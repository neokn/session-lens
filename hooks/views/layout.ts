import { isWide } from '../digest/record'

// Terminal cells: how wide a string draws, and how it is fitted, cut and spread over a width. Pure.

// A count in at most six cells (`999.9k`): what would round up to `1000.0k` is read in millions.
export const k = (n: number) =>
  n >= 999_950 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
export const K_W = 6

// Terminal cells: CJK and other wide characters take two.
const cells = (ch: string) => (isWide(ch) ? 2 : 1)
export const width = (s: string) => [...s].reduce((n, ch) => n + cells(ch), 0)
export const fit = (s: string, w: number) => {
  let out = ''
  let n = 0
  for (const ch of s) {
    if (n + cells(ch) > w) break
    out += ch
    n += cells(ch)
  }
  return out + ' '.repeat(Math.max(0, w - n))
}
export const left = (s: string, w: number) => ' '.repeat(Math.max(0, w - width(s))) + s
export const cut = (s: string, w: number) => (width(s) <= w ? s : `${fit(s, w - 1).trimEnd()}…`)
// A prompt is shown up to 80 cells, wherever it appears.
export const prompt = (s: string) => cut(s, 80)

/**
 * A waffle chart, as /context draws its grid: `cells` squares, each one share of the whole, handed to the slices in
 * their order by largest remainder so the squares always add up; none that is there at all goes without one. Returns the slice each square belongs to, row by row.
 */
export function waffle<T extends { v: number }>(slices: T[], cells = 100): T[] {
  const live = slices.filter(s => s.v > 0)
  const total = live.reduce((n, s) => n + s.v, 0)
  if (total <= 0) return []
  const exact = live.map(s => (s.v / total) * cells)
  // Anything there at all gets a square, as /context draws it; the largest give theirs up for it.
  const counts = exact.map(x => Math.max(1, Math.floor(x)))
  while (counts.reduce((n, c) => n + c, 0) > cells) {
    const most = counts.indexOf(Math.max(...counts))
    if ((counts[most] ?? 0) <= 1) break
    counts[most] = (counts[most] ?? 0) - 1
  }
  const left = Math.max(0, cells - counts.reduce((n, c) => n + c, 0))
  // The squares left over go to the slices that lost the most to rounding down; one already raised to its square lost nothing.
  exact
    .map((x, i) => ({ i, r: x < 1 ? -1 : x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r)
    .slice(0, left)
    .forEach(({ i }) => (counts[i] = (counts[i] ?? 0) + 1))
  return live.flatMap((s, i) => Array.from({ length: counts[i] ?? 0 }, () => s))
}

/**
 * A bar's cells for each value, `scale` filling `cells`: anything there at all gets one, and when they add up to more
 * than the bar holds, the largest give theirs up until they fit, so the bar never runs past its line.
 */
export function barCells(vs: number[], scale: number, cells: number): number[] {
  const counts = vs.map(v => (v > 0 ? Math.max(1, Math.round((v / Math.max(1, scale)) * cells)) : 0))
  while (counts.reduce((n, c) => n + c, 0) > cells) {
    const most = counts.indexOf(Math.max(...counts))
    if ((counts[most] ?? 0) <= 1) break
    counts[most] = (counts[most] ?? 0) - 1
  }
  return counts
}

// How long, in its two largest units: 45s, 3m05s, 2h10m, 1d04h.
export const span = (ms: number) => {
  const sec = Math.round(ms / 1000)
  return sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}s` : sec < 86400 ? `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m` : `${Math.floor(sec / 86400)}d${String(Math.floor((sec % 86400) / 3600)).padStart(2, '0')}h`
}
// The time of day a record line was written, on this machine's clock.
export const fmtTime = (ts: string) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
// A model's name without the family prefix every one shares.
export const shortModel = (m: string) => m.replace(/^claude-/, '')
/** A model's name at its tightest, for a key beside others: `claude-opus-5-5` is `opus55`, a dated build drops its date. */
export const tinyModel = (m: string) => shortModel(m).replace(/-\d{8}$/, '').replace(/-(\d+)(?:-(\d+))?$/, (_, a: string, b?: string) => `${a}${b ?? ''}`)
// An agent by its type; one the record only guessed says so.
export const typeOf = (info: { type: string; inferred?: boolean }) => (info.inferred ? `${info.type} (≈)` : info.type)

// An MCP tool is `mcp__<server>__<tool>`: show the server, then the tool, without the plugin's own prefix.
export const toolLabel = (name: string) => {
  if (!name.startsWith('mcp__')) return name
  const [, server = '', ...rest] = name.split('__')
  const bare = server.replace(/^(plugin_|claude_ai_)/, '')
  const half = Math.floor(bare.length / 2)
  const one = bare.length % 2 === 1 && bare.slice(0, half) === bare.slice(half + 1) ? bare.slice(0, half) : bare
  return `${one} · ${rest.join('__')}`
}

// Every token figure reads one way: ↑ what went into the model, ↓ what came out of it.
export const io = (i: string, o: string) => `↑${i} ↓${o}`
// In a column each figure keeps the room of the widest, so the arrows line up and a growing count wraps no row.
export const IO_W = (K_W + 1) * 2 + 1
export const ioCol = (i: number, o: number) => `${left(`↑${k(i)}`, K_W + 1)} ${left(`↓${k(o)}`, K_W + 1)}`
export const ioHead = `${left('↑', K_W + 1)} ${left('↓', K_W + 1)}`
// A price in dollars to the cent; — when there is none.
export const money = (n?: number) => (n === undefined ? '—' : `$${n.toFixed(2)}`)
