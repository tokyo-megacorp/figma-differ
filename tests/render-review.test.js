#!/usr/bin/env node
/**
 * Tests for render-review.js — error paths (no file dependencies)
 */

const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'render-review.js')
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

console.log('render-review.js tests\n')

// Test 1: No args → usage error, exit 1
try {
  execFileSync('node', [SCRIPT], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  assert(false, 'no args should exit 1')
} catch (e) {
  assert(e.status === 1, 'no args exits with code 1')
  assert(e.stderr.includes('Usage'), 'no args shows usage')
}

// Test 2: Nonexistent filekey → error about missing index
try {
  execFileSync('node', [SCRIPT, 'nonexistent-key-12345'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  assert(false, 'missing index should exit 1')
} catch (e) {
  assert(e.status === 1, 'missing index exits with code 1')
}

// Test 3: --no-images and --no-open flags accepted
// (just verify they don't crash the arg parser before the index check)
try {
  execFileSync('node', [SCRIPT, 'fake-key', '--no-images', '--no-open'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  assert(false, 'should still fail on missing index')
} catch (e) {
  assert(e.status === 1, 'flags accepted, fails on missing index')
}

// Test 4: generated fixture embeds reviewPayload.v1 marker
execFileSync('node', [path.join(__dirname, 'helpers', 'generate-dashboard-fixture.js')], { stdio: 'pipe' })
const html = fs.readFileSync('/tmp/test-review.html', 'utf8')
assert(html.includes('reviewPayload.v1'), 'generated review embeds reviewPayload.v1')
assert(html.includes('"sourceAuthority"'), 'generated review embeds source authority metadata')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
