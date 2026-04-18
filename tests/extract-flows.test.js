#!/usr/bin/env node
/**
 * Tests for extract-flows.js — connector and prototype flow extraction.
 * Runs without any test framework — just assertions.
 */

const { execFileSync, execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'extract-flows.js')
let tmpHome
let passed = 0
let failed = 0

function setup() {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-test-'))
}

function teardown() {
  fs.rmSync(tmpHome, { recursive: true, force: true })
}

function writeTree(filename, tree) {
  const p = path.join(tmpHome, filename)
  fs.writeFileSync(p, JSON.stringify(tree, null, 2))
  return p
}

function runExtract(fileKey, treePath, expectFail) {
  const env = { ...process.env, HOME: tmpHome }
  try {
    const stdout = execFileSync('node', [SCRIPT, fileKey, treePath].filter(Boolean), {
      encoding: 'utf8',
      env,
    })
    const flowsPath = path.join(tmpHome, '.figma-differ', fileKey, 'flows.json')
    const result = JSON.parse(fs.readFileSync(flowsPath, 'utf8'))
    return { stdout: stdout.trim(), result, exitCode: 0 }
  } catch (e) {
    if (expectFail) return { exitCode: e.status, stderr: (e.stderr || '').toString() }
    throw e
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

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTree(pages) {
  return {
    document: {
      id: '0:0', type: 'DOCUMENT', name: 'Doc',
      children: pages,
    },
  }
}

function makePage(id, name, children) {
  return { id, type: 'CANVAS', name, children: children || [] }
}

function makeFrame(id, name, children) {
  return { id, type: 'FRAME', name, children: children || [] }
}

function makeConnector(id, startId, endId, opts) {
  return {
    id,
    type: 'CONNECTOR',
    name: opts?.name || 'Connector',
    connectorStart: { endpointNodeId: startId, magnet: 'RIGHT' },
    connectorEnd: { endpointNodeId: endId, magnet: 'LEFT' },
    connectorStartStrokeCap: 'NONE',
    connectorEndStrokeCap: 'LINE_ARROW',
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

console.log('extract-flows.js tests\n')

setup()

// Test 1: Connector flow extraction
{
  const tree = makeTree([
    makePage('0:1', 'Page 1', [
      makeFrame('1:1', 'Login Screen'),
      makeFrame('2:1', 'Dashboard'),
      makeConnector('3:1', '1:1', '2:1'),
    ]),
  ])
  const treePath = writeTree('t1-tree.json', tree)
  const { result } = runExtract('test-file-1', treePath)
  assert(result.totalFlows === 1, 'connector: totalFlows === 1')
  assert(result.connectorFlows === 1, 'connector: connectorFlows === 1')
  const f = result.flows[0]
  assert(f.type === 'connector', 'connector: flow type is connector')
  assert(f.from.id === '1:1' && f.from.name === 'Login Screen', 'connector: from is Login Screen')
  assert(f.to.id === '2:1' && f.to.name === 'Dashboard', 'connector: to is Dashboard')
}

// Test 2: Prototype flow extraction
{
  const tree = makeTree([
    makePage('0:1', 'Page 1', [
      makeFrame('1:1', 'Login Screen', [
        { id: '1:2', type: 'RECTANGLE', name: 'CTA Button', transitionNodeID: '2:1' },
      ]),
      makeFrame('2:1', 'Dashboard'),
    ]),
  ])
  const treePath = writeTree('t2-tree.json', tree)
  const { result } = runExtract('test-file-2', treePath)
  assert(result.prototypeFlows >= 1, 'prototype: at least 1 prototype flow')
  const pf = result.flows.find(f => f.type === 'prototype')
  assert(pf !== undefined, 'prototype: flow with type prototype exists')
  assert(pf.from.id === '1:1' && pf.from.name === 'Login Screen', 'prototype: from is Login Screen')
  assert(pf.to.id === '2:1' && pf.to.name === 'Dashboard', 'prototype: to is Dashboard')
  assert(pf.trigger === 'CTA Button', 'prototype: trigger is CTA Button')
}

// Test 3: Self-loop filtering — prototype where from and to resolve to same frame
{
  const tree = makeTree([
    makePage('0:1', 'Page 1', [
      makeFrame('1:1', 'Login Screen', [
        { id: '1:2', type: 'RECTANGLE', name: 'Self Btn', transitionNodeID: '1:1' },
      ]),
    ]),
  ])
  const treePath = writeTree('t3-tree.json', tree)
  const { result } = runExtract('test-file-3', treePath)
  assert(result.totalFlows === 0, 'self-loop: totalFlows === 0 (self-loop excluded)')
  assert(result.flows.length === 0, 'self-loop: flows array empty')
}

// Test 4: SHAPE_WITH_TEXT connectors (FigJam flow steps)
{
  const tree = makeTree([
    makePage('0:1', 'Page 1', [
      { id: '1:1', type: 'SHAPE_WITH_TEXT', name: 'Step A', children: [] },
      { id: '2:1', type: 'SHAPE_WITH_TEXT', name: 'Step B', children: [] },
      makeConnector('3:1', '1:1', '2:1'),
    ]),
  ])
  const treePath = writeTree('t4-tree.json', tree)
  const { result } = runExtract('test-file-4', treePath)
  assert(result.totalFlows === 1, 'shape_with_text: totalFlows === 1')
  const f = result.flows[0]
  assert(f.from.id === '1:1' && f.from.name === 'Step A', 'shape_with_text: from is Step A')
  assert(f.to.id === '2:1' && f.to.name === 'Step B', 'shape_with_text: to is Step B')
  assert(f.from.nodeType === 'SHAPE_WITH_TEXT', 'shape_with_text: from nodeType correct')
}

// Test 5: Deduplication — two identical connector flows (same from/to)
{
  const tree = makeTree([
    makePage('0:1', 'Page 1', [
      makeFrame('1:1', 'A'),
      makeFrame('2:1', 'B'),
      makeConnector('3:1', '1:1', '2:1'),
      makeConnector('3:2', '1:1', '2:1'),
    ]),
  ])
  const treePath = writeTree('t5-tree.json', tree)
  const { result } = runExtract('test-file-5', treePath)
  assert(result.totalFlows === 1, 'dedup: totalFlows === 1 after dedup')
  assert(result.flows.length === 1, 'dedup: only one flow in array')
}

// Test 6: Frame flow map — verify incoming/outgoing arrays
{
  const tree = makeTree([
    makePage('0:1', 'Page 1', [
      makeFrame('1:1', 'A'),
      makeFrame('2:1', 'B'),
      makeFrame('3:1', 'C'),
      makeConnector('4:1', '1:1', '2:1'),
      makeConnector('4:2', '1:1', '3:1'),
    ]),
  ])
  const treePath = writeTree('t6-tree.json', tree)
  const { result } = runExtract('test-file-6', treePath)
  const fm = result.frameFlows
  assert(fm['1:1'] !== undefined, 'frameFlows: A exists')
  assert(fm['1:1'].outgoing.length === 2, 'frameFlows: A has 2 outgoing')
  assert(fm['1:1'].incoming.length === 0, 'frameFlows: A has 0 incoming')
  assert(fm['2:1'].incoming.length === 1, 'frameFlows: B has 1 incoming')
  assert(fm['2:1'].outgoing.length === 0, 'frameFlows: B has 0 outgoing')
  assert(fm['3:1'].incoming.length === 1, 'frameFlows: C has 1 incoming')
}

// Test 7: Multiple pages — connectors on different pages
{
  const tree = makeTree([
    makePage('0:1', 'Page 1', [
      makeFrame('1:1', 'Screen A'),
      makeFrame('2:1', 'Screen B'),
      makeConnector('3:1', '1:1', '2:1'),
    ]),
    makePage('0:2', 'Page 2', [
      makeFrame('4:1', 'Screen C'),
      makeFrame('5:1', 'Screen D'),
      makeConnector('6:1', '4:1', '5:1'),
    ]),
  ])
  const treePath = writeTree('t7-tree.json', tree)
  const { result } = runExtract('test-file-7', treePath)
  assert(result.totalFlows === 2, 'multi-page: totalFlows === 2')
  const pages = result.flows.map(f => f.from.page)
  assert(pages.includes('Page 1'), 'multi-page: has flow from Page 1')
  assert(pages.includes('Page 2'), 'multi-page: has flow from Page 2')
}

// Test 8: No connectors or prototypes → totalFlows: 0
{
  const tree = makeTree([
    makePage('0:1', 'Page 1', [
      makeFrame('1:1', 'Lonely Frame'),
    ]),
  ])
  const treePath = writeTree('t8-tree.json', tree)
  const { result } = runExtract('test-file-8', treePath)
  assert(result.totalFlows === 0, 'empty: totalFlows === 0')
  assert(result.flows.length === 0, 'empty: flows array empty')
  assert(Object.keys(result.frameFlows).length === 0, 'empty: frameFlows empty')
}

// Test 9: Missing args → exit code 1
{
  const { exitCode } = runExtract(undefined, undefined, true)
  assert(exitCode === 1, 'missing args: exit code 1')
}

// Test 10: Nested endpoint resolution — connector endpoint is a child of a frame
{
  const tree = makeTree([
    makePage('0:1', 'Page 1', [
      makeFrame('1:1', 'Login Screen', [
        { id: '1:2', type: 'RECTANGLE', name: 'Button Inside Login', children: [] },
      ]),
      makeFrame('2:1', 'Dashboard', [
        { id: '2:2', type: 'TEXT', name: 'Label Inside Dashboard', children: [] },
      ]),
      makeConnector('3:1', '1:2', '2:2'),
    ]),
  ])
  const treePath = writeTree('t10-tree.json', tree)
  const { result } = runExtract('test-file-10', treePath)
  assert(result.totalFlows === 1, 'nested: totalFlows === 1')
  const f = result.flows[0]
  assert(f.from.id === '1:1' && f.from.name === 'Login Screen', 'nested: from resolved to parent frame Login Screen')
  assert(f.to.id === '2:1' && f.to.name === 'Dashboard', 'nested: to resolved to parent frame Dashboard')
}

teardown()

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
