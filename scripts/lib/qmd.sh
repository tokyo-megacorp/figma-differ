#!/usr/bin/env bash
# qmd.sh — shared QMD helpers for figma-differ
#
# Source this file in other scripts:
#   source "$(dirname "$0")/lib/qmd.sh"

FIGMA_DIFFER_DIR="${FIGMA_DIFFER_DIR:-$HOME/.figma-differ}"

# Check if QMD is available and ensure the figma collection exists.
# Returns 0 if QMD is ready, 1 if not installed.
ensure_qmd() {
  if ! command -v qmd &>/dev/null; then
    echo "WARN: qmd not installed. Semantic search unavailable." >&2
    echo "Install: brew install qmd  or  bun install -g @tobilu/qmd" >&2
    return 1
  fi
  if ! qmd collection show figma &>/dev/null 2>&1; then
    qmd collection add "$FIGMA_DIFFER_DIR" --name figma --mask "**/frame.md"
    qmd context add qmd://figma "Figma design frames: UI screens, components, and design system elements. Each document represents a frame with text content, component hierarchy, and layout metadata."
  fi
  return 0
}

# Re-index changed frame.md files and embed new/changed docs.
# No-op if QMD is not installed.
qmd_reindex() {
  ensure_qmd || return 0
  echo "Updating QMD index..." >&2
  qmd update 2>/dev/null || true
  qmd embed 2>/dev/null || true
  echo "QMD index updated." >&2
}
