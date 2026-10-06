#!/usr/bin/env bash
# Drive pixel-builder with a real model through Cline CLI: the 5 prompts from
# docs/agent-testing.md, then a summary of what each run made.
#
#   GEMINI_API_KEY=... scripts/agent-test-cline.sh            # free Gemini tier
#   CLINE_PROVIDER=openai CLINE_BASE_URL=https://openrouter.ai/api/v1 \
#     CLINE_KEY=... CLINE_MODEL=<id> scripts/agent-test-cline.sh
#
# Output: agent-test-out/<timestamp>/ with one workspace + log per prompt.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PROVIDER="${CLINE_PROVIDER:-gemini}"
MODEL="${CLINE_MODEL:-gemini-2.5-flash}"
KEY="${CLINE_KEY:-${GEMINI_API_KEY:-}}"
BASE_URL="${CLINE_BASE_URL:-}"
TOOLS="${PIXEL_BUILDER_TOOLS:-core}"
TIMEOUT="${CLINE_TIMEOUT:-600}"
if [ -z "$KEY" ]; then echo "Set GEMINI_API_KEY (or CLINE_KEY)." >&2; exit 2; fi

OUT="$REPO/agent-test-out/$(date +%Y%m%d-%H%M%S)-${MODEL//\//_}"
mkdir -p "$OUT"
# Cline keeps its settings (and the key) under HOME; use a throwaway one.
CLINE_HOME="$(mktemp -d)"
trap 'rm -rf "$CLINE_HOME"' EXIT

CLINE=(cline)
if ! command -v cline >/dev/null; then
  npm install --silent --prefix "$CLINE_HOME/pkg" cline >/dev/null
  CLINE=(node "$CLINE_HOME/pkg/node_modules/cline/bin/cline")
fi
cl() { HOME="$CLINE_HOME" "${CLINE[@]}" "$@"; }

auth=(auth -p "$PROVIDER" -k "$KEY" -m "$MODEL")
[ -n "$BASE_URL" ] && auth+=(-b "$BASE_URL")
cl "${auth[@]}" >/dev/null

PROMPTS=(
  "forest|Make a starter forest pack: 3 trees, bushes, rocks, a grass tile and a dirt path tile."
  "villagers|Make 3 farm villagers: a farmer, a shopkeeper and a child, in the same style."
  "ui|Make a small UI kit: a button, a panel, a health bar and an inventory slot."
  "village|Make a small village map with a few houses, a road and trees."
  "sign|Make a sign that says INN."
)
SUFFIX=" Use the pixel-builder tools. Call get_style_guide first. Report the file paths you made."

for entry in "${PROMPTS[@]}"; do
  name="${entry%%|*}"; prompt="${entry#*|}"
  ws="$OUT/$name"; mkdir -p "$ws"
  cl mcp remove pixel-builder >/dev/null 2>&1 || true
  cl mcp add pixel-builder --yes -- node "$REPO/node_modules/tsx/dist/cli.mjs" "$REPO/src/node/cli.ts" \
    mcp --tools "$TOOLS" --workspace "$ws" >/dev/null
  echo "== $name"
  start=$(date +%s)
  ( cd "$ws" && cl --json -t "$TIMEOUT" "$prompt$SUFFIX" ) >"$ws/cline.jsonl" 2>"$ws/cline.err" || echo "   cline exited $?"
  pngs=$(find "$ws" -path "$ws/.previews" -prune -o -name '*.png' -print | wc -l)
  calls=$( { grep -o 'pixel-builder__[a-z_]*' "$ws/cline.jsonl" || true; } | sort | uniq -c | sort -rn | awk '{printf "%s x%s, ", $2, $1}')
  errors=$(grep -c '"isError":true' "$ws/cline.jsonl" || true)
  echo "   $(( $(date +%s) - start ))s, $pngs png, tool errors: $errors"
  echo "   calls: ${calls%, }"
done
echo
echo "Results in $OUT (open the PNGs; each folder has cline.jsonl with the full run)."
