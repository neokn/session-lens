import { expect, mock, test } from 'claude-code/testing'
import { fitTiles } from './views/molecules/TileRow'
import { LOADING, T } from './views/palette'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const square = (color: string, isFilled: boolean) => ({ color, isFilled, categoryName: 'x', tokens: 1, percentage: 1, squareFullness: 1 })
const USAGE = {
  startedAt: 0,
  rateLimits: [],
  context: {
    window: 200000,
    breakdown: {
      model: 'm',
      maxTokens: 200000,
      autocompactSource: 'auto' as const,
      isAutoCompactEnabled: true,
      apiUsage: null,
      percentage: 40,
      totalTokens: 80000,
      rawMaxTokens: 200000,
      autoCompactThreshold: 160000,
      categories: [
        { name: 'System tools', tokens: 18000, color: 'permission', kind: 'used' as const, isDeferred: false },
        { name: 'Messages', tokens: 30000, color: 'suggestion', kind: 'used' as const, isDeferred: false },
        { name: 'Free space', tokens: 120000, color: 'inactive', kind: 'free' as const, isDeferred: false },
      ],
      gridRows: [[square('permission', true), square('inactive', false)]],
      skills: { totalSkills: 1, includedSkills: 1, tokens: 100, skillFrontmatter: [{ name: 's1', source: 'plugin' as const, tokens: 100 }] },
      mcpTools: [],
      memoryFiles: [],
      agents: [],
    },
  },
}

test('without jq the pane says to install it and still shows what /context knows', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  // The command cannot start: the call is refused.
  on('process.run', () => ({ deny: 'spawn jq ENOENT' }))
  on('session.usage', () => ({ value: USAGE }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(/jq is required/)).toBeTruthy()
  expect(await text(/brew install jq/)).toBeTruthy()
  // What /context knows needs no record: the window, where it compacts, and who takes it, in the session block.
  expect(await ui.find({ key: 'node-session' })).toBeTruthy()
  expect(await ui.find({ key: 'node-ctx' })).toBeTruthy()
  // One line above the bar: the window in use, the model, and how far auto-compact is and where.
  expect(await text(/^80\.0k \/ 200\.0k · 80\.0k to auto-compact at 160\.0k$/)).toBeTruthy()
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  await press('ctx-grid') // the box opens on the bar
  // Two waffles, what the window opened with and what came in since, each titled with its share of the window.
  expect(await text(/^Init · 9\.0% of context · 18\.0k$/)).toBeTruthy()
  // A part with a page of its own is a row to press.
  expect((await ui.find({ key: 'node-init-System tools' }))?.text).toMatch(/⛁ System tools ›\s+18\.0k\s+9\.0%/)
  // Past the trigger, the buffer auto-compact keeps, in /context's own square.
  expect(await text(/^⛝ Autocompact buffer\s+40\.0k\s+20\.0%$/)).toBeTruthy()
  expect(await text(/^Conversation · 15\.0% of context · 30\.0k$/)).toBeTruthy()
  // Without the record there are no agents, turns or events to show.
  expect(await text(/^Hooks  /)).toBeFalsy()
  expect(await text(/Event log/)).toBeFalsy()
  await ui.unmount()
})

test('the bar and the Breakdown span the window auto-compact measures against, not the model\'s', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  // The command cannot start: the call is refused.
  on('process.run', () => ({ deny: 'spawn jq ENOENT' }))
  // A 1M model whose auto-compact measures against 243k (autoCompactWindow).
  on('session.usage', () => ({ value: { ...USAGE, context: { ...USAGE.context, window: 1_000_000, breakdown: { ...USAGE.context.breakdown, rawMaxTokens: 243_000, maxTokens: 243_000, autoCompactThreshold: 210_000 } } } }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  await press('ctx-grid') // the Breakdown starts folded
  // A 1M model whose auto-compact measures against 243k: every share is of those 243k, the bar ends where they do.
  expect(await text(/^80\.0k \/ 243\.0k · 130\.0k to auto-compact at 210\.0k$/)).toBeTruthy()
  expect(await text(/^Init · 7\.4% of context · 18\.0k$/)).toBeTruthy()
  // The squares span the model's 1M: the buffer runs from the trigger to 243k, and what lies past 243k is drawn apart, never reached.
  expect(await text(/^⛝ Autocompact buffer\s+33\.0k\s+3\.3%$/)).toBeTruthy()
  expect(await text(/^· Beyond auto-compact window\s+757\.0k\s+75\.7%$/)).toBeTruthy()
  expect(await text(/Past the compaction window/)).toBeFalsy()
  await ui.unmount()
})

// A window past the one auto-compact measures against fills its bar to the same width, and never wraps onto a second line.
test('a window past auto-compact\'s fills the bar, no wider than one within it', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('process.run', () => ({ deny: 'spawn jq ENOENT' }))
  let total = 80_000
  on('session.usage', () => ({ value: { ...USAGE, context: { ...USAGE.context, window: 1_000_000, breakdown: { ...USAGE.context.breakdown, totalTokens: total, rawMaxTokens: 243_000, maxTokens: 243_000, autoCompactThreshold: 210_000, categories: USAGE.context.breakdown.categories.map((c, n) => (n === 1 ? { ...c, tokens: total - 18_000 } : c)).slice(0, 2) } } } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const bar = async () => {
    await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    // The window's bar is the one that marks where auto-compact starts.
    const got = (await ui.findAll({ type: 'Text', text: /^█[█│░▒]*┃[▒]*$/ })).map(t => [...(t.text ?? '')].length)
    await ui.unmount()
    return got
  }
  const within = await bar()
  expect(within).toHaveLength(1)
  total = 310_000
  const past = await bar()
  expect(past).toEqual(within)
})

// Reading the record takes a while: until it lands the pane draws the skeleton of its three blocks and says what it reads,
// over the light that sweeps the pane as a slow reading again does, through /context and then the record.
test('while /context and the record are read the pane shows a skeleton under a sweeping light, and then the picture', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let answer = () => {}
  const asked = new Promise<void>(r => (answer = r))
  on('session.usage', async () => {
    await asked
    return { value: USAGE }
  })
  let release = () => {}
  const gate = new Promise<void>(r => (release = r))
  on('process.run', async () => {
    await gate
    return { deny: 'spawn jq ENOENT' }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  // The bar spans the pane, 78 cells inside an 80-column body.
  const bar = async () => JSON.stringify(await ui.find({ type: 'Text', text: /^━{78}$/ }))
  const sweeps = async (line: RegExp) => {
    const frames = new Set<string>()
    for (let i = 0; i < 6; i++) {
      expect(await text(line)).toBeTruthy()
      frames.add(await bar())
      await clock.advance(120)
    }
    expect(frames.has(undefined as unknown as string)).toBe(false)
    expect(frames.size).toBeGreaterThan(2)
  }
  expect(await text(/^Session$/)).toBeTruthy()
  expect(await text(/^Event log$/)).toBeTruthy()
  expect(await ui.find({ key: 'skel-Session' })).toBeTruthy()
  // The render asks for a reading; /context has not answered, and the light moves.
  await clock.advance(0)
  await sweeps(/^Reading \/context…$/)
  for (const hue of [T.rank.working, T.actor.main, T.actor.sub, T.rank.shortest, T.rank.longest]) expect(await bar()).toContain(hue)
  // /context answers; the record is still being read, and the light keeps moving.
  answer()
  await clock.advance(120)
  await sweeps(/^Reading the session transcript…$/)
  // The reading lands: the skeleton and the light go.
  release()
  await clock.advance(120)
  expect(await text(/jq is required/)).toBeTruthy()
  expect(await ui.find({ key: 'skel-Session' })).toBeFalsy()
  expect(await text(/Reading the session transcript…/)).toBeFalsy()
  expect(await ui.find({ type: 'Text', text: /^━+$/ })).toBeFalsy()
  await ui.unmount()
})

// A count takes at most six cells (`999.9k`), and every column of counts keeps that room: a row is as wide as its head
// whatever it carries, and a total that would round up to `1000.0k` reads `1m`.
test("a count at its widest keeps its room in the waterfall, the turns, the cost table and the agent's tiles", async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [{ name: 'sid.jsonl', kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: '{}' }))
  const ask = (ts: string, pv: string) => ({ t: 'user', id: null, o: 'human', pv, ts, u: null, c: [{ k: 'text', n: 8, w: 0 }] })
  const record = [
    // Turn 1 read 899.9k and wrote 99.9k.
    ask('2026-01-01T00:00:00.000Z', 'first'),
    { t: 'assistant', id: 'm0', ts: '2026-01-01T00:00:03.000Z', u: { i: 100, o: 99_900, cr: 899_800, cw: 0 }, md: 'claude-opus-5-5', ef: 'medium', c: [{ k: 'text', n: 4, w: 0 }] },
    // Turn 2: ↑143.2k ↓11.8k, then a request that brings what the turn read to 999,960.
    ask('2026-01-01T00:01:00.000Z', 'go'),
    { t: 'assistant', id: 'm1', ts: '2026-01-01T00:01:05.000Z', u: { i: 200, o: 11_800, cr: 143_000, cw: 0 }, md: 'claude-opus-5-5', ef: 'medium', c: [{ k: 'use', id: 't1', name: 'Bash', n: 10, sk: null, pl: 0 }] },
    { t: 'user', id: null, ts: '2026-01-01T00:01:06.000Z', u: null, c: [{ k: 'res', id: 't1', n: 8, e: false }] },
    { t: 'assistant', id: 'm2', ts: '2026-01-01T00:01:09.000Z', u: { i: 10, o: 5, cr: 856_750, cw: 0 }, md: 'claude-opus-5-5', ef: 'medium', c: [{ k: 'text', n: 4, w: 0 }] },
  ]
  const ran = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => (JSON.stringify(e).includes('api-request-shape') ? ran(2, '', 'jq: error: Could not open file') : ran(0, record.map(r => JSON.stringify(r)).join('\n'))))
  on('session.usage', () => ({ value: USAGE }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 80, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  const cells = (s?: string) => [...(s ?? '')].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0)
  const io = (s?: string) => s?.match(/↑\S+\s+↓\S+/)?.[0].replace(/\s+/, ' ')
  // A top block is 2 narrower than the pane, and its border and padding take 4 more.
  const IW = 80 - 2 - 4

  await press('live')
  // The live box, a border and padding of its own inside the block: the turn's requests, newest on top, under what they all read.
  const header = await text(/^Request\s+0\s/)
  expect(io(header)).toBe('↑1m ↓11.8k')
  const rows = (await ui.findAll({ type: 'Text', text: /^\d+ \S.*█/ })).map((t: { text?: string }) => t.text)
  expect(rows.map(io)).toEqual(['↑856.8k ↓5', '↑143.2k ↓11.8k'])
  // Indented 2 under main's tiles, its edges on theirs.
  expect([header, ...rows].map(cells)).toEqual([IW - 6, IW - 6, IW - 6])

  // The cost table, inside the cost box (indented 2 in the block, a border and padding of its own) and indented 2 in it.
  await press('cost')
  const costRows = [await text(/^By model \(per request\)\s/), await text(/^opus-5-5 · main\s.*\$/), await text(/^By agent \(incl\. nested\)\s/), await text(/^main agent\s.*\$/)]
  expect([costRows[1], costRows[3]].map(io)).toEqual(['↑1.9m ↓111.7k', '↑1.9m ↓111.7k'])
  expect(costRows.map(cells)).toEqual([IW - 8, IW - 8, IW - 8, IW - 8])

  // The page of past turns: each row as wide as the head over it.
  await press('turn-history')
  const turnRows = [await text(/^Turn \(newest first\)\s/), (await ui.find({ key: 'node-turn:1' }))?.text]
  expect(io(turnRows[1])).toBe('↑899.9k ↓99.9k')
  expect(turnRows.map(cells)).toEqual([IW - 2, IW - 2])
  await press('turn-back')
  await ui.unmount()

  // A pane too narrow for four even tiles: the agent's tile of counts keeps the room of its widest, the others give it up.
  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 66 }, surface: 'terminal', viewport: { columns: 66, rows: 400 } })
  expect(JSON.stringify(await narrow.drawn()).match(/"↑ ↓".*?"(↑[^"]*)"/)?.[1]).toBe('↑1.9m ↓111.7k')
  await narrow.unmount()
})

// One model, its effort raised and lowered again, as /effort does between turns: the agent's tile carries every setting,
// its Details say a table waits inside, the event log names both switches.
test('an effort raised and lowered shows in the tile, the Details and the event log', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [{ name: 'sid.jsonl', kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: '{}' }))
  const ask = (ts: string, pv: string) => ({ t: 'user', id: null, o: 'human', pv, ts, u: null, c: [{ k: 'text', n: 8, w: 0 }] })
  const reply = (id: string, ts: string, ef: string) => ({ t: 'assistant', id, ts, u: { i: 100, o: 50, cr: 20_000, cw: 0 }, md: 'claude-opus-5-5', ef, c: [{ k: 'text', n: 4, w: 0 }] })
  const record = [
    ask('2026-01-01T00:00:00.000Z', 'first'),
    reply('m0', '2026-01-01T00:00:03.000Z', 'medium'),
    ask('2026-01-01T00:01:00.000Z', 'second'),
    reply('m1', '2026-01-01T00:01:03.000Z', 'max'),
    ask('2026-01-01T00:02:00.000Z', 'third'),
    reply('m2', '2026-01-01T00:02:03.000Z', 'medium'),
  ]
  const ran = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => (JSON.stringify(e).includes('api-request-shape') ? ran(2, '', 'jq: error: Could not open file') : ran(0, record.map(r => JSON.stringify(r)).join('\n'))))
  on('session.usage', () => ({ value: USAGE }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 100 }, surface: 'terminal', viewport: { columns: 100, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

  // The tile: every setting in order, the model named once; the line that listed them is gone.
  expect(await text(/^Model \/ Effort · 2 switches$/)).toBeTruthy()
  expect(await text(/^opus-5-5\/medium → max → medium$/)).toBeTruthy()
  expect(await text(/^\d+ switches:/)).toBeFalsy()
  // The window's box, opened, holds a row for each effort.
  await press('ctx-grid')
  expect(await text(/^Model\/effort\s*$/)).toBeTruthy()
  // The event log names both switches, the model once: it did not change.
  const switches = (await ui.findAll({ type: 'Text', text: /^⇄ / })).map((t: { text?: string }) => t.text)
  expect([...new Set(switches)]).toEqual(['⇄ opus-5-5 / max → medium', '⇄ opus-5-5 / medium → max'])
  await ui.unmount()


  // Too narrow to list them all: the setting now, and the count of switches in the title.
  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 60 }, surface: 'terminal', viewport: { columns: 60, rows: 400 } })
  const drawn = JSON.stringify(await narrow.drawn())
  expect(drawn).toMatch(/"⇄2 Model[^"]*"/)
  expect(drawn).not.toMatch(/medium → max/)
  await narrow.unmount()
})

test('a compaction starts main agent switches again: the tile and Details count from it, the event log keeps them all', async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [{ name: 'sid.jsonl', kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: '{}' }))
  const ask = (ts: string, pv: string) => ({ t: 'user', id: null, o: 'human', pv, ts, u: null, c: [{ k: 'text', n: 8, w: 0 }] })
  const reply = (id: string, ts: string, ef: string) => ({ t: 'assistant', id, ts, u: { i: 100, o: 50, cr: 20_000, cw: 0 }, md: 'claude-opus-5-5', ef, c: [{ k: 'text', n: 4, w: 0 }] })
  const record = [
    ask('2026-01-01T00:00:00.000Z', 'first'),
    reply('m0', '2026-01-01T00:00:03.000Z', 'low'),
    ask('2026-01-01T00:01:00.000Z', 'second'),
    reply('m1', '2026-01-01T00:01:03.000Z', 'max'),
    // The compaction falls inside the second turn: its request after it counts, the one before does not.
    { t: 'compact', id: null, ts: '2026-01-01T00:01:30.000Z', tr: 'manual', pre: 20_000, post: 5_000, c: [], u: null },
    reply('m2', '2026-01-01T00:02:03.000Z', 'max'),
    ask('2026-01-01T00:03:00.000Z', 'fourth'),
    reply('m3', '2026-01-01T00:03:03.000Z', 'medium'),
  ]
  const ran = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => (JSON.stringify(e).includes('api-request-shape') ? ran(2, '', 'jq: error: Could not open file') : ran(0, record.map(r => JSON.stringify(r)).join('\n'))))
  on('session.usage', () => ({ value: USAGE }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 110 } })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 110 }, surface: 'terminal', viewport: { columns: 110, rows: 400 } })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

  // One switch since: the title in full, or in short when the sequence takes the room; never cut.
  expect(await text(/^(Model \/ Effort · 1 switches|⇄1 Model \/ Effort)$/)).toBeTruthy()
  expect(await text(/^opus-5-5\/max → medium$/)).toBeTruthy()
  const switches = (await ui.findAll({ type: 'Text', text: /^⇄ / })).map((t: { text?: string }) => t.text)
  // The one before the compaction stays in the log.
  expect([...new Set(switches)]).toEqual(['⇄ opus-5-5 / max → medium', '⇄ opus-5-5 / low → max'])
  // The table holds what ran since the compaction: no low, and the max turn counted from it on.
  await $.ui.press({ plugin: 'session-lens', key: 'node-ctx-grid', requestId: 'session-lens', surface: 'terminal' })
  const rows = (await ui.findAll({ type: 'Text', text: /^\s+(medium|max|low)\s+\d/ })).map((t: { text?: string }) => (t.text ?? '').trim().split(/\s+/).slice(0, 2).join(' '))
  expect([...new Set(rows)].sort()).toEqual(['max 1.0', 'medium 1.0'])
  await ui.unmount()
})

test("right after a compaction, main's tiles count from it: the effort it ran at, the window it restarted from as sent, no calls of before", async ($, on) => {
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [{ name: 'sid.jsonl', kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: '{}' }))
  const record = [
    { t: 'user', id: null, o: 'human', pv: 'first', ts: '2026-01-01T00:00:00.000Z', u: null, c: [{ k: 'text', n: 8, w: 0 }] },
    { t: 'assistant', id: 'm0', ts: '2026-01-01T00:00:01.000Z', u: { i: 100, o: 50, cr: 20_000, cw: 0 }, md: 'claude-opus-5-5', ef: 'max', c: [{ k: 'use', id: 't-m0', name: 'Bash', n: 10, sk: null, pl: 0 }] },
    { t: 'user', id: null, ts: '2026-01-01T00:00:02.000Z', u: null, c: [{ k: 'res', id: 't-m0', n: 8, e: false }] },
    { t: 'assistant', id: 'm1', ts: '2026-01-01T00:00:03.000Z', u: { i: 100, o: 50, cr: 20_000, cw: 0 }, md: 'claude-opus-5-5', ef: 'max', c: [{ k: 'text', n: 4, w: 0 }] },
    { t: 'compact', id: null, ts: '2026-01-01T00:01:30.000Z', tr: 'manual', pre: 20_000, post: 5_000, c: [], u: null },
  ]
  const ran = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => (JSON.stringify(e).includes('api-request-shape') ? ran(2, '', 'jq: error: Could not open file') : ran(0, record.map(r => JSON.stringify(r)).join('\n'))))
  on('session.usage', () => ({ value: USAGE }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 100 }, surface: 'terminal', viewport: { columns: 100, rows: 400 } })
  const drawn = JSON.stringify(await ui.drawn())
  // No request since the compaction: the effort is still the one main ran at, and what the model wrote is the restarted window.
  expect(drawn).toMatch(/"opus-5-5 \/ max"/)
  expect(drawn).not.toMatch(/"opus-5-5 \/ —"/)
  expect(drawn).toMatch(/"↑0 ↓5\.0k"/)
  // The Bash call came before it, as did the requests.
  expect(drawn).toMatch(/"Tool Calls"[^↑]*?"0"/)
  // Room enough: inside its border each tile keeps the inset every box does.
  expect(drawn).toMatch(/"paddingX":1,"width":\d+,"flexShrink":0\},"children":\[\{"type":"Text","props":\{[^}]*\},"children":\["Shells"\]/)
  // The turn that ended before the compaction leaves the live box: a new prompt starts it again.
  expect(drawn).toMatch(/No turn yet/)
  await ui.unmount()
})

test('a /compact is seen while idle by the conversation getting shorter: nothing else moves until the next turn, and the page would keep what came before', async ($, on) => {
  const clock = mock.clock(on)
  const kept = { role: 'user' as const, text: 'summary', toolUses: [] }
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('command.run', () => ({ text: '' }))
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sid' }))
  let conversation = [kept, kept, kept]
  on('session.messages', () => ({ value: conversation }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [{ name: 'sid.jsonl', kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: '{}' }))
  const record: Record<string, unknown>[] = [
    { t: 'user', id: null, o: 'human', pv: 'first', ts: '2026-01-01T00:00:00.000Z', u: null, c: [{ k: 'text', n: 8, w: 0 }] },
    { t: 'assistant', id: 'm0', ts: '2026-01-01T00:00:01.000Z', u: { i: 100, o: 50, cr: 20_000, cw: 0 }, md: 'claude-opus-5-5', ef: 'max', c: [{ k: 'text', n: 4, w: 0 }] },
  ]
  const ran = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => (JSON.stringify(e).includes('api-request-shape') ? ran(2, '', 'jq: error: Could not open file') : ran(0, record.map(r => JSON.stringify(r)).join('\n'))))
  on('session.usage', () => ({ value: USAGE }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 100 }, surface: 'terminal', viewport: { columns: 100, rows: 400 } })
  // The turn ended: nothing moves, so the pane idles.
  await $.turn.start({ text: 'first', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/No turn yet/)
  record.push({ t: 'compact', id: null, ts: '2026-01-01T00:01:30.000Z', tr: 'manual', pre: 20_000, post: 5_000, c: [], u: null })
  // A pane in view is drawn again after each redraw it asks for, which is what keeps its tickers running.
  const seen = async (ms: number) => {
    for (let t = 0; t < ms; t += 500) {
      await clock.advance(500)
      await ui.drawn()
    }
  }
  await seen(8000)
  conversation = [kept]
  await seen(8000)
  expect(JSON.stringify(await ui.drawn())).toMatch(/No turn yet/)
  await ui.unmount()
})

test('a row of tiles keeps the inset before it spends room on the whole sequence of settings', () => {
  const tiles = [
    { label: 'Model / Effort · 1 switches', labels: ['⇄1 Model / Effort', 'Model'], value: 'opus-5-5/medium → sonnet-5-5/medium', shorter: ['sonnet-5-5 / medium'] },
    { label: 'Requests', labels: ['Reqs'], value: '84' },
  ]
  // The sequence and the other tile with its short title fit with no inset, and not with it: the inset stays, and the
  // setting now is named instead.
  const need = (pad: number) => 'opus-5-5/medium → sonnet-5-5/medium'.length + 2 + pad * 2 + 4 + 2 + pad * 2
  const fitted = fitTiles(tiles, need(0), 1, true)
  expect(fitted.pad).toBe(1)
  expect(fitted.tiles[0]?.value).toBe('sonnet-5-5 / medium')
  // Room for both, the sequence is named whole with the inset.
  const roomy = fitTiles(tiles, need(1), 1, true)
  expect([roomy.pad, roomy.tiles[0]?.value]).toEqual([1, 'opus-5-5/medium → sonnet-5-5/medium'])
})
