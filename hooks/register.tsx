import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRun, Chat, ChatKind, Compaction, FailedCall, Opening, Reading, Req, Shape, TokenKinds, TurnRow, UseRow } from '../types'
import { agentTreeOf, fed } from './digest/agents'
import { chatPartsOf, subPartsOf } from './digest/context'
import { byCost, costModelOf, ledgerOf, spendsOf, sumKinds } from './digest/cost'
import { eventGroupsOf, type EventGroup, KIND_FILTERS, type KindFilter, pickEvents, type WhoFilter } from './digest/events'
import { forecast, forecastInputs } from './digest/forecast'
import { estimateTokens, noChat, same } from './digest/record'
import { liveReqsOf } from './digest/turns'
import { usesOf } from './digest/uses'
import { bashEnded, bashStarted } from './record/children'
import { readMainShape, readMcpInstructions, readPrompt, readRestart } from './record/transcript'
import { checkReport, cycleState, drawn, eased, opened, openInRecord, refresh, readVersion, report, REPORT_REPO, REREAD_AFTER, setTurn, showcase, tick } from './refresh'
import { ledgerKey, measuredOf } from './state'
import { Fold } from './views/atoms/Fold'
import { cut, fit, fmtTime, io, IO_W, k, K_W, left, money, prompt, shortModel, span, tinyModel, toolLabel, typeOf, waffle, width } from './views/layout'
import { ContextBar, ContextLine } from './views/molecules/ContextBar'
import { COST_COLS } from './views/molecules/CostRow'
import { KindBar, KindKey } from './views/molecules/KindBar'
import { MoreRow } from './views/molecules/MoreRow'
import { Tabs } from './views/molecules/Tabs'
import { fitTiles, TileRow } from './views/molecules/TileRow'
import { AgentNode } from './views/organisms/AgentNode'
import { ComboTable } from './views/organisms/ComboTable'
import { Compactions } from './views/organisms/Compactions'
import { ContextGrid, type Square, WAFFLE_W, type WindowPart } from './views/organisms/ContextGrid'
import { agentCostItems, CostTable } from './views/organisms/CostTable'
import { EventLogBox } from './views/organisms/EventLog'
import { EventLogScreen } from './views/templates/EventLogScreen'
import { TurnBox } from './views/organisms/TurnBox'
import type { TurnItem } from './views/organisms/TurnEntry'
import { callsOf, UseTable } from './views/organisms/UseTable'
import { Lane, Waterfall } from './views/organisms/Waterfall'
import { agentColor, G, MODEL_SERIES, S, SERIES, SPACE, T, theme } from './views/palette'
import { followTheme, switchTheme, themeChanged } from './theme'
import { runsOf, SPIN, sweepOf } from './views/sweep'
import { Spacer } from './views/atoms/Spacer'
import { HistoryScreen } from './views/templates/HistoryScreen'
import { RestartScreen } from './views/templates/RestartScreen'
import { InitScreen, type InitKind } from './views/templates/InitScreen'
import { EffortScreen } from './views/templates/EffortScreen'
import { MarkLane, SettingLine, StackChart } from './views/molecules/Timeline'
import { sessionFiguresOf, spansOf } from './digest/figures'
import { timelineOf, type TimelineStart } from './digest/timeline'
import { EFFORT_PREFIX, effortSamplesOf, effortStudyOf, samplesIn, type EffortSample } from './digest/effort'
import { ComponentScreen } from './views/templates/ComponentScreen'
import { TokenScreen } from './views/templates/TokenScreen'
import type { UI } from './views/ui'

// The atoms this module reads or writes. The scan of the hooks module lists them only from a const of the file that uses
// them, so each module declares its own; their types are one, in `PluginState`, and their defaults are the same in each.
const themeDrawn = atom({ plugin: 'session-lens', key: 'themeDrawn' } as const, null)
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
const compactions = atom({ plugin: 'session-lens', key: 'compactions' } as const, [])
const openNodes = atom({ plugin: 'session-lens', key: 'openNodes' } as const, {})
const shownRows = atom({ plugin: 'session-lens', key: 'shownRows' } as const, {})
const history = atom({ plugin: 'session-lens', key: 'history' } as const, { status: 'pending', detail: '' })
const logFilter = atom({ plugin: 'session-lens', key: 'logFilter' } as const, { who: 'all', kind: 'all' })
const page = atom({ plugin: 'session-lens', key: 'page' } as const, null)
const restart = atom({ plugin: 'session-lens', key: 'restart' } as const, null)
const prompts = atom({ plugin: 'session-lens', key: 'prompts' } as const, {})
const readings = atom({ plugin: 'session-lens', key: 'readings' } as const, [])
const priced = atom({ plugin: 'session-lens', key: 'priced' } as const, [])
const started = atom({ plugin: 'session-lens', key: 'started' } as const, null)
const mainShape = atom({ plugin: 'session-lens', key: 'mainShape' } as const, null)
const memoryText = atom({ plugin: 'session-lens', key: 'memoryText' } as const, {})
const mcpInstructions = atom({ plugin: 'session-lens', key: 'mcpInstructions' } as const, null)
const effortAll = atom({ plugin: 'session-lens', key: 'effortAll' } as const, null)
const effortScope = atom({ plugin: 'session-lens', key: 'effortScope' } as const, 'all')

const PANE = 'session-lens'

// The parts of main's Init that open a page of their own, by the name /context gives each; a part it names otherwise
// stays a row. A shaped page is drawn from the system prompt and tools main's request was sent with, which /context does not list.
const INIT_PAGES = new Map<string, { page: InitKind; isShaped: boolean }>([
  ['Skills', { page: 'skills', isShaped: false }],
  ['MCP tools', { page: 'mcp', isShaped: false }],
  ['Custom agents', { page: 'agents', isShaped: false }],
  ['Memory files', { page: 'memory', isShaped: false }],
  ['System prompt', { page: 'system', isShaped: true }],
  ['System tools', { page: 'tools', isShaped: true }],
  ['MCP server instructions', { page: 'instructions', isShaped: true }],
])

// Each effort in two letters, for a tile too narrow to spell it.
const EFFORT_SHORT: Record<string, string> = { low: 'lo', medium: 'md', high: 'hi', xhigh: 'xh', max: 'mx' }




// An agent's name in the tree: a `claude -p` child guessed from when it started, not seen starting, says so.


// What the page draws from: every atom it reads, each by its name, read at once.
async function pageState($: EngineInterface) {
  const reads = {
    snap: read($, snapshot),
    sk: read($, skills),
    runs: read($, agentRuns),
    who: read($, agentInfo),
    failed: read($, failedCalls),
    shellsAll: read($, shellList),
    stored: read($, chat),
    open: read($, openNodes),
    hist: read($, history),
    mine: read($, mainRun),
    turnList: read($, turns),
    log: read($, events),
    filter: read($, logFilter),
    pageOf: read($, page),
    compacted: read($, compactions),
    restartOf: read($, restart),
    fresh: read($, mainNow),
    promptOf: read($, prompts),
    counted: read($, readings),
    pricedAt: read($, priced),
    proc: read($, started),
    settingsAll: read($, sessionCombos),
    shownOf: read($, shownRows),
    shapeOf: read($, mainShape),
    memOf: read($, memoryText),
    instructionsOf: read($, mcpInstructions),
    effortOf: read($, effortAll),
    scopeOf: read($, effortScope),
  }
  const values = await Promise.all(Object.values(reads))
  return Object.fromEntries(Object.keys(reads).map((k, n) => [k, values[n]])) as { [K in keyof typeof reads]: Awaited<(typeof reads)[K]> }
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await followTheme($)
    // When this process started: what names the readings of /cost it takes. A hot reload starts no process.
    const now = await $.clock.now()
    await update($, started, v => v ?? now)
    await readVersion($)
    await $.command.register({
      name: 'session-lens',
      description: 'Open the session-lens pane (what fills the context, what got used)',
    })
    return next(e)
  })

  on('command.run', { command: 'session-lens' }, async $ => {
    await followTheme($)
    await $.ui.open({ id: PANE, title: 'Session lens' })
    await opened($)
    return { text: 'Session lens opened.' }
  })

  // The person changed Claude Code's theme: the pane changes with it, at once.
  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    await themeChanged($)
    return result
  })

  // Every slash command that runs, whoever provides it: the record has the names, this keeps who provided them.
  on('command.run', async ($, e, next) => {
    if (e.command !== 'session-lens') {
      let source = 'unknown'
      let plugin: string | undefined
      try {
        const info = (await $.command.list()).find(c => c.name === e.command)
        if (info) {
          source = String(info.source)
          plugin = info.plugin
        }
      } catch {
        // Source stays unknown.
      }
      const origin = e.origin.kind
      await update($, commands, m => {
        const c = m[e.command]
        return {
          ...m,
          [e.command]: { count: (c?.count ?? 0) + 1, source, plugin, origins: { ...c?.origins, [origin]: (c?.origins[origin] ?? 0) + 1 } },
        }
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('cost') && e.cost) {
      const proc = await read($, started)
      // The count /cost runs: from the session's launch, kept by a resume, or from the last /login.
      const start = (await $.session.usage().catch(() => undefined))?.startedAt
      if (proc !== null && start !== undefined) {
        const key = ledgerKey(await $.session.id())
        const rest = measuredOf(await $.store.get(key).catch(() => undefined)).filter(m => m.start !== start || m.proc !== proc)
        // Without a store the total falls back on the record and the live figure.
        await $.store.set(key, [...rest, { start, proc, at: await $.clock.now(), usd: e.cost.usd }]).catch(() => undefined)
      }
    }
    await refresh($)
    return next(e)
  })

  // A Bash call may start a `claude -p` session, a child of this one: while the call runs, a child found is linked to it.
  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash' || !e.tool_use_id) return next(e)
    const id = e.tool_use_id
    bashStarted($, id, e.command, () => void refresh($))
    try {
      return await next(e)
    } finally {
      await bashEnded($, id).catch(() => undefined)
    }
  })

  // A turn of the main agent is what makes the picture move.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      // The same turn started again (a setting switched mid-turn) keeps its start.
      await setTurn($, t => ({
        ...(!t.isBusy || e.turnId !== t.busyTurn ? { busySince: now, busyText: e.text.replace(/\s+/g, ' ').trim() } : { busySince: t.busySince, busyText: t.busyText }),
        busyTurn: e.turnId,
        hasHeardTurn: true,
        isBusy: true,
      }))
      tick($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await setTurn($, t => ({ ...t, hasHeardTurn: true, isBusy: false }))
      tick($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A skill's prompt as the model reads it: this is what a skill really costs once invoked.
  on('skill.prompt', async ($, e, next) => {
    const tokens = estimateTokens(e.text)
    const source = e.pluginName ? `${e.source}:${e.pluginName}` : e.source
    await update($, skills, m => ({
      ...m,
      [e.skill]: { count: (m[e.skill]?.count ?? 0) + 1, tokens: (m[e.skill]?.tokens ?? 0) + tokens, source },
    }))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui: UI = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    // What is being read, over the light that sweeps the pane: the first reading and a slow one again draw the same.
    const reading = (text: string, w: number, f: number) => (
      <Box flexDirection="column" width={w}>
        <Text {...S.live}>{cut(text, w)}</Text>
        <Text>{runsOf(sweepOf(w, f)).map(x => <Text color={x.color}>{'━'.repeat(x.n)}</Text>)}</Text>
      </Box>
    )
    // Drawn: the pane is there, so its tickers run again (see `drawn`).
    await drawn($)
    const { frame, turnLive, isRereading, rereadSince, hasReport, reportMarket, version } = cycleState()
    const drawnTheme = (await read($, themeDrawn)) ?? theme
    // One time for the whole drawing: what is live counts to it.
    const now = await $.clock.now()
    try {
      const { snap, sk, runs, who, failed, shellsAll, stored, open, hist, mine, turnList, log, filter, pageOf, compacted, restartOf, fresh, promptOf, counted, pricedAt, proc, settingsAll, shownOf, shapeOf, memOf, instructionsOf, effortOf, scopeOf } = await pageState($)
      // Older saved shapes lack the newer fields.
      const talk: Chat = { ...noChat(), ...(stored as Partial<Chat>) }

      // Until /context and the record are read there is nothing true to draw: a skeleton of the three blocks, and what is
      // being read, say the pane is loading.
      if (hist.status === 'pending') {
        const SW = (e.props.bodyColumns ?? 80) - 2
        const bar = (share: number) => '░'.repeat(Math.max(1, Math.floor((SW - 4) * share)))
        const block = (title: string, shares: number[]) => (
          <Box key={`skel-${title}`} flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={SW}>
            <Text bold color={T.text.muted}>{title}</Text>
            {shares.map((share, n) => (
              <Text key={`skel-${title}-${n}`} color={T.text.muted}>{bar(share)}</Text>
            ))}
          </Box>
        )
        return (
          <Box flexDirection="column" width={SW}>
            {reading(snap ? 'Reading the session transcript…' : 'Reading /context…', SW, frame - rereadSince)}
            {block('Session', [0.9, 0.6, 0.75])}
            {block('Agents', [0.5, 0.7])}
            {block('Event log', [0.8, 0.65, 0.7, 0.55])}
          </Box>
        )
      }

      if (!snap) {
        return (
          <Box flexDirection="column">
            <Text bold>Session lens</Text>
            <Text color={T.text.muted}>No reading yet; it arrives after the first turn.</Text>
          </Box>
        )
      }

      // ── geometry, colours, folding ──
      const cols = e.props.bodyColumns ?? 80
      const W = cols - 2 // a top block's outer width
      const IW = W - 4 // inside its border and padding
      // Grey and black are what /context draws the unused room in; anything that takes room is drawn in a colour.
      const GREYS = new Set(['inactive', 'subtle', 'promptBorder', 'secondaryText', 'gray', 'grey', 'black', 'blackBright', 'whiteBright'])
      const SPARE = SERIES.slice(2)
      // The colours /context names from the theme, each given its place in the palette; one it does not name is still drawn from it.
      const THEME: Record<string, string> = { permission: T.actor.main, claude: T.cost.spend, warning: T.source.mcp, success: T.state.done, error: T.state.danger, suggestion: T.actor.sub, autoAccept: T.actor.main, planMode: T.actor.sub, cyan_FOR_SUBAGENTS_ONLY: T.actor.sub, purple_FOR_SUBAGENTS_ONLY: T.actor.main }
      const HUES = SERIES
      const PALETTE = new Set<string>([...Object.values(T).flatMap(g => Object.values(g)), ...SERIES])
      const hash = (color: string) => [...color].reduce((n, ch) => n + ch.charCodeAt(0), 0)
      const vivid = (color: string) =>
        PALETTE.has(color) ? color : GREYS.has(color) ? (SPARE[hash(color) % SPARE.length] ?? T.state.live) : (THEME[color] ?? HUES[hash(color) % HUES.length] ?? T.state.live)
      const spin = SPIN[frame % SPIN.length] ?? ''
      // The window every figure is a share of: the one auto-compact measures against, which `autoCompactWindow` may set below the model's.
      const max = snap.max || 1
      // The Breakdown's squares span the model's whole window; Free space and the buffer are shares of that, the rest of the auto-compact window.
      const gridOf = () => Math.max(snap.window || 0, max)
      const pctOf = (n: number, of = max) => `${((n / Math.max(1, of)) * 100).toFixed(1)}%`
      // Past turns and the whole event log each fill the pane as a page of their own.
      const go = (to: 'turns' | 'log' | 'tokens' | 'components' | 'effort' | `cmp:${'log' | 'main'}:${string}` | `init:${string}` | `chat:${ChatKind}` | null) => () => update($, page, () => to)
      // A shaped Init page reads main's system prompt and tools as it opens, from its request since the last compaction;
      // one read or done is kept until another compaction moves the boundary, a failed one read again.
      const openInit = (name: string) => async () => {
        await go(`init:${name}`)()
        // The servers' instructions come and go with the servers: read again at every opening.
        if (INIT_PAGES.get(name)?.page === 'instructions') {
          await update($, mcpInstructions, () => ({ status: 'pending' as const, detail: '' }))
          await readMcpInstructions($).then(
            data => update($, mcpInstructions, () => ({ status: 'ok' as const, detail: '', data })),
            err => update($, mcpInstructions, () => ({ status: 'error' as const, detail: err instanceof Error ? err.message : String(err) })),
          )
        }
        if (!INIT_PAGES.get(name)?.isShaped) return
        const boundary = compacted[compacted.length - 1]?.uuid ?? ''
        const was = await read($, mainShape)
        if (was?.boundary === boundary && was.status !== 'error') return
        await update($, mainShape, () => ({ boundary, status: 'pending' as const, detail: '' }))
        const settle = (got: NonNullable<typeof was>) => update($, mainShape, r => (r?.boundary === boundary ? got : r))
        try {
          await settle({ boundary, status: 'ok', detail: '', data: await readMainShape($, boundary) })
        } catch (err) {
          await settle({ boundary, status: 'error', detail: err instanceof Error ? err.message : String(err) })
        }
      }
      // A memory file is read the first time its fold opens, as a subagent's initial prompt is.
      const openMemory = (path: string, key = `init-mem-${path}`) => async () => {
        const opening = !(open[key] ?? false)
        await update($, openNodes, m => ({ ...m, [key]: opening }))
        if (!opening) return
        const was = (await read($, memoryText))[path]
        if (was && was.status !== 'error') return
        const settle = (got: { status: 'pending' | 'ok' | 'error'; detail: string; data?: string }) => update($, memoryText, m => ({ ...m, [path]: got }))
        await settle({ status: 'pending', detail: '' })
        try {
          await settle({ status: 'ok', detail: '', data: await $.fs.read(path) })
        } catch (err) {
          await settle({ status: 'error', detail: err instanceof Error ? err.message : String(err) })
        }
      }
      // A compaction's page reads what the window restarted from as it opens; the last one read is kept.
      const openCompact = (c: Compaction, to: `cmp:${'log' | 'main'}:${string}`) => async () => {
        await update($, page, () => to)
        const uuid = c.uuid
        if (!uuid) return update($, restart, () => ({ uuid: '', status: 'error' as const, detail: 'This compaction recorded no boundary' }))
        // One read or done is kept; a failed one is read again.
        const was = await read($, restart)
        if (was?.uuid === uuid && was.status !== 'error') return
        await update($, restart, () => ({ uuid, status: 'pending' as const, detail: '' }))
        // A read that ends after another compaction was opened leaves that one's alone.
        const settle = (got: NonNullable<typeof was>) => update($, restart, r => (r?.uuid === uuid ? got : r))
        try {
          await settle({ uuid, status: 'ok', detail: '', data: await readRestart($, uuid, c.keep ?? []) })
        } catch (err) {
          await settle({ uuid, status: 'error', detail: err instanceof Error ? err.message : String(err) })
        }
      }
      // A subagent's initial prompt is read the first time its fold opens; one read or done is kept, a failed one read again.
      const openPrompt = (id: string) => async () => {
        const key = `prompt-${id}`
        const opening = !(open[key] ?? false)
        await update($, openNodes, m => ({ ...m, [key]: opening }))
        if (!opening) return
        const was = (await read($, prompts))[id]
        if (was && was.status !== 'error') return
        const settle = (got: { status: 'pending' | 'ok' | 'error'; detail: string; data?: Opening }) => update($, prompts, m => ({ ...m, [id]: got }))
        await settle({ status: 'pending', detail: '' })
        try {
          await settle({ status: 'ok', detail: '', data: await readPrompt($, id) })
        } catch (err) {
          await settle({ status: 'error', detail: err instanceof Error ? err.message : String(err) })
        }
      }
      // The effort page reads every session's kept turns as it opens.
      const openEffort = async () => {
        await go('effort')()
        await update($, effortAll, () => ({ status: 'pending' as const, bySession: {} }))
        try {
          const keys = (await $.store.keys()).filter(x => x.startsWith(EFFORT_PREFIX))
          const values = await Promise.all(keys.map(x => $.store.get(x)))
          await update($, effortAll, () => ({ status: 'ok' as const, bySession: Object.fromEntries(keys.map((x, n) => [x.slice(EFFORT_PREFIX.length), samplesIn(values[n])])) }))
        } catch {
          await update($, effortAll, () => ({ status: 'error' as const, bySession: {} }))
        }
      }
      // What opens by itself, as on the web page; a press overrides it.
      const OPEN_AT_FIRST = ['session', 'ctx', 'turns', 'agents', 'log']
      // A context window's grid starts open, wherever it is; so do an agent's running shells.
      const opensAtFirst = (key: string) => OPEN_AT_FIRST.includes(key) || key.startsWith('shells-')
      const isOpen = (key: string) => open[key] ?? opensAtFirst(key)
      const toggle = (key: string) => () => update($, openNodes, m => ({ ...m, [key]: !(m[key] ?? opensAtFirst(key)) }))
      const fold = (key: string, indent: number, title: string, summary: string, room: number, color?: string) => (
        <Fold ui={ui} key={`node-${key}`} indent={indent} isOpen={isOpen(key)} title={title} summary={summary} room={room} color={color} onToggle={toggle(key)} />
      )
      // Every list that unfolds draws its first 10 rows, as `tail` does, and 30 more at each press below it, as `gh` and
      // `glab` list a page: drawn whole, one that runs to hundreds would hold the pane up on every frame.
      const FIRST = 10
      const PAGE = 30
      const shownCount = (key: string) => Math.max(FIRST, shownOf[key] ?? FIRST)
      const paged = <T,>(key: string, list: T[]) => list.slice(0, shownCount(key))
      // Past the first ten, however many pages are open, one press folds the list back to its first ten.
      const fewerStep = (key: string, total: number) => (total > FIRST && shownCount(key) > FIRST ? { label: `${G.fewer} Show first ${FIRST} only`, onPress: () => update($, shownRows, m => ({ ...m, [key]: FIRST })) } : undefined)
      // The presses below a list: + while some are hidden, − once more than the first are shown.
      const stepsOf = (key: string, total: number) => ({ more: total > shownCount(key) ? { label: moreLabel(key, total), onPress: showMore(key) } : undefined, fewer: fewerStep(key, total) })
      const more = (key: string, total: number, indent: number) => <MoreRow ui={ui} listKey={key} indent={indent} {...stepsOf(key, total)} />
      const moreLabel = (key: string, total: number) => `${G.more} Show ${Math.min(PAGE, total - shownCount(key))} more · ${total - shownCount(key)} not shown`
      const showMore = (key: string) => () => update($, shownRows, m => ({ ...m, [key]: shownCount(key) + PAGE }))
      const bar = (frac: number, w: number) => {
        const n = Math.max(frac > 0 ? 1 : 0, Math.min(w, Math.round(frac * w)))
        return { on: '█'.repeat(n), off: '░'.repeat(w - n) }
      }
      const FORM_COLOR: Record<string, string> = { main: T.actor.main, subagent: T.actor.sub, advisor: T.actor.mainEcho }

      // ── the agents ──
      const isOk = hist.status === 'ok' && mine !== null
      const { ids, parentOf, kidsOf, runOf, modelOf, running, whole, usd, unpriced, unpricedModels } = agentTreeOf(who, runs, mine)
      const unpricedNames = [...new Set(unpricedModels.map(shortModel))]
      const gWhole = { i: eased('wholeI', whole.i), o: eased('wholeO', whole.o) }

      // ── the window ──
      const rows = snap.rows
      const used = rows.filter(r => r.kind === 'used')
      const messagesRow = used.find(r => /message/i.test(r.name))
      const categories = used.filter(r => r !== messagesRow)
      const categorised = categories.reduce((n, r) => n + r.tokens, 0)
      const ctxNow = mine ? mine.last : snap.total
      // The first request's own messages leave the window at a compaction: from then on it opens with what /context names.
      const opened = mine ? (compacted?.length ? categorised : (mine.init ?? 0)) : 0
      const messagesNow = mine ? Math.max(0, mine.last - opened) : (messagesRow?.tokens ?? 0)
      const initOther = Math.max(0, opened - categorised)
      const parts = [
        ...categories.map(r => ({ key: r.name, name: r.name, v: r.tokens, color: r.color })),
        ...(initOther > 0 ? [{ key: 'init-other', name: 'Other init (prompt · agents · MCP · memory)', v: initOther, color: 'inactive' }] : []),
        { key: 'chat', name: 'Messages', v: messagesNow, color: T.actor.main },
      ].sort((a, b) => b.v - a.v)

      // ── turns ──
      const newest = turnList[turnList.length - 1]
      // Loaded again mid-turn (the mod reloaded), no turn event has come yet: a turn the record shows still going is live.
      const isOpenNow = newest?.open === true
      openInRecord(isOpenNow)
      const isBusyNow = turnLive.isBusy || (!turnLive.hasHeardTurn && isOpenNow)
      // Until the record holds the new prompt, the newest turn in it is the finished one: it leaves the live box at once.
      const isRecorded = isBusyNow && newest?.startedAt !== undefined && (!turnLive.isBusy || Date.parse(newest.startedAt) >= turnLive.busySince - 5000 || (turnLive.busyText !== '' && newest.preview === turnLive.busyText))
      // A typed prompt is a turn from the moment it is sent: it counts, and heads the live box, before the record has it.
      const isUnrecorded = turnLive.isBusy && !isRecorded && turnLive.busyText !== ''
      const isLive = isRecorded || isUnrecorded
      // A compaction that came after the newest turn ended starts afresh: that turn leaves the live box, as it does for a new one.
      const compactedAt = Date.parse(compacted.at(-1)?.ts ?? '')
      const isCleared = !isLive && newest?.startedAt !== undefined && compactedAt > Date.parse(newest.startedAt) + newest.ms
      const current: TurnRow | undefined = isUnrecorded
        ? { n: turnList.length + 1, preview: turnLive.busyText, steps: 0, wrote: 0, read: 0, cacheRead: 0, subCount: 0, subSteps: 0, subRead: 0, subWrote: 0, ms: 0, startedAt: new Date(turnLive.busySince).toISOString() }
        : isCleared
          ? undefined
          : newest
      const past = isRecorded ? turnList.slice(0, -1) : turnList
      const turnCount = turnList.length + (isUnrecorded ? 1 : 0)
      // Idle is the gap between turns: from one turn's last reply to the next prompt; after the newest finished turn, to now.
      const idleOf = (x: TurnRow) => x.idleMs ?? (!isLive && x === current && x.startedAt ? Math.max(0, now - Date.parse(x.startedAt) - x.ms) : undefined)

      // ════════════ SESSION ════════════
      // Each tile as wide as its longest line, the room left shared out; when the row cannot hold them, the padding goes
      // first, then every tile narrows by the same share and a line still too long is cut.
      // The tiles sit under the block's title, as its boxes do: the room is what the indent leaves.
      const KW = IW - SPACE.indent

      // Detail: what the session's list price went on, by model, then by agent with the nested ones beneath their caller;
      // then each compaction, the context before and after.
      const ZERO: TokenKinds = { i: 0, cr: 0, w5: 0, w1: 0, o: 0 }
      // A turn that runs at another setting than the one before says so after its prompt; a new model starts a turn of its own.
      const tagOf = (t: TurnRow) => (t.switched && t.model ? `  ${G.switch} ${shortModel(t.model)}/${t.effort ?? '—'}` : '')
      // Each part of the session under the tiles is a box as wide as they are; BR is the room inside one.
      const BW = KW
      const BR = BW - 4
      const costRoom = BR - SPACE.indent
      const runsById: [string, AgentRun][] = [...(mine ? [['main', mine] as [string, AgentRun]] : []), ...ids.flatMap(id => (runOf(id) ? [[id, runOf(id) as AgentRun] as [string, AgentRun]] : []))]
      const { byModel, kindUsd, searchUsd } = costModelOf(runsById)
      // By kind, under the session's tiles: one bar of colour, each kind of token a block as wide as its share of the cost.
      // In the order the model meets them: the cached prefix it reads, the parts it caches (an hour's before five minutes'),
      // the input past the last breakpoint, then what it writes.
      const KINDS: [keyof TokenKinds, string, string][] = [['cr', T.cost.reused, 'cache/r'], ['w1', T.cost.cachedLong, 'cache/w 1h'], ['w5', T.cost.cachedShort, 'cache/w 5m'], ['i', T.cost.fresh, 'input'], ['o', T.cost.spend, 'output']]
      // Web searches are billed by the search, not by the token: a block of their own, after the tokens.
      const kindsShown: [string, string, string, number][] = [
        ...KINDS.filter(([key]) => kindUsd[key] > 0).map(([key, color, name]) => [key, color, name, kindUsd[key]] as [string, string, string, number]),
        ...(searchUsd > 0 ? [['search', T.source.mcp, 'web search', searchUsd] as [string, string, string, number]] : []),
      ]
      // The session's total: what the harness counted, from every reading of each count, this process's read live; the
      // rest from the record, scaled by how far the record fell short where both are known.
      const live: Reading[] = proc !== null && snap.startedAt !== undefined && snap.cost !== undefined ? [{ start: snap.startedAt, proc, at: now, usd: snap.cost }] : []
      const spent = spendsOf([...counted.filter(r => !live.some(l => l.start === r.start && l.proc === r.proc)), ...live])
      const ledger = ledgerOf(spent, pricedAt)
      const pm = (n: number) => (n >= 0.005 ? ` ± ${money(n)}` : '')
      // The session's total heads the cost box, ± what the estimate may be off by.
      const totalText = `${money(ledger.total)}${pm(ledger.pm)}`
      const unpricedText = unpriced > 0 ? ` +${unpriced} unpriced${unpricedNames.length > 0 ? ` (${unpricedNames.slice(0, 2).join(', ')}${unpricedNames.length > 2 ? ', …' : ''})` : ''}` : ''
      const barW = Math.max(4, BR)
      const kindCells = kindsShown.map(([, , , v]) => Math.round((v / Math.max(usd, 1e-9)) * barW))
      // Rounding can leave the bar a cell short or long: the largest part takes up the difference.
      const largest = kindCells.indexOf(Math.max(...kindCells))
      if (largest >= 0) kindCells[largest] = Math.max(0, (kindCells[largest] ?? 0) + barW - kindCells.reduce((n, w) => n + w, 0))
      // Beneath the bar, which colour is which kind, in the bar's order.
      const kindKey = <KindKey ui={ui} kinds={kindsShown} usd={usd} rowWidth={BR} />
      const kindBar = <KindBar ui={ui} kinds={kindsShown} cells={kindCells} barWidth={barW} rowWidth={BR} total="" />
      // By model and by agent: requests, tokens in and out, and what they cost.
      const NW = Math.max(14, costRoom - COST_COLS)
      const costRoots = isOpen('cost') ? byCost(kidsOf(undefined), runOf) : []
      const compactsBody = <Compactions ui={ui} indent={0} shown={paged('compacts', compacted)} onOpen={x => openCompact(x, `cmp:main:${x.ts}|${x.pre}`)} {...stepsOf('compacts', compacted.length)} />
      const costBody = mine ? (
        <CostTable
          ui={ui}
          nameWidth={NW}
          sessionUsd={usd}
          byModel={[...byModel]
            .sort((x, y) => sumKinds(y[1].usd ?? ZERO) - sumKinds(x[1].usd ?? ZERO))
            .map(([key, g]) => {
              const model = g.model === '?' ? 'unknown' : shortModel(g.model)
              const note = `· ${g.where}${g.where === 'subagent' && g.agents.size > 1 ? ` ×${g.agents.size}` : ''}`
              return { key: `m-${key}`, indent: 0, name: model, note, reqs: g.steps, i: g.tokens.i + g.tokens.cr + g.tokens.w5 + g.tokens.w1, o: g.tokens.o, cost: g.usd ? sumKinds(g.usd) : undefined, color: T.text.soft, noteColor: FORM_COLOR[g.where] }
            })}
          byAgent={agentCostItems({ run: mine, model: snap.model }, who, runOf, kidsOf, costRoots, { shown: paged, steps: stepsOf })}
          {...stepsOf('cost', costRoots.length)}
        />
      ) : null

      // Context, for every agent: its window drawn to scale, where it compacts, and who takes the most of it.
      // A kind read from the transcript opens a page of what it holds; thinking and what is left are only figures.
      // Each kind keeps its colour however the sizes reorder them; its name ends in its count.
      const CHAT_COLOR: [string, string][] = [['Assistant messages', T.actor.main], ['thinking', T.actor.mainEcho], ['User messages', SERIES[5] ?? T.text.soft], ['Tool calls & results', SERIES[2] ?? T.text.soft], ['Notifications (subagents)', T.actor.sub], ['Injected (skills · reminders)', T.source.skill], ['Attachments (reminders · lists · hooks)', T.source.hook], ['Deferred tool definitions', T.source.mcp]]
      const chatColor = (name: string) => CHAT_COLOR.find(([kind]) => name.startsWith(kind))?.[1] ?? 'inactive'
      const chatParts: WindowPart[] = chatPartsOf(talk, messagesNow).map(x => ({ key: x.key, name: x.name, v: x.v, color: chatColor(x.name), approx: x.approx, page: x.kind ? `chat:${x.kind}` : undefined }))
      const SUB_COLOR: Record<string, string> = { init: 'inactive', tools: SERIES[2] ?? T.text.soft, skills: T.source.skill, rest: T.actor.sub }
      const subParts = (run: AgentRun, id: string): WindowPart[] => subPartsOf(run, who[id]?.prompt ?? 0, promptOf[id]?.data?.shape).map(x => ({ key: x.key, name: x.name, v: x.v, color: SUB_COLOR[x.key] ?? 'inactive', approx: x.approx }))
      const windowSummary = (now: number, list: WindowPart[]) => {
        const gap = snap.threshold !== undefined ? snap.threshold - now : undefined
        return `${pctOf(now)} · ${gap === undefined ? 'auto-compact off' : `${k(Math.max(0, gap))} to auto-compact`}${list[0] ? ` · largest ${list[0].name} ${k(list[0].v)}` : ''}`
      }
      const isNearCompact = (now: number) => snap.threshold !== undefined && snap.threshold - now < max * 0.1
      // One grid of the whole window, a square to each hundredth, laid out as /context lays its own: what it opened with,
      // what came in since, the room left before auto-compact (⛶), and the buffer auto-compact keeps (⛝). The key sits to
      // its right, a group for each part, each titled with the part's share of the whole window.
      // What the window opened with, and what has come in since: a subagent's opening is one figure from the API.
      const sidesOf = (list: WindowPart[], chat?: boolean) => {
        const isSub = list.some(p => p.key === 'init')
        const opening = isSub ? list.filter(p => p.key === 'init') : list.filter(p => p.key !== 'chat')
        const since = isSub ? list.filter(p => p.key !== 'init') : chat ? chatParts : list.filter(p => p.key === 'chat')
        return { isSub, opening, since }
      }
      // How wide an agent's tree is drawn: the block's inside, or a box's when the finished ones open in the Timeline box.
      let TW = IW
      const ctxView = (o: { key: string; now: number; list: WindowPart[]; peak?: number; indent: number; chat?: boolean; ends?: number[]; steps?: number[]; details?: (room: number) => JSX.Element[] }) => {
        // A box under the agent's tiles, its edges on theirs; room is what its border and padding leave inside.
        const boxW = TW - o.indent - 2
        const room = boxW - 4
        const barW = Math.max(20, room)
        // The bar draws the Breakdown's own parts, in its order and colours: the opening, then what came in since.
        const { isSub, opening, since } = sidesOf(o.list, o.chat)
        const segs = [...opening, ...since].filter(p => p.v > 0).map(p => ({ v: p.v, color: vivid(p.color) }))
        const gap = snap.threshold !== undefined ? snap.threshold - o.now : undefined
        // Turns until it compacts: a line fitted through the window at the end of every turn since the last compaction.
        const fc = o.ends && gap !== undefined ? forecast(o.ends, gap, o.steps) : undefined
        const keyW = Math.max(30, room - WAFFLE_W - 2)
        // The room left and the buffer, in /context's own squares and colours.
        const used = o.list.reduce((n, p) => n + p.v, 0)
        // The squares span the model's whole window (1M), as /context's do; the bar above spans the window auto-compact measures against.
        const grid = gridOf()
        const edge = snap.threshold ?? max
        const rest: WindowPart[] = [
          { key: 'free', name: 'Free space', v: Math.max(0, edge - used), color: T.window.free, free: true, ch: '⛶' },
          { key: 'buffer', name: 'Autocompact buffer', v: snap.threshold !== undefined ? Math.max(0, max - Math.max(snap.threshold, used)) : 0, color: T.window.buffer, free: true, ch: '⛝' },
          // Past the window auto-compact measures against: the model has it, the session never reaches it.
          { key: 'beyond', name: 'Beyond auto-compact window', v: Math.max(0, grid - Math.max(max, used)), color: T.window.beyond, free: true, ch: '·' },
        ]
        const squares = waffle<Square>([
          // What it opened with in full squares, what came in since in half ones.
          ...opening.map(p => ({ ...p, color: vivid(p.color), ch: '⛁' })),
          ...since.map(p => ({ ...p, color: vivid(p.color), ch: '⛀' })),
          ...rest.map(p => ({ ...p, ch: p.ch ?? '⛶' })),
        ])
        const tint = (ps: WindowPart[], ch: string) => ps.map(p => ({ ...p, color: vivid(p.color), ch }))
        // The line and the bar are pressed to open the box: the Breakdown grid, then what the agent used.
        const openKey = `${o.key}-grid`
        const isWide = isOpen(openKey)
        return (
          <Box paddingLeft={o.indent + SPACE.indent}>
            <Box flexDirection="column" borderStyle="round" borderColor={isNearCompact(o.now) ? T.state.danger : T.text.muted} paddingX={SPACE.inset} width={boxW}>
              {/* The window in use and how far auto-compact is, then the window drawn to scale. */}
              <Button plain key={`node-${o.key}-line`} onPress={toggle(openKey)}>
                <Text color={T.text.muted}>{isWide ? `${G.open} ` : `${G.shut} `}</Text>
                <ContextLine ui={ui} figure={eased(o.key, o.now)} now={o.now} max={max} peak={o.peak} threshold={snap.threshold} isNear={isNearCompact(o.now)} turnsLeft={o.ends && gap !== undefined && gap > 0 ? (fc ? fc.turns : null) : undefined} />
              </Button>
              <Button plain key={`node-${openKey}`} onPress={toggle(openKey)}>
                <ContextBar ui={ui} max={max} threshold={snap.threshold} parts={segs} initParts={opening.filter(p => p.v > 0).length} barWidth={barW} />
              </Button>
              {!isWide ? null : (
                <Box flexDirection="column" marginTop={SPACE.section}>
                  <ContextGrid
                    ui={ui}
                    gridKey={`waffle-${o.key}`}
                    squares={squares}
                    groups={[
                      { key: 'init', title: 'Init', parts: tint(opening, '⛁') },
                      { key: 'since', title: isSub ? 'Context' : 'Conversation', parts: tint(since, '⛀') },
                      { key: 'rest', parts: rest },
                    ]}
                    keyWidth={keyW}
                    windowMax={max}
                    grid={grid}
                    onOpen={page => (page.startsWith('chat:') ? go(page as `chat:${ChatKind}`) : openInit(page))}
                  />
                  {o.details ? o.details(room) : null}
                </Box>
              )}
            </Box>
          </Box>
        )
      }
      // A part of main's Init that has a page of its own opens it.
      const mainList: WindowPart[] = parts.map(p => ({ ...p, approx: p.key === 'chat' && mine !== null, page: INIT_PAGES.has(p.key) ? p.key : undefined }))
      // The ground for how many turns are left before auto-compact.
      const { ends, steps } = forecastInputs(past, compacted)
      const mainCtx = (indent: number, details?: (room: number) => JSX.Element[]) => ctxView({ key: 'ctx', now: ctxNow, list: mainList, peak: (fresh ?? mine)?.peak, indent, chat: isOk, ends: mine ? ends : undefined, steps, details })

      // Turns: the one running now, live; then each earlier one, newest first, opening into what it did.
      const liveIds = new Set(running)
      // The background shells, drawn under the agent that started them.
      const shells = shellsAll ?? []
      const clockNow = now
      // A timeline draws the agent's own requests alone: a subagent it started, or a shell, does not hold its turn up, as
      // the person can go on prompting; each is drawn under its agent in the Agents block.
      const own = (x: TurnRow): Req[] => (x.reqs ?? []).filter(r => r.id === undefined)
      // A timeline folded: its requests on one lane, its head how it stands. A box folded to one lane has no rows to line up
      // with: its lane starts where its head ends. The turns listed one under another keep one column.
      const laneOf = (x: TurnRow, room: number, isRunning: boolean, isAlone = true) => {
        const reqs = own(x)
        const label = `${isRunning ? `${spin} ` : ''}${reqs.length} requests · ${span(x.ms)}`
        return <Lane ui={ui} reqs={reqs} turnMs={x.ms} room={room} label={label} labelW={isAlone ? width(label) : undefined} />
      }
      // A turn's requests on one lane each, paged under the key the turn gives.
      const waterfall = (x: TurnRow, pageKey: string, room = IW - 4, isNewestFirst = false, head?: string) => {
        const reqs = own(x)
        const total = reqs.length
        return <Waterfall ui={ui} reqs={reqs} turnMs={x.ms} room={room} isNewestFirst={isNewestFirst} pageKey={pageKey} shown={shownCount(pageKey)} more={{ label: moreLabel(pageKey, total), onPress: showMore(pageKey) }} fewer={fewerStep(pageKey, total)} spin={spin} head={head} />
      }
      // A subagent's own requests on its own clock, from the turn that launched it; a running one's last runs to now.
      const subTimeline = (id: string): TurnRow | undefined => {
        for (const t of [...turnList].reverse()) {
          const row = t.reqs?.find(r => r.id === id)
          if (!row?.kids || !t.startedAt) continue
          const elapsed = row.running ? Math.max(row.ms, now - Date.parse(t.startedAt) - row.startMs) : row.ms
          const kids = row.kids.map(r => ({ ...r, startMs: Math.max(0, r.startMs - row.startMs) }))
          // Titled by what its parent handed it, and open while it runs, as main's live turn.
          return { ...t, preview: row.prompt ?? row.label, open: row.running ? true : undefined, startedAt: new Date(Date.parse(t.startedAt) + row.startMs).toISOString(), ms: elapsed, reqs: row.running ? liveReqsOf(kids, elapsed, row.who, { of: id }) : kids }
        }
        return undefined
      }
      let liveBox: JSX.Element | null = null
      if (isOk) {
        const shown = current && (isLive || !isBusyNow) ? current : undefined
        const startedAt = shown?.startedAt
        const elapsed = shown ? (isLive && startedAt ? Math.max(0, now - Date.parse(startedAt)) : shown.ms) : 0
        // A live turn has its `working` row from the moment it starts, before its first request too.
        const reqs = shown ? (isLive ? liveReqsOf(shown.reqs ?? [], elapsed) : (shown.reqs ?? [])) : []
        // A turn's requests page under one key in the live box and in History: a new turn starts at its first 10 again.
        const reqsKey = `reqs-${shown?.n}`
        const rowCount = shown ? own({ ...shown, reqs }).length : 0
        const wfRows = rowCount === 0 ? 1 : 1 + Math.min(shownCount(reqsKey), rowCount) + (rowCount > shownCount(reqsKey) ? 1 : 0)
        // Under main's tiles, its edges on theirs: indented as they are, as wide.
        const liveW = IW - 2
        liveBox = (
          <Box paddingLeft={SPACE.indent}>
            <TurnBox
              ui={ui}
              width={liveW}
              title={shown ? prompt(shown.preview) : isBusyNow ? 'Starting the turn…' : 'No turn yet'}
              isRunning={isLive || (!shown && isBusyNow)}
              hasTurn={shown !== undefined}
              isComplete={shown !== undefined && !isLive}
              waterfall={shown && reqs.length > 0 ? waterfall({ ...shown, ms: elapsed, reqs }, reqsKey, liveW - 4, true) : null}
              waterfallRows={wfRows}
              isOpen={isOpen('live')}
              onToggle={toggle('live')}
              lane={shown && reqs.length > 0 ? laneOf({ ...shown, ms: elapsed, reqs }, liveW - 4, isLive) : null}
            />
          </Box>
        )
      }
      const shown = [...past].reverse()
      const turnItems: TurnItem[] = paged('turns', shown).map(x => ({ turn: x, tag: tagOf(x), idle: idleOf(x), isOpen: isOpen(`turn:${x.n}`), onToggle: toggle(`turn:${x.n}`), waterfall: (x.reqs ?? []).length > 0 ? waterfall(x, `reqs-${x.n}`, IW - 2) : null, lane: own(x).length > 0 ? laneOf(x, IW - 2, false, false) : null }))
      // A subagent stays in the tree while it, or one it started, still runs; once all are done it moves to the session's fold.
      const isAlive = (id: string): boolean => liveIds.has(id) || kidsOf(id).some(isAlive)
      const done = ids.filter(id => !isAlive(id))
      const doneRuns = done.map(runOf).filter((r): r is AgentRun => r !== undefined)
      const doneNodes: JSX.Element[] = []
      // A dispatch that started no subagent leaves the tree at once: the finished ones keep a line for each reason, its count and tokens.
      const failedLines = Object.entries(failed.reduce<Record<string, FailedCall[]>>((by, f) => ({ ...by, [f.why ?? 'no reason given']: [...(by[f.why ?? 'no reason given'] ?? []), f] }), {})).map(
        ([why, fs]) => `(failed) ${why} · ${fs.length} dispatches · ${io(`≈${k(fs.reduce((n, f) => n + f.i, 0))}`, `≈${k(fs.reduce((n, f) => n + f.o, 0))}`)}`,
      )
      // Their requests are the Work row's: what they read and wrote is the lane's own.
      const doneSummary = `${io(k(doneRuns.reduce((n, r) => n + fed(r), 0)), k(doneRuns.reduce((n, r) => n + r.output, 0)))}`
      // The way to the earlier turns, from the turns' box.
      const turnsBody = past.length > 0 ? <Button plain key="node-turn-history" label={`${G.page} History · ${past.length} turns`} onPress={go('turns')} /> : null
      // The past turns' page: newest first, a page at a time, each unfolding in place.
      const historyView = <HistoryScreen ui={ui} width={W} rowWidth={IW} turnCount={past.length} turns={turnItems} {...stepsOf('turns', shown.length)} onBack={go(null)} />

      // ════════════ AGENTS ════════════
      const UW = () => Math.max(16, TW - 6 - 5 - 9 - 9 - 11)
      const listPage = (key: string, total: number) => ({ shown: shownCount(key), ...stepsOf(key, total) })
      const useTable = (owner: string, title: string, color: string | undefined, list: UseRow[], indent: number) => <UseTable ui={ui} listKey={`use-${owner}-${title}`} title={title} color={color} rows={list} indent={indent} nameWidth={UW()} pageOf={listPage} />
      // Main's own figures start at its last compaction: its hooks do too.
      const sinceCompact = compacted.at(-1)?.ts ?? ''
      const usesOfNode = (id: string, run: AgentRun, isMain: boolean) => {
        const u = usesOf(id, run, isMain, { known: sk, listed: snap.skills, who, kids: kidsOf(undefined), log, since: sinceCompact })
        return { ...u, mcpRows: u.mcpRows.map(r => ({ ...r, name: toolLabel(r.name) })) }
      }
      // A subagent's initial prompt, folded: the system prompt and tools its first request was sent with, then each message
      // under what it is. Each part pages its lines like every list.
      type Line = { head?: boolean; text: string; note?: string }
      const bounded = (key: string, pad: string, lines: Line[]) => {
        return [
          ...paged(key, lines).map((x, n) =>
            x.head ? (
              <Text key={`${key}-${n}`}>
                <Text bold color={T.source.skill}>{`${pad}${x.text}`}</Text>
                <Text color={T.text.muted}>{x.note ?? ''}</Text>
              </Text>
            ) : (
              <Text key={`${key}-${n}`}>{`${pad}${x.text}`}</Text>
            ),
          ),
          more(key, lines.length, pad.length),
        ]
      }
      const toolsTokens = (shape: Shape) => shape.tools.reduce((n, t) => n + t.tokens, 0)
      const promptView = (id: string, indent: number) => {
        const key = `prompt-${id}`
        const pad = ' '.repeat(indent + SPACE.indent * 2)
        const size = who[id]?.prompt
        const got = promptOf[id]
        const shape = got?.data?.shape
        const messages = (got?.data?.messages ?? []).filter(m => m.text.trim() !== '')
        // A forked skill's first message is the skill's prompt: its task, though the harness marks it injected.
        const skill = who[id]?.skill
        const systemTokens = shape ? estimateTokens(shape.system) : 0
        const messageTokens = messages.reduce((n, m) => n + estimateTokens(m.text), 0)
        const total = systemTokens + (shape ? toolsTokens(shape) : 0) + messageTokens
        // Each part folds on its own, as a compaction's: named by what it is, with its size and how it starts.
        const part = (partKey: string, title: string, summary: string, lines: Line[], color?: string) => (
          <Box key={partKey} flexDirection="column">
            {fold(partKey, indent + SPACE.indent, title, summary, TW, color)}
            {isOpen(partKey) ? bounded(partKey, pad, lines) : null}
          </Box>
        )
        const firstLine = (text: string) => text.replace(/^\n+/, '').split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? ''
        return (
          <Box flexDirection="column">
            <Button plain key={`node-${key}`} onPress={openPrompt(id)}>
              {`${' '.repeat(indent)}${isOpen(key) ? G.open : G.shut} `}
              <Text bold>Init Context</Text>
              <Text color={T.text.muted}>{got?.data ? `  ≈${k(total)} · ${shape ? 'system prompt · tools · ' : ''}messages ${messages.length}` : `  ${size ? `messages ≈${k(size)} · ` : ''}plus system prompt and tools`}</Text>
            </Button>
            {!isOpen(key) ? null : !got || got.status === 'pending' ? (
              <Text {...S.live}>{`${pad}Loading…`}</Text>
            ) : got.status === 'error' ? (
              <Text color={T.state.danger}>{`${pad}${got.detail}`}</Text>
            ) : (
              <Box flexDirection="column">
                {shape ? null : <Text color={T.text.muted}>{`${' '.repeat(indent + SPACE.indent)}No system prompt or tools for this agent in the transcript`}</Text>}
                {shape ? part(`prompt-sys-${id}`, 'System prompt', `≈${k(systemTokens)} · ${shape.system.split('\n').length} lines`, shape.system.split('\n').map(text => ({ text })), T.actor.main) : null}
                {shape
                  ? part(`prompt-tools-${id}`, `Tools ${shape.tools.length}`, `≈${k(toolsTokens(shape))}`, [...shape.tools].sort((a, b) => b.tokens - a.tokens).map(t => ({ text: `${fit(toolLabel(t.name), 36)}${left(`≈${k(t.tokens)}`, 8)}` })), T.actor.main)
                  : null}
                {messages.map((m, n) =>
                  part(`prompt-m${n}-${id}`, n === 0 && skill ? `/${skill} prompt` : m.meta ? 'Injected' : 'Task', `≈${k(estimateTokens(m.text))} · ${m.text.split('\n').length} lines · ${firstLine(m.text)}`, m.text.replace(/^\n+|\n+$/g, '').split('\n').map(text => ({ text })), T.actor.sub),
                )}
              </Box>
            )}
          </Box>
        )
      }
      // A kind of main's conversation on a page of its own: what it holds since the last compaction, by what it is,
      // largest first. The sizes are the transcript's estimates, before the kinds are scaled to what the window holds.
      const chatView = (kind: ChatKind) => {
        const part = chatParts.find(p => p.page === `chat:${kind}`)
        const list = talk.groups?.[kind] ?? []
        const RW = IW - 2 - 18
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={W}>
            <Button plain key="node-chat-back" label={`${G.back} Back`} onPress={go(null)} />
            <Text>
              <Text bold>{part?.name ?? kind}</Text>
              <Text color={T.text.muted}>{part ? `  ≈${k(part.v)} · ${pctOf(part.v)} of context` : ''}</Text>
            </Text>
            {list.length === 0 ? <Text color={T.text.muted}>Nothing of this kind since the last compaction</Text> : null}
            {paged(`chat-${kind}`, list).map((g, n) => (
              <Text key={`chat-${kind}-${n}`}>
                {`  ${fit(cut(g.label || '(empty)', RW), RW)}`}
                <Text color={T.text.muted}>{`${left(g.count > 1 ? `×${g.count}` : '', 8)}${left(`≈${k(g.tokens)}`, 10)}`}</Text>
              </Text>
            ))}
            {more(`chat-${kind}`, list.length, 2)}
          </Box>
        )
      }
      // A part of main's Init on a page of its own: what /context counts in it, largest first, every list paged.
      const initHost = { paged, more, bounded, fold, isOpen, openMemory }
      const initView = (name: string, kind: InitKind) => {
        const part = mainList.find(p => p.key === name)
        const got = shapeOf?.boundary === (compacted[compacted.length - 1]?.uuid ?? '') ? shapeOf : null
        return <InitScreen ui={ui} host={initHost} name={name} kind={kind} width={W} rowWidth={IW} contextNote={part ? `${k(part.v)} · ${pctOf(part.v)} of context` : undefined} snap={snap} shape={got} memOf={memOf} instructionsOf={instructionsOf} onBack={go(null)} />
      }
      const agentNodes: JSX.Element[] = []
      // `rails` says, for each level above the node's own connector, whether the line of an ancestor's children runs on
      // past it; `keep` which of its children the tree shows, `out` where the nodes go.
      const agentNode = (id: string, depth: number, isLast: boolean, rails: boolean[], keep: (id: string) => boolean, out: JSX.Element[]) => {
        const isMain = id === 'main'
        const run = isMain ? (fresh ?? mine) : runOf(id)
        const info = isMain ? undefined : who[id]
        if (!run || (!isMain && !info)) return
        const key = `ag-${id}`
        // main is always there: no head of its own, its body always open and one step left of a subagent's.
        const isShown = isMain || isOpen(key)
        const at = isMain ? 0 : (depth + 1) * SPACE.indent
        const color = agentColor(depth)
        const isRunning = isMain ? isBusyNow : liveIds.has(id)
        const started = kidsOf(isMain ? undefined : id)
        const children = started.filter(keep)
        // The tree's lines: each level's connector sits under its parent's ▸, and the line runs from the parent down to the
        // connector of its last child, past everything the nodes between show.
        const lead = `${rails.map(b => (b ? '│ ' : '  ')).join('')}${depth > 0 ? (isLast ? '└ ' : '├ ') : ''}`
        const below = [...rails, ...(depth > 0 ? [!isLast] : []), children.length > 0]
        const railText = below.map(b => (b ? '│' : ' ')).join(' ')
        const name = isMain ? 'main agent' : info ? typeOf(info) : id
        const desc = isMain ? '' : (info?.description ?? '')
        const model = isMain ? shortModel(snap.model) : shortModel(run.model ?? modelOf(id))
        // main's window is the one /context draws; a subagent's is pieced together from its record.
        const ctxKey = isMain ? 'ctx' : `ctx-${id}`
        const ctxList = isMain ? mainList : subParts(run, id)
        const runIo = `${run.steps} requests · ${io(k(fed(run)), k(run.output))}`
        // A child that ended without a reply was cut off: what it spent before, if anything, its record does not say.
        const status = isRunning ? `${spin} ${isMain ? 'working' : 'running'}` : isMain ? 'idle' : info?.status === 'interrupted' ? `${G.failed} interrupted${run.steps === 0 || run.unanswered ? ' · usage unknown' : ''}` : `${G.done} done`
        // The counts keep room for their widest: the description is cut the same as they grow, and the line does not wrap.
        const runIoW = Math.max(width(runIo), width(`${run.steps} requests · `) + IO_W)
        // Open, the tiles under it say the model, the requests and the counts: the head keeps the name and the state.
        const headRoom = Math.max(8, TW - width(lead) - 2 - width(name) - width(status) - (isOpen(key) ? 2 : width(model) + runIoW + 6))
        const meta = [
          info && (info.call !== undefined || info.ack !== undefined) ? `Dispatch ${io(k(info.ack ?? 0), k(info.call ?? 0))}` : null,
          info?.report !== undefined ? `Result ↓≈${info.report} to parent` : null,
        ].filter(Boolean).join(' · ')
        // The agent's own tiles, as the session's: what runs it and what its requests carried.
        const tileRoom = TW - at - 2
        // Each tile is a title and one value. `reserve` is the
        // room a figure of counts keeps for its widest, as on the session's tiles.
        // main's figures start again at a compaction; until its next request, it still runs at the setting it had.
        const now = run.settings?.at(-1) ?? { model: run.model ?? (isMain ? (mine?.model ?? snap.model) : modelOf(id)) ?? '?', effort: run.effort ?? (isMain ? mine?.effort : undefined) ?? '—' }
        // Every setting it ran at, in order: the model only where it changed.
        const sequence = run.settings?.map((x, n, all) => (n > 0 && all[n - 1]?.model === x.model ? x.effort : `${shortModel(x.model)}/${x.effort}`)).join(' → ')
        // Its own tool, skill, MCP and Agent calls; what it started counts its own.
        const ownCalls = (log ?? []).filter(e => e.agent === id && (!isMain || e.ts >= sinceCompact) && (e.kind === 'tool' || e.kind === 'mcp' || e.kind === 'skill' || e.kind === 'agent')).length
        // Right after a compaction nothing has gone up yet, and what main's window restarted from is what the model wrote.
        const isRestarted = isMain && run.steps === 0 && compacted.length > 0
        const up = isRestarted ? 0 : fed(run)
        const down = isRestarted ? (compacted.at(-1)?.post ?? 0) : run.output
        const liveKids = started.filter(c => liveIds.has(c)).length
        const liveShells = shells.filter(x => x.owner === (isMain ? 'main' : id) && !x.endedAt).length
        const tiles: { label: string; value: string; shorter?: string[]; reserve?: number; labels?: string[]; isLabelLive?: boolean }[] = [
          {
            label: run.settings ? `Model / Effort · ${run.settings.length - 1} switches` : 'Model / Effort',
            labels: [...(run.settings ? [`${G.switch}${run.settings.length - 1} Model / Effort`] : []), 'Model'],
            // Every setting it ran at; too narrow for that, the one now; narrower still, the model without its dashes, the effort in two letters.
            value: sequence ?? `${shortModel(now.model)} / ${now.effort}`,
            shorter: [
              ...(sequence ? [`${shortModel(now.model)} / ${now.effort}`] : []),
              `${shortModel(now.model).replace(/-/g, '')} / ${EFFORT_SHORT[now.effort] ?? now.effort}`,
            ],
          },
          { label: '↑ ↓', value: `↑${k(up)} ↓${k(down)}`, reserve: IO_W },
          { label: 'Requests', labels: ['Reqs'], value: String(run.steps) },
          { label: 'Tool Calls', labels: ['Calls'], value: String(ownCalls) },
          // What it has running now: the subagents and the shells its node opens to.
          { label: 'Subagents', labels: ['Subs'], value: String(liveKids) },
          { label: 'Shells', value: String(liveShells) },
        ]
        const fitted = fitTiles(tiles, tileRoom, run.settings ? run.settings.length - 1 : undefined, sequence !== undefined)
        const tileStrip = <TileRow ui={ui} tiles={fitted.tiles.map(x => ({ ...x, color }))} widths={fitted.widths} pad={fitted.pad} paddingLeft={at + SPACE.indent} rowWidth={TW} borderColor={color} spin={spin} spinColor={T.state.live} />
        const head = isMain ? undefined : { lead, name, desc, descRoom: headRoom, model, status, runIo, onToggle: toggle(key) }
        // The background shells it left running and may be waiting on, under one fold, open at first, paged as every list:
        // each on one line, what it is, the command it runs, and for how long. They sit in the node, so the tree's lines run past them.
        // A finished subagent keeps every shell it started, ended too: the timeline's row opens it, and its shells are its own.
        const isOver = !isMain && !isRunning
        const ownShells = shells.filter(x => x.owner === (isMain ? 'main' : id) && (isOver || !x.endedAt))
        const tail: JSX.Element[] = []
        if (ownShells.length > 0) {
          const shKey = `shells-${id}`
          const runningCount = ownShells.filter(x => !x.endedAt).length
          tail.push(fold(shKey, at + SPACE.indent, 'Shells', isOver ? `${ownShells.length}${runningCount > 0 ? ` · ${runningCount} running` : ''}` : `${ownShells.length} running`, TW))
          if (isOpen(shKey)) {
            for (const sh of paged(shKey, ownShells)) {
              const isLive = !sh.endedAt
              const took = span(Math.max(0, (isLive ? clockNow : Date.parse(sh.endedAt ?? sh.startedAt)) - Date.parse(sh.startedAt)))
              const room = Math.max(8, TW - at - 8 - took.length)
              const desc = cut(sh.desc ?? sh.command, room)
              const rest = sh.desc ? cut(sh.command, room - width(desc) - 2) : ''
              tail.push(
                <Text wrap="truncate">
                  {isLive ? <Text {...S.live}>{`${' '.repeat(at + SPACE.indent * 2)}${G.shell} ${spin} `}</Text> : <Text color={color}>{`${' '.repeat(at + SPACE.indent * 2)}${G.shell} `}</Text>}
                  <Text>{desc}</Text>
                  {rest && room - width(desc) - 2 > 1 ? <Text color={T.text.muted}>{`  ${rest}`}</Text> : null}
                  <Text color={T.text.muted}>{`  ${took}`}</Text>
                </Text>,
              )
            }
            const moreShells = more(shKey, ownShells.length, at + SPACE.indent * 2)
            if (moreShells) tail.push(moreShells)
          }
        }
        out.push(
          <AgentNode
            ui={ui}
            nodeKey={key}
            head={head}
            isOpen={isOpen(key)}
            isRunning={isRunning}
            color={color}
            meta={meta}
            pad={at + SPACE.indent}
            rowWidth={TW}
            rails={railText}
            tail={tail}
            body={isShown
              ? (() => {
                  const u = usesOfNode(id, run, isMain)
                  return (
                    <Box flexDirection="column">
                      {tileStrip}
                      {/* main's turn now, as it runs; a subagent's own requests, folded until asked for. */}
                      {isMain ? liveBox : (() => {
                        const tl = subTimeline(id)
                        if (!tl) return null
                        // Its own timeline, drawn as main's turn: what it was handed as the title, its requests newest first;
                        // folded, one lane.
                        const tlKey = `tl-${id}`
                        const isTlRunning = tl.open === true
                        const boxW = TW - at - 2
                        const tlRows = own(tl).length
                        return (
                          <Box paddingLeft={at + SPACE.indent}>
                            <TurnBox
                              ui={ui}
                              width={boxW}
                              nodeKey={`node-${tlKey}`}
                              title={prompt(tl.preview)}
                              summary={`${tlRows} requests · ${span(tl.ms)}`}
                              isRunning={isTlRunning}
                              hasTurn
                              isComplete={!isTlRunning}
                              doneText="Done"
                              waterfall={(tl.reqs ?? []).length > 0 ? waterfall(tl, `tl-reqs-${id}`, boxW - 4, true) : null}
                              waterfallRows={1 + Math.min(shownCount(`tl-reqs-${id}`), tlRows)}
                              isFixed={false}
                              isOpen={isOpen(tlKey)}
                              onToggle={toggle(tlKey)}
                              lane={(tl.reqs ?? []).length > 0 ? laneOf(tl, boxW - 4, isTlRunning) : null}
                            />
                          </Box>
                        )
                      })()}
                      {/* The agent's window is always in view, under its tiles. */}
                      {/* Its window in a box, always in view under its tiles; opened, the Breakdown and what it used. */}
                      {(() => {
                        const details = (room: number) => [
                          ...(run.combos ? [<ComboTable ui={ui} combos={run.combos} indent={0} rowWidth={room} />] : []),
                          useTable(id, 'Tools', undefined, u.toolRows, 0),
                          useTable(id, 'MCP', T.source.mcp, u.mcpRows, 0),
                          useTable(id, 'Skills', T.source.skill, u.skillRows, 0),
                          useTable(id, 'Hooks', T.source.hook, u.hookRows, 0),
                        ]
                        return isMain ? mainCtx(at, details) : ctxView({ key: ctxKey, now: run.last, list: ctxList, peak: run.peak, indent: at, details })
                      })()}
                      {/* What it was handed to start with, read when asked for. */}
                      {isMain ? null : promptView(id, at + SPACE.indent)}
                    </Box>
                  )
                })()
              : null}
          />,
        )
        // The children not shown yet are the last branch: the last child shown keeps the line on down to the row that shows them.
        const kids = paged(`kids-${id}`, children)
        const kidRails = depth > 0 ? [...rails, !isLast] : []
        const hasMoreKids = children.length > kids.length
        kids.forEach((c, n) => agentNode(c, depth + 1, n === kids.length - 1 && !hasMoreKids, kidRails, keep, out))
        const moreKids = more(`kids-${id}`, children.length, 0)
        if (moreKids)
          out.push(
            <Box flexDirection="row">
              <Text color={T.text.muted}>{`${kidRails.map(b => (b ? '│ ' : '  ')).join('')}${hasMoreKids ? '└ ' : '  '}`}</Text>
              {moreKids}
            </Box>,
          )
      }
      if (mine) agentNode('main', 0, true, [], isAlive, agentNodes)
      // The finished ones, each from the one nearest main whose starter is main or still runs, with all it started below.
      const doneSet = new Set(done)
      const doneRoots = isOpen('done') ? done.filter(id => !doneSet.has(parentOf(id) ?? '')).reverse() : []
      const doneShown = paged('done', doneRoots)
      TW = BR
      doneShown.forEach((id, n) => agentNode(id, 1, n === doneShown.length - 1, [], () => true, doneNodes))
      TW = IW
      // The turns as a strip, each in the colour of the setting it ran at; the settings in the order the session first used them.
      // The line under the work names the model alone: the effort is the table's, open under Work.
      const settingKeys = [...new Set(turnList.flatMap(t => (t.model ? [tinyModel(t.model)] : [])))]
      const settingColor = (key: string) => MODEL_SERIES[settingKeys.indexOf(key) % MODEL_SERIES.length] ?? T.text.soft
      // The session on one clock: main's requests and calls, the setting it ran at, the compactions, and the agents and
      // shells by when they started, a column free between marks.
      const depthOf = (id: string) => {
        let d = 1
        for (let p = parentOf(id); p && p !== 'main' && d < 8; p = parentOf(p)) d++
        return d
      }
      const starts: TimelineStart[] = [
        ...ids.flatMap(id => (who[id]?.startedAt ? [{ at: who[id]?.startedAt ?? '', kind: 'agent' as const, depth: depthOf(id), isLive: liveIds.has(id) }] : [])),
        ...shells.map(x => ({ at: x.startedAt, kind: 'shell' as const, depth: x.owner === 'main' ? 0 : depthOf(x.owner), isLive: x.endedAt === undefined })),
      ]
      // Main's shells the lane marks, oldest first: `$` in main's hue (live while it runs), what it is, the command and how
      // long it ran. A subagent's shells are its own, under it in its tree.
      const shellsByStart = shells.filter(x => x.owner === 'main').sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      const shellRows = paged('done-shells', shellsByStart).map(sh => {
        const isLive = sh.endedAt === undefined
        const took = span(Math.max(0, (isLive ? clockNow : Date.parse(sh.endedAt ?? sh.startedAt)) - Date.parse(sh.startedAt)))
        const room = Math.max(8, BR - 2 - took.length - 2)
        const desc = cut(sh.desc ?? sh.command, room)
        const rest = sh.desc ? cut(sh.command, room - width(desc) - 2) : ''
        return (
          <Text key={`done-shell-${sh.id}`} wrap="truncate">
            <Text color={isLive ? T.state.live : T.actor.main}>{`${G.shell} `}</Text>
            <Text>{desc}</Text>
            {rest && room - width(desc) - 2 > 1 ? <Text color={T.text.muted}>{`  ${rest}`}</Text> : null}
            <Text color={T.text.muted}>{`  ${took}`}</Text>
          </Text>
        )
      })
      // Each subagent's work for the chart: its requests over the stretch from its start to its last event (to now while it
      // runs), its tool, skill and MCP calls at their own times.
      const spans = spansOf(ids.map(id => ({ id, startedAt: who[id]?.startedAt, steps: runOf(id)?.steps ?? 0, isLive: liveIds.has(id), events: (log ?? []).filter(e => e.agent === id) })), now)
      const LW = 7
      const CW = Math.max(8, BR - LW)
      const line = timelineOf({ turns: turnList, spans, compactions: compacted, starts, now, room: CW, settingOf: t => (t.model ? tinyModel(t.model) : undefined) })
      // What the chart holds in all: every request of the session and every tool, skill and MCP call, subagents' too.
      // Only a turn event says when main got busy: with none heard, the record's open turn already runs to now.
      const { reqs: reqTotal, calls: callTotal, dropped, worked } = sessionFiguresOf({ turns: turnList, busySince: turnLive.isBusy ? turnLive.busySince : undefined, spans, shells, compactions: compacted, cols: line.cols, now })
      const timelineSummary = [
        `${turnCount} turn${turnCount === 1 ? '' : 's'}`,
        ...(compacted.length > 0 ? [`${compacted.length} compaction${compacted.length > 1 ? 's' : ''}`] : []),
        `${reqTotal} request${reqTotal === 1 ? '' : 's'}`,
        `${callTotal} tool call${callTotal === 1 ? '' : 's'}`,
      ].join(' · ')
      // How long the session has run, from its first prompt to now: the Timeline's own span, growing while nothing runs.
      const turnsTime = span(Math.max(0, line.to - line.from))
      // Working is when something runs: a turn of main's, a subagent or `claude -p` child. A background shell joins it only
      // once its result comes back, so one still running does not turn the spinner. What is left of the Timeline's span is
      // idle, for the reader to take.
      const isRunningNow = isBusyNow || liveIds.size > 0
      // Six tiles of the whole session in one row, never wrapped, made once the Timeline has counted its work. The context now is not the session's: it lives in Context.
      // A tile is its name over one figure; `live` puts the working spinner beside the figure, and `reserve` is the room
      // a figure of counts keeps for its widest, so the row does not shift as they grow.
      const kpiList: { label: string; short?: string; value: string; live?: boolean; color?: string; reserve?: number }[] = [
        { label: 'Session ↑↓', short: '↑↓', value: io(k(gWhole.i), k(gWhole.o)), reserve: IO_W },
        { label: 'Cost', value: totalText },
        // Every request of the session, main's and its subagents' alike (one outside any turn too, which the Timeline
        // cannot place), and every tool, skill and MCP call the Timeline holds.
        { label: 'Req. / Calls', short: 'Req. / Calls', value: `${whole.steps} / ${callTotal}` },
        { label: 'Turns', value: String(turnCount), live: isBusyNow },
        {
          label: 'Compact',
          value: `${compacted.length}${compacted.length > 0 ? ` (-${k(dropped)})` : ''}`,
          reserve: compacted.length > 0 ? width(`${compacted.length} (-)`) + K_W : undefined,
        },
        // How long something ran, overlaps counted once, and the longest run of it with nothing idle between.
        { label: 'Work (MAX)', short: 'Work', value: `${span(worked.total)} (${span(worked.longest)})`, live: isRunningNow },
      ]
      // A row too narrow for every name takes the short names; narrower still, it keeps every figure whole and cuts the names.
      const figureNeed = kpiList.map(x => Math.max(width(x.value), x.reserve ?? 0) + (x.live ? 2 : 0) + 2)
      const needOf = (named: { label: string }[]) => named.map((x, n) => Math.max(width(x.label) + 2, figureNeed[n] ?? 0))
      const fits = (ws: number[]) => ws.reduce((n, w) => n + w, 0) <= KW
      const shortList = kpiList.map(x => ({ ...x, label: x.short ?? x.label }))
      // Inside its border a tile keeps the inset every box does while its names can be read, whole or short; only then does
      // it give the inset up, and at the last cut the names.
      const padded = (ws: number[], pad: number) => fits(ws.map(w => w + pad * 2))
      const kpiPad = padded(needOf(shortList), SPACE.inset) ? SPACE.inset : 0
      const kpis = padded(needOf(kpiList), kpiPad) ? kpiList : shortList
      const kpiNeed = padded(needOf(kpis), kpiPad) ? needOf(kpis) : figureNeed
      const kpiSum = kpiNeed.reduce((n, w) => n + w + kpiPad * 2, 0)
      const kpiW = kpiNeed.map(w => w + kpiPad * 2).map(w => (kpiSum <= KW ? w : Math.max(4, Math.floor((w * KW) / kpiSum))))
      const kpiLeft = KW - kpiW.reduce((n, w) => n + w, 0)
      kpiW.forEach((w, n) => (kpiW[n] = w + Math.floor(kpiLeft / kpis.length) + (n < kpiLeft % kpis.length ? 1 : 0)))
      const kpiStrip = <TileRow ui={ui} tiles={kpis} widths={kpiW} pad={kpiPad} rowWidth={KW} keyPrefix="kpi" borderColor={T.line.frame} spin={spin} spinColor={T.state.live} />
      // A box of the session's: its edges on the tiles', its parts inside.
      const partBox = (key: string, children: (JSX.Element | null)[]) => (
        <Box key={`box-${key}`} flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={BW}>
          {children}
        </Box>
      )
      // What it cost: the bar by kind and its key (the total is the Cost tile's); open, the table by model and by agent.
      const costHead = (
        <Button plain key="node-cost" onPress={toggle('cost')}>
          <Text color={T.text.muted}>{`${isOpen('cost') ? G.open : G.shut} `}</Text>
          <Text {...S.name}>Cost</Text>
          {/* The total is the Cost tile's: the head keeps only what went unpriced. */}
          <Text color={T.text.muted}>{cut(unpricedText ? ` ${unpricedText}` : '', Math.max(0, BR - 8))}</Text>
        </Button>
      )
      const costBox = isOk && mine ? partBox('cost', [costHead, kindBar, kindKey, isOpen('cost') ? <Box key="cost-table" marginTop={SPACE.section}>{costBody}</Box> : null]) : null
      // A row of the timeline: its label, pressed to open what it draws, then the chart to the box's edge.
      const lane = (key: string, label: string, chart: JSX.Element, onPress?: () => unknown) => (
        <Box key={`lane-${key}`} flexDirection="row" width={BR}>
          <Box width={LW} flexShrink={0}>
            {onPress ? <Button plain key={`node-${key}`} label={`${isOpen(key) ? G.open : G.shut} ${label}`} onPress={onPress} /> : <Text color={T.text.muted}>{`  ${label}`}</Text>}
          </Box>
          {chart}
        </Box>
      )
      const agentCount = ids.length
      const laneSummary = [
        `${agentCount} subagent${agentCount === 1 ? '' : 's'}`,
        ...(shells.length > 0 ? [`${shells.length} shell${shells.length === 1 ? '' : 's'}`] : []),
        ...(failed.length > 0 ? [`${failed.length} failed`] : []),
        ...(done.length > 0 ? [doneSummary] : []),
      ].join(' · ')
      const settingKey = (
        <Box key="strip-key" flexDirection="row" flexWrap="wrap" justifyContent="flex-end" columnGap={SPACE.gap} width={BR}>
          {settingKeys.map(x => (
            <Text key={`strip-key-${x}`}>
              <Text color={settingColor(x)}>■</Text>
              {` ${x}`}
            </Text>
          ))}
          <Text key="strip-key-req">
            <Text color={T.actor.main}>■</Text>
            {' requests'}
          </Text>
          <Text key="strip-key-call">
            <Text color={T.actor.mainEcho}>■</Text>
            {' tool calls'}
          </Text>
          {compacted.length > 0 ? (
            <Text key="strip-key-compact">
              <Text color={T.cost.spend}>┃</Text>
              {' compactions'}
            </Text>
          ) : null}
        </Box>
      )
      const unfolded = (key: string, body: JSX.Element | null) => (isOpen(key) && body ? <Box key={`open-${key}`} flexDirection="column" marginTop={SPACE.section} marginBottom={SPACE.section}>{body}</Box> : null)
      const timelineBox = isOk
        ? partBox('timeline', [
            // How long the session has run closes the head, on the box's right edge.
            <Box key="timeline-head" flexDirection="row" justifyContent="space-between" width={BR}>
              <Text>
                <Text {...S.name}>Timeline</Text>
                <Text color={T.text.muted}>{cut(`  ${timelineSummary}`, Math.max(8, BR - 8 - width(turnsTime) - 2))}</Text>
              </Text>
              <Text {...S.figure}>{turnsTime}</Text>
            </Box>,
            turnList.length > 0 ? settingKey : null,
            turnList.length > 0 ? lane('combos', 'Work', <StackChart ui={ui} cols={line.cols} />, settingsAll.length + compacted.length > 0 ? toggle('combos') : undefined) : null,
            turnList.length > 0 ? lane('model', 'Model', <SettingLine ui={ui} cols={line.cols} colorOf={settingColor} />) : null,
            // Open, the work is what to tune by: the compactions drawn through it, then the table by model / effort.
            unfolded(
              'combos',
              settingsAll.length + compacted.length > 0 ? (
                <Box flexDirection="column" rowGap={SPACE.section}>
                  {compacted.length > 0 ? compactsBody : null}
                  {settingsAll.length > 0 ? (
                    <Box flexDirection="column">
                      <ComboTable ui={ui} combos={settingsAll} indent={0} rowWidth={BR} />
                      {/* The page it leads to, on the table's right edge, as History is on the box's. */}
                      <Box flexDirection="row" justifyContent="flex-end" width={BR}>
                        <Button plain key="node-effort" label={`${G.page} Effort vs. Tool Calls`} onPress={openEffort} />
                      </Box>
                    </Box>
                  ) : null}
                </Box>
              ) : null,
            ),
            agentCount + shells.length + failed.length > 0 ? (
              <Box key="lane-agents" flexDirection="column">
                {lane('done', '', <MarkLane ui={ui} marks={line.marks} room={CW} />)}
                {/* The fold sits on the line that counts what it opens, its arrow just before the count, under the marks. */}
                {done.length + failed.length + shells.length > 0 ? (
                  <Button plain key="node-done" onPress={toggle('done')}>
                    <Text color={T.text.muted}>{cut(`${' '.repeat(LW - 2)}${isOpen('done') ? G.open : G.shut} ${laneSummary}`, BR)}</Text>
                  </Button>
                ) : (
                  <Text color={T.text.muted}>{cut(`${' '.repeat(LW)}${laneSummary}`, BR)}</Text>
                )}
              </Box>
            ) : null,
            unfolded(
              'done',
              done.length + failed.length + shells.length > 0 ? (
                <Box flexDirection="column">
                  {failedLines.map(x => <Text color={T.text.muted}>{cut(x, BR)}</Text>)}
                  {done.length > 0 ? doneNodes : null}
                  {done.length > 0 ? more('done', doneRoots.length, 2) : null}
                  {shellRows}
                  {more('done-shells', shellsByStart.length, 0)}
                </Box>
              ) : null,
            ),
            // The page of earlier turns closes the box, on its right edge.
            turnsBody ? (
              <Box key="timeline-links" flexDirection="row" justifyContent="flex-end" width={BR}>
                {turnsBody}
              </Box>
            ) : null,
          ])
        : null
      const sessionBlock = (
        <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={W}>
          {fold('session', 0, 'Session', '', IW)}
          {isOpen('session') ? (
            <Box flexDirection="column" paddingLeft={SPACE.indent}>
              {isOk ? kpiStrip : null}
              {costBox}
              {timelineBox}
            </Box>
          ) : null}
          {/* Without the record, main's window: it carries its own indent, its box's edges on the block's. */}
          {isOpen('session') && !mine ? fold('ctx', 1, 'Context', windowSummary(ctxNow, mainList), IW, isNearCompact(ctxNow) ? T.state.danger : undefined) : null}
          {isOpen('session') && !mine && isOpen('ctx') ? mainCtx(0) : null}
        </Box>
      )
      const runningShells = shells.filter(x => !x.endedAt).length
      const agentsBlock = isOk ? (
        <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={W}>
          {fold('agents', 0, 'Agents', [`${ids.filter(id => liveIds.has(id)).length} running subagents`, ...(runningShells > 0 ? [`${runningShells} running shell${runningShells > 1 ? 's' : ''}`] : [])].join(' · '), IW)}
          {isOpen('agents') ? agentNodes : null}
        </Box>
      ) : null

      // ════════════ EVENT LOG ════════════
      const fWho: WhoFilter = filter?.who ?? 'all'
      // A filter stored before the kinds merged reads as all.
      const fKind = KIND_FILTERS.find(v => v === filter?.kind) ?? 'all'
      const setWho = (v: WhoFilter) => () => update($, logFilter, f => ({ ...f, who: v, kind: f?.kind ?? 'all' }))
      const setKind = (v: KindFilter) => () => update($, logFilter, f => ({ ...f, who: f?.who ?? 'all', kind: v }))
      const picked = pickEvents(log, fWho, fKind)
      const EW = Math.max(16, IW - 5 - 9 - 16 - 8 - 8)
      // On the log's page the rows sit under their turn, newest first; the newest turn starts open, the rest closed.
      const logGroups = eventGroupsOf(picked)
      const newestTurn = log.reduce((m, x) => Math.max(m, x.turn ?? 0), 0)
      const previewOf = new Map(turnList.map(t => [t.n, t.preview]))
      // A group by its key: the newest turn starts open, and with it anything sent after it that opened no turn.
      const groupKey = (g: EventGroup) => (g.after === undefined ? `log-t-${g.turn}` : `log-t-${g.turn}-${g.after}`)
      const startsOpen = (g: EventGroup) => (g.after ?? g.turn) === newestTurn
      const setTurnsOpen = (isOn: boolean) => () => update($, openNodes, m => ({ ...m, ...Object.fromEntries(logGroups.map(g => [groupKey(g), isOn])) }))
      const openRestart = (c: Compaction, key: string) => openCompact(c, `cmp:${pageOf === 'log' ? 'log' : 'main'}:${key}`)
      // What a compaction left in the window: the summary it wrote, the messages it kept, the files it pointed back to, and the
      // rest, which is what every request carries anyway (system prompt, tools) and the reminders the harness attaches again.
      const restartHost = { paged, more, fold, isOpen }
      const restartView = (c: Compaction, from: 'log' | 'main') => (
        <RestartScreen ui={ui} host={restartHost} c={c} got={restartOf?.uuid === (c.uuid ?? '') ? restartOf : null} width={W} rowWidth={IW} onBack={go(from === 'log' ? 'log' : null)} />
      )
      const logBlock = isOk ? <EventLogBox ui={ui} width={W} actionWidth={EW - SPACE.indent} onRestart={openRestart} log={log} onAll={go('log')} isOpen={isOpen('log')} onToggle={toggle('log')} /> : null
      const logView = (
        <EventLogScreen
          ui={ui}
          width={W}
          rowWidth={IW}
          actionWidth={EW}
          onRestart={openRestart}
          total={log}
          picked={picked.length}
          who={fWho}
          kind={fKind}
          onWho={setWho}
          onKind={setKind}
          folds={paged('log-turns', logGroups).map(g => {
            const key = groupKey(g)
            return {
              key,
              title: g.turn > 0 ? `#${g.turn}「${prompt(previewOf.get(g.turn) ?? '')}」` : g.after ? `after #${g.after} · no new turn` : 'before the first turn',
              isOpen: open[key] ?? startsOpen(g),
              onToggle: () => update($, openNodes, m => ({ ...m, [key]: !(m[key] ?? startsOpen(g)) })),
              all: g.rows,
              shown: paged(key, g.rows),
              ...stepsOf(key, g.rows.length),
            }
          })}
          onExpand={logGroups.length > 1 ? setTurnsOpen : undefined}
          {...stepsOf('log-turns', logGroups.length)}
          onBack={go(null)}
        />
      )

      // Without the record there is no picture to draw: say what is missing, and keep what /context knows.
      const notice = (
        <Box flexDirection="column">
          {hist.status === 'no-jq' ? <Text bold>jq is required</Text> : null}
          {hist.status === 'no-jq' ? <Text color={T.text.muted}>Session lens reads this session's transcript with jq: tool, MCP, message and subagent usage all come from it.</Text> : null}
          {hist.status === 'no-jq' ? <Text color={T.text.muted}>macOS: brew install jq    Linux: sudo apt install jq    Windows: winget install jqlang.jq</Text> : null}
          {hist.status === 'no-jq' ? <Text color={T.text.muted}>Install it, then run /session-lens again.</Text> : null}
          {hist.status === 'error' ? <Text bold>Could not read the session transcript</Text> : null}
          {hist.status === 'error' ? <Text color={T.text.muted}>{hist.detail}</Text> : null}
        </Box>
      )

      // What a reload kept, drawn while this code reads the record again.
      const rereading =
        isRereading && frame - rereadSince >= REREAD_AFTER ? reading('Re-reading the session transcript · what is shown is from before', W, frame - rereadSince) : null
      if (pageOf === 'log') return <Box flexDirection="column" width={W}>{rereading}{logView}</Box>
      if (pageOf?.startsWith('cmp:')) {
        const [, from, key] = /^cmp:(log|main):(.*)$/.exec(pageOf) ?? []
        const c = compacted.find(x => `${x.ts}|${x.pre}` === key)
        if (c) return <Box flexDirection="column" width={W}>{restartView(c, from === 'log' ? 'log' : 'main')}</Box>
      }
      // The version opens two tabs of one page: what the pane draws with, and what it builds from that. Their specimens play.
      showcase($, pageOf === 'tokens' || pageOf === 'components')
      const versionTabs = (current: 'tokens' | 'components') => <Tabs ui={ui} tabs={[{ key: 'tokens', label: 'Design tokens' }, { key: 'components', label: 'UI components' }]} current={current} color={T.actor.main} onPick={go} />
      if (pageOf === 'tokens') return <Box flexDirection="column" width={W}><TokenScreen ui={ui} width={W} rowWidth={IW} version={version} tabs={versionTabs('tokens')} frame={frame} spin={spin} onBack={go(null)} /></Box>
      if (pageOf === 'components') return <Box flexDirection="column" width={W}><ComponentScreen ui={ui} width={W} rowWidth={IW} version={version} tabs={versionTabs('components')} frame={frame} spin={spin} onBack={go(null)} /></Box>
      if (pageOf === 'effort') {
        // This session's turns are read live; every other session's as the page opened.
        const sid = await $.session.id()
        const here: EffortSample[] = effortSamplesOf(turnList)
        const others = Object.entries(effortOf?.bySession ?? {}).filter(([id]) => id !== sid)
        const samples = scopeOf === 'this' ? here : [...here, ...others.flatMap(([, xs]) => xs)]
        const sessions = 1 + others.filter(([, xs]) => xs.length > 0).length
        const effortView = <EffortScreen ui={ui} width={W} rowWidth={IW} study={effortStudyOf(samples)} sessions={sessions} turns={samples.length} scope={scopeOf} onScope={v => () => update($, effortScope, () => v)} status={effortOf?.status ?? 'pending'} onBack={go(null)} />
        return <Box flexDirection="column" width={W}>{effortView}</Box>
      }
      if (pageOf === 'turns') return <Box flexDirection="column" width={W}>{rereading}{historyView}</Box>
      const chatPage = /^chat:(.+)$/.exec(pageOf ?? '')?.[1] as ChatKind | undefined
      if (chatPage) return <Box flexDirection="column" width={W}>{rereading}{chatView(chatPage)}</Box>
      const initPage = pageOf?.startsWith('init:') ? INIT_PAGES.get(pageOf.slice('init:'.length)) : undefined
      if (pageOf && initPage) return <Box flexDirection="column" width={W}>{rereading}{initView(pageOf.slice('init:'.length), initPage.page)}</Box>

      return (
        <Box flexDirection="column" width={W}>
          {rereading}
          {isOk ? null : notice}
          {sessionBlock}
          {agentsBlock}
          {logBlock}
          {/* The version at the left, so which copy runs can be seen; pressed, it opens the tabs of design tokens and UI components. Beside it the
              theme drawn, which a press switches. The report is a turn of the model's: it costs tokens, so it asks once more
              before it runs. Seldom wanted, it sits apart from every block, under the last, at the right, and dim. */}
          <Box flexDirection="row" justifyContent="space-between" width={W}>
            <Box flexDirection="row" gap={SPACE.gap}>
              {version ? <Button plain key="node-version" onPress={go('tokens')}><Text color={T.text.muted}>{`v${version}`}</Text></Button> : null}
              <Button plain key="node-theme" onPress={() => switchTheme($)}><Text color={T.text.muted}>{`${G.theme} ${drawnTheme}`}</Text></Button>
            </Box>
            {isOk ? (
              /* Installed since the last reading, the plugin is found as the fold opens. */
              <Button plain key="node-report" onPress={() => checkReport($).then(toggle('report')).then(() => $.ui.scroll({ in: PANE, to: 'end' }).catch(() => undefined))}>
                <Text color={T.text.muted}>{`${isOpen('report') ? G.open : G.shut} Generate Current Session Analysis Report`}</Text>
              </Button>
            ) : null}
          </Box>
          {isOk && !hasReport && isOpen('report') ? (
            <Box flexDirection="column" alignItems="flex-end" width={W}>
              <Text color={T.text.muted}>{cut(`Needs Anthropic's session-report plugin, which is not installed. ${reportMarket ? 'Install it with' : 'Add its marketplace and install it with'}`, W)}</Text>
              {reportMarket ? null : <Text color={T.actor.main}>{cut(`/plugin marketplace add ${REPORT_REPO}`, W)}</Text>}
              <Text color={T.actor.main}>{cut(`/plugin install session-report@${reportMarket ?? 'claude-plugins-official'}`, W)}</Text>
              <Text color={T.text.muted}>{cut('then run /reload-plugins (or restart Claude Code) and press this again.', W)}</Text>
              <Button key="node-report-cancel" label="Close" onPress={toggle('report')} />
            </Box>
          ) : null}
          {isOk && hasReport && isOpen('report') ? (
            <Box flexDirection="column" alignItems="flex-end" width={W}>
              <Text color={T.text.muted}>{cut("Runs session-report's skill on this session alone: a turn of the model's, which uses tokens.", W)}</Text>
              {/* Drawn with the Button's own chrome, so the two read as buttons, apart from the plain fold above. */}
              <Box flexDirection="row" columnGap={SPACE.gap}>
                <Button key="node-report-go" label="Generate" onPress={() => update($, openNodes, m => ({ ...m, report: false })).then(() => report($))} />
                <Button key="node-report-cancel" label="Cancel" onPress={toggle('report')} />
              </Box>
            </Box>
          ) : null}
        </Box>
      )
    } catch (error) {
      return (
        <Box flexDirection="column">
          <Text {...S.danger}>Session lens failed to render</Text>
          <Text>{String(error)}</Text>
        </Box>
      )
    }
  })
}
