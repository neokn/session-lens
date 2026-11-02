---
name: autocompact-tuning
description: Use when someone wants a Claude Code auto-compact setting chosen or re-checked from their own usage — "auto compact 要設多少", "推薦 auto-compact 設定值", "幫我分析每次請求的 input/output", "壓縮比是多少", "what should I set /autocompact to", "is my CLAUDE_AUTOCOMPACT_PCT_OVERRIDE right", "compact 太早 / 太晚", or any question about where compaction becomes cheaper than letting the context grow. Also use when per-request token usage or compression ratios must be read from ~/.claude/projects jsonl logs.
---

# autocompact-tuning

A command, not a task for the model: it reads the session logs and writes the
report with no model involved, and a person can run it directly or press
`Auto-compact Report` in the session-lens pane. Run it, relay what it prints, and do
not recompute anything. What this adds to the button is the question at the end:
whether to write the setting for them.

The script path is under this skill's base directory:

```bash
bash <skill dir>/scripts/report.sh             # writes the data, opens the page, prints the setting
bash <skill dir>/scripts/recommend.sh --settings  # what to set as JSON, overall and by model
bash <skill dir>/scripts/recommend.sh          # the full report as text, 30, 7 and 1 days
bash <skill dir>/scripts/apply.sh --help       # writes ~/.claude/settings.json, once asked
```

## Steps

1. Run `report.sh`, which opens the page, then `recommend.sh --settings`. For a
   question about the current project, add `--here` to the second.
2. Reply with the printed lines in a code block, then what is in force, from the
   `in force` line, and the advice under **What to tell the user**.
3. Ask with AskUserQuestion whether to write the setting, unless there is nothing to
   write (no compactions yet). Show values in K, as the report does.

   | State | Options, the recommended one first |
   |---|---|
   | Off | Enable auto-compact · Change nothing |
   | Under 30, no number set | Change nothing · Global · By model |
   | Under 30, number set, `costsMore` 5 or above | Change nothing · Global · By model, none marked recommended: it is their choice |
   | Under 30, number set, under 5 | Change nothing · Global · By model |
   | 30 or more | Global · By model · Change nothing |

   Global is `overall.window`. By model lists each of `byModel` with its `window`;
   Haiku is not in it, as its price steps with the input, and the page's table has it.
4. Run what they chose, and nothing when they choose to change nothing:

   ```bash
   bash <skill dir>/scripts/apply.sh --enable
   bash <skill dir>/scripts/apply.sh --global <overall.window>
   bash <skill dir>/scripts/apply.sh --model <id>=<window> [<id>=<window> ...]
   ```

   Relay what it prints, its warnings first: a setting elsewhere can win over this one.
   It takes effect in new sessions. Never edit settings without this question.

   If `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is set, say it should go: `/context` does
   not show it, so whether it still moves the trigger is unconfirmed. `apply.sh` leaves it.
5. Where the Artifact tool exists and they want a link, publish `assets/chart.html` with
   `report.json` beside it (`files`); nothing in the page is written by you.

## The report

`assets/chart.html` never changes. `report.sh` writes the data beside it, as
`report.js` for a page opened from `file://` and `report.json` for a served one, and
the page computes every figure in the browser. It follows the browser's language, zh or else English, and has a switch. It needs bash and jq, and no server.

## What the script counts

- One request = one API call = one assistant `message.id` (streamed entries
  repeat the id and are counted once).
- Usage is the main session only. Subagents run in their own context and live under
  `<session>/subagents/`; they do not fill the main window. Their compactions count
  toward the ratio and the size.
- Compaction is left out of usage: the first request after a compaction (the
  summary write) is never counted as input or output.
- **New input** = `input_tokens + cache_creation_input_tokens`. Output of request
  *i* becomes cached input of request *i+1*, so it is already inside it.
  *With initial* counts each session's first request (the start context);
  *without* leaves it out.
- **Context sent** = new input + `cache_read_input_tokens`, the whole context a
  request carries. *Without initial* subtracts that session's start context.
- **Pure ratio** = (context before − that session's initial context) ÷ summary:
  neither side holds the initial context, which is never compacted. **Ratio with
  initial** = context before ÷ the first request after the compaction: both sides
  hold it. `preTokens` is the last request's whole context plus its output.
- **Kind**: `manual` from the record; `idle` when `auto` came after 50+ idle
  minutes above 200k; else `threshold`. The record marks idle and threshold both
  `auto`, so that split is inferred.
- **Ratio or fixed size**: each compaction's ratio and size, subagents included, give a
  normal value in log space, outliers out, and the steadier one is what the cost assumes. Under 30 compactions the
  report warns and says what to do, as below; no ratio is assumed.
- Over 30 days the cost leans toward the last 24 hours by partial pooling, 50% at most;
  `references/model.md` has how. The `last day` line shows the weights.
- **Normal request**: one request's input and output, the pair dropped when either is
  more than 2 deviations out in log space, then `exp(mean)` of what is left, so their
  ratio is the normal in/out ratio. It says what one request is. The cost then adds it
  up, so big requests left out make the context grow slower there than it really does.

## Where the setting comes from

The trigger with the lowest total cost over the same work, the requests it takes
the context to reach 1M without compacting at this user's input and output, at the
Sonnet 5.5, Opus 5.5 and Fable 5.1 prices, with what the logs show a compaction leaves behind. The single setting weighs those models by this user's requests. It adds
the 33k buffer, as auto-compact fires that far below `autoCompactWindow`. The `setting` line prices one usage at each model; the page's per-model table uses each
model's own usage, so trust that table for per-model settings. The last line is for the
initial context of the latest five sessions, so it can differ a
little from the 30d `setting` line, which keeps what the logs measured. The page's
single-model and per-project views use the same rules over their own records. Read
[references/model.md](references/model.md) before changing a constant or when
asked how good the number is.

## What to tell the user

The last lines of the text report and the top of the page say it, and you pass it on:

| State | Say |
|---|---|
| Auto-compact off | Enable it first |
| No compactions yet | Nothing measured to compute from: keep watching |
| Under 30, on, no number set | The estimate, and keep watching |
| Under 30, number set, in force costs 5% or more | Switch to the estimate, or change nothing and keep watching: their choice |
| Under 30, number set, within 5% | Change nothing, keep watching |
| 30 or more | The recommendation |

Where a change is on the table (a number set, or 30 or more), an estimate under 200K is
raised to 200K, and the report says so: pass on that the estimate was lower.

Give the setting, never the point it fires at: the buffer between them is Claude Code's
and can change, so the reports leave it out.

## Common mistakes

| Mistake | Effect |
|---|---|
| Counting subagent requests | Inflates request count, deflates new input |
| Using per-turn totals as new input | A turn is many requests; it is per request |
| Quoting the pure ratio as how much the context shrinks | The context left behind also holds the initial context; use the ratio with initial |
| Quoting a compression ratio as a property of the user | It grows with how late they compact, as the summary stays about the same size |
| Reading `autoCompactWindow` as the trigger | It fires 33k below it |
| Expecting the window to be the only trigger | Idle compaction (200k+ tokens, idle about 54 min) runs on its own; `"idleCompaction": false` turns it off |
| Reading the number as a share of the window | It is a token count; Claude Code clamps it to the model's context, so a 200k model gets min(N, 200k) |
