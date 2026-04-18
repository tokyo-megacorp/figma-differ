#!/usr/bin/env node
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'mcp-server.mjs')
let tmpHome
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

function setupTestData() {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-flows-'))
  const baseDir = path.join(tmpHome, '.figma-differ', 'FLOWKEY')
  fs.mkdirSync(baseDir, { recursive: true })
  fs.writeFileSync(path.join(baseDir, 'index.json'), JSON.stringify({
    fileKey: 'FLOWKEY',
    fileName: 'Flow File',
    lastIndexed: '20260418T120000Z',
    frames: [
      { id: '1:1', name: 'Profile Tab', type: 'FRAME', page: 'Main' },
      { id: '2:1', name: 'Settings', type: 'FRAME', page: 'Main' },
    ],
  }, null, 2))
  fs.writeFileSync(path.join(baseDir, 'flows.json'), JSON.stringify({
    fileKey: 'FLOWKEY',
    totalFlows: 2,
    connectorFlows: 0,
    prototypeFlows: 2,
    flows: [
      {
        type: 'prototype',
        from: { id: '1:1', name: 'Profile Tab', nodeType: 'FRAME', page: 'Main' },
        to: { id: '1:1', name: 'Profile Tab', nodeType: 'FRAME', page: 'Main' },
        trigger: 'Variant Trigger',
      },
      {
        type: 'prototype',
        from: { id: '1:1', name: 'Profile Tab', nodeType: 'FRAME', page: 'Main' },
        to: { id: '2:1', name: 'Settings', nodeType: 'FRAME', page: 'Main' },
        trigger: 'Settings Entry',
      },
    ],
    frameFlows: {
      '1:1': {
        incoming: [],
        outgoing: [
          { type: 'prototype', from: { id: '1:1', name: 'Profile Tab' }, to: { id: '1:1', name: 'Profile Tab' }, trigger: 'Variant Trigger' },
          { type: 'prototype', from: { id: '1:1', name: 'Profile Tab' }, to: { id: '2:1', name: 'Settings' }, trigger: 'Settings Entry' },
        ],
      },
      '2:1': {
        incoming: [
          { type: 'prototype', from: { id: '1:1', name: 'Profile Tab' }, to: { id: '2:1', name: 'Settings' }, trigger: 'Settings Entry' },
        ],
        outgoing: [],
      },
    },
  }, null, 2))
}

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
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (resolveNext) { resolveNext(msg); resolveNext = null }
        else responses.push(msg)
      } catch {}
    }
  })
  let stderrBuf = ''
  proc.stderr.on('data', chunk => { stderrBuf += chunk.toString() })
  async function send(msg) {
    proc.stdin.write(JSON.stringify(msg) + '\n')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${msg.method || msg.id}: ${stderrBuf}`)), 5000)
      function done(m) { clearTimeout(timer); resolve(m) }
      if (responses.length) done(responses.shift())
      else resolveNext = done
    })
  }
  return {
    async initialize() {
      const res = await send({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.1' } },
      })
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      return res
    },
    async callTool(name, args) {
      return send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args || {} } })
    },
    close() {
      proc.kill('SIGTERM')
      fs.rmSync(tmpHome, { recursive: true, force: true })
    },
  }
}

function resultText(res) {
  return (((res || {}).result || {}).content || []).map(item => item.text || '').join('\n')
}

;(async function main() {
  console.log('mcp get_flows contract tests\n')
  setupTestData()
  const client = createMcpClient()
  try {
    await client.initialize()

    const globalRes = await client.callTool('get_flows', {})
    const globalText = resultText(globalRes)
    assert(globalText.includes('Total flows: 1'), 'global flow view reports filtered total')
    assert(globalText.includes('Profile Tab → (Settings Entry) Settings'), 'global flow view keeps real edge')
    assert(!globalText.includes('Variant Trigger'), 'global flow view hides self-loop trigger')

    const nodeRes = await client.callTool('get_flows', { node_id: '1:1' })
    const nodeText = resultText(nodeRes)
    assert(nodeText.includes('Outgoing'), 'node-scoped flow view keeps outgoing section')
    assert(nodeText.includes('Settings'), 'node-scoped flow view keeps real edge target')
    assert(!nodeText.includes('Profile Tab (prototype)'), 'node-scoped flow view hides resolved self-loop')
  } catch (error) {
    console.error(error.stack || error.message)
    process.exitCode = 1
  } finally {
    client.close()
    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : (process.exitCode || 0))
  }
})()
