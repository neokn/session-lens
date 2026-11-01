import type { Compaction, TurnRow } from '../../types'

// The session on one clock, from its first prompt to now, cut into as many
// equal stretches as there are columns. Each column holds what main and its subagents sent the model and what they called
// in that stretch,
// the setting it ran at (an idle stretch keeps the one before it), and whether a compaction fell in it; idle stretches
// hold no work. Agents and shells are marks on
// a lane of their own, by when they started.
export type TimelineCol = { reqs: number; calls: number; setting?: string; isCompact: boolean }
export type MarkKind = 'agent' | 'shell'
export type TimelineMark = { col: number; kind: MarkKind; depth: number; isLive: boolean }
export type TimelineStart = { at: string; kind: MarkKind; depth: number; isLive: boolean }
// A subagent's work, on the session's clock: its requests spread over the stretch it ran, its calls when each was made.
export type TimelineSpan = { from: string; to: string; reqs: number; calls: string[] }
export type Timeline = { cols: TimelineCol[]; marks: TimelineMark[]; from: number; to: number }

const ms = (iso?: string) => (iso ? Date.parse(iso) : Number.NaN)

/** The columns and marks of a session's timeline, `room` wide. A turn's requests and calls are spread evenly over the
 * stretch it ran; `setting` is the model / effort of the last turn in the column. A column holds one mark: the kind
 * of start there are most of in it, on a tie the kind there are fewest of in the whole timeline. */
export function timelineOf(o: { turns: TurnRow[]; spans?: TimelineSpan[]; compactions: Compaction[]; starts: TimelineStart[]; now: number; room: number; settingOf: (t: TurnRow) => string | undefined }): Timeline {
  const room = Math.max(1, o.room)
  const spans = o.turns.flatMap(t => {
    const start = ms(t.startedAt)
    if (Number.isNaN(start)) return []
    return [{ t, start, end: t.open ? Math.max(start + t.ms, o.now) : start + t.ms }]
  })
  const cols: TimelineCol[] = Array.from({ length: room }, () => ({ reqs: 0, calls: 0, isCompact: false }))
  if (spans.length === 0) return { cols, marks: [], from: 0, to: 0 }
  const subs = (o.spans ?? []).flatMap(x => {
    const start = ms(x.from)
    const end = ms(x.to)
    return Number.isNaN(start) || Number.isNaN(end) ? [] : [{ ...x, start, end: Math.max(start, end) }]
  })
  const from = Math.min(...spans.map(s => s.start), ...subs.map(s => s.start))
  // It runs to now: the session's clock goes on while nothing runs, the idle stretch at its end growing.
  const to = Math.max(from + 1, o.now, ...spans.map(s => s.end), ...subs.map(s => s.end))
  const step = (to - from) / room
  const colAt = (t: number) => Math.min(room - 1, Math.max(0, Math.floor((t - from) / step)))
  for (const s of spans) {
    const calls = s.t.calls ? s.t.calls.tools + s.t.calls.skills + s.t.calls.mcp : 0
    const a = colAt(s.start)
    // The column its end falls in, or the one before when it ends on a boundary: a column holds what ran inside it.
    const b = Math.min(room - 1, Math.max(a, Math.ceil((s.end - from) / step) - 1))
    const n = b - a + 1
    for (let c = a; c <= b; c++) {
      const col = cols[c]
      if (!col) continue
      // A turn's steps hold its subagents' too: they are added from their own spans below, so the turn gives main's alone.
      col.reqs += (s.t.steps - (s.t.subSteps ?? 0)) / n
      col.calls += calls / n
      col.setting = o.settingOf(s.t) ?? col.setting
    }
  }
  // A subagent's requests and calls stack with main's: every request of the session went to a model.
  for (const x of subs) {
    const a = colAt(x.start)
    const b = Math.min(room - 1, Math.max(a, Math.ceil((x.end - from) / step) - 1))
    for (let c = a; c <= b; c++) {
      const col = cols[c]
      if (col) col.reqs += x.reqs / (b - a + 1)
    }
    for (const at of x.calls) {
      const t = ms(at)
      const col = Number.isNaN(t) ? undefined : cols[colAt(t)]
      if (col) col.calls += 1
    }
  }
  // The setting holds while main is idle: it is what the next request would be sent with, so the line runs on.
  for (let c = 1; c < room; c++) {
    const col = cols[c]
    if (col && col.setting === undefined) col.setting = cols[c - 1]?.setting
  }
  for (const x of o.compactions) {
    const t = ms(x.ts)
    if (!Number.isNaN(t) && t >= from && t <= to) {
      const col = cols[colAt(t)]
      if (col) col.isCompact = true
    }
  }
  // One mark a column, the kind of start there are most of in it (a kind is a glyph and a hue: its agent depth, or who
  // started the shell); on a tie the one there are fewest of in the whole timeline, then the earliest. It is live while
  // any start of that kind in the column still runs.
  const kindOf = (x: TimelineStart) => `${x.kind}:${x.depth}`
  const starts = o.starts
    .map(x => ({ ...x, t: ms(x.at) }))
    .filter(x => !Number.isNaN(x.t))
    .sort((p, q) => p.t - q.t)
  const overall = new Map<string, number>()
  const byCol = new Map<number, typeof starts>()
  for (const x of starts) {
    overall.set(kindOf(x), (overall.get(kindOf(x)) ?? 0) + 1)
    const col = colAt(Math.min(to, Math.max(from, x.t)))
    byCol.set(col, [...(byCol.get(col) ?? []), x])
  }
  const placed: TimelineMark[] = [...byCol].map(([col, here]) => {
    const inCol = (x: TimelineStart) => here.filter(y => kindOf(y) === kindOf(x)).length
    const pick = here.reduce((best, x) => {
      const d = inCol(x) - inCol(best) || (overall.get(kindOf(best)) ?? 0) - (overall.get(kindOf(x)) ?? 0)
      return d > 0 ? x : best
    })
    return { col, kind: pick.kind, depth: pick.depth, isLive: here.some(y => kindOf(y) === kindOf(pick) && y.isLive) }
  })
  return { cols, marks: placed.sort((p, q) => p.col - q.col), from, to }
}

export const LEVELS = '▁▂▃▄▅▆▇█'

// One cell of a stacked column: a block `eighths` tall from its foot, the part below `split` eighths requests and the
// rest calls; `split` is where requests end inside it, 0 to 8.
export type StackCell = { eighths: number; split: number } | null

/** A column's cells, top row first, `rows` tall: requests from the foot, calls on them, square-root scaled to `max`. */
export function stackCells(col: { reqs: number; calls: number }, max: number, rows = 2): StackCell[] {
  const total = col.reqs + col.calls
  if (total <= 0 || max <= 0) return Array.from({ length: rows }, () => null)
  const all = rows * 8
  const height = Math.max(1, Math.round(Math.sqrt(Math.min(1, total / max)) * all))
  const reqH = Math.round((height * col.reqs) / total)
  return Array.from({ length: rows }, (_, n) => {
    const foot = (rows - 1 - n) * 8
    const eighths = Math.max(0, Math.min(8, height - foot))
    return eighths === 0 ? null : { eighths, split: Math.max(0, Math.min(eighths, reqH - foot)) }
  })
}

// A stretch something ran: a turn of main's, a subagent or `claude -p` child, a background shell.
export type Busy = { from: number; to: number }

/** How long something ran, and the longest run of it with no idle gap in it: the union of every stretch, so two that
 * overlap count once and two that touch make one run. The session's idle is the Timeline's span less `total`, which the
 * page leaves to the reader. */
export function workedOf(busy: Busy[]): { total: number; longest: number } {
  const runs = busy.filter(b => !Number.isNaN(b.from) && !Number.isNaN(b.to)).sort((p, q) => p.from - q.from)
  let total = 0
  let longest = 0
  let from: number | undefined
  let end: number | undefined
  const close = () => {
    if (from === undefined || end === undefined) return
    total += end - from
    longest = Math.max(longest, end - from)
  }
  for (const b of runs) {
    const to = Math.max(b.from, b.to)
    if (end === undefined || b.from > end) {
      close()
      from = b.from
      end = to
    } else end = Math.max(end, to)
  }
  close()
  return { total, longest }
}
