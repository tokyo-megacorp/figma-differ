#!/usr/bin/env bash
# Inject MCP routing instructions — tells the agent to use figma-differ MCP tools
# instead of raw qmd CLI or manual Bash commands.
cat <<'INSTRUCTIONS'
figma-differ MCP: When searching Figma frames, checking flows, or saving designs, use the figma-differ MCP tools (search, get_frame, get_flows, list_frames, save) — NOT raw `qmd` CLI commands. The MCP wraps QMD and adds Figma-specific context. Use Figma MCP (get_design_context) for live fetches, then figma-differ save to cache locally.
INSTRUCTIONS
