# The model behind the setting

## Cost model

Per request at context size `x`, with `g` new input and `O` output
(tokens; prices per million):

```
cost(request) = read · x + write · g + out · O
cost(compact at T) = read · T + out · s + write · w
```

- `read` cache read, `write` 1h cache write, `out` output.
- Prices per million, input / read / 5m write / 1h write / output: Sonnet 5.5
  2 / 0.20 / 2.5 / 4 / 10; Opus 5.5 4 / 0.20 / 5 / 8 / 20; Fable 5.1 10 / 0.25 / 12.5 /
  20 / 50; Haiku 5.5 0.1 / 0.01 / 0.125 / 0.2 / 0.5, and 0.5 / 0.05 / 0.625 / 1 / 2.5
  past 100k of input. A write is 1.25× input at 5m and 2× at 1h.
- A model without its exact price is priced by the one of its name, with a warning: the
  report names each such model. One of no known name stays out of the cost.
- `write` is those two weighed by the share of 5m. A request writes to one lifetime or
  the other, never both, so a per-request share is 0 or 1 and has no log. Each lifetime
  gets its normal size (log mean, outliers out), and the share is what those sizes times
  their request counts come to. Of `g`, the normal `input_tokens` is priced as input and
  the rest as a write.
- `s` the summary, `A` the context the first request after a compaction carries,
  `w` what that request writes to cache. All three are measured from the logs.
  `A` is larger than `s`, as the system prompt, tools and memory go back in.

Settings are compared over the same work, so that auto-compact off is on the same
footing as any trigger: the requests it takes the context to reach 1M without
compacting, at this user's input and output.

```
H = ⌊(1M − O − I) / g⌋ + 1        I the initial context
```

Those `H` requests run under each trigger: the context starts at `I`, grows by `g`,
and at `T` is compacted down to `A`. Off never compacts. The total is

```
write · I + H · (write · g + out · O) + read · Σ x + n · (out · s + write · w) + read · Σ T'
```

with `Σ x` the context of each request, `n` the compactions and `T'` the context at
each. The script tries every trigger by 1k from just above `A` to 967k (1M less the
buffer), and for the single setting minimises the costs weighed by this user's
Sonnet, Opus and Fable requests. Haiku is left out of the weights: its price steps
with the input, which this sum cannot carry, and its share is small. The page walks
it request by request when Haiku is chosen alone.

The cost steps with `T`, as `n` is whole: a trigger that fires once more near the
end of `H` pays for a compaction it never earns back. So the lowest point is exact
for this `H`, and a nearby trigger can cost a few percent more or less. Over a long
run the balance is `T ≈ A + √(2K · g / read)`, with
`K = read · A + out · s + write · w`, which is why the trigger moves with the square
root of `g` under a fixed size.

## What input and output do

`out · O` is paid on every request under every trigger, so it moves the optimum only
through `H` and `g`: the output of one request is cached input to the next. So a higher input/output ratio at the same output means
a larger `g`, and a later trigger, by the square root.

The script reports the rank correlation of a cycle's input/output with its
compression ratio, beside that of the context before the compaction with it.
Summaries stay about the same size, so the ratio mostly follows how large the
context was. With this few compactions neither is evidence of a cause.

## The normal request

Tokens per request are heavily right-skewed; their logarithms are close to normal
(`log skew` near 0). So one request's normal input and output are `exp(mean)` in log
space, over the pairs left when either value more than 2 deviations out drops its pair,
judged once. Taken over the same pairs, their ratio is the normal ratio of each request.
These describe one request, not a total. The cost adds them up, and what they leave out
(the largest 1% of requests hold about 40% of the input in one user's logs) is growth
the model does not see. The script prints the setting the raw means give beside it.

## The chart

`assets/chart.html` computes the same total from `report.json`, so across all
projects and models over 30 days, at the starting initial context, its lowest point
is the recommendation. A project with no compaction of its own takes its
compaction figures from all records. The page covers 30 days and has no filter by period
or model, as it leans toward the last day and tables each model. Moving the initial context
by `d` moves `A` and `w` by `d`, an assumption: the logs do not show a session's
initial context changing. A larger initial context leaves fewer requests before 1M,
so totals compare settings at one initial context, not initial contexts.

The scatter fits ordinary least squares, `after = a + b × compacted`, with `compacted =
preTokens − the session's initial context`, as the summary leaves it out too. A
compaction is an outlier there when its externally studentized residual exceeds 2 in
size, judged once. It gives R² and the slope's 95% interval (Student's t).

## Ratio or fixed size

Each compaction has its own ratio, `compacted ÷ summary`, and its own size, the summary.
Each is taken in log space: what lies more than 2 sample deviations from the mean is
dropped, once, never leaving fewer than 3, and `exp(mean)` is the normal value. Log
deviations have no unit, so they say which is steadier. The cost assumes a ratio only
when its deviation is under 0.9 of the size's, with at least 3 compactions and a ratio
above 1; otherwise a fixed size. A ratio makes each compaction leave `max(T − I, 0) ÷
ratio`. Either way the initial context goes back in, and the rest of `A` and `w` is what
the logs show above the summary. Ratio and size take subagent compactions too, as they
compact the same way and neither figure holds an initial context. What goes back in
after a compaction comes from main-session compactions, whose initial context it holds.

## Leaning toward the last day

The input, output and uncached input the cost uses lean toward the last
24 hours by partial pooling, in log space, on the requests left after outliers go:

```
weight = between ÷ (between + within ÷ m), at most 0.5
value  = exp(weight · log(last day) + (1 − weight) · log(30-day normal))
```

- `m` the projects of the last day, and each project counts once however many requests
  it made: requests of one project are not independent evidence. A selection of one
  project counts sessions instead.
- `within` the variance between projects on one day, pooled over days with several.
- `between` the variance between days, less what `within` alone explains, at least 0
  (the DerSimonian-Laird estimate).
- The 5m share moves by the weight of the input. Compaction figures and the model mix
  do not lean: the first are too few, and the second is priced as a share of requests.
- Under 3 active days, with no day of several projects, or with no request in the last
  24 hours, the weight is 0. The cap of 0.5 is a choice, as `between` is rough at this
  few days. The text report's 7 and 1 days do not lean, as they are already recent.

## Too few compactions

Under 30 compactions (a common rule for trusting a mean) the figures are the measured
ones with a warning, and no ratio or size is assumed. What the report advises then:

- Auto-compact off: enable it first, whatever the samples. A number comes after.
- No compaction at all: there is nothing to compute from, so no number.
- On with no number set: the estimate, and keep watching.
- A number set that costs 5% or more than the estimate: switch or keep watching, for
  the user to choose. Under 5% change nothing, as the cost steps with the compaction
  count and a gap that small can be one step.

With a number set, or with 30 or more compactions, an estimate under 200K is raised to
200K and the report shows the estimate. The floor is a choice: the cost does not price
what a compaction loses, so a lowest cost that early is not a reason to compact that
often. With no number set the estimate stands as it is, as the advice is to keep watching.

## What it leaves out

- It prices one context's worth of work. Most sessions end sooner and never reach
  the trigger, and for those nothing changes.
- Cache expiry. A 1h cache write that expires is written again in full, which
  favours neither side clearly and is not priced.
- What a compaction costs in lost context. It is not money and is not priced, so
  a trigger well below the lowest cost is not recommended by this model alone.
- Prices of other models.

## Claude Code mechanics (verified on 2.1.309)

- `autoCompactWindow` accepts 100000–1000000 tokens or `"auto"`. Precedence:
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` env, then `modelSettings.<model>`, then the
  top-level setting, then the model default.
- `/context` shows an Autocompact buffer of 33k at both 249k and 300k windows, so
  compaction fires at `window − 33000`. The script's setting adds it. It is read
  from `/context`: no threshold compaction in the logs has confirmed the firing
  point yet.
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`: `/context` shows the same 33k buffer at 50% and
  87%, so it either no longer moves the trigger or is not shown. The script counts
  it as `min(window × pct ÷ 100, window − 33000)`, the lower of the two.
- `DISABLE_AUTO_COMPACT` removes the buffer from `/context`, as auto-compact is off.
  With nothing set, the window of a 1M model is 1M.
- `precomputeCompactionEnabled` (default on) writes the summary in the
  background ahead of the threshold; it does not move the threshold.
- Idle compaction (since 2.1.299): a conversation above 200k tokens left idle
  about 54 minutes is compacted before its 1h cache expires.
  `"idleCompaction": false` disables it, `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`
  changes the minimum. It ignores the window.
- `compactMetadata.trigger` in the jsonl records `auto` for both idle and
  threshold compactions; the idle gap before the entry tells them apart.
- `preTokens` is the last request's whole context plus its output (exact in 4 of 9
  compactions checked, within about 2k in the rest), so it holds the initial context.
- `postTokens` is the summary alone. The first request after the compaction shows
  what the context really restarts from.
