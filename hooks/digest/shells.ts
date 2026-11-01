import type { Shell } from '../../types'
import type { Row } from './record'

/**
 * The background shells one agent's record started, in the order they started. A Bash call's result names the task it
 * left running; the shell runs from the call until the task notification the harness queues as it ends, or a TaskStop
 * that names it. `endedAt` is the agent's own end for a shell the record never saw end, once the agent has ended.
 */
export function shellsOf(rows: Row[], owner: string, endedAt?: string): Shell[] {
  const calls = new Map<string, { ts: string; command: string; desc?: string }>()
  const out: Shell[] = []
  const byTask = new Map<string, Shell>()
  const end = (task: string | null | undefined, ts: string | null | undefined, status: string, exit?: number | null) => {
    const s = task ? byTask.get(task) : undefined
    if (!s || s.endedAt || !ts) return
    s.endedAt = ts
    s.status = status
    if (typeof exit === 'number') s.exit = exit
  }
  for (const r of rows) {
    if (r.t === 'assistant') {
      for (const b of r.c) {
        if (b.k === 'use' && b.name === 'Bash' && b.id && r.ts) calls.set(b.id, { ts: r.ts, command: b.d ?? '', desc: b.ds || undefined })
        if (b.k === 'use' && b.tk) end(b.tk, r.ts, 'killed')
      }
    } else if (r.t === 'user' && r.bg) {
      const res = r.c.find(b => b.k === 'res' && b.id && calls.has(b.id))
      const call = res?.id ? calls.get(res.id) : undefined
      if (!call || byTask.has(r.bg)) continue
      const s: Shell = { id: r.bg, owner, command: call.command, desc: call.desc, startedAt: call.ts, status: 'running' }
      byTask.set(r.bg, s)
      out.push(s)
    } else if (r.t === 'task') end(r.tid, r.ts, r.tst ?? 'completed', r.ec)
  }
  if (endedAt) for (const s of out) if (!s.endedAt) Object.assign(s, { endedAt, status: 'ended' })
  return out
}

/**
 * The shells as the session's own record ends them. A subagent's shell ends in main's record, not its own: the harness
 * queues the notification there, and a TaskStop main sends names it there too. A shell no record has seen end runs on,
 * whether or not the agent that started it has stopped to wait for it.
 */
export function endedBy(shells: Shell[], rows: Row[]): Shell[] {
  const ends = new Map<string, { ts: string; status: string; exit?: number }>()
  for (const r of rows) {
    if (!r.ts) continue
    if (r.t === 'task' && r.tid && !ends.has(r.tid)) ends.set(r.tid, { ts: r.ts, status: r.tst ?? 'completed', ...(typeof r.ec === 'number' ? { exit: r.ec } : {}) })
    if (r.t === 'assistant') for (const b of r.c) if (b.k === 'use' && b.tk && !ends.has(b.tk)) ends.set(b.tk, { ts: r.ts, status: 'killed' })
  }
  return shells.map(s => {
    const end = s.endedAt ? undefined : ends.get(s.id)
    return end ? { ...s, endedAt: end.ts, status: end.status, ...(end.exit !== undefined ? { exit: end.exit } : {}) } : s
  })
}

