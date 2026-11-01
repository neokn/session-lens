import type { AgentMeta, AgentRun } from '../../types'
import { emptyRun } from './record'

// What a request read: what was sent, and the cache it read and wrote.
export const fed = (r: { input: number; cacheRead: number; cacheWrite: number }) => r.input + r.cacheRead + r.cacheWrite

// The session's agents as a tree, oldest first: each under the agent that launched it, one whose parent is not known at
// the top. With main's run, what the whole session sent and wrote. Pure.
export function agentTreeOf(who: Record<string, AgentMeta>, runs: Record<string, AgentRun>, mine: AgentRun | null) {
  const ids = Object.keys(who).sort((a, b) => (who[a]?.startedAt ?? '').localeCompare(who[b]?.startedAt ?? ''))
  const known = new Set(ids)
  const parentOf = (id: string) => {
    const p = who[id]?.parentId
    return p && known.has(p) ? p : undefined
  }
  const kids = new Map<string | undefined, string[]>()
  for (const i of ids) kids.set(parentOf(i), [...(kids.get(parentOf(i)) ?? []), i])
  const kidsOf = (parent?: string) => kids.get(parent) ?? []
  const runOf = (id: string): AgentRun | undefined => (runs[id] ? { ...emptyRun(), ...runs[id] } : undefined)
  const modelOf = (id: string) => who[id]?.model ?? 'default'
  const subRuns = ids.map(runOf).filter((r): r is AgentRun => r !== undefined)
  const running = ids.filter(id => who[id]?.status === 'running')
  const whole = mine
    ? { steps: mine.steps + subRuns.reduce((n, r) => n + r.steps, 0), i: fed(mine) + subRuns.reduce((n, r) => n + fed(r), 0), o: mine.output + subRuns.reduce((n, r) => n + r.output, 0) }
    : { steps: 0, i: 0, o: 0 }
  const subTotal = subRuns.reduce((n, r) => n + fed(r) + r.output, 0)
  // What the whole session cost at list price, main and every subagent, each request at its own model's rates.
  const everyRun = mine ? [mine, ...subRuns] : subRuns
  const usd = everyRun.reduce((n, r) => n + (r.usd ?? 0), 0)
  const unpriced = everyRun.reduce((n, r) => n + (r.unpriced ?? 0), 0)
  const unpricedModels = [...new Set(everyRun.flatMap(r => r.unpricedModels ?? []))]
  return { ids, parentOf, kidsOf, runOf, modelOf, subRuns, running, whole, subTotal, usd, unpriced, unpricedModels }
}
