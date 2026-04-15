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
  - mcp__claude_ai_Slack__slack_send_message
---

## Snapshot a Figma Node

### 1. Parse the URL

Extract `fileKey` and `nodeId` from the Figma URL:
- URL format: `https://www.figma.com/design/<fileKey>/...?node-id=<nodeId>`
- `nodeId`: convert `-` to `:` (e.g. `2895-40497` → `2895:40497`)

### 2. Check prerequisites

Verify the Figma token is loadable (via `$FIGMA_TOKEN` env var or `~/.figma-differ/.env`):
```bash
bash scripts/auth.sh status || { echo "ERROR: no Figma token. Run: bash scripts/auth.sh set"; exit 1; }
```

Get your Figma personal access token at: https://www.figma.com/settings → Personal access tokens. Save it with `bash scripts/auth.sh set` (prompts, verifies, writes to `~/.figma-differ/.env` at mode 600).

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

### 6. Create Slack parent thread (if configured)

Check if `~/.figma-differ/config.json` exists and has a `slack_channel_id`. If so:

1. Read `~/.figma-differ/<fileKey>/slack-threads.json` (create `{ "channel_id": "<channel_id>", "threads": {} }` if missing)
2. If the `nodeId` is NOT already in the `threads` registry, create a parent message:

   Infer a semantic emoji from the frame name:
   - 🔐 `:lock:` — login, sign in, auth
   - ⚙️ `:gear:` — settings, preferences, config
   - 👤 `:bust_in_silhouette:` — profile, account, user
   - 📥 `:inbox_tray:` — inbox, notifications, messages
   - 💰 `:moneybag:` — net worth, balance, portfolio, finance
   - 🎁 `:gift:` — gift, rewards, offers, promotions
   - 📄 `:page_facing_up:` — statements, documents, history
   - 🛡️ `:shield:` — security, privacy, verification
   - 🏠 `:house:` — home, dashboard, overview
   - 🔍 `:mag:` — search, explore, discover
   - 💳 `:credit_card:` — payments, cards, transactions
   - 📊 `:bar_chart:` — analytics, reports, charts
   - 📱 `:iphone:` — default/fallback for any screen

   Build Figma deep-link: `https://www.figma.com/design/<fileKey>/<fileName>?node-id=<nodeId with : replaced by ->`

   To get the frame name and page name, read the node.json that was just saved and check the index if available, or extract from the Figma API response.

   Post via `mcp__claude_ai_Slack__slack_send_message`:
   - `channel_id`: from config
   - `message`: `<emoji> *<Frame Name>* · <<figma-deep-link>|Figma> · _<Page Name>_`

   Save the returned `message_ts` to the registry:
   ```json
   { "ts": "<message_ts>", "name": "<Frame Name>", "page": "<Page Name>" }
   ```

   Write the updated `slack-threads.json`.

3. If the `nodeId` is already in threads, skip — parent already exists.

### 7. Confirm

Tell the user:
```
Snapshot saved to ~/.figma-differ/<fileKey>/<nodeId_safe>/<timestamp>/
   node.json     — <size> bytes
   screenshot.png — <size> bytes (if successful)

Run /figma-differ:diff <same-url> to compare against this snapshot later.
```
