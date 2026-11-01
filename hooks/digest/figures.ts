import type { Compaction, Shell, TurnRow } from '../../types'
import { workedOf, type Busy, type TimelineSpan } from './timeline'

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

// How a shell ends when its result comes back to the session. One still running, killed, or left when its agent ended
// brought nothing back, and a server left running looks just like a build until then.
const RETURNED = ['completed', 'failed']

/** The session's figures, as numbers: what the Timeline holds in all, what compacting dropped, and how long something
 * ran. Work is the union of main's turns, the subagents' stretches and the stretches of the shells whose result came
 * back, a turn or subagent still running counted to `now`. */
export function sessionFiguresOf(o: { turns: TurnRow[]; busySince?: number; spans: TimelineSpan[]; shells: Shell[]; compactions: Compaction[]; cols: { reqs: number; calls: number }[]; now: number }): { reqs: number; calls: number; dropped: number; worked: { total: number; longest: number } } {
  const busy: Busy[] = [
    ...o.turns.flatMap(t => (t.startedAt ? [{ from: Date.parse(t.startedAt), to: t.open ? o.now : Date.parse(t.startedAt) + t.ms }] : [])),
    ...(o.busySince !== undefined ? [{ from: o.busySince, to: o.now }] : []),
    ...o.spans.map(x => ({ from: Date.parse(x.from), to: Date.parse(x.to) })),
    ...o.shells.flatMap(x => (x.endedAt && RETURNED.includes(x.status) ? [{ from: Date.parse(x.startedAt), to: Date.parse(x.endedAt) }] : [])),
  ]
  return {
    reqs: Math.round(o.cols.reduce((n, c) => n + c.reqs, 0)),
    calls: Math.round(o.cols.reduce((n, c) => n + c.calls, 0)),
    dropped: o.compactions.reduce((n, x) => n + Math.max(0, x.pre - x.post), 0),
    worked: workedOf(busy),
  }
}
