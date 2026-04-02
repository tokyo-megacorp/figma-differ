#!/usr/bin/env node
/**
 * Tests for structural-diff.js severity classification and diff logic.
 * Runs without any test framework — just assertions.
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'structural-diff.js')
let tmpDir
let passed = 0
let failed = 0

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-test-'))
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}

function writeNode(filename, node) {
  const p = path.join(tmpDir, filename)
  fs.writeFileSync(p, JSON.stringify(node, null, 2))
  return p
}

function runDiff(beforeNode, afterNode) {
  const beforePath = writeNode('before.json', beforeNode)
  const afterPath = writeNode('after.json', afterNode)
  const diffPath = path.join(tmpDir, 'diff.json')
  const stdout = execFileSync('node', [SCRIPT, beforePath, afterPath, diffPath], { encoding: 'utf8' })
  const result = JSON.parse(fs.readFileSync(diffPath, 'utf8'))
  return { stdout: stdout.trim(), result }
}

function makeFrame(id, children) {
  return {
    id, type: 'FRAME', name: 'Test Frame', visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 375, height: 812 },
    children: children || []
  }
}

function makeText(id, text, bbox) {
  return {
    id, type: 'TEXT', name: 'Label', visible: true,
    characters: text,
    absoluteBoundingBox: bbox || { x: 10, y: 10, width: 100, height: 20 },
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }]
  }
}

function makeRect(id, fills, bbox) {
  return {
    id, type: 'RECTANGLE', name: 'Rect', visible: true,
    absoluteBoundingBox: bbox || { x: 0, y: 0, width: 50, height: 50 },
    fills: fills || []
  }
}

function assert(condition, name) {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}`)
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('structural-diff.js tests\n')

setup()

// Test 1: Identical frames → unchanged
{
  const frame = makeFrame('0:1', [makeText('1:1', 'Hello')])
  const { result } = runDiff(frame, frame)
  assert(result.severity === 'unchanged', 'identical frames → unchanged')
}

// Test 2: Text change → cosmetic
{
  const before = makeFrame('0:1', [makeText('1:1', 'Sign In')])
  const after = makeFrame('0:1', [makeText('1:1', 'Log In')])
  const { result } = runDiff(before, after)
  assert(result.severity === 'cosmetic', 'text change → cosmetic')
  assert(result.changes.textChanges.length === 1, 'text change counted')
}

// Test 3: Fill change → cosmetic
{
  const fillA = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]
  const fillB = [{ type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 } }]
  const before = makeFrame('0:1', [makeRect('1:1', fillA)])
  const after = makeFrame('0:1', [makeRect('1:1', fillB)])
  const { result } = runDiff(before, after)
  assert(result.severity === 'cosmetic', 'fill change → cosmetic')
  assert(result.changes.fillChanges.length === 1, 'fill change counted')
}

// Test 4: Added node → structural
{
  const before = makeFrame('0:1', [makeText('1:1', 'Hello')])
  const after = makeFrame('0:1', [makeText('1:1', 'Hello'), makeRect('1:2')])
  const { result } = runDiff(before, after)
  assert(result.severity === 'structural', 'added node → structural')
  assert(result.changes.addedNodes.length === 1, 'added node counted')
}

// Test 5: Removed node → structural
{
  const before = makeFrame('0:1', [makeText('1:1', 'Hello'), makeRect('1:2')])
  const after = makeFrame('0:1', [makeText('1:1', 'Hello')])
  const { result } = runDiff(before, after)
  assert(result.severity === 'structural', 'removed node → structural')
  assert(result.changes.removedNodes.length === 1, 'removed node counted')
}

// Test 6: Visibility toggle → structural
{
  const before = makeFrame('0:1', [{ ...makeText('1:1', 'Hi'), visible: true }])
  const after = makeFrame('0:1', [{ ...makeText('1:1', 'Hi'), visible: false }])
  const { result } = runDiff(before, after)
  assert(result.severity === 'structural', 'visibility toggle → structural')
}

// Test 7: bbox-only change → unchanged (noise filter)
{
  const before = makeFrame('0:1', [
    makeText('1:1', 'Hello', { x: 10, y: 10, width: 100, height: 20 })
  ])
  const after = makeFrame('0:1', [
    makeText('1:1', 'Hello', { x: 11, y: 10, width: 100, height: 20 })
  ])
  const { result } = runDiff(before, after)
  assert(result.severity === 'unchanged', 'bbox-only → unchanged (noise)')
}

// Test 8: bbox change WITH text change → cosmetic (not filtered)
{
  const before = makeFrame('0:1', [
    makeText('1:1', 'Hello', { x: 10, y: 10, width: 100, height: 20 })
  ])
  const after = makeFrame('0:1', [
    makeText('1:1', 'World', { x: 11, y: 10, width: 100, height: 20 })
  ])
  const { result } = runDiff(before, after)
  assert(result.severity === 'cosmetic', 'bbox + text change → cosmetic')
}

// Test 9: Component swap → structural
{
  const before = makeFrame('0:1', [
    { ...makeRect('1:1'), componentId: 'comp-a' }
  ])
  const after = makeFrame('0:1', [
    { ...makeRect('1:1'), componentId: 'comp-b' }
  ])
  const { result } = runDiff(before, after)
  assert(result.severity === 'structural', 'component swap → structural')
}

// Test 10: Corrupted JSON with out='' prefix → parseable
{
  const node = makeFrame('0:1', [makeText('1:1', 'Test')])
  const corruptedPath = path.join(tmpDir, 'corrupted.json')
  fs.writeFileSync(corruptedPath, "out=''\n" + JSON.stringify(node))
  const afterPath = writeNode('clean.json', node)
  const diffPath = path.join(tmpDir, 'diff-corrupt.json')
  const stdout = execFileSync('node', [SCRIPT, corruptedPath, afterPath, diffPath], { encoding: 'utf8' })
  const result = JSON.parse(fs.readFileSync(diffPath, 'utf8'))
  assert(result.severity === 'unchanged', 'corrupted baseline parsed correctly')
}

teardown()

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
