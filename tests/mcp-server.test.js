#!/usr/bin/env node
/**
 * End-to-end tests for mcp-server.mjs — spawns the MCP server as a child
 * process and exercises every tool via JSON-RPC over stdio.
 * Runs without any test framework — just assertions.
 */

const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'mcp-server.mjs')
let tmpHome
let passed = 0
let failed = 0

function assert(condition, name) {
  if (condition) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}`) }
}

// ── Test data setup ────────────────────────────────────────────────────────

function setupTestData() {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'))
  const baseDir = path.join(tmpHome, '.figma-differ', 'TESTKEY')

  // index.json
  fs.mkdirSync(baseDir, { recursive: true })
  fs.writeFileSync(path.join(baseDir, 'index.json'), JSON.stringify({
    fileKey: 'TESTKEY',
    fileName: 'Test File',
    lastIndexed: '20260418T120000Z',
    frames: [
      { id: '1:1', name: 'Login Screen', type: 'FRAME', page: 'Auth' },
      { id: '2:1', name: 'Dashboard', type: 'FRAME', page: 'Main' },
      { id: '3:1', name: 'Settings', type: 'FRAME', page: 'Main' },
    ],
  }, null, 2))

  // frame.md for 1:1
  const frameDir = path.join(baseDir, '1_1')
  fs.mkdirSync(frameDir, { recursive: true })
  fs.writeFileSync(path.join(frameDir, 'frame.md'), `---
title: "Login Screen"
description: "light mode authentication screen; with input fields; buttons: \\"Sign In\\""
figma_file: "TESTKEY"
figma_node: "1:1"
figma_page: "Auth"
figma_type: "FRAME"
figma_url: "https://www.figma.com/design/TESTKEY/Test-File?node-id=1-1"
node_count: 42
---

# Login Screen

> light mode authentication screen; with input fields; buttons: "Sign In"

## Text Content
- "Sign In"
- "Email"
- "Password"
`)

  // flows.json
  fs.writeFileSync(path.join(baseDir, 'flows.json'), JSON.stringify({
    fileKey: 'TESTKEY',
    totalFlows: 1,
    connectorFlows: 1,
    prototypeFlows: 0,
    flows: [
      {
        type: 'connector',
        from: { id: '1:1', name: 'Login Screen', nodeType: 'FRAME', page: 'Auth' },
        to: { id: '2:1', name: 'Dashboard', nodeType: 'FRAME', page: 'Main' },
      },
    ],
    frameFlows: {
      '1:1': {
        outgoing: [{ type: 'connector', from: { id: '1:1', name: 'Login Screen' }, to: { id: '2:1', name: 'Dashboard' } }],
        incoming: [],
      },
      '2:1': {
        outgoing: [],
        incoming: [{ type: 'connector', from: { id: '1:1', name: 'Login Screen' }, to: { id: '2:1', name: 'Dashboard' } }],
      },
    },
  }, null, 2))
}

// ── MCP Client helper ──────────────────────────────────────────────────────

function createMcpClient() {
  const proc = spawn('node', [SCRIPT], {
    env: { ...process.env, HOME: tmpHome },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let buffer = ''
  const responses = []
  let resolveNext = null

  proc.stdout.on('data', chunk => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line)
          if (resolveNext) { resolveNext(msg); resolveNext = null }
          else responses.push(msg)
        } catch { /* ignore non-JSON lines */ }
      }
    }
  })

  let stderrBuf = ''
  proc.stderr.on('data', chunk => { stderrBuf += chunk.toString() })

  async function send(msg) {
    proc.stdin.write(JSON.stringify(msg) + '\n')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for response to ${msg.method || msg.id}`)), 5000)
      function tryResolve(m) { clearTimeout(timer); resolve(m) }
      if (responses.length) tryResolve(responses.shift())
      else resolveNext = tryResolve
    })
  }

  async function initialize() {
    const res = await send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.1' },
      },
    })
    // Send initialized notification (no response expected)
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    return res
  }

  let idCounter = 100
  async function callTool(name, args) {
    return send({
      jsonrpc: '2.0', id: idCounter++, method: 'tools/call',
      params: { name, arguments: args || {} },
    })
  }

  async function listTools() {
    return send({ jsonrpc: '2.0', id: idCounter++, method: 'tools/list', params: {} })
  }

  function close() {
    try { proc.stdin.end() } catch {}
    proc.kill()
  }

  return { send, initialize, callTool, listTools, close, proc, getStderr: () => stderrBuf }
}

// ── Helper: extract text from MCP tool result ──────────────────────────────

function resultText(res) {
  if (!res || !res.result) return ''
  const content = res.result.content || []
  return content.map(c => c.text || '').join('\n')
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function runTests() {
  setupTestData()
  const client = createMcpClient()

  try {
    // 1. Server initialization
    console.log('\n── Server initialization ──')
    const initRes = await client.initialize()
    assert(initRes.result != null, 'initialize returns result')
    assert(initRes.result.protocolVersion != null, 'initialize has protocolVersion')
    assert(
      initRes.result.serverInfo && initRes.result.serverInfo.name === 'figma-differ',
      'serverInfo.name = figma-differ'
    )
    assert(
      initRes.result.capabilities && initRes.result.capabilities.tools != null,
      'capabilities.tools present'
    )

    // 2. tools/list
    console.log('\n── tools/list ──')
    const listRes = await client.listTools()
    const tools = (listRes.result && listRes.result.tools) || []
    const toolNames = tools.map(t => t.name).sort()
    assert(toolNames.includes('search'), 'tools/list includes search')
    assert(toolNames.includes('get_frame'), 'tools/list includes get_frame')
    assert(toolNames.includes('get_flows'), 'tools/list includes get_flows')
    assert(toolNames.includes('list_frames'), 'tools/list includes list_frames')
    assert(toolNames.includes('save'), 'tools/list includes save')
    assert(tools.length === 5, `tools/list returns exactly 5 tools (got ${tools.length})`)

    // 3. list_frames (no filter)
    console.log('\n── list_frames (no filter) ──')
    const framesRes = await client.callTool('list_frames', {})
    const framesText = resultText(framesRes)
    assert(framesText.includes('Login Screen'), 'list_frames shows Login Screen')
    assert(framesText.includes('Dashboard'), 'list_frames shows Dashboard')
    assert(framesText.includes('Settings'), 'list_frames shows Settings')
    assert(framesText.includes('Test File'), 'list_frames shows file name')

    // 4. list_frames with page filter
    console.log('\n── list_frames (page=Auth) ──')
    const authRes = await client.callTool('list_frames', { page: 'Auth' })
    const authText = resultText(authRes)
    assert(authText.includes('Login Screen'), 'page=Auth includes Login Screen')
    assert(!authText.includes('Dashboard'), 'page=Auth excludes Dashboard')
    assert(!authText.includes('Settings'), 'page=Auth excludes Settings')

    // 5. get_frame found
    console.log('\n── get_frame (found) ──')
    const frameRes = await client.callTool('get_frame', { node_id: '1:1' })
    const frameText = resultText(frameRes)
    assert(frameText.includes('Login Screen'), 'get_frame returns Login Screen title')
    assert(frameText.includes('Sign In'), 'get_frame returns Sign In text')
    assert(frameText.includes('figma_node: "1:1"'), 'get_frame returns node ID in frontmatter')

    // 6. get_frame not found
    console.log('\n── get_frame (not found) ──')
    const notFoundRes = await client.callTool('get_frame', { node_id: '99:99' })
    const notFoundText = resultText(notFoundRes)
    assert(notFoundText.toLowerCase().includes('not found'), 'get_frame 99:99 says not found')

    // 7. get_flows all
    console.log('\n── get_flows (all) ──')
    const flowsAllRes = await client.callTool('get_flows', {})
    const flowsAllText = resultText(flowsAllRes)
    assert(flowsAllText.includes('Login Screen'), 'get_flows all includes Login Screen')
    assert(flowsAllText.includes('Dashboard'), 'get_flows all includes Dashboard')
    assert(flowsAllText.includes('Total flows: 1'), 'get_flows all shows total flows')

    // 8. get_flows per frame (outgoing)
    console.log('\n── get_flows (node_id=1:1, outgoing) ──')
    const flowsOutRes = await client.callTool('get_flows', { node_id: '1:1' })
    const flowsOutText = resultText(flowsOutRes)
    assert(flowsOutText.includes('Outgoing'), 'flows for 1:1 has Outgoing section')
    assert(flowsOutText.includes('Dashboard'), 'flows for 1:1 outgoing includes Dashboard')

    // 9. get_flows per frame (incoming)
    console.log('\n── get_flows (node_id=2:1, incoming) ──')
    const flowsInRes = await client.callTool('get_flows', { node_id: '2:1' })
    const flowsInText = resultText(flowsInRes)
    assert(flowsInText.includes('Incoming'), 'flows for 2:1 has Incoming section')
    assert(flowsInText.includes('Login Screen'), 'flows for 2:1 incoming includes Login Screen')

    // 10. save tool — creates new frame
    console.log('\n── save (new frame) ──')
    const saveRes = await client.callTool('save', {
      file_key: 'TESTKEY',
      node_id: '4:1',
      name: 'New Screen',
      page: 'Onboarding',
      node_type: 'FRAME',
    })
    const saveText = resultText(saveRes)
    assert(saveText.includes('Saved'), 'save response says Saved')
    assert(saveText.includes('New Screen'), 'save response mentions New Screen')

    // Verify frame.md was created on disk
    const savedFrameMd = path.join(tmpHome, '.figma-differ', 'TESTKEY', '4_1', 'frame.md')
    assert(fs.existsSync(savedFrameMd), 'save creates frame.md on disk')

    // 11. save updates index
    console.log('\n── save updates index ──')
    const updatedIndex = JSON.parse(
      fs.readFileSync(path.join(tmpHome, '.figma-differ', 'TESTKEY', 'index.json'), 'utf8')
    )
    const newFrame = updatedIndex.frames.find(f => f.id === '4:1')
    assert(newFrame != null, 'index.json contains new frame 4:1')
    assert(newFrame && newFrame.name === 'New Screen', 'index.json frame 4:1 has correct name')
    assert(newFrame && newFrame.page === 'Onboarding', 'index.json frame 4:1 has correct page')

    // 12. save with metadata (components + text_content)
    console.log('\n── save with metadata ──')
    const saveMetaRes = await client.callTool('save', {
      file_key: 'TESTKEY',
      node_id: '5:1',
      name: 'Profile Screen',
      page: 'Settings',
      node_type: 'FRAME',
      metadata: {
        description: 'user profile with avatar',
        components: ['Avatar', 'Button', 'TextField'],
        text_content: ['Edit Profile', 'Save Changes', 'Cancel'],
      },
    })
    const saveMetaText = resultText(saveMetaRes)
    assert(saveMetaText.includes('Saved'), 'save with metadata says Saved')

    const metaFrameMd = fs.readFileSync(
      path.join(tmpHome, '.figma-differ', 'TESTKEY', '5_1', 'frame.md'), 'utf8'
    )
    assert(metaFrameMd.includes('Avatar'), 'frame.md contains component Avatar')
    assert(metaFrameMd.includes('Button'), 'frame.md contains component Button')
    assert(metaFrameMd.includes('TextField'), 'frame.md contains component TextField')
    assert(metaFrameMd.includes('Edit Profile'), 'frame.md contains text Edit Profile')
    assert(metaFrameMd.includes('Save Changes'), 'frame.md contains text Save Changes')
    assert(metaFrameMd.includes('user profile with avatar'), 'frame.md contains description')

    // 13. search (skip if qmd not available)
    console.log('\n── search (qmd check) ──')
    let qmdAvailable = false
    try {
      execFileSync('which', ['qmd'], { encoding: 'utf8', stdio: 'pipe' })
      qmdAvailable = true
    } catch { /* qmd not installed */ }

    if (qmdAvailable) {
      const searchRes = await client.callTool('search', { query: 'login' })
      const searchText = resultText(searchRes)
      assert(searchText.length > 0, 'search returns non-empty result')
    } else {
      console.log('  SKIP  search: qmd not installed')
    }

  } finally {
    client.close()
    // Clean up temp dir
    if (tmpHome) {
      try { fs.rmSync(tmpHome, { recursive: true, force: true }) } catch {}
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
  })
  .catch(err => {
    console.error('Test runner error:', err)
    process.exit(1)
  })
