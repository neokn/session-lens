import type { AgentRun, Combo, Req, Segment, TurnRow, Use } from '../../types'
import { addBills, billsOf, costOf, SEARCH_USD, usdOf } from './cost'
import { type Call, callKind, isAlike, isSameSetting, type Row, scan, type Step, tally } from './record'

// An agent's run and the main agent's turns, from the rows of their records: requests, settings and the subagents each
// turn launched. Pure.

// A subagent keeps its own record; the API's figures for its requests are exact, the first being its init context.
export function runOf(sc: ReturnType<typeof scan>): AgentRun {
  const { uses, results, steps, advised, searches, chat } = sc
  const billed = [...steps, ...advised]
  const { tools: plain, mcp, skills } = tally(uses, results)
  // MCP calls sit in the tool list under their full names, as the model wrote them.
  const tools: Record<string, Use> = { ...plain }
  for (const [server, m] of Object.entries(mcp)) {
    for (const [tool, u] of Object.entries(m.tools)) tools[`mcp__${server}__${tool}`] = u
  }
  const total = (s: Step) => s.i + s.cr + s.cw
  const first = steps[0]
  const lastStep = steps[steps.length - 1]
  return {
    turns: Math.max(1, chat.userCount),
    steps: steps.length,
    init: first ? total(first) : undefined,
    initCached: first?.cr,
    last: lastStep ? total(lastStep) : 0,
    peak: steps.reduce((m, s) => Math.max(m, total(s)), 0),
    output: steps.reduce((n, s) => n + s.o, 0),
    input: steps.reduce((n, s) => n + s.i, 0),
    cacheRead: steps.reduce((n, s) => n + s.cr, 0),
    cacheWrite: steps.reduce((n, s) => n + s.cw, 0),
    tools,
    skills: Object.fromEntries(Object.entries(skills).map(([name, count]) => [name, { count, tokens: 0 }])),
    model: sc.model,
    effort: sc.effort,
    usd: billed.reduce((n, s) => n + (usdOf(s) ?? 0), 0) + searches * SEARCH_USD,
    unpriced: billed.filter(s => usdOf(s) === undefined).length,
    unpricedModels: [...new Set(billed.filter(x => usdOf(x) === undefined && x.md).map(x => x.md as string))],
    byModel: billsOf(advised, ' (advisor)', billsOf(steps)),
    advisor: advised.length > 0 ? Object.values(billsOf(advised)).reduce(addBills) : undefined,
    searches: searches > 0 ? searches : undefined,
    segments: segmentsOf(sc.calls),
    settings: settingsOf(sc.calls),
    combos: combosOf(settingTurnsOf(sc)),
  }
}

// The settings the agent ran at, in order, once it ran at two or more.
const settingsOf = (calls: Call[]) => {
  const runs = runsOf(calls, isSameSetting)
  return runs.length >= 2 ? runs.map(run => ({ model: run.find(c => c.md)?.md ?? '?', effort: run.find(c => c.ef)?.ef ?? '—' })) : undefined
}

// Consecutive items alike, in order.
function runsOf<T>(xs: T[], isSame: (a: T, b: T) => boolean): T[][] {
  const out: T[][] = []
  for (const x of xs) {
    const last = out[out.length - 1]
    if (last && isSame(last[last.length - 1] as T, x)) last.push(x)
    else out.push([x])
  }
  return out
}

// The requests in runs of one model, once the model changed: each run's span, size and cost, and what its first
// request paid to write the cache again, the new model reading none of the old one's.
function segmentsOf(calls: Call[]): Segment[] | undefined {
  const runs = runsOf(calls, (a, b) => isAlike(a.md, b.md))
  if (runs.length < 2) return undefined
  return runs.map((run, n) => {
    const head = run[0] as Call
    const w = n > 0 ? costOf(head.s) : undefined
    return {
      model: run.find(c => c.md)?.md ?? '?',
      from: head.ts ?? '',
      to: run[run.length - 1]?.ts ?? '',
      steps: run.length,
      i: run.reduce((x, c) => x + c.s.i + c.s.cr + c.s.cw, 0),
      o: run.reduce((x, c) => x + c.s.o, 0),
      usd: run.reduce((x, c) => x + c.usd, 0),
      rewrite: w ? w.w5 + w.w1 : 0,
      rewriteTokens: n > 0 ? head.s.cw : 0,
    }
  })
}

type Counted = { tools: number; skills: number; mcp: number; th: number }
export type ComboTurn = { model?: string; effort?: string; turns: number; calls: Counted[]; steps?: number }
// A subagent's runs at one setting, each counted as a turn.
export const settingTurnsOf = (sc: ReturnType<typeof scan>): ComboTurn[] => runsOf(sc.calls, isSameSetting).map(run => ({ model: run.find(c => c.md)?.md, effort: run.find(c => c.ef)?.ef, turns: 1, calls: run }))

/** What each model / effort setting did, summed over the turns under it, in the order each was first used; only when there are `least` or more. */
export function combosOf(turns: ComboTurn[], least = 2): Combo[] | undefined {
  const by = new Map<string, Combo>()
  for (const t of turns) {
    const key = `${t.model ?? '?'}|${t.effort ?? '—'}`
    const c = by.get(key) ?? { model: t.model ?? '?', effort: t.effort ?? '—', turns: 0, steps: 0, tools: 0, skills: 0, mcp: 0, thinking: 0 }
    by.set(key, {
      ...c,
      turns: c.turns + t.turns,
      steps: c.steps + (t.steps ?? t.calls.length),
      tools: c.tools + t.calls.reduce((n, x) => n + x.tools, 0),
      skills: c.skills + t.calls.reduce((n, x) => n + x.skills, 0),
      mcp: c.mcp + t.calls.reduce((n, x) => n + x.mcp, 0),
      thinking: c.thinking + t.calls.reduce((n, x) => n + x.th, 0),
    })
  }
  return by.size >= least && by.size > 0 ? [...by.values()] : undefined
}

/**
 * A live turn's requests as they stand now: main is always waiting on a reply or on a tool, so when the record shows
 * neither, it is working from its last request on. Every running row runs to `elapsed`.
 */
// Where a request's bar lies on a lane of `laneW` cells spanning `total` ms: from its first cell, `b` cells long, at least
// one. Both ends land on a cell of their own, so a request sent where the last one ended meets it with no gap.
export function laneSpan(startMs: number, ms: number, total: number, laneW: number): { a: number; b: number } {
  const cell = (at: number) => Math.round((at / total) * laneW)
  const a = Math.min(laneW - 1, cell(startMs))
  return { a, b: Math.max(1, Math.min(laneW - a, cell(startMs + ms) - a)) }
}

// A running agent always has a `working` row: with no request out (a tool running, its shells or subagents waited on),
// one from its last request on, to now; before its first request, one from its start. `pending` is what that row holds
// beyond main's, such as the subagent it is of.
export function liveReqsOf(reqs: Req[], elapsed: number, who = 'main', pending: Partial<Req> = {}): Req[] {
  const last = reqs.filter(r => r.who === who).at(-1)
  const all = reqs.some(r => r.who === who && r.running) ? reqs : [...reqs, { who, depth: last?.depth ?? 0, no: (last?.no ?? 0) + 1, label: 'awaiting reply', startMs: last ? last.startMs + last.ms : 0, ms: 0, i: 0, o: 0, n: 0, running: true, ...pending }]
  const run = (r: Req) => (r.running ? { ...r, ms: Math.max(r.ms, elapsed - r.startMs) } : r)
  return all.map(r => (r.kids ? { ...run(r), kids: r.kids.map(run) } : run(r)))
}

export type Meta = { agentType?: string; description?: string; toolUseId?: string; parentAgentId?: string; model?: string; finished?: boolean; skill?: string }

const KEEP_REQS = 15

// What a turn did, by name: the main agent's tool calls, and how many of its requests thought or answered in words.
function didOf(a: { did: Record<string, number>; reqs: { kinds: string[] }[] }): Record<string, number> {
  const out = { ...a.did }
  const thinking = a.reqs.filter(r => r.kinds.includes('thinking')).length
  const replies = a.reqs.filter(r => r.kinds.includes('text')).length
  if (thinking > 0) out['thinking'] = thinking
  if (replies > 0) out['reply'] = replies
  return out
}
export const ms = (ts?: string | null) => (ts ? Date.parse(ts) : NaN)

// One row per request of the main agent and one per subagent the turn launched, in the order they began,
// each with where it sits on the turn's clock.
function reqsOf(
  a: { first?: string | null; last?: string | null; waiting?: string | null; reqs: { ts?: string | null; sent?: string | null; u: Step; kinds: string[] }[]; agents: string[] },
  agents: Record<string, AgentRun>,
  metas: Record<string, Meta>,
  spans: Record<string, Span>,
): Req[] {
  const t0 = ms(a.first)
  if (Number.isNaN(t0)) return []
  const rows: Req[] = []
  const fed = (s: Step) => s.i + s.cr + s.cw
  // A request starts when it is sent (the prompt, or the tool result before it), not when its reply is written, and
  // lasts to the next one sent; the last, to the turn's last reply, or to the request it is now waiting on.
  const sentOf = (r: { ts?: string | null; sent?: string | null }) => r.sent ?? r.ts
  a.reqs.forEach((r, idx) => {
    const start = ms(sentOf(r))
    const next = a.reqs[idx + 1]
    const end = ms(next ? sentOf(next) : (a.waiting ?? a.last))
    if (Number.isNaN(start)) return
    rows.push({ who: 'main', depth: 0, no: idx + 1, label: r.kinds.join(' · ') || 'reply', startMs: Math.max(0, start - t0), ms: Number.isNaN(end) ? 0 : Math.max(0, end - start), i: fed(r.u), o: r.u.o, n: 1 })
  })
  // A request sent that no reply has answered yet: it is in flight, and the record does not have it.
  const waiting = ms(a.waiting)
  if (!Number.isNaN(waiting)) rows.push({ who: 'main', depth: 0, no: a.reqs.length + 1, label: 'awaiting reply', startMs: Math.max(0, waiting - t0), ms: 0, i: 0, o: 0, n: 0, running: true })
  const depthOf = (id: string) => {
    let d = 1
    let c = id
    for (let i = 0; i < 6; i++) {
      const p = metas[c]?.parentAgentId
      if (!p || !a.agents.includes(p)) break
      d += 1
      c = p
    }
    return d
  }
  for (const id of a.agents) {
    const run = agents[id]
    const span = spans[id]
    const start = ms(span?.start)
    const end = ms(span?.end)
    if (!run || Number.isNaN(start)) continue
    const who = metas[id]?.agentType ?? '?'
    const depth = depthOf(id)
    // Its own requests, moved from its clock onto the turn's.
    const tl = span?.timeline
    const kids = tl && tl.reqs.length > 0 ? tl.reqs.map(k => ({ ...k, who, depth, of: id, startMs: Math.max(0, k.startMs + tl.at - t0) })) : undefined
    rows.push({ who, depth, label: metas[id]?.description ?? id, startMs: Math.max(0, start - t0), ms: Number.isNaN(end) ? 0 : Math.max(0, end - start), i: run.input + run.cacheRead + run.cacheWrite, o: run.output, n: run.steps, running: metas[id]?.finished !== true, id, ...(kids ? { kids } : {}), ...(tl?.prompt ? { prompt: tl.prompt } : {}) })
  }
  return rows.sort((x, y) => x.startMs - y.startMs || x.depth - y.depth)
}

// A prompt is the person's own input; its turn runs until the next one. Everything the main agent requested in between,
// and everything the subagents it launched spent, is that turn's.
/** Where a subagent's record starts and ends, and its own requests from `timeline.at` on. */
export type Span = { start: string | null; end: string | null; timeline?: Timeline }
export type Timeline = { at: number; reqs: Req[]; prompt?: string }

/** An agent's own requests on one clock from its first prompt, every turn's in order and numbered from 1. */
export function timelineOf(rows: Row[]): Timeline | undefined {
  const turns = turnsOf(rows, {}, {}, {})
  const at = ms(turns[0]?.startedAt)
  if (Number.isNaN(at)) return undefined
  let no = 0
  const reqs = turns.flatMap(t => (t.reqs ?? []).filter(r => r.who === 'main').map(r => ({ ...r, no: ++no, startMs: r.startMs + ms(t.startedAt) - at })))
  // What it was handed: the first message of its record, the prompt its parent wrote.
  return { at, reqs, prompt: turns[0]?.preview || undefined }
}

export function turnsOf(rows: Row[], agents: Record<string, AgentRun>, metas: Record<string, Meta>, spans: Record<string, Span>): TurnRow[] {
  type Pending = { ts?: string | null; sent?: string | null; u: Step; kinds: string[] }
  type Acc = { preview: string; first?: string | null; last?: string | null; sent?: string | null; waiting?: string | null; steps: Step[]; usd: number; useIds: Set<string>; agents: string[]; reqs: Pending[]; did: Record<string, number>; model?: string; effort?: string; calls: (Counted & { ef?: string; cut: number })[]; uses?: Set<string> }
  const accs: Acc[] = []
  const seen = new Set<string>()
  const pending = new Map<string, Pending>()
  let cur: Acc | undefined
  // The model of the latest request that named one, as scan reads it: a request is priced at it. The effort likewise.
  let model: string | undefined
  let effort: string | undefined
  const callOf = new Map<string, Counted>()
  // How many compactions came before: a run of an effort ends at one, so main's figures since the last can take it.
  let cuts = 0
  // What the next request is sent with, as a turn a new model starts is titled: the latest tool result or message in.
  const toolOf = new Map<string, string>()
  let input: string | undefined
  for (const r of rows) {
    if (r.t === 'compact') cuts += 1
    if (r.t === 'assistant' && r.md && !r.md.startsWith('<')) model = r.md
    if (r.t === 'assistant' && r.ef !== null && r.ef !== undefined) effort = String(r.ef)
    const isPrompt = r.t === 'user' && !r.meta && (!r.o || r.o === 'human') && (r.pv ?? '').trim() !== ''
    if (isPrompt) {
      input = undefined
      const text = r.pv ?? ''
      const command = /<command-name>([^<]*)<\/command-name>/.exec(text)
      cur = { preview: command ? (command[1] ?? '') : text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(), first: r.ts, last: r.ts, sent: r.ts, steps: [], usd: 0, useIds: new Set(), agents: [], reqs: [], did: {}, calls: [] }
      accs.push(cur)
      continue
    }
    if (cur && r.t === 'user') {
      const res = [...r.c].reverse().find(b => b.k === 'res')
      if (res) input = `${toolOf.get(res.id ?? '') ?? 'tool'} → ${res.r || '(empty)'}`
      for (const b of r.c) if (b.k === 'res' && b.id) cur.uses?.delete(b.id)
      cur.usd += (r.sc ?? 0) * SEARCH_USD
      // A tool's result is what the next request is sent with: a request goes out as the latest of them lands, and,
      // until a reply comes, one is waiting.
      if (r.ts && r.c.some(b => b.k === 'res')) {
        cur.sent = r.ts
        cur.waiting = r.ts
      }
    }
    if (!cur || r.t !== 'assistant') continue
    // Without a tool result between, a request went out once the one before had replied.
    const after = cur.last
    if (r.ts) cur.last = r.ts
    let req = r.id ? pending.get(r.id) : undefined
    if (r.id && r.u && !seen.has(r.id)) {
      seen.add(r.id)
      const sent = after && cur.sent && after > cur.sent ? after : cur.sent
      // Another model mid-turn starts a turn of its own, from when its first request went out: what each costs stays apart.
      // Another effort does not.
      if (cur.steps.length > 0 && !isAlike(cur.model, model)) {
        cur.last = after
        cur = { preview: input ?? cur.preview, first: sent ?? r.ts, last: r.ts, sent, steps: [], usd: 0, useIds: new Set(), agents: [], reqs: [], did: {}, calls: [] }
        accs.push(cur)
      }
      // A turn runs at what its first request named: a model or effort named only later fills in what was unknown.
      cur.model ??= model
      if (cur.steps.length === 0 || cur.effort === undefined) cur.effort = effort
      const { ad, th, ...u } = r.u
      const step = { ...u, md: model }
      const counted = { tools: 0, skills: 0, mcp: 0, th: typeof th === 'number' ? th : 0, ef: effort, cut: cuts }
      cur.calls.push(counted)
      callOf.set(r.id, counted)
      cur.steps.push(step)
      // What the request cost, with the advisor's requests inside it.
      cur.usd += [step, ...(ad ?? []).map(a => ({ ...a, md: a.md ?? undefined }))].reduce((n, s) => n + (usdOf(s) ?? 0), 0)
      req = { ts: r.ts, sent, u: r.u, kinds: [] }
      cur.waiting = undefined
      pending.set(r.id, req)
      cur.reqs.push(req)
    }
    for (const b of r.c) {
      if (b.k === 'use' && b.id) {
        toolOf.set(b.id, b.name ?? '?')
        // A tool still to come back keeps the turn open: main is working on it.
        if (!b.sv) (cur.uses ??= new Set()).add(b.id)
        cur.useIds.add(b.id)
        if (b.name !== 'SubagentHandback') {
          cur.did[b.name ?? '?'] = (cur.did[b.name ?? '?'] ?? 0) + 1
          const counted = r.id ? callOf.get(r.id) : undefined
          if (counted) counted[callKind(b.name ?? '?')] += 1
        }
      }
      // What the request was made of, in the words the waterfall prints.
      const kind = b.k === 'use' ? (b.name ?? '?') : b.k === 'text' ? 'text' : b.k === 'thinking' ? 'thinking' : undefined
      if (req && kind && !req.kinds.includes(kind)) req.kinds.push(kind)
    }
  }
  // A subagent belongs to the turn whose Agent call launched it; a nested one to its ancestor's turn.
  const rootOf = (id: string) => {
    let c = id
    for (let i = 0; i < 8; i++) {
      const p = metas[c]?.parentAgentId
      if (!p || !metas[p]) break
      c = p
    }
    return c
  }
  for (const id of Object.keys(agents)) {
    const useId = metas[rootOf(id)]?.toolUseId
    accs.find(a => useId && a.useIds.has(useId))?.agents.push(id)
  }
  const out: TurnRow[] = []
  accs.forEach((a, ai) => {
    if (a.steps.length === 0 && a.agents.length === 0) return
    const fed = (s: Step) => s.i + s.cr + s.cw
    let wrote = a.steps.reduce((n, s) => n + s.o, 0)
    let read = a.steps.reduce((n, s) => n + fed(s), 0)
    let cacheRead = a.steps.reduce((n, s) => n + s.cr, 0)
    let steps = a.steps.length
    let subWrote = 0
    let subRead = 0
    let subSteps = 0
    let usd = a.usd
    for (const id of a.agents) {
      const r = agents[id]
      if (!r) continue
      usd += r.usd ?? 0
      subWrote += r.output
      subRead += r.input + r.cacheRead + r.cacheWrite
      cacheRead += r.cacheRead
      steps += r.steps
      subSteps += r.steps
    }
    wrote += subWrote
    read += subRead
    const ms = a.first && a.last ? Math.max(0, Date.parse(a.last) - Date.parse(a.first)) : 0
    // Idle runs to the next prompt, even one that started no work of its own.
    const next = accs[ai + 1]?.first
    const idleMs = next && a.last ? Math.max(0, Date.parse(next) - Date.parse(a.last)) : undefined
    // The main agent's window as the turn ended: the whole prompt of its last request.
    const end = a.steps[a.steps.length - 1]
    // Only a turn that made requests of its own has a setting to compare.
    const prev = a.model ? [...out].reverse().find(t => t.model) : undefined
    // The newest turn is still going while a request waits for its reply or a tool has not come back.
    const isOpen = ai === accs.length - 1 && (a.waiting !== undefined && a.waiting !== null || (a.uses?.size ?? 0) > 0)
    out.push({ n: out.length + 1, preview: a.preview, usd, steps, wrote, read, cacheRead, subCount: a.agents.length, subSteps, subRead, subWrote, ms, startedAt: a.first ?? undefined, idleMs, ctx: end ? end.i + end.cr + end.cw : undefined, endedAt: a.last ?? undefined, did: didOf(a), model: a.model, effort: a.effort, switched: prev !== undefined && !isSameSetting({ md: prev.model, ef: prev.effort }, { md: a.model, ef: a.effort }) ? true : undefined, calls: { steps: a.calls.length, tools: a.calls.reduce((n, c) => n + c.tools, 0), skills: a.calls.reduce((n, c) => n + c.skills, 0), mcp: a.calls.reduce((n, c) => n + c.mcp, 0), thinking: a.calls.reduce((n, c) => n + c.th, 0) }, runs: runsOf(a.calls, (x, y) => x.cut === y.cut && (!y.ef || x.ef === y.ef)).map(run => ({ effort: run.find(c => c.ef)?.ef ?? a.effort, cut: run[0]?.cut ?? 0, steps: run.length, tools: run.reduce((n, c) => n + c.tools, 0), skills: run.reduce((n, c) => n + c.skills, 0), mcp: run.reduce((n, c) => n + c.mcp, 0), thinking: run.reduce((n, c) => n + c.th, 0) })), open: isOpen ? true : undefined, reqs: reqsOf(isOpen ? { ...a, waiting: a.waiting ?? a.last } : { ...a, waiting: undefined }, agents, metas, spans) })
  })
  // The waterfall is drawn for the newest turns only; older ones keep their totals.
  for (const t of out.slice(0, -KEEP_REQS)) delete t.reqs
  return out
}
