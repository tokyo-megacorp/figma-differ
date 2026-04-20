---
name: figma-differ enrich
description: >
  Re-fetch and enrich thin Figma frames that have shallow data (1 node,
  generic description like "dark mode screen", or description under 30 chars).
  Uses REST API to fetch full node JSON and regenerates frame.md for each thin
  frame. Use when the user runs /figma-differ:enrich, says "enrich thin frames",
  "improve frame descriptions", or "deep-fetch all frames".
argument-hint: "<figma-file-url-or-fileKey>"
allowed-tools:
  - Bash
  - Read
  - Skill
  - Agent
  - TaskCreate
  - TaskUpdate
---

## Enrich Thin Frames

### 1. Parse arguments

Extract `fileKey` from `$ARGUMENTS`:
- If it looks like a Figma URL, extract the fileKey segment: `https://www.figma.com/design/<fileKey>/...`
- If it's a bare fileKey (no slashes), use it directly

### 2. Check prerequisites

```bash
bash $CLAUDE_PLUGIN_ROOT/scripts/auth.sh status
```

If it fails, tell the user to run `bash $CLAUDE_PLUGIN_ROOT/scripts/auth.sh set` and stop.

Verify the fileKey has local data:
```bash
ls ~/.figma-differ/<fileKey>/
```

If missing, tell the user to run `/figma-differ:track <url>` first.

### 3. Orchestration

```
TaskCreate("Scan thin frames",   activeForm: "Detecting frames with shallow data...")
TaskCreate("Re-fetch & enrich",  activeForm: "Fetching full node JSON for thin frames...")
TaskCreate("Rebuild frame docs", activeForm: "Regenerating frame.md documents...")
TaskCreate("Update search index", activeForm: "Re-indexing enriched frames in QMD...")
```

**Task lifecycle:**
1. Create ALL tasks upfront (pending)
2. Before each phase: `TaskUpdate(taskId, status: "in_progress")`
3. Dispatch `Agent(model: "haiku")` — agent reports only counts, never raw output
4. After agent returns: `TaskUpdate(taskId, status: "completed")`
5. Every task must be completed or deleted before final summary

### Data discipline

- NEVER keep raw API responses or JSON in conversation context
- ALWAYS write intermediate data to temp files
- Subagent prompts MUST include: "Write results to <path>. Report only counts and file paths."

### 4. Run enrichment

Dispatch a haiku agent to run the script:

```
Prompt: Run enrich-thin-frames.sh for fileKey <fileKey>.
Command: bash $CLAUDE_PLUGIN_ROOT/scripts/enrich-thin-frames.sh <fileKey>
Write stdout to /tmp/enrich-<fileKey>-result.txt.
Report only: total frames scanned, enriched count, skipped count, QMD status.
```

### 5. Report

```
Enrich complete: <fileKey>
  Frames scanned: N
  Enriched:       M  (were thin — re-fetched and frame.md regenerated)
  Already rich:   K  (skipped)
  QMD index:      updated | unchanged

Run /figma-differ:search "query" to verify enriched frames are now findable.
```
