#!/usr/bin/env bash
# Figma REST API helper for figma-differ
# Usage: figma-api.sh <command> [args...]
# Token: loaded via scripts/lib/token.sh — $FIGMA_TOKEN env var, then
#        ~/.figma-differ/.env (mode 0600). Set via: bash scripts/auth.sh set

set -euo pipefail

FIGMA_API="https://api.figma.com/v1"

_FIGMA_API_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/token.sh
source "${_FIGMA_API_SCRIPT_DIR}/lib/token.sh"

_check_deps() {
  for cmd in curl jq; do
    if ! command -v "$cmd" &>/dev/null; then
      echo "ERROR: required command '${cmd}' not found. Install it first." >&2
      exit 1
    fi
  done
}

_check_token() {
  load_figma_token || exit 1
}

_url_encode_node_id() {
  # URL-encode the : separator in node IDs
  echo "${1//:/%3A}"
}

_figma_get() {
  local path="$1"
  local max_retries="${FIGMA_MAX_RETRIES:-5}"
  local retry_delay=2
  local attempt=0

  while (( attempt < max_retries )); do
    local body_file header_file
    body_file=$(mktemp)
    header_file=$(mktemp)

    local http_code
    http_code=$(curl -s --compressed --max-time 120 \
      -H "X-Figma-Token: ${FIGMA_TOKEN}" \
      -o "$body_file" -D "$header_file" -w '%{http_code}' \
      "${FIGMA_API}${path}") || http_code="000"

    case "$http_code" in
      200)
        cat "$body_file"
        rm -f "$body_file" "$header_file"
        return 0
        ;;
      429)
        local retry_after
        retry_after=$(grep -i 'retry-after:' "$header_file" 2>/dev/null | head -1 | tr -dc '0-9') || true
        local wait_time=${retry_after:-$retry_delay}
        (( wait_time < 1 )) && wait_time=$retry_delay
        (( wait_time > 300 )) && wait_time=300
        local jitter=$(( RANDOM % (retry_delay + 1) ))
        echo "RATE_LIMITED: 429 on ${path}, waiting $((wait_time + jitter))s (attempt $((attempt+1))/${max_retries})" >&2
        sleep $((wait_time + jitter))
        retry_delay=$((retry_delay * 2))
        (( retry_delay > 60 )) && retry_delay=60
        ;;
      403)
        echo "ERROR: HTTP 403 Forbidden on ${path} — check FIGMA_TOKEN" >&2
        rm -f "$body_file" "$header_file"
        return 1
        ;;
      404)
        echo "ERROR: HTTP 404 Not Found on ${path}" >&2
        rm -f "$body_file" "$header_file"
        return 1
        ;;
      5[0-9][0-9])
        echo "ERROR: HTTP ${http_code} on ${path}, retrying (attempt $((attempt+1))/${max_retries})" >&2
        sleep "$retry_delay"
        retry_delay=$((retry_delay * 2))
        (( retry_delay > 60 )) && retry_delay=60
        ;;
      000)
        echo "ERROR: connection failed on ${path}, retrying (attempt $((attempt+1))/${max_retries})" >&2
        sleep "$retry_delay"
        retry_delay=$((retry_delay * 2))
        (( retry_delay > 60 )) && retry_delay=60
        ;;
      *)
        echo "ERROR: unexpected HTTP ${http_code} on ${path}" >&2
        rm -f "$body_file" "$header_file"
        return 1
        ;;
    esac
    rm -f "$body_file" "$header_file"
    attempt=$((attempt + 1))
  done

  echo "ERROR: max retries (${max_retries}) exceeded on ${path}" >&2
  return 1
}

fetch_node_json() {
  local file_key="$1" node_id="$2" version="${3:-}"
  _check_deps
  _check_token
  echo "Fetching node ${node_id}..." >&2
  local encoded_id=$(_url_encode_node_id "$node_id")
  local url="/files/${file_key}/nodes?ids=${encoded_id}"
  [[ -n "$version" ]] && url="${url}&version=${version}"
  _figma_get "$url"
}

fetch_node_png() {
  local file_key="$1" node_id="$2" output_path="$3" node_type="${4:-}"
  if [[ "$node_type" == "CANVAS" ]]; then
    echo "Skipping PNG export for CANVAS node (pages cannot be exported as images)" >&2
    return 0
  fi
  if [[ -n "${FIGMA_DIFFER_TEST_IMAGE_RESPONSE:-}" ]]; then
    local response="$FIGMA_DIFFER_TEST_IMAGE_RESPONSE"
    local s3_url=""
    s3_url=$(echo "$response" | jq -r ".images[\"${node_id}\"] // empty")
    if [[ -z "$s3_url" || "$s3_url" == "null" ]]; then
      echo "Skipping PNG export for node ${node_id} (images API returned no export URL)" >&2
      return 0
    fi
  fi
  _check_deps
  _check_token
  echo "Exporting PNG for ${node_id}..." >&2

  # Step 1: get S3 export URL
  local response
  local encoded_id=$(_url_encode_node_id "$node_id")
  response=$(_figma_get "/images/${file_key}?ids=${encoded_id}&format=png&scale=2")

  # Use jq to safely extract the URL — try : separator, then - separator
  local s3_url
  s3_url=$(echo "$response" | jq -r ".images[\"${node_id}\"] // empty")

  if [[ -z "$s3_url" ]]; then
    local alt_id="${node_id//:/-}"
    s3_url=$(echo "$response" | jq -r ".images[\"${alt_id}\"] // empty")
  fi

  if [[ -z "$s3_url" || "$s3_url" == "null" ]]; then
    local api_err
    api_err=$(echo "$response" | jq -r '.err // empty' 2>/dev/null || true)
    if [[ "$api_err" == *"CANVAS"* || "$api_err" == *"pages cannot be exported"* ]]; then
      echo "Skipping PNG export for CANVAS node (pages cannot be exported as images)" >&2
      return 0
    fi
    echo "Skipping PNG export for node ${node_id} (images API returned no export URL)" >&2
    return 0
  fi

  # Step 2: download PNG from S3
  curl -sf "$s3_url" -o "$output_path"
  echo "Saved PNG to ${output_path}" >&2
}

fetch_comments() {
  local file_key="$1"
  _check_deps
  _check_token
  _figma_get "/files/${file_key}/comments"
}

fetch_versions() {
  local file_key="$1"
  local page_size="${2:-30}"
  _check_deps
  _check_token
  _figma_get "/files/${file_key}/versions?page_size=${page_size}"
}

fetch_file_tree() {
  local file_key="$1"
  local depth="${2:-2}"
  _check_deps
  _check_token
  _figma_get "/files/${file_key}?depth=${depth}"
}

fetch_prototype_data() {
  local file_key="$1" node_id="$2"
  _check_deps
  _check_token
  echo "Fetching full file for prototype interactions (node: ${node_id})..." >&2
  _figma_get "/files/${file_key}" | node "${_FIGMA_API_SCRIPT_DIR}/simplify-node.mjs" --subtree "${node_id}"
}

_fetch_image_chunk() {
  # Returns "ok fail" counts on stdout — caller accumulates
  local file_key="$1" chunk="$2" output_dir="$3"
  local ok=0 fail=0

  local encoded_chunk
  encoded_chunk=$(echo "$chunk" | sed 's/:/%3A/g')

  local response
  # Use || true so curl/network failures don't kill the subshell via set -e
  response=$(_figma_get "/images/${file_key}?ids=${encoded_chunk}&format=png&scale=2") || true

  # Count IDs in this chunk for accurate failure reporting
  local chunk_ids
  IFS=',' read -ra chunk_ids <<< "$chunk"

  # Handle empty response (curl failure, timeout, network error)
  if [[ -z "$response" ]]; then
    echo "ERROR: no response from Figma images API for chunk" >&2
    echo "0 ${#chunk_ids[@]}"
    return 0
  fi

  # Detect Figma API-level errors (403, rate limit, etc.)
  local api_err
  api_err=$(echo "$response" | jq -r '.err // empty' 2>/dev/null) || {
    echo "ERROR: unparseable response from Figma images API for chunk" >&2
    echo "0 ${#chunk_ids[@]}"
    return 0
  }
  if [[ -n "$api_err" ]]; then
    echo "ERROR: Figma images API error for chunk: ${api_err}" >&2
    echo "0 ${#chunk_ids[@]}"
    return 0  # failure signalled via fail count in stdout, not exit code
  fi

  while IFS=$'\t' read -r node_id url; do
    local safe_id="${node_id//:/_}"
    if [[ -n "$url" && "$url" != "null" ]]; then
      if curl -sf --max-time 60 "$url" -o "${output_dir}/${safe_id}.png"; then
        ok=$((ok + 1))
      else
        echo "WARN: failed to download PNG for ${node_id}" >&2
        fail=$((fail + 1))
      fi
    else
      echo "WARN: no export URL for ${node_id}" >&2
      fail=$((fail + 1))
    fi
  done < <(echo "$response" | jq -r '.images | to_entries[] | "\(.key)\t\(.value)"')

  echo "$ok $fail"
}

fetch_batch_images() {
  local file_key="$1" node_ids="$2" output_dir="$3"
  _check_deps
  _check_token

  local success=0 failed=0
  local ids
  IFS=',' read -ra ids <<< "$node_ids"

  # Chunk into batches of 10 (50 causes Figma render timeouts)
  local chunk=""
  local chunk_count=0
  for id in "${ids[@]}"; do
    if [[ -n "$chunk" ]]; then chunk="${chunk},${id}"; else chunk="$id"; fi
    chunk_count=$((chunk_count + 1))

    if [[ $chunk_count -ge 10 ]]; then
      local result
      result=$(_fetch_image_chunk "$file_key" "$chunk" "$output_dir")
      success=$((success + ${result%% *}))
      failed=$((failed + ${result##* }))
      chunk=""
      chunk_count=0
    fi
  done
  # Final partial chunk
  if [[ -n "$chunk" ]]; then
    local result
    result=$(_fetch_image_chunk "$file_key" "$chunk" "$output_dir")
    success=$((success + ${result%% *}))
    failed=$((failed + ${result##* }))
  fi

  echo "Batch images: ${success} saved, ${failed} failed" >&2
  # Non-zero exit signals partial failure to callers (note: set -e is active)
  if [[ $failed -gt 0 ]]; then return 1; fi
}

_split_batch_response() {
  # Split a batch nodes response file into per-node files using jq on disk
  local resp_file="$1" output_dir="$2"
  shift 2
  local chunk_ids=("$@")
  local ok=0 fail=0

  for nid in "${chunk_ids[@]}"; do
    local safe="${nid//:/_}"
    jq --arg id "$nid" '.nodes[$id] // empty' "$resp_file" > "${output_dir}/${safe}.json" 2>/dev/null
    if [[ -s "${output_dir}/${safe}.json" ]]; then
      ok=$((ok + 1))
    else
      rm -f "${output_dir}/${safe}.json"
      fail=$((fail + 1))
    fi
  done
  echo "$ok $fail"
}

fetch_batch_nodes() {
  local file_key="$1" node_ids="$2" output_dir="$3"
  _check_deps
  _check_token

  mkdir -p "$output_dir"
  local ids
  IFS=',' read -ra ids <<< "$node_ids"

  local success=0 failed=0
  local resp_file
  resp_file=$(mktemp)
  trap "rm -f '$resp_file'" RETURN

  # Chunk into batches of 10 (responses can be 100MB+, pipe to file not variable)
  local chunk=""
  local chunk_count=0
  local chunk_ids=()
  for id in "${ids[@]}"; do
    local encoded=$(_url_encode_node_id "$id")
    if [[ -n "$chunk" ]]; then chunk="${chunk},${encoded}"; else chunk="$encoded"; fi
    chunk_ids+=("$id")
    chunk_count=$((chunk_count + 1))

    if [[ $chunk_count -ge 10 ]]; then
      if _figma_get "/files/${file_key}/nodes?ids=${chunk}" > "$resp_file" 2>/dev/null; then
        local result
        result=$(_split_batch_response "$resp_file" "$output_dir" "${chunk_ids[@]}")
        success=$((success + ${result%% *}))
        failed=$((failed + ${result##* }))
      else
        echo "ERROR: batch node fetch failed for chunk" >&2
        failed=$((failed + ${#chunk_ids[@]}))
      fi
      chunk=""
      chunk_count=0
      chunk_ids=()
    fi
  done
  # Final partial chunk
  if [[ -n "$chunk" ]]; then
    if _figma_get "/files/${file_key}/nodes?ids=${chunk}" > "$resp_file" 2>/dev/null; then
      local result
      result=$(_split_batch_response "$resp_file" "$output_dir" "${chunk_ids[@]}")
      success=$((success + ${result%% *}))
      failed=$((failed + ${result##* }))
    else
      echo "ERROR: batch node fetch failed for chunk" >&2
      failed=$((failed + ${#chunk_ids[@]}))
    fi
  fi

  echo "Batch nodes: ${success} saved, ${failed} failed" >&2
  if [[ $failed -gt 0 ]]; then return 1; fi
}

fetch_image_urls() {
  local file_key="$1" node_ids="$2"
  _check_deps
  _check_token

  local ids result_json="{}"
  IFS=',' read -ra ids <<< "$node_ids"

  # Chunk into batches of 50 (URL-only is lighter than render, bigger batches OK)
  local chunk=""
  local chunk_count=0
  for id in "${ids[@]}"; do
    if [[ -n "$chunk" ]]; then chunk="${chunk},${id}"; else chunk="$id"; fi
    chunk_count=$((chunk_count + 1))

    if [[ $chunk_count -ge 50 ]]; then
      local encoded_chunk
      encoded_chunk=$(echo "$chunk" | sed 's/:/%3A/g')
      local response
      response=$(_figma_get "/images/${file_key}?ids=${encoded_chunk}&format=png&scale=2") || true
      if [[ -n "$response" ]]; then
        local chunk_urls
        chunk_urls=$(echo "$response" | jq '.images // {}')
        result_json=$(echo "$result_json" "$chunk_urls" | jq -s '.[0] * .[1]')
      fi
      chunk=""
      chunk_count=0
    fi
  done
  # Final partial chunk
  if [[ -n "$chunk" ]]; then
    local encoded_chunk
    encoded_chunk=$(echo "$chunk" | sed 's/:/%3A/g')
    local response
    response=$(_figma_get "/images/${file_key}?ids=${encoded_chunk}&format=png&scale=2") || true
    if [[ -n "$response" ]]; then
      local chunk_urls
      chunk_urls=$(echo "$response" | jq '.images // {}')
      result_json=$(echo "$result_json" "$chunk_urls" | jq -s '.[0] * .[1]')
    fi
  fi

  echo "$result_json"
}

# Dispatch
command="${1:-}"
shift || true

case "$command" in
  fetch_node_json)       fetch_node_json "$@" ;;
  fetch_node_png)        fetch_node_png "$@" ;;
  fetch_comments)        fetch_comments "$@" ;;
  fetch_file_tree)       fetch_file_tree "$@" ;;
  fetch_batch_nodes)     fetch_batch_nodes "$@" ;;
  fetch_batch_images)    fetch_batch_images "$@" ;;
  fetch_image_urls)      fetch_image_urls "$@" ;;
  fetch_versions)        fetch_versions "$@" ;;
  fetch_prototype_data)  fetch_prototype_data "$@" ;;
  *)
    echo "Usage: figma-api.sh <fetch_node_json|fetch_node_png|fetch_comments|fetch_file_tree|fetch_batch_nodes|fetch_batch_images|fetch_image_urls|fetch_versions|fetch_prototype_data> [args]" >&2
    exit 1
    ;;
esac
