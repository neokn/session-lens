import type { AgentRun, Bill, Ledger, Reading, Spend, TokenKinds } from '../../types'
import type { Priced, Step } from './record'

// What requests cost: list prices, the tokens of each kind, and the ledger the harness's own readings settle. Pure.

// List prices in USD per million tokens: input, output, cache read. Most specific id first; a model not here is not priced.
const PRICES: [string, number, number, number][] = [
  ['claude-fable-5-1', 10, 50, 0.25],
  ['claude-mythos-5-1', 10, 50, 0.25],
  ['claude-fable-5', 10, 50, 1],
  ['claude-mythos-5', 10, 50, 1],
  ['claude-opus-5-5', 4, 20, 0.2],
  ['claude-opus-5', 5, 25, 0.5],
  ['claude-opus-4-8', 5, 25, 0.5],
  ['claude-opus-4-7', 5, 25, 0.5],
  ['claude-opus-4-6', 5, 25, 0.5],
  ['claude-opus-4-5', 5, 25, 0.5],
  ['claude-opus-4', 15, 75, 1.5],
  ['claude-sonnet-5-5', 2, 10, 0.2],
  ['claude-sonnet-5', 2, 10, 0.2],
  ['claude-sonnet-4', 3, 15, 0.3],
  ['claude-haiku-5-5', 0.1, 0.5, 0.01],
  ['claude-haiku-4-5', 1, 5, 0.1],
]

/** One request's tokens by the kind each is billed as; an hour's write is the part of `cw` the API says was written for an hour. */
export function kindsOf(s: Step): TokenKinds {
  const w1 = Math.min(s.c1 ?? 0, s.cw)
  return { i: s.i, cr: s.cr, w5: s.cw - w1, w1, o: s.o }
}

/**
 * What one request cost by kind, each at its own rate: fresh input, cache reads, cache writes at 1.25x input for five
 * minutes or 2x for an hour, and output. Haiku 5.5 charges five times as much for a prompt over 100K.
 */
export function costOf(s: Step): TokenKinds | undefined {
  const row = s.md ? PRICES.find(([id]) => s.md === id || s.md?.startsWith(`${id}-`) || s.md?.startsWith(`${id}[`)) : undefined
  if (!row) return undefined
  const [id, inRate, outRate, readRate] = row
  const per = ((id === 'claude-haiku-5-5' && s.i + s.cr + s.cw > 100_000 ? 5 : 1) / 1_000_000)
  const t = kindsOf(s)
  return { i: t.i * inRate * per, cr: t.cr * readRate * per, w5: t.w5 * inRate * 1.25 * per, w1: t.w1 * inRate * 2 * per, o: t.o * outRate * per }
}

export const sumKinds = (x: TokenKinds) => x.i + x.cr + x.w5 + x.w1 + x.o
export const addKinds = (a: TokenKinds, b: TokenKinds): TokenKinds => ({ i: a.i + b.i, cr: a.cr + b.cr, w5: a.w5 + b.w5, w1: a.w1 + b.w1, o: a.o + b.o })

export function usdOf(s: Step): number | undefined {
  const c = costOf(s)
  return c ? sumKinds(c) : undefined
}

/**
 * What each stretch of the session cost by the harness's count, from every reading of it. A count runs on across
 * resumes: a process takes it up from what the harness last wrote, so each reading spent what it reached less that, in
 * the time since the reading before it. One process's count is written several times as it exits, the most it reached
 * standing; what the lens took gives way to a count written once that process was done, unless another process had
 * started by then. Several counts are several chains: /login starts another and leaves the one before as it stood.
 */
export function spendsOf(readings: Reading[]): Spend[] {
  const written = new Map<string, Reading>()
  for (const r of readings) if (r.proc === undefined && (written.get(`${r.start}:${r.at}`)?.usd ?? -1) < r.usd) written.set(`${r.start}:${r.at}`, r)
  const procs = readings.flatMap(r => (r.proc === undefined ? [] : [r.proc]))
  const isPassed = (r: Reading) => [...written.values()].some(w => w.start === r.start && w.at >= r.at && w.usd >= r.usd && !procs.some(p => p > r.at && p <= w.at))
  const kept = [...written.values(), ...readings.filter(r => r.proc !== undefined && !isPassed(r))]
  // What one model spent between two readings the harness wrote; without both, no model is known.
  const less = (now: Record<string, number>, base: Record<string, number>) =>
    Object.fromEntries(Object.entries(now).flatMap(([m, usd]) => (usd - (base[m] ?? 0) > 1e-9 ? [[m, usd - (base[m] ?? 0)]] : [])))
  const out: Spend[] = []
  for (const start of new Set(kept.map(r => r.start))) {
    let from = start
    let base: Reading | undefined
    for (const r of kept.filter(x => x.start === start).sort((a, b) => a.at - b.at)) {
      const byModel = r.byModel && (!base || base.byModel) ? less(r.byModel, base?.byModel ?? {}) : undefined
      out.push({ start: from, end: r.at, usd: Math.max(0, r.usd - (base?.usd ?? 0)), ...(byModel && { byModel }) })
      from = r.at
      if (r.proc === undefined) base = r
    }
  }
  return out
}

/**
 * The session's total from what was measured and what the record says. Each stretch the harness counted (`spends`, after
 * `start` up to `end`) counts as measured; the requests in none of them are priced from the record. Where both are known the
 * record falls short of the measure (side requests leave no usage behind), by a ratio of each model's own where the
 * measure names its models; a model the record never priced there is a side request's, its cost spread over the record
 * as a share of it. A model with no ratio of its own takes the ratio of the whole. The rest is somewhere between its record
 * price and that price scaled: the midpoint, give or take half the gap. With nothing measured the record price stands.
 */
export function ledgerOf(spends: Spend[], priced: Priced[]): Ledger {
  const isIn = (s: Spend, ts: number) => ts > s.start && ts <= s.end
  const add = (m: Record<string, number>, key: string, n: number) => (m[key] = (m[key] ?? 0) + n)
  const snapped = spends.reduce((n, s) => n + s.usd, 0)
  let measured = 0
  let recorded = 0
  const byMeasured: Record<string, number> = {}
  const byRecorded: Record<string, number> = {}
  let side = 0
  let sideOf = 0
  for (const s of spends) {
    const inside = priced.filter(p => isIn(s, p.ts))
    const e = inside.reduce((n, p) => n + p.usd, 0)
    if (e <= 0) continue
    measured += s.usd
    recorded += e
    if (!s.byModel || Object.keys(s.byModel).length === 0) continue
    const rec: Record<string, number> = {}
    for (const p of inside) add(rec, p.md ?? '?', p.usd)
    sideOf += e
    for (const [m, usd] of Object.entries(s.byModel)) {
      if ((rec[m] ?? 0) > 0) {
        add(byMeasured, m, usd)
        add(byRecorded, m, rec[m] ?? 0)
      } else side += usd
    }
  }
  const ratio = recorded > 0 ? measured / recorded : undefined
  const sideShare = sideOf > 0 ? side / sideOf : 0
  const ratios = Object.fromEntries(Object.entries(byMeasured).map(([m, usd]) => [m, usd / (byRecorded[m] ?? 1) + sideShare]))
  const rest = priced.filter(p => !spends.some(s => isIn(s, p.ts)))
  const rawBy: Record<string, number> = {}
  for (const p of rest) add(rawBy, p.md ?? '?', p.usd)
  const raw = rest.reduce((n, p) => n + p.usd, 0)
  // Each model between its record price and that price scaled, then summed: the midpoints and the half gaps alike.
  let estimated = 0
  let pm = 0
  const used: Record<string, { ratio: number; isOwn: boolean }> = {}
  for (const [m, usd] of Object.entries(rawBy)) {
    const r = ratios[m] ?? ratio ?? 1
    used[m] = { ratio: r, isOwn: ratios[m] !== undefined }
    const hi = usd * r
    estimated += (usd + hi) / 2
    pm += Math.abs(hi - usd) / 2
  }
  return { total: snapped + estimated, pm, snapped, estimated, raw, ratio, ratios: Object.keys(ratios).length > 0 ? used : undefined, isFull: raw === 0 && spends.length > 0 }
}

/** What one web search costs, apart from the tokens: $10 for a thousand. */
export const SEARCH_USD = 0.01
// What an agent's requests cost, or nothing when none of them could be priced.
export const costOfRun = (r: AgentRun) => (r.steps > 0 && (r.unpriced ?? 0) >= r.steps ? undefined : r.usd)
// Agents, the dearest first; one without a run or a price counts as nothing.
export const byCost = (ids: string[], runOf: (id: string) => AgentRun | undefined) => {
  const usd = (id: string) => {
    const r = runOf(id)
    return (r ? costOfRun(r) : undefined) ?? 0
  }
  return [...ids].sort((a, b) => usd(b) - usd(a))
}

export const addBills = (a: Bill, b: Bill): Bill => ({ steps: a.steps + b.steps, tokens: addKinds(a.tokens, b.tokens), usd: a.usd && b.usd ? addKinds(a.usd, b.usd) : (a.usd ?? b.usd) })

// The requests of one run by the model that served each; `tag` marks a server tool's own requests apart from the agent's.
export function billsOf(steps: Step[], tag = '', bills: Record<string, Bill> = {}): Record<string, Bill> {
  for (const s of steps) {
    const key = `${s.md ?? '?'}${tag}`
    const b = bills[key] ?? { steps: 0, tokens: { i: 0, cr: 0, w5: 0, w1: 0, o: 0 } }
    const c = costOf(s)
    bills[key] = { steps: b.steps + 1, tokens: addKinds(b.tokens, kindsOf(s)), usd: c ? addKinds(b.usd ?? { i: 0, cr: 0, w5: 0, w1: 0, o: 0 }, c) : b.usd }
  }
  return bills
}

const ZERO: TokenKinds = { i: 0, cr: 0, w5: 0, w1: 0, o: 0 }

// A model by the form of agent it served as: main, subagent or advisor; the same model in two forms is two rows. What
// went on each kind of token, and on web searches, billed by the search and not by the token.
export function costModelOf(runs: [string, AgentRun][]) {
  const byModel = new Map<string, { model: string; where: string; steps: number; tokens: TokenKinds; usd?: TokenKinds; agents: Set<string> }>()
  for (const [id, r] of runs) {
    for (const [key, b] of Object.entries(r.byModel ?? {})) {
      const isAdvisor = key.endsWith(' (advisor)')
      const model = isAdvisor ? key.slice(0, -' (advisor)'.length) : key
      const where = isAdvisor ? 'advisor' : id === 'main' ? 'main' : 'subagent'
      const g = byModel.get(`${model}|${where}`) ?? { model, where, steps: 0, tokens: ZERO, agents: new Set<string>() }
      byModel.set(`${model}|${where}`, { ...g, steps: g.steps + b.steps, tokens: addKinds(g.tokens, b.tokens), usd: b.usd ? addKinds(g.usd ?? ZERO, b.usd) : g.usd, agents: g.agents.add(id) })
    }
  }
  const kindUsd = [...byModel.values()].reduce((x, g) => addKinds(x, g.usd ?? ZERO), ZERO)
  const searchUsd = runs.reduce((n, [, r]) => n + (r.searches ?? 0) * SEARCH_USD, 0)
  return { byModel, kindUsd, searchUsd }
}
