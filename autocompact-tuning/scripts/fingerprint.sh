#!/usr/bin/env bash
# Print what a report depends on, as one line: when it has not changed, the last report still stands.
#
# Usage: bash fingerprint.sh [--here | PROJECT_GLOB]
#
# The sessions count by name and size: a new session changes this, and so does one that went on. The settings count as
# well, as the advice reads them, and so does the script.
# Needs bash, cksum.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
{
  printf '%s\n' "$ROOT" "$*"
  for name in CLAUDE_CODE_AUTO_COMPACT_WINDOW CLAUDE_AUTOCOMPACT_PCT_OVERRIDE DISABLE_AUTO_COMPACT DISABLE_COMPACT; do printf '%s=%s\n' "$name" "$(printenv "$name" || true)"; done
  cat ~/.claude/settings.json "$ROOT/.claude/settings.json" "$ROOT/.claude/settings.local.json" 2>/dev/null || true
  cat "$HERE/recommend.sh"
  find ~/.claude/projects -mindepth 2 -maxdepth 2 -name '*.jsonl' -mtime -31 -ls 2>/dev/null | awk '{ print $7, $NF }' | sort
} | cksum | cut -d' ' -f1
