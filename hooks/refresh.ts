import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Snapshot } from '../types'
import { effortKey, effortSamplesOf } from './digest/effort'
import { emptyRun, noChat, same } from './digest/record'
import { linkSession, readHistory } from './record/transcript'
import { ledgerKey, measuredOf, type Turn } from './state'

// The atoms this module reads or writes. The scan of the hooks module lists them only from a const of the file that uses
// them, so each module declares its own; their types are one, in `PluginState`, and their defaults are the same in each.
const snapshot = atom({ plugin: 'session-lens', key: 'snapshot' } as const, null)
const skills = atom({ plugin: 'session-lens', key: 'skills' } as const, {})
const mainRun = atom({ plugin: 'session-lens', key: 'mainRun' } as const, null)
const mainNow = atom({ plugin: 'session-lens', key: 'mainNow' } as const, null)
const sessionCombos = atom({ plugin: 'session-lens', key: 'sessionCombos' } as const, [])
const agentRuns = atom({ plugin: 'session-lens', key: 'agentRuns' } as const, {})
const agentInfo = atom({ plugin: 'session-lens', key: 'agentInfo' } as const, {})
const failedCalls = atom({ plugin: 'session-lens', key: 'failedCalls' } as const, [])
const shellList = atom({ plugin: 'session-lens', key: 'shells' } as const, [])
const commands = atom({ plugin: 'session-lens', key: 'commands' } as const, {})
const chat = atom({ plugin: 'session-lens', key: 'chat' } as const, noChat())
const turns = atom({ plugin: 'session-lens', key: 'turns' } as const, [])
const events = atom({ plugin: 'session-lens', key: 'events' } as const, [])
const slashCounts = atom({ plugin: 'session-lens', key: 'slashCounts' } as const, {})
const compactions = atom({ plugin: 'session-lens', key: 'compactions' } as const, [])
const history = atom({ plugin: 'session-lens', key: 'history' } as const, { status: 'pending', detail: '' })
const readings = atom({ plugin: 'session-lens', key: 'readings' } as const, [])
const priced = atom({ plugin: 'session-lens', key: 'priced' } as const, [])
const turnState = atom({ plugin: 'session-lens', key: 'turnState' } as const, { isBusy: false, hasHeardTurn: false, busySince: 0, busyText: '' } as Turn)

// The read cycle: when the record is read again, what the reading stores, and the tickers that redraw the pane while
// something moves. The tickers' frame and glide live here, not in an atom: a reload costs them one frame.


// jq reads the session's record; there is no second source, so without it the pane says so instead of showing a partial count.
async function hasJq($: EngineInterface) {
  try {
    return (await $.process.run(['jq', '--version'])).exitCode === 0
  } catch {
    return false
  }
}

// The picture moves while something runs (the main agent in a turn, a subagent not yet finished), and for a moment after
// any figure changes, so that it glides to its new value instead of jumping.
const FRAME_MS = 120
const GLIDE = 10
// A re-reading quicker than this many frames is not worth a word.
export const REREAD_AFTER = 3
// What this process last wrote to the store: the session and its effort samples, so unchanged ones are not written again.
const kept: { effort?: string } = {}
// The cycle's own state, in one place: only this module changes it, and the page reads it once per drawing through
// `cycleState`.
const cycle = {
  frame: 0,
  glideUntil: 0,
  turnLive: { isBusy: false, hasHeardTurn: false, busySince: 0, busyText: '' } as Turn,
  isOpenInRecord: false,
  hasRunning: false,
  isRefreshing: false,
  // The first reading of the record: the pane shows a skeleton until it lands, and its spinner turns.
  isLoading: false,
  // The version's tabs are open: their specimens play, though nothing of the session moves.
  isShowcase: false,
  ticker: undefined as { cancel: () => void } | undefined,
  idleTicker: undefined as { cancel: () => void } | undefined,
  // A reload keeps the pane and what the last code read, not what this code reads: its first drawing reads the record again.
  hasReadSinceLoad: false,
  // The first reading by this code, or one /session-lens asked for: what the pane holds until it lands is from before, and
  // for a large session it takes a while. Past a few frames the pane says so.
  isRereading: false,
  rereadSince: 0,
  hasReadOnce: false,
  // Redraws asked for that never came: a pane that is not there draws nothing, so past a few both tickers stop, until
  // the pane draws again.
  unseen: 0,
  hasReport: false,
  // The conversation's length when last looked at while idle: a change is a compaction, or a turn that was heard anyway.
  messageCount: undefined as number | undefined,
  // The name the marketplace that ships session-report was added under, found by its repository; none when not added.
  reportMarket: undefined as string | undefined,
  // The version its own plugin.json states, read at each start: a reload of a newer copy shows its own.
  version: undefined as string | undefined,
}

// What the page draws from the cycle, read once per drawing.
export const cycleState = () => {
  const { frame, turnLive, isRereading, rereadSince, hasReport, reportMarket, version } = cycle
  return { frame, turnLive, isRereading, rereadSince, hasReport, reportMarket, version }
}

export function setTurn($: EngineInterface, f: (t: Turn) => Turn) {
  return update($, turnState, t => (cycle.turnLive = f(t)))
}

const isLive = () => cycle.turnLive.isBusy || (!cycle.turnLive.hasHeardTurn && cycle.isOpenInRecord) || cycle.hasRunning || cycle.isLoading || cycle.isRereading || cycle.frame < cycle.glideUntil

const isMoving = () => isLive() || cycle.isShowcase

const UNSEEN_MAX = 10

function stop() {
  cycle.ticker?.cancel()
  cycle.ticker = undefined
  cycle.idleTicker?.cancel()
  cycle.idleTicker = undefined
}

function redraw($: EngineInterface): boolean {
  cycle.unseen += 1
  if (cycle.unseen > UNSEEN_MAX) {
    stop()
    return false
  }
  $.ui.invalidate('ui.render')
  return true
}

// While nothing moves, the idle since the last turn still counts up: redraw once a second. A compaction moves nothing the
// page hears (no turn, no request, and an org's hook above `session.compact` may keep a plugin's from running), so every
// few seconds the length of the conversation is looked at: a change reads the record, and once more a moment after, as
// its boundary is written a little later.
const WATCH_EVERY = 3
function idle($: EngineInterface) {
  if (cycle.idleTicker || cycle.unseen > UNSEEN_MAX) return
  let beats = 0
  cycle.idleTicker = $.clock.every(1000, () => {
    void redraw($)
    if (++beats % WATCH_EVERY === 0) void watch($)
  })
}

async function watch($: EngineInterface) {
  const length = (await $.session.messages().catch(() => undefined))?.length
  if (length === undefined) return
  const before = cycle.messageCount
  cycle.messageCount = length
  if (before !== undefined && before !== length) {
    void refresh($)
    $.clock.after(1500, () => void refresh($))
  }
}

// The version's tabs opened or left: the clock runs for their specimens, or stops if nothing else moves.
export function showcase($: EngineInterface, isOn: boolean) {
  if (cycle.isShowcase === isOn) return
  cycle.isShowcase = isOn
  tick($)
}

export function tick($: EngineInterface) {
  if (!isMoving()) {
    cycle.ticker?.cancel()
    cycle.ticker = undefined
    idle($)
    return
  }
  cycle.idleTicker?.cancel()
  cycle.idleTicker = undefined
  if (cycle.ticker || cycle.unseen > UNSEEN_MAX) return
  cycle.ticker = $.clock.every(FRAME_MS, () => {
    cycle.frame += 1
    if (!redraw($)) return
    // While a turn runs the record grows: read it again every few seconds.
    if (cycle.frame % 25 === 0 && isLive()) void refresh($)
    if (!isMoving()) {
      cycle.ticker?.cancel()
      cycle.ticker = undefined
      idle($)
    }
  })
}

// A figure shown mid-glide: where it was on screen when it last changed, on its way to where it is now.
const glide: Record<string, { to: number; from: number; at: number }> = {}
export const eased = (key: string, target: number): number => {
  const g = glide[key]
  if (g === undefined) {
    glide[key] = { to: target, from: target, at: cycle.frame }
    return target
  }
  const at = (t: number) => g.from + (g.to - g.from) * (1 - (1 - t) ** 3)
  if (g.to !== target) {
    g.from = at(Math.min(1, (cycle.frame - g.at) / GLIDE))
    g.to = target
    g.at = cycle.frame
  }
  return Math.round(at(Math.min(1, (cycle.frame - g.at) / GLIDE)))
}

// The session report is session-report's own skill, run on this session alone; without the plugin the button says how to
// install it.
const REPORT = 'session-report:session-report'
export const REPORT_REPO = 'anthropics/claude-plugins-official'
function findReport($: EngineInterface) {
  return $.command.list().then(
    list => list.some(c => c.name === REPORT),
    () => false,
  )
}
// Read as the fold opens on a missing plugin, so the lines say whether the marketplace must be added first.
async function findMarket($: EngineInterface) {
  try {
    const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
    const known = JSON.parse(await $.fs.read(`${config}/plugins/known_marketplaces.json`)) as Record<string, { source?: { repo?: string } }>
    cycle.reportMarket = Object.entries(known).find(([, m]) => m.source?.repo === REPORT_REPO)?.[0]
  } catch {
    cycle.reportMarket = undefined
  }
}

export async function report($: EngineInterface) {
  try {
    const { root, out } = await linkSession($)
    $.ui.toast('Session report: asked for, it runs once the session is idle')
    await $.command.run({ command: REPORT, args: `all (no --since), with --dir ${root} so it covers only this session; write the report into ${out}, not the current directory` })
  } catch (err) {
    $.ui.toast(`Session report: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export async function refresh($: EngineInterface, isAsked = false) {
  if (cycle.isRefreshing) return
  cycle.isRefreshing = true
  cycle.isLoading = (await read($, history)).status === 'pending'
  cycle.isRereading = !cycle.isLoading && (isAsked || !cycle.hasReadOnce)
  cycle.rereadSince = cycle.frame
  if (cycle.isLoading || cycle.isRereading) tick($)
  cycle.hasReport = await findReport($)
  try {
    await readAll($)
  } finally {
    cycle.isRefreshing = false
    cycle.isLoading = false
    cycle.isRereading = false
    cycle.hasReadOnce = true
  }
}

async function readAll($: EngineInterface) {
  try {
    const { context, cost, startedAt } = await $.session.usage({ breakdown: 'summary' })
    const b = context.breakdown
    if (!b) return
    const snap: Snapshot = {
      model: b.model,
      percent: b.percentage,
      total: b.totalTokens,
      max: b.rawMaxTokens,
      window: context.window,
      threshold: b.autoCompactThreshold,
      cost: cost?.usd,
      startedAt,
      rows: b.categories.map((c: any) => ({ name: c.name, tokens: c.tokens, kind: c.kind, color: c.color })),
      grid: b.gridRows.map((row: any[]) =>
        row.map((s: any) => {
          const category = b.categories.find((c: any) => c.name === s.categoryName)
          const ch =
            category?.kind === 'buffer' ? '⛝' : category?.kind === 'free' || !s.isFilled ? '⛶' : s.squareFullness >= 0.7 ? '⛁' : '⛀'
          return { color: s.color, ch }
        }),
      ),
      skills: (b.skills?.skillFrontmatter ?? []).map((s: any) => ({
        name: s.name,
        source: s.pluginName ? `${s.source}:${s.pluginName}` : s.source,
        tokens: s.tokens,
      })),
      mcpTools: b.mcpTools.map((t: any) => ({
        name: t.name,
        server: t.serverName,
        tokens: t.tokens,
        isLoaded: t.isLoaded,
      })),
      memory: b.memoryFiles.map((f: any) => ({ path: f.path, type: f.type ?? '', tokens: f.tokens })),
      agents: b.agents.map((a: any) => ({ name: a.agentType ?? a.name ?? '?', source: a.source ?? '', tokens: a.tokens })),
    }
    await update($, snapshot, () => snap)
  } catch {
    // The pane keeps its last snapshot.
  }

  if (!(await hasJq($))) {
    await update($, history, () => ({ status: 'no-jq', detail: '' }))
    return
  }
  try {
    const d = await readHistory($)
    await update($, chat, () => d.chat)
    await update($, mainRun, () => d.main)
    await update($, mainNow, () => d.mainNow)
    await update($, turns, () => d.turns)
    await update($, agentInfo, () => d.info)
    await update($, failedCalls, () => d.failed)
    await update($, shellList, () => d.shells)
    await update($, events, () => d.events)
    await update($, slashCounts, () => d.commands)
    await update($, compactions, () => d.compactions)
    await update($, sessionCombos, () => d.sessionCombos)
    // The main agent's turns, by effort, kept beside every other session's: written again whenever they change, as the
    // turn running now gains calls.
    const samples = effortSamplesOf(d.turns)
    const sid = await $.session.id()
    const mark = `${sid}:${JSON.stringify(samples)}`
    if (kept.effort !== mark) {
      await $.store.set(effortKey(sid), samples).catch(() => undefined)
      kept.effort = mark
    }
    // What the harness wrote as each process exited, and what the lens took in every process; this one's is read live as
    // the pane draws.
    const taken = measuredOf(await $.store.get(ledgerKey(await $.session.id())).catch(() => undefined))
    await update($, readings, () => [...d.readings, ...taken])
    await update($, priced, () => d.priced)
    cycle.hasRunning = Object.values(d.info).some(a => a.status === 'running')
    cycle.glideUntil = cycle.frame + GLIDE + 2
    tick($)
    // A skill's size is only known from the live expansion: keep what an earlier reading saw.
    await update($, agentRuns, old =>
      Object.fromEntries(
        Object.entries(d.agents).map(([id, run]) => [
          id,
          {
            ...run,
            skills: Object.fromEntries(
              Object.entries(run.skills).map(([name, x]) => {
                const had = Object.entries(old[id]?.skills ?? {}).filter(([o]) => same(o, name)).map(([, y]) => y.tokens)
                return [name, { count: x.count, tokens: Math.max(x.tokens, ...had, 0) }]
              }),
            ),
          },
        ]),
      ),
    )
    await update($, skills, cur => {
      const next = { ...cur }
      for (const [name, count] of Object.entries(d.skills)) {
        const key = Object.keys(next).find(n => same(n, name))
        const held = key === undefined ? undefined : next[key]
        if (key !== undefined && held) next[key] = { ...held, count: Math.max(held.count, count) }
        else next[name] = { count, tokens: 0, source: '?', isEarlier: true }
      }
      return next
    })

    // `skill.prompt` names no loop. A skill it saw that the main loop did not load through the Skill tool, and the person
    // did not type as a command, was loaded in a subagent: its size goes to the subagent whose record names it.
    const typed = Object.keys(await read($, commands))
    const leftovers = Object.entries(await read($, skills)).filter(
      ([n]) => !Object.keys(d.skills).some(m => same(m, n)) && !typed.some(c => same(c, n)),
    )
    for (const [name, x] of leftovers) {
      await update($, skills, cur => Object.fromEntries(Object.entries(cur).filter(([n]) => n !== name)))
      const owner = Object.entries(d.agents).find(([, r]) => Object.keys(r.skills).some(n => same(n, name)))?.[0]
      if (owner === undefined) continue
      await update($, agentRuns, m => {
        const run = { ...emptyRun(), ...m[owner] }
        const key = Object.keys(run.skills).find(n => same(n, name)) ?? name
        return { ...m, [owner]: { ...run, skills: { ...run.skills, [key]: { count: run.skills[key]?.count ?? 1, tokens: Math.max(x.tokens, run.skills[key]?.tokens ?? 0) } } } }
      })
    }
    await update($, history, () => ({ status: 'ok', detail: `${d.lines} lines, ${Object.keys(d.agents).length} subagents` }))
  } catch (error) {
    await update($, history, () => ({ status: 'error', detail: String(error).slice(0, 200) }))
  }
}

// /session-lens opened the pane: the reading it asks for is taken as one again.
export async function opened($: EngineInterface) {
  cycle.hasReadSinceLoad = true
  await refresh($, true)
}

// Drawn: the pane is there, so its tickers run again. A reload's first drawing reads the record again.
export async function drawn($: EngineInterface) {
  cycle.unseen = 0
  cycle.turnLive = await read($, turnState)
  tick($)
  if (!cycle.hasReadSinceLoad) {
    cycle.hasReadSinceLoad = true
    $.clock.after(0, () => refresh($))
  }
}

// Whether the record's newest turn is still open, as the drawing found it: until a turn event comes, it says whether main is busy.
export const openInRecord = (isOpen: boolean) => {
  cycle.isOpenInRecord = isOpen
}

// The version this copy of the lens is, so the pane says which one runs.
export async function readVersion($: EngineInterface) {
  try {
    cycle.version = (JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)) as { version?: string }).version
  } catch {
    cycle.version = undefined
  }
}

// Whether session-report is installed, asked as its fold opens; without it, where its marketplace is.
export async function checkReport($: EngineInterface) {
  cycle.hasReport = await findReport($)
  if (!cycle.hasReport) await findMarket($)
}
