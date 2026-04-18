#!/usr/bin/env node
/**
 * Tests for generate-frame-md.js — markdown generation from Figma snapshots.
 * Runs without any test framework — just assertions.
 */

const { execFileSync, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'generate-frame-md.js')
let tmpParent, tmpHome, origHome
let passed = 0
let failed = 0

function assert(condition, name) {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}`)
  }
}

// ── Setup / Teardown ───────────────────────────────────────────────────────

function setup() {
  tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'gfm-test-'))
  tmpHome = path.join(tmpParent, 'home')
  fs.mkdirSync(tmpHome, { recursive: true })
  origHome = process.env.HOME
}

function teardown() {
  process.env.HOME = origHome
  fs.rmSync(tmpParent, { recursive: true, force: true })
}

// ── Helpers ────────────────────────────────────────────────────────────────

function makeFileDir(fileKey) {
  const dir = path.join(tmpHome, '.figma-differ', fileKey)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeIndex(fileKey, index) {
  const dir = makeFileDir(fileKey)
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2))
  return dir
}

function writeSnapshot(fileKey, nodeId, timestamp, nodeJson) {
  const nodeIdSafe = nodeId.replace(/:/g, '_')
  const snapshotDir = path.join(tmpHome, '.figma-differ', fileKey, nodeIdSafe, timestamp)
  fs.mkdirSync(snapshotDir, { recursive: true })
  fs.writeFileSync(path.join(snapshotDir, 'node.json'), JSON.stringify(nodeJson, null, 2))
  return snapshotDir
}

function runScript(fileKey, nodeId) {
  const args = ['node', SCRIPT, fileKey]
  if (nodeId) args.push(nodeId)
  const env = { ...process.env, HOME: tmpHome }
  try {
    const stdout = execFileSync(args[0], args.slice(1), { encoding: 'utf8', env })
    return { stdout: stdout.trim(), exitCode: 0 }
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status }
  }
}

function readFrameMd(fileKey, nodeId) {
  const nodeIdSafe = nodeId.replace(/:/g, '_')
  const mdPath = path.join(tmpHome, '.figma-differ', fileKey, nodeIdSafe, 'frame.md')
  if (!fs.existsSync(mdPath)) return null
  return fs.readFileSync(mdPath, 'utf8')
}

function makeIndex(fileKey, frames) {
  return {
    fileKey,
    fileName: 'Test File',
    lastIndexed: '20260418T120000Z',
    frames: frames || []
  }
}

function makeNodeJson(nodeId, document) {
  return {
    nodes: {
      [nodeId]: { document }
    }
  }
}

function makeDocument(nodeId, name, opts = {}) {
  return {
    id: nodeId,
    type: opts.type || 'FRAME',
    name: name,
    backgroundColor: opts.backgroundColor || { r: 1, g: 1, b: 1, a: 1 },
    fills: opts.fills || [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    children: opts.children || [],
    ...(opts.layoutMode ? { layoutMode: opts.layoutMode } : {})
  }
}

function makeTextNode(id, text) {
  return { id, type: 'TEXT', name: 'Label', characters: text }
}

function makeInstanceNode(id, name, children) {
  return { id, type: 'INSTANCE', name, children: children || [] }
}

function parseFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const fm = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/)
    if (m) fm[m[1]] = m[2]
  }
  return fm
}

// ── Tests ──────────────────────────────────────────────────────────────────

console.log('generate-frame-md.js tests\n')

setup()

try {
  // ── Test 1: Basic generation ───────────────────────────────────────────
  {
    const FK = 'BASIC1'
    const nodeId = '1:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Home Screen', type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Home Screen', {
      children: [
        makeTextNode('1:2', 'Hello World'),
        makeInstanceNode('1:3', 'Button Primary')
      ]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))

    const result = runScript(FK)
    assert(result.exitCode === 0, 'basic generation exits 0')

    const md = readFrameMd(FK, nodeId)
    assert(md !== null, 'basic generation creates frame.md')

    const fm = parseFrontmatter(md)
    assert(fm.title === 'Home Screen', 'basic generation: frontmatter title')
    assert(fm.figma_file === FK, 'basic generation: frontmatter figma_file')
    assert(fm.figma_node === nodeId, 'basic generation: frontmatter figma_node')
    assert(fm.figma_page === 'Page 1', 'basic generation: frontmatter figma_page')
    assert(fm.figma_type === 'FRAME', 'basic generation: frontmatter figma_type')
    assert(md.includes('# Home Screen'), 'basic generation: heading present')
  }

  // ── Test 2: Text extraction & deduplication ────────────────────────────
  {
    const FK = 'TEXT2'
    const nodeId = '2:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Text Frame', type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Text Frame', {
      children: [
        makeTextNode('2:2', 'Welcome'),
        makeTextNode('2:3', 'Sign Up'),
        makeTextNode('2:4', 'Welcome'),  // duplicate
        makeTextNode('2:5', 'Already have an account?'),
      ]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))
    runScript(FK)

    const md = readFrameMd(FK, nodeId)
    assert(md.includes('## Text Content'), 'text extraction: section header present')
    assert(md.includes('"Welcome"'), 'text extraction: first text present')
    assert(md.includes('"Sign Up"'), 'text extraction: second text present')
    assert(md.includes('"Already have an account?"'), 'text extraction: third text present')

    // Count occurrences of "Welcome" in Text Content section only (before next ## heading)
    const textSection = (md.split('## Text Content')[1] || '').split(/\n## /)[0]
    const welcomeCount = (textSection.match(/"Welcome"/g) || []).length
    assert(welcomeCount === 1, 'text extraction: deduplication works')
  }

  // ── Test 3: Component extraction ───────────────────────────────────────
  {
    const FK = 'COMP3'
    const nodeId = '3:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Comp Frame', type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Comp Frame', {
      children: [
        makeInstanceNode('3:2', 'Avatar'),
        makeInstanceNode('3:3', 'Avatar'),
        makeInstanceNode('3:4', 'Avatar'),
        makeInstanceNode('3:5', 'Card'),
      ]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))
    runScript(FK)

    const md = readFrameMd(FK, nodeId)
    assert(md.includes('## Components Used'), 'component extraction: section present')
    assert(md.includes('Avatar (x3)'), 'component extraction: Avatar count')
    assert(md.includes('- Card'), 'component extraction: Card listed')
  }

  // ── Test 4: Color extraction ───────────────────────────────────────────
  {
    const FK = 'COLOR4'
    const nodeId = '4:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Color Frame', type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Color Frame', {
      children: [
        {
          id: '4:2', type: 'RECTANGLE', name: 'Blue Box',
          fills: [{ type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.8, a: 1 } }]
        },
        {
          id: '4:3', type: 'RECTANGLE', name: 'Red Box',
          fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]
        },
      ]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))
    runScript(FK)

    const md = readFrameMd(FK, nodeId)
    assert(md.includes('## Color Palette'), 'color extraction: section present')
    // Blue: rgb(0.2, 0.4, 0.8) → #3366cc
    assert(md.includes('#3366cc'), 'color extraction: blue hex present')
    assert(md.includes('blue'), 'color extraction: blue name present')
    // Red: rgb(1, 0, 0) → #ff0000
    assert(md.includes('#ff0000'), 'color extraction: red hex present')
    assert(md.includes('red'), 'color extraction: red name present')
  }

  // ── Test 5: Dark mode detection ────────────────────────────────────────
  {
    const FK = 'DARK5'
    const nodeId = '5:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Dark Frame', type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Dark Frame', {
      backgroundColor: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }],
      children: [makeTextNode('5:2', 'Dark mode text')]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))
    runScript(FK)

    const md = readFrameMd(FK, nodeId)
    assert(md.includes('color_mode: "dark"'), 'dark mode detection: color_mode in frontmatter')
    assert(md.includes('dark mode'), 'dark mode detection: mentioned in description')
  }

  // ── Test 6: Button extraction ──────────────────────────────────────────
  {
    const FK = 'BTN6'
    const nodeId = '6:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Button Frame', type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Button Frame', {
      children: [
        makeInstanceNode('6:2', 'Button Primary', [
          makeTextNode('6:3', 'Submit')
        ]),
        makeInstanceNode('6:4', 'Button Secondary', [
          makeTextNode('6:5', 'Cancel')
        ]),
      ]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))
    runScript(FK)

    const md = readFrameMd(FK, nodeId)
    assert(md.includes('## Buttons'), 'button extraction: section present')
    assert(md.includes('Button Primary: "Submit"'), 'button extraction: Submit button')
    assert(md.includes('Button Secondary: "Cancel"'), 'button extraction: Cancel button')
  }

  // ── Test 7: Form field extraction ──────────────────────────────────────
  {
    const FK = 'FORM7'
    const nodeId = '7:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Form Frame', type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Form Frame', {
      children: [
        makeInstanceNode('7:2', 'Text Input', [
          makeTextNode('7:3', 'Email address')
        ]),
        makeInstanceNode('7:4', 'Dropdown Select', [
          makeTextNode('7:5', 'Country')
        ]),
        makeInstanceNode('7:6', 'Toggle Switch', [
          makeTextNode('7:7', 'Notifications')
        ]),
      ]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))
    runScript(FK)

    const md = readFrameMd(FK, nodeId)
    assert(md.includes('## Form Fields'), 'form field extraction: section present')
    assert(md.includes('Text Input'), 'form field extraction: Text Input listed')
    assert(md.includes('Dropdown Select'), 'form field extraction: Dropdown Select listed')
    assert(md.includes('Toggle Switch'), 'form field extraction: Toggle Switch listed')
    assert(md.includes('"Email address"'), 'form field extraction: Email label')
  }

  // ── Test 8: Layout detection ───────────────────────────────────────────
  {
    const FK = 'LAYOUT8'
    const nodeId = '8:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Layout Frame', type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Layout Frame', {
      layoutMode: 'VERTICAL',
      children: [
        { id: '8:2', type: 'FRAME', name: 'Tab Bar Nav', children: [] },
        { id: '8:3', type: 'FRAME', name: 'Content List', children: [] },
        { id: '8:4', type: 'FRAME', name: 'Scroll Area', layoutMode: 'HORIZONTAL', children: [] },
      ]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))
    runScript(FK)

    const md = readFrameMd(FK, nodeId)
    assert(md.includes('## Layout'), 'layout detection: section present')
    assert(md.includes('tab navigation'), 'layout detection: tab navigation')
    assert(md.includes('list layout'), 'layout detection: list layout')
    assert(md.includes('horizontal scroll'), 'layout detection: horizontal scroll')
    assert(md.includes('vertical stack'), 'layout detection: vertical stack')
  }

  // ── Test 9: Synthesized description ────────────────────────────────────
  {
    const FK = 'DESC9'
    const nodeId = '9:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Login Screen', type: 'FRAME', page: 'Auth' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Login Screen', {
      children: [
        makeTextNode('9:2', 'Welcome back'),
        makeInstanceNode('9:3', 'Button CTA', [
          makeTextNode('9:4', 'Sign In')
        ]),
      ]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))
    runScript(FK)

    const md = readFrameMd(FK, nodeId)
    const fm = parseFrontmatter(md)
    assert(fm.description && fm.description.length > 0, 'synthesized description: frontmatter description non-empty')
    assert(fm.description.includes('authentication'), 'synthesized description: detects auth screen type')
    // blockquote description
    assert(md.includes('> '), 'synthesized description: blockquote present')
  }

  // ── Test 10: Timestamp filtering ───────────────────────────────────────
  {
    const FK = 'TSTAMP10'
    const nodeId = '10:1'
    const nodeIdSafe = '10_1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Timestamp Frame', type: 'FRAME', page: 'Page 1' }])
    const baseDir = writeIndex(FK, index)

    // Create valid timestamp dir with node.json
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId,
      makeDocument(nodeId, 'Timestamp Frame', {
        children: [makeTextNode('10:2', 'Valid snapshot')]
      })
    ))

    // Create invalid dir name — should be ignored
    const notesDir = path.join(baseDir, nodeIdSafe, 'notes')
    fs.mkdirSync(notesDir, { recursive: true })
    fs.writeFileSync(path.join(notesDir, 'node.json'), JSON.stringify({ bad: true }))

    // Create another invalid dir name
    const randomDir = path.join(baseDir, nodeIdSafe, 'backup-old')
    fs.mkdirSync(randomDir, { recursive: true })
    fs.writeFileSync(path.join(randomDir, 'node.json'), JSON.stringify({ bad: true }))

    const result = runScript(FK)
    assert(result.exitCode === 0, 'timestamp filtering: exits 0')

    const md = readFrameMd(FK, nodeId)
    assert(md !== null, 'timestamp filtering: frame.md created')
    assert(md.includes('"Valid snapshot"'), 'timestamp filtering: uses valid snapshot data')
    assert(md.includes('snapshot_timestamp: "20260418T120000Z"'), 'timestamp filtering: correct timestamp in frontmatter')
  }

  // ── Test 11: Single node mode ──────────────────────────────────────────
  {
    const FK = 'SINGLE11'
    const nodeA = '11:1'
    const nodeB = '11:2'
    const index = makeIndex(FK, [
      { id: nodeA, name: 'Frame A', type: 'FRAME', page: 'Page 1' },
      { id: nodeB, name: 'Frame B', type: 'FRAME', page: 'Page 1' },
    ])
    writeIndex(FK, index)

    writeSnapshot(FK, nodeA, '20260418T120000Z', makeNodeJson(nodeA,
      makeDocument(nodeA, 'Frame A', { children: [makeTextNode('11:3', 'A text')] })
    ))
    writeSnapshot(FK, nodeB, '20260418T120000Z', makeNodeJson(nodeB,
      makeDocument(nodeB, 'Frame B', { children: [makeTextNode('11:4', 'B text')] })
    ))

    // Run with specific nodeId — only Frame A should be generated
    const result = runScript(FK, nodeA)
    assert(result.exitCode === 0, 'single node mode: exits 0')
    assert(result.stdout.includes('Generated 1'), 'single node mode: generates exactly 1')

    const mdA = readFrameMd(FK, nodeA)
    assert(mdA !== null, 'single node mode: target frame.md created')
    assert(mdA.includes('Frame A'), 'single node mode: correct frame generated')

    const mdB = readFrameMd(FK, nodeB)
    assert(mdB === null, 'single node mode: other frame NOT generated')
  }

  // ── Test 12: Missing index ─────────────────────────────────────────────
  {
    const FK = 'NOINDEX12'
    // Create directory but NO index.json
    makeFileDir(FK)

    const result = runScript(FK)
    assert(result.exitCode === 1, 'missing index: exits 1')
    assert(result.stderr.includes('ERROR'), 'missing index: error message')
  }

  // ── Test 13: Empty frame ───────────────────────────────────────────────
  {
    const FK = 'EMPTY13'
    const nodeId = '13:1'
    const index = makeIndex(FK, [{ id: nodeId, name: 'Empty Frame', type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, 'Empty Frame', { children: [] })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))

    const result = runScript(FK)
    assert(result.exitCode === 0, 'empty frame: exits 0')

    const md = readFrameMd(FK, nodeId)
    assert(md !== null, 'empty frame: frame.md created')
    assert(md.includes('# Empty Frame'), 'empty frame: heading present')
    assert(!md.includes('## Text Content'), 'empty frame: no text section')
    assert(!md.includes('## Components Used'), 'empty frame: no components section')
    assert(!md.includes('## Buttons'), 'empty frame: no buttons section')
    assert(!md.includes('## Form Fields'), 'empty frame: no form fields section')
  }

  // ── Test 14: YAML escaping ─────────────────────────────────────────────
  {
    const FK = 'ESCAPE14'
    const nodeId = '14:1'
    const frameName = 'Frame "with quotes" and\nnewline'
    const index = makeIndex(FK, [{ id: nodeId, name: frameName, type: 'FRAME', page: 'Page 1' }])
    writeIndex(FK, index)

    const doc = makeDocument(nodeId, frameName, {
      children: [makeTextNode('14:2', 'Some text')]
    })
    writeSnapshot(FK, nodeId, '20260418T120000Z', makeNodeJson(nodeId, doc))

    const result = runScript(FK)
    assert(result.exitCode === 0, 'YAML escaping: exits 0')

    const md = readFrameMd(FK, nodeId)
    assert(md !== null, 'YAML escaping: frame.md created')

    // Verify the frontmatter is parseable — quotes and newlines are escaped
    assert(md.includes('\\"with quotes\\"'), 'YAML escaping: quotes escaped in frontmatter')
    assert(md.includes('\\n'), 'YAML escaping: newline escaped in frontmatter')

    // Verify the --- delimiters are balanced (valid frontmatter)
    const fmMatch = md.match(/^---\n[\s\S]*?\n---/)
    assert(fmMatch !== null, 'YAML escaping: frontmatter block is well-formed')
  }

} finally {
  teardown()
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
