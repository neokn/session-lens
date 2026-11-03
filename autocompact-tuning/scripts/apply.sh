#!/usr/bin/env bash
# Write an auto-compact setting into ~/.claude/settings.json, keeping all else in it. No model is involved.
#
# Usage: bash apply.sh [--enable] [--global TOKENS] [--clear-other-models] [--model MODEL_ID=TOKENS ...]
#   --enable  turn auto-compact on
#   --global  set autoCompactWindow, for every model without its own
#   --model   set modelSettings.<id>.autoCompactWindow, by the canonical id such as claude-opus-5-5
#   --clear-other-models  take the window off every model not named, so that it follows the global
#
# TOKENS is 100000 to 1000000. The file as it was stays beside it as settings.json.bak. It takes effect in new sessions.
# Needs bash, jq.
set -euo pipefail
usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; }
command -v jq >/dev/null || { echo "apply.sh: jq not found" >&2; exit 2; }
FILE="$HOME/.claude/settings.json"
in_range() { [[ "$1" =~ ^[0-9]+$ ]] && [ "$1" -ge 100000 ] && [ "$1" -le 1000000 ] || { echo "apply.sh: $1 is not a token count from 100000 to 1000000" >&2; exit 2; }; }

ENABLE=false; GLOBAL=""; PAIRS='{}'; SAID=""; CLEAR=false
[ $# -gt 0 ] || { usage >&2; exit 2; }
while [ $# -gt 0 ]; do
  case "$1" in
    --enable) ENABLE=true; SAID="$SAID autoCompactEnabled = true"; shift ;;
    --global)
      in_range "${2:-}"
      GLOBAL="$2"; SAID="$SAID autoCompactWindow = $2"; shift 2 ;;
    --clear-other-models) CLEAR=true; SAID="$SAID, the window off other models,"; shift ;;
    --model)
      shift
      [ $# -gt 0 ] && [ "${1#--}" = "$1" ] || { echo "apply.sh: --model needs MODEL_ID=TOKENS" >&2; exit 2; }
      while [ $# -gt 0 ] && [ "${1#--}" = "$1" ]; do
        id="${1%%=*}"; n="${1#*=}"
        [[ "$id" =~ ^claude-[a-z0-9.-]+$ ]] || { echo "apply.sh: $id is not a model id such as claude-opus-5-5" >&2; exit 2; }
        in_range "$n"
        PAIRS="$(jq -c --arg id "$id" --argjson n "$n" '.[$id] = $n' <<<"$PAIRS")"
        SAID="$SAID modelSettings.$id.autoCompactWindow = $n"
        shift
      done ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

mkdir -p "$(dirname "$FILE")"
[ -f "$FILE" ] || echo '{}' > "$FILE"
jq -e 'type == "object"' "$FILE" >/dev/null 2>&1 || { echo "apply.sh: $FILE is not a JSON object, so nothing was written" >&2; exit 1; }
cp "$FILE" "$FILE.bak"
jq --argjson enable "$ENABLE" --argjson clear "$CLEAR" --arg global "$GLOBAL" --argjson pairs "$PAIRS" '
  (if $clear and .modelSettings then .modelSettings |= with_entries(if $pairs[.key] then . else .value |= del(.autoCompactWindow) end) else . end)
  |
  (if $enable then .autoCompactEnabled = true else . end)
  | (if $global != "" then .autoCompactWindow = ($global | tonumber) else . end)
  | reduce ($pairs | to_entries[]) as $p (.; .modelSettings[$p.key].autoCompactWindow = $p.value)' "$FILE" > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
echo "wrote$SAID to $FILE (the old one is $FILE.bak)"

# What can still win over it.
env_of() { local v; v="$(printenv "$1" || true)"; [ -n "$v" ] && { printf '%s' "$v"; return; }; jq -r --arg k "$1" '.env[$k] // empty' "$FILE"; }
[ -z "$(env_of CLAUDE_CODE_AUTO_COMPACT_WINDOW)" ] || echo "warning: CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and wins over this"
[ -z "$(env_of CLAUDE_AUTOCOMPACT_PCT_OVERRIDE)" ] || echo "warning: CLAUDE_AUTOCOMPACT_PCT_OVERRIDE is set and may bring compaction earlier; apply.sh leaves it"
[ -z "$(env_of DISABLE_AUTO_COMPACT)" ] || echo "warning: DISABLE_AUTO_COMPACT is set and keeps auto-compact off whatever this says"
[ -z "$(env_of DISABLE_COMPACT)" ] || echo "warning: DISABLE_COMPACT is set and keeps compaction off whatever this says"
if [ -n "$GLOBAL" ]; then
  jq -r --argjson pairs "$PAIRS" '(.modelSettings // {}) | to_entries[] | select(.value.autoCompactWindow != null and ($pairs[.key] == null)) | "warning: \(.key) has its own window of \(.value.autoCompactWindow), which wins over this for it"' "$FILE"
fi
