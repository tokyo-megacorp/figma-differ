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

const [,, fileKey, treePath] = process.argv

if (!fileKey || !treePath) {
  console.error('Usage: extract-flows.js <fileKey> <tree-json-path>')
  process.exit(1)
}

const BASE_DIR = path.join(process.env.HOME, '.figma-differ', fileKey)

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
  function find(node) {
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
    for (const c of node.children || []) find(c)
  }
  find(document)
  return flows
}

function extractPrototypeFlows(document, nodeMap, parentMap) {
  const flows = []
  function find(node, ancestorFrame) {
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
    for (const c of node.children || []) find(c, currentFrame)
  }
  for (const page of document.children || []) {
    find(page, null)
  }
  return flows
}

// ── Deduplicate ─────────────────────────────────────────────────────────────

function dedup(flows) {
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

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const raw = fs.readFileSync(treePath, 'utf8')
  const data = JSON.parse(raw)
  const document = data.document

  const nodeMap = buildNodeMap(document)
  const parentMap = buildParentMap(document)

  const connectorFlows = extractConnectorFlows(document, nodeMap, parentMap)
  const prototypeFlows = extractPrototypeFlows(document, nodeMap, parentMap)
  const allFlows = dedup([...connectorFlows, ...prototypeFlows])
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
