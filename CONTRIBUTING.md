# Contributing to figma-differ

figma-differ is a Claude Code plugin with an MCP server for Figma design search and diff. Contributions are welcome.

## Prerequisites

- **Node.js 20+**
- **bash 4+** (required for shell tests)
- **QMD** (optional -- enables semantic search; install via `brew install qmd` or `bun install -g @tobilu/qmd`)
- **Figma personal access token** (optional -- needed for API integration tests; set via `bash scripts/auth.sh set`)

## Setup

```bash
git clone https://github.com/ipedro/figma-differ.git
cd figma-differ
npm install
npx playwright install
npm test
```

## Project Structure

| Directory | Contents |
|-----------|----------|
| `scripts/` | 13 core scripts -- API wrapper, diff engine, flow extractor, MCP server, validation |
| `skills/` | 10 skill definitions (snapshot, diff, diff-all, index, search, track, sync, notify, review-comments) |
| `commands/` | 10 slash command entry points (one per skill) |
| `agents/` | 2 sub-agents (structural-differ, vision-analyzer) |
| `tests/` | 14 test files -- unit (.test.js), e2e (mcp-server.test.js), browser (dashboard.spec.js), shell (.test.sh) |
| `.claude-plugin/` | Plugin manifest (plugin.json) and marketplace config (marketplace.json) |
| `hooks/` | Hook configuration (hooks.json) and hook scripts |

## Running Tests

- **`npm test`** -- unit tests + e2e tests (MCP server + Playwright)
- **`npm run test:shell`** -- bash integration tests (some require `FIGMA_TOKEN` env var)
- **`npm run validate`** -- plugin structure validation

## Adding a Skill

1. Create `skills/<name>/SKILL.md` with YAML frontmatter: `name` (required), `description` (required), `allowed-tools` (optional list), `argument-hint` (optional).
2. Create `commands/<name>.md` with frontmatter `description` and `argument-hint`, body: `Invoke the \`figma-differ <name>\` skill with the provided arguments.`
3. Run `npm run validate` to verify structure.

## MCP Server

The MCP server (`scripts/mcp-server.mjs`) exposes 5 tools: `search`, `get_frame`, `get_flows`, `list_frames`, `save`. To add a tool, use `server.tool()` in the MCP server file. Test via JSON-RPC stdio or with `tests/mcp-server.test.js`.

## PR Guidelines

- Run `npm test && npm run validate` before submitting.
- Follow conventional commit messages (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
- Tests for new functionality are expected.
