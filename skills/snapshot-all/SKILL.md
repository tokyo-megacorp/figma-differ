---
name: figma-differ snapshot-all
description: >
  Bulk snapshots every frame in a Figma file — fetches all node JSONs, exports PNGs,
  and stores comments. Uses a single API call for the tree and batched image exports.
  Use when the user runs /figma-differ:snapshot-all with a Figma file URL, or says
  "snapshot all frames", "bulk snapshot", "baseline the whole file", or "snapshot
  everything in this Figma file".
argument-hint: "<figma-file-url>"
allowed-tools:
  - Bash
  - Read
  - Write
  - mcp__claude_ai_Slack__slack_send_message
---

## Bulk Snapshot All Frames

### 1. Parse the URL

Extract `fileKey` from the Figma URL (`https://www.figma.com/design/<fileKey>/...`). No `node-id` parameter needed.

### 2. Check prerequisites

- Verify `FIGMA_TOKEN` is set
- Always refresh the index first (re-run the index workflow: fetch tree, walk, write index.json) to catch new frames added since last run
- After indexing, if the frames array in `index.json` is empty, stop and tell the user the file has no indexable frames

### 3. Fetch the full file tree (1 API call)

Pipe directly to a temp file (do NOT store in shell variable — file trees can be 10-30MB):

```bash
TREE_FILE="/tmp/figma-tree-<fileKey>-$$.json"
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_file_tree <fileKey> > "$TREE_FILE"
```

Extract `fileName` from the response: `jq -r '.name' "$TREE_FILE"`.

### 4. Split into per-frame node.json files

For each frame in the index, extract its subtree from the tree file using jq.

**IMPORTANT: Do NOT use jq recursive descent (`..`) — it hangs on large trees.** Use explicit path traversal to find each frame by ID:
```bash
jq --arg id "<nodeId>" '
  [.document.children[].children[]? | recurse(.children[]?) | select(.id == $id)] | first
' "$TREE_FILE"
```

Store each frame's JSON at:
```
~/.figma-differ/<fileKey>/<nodeId_safe>/<timestamp>/node.json
```

Use the same timestamp for all frames in this snapshot (atomic file-level snapshot).

### 5. Batch export PNGs

Collect all frame IDs from the index. Call:
```bash
BATCH_DIR="/tmp/figma-batch-<fileKey>-$$"
mkdir -p "$BATCH_DIR"
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_batch_images <fileKey> "id1,id2,..." "$BATCH_DIR"
```

Move each downloaded PNG to its frame's snapshot directory and clean up:
```
~/.figma-differ/<fileKey>/<nodeId_safe>/<timestamp>/screenshot.png
```

After all PNGs are moved: `rm -rf "$BATCH_DIR" "$TREE_FILE"`

### 6. Store comments

Pipe directly to file (do NOT store in shell variable — large comment payloads will exceed argument limits):

```bash
COMMENT_DIR="$HOME/.figma-differ/<fileKey>/comments"
mkdir -p "$COMMENT_DIR"
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_comments <fileKey> > "$COMMENT_DIR/<timestamp>.json"
```

### 7. Create Slack parent threads (if configured)

Check if `~/.figma-differ/config.json` exists and has a `slack_channel_id`. If so:

1. Read `~/.figma-differ/<fileKey>/slack-threads.json` (create `{ "channel_id": "<channel_id>", "threads": {} }` if missing)
2. For each frame in the index that is NOT already in the `threads` registry, create a parent message:

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

   Post via `mcp__claude_ai_Slack__slack_send_message`:
   - `channel_id`: from config
   - `message`: `<emoji> *<Frame Name>* · <<figma-deep-link>|Figma> · _<Page Name>_`

   Save the returned `message_ts` to the registry:
   ```json
   { "ts": "<message_ts>", "name": "<Frame Name>", "page": "<Page Name>" }
   ```

3. Write the updated `slack-threads.json` after all parent messages are created.

**Rate limit note:** If there are many new frames (e.g. first run with 50+ frames), post parent messages sequentially with no artificial delay — the Slack MCP handles rate limiting. Log progress: `Creating Slack thread for "<Frame Name>"... (M/N)`

### 8. Confirm

```
Snapshot complete — <fileName>
  Frames: N snapshots stored
  PNGs: M exported (K failed)
  Comments: C total (U unresolved)
  Slack threads: T created (S already existed)
  Timestamp: <timestamp>
  Storage: ~/.figma-differ/<fileKey>/

Run /figma-differ:diff-all <url> to check for changes later.
```

### API call budget

- 1 call: fetch_file_tree
- ceil(N/50) calls: batch image export (e.g. 200 frames = 4 calls)
- 1 call: fetch_comments
- N Slack calls: parent thread creation (first run only; subsequent runs = 0)
- Total for 200 frames: ~6 Figma API calls + up to 200 Slack messages on first run
