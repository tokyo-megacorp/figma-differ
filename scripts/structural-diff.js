#!/usr/bin/env node
/**
 * structural-diff.js — semantic diff of two Figma node.json snapshots
 *
 * Usage:
 *   node structural-diff.js <before.json> <after.json> <diff.json>
 *
 * Exits 0 on success, 1 on error.
 * Prints one line to stdout: OK <severity> <summary>  or  FAIL <reason>
 *
 * Severity tiers:
 *   unchanged   no changes detected
 *   cosmetic    only fills / text content / font style changed
 *   structural  node added/removed, componentId swapped, bbox resized,
 *               constraints changed, visibility toggled
 */

const fs = require('fs')

const [,, beforePath, afterPath, diffPath] = process.argv

if (!beforePath || !afterPath || !diffPath) {
  console.error('Usage: structural-diff.js <before.json> <after.json> <diff.json>')
  process.exit(1)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readNodeJson(path) {
  try {
    let raw = fs.readFileSync(path, 'utf8')
    if (!raw || raw.trim().length === 0) throw new Error('empty file')
    // Strip leading non-JSON garbage (e.g. "out=''\n" from buggy snapshots)
    const jsonStart = raw.indexOf('{')
    if (jsonStart > 0) raw = raw.slice(jsonStart)
    const parsed = JSON.parse(raw)
    // Figma node endpoint: { nodes: { "ID": { document: {...} } } }
    const nodeId = Object.keys(parsed.nodes || {})[0]
    if (nodeId) return parsed.nodes[nodeId].document
    // Fallback: raw document
    return parsed.document || parsed
  } catch (e) {
    throw new Error(`Failed to parse ${path}: ${e.message}`)
  }
}

// Walk the node tree, collect all nodes indexed by id
function walkNodes(node, acc = {}) {
  if (!node || typeof node !== 'object') return acc
  if (node.id) acc[node.id] = node
  for (const child of node.children || []) walkNodes(child, acc)
  return acc
}

// Extract a flat summary of a node's key properties for diffing
function summarize(node) {
  return {
    type: node.type,
    name: node.name,
    visible: node.visible !== false, // default true
    componentId: node.componentId || null,
    bbox: node.absoluteBoundingBox
      ? { x: node.absoluteBoundingBox.x, y: node.absoluteBoundingBox.y,
          w: node.absoluteBoundingBox.width, h: node.absoluteBoundingBox.height }
      : null,
    constraints: node.constraints || null,
    fills: node.fills ? node.fills.map(f => JSON.stringify(f)) : [],
    strokes: node.strokes ? node.strokes.map(s => JSON.stringify(s)) : [],
    characters: node.type === 'TEXT' ? (node.characters || '') : null,
    fontSize: node.style ? node.style.fontSize : null,
    fontFamily: node.style ? node.style.fontFamily : null,
    fontWeight: node.style ? node.style.fontWeight : null,
    opacity: node.opacity !== undefined ? node.opacity : 1,
    layoutMode: node.layoutMode ?? null,
    paddingLeft: node.paddingLeft ?? 0,
    paddingRight: node.paddingRight ?? 0,
    paddingTop: node.paddingTop ?? 0,
    paddingBottom: node.paddingBottom ?? 0,
    itemSpacing: node.itemSpacing ?? 0,
    effects: node.effects ? node.effects.map(e => JSON.stringify(e)) : [],
  }
}

function bboxDelta(a, b) {
  if (!a && !b) return null
  if (!a || !b) return { changed: true, before: a, after: b }
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  const dw = Math.abs(a.w - b.w)
  const dh = Math.abs(a.h - b.h)
  if (dx + dy + dw + dh < 0.5) return null
  return { before: a, after: b, dx, dy, dw, dh }
}

function arrDiff(a, b) {
  const aSet = new Set(a), bSet = new Set(b)
  return {
    added: b.filter(x => !aSet.has(x)),
    removed: a.filter(x => !bSet.has(x)),
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  let before, after
  try {
    before = readNodeJson(beforePath)
    after  = readNodeJson(afterPath)
  } catch (e) {
    console.log(`FAIL  ${e.message}`)
    process.exit(1)
  }

  const beforeNodes = walkNodes(before)
  const afterNodes  = walkNodes(after)

  const beforeIds = new Set(Object.keys(beforeNodes))
  const afterIds  = new Set(Object.keys(afterNodes))

  const addedIds   = [...afterIds].filter(id => !beforeIds.has(id))
  const removedIds = [...beforeIds].filter(id => !afterIds.has(id))
  const commonIds  = [...beforeIds].filter(id => afterIds.has(id))

  const changes = {
    addedNodes:        addedIds.map(id => ({ id, name: afterNodes[id].name, type: afterNodes[id].type })),
    removedNodes:      removedIds.map(id => ({ id, name: beforeNodes[id].name, type: beforeNodes[id].type })),
    componentSwaps:    [],
    bboxChanges:       [],
    constraintChanges: [],
    visibilityChanges: [],
    textChanges:       [],
    fillChanges:       [],
    strokeChanges:     [],
    fontChanges:       [],
    opacityChanges:    [],
    layoutChanges:     [],
    effectChanges:     [],
  }

  for (const id of commonIds) {
    const b = summarize(beforeNodes[id])
    const a = summarize(afterNodes[id])

    if (b.componentId !== a.componentId)
      changes.componentSwaps.push({ id, name: a.name, before: b.componentId, after: a.componentId })

    const bb = bboxDelta(b.bbox, a.bbox)
    if (bb) changes.bboxChanges.push({ id, name: a.name, ...bb })

    if (JSON.stringify(b.constraints) !== JSON.stringify(a.constraints))
      changes.constraintChanges.push({ id, name: a.name, before: b.constraints, after: a.constraints })

    if (b.visible !== a.visible)
      changes.visibilityChanges.push({ id, name: a.name, before: b.visible, after: a.visible })

    if (b.characters !== null && b.characters !== a.characters)
      changes.textChanges.push({ id, name: a.name, before: b.characters, after: a.characters })

    const fills = arrDiff(b.fills, a.fills)
    if (fills.added.length || fills.removed.length)
      changes.fillChanges.push({ id, name: a.name, added: fills.added, removed: fills.removed })

    const strokes = arrDiff(b.strokes, a.strokes)
    if (strokes.added.length || strokes.removed.length)
      changes.strokeChanges.push({ id, name: a.name, added: strokes.added, removed: strokes.removed })

    if (b.fontSize !== a.fontSize || b.fontFamily !== a.fontFamily || b.fontWeight !== a.fontWeight)
      changes.fontChanges.push({ id, name: a.name,
        before: { fontSize: b.fontSize, fontFamily: b.fontFamily, fontWeight: b.fontWeight },
        after:  { fontSize: a.fontSize, fontFamily: a.fontFamily, fontWeight: a.fontWeight } })

    if (Math.abs(b.opacity - a.opacity) > 0.001)
      changes.opacityChanges.push({ id, name: a.name, before: b.opacity, after: a.opacity })

    if (b.layoutMode !== a.layoutMode ||
        b.paddingLeft !== a.paddingLeft || b.paddingRight !== a.paddingRight ||
        b.paddingTop !== a.paddingTop || b.paddingBottom !== a.paddingBottom ||
        b.itemSpacing !== a.itemSpacing)
      changes.layoutChanges.push({ id, name: a.name,
        before: { layoutMode: b.layoutMode, padding: [b.paddingTop, b.paddingRight, b.paddingBottom, b.paddingLeft], spacing: b.itemSpacing },
        after:  { layoutMode: a.layoutMode, padding: [a.paddingTop, a.paddingRight, a.paddingBottom, a.paddingLeft], spacing: a.itemSpacing } })

    const effects = arrDiff(b.effects, a.effects)
    if (effects.added.length || effects.removed.length)
      changes.effectChanges.push({ id, name: a.name, added: effects.added, removed: effects.removed })
  }

  // ── Severity ────────────────────────────────────────────────────────────────
  const isStructural =
    changes.addedNodes.length > 0 ||
    changes.removedNodes.length > 0 ||
    changes.componentSwaps.length > 0 ||
    changes.bboxChanges.length > 0 ||
    changes.constraintChanges.length > 0 ||
    changes.visibilityChanges.length > 0 ||
    changes.layoutChanges.length > 0

  const isCosmetic =
    changes.textChanges.length > 0 ||
    changes.fillChanges.length > 0 ||
    changes.strokeChanges.length > 0 ||
    changes.fontChanges.length > 0 ||
    changes.opacityChanges.length > 0 ||
    changes.effectChanges.length > 0

  const severity = isStructural ? 'structural' : isCosmetic ? 'cosmetic' : 'unchanged'

  // ── Summary line ────────────────────────────────────────────────────────────
  const parts = []
  if (changes.addedNodes.length)   parts.push(`+${changes.addedNodes.length} nodes`)
  if (changes.removedNodes.length) parts.push(`-${changes.removedNodes.length} nodes`)
  if (changes.componentSwaps.length) parts.push(`${changes.componentSwaps.length} component swap(s)`)
  if (changes.bboxChanges.length)  parts.push(`${changes.bboxChanges.length} bbox change(s)`)
  if (changes.textChanges.length)  parts.push(`${changes.textChanges.length} text change(s)`)
  if (changes.fillChanges.length)  parts.push(`${changes.fillChanges.length} fill change(s)`)
  if (changes.fontChanges.length)  parts.push(`${changes.fontChanges.length} font change(s)`)
  if (severity === 'unchanged')    parts.push('no changes')

  // ── Write diff JSON ─────────────────────────────────────────────────────────
  const result = {
    severity,
    summary: parts.join(', '),
    nodeCountBefore: beforeIds.size,
    nodeCountAfter:  afterIds.size,
    nodeCountDelta:  afterIds.size - beforeIds.size,
    changes,
    beforePath,
    afterPath,
    diffPath,
  }
  fs.writeFileSync(diffPath, JSON.stringify(result, null, 2))

  console.log(`OK  severity=${severity}  nodes=${beforeIds.size}→${afterIds.size}  ${parts.join('  ')}`)
  process.exit(0)
}

main()
