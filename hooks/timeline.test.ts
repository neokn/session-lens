import { expect, test } from 'claude-code/testing'
import type { TurnRow } from '../types'
import { tinyModel } from './views/layout'
import { sessionFiguresOf, spansOf } from './digest/figures'
import { summaryParts } from './digest/summary'
import { stackCells, timelineOf, workedOf, type TimelineStart } from './digest/timeline'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')
const at = (s: number) => new Date(T0 + s * 1000).toISOString()
const turn = (n: number, start: number, secs: number, steps: number, tools: number, extra: Partial<TurnRow> = {}): TurnRow => ({
  n, preview: '', steps, wrote: 0, read: 0, cacheRead: 0, subCount: 0, subSteps: 0, subRead: 0, subWrote: 0,
  ms: secs * 1000, startedAt: at(start), model: 'claude-opus-5-5', effort: 'high',
  calls: { steps, tools, skills: 1, mcp: 1, thinking: 0 }, ...extra,
})
const setting = (t: TurnRow) => `${t.model}/${t.effort}`
const of = (o: { turns: TurnRow[]; starts?: TimelineStart[]; compactions?: { ts: string; trigger: string; pre: number; post: number }[]; now?: number; room?: number }) =>
  timelineOf({ turns: o.turns, compactions: o.compactions ?? [], starts: o.starts ?? [], now: o.now ?? T0, room: o.room ?? 10, settingOf: setting })

test('the timeline is as wide as its room, a turn spread evenly over the stretch it ran, idle stretches hold no work', () => {
  // Two turns, 0–20s and 80–100s, on ten columns of 10s: the first fills two, the last two, the middle is idle.
  const line = of({ turns: [turn(1, 0, 20, 4, 6), turn(2, 80, 20, 2, 0, { effort: 'low' })] })
  expect(line.cols).toHaveLength(10)
  expect(line.cols.map(c => c.reqs)).toEqual([2, 2, 0, 0, 0, 0, 0, 0, 1, 1])
  // Calls are tools, skills and MCP together, conserved over the columns.
  expect(line.cols.reduce((n, c) => n + c.calls, 0)).toBe(8 + 2)
  // Idle, main still runs at the setting it last ran at: the line runs on.
  expect(line.cols.slice(2, 8).every(c => c.reqs + c.calls === 0 && c.setting === 'claude-opus-5-5/high')).toBe(true)
  expect([line.cols[0]?.setting, line.cols[9]?.setting]).toEqual(['claude-opus-5-5/high', 'claude-opus-5-5/low'])
})

test('a turn still running reaches to now, and a compaction marks the column it fell in', () => {
  const line = of({ turns: [turn(1, 0, 10, 1, 0), turn(2, 10, 5, 9, 0, { open: true })], now: T0 + 100_000, compactions: [{ ts: at(55), trigger: 'auto', pre: 1, post: 0 }] })
  expect(line.to - line.from).toBe(100_000)
  expect(line.cols.filter(c => c.reqs > 0)).toHaveLength(10)
  expect(line.cols.map(c => c.isCompact)).toEqual([false, false, false, false, false, true, false, false, false, false])
})

test('a column holds the mark of the kind most started in it; on a tie, the kind fewest in the whole timeline', () => {
  const starts: TimelineStart[] = [
    // Column 0 (0–9s): two agents and a shell: the agents are most.
    { at: at(1), kind: 'agent', depth: 1, isLive: false },
    { at: at(2), kind: 'agent', depth: 1, isLive: false },
    { at: at(3), kind: 'shell', depth: 0, isLive: true },
    // Column 3 (30–39s): one agent, one shell, tied; the shell is fewer in all (2 against 4), and it is live.
    { at: at(31), kind: 'agent', depth: 1, isLive: true },
    { at: at(32), kind: 'shell', depth: 0, isLive: true },
    // Column 4 beside it keeps its own mark: no column is left free.
    { at: at(41), kind: 'agent', depth: 2, isLive: false },
  ]
  const line = of({ turns: [turn(1, 0, 100, 1, 0)], starts })
  expect(line.marks).toEqual([
    { col: 0, kind: 'agent', depth: 1, isLive: false },
    { col: 3, kind: 'shell', depth: 0, isLive: true },
    { col: 4, kind: 'agent', depth: 2, isLive: false },
  ])
  // Kept apart by who started them: two shells of different depths are two kinds.
  const apart = of({ turns: [turn(1, 0, 100, 1, 0)], starts: [{ at: at(1), kind: 'shell', depth: 0, isLive: false }, { at: at(2), kind: 'shell', depth: 1, isLive: false }, { at: at(3), kind: 'shell', depth: 1, isLive: false }] })
  expect(apart.marks).toEqual([{ col: 0, kind: 'shell', depth: 1, isLive: false }])
})

test('a session with no turn yet draws empty columns and no marks', () => {
  const line = of({ turns: [], starts: [{ at: at(0), kind: 'agent', depth: 1, isLive: true }] })
  expect(line.cols).toHaveLength(10)
  expect(line.marks).toEqual([])
})

test('a stacked column holds requests from its foot and calls above, the cell they meet in split between them', () => {
  // The tallest column fills both rows; a quarter of it is requests: 4 eighths, then 12 eighths of calls.
  expect(stackCells({ reqs: 1, calls: 3 }, 4)).toEqual([{ eighths: 8, split: 0 }, { eighths: 8, split: 4 }])
  // Half as tall in total, square-root scaled: 11 of 16 eighths, the top row 3 eighths.
  expect(stackCells({ reqs: 2, calls: 0 }, 4)).toEqual([{ eighths: 3, split: 3 }, { eighths: 8, split: 8 }])
  // Something always shows; nothing shows nothing.
  expect(stackCells({ reqs: 0.001, calls: 0 }, 1000)[1]).toEqual({ eighths: 1, split: 1 })
  expect(stackCells({ reqs: 0, calls: 0 }, 4)).toEqual([null, null])
})

test("the model line's key names a model at its tightest, so several fit beside each other", () => {
  expect(['claude-opus-5-5', 'claude-haiku-4-5-20251001', 'claude-fable-5-1', 'claude-opus-4', 'gpt-x'].map(tinyModel)).toEqual(['opus55', 'haiku45', 'fable51', 'opus4', 'gpt-x'])
})

test("a subagent's requests stack with main's over the stretch it ran, its calls in the column each was made, past main's last turn too", () => {
  const line = timelineOf({
    turns: [turn(1, 0, 20, 2, 0)],
    spans: [{ from: at(30), to: at(100), reqs: 7, calls: [at(35), at(95), at(99)] }],
    compactions: [], starts: [], now: T0, room: 10, settingOf: setting,
  })
  // The subagent ran on after main's turn: the clock reaches its end.
  expect(line.to - line.from).toBe(100_000)
  expect(line.cols.map(c => c.reqs)).toEqual([1, 1, 0, 1, 1, 1, 1, 1, 1, 1])
  // Main's two calls a turn (skill and MCP) and the subagent's three.
  expect(line.cols.map(c => c.calls)).toEqual([1, 1, 0, 1, 0, 0, 0, 0, 0, 2])
})

test('worked is how long something ran, main, a subagent or a shell, overlaps counted once, and the longest run with no idle in it', () => {
  const s = (x: number) => T0 + x * 1000
  // main 0–10s, a subagent 5–30s past the turn, a shell 40–50s, main again 60–70s: runs of 30, 10 and 10 seconds.
  const busy = [{ from: s(0), to: s(10) }, { from: s(5), to: s(30) }, { from: s(40), to: s(50) }, { from: s(60), to: s(70) }]
  expect(workedOf(busy)).toEqual({ total: 50000, longest: 30000 })
  // One starting where another ends makes a single run: 60–100s joins the last.
  expect(workedOf([...busy, { from: s(65), to: s(100) }])).toEqual({ total: 80000, longest: 40000 })
  expect(workedOf([])).toEqual({ total: 0, longest: 0 })
  // A run still going is counted to now: once it is the longest, the longest grows with it.
  const running = (now: number) => workedOf([{ from: s(0), to: s(10) }, { from: s(20), to: s(now) }])
  expect(running(25)).toEqual({ total: 15000, longest: 10000 })
  expect(running(60)).toEqual({ total: 50000, longest: 40000 })
})

test('the session figures: what the chart holds, what compacting dropped, and the work of turns, subagents and shells counted once', () => {
  const spans = spansOf([
    { id: 'a', startedAt: at(5), steps: 3, isLive: false, events: [{ kind: 'tool', ts: at(8) }, { kind: 'text', ts: at(9) }] },
    { id: 'b', startedAt: undefined, steps: 9, isLive: true, events: [] },
    { id: 'c', startedAt: at(50), steps: 1, isLive: true, events: [] },
  ], T0 + 60_000)
  // No start, no stretch; a live one runs to now; a finished one to its last event; only call kinds are calls.
  expect(spans).toEqual([
    { from: at(5), to: at(9), reqs: 3, calls: [at(8)] },
    { from: at(50), to: at(60), reqs: 1, calls: [] },
  ])
  const shell = { id: 's', owner: 'main', command: 'sleep', startedAt: at(0), endedAt: at(30), status: 'completed' }
  const f = sessionFiguresOf({
    turns: [turn(1, 0, 10, 1, 0)], spans, shells: [shell], now: T0 + 60_000,
    compactions: [{ ts: at(1), trigger: 'auto', pre: 190, post: 30 }, { ts: at(2), trigger: 'manual', pre: 5, post: 9 }],
    cols: [{ reqs: 1.4, calls: 2.2 }, { reqs: 1.4, calls: 0.2 }],
  })
  expect(f.reqs).toBe(3)
  expect(f.calls).toBe(2)
  // A compaction that grew the context drops nothing.
  expect(f.dropped).toBe(160)
  // 0–30s (turn and shell overlap) + 50–60s.
  expect(f.worked).toEqual({ total: 40_000, longest: 30_000 })
})

test('a background shell is work only once its result came back, whatever its command', () => {
  const workWith = (status: string, endedAt?: string) => sessionFiguresOf({
    turns: [turn(1, 0, 10, 1, 0)], spans: [], compactions: [], cols: [], now: T0 + 60_000,
    shells: [{ id: 's', owner: 'main', command: 'sleep', startedAt: at(20), endedAt, status }],
  }).worked
  // The turn's 0–10s and the shell's 20–30s, while main did something else or nothing.
  const returned = { total: 20_000, longest: 10_000 }
  expect(workWith('completed', at(30))).toEqual(returned)
  expect(workWith('failed', at(30))).toEqual(returned)
  // The turn alone: a dev server left running, or one given up on, brought nothing back.
  const turnAlone = { total: 10_000, longest: 10_000 }
  expect(workWith('running')).toEqual(turnAlone)
  expect(workWith('killed', at(30))).toEqual(turnAlone)
  expect(workWith('ended', at(30))).toEqual(turnAlone)
})

test('a compaction summary is cut into its numbered sections, the preamble and the closing instructions kept as asides', () => {
  const parts = summaryParts('Intro line\n1. Primary Request:\n   keep it\n2. Key Concepts:\n   - folds\nContinue the conversation from here')
  expect(parts.map(x => x.title)).toEqual(['Preamble', '1. Primary Request', '2. Key Concepts', 'Closing (instructions to the model)'])
  expect(parts.map(x => x.isAside ?? false)).toEqual([true, false, false, true])
  // An empty preamble is left out.
  expect(summaryParts('1. Only:\n   x').map(x => x.title)).toEqual(['1. Only'])
})
