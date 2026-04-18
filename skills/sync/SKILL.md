---
name: figma-differ sync
description: >
  Refresh snapshots and search index for tracked Figma files. Fetches current
  state from Figma, generates frame.md documents, and updates the QMD search
  index. Use when the user runs /figma-differ:sync or says "sync Figma",
  "refresh snapshots", "update the Figma index", or "re-sync tracked files".
argument-hint: "[<figma-file-url>]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
  - Agent
  - TaskCreate
  - TaskUpdate
---

## Sync Tracked Figma Files

### 1. Determine which files to sync

**If a URL is provided:** extract `fileKey` and sync only that file.

**If no URL:** read `~/.figma-differ/tracked.json` and sync all tracked files. If no tracked files exist, tell the user to run `/figma-differ:track <url>` first.

### 2. Orchestration pattern

For each file, create tasks and dispatch haiku subagents per phase. The main conversation shows only task progress and a final summary. Raw output stays in forked agents.

```
TaskCreate("Fetch file tree",       activeForm: "Fetching <fileName> from Figma API...")
TaskCreate("Index all frames",      activeForm: "Cataloging frames and sections...")
TaskCreate("Extract screen flows",  activeForm: "Mapping connector lines and transitions...")
TaskCreate("Generate frame docs",   activeForm: "Extracting text, colors, buttons, layout...")
TaskCreate("Update search index",   activeForm: "Indexing frames for semantic search...")
```

Execute each phase sequentially — each depends on the previous. Mark tasks `in_progress` before starting, `completed` when done.

### 3. Phase execution

Each phase dispatches an `Agent(model: "haiku")` subagent. The agent runs the commands and reports only counts — never raw JSON or file contents.

#### Phase 1: Fetch file tree

```
Agent(model: "haiku", prompt: "
  Fetch the Figma file tree for <fileKey>.
  Run: bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_file_tree <fileKey> > /tmp/figma-tree-<fileKey>.json
  Report: file size in bytes
")
```

#### Phase 2: Index frames

```
Agent(model: "haiku", prompt: "
  Walk /tmp/figma-tree-<fileKey>.json and extract FRAME/SECTION/COMPONENT_SET nodes.
  Write ~/.figma-differ/<fileKey>/index.json.
  Report: total frame count
")
```

#### Phase 3: Extract flows

```
Agent(model: "haiku", prompt: "
  Run: node $CLAUDE_PLUGIN_ROOT/scripts/extract-flows.js <fileKey> /tmp/figma-tree-<fileKey>.json
  Report: connector count, prototype count, frames with flows
")
```

#### Phase 4: Generate frame docs

```
Agent(model: "haiku", prompt: "
  Run: node $CLAUDE_PLUGIN_ROOT/scripts/generate-frame-md.js <fileKey>
  Report: generated count, skipped count
")
```

#### Phase 5: Update search index

```
Agent(model: "haiku", prompt: "
  Run: source $CLAUDE_PLUGIN_ROOT/scripts/lib/qmd.sh && qmd_reindex
  Report: new docs indexed, chunks embedded
")
```

After all phases: clean up temp tree file, update `tracked.json` with `lastSynced` timestamp.

### 4. Report

After all tasks complete, print a single summary:

```
Sync complete — <fileName> (<fileKey>)
  Frames: F indexed
  Flows: C connectors, P prototype
  Docs: G generated (S skipped)
  Search: N new chunks embedded
  Last synced: <timestamp>

/figma-differ:search "query" to find frames
/figma-differ:diff-all <url> to check changes
```
