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
import { readFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

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
  version: '0.1.0',
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

// ── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
