import { expect, mock, test, type TestBody } from 'claude-code/testing'
import { CHANNELS, LOADING, P, setTheme, T, tokensOf, type Theme } from './views/palette'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const line = (o: object) => JSON.stringify(o)
const square = { color: 'permission', isFilled: true, categoryName: 'System tools', tokens: 1, percentage: 1, squareFullness: 1 }
const MAIN = [
  { t: 'user', id: null, o: 'human', pv: 'go', ts: '2026-01-01T00:00:00.000Z', u: null, c: [{ k: 'text', n: 8, w: 0 }] },
  { t: 'assistant', id: 'm1', ts: '2026-01-01T00:00:05.000Z', u: { i: 10, o: 50, cr: 900, cw: 100 }, c: [{ k: 'use', id: 't1', name: 'Workflow', n: 100, sk: null, pl: 40 }] },
]
const task = (s: number) => ({ t: 'user', id: null, ts: `2026-01-01T00:00:0${s}.000Z`, u: null, c: [{ k: 'text', n: 8000, w: 0 }] })
const ZERO = { i: 0, o: 0, cr: 0, cw: 0 }
// A session limit's notice is written as a reply from `<synthetic>`, with no request behind it.
const LIMIT = (s: number) => ({ t: 'assistant', id: `x${s}`, md: '<synthetic>', ts: `2026-01-01T00:00:0${s}.000Z`, u: ZERO, c: [{ k: 'text', n: 60, w: 0 }] })
const ROWS: Record<string, object[]> = {
  // Asked once, then cut off: its one request is its init, the notice after it no request.
  w1: [task(1), { t: 'assistant', id: 's1', md: 'claude-opus-5-5', ts: '2026-01-01T00:00:02.000Z', u: { i: 20, o: 5, cr: 30000, cw: 1000 }, c: [{ k: 'text', n: 4, w: 0 }] }, LIMIT(3)],
  // Cut off before its first request: nothing from the API, only the task it was handed.
  w2: [task(1), LIMIT(2)],
}
const entry = (name: string, mtimeMs = 0) => ({ name, kind: 'file' as const, size: 100, mtimeMs, isLink: false })
const dir = (name: string) => ({ ...entry(name), kind: 'dir' as const })
const JOURNAL = [
  { type: 'launched' },
  { type: 'started', key: 'k1', agentId: 'w1' },
  { type: 'started', key: 'k2', agentId: 'w2' },
  { type: 'started', key: 'k3', agentId: 'w3' },
  { type: 'result', key: 'k3', agentId: 'w3', result: 'x'.repeat(2000) },
  // A resume starts k1 again: w1, cut off, is over.
  { type: 'started', key: 'k1', agentId: 'w4' },
]

let clock: ReturnType<typeof mock.clock>
// While set, listing the session's folders waits on it: a reading that takes a while.
let gate: Promise<void> | undefined
// The commands listed as installed, and what the pane ran: commands, the shell scripts it started, the toasts it showed.
let installed: string[] = []
// known_marketplaces.json as Claude Code writes it; none when unset.
let markets: string | undefined
let ran: { command: string; args?: string }[] = []
let scripts: string[][] = []
let toasts: string[] = []
let kept: Record<string, unknown> = {}

// One more turn after the workflow's, its prompt typed `n` hours in, answered with a line.
const turnOf = (n: number) => {
  const at = `2026-01-01T${String(n).padStart(2, '0')}:00:0`
  return [
    { t: 'user', id: null, o: 'human', pv: `turn ${n}`, ts: `${at}0.000Z`, u: null, c: [{ k: 'text', n: 8, w: 0 }] },
    { t: 'assistant', id: `m${n + 1}`, ts: `${at}5.000Z`, u: { i: 10, o: 5, cr: 900, cw: 0 }, c: [{ k: 'text', n: 4, w: 0 }] },
  ]
}

// What the terminal's COLORFGBG says, for the tests of `auto`.
let colorfgbg: string | undefined

async function mountLens([$, on]: Parameters<TestBody>, run?: { status: string; timestamp: string }, extra = 0, turns = 0, running = 0) {
  // `extra` more agents, each finished with its own result; `running` more, started and not yet back.
  const finished = Array.from({ length: extra }, (_, i) => `d${i}`)
  const going = Array.from({ length: running }, (_, i) => `g${i}`)
  const more = [...finished, ...going]
  const journal = [...JOURNAL, ...finished.flatMap(a => [{ type: 'started', key: a, agentId: a }, { type: 'result', key: a, agentId: a, result: 'ok' }]), ...going.map(a => ({ type: 'started', key: a, agentId: a }))]
  const main = [...MAIN, ...Array.from({ length: turns }, (_, i) => turnOf(i + 1)).flat()]
  clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  ran = []
  scripts = []
  toasts = []
  on('command.run', (_, e) => {
    ran.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('command.list', () => ({ value: installed.map(name => ({ name, description: '', source: 'plugin' })) }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('COLORFGBG') ? colorfgbg : JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', async (_, e) => {
    if (gate) await gate
    if (e.path.endsWith('/subagents/workflows/wf_1')) return { value: [entry('journal.jsonl', Date.parse('2026-01-01T00:10:00.000Z')), ...['w1', 'w2', 'w3', 'w4', ...more].flatMap(a => [entry(`agent-${a}.jsonl`), entry(`agent-${a}.meta.json`)])] }
    if (e.path.endsWith('/subagents/workflows')) return { value: [dir('wf_1')] }
    if (e.path.endsWith('/subagents')) return { value: [dir('workflows')] }
    if (e.path.endsWith('/sid/workflows')) return { value: run ? [entry('wf_1.json')] : [] }
    return { value: [entry('sid.jsonl')] }
  })
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value
    return { value: undefined }
  })
  on('fs.read', (_, e) => {
    if (e.path === '/home/u/.claude/plugins/known_marketplaces.json') {
      if (markets === undefined) throw new Error('ENOENT')
      return { value: markets }
    }
    if (e.path.endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ version: '9.9.9' }) }
    if (e.path.endsWith('journal.jsonl')) return { value: journal.map(line).join('\n') }
    if (e.path.endsWith('/workflows/wf_1.json')) return { value: line({ runId: 'wf_1', timestamp: run?.timestamp, script: 'x', status: run?.status }) }
    const a = /agent-(\w\d+)/.exec(e.path)?.[1] ?? '?'
    return { value: line({ agentType: 'workflow-subagent', description: `sweep:${a}`, workflowPhase: 'Sweep', spawnDepth: 1 }) }
  })
  on('process.run', (_, e) => {
    if (e.argv[0] === 'sh' && e.argv[2]?.includes('ln "')) {
      scripts.push([...e.argv])
      return { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: '' } }
    }
    const a = /agent-(\w\d+)\.jsonl/.exec(e.argv.join(' '))?.[1]
    const rows = a ? (ROWS[a] ?? [task(1), { t: 'assistant', id: `r${a}`, md: 'claude-opus-5-5', ts: '2026-01-01T00:00:02.000Z', u: { i: 20, o: 5, cr: 100, cw: 0 }, c: [{ k: 'text', n: 4, w: 0 }] }]) : main
    return { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: rows.map(line).join('\n') } }
  })
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        window: 200000,
        breakdown: {
          model: 'm', maxTokens: 200000, autocompactSource: 'auto' as const, isAutoCompactEnabled: true, apiUsage: null, percentage: 1, totalTokens: 2000, rawMaxTokens: 200000,
          categories: [{ name: 'System tools', tokens: 600, color: 'permission', kind: 'used', isDeferred: false }],
          gridRows: [[square]], mcpTools: [], memoryFiles: [], agents: [],
        },
      },
    },
  }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  return $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 120, rows: 400 } })
}

// A workflow's agents are kept in a run's folder under `subagents/workflows/`; their records never say they finished,
// the run's journal does, and a resume that starts a step again ends the agent that ran it before.
test('a workflow agent runs until the journal ends it or a resume starts its step again', async (...args) => {
  const [$] = args
  const ui = await mountLens(args)
  const drawn = async () => JSON.stringify(await ui.drawn())
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })

  // w2 has no end in the journal, w4 is k1's new start: both run. w3 has its result; w1 was started again as w4.
  expect(JSON.stringify(await ui.find({ key: 'node-agents' }))).toMatch(/"label":"▾ Agents  2 running subagents"/)
  expect(await drawn()).toContain('node-ag-w2')
  expect(await drawn()).toContain('node-ag-w4')
  await press('done')
  expect(await drawn()).toContain('node-ag-w1')
  expect(await drawn()).toContain('node-ag-w3')

  // The notice of a session limit is no request: w1 made one, and its init is that request's, not the notice's zero.
  await press('ag-w1')
  expect(await ui.find({ type: 'Text', text: /^Requests$/ })).toBeTruthy()
  await press('ctx-w1-grid')
  expect(await ui.find({ type: 'Text', text: /^Init · 1[0-9]\.\d% of context · 31\.0k$/ })).toBeTruthy()
  // w2 never sent one: its init is the task it was handed, estimated (8000 characters, ≈2.0k tokens).
  await press('ag-w2')
  await press('ctx-w2-grid')
  expect(await ui.find({ type: 'Text', text: /^Init · 1\.0% of context · ≈?2\.0k$/ })).toBeTruthy()
  await ui.unmount()
})

// A run whose own file says it is over, written after the journal's last line, has no agent still running, whatever
// the journal left open; one written before it is from an earlier pass, and the journal decides.
test('every agent of a run that is over has ended', async (...args) => {
  const ui = await mountLens(args, { status: 'completed', timestamp: '2026-01-01T00:10:01.000Z' })
  expect(JSON.stringify(await ui.find({ key: 'node-agents' }))).toMatch(/"label":"▾ Agents  0 running subagents"/)
  await ui.unmount()
})

test('a run file written before the journal does not end its agents', async (...args) => {
  const ui = await mountLens(args, { status: 'completed', timestamp: '2026-01-01T00:05:00.000Z' })
  expect(JSON.stringify(await ui.find({ key: 'node-agents' }))).toMatch(/"label":"▾ Agents  2 running subagents"/)
  await ui.unmount()
})

// A run of hundreds of agents draws its finished ones newest first, ten at first and thirty more at each asking.
test('finished agents are drawn ten at first, then thirty at a time', async (...args) => {
  const [$] = args
  const ui = await mountLens(args, undefined, 35)
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const shown = async () => (JSON.stringify(await ui.drawn()).match(/"key":"node-ag-[wd]\d+"/g) ?? []).length
  const label = async () => JSON.stringify(await ui.find({ key: 'node-more-done' }))
  await press('done')
  // 10 of the 37 finished, the 2 running beside them.
  expect(await shown()).toBe(12)
  expect(await label()).toMatch(/Show 27 more · 27 not shown/)
  await press('more-done')
  expect(await shown()).toBe(39)
  expect(await ui.find({ key: 'node-more-done' })).toBeFalsy()
  await ui.unmount()
})

// A reading /session-lens asks for while the pane still holds an earlier one: what is drawn is from before until it lands. A quick
// one passes unremarked; a slow one says so, over a light sweeping the width.
test('a slow reading again says what is shown is from before', async (...args) => {
  const [$] = args
  const ui = await mountLens(args)
  const notice = { type: 'Text', text: /^Re-reading the session transcript · what is shown is from before$/ } as const
  expect(await ui.find(notice)).toBeFalsy()
  let release = () => {}
  gate = new Promise<void>(r => (release = r))
  const asked = $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await clock.advance(120)
  expect(await ui.find(notice)).toBeFalsy()
  for (let n = 0; n < 3; n++) await clock.advance(120)
  expect(await ui.find(notice)).toBeTruthy()
  // Under it, a bar as wide as the pane: a light, its trail through the palette, and the track.
  const bar = JSON.stringify(await ui.find({ type: 'Text', text: /^━{118}$/ }))
  for (const hue of [T.rank.working, T.actor.main, T.actor.sub, T.rank.shortest, T.rank.longest]) expect(bar).toContain(hue)
  release()
  await asked
  gate = undefined
  await clock.advance(120)
  expect(await ui.find(notice)).toBeFalsy()
  await ui.unmount()
})

// Every list that unfolds draws ten at first and thirty more at each asking, a list inside a list too: the past turns,
// the event log's turns and the events in each, and the subagents an agent has running.
test('every list unfolds ten at first, then thirty at a time', async (...args) => {
  const [$] = args
  const ui = await mountLens(args, undefined, 0, 44, 12)
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const count = async (re: RegExp) => (JSON.stringify(await ui.drawn()).match(re) ?? []).length
  const label = async (key: string) => (await ui.find({ key: `node-${key}` }))?.text
  // Main's running subagents: w2, w4 and the 12 more, 10 of them drawn.
  expect(await count(/"key":"node-ag-[wg]\d+"/g)).toBe(10)
  expect(await label('more-kids-main')).toMatch(/\+ Show 4 more · 4 not shown$/)
  await press('more-kids-main')
  expect(await count(/"key":"node-ag-[wg]\d+"/g)).toBe(14)
  // Every list open past its first ten folds back to them in one press, however many pages were opened.
  expect(await label('fewer-kids-main')).toMatch(/− Show first 10 only$/)
  await press('fewer-kids-main')
  expect(await count(/"key":"node-ag-[wg]\d+"/g)).toBe(10)
  expect(await ui.find({ key: 'node-fewer-kids-main' })).toBeFalsy()
  await press('turn-history')
  expect(await count(/"key":"node-turn:\d+"/g)).toBe(10)
  expect(await label('more-turns')).toMatch(/^\+ Show 30 more · 35 not shown$/)
  await press('more-turns')
  expect(await count(/"key":"node-turn:\d+"/g)).toBe(40)
  expect(await label('more-turns')).toMatch(/^\+ Show 5 more · 5 not shown$/)
  await press('more-turns')
  expect(await count(/"key":"node-turn:\d+"/g)).toBe(45)
  expect(await ui.find({ key: 'node-more-turns' })).toBeFalsy()
  await press('fewer-turns')
  expect(await count(/"key":"node-turn:\d+"/g)).toBe(10)
  expect(await label('more-turns')).toMatch(/^\+ Show 30 more · 35 not shown$/)
  await press('turn-back')
  await press('log-all')
  expect(await count(/"key":"node-log-t-\d+(-\d+)?"/g)).toBe(10)
  expect(await label('more-log-turns')).toMatch(/^\+ Show 30 more · \d+ not shown$/)
  await press('more-log-turns')
  expect(await count(/"key":"node-log-t-\d+(-\d+)?"/g)).toBe(40)
  await press('fewer-log-turns')
  expect(await count(/"key":"node-log-t-\d+(-\d+)?"/g)).toBe(10)
  await ui.unmount()
})

// With session-report installed, a button runs its skill on this session alone, once asked again, as it costs tokens:
// the record hard-linked into a projects folder of its own beside ~/.claude/projects, the report written there too,
// not into the repository.
test('the session report runs session-report on this session alone, once confirmed', async (...args) => {
  const [$] = args
  installed = ['session-report:session-report']
  const ui = await mountLens(args)
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  expect((await ui.find({ key: 'node-report' }))?.text).toBe('▸ Generate Current Session Analysis Report')
  await press('report')
  expect(await ui.find({ type: 'Text', text: /uses tokens\.$/ })).toBeTruthy()
  // Generate and Cancel are drawn as buttons, the Button's own chrome, not as plain rows.
  type Found = { props?: { plain?: boolean } } | undefined
  expect(((await ui.find({ key: 'node-report-go' })) as Found)?.props?.plain).toBeFalsy()
  expect(((await ui.find({ key: 'node-report-cancel' })) as Found)?.props?.plain).toBeFalsy()
  expect(await ui.find({ key: 'node-report-go' })).toBeTruthy()
  await press('report-cancel')
  expect(await ui.find({ key: 'node-report-go' })).toBeFalsy()
  expect(scripts).toEqual([])
  await press('report')
  await press('report-go')
  await clock.advance(120)
  expect(await ui.find({ key: 'node-report-go' })).toBeFalsy()
  const link = scripts.find(a => a[2]?.includes('ln '))
  expect(link?.slice(4)).toEqual(['/home/u/.claude/projects/-work-app', 'sid', '/home/u/.claude/session-reports/.root/sid', '-work-app'])
  const asked = ran.filter(r => r.command === 'session-report:session-report')
  expect(asked.length).toBe(1)
  expect(asked[0]?.args).toContain('--dir /home/u/.claude/session-reports/.root/sid')
  expect(asked[0]?.args).toContain('no --since')
  expect(asked[0]?.args).toContain('into /home/u/.claude/session-reports,')
  expect(toasts.join()).toContain('runs once the session is idle')
  installed = []
  await ui.unmount()
})

test('without session-report the report button says how to install it, and runs nothing', async (...args) => {
  const [$] = args
  installed = []
  const ui = await mountLens(args)
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  expect((await ui.find({ key: 'node-report' }))?.text).toBe('▸ Generate Current Session Analysis Report')
  await press('report')
  expect(await ui.find({ type: 'Text', text: /session-report plugin, which is not installed\. Add its marketplace/ })).toBeTruthy()
  // No marketplace added: the line that adds it comes first.
  expect(await ui.find({ type: 'Text', text: '/plugin marketplace add anthropics/claude-plugins-official' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: '/plugin install session-report@claude-plugins-official' })).toBeTruthy()
  expect(await ui.find({ key: 'node-report-go' })).toBeFalsy()
  // Added under a name of its own, found by its repository: installed from it, with no line to add it.
  await press('report-cancel')
  markets = JSON.stringify({ other: { source: { source: 'github', repo: 'someone/else' } }, official: { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } } })
  await press('report')
  expect(await ui.find({ type: 'Text', text: '/plugin install session-report@official' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /marketplace add/ })).toBeFalsy()
  markets = undefined
  // Installed while the fold was shut, the plugin is found as it opens again: Generate is there.
  await press('report-cancel')
  installed = ['session-report:session-report']
  await press('report')
  expect(await ui.find({ key: 'node-report-go' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /not installed/ })).toBeFalsy()
  installed = []
  await ui.unmount()
})

// The version at the bottom left opens a page of every design token the pane draws with, each with what it means, and
// Back returns to the main page.
test('the version opens the page of design tokens', async (...args) => {
  const [$] = args
  const ui = await mountLens(args)
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  expect((await ui.find({ key: 'node-version' }))?.text).toBe('v9.9.9')
  await press('version')
  expect(await ui.find({ type: 'Text', text: 'Session lens v9.9.9 · design tokens' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^██ actor\.main\s+#[0-9a-f]{6}  the main agent/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^██ cost\.reused\s+#[0-9a-f]{6}  tokens read back from the cache/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^ ▸ shut\s+a fold, shut/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^Sample 12\.3k\s+live\s+still changing/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^ 2 indent\s+one level down/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /^ ⊞ expandAll\s+opens every fold/ })).toBeTruthy()
  await press('tokens-back')
  expect(await ui.find({ type: 'Text', text: /· design tokens$/ })).toBeFalsy()
  expect(await ui.find({ key: 'node-version' })).toBeTruthy()
  await ui.unmount()
})

// The version's page has a tab of components: the molecules and organisms, each drawn with sample figures. The atoms stay
// with the design tokens. What can move or be pressed plays through its states by itself.
test('the version page has a tab of UI components, whose specimens play', async (...args) => {
  const [$] = args
  const ui = await mountLens(args)
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const heading = (text: string | RegExp) => ui.find({ type: 'Text', text })
  const textOf = async (key: string) => (await ui.find({ key }))?.text
  const beat = () => clock.advance(12 * 120)
  await press('version')
  for (const name of ['Atoms', 'Chip', 'Fold', 'Spacer', 'Tile']) expect(await heading(name)).toBeTruthy()
  expect(await heading('Molecules')).toBeFalsy()
  const seen = new Set<string | undefined>()
  for (let n = 0; n < 2; n++) {
    seen.add((await textOf('node-atom-fold'))?.[0])
    await beat()
  }
  expect([...seen].sort()).toEqual(['▸', '▾'])
  await press('tab-components')
  expect(await heading('Session lens v9.9.9 · UI components')).toBeTruthy()
  expect(await heading(/· design tokens$/)).toBeFalsy()
  for (const name of ['Molecules', 'Tabs', 'TileRow', 'Organisms', 'Lane · Waterfall', 'LogHead · EventLogBox']) expect(await heading(name)).toBeTruthy()
  for (const name of ['Atoms', 'Templates']) expect(await heading(name)).toBeFalsy()
  // The window fills past auto-compact, and the requests arrive, on the beat.
  const windows = new Set<string | undefined>()
  const lanes = new Set<string | undefined>()
  for (let n = 0; n < 8; n++) {
    windows.add((await heading(/243\.0k · /))?.text)
    lanes.add((await heading(/^\d requests? /))?.text?.slice(0, 10))
    await beat()
  }
  expect(windows.size).toBeGreaterThan(4)
  expect([...windows].some(t => t?.includes('past auto-compact by'))).toBe(true)
  expect(lanes.size).toBeGreaterThan(2)
  await press('tab-tokens')
  expect(await heading('Session lens v9.9.9 · design tokens')).toBeTruthy()
  await press('tab-components')
  await press('components-back')
  expect(await ui.find({ key: 'node-version' })).toBeTruthy()
  await ui.unmount()
})

// Colour answers three questions on three channels, and none hides another: who (the agents' hue families) never
// shares a hue with which kind (the parts of a bill), every kind of token has its own, what runs is a hue and not a
// grey, and what needs the eye is none of them. The token page leads with the three.
test('colour keeps who, which kind and when apart, and the token page says how', async (...args) => {
  const [$] = args
  const greys: string[] = [P.muted, P.soft, P.bright]
  const actors = Object.values(T.actor)
  const costs = Object.values(T.cost)
  expect(new Set(costs).size).toBe(costs.length)
  expect(actors.filter(c => costs.includes(c))).toEqual([])
  expect(greys).not.toContain(T.state.live)
  expect([...costs, T.state.live, ...actors]).not.toContain(T.state.danger)
  expect([...actors, ...costs]).not.toContain(T.state.done)
  // Warm for what the model wrote and the longest, cool for what was sent and the shortest.
  expect(T.rank.longest).toBe(T.cost.spend)
  expect(T.rank.shortest).toBe(T.cost.fresh)
  const ui = await mountLens(args)
  await $.ui.press({ plugin: 'session-lens', key: 'node-version', requestId: 'session-lens', surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^How colour reads$/ })).toBeTruthy()
  for (const c of CHANNELS) expect(await ui.find({ type: 'Text', text: new RegExp(`${c.channel}$`) })).toBeTruthy()
  expect(await ui.find({ key: 'node-theme-classic' })).toBeFalsy()
  await ui.unmount()
})

// The samples are made as the page draws: neither tab keeps a colour of the theme it was first drawn in.
for (const tab of ['tokens', 'components']) {
  test(`the ${tab} tab draws only the theme chosen`, async (...args) => {
    const [$, on] = args
    on('config.list', () => themed('light'))
    try {
      const ui = await mountLens(args)
      await $.ui.press({ plugin: 'session-lens', key: 'node-version', requestId: 'session-lens', surface: 'terminal' })
      await $.ui.press({ plugin: 'session-lens', key: `node-tab-${tab}`, requestId: 'session-lens', surface: 'terminal' })
      expect(hexes(await ui.drawn()).filter(c => !paintedIn('light').includes(c))).toEqual([])
      await ui.unmount()
    } finally {
      setTheme('dark')
    }
  })
}

// The pane draws in the theme Claude Code's own setting comes to, or the one the option pins, and nothing of the other is
// left on it, the module's own constants included.
const themed = (value: string) => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice' as const, value, provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false }] })
const hexes = (tree: unknown) => [...new Set(JSON.stringify(tree).match(/#[0-9a-f]{6}/g))]
const paintedIn = (t: Theme) => {
  const { COLOR_TOKENS, SERIES, MODEL_SERIES, LOADING, P } = tokensOf(t)
  return [...Object.values(COLOR_TOKENS).flatMap(g => Object.values(g).map(x => x.color)), ...SERIES, ...MODEL_SERIES, LOADING.light, LOADING.head, ...LOADING.trail, LOADING.track, ...Object.values(P)]
}

for (const [setting, want] of [['light', 'light'], ['light-ansi', 'light'], ['light-daltonized', 'light'], ['dark', 'dark'], ['dark-daltonized', 'dark'], ['my-custom', 'dark']] as const) {
  test(`Claude Code's theme ${setting} draws the pane ${want}`, async (...args) => {
    const [, on] = args
    on('config.list', () => themed(setting))
    try {
      const ui = await mountLens(args)
      const drawn = hexes(await ui.drawn())
      expect(drawn.length).toBeGreaterThan(0)
      expect(drawn.filter(c => !paintedIn(want).includes(c))).toEqual([])
      expect(drawn).toContain(tokensOf(want).T.actor.main)
      await ui.unmount()
    } finally {
      setTheme('dark')
    }
  })
}

for (const [says, fgbg, want] of [
  ['a light terminal', '0;15', 'light'],
  ['a dark terminal', '15;0', 'dark'],
  ['a terminal that says nothing', undefined, 'dark'],
] as const) {
  test(`auto, with ${says}, draws the pane ${want}`, async (...args) => {
    const [, on] = args
    on('config.list', () => themed('auto'))
    colorfgbg = fgbg
    try {
      const ui = await mountLens(args)
      expect(hexes(await ui.drawn())).toContain(tokensOf(want).T.actor.main)
      await ui.unmount()
    } finally {
      colorfgbg = undefined
      setTheme('dark')
    }
  })
}

test('one button at the foot of the pane names the theme drawn and switches it, for this session alone', async (...args) => {
  const [$, on] = args
  on('config.list', () => themed('dark'))
  const press = () => $.ui.press({ plugin: 'session-lens', key: 'node-theme', requestId: 'session-lens', surface: 'terminal' })
  try {
    const ui = await mountLens(args)
    expect((await ui.find({ key: 'node-theme' }))?.text).toBe('◐ dark')
    await press()
    expect((await ui.find({ key: 'node-theme' }))?.text).toBe('◐ light')
    expect(hexes(await ui.drawn())).toContain(tokensOf('light').T.actor.main)
    expect(hexes(await ui.drawn())).not.toContain(tokensOf('dark').T.actor.main)
    // Nothing of it is kept for another session.
    expect(kept.theme).toBeUndefined()
    await press()
    expect((await ui.find({ key: 'node-theme' }))?.text).toBe('◐ dark')
    expect(hexes(await ui.drawn())).toContain(tokensOf('dark').T.actor.main)
    await ui.unmount()
  } finally {
    setTheme('dark')
  }
})

test('a theme a session switched to survives opening the pane again', async (...args) => {
  const [$, on] = args
  on('config.list', () => themed('dark'))
  try {
    const ui = await mountLens(args)
    await $.ui.press({ plugin: 'session-lens', key: 'node-theme', requestId: 'session-lens', surface: 'terminal' })
    await $.command.run({ command: 'session-lens', args: '' } as never).catch(() => undefined)
    expect((await ui.find({ key: 'node-theme' }))?.text).toBe('◐ light')
    await ui.unmount()
  } finally {
    setTheme('dark')
  }
})
