#!/usr/bin/env bash
# Inject MCP routing + data discipline instructions per turn
cat <<'INSTRUCTIONS'
figma-differ routing rules (apply to every Figma operation this turn):

1. LOCAL FIRST — Before any Figma API call, query figma-differ (search / get_frame / get_flows). If the frame is already indexed, no network call needed. Only go online when the local result is missing or explicitly stale.

2. MODE FALLBACK — Try in order:
   a. Figma MCP (get_design_context / get_metadata / get_variable_defs) — richest data; if tool is unavailable or errors → go to (b)
   b. REST API (bash figma-api.sh fetch_node_json | simplify-node.mjs) — requires FIGMA_TOKEN; if token not set → go to (c)
   c. Offline cache only (figma-differ get_frame / search) — inform user data may be stale

3. AUTO-SAVE — After EVERY successful Figma MCP or REST fetch, call figma-differ save. Never leave fetched data un-cached.

4. PROTOTYPE INTERACTIONS — Always use REST (fetch_prototype_data). Figma MCP does not provide prototype interactions.

5. DATA DISCIPLINE — Write API responses to disk (~/.figma-differ/), never keep raw JSON in context. Report only counts and file paths.
INSTRUCTIONS
