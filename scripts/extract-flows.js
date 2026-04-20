#!/usr/bin/env node
/**
 * extract-flows.js — extract screen flow connections from a Figma file tree
 *
 * Reads the full file tree JSON and extracts:
 *   1. CONNECTOR nodes (visual connector lines between frames)
 *   2. transitionNodeID (prototype interactions)
 *
 * Usage:
 *   node extract-flows.js <fileKey> <tree-json-path>
 *
 * Output: ~/.figma-differ/<fileKey>/flows.json
 */

const fs = require('fs')
const path = require('path')

function parseArgs(argv) {
  const rawArgs = argv.slice(2)
  const outputFlagIdx = rawArgs.indexOf('--output')
  const outputPath = outputFlagIdx >= 0 ? rawArgs[outputFlagIdx + 1] : null
  const nodeFlagIdx = rawArgs.indexOf('--node')
  const singleNodeId = nodeFlagIdx >= 0 ? rawArgs[nodeFlagIdx + 1] : null
  const positionalArgs = rawArgs.filter((a, i) => {
    if (a === '--output' || a === '--node') return false
    if (i > 0 && (rawArgs[i-1] === '--output' || rawArgs[i-1] === '--node')) return false
    return true
  })
  const [fileKey, treePath] = positionalArgs
  return { outputPath, singleNodeId, positionalArgs, fileKey, treePath }
}

const { outputPath, singleNodeId, positionalArgs, fileKey, treePath } = parseArgs(process.argv)

// ── Build node ID → info map ────────────────────────────────────────────────

function buildNodeMap(document) {
  const map = {}
  function walk(node, pageName) {
    if (!node) return
    if (node.id) {
      map[node.id] = { name: node.name, type: node.type, page: pageName }
    }
    for (const c of node.children || []) walk(c, pageName || node.name)
  }
  for (const page of document.children || []) {
    walk(page, page.name)
  }
  return map
}

// ── Find ancestor frame for a node ID ───────────────────────────────────────
// Connector endpoints may reference child nodes inside frames.
// Walk up through the tree to find the nearest FRAME/COMPONENT_SET ancestor.

function buildParentMap(document) {
  const parents = {}
  function walk(node, parent) {
    if (!node) return
    if (parent) parents[node.id] = parent.id
    for (const c of node.children || []) walk(c, node)
  }
  walk(document, null)
  return parents
}

// Node types that represent meaningful flow endpoints
const FLOW_NODE_TYPES = new Set([
  'FRAME', 'COMPONENT_SET', 'COMPONENT', 'SHAPE_WITH_TEXT', 'SECTION',
])

function resolveToFrame(nodeId, nodeMap, parentMap) {
  let current = nodeId
  const visited = new Set()
  while (current && !visited.has(current)) {
    visited.add(current)
    const info = nodeMap[current]
    if (!info) return null
    if (FLOW_NODE_TYPES.has(info.type)) {
      return { id: current, ...info }
    }
    current = parentMap[current]
  }
  return nodeMap[nodeId] ? { id: nodeId, ...nodeMap[nodeId] } : null
}

// ── Extract flows ───────────────────────────────────────────────────────────

function extractConnectorFlows(document, nodeMap, parentMap) {
  const flows = []
  function walkConnectors(node) {
    if (!node) return
    if (node.type === 'CONNECTOR') {
      const startId = node.connectorStart?.endpointNodeId
      const endId = node.connectorEnd?.endpointNodeId
      if (startId && endId && startId !== endId) {
        const from = resolveToFrame(startId, nodeMap, parentMap)
        const to = resolveToFrame(endId, nodeMap, parentMap)
        if (from && to && from.id !== to.id) {
          flows.push({
            type: 'connector',
            from: { id: from.id, name: from.name, nodeType: from.type, page: from.page },
            to: { id: to.id, name: to.name, nodeType: to.type, page: to.page },
          })
        }
      }
    }
    for (const c of node.children || []) walkConnectors(c)
  }
  walkConnectors(document)
  return flows
}

function extractPrototypeFlows(document, nodeMap, parentMap) {
  const flows = []
  function walkPrototypes(node, ancestorFrame) {
    if (!node) return
    // Track the nearest frame ancestor as we descend
    const isFrame = FLOW_NODE_TYPES.has(node.type) && node.type !== 'SHAPE_WITH_TEXT'
    const currentFrame = isFrame ? node : ancestorFrame

    if (node.transitionNodeID) {
      // "from" is the frame containing this trigger element
      const fromFrame = currentFrame
      // "to" resolves to the nearest flow endpoint ancestor for the target node
      const toFrame = resolveToFrame(node.transitionNodeID, nodeMap, parentMap)
      if (fromFrame && toFrame && fromFrame.id !== toFrame.id) {
        flows.push({
          type: 'prototype',
          from: { id: fromFrame.id, name: fromFrame.name, nodeType: fromFrame.type, page: fromFrame.page },
          to: { id: toFrame.id, name: toFrame.name, nodeType: toFrame.type, page: toFrame.page },
          trigger: node.name || node.type,
        })
      }
    }
    for (const c of node.children || []) walkPrototypes(c, currentFrame)
  }
  for (const page of document.children || []) {
    walkPrototypes(page, null)
  }
  return flows
}

// ── Deduplicate ─────────────────────────────────────────────────────────────

function deduplicateFlows(flows) {
  const seen = new Set()
  return flows.filter(f => {
    const key = `${f.type}:${f.from.id}→${f.to.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ── Build per-frame flow map ────────────────────────────────────────────────

function buildFrameFlowMap(flows) {
  const map = {} // frameId → { outgoing: [], incoming: [] }
  for (const f of flows) {
    if (!map[f.from.id]) map[f.from.id] = { outgoing: [], incoming: [] }
    if (!map[f.to.id]) map[f.to.id] = { outgoing: [], incoming: [] }
    map[f.from.id].outgoing.push(f)
    map[f.to.id].incoming.push(f)
  }
  return map
}

// ── Collect all nodes recursively (for single-node mode) ────────────────────

function collectAllNodes(node, acc) {
  if (!acc) acc = []
  if (!node || typeof node !== 'object') return acc
  acc.push(node)
  for (const child of node.children || []) collectAllNodes(child, acc)
  return acc
}

// ── Single-node extraction ───────────────────────────────────────────────────

function extractPrototypeInteractions(node) {
  if (!Array.isArray(node.interactions)) return []
  const triggerNode = { id: node.id, name: node.name }
  return node.interactions.flatMap(interaction => {
    const trigger = interaction.trigger?.type || 'UNKNOWN'
    return (interaction.actions || [])
      .filter(a => a.destinationId)
      .map(a => ({ type: 'prototype', trigger, triggerNode, destinationId: a.destinationId }))
  })
}

function extractLegacyTransition(node) {
  if (!node.transitionNodeID) return []
  return [{ type: 'prototype', trigger: 'ON_CLICK', triggerNode: { id: node.id, name: node.name }, destinationId: node.transitionNodeID }]
}

function extractConnectorFlow(node) {
  if (node.type !== 'CONNECTOR') return []
  const from = node.connectorStart?.endpointNodeId
  const to = node.connectorEnd?.endpointNodeId
  if (!from || !to) return []
  return [{ type: 'connector', from, to }]
}

function buildSingleNodeOutput(data, interactions, singleNodeId) {
  return {
    nodeId: singleNodeId || data.id,
    extractedAt: new Date().toISOString(),
    totalInteractions: interactions.length,
    prototypeFlows: interactions.filter(i => i.type === 'prototype').length,
    connectors: interactions.filter(i => i.type === 'connector').length,
    interactions,
  }
}

function writeNodeFlows(output, { outputPath, fileKey }) {
  const dest = outputPath || path.join(process.env.HOME, '.figma-differ', fileKey || 'unknown', 'node-flows.json')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, JSON.stringify(output, null, 2))
  console.log(`Extracted ${output.totalInteractions} interactions from node ${output.nodeId}`)
  console.log(`Saved to: ${dest}`)
}

function extractFlowsFromSingleNode(data, { singleNodeId, outputPath, fileKey }) {
  const allNodes = collectAllNodes(data)
  const nameMap = {}
  for (const n of allNodes) {
    if (n.id) nameMap[n.id] = { name: n.name || n.id, type: n.type || 'UNKNOWN' }
  }
  const interactions = allNodes.flatMap(n => [
    ...extractPrototypeInteractions(n),
    ...extractLegacyTransition(n),
    ...extractConnectorFlow(n),
  ]).map(interaction => {
    if (interaction.type !== 'connector') return interaction
    const fromId = typeof interaction.from === 'string' ? interaction.from : interaction.from?.id
    const toId = typeof interaction.to === 'string' ? interaction.to : interaction.to?.id
    return {
      ...interaction,
      from: fromId ? { id: fromId, ...(nameMap[fromId] || { name: fromId, type: 'UNKNOWN' }) } : interaction.from,
      to: toId ? { id: toId, ...(nameMap[toId] || { name: toId, type: 'UNKNOWN' }) } : interaction.to,
    }
  })
  writeNodeFlows(buildSingleNodeOutput(data, interactions, singleNodeId), { outputPath, fileKey })
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const inputPath = treePath || positionalArgs[0]
  const isSingleNodeRequest = singleNodeId != null || outputPath != null

  if (!inputPath) {
    console.error('Usage: extract-flows.js <fileKey> <tree-json-path>')
    console.error('       extract-flows.js --node <nodeId> --output <path> <simplified.json>')
    process.exit(1)
  }

  const raw = fs.readFileSync(inputPath, 'utf8')
  let data = JSON.parse(raw)

  // Normalize Figma /nodes API response: {nodes: {"id": {document: {...}}}}
  if (data.nodes && data.id == null && !data.document) {
    const firstEntry = Object.values(data.nodes)[0]
    if (firstEntry) data = firstEntry.document || firstEntry
  }

  if (!data.document && data.id != null) {
    extractFlowsFromSingleNode(data, { singleNodeId, outputPath, fileKey })
    return
  }

  const BASE_DIR = path.join(process.env.HOME, '.figma-differ', fileKey)
  const document = data.document

  const nodeMap = buildNodeMap(document)
  const parentMap = buildParentMap(document)

  const connectorFlows = extractConnectorFlows(document, nodeMap, parentMap)
  const prototypeFlows = extractPrototypeFlows(document, nodeMap, parentMap)
  const allFlows = deduplicateFlows([...connectorFlows, ...prototypeFlows])
  const frameFlowMap = buildFrameFlowMap(allFlows)

  const output = {
    fileKey,
    extractedAt: new Date().toISOString(),
    totalFlows: allFlows.length,
    connectorFlows: connectorFlows.length,
    prototypeFlows: prototypeFlows.length,
    flows: allFlows,
    frameFlows: frameFlowMap,
  }

  const outPath = path.join(BASE_DIR, 'flows.json')
  fs.mkdirSync(BASE_DIR, { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8')

  console.log(`Extracted ${allFlows.length} flows (${connectorFlows.length} connectors, ${prototypeFlows.length} prototype)`)
  console.log(`Frames with flows: ${Object.keys(frameFlowMap).length}`)
  console.log(`Saved to: ${outPath}`)
}

main()
