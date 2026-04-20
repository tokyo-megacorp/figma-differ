#!/usr/bin/env node
/**
 * figma-differ MCP server — semantic search over Figma design frames
 *
 * Tools:
 *   search       — find frames by content, components, flows, or description
 *   get_frame    — get full frame details by node ID or name
 *   get_flows    — get screen flow connections for a frame or entire file
 *   list_frames  — list all indexed frames with metadata
 *
 * Wraps QMD for search, reads frame.md and flows.json directly for the rest.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { execSync, execSync as execSyncRaw } from 'child_process'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))

const BASE_DIR = join(homedir(), '.figma-differ')

const MIN_DESCRIPTION_LENGTH = 30

const FLOWS_EXTRACTION_TIMEOUT_MS = 15000
const QMD_UPDATE_TIMEOUT_MS = 30000

// ── Global error guards — keep the server alive on unhandled throws ──────────

process.on('uncaughtException', (err) => {
  process.stderr.write(`[figma-differ] uncaughtException: ${err.message}\n${err.stack}\n`)
})
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[figma-differ] unhandledRejection: ${reason}\n`)
})

// ── Frame guidance helpers ────────────────────────────────────────────────────

function generateFrameEnrichmentHint(fileKey, nodeId, nodeCount) {
  const plural = nodeCount !== 1 ? 's' : ''
  return [
    `\n\n---`,
    `This frame has shallow data (${nodeCount} node${plural}). Enrich it:`,
    ``,
    `**Primary (Figma MCP):**`,
    `1. Call Figma MCP get_design_context(fileKey: "${fileKey}", nodeId: "${nodeId}")`,
    `2. Call figma-differ save with extracted components and text content`,
    ``,
    `**Fallback (if Figma MCP unavailable or errors):**`,
    `1. Run: \`bash ${SCRIPTS_DIR}/figma-api.sh fetch_node_json ${fileKey} ${nodeId} | node ${SCRIPTS_DIR}/simplify-node.mjs > /tmp/simplified.json\``,
    `2. Extract name, node_type, components (INSTANCE/COMPONENT nodes), text_content (TEXT nodes) from simplified JSON`,
    `3. Call figma-differ save with node_json ← contents of /tmp/simplified.json and extracted metadata`,
  ].join('\n')
}

function generateFrameNotFoundGuide(nodeId, scriptsDir) {
  return [
    `Frame ${nodeId} not found in local cache.`,
    ``,
    `**To fetch it:**`,
    ``,
    `**Primary (Figma MCP):**`,
    `1. Call Figma MCP get_design_context(fileKey: "<file_key>", nodeId: "${nodeId}")`,
    `2. Call figma-differ save with the result`,
    ``,
    `**Fallback (if Figma MCP unavailable):**`,
    `1. Run: \`bash ${scriptsDir}/figma-api.sh fetch_node_json <file_key> ${nodeId} | node ${scriptsDir}/simplify-node.mjs > /tmp/simplified.json\``,
    `2. Call figma-differ save with node_json ← contents of /tmp/simplified.json and extracted metadata (name, node_type, components, text_content)`,
  ].join('\n')
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function findFileKeys() {
  if (!existsSync(BASE_DIR)) return []
  return readdirSync(BASE_DIR)
    .filter(d => {
      const dirPath = join(BASE_DIR, d)
      return statSync(dirPath).isDirectory() && existsSync(join(dirPath, 'index.json'))
    })
}

function readIndex(fileKey) {
  const indexJsonPath = join(BASE_DIR, fileKey, 'index.json')
  if (!existsSync(indexJsonPath)) return null
  return JSON.parse(readFileSync(indexJsonPath, 'utf8'))
}

function readFlows(fileKey) {
  const flowsJsonPath = join(BASE_DIR, fileKey, 'flows.json')
  if (!existsSync(flowsJsonPath)) return null
  return JSON.parse(readFileSync(flowsJsonPath, 'utf8'))
}

function findFrameMd(fileKey, nodeId) {
  const safe = nodeId.replace(/:/g, '_')
  const frameMdPath = join(BASE_DIR, fileKey, safe, 'frame.md')
  if (!existsSync(frameMdPath)) return null
  return readFileSync(frameMdPath, 'utf8')
}

function hasNodeJsonSnapshot(fileKey, nodeId) {
  const safe = nodeId.replace(/:/g, '_')
  const frameDir = join(BASE_DIR, fileKey, safe)
  if (!existsSync(frameDir)) return false
  return readdirSync(frameDir).some(entry => {
    const candidate = join(frameDir, entry, 'node.json')
    return existsSync(candidate)
  })
}

function parseFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const fm = {}
  for (const line of match[1].split('\n')) {
    const lineMatch = line.match(/^(\w+):\s*"?(.*?)"?\s*$/)
    if (lineMatch) fm[lineMatch[1]] = lineMatch[2]
  }
  return fm
}

function filterNonSelfLoops(flows = []) {
  return flows.filter(f => f?.from?.id && f?.to?.id && f.from.id !== f.to.id)
}

function takeSectionItems(md, heading, limit = 5) {
  const sectionMatch = md.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?:\\n## |$)`))
  if (!sectionMatch) return []
  return sectionMatch[1]
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.startsWith('- '))
    .slice(0, limit)
}

function extractDescriptionBlockquote(md) {
  const lines = md.split('\n')
  return lines.find(line => line.startsWith('> ')) || ''
}

function summarizeFrameMd(md) {
  const frontmatter = parseFrontmatter(md)
  const frontmatterMatch = md.match(/^---\n[\s\S]*?\n---/)
  const parts = []
  if (frontmatterMatch) parts.push(frontmatterMatch[0])

  const description = extractDescriptionBlockquote(md)
  if (description) parts.push('', description)

  const nodeCount = Number(frontmatter.node_count || 0)
  if (frontmatter.figma_type === 'CANVAS' || nodeCount > 10000) {
    parts.push('', '> degraded summary: large page/section node — prefer indexing child frames for full fidelity')
  }

  const components = takeSectionItems(md, 'Components Used')
  if (components.length) parts.push('', '## Components Used', ...components)

  const textItems = takeSectionItems(md, 'Text Content')
  if (textItems.length) parts.push('', '## Text Content', ...textItems)

  return parts.join('\n').trim()
}

function qmdSearch(query, limit = 10) {
  try {
    const out = execSync(
      `qmd search -n ${limit} -c figma --json "${query.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: FLOWS_EXTRACTION_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return JSON.parse(out)
  } catch (e) {
    // Fallback: try without --json
    try {
      const out = execSync(
        `qmd search -n ${limit} -c figma "${query.replace(/"/g, '\\"')}"`,
        { encoding: 'utf8', timeout: FLOWS_EXTRACTION_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'] }
      )
      return out
    } catch {
      return null
    }
  }
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'figma-differ',
  version: '0.4.1',
  instructions: `figma-differ is a local Figma design database with semantic search, change tracking, and flow detection.

## Mode Auto-Detection

Call figma-differ check_auth at session start to see what's available. Apply this priority for every Figma operation:

**Mode 1 — LOCAL CACHE (always free, zero cost)**
figma-differ search / get_frame / get_flows
→ Use when the frame is already indexed. No network call needed.
→ Skip to Mode 2 only when local result is missing or user asks for fresh data.

**Mode 2 — FIGMA MCP (richest data, rate-limited)**
get_design_context / get_metadata / get_variable_defs / get_screenshot
→ Use when fresh data is needed AND Figma MCP tools respond without error.
→ Limitation: ~6 calls/month on Starter; does NOT provide prototype interactions.
→ After each call: ALWAYS call figma-differ save to cache the result.

**Mode 3 — REST API (structural, unlimited)**
bash ${SCRIPTS_DIR}/figma-api.sh ...
→ Use when Figma MCP is unavailable or errors, OR when prototype interactions are needed.
→ Requires FIGMA_TOKEN (check via check_auth).
→ After each call: ALWAYS call figma-differ save to cache the result.

**Mode 4 — OFFLINE ONLY**
figma-differ get_frame / search from cached data
→ Use when no REST token AND Figma MCP unavailable.
→ Inform the user that data may be stale.

## Per-operation priority

| Operation | Mode 2 (Figma MCP) | Mode 3 (REST fallback) | Mode 1 (offline) |
|---|---|---|---|
| Get frame design | get_design_context | fetch_node_json \| simplify-node.mjs | get_frame |
| List children | get_metadata (sparse XML) | fetch_node_json .children[] | list_frames |
| Prototype interactions | — (unsupported) | fetch_prototype_data | get_flows |
| Design tokens | get_variable_defs | — | variables.json (cached) |
| Screenshot / PNG | get_screenshot | fetch_node_png | — |
| Search frames | — | — | search |

## REST API commands

\`\`\`
# Fetch + simplify (structure only — no prototype interactions)
bash ${SCRIPTS_DIR}/figma-api.sh fetch_node_json <file_key> <node_id> | node ${SCRIPTS_DIR}/simplify-node.mjs > /tmp/simplified.json

# Fetch WITH prototype interactions (full-file endpoint, may be slow)
bash ${SCRIPTS_DIR}/figma-api.sh fetch_prototype_data <file_key> <node_id> > /tmp/simplified.json

# Fetch PNG
bash ${SCRIPTS_DIR}/figma-api.sh fetch_node_png <file_key> <node_id> <output_path>
\`\`\`

Then save:
\`\`\`
figma-differ save:
  file_key       ← same file_key used above
  node_id        ← same node_id used above
  name           ← .name from simplified.json  ← NEVER a URL slug or node-id placeholder
  node_type      ← .type from simplified.json
  node_json_path ← "/tmp/simplified.json"  ← preferred for large nodes (>500KB)
  metadata:
    description  ← one-line summary from name + type
    components   ← COMPONENT/INSTANCE nodes from simplified JSON
    text_content ← .characters from all TEXT nodes recursively
\`\`\`

## Auto-save: Figma MCP → figma-differ

After get_design_context or get_metadata: ALWAYS call figma-differ save.
After get_variable_defs: pass result as variables_json — stored as variables.json, surfaced as Design Tokens in frame.md.

TIP — children without heavy payloads: get_metadata(fileKey, nodeId) returns sparse XML (IDs + names only). Parse child node-ids, then fetch each with get_design_context individually — avoids downloading the full parent JSON (15MB+).

CRITICAL — name field: ALWAYS extract the real node name. NEVER use a URL slug, node-id, or placeholder.

### Field mapping from get_design_context

\`\`\`
figma-differ save:
  file_key    ← fileKey from URL
  node_id     ← nodeId from URL (e.g., "1431:33250")
  name        ← real node name from response
  page        ← page name from get_metadata or context
  node_type   ← "FRAME", "COMPONENT", "SECTION", etc.
  node_json   ← full JSON body (stringified) if <500KB; else use node_json_path
  metadata:
    description  ← one-line summary of what the screen shows
    components   ← component names from the code (e.g., ["Button", "Input"])
    text_content ← visible text strings (e.g., ["Sign In", "Email"])
\`\`\`

### Field mapping from get_metadata

\`\`\`
  name       ← root node's name attribute
  node_type  ← root node's type attribute
  page       ← parent CANVAS node name
\`\`\`

## Typical patterns

- "Find the settings screen" → figma-differ search (Mode 1)
- "What does this screen look like?" → check_auth → get_design_context → figma-differ save
- "Implement this screen" → Mode 1 check → Mode 2/3 fetch → save → implement
- "What changed in the login flow?" → figma-differ get_flows + search
- "Which screens use Modal?" → figma-differ search "Modal component"`,
})

// Tool: check_auth
server.tool(
  'check_auth',
  'Check which Figma data modes are available: REST API token status, local cache size, and QMD search availability. Call this at session start to know whether to use Figma MCP, REST API, or offline cache only.',
  {},
  async () => {
    const restAvailable = (() => {
      try {
        execSync(`bash "${SCRIPTS_DIR}/auth.sh" status`, { encoding: 'utf8', stdio: 'pipe' })
        return true
      } catch { return false }
    })()

    const qmdAvailable = (() => {
      try {
        execSync('which qmd', { encoding: 'utf8', stdio: 'pipe' })
        return true
      } catch { return false }
    })()

    const cachedFrames = (() => {
      try {
        return findFileKeys().reduce((sum, key) => {
          const idx = readIndex(key)
          return sum + (idx?.frames?.length || 0)
        }, 0)
      } catch { return 0 }
    })()

    const lines = [
      '## figma-differ Mode Status',
      '',
      `**REST API:** ${restAvailable ? `available (FIGMA_TOKEN set)` : `unavailable — run: bash ${SCRIPTS_DIR}/auth.sh set`}`,
      `**Figma MCP:** unknown at server start — try get_design_context; if it errors, MCP plugin is not connected`,
      `**Offline cache:** ${cachedFrames} frames indexed locally`,
      `**QMD search:** ${qmdAvailable ? 'available' : 'unavailable — install: brew install qmd'}`,
      '',
      cachedFrames > 0
        ? `Recommendation: check figma-differ search/get_frame first — ${cachedFrames} frames already cached.`
        : 'No local cache yet. Fetch from Figma MCP or REST API, then save to build the index.',
    ]

    return { content: [{ type: 'text', text: lines.join('\n') }] }
  }
)

// Tool: search
server.tool(
  'search',
  'Search Figma frames by content, components, layout, colors, flows, or natural language description. Returns ranked results with Figma URLs.',
  {
    query: z.string().describe('Search query — e.g., "dark mode settings", "login screen", "dropdown form", "leads to Account"'),
    limit: z.number().optional().default(5).describe('Max results (default 5)'),
  },
  async ({ query, limit }) => {
    const results = qmdSearch(query, limit)
    if (!results) {
      return { content: [{ type: 'text', text: 'QMD not available. Install: brew install qmd' }] }
    }

    // If JSON parse succeeded, format nicely
    if (Array.isArray(results)) {
      const formatted = results.map((r, i) => {
        const score = r.score != null ? `${Math.round(r.score * 100)}%` : '?'
        return `${i + 1}. [${score}] ${r.title || r.path || 'Unknown'}\n   ${r.snippet || ''}`
      }).join('\n\n')
      return { content: [{ type: 'text', text: formatted || 'No results found.' }] }
    }

    // Plain text fallback
    return { content: [{ type: 'text', text: String(results) || 'No results found.' }] }
  }
)

// Tool: get_frame
server.tool(
  'get_frame',
  'Get full details of a Figma frame — metadata, description, colors, buttons, form fields, layout, flows, components, text content, and hierarchy.',
  {
    node_id: z.string().describe('Figma node ID (e.g., "1431:33250" or "1431_33250")'),
    file_key: z.string().optional().describe('Figma file key. If omitted, searches all tracked files.'),
    summary: z.boolean().optional().describe('When true, return a compact summary instead of the full frame markdown.'),
  },
  async ({ node_id, file_key, summary }) => {
    try {
    const normalizedId = node_id.replace(/_/g, ':')

    const fileKeys = file_key ? [file_key] : findFileKeys()
    for (const fk of fileKeys) {
      const md = findFrameMd(fk, normalizedId)
      if (md) {
        const text = summary ? summarizeFrameMd(md) : md

        // Check for thin content — nudge agent to enrich via Figma MCP bridge
        const fm = parseFrontmatter(md)
        const nodeCount = parseInt(fm.node_count || '0', 10)
        const desc = fm.description || ''
        const isThin = nodeCount <= 1 || desc.length < MIN_DESCRIPTION_LENGTH || desc === 'screen' || /^(light|dark) mode screen$/.test(desc)
        const alreadySnapshotted = hasNodeJsonSnapshot(fk, normalizedId)

        if (isThin && !alreadySnapshotted) {
          const fileKey = fm.figma_file || ''
          const nodeId = fm.figma_node || ''
          const enrichmentHint = generateFrameEnrichmentHint(fileKey, nodeId, nodeCount)
          return { content: [{ type: 'text', text: text + enrichmentHint }] }
        }

        return {
          content: [{
            type: 'text',
            text,
          }],
        }
      }
    }

    return { content: [{ type: 'text', text: generateFrameNotFoundGuide(node_id, SCRIPTS_DIR) }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `get_frame error: ${e.message}` }] }
    }
  }
)

// Tool: get_flows
server.tool(
  'get_flows',
  'Get screen flow connections — which screens link to which via connector lines and prototype interactions. Shows the user journey graph.',
  {
    node_id: z.string().optional().describe('Figma node ID to get flows for a specific frame. Omit to get all flows.'),
    file_key: z.string().optional().describe('Figma file key. If omitted, searches all tracked files.'),
  },
  async ({ node_id, file_key }) => {
    try {
    // Check snapshot-level flows.json for this specific node
    if (node_id) {
      const nodeIdSafe = node_id.replace(/:/g, '_')
      const nodeDir = join(BASE_DIR, file_key || '', nodeIdSafe)
      if (existsSync(nodeDir)) {
        const snapshotDirs = readdirSync(nodeDir)
          .filter(d => /^\d{8}T\d{6}Z$/.test(d))
          .sort()
          .reverse()
        for (const snapDir of snapshotDirs) {
          const snapshotFlowsPath = join(nodeDir, snapDir, 'flows.json')
          if (existsSync(snapshotFlowsPath)) {
            const snapshotFlows = JSON.parse(readFileSync(snapshotFlowsPath, 'utf8'))
            if (snapshotFlows.interactions?.length) {
              // Build ID → name map from index.json — try explicit file_key first, then any local key
              const idToName = {}
              const indexKey = file_key || findFileKeys()[0]
              if (indexKey) {
                const indexPath = join(BASE_DIR, indexKey, 'index.json')
                if (existsSync(indexPath)) {
                  const idx = JSON.parse(readFileSync(indexPath, 'utf8'))
                  for (const f of idx.frames || []) idToName[f.id] = f.name
                }
              }
              const resolveName = id => idToName[id] || id
              const resolveEndpoint = ep => {
                if (ep && typeof ep === 'object') return ep.name || idToName[ep.id] || ep.id
                return resolveName(ep)
              }
              const snapshotNodeId = snapshotFlows.nodeId
              const interactions = (snapshotFlows.interactions || []).filter(i => {
                if (i.type === 'connector') {
                  const fId = typeof i.from === 'object' ? i.from?.id : i.from
                  const tId = typeof i.to === 'object' ? i.to?.id : i.to
                  return fId && tId && fId !== tId
                }
                // prototype self-loop: destination resolves back to the snapshot frame itself
                return i.destinationId !== snapshotNodeId
              })
              const lines = interactions.map(i => i.type === 'connector'
                ? `connector: ${resolveEndpoint(i.from)} → ${resolveEndpoint(i.to)}`
                : `[${i.trigger}] ${i.triggerNode?.name || resolveName(i.triggerNode?.id)} → ${resolveName(i.destinationId)}`)
              const rawIdPattern = /^\d+:\d+$/
              const unresolvedCount = lines.filter(l => rawIdPattern.test(l.split('→').pop()?.trim())).length
              const hint = unresolvedCount > 0
                ? `\n\n(${unresolvedCount} endpoint(s) show raw IDs — these reference frames outside the saved subtree. Run /figma-differ:track to build a full file index for complete name resolution.)`
                : ''
              return { content: [{ type: 'text', text: `Flows for ${node_id} (from snapshot ${snapDir}):\n\n${lines.join('\n')}${hint}` }] }
            }
            break
          }
        }
      }
    }

    const fileKeys = file_key ? [file_key] : findFileKeys()

    for (const fk of fileKeys) {
      const flowsData = readFlows(fk)
      if (!flowsData) continue

      if (node_id) {
        const normalizedId = node_id.replace(/_/g, ':')
        const frameFlows = flowsData.frameFlows?.[normalizedId]
        if (!frameFlows) continue

        const incoming = filterNonSelfLoops(frameFlows.incoming || [])
          .map(f => `← ${f.from.name} (${f.type})`)
        const outgoing = filterNonSelfLoops(frameFlows.outgoing || [])
          .map(f => `→ ${f.to.name} (${f.type})`)

        const lines = []
        if (incoming.length) lines.push('Incoming:', ...incoming.map(s => `  ${s}`))
        if (outgoing.length) lines.push('Outgoing:', ...outgoing.map(s => `  ${s}`))
        if (!lines.length) lines.push('No flow connections for this frame.')

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      // All flows
      const filteredFlows = filterNonSelfLoops(flowsData.flows || [])
      const filteredConnectorFlows = filteredFlows.filter(f => f.type === 'connector').length
      const filteredPrototypeFlows = filteredFlows.filter(f => f.type === 'prototype').length
      const lines = [
        `File: ${fk}`,
        `Total flows: ${filteredFlows.length}`,
        `Connector lines: ${filteredConnectorFlows}`,
        `Prototype links: ${filteredPrototypeFlows}`,
        '',
        'Flows:',
      ]
      for (const f of filteredFlows) {
        const arrow = f.type === 'prototype' ? `→ (${f.trigger || 'interaction'})` : '→'
        lines.push(`  ${f.from.name} ${arrow} ${f.to.name}`)
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }

    return { content: [{ type: 'text', text: 'No flow data found. Run /figma-differ:track or /figma-differ:sync first.' }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `get_flows error: ${e.message}` }] }
    }
  }
)

// Tool: list_frames
server.tool(
  'list_frames',
  'List all indexed Figma frames with name, page, type, and node count. Use to browse available frames before searching.',
  {
    file_key: z.string().optional().describe('Figma file key. If omitted, lists frames from all tracked files.'),
    page: z.string().optional().describe('Filter by page name (case-insensitive partial match).'),
  },
  async ({ file_key, page }) => {
    try {
    const fileKeys = file_key ? [file_key] : findFileKeys()
    const results = []

    for (const fk of fileKeys) {
      const index = readIndex(fk)
      if (!index) continue

      let frames = index.frames || []
      if (page) {
        const lower = page.toLowerCase()
        frames = frames.filter(f => (f.page || '').toLowerCase().includes(lower))
      }

      results.push(`File: ${index.fileName || fk} (${fk})`)
      results.push(`Frames: ${frames.length}`)
      results.push('')
      for (const f of frames.slice(0, 50)) {
        results.push(`  ${f.name} [${f.type}] — page: ${f.page || '?'} — ${f.id}`)
      }
      if (frames.length > 50) {
        results.push(`  ... and ${frames.length - 50} more`)
      }
    }

    if (!results.length) {
      return { content: [{ type: 'text', text: 'No indexed files found. Run /figma-differ:track first.' }] }
    }

    return { content: [{ type: 'text', text: results.join('\n') }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `list_frames error: ${e.message}` }] }
    }
  }
)

function writeNodeSnapshot({ snapshotDir, nodeJsonPath, node_json, node_id, variables_json }) {
  mkdirSync(snapshotDir, { recursive: true })
  if (node_json) {
    writeFileSync(nodeJsonPath, node_json, 'utf8')
    // Extract node-level flows into snapshot (best-effort)
    try {
      execSyncRaw(
        `node "${SCRIPTS_DIR}/extract-flows.js" --node "${node_id}" --output "${join(snapshotDir, 'flows.json')}" "${nodeJsonPath}"`,
        { encoding: 'utf8', timeout: FLOWS_EXTRACTION_TIMEOUT_MS, stdio: 'pipe' }
      )
    } catch { /* flows extraction is non-critical */ }
  }
  if (variables_json) {
    writeFileSync(join(snapshotDir, 'variables.json'), variables_json, 'utf8')
  }
}

function updateFrameIndex({ fileDir, file_key, node_id, name, node_type, page, timestamp, sharedIndex }) {
  const indexPath = join(fileDir, 'index.json')
  const index = sharedIndex || (existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { fileKey: file_key, fileName: '', lastIndexed: timestamp, frames: [] })
  const existing = index.frames.findIndex(f => f.id === node_id)
  const entry = { id: node_id, name, type: node_type || 'FRAME', page: page || '' }
  if (existing >= 0) index.frames[existing] = entry
  else index.frames.push(entry)
  index.lastIndexed = timestamp
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8')
  return { index }
}

function buildFrameMd({ file_key, node_id, name, page, node_type, metadata, index, timestamp, frameDir }) {
  const slug = (index.fileName || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  const figmaUrl = `https://www.figma.com/design/${file_key}/${slug}?node-id=${node_id.replace(/:/g, '-')}`

  const descParts = [node_type?.toLowerCase() || 'frame']
  if (metadata?.components?.length) descParts.push(`with ${metadata.components.slice(0, 5).join(', ')}`)
  if (metadata?.description) descParts.push(metadata.description)

  const mdLines = [
    '---',
    `title: "${name.replace(/"/g, '\\"')}"`,
    `description: "${descParts.join('; ').replace(/"/g, '\\"')}"`,
    `figma_file: "${file_key}"`,
    `figma_file_name: "${(index.fileName || '').replace(/"/g, '\\"')}"`,
    `figma_node: "${node_id}"`,
    `figma_page: "${(page || '').replace(/"/g, '\\"')}"`,
    `figma_type: "${node_type || 'FRAME'}"`,
    `figma_url: "${figmaUrl}"`,
    `snapshot_timestamp: "${timestamp}"`,
    `source: "figma-mcp"`,
    '---', '',
    `# ${name}`, '',
    `> ${descParts.join('; ')}`, '',
    `Page: ${page || 'Unknown'} | Type: ${node_type || 'FRAME'}`, '',
  ]
  if (metadata?.components?.length) {
    mdLines.push('## Components Used')
    for (const c of metadata.components) mdLines.push(`- ${c}`)
    mdLines.push('')
  }
  if (metadata?.text_content?.length) {
    mdLines.push('## Text Content')
    for (const t of metadata.text_content.slice(0, 50)) mdLines.push(`- "${t}"`)
    mdLines.push('')
  }
  writeFileSync(join(frameDir, 'frame.md'), mdLines.join('\n'), 'utf8')
}

function persistNode({ file_key, node_id, name, page, node_type, node_json, metadata, index: sharedIndex, variables_json }) {
  const nodeIdSafe = node_id.replace(/:/g, '_')
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').replace('T', 'T').slice(0, 15) + 'Z'
  const fileDir = join(BASE_DIR, file_key)
  const frameDir = join(fileDir, nodeIdSafe)
  const snapshotDir = join(frameDir, timestamp)
  const nodeJsonPath = join(snapshotDir, 'node.json')

  writeNodeSnapshot({ snapshotDir, nodeJsonPath, node_json, node_id, variables_json })
  const { index } = updateFrameIndex({ fileDir, file_key, node_id, name, node_type, page, timestamp, sharedIndex })
  buildFrameMd({ file_key, node_id, name, page, node_type, metadata, index, timestamp, frameDir })

  return { snapshotDir, index }
}

function tryEnrichFrameMarkdown(file_key, node_id) {
  try {
    execSyncRaw(
      `node "${SCRIPTS_DIR}/generate-frame-md.js" "${file_key}" "${node_id}"`,
      { encoding: 'utf8', timeout: QMD_UPDATE_TIMEOUT_MS, stdio: 'pipe' }
    )
  } catch { /* non-critical: full frame.md extraction */ }
}

function saveChildren({ file_key, page, node_json, child_types, sharedIndex }) {
  const allowedTypes = new Set(child_types?.length ? child_types : ['SECTION', 'FRAME', 'COMPONENT'])
  let parsed
  try { parsed = JSON.parse(node_json) } catch { return { saved: [], error: 'invalid JSON' } }
  const docRoot = parsed.nodes ? (Object.values(parsed.nodes)[0]?.document || Object.values(parsed.nodes)[0]) : (parsed.document || parsed)
  const children = (docRoot?.children || []).filter(c => allowedTypes.has(c.type))
  const saved = []
  for (const child of children) {
    try {
      persistNode({ file_key, node_id: child.id, name: child.name, page, node_type: child.type, node_json: JSON.stringify(child), index: sharedIndex })
      tryEnrichFrameMarkdown(file_key, child.id)
      saved.push(`  → ${child.name} (${child.id})`)
    } catch (childErr) {
      saved.push(`  ✗ ${child.name} (${child.id}): ${childErr.message}`)
    }
  }
  return { saved, count: children.length }
}

// Tool: save
server.tool(
  'save',
  `Save a Figma node to the local figma-differ database for search and diffing.
Call this after fetching a design via Figma MCP (get_design_context) to cache it locally.
Accepts any Figma node — frames, components, sections, groups, pages.
The node is stored as a snapshot and indexed for semantic search.`,
  {
    file_key: z.string().describe('Figma file key'),
    node_id: z.string().describe('Figma node ID (e.g., "1431:33250")'),
    name: z.string().describe('Human-readable name for the node'),
    page: z.string().optional().describe('Page name the node belongs to'),
    node_type: z.string().optional().default('FRAME').describe('Node type: FRAME, COMPONENT, SECTION, etc.'),
    node_json: z.string().optional().describe('Full node JSON from Figma API (stringified). Use for small payloads. For large nodes (>500KB) use node_json_path instead.'),
    node_json_path: z.string().optional().describe('Path to a file containing the node JSON. Preferred over node_json for large nodes (e.g. /tmp/simplified.json). node_json takes precedence if both are provided.'),
    metadata: z.object({
      description: z.string().optional(),
      components: z.array(z.string()).optional(),
      text_content: z.array(z.string()).optional(),
    }).optional().describe('Optional metadata to enrich the frame.md for search'),
    save_children: z.boolean().optional().default(false).describe('When true, also save direct children of the node that match child_types as separate entries.'),
    child_types: z.array(z.string()).optional().describe('Node types to save as children when save_children is true. Defaults to ["SECTION", "FRAME", "COMPONENT"].'),
    variables_json: z.string().optional().describe('JSON string from get_variable_defs — design tokens (colors, spacing, typography) for this node. Stored as variables.json and surfaced in frame.md as Design Tokens section.'),
  },
  async ({ file_key, node_id, name, page, node_type, node_json, node_json_path, metadata, save_children, child_types, variables_json }) => {
    if (!node_json && node_json_path) {
      node_json = readFileSync(node_json_path, 'utf8')
    }
    try {
      const { snapshotDir, index } = persistNode({ file_key, node_id, name, page, node_type, node_json, metadata, variables_json })
      tryEnrichFrameMarkdown(file_key, node_id)

      // Try to update QMD index (best-effort)
      try {
        execSyncRaw('qmd update 2>/dev/null && qmd embed 2>/dev/null', { encoding: 'utf8', timeout: QMD_UPDATE_TIMEOUT_MS, stdio: 'pipe' })
      } catch { /* QMD not available */ }

      if (!save_children || !node_json) {
        return { content: [{ type: 'text', text: `Saved: ${name} (${node_id}) to figma-differ\n  Type: ${node_type || 'FRAME'}\n  Page: ${page || 'Unknown'}\n  Snapshot: ${snapshotDir}\n  Searchable: yes (frame.md indexed)\n\nThis node is now searchable via figma-differ search.` }] }
      }

      const { saved, count, error } = saveChildren({ file_key, page, node_json, child_types, sharedIndex: index })
      if (error) return { content: [{ type: 'text', text: `Saved: ${name} (${node_id}) — save_children skipped: ${error}` }] }
      return { content: [{ type: 'text', text: `Saved: ${name} (${node_id}) + ${count} children\n${saved.join('\n')}\n\nAll entries are searchable via figma-differ search.` }] }
    } catch (e) {
      return { content: [{ type: 'text', text: `Failed to save: ${e.message}` }] }
    }
  }
)

// ── Start ───────────────────────────────────────────────────────────────────

try {
  const transport = new StdioServerTransport()
  await server.connect(transport)
} catch (e) {
  process.stderr.write(`[figma-differ] failed to start: ${e.message}\n`)
  process.exit(1)
}
