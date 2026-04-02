#!/usr/bin/env node
/**
 * bulk-diff.js — run structural diff on all frames in one pass
 *
 * Usage:
 *   node bulk-diff.js <fileKey> <current-dir> [--top N]
 *
 * Reads index.json, finds latest baseline per frame, runs summarize+compare
 * (same logic as structural-diff.js), outputs JSON report to stdout.
 *
 * Exit 0: success. Exit 1: error.
 */

const fs = require('fs')
const path = require('path')

const [,, fileKey, currentDir, ...flags] = process.argv

if (!fileKey || !currentDir) {
  console.error('Usage: bulk-diff.js <fileKey> <current-dir> [--top N]')
  process.exit(1)
}

const topN = (() => {
  const idx = flags.indexOf('--top')
  return idx >= 0 ? parseInt(flags[idx + 1], 10) || 15 : 15
})()

const baseDir = path.join(process.env.HOME, '.figma-differ', fileKey)
const indexPath = path.join(baseDir, 'index.json')

// ── Helpers (same as structural-diff.js) ────────────────────────────────────

function summarize(node) {
  return {
    type: node.type,
    name: node.name,
    visible: node.visible !== false,
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

function walkNodes(node, acc = {}) {
  if (!node || typeof node !== 'object') return acc
  if (node.id) acc[node.id] = node
  for (const child of node.children || []) walkNodes(child, acc)
  return acc
}

function bboxDelta(a, b) {
  if (!a && !b) return null
  if (!a || !b) return { changed: true }
  const dx = Math.abs(a.x - b.x)
  const dy = Math.abs(a.y - b.y)
  const dw = Math.abs(a.w - b.w)
  const dh = Math.abs(a.h - b.h)
  if (dx + dy + dw + dh < 0.5) return null
  return { dx, dy, dw, dh }
}

function arrDiff(a, b) {
  const aSet = new Set(a), bSet = new Set(b)
  return {
    added: b.filter(x => !aSet.has(x)),
    removed: a.filter(x => !bSet.has(x)),
  }
}

function readJson(p) {
  let raw = fs.readFileSync(p, 'utf8')
  // Strip leading non-JSON garbage (e.g. "out=''\n" from buggy snapshots)
  const jsonStart = raw.indexOf('{')
  if (jsonStart < 0) throw new Error(`no JSON object in ${p}`)
  if (jsonStart > 0) raw = raw.slice(jsonStart)
  const parsed = JSON.parse(raw)
  // Handle Figma node endpoint format
  const nodeId = Object.keys(parsed.nodes || {})[0]
  if (nodeId) return parsed.nodes[nodeId].document
  return parsed.document || parsed
}

function diffFrame(beforeNode, afterNode) {
  const beforeNodes = walkNodes(beforeNode)
  const afterNodes = walkNodes(afterNode)

  const beforeIds = new Set(Object.keys(beforeNodes))
  const afterIds = new Set(Object.keys(afterNodes))

  const addedIds = [...afterIds].filter(id => !beforeIds.has(id))
  const removedIds = [...beforeIds].filter(id => !afterIds.has(id))
  const commonIds = [...beforeIds].filter(id => afterIds.has(id))

  const counts = {
    added: addedIds.length,
    removed: removedIds.length,
    componentSwaps: 0,
    bboxChanges: 0,
    constraintChanges: 0,
    visibilityChanges: 0,
    textChanges: 0,
    fillChanges: 0,
    strokeChanges: 0,
    fontChanges: 0,
    opacityChanges: 0,
    layoutChanges: 0,
    effectChanges: 0,
  }

  for (const id of commonIds) {
    const b = summarize(beforeNodes[id])
    const a = summarize(afterNodes[id])

    if (b.componentId !== a.componentId) counts.componentSwaps++
    if (bboxDelta(b.bbox, a.bbox)) counts.bboxChanges++
    if (JSON.stringify(b.constraints) !== JSON.stringify(a.constraints)) counts.constraintChanges++
    if (b.visible !== a.visible) counts.visibilityChanges++
    if (b.characters !== null && b.characters !== a.characters) counts.textChanges++

    const fills = arrDiff(b.fills, a.fills)
    if (fills.added.length || fills.removed.length) counts.fillChanges++

    const strokes = arrDiff(b.strokes, a.strokes)
    if (strokes.added.length || strokes.removed.length) counts.strokeChanges++

    if (b.fontSize !== a.fontSize || b.fontFamily !== a.fontFamily || b.fontWeight !== a.fontWeight)
      counts.fontChanges++

    if (Math.abs(b.opacity - a.opacity) > 0.001) counts.opacityChanges++

    if (b.layoutMode !== a.layoutMode ||
        b.paddingLeft !== a.paddingLeft || b.paddingRight !== a.paddingRight ||
        b.paddingTop !== a.paddingTop || b.paddingBottom !== a.paddingBottom ||
        b.itemSpacing !== a.itemSpacing)
      counts.layoutChanges++

    const effects = arrDiff(b.effects, a.effects)
    if (effects.added.length || effects.removed.length) counts.effectChanges++
  }

  const isStructural =
    counts.added > 0 || counts.removed > 0 || counts.componentSwaps > 0 ||
    counts.visibilityChanges > 0 || counts.layoutChanges > 0

  const isCosmetic =
    counts.bboxChanges > 0 || counts.constraintChanges > 0 ||
    counts.textChanges > 0 || counts.fillChanges > 0 || counts.strokeChanges > 0 ||
    counts.fontChanges > 0 || counts.opacityChanges > 0 || counts.effectChanges > 0

  const severity = isStructural ? 'structural' : isCosmetic ? 'cosmetic' : 'unchanged'

  const parts = []
  if (counts.added) parts.push(`+${counts.added} nodes`)
  if (counts.removed) parts.push(`-${counts.removed} nodes`)
  if (counts.componentSwaps) parts.push(`${counts.componentSwaps} component swap(s)`)
  if (counts.bboxChanges) parts.push(`${counts.bboxChanges} bbox`)
  if (counts.textChanges) parts.push(`${counts.textChanges} text`)
  if (counts.fillChanges) parts.push(`${counts.fillChanges} fill`)
  if (counts.fontChanges) parts.push(`${counts.fontChanges} font`)
  if (counts.layoutChanges) parts.push(`${counts.layoutChanges} layout`)
  if (counts.visibilityChanges) parts.push(`${counts.visibilityChanges} visibility`)
  if (counts.effectChanges) parts.push(`${counts.effectChanges} effect`)

  return {
    severity,
    summary: parts.join(', ') || 'no changes',
    nodesBefore: beforeIds.size,
    nodesAfter: afterIds.size,
    counts,
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  const frames = index.frames

  const results = []
  const errorDetails = []
  let unchanged = 0, cosmetic = 0, structural = 0, noBaseline = 0, errors = 0

  const skipTypes = new Set(['SECTION'])

  for (const fr of frames) {
    if (skipTypes.has(fr.type)) continue

    const safe = fr.id.replace(/:/g, '_')
    const currentPath = path.join(currentDir, `${safe}.json`)

    if (!fs.existsSync(currentPath)) {
      // Not fetched (no baseline or fetch failed)
      continue
    }

    // Find latest baseline
    const snapDir = path.join(baseDir, safe)
    if (!fs.existsSync(snapDir)) { noBaseline++; continue }

    const timestamps = fs.readdirSync(snapDir)
      .filter(d => fs.statSync(path.join(snapDir, d)).isDirectory())
      .sort()

    if (!timestamps.length) { noBaseline++; continue }

    const baselinePath = path.join(snapDir, timestamps[timestamps.length - 1], 'node.json')
    if (!fs.existsSync(baselinePath)) { noBaseline++; continue }

    try {
      const beforeNode = readJson(baselinePath)
      const afterNode = readJson(currentPath)
      const diff = diffFrame(beforeNode, afterNode)

      if (diff.severity === 'unchanged') { unchanged++; continue }
      if (diff.severity === 'cosmetic') cosmetic++
      if (diff.severity === 'structural') structural++

      results.push({
        id: fr.id,
        name: fr.name,
        page: fr.page || '?',
        ...diff,
      })
    } catch (e) {
      errors++
      errorDetails.push({ id: fr.id, name: fr.name, error: e.message })
    }
  }

  // Sort: structural first, then cosmetic; within tier by total change count
  const sevOrder = { structural: 0, cosmetic: 1 }
  results.sort((a, b) => {
    const so = (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9)
    if (so !== 0) return so
    const aTotal = Object.values(a.counts).reduce((s, v) => s + v, 0)
    const bTotal = Object.values(b.counts).reduce((s, v) => s + v, 0)
    return bTotal - aTotal
  })

  const report = {
    total: frames.length,
    unchanged,
    cosmetic,
    structural,
    noBaseline,
    errors,
    top: results.slice(0, topN),
    rest: results.slice(topN).map(r => ({
      id: r.id, name: r.name, page: r.page, severity: r.severity, summary: r.summary,
    })),
    errorDetails: errorDetails.slice(0, 10),
  }

  console.log(JSON.stringify(report, null, 2))
}

main()
