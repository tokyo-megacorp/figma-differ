---
name: figma-differ notify
description: >
  Posts the latest diff result to the configured Slack channel. Use when the user
  runs /figma-differ:notify, or says "post the diff to Slack", "share the Figma diff",
  "notify the team about design changes", or "send diff to Slack".
argument-hint: "[--channel <channel>]"
allowed-tools:
  - Read
  - mcp__claude_ai_Slack__slack_send_message
  - mcp__claude_ai_Slack__slack_search_channels
---

## Post Latest Diff to Slack

### 1. Check prerequisites

- Verify `FIGMA_DIFFER_SLACK_CHANNEL` is set, or `--channel` flag was passed
  - If neither: error — `Set FIGMA_DIFFER_SLACK_CHANNEL or pass --channel #channel-name`
- Find the latest diff result: check both `~/.figma-differ/**/latest-diff-all.md` (bulk diff) and `~/.figma-differ/**/latest-diff.md` (single-node diff); use whichever was most recently modified
  - If none found: error — `No diff result found. Run /figma-differ:diff <url> first.`

### 2. Read the diff result

Read the chosen diff result file (`latest-diff-all.md` or `latest-diff.md`).

### 3. Format for Slack

**Single-node diff** (`latest-diff.md`) — format as:

```
*Figma Diff Report* — <timestamp>

*Structural Changes*
> <summary line from diff>
Severity: <severity>

*Visual Fidelity*: <score>/5
> <summary from vision-analyzer>

*Action Items*
- <item 1>
- <item 2>

_<fileKey> / <nodeId> — <snapshot baseline timestamp>_
```

**Bulk diff** (`latest-diff-all.md`) — format as:

```
*Figma Bulk Diff Report* — <timestamp>
<summary line: e.g. "3/10 nodes changed — 1 critical, 1 warning, 1 info">

*Top Changes*
1. *<nodeId>* — <one-line summary> [<severity>]
2. *<nodeId>* — <one-line summary> [<severity>]
3. *<nodeId>* — <one-line summary> [<severity>]

_<fileKey> — <snapshot baseline timestamp>_
```

Include up to the top 5 changed nodes, ordered by severity (critical first).

### 4. Post to Slack

Use `mcp__claude_ai_Slack__slack_send_message`. The tool requires a `channel_id` (e.g. `C01234ABCDE`), not a channel name. If `FIGMA_DIFFER_SLACK_CHANNEL` contains a name like `#design-reviews`, first resolve it to an ID using `mcp__claude_ai_Slack__slack_search_channels`, then pass the `id` field to `slack_send_message`.

- `channel_id`: resolved channel ID
- `text`: the formatted message above

### 5. Confirm

```
Diff posted to <channel>
```
