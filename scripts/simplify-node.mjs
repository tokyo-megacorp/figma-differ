#!/usr/bin/env node
/**
 * simplify-node.mjs — Strip noisy Figma API node JSON to lean semantic essentials.
 *
 * Usage:
 *   # From stdin:
 *   bash scripts/figma-api.sh fetch_node_json <file_key> <node_id> | node scripts/simplify-node.mjs
 *
 *   # From file:
 *   node scripts/simplify-node.mjs path/to/node.json
 *
 *   # With explicit node_id to extract from multi-node response:
 *   node scripts/simplify-node.mjs --node-id 1431:33250 path/to/response.json
 *
 *   # Extract subtree rooted at a specific node:
 *   node scripts/simplify-node.mjs --subtree 43810:194637 path/to/full.json
 */

import { readFileSync } from 'fs'

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
let nodeId = null
let subtreeId = null
let filePath = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--node-id' && args[i + 1]) {
    nodeId = args[i + 1]
    i++
  } else if (args[i] === '--subtree' && args[i + 1]) {
    subtreeId = args[i + 1].replace(/[_-]/g, ':')
    i++
  } else {
    filePath = args[i]
  }
}

// ---------------------------------------------------------------------------
// Read input
// ---------------------------------------------------------------------------

let raw
if (filePath) {
  raw = readFileSync(filePath, 'utf8')
} else {
  // Read from stdin
  raw = readFileSync('/dev/stdin', 'utf8')
}

const response = JSON.parse(raw)

// ---------------------------------------------------------------------------
// Extract root document node
// ---------------------------------------------------------------------------

let document
if (response.nodes) {
  // Standard Figma /files/{key}/nodes?ids={id} response
  const nodeMap = response.nodes
  const keys = Object.keys(nodeMap)
  if (keys.length === 0) {
    process.stderr.write('No nodes found in response\n')
    process.exit(1)
  }

  const targetKey = nodeId
    ? (nodeId.replace(/_/g, ':'))  // normalize underscore form
    : keys[0]

  const entry = nodeMap[targetKey]
  if (!entry) {
    process.stderr.write(`Node ${targetKey} not found. Available: ${keys.join(', ')}\n`)
    process.exit(1)
  }
  document = entry.document
} else if (response.document) {
  // Already a node document
  document = response.document
} else {
  // Assume the response IS the node
  document = response
}

// ---------------------------------------------------------------------------
// Subtree extraction
// ---------------------------------------------------------------------------

if (subtreeId) {
  const found = findById(document, subtreeId)
  if (!found) {
    process.stderr.write(`Subtree node ${subtreeId} not found in document\n`)
    process.exit(1)
  }
  document = found
}

// ---------------------------------------------------------------------------
// Simplify — strip noise, keep layout/semantic essentials
// ---------------------------------------------------------------------------

const STRIP_BLEND = new Set(['PASS_THROUGH', 'NORMAL'])

function findById(node, id) {
  if (!node || typeof node !== 'object') return null
  if (node.id === id) return node
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findById(child, id)
      if (found) return found
    }
  }
  return null
}

/**
 * Simplify a single Figma node (and its children recursively).
 */
function simplify(node) {
  if (!node || typeof node !== 'object') return null

  const out = {}

  // Always keep identity fields
  if (node.id != null)   out.id = node.id
  if (node.name != null) out.name = node.name
  if (node.type != null) out.type = node.type

  // Visibility — only include when false (saves space; true is the default)
  if (node.visible === false) out.visible = false

  // Text content — TEXT nodes only
  if (node.type === 'TEXT' && node.characters != null) {
    out.characters = node.characters
  }

  // Component reference — INSTANCE nodes only
  if (node.type === 'INSTANCE' && node.componentId != null) {
    out.componentId = node.componentId
  }

  // Fills — only SOLID fills, non-empty
  if (Array.isArray(node.fills) && node.fills.length > 0) {
    const solidFills = node.fills
      .filter(f => f.type === 'SOLID' && f.color)
      .map(f => ({
        type: 'SOLID',
        color: {
          r: round(f.color.r),
          g: round(f.color.g),
          b: round(f.color.b),
          a: f.color.a != null ? round(f.color.a) : 1,
        },
        ...(f.opacity != null && f.opacity !== 1 ? { opacity: round(f.opacity) } : {}),
      }))
    if (solidFills.length > 0) out.fills = solidFills
  }

  // Non-default blend mode (kept if meaningful)
  if (node.blendMode && !STRIP_BLEND.has(node.blendMode)) {
    out.blendMode = node.blendMode
  }

  // Prototype interactions (modern format)
  if (Array.isArray(node.interactions) && node.interactions.length > 0) {
    const compacted = node.interactions
      .map(i => ({
        trigger: i.trigger ? { type: i.trigger.type } : undefined,
        actions: (i.actions || [])
          .filter(a => a.destinationId)
          .map(a => ({ type: a.type, destinationId: a.destinationId, navigation: a.navigation })),
      }))
      .filter(i => i.actions && i.actions.length > 0)
    if (compacted.length > 0) out.interactions = compacted
  }

  // Legacy prototype transition
  if (node.transitionNodeID != null) out.transitionNodeID = node.transitionNodeID

  // CONNECTOR node fields
  if (node.type === 'CONNECTOR') {
    if (node.connectorStart?.endpointNodeId) out.connectorStart = { endpointNodeId: node.connectorStart.endpointNodeId }
    if (node.connectorEnd?.endpointNodeId) out.connectorEnd = { endpointNodeId: node.connectorEnd.endpointNodeId }
    if (node.connectorLineType) out.connectorLineType = node.connectorLineType
  }

  // Component variant definitions (on COMPONENT_SET nodes)
  if (node.componentPropertyDefinitions) {
    const variantDefs = {}
    for (const [key, def] of Object.entries(node.componentPropertyDefinitions)) {
      if (def.type === 'VARIANT') {
        variantDefs[key] = { type: 'VARIANT', variantOptions: def.variantOptions || [] }
      }
    }
    if (Object.keys(variantDefs).length > 0) out.componentPropertyDefinitions = variantDefs
  }

  // Component current state (on INSTANCE nodes)
  if (node.componentProperties) {
    const variantProps = {}
    for (const [key, prop] of Object.entries(node.componentProperties)) {
      if (prop.type === 'VARIANT') variantProps[key] = { type: 'VARIANT', value: prop.value }
    }
    if (Object.keys(variantProps).length > 0) out.componentProperties = variantProps
  }

  // Recurse into children
  if (Array.isArray(node.children) && node.children.length > 0) {
    const simplifiedChildren = node.children
      .map(child => simplify(child))
      .filter(Boolean)
    if (simplifiedChildren.length > 0) out.children = simplifiedChildren
  }

  return out
}

/** Round to 4 decimal places to avoid float noise */
function round(n) {
  return Math.round(n * 10000) / 10000
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const simplified = simplify(document)
process.stdout.write(JSON.stringify(simplified, null, 2) + '\n')
