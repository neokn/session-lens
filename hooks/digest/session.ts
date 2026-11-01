import type { AgentMeta, AgentRun, Compaction, EventRow, FailedCall, Reading, Shell, TurnRow } from '../../types'
import { type Block, type Digest, est, type Priced, type Reply, type Row, scan, type Switch, tally } from './record'
import { combosOf, type ComboTurn, type Meta, runOf, settingTurnsOf, type Timeline, timelineOf, turnsOf } from './turns'
import { endedBy, shellsOf } from './shells'

// The session as the pane reads it, from what `record/` read: the main agent's rows and every agent's digest. Pure: the
// readings are handed in, so a test can give it any it likes.

export type AgentDigest = { size: number; run: AgentRun; unanswered?: { ts: string | null; md?: string }; uses: Map<string, Block>; results: Map<string, Block>; startedAt: string | null; endedAt: string | null; report?: number; prompt?: number; opening?: number; replies: Reply[]; hooks: Row[]; switches: Switch[]; priced: Priced[]; settings: ComboTurn[]; said?: string; timeline?: Timeline; shells?: Shell[] }

// How a `claude -p` child a Bash call started stands, and whether it was guessed at from the records alone.
export type ChildState = { status: string; inferred?: boolean }

// What the adapter read for one reading: the main record's rows and its scan, every agent found, what each agent's meta
// file says, the children and their requests no reply came back to, and where each hook is written (by `hookKey`).
export type SessionReading = {
  rows: Row[]
  main: ReturnType<typeof scan>
  agents: Record<string, AgentRun>
  metas: Record<string, Meta>
  calls: Record<string, AgentDigest>
  childOf: Map<string, ChildState>
  cutOff: { child: string; ts: string; md?: string }[]
  cwd: string
  home: string
  hookSrc: Map<string, string[]>
}

// Where each hook is written, keyed by its event and its command as the record keeps it: whitespace run together, the
// first 120 characters. A command several sources share names them all.
export const hookKey = (event: string, cmd: string) => `${event}\0${cmd.replace(/\s+/g, ' ').trim().slice(0, 120)}`

/**
 * Why a dispatch started no subagent, as a kind the failures group by: the error's first sentence, the names it quotes
 * and the tags around it left out, so `Agent type 'x' not found. Available: …` and the same for 'y' read alike.
 */
export const whyFailed = (r?: string): string => {
  const plain = (r ?? '').replace(/<\/?[\w-]+>/g, '').replace(/(['"`])[^'"`]*\1/g, '').split(/[.:;]\s/)[0]?.replace(/\s+/g, ' ').trim()
  return plain || 'no reason given'
}

// What an agent's record adds up to: what its node, its log and the totals need of it. `size` is the size it was read at.
export function agentDigestOf(rows: Row[], size: number): AgentDigest {
  const sc = scan(rows)
  // The report it handed back is the argument of its last call to the harness's hand-back tool.
  const handback = [...sc.uses.values()].filter(u => u.name === 'SubagentHandback').pop()
  // Its first message: the task it was given, which for a forked skill is the skill's prompt.
  const firstAsk = rows.find(r => r.t === 'user')
  const first = firstAsk?.c.filter(b => b.k === 'text').reduce((n, b) => n + est(b.n ?? 0, b.w), 0)
  // Its initial prompt: every user message before its first reply, what the harness injected included.
  const replied = rows.findIndex(r => r.t === 'assistant')
  const opening = rows.slice(0, replied < 0 ? rows.length : replied).filter(r => r.t === 'user').reduce((n, r) => n + r.c.reduce((m, b) => m + (b.k === 'text' ? est(b.n ?? 0, b.w) : 0), 0), 0)
  const said = rows.find(r => r.t === 'user' && (r.pv ?? '').trim() !== '')?.pv?.replace(/\s+/g, ' ').trim()
  return { size, run: runOf(sc), unanswered: sc.unanswered, uses: sc.uses, results: sc.results, startedAt: sc.firstTs, endedAt: sc.lastTs, replies: sc.replies, hooks: sc.hooks, switches: sc.switches, priced: sc.priced, settings: settingTurnsOf(sc), report: handback ? est(handback.n ?? 0) : undefined, prompt: first, opening, said, timeline: timelineOf(rows), shells: shellsOf(rows, '') }
}

export function sessionOf({ rows, main, agents, metas, calls, childOf, cutOff, cwd, home, hookSrc }: SessionReading): Digest {
  // Every agent's background shells, ended as the session's record ends them. A subagent that stopped to wait for one of
  // its own still runs: its record goes on when the shell ends.
  const shells = endedBy([...shellsOf(rows, 'main'), ...Object.entries(calls).flatMap(([id, c]) => (c.shells ?? []).map(s => ({ ...s, owner: id })))], rows)
  const waiting = new Set(shells.filter(s => !s.endedAt).map(s => s.owner))
  metas = Object.fromEntries(Object.entries(metas).map(([id, m]) => [id, waiting.has(id) && m.finished ? { ...m, finished: false } : m]))
  const info: Record<string, AgentMeta> = {}
  // Each compaction leaves a boundary in the record; it is not a message, so it stays out of the rest of the reading.
  // What follows a boundary, up to the next request, is what the window restarts from; the summary is the part it wrote.
  const compactions: Compaction[] = []
  let restart: Compaction | undefined
  for (const r of rows) {
    if (r.t === 'compact') {
      restart = { ts: r.ts ?? '', trigger: r.tr ?? 'auto', pre: r.pre ?? 0, post: r.post ?? 0, ms: r.ms ?? undefined, uuid: r.bu ?? undefined, keep: r.pu ?? [] }
      compactions.push(restart)
    } else if (restart && r.t === 'assistant') restart = undefined
    else if (restart && r.cs) restart.summary = r.c.reduce((n, b) => n + (b.k === 'text' ? est(b.n ?? 0, b.w) : 0), 0)
  }
  // Compactions stay in: a run of an effort ends at one.
  const mainRows = rows.filter(r => r.t !== 'hook' && r.t !== 'cost' && r.t !== 'fallback' && r.t !== 'sent' && r.t !== 'task')
  // Main agent's own figures start again at its last compaction: what came before has left its window. The session's
  // totals, its turns and its log keep the whole record.
  let cut = 0
  rows.forEach((r, n) => {
    if (r.t === 'compact') cut = n + 1
  })
  const now = scan(rows.slice(cut))
  const { tools, mcp, skills } = tally(main.uses, main.results)
  // The Agent call that started a subagent sits in its parent's record: the main one, or another subagent's.
  const answered = new Set<string>()
  for (const [agentId, meta] of Object.entries(metas)) {
    const parent = (meta.parentAgentId ? calls[meta.parentAgentId] : undefined) ?? main
    const child = childOf.get(agentId)
    // A child's call is the Bash command that started it, not a dispatch: what it was given is its own first message.
    const call = meta.toolUseId && !child ? parent.uses.get(meta.toolUseId) : undefined
    if (meta.toolUseId) answered.add(meta.toolUseId)
    info[agentId] = {
      type: meta.agentType ?? '?',
      description: meta.description ?? agentId,
      status: child?.status ?? (meta.finished ? 'completed' : 'running'),
      ...(child?.inferred ? { inferred: true } : {}),
      model: meta.model,
      parentId: meta.parentAgentId,
      startedAt: calls[agentId]?.startedAt ?? undefined,
      // A forked skill has no Agent call: main hands it the skill's prompt, and its last reply comes back to main as the result.
      call: call ? est(call.n ?? 0) : meta.skill ? calls[agentId]?.prompt : undefined,
      ack: call ? est(parent.results.get(call.id ?? '')?.n ?? 0) : undefined,
      report: calls[agentId]?.report ?? (meta.skill ? calls[agentId]?.replies.at(-1)?.o : undefined),
      skill: meta.skill,
      prompt: calls[agentId]?.opening,
    }
  }
  const failed: FailedCall[] = []
  for (const [host, scanned] of [['main', main] as const, ...Object.entries(calls)]) {
    for (const [useId, use] of scanned.uses) {
      if (use.name === 'Agent' && !answered.has(useId)) {
        const res = scanned.results.get(useId)
        failed.push({ host, i: est(res?.n ?? 0), o: est(use.n ?? 0), why: whyFailed(res?.r) })
      }
    }
  }

  // Every action of every agent, for the log: each tool call with what went out and what came back, each reply.
  const events: EventRow[] = []
  const agentOfUse = new Map(Object.entries(metas).map(([agentId, m]) => [m.toolUseId, agentId] as const))
  const depthOf = (agentId: string) => {
    let d = 1
    let c = agentId
    for (let n = 0; n < 6; n++) {
      const p = metas[c]?.parentAgentId
      if (!p || !metas[p]) break
      d += 1
      c = p
    }
    return d
  }
  const short = (s?: string) => s?.replaceAll(`${cwd}/`, '') || undefined
  const collect = (agent: string, who: string, depth: number, uses: Map<string, Block>, results: Map<string, Block>, replies: Reply[], hooks: Row[], switches: Switch[]) => {
    // A change of model or effort, by itself: what it cost shows in the requests after it.
    for (const w of switches) events.push({ ts: w.ts, who, agent, depth, kind: 'switch', name: `⇄ ${w.from} → ${w.to}${w.fallback ? ' (safeguard fallback)' : ''}`, o: 0 })
    for (const [useId, u] of uses) {
      if (!u.ts) continue
      const res = results.get(useId)
      const name = u.name ?? '?'
      if (name === 'SubagentHandback') {
        events.push({ ts: u.ts, who, depth, kind: 'reply', name: 'report to parent', o: est(u.n ?? 0), detail: short(u.d) })
        continue
      }
      const kind: EventRow['kind'] = name.startsWith('mcp__') ? 'mcp' : name === 'Skill' ? 'skill' : name === 'Agent' ? 'agent' : 'tool'
      const label = kind === 'skill' ? `Skill · ${u.sk ?? '?'}` : kind === 'agent' ? `Agent → ${metas[agentOfUse.get(useId) ?? '']?.agentType ?? '(not started)'}` : name
      const detail = short(kind === 'agent' ? (metas[agentOfUse.get(useId) ?? '']?.description ?? u.d) : u.d)
      events.push({ ts: u.ts, who, agent, depth, kind, name: label, o: est(u.n ?? 0), i: res ? est(res.n ?? 0) : undefined, detail, result: short(res?.r), isError: res?.e || undefined })
    }
    for (const r of replies) if (r.ts) events.push({ ts: r.ts, who, agent, depth, kind: 'reply', name: 'reply', o: r.o, detail: r.x || undefined })
    // A hook's own row, only for a hook that put something into the context: what a SessionStart or UserPromptSubmit hook
    // printed, context another hook added, or the stderr of one that blocked; any other output is the person's to see,
    // not the model's. A non-zero exit or an error, a block or a cancel the engine names is a failure.
    for (const h of hooks) {
      const intoContext = h.at === 'hook_additional_context' || h.at === 'hook_blocking_error' || (h.at === 'hook_success' && /^(SessionStart|UserPromptSubmit)\b/.test(h.hn ?? ''))
      if (!h.ts || !intoContext || (h.n ?? 0) <= 0) continue
      events.push({
        ts: h.ts, who, agent, depth, kind: 'hook', name: h.hn ?? h.at ?? 'hook', o: 0,
        i: est(h.n ?? 0),
        detail: h.cmd ? h.cmd.replaceAll(home, '~') : undefined,
        result: h.r || undefined,
        isError: /error|block|cancel/.test(h.at ?? '') || (h.ec ?? 0) !== 0 || undefined,
        ms: h.ms ?? undefined,
        src: h.cmd ? (hookSrc.get(hookKey((h.hn ?? '').split(':')[0] ?? '', h.cmd)) ?? ['?']).join('+') : undefined,
      })
    }
  }
  collect('main', 'main', 0, main.uses, main.results, main.replies, main.hooks, main.switches)
  // What the person sent from the prompt box: a prompt, a slash command with its arguments, a ! shell line.
  // Anything else tagged (a command's output, a reminder) is not theirs.
  // What the person sends goes into the model: its tokens are `i`, and nothing comes out of it.
  const typed = (ts: string, said: string, i: number) => events.push({ ts, who: 'user', depth: 0, kind: 'prompt', name: said, o: 0, i })
  // When the person sent something that could open a turn, as turnsOf reads it: their own user row (a prompt, a slash
  // command, a ! line), not a command a system row mentions nor one sent mid-turn.
  const opens: string[] = []
  for (const r of mainRows) {
    if (!r.ts) continue
    if (r.t === 'cmd') {
      ;(r.names ?? []).forEach((name, n) => {
        const said = `/${name.trim()} ${(r.args?.[n] ?? '').replace(/\s+/g, ' ')}`.trim()
        typed(r.ts as string, said, est(said.length))
      })
      continue
    }
    // Sent mid-turn: it joins the turn running then, so it opens no turn of its own.
    if (r.t === 'attachment' && r.qp) {
      const queued = r.qp.x.replace(/\s+/g, ' ').trim()
      if (queued && !queued.startsWith('<')) typed(r.ts, queued, est(r.qp.n))
      continue
    }
    const said = (r.pv ?? '').replace(/\s+/g, ' ').trim()
    if (r.t !== 'user' || r.meta || (r.o && r.o !== 'human') || !said) continue
    opens.push(r.ts)
    const shell = /^<bash-input>(.*?)(?:<\/bash-input>|$)/.exec(said)
    if (shell) typed(r.ts, `! ${shell[1] ?? ''}`, est(said.length))
    else if (!said.startsWith('<')) typed(r.ts, said, r.c.reduce((n, b) => n + (b.k === 'text' ? est(b.n ?? 0, b.w) : 0), 0))
  }
  for (const [agentId, c] of Object.entries(calls)) collect(agentId, info[agentId]?.type ?? agentId, depthOf(agentId), c.uses, c.results, c.replies, c.hooks, c.switches)
  // A child a Bash call started, as an Agent call starts a subagent: under whoever made the call, when its record began,
  // given its first message. One Bash call may start several.
  for (const [child, { inferred }] of childOf) {
    const meta = metas[child]
    const host = meta?.parentAgentId
    const ts = calls[child]?.startedAt ?? (host ? calls[host] : main)?.uses.get(meta?.toolUseId ?? '')?.ts
    if (!ts) continue
    events.push({ ts, who: host ? (info[host]?.type ?? host) : 'main', depth: host ? depthOf(host) : 0, kind: 'agent', name: `Agent → claude -p${inferred ? ' (≈)' : ''}`, o: calls[child]?.prompt ?? 0, i: meta?.finished ? 0 : undefined, detail: short(meta?.description) })
  }
  // A child's request no reply came back to: its process ended while it waited.
  for (const c of cutOff) events.push({ ts: c.ts, who: info[c.child]?.type ?? c.child, depth: depthOf(c.child), kind: 'reply', name: 'request · no reply', o: 0, detail: `✗ request on ${c.md?.replace(/^claude-/, '') ?? '?'} · no reply, the process ended`, isError: true })
  // A compaction is an action of main's too: the window before, in `pre`, and after, in `i`.
  for (const c of compactions) if (c.ts) events.push({ ts: c.ts, who: 'main', depth: 0, kind: 'compact', name: 'compact', o: 0, i: c.post, pre: c.pre, detail: c.trigger, restart: c })
  events.sort((a, b) => a.ts.localeCompare(b.ts))
  const turns = turnsOf(mainRows, agents, metas, Object.fromEntries(Object.entries(calls).map(([id, c]) => [id, { start: c.startedAt, end: c.endedAt, timeline: c.timeline }])))
  // Each event belongs to the last turn that had started by then, unless the person sent something after it that opened
  // no turn of its own (a local command, a ! line): what follows that is in no turn.
  // A turn another model started begins as the reply before it was written: what was written then is the turn before's.
  opens.sort()
  const isOpened = new Set(opens)
  const hasStarted = (at: string, ts: string) => at < ts || (at === ts && isOpened.has(at))
  let t = 0
  let o = 0
  for (const e of events) {
    while (t < turns.length && hasStarted(turns[t]?.startedAt ?? '', e.ts)) t += 1
    while (o < opens.length && (opens[o] ?? '') <= e.ts) o += 1
    const turn = turns[t - 1]
    e.turn = turn && (opens[o - 1] ?? '') <= (turn.startedAt ?? '') ? turn.n : undefined
  }

  // What the harness counted as each process exited, by the last line before it.
  const readings: Reading[] = []
  let lastAt = NaN
  for (const r of rows) {
    if (r.ts) lastAt = Date.parse(r.ts)
    if (r.t !== 'cost' || typeof r.st !== 'number' || typeof r.usd !== 'number' || Number.isNaN(lastAt)) continue
    readings.push({ start: r.st, at: lastAt, usd: r.usd, byModel: r.bm })
  }
  // Main's settings by turn, a new model having started its own; a subagent's are by run, set in runOf.
  // Only a new model starts a turn: an effort switched mid-turn takes the share of the turn its requests made.
  const turnsSince = (ts: TurnRow[], since = 0): ComboTurn[] => ts.flatMap(t => {
    const runs = (t.runs ?? (t.calls ? [{ ...t.calls, effort: t.effort, cut: 0 }] : [])).filter(r => r.steps > 0 && r.cut >= since)
    const all = runs.reduce((n, r) => n + r.steps, 0)
    return runs.map(r => ({ model: t.model, effort: r.effort, turns: r.steps / all, calls: [{ tools: r.tools, skills: r.skills, mcp: r.mcp, th: r.thinking }], steps: r.steps }))
  })
  const combosOfTurns = (ts: TurnRow[], since = 0) => combosOf(turnsSince(ts, since))
  // The whole session's, main and every subagent, every setting it ran at, one or more.
  const sessionCombos = combosOf([...turnsSince(turns), ...Object.values(calls).flatMap(c => c.settings)], 1) ?? []
  const mainRun = { ...runOf(main), combos: combosOfTurns(turns) }
  // Since the last compaction, as main's other figures: the runs of each effort after it, a turn it fell inside too.
  // A turn the compaction fell inside counts from it on.
  const nowRun = { ...runOf(now), combos: combosOfTurns(turns, mainRows.filter(r => r.t === 'compact').length) }
  return {
    shells,
    tools, mcp, skills, chat: now.chat, main: mainRun, mainNow: nowRun, agents, info, failed,
    turns, events, commands: main.commands, compactions, lines: mainRows.length, sessionCombos,
    readings,
    priced: [...main.priced, ...Object.values(calls).flatMap(c => c.priced)],
  }
}
