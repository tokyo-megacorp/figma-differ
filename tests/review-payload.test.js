#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const os = require('os')
const { buildReviewPayloadV1 } = require('../scripts/lib/review-payload')

let passed = 0
let failed = 0
let tmpHome

function assert(condition, name) {
  if (condition) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}`)
  }
}

function setupFixtureStore() {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'review-payload-'))
  const base = path.join(tmpHome, '.figma-differ', 'TEST_KEY')
  const diffDir = path.join(base, 'diffs', '20260401T090000Z-vs-20260401T164047Z')
  const commentsDir = path.join(base, 'comments')
  fs.mkdirSync(diffDir, { recursive: true })
  fs.mkdirSync(commentsDir, { recursive: true })

  fs.writeFileSync(path.join(base, 'index.json'), JSON.stringify({
    fileKey: 'TEST_KEY',
    fileName: 'Test Design System',
    lastIndexed: '20260401T164047Z',
    frames: [
      { id: '1:1', name: 'Login', type: 'FRAME', page: 'Auth' },
      { id: '1:2', name: 'Signup', type: 'FRAME', page: 'Auth' },
      { id: '2:1', name: 'Dashboard', type: 'FRAME', page: 'Main' },
      { id: '2:2', name: 'Profile', type: 'FRAME', page: 'Main' },
    ],
  }, null, 2))

  const review = {
    fileKey: 'TEST_KEY',
    diffRange: '20260401T090000Z-vs-20260401T164047Z',
    baseline: '20260401T090000Z',
    current: '20260401T164047Z',
    reviewedAt: '2026-04-01T17:00:00Z',
    summary: { total: 4, structural: 1, cosmetic: 1, unchanged: 2, approved: 0, flagged: 0, pending: 2 },
    byPage: [
      { page: 'Auth', total: 2, structural: 1, cosmetic: 1 },
      { page: 'Main', total: 2, structural: 0, cosmetic: 0 },
    ],
    decisions: [
      { nodeId: '1:1', nodeName: 'Login', page: 'Auth', severity: 'structural', summary: '+2 nodes, 1 bbox change(s)', nodeCountBefore: 15, nodeCountAfter: 17, nodeCountDelta: 2, diffPath: path.join(diffDir, '1_1-structural.json'), decision: 'pending', note: '' },
      { nodeId: '1:2', nodeName: 'Signup', page: 'Auth', severity: 'cosmetic', summary: '1 text change(s), 1 fill change(s)', nodeCountBefore: 20, nodeCountAfter: 20, nodeCountDelta: 0, diffPath: '', decision: 'pending', note: '' },
      { nodeId: '2:1', nodeName: 'Dashboard', page: 'Main', severity: 'unchanged', summary: 'no changes', nodeCountBefore: 50, nodeCountAfter: 50, nodeCountDelta: 0, diffPath: '', decision: 'pending', note: '' },
      { nodeId: '2:2', nodeName: 'Profile', page: 'Main', severity: 'unchanged', summary: 'no changes', nodeCountBefore: 21, nodeCountAfter: 21, nodeCountDelta: 0, diffPath: '', decision: 'pending', note: '' },
    ],
  }
  fs.writeFileSync(path.join(diffDir, 'review.json'), JSON.stringify(review, null, 2))
  fs.writeFileSync(path.join(diffDir, '1_1-structural.json'), JSON.stringify({
    summary: '2 nodes changed', severity: 'high', added: [{ id: '3:1', name: 'Social Login Button', type: 'INSTANCE' }], removed: [], changed: [{ id: '1:3', name: 'Login Form', changes: [{ field: 'characters', before: 'Sign in', after: 'Continue' }] }]
  }, null, 2))

  fs.writeFileSync(path.join(base, 'latest-diff-all.json'), JSON.stringify({
    total: 4,
    unchanged: 2,
    top: [{ id: '1:1', name: 'Login', page: 'Auth', severity: 'structural', summary: 'top issue' }],
    rest: [{ id: '1:2', name: 'Signup', page: 'Auth', severity: 'cosmetic', summary: 'rest issue' }],
    comments: { new: [{ id: 'n1', nodeId: '1:1' }], resolved: [] },
  }, null, 2))

  fs.writeFileSync(path.join(base, 'flows.json'), JSON.stringify({
    fileKey: 'TEST_KEY',
    totalFlows: 1,
    connectorFlows: 0,
    prototypeFlows: 1,
    flows: [{ type: 'prototype', from: { id: '1:1', name: 'Login' }, to: { id: '2:1', name: 'Dashboard' }, trigger: 'Primary CTA' }],
    frameFlows: { '1:1': { outgoing: [{ type: 'prototype', from: { id: '1:1', name: 'Login' }, to: { id: '2:1', name: 'Dashboard' }, trigger: 'Primary CTA' }], incoming: [] } }
  }, null, 2))

  fs.mkdirSync(path.join(base, '1_1'), { recursive: true })
  fs.writeFileSync(path.join(base, '1_1', 'frame.md'), `---\ntitle: "Login"\ndescription: "authentication screen"\nfigma_node: "1:1"\nfigma_page: "Auth"\n---\n\n# Login\n\n> authentication screen\n\n## Text Content\n- "Welcome back"\n- "Sign in"\n`)

  fs.writeFileSync(path.join(commentsDir, '20260401T170000Z.json'), JSON.stringify({
    comments: [
      { id: '1', message: 'Use primary button', created_at: '2026-04-01T12:00:00Z', resolved_at: null, user: { handle: 'alice', img_url: 'https://example.com/alice.png' }, client_meta: { node_id: '1:1' }, order_id: '1', parent_id: null },
      { id: '2', message: 'done', created_at: '2026-04-01T13:00:00Z', resolved_at: '2026-04-01T14:00:00Z', user: { handle: 'bob', img_url: null }, client_meta: { node_id: '1:1' }, order_id: '2', parent_id: '1' }
    ]
  }, null, 2))

  fs.writeFileSync(path.join(base, 'file-metadata.json'), JSON.stringify({
    lastModified: '2026-04-01T17:05:00Z',
    thumbnailUrl: 'https://example.com/thumb.png',
    fileName: 'Test Design System'
  }, null, 2))

  return base
}

console.log('review-payload.js tests\n')
const store = setupFixtureStore()
const payload = buildReviewPayloadV1({ fileKey: 'TEST_KEY', storePath: store, noImages: true, allowFetch: false })
assert(payload.version === 'reviewPayload.v1', 'payload has version marker')
assert(payload.index.fileName === 'Test Design System', 'payload keeps index data')
assert(payload.latestTriage && payload.latestTriage.top.length === 1, 'payload includes latest triage')
assert(payload.flows && payload.flows.totalFlows === 1, 'payload includes flows enrichment')
assert(payload.frameContexts['1:1'].description === 'authentication screen', 'payload includes frame context enrichment')
assert(payload.comments.length === 2, 'payload includes comments from local cache')
assert(payload.metadata.fileName === 'Test Design System', 'payload prefers local metadata')
assert(payload.sourceAuthority.review === 'review.json', 'payload exposes source authority')
assert(payload.imageUrls && Object.keys(payload.imageUrls).length === 0, 'payload can skip image fetching')
assert(payload.optionalEnrichmentsFailSoft === true, 'payload marks optional enrichments as fail-soft')

const missingStore = fs.mkdtempSync(path.join(os.tmpdir(), 'review-payload-missing-'))
fs.mkdirSync(path.join(missingStore, '.figma-differ', 'EMPTY', 'diffs', 'range'), { recursive: true })
fs.writeFileSync(path.join(missingStore, '.figma-differ', 'EMPTY', 'index.json'), JSON.stringify({ fileKey: 'EMPTY', fileName: 'Empty', frames: [] }, null, 2))
fs.writeFileSync(path.join(missingStore, '.figma-differ', 'EMPTY', 'diffs', 'range', 'review.json'), JSON.stringify({ fileKey: 'EMPTY', diffRange: 'range', decisions: [], summary: { total: 0, structural: 0, cosmetic: 0, unchanged: 0 }, byPage: [] }, null, 2))
const emptyPayload = buildReviewPayloadV1({ fileKey: 'EMPTY', storePath: path.join(missingStore, '.figma-differ', 'EMPTY'), noImages: true, allowFetch: false })
assert(emptyPayload.comments.length === 0, 'missing comments fail soft')
assert(emptyPayload.latestTriage === null, 'missing latest diff fails soft')
assert(Object.keys(emptyPayload.frameContexts).length === 0, 'missing frame context fails soft')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
