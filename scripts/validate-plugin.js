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

/**
 * Parse YAML frontmatter between --- delimiters.
 *
 * LIMITATIONS (by design — no YAML library dependency):
 * - Only handles simple "key: value" pairs on a single line
 * - YAML block scalars (description: >) capture ">" not the multiline text
 *   This is acceptable: we only check field existence (truthiness), not content
 * - YAML list values (allowed-tools:) are skipped (no value on the key line)
 * - Use this ONLY for existence checks, not content validation
 */
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
  // NOTE: only ${CLAUDE_PLUGIN_ROOT} is resolved; other variables would need adding here
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

// ── commands ↔ skills (bidirectional) ───────────────────────────────────────
// CONVENTION: command file "X.md" must have a corresponding "skills/X/" directory
// and vice versa. This naming convention is enforced here.
console.log('\ncommands ↔ skills')
const cmdsDir = path.join(ROOT, 'commands')
const skillsDir = path.join(ROOT, 'skills')
if (fs.existsSync(cmdsDir) && fs.existsSync(skillsDir)) {
  const cmds = fs.readdirSync(cmdsDir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''))
  const skills = fs.readdirSync(skillsDir).filter(f => fs.statSync(path.join(skillsDir, f)).isDirectory())

  // Forward: every command has a matching skill
  for (const cmd of cmds) {
    check(`command "${cmd}" has matching skill dir`, skills.includes(cmd))
  }
  // Reverse: every skill has a matching command (F9 fix)
  for (const skill of skills) {
    check(`skill "${skill}" has matching command`, cmds.includes(skill))
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
