# Production Readiness: CI, Docs, Marketplace

**Date:** 2026-04-18
**Status:** Approved
**Approach:** Remix — CI-first with MCP instructions as living docs

## Context

figma-differ is a mature Claude Code plugin (64 source files, 150 tests, MCP server, 5 tools) that lacks production scaffolding for public marketplace distribution and open source contribution. The claude-code-plugin-template provides reference patterns for CI, docs, and marketplace config. After a 3x3 idea matrix evaluating 9 approaches, the "Remix" approach scored highest (8.0/10) — leverage what already exists (MCP instructions, README, comprehensive tests) and add only the missing infrastructure.

## Design

### 1. npm scripts in package.json

Wrap existing test runners so `npm test` works:

```json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:e2e",
    "test:unit": "node tests/generate-frame-md.test.js && node tests/extract-flows.test.js && node tests/structural-diff.test.js && node tests/bulk-diff.test.js && node tests/render-review.test.js",
    "test:e2e": "node tests/mcp-server.test.js && npx playwright test",
    "test:shell": "bash tests/figma-api.test.sh && bash tests/diff-all.test.sh && bash tests/hooks.test.sh && bash tests/benchmark.test.sh && bash tests/compile-review.test.sh && bash tests/test-api.test.sh",
    "validate": "node scripts/validate-plugin.js"
  }
}
```

Shell tests run separately via `npm run test:shell` (not included in `npm test`).

**First-run setup:** Contributors must run `npx playwright install` once before `npm test` will work (Playwright needs browser binaries). This is documented in CONTRIBUTING.md.

### 2. GitHub Actions CI — 2 jobs

File: `.github/workflows/ci.yml`

Both jobs run in **parallel** (no `needs:` dependency).

**Job 1: validate** — structural checks (no Figma token or QMD needed)
- Checkout + setup Node 20
- `npm ci`
- `npm run validate` (calls `scripts/validate-plugin.js`)
- MCP server health check: spawn `node scripts/mcp-server.mjs`, send initialize + tools/list, assert 5 tools returned (search, get_frame, get_flows, list_frames, save), kill process

**Job 2: test** — run test suite (steps in this order)
1. Checkout + setup Node 20
2. `npm ci`
3. `npx playwright install --with-deps` (install browsers BEFORE tests)
4. `npm run test:unit` (62 + 34 + other unit assertions)
5. `npm run test:e2e` (MCP server e2e + Playwright dashboard tests)
6. `npm run test:shell` (bash tests — some may skip if FIGMA_TOKEN not set)

**Shell test environment:** Shell tests that call the Figma API (figma-api.test.sh, test-api.test.sh) require `FIGMA_TOKEN` as an env var. In CI, these tests skip gracefully if the token is absent. QMD-dependent tests also skip gracefully if `qmd` is not in PATH.

Triggers: push to main, pull requests to main.

### 3. Plugin validation script

File: `scripts/validate-plugin.js`

Standalone Node.js script (no deps — frontmatter parsed via regex between `---` delimiters) that checks:

**plugin.json** — exists, valid JSON, required fields: `name`, `version`, `description`, `author` (object with `name`)
**marketplace.json** — exists, valid JSON, required fields: `name`, `owner` (object with `name`), `metadata.version`, `plugins` (array with at least one entry, each having `name`, `description`, `version`, `source`)
**commands/ ↔ skills/** — every directory in commands/ has a matching directory in skills/
**SKILL.md frontmatter** — each skill has SKILL.md with frontmatter containing required keys: `name`, `description`
**MCP server** — `mcpServers` entry in plugin.json points to a file that exists on disk
**hooks.json** — exists and is valid JSON

Exits 0 if all pass, 1 with errors listed. Used by CI and locally via `npm run validate`.

### 4. marketplace.json — self-contained

Fix the current marketplace.json to be self-contained:

```json
{
  "name": "figma-differ",
  "owner": {
    "name": "Pedro Almeida",
    "url": "https://github.com/ipedro"
  },
  "metadata": {
    "description": "Local Figma design database with semantic search, change tracking, flow detection, and Slack notifications.",
    "version": "0.2.0"
  },
  "plugins": [
    {
      "name": "figma-differ",
      "description": "Snapshot Figma canvases, diff design changes, search frames semantically, detect screen flows, and notify Slack.",
      "version": "0.2.0",
      "author": { "name": "Pedro Almeida" },
      "source": ".",
      "category": "design-tools",
      "tags": ["figma", "design", "diff", "semantic-search", "mcp"],
      "keywords": ["figma", "design-review", "snapshot", "diff", "qmd", "semantic-search", "flow-detection", "slack"]
    }
  ]
}
```

### 5. LICENSE

MIT license at repo root. Author: Pedro Almeida.

### 6. CONTRIBUTING.md

Covers:
- Prerequisites: Node.js 20+, bash 4+ (for shell tests), QMD (optional, for search features), Figma personal access token (optional, for API tests)
- First-run setup: clone, `npm install`, `npx playwright install`, `npm test`
- Project structure: scripts/, skills/, commands/, agents/, tests/
- How to add a skill: create skill dir + command, follow existing patterns
- How to test: `npm run test:unit`, `npm run test:e2e`, `npm run test:shell`
- MCP server development: how to add tools, test via stdio
- PR guidelines: run `npm test` + `npm run validate` before submitting

### 7. architecture.md

Single doc covering:
- System overview diagram (snapshot → index → generate-frame-md → QMD → MCP)
- Data flow: Figma API → node.json → frame.md → QMD index → MCP search
- Storage layout: `~/.figma-differ/<fileKey>/` structure
- MCP tools: what each does, when to use
- Flow detection: CONNECTOR nodes + transitionNodeID extraction
- Bridge: Figma MCP → save → local database

This is the ONE doc file. MCP server instructions remain the primary agent-facing docs (living, always in sync).

### 8. dependabot.yml

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

### 9. Version bump

Bump to `0.2.0` in these files (all must stay in sync):
- `package.json` — `version` field
- `.claude-plugin/plugin.json` — `version` field
- `.claude-plugin/marketplace.json` — `metadata.version` and `plugins[0].version`

## What we explicitly skip

- Generic Claude Code plugin docs (hooks.md, settings.md, etc.) — those belong in Claude Code's own docs
- 4-job CI from the template — overkill for single plugin
- PreToolUse validation hook — nice-to-have, not blocking
- Multi-plugin marketplace structure — we're one plugin

## Verification

1. `npm test` passes all unit + e2e tests
2. `npm run validate` passes structural checks
3. `npm run test:shell` passes bash tests
4. GitHub Actions CI runs green on push
5. marketplace.json validates against template schema
6. MCP server starts and lists 5 tools in CI (search, get_frame, get_flows, list_frames, save)
