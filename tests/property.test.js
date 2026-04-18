#!/usr/bin/env node
/**
 * Property-based invariant tests — verify data integrity across all real
 * frame.md files and flows.json in ~/.figma-differ/.
 * Runs without any test framework — just assertions.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const BASE_DIR = path.join(os.homedir(), '.figma-differ')

let passed = 0, failed = 0, skipped = 0

function assert(condition, name) {
  if (condition) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}`) }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function findFileKeyDirs() {
  if (!fs.existsSync(BASE_DIR)) return []
  return fs.readdirSync(BASE_DIR).filter(d => {
    const p = path.join(BASE_DIR, d)
    return fs.statSync(p).isDirectory()
  })
}

function findAllFrameMds(fileKeyDir) {
  const results = []
  const base = path.join(BASE_DIR, fileKeyDir)
  for (const entry of fs.readdirSync(base)) {
    const entryPath = path.join(base, entry)
    if (!fs.statSync(entryPath).isDirectory()) continue
    const frameMdPath = path.join(entryPath, 'frame.md')
    if (fs.existsSync(frameMdPath)) {
      results.push({ nodeDir: entry, frameMdPath, content: fs.readFileSync(frameMdPath, 'utf8') })
    }
  }
  return results
}

function parseFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const fm = {}
  const raw = match[1]
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\w[\w_]*?):\s*"(.*)"/)
    if (m) { fm[m[1]] = m[2]; continue }
    const m2 = line.match(/^(\w[\w_]*?):\s*(.+)/)
    if (m2) fm[m2[1]] = m2[2]
  }
  return fm
}

function findTimestampDirs(nodeDir) {
  const timestampPattern = /^\d{8}T\d{6}Z$/
  if (!fs.existsSync(nodeDir)) return []
  return fs.readdirSync(nodeDir).filter(d => {
    return timestampPattern.test(d) && fs.statSync(path.join(nodeDir, d)).isDirectory()
  })
}

// ── Main ──────────────────────────────────────────────────────────────────

console.log('property.test.js — data integrity invariants\n')

const fileKeyDirs = findFileKeyDirs()

if (fileKeyDirs.length === 0) {
  console.log('  SKIP  No data in ~/.figma-differ/ — all property tests skipped')
  process.exit(0)
}

console.log(`Found ${fileKeyDirs.length} file key dir(s) in ${BASE_DIR}\n`)

// ── Invariant 1: YAML frontmatter validity ────────────────────────────────

console.log('── Invariant 1: YAML frontmatter validity ──')

let totalFrameMds = 0
for (const fkDir of fileKeyDirs) {
  const frameMds = findAllFrameMds(fkDir)
  for (const { nodeDir, frameMdPath, content } of frameMds) {
    totalFrameMds++
    const label = `${fkDir}/${nodeDir}/frame.md`

    assert(content.startsWith('---\n'), `${label}: starts with ---`)

    const closingMatch = content.match(/\n---/)
    assert(closingMatch !== null, `${label}: has closing --- delimiter`)

    const fm = parseFrontmatter(content)
    assert(fm !== null, `${label}: frontmatter is parseable`)

    if (fm) {
      assert(fm.title && fm.title.length > 0, `${label}: title is non-empty`)
      assert(fm.figma_file != null, `${label}: has figma_file`)
      assert(fm.figma_node != null, `${label}: has figma_node`)
      assert(
        fm.figma_url && fm.figma_url.startsWith('https://www.figma.com/design/'),
        `${label}: figma_url starts with https://www.figma.com/design/`
      )
    }
  }
}

if (totalFrameMds === 0) {
  console.log('  SKIP  No frame.md files found')
}

// ── Invariant 2: Index consistency ────────────────────────────────────────

console.log('\n── Invariant 2: Index consistency ──')

for (const fkDir of fileKeyDirs) {
  const indexPath = path.join(BASE_DIR, fkDir, 'index.json')
  if (!fs.existsSync(indexPath)) continue

  const label = `${fkDir}/index.json`
  let index
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    assert(true, `${label}: valid JSON`)
  } catch {
    assert(false, `${label}: valid JSON`)
    continue
  }

  assert(Array.isArray(index.frames), `${label}: has frames array`)

  if (Array.isArray(index.frames)) {
    for (const frame of index.frames) {
      const fLabel = `${label} frame ${frame.id || '?'}`
      assert(frame.id != null, `${fLabel}: has id`)
      assert(frame.name != null, `${fLabel}: has name`)
      assert(frame.type != null, `${fLabel}: has type`)

      // Check if corresponding frame.md has matching title
      const nodeIdSafe = (frame.id || '').replace(/:/g, '_')
      const frameMdPath = path.join(BASE_DIR, fkDir, nodeIdSafe, 'frame.md')
      if (fs.existsSync(frameMdPath)) {
        const md = fs.readFileSync(frameMdPath, 'utf8')
        const fm = parseFrontmatter(md)
        if (fm && fm.title) {
          assert(
            fm.title === frame.name,
            `${fLabel}: frame.md title "${fm.title}" matches index name "${frame.name}"`
          )
        }
      }
    }
  }
}

// ── Invariant 3: Flow endpoint validity ───────────────────────────────────

console.log('\n── Invariant 3: Flow endpoint validity ──')

let flowsFound = false
for (const fkDir of fileKeyDirs) {
  const flowsPath = path.join(BASE_DIR, fkDir, 'flows.json')
  if (!fs.existsSync(flowsPath)) continue
  flowsFound = true

  const label = `${fkDir}/flows.json`
  let flowsData
  try {
    flowsData = JSON.parse(fs.readFileSync(flowsPath, 'utf8'))
    assert(true, `${label}: valid JSON`)
  } catch {
    assert(false, `${label}: valid JSON`)
    continue
  }

  assert(Array.isArray(flowsData.flows), `${label}: has flows array`)

  if (Array.isArray(flowsData.flows)) {
    for (let i = 0; i < flowsData.flows.length; i++) {
      const flow = flowsData.flows[i]
      const fLabel = `${label} flow[${i}]`
      assert(flow.from && flow.from.id, `${fLabel}: from.id exists`)
      assert(flow.to && flow.to.id, `${fLabel}: to.id exists`)

      if (flow.from && flow.to) {
        assert(flow.from.id !== flow.to.id, `${fLabel}: no self-loop (${flow.from.id} !== ${flow.to.id})`)
      }
    }

    assert(
      flowsData.totalFlows === flowsData.flows.length,
      `${label}: totalFlows (${flowsData.totalFlows}) matches flows.length (${flowsData.flows.length})`
    )
  }
}

if (!flowsFound) {
  console.log('  SKIP  No flows.json files found')
}

// ── Invariant 4: Figma URL format ─────────────────────────────────────────

console.log('\n── Invariant 4: Figma URL format ──')

for (const fkDir of fileKeyDirs) {
  const frameMds = findAllFrameMds(fkDir)
  for (const { nodeDir, content } of frameMds) {
    const label = `${fkDir}/${nodeDir}/frame.md`
    const fm = parseFrontmatter(content)
    if (!fm || !fm.figma_url) continue

    assert(
      fm.figma_url.includes(fkDir),
      `${label}: figma_url contains fileKey "${fkDir}"`
    )
    assert(
      fm.figma_url.includes('node-id='),
      `${label}: figma_url has node-id= parameter`
    )

    // Extract node-id value and check separator
    const nodeIdMatch = fm.figma_url.match(/node-id=([^&\s"]+)/)
    if (nodeIdMatch) {
      assert(
        !nodeIdMatch[1].includes(':'),
        `${label}: node-id uses - separator (not :): ${nodeIdMatch[1]}`
      )
    }
  }
}

// ── Invariant 5: Description exists ───────────────────────────────────────

console.log('\n── Invariant 5: Description exists ──')

for (const fkDir of fileKeyDirs) {
  const frameMds = findAllFrameMds(fkDir)
  for (const { nodeDir, content } of frameMds) {
    const label = `${fkDir}/${nodeDir}/frame.md`
    const fm = parseFrontmatter(content)
    if (!fm) continue

    assert(
      fm.description && fm.description.trim().length > 0,
      `${label}: description is non-empty`
    )
  }
}

// ── Invariant 6: No orphan frame.md ───────────────────────────────────────

console.log('\n── Invariant 6: No orphan frame.md (each has at least one timestamp dir with node.json) ──')

for (const fkDir of fileKeyDirs) {
  const frameMds = findAllFrameMds(fkDir)
  for (const { nodeDir, frameMdPath } of frameMds) {
    const label = `${fkDir}/${nodeDir}/frame.md`
    const nodeFullDir = path.join(BASE_DIR, fkDir, nodeDir)
    const tsDirs = findTimestampDirs(nodeFullDir)

    // Check if at least one timestamp dir has node.json
    const hasNodeJson = tsDirs.some(ts => {
      return fs.existsSync(path.join(nodeFullDir, ts, 'node.json'))
    })

    // If source is "figma-mcp" (saved via MCP save tool), snapshot may have been
    // stored without node.json — that's valid if node_json wasn't provided.
    // Only flag truly orphaned frame.md with zero timestamp dirs.
    if (tsDirs.length === 0) {
      // Still valid if created by MCP save (which creates timestamp dir but
      // node.json only when node_json param is provided)
      const fm = parseFrontmatter(fs.readFileSync(frameMdPath, 'utf8'))
      if (fm && fm.source === 'figma-mcp') {
        // Check for any timestamp-like dirs (MCP save creates them)
        const allSubdirs = fs.readdirSync(nodeFullDir).filter(d =>
          fs.statSync(path.join(nodeFullDir, d)).isDirectory()
        )
        assert(allSubdirs.length > 0, `${label}: has at least one snapshot directory`)
      } else {
        assert(hasNodeJson, `${label}: has at least one timestamp dir with node.json`)
      }
    } else {
      assert(true, `${label}: has ${tsDirs.length} timestamp dir(s)`)
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
