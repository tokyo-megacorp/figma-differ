---
name: review-comments
description: >
  Fetches comments from a Figma file and surfaces unresolved ones grouped by node.
  Use when the user runs /figma-differ:review-comments with a Figma URL, or says
  "show Figma comments", "what are the open Figma comments", "review Figma feedback",
  or "check Figma annotations".
argument-hint: "<figma-url> [--all-comments]"
allowed-tools:
  - Bash
  - Read
---

## Fetch and Surface Figma Comments

### 1. Parse the URL

Extract `fileKey` from the Figma URL. Note `nodeId` if present (used for filtering).
Check for `--all-comments` flag in arguments.

### 2. Check prerequisites

Verify a Figma token is loadable: `bash scripts/auth.sh status` (if it fails, tell the user to run `bash scripts/auth.sh set` and stop).

### Data discipline

- NEVER keep raw API responses, JSON trees, or large frame content in the conversation context
- ALWAYS write intermediate data to disk (temp files or `~/.figma-differ/`)
- Subagent prompts MUST include: "Write results to <path>. Report only counts and file paths."
- Final summary to user: counts, paths, and actionable next steps only

### 3. Fetch comments

```bash
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_comments <fileKey>
```

### 4. Filter and group

From the JSON response:
- Default: filter to comments where `resolved_at` is null (unresolved only)
- If `--all-comments`: include all comments
- Group by `client_meta.node_id` (the node the comment is anchored to)
- Sort by `created_at` descending (newest first)

### 5. Display

```
Figma Comments — <fileKey>
<N> unresolved comments (run with --all-comments to see resolved)

Node: <node_name or node_id>
  - [<author>] <message> (<relative_time>)
  - [<author>] <message> (<relative_time>)

Node: <node_name or node_id>
  - [<author>] <message> (<relative_time>)

File-level comments (no node anchor)
  - [<author>] <message> (<relative_time>)
```

If no unresolved comments: `No unresolved comments in this file.`
