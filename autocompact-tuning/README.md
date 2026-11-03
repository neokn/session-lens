# autocompact-tuning

Says what `autoCompactWindow` fits a person's own usage. Nothing here takes a turn of the
model's or any room in its context: the mod runs these scripts, and so can a person.

```bash
bash autocompact-tuning/scripts/recommend.sh             # what to set, as JSON: the global, and each model
bash autocompact-tuning/scripts/apply.sh --help          # writes ~/.claude/settings.json
```

In a session, `/autocompact-tuning`, or `Auto Compact Tuning` at the foot of the pane, runs the
first, then asks in a dialog what to write: the global setting with a setting for each model above it,
every other model then following the global; the global alone; or what is typed under Other. It runs
`apply.sh` on the answer. With no session new or gone on since the last run, and the settings and the
script as they were, it reads no logs: `fingerprint.sh` says what counts, and `--fresh` reads them
anyway. When it does read, `rows/` under `~/.claude/autocompact-tuning/` holds what each log came to,
how far it was read and how the reading stood, so only what was added since is read, and what is past
30 days or deleted is dropped from it. `hooks/digest/autocompact.ts` holds what it says and offers.

`autoCompactWindow` takes tokens, 100000–1000000, and the dialog writes it in K. Precedence:
`CLAUDE_CODE_AUTO_COMPACT_WINDOW`, then `modelSettings.<model>`, then the top-level setting.
`apply.sh` leaves `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` where it is and warns of it: `/context`
does not show it, so whether it still moves the trigger is unconfirmed.

## What the script counts

- One request = one API call = one assistant `message.id` (streamed entries
  repeat the id and are counted once).
- Main sessions and subagents both, each subagent in the mode `subagent`; a main session is `claude -p`
  when its entrypoint is the SDK's, else interactive.
- The first request after a compaction is the summary write: it gives what the compaction left, and is
  no turn of the work.
- **Context sent** = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, the whole
  context a request carries.

## Where the setting comes from

A formula, from the initial context, how fast the context grows, the files read again after a
compaction, what a compaction writes out and writes again, and the model's prices; the compact buffer,
33K, is taken as what a compaction leaves. Each mode of a model gives a cost curve, the modes are summed
into the model's and the models into the global's, and each lowest point is rounded to 10K, never below 200K. Nothing
needs a compaction on record: a person who has never compacted gets a number. Read
[references/model.md](references/model.md) before changing a constant or when asked how good the number is.

## What it advises

| State | Say |
|---|---|
| Auto-compact off | Enable it first |
| No session of a known model in the last 30 days | No number: keep watching |
| The global and every model's own window already in force | No change |
| Otherwise | The global, and a setting for each model above it; every other model follows the global |

It gives the setting, never the point it fires at: the buffer between them is Claude Code's
and can change.

## Common mistakes

| Mistake | Effect |
|---|---|
| Using a request's new input as the context's growth | A cache written again counts the whole context as new |
| Taking `postTokens` for the summary | It is the conversation after the compaction, files attached again included |
| Reading `autoCompactWindow` as the trigger | It fires 33k below it |
| Expecting the window to be the only trigger | Idle compaction (200k+ tokens, idle about 54 min) runs on its own; `"idleCompaction": false` turns it off |
| Reading the number as a share of the window | It is a token count; Claude Code clamps it to the model's context, so a 200k model gets min(N, 200k) |
