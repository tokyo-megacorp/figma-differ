---
name: figma-differ notify
description: >
  Posts diff results to Slack using persistent frame threads. Each tracked frame
  gets a permanent parent message; diffs and comments are thread replies.
  Use when the user runs /figma-differ:notify, or says "post the diff to Slack",
  "share the Figma diff", "notify the team about design changes", or "send diff to Slack".
argument-hint: "[<figma-file-url>]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Glob
  - Grep
  - mcp__claude_ai_Slack__slack_send_message
  - mcp__claude_ai_Slack__slack_search_channels
---

## Post Diff to Slack — Persistent Frame Threads

### 1. Resolve config and file key

- Read `~/.figma-differ/config.json` to get `slack_channel_id`
  - If missing or no `slack_channel_id`: error — `Set slack_channel_id in ~/.figma-differ/config.json`
- If a Figma URL was passed, extract `fileKey` from it
- Otherwise, find the most recently modified `latest-diff-all.json` under `~/.figma-differ/*/`
- Extract `fileKey` from the path

### 2. Load diff data

Read `~/.figma-differ/<fileKey>/latest-diff-all.json`. This is the structured JSON output from `bulk-diff.js`.

Structure:
```json
{
  "total": 10,
  "unchanged": 7,
  "top": [
    {
      "id": "2895:40497",
      "name": "Login Screen",
      "page": "Profile",
      "severity": "critical",
      "changes": [
        { "type": "added", "count": 5, "details": "..." },
        { "type": "text", "details": "\"Sign In\" → \"Log In\"" },
        { "type": "fill", "details": "header #F85149 → #D29922" }
      ],
      "nodeCount": { "before": 142, "after": 147 }
    }
  ],
  "rest": [...],
  "comments": {
    "new": [{ "author": "Alice", "text": "Button needs variant", "nodeId": "2895:40497" }],
    "resolved": [{ "text": "Icon alignment", "resolvedBy": "Bob", "nodeId": "2895:40501" }]
  }
}
```

If file not found: error — `No diff result found. Run /figma-differ:diff-all <url> first.`

### 3. Load thread registry

Read `~/.figma-differ/<fileKey>/slack-threads.json`. If it doesn't exist, initialize:
```json
{ "channel_id": "<slack_channel_id>", "threads": {} }
```

### 4. Load index for page names and file metadata

Read `~/.figma-differ/<fileKey>/index.json` to get:
- `fileName` — the Figma file name
- Each frame's `page` name (from the frames array)

### 5. Process each changed frame

Combine `top` and `rest` arrays from the diff JSON. For each frame with changes:

#### 5a. If frame has NO thread in registry — create parent message

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

Build the Figma deep-link:
```
https://www.figma.com/design/<fileKey>/<fileName>?node-id=<nodeId with : replaced by ->
```

Post parent message:
```
<emoji> *<Frame Name>* · <<figma-deep-link>|Figma> · _<Page Name>_
```

Use `mcp__claude_ai_Slack__slack_send_message` with:
- `channel_id`: from config
- `message`: the formatted parent message

**Save the returned `message_ts`** (from the tool response) to the registry:
```json
"threads": {
  "<frameId>": { "ts": "<message_ts>", "name": "<Frame Name>", "page": "<Page Name>" }
}
```

#### 5b. Post diff run as thread reply

Build a single thread reply message grouping all changes for this frame. Format:

```
*Apr 2 — N changes detected*
> <change lines with emojis>
>
> _<before> → <after> nodes_
```

Change type emoji mapping:
- `added` or `removed` → 🧩 `:jigsaw:` — e.g. `> :jigsaw: +5 nodes added`
- `text` → ✏️ `:pencil2:` — e.g. `> :pencil2: 2 text changes: "Sign In" → "Log In"`
- `fill` or `color` or `stroke` → 🎨 `:art:` — e.g. `> :art: fill: header #F85149 → #D29922`
- `layout` or `spacing` or `padding` → 📐 `:straight_ruler:`
- `component` or `swap` → 🔀 `:twisted_rightwards_arrows:`
- `visibility` → 👁️ `:eye:`
- `bbox` or `position` → 📍 `:round_pushpin:`
- `baseline` or `resolved` or `none` → 🤏 `:pinching_hand:` (matches baseline)

Use `mcp__claude_ai_Slack__slack_send_message` with:
- `channel_id`: from config
- `message`: the formatted diff reply
- `thread_ts`: the `ts` from the registry for this frame

### 6. Post comment activity as thread replies

For each **new comment** in `comments.new`, find the frame thread by `nodeId`:
```
:speech_balloon: *<Author Name>*
> <comment text>
```

For each **resolved comment** in `comments.resolved`, find the frame thread by `nodeId`:
```
:speech_balloon: ~"<comment text>"~ — _resolved by <Author>_
```

Post each as a thread reply using `thread_ts` from the registry.

If a comment's `nodeId` doesn't have a thread, skip it (comment is on an untracked frame).

### 7. Save updated registry

Write the updated `slack-threads.json` back to `~/.figma-differ/<fileKey>/slack-threads.json`:
```json
{
  "channel_id": "<slack_channel_id>",
  "threads": {
    "<frameId>": { "ts": "<message_ts>", "name": "<name>", "page": "<page>" },
    ...
  }
}
```

### 8. Confirm

```
Slack notify complete — <fileKey>
  Threads: N parent messages (M new, K existing)
  Diff replies: X posted
  Comment replies: Y posted
  Channel: <channel_id>
```

### Important constraints

- The Slack MCP tool is `mcp__claude_ai_Slack__slack_send_message` with params: `channel_id`, `message`, optional `thread_ts`
- There is NO `chat.update` or `reactions.add` API — never reference them
- Never put status/progress info in message text that could go stale
- Status tracking is via human-added reactions only (👀/✅)
- Date in diff replies uses short format: `Apr 2`, `Mar 15`, etc.
