#!/usr/bin/env bash
# Recommend a Claude Code auto-compact setting from real usage, over the last 30, 7 and 1 days (24-hour days, by request time).
#
# Usage: bash recommend.sh [--json | --settings] [--here | PROJECT_GLOB=*]
#   --json        print the records report.sh writes for the page, instead of the report
#   --settings    print what to set as JSON: overall, and by model for Sonnet, Opus and Fable
#   --here        only the project of the current directory
#   PROJECT_GLOB  directory name pattern under ~/.claude/projects (quote it; names start with "-")
#
# Usage comes from main-session logs only: ~/.claude/projects/<project>/*.jsonl.
# Subagent transcripts live under <project>/<session>/subagents/; only their compactions are read.
# Needs bash, jq (1.6+).
set -euo pipefail
command -v jq >/dev/null || { echo "recommend.sh: jq not found (needs jq 1.6+)" >&2; exit 2; }
MODE=text
if [ "${1:-}" = "--json" ]; then MODE=json; shift; elif [ "${1:-}" = "--settings" ]; then MODE=settings; shift; fi
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
    (setting("DISABLE_COMPACT") | truthy) as $noCompact
  | (setting("DISABLE_AUTO_COMPACT") | truthy) as $noAuto
  | (setting("CLAUDE_CODE_AUTO_COMPACT_WINDOW") // $s.autoCompactWindow | number) as $win
  | (setting("CLAUDE_AUTOCOMPACT_PCT_OVERRIDE") | number) as $pct
  | ($win // 1000000) as $window
  | ([$window - 33000] + (if $pct then [($window * $pct / 100 | floor)] else [] end) | min) as $fire
  | def fire_at($w): [$w - 33000] + (if $pct then [($w * $pct / 100 | floor)] else [] end) | min;
    {isOff: ($noCompact or $noAuto or $s.autoCompactEnabled == false), window: $win, pct: $pct, fire: $fire,
     windowInEnv: (setting("CLAUDE_CODE_AUTO_COMPACT_WINDOW") != null),
     idleOff: ($s.idleCompaction == false),
     models: (if setting("CLAUDE_CODE_AUTO_COMPACT_WINDOW") then {} else
       ($s.modelSettings // {}) | to_entries | map(select(.value.autoCompactWindow | number) | {
         key: (.key | if test("opus") then "opus" elif test("sonnet") then "sonnet" elif test("fable") then "fable" elif test("haiku") then "haiku" else "other" end),
         value: fire_at(.value.autoCompactWindow | number)}) | from_entries end)}' ${settings[@]+"${settings[@]}"} </dev/null)

read_log() {
  local f="$1" scope="$2"
  jq -nc --arg file "$f" --arg scope "$scope" '
    def epoch: sub("\\.[0-9]+Z$"; "Z") | fromdate;
    def close: if .open then .rows += [.open] | .open = null else . end;
    reduce inputs as $e (
      {seen: {}, first: true, skip: false, init: null, last: null, lastModel: null, open: null, rows: [], cg: 0, co: 0, cn: 0};
      if ($e.type == "system" and $e.subtype == "compact_boundary") then
        ($e.timestamp | epoch) as $t
        | ((if .last then ($t - .last) / 60 else 0 end)) as $idle
        | ($e.compactMetadata) as $m
        | close
        | .open = {t: "c", scope: $scope, file: $file, model: .lastModel, init: .init, ts: $t, pre: $m.preTokens, summary: $m.postTokens, after: null, write: null, idle: $idle,
                   kind: (if $m.trigger == "manual" then "manual"
                          elif ($idle >= 50 and $m.preTokens >= 200000) then "idle"
                          else "threshold" end),
                   cycle: (if .cn > 0 and .co > 0 then .cg / .co else null end)}
        | .skip = true | .cg = 0 | .co = 0 | .cn = 0
      elif ($e.type == "user" and $e.isCompactSummary == true) then .skip = true      # first request after a compaction is the summary write, not a normal turn
      elif ($e.type == "assistant" and ($scope != "main" or ($e.isSidechain | not))
            and ($e.message.usage? != null) and ($e.message.id? != null)
            and ($e.message.model != "<synthetic>")
            and (.seen[$e.message.id] | not)) then                                     # one API request = one message id (streamed entries repeat it)
        .seen[$e.message.id] = true
        | ($e.message.usage) as $u
        | (($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0)) as $g
        | ($g + ($u.cache_read_input_tokens // 0)) as $ctx
        | ($u.output_tokens // 0) as $o
        | ($e.timestamp | epoch) as $t
        | .lastModel = $e.message.model
        | if .first then
            .init = $ctx | .first = false | .skip = false
            | .rows += [{t: "r", k: "first", file: $file, ts: $t, g: $g, o: $o, ctx: $ctx, init: $ctx, model: $e.message.model, i: ($u.input_tokens // 0), w5: ($u.cache_creation.ephemeral_5m_input_tokens // 0), w1: ($u.cache_creation.ephemeral_1h_input_tokens // 0)}]
          elif .skip then
            .skip = false
            | if .open and .open.after == null then .open.after = $ctx | .open.write = $g | .open.model = $e.message.model else . end
          else
            .cg += $g | .co += $o | .cn += 1
            | .rows += [{t: "r", k: "normal", file: $file, ts: $t, g: $g, o: $o, ctx: $ctx, init: .init, model: $e.message.model, i: ($u.input_tokens // 0), w5: ($u.cache_creation.ephemeral_5m_input_tokens // 0), w1: ($u.cache_creation.ephemeral_1h_input_tokens // 0)}]
          end
      else . end
      | if ($e.timestamp? != null and ($e.type == "user" or $e.type == "assistant") and ($e.isCompactSummary != true)) then .last = ($e.timestamp | epoch) else . end
    ) | close | .rows[] | select($scope == "main" or .t == "c")' "$f" 2>/dev/null || true
}

ROWS="$(mktemp)"
trap 'rm -f "$ROWS"' EXIT
{
  for f in ~/.claude/projects/$PROJ/*.jsonl; do
    # A file untouched for over 30 days holds no request of the last 30.
    [ -n "$(find "$f" -mtime -31 2>/dev/null)" ] || continue
    read_log "$f" main
  done
  find ~/.claude/projects/$PROJ -type f -path '*/subagents/*' -name '*.jsonl' -mtime -31 -exec grep -l '"compact_boundary"' {} + 2>/dev/null \
    | while IFS= read -r f; do read_log "$f" subagent; done || true
} > "$ROWS"

analyse() {
jq -sr --arg only "$1" --arg mode "$MODE" --argjson current "$CURRENT" --arg here_dir "$HERE_DIR" --arg here_name "$(basename "$ROOT")" '
  # Prices per million: cached read, 1h cache write, output. references/model.md says how they enter.
  def PRICES: {sonnet: {id: "claude-sonnet-5-5", name: "Sonnet 5.5", input: 2, read: 0.20, write5m: 2.5, write1h: 4, out: 10}, opus: {id: "claude-opus-5-5", name: "Opus 5.5", input: 4, read: 0.20, write5m: 5, write1h: 8, out: 20}, fable: {id: "claude-fable-5-1", name: "Fable 5.1", input: 10, read: 0.25, write5m: 12.5, write1h: 20, out: 50}};
  # Haiku changes price past 100k of input, which a sum cannot carry; its share is small, so the setting leaves it out and the chart walks it.
  def HAIKU: {id: "claude-haiku-5-5", name: "Haiku 5.5", input: 0.1, read: 0.01, write5m: 0.125, write1h: 0.2, out: 0.5, over: 100000, above: {input: 0.5, read: 0.05, write5m: 0.625, write1h: 1, out: 2.5}};
  def ENOUGH: 30;        # compactions it takes to trust a normal value
  def BUFFER: 33000;     # /context shows auto-compact firing this far below the window
  def FLOOR: 200000;     # a setting is not advised below this: the cost does not price what a compaction loses
  def FULL: 1000000;     # what the context is compared at: the work it takes to fill this

  def mean: if length == 0 then null else add / length end;
  def over($a; $b): if ($b // 0) == 0 then null else ($a // 0) / $b end;
  def median: if length == 0 then null else sort | if length % 2 == 1 then .[length / 2 | floor] else (.[length / 2 - 1] + .[length / 2]) / 2 end end;
  # Per-request tokens are close to log-normal, so their normal values are taken in log space.
  def logs: map(select(. > 0) | log);
  def geo: logs | if length == 0 then null else (add / length | exp) end;
  # The input and output of a request belong together: either more than 2 deviations out drops the pair, once, and both means come from the pairs kept.
  def request_normal:
    map(select(.g > 0 and .o > 0)) as $pairs
    | if ($pairs | length) == 0 then {g: null, o: null, n: 0, kept: []} else
        def stats($a): ($a | add / length) as $m | {m: $m, s: (if ($a | length) > 1 then ($a | map(pow(. - $m; 2)) | add / (($a | length) - 1) | sqrt) else 0 end)};
        stats($pairs | map(.g | log)) as $gs | stats($pairs | map(.o | log)) as $os
        | def within($v; $st): $st.s == 0 or ((($v | log) - $st.m) / $st.s | fabs) <= 2;
        ($pairs | map(select(within(.g; $gs) and within(.o; $os)))) as $near
        | (if ($pairs | length) >= 3 and ($near | length) >= 3 then $near else $pairs end) as $kept
        | {g: ($kept | map(.g | log) | add / length | exp), o: ($kept | map(.o | log) | add / length | exp), n: ($kept | length), kept: $kept}
      end;
  def skewlog: logs | if length < 3 then null else (add / length) as $m | (map(pow(. - $m; 2)) | add / length | sqrt) as $s
    | if $s == 0 then 0 else (map(pow((. - $m) / $s; 3)) | add / length) end end;

  def k: if . == null then "-" else (. / 1000 * 100 | round / 100 | tostring) + "K" end;
  def x: if . == null then "-" else (. * 10 | round / 10 | tostring) + "x" end;
  def num: if . == null then "-" else (. * 100 | round / 100 | tostring) end;
  def range_x: if length == 0 then "-" else "\(min | x)-\(max | x)" end;

  # The work it takes the context to reach 1M without compacting, at the input and output measured.
  # A compaction leaves a summary and sends the initial context again: its summary is a fixed size, or what was compacted over a ratio.
  def left($c; $v):
    (if $v.n.model == "ratio" then (([$c - $v.i, 0] | max) / $v.n.ratio) else $v.n.summary end) as $s
    | {summary: $s, after: ($s + ([$v.n.after - $v.n.summary, 0] | max)), write: ([$s + $v.n.write - $v.n.summary, 0] | max)};
  def requests($v): ((FULL - $v.o - $v.i) / $v.g | floor) + 1 | if . < 1 then 1 else . end;
  # That many requests under trigger T: the tokens they read and the compactions they need.
  def plan($T; $v):
    {left: requests($v), c: $v.i, reads: 0, compactReads: 0, summaries: 0, writes: 0, n: 0}
    | until(.left <= 0;
        (if .c >= $T then 0 else (($T - .c) / $v.g | ceil) end) as $steps
        | ([$steps, .left] | min) as $k
        | .reads += $k * .c + $v.g * $k * ($k - 1) / 2
        | .left -= $k
        | if .left > 0 then
            (.c + $k * $v.g) as $at | left($at; $v) as $l
            # Once a compaction leaves the context where this stretch began, every stretch to come is the same: take them at once.
            | (if $k > 0 and $l.after == .c then ((.left - 1) / $k | floor) else 0 end) as $more
            | .reads += $more * ($k * $l.after + $v.g * $k * ($k - 1) / 2)
            | .left -= $more * $k
            | .compactReads += (1 + $more) * $at | .summaries += (1 + $more) * $l.summary | .writes += (1 + $more) * $l.write | .n += 1 + $more | .c = $l.after
          else . end);
  def cost($p; $plan; $v): requests($v) as $h
    | ($p.write1h * (1 - $v.five) + $p.write5m * $v.five) as $write
    | ($write * $v.i + $p.read * $plan.reads + $h * ($write * ($v.g - $v.uncached) + $p.input * $v.uncached + $p.out * $v.o)
       + $p.read * $plan.compactReads + $p.out * $plan.summaries + $write * $plan.writes) / 1000000;
  def mixed($plan; $v; $share): $share.s * cost(PRICES.sonnet; $plan; $v) + $share.o * cost(PRICES.opus; $plan; $v) + $share.f * cost(PRICES.fable; $plan; $v);
  def first_trigger($v):
    if $v.n.model == "ratio" then
      ([$v.n.after - $v.n.summary, 0] | max) as $rest
      | ([(($rest + $v.g - $v.i / $v.n.ratio) / (1 - 1 / $v.n.ratio)), $v.i + $v.g] | max)
    else $v.n.after + $v.g end;
  def triggers($v): [range((first_trigger($v) / 1000 | ceil); ((FULL - BUFFER) / 1000 + 1)) * 1000];
  def NEVER: 1000000000000;

  def rank: . as $a | ($a | sort) as $s | map(. as $v | ([range(0; $s | length) | select($s[.] == $v)] | add / length));
  def spearman: if length < 3 then null else
      (map(.[0]) | rank) as $x | (map(.[1]) | rank) as $y | ($x | mean) as $mx | ($y | mean) as $my
      | ([range(0; $x | length) | ($x[.] - $mx) * ($y[.] - $my)] | add) as $c
      | (($x | map(pow(. - $mx; 2)) | add) * ($y | map(pow(. - $my; 2)) | add) | sqrt) as $d
      | if $d == 0 then null else $c / $d end end;

  # What was compacted leaves out the initial context, as the summary does; a log that starts past its first request shows it only after the compaction.
  def compacted: .pre - (.init // (if .after != null then .after - .summary else 0 end));
  # A request writes to one cache lifetime or the other, so its share is 0 or 1: each lifetime gets its normal size, and the share is what those sizes come to.
  def log_normal: map(select(. > 0) | log) as $l
    | if ($l | length) == 0 then null else
        ($l | add / length) as $m
        | (if ($l | length) > 1 then ($l | map(pow(. - $m; 2)) | add / (($l | length) - 1) | sqrt) else 0 end) as $s
        | ($l | map(select($s == 0 or (((. - $m) / $s) | fabs) <= 2))) as $near
        | (if ($l | length) >= 3 and ($near | length) >= 3 then $near else $l end) | add / length | exp
      end;
  def five_share:
    (map(select(.w5 > 0)) | {n: length, size: (map(.w5) | log_normal)}) as $five
    | (map(select(.w1 > 0)) | {n: length, size: (map(.w1) | log_normal)}) as $hour
    | (($five.n * ($five.size // 0)) + ($hour.n * ($hour.size // 0))) as $all
    | if $all > 0 then $five.n * ($five.size // 0) / $all else 0 end;
  def project_of: split("/.claude/projects/")[1] | split("/")[0];
  # The last day pulled toward the period normal value by how far it can be trusted: partial pooling on the logs of each day of projects, or sessions when all are one project.
  def recency($now; $base; f):
    def variance: mean as $m | map(pow(. - $m; 2)) | add / (length - 1);
    map(select(f > 0) | {day: ((($now - .ts) / 86400) | floor), session: .file, project: (.file | project_of), v: (f | log)}) as $rows
    | (if ($rows | map(.project) | unique | length) > 1 then "project" else "session" end) as $by
    | ($rows | group_by(.day) | map({day: .[0].day, means: (group_by(.[$by]) | map(map(.v) | add / length))} | .m = (.means | length) | .mean = (.means | add / length))) as $days
    | ($days | map(select(.m > 1))) as $several
    | ($several | map(.m - 1) | add // 0) as $df
    | ($days | map(select(.day == 0)) | .[0]) as $today
    | if $base == null or ($days | length) < 3 or $df == 0 or $today == null then {value: $base, weight: 0} else
        (($several | map((.means | variance) * (.m - 1)) | add) / $df) as $within
        | ([($days | map(.mean) | variance) - $within * ($days | map(1 / .m) | mean), 0] | max) as $between
        | ($between + $within / $today.m) as $noise
        | (if $noise > 0 then [$between / $noise, 0.5] | min else 0 end) as $w
        | {value: (($w * $today.mean + (1 - $w) * ($base | log)) | exp), weight: $w, today: ($today.mean | exp), units: $today.m, by: $by}
      end;
  def family: if test("opus") then "opus" elif test("sonnet") then "sonnet" elif test("fable") then "fable" elif test("haiku") then "haiku" else "other" end;
  # A model without its own price is priced by the one of its name, and said so.
  def price_warnings:
    (PRICES + {haiku: HAIKU}) as $table
    | map(.model) | group_by(.) | map({id: .[0], n: length, family: (.[0] | family)})
    | map(select(.id != ($table[.family].id // "")))
    | map(if $table[.family] then "\(.id) (\(.n) requests) has no price of its own: estimated at \($table[.family].name)"
          else "\(.id) (\(.n) requests) has no price: left out of the cost" end);
  def ratio_pure: select(.summary > 0 and compacted > 0) | compacted / .summary;
  def ratio_full: select(.after != null and .after > 0) | .pre / .after;

  now as $now
  # One model alone keeps the compactions of that model; with none of its own, all of them.
  | def mine: $only == "" or ((.model // "") | family) == $only;
    map(select(.t == "c")) as $allComps
  | ($allComps | map(select(.scope == "main"))) as $allMain
  | map(select(.t == "r" and .k == "first")) as $allFirst
  | map(select(.t == "r" and mine)) as $reqs
  | (if ($allComps | map(select(mine)) | length) > 0 then ($allComps | map(select(mine))) else $allComps end) as $own
  | ($own | map(select(.scope == "main"))) as $comps
  | ($own | map(select(.scope == "subagent"))) as $subComps
  | ($comps | map(select(.ts >= $now - 30 * 86400))) as $comps30

  # Each compaction has its own ratio and size. In log space: what is more than 2 deviations out is dropped, once, and the mean is the normal value.
  | def spread($list):
      ($list | map(select(. > 0) | log)) as $l
      | def stats($a): ($a | add / length) as $m | {m: $m, s: (if ($a | length) > 1 then ($a | map(pow(. - $m; 2)) | add / (($a | length) - 1) | sqrt) else 0 end)};
      if ($l | length) == 0 then null else
        stats($l) as $all
        | ($l | map(select($all.s == 0 or (((. - $all.m) / $all.s) | fabs) <= 2))) as $near
        | (if ($l | length) >= 3 and ($near | length) >= 3 then $near else $l end) as $kept
        | stats($kept) as $k
        | {n: ($kept | length), normal: ($k.m | exp), sd: $k.s}
      end;
    def assumption($c):
      ($c | map(select(compacted > 0))) as $rows
      | spread($rows | map(compacted / .summary)) as $ratio | spread($rows | map(.summary)) as $size
      | {ratio: $ratio, size: $size,
         model: (if $ratio and $size and $ratio.n >= 3 and $ratio.normal > 1 and $ratio.sd < 0.9 * $size.sd then "ratio" else "fixed" end)};
    def near($c; $normal; $firsts):
      assumption($c) as $how | (($how.size // {}).normal) as $s
      # What a compaction sends again holds the initial context of its own agent, and the cost follows the main session.
      | (($c | map(select(.scope == "main"))) as $main | if ($main | length) > 0 then $main else $allMain end) as $sent
      | ($sent | map(select(.after != null) | .after) | geo) as $a | ($sent | map(select(.write != null) | .write) | geo) as $w
      | ($firsts | map(.ctx) | median) as $init
      | {summary: ($s // 30000), after: ($a // (($init // 60000) + 30000)), write: ($w // (($init // 60000) + 30000)),
         tooFew: (($c | map(select(compacted > 0)) | length) < ENOUGH), count: ($c | map(select(compacted > 0)) | length),
         model: $how.model, ratio: (($how.ratio // {}).normal), how: $how};

    def report($days):
      ($now - $days * 86400) as $since
      | ($reqs | map(select(.ts >= $since))) as $w
      | ($w | map(select(.k == "normal"))) as $normal
      | ($w | map(select(.k == "first"))) as $firsts
      | ($comps | map(select(.ts >= $since))) as $c
      | ($normal | map(.g)) as $g0 | (($normal + $firsts) | map(.g)) as $g1
      | ($normal | map(.o)) as $o0
      | ($normal | map(.ctx)) as $ctx0 | (($normal + $firsts) | map(.ctx)) as $ctx1
      | ($normal | map((.ctx - .init) | if . < 0 then 0 else . end)) as $ctxNet
      | (($comps + $subComps) | map(select(.ts >= $since))) as $every
      | (if ($every | length) >= 3 then $every else (($comps + $subComps) | map(select(.ts >= $now - 30 * 86400))) end) as $basis
      | near($basis; $normal; $firsts) as $n
      | ($normal | request_normal) as $rn
      | ($rn.g // ($g0 | mean)) as $gPlain | ($rn.o // ($o0 | mean)) as $oPlain
      # Over 30 days the cost leans toward the last day; a shorter period already is the recent one.
      | (if $days == 30 then ($rn.kept | recency($now; $gPlain; .g)) else {value: $gPlain, weight: 0} end) as $gRecent
      | (if $days == 30 then ($rn.kept | recency($now; $oPlain; .o)) else {value: $oPlain, weight: 0} end) as $oRecent
      | $gRecent.value as $gN | $oRecent.value as $oN
      | (($normal | map(.i) | log_normal) // 0) as $uncachedPlain
      | ($normal | map(select(.model | test("sonnet"))) | length) as $ns | ($normal | map(select(.model | test("opus"))) | length) as $no | ($normal | map(select(.model | test("fable"))) | length) as $nf
      | (($ns + $no + $nf) as $t | if $t == 0 then {s: 0.5, o: 0.5, f: 0} else {s: ($ns / $t), o: ($no / $t), f: ($nf / $t)} end) as $share
      | (($firsts | map(.ctx) | median) // ($reqs | map(select(.k == "first") | .ctx) | median) // ($allFirst | map(.ctx) | median)) as $init
      | {five: ((1 - $gRecent.weight) * ($normal | five_share) + $gRecent.weight * ($normal | map(select(.ts >= $now - 86400)) | five_share)),
         uncached: (if $days == 30 then ($rn.kept | recency($now; $uncachedPlain; .i) | .value) else $uncachedPlain end), $gPlain, $oPlain, $gRecent, $oRecent, $days, $w, $normal, $firsts, $c, $g0, $g1, $o0, $ctx0, $ctx1, $ctxNet, $n, $gN, $oN, $share, $basis, $every, $init,
         gRaw: ($g0 | mean), oRaw: ($o0 | mean)};

    def per($v; $share):
      (triggers($v) | map({t: ., plan: plan(.; $v)})) as $all
      | {sonnet: ($all | min_by(cost(PRICES.sonnet; .plan; $v)) | .t),
         opus: ($all | min_by(cost(PRICES.opus; .plan; $v)) | .t),
         fable: ($all | min_by(cost(PRICES.fable; .plan; $v)) | .t),
         mix: ($all | min_by(mixed(.plan; $v; $share)) | .t)};

    def window($t): ($t + BUFFER) | if . > 1000000 then 1000000 elif . < 100000 then 100000 else . end;

    def lines($r):
      ($r.g0 | length) as $count
      | "\($r.days)d · \($r.w | map(.file) | unique | length) sessions · \($count) requests · \($r.c | length) compactions",
        "  new input      with initial: mean \($r.g1 | mean | k) typical \($r.g1 | geo | k)   without initial: mean \($r.g0 | mean | k) typical \($r.g0 | geo | k)",
        "  context sent   with initial: mean \($r.ctx1 | mean | k) typical \($r.ctx1 | geo | k)   without initial: mean \($r.ctxNet | mean | k) typical \($r.ctxNet | geo | k)",
        "  output         mean \($r.o0 | mean | k) typical \($r.o0 | geo | k)   input/output: mean \(over(($r.g0 | mean); ($r.o0 | mean)) | num) typical \(over(($r.g0 | geo); ($r.o0 | geo)) | num)",
        "  initial        median \($r.firsts | map(.ctx) | median | k) over \($r.firsts | length) session starts",
        "  log skew       new input \($r.g0 | skewlog | num)   output \($r.o0 | skewlog | num)   (0 = normal in log space)",
        (["manual", "threshold", "idle"][] as $kind
          | ($r.c | map(select(.kind == $kind))) as $x
          | "  \($kind)\(" " * (13 - ($kind | length)))n=\($x | length)  pure \($x | map(ratio_pure) | geo | x) (\($x | map(ratio_pure) | range_x))  with initial \($x | map(ratio_full) | geo | x) (\($x | map(ratio_full) | range_x))  summary \($x | map(.summary) | geo | k)  after \($x | map(select(.after != null) | .after) | geo | k)"),
        (($subComps | map(select(.ts >= $now - $r.days * 86400))) as $x
          | if ($x | length) == 0 then empty else "  subagent     n=\($x | length)  pure \($x | map(ratio_pure) | geo | x) (\($x | map(ratio_pure) | range_x))  with initial \($x | map(ratio_full) | geo | x) (\($x | map(ratio_full) | range_x))  summary \($x | map(.summary) | geo | k)  after \($x | map(select(.after != null) | .after) | geo | k)" end),
        (($r.g0 | length) as $n0
          | if $n0 == 0 or ($r.gN // 0) <= 0 or ($r.oN // 0) <= 0 then "  no requests in this window" else
            {g: $r.gN, o: $r.oN, n: $r.n, i: $r.init, five: $r.five, uncached: ([$r.uncached, $r.gN] | min)} as $v
            | per($v; $r.share) as $near
            | per({g: $r.gRaw, o: $r.oRaw, n: $r.n, i: $r.init, five: $r.five, uncached: ([$r.uncached, $r.gRaw] | min)}; $r.share) as $raw
            | "  normal request new input \($r.gN | k) output \($r.oN | k) input/output \(over($r.gN; $r.oN) | num)   cache 5m \($r.five * 100 | round)%   summary \($r.n.summary | k) after \($r.n.after | k) cache write \($r.n.write | k)\(if ($r.every | length) < 3 then "   (compaction figures from 30d)" else "" end)",
              (if $r.n.count == 0 then "  no compactions  nothing measured to compute from" else empty end),
              (if $r.days == 30 then "  last day       input \($r.gRecent.today | k) at \($r.gRecent.weight * 100 | round)% of \($r.gPlain | k)   output \($r.oRecent.today | k) at \($r.oRecent.weight * 100 | round)% of \($r.oPlain | k)   (\($r.gRecent.units // 0) \($r.gRecent.by // "units") that day, 50% at most)" else empty end),
              (if $r.n.count == 0 then empty else "  each compaction  ratio \($r.n.how.ratio.normal | x) (log sd \($r.n.how.ratio.sd | num))  size \($r.n.how.size.normal | k) (log sd \($r.n.how.size.sd | num))  → \(if $r.n.model == "ratio" then "cost uses the ratio" else "cost uses the size" end)\(if $r.n.tooFew then ", only \($r.n.count), under \(ENOUGH): for reference" else "" end)" end),
              (if $r.n.count == 0 then empty else "  ratio at T     pure \(($near.mix - $r.init) / $r.n.summary | x) with initial \($near.mix / $r.n.after | x)" end),
              (if $r.n.count == 0 then empty else "  to fill 1M     \(requests($v)) requests: off $\(mixed(plan(NEVER; $v); $v; $r.share) | num), at the setting $\(mixed(plan($near.mix; $v); $v; $r.share) | num) with \(plan($near.mix; $v).n) compactions" end),
              (if $r.n.count == 0 then empty else "  model mix      \($r.share.s * 100 | round)% Sonnet, \($r.share.o * 100 | round)% Opus, \($r.share.f * 100 | round)% Fable   raw means give \(window($raw.mix) | k)" end),
              (if $r.n.count == 0 then empty else "  setting        autoCompactWindow = \(window($near.mix) | k)  (this usage at Sonnet prices \(window($near.sonnet) | k), Opus \(window($near.opus) | k), Fable \(window($near.fable) | k))" end)
            end);

    # The setting for the initial context of the latest sessions: what a compaction leaves behind moves with it.
    def for_now($a):
      (($reqs | map(select(.k == "first"))) as $mine | (if ($mine | length) > 0 then $mine else $allFirst end) | sort_by(.ts) | .[-5:] | map(.ctx) | median) as $now_init
      | ($a.firsts | map(.ctx) | median // $now_init) as $base
      | ($now_init - $base) as $d
      | {base: $base, init: $now_init, n: {summary: $a.n.summary, model: $a.n.model, ratio: $a.n.ratio, tooFew: $a.n.tooFew,
           after: ([$a.n.after + $d, $a.n.summary] | max), write: ([$a.n.write + $d, 0] | max)}}
      | . + {v: {g: $a.gN, o: $a.oN, n: .n, i: $now_init, five: $a.five, uncached: ([$a.uncached, $a.gN] | min)}}
      | . + {near: per(.v; $a.share)};

    def in_force:
      if $current.isOff then "off"
      else "autoCompactWindow \(($current.window // FULL) | k)\(if $current.pct then " at \($current.pct)% (/context does not show a percentage, so unconfirmed)" else "" end)" end
      + (if $current.idleOff then ", idle compaction off" else "" end)
      + ($current.models | to_entries | map(", \(.key) \(.value + BUFFER | k)") | join(""));

    # The lowest cost, raised to the floor when a change is on the table: not for a user told only to keep watching.
    def advised($a; $f; $nowT):
      ($current.window != null or $current.pct != null or (if $only == "" then ($current.models | length) > 0 else $current.models[$only] != null end)) as $hasNumber
      | (window($f.near.mix) < FLOOR and ($a.n.tooFew | not or $hasNumber)) as $floored
      | (if $floored then [FLOOR - BUFFER, first_trigger($f.v)] | max else $f.near.mix end) as $fire
      | {$hasNumber, $floored, $fire, lowest: window($f.near.mix),
         more: (mixed(plan($nowT; $f.v); $f.v; $a.share) / mixed(plan($fire; $f.v); $f.v; $a.share) * 100 - 100)};

    if ($reqs | length) == 0 then (if $mode == "text" then "no requests in the logs" else "null" end)
    elif $mode == "settings" then
      report(30) as $a
      | if ($a.gN // 0) <= 0 or ($a.oN // 0) <= 0 then {model: $only, id: ((PRICES[$only] // {}).id), requests: ($a.normal | length), compactions: $a.n.count, tooFew: $a.n.tooFew, window: null} | tojson else
      for_now($a) as $f
      | (if $current.isOff then NEVER else ($current.models[$only] // $current.fire) end) as $nowT
      | advised($a; $f; $nowT) as $d
      | {model: $only, id: ((PRICES[$only] // {}).id), requests: ($a.normal | length), compactions: $a.n.count, tooFew: $a.n.tooFew,
         window: (if $a.n.count == 0 then null else window($d.fire) end), lowest: (if $a.n.count == 0 then null else $d.lowest end),
         floored: $d.floored, costsMore: (if $current.isOff then null else ($d.more | round) end), hasNumber: $d.hasNumber} | tojson end
    elif $mode == "json" then
      # Records, not names: the page filters and computes them, and learns of a project only a number and whether it is the current one.
      def is_here: project_of | . == $here_dir or startswith($here_dir + "--");
      ($now - 30 * 86400) as $since
      | ($reqs | map(select(.ts >= $since or .k == "first"))) as $rows
      | ($rows | map(.file) | unique) as $files
      | (reduce range(0; $files | length) as $i ({}; .[$files[$i]] = $i)) as $index
      | ($rows | map(.file | project_of) | unique) as $projects
      | (reduce range(0; $projects | length) as $i ({}; .[$projects[$i]] = $i)) as $projectIndex
      | {now: ($now | floor), hereName: $here_name, prices: (PRICES + {haiku: HAIKU}), buffer: BUFFER, full: FULL, enough: ENOUGH, current: $current,
         requests: ($rows | map([.ts, .g, .o, .ctx, .init, (if .k == "first" then 1 else 0 end), (.model | family), (if .file | is_here then 1 else 0 end), $index[.file], .i, .w5, .w1, .model, $projectIndex[.file | project_of]])),
         compactions: (($comps + $subComps) | map(select(.ts >= $since) | {ts, pre, compacted: compacted, post: .summary, after, write, kind, scope, model: ((.model // "") | family), here: (.file | is_here)}))} | tojson
    else
      report(30) as $a | report(7) as $b | report(1) as $c
      | lines($a), "", lines($b), "", lines($c), "",
        ($comps30 | map(select(.cycle != null and .after != null and .after > 0))) as $cy
        | "does input/output move compression? (Spearman, \($cy | length) compactions in 30d)",
          "  input/output vs pure ratio \($cy | map(select(.summary > 0 and compacted > 0) | [.cycle, compacted / .summary]) | spearman | num)   vs ratio with initial \($cy | map([.cycle, .pre / .after]) | spearman | num)   context before vs pure ratio \($cy | map(select(.summary > 0 and compacted > 0) | [.pre, compacted / .summary]) | spearman | num)",
          "",
          ($reqs | map(select(.ts >= $now - 30 * 86400)) | price_warnings[] | "warning: \(.)"),
          (if $a.n.tooFew then "warning: only \($a.n.count) compactions, under \(ENOUGH): the figures are measured but for reference" else empty end),
          "in force: \(in_force)",
          (if ($a.gN // 0) <= 0 or ($a.oN // 0) <= 0 then "advice: no usable requests in the last 30 days, so nothing to compute from" else for_now($a) as $f
          | (if $current.isOff then NEVER else $current.fire end) as $nowT
          | "to fill 1M from an initial context of \($f.init | k): \(requests($f.v)) requests, off $\(mixed(plan(NEVER; $f.v); $f.v; $a.share) | num), in force $\(mixed(plan($nowT; $f.v); $f.v; $a.share) | num), lowest $\(mixed(plan($f.near.mix; $f.v); $f.v; $a.share) | num)",
            # Off comes first, then what the samples can carry and whether a number is set.
            advised($a; $f; $nowT) as {$floored, $fire, $more, $hasNumber}
            | "autoCompactWindow = \(window($fire) | k)\(if $floored then "\nnote: the estimate is \(window($f.near.mix) | k) < \(FLOOR | k), so \(FLOOR | k)" else "" end)" as $number
            | if $current.isOff then "advice: auto-compact is off: enable it first, and come back with records"
              elif $a.n.count == 0 then "advice: no compactions yet, so nothing measured to compute from: keep watching"
              elif ($a.n.tooFew | not) then "recommended: \($number)"
              elif ($hasNumber | not) then "estimated: \($number)\nadvice: only \($a.n.count) compactions: keep watching, no change needed"
              elif $more >= 5 then "estimated: \($number)\nadvice: in force costs \($more | round)% more, on only \($a.n.count) compactions: switch to it, or change nothing and keep watching"
              else "estimated: \($number)\nadvice: in force is within 5%, on only \($a.n.count) compactions: change nothing, keep watching" end end)
    end' "$ROWS"
}

if [ "$MODE" = settings ]; then
  # Only 30 days are asked for, each run reads the rows again, and they run side by side.
  jq -c --argjson since "$(($(date +%s) - 30 * 86400))" 'select(.t != "r" or .k == "first" or .ts >= $since)' "$ROWS" > "$ROWS.recent"
  mv "$ROWS.recent" "$ROWS"
  analyse "" > "$ROWS.all" &
  pids=($!)
  for m in opus sonnet fable; do analyse "$m" > "$ROWS.$m" & pids+=($!); done
  for pid in "${pids[@]}"; do wait "$pid"; done
  cat "$ROWS.opus" "$ROWS.sonnet" "$ROWS.fable" > "$ROWS.models"
  jq -cn --argjson current "$CURRENT" --slurpfile all "$ROWS.all" --slurpfile models "$ROWS.models" \
    '{current: $current, overall: $all[0], byModel: ($models | map(select(. != null))), notCovered: ["haiku"]}'
  rm -f "$ROWS.all" "$ROWS.models" "$ROWS.opus" "$ROWS.sonnet" "$ROWS.fable"
else
  analyse ""
fi
