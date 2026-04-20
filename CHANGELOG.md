# Changelog

## [0.3.1] — 2026-04-20 — Fix flows.json, Frame.md & Prototype Fetch

### Fixed
- `extract-flows.js`: normalize Figma `/nodes` API response (`{nodes:{id:{document}}}`) before `isSingleNode` detection — fixes silent fallthrough that left `flows.json` empty after save
- `mcp-server.mjs` `persistNode()`: run `generate-frame-md.js` post-save (best-effort) so `frame.md` surfaces connectors, component states, and prototype interactions from `node.json`
- `figma-api.sh`: add `fetch_prototype_data <fileKey> <nodeId>` command using `GET /files/:key` piped through `simplify-node.mjs --subtree` — only endpoint that returns prototype `interactions`
- MCP server instructions: document `fetch_prototype_data` alongside `fetch_node_json` in REST API fallback section

## [0.3.0] — 2026-04-20 — Interaction, Flow & State Enrichment

### Added
- `simplify-node.mjs --subtree <id>` flag — extract a child subtree from a full JSON without re-fetching from the API
- `simplify-node.mjs` now preserves prototype `interactions`, legacy `transitionNodeID`, CONNECTOR fields, and component variant definitions/properties
- `generate-frame-md.js` generates three new searchable sections: **Prototype Flows**, **Connectors**, **Component States** — resolved against `flows.json` when available
- `extract-flows.js` single-node mode (`--node <id> --output <path>`) — extracts interactions and connector edges from a simplified node JSON without a full file tree
- `save` MCP tool: `save_children` and `child_types` params — saves direct children from already-fetched JSON in a single call (no extra API requests)
- Every `save` call now automatically extracts `flows.json` into the snapshot directory (best-effort, non-blocking)
- `get_flows` MCP tool checks snapshot-level `flows.json` first, enabling offline flow queries and diffable interaction history

### Changed
- `/figma-differ:track --depth 1` renamed to `--children[=N]`; depth=2 supported via re-invoke pattern
- `persistNode()` extracted from the `save` handler for reuse
- Uncle Bob: renamed single-letter `p` vars to intent-revealing names; extracted `MIN_DESCRIPTION_LENGTH` constant

## [0.2.6] — 2026-04-20 — Fix Misleading Enrichment Hint on Snapshotted Frames

### Fixed
- `get_frame` no longer fires the "shallow data" enrichment hint when a `node.json` snapshot already exists on disk — hint now only fires when no snapshot is present

## [0.2.5] — 2026-04-20 — MCP Stability, Large Payload Support & Depth Tracking

### Added
- `node_json_path` parameter on `save` tool — pass a file path instead of inlining large JSON payloads (handles 15MB+ SECTION nodes)
- `--depth 1` flag for `/figma-differ:track` — auto-saves direct FRAME/COMPONENT/SECTION children of the tracked node via `fetch_node_json | simplify-node.mjs`

### Fixed
- MCP server no longer crashes on unhandled exceptions — global `uncaughtException` and `unhandledRejection` handlers log to stderr without killing the process
- `get_frame`, `get_flows`, `list_frames` handlers wrapped in try/catch — return error text instead of disconnecting
- `server.connect()` wrapped in try/catch with stderr logging on transport failure
- MCP instructions now include a `CRITICAL` name guardrail: never use URL slug or node-id as the frame name — always extract real name from the response

## [0.2.4] — 2026-04-20 — Fix Absolute Script Paths in Fallback Instructions

### Fixed
- Fallback instructions in MCP server now use absolute paths (`${SCRIPTS_DIR}/figma-api.sh`, `${SCRIPTS_DIR}/simplify-node.mjs`) resolved at runtime via `import.meta.url` — prevents "No such file or directory" when the agent runs the fallback from a different project's CWD

## [0.2.3] — 2026-04-20 — REST API Node Simplifier

### Added
- `scripts/simplify-node.mjs` — strips noisy Figma API JSON (bbox, transforms, constraints, layout props, strokes, effects) down to semantic essentials (`id`, `name`, `type`, `characters`, `componentId`, SOLID `fills`, `children`)
- REST API fallback instructions in MCP server now pipe through `simplify-node.mjs` before `save`

## [0.2.2] — 2026-04-20 — Figma MCP Fallback to REST API

### Added
- Explicit MCP → REST API fallback instructions in the MCP server for all data-fetch scenarios
- `get_frame` thin-content hint now includes REST API fallback steps (`figma-api.sh fetch_node_json`)
- "Frame not found" response now guides agent through MCP-first + REST fallback fetch flow
- New "Figma MCP Fallback" section in server instructions with field mapping for REST API responses

## [0.2.1] — 2026-04-20 — Marketplace Schema Fix

### Fixed
- `marketplace.json` source field changed from `"."` to proper `{ source: "url", url: "..." }` schema
- Removed `slack` from plugin keywords (implementation detail, not a use case)
- Fixed `homepage` and `repository` URLs in `plugin.json` (`ipedro` → `tokyo-megacorp`)

## [0.2.0] — 2026-04-20 — Dashboard Cockpit & MCP Foundation

### Added
- Dashboard cockpit with triage context and frame-level enrichment surfaced directly
- Task-driven UX for all long-running skills with real-time progress feedback
- Versioned review payload contract stabilizing the dashboard data shape
- MCP server with save tool and Figma MCP bridge instructions
- MCP routing hook — injects figma-differ tool guidance per turn
- QMD semantic search over Figma frames with flow detection
- Dashboard: Index, Accordion, and Detail screens with full CSS theme system
- Dashboard: threaded replies, user avatars, file metadata, comment badges
- Dashboard: comments integration, timeline view, lazy image loading, keyboard navigation
- Dashboard: frame filter, clickable frames, diff range cards
- Figma API: `fetch_versions`, `fetch_image_urls`, and version param on `fetch_node_json`
- Persistent frame threads in Slack notifications with semantic emoji system
- Batch node fetch and proper structural diff pipeline (`diff-all`)
- Durable Figma token storage via `~/.figma-differ/.env` (mode 0600)
- Plugin validation script and npm scripts
- GitHub Actions CI workflow + Dependabot

### Fixed
- Standardized task lifecycle across all long-running skills
- CANVAS detection, large node warnings, and progress feedback
- Split hooks — public plugin vs local dev-only
- Auth: strip CRLF from `.env` tokens; trap temp file in `_verify_token`
- Diff: filter bbox/constraint-only changes as noise, not cosmetic changes
- Dashboard: block comment and template interpolation bugs

### Changed
- Progressive frame enrichment with data discipline improvements
- Contract drift reduced across hook, flow, and degradation paths

### Other
- Property invariant tests + synthetic stress tests (77 dashboard tests + 34 Playwright tests)
- Full test coverage for all core scripts (10/10)
- MIT License, CONTRIBUTING.md, and architecture overview
