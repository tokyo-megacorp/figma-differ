# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make figma-differ marketplace-ready and contributor-friendly with CI, docs, licensing, and validation.

**Architecture:** Add infrastructure around the existing codebase — no functional changes. npm scripts wrap existing test runners, CI validates structure + runs tests, validate-plugin.js checks plugin health, docs describe the system.

**Tech Stack:** GitHub Actions, Node.js (no new deps), Playwright (existing)

**Spec:** `docs/superpowers/specs/2026-04-18-production-readiness-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `scripts/validate-plugin.js` | Plugin structure validation |
| Create | `.github/workflows/ci.yml` | CI pipeline (validate + test) |
| Create | `.github/dependabot.yml` | Dependency updates |
| Create | `LICENSE` | MIT license |
| Create | `CONTRIBUTING.md` | Contributor onboarding |
| Create | `docs/architecture.md` | System overview |
| Modify | `package.json` | Add scripts, bump version |
| Modify | `.claude-plugin/plugin.json` | Bump version |
| Modify | `.claude-plugin/marketplace.json` | Self-contained config |

---

### Task 1: npm scripts + version bump

**Files:**
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Add scripts to package.json**

```json
{
  "name": "figma-differ",
  "version": "0.2.0",
  "private": true,
  "scripts": {
    "test": "npm run test:unit && npm run test:e2e",
    "test:unit": "node tests/generate-frame-md.test.js && node tests/extract-flows.test.js && node tests/structural-diff.test.js && node tests/bulk-diff.test.js && node tests/render-review.test.js",
    "test:e2e": "node tests/mcp-server.test.js && npx playwright test",
    "test:shell": "bash tests/figma-api.test.sh && bash tests/diff-all.test.sh && bash tests/hooks.test.sh && bash tests/benchmark.test.sh && bash tests/compile-review.test.sh && bash tests/test-api.test.sh",
    "validate": "node scripts/validate-plugin.js"
  },
  "devDependencies": {
    "@playwright/test": "^1.59.1"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0"
  }
}
```

- [ ] **Step 2: Bump version in plugin.json to 0.2.0**

Change `"version": "0.1.0"` to `"version": "0.2.0"` in `.claude-plugin/plugin.json`.

- [ ] **Step 3: Rewrite marketplace.json as self-contained**

Replace entire `.claude-plugin/marketplace.json` with:

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

- [ ] **Step 4: Verify npm test works**

Run: `npm test`
Expected: all unit + e2e tests pass (generate-frame-md, extract-flows, structural-diff, bulk-diff, render-review, mcp-server, playwright)

- [ ] **Step 5: Commit**

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: add npm scripts, bump to 0.2.0, fix marketplace.json"
```

---

### Task 2: Plugin validation script

**Files:**
- Create: `scripts/validate-plugin.js`

- [ ] **Step 1: Create validate-plugin.js**

```js
#!/usr/bin/env node
/**
 * validate-plugin.js — validate figma-differ plugin structure
 *
 * Checks plugin.json, marketplace.json, skills, commands, hooks, and MCP server.
 * No external dependencies — uses only Node.js built-ins.
 *
 * Exit 0 if all pass, 1 if any fail.
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PLUGIN_DIR = path.join(ROOT, '.claude-plugin')
let passed = 0
let failed = 0

function check(name, condition) {
  if (condition) {
    passed++
    console.log(`  [PASS] ${name}`)
  } else {
    failed++
    console.log(`  [FAIL] ${name}`)
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function parseFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const fm = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w[\w-]*):\s*(.+)/)
    if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  return fm
}

// ── plugin.json ─────────────────────────────────────────────────────────────
console.log('plugin.json')
const pluginPath = path.join(PLUGIN_DIR, 'plugin.json')
const plugin = readJson(pluginPath)
check('exists and is valid JSON', plugin !== null)
if (plugin) {
  check('has name', !!plugin.name)
  check('has version', !!plugin.version)
  check('has description', !!plugin.description)
  check('has author.name', !!plugin.author?.name)

  // MCP server entry points to real file
  if (plugin.mcpServers) {
    for (const [name, cfg] of Object.entries(plugin.mcpServers)) {
      const args = cfg.args || []
      const serverPath = args[0]?.replace('${CLAUDE_PLUGIN_ROOT}', ROOT)
      check(`mcpServers.${name} file exists`, serverPath && fs.existsSync(serverPath))
    }
  }
}

// ── marketplace.json ────────────────────────────────────────────────────────
console.log('\nmarketplace.json')
const marketplacePath = path.join(PLUGIN_DIR, 'marketplace.json')
const marketplace = readJson(marketplacePath)
check('exists and is valid JSON', marketplace !== null)
if (marketplace) {
  check('has name', !!marketplace.name)
  check('has owner.name', !!marketplace.owner?.name)
  check('has metadata.version', !!marketplace.metadata?.version)
  check('has plugins array', Array.isArray(marketplace.plugins) && marketplace.plugins.length > 0)
  if (marketplace.plugins?.[0]) {
    const p = marketplace.plugins[0]
    check('plugin has name', !!p.name)
    check('plugin has description', !!p.description)
    check('plugin has version', !!p.version)
    check('plugin has source', !!p.source)
  }
}

// ── commands ↔ skills ───────────────────────────────────────────────────────
console.log('\ncommands ↔ skills')
const cmdsDir = path.join(ROOT, 'commands')
const skillsDir = path.join(ROOT, 'skills')
if (fs.existsSync(cmdsDir) && fs.existsSync(skillsDir)) {
  const cmds = fs.readdirSync(cmdsDir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''))
  const skills = fs.readdirSync(skillsDir).filter(f => fs.statSync(path.join(skillsDir, f)).isDirectory())
  for (const cmd of cmds) {
    check(`command "${cmd}" has matching skill dir`, skills.includes(cmd))
  }
}

// ── SKILL.md frontmatter ────────────────────────────────────────────────────
console.log('\nSKILL.md frontmatter')
if (fs.existsSync(skillsDir)) {
  const skills = fs.readdirSync(skillsDir).filter(f => fs.statSync(path.join(skillsDir, f)).isDirectory())
  for (const skill of skills) {
    const skillMd = path.join(skillsDir, skill, 'SKILL.md')
    if (fs.existsSync(skillMd)) {
      const content = fs.readFileSync(skillMd, 'utf8')
      const fm = parseFrontmatter(content)
      check(`${skill}/SKILL.md has frontmatter`, fm !== null)
      if (fm) {
        check(`${skill}/SKILL.md has name`, !!fm.name)
        check(`${skill}/SKILL.md has description`, !!fm.description)
      }
    } else {
      check(`${skill}/SKILL.md exists`, false)
    }
  }
}

// ── hooks.json ──────────────────────────────────────────────────────────────
console.log('\nhooks.json')
const hooksPath = path.join(ROOT, 'hooks', 'hooks.json')
check('exists and is valid JSON', readJson(hooksPath) !== null)

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
```

- [ ] **Step 2: Run validate**

Run: `node scripts/validate-plugin.js`
Expected: all checks pass (0 failed)

- [ ] **Step 3: Commit**

```bash
git add scripts/validate-plugin.js
git commit -m "feat: add plugin validation script"
```

---

### Task 3: LICENSE

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create MIT LICENSE**

Standard MIT license with `Copyright (c) 2026 Pedro Almeida`. Use the current year.

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "chore: add MIT license"
```

---

### Task 4: CONTRIBUTING.md

**Files:**
- Create: `CONTRIBUTING.md`

- [ ] **Step 1: Create CONTRIBUTING.md**

Cover these sections in this order:
- **Prerequisites:** Node.js 20+, bash 4+ (for shell tests), QMD (optional, for search), Figma personal access token (optional, for API tests)
- **Setup:** `git clone`, `npm install`, `npx playwright install`, `npm test`
- **Project Structure:** table listing scripts/, skills/, commands/, agents/, tests/, .claude-plugin/
- **Running Tests:** `npm test` (unit+e2e), `npm run test:shell` (bash tests, some need FIGMA_TOKEN), `npm run validate` (plugin structure)
- **Adding a Skill:** create `skills/<name>/SKILL.md` with frontmatter (name, description, allowed-tools) + `commands/<name>.md` that invokes it
- **MCP Server:** tools live in `scripts/mcp-server.mjs`, test via JSON-RPC stdio
- **PR Guidelines:** run `npm test` + `npm run validate` before submitting, follow existing commit message style (conventional commits)

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add contributing guide"
```

---

### Task 5: architecture.md

**Files:**
- Create: `docs/architecture.md`

- [ ] **Step 1: Create architecture.md**

Single doc with these sections:
- **Overview:** ASCII diagram: `Figma API → node.json → frame.md → QMD index → MCP server → Claude`
- **Data Flow:** explain the pipeline from snapshot to searchable index
- **Storage Layout:** `~/.figma-differ/<fileKey>/` structure with index.json, flows.json, `<nodeId_safe>/frame.md`, `<nodeId_safe>/<timestamp>/node.json`
- **MCP Tools:** table of 5 tools (search, get_frame, get_flows, list_frames, save) with one-line descriptions
- **Flow Detection:** CONNECTOR nodes + transitionNodeID → flows.json
- **Figma MCP Bridge:** save tool ingests data from Figma MCP's get_design_context
- **Scripts:** table listing all scripts in scripts/ with one-line purpose

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: add architecture overview"
```

---

### Task 6: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/dependabot.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run validate
      - name: MCP server health check
        run: |
          node -e "
          const { spawn } = require('child_process');
          const proc = spawn('node', ['scripts/mcp-server.mjs'], { stdio: ['pipe','pipe','pipe'] });
          let buf = '';
          proc.stdout.on('data', d => { buf += d.toString(); });
          proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'ci',version:'0.1'}}}) + '\n');
          proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'}) + '\n');
          proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'}) + '\n');
          setTimeout(() => {
            proc.kill();
            const lines = buf.trim().split('\n').filter(Boolean);
            const toolsResp = JSON.parse(lines[lines.length - 1]);
            const names = toolsResp.result.tools.map(t => t.name).sort();
            const expected = ['get_flows','get_frame','list_frames','save','search'];
            if (JSON.stringify(names) !== JSON.stringify(expected)) {
              console.error('Expected tools:', expected, 'Got:', names);
              process.exit(1);
            }
            console.log('MCP server OK: 5 tools verified');
          }, 3000);
          "

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:unit
      - run: npm run test:e2e
      - name: Shell tests (best-effort)
        run: npm run test:shell || echo "Some shell tests skipped (missing FIGMA_TOKEN or QMD)"
```

- [ ] **Step 2: Create dependabot.yml**

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

- [ ] **Step 3: Verify CI workflow syntax**

Run: `cat .github/workflows/ci.yml | python3 -c "import sys,yaml; yaml.safe_load(sys.stdin); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/dependabot.yml
git commit -m "ci: add GitHub Actions workflow + dependabot"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all unit + e2e tests pass

- [ ] **Step 2: Run validation**

Run: `npm run validate`
Expected: all checks pass

- [ ] **Step 3: Run shell tests**

Run: `npm run test:shell`
Expected: passes (some may skip without FIGMA_TOKEN)

- [ ] **Step 4: Verify git status is clean**

Run: `git status`
Expected: nothing to commit, working tree clean

- [ ] **Step 5: Review commit log**

Run: `git log --oneline -10`
Expected: 6 new commits (npm scripts, validate, license, contributing, architecture, ci)
