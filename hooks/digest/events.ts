import type { EventRow } from '../../types'

export type WhoFilter = 'all' | 'main' | 'sub'
export type KindFilter = 'all' | 'tool' | 'agent' | 'talk' | 'hook' | 'compact'
export const KIND_FILTERS: readonly KindFilter[] = ['all', 'tool', 'agent', 'talk', 'hook', 'compact']

// tool covers tool, MCP and skill; talk what the person sent and every reply; hook the hooks that put something into
// the context. Under all, the hooks wait behind their own filter.
const MERGED: Record<string, Set<string>> = { tool: new Set(['tool', 'mcp', 'skill']), talk: new Set(['reply', 'prompt']) }
export const pickEvents = (log: EventRow[], who: WhoFilter, kind: KindFilter) =>
  log.filter(x => (who === 'all' || (who === 'main' ? x.depth === 0 : x.depth > 0)) && (kind === 'all' ? x.kind !== 'hook' : (MERGED[kind]?.has(x.kind) ?? x.kind === kind)))

// The events under their turn, newest first. What is in no turn groups after the turn before it: `after` names that
// turn, 0 before the first.
export type EventGroup = { turn: number; after?: number; rows: EventRow[] }
export const eventGroupsOf = (picked: EventRow[]): EventGroup[] => {
  const groups: EventGroup[] = []
  let lastTurn = 0
  for (const x of picked) {
    const turn = x.turn ?? 0
    const after = x.turn ? undefined : lastTurn
    if (x.turn) lastTurn = x.turn
    const g = groups[groups.length - 1]
    if (g && g.turn === turn && g.after === after) g.rows.push(x)
    else groups.push({ turn, after, rows: [x] })
  }
  groups.reverse()
  for (const g of groups) g.rows.reverse()
  return groups
}
