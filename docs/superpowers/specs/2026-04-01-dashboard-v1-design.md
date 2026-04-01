# Fig-Diff Dashboard v1 — Design Spec

## North Star

> "What changed since the last time I looked?"

Designs change while implementation is in progress — sometimes within hours. This tool surfaces exactly what changed between any two snapshots so developers don't build against stale specs.

## Overview

A Node.js script (`render-review.js`) that reads `review.json` + `index.json`, fetches Figma image URLs, and generates a single self-contained `review.html` file. The HTML embeds all data as inline JSON and uses vanilla JS for interactivity. Zero runtime dependencies. Open in any browser, share via Slack.

## Architecture

```
review.json + index.json
        │
        ▼
  render-review.js ──→ Figma /v1/images (batch, URLs only)
        │
        ▼
  review.html (self-contained, ~250KB)
        │
        ├── Embedded: review data as JSON
        ├── Embedded: index data as JSON
        ├── Embedded: image URL map as JSON
        ├── Embedded: structural diff details (per changed frame)
        ├── Inline CSS (system theme adaptive)
        ├── Google Fonts: JetBrains Mono (ligatures)
        └── Inline JS (vanilla, no framework)
```

### CLI Integration

```bash
fig-diff review                    # generate + open review.html
fig-diff review --no-open          # generate only
fig-diff review --no-images        # skip Figma images API call
```

The `review` command calls `render-review.js` under the hood.

## Screens

### Screen 1: Index

The landing page. Lists all available diff ranges for the current file.

**Data source:** Scan `~/.figma-differ/<fileKey>/diffs/` for `review.json` files.

**Layout:**
- Header: "fig-diff" + file name + total frames tracked
- List of diff ranges as cards, sorted newest first
- Each card shows: baseline timestamp → current timestamp, time span, severity badge counts (structural/cosmetic)

**Interaction:** Click a diff range → navigate to Accordion view.

### Screen 2: Accordion (scan)

The triage view. All changed frames grouped by Figma page, presented as a scrollable list of collapsible cards. GitHub PR files-changed style.

**Data source:** `review.json` → `decisions` array, grouped by `page` field.

**Layout:**
- Top bar: back button, diff range label, severity filter pills (structural / cosmetic / unchanged)
- Filter pills are toggleable — click "structural" to show only structural changes
- Page groups as section headers with change counts ("Security — 4 changes, 4 of 28 frames")
- Each frame is a collapsible card:
  - **Collapsed:** severity dot (red/yellow/green) + frame name + node count delta + change summary + expand chevron
  - **Expanded:** diff hunks styled as git diff lines:
    - Red (`−`): removed nodes
    - Green (`+`): added nodes
    - Yellow (`△`): bbox changes, component swaps, visibility toggles, text changes, fill changes
  - Lazy-loaded PNG thumbnail (IntersectionObserver) shown when expanded

**Interaction:**
- Click card → toggle expand/collapse
- Click frame name → navigate to Detail view
- Click severity pills → filter
- Keyboard: `j`/`k` to move between frames, `Enter` to expand, `o` to open detail

### Screen 3: Detail (inspect)

Deep inspection of a single frame's structural diff. GitFork-style sidebar + detail panel.

**Data source:** Single entry from `review.json` → `decisions` array, plus its corresponding `structural_diff.json`.

**Layout:**
- Left sidebar (220px): tree of changed frames grouped by page, severity dots, active frame highlighted. Scrollable independently.
- Main panel:
  - Frame name + severity badge + page name
  - Stats line: "42 → 47 nodes (+5) · Security page · +3 nodes, 2 bbox, 1 swap"
  - Lazy-loaded PNG of current state (full width, IntersectionObserver)
  - Change groups as collapsible sections:
    - **Added Nodes** — green, one line per node: `+ "NodeName" TYPE`
    - **Removed Nodes** — red, one line per node: `− "NodeName" TYPE`
    - **Component Swaps** — yellow: `⇄ "NodeName" oldId → newId`
    - **Bbox Changes** — yellow: `△ "NodeName" W×H → W×H (dw: ±N, dh: ±N)`
    - **Visibility Changes** — yellow: `"NodeName" visible: true → false`
    - **Constraint Changes** — yellow: before → after
    - **Layout Changes** — yellow: layoutMode, padding, spacing
    - **Text Changes** — yellow: `"NodeName" "old text" → "new text"`
    - **Fill Changes** — yellow: added/removed fills
    - **Stroke Changes** — yellow: added/removed strokes
    - **Font Changes** — yellow: fontSize/fontFamily/fontWeight before → after
    - **Opacity Changes** — yellow: `"NodeName" 1.0 → 0.5`
    - **Effect Changes** — yellow: added/removed effects
  - Empty sections are hidden, not shown as "No changes"

**Interaction:**
- Click sidebar frame → switch detail panel
- Keyboard: `j`/`k` sidebar navigation, `Esc` back to accordion
- Change groups are collapsed by default if >10 items, expanded otherwise

## Image Loading

**Generation time:**
- `render-review.js` calls Figma `/v1/images/:fileKey?ids=<changed_ids>&format=png&scale=2`
- Uses existing `figma-api.sh fetch_batch_images` logic but only fetches URLs, does not download PNGs
- Embeds URL map as `{ "nodeId": "https://s3..." }` in the HTML
- Adds `--no-images` flag to skip this step (for offline/fast generation)

**Runtime (browser):**
- `IntersectionObserver` watches frame cards and detail panel image containers
- When element enters viewport, sets `img.src` from the URL map
- Loading state: gray shimmer placeholder
- Error state: "Image unavailable" text (S3 URL expired or network error)
- URLs are pre-signed S3, valid ~14 days. Sufficient for the use case.

## Typography

**Monospace (diff hunks, code, node IDs):** JetBrains Mono with ligatures enabled. Loaded via Google Fonts CDN (`<link>` in the HTML head). Fallback: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`.

```css
font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
font-feature-settings: 'liga' 1, 'calt' 1;
```

**UI text (headers, labels, descriptions):** System font stack — `-apple-system, BlinkMacSystemFont, "Segoe UI", Noto Sans, Helvetica, Arial, sans-serif`.

## Theme

System-adaptive using `prefers-color-scheme`:

**Dark (default):**
- Background: `#0d1117`
- Surface: `#161b22`
- Border: `#30363d`
- Text primary: `#e6edf3`
- Text secondary: `#8b949e`

**Light:**
- Background: `#ffffff`
- Surface: `#f6f8fa`
- Border: `#d0d7de`
- Text primary: `#1f2328`
- Text secondary: `#656d76`

**Severity colors (both themes):**
- Structural: `#da3633` (dark) / `#cf222e` (light)
- Cosmetic: `#d29922` (dark) / `#bf8700` (light)
- Unchanged: `#3fb950` (dark) / `#1a7f37` (light)

**Diff hunk colors:**
- Added: green background tint + green text
- Removed: red background tint + red text
- Changed: yellow background tint + yellow text

## Data Contract

### Input: review.json (from compile-review.sh)

```json
{
  "fileKey": "5nIxJq1CzXIipSFfjs8eMQ",
  "diffRange": "20260401T090000Z-vs-20260401T164047Z",
  "baseline": "20260401T090000Z",
  "current": "20260401T164047Z",
  "reviewedAt": "2026-04-01T17:00:00Z",
  "summary": {
    "total": 548,
    "structural": 12,
    "cosmetic": 8,
    "unchanged": 528,
    "approved": 0,
    "flagged": 0,
    "pending": 20
  },
  "byPage": [
    { "page": "Security", "total": 28, "structural": 3, "cosmetic": 1 }
  ],
  "decisions": [
    {
      "nodeId": "1431:33250",
      "nodeName": "PIN Modal",
      "page": "Security",
      "severity": "structural",
      "summary": "+3 nodes, 2 bbox change(s), 1 component swap(s)",
      "nodeCountBefore": 42,
      "nodeCountAfter": 47,
      "nodeCountDelta": 5,
      "beforePath": "~/.figma-differ/.../node.json",
      "afterPath": "~/.figma-differ/.../node.json",
      "diffPath": "~/.figma-differ/.../structural_diff.json",
      "decision": "pending",
      "note": ""
    }
  ]
}
```

### Input: index.json

```json
{
  "fileKey": "5nIxJq1CzXIipSFfjs8eMQ",
  "fileName": "Profile",
  "frames": [
    { "id": "1431:33250", "name": "PIN Modal", "page": "Security" }
  ]
}
```

### Generated: image URL map (embedded in HTML)

```json
{
  "1431:33250": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/...",
  "1431:33258": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/..."
}
```

## File Structure

```
scripts/
  render-review.js          # Node.js generator (new)
  render-review-template.html  # HTML template with {{DATA}} placeholders (new)
  figma-api.sh              # Existing — add fetch_image_urls command
  compile-review.sh         # Existing — no changes
  structural-diff.js        # Existing — no changes
```

## What's NOT in v1

- Triage / approval / persistence
- Timeline view (v2 monitoring)
- Side-by-side before/after PNGs (v1.1)
- Build tooling / framework / dev server
- Offline image caching
- Search / filter by frame name
- Deep linking to specific frames
