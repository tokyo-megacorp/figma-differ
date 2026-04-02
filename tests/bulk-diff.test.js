#!/usr/bin/env node
/**
 * Tests for bulk-diff.js severity classification and noise filtering.
 * Creates a mock file structure and runs bulk-diff against it.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'bulk-diff.js')
let tmpBase, tmpCurrent, fileKey
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

function makeFrame(id, children) {
  return {
    id, type: 'FRAME', name: 'Frame', visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 },
    children: children || []
  }
}

function makeText(id, text, bbox) {
  return {
    id, type: 'TEXT', name: 'Label', visible: true,
    characters: text,
    absoluteBoundingBox: bbox || { x: 10, y: 10, width: 100, height: 20 }
  }
}

function setup() {
  fileKey = 'test-file-key'
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-test-'))
  tmpCurrent = path.join(tmpBase, 'current')
  fs.mkdirSync(tmpCurrent)

  // Create base dir structure that bulk-diff expects
  const baseDir = path.join(tmpBase, '.figma-differ', fileKey)
  fs.mkdirSync(baseDir, { recursive: true })

  // Override HOME so bulk-diff finds our test data
  process.env._ORIG_HOME = process.env.HOME
  process.env.HOME = tmpBase

  return baseDir
}

function teardown() {
  process.env.HOME = process.env._ORIG_HOME
  fs.rmSync(tmpBase, { recursive: true, force: true })
}

function addFrame(baseDir, frameId, frameName, pageName, baselineNode, currentNode) {
  const safe = frameId.replace(/:/g, '_')

  // Write index entry (we'll rebuild index at the end)
  if (!addFrame._frames) addFrame._frames = []
  addFrame._frames.push({ id: frameId, name: frameName, page: pageName, type: 'FRAME' })

  // Write baseline
  const snapDir = path.join(baseDir, safe, '20260401T000000Z')
  fs.mkdirSync(snapDir, { recursive: true })
  fs.writeFileSync(path.join(snapDir, 'node.json'), JSON.stringify(baselineNode))

  // Write current
  fs.writeFileSync(path.join(tmpCurrent, `${safe}.json`), JSON.stringify(currentNode))
}

function writeIndex(baseDir) {
  fs.writeFileSync(
    path.join(baseDir, 'index.json'),
    JSON.stringify({ frames: addFrame._frames || [] })
  )
}

function runBulkDiff() {
  const stdout = execFileSync('node', [SCRIPT, fileKey, tmpCurrent], {
    encoding: 'utf8',
    env: { ...process.env, HOME: tmpBase }
  })
  return JSON.parse(stdout)
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('bulk-diff.js tests\n')

// Test suite 1: Noise filtering
{
  const baseDir = setup()
  addFrame._frames = []

  // Frame with bbox-only changes (noise)
  const bboxBefore = makeFrame('1:1', [
    makeText('2:1', 'Hello', { x: 10, y: 10, width: 100, height: 20 })
  ])
  const bboxAfter = makeFrame('1:1', [
    makeText('2:1', 'Hello', { x: 12, y: 10, width: 100, height: 20 })
  ])
  addFrame(baseDir, '1:1', 'BboxOnly', 'Page1', bboxBefore, bboxAfter)

  // Frame with real text change
  const textBefore = makeFrame('1:2', [makeText('2:2', 'Sign In')])
  const textAfter = makeFrame('1:2', [makeText('2:2', 'Log In')])
  addFrame(baseDir, '1:2', 'TextChange', 'Page1', textBefore, textAfter)

  // Frame with no changes
  const same = makeFrame('1:3', [makeText('2:3', 'Static')])
  addFrame(baseDir, '1:3', 'Unchanged', 'Page1', same, same)

  writeIndex(baseDir)
  const result = runBulkDiff()

  assert(result.total === 3, 'total frame count = 3')
  assert(result.unchanged === 2, 'unchanged = 2 (identical + bbox-only noise)')
  assert(result.cosmetic === 1, 'cosmetic = 1 (text change)')
  assert(result.structural === 0, 'structural = 0')
  assert(result.top.length === 1, 'top has 1 entry')
  assert(result.top[0].name === 'TextChange', 'top entry is the text change')
  assert(result.errors === 0, 'no errors')

  teardown()
}

// Test suite 2: Structural changes
{
  const baseDir = setup()
  addFrame._frames = []

  // Frame with added node
  const addedBefore = makeFrame('1:1', [makeText('2:1', 'Hello')])
  const addedAfter = makeFrame('1:1', [
    makeText('2:1', 'Hello'),
    { id: '2:2', type: 'RECTANGLE', name: 'New', visible: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 } }
  ])
  addFrame(baseDir, '1:1', 'AddedNode', 'Page1', addedBefore, addedAfter)

  writeIndex(baseDir)
  const result = runBulkDiff()

  assert(result.structural === 1, 'structural = 1 (added node)')
  assert(result.top[0].counts.added === 1, 'added count = 1')

  teardown()
}

// Test suite 3: SECTION type skipped
{
  const baseDir = setup()
  addFrame._frames = [
    { id: '1:1', name: 'Section', page: 'Page1', type: 'SECTION' },
    { id: '1:2', name: 'Frame', page: 'Page1', type: 'FRAME' }
  ]

  const frame = makeFrame('1:2', [makeText('2:1', 'Text')])
  const safe = '1_2'
  const snapDir = path.join(baseDir, safe, '20260401T000000Z')
  fs.mkdirSync(snapDir, { recursive: true })
  fs.writeFileSync(path.join(snapDir, 'node.json'), JSON.stringify(frame))
  fs.writeFileSync(path.join(tmpCurrent, `${safe}.json`), JSON.stringify(frame))

  writeIndex(baseDir)
  const result = runBulkDiff()

  assert(result.unchanged === 1, 'SECTION skipped, only FRAME counted')

  teardown()
}

// Test suite 4: Corrupted baseline tolerance
{
  const baseDir = setup()
  addFrame._frames = []

  const frame = makeFrame('1:1', [makeText('2:1', 'Test')])
  const safe = '1_1'
  addFrame._frames.push({ id: '1:1', name: 'Corrupted', page: 'Page1', type: 'FRAME' })

  const snapDir = path.join(baseDir, safe, '20260401T000000Z')
  fs.mkdirSync(snapDir, { recursive: true })
  // Write corrupted baseline with out='' prefix
  fs.writeFileSync(path.join(snapDir, 'node.json'), "out=''\n" + JSON.stringify(frame))
  fs.writeFileSync(path.join(tmpCurrent, `${safe}.json`), JSON.stringify(frame))

  writeIndex(baseDir)
  const result = runBulkDiff()

  assert(result.errors === 0, 'corrupted baseline parsed without error')
  assert(result.unchanged === 1, 'corrupted baseline compared correctly')

  teardown()
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
