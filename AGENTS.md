# AGENTS.md

## First: load the plugin in dev mode

Before anything else in this repository, the session must run the plugin from this working tree, not a copy installed from the marketplace:

```bash
claude --plugin-dir .
```

Check it first, before reading code or making a change:

```bash
ps -o args= -p $PPID
```

- The line holds `--plugin-dir .` (or this repository's path): the session runs this tree. Go on.
- It does not: stop and ask the user to quit and start again with `claude --plugin-dir .` from the repository root. A session cannot add a plugin directory to itself, and `claude -p` does not count: it does not lay the types below.

### The mod that runs must be this tree's too

The plugin ships a mod (the `/session-lens` pane and its hooks module), and the one that runs must be the one in this tree. A copy installed from the marketplace (`session-lens@session-lens`) may be enabled in user settings at the same time. With `--plugin-dir .`, the tree's copy loads as `session-lens@inline` and replaces the installed one by the manifest's `name`: only one copy loads, and nothing says so outside the `--debug` log. `claude plugin list` still shows the marketplace copy as enabled, so it proves nothing.

Confirm that the mod comes from this tree before trusting anything the pane draws:

- The version at the bottom left of the pane must be the `version` in this tree's `.claude-plugin/plugin.json`. An older one means the installed copy is running.
- `/plugin` must show `session-lens` from `inline`, at this repository's path.
- No setting may turn the tree's copy off: `"session-lens@inline": false` in any `enabledPlugins` keeps it from loading, and the installed copy runs in its place.

If any of these fails, stop and tell the user. Do not test, measure or screenshot the pane until it passes. Do not disable the marketplace copy in `.claude/settings.json` to force it: the replacement by name already does that, and the file is shared.

### Why it comes first

- Only a session that loads the mod writes the engine's types to `.claude-plugin/types/`, which git ignores. Without them `tsc -p .` fails, so a fresh clone cannot be type-checked until it has run once in dev mode.
- A change to `hooks/` shows only in the copy that runs. With the marketplace copy loaded, `/session-lens` draws the released version, not the edit. The version at the bottom left of the pane (`v1.1.2`, say) is read from the running copy's `plugin.json`, so it tells which one runs.
- After an edit, `/reload-plugins` loads it again in the same session.

## Then

The checks in the README's [Develop](README.md#develop) section:

```bash
claude plugin validate .
claude plugin test .
scripts/mutate
scripts/boundaries
npx -y -p typescript@5.6.3 tsc -p .
```
