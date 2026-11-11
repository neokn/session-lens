import type { Compaction, TurnRow } from '../../types'
import { at } from './effort'
import type { TimelineSpan } from './timeline'

type SubAgent = { id: string; startedAt?: string; steps: number; isLive: boolean; events: { kind: string; ts: string }[] }

/** Each subagent's stretch for the Timeline: from its start to its last event, to `now` while it runs; its requests, and
 * the times of its tool, skill, MCP and agent calls. */
export function spansOf(agents: SubAgent[], now: number): TimelineSpan[] {
  return agents.flatMap(a => {
    if (!a.startedAt) return []
    const last = a.events.reduce((m, e) => (e.ts > m ? e.ts : m), a.startedAt)
    const calls = a.events.filter(e => e.kind === 'tool' || e.kind === 'mcp' || e.kind === 'skill' || e.kind === 'agent').map(e => e.ts)
    return [{ from: a.startedAt, to: a.isLive ? new Date(now).toISOString() : last, reqs: a.steps, calls }]
  })
}

/** How long the agent ran with nobody needed, stretch by stretch: one runs from a prompt to the next time the person came
 * in, a turn a new model started mid-turn carrying it on and a message sent mid-turn cutting it. A turn still going, or
 * one heard before the record holds it, runs to `now`. What woke the agent without the person (a shell or subagent that
 * ended, another session's message) is no prompt, so its work is already the turn's. */
export function awayOf(o: { turns: TurnRow[]; busySince?: number; now: number }): { median: number; longest: number; n: number } {
  const runs: { from: number; to: number }[] = []
  for (const t of o.turns) {
    if (!t.startedAt) continue
    const from = Date.parse(t.startedAt)
    const to = t.open ? o.now : from + t.ms
    const last = runs[runs.length - 1]
    if (t.split && last) last.to = Math.max(last.to, to)
    else runs.push({ from, to })
    for (const q of (t.asked ?? []).map(Date.parse).filter(q => q > from && q < to).sort((a, b) => a - b)) {
      const cut = runs[runs.length - 1]
      if (!cut || q <= cut.from) continue
      cut.to = q
      runs.push({ from: q, to })
    }
  }
  if (o.busySince !== undefined && !o.turns[o.turns.length - 1]?.open) runs.push({ from: o.busySince, to: o.now })
  const sorted = runs.map(r => Math.max(0, r.to - r.from)).sort((a, b) => a - b)
  return { median: at(sorted, 0.5), longest: sorted[sorted.length - 1] ?? 0, n: sorted.length }
}

/** The session's figures, as numbers: what the Timeline holds in all, what compacting dropped, and how long the agent ran
 * with nobody needed. */
export function sessionFiguresOf(o: { turns: TurnRow[]; busySince?: number; compactions: Compaction[]; cols: { reqs: number; calls: number }[]; now: number }): { reqs: number; calls: number; dropped: number; away: { median: number; longest: number; n: number } } {
  return {
    reqs: Math.round(o.cols.reduce((n, c) => n + c.reqs, 0)),
    calls: Math.round(o.cols.reduce((n, c) => n + c.calls, 0)),
    dropped: o.compactions.reduce((n, x) => n + Math.max(0, x.pre - x.post), 0),
    away: awayOf(o),
  }
}
