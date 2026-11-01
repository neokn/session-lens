import type { AgentMeta, AgentRun, Chat, ChatGroup, ChatKind, Combo, Compaction, EventRow, FailedCall, McpUse, Reading, Shell, TurnRow, Use } from '../../types'
import { SEARCH_USD, usdOf } from './cost'

// The record's rows as jq leaves them, and what one agent's rows add up to. Pure: it reads no file and calls no tool.

export type Block = { k: string; sv?: boolean; id?: string; name?: string; n?: number; w?: number; sk?: string | null; pl?: number; e?: boolean; ts?: string | null; d?: string; r?: string; x?: string; ds?: string | null; tk?: string | null }
export type Reply = { ts: string | null; o: number; x?: string }
// `c1` is the share of `cw` written for an hour; `md` the model that served the request, which prices it.
export type Step = { i: number; o: number; cr: number; cw: number; c1?: number; md?: string }
// A request's figures leave out what a server tool ran on another model inside it (the advisor): its own iterations, in `ad`.
// `th` is what the request spent thinking, when the API says so.
type Usage = Step & { th?: number | null; ad?: (Omit<Step, 'md'> & { md: string | null })[] }
// A process's cost as the harness wrote it at exit (`cost`): `st` when the process started (epoch ms), `usd` its total, `bm` by model.
// `fallback`: the safeguards moved the session to another model. `sent`: a request went out, on model `md`.
// A hook's row: `at` its attachment type, `hn` the event and matcher (`PreToolUse:Bash`), `cmd` what ran, `ms` how long, `ec` its exit
// code, `n` the length of what it handed the model, `r` the first line of what it said.
export type Row = { t: 'user' | 'assistant' | 'attachment' | 'cmd' | 'compact' | 'hook' | 'tooldef' | 'cost' | 'fallback' | 'sent' | 'task'; bg?: string | null; tid?: string | null; tu?: string | null; tst?: string | null; st?: number | null; usd?: number | null; bm?: Record<string, number>; h?: string | null; at?: string | null; hn?: string | null; cmd?: string | null; ms?: number | null; ec?: number | null; r?: string | null; id: string | null; ts?: string | null; o?: string | null; meta?: boolean; ef?: string | number | null; md?: string | null; pv?: string | null; n?: number; names?: string[]; args?: string[]; tr?: string | null; pre?: number | null; post?: number | null; cs?: boolean; bu?: string | null; pu?: string[]; qp?: { x: string; n: number } | null; sc?: number | null; su?: string | null; u: Usage | null; c: Block[] }

// Roughly 4 characters per token for ASCII, one per CJK / other wide character.
export const est = (n: number, wide = 0) => Math.ceil((n - wide) / 4) + wide
// CJK and other wide characters: a token each, and two terminal cells.
export const isWide = (ch: string) => ch.charCodeAt(0) > 0x2e7f
// The estimate of a whole text, its wide characters counted.
export const estimateTokens = (text: string) => est(text.length, [...text].filter(isWide).length)

// An agent's run before anything is read of it.
export const emptyRun = (): AgentRun => ({ turns: 0, steps: 0, last: 0, peak: 0, output: 0, input: 0, cacheRead: 0, cacheWrite: 0, tools: {}, skills: {} })

// A skill listed as `plugin:name` in one place and `name` in another is the same skill.
export const same = (a: string, b: string) => a === b || a.endsWith(`:${b}`) || b.endsWith(`:${a}`)

// One request of an agent with the setting it ran at, what it cost (the advisor's requests inside it too) and what it called.
export type Call = { ts: string | null; s: Step; md?: string; ef?: string; usd: number; tools: number; skills: number; mcp: number; th: number }
// A change of model or effort from one request to the next; `fallback` when the safeguards made it.
export type Switch = { ts: string; from: string; to: string; fallback: boolean }
// What one request or search cost at list price, when it was written, and the model it ran on.
export type Priced = { ts: number; usd: number; md?: string }

export const callKind = (name: string) => (name.startsWith('mcp__') ? 'mcp' : name === 'Skill' ? 'skills' : 'tools')
const settingOf = (c: { md?: string; ef?: string }) => `${(c.md ?? '?').replace(/^claude-/, '')} / ${c.ef ?? '—'}`
// Two values the same, one not yet known matching any: a record that names its effort late has not switched.
export const isAlike = (a?: string, b?: string) => a === undefined || b === undefined || a === b
export const isSameSetting = (a: { md?: string; ef?: string }, b: { md?: string; ef?: string }) => isAlike(a.md, b.md) && isAlike(a.ef, b.ef)

export type Digest = {
  tools: Record<string, Use>
  mcp: Record<string, McpUse>
  skills: Record<string, number>
  chat: Chat
  main: AgentRun
  /** Main agent from its last compaction on. */
  mainNow: AgentRun
  agents: Record<string, AgentRun>
  info: Record<string, AgentMeta>
  failed: FailedCall[]
  shells: Shell[]
  turns: TurnRow[]
  events: EventRow[]
  commands: Record<string, number>
  compactions: Compaction[]
  /** Every setting the session ran at, main and its subagents together. */
  sessionCombos: Combo[]
  /** What the harness counted as each process exited, and every priced request or search of every agent. */
  readings: Reading[]
  priced: Priced[]
  lines: number
}

const GROUPS_KEPT = 300

export function scan(rows: Row[]) {
  const uses = new Map<string, Block>()
  const results = new Map<string, Block>()
  const steps: Step[] = []
  // The advisor's own requests: billed, but not the agent's window.
  const advised: Step[] = []
  // Web searches a tool ran on the server, each billed apart from the tokens.
  let searches = 0
  const seen = new Set<string>()
  const replied = new Set<string>()
  const replies: Reply[] = []
  let firstTs: string | null = null
  let lastTs: string | null = null
  // The model and effort the agent's latest request named; a harness-made reply names `<synthetic>`.
  let model: string | undefined
  let effort: string | undefined
  const commands: Record<string, number> = {}
  const chat: Chat = noChat()
  // What each kind holds, by what it is, for the kind's own page.
  const groups = new Map<ChatKind, Map<string, ChatGroup>>()
  const put = (kind: ChatKind, label: string, tokens: number, count = 1) => {
    const of = groups.get(kind) ?? new Map<string, ChatGroup>()
    groups.set(kind, of)
    const g = of.get(label) ?? { label, count: 0, tokens: 0 }
    of.set(label, { label, count: g.count + count, tokens: g.tokens + tokens })
  }
  const hooks: Row[] = []
  const defs = new Set<string>()
  const calls: Call[] = []
  const callOf = new Map<string, Call>()
  const switches: Switch[] = []
  // Every priced request or search, by when it was written: what the session's total is checked against.
  const priced: Priced[] = []
  let fellBack = false
  // The last request sent that no reply came back to: one in flight, or one whose process was killed waiting.
  let unanswered: { ts: string | null; md?: string } | undefined
  for (const r of rows) {
    if (r.t === 'cost' || r.t === 'task') continue
    if (r.t === 'sent') {
      unanswered = { ts: r.ts ?? null, md: r.md ?? undefined }
      continue
    }
    if (r.t === 'assistant') unanswered = undefined
    if (r.t === 'fallback') {
      fellBack = true
      continue
    }
    // A hook ran beside the agent, not as part of its conversation: kept for the log, out of the agent's figures.
    if (r.t === 'hook') {
      hooks.push(r)
      continue
    }
    // The tools the model may call beyond those sent with the request (deferred ones once loaded): the harness puts
    // their definitions into the request's messages, and the record keeps that message only as a blob, once per content.
    if (r.t === 'tooldef') {
      if (r.h && defs.has(r.h)) continue
      if (r.h) defs.add(r.h)
      for (const b of r.c) {
        chat.toolDefCount += 1
        chat.toolDefTokens += est(b.n ?? 0)
        put('toolDef', b.name ?? 'unknown', est(b.n ?? 0))
      }
      continue
    }
    if (!firstTs && r.ts) firstTs = r.ts
    if (r.ts) lastTs = r.ts
    if (r.t === 'attachment') {
      // A prompt sent while the agent works reaches it as an attachment, but it is the person's.
      if (r.qp) {
        chat.userCount += 1
        chat.userTokens += est(r.qp.n)
        put('user', r.qp.x, est(r.qp.n))
      } else {
        chat.attachCount += 1
        chat.attachTokens += est(r.n ?? 0)
        put('attach', r.at ?? 'unknown', est(r.n ?? 0))
      }
      continue
    }
    if (r.t === 'cmd') {
      for (const name of r.names ?? []) commands[name.trim()] = (commands[name.trim()] ?? 0) + 1
      continue
    }
    if (r.t === 'assistant') {
      if (r.md && !r.md.startsWith('<')) model = r.md
      if (r.ef !== null && r.ef !== undefined) effort = String(r.ef)
      // A reply is one line per block, each repeating the request's figures: count a request once. A harness-made reply
      // (`<synthetic>`, such as a session limit's notice) sent no request: its figures are all zero.
      if (r.id && r.u && !seen.has(r.id) && !r.md?.startsWith('<')) {
        seen.add(r.id)
        const { ad, th, ...u } = r.u
        const step = { ...u, md: model }
        steps.push(step)
        const inner = (ad ?? []).map(a => ({ ...a, md: a.md ?? undefined }))
        advised.push(...inner)
        const call: Call = { ts: r.ts ?? null, s: step, md: model, ef: effort, usd: [step, ...inner].reduce((n, x) => n + (usdOf(x) ?? 0), 0), tools: 0, skills: 0, mcp: 0, th: typeof th === 'number' ? th : 0 }
        const prev = calls[calls.length - 1]
        if (prev && r.ts && !isSameSetting(prev, call)) {
          // The model is named again only when it changed.
          switches.push({ ts: r.ts, from: settingOf(prev), to: isAlike(prev.md, call.md) ? (call.ef ?? '—') : settingOf(call), fallback: fellBack })
          fellBack = false
        }
        calls.push(call)
        callOf.set(r.id, call)
        const at = r.ts ? Date.parse(r.ts) : NaN
        // Each at the model that served it, the advisor's apart: the harness counts its cost under the advisor's model.
        if (!Number.isNaN(at)) for (const x of [step, ...inner]) priced.push({ ts: at, usd: usdOf(x) ?? 0, md: x.md })
        chat.outputTokens += r.u.o
        if (typeof th === 'number') chat.thinkingTokens = (chat.thinkingTokens ?? 0) + th
      }
      for (const b of r.c) {
        // A server tool's result comes back in the same reply as its call.
        if (b.k === 'res' && b.id) results.set(b.id, b)
        if (b.k === 'use' && b.id) {
          const call = r.id ? callOf.get(r.id) : undefined
          if (call && b.name !== 'SubagentHandback') call[callKind(b.name ?? '?')] += 1
          uses.set(b.id, { ...b, ts: r.ts })
          chat.toolCount += 1
          chat.toolTokens += est(b.n ?? 0)
          put('tool', b.name ?? '?', est(b.n ?? 0))
        }
        if (b.k === 'text' && (b.n ?? 0) > 0) {
          replies.push({ ts: r.ts ?? null, o: est(b.n ?? 0, b.w), x: b.x })
          chat.replyTokens += est(b.n ?? 0, b.w)
          put('reply', b.x ?? '', est(b.n ?? 0, b.w))
          const key = r.id ?? `row${replied.size}`
          if (!replied.has(key)) {
            replied.add(key)
            chat.replyCount += 1
          }
        }
      }
    } else {
      // A user turn is not always the person: the harness injects a skill's whole expansion and reminders (isMeta),
      // and other agents and background tasks report in under their own origin.
      let tokens = 0
      searches += r.sc ?? 0
      if (r.sc && r.ts) priced.push({ ts: Date.parse(r.ts), usd: r.sc * SEARCH_USD, md: model })
      for (const b of r.c) {
        if (b.k === 'res' && b.id) {
          // When it came back: with the call's own time, the stretch a Bash call ran.
          results.set(b.id, { ...b, ts: r.ts })
          chat.toolTokens += est(b.n ?? 0)
          // A result is the call's: its size is counted under the tool that was called.
          put('tool', uses.get(b.id)?.name ?? '?', est(b.n ?? 0), 0)
        }
        if (b.k === 'text' && (b.n ?? 0) > 0) tokens += est(b.n ?? 0, b.w)
      }
      if (tokens > 0) {
        const x = r.c.find(b => b.k === 'text' && (b.n ?? 0) > 0)?.x ?? ''
        if (r.meta) {
          chat.injectedTokens += tokens
          chat.injectedCount += 1
          // A skill's expansion answers the Skill call that loaded it; anything else is named by its opening tag.
          const by = r.su ? uses.get(r.su) : undefined
          const tag = /^\s*<([a-z][\w-]*)/i.exec(x)?.[1]
          put('injected', by?.name === 'Skill' ? `Skill: ${by.sk ?? '?'}` : r.cs ? 'Compaction summary' : tag ? `<${tag}>` : x, tokens)
        } else if (r.o && r.o !== 'human') {
          chat.noticeTokens += tokens
          chat.noticeCount += 1
          put('notice', `${r.o}: ${x}`, tokens)
        } else {
          chat.userTokens += tokens
          chat.userCount += 1
          put('user', x, tokens)
        }
      }
    }
  }
  // The largest of each kind: a page lists no more than a few hundred.
  chat.groups = Object.fromEntries([...groups].map(([kind, of]) => [kind, [...of.values()].sort((a, b) => b.tokens - a.tokens).slice(0, GROUPS_KEPT)]))
  return { uses, results, steps, advised, searches, chat, firstTs, lastTs, commands, replies, model, effort, hooks, calls, switches, priced, unanswered }
}

export const noChat = (): Chat => ({ userCount: 0, userTokens: 0, replyCount: 0, replyTokens: 0, injectedCount: 0, injectedTokens: 0, noticeCount: 0, noticeTokens: 0, attachCount: 0, attachTokens: 0, toolCount: 0, toolTokens: 0, toolDefCount: 0, toolDefTokens: 0, outputTokens: 0 })

const bump = (u: Use | undefined, wrote: number, read: number, isError: boolean, server?: boolean): Use => ({
  ...(server ? { server } : {}),
  calls: (u?.calls ?? 0) + 1,
  errors: (u?.errors ?? 0) + (isError ? 1 : 0),
  wrote: (u?.wrote ?? 0) + wrote,
  read: (u?.read ?? 0) + read,
})

// Every tool call paired with its result: by tool, by MCP server, and the skills the Skill tool named.
export function tally(uses: Map<string, Block>, results: Map<string, Block>) {
  const tools: Record<string, Use> = {}
  const mcp: Record<string, McpUse> = {}
  const skills: Record<string, number> = {}
  for (const [id, u] of uses) {
    const name = u.name ?? '?'
    const res = results.get(id)
    const wrote = est(u.n ?? 0)
    const read = res ? est(res.n ?? 0) : 0
    const isError = res?.e === true
    if (name === 'Skill' && u.sk) skills[u.sk] = (skills[u.sk] ?? 0) + 1
    if (name.startsWith('mcp__')) {
      const [, server = '?', ...rest] = name.split('__')
      const tool = rest.join('__')
      const s = mcp[server]
      mcp[server] = { ...bump(s, wrote, read, isError), tools: { ...s?.tools, [tool]: bump(s?.tools[tool], wrote, read, isError) } }
    } else {
      tools[name] = bump(tools[name], wrote, read, isError, u.sv)
    }
  }
  return { tools, mcp, skills }
}
