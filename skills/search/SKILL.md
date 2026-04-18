---
name: figma-differ search
description: >
  Semantic search across all tracked Figma frames using QMD hybrid search.
  Finds frames by content, component names, text strings, or natural language
  queries like "the login screen" or "frames with portfolio charts". Use when
  the user runs /figma-differ:search or says "find the Figma frame for",
  "which frame has", "search Figma frames", or "find frames with".
argument-hint: "<query>"
allowed-tools:
  - Bash
  - Read
---

## Search Figma Frames

### 1. Check prerequisites

Verify QMD is installed:
```bash
command -v qmd >/dev/null 2>&1
```
If not installed, tell the user: `Install QMD for semantic search: brew install qmd` and stop.

Verify the figma collection exists:
```bash
qmd collection show figma 2>/dev/null
```
If no collection, tell the user to run `/figma-differ:track <url>` first and stop.

### 2. Run hybrid search

Use `qmd search` scoped to the figma collection for fast keyword results:

```bash
qmd search -n 10 -c figma "<query>"
```

For richer semantic results (uses vectors + reranking, slower on first run):
```bash
qmd query -n 10 -c figma --min-score 0.2 "<query>"
```

Prefer `qmd search` for speed. Use `qmd query` when keyword search returns poor results or the user asks for "semantic" or "similar" frames.

If no results from either, fall back with a lower threshold:
```bash
qmd search -n 10 -c figma --min-score 0.1 "<query>"
```

### 3. Parse results

QMD outputs results with paths like `<fileKey>/<nodeId_safe>/frame.md` and match scores.

For each result:
1. Extract `fileKey` and `nodeId_safe` from the path
2. Convert `nodeId_safe` back to `nodeId` (replace `_` with `:`)
3. Read the frame.md frontmatter to get: `title`, `figma_page`, `figma_url`, `figma_type`, `node_count`
4. Read the `## Components Used` section for context

### 4. Present results

Format results as a ranked list:

```
Search: "<query>"  (N results)

1. [92%] Login Screen
   Page: Auth Flows | Type: FRAME | 177 nodes
   Components: Modal, Keyboard, iOS Bar
   Figma: <figma_url>

2. [78%] Recovery Login
   Page: Auth Flows | Type: FRAME | 94 nodes
   Components: Input Field, Button, Link
   Figma: <figma_url>

3. [65%] ...

Run /figma-differ:diff <url> to check a frame for changes.
```

If no results found, suggest:
- Checking the query for typos
- Running `/figma-differ:sync` to refresh the index
- Trying broader or different terms
