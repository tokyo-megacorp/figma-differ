# figma-differ — Agent Contract

Claude Code plugin that snapshots Figma nodes, diffs design changes structurally and visually, surfaces comments, and posts results to Slack.

## Documentation Hierarchy

Three surfaces — never collapsed:

- **README.md** — public pitch, prerequisites, walkthrough
- **AGENTS.md** (this file) — agent-facing runtime contract
- **docs/** — narrative: architecture, usage, command reference

CLAUDE.md and GEMINI.md are one-line pointers to this file.

## Repository Identity

| Field | Value |
|---|---|
| Repo | `tokyo-megacorp/figma-differ` |
| Plugin namespace | `figma-differ:*` |
| Entry point | `.claude-plugin/plugin.json` |
| Runtime state | `~/.figma-differ/<fileKey>/<nodeId>/` (snapshots, diffs) |
| Auth | `~/.figma-differ/.env` (mode 600) — never committed |

## Architecture

Two-agent design for diff operations:

- **structural-differ** — compares two Figma node JSON snapshots; identifies added/removed/changed nodes with field-level precision (colors, text, sizes, fills)
- **vision-analyzer** — compares two PNGs via Claude vision; produces fidelity score (1–5) and categorized findings (typography, color, layout, spacing, components)

Both agents are spawned in parallel by the `/figma-differ:diff` skill and their results are merged into a single diff report.

## Key Invariants

- Figma token stored at `~/.figma-differ/.env` (600) — never in env vars, commits, or logs
- Snapshots keyed by `<fileKey>/<nodeId>/<timestamp>/` — `node.json` + `screenshot.png`
- `latest-diff.md` at `<fileKey>/<nodeId>/latest-diff.md` — used by notify skill
- Canvas/page nodes: JSON snapshot only, PNG export skipped (warn user)
- Severity scale: `low` (cosmetic) → `medium` (visual) → `high` (structural) → `critical` (breaking)
- Slack channel via `$FIGMA_DIFFER_SLACK_CHANNEL` env var

## Project Structure

```
agents/          — structural-differ, vision-analyzer
skills/          — diff, diff-all, enrich, index, notify, review-comments, search,
                   snapshot, snapshot-all, sync, track
commands/        — user-facing slash commands
hooks/           — hooks.json (lifecycle hook config)
tests/           — bash + JS test suite
scripts/         — auth.sh, figma-api.sh, diff-all.sh, mcp-server.mjs, etc.
docs/            — narrative documentation
snapshots/       — committed baseline snapshots (sample data)
data/            — reference data
```

## Coding Conventions

- Claude Code plugin — skills, agents, and commands are Markdown + YAML frontmatter
- Shell scripts (`scripts/`) use `bash` — must pass `shellcheck`
- Node/JS scripts (`scripts/*.js`, `scripts/*.mjs`) use async/await throughout (`execAsync` not `execSync`)
- No runtime dependencies beyond Claude Code's built-in tools + `curl` + `jq`
- Auth via `scripts/auth.sh` — never hardcode tokens

## AGENTS File Index

Exhaustive list of every `AGENTS.md` in this repo. Keep this section in sync — additions here are the format's most-broken contract.

- [`/AGENTS.md`](AGENTS.md) — TODO: one-line purpose
- [`/agents/AGENTS.md`](agents/AGENTS.md) — 2 agent definitions
- [`/skills/AGENTS.md`](skills/AGENTS.md) — 11 skill subdirs
- [`/tests/AGENTS.md`](tests/AGENTS.md) — test suite contract

## Update Triggers

Update this file when:
- A new agent is added to `agents/` or removed
- A new skill subdir is added to `skills/` or removed
- The auth storage location changes
- The snapshot path schema changes
- A new entry point is added to `.claude-plugin/`

## Reviewer Contract

Reviewers must treat the `AGENTS.md` hierarchy as part of the code contract. Block or request changes when a PR:

- Adds, removes, or moves a top-level directory without updating the root AGENTS File Index and Documentation Hierarchy.
- Adds a new ownership boundary without a local `AGENTS.md` or an explicit inheritance decision in the nearest parent contract.
- Changes subsystem responsibilities, public entrypoints, runtime behavior, dependencies, or cross-subsystem contracts without updating the relevant child `AGENTS.md`.
- Changes verification requirements without updating local `Verification` and `Change Triggers` sections.
- Duplicates global routing rules outside the canonical routing contract.
- Leaves discovered child `AGENTS.md` files and the root index out of sync.

Prefer small local contract updates over broad root-file expansion.

## Child Contract Schema

Every child `AGENTS.md` should use this local schema:

- `Local Role`
- `Product Vision Fit`
- `Tech Stack Boundaries`
- `Owns`
- `Does Not Own`
- `Routes Elsewhere`
- `Local Examples`
- `Verification`
- `Change Triggers`
