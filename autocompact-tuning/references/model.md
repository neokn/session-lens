# How the setting is chosen

No request is run again. A formula takes a handful of figures from the logs and the model's prices, and
gives the window where a compaction pays for itself: where what a round costs in reading a larger and
larger context equals what one compaction costs.

## The formula, for one mode of one model

```
after    = initial context + 33K                         what a compaction leaves: the compact buffer, taken as filled
base     = after + rework                                where the next round's work starts
cost     = base                                          reading the whole context once, at the compaction
         + (write ÷ read) × (rewrite × after + rework)   writing the cache again
         + (output ÷ read) × compaction output           what the compaction writes out
         + rework requests × (after + rework ÷ 2)        reading under the requests that read files again
round    = √( 2 × growth × cost )                        the context a round should grow by
window   = base + round + 33K                            33K: auto-compact fires that far below the window
```

All of it in tokens of cached reading, the model's read price the unit. Per 1M tokens of progress, a
window `W` costs

```
read × ( base ÷ growth + r ÷ (2 × growth) + 1 + cost ÷ r ),   r = max(W − 33K − base, growth)
```

so below where a mode starts, every request compacts. `window` is where that is lowest.

33K plays two parts. As what a compaction leaves, it is a fixed figure. As what a compaction writes out
it is not: that is the compaction output below.

## Where each figure comes from

Each of the last 1, 7 and 30 days on its own, the three averaged 8 : 5 : 3 over the spans that have the
figure. One a span lacks is borrowed from the model's last 30 days, every mode and project; one the
model lacks wholly takes the next, wider tier, as below.

- **Initial context**: the first request of each session, the first prompt in it. A session that opens on
  a summary went on from another and is left out. From the sessions that reach 200K, the ones a
  compaction serves; with none, from all. What lies 2 deviations out in log space, among the model's
  sessions of every mode, is a first prompt rather than a mode's size and is dropped; of the rest, the
  normal value (the mean once more than 2 deviations out are dropped).
- **Growth**: each stretch between compactions, the 15 requests after one left out as rework, from the
  median of its first three requests to that of its last three (a spike that falls back, as the
  advisor's, cancels), the stretches' growth added up over their requests. From stretches that reach
  200K with 10 requests or more; with none, from those of 10 or more; with none, from all.
- **Rework, rework requests**: of each compaction, what the 15 requests after it read again with Read of
  the files Read since the compaction before (characters ÷ 3.5), and how many requests did. Bash rereads
  are not seen, so it is a floor. No compaction on record: 0.
- **Compaction output**: the summary text (characters ÷ 3.5) times 2, as the analysis before it is
  dropped from the log. The model's compactions of the last 30 days, else every model's, else 33K.
- **Rewrite**: what the first request after a compaction writes to the cache, over what it sends; the
  system prompt's prefix stays cached. A first request over 50K above the next is not what the
  compaction left: the next is taken, and its write not. Else every model's, else 1.
- **Write price**: the 5-minute and 1-hour prices, in the share the model's cache writes of the last 30
  days were billed at.

Prices per million, read / 5m write / 1h write / output: Opus 5.5 0.20 / 5 / 8 / 20; Sonnet 5.5 0.20 /
2.5 / 4 / 10; Fable 5.1 0.25 / 12.5 / 20 / 50; Haiku 5.5 0.01 / 0.125 / 0.2 / 0.5. Haiku goes dearer past
100K of input; the formula takes the base price.

## Modes, models, and the global

One window serves a model in every mode, interactive, `claude -p` and subagent, though their initial
context and growth differ. Each mode gives its own cost per 1M of progress at every window, by 1K; they
are summed weighed by how much the mode's sessions that reach 200K grow, the progress a compaction
serves (with none of them, by how much all grow), and the model's window is where the sum is lowest.

The global serves every model without one of its own: the models' sums, in dollars, weighed the same
way, so a dearer model counts for more.

## From the lowest point to the advice

- Each lowest point, to 10K, a 5K exactly to the even ten (245K is 240K, 255K is 260K), and never below
  200K: the global and each model's alike.
- A model at or below the global follows it and gets no `modelSettings` of its own: the formula leans
  low, its rework only partly seen.
- Auto-compact off: enable it first. No session of a known model: no number.
- The global and each model's window already in force: no change.

## What it leaves out

- What a compaction costs in lost context, beyond the files read again with Read.
- How long a session is: the formula takes one that goes on, so a window over a session's whole length
  is priced as if it went on.
- Idle and manual compactions, and a cache that expires.

## Claude Code mechanics (verified on 2.1.309)

- `autoCompactWindow` accepts 100000–1000000 tokens or `"auto"`. Precedence:
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` env, then `modelSettings.<model>`, then the
  top-level setting, then the model default.
- `/context` shows an Autocompact buffer of 33k at both 249k and 300k windows, so
  compaction fires at `window − 33000`.
- `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`: `/context` shows the same 33k buffer at 50% and
  87%, so it either no longer moves the trigger or is not shown. `apply.sh` leaves it and warns of it.
- `DISABLE_AUTO_COMPACT` removes the buffer from `/context`, as auto-compact is off.
  With nothing set, the window of a 1M model is 1M.
- `precomputeCompactionEnabled` (default on) writes the summary in the
  background ahead of the threshold; it does not move the threshold.
- Idle compaction (since 2.1.299): a conversation above 200k tokens left idle
  about 54 minutes is compacted before its 1h cache expires.
  `"idleCompaction": false` disables it, `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`
  changes the minimum. It ignores the window.
- `compactMetadata.postTokens` is the conversation after a compaction (summary, files attached again,
  messages kept), not the summary alone; the compaction's own request is not in the log.
