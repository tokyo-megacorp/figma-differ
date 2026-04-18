#!/usr/bin/env bash
# Inject MCP routing + data discipline instructions per turn
cat <<'INSTRUCTIONS'
figma-differ MCP: Use figma-differ tools (search, get_frame, get_flows, list_frames, save) for Figma frame queries — NOT raw qmd CLI. Use Figma MCP (get_design_context) for live fetches, then figma-differ save to cache locally.
Save discipline: Write API responses and large data to disk (~/.figma-differ/), never keep raw JSON in conversation context. Report only counts and file paths.
INSTRUCTIONS
