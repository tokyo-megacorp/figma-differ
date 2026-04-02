#!/usr/bin/env node
// render-review.js — Generate a self-contained review.html from fig-diff data
//
// Usage:
//   node render-review.js <fileKey> [--no-images] [--no-open] [--output path]
//
// Reads:
//   ~/.figma-differ/<fileKey>/index.json
//   ~/.figma-differ/<fileKey>/diffs/<range>/review.json
//   ~/.figma-differ/<fileKey>/diffs/<range>/<nodeId>/structural_diff.json
//
// Outputs:
//   review.html (self-contained, shareable)

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const os = require('os')

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const fileKey = args.find(a => !a.startsWith('--'))
const noImages = args.includes('--no-images')
const noComments = args.includes('--no-comments')
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

// ── Fetch comments via figma-api.sh ────────────────────────────────────────
function fetchComments() {
  const scriptDir = path.dirname(process.argv[1])
  const apiScript = path.join(scriptDir, 'figma-api.sh')
  try {
    const result = execSync(
      `bash "${apiScript}" fetch_comments "${fileKey}"`,
      { encoding: 'utf8', timeout: 120000 }
    )
    const data = JSON.parse(result)
    const comments = (data.comments || []).map(c => ({
      id: c.id,
      message: c.message,
      user: c.user ? c.user.handle : 'unknown',
      createdAt: c.created_at,
      resolvedAt: c.resolved_at || null,
      nodeId: c.client_meta ? c.client_meta.node_id : null,
      orderId: c.order_id || null,
      parentId: c.parent_id || null
    }))
    return comments
  } catch (e) {
    console.error(`WARN: failed to fetch comments: ${e.message}`)
    return []
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

  // Fetch comments
  const comments = noComments ? [] : fetchComments()
  if (comments.length > 0) {
    console.error(`Fetched ${comments.length} comments`)
  }

  // Build the embedded data object
  const embeddedData = {
    index,
    reviews: reviews.map(r => r.review),
    diffs: allDiffs,
    imageUrls,
    comments,
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

function generateHtml(data) {
  const jsonPayload = JSON.stringify(data)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>fig-diff — ${data.index.fileName || 'Review'}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    /* ── Reset ─────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Theme tokens ──────────────────────────────────────────── */
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface-hover: #1c2129;
      --border: #30363d;
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --severity-structural: #da3633;
      --severity-cosmetic: #d29922;
      --severity-unchanged: #3fb950;
      --diff-add-bg: #12261e;
      --diff-add-text: #3fb950;
      --diff-remove-bg: #3d1214;
      --diff-remove-text: #f85149;
      --diff-change-bg: #2d2000;
      --diff-change-text: #d29922;
      --accent: #58a6ff;
      --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Noto Sans, Helvetica, Arial, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --surface: #f6f8fa;
        --surface-hover: #eef1f4;
        --border: #d0d7de;
        --text-primary: #1f2328;
        --text-secondary: #656d76;
        --severity-structural: #cf222e;
        --severity-cosmetic: #bf8700;
        --severity-unchanged: #1a7f37;
        --diff-add-bg: #dafbe1;
        --diff-add-text: #116329;
        --diff-remove-bg: #ffebe9;
        --diff-remove-text: #82071e;
        --diff-change-bg: #fff8c5;
        --diff-change-text: #6a5300;
        --accent: #0969da;
      }
    }

    /* ── Base ───────────────────────────────────────────────────── */
    body {
      font-family: var(--font-ui);
      background: var(--bg);
      color: var(--text-primary);
      line-height: 1.5;
      min-height: 100vh;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Layout ────────────────────────────────────────────────── */
    .app { max-width: 1200px; margin: 0 auto; }
    .header {
      padding: 16px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-title { font-size: 18px; font-weight: 600; }
    .header-meta { color: var(--text-secondary); font-size: 13px; }
    .content { padding: 16px 24px; }

    /* ── Badges ─────────────────────────────────────────────────── */
    .badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      color: white;
    }
    .badge-structural { background: var(--severity-structural); }
    .badge-cosmetic { background: var(--severity-cosmetic); }
    .badge-unchanged { background: var(--severity-unchanged); }
    .severity-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .severity-dot-structural { background: var(--severity-structural); }
    .severity-dot-cosmetic { background: var(--severity-cosmetic); }
    .severity-dot-unchanged { background: var(--severity-unchanged); }

    /* ── Filter pills ──────────────────────────────────────────── */
    .filters { display: flex; gap: 8px; }
    .filter-pill {
      padding: 3px 12px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      color: white;
      opacity: 1;
      transition: opacity 0.15s;
    }
    .filter-pill.inactive { opacity: 0.35; }
    .filter-pill-structural { background: var(--severity-structural); }
    .filter-pill-cosmetic { background: var(--severity-cosmetic); }
    .filter-pill-unchanged { background: var(--border); color: var(--text-secondary); }

    /* ── Index screen ──────────────────────────────────────────── */
    .section-label {
      color: var(--text-secondary);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
    }
    .diff-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .diff-card:hover { background: var(--surface-hover); }
    .diff-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .diff-card-title { font-weight: 600; }
    .diff-card-meta { color: var(--text-secondary); font-size: 11px; margin-top: 4px; }

    /* ── Accordion screen ──────────────────────────────────────── */
    .topbar {
      padding: 12px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .topbar-left { display: flex; align-items: center; gap: 8px; }
    .back-btn {
      color: var(--text-secondary);
      cursor: pointer;
      background: none;
      border: none;
      font-family: var(--font-ui);
      font-size: 13px;
    }
    .back-btn:hover { color: var(--text-primary); }
    .page-group-header {
      color: var(--text-secondary);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 16px 0 10px;
      display: flex;
      justify-content: space-between;
    }
    .frame-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 6px;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .frame-card:hover { border-color: var(--text-secondary); }
    .frame-card-header {
      padding: 12px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .frame-card-left { display: flex; align-items: center; gap: 8px; }
    .frame-card-name { font-weight: 600; cursor: pointer; }
    .frame-card-name:hover { color: var(--accent); }
    .frame-card-stats { color: var(--text-secondary); font-size: 11px; }
    .frame-card-body {
      padding: 0 16px 12px;
      border-top: 1px solid var(--border);
      padding-top: 10px;
      display: none;
    }
    .frame-card.expanded .frame-card-body { display: block; }

    /* ── Diff hunks ────────────────────────────────────────────── */
    .diff-hunk {
      font-family: var(--font-mono);
      font-feature-settings: 'liga' 1, 'calt' 1;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 4px;
      margin-bottom: 3px;
      line-height: 1.6;
    }
    .diff-add { background: var(--diff-add-bg); color: var(--diff-add-text); }
    .diff-remove { background: var(--diff-remove-bg); color: var(--diff-remove-text); }
    .diff-change { background: var(--diff-change-bg); color: var(--diff-change-text); }
    .diff-meta {
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: 11px;
    }

    /* ── Detail screen ─────────────────────────────────────────── */
    .detail-layout { display: flex; height: calc(100vh - 49px); }
    .detail-sidebar {
      width: 220px;
      min-width: 220px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 12px;
      overflow-y: auto;
    }
    .sidebar-item {
      padding: 6px 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.1s;
    }
    .sidebar-item:hover { background: var(--surface-hover); }
    .sidebar-item.active { background: rgba(31, 111, 235, 0.12); font-weight: 600; }
    .detail-main {
      flex: 1;
      padding: 16px 24px;
      overflow-y: auto;
    }
    .detail-title { font-size: 16px; font-weight: 600; }
    .detail-stats {
      color: var(--text-secondary);
      font-size: 12px;
      margin: 4px 0 16px;
    }
    .change-group { margin-bottom: 16px; }
    .change-group-header {
      color: var(--text-secondary);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    /* ── Lazy image ────────────────────────────────────────────── */
    .lazy-img-container {
      width: 100%;
      max-height: 400px;
      overflow: hidden;
      border-radius: 8px;
      border: 1px solid var(--border);
      margin: 12px 0;
      background: var(--surface);
    }
    .lazy-img-container img {
      width: 100%;
      display: block;
      object-fit: contain;
      max-height: 400px;
    }
    .img-placeholder {
      height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      font-size: 12px;
      animation: shimmer 1.5s infinite;
    }
    @keyframes shimmer {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 0.7; }
    }
    .img-error {
      height: 80px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      font-size: 12px;
    }

    /* ── Keyboard focus ────────────────────────────────────────── */
    .frame-card.focused { outline: 2px solid var(--accent); outline-offset: -2px; }
    .sidebar-item.focused { outline: 2px solid var(--accent); outline-offset: -2px; }

    /* ── Timeline screen ───────────────────────────────────────── */
    .timeline-line {
      position: absolute;
      left: 24px;
      top: 0;
      bottom: 0;
      width: 1px;
      background: var(--border);
    }
    .timeline-entry {
      position: relative;
      margin-bottom: 16px;
      padding-left: 24px;
    }
    .timeline-dot {
      position: absolute;
      left: -16px;
      top: 6px;
      width: 10px;
      height: 10px;
    }
    .timeline-dot-version { border-radius: 50%; }
    .timeline-dot-comment {
      border-radius: 2px;
      background: var(--border);
      border: 1px dashed var(--text-secondary);
    }
    .timeline-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 14px;
    }
    .timeline-comment-card {
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 14px;
    }

    /* ── Comment items ────────────────────────────────────────── */
    .comment-item {
      display: flex;
      gap: 10px;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .comment-item.dimmed { opacity: 0.5; }
    .comment-dot {
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: var(--border);
      border: 1px dashed var(--text-secondary);
      flex-shrink: 0;
      margin-top: 4px;
    }
    .comment-message {
      margin: 4px 0 0;
      font-size: 13px;
      font-style: italic;
    }

    /* ── Nav buttons ──────────────────────────────────────────── */
    .nav-btn {
      cursor: pointer;
      font-size: 13px;
      padding: 6px 14px;
      border: none;
      border-radius: 16px;
      background: var(--border);
      color: var(--text-primary);
      transition: background 0.15s;
    }
    .nav-btn:hover { background: var(--surface-hover); }

    /* ── Hidden screens ────────────────────────────────────────── */
    .screen { display: none; }
    .screen.active { display: block; }
    .screen-detail.active { display: flex; }
  </style>
</head>
<body>
  <div class="app" id="app"></div>
  <script>
    const DATA = ${jsonPayload};
  </script>
  <script>
${generateAppJs()}
  </script>
</body>
</html>`
}

function generateAppJs() {
  return `
// ── State ─────────────────────────────────────────────────────────────────
const state = {
  screen: 'index',       // 'index' | 'accordion' | 'detail' | 'timeline' | 'comments'
  reviewIdx: null,        // which review is selected
  activeFilters: new Set(['structural', 'cosmetic']),
  expandedFrames: new Set(),
  detailNodeId: null,
  focusIdx: -1,
  commentFilters: { author: null, frame: null, resolved: 'all' },
};

const app = document.getElementById('app');

// ── Helpers ───────────────────────────────────────────────────────────────
function formatTimestamp(ts) {
  // "20260401T164047Z" → "Apr 1, 16:40"
  if (!ts || ts.length < 15) return ts;
  const y = ts.slice(0,4), m = ts.slice(4,6), d = ts.slice(6,8);
  const h = ts.slice(9,11), min = ts.slice(11,13);
  const date = new Date(y + '-' + m + '-' + d + 'T' + h + ':' + min + ':00Z');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
         date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function severityClass(sev) {
  return 'severity-' + (sev || 'unchanged');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatIsoDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
         d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getFrameName(nodeId) {
  const idx = DATA.index;
  if (!idx.frames) return nodeId;
  const frame = idx.frames.find(f => f.id === nodeId || f.nodeId === nodeId);
  return frame ? frame.name : nodeId;
}

function getUniqueAuthors() {
  const authors = new Set();
  (DATA.comments || []).forEach(c => authors.add(c.user));
  return Array.from(authors).sort();
}

// ── Index Screen ──────────────────────────────────────────────────────────
function renderIndex() {
  state.screen = 'index';
  const idx = DATA.index;
  const reviews = DATA.reviews;

  let html = '<div class="header">';
  html += '<div><span class="header-title">fig-diff</span> ';
  html += '<span class="header-meta">' + escapeHtml(idx.fileName || idx.fileKey) + '</span></div>';
  html += '<span class="header-meta">' + idx.frames.length + ' frames tracked</span>';
  html += '</div>';

  // Nav buttons
  const commentCount = (DATA.comments || []).length;
  const unresolvedCount = (DATA.comments || []).filter(c => !c.resolvedAt).length;
  html += '<div style="display:flex;gap:8px;padding:16px 24px 0">';
  if (reviews.length > 0) {
    html += '<button class="nav-btn" onclick="renderTimeline()">Timeline</button>';
  }
  if (commentCount > 0) {
    html += '<button class="nav-btn" onclick="renderComments()">' + commentCount + ' comments';
    if (unresolvedCount > 0) html += ' · ' + unresolvedCount + ' open';
    html += '</button>';
  }
  html += '</div>';

  html += '<div class="content">';
  html += '<div class="section-label">Recent Diffs</div>';

  if (reviews.length === 0) {
    html += '<p style="color:var(--text-secondary)">No diffs found. Run fig-diff diff-all first.</p>';
  }

  reviews.forEach((r, i) => {
    const s = r.summary;
    html += '<div class="diff-card" onclick="openReview(' + i + ')">';
    html += '<div class="diff-card-header">';
    html += '<div><span class="diff-card-title">' + formatTimestamp(r.baseline) + ' → ' + formatTimestamp(r.current) + '</span></div>';
    html += '<div style="display:flex;gap:6px">';
    if (s.structural > 0) html += '<span class="badge badge-structural">' + s.structural + '</span>';
    if (s.cosmetic > 0) html += '<span class="badge badge-cosmetic">' + s.cosmetic + '</span>';
    html += '</div></div>';
    html += '<div class="diff-card-meta">' + s.structural + ' structural, ' + s.cosmetic + ' cosmetic, ' + s.unchanged + ' unchanged</div>';
    html += '</div>';
  });

  html += '</div>';
  app.innerHTML = html;
}

function openReview(idx) {
  state.reviewIdx = idx;
  state.expandedFrames.clear();
  state.focusIdx = -1;
  renderAccordion();
}

function renderAccordion() {
  state.screen = 'accordion';
  const review = DATA.reviews[state.reviewIdx];
  const diffs = DATA.diffs[review.diffRange] || {};
  const decisions = review.decisions || [];

  // Filter decisions by active severity filters
  const filtered = decisions.filter(d => state.activeFilters.has(d.severity));

  // Group by page
  const pages = {};
  const pageTotals = {};
  for (const d of decisions) {
    pageTotals[d.page] = (pageTotals[d.page] || 0) + 1;
  }
  for (const d of filtered) {
    if (!pages[d.page]) pages[d.page] = [];
    pages[d.page].push(d);
  }

  let html = '<div class="topbar">';
  html += '<div class="topbar-left">';
  html += '<button class="back-btn" onclick="renderIndex()">← Back</button>';
  html += '<span style="color:var(--border)">|</span>';
  html += '<span style="font-weight:600">' + formatTimestamp(review.baseline) + ' → ' + formatTimestamp(review.current) + '</span>';
  html += '</div>';
  html += '<div class="filters">';
  ['structural', 'cosmetic', 'unchanged'].forEach(sev => {
    const count = decisions.filter(d => d.severity === sev).length;
    const active = state.activeFilters.has(sev);
    html += '<button class="filter-pill filter-pill-' + sev + (active ? '' : ' inactive') + '" ';
    html += 'onclick="toggleFilter(\\'' + sev + '\\')">' + count + ' ' + sev + '</button>';
  });
  html += '</div></div>';

  html += '<div class="content">';

  const pageNames = Object.keys(pages).sort();
  let frameIdx = 0;
  for (const page of pageNames) {
    const frames = pages[page];
    html += '<div class="page-group-header"><span>' + escapeHtml(page) + ' — ' + frames.length + ' change(s)</span>';
    html += '<span>' + frames.length + ' of ' + (pageTotals[page] || '?') + ' frames</span></div>';

    for (const d of frames) {
      const expanded = state.expandedFrames.has(d.nodeId);
      const diff = diffs[d.nodeId];
      const focused = frameIdx === state.focusIdx;
      html += '<div class="frame-card' + (expanded ? ' expanded' : '') + (focused ? ' focused' : '') + '" data-node="' + d.nodeId + '" data-idx="' + frameIdx + '">';
      html += '<div class="frame-card-header" onclick="toggleFrame(\\'' + d.nodeId + '\\')">';
      html += '<div class="frame-card-left">';
      html += '<span class="severity-dot severity-dot-' + d.severity + '"></span>';
      html += '<span class="frame-card-name" onclick="event.stopPropagation();openDetail(\\'' + d.nodeId + '\\')">' + escapeHtml(d.nodeName) + '</span>';
      html += '<span class="frame-card-stats">' + d.nodeCountBefore + ' → ' + d.nodeCountAfter + ' nodes (' + (d.nodeCountDelta >= 0 ? '+' : '') + d.nodeCountDelta + ')</span>';
      html += '</div>';
      html += '<span class="frame-card-stats">' + escapeHtml(d.summary) + ' ' + (expanded ? '▾' : '▸') + '</span>';
      html += '</div>';

      // Expanded body with diff hunks
      html += '<div class="frame-card-body">';
      if (diff && diff.changes) {
        html += renderDiffHunks(diff.changes, d.nodeId);
      } else {
        html += '<div class="diff-meta">No detailed diff data available</div>';
      }
      html += '</div></div>';
      frameIdx++;
    }
  }

  if (filtered.length === 0) {
    html += '<p style="color:var(--text-secondary);margin-top:24px;">No changes match the current filters.</p>';
  }

  html += '</div>';
  app.innerHTML = html;
}

function renderDiffHunks(changes, nodeId) {
  let html = '';
  const imageUrl = DATA.imageUrls[nodeId];
  if (imageUrl) {
    html += '<div class="lazy-img-container" data-src="' + imageUrl + '">';
    html += '<div class="img-placeholder">Loading preview...</div></div>';
  }

  for (const n of (changes.removedNodes || [])) {
    html += '<div class="diff-hunk diff-remove">\\u2212 "' + escapeHtml(n.name) + '" <span class="diff-meta">' + escapeHtml(n.type) + '</span></div>';
  }
  for (const n of (changes.addedNodes || [])) {
    html += '<div class="diff-hunk diff-add">+ "' + escapeHtml(n.name) + '" <span class="diff-meta">' + escapeHtml(n.type) + '</span></div>';
  }
  for (const c of (changes.componentSwaps || [])) {
    html += '<div class="diff-hunk diff-change">\\u21c4 "' + escapeHtml(c.name) + '" <span class="diff-meta">' + escapeHtml(c.before || '') + ' \\u2192 ' + escapeHtml(c.after || '') + '</span></div>';
  }
  for (const b of (changes.bboxChanges || [])) {
    const bef = b.before || {};
    const aft = b.after || {};
    html += '<div class="diff-hunk diff-change">\\u25b3 "' + escapeHtml(b.name) + '" <span class="diff-meta">' + (bef.w||'?') + '\\u00d7' + (bef.h||'?') + ' \\u2192 ' + (aft.w||'?') + '\\u00d7' + (aft.h||'?');
    if (b.dw) html += ' (dw: ' + (b.dw > 0 ? '+' : '') + Math.round(b.dw) + ', dh: ' + (b.dh > 0 ? '+' : '') + Math.round(b.dh) + ')';
    html += '</span></div>';
  }
  for (const v of (changes.visibilityChanges || [])) {
    html += '<div class="diff-hunk diff-change">"' + escapeHtml(v.name) + '" <span class="diff-meta">visible: ' + v.before + ' \\u2192 ' + v.after + '</span></div>';
  }
  for (const t of (changes.textChanges || [])) {
    html += '<div class="diff-hunk diff-change">"' + escapeHtml(t.name) + '" <span class="diff-meta">"' + escapeHtml(String(t.before).slice(0, 60)) + '" \\u2192 "' + escapeHtml(String(t.after).slice(0, 60)) + '"</span></div>';
  }
  for (const f of (changes.fillChanges || [])) {
    html += '<div class="diff-hunk diff-change">"' + escapeHtml(f.name) + '" <span class="diff-meta">' + (f.added||[]).length + ' fill(s) added, ' + (f.removed||[]).length + ' removed</span></div>';
  }
  for (const f of (changes.fontChanges || [])) {
    const b = f.before || {};
    const a = f.after || {};
    html += '<div class="diff-hunk diff-change">"' + escapeHtml(f.name) + '" <span class="diff-meta">font: ' + (b.fontFamily||'') + ' ' + (b.fontSize||'') + ' \\u2192 ' + (a.fontFamily||'') + ' ' + (a.fontSize||'') + '</span></div>';
  }
  for (const o of (changes.opacityChanges || [])) {
    html += '<div class="diff-hunk diff-change">"' + escapeHtml(o.name) + '" <span class="diff-meta">opacity: ' + o.before + ' \\u2192 ' + o.after + '</span></div>';
  }
  for (const l of (changes.layoutChanges || [])) {
    const b = l.before || {};
    const a = l.after || {};
    html += '<div class="diff-hunk diff-change">"' + escapeHtml(l.name) + '" <span class="diff-meta">layout: ' + (b.layoutMode||'none') + ' \\u2192 ' + (a.layoutMode||'none') + '</span></div>';
  }
  for (const s of (changes.strokeChanges || [])) {
    html += '<div class="diff-hunk diff-change">"' + escapeHtml(s.name) + '" <span class="diff-meta">' + (s.added||[]).length + ' stroke(s) added, ' + (s.removed||[]).length + ' removed</span></div>';
  }
  for (const c of (changes.constraintChanges || [])) {
    html += '<div class="diff-hunk diff-change">"' + escapeHtml(c.name) + '" <span class="diff-meta">constraints changed</span></div>';
  }
  for (const e of (changes.effectChanges || [])) {
    html += '<div class="diff-hunk diff-change">"' + escapeHtml(e.name) + '" <span class="diff-meta">' + (e.added||[]).length + ' effect(s) added, ' + (e.removed||[]).length + ' removed</span></div>';
  }

  return html;
}

function toggleFrame(nodeId) {
  if (state.expandedFrames.has(nodeId)) {
    state.expandedFrames.delete(nodeId);
  } else {
    state.expandedFrames.add(nodeId);
  }
  renderAccordion();
  setupLazyImages();
}

function toggleFilter(sev) {
  if (state.activeFilters.has(sev)) {
    state.activeFilters.delete(sev);
  } else {
    state.activeFilters.add(sev);
  }
  state.expandedFrames.clear();
  state.focusIdx = -1;
  renderAccordion();
}

function openDetail(nodeId) {
  state.detailNodeId = nodeId;
  renderDetail(nodeId);
  setupLazyImages();
}

function renderDetail(nodeId) {
  state.screen = 'detail';
  const review = DATA.reviews[state.reviewIdx];
  const diffs = DATA.diffs[review.diffRange] || {};
  const decisions = review.decisions.filter(d => state.activeFilters.has(d.severity));
  const current = review.decisions.find(d => d.nodeId === nodeId);
  const diff = diffs[nodeId];

  if (!current) { renderAccordion(); return; }

  // Group sidebar items by page
  const pages = {};
  for (const d of decisions) {
    if (!pages[d.page]) pages[d.page] = [];
    pages[d.page].push(d);
  }

  let html = '<div class="topbar">';
  html += '<div class="topbar-left">';
  html += '<button class="back-btn" onclick="state.screen=\\'accordion\\';renderAccordion()">← Back</button>';
  html += '<span style="color:var(--border)">|</span>';
  html += '<span style="font-weight:600">' + escapeHtml(current.nodeName) + '</span>';
  html += '</div></div>';

  html += '<div class="detail-layout">';

  // Sidebar
  html += '<div class="detail-sidebar">';
  for (const page of Object.keys(pages).sort()) {
    html += '<div class="section-label" style="margin:8px 0 6px">' + escapeHtml(page) + '</div>';
    for (const d of pages[page]) {
      const active = d.nodeId === nodeId;
      html += '<div class="sidebar-item' + (active ? ' active' : '') + '" onclick="openDetail(\\'' + d.nodeId + '\\')">';
      html += '<span class="severity-dot severity-dot-' + d.severity + '"></span>';
      html += '<span>' + escapeHtml(d.nodeName) + '</span>';
      html += '</div>';
    }
  }
  html += '</div>';

  // Main panel
  html += '<div class="detail-main">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center">';
  html += '<span class="detail-title">' + escapeHtml(current.nodeName) + '</span>';
  html += '<span class="badge badge-' + current.severity + '">' + current.severity + '</span>';
  html += '</div>';
  html += '<div class="detail-stats">' + current.nodeCountBefore + ' → ' + current.nodeCountAfter + ' nodes (' + (current.nodeCountDelta >= 0 ? '+' : '') + current.nodeCountDelta + ') · ' + escapeHtml(current.page) + ' · ' + escapeHtml(current.summary) + '</div>';

  // Lazy image
  const imageUrl = DATA.imageUrls[nodeId];
  if (imageUrl) {
    html += '<div class="lazy-img-container" data-src="' + imageUrl + '">';
    html += '<div class="img-placeholder">Loading preview...</div></div>';
  }

  // Change groups from structural diff
  if (diff && diff.changes) {
    const groups = [
      { key: 'addedNodes', label: 'Added Nodes', type: 'add' },
      { key: 'removedNodes', label: 'Removed Nodes', type: 'remove' },
      { key: 'componentSwaps', label: 'Component Swaps', type: 'change' },
      { key: 'bboxChanges', label: 'Bounding Box Changes', type: 'change' },
      { key: 'visibilityChanges', label: 'Visibility Changes', type: 'change' },
      { key: 'constraintChanges', label: 'Constraint Changes', type: 'change' },
      { key: 'layoutChanges', label: 'Layout Changes', type: 'change' },
      { key: 'textChanges', label: 'Text Changes', type: 'change' },
      { key: 'fillChanges', label: 'Fill Changes', type: 'change' },
      { key: 'strokeChanges', label: 'Stroke Changes', type: 'change' },
      { key: 'fontChanges', label: 'Font Changes', type: 'change' },
      { key: 'opacityChanges', label: 'Opacity Changes', type: 'change' },
      { key: 'effectChanges', label: 'Effect Changes', type: 'change' },
    ];

    for (const g of groups) {
      const items = diff.changes[g.key] || [];
      if (items.length === 0) continue;

      html += '<div class="change-group">';
      html += '<div class="change-group-header">' + g.label + ' (' + items.length + ')</div>';

      for (const item of items) {
        html += renderDetailHunk(g.key, item, g.type);
      }
      html += '</div>';
    }
  } else {
    html += '<div class="diff-meta" style="margin-top:16px">No detailed structural diff available for this frame.</div>';
  }

  // Inline comments for this frame
  const frameComments = (DATA.comments || []).filter(c => c.nodeId === nodeId || c.nodeId === nodeId.replace('_', ':'));
  if (frameComments.length > 0) {
    html += '<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:16px">';
    html += '<div class="change-group-header">Comments on this frame (' + frameComments.length + ')</div>';
    for (const c of frameComments.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const resolved = c.resolvedAt ? ' · resolved' : '';
      html += '<div style="display:flex;gap:8px;margin-bottom:10px">';
      html += '<div style="width:10px;height:10px;border-radius:2px;background:var(--border);border:1px dashed var(--text-secondary);flex-shrink:0;margin-top:3px"></div>';
      html += '<div style="flex:1">';
      html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
      html += '<span style="font-weight:500;font-size:13px">' + escapeHtml(c.user) + '<span style="color:var(--text-secondary);font-size:11px">' + resolved + '</span></span>';
      html += '<span style="color:var(--text-secondary);font-size:11px">' + formatIsoDate(c.createdAt) + '</span>';
      html += '</div>';
      html += '<p style="color:var(--text-secondary);margin:2px 0 0;font-size:12px;font-style:italic">"' + escapeHtml(c.message) + '"</p>';
      html += '</div></div>';
    }
    html += '</div>';
  }

  html += '</div>'; // detail-main
  html += '</div>'; // detail-layout
  app.innerHTML = html;
}

function renderDetailHunk(groupKey, item, type) {
  const cls = 'diff-hunk diff-' + type;
  const name = escapeHtml(item.name || item.id || '');

  switch (groupKey) {
    case 'addedNodes':
      return '<div class="' + cls + '">+ "' + name + '" <span class="diff-meta">' + escapeHtml(item.type) + '</span></div>';
    case 'removedNodes':
      return '<div class="' + cls + '">\u2212 "' + name + '" <span class="diff-meta">' + escapeHtml(item.type) + '</span></div>';
    case 'componentSwaps':
      return '<div class="' + cls + '">\u21c4 "' + name + '" <span class="diff-meta">' + escapeHtml(String(item.before)) + ' \u2192 ' + escapeHtml(String(item.after)) + '</span></div>';
    case 'bboxChanges': {
      const b = item.before || {};
      const a = item.after || {};
      let s = '<div class="' + cls + '">\u25b3 "' + name + '" <span class="diff-meta">' + (b.w||'?') + '\u00d7' + (b.h||'?') + ' \u2192 ' + (a.w||'?') + '\u00d7' + (a.h||'?');
      if (item.dw != null) s += ' (dw: ' + (item.dw>0?'+':'') + Math.round(item.dw) + ', dh: ' + (item.dh>0?'+':'') + Math.round(item.dh) + ')';
      return s + '</span></div>';
    }
    case 'visibilityChanges':
      return '<div class="' + cls + '">"' + name + '" <span class="diff-meta">visible: ' + item.before + ' \u2192 ' + item.after + '</span></div>';
    case 'constraintChanges':
      return '<div class="' + cls + '">"' + name + '" <span class="diff-meta">' + JSON.stringify(item.before) + ' \u2192 ' + JSON.stringify(item.after) + '</span></div>';
    case 'layoutChanges': {
      const b = item.before || {};
      const a = item.after || {};
      return '<div class="' + cls + '">"' + name + '" <span class="diff-meta">layout: ' + (b.layoutMode||'none') + ' \u2192 ' + (a.layoutMode||'none') + ', spacing: ' + (b.spacing||0) + ' \u2192 ' + (a.spacing||0) + '</span></div>';
    }
    case 'textChanges':
      return '<div class="' + cls + '">"' + name + '" <span class="diff-meta">"' + escapeHtml(String(item.before).slice(0,80)) + '" \u2192 "' + escapeHtml(String(item.after).slice(0,80)) + '"</span></div>';
    case 'fillChanges':
      return '<div class="' + cls + '">"' + name + '" <span class="diff-meta">' + (item.added||[]).length + ' added, ' + (item.removed||[]).length + ' removed</span></div>';
    case 'strokeChanges':
      return '<div class="' + cls + '">"' + name + '" <span class="diff-meta">' + (item.added||[]).length + ' added, ' + (item.removed||[]).length + ' removed</span></div>';
    case 'fontChanges': {
      const b = item.before || {};
      const a = item.after || {};
      return '<div class="' + cls + '">"' + name + '" <span class="diff-meta">' + (b.fontFamily||'') + ' ' + (b.fontSize||'') + '/' + (b.fontWeight||'') + ' \u2192 ' + (a.fontFamily||'') + ' ' + (a.fontSize||'') + '/' + (a.fontWeight||'') + '</span></div>';
    }
    case 'opacityChanges':
      return '<div class="' + cls + '">"' + name + '" <span class="diff-meta">opacity: ' + item.before + ' \u2192 ' + item.after + '</span></div>';
    case 'effectChanges':
      return '<div class="' + cls + '">"' + name + '" <span class="diff-meta">' + (item.added||[]).length + ' added, ' + (item.removed||[]).length + ' removed</span></div>';
    default:
      return '<div class="' + cls + '">"' + name + '"</div>';
  }
}

// ── Comments Screen ──────────────────────────────────────────────────────
function renderComments() {
  state.screen = 'comments';
  const comments = DATA.comments || [];
  const f = state.commentFilters;

  let filtered = comments;
  if (f.author) filtered = filtered.filter(c => c.user === f.author);
  if (f.frame) filtered = filtered.filter(c => c.nodeId === f.frame);
  if (f.resolved === 'unresolved') filtered = filtered.filter(c => !c.resolvedAt);
  else if (f.resolved === 'resolved') filtered = filtered.filter(c => !!c.resolvedAt);

  const unresolved = filtered.filter(c => !c.resolvedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const resolved = filtered.filter(c => !!c.resolvedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const authors = getUniqueAuthors();
  const totalUnresolved = comments.filter(c => !c.resolvedAt).length;

  let html = '<div class="topbar">';
  html += '<div class="topbar-left">';
  html += '<button class="back-btn" onclick="renderIndex()">← Back</button>';
  html += '<span style="color:var(--border)">|</span>';
  html += '<span style="font-weight:600">Comments</span>';
  html += '<span style="color:var(--text-secondary);font-size:12px">' + comments.length + ' total · ' + totalUnresolved + ' unresolved</span>';
  html += '</div>';
  html += '<div class="filters">';

  // Author filter
  html += '<select class="filter-pill" onchange="state.commentFilters.author=this.value||null;renderComments()" style="cursor:pointer;background:var(--card-bg);color:var(--text-primary);border:1px solid var(--border);padding:4px 8px;border-radius:12px;font-size:12px">';
  html += '<option value="">All authors</option>';
  for (const a of authors) {
    html += '<option value="' + escapeHtml(a) + '"' + (f.author === a ? ' selected' : '') + '>' + escapeHtml(a) + '</option>';
  }
  html += '</select>';

  // Resolved filter
  ['unresolved', 'resolved', 'all'].forEach(val => {
    const active = f.resolved === val || (val === 'all' && !f.resolved);
    html += '<button class="filter-pill' + (active ? '' : ' inactive') + '" onclick="state.commentFilters.resolved=\\'' + val + '\\';renderComments()" style="cursor:pointer">' + val + '</button>';
  });
  html += '</div></div>';

  html += '<div class="content">';

  function renderCommentItem(c, dimmed) {
    const opacity = dimmed ? 'opacity:0.5;' : '';
    let h = '<div style="display:flex;gap:10px;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--border);' + opacity + '">';
    h += '<div style="width:10px;height:10px;border-radius:2px;background:var(--border);border:1px dashed var(--text-secondary);flex-shrink:0;margin-top:4px"></div>';
    h += '<div style="flex:1">';
    h += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
    h += '<div><span style="font-weight:500">' + escapeHtml(c.user) + '</span>';
    if (c.nodeId) h += ' <span style="color:var(--text-secondary);font-size:12px">on </span><span style="font-size:12px">' + escapeHtml(getFrameName(c.nodeId)) + '</span>';
    h += '</div>';
    h += '<span style="color:var(--text-secondary);font-size:11px">' + formatIsoDate(c.createdAt) + '</span>';
    h += '</div>';
    h += '<p style="color:' + (dimmed ? 'var(--text-secondary)' : 'var(--text-primary)') + ';margin:4px 0 0;font-size:13px">"' + escapeHtml(c.message) + '"</p>';
    h += '</div></div>';
    return h;
  }

  if (unresolved.length > 0) {
    for (const c of unresolved) html += renderCommentItem(c, false);
  }

  if (resolved.length > 0) {
    html += '<div style="font-size:11px;text-transform:uppercase;color:var(--text-secondary);margin:8px 0 12px">Resolved</div>';
    for (const c of resolved) html += renderCommentItem(c, true);
  }

  if (unresolved.length === 0 && resolved.length === 0) {
    html += '<p style="color:var(--text-secondary);margin-top:24px">No comments match the current filters.</p>';
  }

  html += '</div>';
  app.innerHTML = html;
}

// ── Timeline Screen ─────────────────────────────────────────────────────
function renderTimeline() {
  state.screen = 'timeline';
  const comments = (DATA.comments || []).map(c => ({ ...c, _type: 'comment', _time: c.createdAt }));
  const reviews = (DATA.reviews || []).map((r, i) => ({ ...r, _type: 'version', _time: r.current ? r.current.replace(/(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z/, '$1-$2-$3T$4:$5:$6Z') : r.reviewedAt || '', _reviewIdx: i }));

  // Merge and sort by time descending
  const events = [...comments, ...reviews].sort((a, b) => b._time.localeCompare(a._time));

  let html = '<div class="topbar">';
  html += '<div class="topbar-left">';
  html += '<button class="back-btn" onclick="renderIndex()">← Back</button>';
  html += '<span style="color:var(--border)">|</span>';
  html += '<span style="font-weight:600">Timeline</span>';
  html += '<span style="color:var(--text-secondary);font-size:12px">' + reviews.length + ' diffs · ' + comments.length + ' comments</span>';
  html += '</div></div>';

  html += '<div class="content" style="padding-left:40px;position:relative">';
  html += '<div style="position:absolute;left:24px;top:0;bottom:0;width:1px;background:var(--border)"></div>';

  for (const ev of events) {
    if (ev._type === 'version') {
      const s = ev.summary || {};
      const maxSev = s.structural > 0 ? 'structural' : s.cosmetic > 0 ? 'cosmetic' : 'unchanged';
      const dotColor = maxSev === 'structural' ? 'var(--severity-structural)' : maxSev === 'cosmetic' ? 'var(--severity-cosmetic)' : 'var(--text-secondary)';
      const dimmed = maxSev === 'unchanged' ? 'opacity:0.35;' : '';

      html += '<div style="position:relative;margin-bottom:16px;padding-left:24px;' + dimmed + '">';
      html += '<div style="position:absolute;left:-16px;top:6px;width:10px;height:10px;border-radius:50%;background:' + dotColor + '"></div>';
      html += '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:6px;padding:10px 14px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
      html += '<span style="font-weight:600;font-size:14px">' + formatTimestamp(ev.baseline) + ' → ' + formatTimestamp(ev.current) + '</span>';
      html += '</div>';

      if (s.structural > 0 || s.cosmetic > 0) {
        html += '<div style="display:flex;gap:6px;margin-top:6px">';
        if (s.structural > 0) html += '<span style="background:var(--severity-structural);padding:1px 8px;border-radius:10px;font-size:11px">' + s.structural + ' structural</span>';
        if (s.cosmetic > 0) html += '<span style="background:var(--severity-cosmetic);color:#000;padding:1px 8px;border-radius:10px;font-size:11px">' + s.cosmetic + ' cosmetic</span>';
        html += '</div>';
      }

      // Frame summary
      const changed = (ev.decisions || []).filter(d => d.severity !== 'unchanged');
      if (changed.length > 0) {
        html += '<div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">';
        html += changed.map(d => {
          const sevColor = d.severity === 'structural' ? 'var(--severity-structural)' : 'var(--severity-cosmetic)';
          return '<span style="color:' + sevColor + '">' + escapeHtml(d.nodeName) + '</span> ' + escapeHtml(d.summary || d.severity);
        }).join(' · ');
        html += '</div>';
      }

      html += '<div style="margin-top:6px;font-size:12px;color:var(--accent);cursor:pointer" onclick="state.reviewIdx=' + ev._reviewIdx + ';renderAccordion()">View diff →</div>';
      html += '</div></div>';

    } else {
      // Comment
      html += '<div style="position:relative;margin-bottom:16px;padding-left:24px">';
      html += '<div style="position:absolute;left:-16px;top:6px;width:10px;height:10px;border-radius:2px;background:var(--border);border:1px dashed var(--text-secondary)"></div>';
      html += '<div style="background:var(--bg-primary);border:1px solid var(--border);border-radius:6px;padding:8px 14px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:baseline">';
      html += '<div style="font-size:13px"><span style="font-weight:500">' + escapeHtml(ev.user) + '</span>';
      if (ev.nodeId) html += ' <span style="color:var(--text-secondary);font-size:12px">on </span><span style="font-size:12px">' + escapeHtml(getFrameName(ev.nodeId)) + '</span>';
      html += '</div>';
      html += '<div style="display:flex;align-items:center;gap:8px">';
      if (ev.resolvedAt) html += '<span style="color:var(--text-secondary);font-size:11px">resolved</span>';
      html += '<span style="color:var(--text-secondary);font-size:12px">' + formatIsoDate(ev.createdAt) + '</span>';
      html += '</div></div>';
      html += '<p style="color:var(--text-secondary);margin:4px 0 0;font-size:12px;font-style:italic">"' + escapeHtml(ev.message) + '"</p>';
      html += '</div></div>';
    }
  }

  if (events.length === 0) {
    html += '<p style="color:var(--text-secondary);margin-top:24px">No timeline events found.</p>';
  }

  html += '</div>';
  app.innerHTML = html;
}

// ── Lazy Image Loading ────────────────────────────────────────────────────
function setupLazyImages() {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const container = entry.target;
        const src = container.dataset.src;
        if (src) {
          const img = document.createElement('img');
          img.src = src;
          img.onload = () => {
            container.innerHTML = '';
            container.appendChild(img);
          };
          img.onerror = () => {
            container.innerHTML = '<div class="img-error">Image unavailable</div>';
          };
          observer.unobserve(container);
        }
      }
    }
  }, { rootMargin: '200px' });

  document.querySelectorAll('.lazy-img-container[data-src]').forEach(el => {
    observer.observe(el);
  });
}

// ── Keyboard Navigation ──────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (state.screen === 'accordion') {
    const cards = document.querySelectorAll('.frame-card');
    if (e.key === 'j') {
      e.preventDefault();
      state.focusIdx = Math.min(state.focusIdx + 1, cards.length - 1);
      updateFocus(cards);
    } else if (e.key === 'k') {
      e.preventDefault();
      state.focusIdx = Math.max(state.focusIdx - 1, 0);
      updateFocus(cards);
    } else if (e.key === 'Enter' && state.focusIdx >= 0) {
      e.preventDefault();
      const card = cards[state.focusIdx];
      if (card) toggleFrame(card.dataset.node);
    } else if (e.key === 'o' && state.focusIdx >= 0) {
      e.preventDefault();
      const card = cards[state.focusIdx];
      if (card) openDetail(card.dataset.node);
    } else if (e.key === 'Escape') {
      renderIndex();
    }
  } else if (state.screen === 'detail') {
    const items = document.querySelectorAll('.sidebar-item');
    const currentIdx = Array.from(items).findIndex(el => el.classList.contains('active'));
    if (e.key === 'j') {
      e.preventDefault();
      const next = Math.min(currentIdx + 1, items.length - 1);
      const nodeId = items[next]?.onclick?.toString().match(/openDetail\\('([^']+)'\\)/)?.[1];
      if (nodeId) openDetail(nodeId);
    } else if (e.key === 'k') {
      e.preventDefault();
      const prev = Math.max(currentIdx - 1, 0);
      const nodeId = items[prev]?.onclick?.toString().match(/openDetail\\('([^']+)'\\)/)?.[1];
      if (nodeId) openDetail(nodeId);
    } else if (e.key === 'Escape') {
      renderAccordion();
      setupLazyImages();
    }
  } else if (state.screen === 'comments' || state.screen === 'timeline') {
    if (e.key === 'Escape') {
      renderIndex();
    }
  }
});

function updateFocus(cards) {
  cards.forEach((c, i) => {
    c.classList.toggle('focused', i === state.focusIdx);
  });
  if (cards[state.focusIdx]) {
    cards[state.focusIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Initial setup
setupLazyImages();
renderIndex();
`
}

main()
