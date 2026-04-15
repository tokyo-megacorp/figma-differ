#!/usr/bin/env bash
# Token loader for figma-differ — single source of truth.
#
# Lookup chain (first hit wins):
#   1. $FIGMA_TOKEN env var (explicit override)
#   2. ~/.figma-differ/.env (mode 0600, line: FIGMA_TOKEN=...)
#
# On success: exports FIGMA_TOKEN and sets FIGMA_TOKEN_SOURCE ("env" or "file").
# On failure: prints an actionable message to stderr and returns non-zero.
#
# Also performs a one-time migration of the legacy /tmp/.figma-token into
# ~/.figma-differ/.env with strict permissions, then unlinks the tmp file.

FIGMA_DIFFER_CONFIG_DIR="${FIGMA_DIFFER_CONFIG_DIR:-${HOME}/.figma-differ}"
FIGMA_DIFFER_ENV_FILE="${FIGMA_DIFFER_CONFIG_DIR}/.env"

_token_migrate_legacy() {
  # If a legacy /tmp/.figma-token exists and no config file is in place yet,
  # relocate it to the durable 0600 file and delete the tmp copy.
  if [[ -f "/tmp/.figma-token" && ! -f "${FIGMA_DIFFER_ENV_FILE}" ]]; then
    local legacy
    legacy=$(cat /tmp/.figma-token 2>/dev/null | tr -d '[:space:]')
    if [[ -n "$legacy" ]]; then
      mkdir -p "${FIGMA_DIFFER_CONFIG_DIR}"
      chmod 700 "${FIGMA_DIFFER_CONFIG_DIR}"
      (
        umask 077
        printf 'FIGMA_TOKEN=%s\n' "$legacy" > "${FIGMA_DIFFER_ENV_FILE}"
      )
      chmod 600 "${FIGMA_DIFFER_ENV_FILE}"
      rm -f /tmp/.figma-token
      echo "NOTE: migrated token from /tmp/.figma-token to ${FIGMA_DIFFER_ENV_FILE} (0600)" >&2
    fi
  fi
}

_token_read_file() {
  # Parse FIGMA_TOKEN=... from the env file. Accepts optional surrounding
  # quotes. Ignores blank lines and comments.
  [[ -f "${FIGMA_DIFFER_ENV_FILE}" ]] || return 1
  local line value
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    if [[ "$line" == FIGMA_TOKEN=* ]]; then
      value="${line#FIGMA_TOKEN=}"
      # strip surrounding single or double quotes
      value="${value%\"}"; value="${value#\"}"
      value="${value%\'}"; value="${value#\'}"
      if [[ -n "$value" ]]; then
        printf '%s' "$value"
        return 0
      fi
    fi
  done < "${FIGMA_DIFFER_ENV_FILE}"
  return 1
}

_token_warn_file_perms() {
  # Warn loudly if the env file is too permissive — the whole point is 0600.
  [[ -f "${FIGMA_DIFFER_ENV_FILE}" ]] || return 0
  local mode
  mode=$(stat -f '%Lp' "${FIGMA_DIFFER_ENV_FILE}" 2>/dev/null || stat -c '%a' "${FIGMA_DIFFER_ENV_FILE}" 2>/dev/null)
  if [[ -n "$mode" && "$mode" != "600" ]]; then
    echo "WARN: ${FIGMA_DIFFER_ENV_FILE} has mode ${mode}; tightening to 600" >&2
    chmod 600 "${FIGMA_DIFFER_ENV_FILE}" 2>/dev/null || true
  fi
}

load_figma_token() {
  # 1) env wins
  if [[ -n "${FIGMA_TOKEN:-}" ]]; then
    export FIGMA_TOKEN
    FIGMA_TOKEN_SOURCE="env"
    export FIGMA_TOKEN_SOURCE
    return 0
  fi

  # One-time migration, then try the file.
  _token_migrate_legacy
  _token_warn_file_perms

  local from_file
  if from_file=$(_token_read_file); then
    FIGMA_TOKEN="$from_file"
    export FIGMA_TOKEN
    FIGMA_TOKEN_SOURCE="file"
    export FIGMA_TOKEN_SOURCE
    return 0
  fi

  cat >&2 <<EOF
ERROR: FIGMA_TOKEN not found.
  Looked in: \$FIGMA_TOKEN env var, and ${FIGMA_DIFFER_ENV_FILE}
  Fix: run  bash scripts/auth.sh set
EOF
  return 1
}

# Helper: mask a token for display — keeps the last 4 chars.
mask_figma_token() {
  local t="${1:-}"
  local n=${#t}
  if (( n <= 4 )); then
    printf '****'
  else
    printf '…%s' "${t: -4}"
  fi
}
