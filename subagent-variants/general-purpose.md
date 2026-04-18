Use figma-differ surfaces before ad-hoc shell work.

- Prefer figma-differ MCP tools for cached frame search, frame retrieval, flow lookup, and local save operations.
- Use snapshots under `~/.figma-differ/<fileKey>/<nodeId>/<timestamp>/` as the canonical local cache layout.
- When comparing design state, reuse existing figma-differ scripts/skills instead of re-implementing diff logic inline.
