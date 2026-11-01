import { Spacer } from '../atoms/Spacer'
import type { AgentMeta, AgentRun } from '../../../types'
import { fed } from '../../digest/agents'
import { costOfRun, SEARCH_USD, sumKinds } from '../../digest/cost'
import { fmtTime, k, K_W, left, money, shortModel, typeOf } from '../layout'
import { CostHead, CostRow } from '../molecules/CostRow'
import { MoreRow, type PageStep } from '../molecules/MoreRow'
import { T, SPACE } from '../palette'
import type { UI } from '../ui'

// One line of the table: who or what, a note beside it, its requests, tokens in and out, and what it cost.
export type CostLine = { key: string; indent: number; name: string; note: string; reqs: number; i: number; o: number; cost: number | undefined; color?: string; noteColor?: string }
// Under an agent: a cost line, the cache a new model wrote again, or the presses that page the agents it launched.
export type CostItem = { row: CostLine } | { rewrite: { key: string; indent: number; tokens: number; usd: number } } | { page: { key: string; indent: number; more?: PageStep; fewer?: PageStep } }

const line = (key: string, indent: number, name: string, note: string, reqs: number, i: number, o: number, cost: number | undefined, color?: string, noteColor?: string): CostItem => ({ row: { key, indent, name, note, reqs, i, o, cost, color, noteColor } })
// The advisor runs on its own model inside a request: its cost is in the agent's, shown again on a line of its own,
// named by the model it ran on.
const advisorName = (model?: string) => `Advisor (${model ? shortModel(model) : '?'})`
const advisorLines = (key: string, indent: number, r: AgentRun) =>
  Object.entries(r.byModel ?? {})
    .filter(([m]) => m.endsWith(' (advisor)'))
    .map(([m, b]) => line(`${key}-${m}`, indent, advisorName(m.slice(0, -' (advisor)'.length)), '', b.steps, b.tokens.i + b.tokens.cr + b.tokens.w5 + b.tokens.w1, b.tokens.o, b.usd ? sumKinds(b.usd) : undefined, T.cost.spend))
// A web search is billed by the search, apart from its tokens: counted in the agent's cost, shown on a line of its own.
const searchLine = (key: string, indent: number, n: number) => line(key, indent, 'web search', `· ${n} searches`, n, 0, 0, n * SEARCH_USD, T.cost.spend)
// An agent that changed model: its requests in runs of one model, from when to when, beneath it. The first request on a
// new model reads none of the old one's cache and writes it again: what that cost, when it did.
const segmentLines = (key: string, indent: number, r: AgentRun) =>
  (r.segments ?? []).flatMap((g, n): CostItem[] => {
    const hhmm = (ts: string) => (ts ? fmtTime(ts).slice(0, 5) : '?')
    return [
      line(`${key}-${n}`, indent, shortModel(g.model), `${hhmm(g.from)}–${n === (r.segments?.length ?? 0) - 1 ? '' : hhmm(g.to)}`, g.steps, g.i, g.o, g.usd, T.text.soft),
      ...(g.rewrite >= 0.005 ? [{ rewrite: { key: `${key}-${n}-rw`, indent, tokens: g.rewriteTokens, usd: g.rewrite } }] : []),
    ]
  })
// What an agent's line says beneath it: its runs of one model, its advisor and its searches.
const partsOf = (key: string, indent: number, r: AgentRun) => [
  ...(r.segments ? segmentLines(`${key}-seg`, indent, r) : []),
  ...(r.advisor ? advisorLines(`${key}-advisor`, indent, r) : []),
  ...(r.searches ? [searchLine(`${key}-search`, indent, r.searches)] : []),
]

// Which of a list are shown, and the presses that page it.
export type Pages = { shown: <T>(key: string, list: T[]) => T[]; steps: (key: string, total: number) => { more?: PageStep; fewer?: PageStep } }

/** The lines by agent: main and what its requests split into, then the agents it launched, the dearest first, each with
 * the ones it launched beneath it; every list of agents paged on its own. */
export function agentCostItems(main: { run: AgentRun; model: string }, who: Record<string, AgentMeta>, runOf: (id: string) => AgentRun | undefined, kidsOf: (id: string) => string[], roots: string[], pages: Pages): CostItem[] {
  const items: CostItem[] = [line('cost-main', 0, 'main agent', `· ${shortModel(main.model)}`, main.run.steps, fed(main.run), main.run.output, costOfRun(main.run), T.actor.main), ...partsOf('cost-main', 2, main.run)]
  const walk = (id: string, depth: number) => {
    const r = runOf(id)
    const info = who[id]
    if (r && info) items.push(line(`cost-${id}`, depth * 2, typeOf(info), `· ${info.description}`, r.steps, fed(r), r.output, costOfRun(r), depth > 1 ? T.actor.subEcho : T.actor.sub))
    if (r) items.push(...partsOf(`cost-${id}`, depth * 2 + 2, r))
    for (const c of pages.shown(`cost-${id}`, kidsOf(id))) walk(c, depth + 1)
    items.push({ page: { key: `cost-${id}`, indent: depth * 2 + 2, ...pages.steps(`cost-${id}`, kidsOf(id).length) } })
  }
  for (const root of pages.shown('cost', roots)) walk(root, 1)
  return items
}

// What the session's list price went on: by model, then by agent with the nested ones beneath their caller. Each
// line's share is of the session's whole cost; more and fewer page the agents main launched.
export function CostTable({ ui, nameWidth, sessionUsd, byModel, byAgent, more, fewer }: { ui: UI; nameWidth: number; sessionUsd: number; byModel: CostLine[]; byAgent: CostItem[]; more?: PageStep; fewer?: PageStep }) {
  const { Box, Text } = ui
  const shareOf = (n?: number) => (n === undefined || sessionUsd <= 0 ? '-' : `${Math.round((n / sessionUsd) * 100)}%`)
  const line = (x: CostLine) => <CostRow ui={ui} key={x.key} nameWidth={nameWidth} indent={x.indent} name={x.name} note={x.note} reqs={x.reqs} i={x.i} o={x.o} cost={x.cost} share={shareOf(x.cost)} color={x.color} noteColor={x.noteColor} />
  return (
    <Box flexDirection="column" paddingLeft={SPACE.indent}>
      <CostHead ui={ui} label="By model (per request)" nameWidth={nameWidth} />
      {byModel.map(line)}
      <Spacer ui={ui} />
      <CostHead ui={ui} label="By agent (incl. nested)" nameWidth={nameWidth} />
      {byAgent.map(x =>
        'row' in x ? (
          line(x.row)
        ) : 'rewrite' in x ? (
          <Text key={x.rewrite.key} color={T.text.muted}>{`${' '.repeat(x.rewrite.indent + 2)}incl. cache rewrite ${left(k(x.rewrite.tokens), K_W)}  ${money(x.rewrite.usd)}`}</Text>
        ) : (
          <MoreRow ui={ui} listKey={x.page.key} indent={x.page.indent} more={x.page.more} fewer={x.page.fewer} />
        ),
      )}
      <MoreRow ui={ui} listKey="cost" indent={0} more={more} fewer={fewer} />
    </Box>
  )
}
