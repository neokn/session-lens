#!/usr/bin/env bash
# Write the auto-compact report and open it. No model is involved.
#
# Usage: bash report.sh [--here | PROJECT_GLOB] [--out DIR] [--no-open]
#   --here        limit the logs read to the project of the current directory (the page can narrow to it without this)
#   PROJECT_GLOB  directory name pattern under ~/.claude/projects (quote it; names start with "-")
#   --out DIR     where report.json goes (default ~/.claude/autocompact-tuning)
#   --no-open     only write report.json and print the summary
#
# assets/chart.html never changes: it reads the data beside it, so each run replaces only the data. report.js is what a
# page opened from file:// can load, as a browser refuses it a fetch; report.json is the same data, for a page that is served.
# Needs what recommend.sh needs: bash and jq.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HOME/.claude/autocompact-tuning"; OPEN=1; SELECT=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out needs a directory}"; shift 2 ;;
    --no-open) OPEN=0; shift ;;
    *) SELECT+=("$1"); shift ;;
  esac
done

mkdir -p "$OUT"
DATA="$(bash "$HERE/recommend.sh" --json ${SELECT[@]+"${SELECT[@]}"})"
[ "$DATA" != "null" ] || { echo "report.sh: no requests in the logs" >&2; exit 1; }
printf '%s\n' "$DATA" > "$OUT/report.json.tmp"
mv "$OUT/report.json.tmp" "$OUT/report.json"
{ printf 'window.AUTOCOMPACT_REPORT = '; printf '%s' "$DATA"; printf ';\n'; } > "$OUT/report.js.tmp"
mv "$OUT/report.js.tmp" "$OUT/report.js"
ln -sf "$HERE/../assets/chart.html" "$OUT/index.html"

bash "$HERE/recommend.sh" ${SELECT[@]+"${SELECT[@]}"} | tail -3
echo "report: $OUT/index.html"
[ "$OPEN" = 1 ] || exit 0

if command -v open >/dev/null; then open "$OUT/index.html"
elif command -v xdg-open >/dev/null; then xdg-open "$OUT/index.html" >/dev/null 2>&1
else echo "open $OUT/index.html in a browser"; fi
