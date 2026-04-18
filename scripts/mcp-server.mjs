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
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'
import { execSync as execSyncRaw } from 'child_process'

const BASE_DIR = join(homedir(), '.figma-differ')

// ── Helpers ─────────────────────────────────────────────────────────────────

function findFileKeys() {
  if (!existsSync(BASE_DIR)) return []
  return readdirSync(BASE_DIR)
    .filter(d => {
      const p = join(BASE_DIR, d)
      return statSync(p).isDirectory() && existsSync(join(p, 'index.json'))
    })
}

function readIndex(fileKey) {
  const p = join(BASE_DIR, fileKey, 'index.json')
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8'))
}

function readFlows(fileKey) {
  const p = join(BASE_DIR, fileKey, 'flows.json')
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8'))
}

function findFrameMd(fileKey, nodeId) {
  const safe = nodeId.replace(/:/g, '_')
  const p = join(BASE_DIR, fileKey, safe, 'frame.md')
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8')
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

function qmdSearch(query, limit = 10) {
  try {
    const out = execSync(
      `qmd search -n ${limit} -c figma --json "${query.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    return JSON.parse(out)
  } catch (e) {
    // Fallback: try without --json
    try {
      const out = execSync(
        `qmd search -n ${limit} -c figma "${query.replace(/"/g, '\\"')}"`,
        { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
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
  version: '0.2.0',
  instructions: `figma-differ is a local Figma design database with semantic search, change tracking, and flow detection.

## When to use figma-differ vs Figma MCP

| Task | Tool |
|------|------|
| Fetch LIVE state of a design | Figma MCP: get_design_context |
| SEARCH across all indexed frames | figma-differ: search |
| Check FLOWS between screens | figma-differ: get_flows |
| Get cached frame details (no API call) | figma-differ: get_frame |
| Save a fetched design locally | figma-differ: save |
| Read design tokens / variables | Figma MCP: get_variable_defs |
| Browse all frames in a file | figma-differ: list_frames |

## Auto-save: Figma MCP → figma-differ

IMPORTANT: After calling Figma MCP's get_design_context or get_metadata, ALWAYS call figma-differ save to cache the result locally. This makes the design searchable and diffable.

### Field mapping from get_design_context response:

The get_design_context response contains code (React+Tailwind reference), a screenshot, and metadata. Extract these fields for the save call:

\`\`\`
figma-differ save:
  file_key    ← fileKey from the Figma URL
  node_id     ← nodeId from the Figma URL (e.g., "1431:33250")
  name        ← the node/frame name from the response or URL slug
  page        ← page name if known (from get_metadata or context)
  node_type   ← "FRAME", "COMPONENT", "SECTION", etc.
  node_json   ← full JSON response body (stringified) if available
  metadata:
    description  ← one-line summary of what the screen shows (write this yourself from the screenshot/code)
    components   ← component names visible in the code (e.g., ["Button", "Input", "Modal"])
    text_content ← visible text strings from the code (e.g., ["Sign In", "Email", "Password"])
\`\`\`

### Field mapping from get_metadata response:

get_metadata returns XML with node structure. Extract:
\`\`\`
  name       ← from the root node's name attribute
  node_type  ← from the root node's type attribute
  page       ← from the parent CANVAS node name
\`\`\`

### Example flow:

1. User says "implement this Figma screen" with a URL
2. Parse fileKey and nodeId from URL
3. Call Figma MCP get_design_context(fileKey, nodeId)
4. From the response, extract component names and text content
5. Call figma-differ save(file_key, node_id, name, metadata)
6. The screen is now in the local database — searchable, diffable, trackable
7. Proceed with implementation using the design context

## Typical patterns

- "Find the settings screen" → figma-differ search
- "What does this screen look like now?" → Figma MCP get_design_context → figma-differ save
- "What changed in the login flow?" → figma-differ get_flows + search
- "Implement this Figma screen" → Figma MCP get_design_context → figma-differ save → implement
- "Which screens use the Modal component?" → figma-differ search "Modal component"
- "Save this design locally" → Figma MCP get_design_context → figma-differ save`,
})

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
  },
  async ({ node_id, file_key }) => {
    const normalizedId = node_id.replace(/_/g, ':')
    const safeId = node_id.replace(/:/g, '_')

    const fileKeys = file_key ? [file_key] : findFileKeys()
    for (const fk of fileKeys) {
      const md = findFrameMd(fk, normalizedId)
      if (md) {
        const fm = parseFrontmatter(md)
        return {
          content: [{
            type: 'text',
            text: md,
          }],
        }
      }
    }

    return { content: [{ type: 'text', text: `Frame ${node_id} not found.` }] }
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
    const fileKeys = file_key ? [file_key] : findFileKeys()

    for (const fk of fileKeys) {
      const flowsData = readFlows(fk)
      if (!flowsData) continue

      if (node_id) {
        const normalizedId = node_id.replace(/_/g, ':')
        const frameFlows = flowsData.frameFlows?.[normalizedId]
        if (!frameFlows) continue

        const incoming = (frameFlows.incoming || [])
          .filter(f => f.from.id !== f.to.id)
          .map(f => `← ${f.from.name} (${f.type})`)
        const outgoing = (frameFlows.outgoing || [])
          .filter(f => f.from.id !== f.to.id)
          .map(f => `→ ${f.to.name} (${f.type})`)

        const lines = []
        if (incoming.length) lines.push('Incoming:', ...incoming.map(s => `  ${s}`))
        if (outgoing.length) lines.push('Outgoing:', ...outgoing.map(s => `  ${s}`))
        if (!lines.length) lines.push('No flow connections for this frame.')

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      // All flows
      const lines = [
        `File: ${fk}`,
        `Total flows: ${flowsData.totalFlows}`,
        `Connector lines: ${flowsData.connectorFlows}`,
        `Prototype links: ${flowsData.prototypeFlows}`,
        '',
        'Flows:',
      ]
      for (const f of flowsData.flows) {
        if (f.from.id === f.to.id) continue
        const arrow = f.type === 'prototype' ? `→ (${f.trigger || 'interaction'})` : '→'
        lines.push(`  ${f.from.name} ${arrow} ${f.to.name}`)
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] }
    }

    return { content: [{ type: 'text', text: 'No flow data found. Run /figma-differ:track or /figma-differ:sync first.' }] }
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
  }
)

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
    node_json: z.string().optional().describe('Full node JSON from Figma API (stringified). If provided, stored as snapshot.'),
    metadata: z.object({
      description: z.string().optional(),
      components: z.array(z.string()).optional(),
      text_content: z.array(z.string()).optional(),
    }).optional().describe('Optional metadata to enrich the frame.md for search'),
  },
  async ({ file_key, node_id, name, page, node_type, node_json, metadata }) => {
    const nodeIdSafe = node_id.replace(/:/g, '_')
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '').replace('T', 'T').slice(0, 15) + 'Z'
    const fileDir = join(BASE_DIR, file_key)
    const frameDir = join(fileDir, nodeIdSafe)
    const snapshotDir = join(frameDir, timestamp)

    try {
      // Create directories
      mkdirSync(snapshotDir, { recursive: true })

      // Save node JSON if provided
      if (node_json) {
        writeFileSync(join(snapshotDir, 'node.json'), node_json, 'utf8')
      }

      // Update or create index.json
      const indexPath = join(fileDir, 'index.json')
      let index = { fileKey: file_key, fileName: '', lastIndexed: timestamp, frames: [] }
      if (existsSync(indexPath)) {
        index = JSON.parse(readFileSync(indexPath, 'utf8'))
      }

      // Add or update this frame in the index
      const existing = index.frames.findIndex(f => f.id === node_id)
      const entry = { id: node_id, name, type: node_type || 'FRAME', page: page || '' }
      if (existing >= 0) {
        index.frames[existing] = entry
      } else {
        index.frames.push(entry)
      }
      index.lastIndexed = timestamp
      writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8')

      // Generate frame.md for search indexing
      const slug = (index.fileName || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
      const figmaUrl = `https://www.figma.com/design/${file_key}/${slug}?node-id=${node_id.replace(/:/g, '-')}`

      const mdLines = [
        '---',
        `title: "${name.replace(/"/g, '\\"')}"`,
      ]

      // Build description from metadata or name
      const descParts = [node_type?.toLowerCase() || 'frame']
      if (metadata?.components?.length) descParts.push(`with ${metadata.components.slice(0, 5).join(', ')}`)
      if (metadata?.description) descParts.push(metadata.description)
      mdLines.push(`description: "${descParts.join('; ').replace(/"/g, '\\"')}"`)

      mdLines.push(
        `figma_file: "${file_key}"`,
        `figma_file_name: "${(index.fileName || '').replace(/"/g, '\\"')}"`,
        `figma_node: "${node_id}"`,
        `figma_page: "${(page || '').replace(/"/g, '\\"')}"`,
        `figma_type: "${node_type || 'FRAME'}"`,
        `figma_url: "${figmaUrl}"`,
        `snapshot_timestamp: "${timestamp}"`,
        `source: "figma-mcp"`,
        '---',
        '',
        `# ${name}`,
        '',
        `> ${descParts.join('; ')}`,
        '',
        `Page: ${page || 'Unknown'} | Type: ${node_type || 'FRAME'}`,
        '',
      )

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

      // Try to update QMD index (best-effort)
      try {
        execSyncRaw('qmd update 2>/dev/null && qmd embed 2>/dev/null', {
          encoding: 'utf8', timeout: 30000, stdio: 'pipe'
        })
      } catch { /* QMD not available, that's fine */ }

      return {
        content: [{
          type: 'text',
          text: `Saved: ${name} (${node_id}) to figma-differ\n  Type: ${node_type || 'FRAME'}\n  Page: ${page || 'Unknown'}\n  Snapshot: ${snapshotDir}\n  Searchable: yes (frame.md indexed)\n\nThis node is now searchable via figma-differ search.`
        }]
      }
    } catch (e) {
      return { content: [{ type: 'text', text: `Failed to save: ${e.message}` }] }
    }
  }
)

// ── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
