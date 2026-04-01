---
name: figma-differ index
description: >
  Discovers and catalogs all frames in a Figma file at any depth. Creates a frame
  manifest for bulk operations. Use when the user runs /figma-differ:index with a
  Figma file URL, or says "index this Figma file", "list all frames", "catalog
  Figma screens", or "discover frames".
argument-hint: "<figma-file-url>"
allowed-tools:
  - Bash
  - Read
  - Write
---

## Index All Frames in a Figma File

### 1. Parse the URL

Extract `fileKey` from the Figma URL. Node ID is not needed — we're indexing the whole file.

### 2. Check prerequisites

Verify `FIGMA_TOKEN` is set (error if not).

### 3. Fetch the full file tree

```bash
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_file_tree <fileKey>
```

This returns the entire node tree in one API call. Extract `document.name` from the top-level response — this is the `fileName` for the index.

### 4. Walk the tree recursively

Parse the JSON response. Collect all nodes where `type == "FRAME"` at any depth.
For each frame, record: `id`, `name`, `type`, and the page name (parent CANVAS node's name).

**IMPORTANT: Do NOT use jq recursive descent (`..`) — it hangs on large (10-30MB) Figma trees.**

Use explicit path traversal instead:
```bash
jq '[.document.children[] as $page |
  $page.children[]? |
  recurse(.children[]?) |
  select(.type == "FRAME" or .type == "COMPONENT" or .type == "COMPONENT_SET") |
  {id: .id, name: .name, type: .type, page: $page.name}]'
```

This walks: document → pages (CANVAS) → children → recurse into nested children. Collects FRAME, COMPONENT, and COMPONENT_SET nodes.

### 5. Write index

```bash
FIGMA_DATA="$HOME/.figma-differ"
mkdir -p "${FIGMA_DATA}/<fileKey>"
```

Write to `${FIGMA_DATA}/<fileKey>/index.json` (overwrites any previous index):
```json
{
  "fileKey": "<fileKey>",
  "fileName": "<document.name from response>",
  "lastIndexed": "<timestamp>",
  "frames": [
    { "id": "<nodeId>", "name": "<frameName>", "type": "FRAME", "page": "<pageName>" }
  ]
}
```

### 6. Confirm

```
Indexed <fileName>
Found N frames across M pages:
  Page "Screens": 45 frames
  Page "Components": 120 frames
  Page "Archive": 38 frames

Index saved to ~/.figma-differ/<fileKey>/index.json
Run /figma-differ:snapshot-all <url> to snapshot all frames.
```
