# Changelog

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
