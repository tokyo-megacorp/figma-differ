# figma-differ

A Claude Code plugin that snapshots Figma nodes, diffs design changes structurally and visually, surfaces comments, and posts results to Slack.

## Prerequisites

Requires `curl` and `jq` on `PATH`.

### Figma token (one-time)

Get a personal access token at figma.com/settings → **Personal access tokens**, then:

```bash
bash scripts/auth.sh set           # prompts (input hidden), verifies, saves
bash scripts/auth.sh status        # show active source + masked tail
bash scripts/auth.sh doctor        # re-verify against /v1/me
bash scripts/auth.sh clear         # remove the stored token
```

The token is stored at `~/.figma-differ/.env` with mode `600`. Lookup order:

1. `$FIGMA_TOKEN` env var (explicit override, per-invocation)
2. `~/.figma-differ/.env`

This survives shell restarts and reboots, and is readable from the sandboxed subagent context. The old `/tmp/.figma-token` fallback has been removed — `auth.sh set` auto-migrates it on first run if found.

### Optional

```bash
export FIGMA_DIFFER_SLACK_CHANNEL='#design-reviews'  # for /figma-differ:notify
```

---

## Walkthrough

### 1. Snapshot a node

Takes a point-in-time snapshot of a Figma node — fetches its JSON structure and exports a PNG screenshot.

```
/figma-differ:snapshot <figma-url>
```

Stores to `~/.figma-differ/<fileKey>/<nodeId>/<timestamp>/`:
- `node.json` — full node tree
- `screenshot.png` — exported PNG

This is the baseline used by all diff operations.

---

### 2. Diff a node

Compares the current state of a Figma node against its latest snapshot. Runs two parallel analyses:

- **Structural diff** — JSON tree comparison keyed by stable node `id`, reports added/removed/changed nodes with field-level precision (colors, text, sizes, fills)
- **Visual diff** — Claude vision comparison of the two PNGs, produces a fidelity score (1–5) and categorized findings (typography, color, layout, spacing, components)

```
/figma-differ:diff <figma-url>
/figma-differ:diff <figma-url> --notify
```

The `--notify` flag posts the result to Slack immediately after the diff completes.

Diff result is saved to `~/.figma-differ/<fileKey>/<nodeId>/latest-diff.md` for later use with `/figma-differ:notify`.

**Severity scale:** `low` (cosmetic) → `medium` (visual) → `high` (structural) → `critical` (breaking)

---

### 3. Review comments

Fetches all comments on a Figma file and surfaces the unresolved ones, grouped by node.

```
/figma-differ:review-comments <figma-url>
/figma-differ:review-comments <figma-url> --all-comments
```

By default shows only unresolved comments. Pass `--all-comments` to include resolved ones as well.

---

### 4. Notify Slack

Posts the most recent diff result to Slack. Picks up whichever diff was run most recently — single-node or bulk.

```
/figma-differ:notify
/figma-differ:notify --channel #another-channel
```

Formats output differently for single-node vs bulk diffs. Includes severity, top changed nodes, and a summary line.

Requires `FIGMA_DIFFER_SLACK_CHANNEL` to be set, or `--channel` to be passed.

---

### 5. Index a file

Discovers and catalogs every frame in a Figma file at any depth. Creates a frame manifest used by bulk operations.

```
/figma-differ:index <figma-file-url>
```

Writes `~/.figma-differ/<fileKey>/index.json` — a flat list of all frames with their node IDs and names.

Run this before `snapshot-all` or `diff-all` if you want to inspect what frames exist first. The bulk skills will run it automatically if an index doesn't exist.

---

### 6. Bulk snapshot

Snapshots every frame in a Figma file in a single pass. Efficient: fetches the full file tree in one API call, then batch-exports all PNGs in one request.

```
/figma-differ:snapshot-all <figma-file-url>
```

Uses the same timestamp across all frames (atomic file-level snapshot). Also caches comments at `~/.figma-differ/<fileKey>/comments/<timestamp>.json`.

**API call budget:** 1 tree fetch + 1 batch image export + 1 comments fetch — regardless of frame count.

---

### 7. Bulk diff

Diffs every frame in a file against stored snapshots. Designed to be cost-efficient: only frames with actual changes get LLM analysis.

```
/figma-differ:diff-all <figma-file-url>
/figma-differ:diff-all <figma-file-url> --notify
/figma-differ:diff-all <figma-file-url> --notify --top 5
```

Pipeline:
1. Fetch current file tree (1 API call)
2. Bash pre-filter — hash-compare JSON to identify changed frames (zero LLM cost)
3. `structural-differ` agent — analyze only changed frames
4. `vision-analyzer` agent — visual comparison for structurally changed frames only
5. Comment delta — new vs resolved comments since last snapshot
6. Tiered report sorted by severity

`--top N` controls how many frames appear in the detailed section (default: all). Remaining changes appear as one-line summaries.

After a successful run, the snapshot baseline is advanced so the next diff compares against today's state.

Result saved to `~/.figma-differ/<fileKey>/latest-diff-all.md`.

---

## Typical Workflows

### Single node monitoring

```
/figma-differ:snapshot <node-url>
# ... time passes, designer makes changes ...
/figma-differ:diff <node-url> --notify
```

### Whole file review

```
/figma-differ:snapshot-all <file-url>
# ... time passes ...
/figma-differ:diff-all <file-url> --notify --top 5
```

### Scheduled monitoring

Use `/schedule` to run automatically:

```
/schedule create --cron "0 */2 * * *" --prompt "/figma-differ:diff-all <file-url> --notify"
```

Runs every 2 hours. Only posts to Slack when changes are detected.

---

## Architecture

```
scripts/figma-api.sh          Figma REST API helper (no Figma MCP dependency)
skills/snapshot/              Single-node snapshot
skills/diff/                  Single-node structural + visual diff
skills/review-comments/       Figma comment surfacing
skills/notify/                Slack post
skills/index/                 Frame catalog
skills/snapshot-all/          Bulk snapshot
skills/diff-all/              Bulk diff with tiered report
agents/structural-differ.md   JSON tree diff agent
agents/vision-analyzer.md     Claude vision comparison agent
~/.figma-differ/              Runtime snapshot storage (not git-tracked)
```

**Key implementation notes:**
- `figma-api.sh` calls `api.figma.com/v1` directly with `--http1.1` to avoid HTTP/2 stream errors
- Node IDs: `:` is URL-encoded as `%3A` for API calls, `_` for filesystem paths
- Node `id` is stable across renames — diffs key on `id`, not `name`
- Image export is two-step: `/images` returns an S3 URL, then fetch PNG from S3
