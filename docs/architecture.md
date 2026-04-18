# Architecture

## Overview

```
Figma API ──> node.json ──> frame.md ──> QMD index ──> MCP server ──> Claude
     |                         |                            |
     |-- screenshot.png        |-- colors, buttons,         |-- search
     |-- comments              |   forms, layout,           |-- get_frame
     '-- flows (CONNECTOR)     |   flows, description       |-- get_flows
                               '-- indexed by QMD           |-- list_frames
                                                            '-- save
```

## Data Flow

1. **Snapshot** captures the raw Figma node tree as `node.json` and exports a PNG screenshot.
2. **generate-frame-md.js** extracts text, components, colors, buttons, forms, layout, flows, and description from `node.json` and writes a searchable `frame.md` document. Large SECTION/CANVAS nodes emit explicit degraded warnings instead of silently pretending full fidelity.
3. **QMD** indexes every `frame.md` for hybrid search (FTS5 full-text + vector similarity + reranking).
4. **MCP server** (`scripts/mcp-server.mjs`) wraps QMD and the local data store, exposing tools that Claude can call during a conversation.

## Storage Layout

```
~/.figma-differ/
|-- .env                                    # Figma token (mode 600)
|-- config.json                             # Slack channel config
|-- tracked.json                            # Tracked files registry
'-- <fileKey>/
    |-- index.json                          # Frame catalog
    |-- flows.json                          # Screen flow connections
    |-- latest-diff-all.json                # Last bulk diff result
    |-- slack-threads.json                  # Slack thread registry
    |-- comments/<timestamp>.json           # Cached Figma comments
    '-- <nodeId_safe>/
        |-- frame.md                        # Searchable frame document
        |-- latest-diff.md                  # Last diff result
        '-- <timestamp>/
            |-- node.json                   # Figma node snapshot
            '-- screenshot.png              # PNG export
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `search` | Semantic search across indexed frames via QMD (FTS5 + vector) |
| `get_frame` | Get full frame.md content by node ID, or a compact summary via `summary: true` |
| `get_flows` | Screen flow connections (CONNECTOR lines + prototype transitions) |
| `list_frames` | Browse all indexed frames with metadata |
| `save` | Ingest a Figma node from Figma MCP into the local database |

## Flow Detection

CONNECTOR nodes in the Figma file tree have `connectorStart.endpointNodeId` and `connectorEnd.endpointNodeId`. Prototype transitions use `transitionNodeID` on interactive elements. `extract-flows.js` is the source of truth for persisted flow semantics: it resolves endpoints to their parent frames and excludes self-loops before writing `flows.json`. The MCP server only presents subsets of that filtered edge set.

## Hook routing

`hooks/hooks.json` registers prompt-time routing guidance and a subagent routing injector. The injector prepends variant-specific figma-differ guidance for spawned subagents while remaining fail-open and idempotent.

## Figma MCP Bridge

The `save` tool accepts data fetched via Figma MCP's `get_design_context`. Field mapping:

- `fileKey` maps to `file_key`
- `nodeId` maps to `node_id`
- Component names and text from the response map to `metadata.components` and `metadata.text_content`

Saved frames are immediately searchable via the `search` tool.
