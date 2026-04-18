#!/usr/bin/env node
/**
 * Synthetic fixture stress test — generates 200 frame.md files in a temp
 * directory and exercises the MCP server under load.
 * Runs without any test framework — just assertions.
 */

const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'mcp-server.mjs')
const FRAME_COUNT = 200
const FLOW_COUNT = 60
const OVERALL_TIMEOUT = 30000

let passed = 0, failed = 0
let tmpParent = null

function assert(condition, name) {
  if (condition) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}`) }
}

// ── Synthetic data pools ──────────────────────────────────────────────────

const NAME_PREFIXES = [
  'Login', 'Dashboard', 'Settings', 'Profile', 'Onboarding',
  'Home', 'Search', 'Checkout', 'Payment', 'Notifications',
  'Chat', 'Gallery', 'Details', 'Analytics', 'Invite',
  'Error', 'Loading', 'Welcome', 'Tutorial', 'Feedback',
]
const NAME_SUFFIXES = [
  'Screen', 'View', 'Modal', 'Sheet', 'Dialog',
  'Step 1', 'Step 2', 'Step 3', 'Panel', 'Overlay',
]
const PAGES = ['Auth', 'Main', 'Settings', 'Onboarding', 'Profile']
const COMPONENTS = ['Button', 'Input', 'Modal', 'Card', 'Avatar', 'Badge', 'Tab Bar', 'Keyboard']
const TEXT_STRINGS = ['Sign In', 'Email', 'Password', 'Submit', 'Cancel', 'Next', 'Back', 'Save', 'Delete', 'Edit', 'OK', 'Done']
const COLOR_MODES = ['light', 'dark']
const COLOR_HEXES = ['#3366cc', '#ff0000', '#00cc66', '#ffcc00', '#9933ff', '#ff6600', '#333333', '#ffffff']

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, Math.min(n, shuffled.length))
}
function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

// ── Fixture generation ────────────────────────────────────────────────────

function generateFixtures() {
  tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-test-'))
  const tmpHome = path.join(tmpParent, 'home')
  const fileKeyDir = path.join(tmpHome, '.figma-differ', 'STRESS_TEST')
  fs.mkdirSync(fileKeyDir, { recursive: true })

  const frames = []
  const frameIds = []

  for (let i = 0; i < FRAME_COUNT; i++) {
    const nodeId = `${i + 1}:${randomInt(1, 99)}`
    const nodeIdSafe = nodeId.replace(/:/g, '_')
    const name = `${pick(NAME_PREFIXES)} ${pick(NAME_SUFFIXES)} ${i + 1}`
    const pageName = pick(PAGES)
    const colorMode = pick(COLOR_MODES)
    const components = pickN(COMPONENTS, randomInt(1, 5))
    const texts = pickN(TEXT_STRINGS, randomInt(1, 6))
    const colors = pickN(COLOR_HEXES, randomInt(1, 3))

    frames.push({ id: nodeId, name, type: 'FRAME', page: pageName })
    frameIds.push(nodeId)

    // Create frame directory and frame.md
    const frameDir = path.join(fileKeyDir, nodeIdSafe)
    fs.mkdirSync(frameDir, { recursive: true })

    const description = `${colorMode} mode ${pageName.toLowerCase()} screen; with ${components.join(', ')}; buttons: ${texts.map(t => `"${t}"`).join(', ')}`
    const figmaUrl = `https://www.figma.com/design/STRESS_TEST/Stress-File?node-id=${nodeId.replace(/:/g, '-')}`

    const mdContent = [
      '---',
      `title: "${name}"`,
      `description: "${description.replace(/"/g, '\\"')}"`,
      `figma_file: "STRESS_TEST"`,
      `figma_node: "${nodeId}"`,
      `figma_page: "${pageName}"`,
      `figma_type: "FRAME"`,
      `figma_url: "${figmaUrl}"`,
      `color_mode: "${colorMode}"`,
      `node_count: ${randomInt(10, 500)}`,
      `snapshot_timestamp: "20260418T120000Z"`,
      `source: "stress-test"`,
      '---',
      '',
      `# ${name}`,
      '',
      `> ${description}`,
      '',
      `Page: ${pageName} | Type: FRAME`,
      '',
      '## Components Used',
      ...components.map(c => `- ${c}`),
      '',
      '## Text Content',
      ...texts.map(t => `- "${t}"`),
      '',
      '## Color Palette',
      ...colors.map(c => `- ${c}`),
      '',
    ].join('\n')

    fs.writeFileSync(path.join(frameDir, 'frame.md'), mdContent)

    // Create a timestamp subdirectory with node.json
    const tsDir = path.join(frameDir, '20260418T120000Z')
    fs.mkdirSync(tsDir, { recursive: true })
    fs.writeFileSync(path.join(tsDir, 'node.json'), JSON.stringify({
      nodes: { [nodeId]: { document: { id: nodeId, type: 'FRAME', name, children: [] } } }
    }))
  }

  // Write index.json
  fs.writeFileSync(path.join(fileKeyDir, 'index.json'), JSON.stringify({
    fileKey: 'STRESS_TEST',
    fileName: 'Stress Test File',
    lastIndexed: '20260418T120000Z',
    frames,
  }, null, 2))

  // Generate flows (~30% connected to neighbors, up to FLOW_COUNT)
  const flows = []
  for (let i = 0; i < FLOW_COUNT && i < FRAME_COUNT - 1; i++) {
    const fromIdx = randomInt(0, FRAME_COUNT - 2)
    const toIdx = fromIdx + 1 + randomInt(0, Math.min(5, FRAME_COUNT - fromIdx - 2))
    if (fromIdx === toIdx) continue // no self-loops
    flows.push({
      type: 'connector',
      from: { id: frameIds[fromIdx], name: frames[fromIdx].name, nodeType: 'FRAME', page: frames[fromIdx].page },
      to: { id: frameIds[toIdx], name: frames[toIdx].name, nodeType: 'FRAME', page: frames[toIdx].page },
    })
  }

  fs.writeFileSync(path.join(fileKeyDir, 'flows.json'), JSON.stringify({
    fileKey: 'STRESS_TEST',
    totalFlows: flows.length,
    connectorFlows: flows.length,
    prototypeFlows: 0,
    flows,
    frameFlows: {},
  }, null, 2))

  return { tmpHome, frames, frameIds, flows }
}

// ── MCP Client helper ─────────────────────────────────────────────────────

function createMcpClient(env) {
  const proc = spawn('node', [SCRIPT], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let buffer = ''
  const resolvers = []

  proc.stdout.on('data', d => {
    buffer += d.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line)
          if (resolvers.length) resolvers.shift()(msg)
        } catch { /* ignore non-JSON */ }
      }
    }
  })

  let stderrBuf = ''
  proc.stderr.on('data', d => { stderrBuf += d.toString() })

  const send = msg => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${msg.method || msg.id}`)), 10000)
    resolvers.push(m => { clearTimeout(timer); resolve(m) })
    proc.stdin.write(JSON.stringify(msg) + '\n')
  })

  const init = async () => {
    const r = await send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'stress', version: '0.1' },
      },
    })
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    return r
  }

  let nextId = 100
  const callTool = (name, args) => send({
    jsonrpc: '2.0', id: nextId++, method: 'tools/call',
    params: { name, arguments: args || {} },
  })

  return { init, callTool, send, close: () => proc.kill(), proc, getStderr: () => stderrBuf }
}

function resultText(res) {
  if (!res || !res.result) return ''
  const content = res.result.content || []
  return content.map(c => c.text || '').join('\n')
}

// ── Tests ─────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('stress.test.js — synthetic fixture stress tests\n')

  // Set up global timeout
  const timeoutHandle = setTimeout(() => {
    console.error(`\nABORT: Overall timeout of ${OVERALL_TIMEOUT}ms exceeded`)
    process.exit(2)
  }, OVERALL_TIMEOUT)

  const { tmpHome, frames, frameIds, flows } = generateFixtures()
  console.log(`Generated ${FRAME_COUNT} frames, ${flows.length} flows in ${tmpHome}\n`)

  const client = createMcpClient({ HOME: tmpHome })

  try {
    // ── Server init ─────────────────────────────────────────────────────
    console.log('── Server initialization ──')
    const initRes = await client.init()
    assert(initRes.result != null, 'server initializes')

    // ── list_frames: 200 frames ─────────────────────────────────────────
    console.log('\n── list_frames (200 frames) ──')
    const t0 = Date.now()
    const listRes = await client.callTool('list_frames', {})
    const listElapsed = Date.now() - t0
    const listText = resultText(listRes)

    assert(listText.includes('Frames: 200'), `list_frames reports 200 frames`)
    assert(listText.includes('... and 150 more'), 'list_frames truncates at 50 with "more" message')
    assert(listElapsed < 2000, `list_frames completes in <2s (took ${listElapsed}ms)`)

    // ── get_frame: valid ID ─────────────────────────────────────────────
    console.log('\n── get_frame (valid ID) ──')
    const validId = frameIds[0]
    const t1 = Date.now()
    const frameRes = await client.callTool('get_frame', { node_id: validId })
    const frameElapsed = Date.now() - t1
    const frameText = resultText(frameRes)

    assert(frameText.includes(frames[0].name), `get_frame returns correct frame name`)
    assert(frameText.includes('---'), 'get_frame returns frontmatter')
    assert(frameElapsed < 500, `get_frame completes in <500ms (took ${frameElapsed}ms)`)

    // ── get_frame: invalid ID ───────────────────────────────────────────
    console.log('\n── get_frame (invalid ID) ──')
    const notFoundRes = await client.callTool('get_frame', { node_id: '9999:9999' })
    const notFoundText = resultText(notFoundRes)
    assert(notFoundText.toLowerCase().includes('not found'), 'get_frame 9999:9999 says not found')

    // ── get_flows ───────────────────────────────────────────────────────
    console.log('\n── get_flows ──')
    const flowsRes = await client.callTool('get_flows', {})
    const flowsText = resultText(flowsRes)
    assert(flowsText.includes('Total flows:'), 'get_flows returns total flows')
    assert(flowsText.includes('STRESS_TEST'), 'get_flows returns file key')

    // ── save: new frame ─────────────────────────────────────────────────
    console.log('\n── save (single new frame) ──')
    const t2 = Date.now()
    const saveRes = await client.callTool('save', {
      file_key: 'STRESS_TEST',
      node_id: '999:1',
      name: 'Saved Screen',
      page: 'Test',
      node_type: 'FRAME',
      metadata: {
        description: 'stress test saved frame',
        components: ['Button', 'Card'],
        text_content: ['Hello', 'World'],
      },
    })
    const saveElapsed = Date.now() - t2
    const saveText = resultText(saveRes)

    assert(saveText.includes('Saved'), 'save responds with Saved')
    assert(saveText.includes('Saved Screen'), 'save mentions frame name')
    assert(saveElapsed < 1000, `save completes in <1s (took ${saveElapsed}ms)`)

    // Verify disk write
    const savedMd = path.join(tmpHome, '.figma-differ', 'STRESS_TEST', '999_1', 'frame.md')
    assert(fs.existsSync(savedMd), 'save creates frame.md on disk')

    // Verify index update
    const updatedIndex = JSON.parse(
      fs.readFileSync(path.join(tmpHome, '.figma-differ', 'STRESS_TEST', 'index.json'), 'utf8')
    )
    assert(updatedIndex.frames.length === FRAME_COUNT + 1, `index grows to ${FRAME_COUNT + 1} frames after save`)

    // ── save: rapid burst of 10 frames ──────────────────────────────────
    console.log('\n── save (10 frames rapidly) ──')
    const t3 = Date.now()
    const savePromises = []
    for (let i = 0; i < 10; i++) {
      savePromises.push(
        client.callTool('save', {
          file_key: 'STRESS_TEST',
          node_id: `1000:${i + 1}`,
          name: `Rapid Frame ${i + 1}`,
          page: 'Burst',
          node_type: 'FRAME',
        })
      )
    }
    // Execute sequentially (MCP server is single-process stdio)
    const saveResults = []
    for (const p of savePromises) {
      saveResults.push(await p)
    }
    const burstElapsed = Date.now() - t3

    let burstSuccesses = 0
    for (const r of saveResults) {
      if (resultText(r).includes('Saved')) burstSuccesses++
    }
    assert(burstSuccesses === 10, `all 10 rapid saves succeeded (got ${burstSuccesses})`)
    assert(burstElapsed < 10000, `10 rapid saves complete in <10s (took ${burstElapsed}ms)`)

    // Verify all 10 on disk
    let onDiskCount = 0
    for (let i = 0; i < 10; i++) {
      const p = path.join(tmpHome, '.figma-differ', 'STRESS_TEST', `1000_${i + 1}`, 'frame.md')
      if (fs.existsSync(p)) onDiskCount++
    }
    assert(onDiskCount === 10, `all 10 rapid-save frame.md files exist on disk (found ${onDiskCount})`)

    // ── search (QMD, if available) ──────────────────────────────────────
    console.log('\n── search (QMD) ──')
    let qmdAvailable = false
    try {
      execFileSync('which', ['qmd'], { encoding: 'utf8', stdio: 'pipe' })
      qmdAvailable = true
    } catch { /* qmd not installed */ }

    if (qmdAvailable) {
      const searchRes = await client.callTool('search', { query: 'login' })
      const searchText = resultText(searchRes)
      assert(searchText.length > 0, 'search returns non-empty result for "login"')
    } else {
      console.log('  SKIP  search: qmd not installed')
    }

    // ── get_frame: random sampling ──────────────────────────────────────
    console.log('\n── get_frame (random sample of 5) ──')
    for (let i = 0; i < 5; i++) {
      const idx = randomInt(0, FRAME_COUNT - 1)
      const id = frameIds[idx]
      const res = await client.callTool('get_frame', { node_id: id })
      const text = resultText(res)
      assert(text.includes(frames[idx].name), `get_frame random[${i}] (${id}) returns correct name`)
    }

    // ── list_frames: page filter ────────────────────────────────────────
    console.log('\n── list_frames (page filter) ──')
    const authRes = await client.callTool('list_frames', { page: 'Auth' })
    const authText = resultText(authRes)
    assert(authText.includes('Frames:'), 'list_frames with page filter returns frame count')
    // Shouldn't contain all 200 (unless randomly all on Auth)
    assert(!authText.includes('Frames: 0'), 'list_frames page=Auth has some frames')

  } finally {
    clearTimeout(timeoutHandle)
    client.close()
    if (tmpParent) {
      try { fs.rmSync(tmpParent, { recursive: true, force: true }) } catch {}
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
  })
  .catch(err => {
    console.error('Test runner error:', err)
    process.exit(1)
  })
