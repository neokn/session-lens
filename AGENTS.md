# AGENTS.md

## First: load the plugin in dev mode

Before anything else in this repository, the session must run the plugin from this working tree, not a copy installed from the marketplace. Hang the tree in the session's mods folder; no restart and no flag:

1. Load the `plugin-authoring` skill. Its load names this session's mods folder, `~/.claude/dev-mods/<session id>/`, and starts the engine's watch on it.
2. Link this repository into that folder, unless the link is there already:

   ```bash
   ln -s "$PWD" ~/.claude/dev-mods/<session id>/session-lens
   ```

3. The engine asks the user, once: "Turn on the mods Claude writes in this session?". Only the user answers it. On `Turn them on`, a notice at the next turn says the mods loaded; from then on each edit reloads when the turn that made it ends.

The folder is the session's own, so these steps come again in every session. `claude -p` cannot take them: nobody is there to answer the question.

Check it first, before reading code or making a change:

```bash
readlink ~/.claude/dev-mods/<session id>/session-lens
```

- It names this repository, and the notice said the mods loaded: the session runs this tree. Go on.
- It does not, or the user declined: stop and tell the user. A session started with `claude --plugin-dir .` runs this tree too.

### The mod that runs must be this tree's too

The plugin ships a mod (the `/session-lens` pane and its hooks module), and the one that runs must be the one in this tree. A copy installed from the marketplace (`session-lens@session-lens`) may be enabled in user settings at the same time. Loaded from the mods folder (or `--plugin-dir .`), the tree's copy loads as `session-lens@inline` and replaces the installed one by the manifest's `name`: only one copy loads, and nothing says so outside the `--debug` log. `claude plugin list` still shows the marketplace copy as enabled, so it proves nothing.

Confirm that the mod comes from this tree before trusting anything the pane draws:

- `/plugin` must show `session-lens` from `inline`.
- The version at the bottom left of the pane must be the `version` in this tree's `.claude-plugin/plugin.json`. An older one means the installed copy is running; the same one proves nothing while the installed copy is at that version too.
- No setting may turn the tree's copy off: `"session-lens@inline": false` in any `enabledPlugins` keeps it from loading, and the installed copy runs in its place.

If any of these fails, stop and tell the user. Do not test, measure or screenshot the pane until it passes. Do not disable the marketplace copy in `.claude/settings.json` to force it: the replacement by name already does that, and the file is shared.

### Why it comes first

- `tsc -p .` needs the engine's types in `.claude-plugin/types/`, which git ignores. Loading the tree from the mods folder does not write them there, so a fresh clone has none: start one interactive session with `claude --plugin-dir .` from the repository root to lay them, once.
- A change to `hooks/` shows only in the copy that runs. With the marketplace copy loaded, `/session-lens` draws the released version, not the edit. The version at the bottom left of the pane (`v1.1.2`, say) is read from the running copy's `plugin.json`, so it tells which one runs.
- After an edit, the mods folder reloads it by itself when the turn that made the edit ends.

## Then

The checks in the README's [Develop](README.md#develop) section:

```bash
claude plugin validate .
claude plugin test .
scripts/boundaries
npx -y -p typescript@5.6.3 tsc -p .
```
