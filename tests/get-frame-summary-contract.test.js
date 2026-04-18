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
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-summary-'))
  const baseDir = path.join(tmpHome, '.figma-differ', 'TESTKEY')
  fs.mkdirSync(baseDir, { recursive: true })
  fs.writeFileSync(path.join(baseDir, 'index.json'), JSON.stringify({
    fileKey: 'TESTKEY',
    fileName: 'Test File',
    lastIndexed: '20260418T120000Z',
    frames: [{ id: '1:1', name: 'Security Settings', type: 'SECTION', page: 'Settings' }],
  }, null, 2))

  const frameDir = path.join(baseDir, '1_1')
  fs.mkdirSync(frameDir, { recursive: true })
  fs.writeFileSync(path.join(frameDir, 'frame.md'), `---
title: "Security Settings"
description: "security settings; covers: PIN, password, biometrics"
figma_file: "TESTKEY"
figma_node: "1:1"
figma_page: "Settings"
figma_type: "SECTION"
node_count: 12699
---

# Security Settings

> security settings; covers: PIN, password, biometrics

## Components Used
- Avatar
- Button CTA
- Card Row
- Toggle Switch
- Face ID Cell
- Overflow Item

## Text Content
- "PIN"
- "Password"
- "Biometrics"
- "Privacy"
- "Session timeout"
- "Passkeys"

## Hierarchy
- Security Settings
  - PIN
  - Password
  - Biometrics
`)
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
  console.log('get-frame summary contract tests\n')
  setupTestData()
  const client = createMcpClient()
  try {
    await client.initialize()

    const fullRes = await client.callTool('get_frame', { node_id: '1:1' })
    const fullText = resultText(fullRes)
    assert(fullText.includes('## Hierarchy'), 'full mode keeps hierarchy')
    assert(fullText.includes('Overflow Item'), 'full mode keeps sixth component')
    assert(fullText.includes('Passkeys'), 'full mode keeps sixth text item')

    const summaryRes = await client.callTool('get_frame', { node_id: '1:1', summary: true })
    const summaryText = resultText(summaryRes)
    const lines = summaryText.split('\n')
    assert(summaryText.includes('title: "Security Settings"'), 'summary mode keeps frontmatter')
    assert(summaryText.includes('> security settings; covers: PIN, password, biometrics'), 'summary mode keeps description blockquote')
    assert(summaryText.includes('degraded summary'), 'summary mode flags degraded large-node output')
    assert(summaryText.includes('Face ID Cell'), 'summary mode keeps fifth component')
    assert(!summaryText.includes('Overflow Item'), 'summary mode trims components after first five')
    assert(summaryText.includes('"Session timeout"'), 'summary mode keeps fifth text item')
    assert(!summaryText.includes('Passkeys'), 'summary mode trims text after first five')
    assert(!summaryText.includes('## Hierarchy'), 'summary mode omits hierarchy')
    assert(lines.length <= 40, 'summary mode stays compact')
  } catch (error) {
    console.error(error.stack || error.message)
    process.exitCode = 1
  } finally {
    client.close()
    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : (process.exitCode || 0))
  }
})()
