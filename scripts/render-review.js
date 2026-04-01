#!/usr/bin/env node
/**
 * render-review.js — Generate a self-contained review.html from fig-diff data
 *
 * Usage:
 *   node render-review.js <fileKey> [--no-images] [--no-open] [--output path]
 *
 * Reads:
 *   ~/.figma-differ/<fileKey>/index.json
 *   ~/.figma-differ/<fileKey>/diffs/*/review.json
 *   ~/.figma-differ/<fileKey>/diffs/*/*/structural_diff.json
 *
 * Outputs:
 *   review.html (self-contained, shareable)
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const os = require('os')

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const fileKey = args.find(a => !a.startsWith('--'))
const noImages = args.includes('--no-images')
const noOpen = args.includes('--no-open')
const outputFlag = args.indexOf('--output')
const outputPath = outputFlag !== -1 ? args[outputFlag + 1] : null

if (!fileKey) {
  console.error('Usage: render-review.js <fileKey> [--no-images] [--no-open] [--output path]')
  process.exit(1)
}

const STORE = path.join(os.homedir(), '.figma-differ', fileKey)

// ── Load index ──────────────────────────────────────────────────────────────
function loadIndex() {
  const indexPath = path.join(STORE, 'index.json')
  if (!fs.existsSync(indexPath)) {
    console.error(`FAIL: index.json not found at ${indexPath}`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(indexPath, 'utf8'))
}

// ── Discover all review.json files ──────────────────────────────────────────
function discoverReviews() {
  const diffsDir = path.join(STORE, 'diffs')
  if (!fs.existsSync(diffsDir)) return []

  return fs.readdirSync(diffsDir)
    .filter(d => fs.statSync(path.join(diffsDir, d)).isDirectory())
    .map(range => {
      const reviewPath = path.join(diffsDir, range, 'review.json')
      if (!fs.existsSync(reviewPath)) return null
      const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'))
      return { range, review, reviewPath }
    })
    .filter(Boolean)
    .sort((a, b) => b.range.localeCompare(a.range)) // newest first
}

// ── Load structural diffs for a review ──────────────────────────────────────
function loadStructuralDiffs(review) {
  const diffs = {}
  for (const entry of review.decisions || []) {
    if (entry.diffPath && fs.existsSync(entry.diffPath)) {
      try {
        diffs[entry.nodeId] = JSON.parse(fs.readFileSync(entry.diffPath, 'utf8'))
      } catch (e) {
        // Skip unreadable diffs
      }
    }
  }
  return diffs
}

// ── Fetch image URLs via figma-api.sh ───────────────────────────────────────
function fetchImageUrls(nodeIds) {
  if (noImages || nodeIds.length === 0) return {}
  const scriptDir = path.dirname(process.argv[1])
  const apiScript = path.join(scriptDir, 'figma-api.sh')
  const idsStr = nodeIds.join(',')
  try {
    const result = execSync(
      `bash "${apiScript}" fetch_image_urls "${fileKey}" "${idsStr}"`,
      { encoding: 'utf8', timeout: 120000 }
    )
    return JSON.parse(result)
  } catch (e) {
    console.error(`WARN: failed to fetch image URLs: ${e.message}`)
    return {}
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
function main() {
  const index = loadIndex()
  const reviews = discoverReviews()

  if (reviews.length === 0) {
    console.error('FAIL: no review.json files found. Run fig-diff diff-all first.')
    process.exit(1)
  }

  // Load structural diffs for all reviews
  const allDiffs = {}
  for (const { range, review } of reviews) {
    allDiffs[range] = loadStructuralDiffs(review)
  }

  // Collect all changed node IDs across all reviews for image fetching
  const changedNodeIds = new Set()
  for (const { review } of reviews) {
    for (const d of review.decisions || []) {
      if (d.severity !== 'unchanged') changedNodeIds.add(d.nodeId)
    }
  }

  console.error(`Loading ${reviews.length} review(s), ${changedNodeIds.size} changed frames...`)
  const imageUrls = fetchImageUrls([...changedNodeIds])
  const fetchedCount = Object.keys(imageUrls).length
  if (!noImages) {
    console.error(`Fetched ${fetchedCount} image URLs`)
  }

  // Build the embedded data object
  const embeddedData = {
    index,
    reviews: reviews.map(r => r.review),
    diffs: allDiffs,
    imageUrls,
    generatedAt: new Date().toISOString()
  }

  const html = generateHtml(embeddedData)

  // Write output
  const outFile = outputPath || path.join(STORE, 'review.html')
  fs.writeFileSync(outFile, html)
  console.log(`OK  review.html written to ${outFile}`)

  // Open in browser
  if (!noOpen) {
    const openCmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    try { execSync(`${openCmd} "${outFile}"`) } catch (e) { /* ignore */ }
  }
}

// Placeholder — Task 3 fills this in
function generateHtml(data) {
  return `<!DOCTYPE html><html><body><pre>${JSON.stringify(data, null, 2)}</pre></body></html>`
}

main()
