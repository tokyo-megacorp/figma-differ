#!/usr/bin/env bash
# figma-differ auth CLI — manage the Figma personal access token.
#
# Subcommands:
#   set      Prompt for a token, verify it against /v1/me, persist to
#            ~/.figma-differ/.env with mode 0600.
#   status   Show which source is active and a masked tail of the token.
#   clear    Remove the stored token (env var is untouched).
#   doctor   Verify the currently-loaded token by hitting /v1/me.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/token.sh
source "${SCRIPT_DIR}/lib/token.sh"

FIGMA_API="https://api.figma.com/v1"

_require_curl_jq() {
  for cmd in curl jq; do
    command -v "$cmd" &>/dev/null || { echo "ERROR: '${cmd}' not installed" >&2; exit 1; }
  done
}

_verify_token() {
  # Hit /v1/me — returns the Figma user JSON. Prints handle on success.
  local token="$1"
  local body http_code
  local tmp
  tmp=$(mktemp)
  # RETURN trap cleans up the response body on every exit path — including
  # SIGINT during the curl, so we don't leak the /v1/me body in /tmp.
  trap 'rm -f "$tmp"' RETURN
  http_code=$(curl -s --max-time 20 \
    -H "X-Figma-Token: ${token}" \
    -o "$tmp" -w '%{http_code}' \
    "${FIGMA_API}/me") || http_code="000"

  if [[ "$http_code" == "200" ]]; then
    local handle email
    handle=$(jq -r '.handle // empty' "$tmp" 2>/dev/null)
    email=$(jq -r '.email // empty' "$tmp" 2>/dev/null)
    printf 'OK — authenticated as %s <%s>\n' "${handle:-?}" "${email:-?}"
    return 0
  fi

  echo "FAIL — HTTP ${http_code} from ${FIGMA_API}/me" >&2
  if [[ -s "$tmp" ]]; then
    head -c 400 "$tmp" >&2
    echo >&2
  fi
  return 1
}

cmd_set() {
  _require_curl_jq

  local token=""
  if [[ -n "${1:-}" ]]; then
    # Explicit arg form: auth.sh set <token>. Handy for automation.
    token="$1"
  elif [[ ! -t 0 ]]; then
    # Piped stdin: cat token.txt | auth.sh set
    token=$(tr -d '[:space:]' < /dev/stdin)
  else
    # Interactive, no echo.
    printf 'Paste Figma token (input hidden): ' >&2
    # shellcheck disable=SC2162
    IFS= read -r -s token
    echo >&2
  fi

  token=$(printf '%s' "$token" | tr -d '[:space:]')
  if [[ -z "$token" ]]; then
    echo "ERROR: empty token" >&2
    exit 1
  fi

  echo "Verifying token against Figma /me…" >&2
  if ! _verify_token "$token"; then
    echo "Refusing to save an unverified token." >&2
    exit 1
  fi

  mkdir -p "${FIGMA_DIFFER_CONFIG_DIR}"
  chmod 700 "${FIGMA_DIFFER_CONFIG_DIR}" 2>/dev/null || true
  (
    umask 077
    printf 'FIGMA_TOKEN=%s\n' "$token" > "${FIGMA_DIFFER_ENV_FILE}"
  )
  chmod 600 "${FIGMA_DIFFER_ENV_FILE}"

  # Clean up legacy file if the user still had one.
  [[ -f /tmp/.figma-token ]] && rm -f /tmp/.figma-token

  echo "Saved to ${FIGMA_DIFFER_ENV_FILE} (mode 600)" >&2
}

cmd_status() {
  if load_figma_token 2>/dev/null; then
    local masked
    masked=$(mask_figma_token "$FIGMA_TOKEN")
    printf 'token source: %s\n' "$FIGMA_TOKEN_SOURCE"
    printf 'token (masked): %s\n' "$masked"
    if [[ "$FIGMA_TOKEN_SOURCE" == "file" ]]; then
      local mode
      mode=$(stat -f '%Lp' "${FIGMA_DIFFER_ENV_FILE}" 2>/dev/null || stat -c '%a' "${FIGMA_DIFFER_ENV_FILE}" 2>/dev/null)
      printf 'file: %s (mode %s)\n' "${FIGMA_DIFFER_ENV_FILE}" "${mode:-?}"
    fi
  else
    printf 'token source: (none)\n'
    printf 'fix: bash scripts/auth.sh set\n'
    exit 1
  fi
}

cmd_clear() {
  if [[ -f "${FIGMA_DIFFER_ENV_FILE}" ]]; then
    rm -f "${FIGMA_DIFFER_ENV_FILE}"
    echo "Removed ${FIGMA_DIFFER_ENV_FILE}" >&2
  else
    echo "No stored token at ${FIGMA_DIFFER_ENV_FILE}" >&2
  fi
  if [[ -f /tmp/.figma-token ]]; then
    rm -f /tmp/.figma-token
    echo "Removed legacy /tmp/.figma-token" >&2
  fi
  if [[ -n "${FIGMA_TOKEN:-}" ]]; then
    echo "NOTE: \$FIGMA_TOKEN is still set in your shell env — unset it with: unset FIGMA_TOKEN" >&2
  fi
}

cmd_doctor() {
  _require_curl_jq
  if ! load_figma_token; then
    exit 1
  fi
  printf 'source: %s\n' "$FIGMA_TOKEN_SOURCE"
  _verify_token "$FIGMA_TOKEN"
}

usage() {
  cat >&2 <<EOF
Usage: bash scripts/auth.sh <command>

Commands:
  set [token]   Save a Figma token after verifying it. Token may be passed as
                an arg, piped on stdin, or entered interactively (hidden).
  status        Show active token source and a masked tail.
  clear         Remove the stored token file.
  doctor        Verify the loaded token against Figma /v1/me.

Lookup order: \$FIGMA_TOKEN env var, then ${FIGMA_DIFFER_ENV_FILE:-~/.figma-differ/.env}.
EOF
}

main() {
  local sub="${1:-}"
  [[ -n "$sub" ]] && shift || true
  case "$sub" in
    set)    cmd_set "$@" ;;
    status) cmd_status "$@" ;;
    clear)  cmd_clear "$@" ;;
    doctor) cmd_doctor "$@" ;;
    ""|-h|--help|help) usage; [[ -z "$sub" ]] && exit 1 || exit 0 ;;
    *) echo "ERROR: unknown command: $sub" >&2; usage; exit 1 ;;
  esac
}

main "$@"
