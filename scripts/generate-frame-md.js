#!/usr/bin/env node
/**
 * generate-frame-md.js — generate searchable markdown from Figma node.json snapshots
 *
 * Usage:
 *   node generate-frame-md.js <fileKey> [<nodeId>]
 *
 * Without nodeId: generates frame.md for ALL frames in index.json
 * With nodeId:    generates frame.md for a single frame
 *
 * Output: ~/.figma-differ/<fileKey>/<nodeId_safe>/frame.md
 */

const fs = require('fs')
const path = require('path')

const [,, fileKey, singleNodeId] = process.argv

if (!fileKey) {
  console.error('Usage: generate-frame-md.js <fileKey> [<nodeId>]')
  process.exit(1)
}

const BASE_DIR = path.join(process.env.HOME, '.figma-differ', fileKey)
const INDEX_PATH = path.join(BASE_DIR, 'index.json')

// ── Helpers (reused from structural-diff.js) ────────────────────────────────

function readNodeJson(filePath) {
  let raw = fs.readFileSync(filePath, 'utf8')
  if (!raw || raw.trim().length === 0) return null
  const jsonStart = raw.indexOf('{')
  if (jsonStart > 0) raw = raw.slice(jsonStart)
  const parsed = JSON.parse(raw)
  const nodeId = Object.keys(parsed.nodes || {})[0]
  if (nodeId) return parsed.nodes[nodeId].document
  return parsed.document || parsed
}

function walkNodes(node, acc = []) {
  if (!node || typeof node !== 'object') return acc
  acc.push(node)
  for (const child of node.children || []) walkNodes(child, acc)
  return acc
}

// ── Extraction ──────────────────────────────────────────────────────────────

function extractTexts(nodes) {
  const texts = []
  for (const n of nodes) {
    if (n.type === 'TEXT' && n.characters && n.characters.trim()) {
      texts.push(n.characters.trim())
    }
  }
  // Deduplicate while preserving order
  return [...new Set(texts)]
}

function extractComponents(nodes) {
  const components = new Map()
  for (const n of nodes) {
    if (n.type === 'INSTANCE' && n.name) {
      components.set(n.name, (components.get(n.name) || 0) + 1)
    }
  }
  return components
}

// ── Rich extraction (colors, buttons, inputs, layout patterns) ──────────────

const COLOR_NAMES = [
  [0.00, 0.00, 0.00, 'black'],
  [0.20, 0.20, 0.20, 'dark gray'],
  [0.40, 0.40, 0.40, 'gray'],
  [0.60, 0.60, 0.60, 'gray'],
  [0.75, 0.75, 0.75, 'light gray'],
  [0.90, 0.90, 0.90, 'light gray'],
  [1.00, 1.00, 1.00, 'white'],
  [1.00, 0.00, 0.00, 'red'],
  [0.80, 0.00, 0.00, 'dark red'],
  [0.00, 0.60, 0.00, 'green'],
  [0.00, 0.80, 0.00, 'green'],
  [0.00, 0.00, 1.00, 'blue'],
  [0.20, 0.40, 0.80, 'blue'],
  [1.00, 1.00, 0.00, 'yellow'],
  [1.00, 0.65, 0.00, 'orange'],
  [0.50, 0.00, 0.50, 'purple'],
  [0.60, 0.30, 0.80, 'purple'],
  [0.00, 0.80, 0.80, 'teal'],
  [1.00, 0.40, 0.60, 'pink'],
  [0.60, 0.40, 0.20, 'brown'],
]

function colorName(r, g, b) {
  let best = 'unknown', bestDist = Infinity
  for (const [cr, cg, cb, name] of COLOR_NAMES) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
    if (d < bestDist) { bestDist = d; best = name }
  }
  return best
}

function rgbToHex(r, g, b) {
  const h = v => Math.round(v * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

function extractColors(nodes, rootNode) {
  // Detect dark/light mode from root background
  const bg = rootNode.backgroundColor || (rootNode.fills && rootNode.fills[0] && rootNode.fills[0].color)
  const luminance = bg ? (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) : null
  const mode = luminance !== null ? (luminance < 0.5 ? 'dark' : 'light') : null

  // Collect dominant colors (from visible solid fills, skip white/black/transparent)
  const colorCounts = new Map()
  for (const n of nodes) {
    if (!n.fills) continue
    for (const f of n.fills) {
      if (f.type !== 'SOLID' || f.visible === false || !f.color) continue
      const { r, g, b } = f.color
      if ((f.color.a || 1) < 0.1) continue
      const hex = rgbToHex(r, g, b)
      // Skip pure white/black — too common to be interesting
      if (hex === '#ffffff' || hex === '#000000') continue
      colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1)
    }
  }

  // Top 5 colors by frequency
  const palette = [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hex, count]) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255
      const g = parseInt(hex.slice(3, 5), 16) / 255
      const b = parseInt(hex.slice(5, 7), 16) / 255
      return { hex, name: colorName(r, g, b), count }
    })

  return { mode, palette }
}

function extractButtons(nodes) {
  const buttons = []
  for (const n of nodes) {
    if (n.type !== 'INSTANCE' || !/button/i.test(n.name)) continue
    const textKids = walkNodes(n).filter(c => c.type === 'TEXT' && c.characters && c.characters.trim())
    const label = textKids.map(t => t.characters.trim()).join(' ') || null
    if (label) buttons.push({ name: n.name, label })
  }
  // Deduplicate by label
  const seen = new Set()
  return buttons.filter(b => { if (seen.has(b.label)) return false; seen.add(b.label); return true })
}

function extractFormFields(nodes) {
  const fields = []
  const patterns = /input|field|text.?field|dropdown|select|checkbox|radio|toggle|switch|picker/i
  for (const n of nodes) {
    if (n.type !== 'INSTANCE' || !patterns.test(n.name)) continue
    const textKids = walkNodes(n).filter(c => c.type === 'TEXT' && c.characters && c.characters.trim())
    const label = textKids.map(t => t.characters.trim()).filter(t => t.length < 60)[0] || null
    fields.push({ type: n.name, label })
  }
  const seen = new Set()
  return fields.filter(f => {
    const key = `${f.type}:${f.label}`
    if (seen.has(key)) return false; seen.add(key); return true
  })
}

function extractLayoutPatterns(nodes) {
  const patterns = []
  let hasHScroll = false, hasVScroll = false, hasGrid = false, hasList = false, hasTabs = false

  for (const n of nodes) {
    if (/tab.?bar|tab.?nav|bottom.?nav/i.test(n.name || '')) hasTabs = true
    if (/scroll/i.test(n.name || '') && n.layoutMode === 'HORIZONTAL') hasHScroll = true
    if (/scroll/i.test(n.name || '') && n.layoutMode === 'VERTICAL') hasVScroll = true
    if (/grid/i.test(n.name || '')) hasGrid = true
    if (/list/i.test(n.name || '') && n.type !== 'TEXT') hasList = true
  }

  if (hasTabs) patterns.push('tab navigation')
  if (hasHScroll) patterns.push('horizontal scroll')
  if (hasVScroll) patterns.push('vertical scroll')
  if (hasGrid) patterns.push('grid layout')
  if (hasList) patterns.push('list layout')

  // Detect from root layout
  const root = nodes[0]
  if (root && root.layoutMode === 'VERTICAL') patterns.push('vertical stack')
  if (root && root.layoutMode === 'HORIZONTAL') patterns.push('horizontal stack')

  return [...new Set(patterns)]
}

function synthesizeDescription(frame, colors, buttons, formFields, layoutPatterns, components, texts) {
  const parts = []

  // Screen type from page name or components
  const page = (frame.page || '').toLowerCase()
  if (/auth|login|sign.?in|sign.?up/i.test(page) || /auth|login|sign.?in/i.test(frame.name))
    parts.push('authentication screen')
  else if (/setting|preference|config/i.test(page) || /setting|preference/i.test(frame.name))
    parts.push('settings screen')
  else if (/profile|account/i.test(page) || /profile|account/i.test(frame.name))
    parts.push('profile screen')
  else if (/onboard|welcome|intro/i.test(page))
    parts.push('onboarding screen')
  else
    parts.push('screen')

  // Color mode
  if (colors.mode) parts[0] = `${colors.mode} mode ${parts[0]}`

  // Key interactions
  if (formFields.length > 0) {
    const types = [...new Set(formFields.map(f => f.type.replace(/\s*\(.*/, '').toLowerCase()))]
    parts.push(`with ${types.slice(0, 3).join(', ')} fields`)
  }
  if (buttons.length > 0) {
    const labels = buttons.slice(0, 3).map(b => `"${b.label}"`)
    parts.push(`buttons: ${labels.join(', ')}`)
  }

  // Layout
  if (layoutPatterns.length > 0) {
    parts.push(layoutPatterns.slice(0, 2).join(' + '))
  }

  // Dominant color (if not just grays)
  const interestingColors = (colors.palette || []).filter(c =>
    !['black', 'white', 'gray', 'light gray', 'dark gray'].includes(c.name)
  )
  if (interestingColors.length > 0) {
    parts.push(`${interestingColors[0].name} accent`)
  }

  // Key component hint
  const compNames = [...(components || new Map()).keys()]
  const notable = compNames.filter(n => /keyboard|modal|dialog|toast|alert|tab|nav|card|avatar/i.test(n))
  if (notable.length > 0) {
    parts.push(`features: ${notable.slice(0, 3).join(', ')}`)
  }

  return parts.join('; ')
}

function buildHierarchy(node, maxDepth = 4, depth = 0) {
  if (!node || depth > maxDepth) return []
  const lines = []
  const indent = '  '.repeat(depth)
  let label = node.name || node.type

  if (node.type === 'TEXT' && node.characters) {
    label += ` / "${truncate(node.characters, 50)}"`
  }
  if (node.type === 'INSTANCE') {
    label = `[${label}]`
  }

  lines.push(`${indent}- ${label}`)

  for (const child of node.children || []) {
    lines.push(...buildHierarchy(child, maxDepth, depth + 1))
  }
  return lines
}

function truncate(str, max) {
  if (str.length <= max) return str
  return str.slice(0, max - 1) + '\u2026'
}

// ── Flow data ───────────────────────────────────────────────────────────────

function loadFlows() {
  const flowsPath = path.join(BASE_DIR, 'flows.json')
  if (!fs.existsSync(flowsPath)) return null
  try {
    return JSON.parse(fs.readFileSync(flowsPath, 'utf8'))
  } catch { return null }
}

function getFrameFlows(frameId, flowsData) {
  if (!flowsData || !flowsData.frameFlows) return { incoming: [], outgoing: [] }
  const entry = flowsData.frameFlows[frameId]
  if (!entry) return { incoming: [], outgoing: [] }
  return {
    incoming: (entry.incoming || []).filter(f => f.from.id !== f.to.id),
    outgoing: (entry.outgoing || []).filter(f => f.from.id !== f.to.id),
  }
}

let _flowsCache = undefined
function getCachedFlows() {
  if (_flowsCache === undefined) _flowsCache = loadFlows()
  return _flowsCache
}

// ── Markdown generation ─────────────────────────────────────────────────────

function generateFrameMd(document, frame, index, timestamp) {
  const nodes = walkNodes(document)
  const texts = extractTexts(nodes)
  const components = extractComponents(nodes)
  const hierarchy = buildHierarchy(document, 4)
  const colors = extractColors(nodes, document)
  const buttons = extractButtons(nodes)
  const formFields = extractFormFields(nodes)
  const layoutPatterns = extractLayoutPatterns(nodes)

  let description = synthesizeDescription(frame, colors, buttons, formFields, layoutPatterns, components, texts)

  // Enrich description with flow context
  const frameFlows = getFrameFlows(frame.id, getCachedFlows())
  if (frameFlows.outgoing.length > 0) {
    const targets = [...new Set(frameFlows.outgoing.map(f => f.to.name))].slice(0, 3)
    description += `; leads to: ${targets.join(', ')}`
  }
  if (frameFlows.incoming.length > 0) {
    const sources = [...new Set(frameFlows.incoming.map(f => f.from.name))].slice(0, 3)
    description += `; reached from: ${sources.join(', ')}`
  }

  const nodeId = frame.id
  const nodeIdSafe = nodeId.replace(/:/g, '_')
  const slug = (index.fileName || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  const figmaUrl = `https://www.figma.com/design/${fileKey}/${slug}?node-id=${nodeId.replace(/:/g, '-')}`

  // Check if screenshot exists
  const snapshotDir = path.join(BASE_DIR, nodeIdSafe, timestamp)
  const hasScreenshot = fs.existsSync(path.join(snapshotDir, 'screenshot.png'))

  // YAML frontmatter
  const lines = [
    '---',
    `title: "${escapeFm(frame.name)}"`,
    `description: "${escapeFm(description)}"`,
    `figma_file: "${fileKey}"`,
    `figma_file_name: "${escapeFm(index.fileName || '')}"`,
    `figma_node: "${nodeId}"`,
    `figma_page: "${escapeFm(frame.page || '')}"`,
    `figma_type: "${frame.type}"`,
    `figma_url: "${figmaUrl}"`,
    `node_count: ${nodes.length}`,
    `snapshot_timestamp: "${timestamp}"`,
  ]
  if (colors.mode) lines.push(`color_mode: "${colors.mode}"`)
  if (layoutPatterns.length > 0) lines.push(`layout: "${layoutPatterns.join(', ')}"`)
  if (hasScreenshot) lines.push(`screenshot: "${path.join(snapshotDir, 'screenshot.png')}"`)
  lines.push('---', '')

  lines.push(`# ${frame.name}`)
  lines.push('')
  lines.push(`> ${description}`)
  lines.push('')
  const tags = [frame.page || 'Unknown', frame.type, `${nodes.length} nodes`]
  if (colors.mode) tags.push(`${colors.mode} mode`)
  lines.push(`Page: ${tags.join(' | ')}`)
  lines.push('')

  // Flows section (from flows.json) — reuse frameFlows from above
  if (frameFlows.incoming.length > 0 || frameFlows.outgoing.length > 0) {
    lines.push('## Flows')
    if (frameFlows.incoming.length > 0) {
      lines.push('**Incoming:**')
      const seen = new Set()
      for (const f of frameFlows.incoming) {
        const key = f.from.name
        if (seen.has(key)) continue; seen.add(key)
        const via = f.type === 'prototype' && f.trigger ? ` (via ${f.trigger})` : ''
        lines.push(`- ${f.from.name}${via} → **this screen**`)
      }
    }
    if (frameFlows.outgoing.length > 0) {
      lines.push('**Outgoing:**')
      const seen = new Set()
      for (const f of frameFlows.outgoing) {
        const key = f.to.name
        if (seen.has(key)) continue; seen.add(key)
        const via = f.type === 'prototype' && f.trigger ? ` (via ${f.trigger})` : ''
        lines.push(`- **this screen** → ${f.to.name}${via}`)
      }
    }
    lines.push('')
  }

  // Color palette section
  if (colors.palette.length > 0) {
    lines.push('## Color Palette')
    for (const c of colors.palette) {
      lines.push(`- ${c.hex} (${c.name}, used ${c.count}x)`)
    }
    lines.push('')
  }

  // Buttons section
  if (buttons.length > 0) {
    lines.push('## Buttons')
    for (const b of buttons) {
      lines.push(`- ${b.name}: "${b.label}"`)
    }
    lines.push('')
  }

  // Form fields section
  if (formFields.length > 0) {
    lines.push('## Form Fields')
    for (const f of formFields) {
      lines.push(f.label ? `- ${f.type}: "${f.label}"` : `- ${f.type}`)
    }
    lines.push('')
  }

  // Layout patterns section
  if (layoutPatterns.length > 0) {
    lines.push('## Layout')
    for (const p of layoutPatterns) {
      lines.push(`- ${p}`)
    }
    lines.push('')
  }

  // Components section
  if (components.size > 0) {
    lines.push('## Components Used')
    for (const [name, count] of components) {
      lines.push(count > 1 ? `- ${name} (x${count})` : `- ${name}`)
    }
    lines.push('')
  }

  // Text content section
  if (texts.length > 0) {
    lines.push('## Text Content')
    for (const t of texts.slice(0, 50)) {
      lines.push(`- "${truncate(t, 80)}"`)
    }
    if (texts.length > 50) {
      lines.push(`- _...and ${texts.length - 50} more_`)
    }
    lines.push('')
  }

  // Hierarchy section (capped to avoid huge files)
  if (hierarchy.length > 0) {
    lines.push('## Hierarchy')
    const cap = 80
    lines.push(...hierarchy.slice(0, cap))
    if (hierarchy.length > cap) {
      lines.push(`- _...${hierarchy.length - cap} more nodes_`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function escapeFm(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

// ── Find latest snapshot ────────────────────────────────────────────────────

function findLatestSnapshot(nodeIdSafe) {
  const frameDir = path.join(BASE_DIR, nodeIdSafe)
  if (!fs.existsSync(frameDir)) return null

  const timestamps = fs.readdirSync(frameDir)
    .filter(d => /^\d{8}T\d{6}Z$/.test(d) && fs.statSync(path.join(frameDir, d)).isDirectory())
    .sort()

  for (let i = timestamps.length - 1; i >= 0; i--) {
    const nodeJson = path.join(frameDir, timestamps[i], 'node.json')
    if (fs.existsSync(nodeJson)) {
      return { path: nodeJson, timestamp: timestamps[i] }
    }
  }
  return null
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`ERROR: no index at ${INDEX_PATH}. Run /figma-differ:index first.`)
    process.exit(1)
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'))
  let frames = index.frames || []

  // Filter to single frame if nodeId provided
  if (singleNodeId) {
    frames = frames.filter(f => f.id === singleNodeId)
    if (frames.length === 0) {
      console.error(`ERROR: nodeId "${singleNodeId}" not found in index.`)
      process.exit(1)
    }
  }

  let generated = 0
  let skipped = 0

  for (const frame of frames) {
    const nodeIdSafe = frame.id.replace(/:/g, '_')
    const snapshot = findLatestSnapshot(nodeIdSafe)

    if (!snapshot) {
      skipped++
      continue
    }

    try {
      const document = readNodeJson(snapshot.path)
      if (!document) {
        skipped++
        continue
      }

      const md = generateFrameMd(document, frame, index, snapshot.timestamp)
      const outPath = path.join(BASE_DIR, nodeIdSafe, 'frame.md')
      fs.writeFileSync(outPath, md, 'utf8')
      generated++
    } catch (e) {
      console.error(`WARN: failed to generate frame.md for ${frame.id}: ${e.message}`)
      skipped++
    }
  }

  console.log(`Generated ${generated} frame.md files (${skipped} skipped)`)
}

main()
