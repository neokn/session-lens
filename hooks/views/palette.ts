// The pane's design tokens, in two layers. The primitives are the raw hues, named by what they are: the brand's own for a light
// terminal, and the same lifted to read on a dark one. The intent tokens say what a colour or a style means;
// every view draws with an intent token, never a primitive. Colour answers three questions, each on its own channel
// (CHANNELS below): the hue family says who, distinct hues inside one whole say which kind, and warmth and light say when
// and which way. What still changes is always a hue, never a grey. The version at the pane's bottom left opens a page of
// them all.

// ── primitives ──
const DARK = {
  muted: '#b0aea5', // labels
  soft: '#dedcd1', // asides
  bright: '#f0eee6', // emphasis
  line: '#b0aea5', // the lines of a box
  ash: '#dedcd1', // a part of a whole with no hue of its own
  plum: '#9f97f1', // the main agent
  mineral: '#6dbda4', // a subagent
  sky: '#5cc8f0', // cool: what was sent
  cobalt: '#6a86f2', // cool: what was written to the cache
  haze: '#9aa6cc', // hazy: what the cache gave back
  afternoon: '#f6a068', // warm: what the model wrote, what was spent
  sunlight: '#ffd75e', // the brightest: what runs now
  sage: '#9db88a', // hazy green: what has ended well
  rose: '#f2667e', // what needs the eye
  sand: '#dcc08a', // what came from outside
}
// The brand's palette on the light ground it was made for, each hue keeping its hue and its chroma and brought down in
// lightness only as far as it takes to hold on a terminal's light grey, #f5f5f5: 3.8:1 for the cool hues, about 3.2:1 for
// the warm ones, which turn brown any further. The names say what each started from.
const LIGHT: typeof DARK = {
  muted: '#73726c', // Muted
  soft: '#3d3d3a',
  bright: '#141413', // Slate
  line: '#9c9a91', // Gray 400
  ash: '#a3a198', // Gray 400
  plum: '#7a75b5', // Plum
  mineral: '#508776', // Mineral
  sky: '#5080af', // Blue
  cobalt: '#5c77d5',
  haze: '#7881a5',
  afternoon: '#cf6e4f', // Clay
  sunlight: '#b28005',
  sage: '#738758', // Cactus
  rose: '#d85269',
  sand: '#ad8230',
}
export type Theme = 'dark' | 'light'
const HUES: Record<Theme, typeof DARK> = { dark: DARK, light: LIGHT }

const rgbOf = (c: string) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))
/** `a` moved toward `b` by `t`, from 0 (all `a`) to 1 (all `b`). */
export const mix = (a: string, b: string, t: number) => {
  const to = rgbOf(b)
  return `#${rgbOf(a)
    .map((x, i) => Math.round(x + ((to[i] ?? x) - x) * t).toString(16).padStart(2, '0'))
    .join('')}`
}
// A tone of a hue. Fainter and further off: toward the bright grey on a dark terminal; on a light one toward the page,
// less far, so it still reads. A skill on a light terminal is a tone of its own, as sand has no room left. Held back: toward the terminal's own background. Darker is darker on either, less so on a
// light terminal, where a warm hue taken far toward black turns brown.
const TONES: Record<Theme, { far: (c: string, t: number) => string; back: (c: string, t: number) => string; down: number; skill: (sand: string) => string }> = {
  dark: { far: (c, t) => mix(c, DARK.bright, t), back: (c, t) => mix(c, '#000000', t), down: 0.3, skill: sand => mix(sand, DARK.bright, 0.4) },
  light: { far: (c, t) => mix(c, '#ffffff', t * 0.45), back: (c, t) => mix(c, '#ffffff', t * 0.6), down: 0.15, skill: () => '#bc7d47' },
}
const darker = (c: string, t: number) => mix(c, '#000000', t)

// ── intent: colour ──
// What each token means, the same in every theme; a theme gives each its colour.
const MEANS = {
  text: {
    muted: 'labels, units, what is said about a figure: read past on the way to the figure',
    soft: 'a value that matters less than its neighbours: a model name, a skill, a quiet aside',
  },
  line: {
    rail: "the tree's lines, from an agent down to what it started",
    frame: 'the border of a box at rest',
    split: 'a divider inside a figure, such as the opening and what came in since',
  },
  actor: {
    main: 'the main agent: its name, its requests, its part of a figure',
    mainEcho: "what speaks for main without being it: the advisor, main's replies, the tool calls on the timeline",
    sub: 'a subagent main started',
    subEcho: 'an agent a subagent started: the deeper, the fainter',
  },
  state: {
    live: 'still running: a spinner, a working row, the border of a box that runs; always a hue, never a grey',
    done: 'ended well: done, the room left',
    danger: 'needs the eye now: near auto-compact, an error, a failed read; always bold',
  },
  cost: {
    spend: 'what was spent: money, tokens lost to a compaction, the tokens the model wrote (output)',
    fresh: 'tokens sent past the last cache breakpoint, priced as input',
    cachedShort: 'tokens written to the cache for five minutes, 1.25× input: the cache write hue',
    cachedLong: 'tokens written to the cache for an hour, 2× input: the cache write hue, darker',
    reused: 'tokens read back from the cache, the cheapest',
  },
  source: {
    mcp: 'what came from outside the harness: an MCP server, a web search',
    skill: 'a skill, and what one injected',
    hook: 'a hook: what ran on its own, beside the agent',
  },
  rank: {
    longest: "a timeline's longest request",
    shortest: "a timeline's shortest request",
    working: 'the request an agent is still working on, until it becomes the longest or the shortest',
  },
  window: {
    free: 'the room left before auto-compact',
    buffer: 'the buffer auto-compact keeps',
    beyond: "the model's window past the one auto-compact measures against",
  },
} as const
type Colors = { [G in keyof typeof MEANS]: { [K in keyof (typeof MEANS)[G]]: string } }

// One theme's tokens, whole: every colour below is drawn from its hues and its tones.
const paint = (theme: Theme) => {
  const P = HUES[theme]
  const { far, back, down, skill } = TONES[theme]
  const T: Colors = {
    text: { muted: P.muted, soft: P.soft },
    line: { rail: P.line, frame: P.line, split: back(P.line, 0.35) },
    // Who: one hue family each, a deeper agent a fainter tone of its parent's.
    actor: { main: P.plum, mainEcho: far(P.plum, 0.45), sub: P.mineral, subEcho: far(P.mineral, 0.45) },
    // When: what runs is the brightest light, what has ended a haze.
    state: { live: P.sunlight, done: P.sage, danger: P.rose },
    // Which kind, and which way: each kind of token its own hue, cool for what was sent, warm for what the model wrote,
    // haze for what the cache gave back. The two cache writes are one kind for two lengths of time: one hue, two tones.
    cost: { spend: P.afternoon, fresh: P.sky, cachedShort: P.cobalt, cachedLong: darker(P.cobalt, 0.28), reused: P.haze },
    source: { mcp: P.sand, skill: skill(P.sand), hook: darker(P.sand, down) },
    // How long, as warmth: the longest is the warm of what was spent, the shortest the cool of what was sent.
    rank: { longest: P.afternoon, shortest: P.sky, working: P.sunlight },
    window: { free: P.muted, buffer: P.ash, beyond: back(P.muted, 0.35) },
  }
  const TYPE_TOKENS = {
    name: { style: { bold: true }, means: 'what a thing is called: an agent, a block, a fold' },
    figure: { style: { bold: true }, means: "a figure the eye comes for: a tile's value, a total" },
    live: { style: { italic: true, color: T.state.live }, means: 'still changing: running, working, a spinner' },
    estimate: { style: { italic: true }, means: 'a figure that is guessed, not counted: ≈, est., (so far)' },
    meta: { style: { color: T.text.muted }, means: 'what is said about a figure' },
    danger: { style: { bold: true, color: T.state.danger }, means: 'what needs the eye now' },
  } as const
  return {
    P,
    T,
    COLOR_TOKENS: Object.fromEntries(
      Object.entries(MEANS).map(([g, ts]) => [g, Object.fromEntries(Object.entries(ts).map(([k, means]) => [k, { color: (T as Record<string, Record<string, string>>)[g]?.[k] ?? '', means }]))]),
    ) as { [G in keyof Colors]: { [K in keyof Colors[G]]: { color: string; means: string } } },
    /** The three questions colour answers, each on its own channel, with the tokens that show it. The token page leads
     * with these. */
    CHANNELS: [
      { channel: 'Hue family', says: 'who: the main agent plum, a subagent mineral, an agent it started a fainter tone of its parent', colors: [T.actor.main, T.actor.mainEcho, T.actor.sub, T.actor.subEcho] },
      { channel: 'Hues in one whole', says: 'which kind: every part of a bill or a window its own hue, so the parts tell apart at a glance', colors: [T.cost.fresh, T.cost.cachedShort, T.cost.cachedLong, T.cost.reused, T.cost.spend, T.source.mcp] },
      { channel: 'Warmth and light', says: 'when and which way: sunlight for what runs, warm for what the model wrote and the longest, cool for what was sent and the shortest, haze for what the cache gave back and what has ended', colors: [T.state.live, T.cost.spend, T.cost.fresh, T.cost.reused, T.state.done] },
    ],
    // The parts of one whole (a window, a bill) told apart: a categorical series, the hues in a fixed order. A series colour
    // says "this part, not that one" and nothing more; where a part has a meaning of its own it takes that token instead.
    SERIES: [P.plum, P.mineral, P.sky, P.sand, P.afternoon, P.ash],
    // The models on the timeline's line, under main's plum work and over the subagents' mineral marks: neither hue, nor a
    // compaction's afternoon, so a model is never read as who or as what was lost.
    MODEL_SERIES: [P.sky, P.sand, P.sage, P.ash],
    // While the pane reads: a light that sweeps a dim track, its trail running through the hues as it fades.
    LOADING: { light: P.sunlight, head: P.afternoon, trail: [P.sunlight, P.afternoon, P.rose, P.plum, P.sky, P.mineral], track: back(P.muted, 0.6) },
    // How sure or how live a figure is, and which words name things. The terminal has one size: weight and slant carry it.
    TYPE_TOKENS,
    S: Object.fromEntries(Object.entries(TYPE_TOKENS).map(([k, x]) => [k, x.style])) as { [K in keyof typeof TYPE_TOKENS]: (typeof TYPE_TOKENS)[K]['style'] },
  }
}
const PAINTED = { dark: paint('dark'), light: paint('light') }

// The theme being drawn. These bindings are live: a view reads `T.actor.main` as it draws, so a change of theme reaches
// every view at its next drawing, and none of them holds a colour of its own between drawings.
export let { P, T, COLOR_TOKENS, CHANNELS, SERIES, MODEL_SERIES, LOADING, TYPE_TOKENS, S } = PAINTED.dark
export let theme: Theme = 'dark'
export const setTheme = (next: Theme) => {
  theme = next
  ;({ P, T, COLOR_TOKENS, CHANNELS, SERIES, MODEL_SERIES, LOADING, TYPE_TOKENS, S } = PAINTED[next])
}
/** Both themes' tokens, for what must hold of each. */
export const tokensOf = (t: Theme) => PAINTED[t]

// Main, a subagent, and one a subagent launched.
export const agentColor = (depth: number) => (depth === 0 ? T.actor.main : depth === 1 ? T.actor.sub : T.actor.subEcho)

// ── intent: glyph ──
// One glyph, one meaning, everywhere on the pane. A glyph that leads a row says what pressing it does; one inside a
// figure says what kind of part it is. digest/ draws nothing and imports no view, so the few it writes into an event's
// name (⇄, →, ✗) are spelled out there, the same glyphs as here.
export const GLYPH_TOKENS = {
  shut: { glyph: '▸', means: 'a fold, shut: press to open it in place' },
  open: { glyph: '▾', means: 'a fold, open: press to shut it' },
  page: { glyph: '›', means: 'opens a page of its own: before a row, or after the name of a part' },
  back: { glyph: '‹', means: 'back from a page to the one it opened from' },
  more: { glyph: '+', means: "shows the list's next page of rows" },
  fewer: { glyph: '−', means: 'folds a list back to its first rows' },
  done: { glyph: '✓', means: 'ended well' },
  failed: { glyph: '✗', means: 'ended without its answer' },
  switch: { glyph: '⇄', means: 'the model or effort changed' },
  agent: { glyph: '@', means: 'a subagent, or a claude -p child' },
  shell: { glyph: '$', means: 'a background shell' },
  idle: { glyph: '⋮', means: 'time passed with nothing running' },
  sent: { glyph: '↑', means: 'tokens sent to the model' },
  got: { glyph: '↓', means: 'tokens the model wrote' },
  about: { glyph: '≈', means: 'an estimate' },
  then: { glyph: '→', means: 'what came next, in order' },
  opening: { glyph: '⛁', means: 'a part of the window from before the first reply' },
  since: { glyph: '⛀', means: 'a part of the window that came in since' },
  free: { glyph: '⛶', means: 'room left before auto-compact' },
  buffer: { glyph: '⛝', means: 'the buffer auto-compact keeps' },
  expandAll: { glyph: '⊞', means: 'opens every fold of a list at once' },
  collapseAll: { glyph: '⊟', means: 'shuts every fold of a list at once' },
  theme: { glyph: '◐', means: 'the theme drawn: press for the other' },
  on: { glyph: '●', means: 'a filter that is on' },
  off: { glyph: '○', means: 'a filter that is off' },
} as const
export const G = Object.fromEntries(Object.entries(GLYPH_TOKENS).map(([k, t]) => [k, t.glyph])) as { [K in keyof typeof GLYPH_TOKENS]: (typeof GLYPH_TOKENS)[K]['glyph'] }

// ── intent: space ──
// The terminal counts in cells: every gap on the pane is one of these, so the same distance always means the same thing.
export const SPACE_TOKENS = {
  inset: { cells: 1, means: 'inside a border, between the line and what it holds' },
  indent: { cells: 2, means: "one level down: a tree's child under its parent, a part under its fold" },
  section: { cells: 1, means: 'a blank row between two sections of one box' },
  gap: { cells: 2, means: 'between controls or columns side by side' },
  tight: { cells: 1, means: 'between the choices of one filter' },
} as const
export const SPACE = Object.fromEntries(Object.entries(SPACE_TOKENS).map(([k, t]) => [k, t.cells])) as { [K in keyof typeof SPACE_TOKENS]: (typeof SPACE_TOKENS)[K]['cells'] }
