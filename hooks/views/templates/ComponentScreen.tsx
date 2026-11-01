import type { Combo, Compaction, EventRow, Req, TurnRow, UseRow } from '../../../types'
import type { EffortModel } from '../../digest/effort'
import type { TimelineCol, TimelineMark } from '../../digest/timeline'
import { barCells } from '../layout'
import { ContextBar, ContextLine, type BarPart } from '../molecules/ContextBar'
import { COST_COLS, CostHead, CostRow } from '../molecules/CostRow'
import { EffortChart, EffortHead } from '../molecules/EffortChart'
import { EventLine } from '../molecules/EventLine'
import { KindBar, KindKey, type CostKind } from '../molecules/KindBar'
import { MoreRow } from '../molecules/MoreRow'
import { Tabs } from '../molecules/Tabs'
import { fitTiles, TileRow, type TileSpec } from '../molecules/TileRow'
import { MarkLane, SettingLine, StackChart } from '../molecules/Timeline'
import { AgentNode } from '../organisms/AgentNode'
import { ComboTable } from '../organisms/ComboTable'
import { Compactions } from '../organisms/Compactions'
import { ContextGrid, type GridGroup, type Square } from '../organisms/ContextGrid'
import { CostTable, type CostItem, type CostLine } from '../organisms/CostTable'
import { EventLogBox, LogHead } from '../organisms/EventLog'
import { TurnBox } from '../organisms/TurnBox'
import { TurnEntry } from '../organisms/TurnEntry'
import { UseTable } from '../organisms/UseTable'
import { Lane, Waterfall } from '../organisms/Waterfall'
import { G, S, SPACE, T } from '../palette'
import { beatOf } from '../sweep'
import type { UI } from '../ui'

// What a specimen's press does: nothing. It plays through its states by itself.
const idle = () => undefined
const VERDICTS: EffortModel['verdict'][] = ['more', 'fewer', 'same', 'few']

/** The page behind the version's other tab: every component built of atoms, by what it is composed of, each drawn with
 * sample figures, playing through its states. A molecule is a fixed group with one job, an organism a section that could
 * move to another page. The samples are made as the page draws, so a change of theme reaches them. */
export function ComponentScreen({ ui, width, rowWidth, version, tabs, frame, spin, onBack }: { ui: UI; width: number; rowWidth: number; version?: string; tabs: JSX.Element; frame: number; spin: string; onBack: () => unknown }) {
  const { Box, Text, Button } = ui
  const beat = beatOf(frame)
  // A specimen that changes height keeps its tallest, so the page under it does not jump as it plays.
  const stage = (rows: number, ...specimen: (JSX.Element | null)[]) => <Box flexDirection="column" height={rows}>{specimen}</Box>
  const stratum = (title: string, means: string) => (
    <Box flexDirection="column" marginTop={SPACE.section}>
      <Text bold color={T.actor.main}>{title}</Text>
      <Text color={T.text.muted} wrap="wrap">{means}</Text>
    </Box>
  )
  const entry = (name: string, says: string, ...specimen: (JSX.Element | null)[]) => (
    <Box key={`catalog-${name}`} flexDirection="column" marginTop={SPACE.section}>
      <Text {...S.name}>{name}</Text>
      <Text color={T.text.muted} wrap="wrap">{says}</Text>
      {specimen}
    </Box>
  )

  const tiles: TileSpec[] = [{ label: 'Model / Effort', labels: ['Model'], value: 'opus-5-5/high', shorter: ['opus-5-5'] }, { label: '↑ ↓', value: '12.3k 4.5k' }, { label: 'Requests', labels: ['Reqs'], value: '18' }, { label: 'Tool Calls', labels: ['Calls'], value: String(42 + beat % 8), live: true }]
  const fitted = fitTiles(tiles, rowWidth, undefined, false)
  // The window fills, past the point where auto-compact would have run, and starts again.
  const filled = 60000 + (beat % 8) * 25000
  const threshold = 210000
  const parts: BarPart[] = [{ v: 22000, color: T.actor.main }, { v: 14000, color: T.source.mcp }, { v: Math.round((filled - 36000) * 0.6), color: T.cost.fresh }, { v: Math.round((filled - 36000) * 0.4), color: T.cost.spend }]
  const kinds: CostKind[] = [['cr', T.cost.reused, 'cache/r', 1.1], ['w5', T.cost.cachedShort, 'cache/w 5m', 0.6], ['i', T.cost.fresh, 'input', 0.3], ['o', T.cost.spend, 'output', 1.2]]
  const usd = kinds.reduce((n, x) => n + x[3], 0)
  const barW = Math.max(10, rowWidth - 6)
  const study: EffortModel = {
    model: 'claude-opus-5-5',
    verdict: VERDICTS[beat % VERDICTS.length] ?? 'more',
    rows: [
      { effort: 'low', n: 12, q1: 1, median: 2, q3: 4, most: 9, perStep: 0.61 },
      { effort: 'high', n: 20, q1: 5, median: 8, q3: 13, most: 31, perStep: 0.84 },
      { effort: 'max', n: 3, q1: 9, median: 12, q3: 16, most: 18, perStep: 0.9 },
    ],
  }
  const events: EventRow[] = [
    { ts: '2026-01-01T09:00:00.000Z', who: 'main', depth: 0, kind: 'prompt', name: 'Sample prompt', o: 0, turn: 3 },
    { ts: '2026-01-01T09:00:04.000Z', who: 'main', depth: 0, kind: 'tool', name: 'Read', o: 40, ...(beat % 2 === 0 ? {} : { i: 1800, result: '120 lines' }), detail: 'src/sample.ts', turn: 3 },
    { ts: '2026-01-01T09:00:09.000Z', who: 'sample-agent', depth: 1, kind: 'mcp', name: 'mcp__sample__search', o: 60, i: 900, detail: 'query', turn: 3 },
    { ts: '2026-01-01T09:00:12.000Z', who: 'main', depth: 0, kind: 'tool', name: 'Bash', o: 30, i: 200, detail: 'false', result: 'exit 1', isError: true, turn: 3 },
    { ts: '2026-01-01T09:00:15.000Z', who: 'main', depth: 0, kind: 'compact', name: 'compact', o: 0, pre: 210000, i: 40000, detail: 'auto', turn: 3 },
    { ts: '2026-01-01T09:00:20.000Z', who: 'main', depth: 0, kind: 'reply', name: 'reply', o: 320, i: 42000, detail: 'A sample reply', turn: 3 },
  ]
  const lineW = Math.max(10, rowWidth - 46)
  const reqs: Req[] = [
    { who: 'main', depth: 0, no: 1, label: 'Read', startMs: 0, ms: 2000, i: 12000, o: 300, n: 1 },
    { who: 'main', depth: 0, no: 2, label: 'Bash', startMs: 2000, ms: 16000, i: 14000, o: 900, n: 1 },
    { who: 'sample-agent', depth: 1, no: 3, label: 'sample-agent', startMs: 3000, ms: 6000, i: 8000, o: 500, n: 3 },
    { who: 'main', depth: 0, no: 4, label: 'reply', startMs: 18000, ms: 3000, i: 15000, o: 200, n: 1 },
    { who: 'main', depth: 0, no: 5, label: 'reply', startMs: 21000, ms: 4000, i: 15500, o: 100, n: 1 },
  ]
  // The requests arrive one by one, the newest still waiting for its reply, and the turn starts again.
  const played: Req[] = reqs.slice(0, 1 + beat % reqs.length).map((r, n, all) => (n === all.length - 1 ? { ...r, running: true } : r))
  const turnMs = Math.max(...played.map(r => r.startMs + r.ms))
  const waterfall = (pageKey: string, shown: number) => <Waterfall ui={ui} reqs={played} turnMs={turnMs} room={rowWidth - 4} isNewestFirst pageKey={pageKey} shown={shown} more={{ label: `${G.more} Show ${played.length - shown} more`, onPress: idle }} spin={spin} />
  const lane = (label: string) => <Lane ui={ui} reqs={played} turnMs={turnMs} room={rowWidth - 4} label={label} labelW={12} />
  const compactions: Compaction[] = [{ ts: '2026-01-01T09:00:15.000Z', trigger: 'auto', pre: 210000, post: 40000 }, { ts: '2026-01-01T10:30:00.000Z', trigger: 'manual', pre: 96000, post: 21000 }]
  const combos: Combo[] = [{ model: 'claude-opus-5-5', effort: 'high', turns: 8, steps: 40, tools: 56, skills: 2, mcp: 6, thinking: 24000 }, { model: 'claude-opus-5-5', effort: 'max', turns: 2, steps: 22, tools: 31, skills: 0, mcp: 4, thinking: 30000 }]
  const uses: UseRow[] = [{ name: 'Read', count: 24, sent: 800, back: 42000, scope: 'built-in' }, { name: 'Bash', count: 11, sent: 600, back: 9000, scope: 'built-in' }, { name: 'sample-search', count: 4, sent: 200, back: 3100, scope: 'sample-server' }]
  const costName = Math.max(12, rowWidth - 2 - COST_COLS)
  const byModel: CostLine[] = [{ key: 'catalog-cost-opus', indent: 0, name: 'opus-5-5', note: '· main', reqs: 18, i: 240000, o: 4500, cost: 2.4, color: T.text.soft, noteColor: T.actor.main }]
  const byAgent: CostItem[] = [
    { row: { key: 'catalog-cost-main', indent: 0, name: 'main agent', note: '· opus-5-5', reqs: 18, i: 240000, o: 4500, cost: 2.4, color: T.actor.main } },
    { rewrite: { key: 'catalog-cost-rewrite', indent: 0, tokens: 18000, usd: 0.11 } },
    { row: { key: 'catalog-cost-agent', indent: 2, name: 'sample-agent', note: '· a sample task', reqs: 3, i: 8000, o: 500, cost: 0.2, color: T.actor.sub } },
  ]
  const cols: TimelineCol[] = Array.from({ length: Math.min(48, rowWidth) }, (_, n) => ({ reqs: ((n + beat) * 7) % 5, calls: ((n + beat) * 3) % 4, setting: (n + beat) % 48 < 24 ? 'high' : 'max', isCompact: (n + beat) % 48 === 30 }))
  const marks: TimelineMark[] = [{ col: 6, kind: 'agent', depth: 1, isLive: beat % 2 === 0 }, { col: 14, kind: 'shell', depth: 0, isLive: beat % 2 === 1 }, { col: 40, kind: 'agent', depth: 1, isLive: true }]
  const gridParts = [{ key: 'opening', name: 'Opening', v: 36000, color: T.actor.main, ch: G.opening }, { key: 'since', name: 'Since', v: filled - 36000, color: T.cost.fresh, ch: G.since }, { key: 'free', name: 'Free space', v: Math.max(0, threshold - filled), color: T.text.muted, ch: G.free, free: true }, { key: 'buffer', name: 'Autocompact buffer', v: 33000, color: T.state.danger, ch: G.buffer, free: true }]
  const squares: Square[] = gridParts.flatMap(p => Array.from({ length: Math.round((p.v / 243000) * 100) }, () => p)).slice(0, 100)
  const groups: GridGroup[] = [{ key: 'init', title: 'Init', parts: gridParts.slice(0, 1) }, { key: 'conversation', title: 'Conversation', parts: gridParts.slice(1, 2) }, { key: 'room', parts: gridParts.slice(2) }]
  const turn: TurnRow = { n: 3, preview: 'A sample prompt', usd: 0.42, steps: 4, wrote: 1500, read: 56500, cacheRead: 40000, subCount: 1, subSteps: 3, subRead: 8000, subWrote: 500, ms: turnMs, idleMs: 120000, did: { Read: 3, Bash: 1 } }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={width}>
      <Button plain key="node-components-back" label={`${G.back} Back`} onPress={onBack} />
      <Text {...S.name}>{`Session lens${version ? ` v${version}` : ''} · UI components`}</Text>
      {tabs}
      <Text color={T.text.muted} wrap="wrap">Each is drawn with sample figures; none reads the session, and each plays through its states. The atoms are with the design tokens.</Text>

      {stratum('Molecules', 'A small fixed group with one job you can name.')}
      {entry('Tabs', "Which of a page's views is drawn.", <Tabs ui={ui} tabs={[{ key: 'first', label: 'first' }, { key: 'second', label: 'second' }]} current={beat % 2 === 0 ? 'first' : 'second'} color={T.actor.main} onPick={() => idle} />)}
      {entry('TileRow', 'A row of tiles, fitted to the room they share.', <TileRow ui={ui} tiles={fitted.tiles} widths={fitted.widths} pad={fitted.pad} rowWidth={rowWidth} keyPrefix="catalog-tiles" borderColor={T.line.frame} spin={spin} spinColor={T.state.live} />)}
      {entry('MoreRow', 'The presses below a list drawn a page at a time.', <MoreRow ui={ui} listKey="catalog-more" indent={0} more={beat % 3 === 2 ? undefined : { label: `${G.more} Show 30 more · 42 not shown`, onPress: idle }} fewer={beat % 3 === 0 ? undefined : { label: `${G.fewer} Show first 10 only`, onPress: idle }} />)}
      {entry('ContextLine', 'The window in use, and how far auto-compact is.', <ContextLine ui={ui} figure={filled} now={filled} max={243000} threshold={threshold} isNear={threshold - filled < 30000} turnsLeft={Math.max(0, Math.round((threshold - filled) / 25000))} />)}
      {entry('ContextBar', "The window as a bar, its parts, the room left and auto-compact's mark.", <ContextBar ui={ui} max={243000} threshold={threshold} parts={parts} initParts={2} barWidth={rowWidth} />)}
      {entry('KindBar · KindKey', 'What the cost went on, as one bar, and which colour is which.', <KindBar ui={ui} kinds={kinds} cells={barCells(kinds.map(x => x[3]), usd, barW)} barWidth={barW} rowWidth={rowWidth} total={`$${usd.toFixed(2)}`} />, <KindKey ui={ui} kinds={kinds} usd={usd} rowWidth={rowWidth} />)}
      {entry('CostHead · CostRow', 'The head of a cost table, and one line of it.', <CostHead ui={ui} label="By model" nameWidth={costName} />, <CostRow ui={ui} key="catalog-cost-row" nameWidth={costName} indent={0} name="opus-5-5" note="· main" reqs={18} i={240000} o={4500} cost={2.4} share="86%" color={T.text.soft} />)}
      {entry('EffortHead · EffortChart', "One model's efforts on one scale.", <EffortHead ui={ui} room={rowWidth} />, <EffortChart ui={ui} study={study} scale={16} room={rowWidth} />)}
      {entry('EventLine', 'One line of the event log.', ...events.map((ev, n) => <EventLine ui={ui} ev={ev} n={n} actionWidth={lineW} onRestart={() => idle} />))}
      {entry('StackChart · SettingLine · MarkLane', "The session's work on one clock, the setting it ran at, and what it started.", <StackChart ui={ui} cols={cols} />, <SettingLine ui={ui} cols={cols} colorOf={s => (s === 'high' ? T.actor.main : T.cost.spend)} />, <MarkLane ui={ui} marks={marks} room={cols.length} />)}

      {stratum('Organisms', 'A section that owns its layout and could move to another page unchanged.')}
      {entry('Lane · Waterfall', 'A timeline, folded to one lane or open with a bar for each request.', lane(`${played.length} requests`), stage(6, waterfall('catalog-waterfall', 4)))}
      {entry('TurnBox', "A running turn or a subagent's timeline: its title, how it stands and its requests.", stage(9, <TurnBox ui={ui} width={rowWidth} title="A sample turn" isRunning={beat % 3 === 0} hasTurn isComplete={beat % 3 !== 0} waterfall={waterfall('catalog-turn-box', 3)} waterfallRows={5} isOpen={beat % 3 !== 2} onToggle={idle} lane={lane('Requests')} nodeKey="node-catalog-turn-box" isFixed={false} />))}
      {entry('TurnEntry', 'An earlier turn, unfolding in place.', stage(9, <TurnEntry ui={ui} rowWidth={rowWidth} turn={turn} tag="" idle={120000} isOpen={beat % 2 === 0} onToggle={idle} waterfall={waterfall('catalog-turn-entry', 3)} lane={lane('Requests')} />))}
      {entry('AgentNode', 'One agent of the tree: its head and what it opens to.', stage(2,
        <AgentNode ui={ui} nodeKey="catalog-agent" head={{ lead: '└ ', name: 'sample-agent', desc: 'a sample task', descRoom: 24, model: 'opus-5-5', status: beat % 3 === 2 ? `${G.done} Done` : `${spin} running`, runIo: '↑8.0k ↓500', onToggle: idle }} isOpen={beat % 3 !== 0} isRunning={beat % 3 !== 2} color={T.actor.sub} meta="" pad={SPACE.indent} rowWidth={rowWidth} rails="" body={beat % 3 !== 0 ? <Box paddingLeft={SPACE.indent}><Text color={T.text.muted}>What the agent opens to</Text></Box> : null} />
      ))}
      {entry('ContextGrid', 'The whole window, a square to each hundredth, beside its key.', <ContextGrid ui={ui} gridKey="catalog-grid" squares={squares} groups={groups} keyWidth={Math.max(24, Math.min(44, rowWidth - 22))} windowMax={243000} grid={243000} onOpen={() => idle} />)}
      {entry('CostTable', 'What the list price went on, by model and by agent.', <CostTable ui={ui} nameWidth={costName} sessionUsd={2.8} byModel={byModel} byAgent={byAgent} />)}
      {entry('ComboTable', 'What each model and effort did a turn.', <ComboTable ui={ui} combos={combos} indent={0} rowWidth={rowWidth} />)}
      {entry('UseTable', 'What an agent used of one kind, by where each is defined.', <UseTable ui={ui} listKey="catalog-use" title="Tools" color={undefined} rows={uses} indent={0} nameWidth={28} pageOf={(_, total) => ({ shown: total })} />)}
      {entry('Compactions', 'Each compaction, from what to what and what it dropped.', <Compactions ui={ui} indent={0} shown={compactions} onOpen={() => idle} />)}
      {entry('LogHead · EventLogBox', "The columns of the log, and the main page's box of its newest events.", <LogHead ui={ui} actionWidth={lineW} />, stage(11, <EventLogBox ui={ui} width={rowWidth} actionWidth={Math.max(10, lineW - SPACE.indent - 4)} onRestart={() => idle} log={events} onAll={idle} isOpen={beat % 2 === 0} onToggle={idle} />))}
    </Box>
  )
}
