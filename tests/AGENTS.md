# tests/ — Test Suite

Mixed bash + JavaScript test suite. CI contract: all tests pass on main.

## Running Tests

```bash
bash tests/benchmark.sh              # performance benchmark
bash tests/hooks.test.sh             # hook lifecycle
node tests/mcp-server.test.js        # MCP server integration
```

## Test Inventory

| File | Type | Covers |
|---|---|---|
| `benchmark.sh` | bash | Performance baseline |
| `benchmark.test.sh` | bash | Benchmark assertions |
| `bulk-diff.test.js` | JS | Bulk diff flow |
| `compile-review.test.sh` | bash | Review compilation |
| `dashboard.spec.js` | JS | Dashboard rendering |
| `diff-all.test.sh` | bash | `/figma-differ:diff-all` flow |
| `enrich-thin-frames.test.sh` | bash | Frame enrichment |
| `extract-flows.test.js` | JS | Flow extraction from node tree |
| `figma-api.test.sh` | bash | Figma API contract |
| `generate-frame-md.test.js` | JS | Frame markdown generation |
| `get-frame-summary-contract.test.js` | JS | Frame summary contract |
| `hooks.test.sh` | bash | Hook execution |
| `mcp-get-flows-contract.test.js` | JS | MCP flows contract |
| `mcp-server.test.js` | JS | MCP server end-to-end |
| `property.test.js` | JS | Property diff assertions |
| `render-review.test.js` | JS | Review render output |
| `review-payload.test.js` | JS | Review payload structure |
| `stress.test.js` | JS | Stress / load |
| `structural-diff.test.js` | JS | Structural diff logic |

## Test Contract

- Bash tests: exit 0 on pass, non-zero on fail
- JS tests: standard node test runner assertions
- `helpers/` subdir: shared test utilities (not tests themselves)
