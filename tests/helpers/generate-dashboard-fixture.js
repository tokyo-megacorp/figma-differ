#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')

const OUTPUT = '/tmp/test-review.html'
const HOME_DIR = path.join(os.tmpdir(), 'figma-differ-dashboard-home')
const FILE_KEY = 'TEST_KEY'
const BASE = path.join(HOME_DIR, '.figma-differ', FILE_KEY)
const DIFF_RANGE = '20260401T090000Z-vs-20260401T164047Z'
const DIFF_DIR = path.join(BASE, 'diffs', DIFF_RANGE)

fs.rmSync(HOME_DIR, { recursive: true, force: true })
fs.mkdirSync(DIFF_DIR, { recursive: true })
fs.mkdirSync(path.join(BASE, 'comments'), { recursive: true })

const index = {
  fileKey: FILE_KEY,
  fileName: 'Test Design System',
  lastIndexed: '20260401T164047Z',
  frames: [
    { id: '1:1', name: 'Login', type: 'FRAME', page: 'Auth' },
    { id: '1:2', name: 'Signup', type: 'FRAME', page: 'Auth' },
    { id: '2:1', name: 'Dashboard', type: 'FRAME', page: 'Main' },
    { id: '2:2', name: 'Profile', type: 'FRAME', page: 'Main' },
  ],
}
fs.writeFileSync(path.join(BASE, 'index.json'), JSON.stringify(index, null, 2))

const structuralDiffPath = path.join(DIFF_DIR, '1_1-structural.json')
fs.writeFileSync(structuralDiffPath, JSON.stringify({
  summary: '3 nodes changed, 1 added',
  severity: 'high',
  changes: {
    addedNodes: [{ id: '4:1', name: 'Social Login Button', type: 'INSTANCE' }],
    removedNodes: [],
    textChanges: [{ id: '1:3', name: 'Login Form', before: 'Log in', after: 'Continue' }],
    fillChanges: [{ id: '1:5', name: 'Primary Button', added: ['#0055ff'], removed: ['#0044dd'] }],
    bboxChanges: [],
  },
}, null, 2))

const review = {
  fileKey: FILE_KEY,
  diffRange: DIFF_RANGE,
  baseline: '20260401T090000Z',
  current: '20260401T164047Z',
  reviewedAt: '2026-04-01T17:00:00Z',
  summary: { total: 4, structural: 1, cosmetic: 1, unchanged: 2, approved: 0, flagged: 0, pending: 2 },
  byPage: [
    { page: 'Auth', total: 2, structural: 1, cosmetic: 1 },
    { page: 'Main', total: 2, structural: 0, cosmetic: 0 },
  ],
  decisions: [
    {
      nodeId: '1:1', nodeName: 'Login', page: 'Auth', severity: 'structural',
      summary: '+2 nodes, 1 bbox change(s)', nodeCountBefore: 15, nodeCountAfter: 17, nodeCountDelta: 2,
      beforePath: path.join(BASE, '1_1', '20260401T090000Z', 'node.json'),
      afterPath: path.join(BASE, '1_1', '20260401T164047Z', 'node.json'),
      diffPath: structuralDiffPath,
      decision: 'pending', note: '',
    },
    {
      nodeId: '1:2', nodeName: 'Signup', page: 'Auth', severity: 'cosmetic',
      summary: '1 text change(s), 1 fill change(s)', nodeCountBefore: 20, nodeCountAfter: 20, nodeCountDelta: 0,
      beforePath: '', afterPath: '', diffPath: '', decision: 'pending', note: '',
    },
    {
      nodeId: '2:1', nodeName: 'Dashboard', page: 'Main', severity: 'unchanged',
      summary: 'no changes', nodeCountBefore: 50, nodeCountAfter: 50, nodeCountDelta: 0,
      beforePath: '', afterPath: '', diffPath: '', decision: 'pending', note: '',
    },
    {
      nodeId: '2:2', nodeName: 'Profile', page: 'Main', severity: 'unchanged',
      summary: 'no changes', nodeCountBefore: 21, nodeCountAfter: 21, nodeCountDelta: 0,
      beforePath: '', afterPath: '', diffPath: '', decision: 'pending', note: '',
    },
  ],
}
fs.writeFileSync(path.join(DIFF_DIR, 'review.json'), JSON.stringify(review, null, 2))

fs.writeFileSync(path.join(BASE, 'latest-diff-all.json'), JSON.stringify({
  total: 4,
  unchanged: 2,
  top: [{ id: '1:1', name: 'Login', page: 'Auth', severity: 'structural', summary: '+2 nodes, 1 bbox change(s)' }],
  rest: [{ id: '1:2', name: 'Signup', page: 'Auth', severity: 'cosmetic', summary: '1 text change(s), 1 fill change(s)' }],
  comments: { new: [{ id: '1', nodeId: '1:1' }], resolved: [{ id: '8', nodeId: '1:2' }] },
}, null, 2))

fs.writeFileSync(path.join(BASE, 'flows.json'), JSON.stringify({
  fileKey: FILE_KEY,
  totalFlows: 2,
  connectorFlows: 0,
  prototypeFlows: 2,
  flows: [
    { type: 'prototype', from: { id: '1:1', name: 'Login', page: 'Auth' }, to: { id: '2:1', name: 'Dashboard', page: 'Main' }, trigger: 'Primary CTA' },
    { type: 'prototype', from: { id: '1:2', name: 'Signup', page: 'Auth' }, to: { id: '2:2', name: 'Profile', page: 'Main' }, trigger: 'Continue CTA' },
  ],
  frameFlows: {},
}, null, 2))

const frameContexts = {
  '1_1': ['Login', 'authentication screen'],
  '1_2': ['Signup', 'signup flow'],
}
for (const [safeId, [title, description]] of Object.entries(frameContexts)) {
  fs.mkdirSync(path.join(BASE, safeId), { recursive: true })
  fs.writeFileSync(path.join(BASE, safeId, 'frame.md'), `---\ntitle: "${title}"\ndescription: "${description}"\nfigma_node: "${safeId.replace('_', ':')}"\nfigma_page: "Auth"\n---\n\n# ${title}\n\n> ${description}\n`)
}

const comments = {
  comments: [
    { id: '1', message: 'Use primary button', created_at: '2026-04-01T12:00:00Z', resolved_at: null, user: { handle: 'alice', img_url: 'https://example.com/alice.png' }, client_meta: { node_id: '1:1' }, order_id: '1', parent_id: null },
    { id: '2', message: 'Will do', created_at: '2026-04-01T12:15:00Z', resolved_at: null, user: { handle: 'bob', img_url: null }, client_meta: { node_id: '1:1' }, order_id: '2', parent_id: '1' },
    { id: '3', message: 'Spacing looks off', created_at: '2026-04-01T13:00:00Z', resolved_at: null, user: { handle: 'carol', img_url: 'https://example.com/carol.png' }, client_meta: { node_id: '1:2' }, order_id: '3', parent_id: null },
    { id: '4', message: 'Adjusted in latest pass', created_at: '2026-04-01T13:15:00Z', resolved_at: null, user: { handle: 'dave', img_url: 'https://example.com/dave.png' }, client_meta: { node_id: '1:2' }, order_id: '4', parent_id: '3' },
    { id: '5', message: 'Profile should keep avatar', created_at: '2026-04-01T14:00:00Z', resolved_at: null, user: { handle: 'erin', img_url: 'https://example.com/erin.png' }, client_meta: { node_id: '2:2' }, order_id: '5', parent_id: null },
    { id: '6', message: 'Confirmed', created_at: '2026-04-01T14:10:00Z', resolved_at: null, user: { handle: 'frank', img_url: null }, client_meta: { node_id: '2:2' }, order_id: '6', parent_id: '5' },
  ],
}
fs.writeFileSync(path.join(BASE, 'comments', '20260401T170000Z.json'), JSON.stringify(comments, null, 2))

fs.writeFileSync(path.join(BASE, 'file-metadata.json'), JSON.stringify({
  lastModified: '2026-04-01T17:05:00Z',
  thumbnailUrl: 'https://example.com/thumb.png',
  fileName: 'Test Design System',
}, null, 2))

execFileSync('node', [path.join(__dirname, '..', '..', 'scripts', 'render-review.js'), FILE_KEY, '--no-images', '--no-open', '--output', OUTPUT], {
  stdio: 'inherit',
  env: { ...process.env, HOME: HOME_DIR },
})
