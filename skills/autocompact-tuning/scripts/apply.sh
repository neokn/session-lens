#!/usr/bin/env bash
# Write an auto-compact setting into ~/.claude/settings.json, keeping all else in it. No model is involved.
#
# Usage: bash apply.sh --enable
#        bash apply.sh --global TOKENS
#        bash apply.sh --model MODEL_ID=TOKENS [MODEL_ID=TOKENS ...]
#   --enable  turn auto-compact on
#   --global  set autoCompactWindow, for every model without its own
#   --model   set modelSettings.<id>.autoCompactWindow, by the canonical id such as claude-opus-5-5
#
# TOKENS is 100000 to 1000000. The file as it was stays beside it as settings.json.bak. It takes effect in new sessions.
# Needs bash, jq.
set -euo pipefail
usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; }
command -v jq >/dev/null || { echo "apply.sh: jq not found" >&2; exit 2; }
FILE="$HOME/.claude/settings.json"
in_range() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 100000 ] && [ "$1" -le 1000000 ] || { echo "apply.sh: $1 is not a token count from 100000 to 1000000" >&2; exit 2; }; }

case "${1:-}" in
  --enable)
    EDIT='.autoCompactEnabled = true'; ARGS=(); SAID="autoCompactEnabled = true" ;;
  --global)
    in_range "${2:-}"
    EDIT='.autoCompactWindow = ($n | tonumber)'; ARGS=(--arg n "$2"); SAID="autoCompactWindow = $2" ;;
  --model)
    shift
    [ $# -gt 0 ] || { echo "apply.sh: --model needs MODEL_ID=TOKENS" >&2; exit 2; }
    PAIRS='{}'; SAID=""
    for pair in "$@"; do
      id="${pair%%=*}"; n="${pair#*=}"
      [[ "$id" =~ ^claude-[a-z0-9.-]+$ ]] || { echo "apply.sh: $id is not a model id such as claude-opus-5-5" >&2; exit 2; }
      in_range "$n"
      PAIRS="$(jq -c --arg id "$id" --argjson n "$n" '.[$id] = $n' <<<"$PAIRS")"
      SAID="$SAID modelSettings.$id.autoCompactWindow = $n"
    done
    EDIT='reduce ($pairs | to_entries[]) as $p (.; .modelSettings[$p.key].autoCompactWindow = $p.value)'; ARGS=(--argjson pairs "$PAIRS") ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac

mkdir -p "$(dirname "$FILE")"
[ -f "$FILE" ] || echo '{}' > "$FILE"
jq -e 'type == "object"' "$FILE" >/dev/null 2>&1 || { echo "apply.sh: $FILE is not a JSON object, so nothing was written" >&2; exit 1; }
cp "$FILE" "$FILE.bak"
jq ${ARGS[@]+"${ARGS[@]}"} "$EDIT" "$FILE" > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
echo "wrote$( [ "${SAID:0:1}" = " " ] || printf ' ' )$SAID to $FILE (the old one is $FILE.bak)"

# What can still win over it.
env_of() { local v; v="$(printenv "$1" || true)"; [ -n "$v" ] && { printf '%s' "$v"; return; }; jq -r --arg k "$1" '.env[$k] // empty' "$FILE"; }
[ -z "$(env_of CLAUDE_CODE_AUTO_COMPACT_WINDOW)" ] || echo "warning: CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and wins over this"
[ -z "$(env_of CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)" ] || echo "warning: CLAUDE_AUTOCOMPACT_PCT_OVERRIDE is set and may bring compaction earlier; apply.sh leaves it"
[ -z "$(env_of DISABLE_AUTO_COMPACT)" ] || echo "warning: DISABLE_AUTO_COMPACT is set and keeps auto-compact off whatever this says"
[ -z "$(env_of DISABLE_COMPACT)" ] || echo "warning: DISABLE_COMPACT is set and keeps compaction off whatever this says"
if [ "${1:-}" = --global ]; then
  jq -r '(.modelSettings // {}) | to_entries[] | select(.value.autoCompactWindow != null) | "warning: \(.key) has its own window of \(.value.autoCompactWindow), which wins over this for it"' "$FILE"
fi
