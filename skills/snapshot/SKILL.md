---
name: figma-differ snapshot
description: >
  Takes a snapshot of a Figma node — fetches its JSON structure and PNG screenshot
  and stores both to ~/.figma-differ/ for later diffing. Use when the user runs
  /figma-differ:snapshot with a Figma URL, or says "snapshot this Figma frame",
  "save a Figma baseline", or "take a Figma snapshot".
argument-hint: "<figma-url>"
allowed-tools:
  - Bash
  - Read
  - Write
---

## Snapshot a Figma Node

### 1. Parse the URL

Extract `fileKey` and `nodeId` from the Figma URL:
- URL format: `https://www.figma.com/design/<fileKey>/...?node-id=<nodeId>`
- `nodeId`: convert `-` to `:` (e.g. `2895-40497` → `2895:40497`)

### 2. Check prerequisites

Verify `FIGMA_TOKEN` is set:
```bash
if [[ -z "${FIGMA_TOKEN:-}" ]]; then
  echo "ERROR: FIGMA_TOKEN is not set. Add it to your environment: export FIGMA_TOKEN=your_token"
  exit 1
fi
```

Get your Figma personal access token at: https://www.figma.com/settings → Personal access tokens.

### 3. Create snapshot directory

Derive `nodeId_safe` by replacing `:` with `_` (filesystem-safe): `2895:40497` → `2895_40497`.

```bash
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
NODE_ID_SAFE="${nodeId//:/_}"
FIGMA_DATA="$HOME/.figma-differ"
SNAP_DIR="${FIGMA_DATA}/<fileKey>/${NODE_ID_SAFE}/${TIMESTAMP}"
mkdir -p "$SNAP_DIR"

# One-time migration from legacy storage (safe to re-run — skips if already migrated)
LEGACY_DIR="$CLAUDE_PLUGIN_ROOT/data/snapshots"
if [ -d "$LEGACY_DIR" ] && [ "$(ls -A "$LEGACY_DIR" 2>/dev/null)" ]; then
  cp -rn "$LEGACY_DIR"/* "$FIGMA_DATA/" 2>/dev/null || true
  echo "Migrated legacy snapshots from data/snapshots/ to ~/.figma-differ/" >&2
  rm -rf "$LEGACY_DIR"
fi
```

### 4. Fetch node JSON

```bash
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_node_json <fileKey> <nodeId> > "$SNAP_DIR/node.json"
```

If this fails, show the error and stop.

### 5. Fetch PNG screenshot

```bash
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_node_png <fileKey> <nodeId> "$SNAP_DIR/screenshot.png"
```

If this fails, warn the user but continue — JSON snapshot is still useful for structural diffs.

### 6. Confirm

Tell the user:
```
Snapshot saved to ~/.figma-differ/<fileKey>/<nodeId_safe>/<timestamp>/
   node.json     — <size> bytes
   screenshot.png — <size> bytes (if successful)

Run /figma-differ:diff <same-url> to compare against this snapshot later.
```
