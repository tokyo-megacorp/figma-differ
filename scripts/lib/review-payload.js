const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const SOURCE_AUTHORITY = {
  review: 'review.json',
  latestTriage: 'latest-diff-all.json',
  structuralDiff: 'structural_diff.json',
  flows: 'flows.json',
  frameContext: 'frame.md',
  comments: 'comments cache or live fetch',
  metadata: 'file metadata cache or live fetch',
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function parseFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const fm = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w+):\s*"?(.*?)"?\s*$/)
    if (m) fm[m[1]] = m[2]
  }
  return fm
}

function extractDescription(md) {
  return md.split('\n').find(line => line.startsWith('> '))?.slice(2) || ''
}

function loadIndex(storePath) {
  const indexPath = path.join(storePath, 'index.json')
  const index = readJsonIfExists(indexPath)
  if (!index) throw new Error(`index.json not found at ${indexPath}`)
  return index
}

function discoverReviews(storePath) {
  const diffsDir = path.join(storePath, 'diffs')
  if (!fs.existsSync(diffsDir)) return []
  return fs.readdirSync(diffsDir)
    .filter(entry => fs.statSync(path.join(diffsDir, entry)).isDirectory())
    .map(range => {
      const reviewPath = path.join(diffsDir, range, 'review.json')
      const review = readJsonIfExists(reviewPath)
      if (!review) return null
      return { range, review, reviewPath }
    })
    .filter(Boolean)
    .sort((a, b) => b.range.localeCompare(a.range))
}

function loadStructuralDiffs(reviews) {
  const allDiffs = {}
  for (const { range, review } of reviews) {
    const diffs = {}
    for (const entry of review.decisions || []) {
      if (!entry.diffPath) continue
      const diff = readJsonIfExists(entry.diffPath)
      if (diff) diffs[entry.nodeId] = diff
    }
    allDiffs[range] = diffs
  }
  return allDiffs
}

function loadLatestTriage(storePath) {
  return readJsonIfExists(path.join(storePath, 'latest-diff-all.json'))
}

function loadFlows(storePath) {
  return readJsonIfExists(path.join(storePath, 'flows.json'))
}

function loadFrameContexts(storePath, index) {
  const contexts = {}
  for (const frame of index.frames || []) {
    const safe = frame.id.replace(/:/g, '_')
    const mdPath = path.join(storePath, safe, 'frame.md')
    if (!fs.existsSync(mdPath)) continue
    const md = fs.readFileSync(mdPath, 'utf8')
    const frontmatter = parseFrontmatter(md)
    contexts[frame.id] = {
      frontmatter,
      description: frontmatter.description || extractDescription(md),
      markdown: md,
    }
  }
  return contexts
}

function normalizeComments(data) {
  const comments = Array.isArray(data?.comments) ? data.comments : []
  return comments.map(comment => ({
    id: comment.id,
    message: comment.message,
    user: comment.user ? comment.user.handle : (comment.user || 'unknown'),
    avatarUrl: comment.user ? (comment.user.img_url || null) : (comment.avatarUrl || null),
    createdAt: comment.created_at || comment.createdAt || null,
    resolvedAt: comment.resolved_at || comment.resolvedAt || null,
    nodeId: comment.client_meta ? comment.client_meta.node_id : (comment.nodeId || null),
    orderId: comment.order_id || comment.orderId || null,
    parentId: comment.parent_id || comment.parentId || null,
  }))
}

function loadCommentsFromCache(storePath) {
  const explicit = readJsonIfExists(path.join(storePath, 'comments.json'))
  if (explicit) return normalizeComments(explicit)
  const commentsDir = path.join(storePath, 'comments')
  if (!fs.existsSync(commentsDir)) return []
  const snapshots = fs.readdirSync(commentsDir).sort().reverse()
  for (const filename of snapshots) {
    const data = readJsonIfExists(path.join(commentsDir, filename))
    if (data) return normalizeComments(data)
  }
  return []
}

function fetchComments(fileKey, scriptDir) {
  const apiScript = path.join(scriptDir, 'figma-api.sh')
  try {
    const result = execSync(`bash "${apiScript}" fetch_comments "${fileKey}"`, { encoding: 'utf8', timeout: 120000 })
    return normalizeComments(JSON.parse(result))
  } catch {
    return []
  }
}

function loadMetadataFromCache(storePath) {
  return readJsonIfExists(path.join(storePath, 'file-metadata.json'))
}

function fetchMetadata(fileKey, scriptDir) {
  const apiScript = path.join(scriptDir, 'figma-api.sh')
  try {
    const result = execSync(`bash "${apiScript}" fetch_file_tree "${fileKey}" 1`, { encoding: 'utf8', timeout: 120000 })
    const data = JSON.parse(result)
    return {
      lastModified: data.lastModified || null,
      thumbnailUrl: data.thumbnailUrl || null,
      fileName: data.name || null,
    }
  } catch {
    return { lastModified: null, thumbnailUrl: null, fileName: null }
  }
}

function fetchImageUrls(fileKey, nodeIds, scriptDir) {
  if (!nodeIds.length) return {}
  const apiScript = path.join(scriptDir, 'figma-api.sh')
  try {
    const result = execSync(`bash "${apiScript}" fetch_image_urls "${fileKey}" "${nodeIds.join(',')}"`, { encoding: 'utf8', timeout: 120000 })
    return JSON.parse(result)
  } catch {
    return {}
  }
}

function buildReviewPayloadV1(options) {
  const {
    fileKey,
    storePath = path.join(os.homedir(), '.figma-differ', fileKey),
    scriptDir = path.join(__dirname, '..'),
    noImages = false,
    noComments = false,
    allowFetch = true,
  } = options

  const index = loadIndex(storePath)
  const reviews = discoverReviews(storePath)
  if (reviews.length === 0) {
    throw new Error('no review.json files found. Run fig-diff diff-all first.')
  }

  const diffs = loadStructuralDiffs(reviews)
  const latestTriage = loadLatestTriage(storePath)
  const flows = loadFlows(storePath)
  const frameContexts = loadFrameContexts(storePath, index)
  const comments = noComments ? [] : (() => {
    const cached = loadCommentsFromCache(storePath)
    return cached.length || !allowFetch ? cached : fetchComments(fileKey, scriptDir)
  })()
  const metadata = loadMetadataFromCache(storePath) || (allowFetch ? fetchMetadata(fileKey, scriptDir) : { lastModified: null, thumbnailUrl: null, fileName: null })

  const changedNodeIds = new Set()
  for (const { review } of reviews) {
    for (const decision of review.decisions || []) {
      if (decision.severity !== 'unchanged') changedNodeIds.add(decision.nodeId)
    }
  }

  const imageUrls = noImages || !allowFetch ? {} : fetchImageUrls(fileKey, [...changedNodeIds], scriptDir)

  return {
    version: 'reviewPayload.v1',
    optionalEnrichmentsFailSoft: true,
    sourceAuthority: SOURCE_AUTHORITY,
    generatedAt: new Date().toISOString(),
    fileKey,
    index,
    reviews: reviews.map(entry => entry.review),
    reviewRanges: reviews.map(entry => ({ range: entry.range, reviewPath: entry.reviewPath })),
    diffs,
    latestTriage,
    flows,
    frameContexts,
    comments,
    metadata,
    imageUrls,
  }
}

module.exports = {
  buildReviewPayloadV1,
  parseFrontmatter,
}
