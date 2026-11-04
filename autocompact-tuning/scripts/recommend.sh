#!/usr/bin/env bash
# Recommend a Claude Code auto-compact setting from real usage over the last 30 days, by a formula: no request is run again.
#
# Usage: bash recommend.sh [--settings] [--here | PROJECT_GLOB=*]
#   --settings    accepted for older callers; what to set, as JSON, is all it prints. With nothing new since the last time,
#                 it prints what it printed then, unless AUTOCOMPACT_FRESH is set.
#   --here        only the project of the current directory
#   PROJECT_GLOB  directory name pattern under ~/.claude/projects (quote it; names start with "-")
#
# Reads ~/.claude/projects/<project>/*.jsonl and the subagent transcripts under <project>/<session>/subagents/.
# references/model.md says what the formula is and where each of its figures comes from.
# Needs bash, jq (1.6+).
set -euo pipefail
command -v jq >/dev/null || { echo "recommend.sh: jq not found (needs jq 1.6+)" >&2; exit 2; }
[ "${1:-}" != "--settings" ] || shift
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
HERE_DIR="$(printf '%s' "$ROOT" | sed 's/[^A-Za-z0-9]/-/g')"
if [ "${1:-}" = "--here" ]; then PROJ="$HERE_DIR"; else PROJ="${1:-*}"; fi

# What is in force: the environment over project settings over user settings.
settings=()
for f in ~/.claude/settings.json "$ROOT/.claude/settings.json" "$ROOT/.claude/settings.local.json"; do
  [ -f "$f" ] || continue
  if jq -e . "$f" >/dev/null 2>&1; then settings+=("$f"); else echo "recommend.sh: $f is not valid JSON, so what is in force may be wrong" >&2; fi
done
CURRENT=$(jq -s '
  def truthy: . != null and (tostring | ascii_downcase | IN("1", "true", "yes", "on"));
  def number: if . == null or . == "" then null else (tonumber? // null) end;
  (add // {}) as $s | ($s.env // {}) as $e
  | def setting($n): ($ENV[$n] // $e[$n]);
    {isOff: ((setting("DISABLE_COMPACT") | truthy) or (setting("DISABLE_AUTO_COMPACT") | truthy) or $s.autoCompactEnabled == false),
     window: (setting("CLAUDE_CODE_AUTO_COMPACT_WINDOW") // $s.autoCompactWindow | number),
     pct: (setting("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE") | number),
     windowInEnv: (setting("CLAUDE_CODE_AUTO_COMPACT_WINDOW") != null),
     # The window each model has of its own, by family; the environment wins over all of them.
     models: (if setting("CLAUDE_CODE_AUTO_COMPACT_WINDOW") then {} else
       ($s.modelSettings // {}) | to_entries | map(select(.value.autoCompactWindow | number) | {
         key: (.key | if test("opus") then "opus" elif test("sonnet") then "sonnet" elif test("fable") then "fable" elif test("haiku") then "haiku" else "other" end),
         value: (.value.autoCompactWindow | number)}) | from_entries end)}' ${settings[@]+"${settings[@]}"} </dev/null)

# A log read into rows: r a request, c a compaction, x a file read again by Read with what it brought back, i the log's first
# request. n is the request's place in its log, so the order holds across readings.
read_log() {
  local f="$1" scope="$2" prior="$3"
  jq -nc --arg file "$f" --arg scope "$scope" --argjson since "$SINCE" --slurpfile prior "$prior" '
    def epoch: sub("\\.[0-9]+Z$"; "Z") | fromdate;
    def close: if .open then .rows += [.open] | .open = null else . end;
    reduce inputs as $e (
      (($prior[0] // {seen: {}, first: true, skip: false, open: null, count: 0, reads: {}}) + {rows: []});
      if ($e.type == "system" and $e.subtype == "compact_boundary") then
        close
        | .open = {t: "c", file: $file, ts: ($e.timestamp | epoch), n: .count, model: .lastModel, after: null, cc: null, summaryChars: null}
        | .skip = true
      elif ($e.type == "user" and $e.isCompactSummary == true) then
        .skip = true      # the first request after a compaction is the summary write, not a normal turn
        | if .open then .open.summaryChars = ($e.message.content // "" | if type == "string" then . elif type == "array" then map(.text? // "") | add // "" else "" end | length) else . end
      elif ($e.type == "assistant" and ($scope != "main" or ($e.isSidechain | not))
            and ($e.message.usage? != null) and ($e.message.id? != null)
            and ($e.message.model != "<synthetic>")) then
        (if .seen[$e.message.id] then . else                                         # one API request = one message id (streamed entries repeat it)
          .seen[$e.message.id] = true
          | ($e.message.usage) as $u
          | ($u.cache_creation_input_tokens // 0) as $cc
          | ((($u.input_tokens // 0) + $cc + ($u.cache_read_input_tokens // 0))) as $ctx
          | ($e.timestamp | epoch) as $t
          | .lastModel = $e.message.model
          | .count += 1
          | if .first then
              .first = false
              | .sample = {t: "i", group: (if $scope != "main" then "subagent" elif ((.entry // $e.entrypoint // "") | startswith("sdk")) then "print" else "interactive" end), file: $file}
              # A log that opens on a summary went on from another: its first request is no initial context.
              | .rows += [{t: "r", k: "first", resumed: .skip, file: $file, ts: $t, n: .count, ctx: $ctx, model: $e.message.model, w5: ($u.cache_creation.ephemeral_5m_input_tokens // 0), w1: ($u.cache_creation.ephemeral_1h_input_tokens // 0)}]
              | .skip = false
            elif .skip then
              .skip = false
              | if .open and .open.after == null then .open.after = $ctx | .open.cc = $cc | .open.model = $e.message.model else . end
            else
              .rows += [{t: "r", k: "normal", file: $file, ts: $t, n: .count, ctx: $ctx, model: $e.message.model, w5: ($u.cache_creation.ephemeral_5m_input_tokens // 0), w1: ($u.cache_creation.ephemeral_1h_input_tokens // 0)}]
            end end)
        # Each file Read asks for, under the request that asked: what comes back is counted when it does.
        | reduce ($e.message.content // [] | if type == "array" then .[] else empty end | select(.type? == "tool_use" and .name == "Read")) as $b
            (.; .reads[$b.id] = {path: ($b.input.file_path // ""), n: .count})
      elif ($e.type == "user" and ($e.message.content | type) == "array") then
        reduce ($e.message.content[] | select(.type? == "tool_result")) as $b (.;
          if .reads[$b.tool_use_id] then
            .rows += [{t: "x", file: $file, ts: ($e.timestamp | epoch), n: .reads[$b.tool_use_id].n, path: .reads[$b.tool_use_id].path, size: ($b.content | tojson | length)}]
            | del(.reads[$b.tool_use_id])
          else . end)
      else . end
      | .entry = (.entry // $e.entrypoint)
    # What it came to so far, then where to go on from: a compaction still open waits there for the request after it.
    ) | . as $state | (.rows[] | select(.k == "first" or .ts >= $since) | . + {group: $state.sample.group}), ({t: "state"} + del(.rows))' 2>/dev/null || true
}

CACHE=~/.claude/autocompact-tuning
KEY="$(bash "$(dirname "$0")/fingerprint.sh" "${1:-}" settings)"
if [ -z "${AUTOCOMPACT_FRESH:-}" ] && [ -f "$CACHE/settings.json" ] && [ "$(cat "$CACHE/settings.key" 2>/dev/null)" = "$KEY" ]; then
  cat "$CACHE/settings.json"
  exit 0
fi

ROWS="$(mktemp)"
SEEN="$(mktemp)"
LOGS="$(mktemp)"
trap 'rm -f "$ROWS" "$SEEN" "$LOGS"' EXIT
SINCE=$(($(date +%s) - 30 * 86400))
[ -z "${AUTOCOMPACT_FRESH:-}" ] || rm -rf "$CACHE/rows"
mkdir -p "$CACHE/rows"
SCRIPT="$(cksum < "$0" | cut -d' ' -f1)"

# What a log came to, kept under its path, with how far it was read and how the reading stood: only what was added since is read.
rows_of() {
  local size="$1" id="$2" scope="$3" f="$4" base read_to=0 seen_size=-1 head_mark="" mark end partial out
  base="$CACHE/rows/$id"
  echo "$id" >> "$SEEN"
  [ ! -f "$base.meta" ] || read -r read_to seen_size head_mark < "$base.meta"
  if [ "$size" != "$seen_size" ]; then
    mark="$(head -c 512 "$f" | cksum | cut -d' ' -f1)"
    # A log that shrank, or begins differently, is another log.
    if [ "$size" -lt "$read_to" ] || { [ "$read_to" -gt 0 ] && [ "$mark" != "$head_mark" ] && [ "$read_to" -ge 512 ]; }; then
      rm -f "$base.rows" "$base.state" "$base.open"
      read_to=0
    fi
    end="$size"
    # The last line may still be being written: it waits for the next reading.
    if [ "$size" -gt 0 ] && [ "$(tail -c 1 "$f" | od -An -c | tr -d ' ')" != '\n' ]; then
      partial="$(tail -n 1 "$f" | wc -c | tr -d ' ')"
      end=$((size - partial))
    fi
    if [ "$end" -gt "$read_to" ]; then
      out="$base.$$"
      # head stops short of a line still being written, and tail then dies of it: that is no failure.
      { tail -c +$((read_to + 1)) "$f" || true; } | head -c $((end - read_to)) \
        | read_log "$f" "$scope" "$([ -f "$base.state" ] && echo "$base.state" || echo /dev/null)" > "$out" || true
      # A log that would not parse keeps where it was.
      if grep -q '^{"t":"state"' "$out"; then
        grep -v '^{"t":"state"' "$out" >> "$base.rows" || true
        grep '^{"t":"state"' "$out" | jq -c 'del(.t)' > "$base.state"
        jq -c '(.open // empty), (.sample // empty)' "$base.state" > "$base.open"
        # What has passed 30 days goes as the log goes on.
        jq -c --argjson since "$SINCE" 'select(.k == "first" or .ts >= $since)' "$base.rows" > "$out" && mv "$out" "$base.rows"
        read_to="$end"
      fi
      rm -f "$out"
    fi
    printf '%s %s %s\n' "$read_to" "$size" "$mark" > "$base.meta"
  fi
  cat "$base.rows" "$base.open" 2>/dev/null || true
}

# A log untouched for over 30 days holds no request of the last 30. Each log gets a line: its size, its id, how much is
# new in it, its scope and its path; what is new adds up to the whole of the reading, for the progress.
TOTAL=0
while read -r scope f; do
  size="$(stat -f '%z' "$f" 2>/dev/null || stat -c '%s' "$f")"
  id="$(printf '%s' "$f $scope $SCRIPT" | cksum | cut -d' ' -f1)"
  read_to=0; seen_size=-1
  [ ! -f "$CACHE/rows/$id.meta" ] || read -r read_to seen_size _ < "$CACHE/rows/$id.meta"
  new=0
  if [ "$size" != "$seen_size" ]; then
    new=$((size - read_to))
    [ "$new" -ge 0 ] || new="$size"
  fi
  TOTAL=$((TOTAL + new))
  printf '%s %s %s %s %s\n' "$size" "$id" "$new" "$scope" "$f" >> "$LOGS"
done < <(
  find ~/.claude/projects/$PROJ -maxdepth 1 -type f -name '*.jsonl' -mtime -31 2>/dev/null | sed 's/^/main /'
  find ~/.claude/projects/$PROJ -type f -path '*/subagents/*' -name '*.jsonl' -mtime -31 2>/dev/null | sed 's/^/subagent /'
)
progress() { [ -z "${AUTOCOMPACT_PROGRESS:-}" ] || echo "progress $*" >&2; }
DONE=0
[ "$TOTAL" = 0 ] || progress reading 0 "$TOTAL"
while read -r size id new scope f; do
  rows_of "$size" "$id" "$scope" "$f"
  if [ "$new" -gt 0 ]; then
    DONE=$((DONE + new))
    progress reading "$DONE" "$TOTAL"
  fi
done < "$LOGS" > "$ROWS"
progress computing
# What no log needs any more goes: past 30 days, changed or deleted. A run over one project knows only that project's.
if [ "$PROJ" = '*' ]; then
  ls "$CACHE/rows" | sed 's/\..*//' | sort -u | grep -vxFf "$SEEN" | while IFS= read -r stale; do rm -f "$CACHE/rows/$stale".*; done || true
fi

mkdir -p "$CACHE"
jq -sc --argjson current "$CURRENT" --argjson now "$(date +%s)" '
  # Prices per million. Haiku goes dearer past 100K of input; the formula takes its base price.
  def PRICES: {opus: {id: "claude-opus-5-5", read: 0.20, write5m: 5, write1h: 8, out: 20}, sonnet: {id: "claude-sonnet-5-5", read: 0.20, write5m: 2.5, write1h: 4, out: 10},
               fable: {id: "claude-fable-5-1", read: 0.25, write5m: 12.5, write1h: 20, out: 50}, haiku: {id: "claude-haiku-5-5", read: 0.01, write5m: 0.125, write1h: 0.2, out: 0.5}};
  def BUFFER: 33000;     # the compact buffer: auto-compact fires this far below the window, and a summary is taken to fill it
  def FULL: 1000000;     # the largest window there is
  def FLOOR: 200000;     # no setting is advised below this
  def LONG: 200000;      # a session that reaches this is one a compaction serves
  def REWORK: 15;        # the requests after a compaction watched for files read again, and left out of the growth
  def CHARS: 3.5;        # characters to a token, for the summary text and what a Read brought back
  def OUT_PER_TEXT: 2;   # the analysis a compaction writes before its summary is dropped from the log; taken as long again
  def SPIKE: 50000;      # a first request after a compaction this far over the next one is not what the compaction left
  def BAND: 1.01;        # the range costing no more than this over the lowest
  def WEIGHT: {"1": 8, "7": 5, "30": 3};
  def KINDS: ["interactive", "print", "subagent"];

  def family: if . == null then null elif test("opus") then "opus" elif test("sonnet") then "sonnet" elif test("fable") then "fable" elif test("haiku") then "haiku" else null end;
  def mean: if length == 0 then null else add / length end;
  def median: sort | length as $n | if $n == 0 then null elif $n % 2 == 1 then .[($n - 1) / 2] else (.[$n / 2 - 1] + .[$n / 2]) / 2 end;
  def peak: . as $a | [range(0; $a | length) as $i | $a[([$i - 1, 0] | max):($i + 2)] | median] | max;
  def since($d): $now - $d * 86400;
  # To 10K, a 5K exactly to the even ten; never below the floor.
  def tenK: (. / 10000) as $q | ($q | floor) as $f
    | (if (($q - $f - 0.5) | fabs) < 1e-9 then (if $f % 2 == 0 then $f else $f + 1 end) else ($q | round) end) * 10000 | [., FULL] | min | [., FLOOR] | max;

  # Each log on its own, in order: its first request, its stretches between compactions, its compactions.
  [group_by(.file)[] | sort_by([.n, ({r: 0, x: 1, c: 2, i: 3}[.t])]) as $rows
    | ($rows | map(.group // empty) | first // "interactive") as $kind
    | ($rows | map(select(.t == "r") | . + {fam: (.model | family)} | select(.fam != null))) as $reqs
    | ($rows | map(select(.t == "c"))) as $cs
    | ($rows | map(select(.t == "x"))) as $xs
    | ($cs | map(.n)) as $cut
    | {
        inits: [$reqs[] | select(.k == "first" and (.resumed | not) and .ts >= since(30)) | {ts, model: .fam, kind: $kind, ctx, peak: ($reqs | map(.ctx) | peak)}],
        # Between two compactions, less the requests after the first that go to rework: from the median of its first three
        # requests to that of its last three, so a spike that falls back cancels.
        stretches: [range(0; ($cut | length) + 1) as $j
          | (if $j == 0 then -1 else $cut[$j - 1] + REWORK end) as $lo
          | (if $j == ($cut | length) then 1e18 else $cut[$j] end) as $hi
          | [$reqs[] | select(.n > $lo and .n <= $hi)] as $s
          | select(($s | length) >= 4 and ($s | last | .ts) >= since(30))
          | ($s | map(.ctx)) as $c
          | {ts: ($s | last | .ts), model: $s[0].fam, kind: $kind, grow: ([($c[-3:] | median) - ($c[:3] | median), 0] | max), n: (($s | length) - 3), peak: ($c | peak)}],
        comps: [range(0; $cs | length) as $j | $cs[$j] as $k
          | select($k.after != null and $k.ts >= since(30) and ($k.model | family) != null)
          | (if $j == 0 then -1 else $cs[$j - 1].n end) as $prev
          | ([$reqs[] | select(.n > $k.n)] | first) as $next
          | (if $next != null and $k.after - $next.ctx > SPIKE then {after: $next.ctx, write: null} else {after: $k.after, write: $k.cc} end) as $a
          | [$xs[] | select(.n > $prev and .n <= $k.n) | .path] as $before
          | [$xs[] | select(.n > $k.n and .n <= $k.n + REWORK) | select(.path as $p | any($before[]; . == $p))] as $again
          | {ts: $k.ts, model: ($k.model | family), kind: $kind, after: $a.after, write: $a.write,
             summary: (if $k.summaryChars then $k.summaryChars / CHARS else null end),
             again: (($again | map(.size) | add // 0) / CHARS), againN: ($again | map(.n) | unique | length)}],
        writes: [$reqs[] | select(.ts >= since(30)) | {fam, w5, w1}]
      }] as $logs
  | [$logs[].inits[]] as $inits | [$logs[].stretches[]] as $stretches | [$logs[].comps[]] as $comps
  | ([$logs[].writes[]] | group_by(.fam) | map({key: .[0].fam, value: {w5: (map(.w5) | add), w1: (map(.w1) | add)}}) | from_entries) as $writes

  # One input of one model and mode over one span, from what its tier lets in. Loose: every mode of the model, 30 days.
  | def keep($part; $tier): if $tier == "all" then true elif $tier == "mid" then .n >= 7
      elif $part == "init" then (.peak // 0) >= LONG else .peak >= LONG and .n >= 7 end;
    def tiers($part): {init: ["long", "all"], grow: ["long", "mid", "all"], comp: ["all"]}[$part];
    def normal: if length == 0 then null else
        map(log) as $l | ($l | mean) as $m | ($l | map(. - $m | . * .) | mean | sqrt) as $sd
        | [.[] | select($sd == 0 or (((log - $m) | fabs) <= 2 * $sd))] as $kept
        | {ctx: ($kept | mean), n: length, dropped: (length - ($kept | length))} end;
    def measure($part; $model; $kind; $d; $loose; $tier):
      def fit: .model == $model and .ts >= since($d) and keep($part; $tier) and ($loose or .kind == $kind);
      if $part == "init" then
        # A first prompt can be most of a first request: what lies 2 deviations out among the model of every mode is such a prompt.
        [$inits[] | select(.model == $model and .ts >= since(30) and keep("init"; $tier)) | .ctx | log] as $all
        | ($all | mean) as $m | ($all | if length == 0 then 0 else map(. - $m | . * .) | mean | sqrt end) as $sd
        | [$inits[] | select(fit) | .ctx] as $list
        | [$list[] | select($sd == 0 or (((log - $m) | fabs) <= 2 * $sd))] | normal
        | if . == null then null else . + {n: ($list | length)} end
      elif $part == "comp" then
        [$comps[] | select(fit)] | if length == 0 then null else {again: (map(.again) | mean), againN: (map(.againN) | mean), n: length} end
      else
        [$stretches[] | select(fit)] | (map(.n) | add // 0) as $n
        | if $n == 0 then null else {g: ((map(.grow) | add) / $n), n: length} end
      end;
    # Each span on its own, averaged 8:5:3 over the spans that have it; none: borrowed from the loose; nothing in the tier: the next.
    def settle($part; $model; $kind; $keys):
      first(tiers($part)[] as $tier
        | [[1, 7, 30][] as $d | measure($part; $model; $kind; $d; false; $tier) | select(. != null) | {d: $d, x: .}] as $have
        | if ($have | length) > 0 then
            ($have | map(WEIGHT[.d | tostring]) | add) as $w
            | reduce $keys[] as $key ({tier: $tier}; .[$key] = (($have | map(.x[$key] * WEIGHT[.d | tostring]) | add) / $w))
          else measure($part; $model; $kind; 30; true; $tier) | select(. != null) | . + {tier: $tier, borrowed: true} end) // null;
    # What a compaction writes out, and the share of what it leaves that is written to the cache again: the model, else every model, else the bound.
    def mechanic($model):
      [$comps[] | select(.ts >= since(30))] as $recent
      | def sizes($list): {out: ([$list[] | .summary // empty] | if length > 0 then mean * OUT_PER_TEXT else null end), ratio: ([$list[] | select(.write != null) | .write / .after] | mean)};
        sizes([$recent[] | select(.model == $model)]) as $own | sizes($recent) as $all
      | {out: ($own.out // $all.out // BUFFER), ratio: ($own.ratio // $all.ratio // 1)};
    def growth($model; $kind; $isLong): [$stretches[] | select(.model == $model and .kind == $kind and (($isLong | not) or .peak >= LONG)) | .grow] | add // 0;
    def own($model; $kind): any(([1, 7, 30][] as $d | (tiers("init")[] as $t | measure("init"; $model; $kind; $d; false; $t)), (tiers("grow")[] as $t | measure("grow"; $model; $kind; $d; false; $t))); . != null);
    # A model and the modes it is used in, each weighed by how much its long sessions grow: the progress a compaction serves.
    def inputs($model):
      [KINDS[] as $kind | select(own($model; $kind))
        | settle("init"; $model; $kind; ["ctx"]) as $init | settle("grow"; $model; $kind; ["g"]) as $grow
        | (settle("comp"; $model; $kind; ["again", "againN"]) // {again: 0, againN: 0, none: true}) as $comp
        | select($init != null and $grow != null)
        | {kind: $kind, ctx: $init.ctx, g: $grow.g, again: $comp.again, againN: $comp.againN,
           long: growth($model; $kind; true), any: growth($model; $kind; false),
           isShort: ($init.tier != "long" or $grow.tier != "long"), isBorrowed: (($init.borrowed // false) or ($grow.borrowed // false) or ($comp.borrowed // false)), hasNoCompactions: ($comp.none // false)}] as $modes
      | if ($modes | length) == 0 then null else
          ($modes | map(.long) | add) as $l | ($modes | map(.any) | add) as $a
          | mechanic($model) as $mech | ($writes[$model] // {w5: 0, w1: 0}) as $wr
          | {model: $model, long: $l, any: $a, out: $mech.out, ratio: $mech.ratio, share: (if $wr.w5 + $wr.w1 > 0 then $wr.w1 / ($wr.w5 + $wr.w1) else 0 end),
             modes: ($modes | map(. + {weight: (if $l > 0 then .long / $l elif $a > 0 then .any / $a else 1 / ($modes | length) end)}))} end;

    # Per 1M tokens of progress, at every window of the grid: for a mode, the formula; for a model, its modes weighed and summed.
    [range(BUFFER + 1000; FULL + 1; 1000)] as $grid
    | def curve($x):
        PRICES[$x.model] as $p
        | ($p.write5m * (1 - $x.share) + $p.write1h * $x.share) as $write
        | ($p.out / $p.read) as $o | ($write / $p.read) as $w
        | [$x.modes[] | select(.weight > 0) | . as $m
            | ($m.ctx + BUFFER) as $after | ($after + $m.again) as $base
            | ($base + $w * ($x.ratio * $after + $m.again) + $o * $x.out + $m.againN * ($after + $m.again / 2)) as $k
            # Below where the mode starts, every request compacts: a round is one request long.
            | {base: $base, cost: [$grid[] | ([. - BUFFER - $base, $m.g] | max) as $round | $m.weight * $p.read * ($base / $m.g + $round / (2 * $m.g) + 1 + $k / $round)]}] as $parts
        | {from: (($parts | map(.base) | min) + BUFFER + 1000), cost: [range(0; $grid | length) as $i | $parts | map(.cost[$i]) | add]};
      def lowest($c):
        [range(0; $grid | length) | select($grid[.] >= $c.from)] as $idx
        | ($idx | min_by($c.cost[.])) as $b | $c.cost[$b] as $best
        | (first(range($b; -1; -1) | select($grid[.] < $c.from or $c.cost[.] > $best * BAND)) // -1) as $lo
        | (first(range($b; $grid | length) | select($c.cost[.] > $best * BAND)) // ($grid | length)) as $hi
        | {at: $b, computed: $grid[$b], best: $best, lo: $grid[$lo + 1], hi: $grid[$hi - 1]};

    [["opus", "sonnet", "fable", "haiku"][] | inputs(.) | select(. != null) | . + {curve: curve(.)} | . + {lowest: lowest(.curve)}] as $models
  | if ($models | length) == 0 then {current: $current, global: null, byModel: []} else
      # The global serves every model without one of its own: the models weighed as the modes are, summed in dollars.
      ($models | map(.long) | add) as $l | ($models | map(.any) | add) as $a
      | ($models | map(. + {weight: (if $l > 0 then .long / $l elif $a > 0 then .any / $a else 1 / ($models | length) end)})) as $models
      | {from: ($models | map(.curve.from) | min), cost: [range(0; $grid | length) as $i | $models | map(.weight * .curve.cost[$i]) | add]} as $g
      | lowest($g) as $gl | ($gl.computed | tenK) as $top
      | {current: $current,
         global: {window: $top, computed: $gl.computed, lo: $gl.lo, hi: $gl.hi},
         byModel: [$models[] | (.lowest.computed | tenK) as $own
           # A model whose own falls at or below the global follows it: the formula leans low, its rework only partly measured.
           | {model, id: PRICES[.model].id, weight, computed: .lowest.computed, own: $own, follows: ($own <= $top), window: ([$own, $top] | max),
              costsMoreAtGlobal: ((.curve.cost[$gl.at] / .lowest.best - 1) * 1000 | round / 10),
              modes: (.modes | map({key: .kind, value: (.weight * 100 | round)}) | from_entries),
              isShort: any(.modes[]; .weight > 0 and .isShort), isBorrowed: any(.modes[]; .isBorrowed), hasNoCompactions: all(.modes[]; .hasNoCompactions)}]}
    end' "$ROWS" > "$CACHE/settings.json"
printf '%s\n' "$KEY" > "$CACHE/settings.key"
cat "$CACHE/settings.json"
