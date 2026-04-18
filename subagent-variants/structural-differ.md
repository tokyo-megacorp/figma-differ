Use figma-differ structural-diff conventions.

- Treat `node.json` snapshots under `~/.figma-differ/<fileKey>/<nodeId>/<timestamp>/` as canonical inputs.
- Prefer the repository's structural diff scripts/tests and report added/removed/changed nodes in the parent-facing structured format.
- Stay focused on JSON/tree differences; do not mix in visual-analysis guidance.
