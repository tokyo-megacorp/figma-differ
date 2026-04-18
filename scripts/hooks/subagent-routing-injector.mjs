#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SENTINEL = '<!-- figma-differ-routing-injected -->'
const PROMPT_FIELDS = ['prompt', 'request', 'objective', 'question', 'query', 'task']
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const VARIANT_DIR = path.join(REPO_ROOT, 'subagent-variants')
const VARIANT_MAP = new Map([
  ['structural-differ', 'structural-differ.md'],
  ['vision-analyzer', 'vision-analyzer.md'],
])

function readVariant(subagentType) {
  const normalizedType = (subagentType || '').split(':').pop()
  const filename = VARIANT_MAP.get(normalizedType) || 'general-purpose.md'
  const variantPath = path.join(VARIANT_DIR, filename)
  return fs.readFileSync(variantPath, 'utf8').trim()
}

function buildPrompt(variantText, originalPrompt) {
  if (originalPrompt.includes(SENTINEL)) return originalPrompt
  return `${SENTINEL}\n${variantText}\n\n${originalPrompt}`
}

function main() {
  const raw = fs.readFileSync(0, 'utf8')
  const payload = JSON.parse(raw)
  if (payload.tool_name !== 'Agent') return

  const toolInput = payload.tool_input || {}
  const promptField = PROMPT_FIELDS.find((field) => typeof toolInput[field] === 'string')
  if (!promptField) return

  const variantText = readVariant(toolInput.subagent_type)
  const updatedPrompt = buildPrompt(variantText, toolInput[promptField])

  const response = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Injected figma-differ routing for subagent',
      updatedInput: {
        ...toolInput,
        [promptField]: updatedPrompt,
      },
    },
  }

  process.stdout.write(JSON.stringify(response))
}

try {
  main()
} catch {
  process.exit(0)
}
