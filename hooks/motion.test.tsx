import { expect, mock, test, type TestBody } from 'claude-code/testing'
import { T } from './views/palette'

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
  { t: 'assistant', id: 'm1', ts: '2026-01-01T00:00:05.000Z', u: { i: 10, o: 50, cr: 900, cw: 100 }, c: [{ k: 'use', id: 't1', name: 'Agent', n: 100, sk: null, pl: 40 }] },
  // Eleven more requests while the subagent runs: more than the live box shows at first.
  ...Array.from({ length: 11 }, (_, n) => ({ t: 'assistant', id: `m${n + 2}`, ts: `2026-01-01T00:00:${String(n + 6).padStart(2, '0')}.000Z`, u: { i: 10, o: 5, cr: 900, cw: 0 }, c: [{ k: 'text', n: 4, w: 0 }] })),
  // A tool's result goes back: main's next request is out, waiting for its reply.
  { t: 'user', id: null, ts: '2026-01-01T00:00:17.000Z', u: null, c: [{ k: 'res', id: 't9', n: 8, e: false }] },
]
const SUB = [{ t: 'assistant', id: 's1', ts: '2026-01-01T00:00:02.000Z', u: { i: 20, o: 5, cr: 100, cw: 0 }, c: [{ k: 'text', n: 4, w: 0 }] }]
// How many times the record's reading has asked for the session's usage.
let usageReads = 0
const entry = (name: string) => ({ name, kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false })

// The session both tests run in: main working with a subagent still running, eleven requests past the first.
async function mountLens($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], sub: object[] = SUB, main: object[] = MAIN, finished = false) {
  // The time is after the record's: its last line was written an hour ago.
  const clock = mock.clock(on, { now: Date.parse('2026-01-01T01:00:00.000Z') })
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  // After a /cd neither the root nor cwd names the folder the record is in: it is found by its id among the projects.
  on('session.root', () => ({ value: '/moved' }))
  on('session.cwd', () => ({ value: '/moved' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', (_, e) => {
    const path = JSON.stringify(e)
    if (path.includes('/projects"')) return { value: [{ ...entry('-moved'), kind: 'dir' as const }, { ...entry('-work-app'), kind: 'dir' as const }] }
    if (path.includes('/projects/-moved"')) return { value: [] }
    return { value: [entry('sid.jsonl'), entry('agent-ab12.jsonl'), entry('agent-ab12.meta.json')] }
  })
  // finished: false -> still running
  on('fs.read', () => ({ value: JSON.stringify({ agentType: 'Explore', description: 'scan', toolUseId: 't1', model: 'haiku', finished, version: '9.9.9' }) }))
  // jq fails as it does on a path that does not exist: only the folder the session started in holds the record.
  const missing = { value: { exitCode: 2, stderr: 'jq: error: Could not open file', stdout: '', isStdoutTruncated: false, isStderrTruncated: false } }
  on('process.run', (_, e) => (/\/projects\/(?!-work-app\/)/.test(JSON.stringify(e)) ? missing : {
    value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: (JSON.stringify(e).includes('agent-ab12') ? sub : main).map(line).join('\n') },
  }))
  on('session.usage', () => (usageReads++, {
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
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 120, rows: 400 } })
  return { clock, ui }
}

// Loaded again mid-turn: no turn event has come, so nothing says when main got busy but the record, whose open turn runs to now.
test('a mod loaded mid-turn counts the work from the turn in the record, not from no time at all', async ($, on) => {
  const { ui } = await mountLens($, on)
  const tile = await ui.find({ type: 'Text', text: /^\d\S* \(\d\S*\)$/ })
  // The record's turn started an hour before the clock.
  expect(tile?.text).toContain('1h00m (1h00m)')
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/\d+d\d+h/)
})

// A subagent that has not finished keeps the picture moving: its spinner turns, frame after frame.
test('while a subagent runs, its spinner turns and the picture keeps redrawing', async ($, on) => {
  const { clock, ui } = await mountLens($, on)
  await $.ui.press({ plugin: 'session-lens', key: 'node-live', requestId: 'session-lens', surface: 'terminal' })
  const drawn = async () => JSON.stringify(await ui.drawn())
  const spinner = async () => /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] running/.exec(await drawn())?.[0]
  // The request out and not yet answered is main working: its row turns like the agents', with no line of what it does above.
  const working = async () => (await ui.find({ type: 'Text', text: /^13 [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working\s+█/ }))?.text?.slice(0, 4)
  expect(await drawn()).not.toContain('awaiting reply')
  // No turn event has come since the mod loaded, yet the record shows a request out: main is working, its turn live.
  expect(await working()).toBeTruthy()
  expect(JSON.stringify(await ui.find({ key: 'node-live' }))).toContain('go')
  expect(await drawn()).not.toContain('Sending request…')

  // The running agent is in the tree under main; it does not hold the turn up, so the turn's box does not list it.
  expect(await drawn()).toContain('node-ag-ab12')
  expect(await drawn()).toContain('Explore')
  expect(await drawn()).not.toContain('Running subagents')
  const seen = new Set<string>()
  const waits = new Set<string>()
  const frames = new Set<string>()
  for (let i = 0; i < 12; i++) {
    seen.add((await spinner()) ?? '')
    waits.add((await working()) ?? '')
    frames.add(await drawn())
    await clock.advance(120)
  }
  // The spinner turned through several faces, and every frame is a new picture.
  expect(seen.size).toBeGreaterThan(3)
  expect(waits.has('')).toBe(false)
  // Four colours: the longest, the shortest, the one working and the rest. The working row has run longest of all by now,
  // so its bar ranks longest, not working; its label still says it works in the live hue.
  const row = (await ui.find({ type: 'Text', text: /^13 [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working\s+█/ }))?.children ?? []
  const colorOf = (re: RegExp) => row.find((c): c is { props: { color?: string } } => typeof c === 'object' && re.test(JSON.stringify(c)))?.props.color
  expect(colorOf(/█/)).toBe(T.rank.longest)
  expect(colorOf(/working/)).toBe(T.state.live)
  const bars = (await ui.findAll({ type: 'Text', text: /^\d+ \S.*█/ })).map((t): string[] => JSON.stringify(t).match(/#[0-9a-f]{6}/g) ?? [])
  expect(bars.filter(c => c.includes(T.rank.longest))).toHaveLength(1)
  expect(bars.filter(c => c.includes(T.rank.shortest)).length).toBeLessThanOrEqual(1)
  expect(new Set(bars.flat())).toEqual(new Set(bars.flat().filter(c => [T.rank.longest, T.rank.shortest, T.rank.working, T.actor.main].includes(c))))
  expect(waits.size).toBeGreaterThan(3)
  expect(frames.size).toBeGreaterThanOrEqual(10)

  // A pane that is gone draws nothing, so the tickers stop; opened again, they start where it draws.
  await ui.unmount()
  await clock.advance(5000)
  const again = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 120, rows: 400 } })
  const faces = new Set<string>()
  for (let i = 0; i < 12; i++) {
    faces.add(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] running/.exec(JSON.stringify(await again.drawn()))?.[0] ?? '')
    await clock.advance(120)
  }
  expect(faces.size).toBeGreaterThan(3)
  await again.unmount()
})

// The turn running now has a box of its own, one height whatever it holds.
test('the live turn keeps its box, its requests newest first, the rest folded on one lane', { timeoutMs: 20_000 }, async ($, on) => {
  const { clock, ui } = await mountLens($, on)
  await $.ui.press({ plugin: 'session-lens', key: 'node-live', requestId: 'session-lens', surface: 'terminal' })
  const drawn = async () => JSON.stringify(await ui.drawn())
  // A typed prompt is a turn from the moment it is sent, before the record holds it: the finished one leaves the live box
  // for it at once, and the count goes up.
  // On the main page the turn's waterfall reads newest first, the newest 10; the rest open on request, down to main's
  // first request, sent with the prompt at 0s though its reply came at 5s. Explore, which it launched, has no row: a
  // subagent does not hold the turn up.
  const bars = async () => (await ui.findAll({ type: 'Text', text: /^(\d+ |├ )\S.*█/ })).map(t => t.text?.slice(0, 9))
  expect((await bars()).map(b => b?.split(' ')[0])).toEqual(['13', '12', '11', '10', '9', '8', '7', '6', '5', '4'])
  // The three left out lie over one lane on the row that shows more, each in the colour its own bar has once shown.
  const colors = (node: unknown) => [...new Set(JSON.stringify(node).match(/#[0-9a-f]{6}/g))].sort()
  const stacked = await ui.find({ text: /^\+ Show 3 more · 3 not shown/ })
  expect(stacked?.text).toMatch(/^\+ Show 3 more · 3 not shown\s+█.*↑\S+\s+↓\d+$/)
  const moreKey = (stacked as { props?: { key?: string } } | undefined)?.props?.key ?? ''
  expect(moreKey).toMatch(/^node-more-reqs-\d+$/)
  await $.ui.press({ plugin: 'session-lens', key: moreKey, requestId: 'session-lens', surface: 'terminal' })
  expect((await bars()).slice(-1)).toEqual(['1 Agent  '])
  expect((await bars()).some(b => b?.startsWith('├'))).toBe(false)
  const shown = colors((await ui.findAll({ type: 'Text', text: /^(\d+ |├ )\S.*█/ })).slice(-3))
  expect(colors(stacked).length).toBeGreaterThan(0)
  expect(colors(stacked).every(c => shown.includes(c))).toBe(true)
  expect(await ui.find({ key: moreKey })).toBeFalsy()
  const liveLabel = async () => JSON.stringify(await ui.find({ key: 'node-live' }))
  const tile = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await liveLabel()).toContain('go')
  expect(await tile(/^1$/)).toBeTruthy()
  await $.turn.start({ text: 'next  one', turnId: 't2' })
  await clock.advance(120)
  expect(await liveLabel()).toContain('next one')
  expect(await liveLabel()).not.toContain('go')
  expect(await tile(/^2$/)).toBeTruthy()
  // While the turn runs the Work tile counts up with the clock: the total and the longest run, which is this one's own,
  // alike (an hour or more shows minutes only, so it takes a minute to move).
  const work = async () => (await drawn()).match(/"children":\["Work(?: \(MAX\))?"\]\},\{[^\]]*?"children":\["([^"]+)"\]/)?.[1]
  const before = await work()
  await clock.advance(60_000)
  const after = await work()
  expect([before, after]).toEqual(['1h00m (1h00m)', '1h01m (1h01m)'])
  // The new turn works from the moment it is sent: its working row runs before the record holds a request of it.
  expect(await ui.find({ type: 'Text', text: /^1 [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working\s+█/ })).toBeTruthy()
  // A turn nobody typed (a notification waking main) is no new prompt: nothing counts, and the finished one still goes,
  // its box kept, at the height it always has, for the turn to come.
  await $.turn.start({ text: '', turnId: 't3' })
  await clock.advance(120)
  expect(await liveLabel()).toContain('Starting the turn')
  expect(await liveLabel()).not.toContain('go')
  // The rows the turn's box holds: each line of a column, the rest one line each.
  type Node = { type?: string; props?: { key?: string; flexDirection?: string }; children?: (Node | string)[] }
  const boxOf = (n: Node | string | undefined): Node | undefined => {
    if (!n || typeof n === 'string') return undefined
    if ((n.children ?? []).some(c => typeof c !== 'string' && c.props?.key === 'node-live')) return n
    for (const c of n.children ?? []) {
      const hit = boxOf(c)
      if (hit) return hit
    }
    return undefined
  }
  const rowsOf = (n: Node | string): number =>
    typeof n !== 'string' && n.type === 'Box' && n.props?.flexDirection === 'column' ? (n.children ?? []).reduce((a, c) => a + rowsOf(c), 0) : 1
  const liveRows = async () => {
    const box = boxOf((await ui.drawn()) as unknown as Node)
    return box ? rowsOf(box) : 0
  }
  const empty = await liveRows()
  expect(empty).toBeGreaterThan(12)
  // The blank it keeps lies at the bottom, not between the title and what it shows.
  const texts: string[] = []
  const leaves = (n: Node | string | undefined) => (typeof n === 'string' ? n !== '' && texts.push(n) : (n?.children ?? []).forEach(leaves))
  leaves(boxOf((await ui.drawn()) as unknown as Node))
  const at = texts.indexOf('No requests yet')
  expect(at).toBeGreaterThan(0)
  expect(texts[at - 1]?.trim()).not.toBe('')
  expect(texts.slice(at + 1).every(t => t.trim() === '')).toBe(true)
  expect(await tile(/^1$/)).toBeTruthy()
  // The recorded turn started again long after it began (an effort switched mid-turn) keeps its requests in the live box.
  await clock.advance(60_000)
  await $.turn.start({ text: 'go', turnId: 't4' })
  await clock.advance(120)
  expect(await liveLabel()).toContain('go')
  expect((await bars()).length).toBeGreaterThan(0)
  // The same turn keeps all 13 it was asked to show: the box is taller than empty by the 3 rows more, the row that
  // offered them now the one that folds them back to the newest ten.
  expect(await liveRows()).toBe(empty + 3)
  const back = moreKey.replace('node-more-', 'node-fewer-')
  expect((await ui.find({ key: back }))?.text).toBe('− Show first 10 only')
  await $.ui.press({ plugin: 'session-lens', key: back, requestId: 'session-lens', surface: 'terminal' })
  expect(await ui.find({ key: back })).toBeFalsy()
  expect(await liveRows()).toBe(empty)
  await ui.unmount()
})

// A subagent's own record: the task it was handed, then requests of its own, the last still waiting for its reply.
const SUB_TASK = [
  { t: 'user', id: null, o: 'human', pv: 'scan the repo', ts: '2026-01-01T00:00:02.000Z', u: null, c: [{ k: 'text', n: 12, w: 0 }] },
  { t: 'assistant', id: 's1', ts: '2026-01-01T00:00:03.000Z', u: { i: 20, o: 5, cr: 100, cw: 0 }, c: [{ k: 'use', id: 'g1', name: 'Grep', n: 10, sk: null, pl: 0 }] },
  { t: 'user', id: null, ts: '2026-01-01T00:00:04.000Z', u: null, c: [{ k: 'res', id: 'g1', n: 8, e: false }] },
  { t: 'assistant', id: 's2', ts: '2026-01-01T00:00:06.000Z', u: { i: 20, o: 7, cr: 130, cw: 0 }, c: [{ k: 'use', id: 'r1', name: 'Read', n: 10, sk: null, pl: 0 }] },
  { t: 'user', id: null, ts: '2026-01-01T00:00:07.000Z', u: null, c: [{ k: 'res', id: 'r1', n: 8, e: false }] },
]

// The turn's timeline sits under main in the Agents block and holds main's own requests: a subagent does not hold the
// turn up, so it has no row there. Its node holds its own requests on its own clock, folded until asked for.
test('a subagent has no row in the turn, and its node keeps its own timeline', async ($, on) => {
  const { ui } = await mountLens($, on, SUB_TASK)
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key, requestId: 'session-lens', surface: 'terminal' })
  await press('node-live')
  const texts = async () => (await ui.findAll({ type: 'Text', text: /█/ })).map(t => t.text ?? '')
  // The live box is drawn once, inside the Agents block.
  expect((await ui.findAll({ key: 'node-live' })).length).toBe(1)
  // All the turn's rows shown: none is Explore's, nor one of its requests.
  const more = (await ui.find({ text: /^\+ Show \d+ more/ })) as { props?: { key?: string } } | undefined
  if (more) await press(more.props?.key ?? '')
  expect((await texts()).some(t => /^[├└] /.test(t))).toBe(false)
  expect((await texts()).some(t => /^\s*\d+ Grep/.test(t))).toBe(false)
  // The tree's line runs from main, past its tiles, its turn and its window, down to the subagent it started.
  expect(await ui.find({ type: 'Text', text: /^│\n│\n│/ })).toBeTruthy()
  // The subagent's node, opened: its timeline in a box as main's turn, titled by what it was handed, folded to one lane
  // that still turns while it waits; open, its requests newest first from its own start.
  await press('node-ag-ab12')
  const fold = await ui.find({ key: 'node-tl-ab12' })
  expect(fold?.text).toMatch(/^▸ scan the repo\s+3 requests · /)
  expect((await ui.findAll({ type: 'Text', text: /^\S \d requests · \S+\s+█/ })).length).toBe(1)
  await press('node-tl-ab12')
  expect((await ui.findAll({ type: 'Text', text: /^Request\s+0/ })).length).toBeGreaterThanOrEqual(2)
  // Its two answered requests, then the one still waiting for its reply, newest first, below main's turn.
  const own = (await texts()).filter(t => /^\s*\d+ /.test(t) && /Grep|Read|working/.test(t)).slice(-3)
  expect(own.map(t => t.trim().split(/\s+/).filter(w => !/[█⠋-⣿]/.test(w)).slice(0, 2).join(' '))).toEqual(['3 working', '2 Read', '1 Grep'])
  expect((await ui.findAll({ type: 'Text', text: /^\S \d requests · \S+\s+█/ })).length).toBe(0)
  await ui.unmount()
})

// Main starts a build in the background, and a test that ends: the build still runs, the test exited 0.
const MAIN_SHELL = [
  ...MAIN,
  { t: 'assistant', id: 'm20', ts: '2026-01-01T00:00:18.000Z', u: { i: 10, o: 5, cr: 900, cw: 0 }, c: [{ k: 'use', id: 'b1', name: 'Bash', n: 10, sk: null, pl: 0, d: 'npm run build', ds: 'Build the app' }, { k: 'use', id: 'b2', name: 'Bash', n: 10, sk: null, pl: 0, d: 'npm test', ds: null }] },
  { t: 'user', id: null, ts: '2026-01-01T00:00:19.000Z', u: null, bg: 'bk1', c: [{ k: 'res', id: 'b1', n: 8, e: false }] },
  { t: 'user', id: null, ts: '2026-01-01T00:00:19.000Z', u: null, bg: 'bk2', c: [{ k: 'res', id: 'b2', n: 8, e: false }] },
  { t: 'task', id: null, ts: '2026-01-01T00:00:30.000Z', u: null, c: [], tid: 'bk2', tu: 'b2', tst: 'completed', ec: 0 },
]

// A shell main left running is drawn like a subagent it started: under main in the Agents block, with what it runs. It
// does not hold the turn up, so the turn's timeline has no lane for it.
test('a background shell shows under the agent that started it, and not in the turn', async ($, on) => {
  const { ui } = await mountLens($, on, SUB, MAIN_SHELL)
  expect((await ui.find({ key: 'node-agents' }))?.text).toMatch(/1 running subagents · 1 running shell\b/)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  // Main's running shells sit under one Shells fold, open at first, each on one line: what it is, its command, how long.
  expect((await ui.find({ key: 'node-shells-main' }))?.text).toMatch(/^\s*▾ Shells\s+1 running$/)
  const shellLine = /^\s+\$ \S+ Build the app {2}npm run build {2}59m4\ds$/
  expect(lines.some(t => shellLine.test(t))).toBe(true)
  // The ended one is no longer listed under main.
  expect(lines.some(t => /\$ \S+ npm test/.test(t))).toBe(false)
  await $.ui.press({ plugin: 'session-lens', key: 'node-shells-main', requestId: 'session-lens', surface: 'terminal' })
  expect((await ui.find({ key: 'node-shells-main' }))?.text).toMatch(/^\s*▸ Shells/)
  expect((await ui.findAll({ type: 'Text' })).some(t => shellLine.test(t.text ?? ''))).toBe(false)
  expect(await ui.findAll({ type: 'Text', text: /^├ \$ / })).toHaveLength(0)
  // The timeline marks every shell of the session; its row opens main's, the ended one too, oldest first.
  expect(await ui.findAll({ type: 'Text', text: /^\$ \S/ })).toHaveLength(0)
  await $.ui.press({ plugin: 'session-lens', key: 'node-done', requestId: 'session-lens', surface: 'terminal' })
  const listed = (await ui.findAll({ type: 'Text', text: /^\$ \S/ })).map(t => t.text ?? '')
  expect(listed).toHaveLength(2)
  expect(listed.some(t => /npm test {2}\S+$/.test(t))).toBe(true)
  expect(listed.some(t => /^\$ Build the app {2}npm run build {2}59m4\ds$/.test(t))).toBe(true)
  await ui.unmount()
})

// A subagent that starts a shell and stops to wait for it: its meta says finished, and its shell ends in main's record.
const SUB_SHELL = [
  ...SUB_TASK,
  { t: 'assistant', id: 's3', ts: '2026-01-01T00:00:08.000Z', u: { i: 20, o: 5, cr: 150, cw: 0 }, c: [{ k: 'use', id: 'sb1', name: 'Bash', n: 10, sk: null, pl: 0, d: 'sleep 90', ds: 'Subagent sleep' }] },
  { t: 'user', id: null, ts: '2026-01-01T00:00:09.000Z', u: null, bg: 'sk1', c: [{ k: 'res', id: 'sb1', n: 8, e: false }] },
  { t: 'assistant', id: 's4', ts: '2026-01-01T00:00:10.000Z', u: { i: 20, o: 5, cr: 160, cw: 0 }, c: [{ k: 'text', n: 4, w: 0 }] },
]

test('a subagent waiting on its own shell still runs, and the shell ends when main\'s record says so', async ($, on) => {
  const { ui } = await mountLens($, on, SUB_SHELL, MAIN, true)
  expect((await ui.find({ key: 'node-agents' }))?.text).toMatch(/1 running subagents · 1 running shell\b/)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect((await ui.find({ key: 'node-shells-ab12' }))?.text).toMatch(/▾ Shells\s+1 running$/)
  expect(lines.some(t => /^\s+\$ \S+ Subagent sleep {2}sleep 90 {2}\S+$/.test(t))).toBe(true)
  // Its timeline has no request out, yet it still runs: a turning `working` row from its last reply on, to now.
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key, requestId: 'session-lens', surface: 'terminal' })
  await press('node-ag-ab12')
  if ((await ui.find({ key: 'node-tl-ab12' }))?.text?.startsWith('▸')) await press('node-tl-ab12')
  // Not complete, so its newest row, on top, is always `working`: its fifth, after the four it sent; its box is below
  // main's.
  const rows = (await ui.findAll({ type: 'Text', text: /^\s*\d+ \S.*█/ })).map(t => t.text ?? '')
  const top = rows.findLastIndex(t => /^\s*5 /.test(t))
  expect(rows[top]).toMatch(/^\s*5 \S working\s/)
  expect(rows[top + 1]).toMatch(/^\s*4 /)
  await ui.unmount()
})

test('a subagent\'s shell that main\'s record ends is no longer running, nor is the subagent that waited on it', async ($, on) => {
  // Main's own shells ended too: they are listed after the finished subagent.
  const ended = [...MAIN_SHELL, { t: 'task', id: null, ts: '2026-01-01T00:00:31.000Z', u: null, c: [], tid: 'bk1', tu: 'b1', tst: 'completed', ec: 0 }]
  const { ui } = await mountLens($, on, SUB_SHELL, [...ended, { t: 'task', id: null, ts: '2026-01-01T00:00:40.000Z', u: null, c: [], tid: 'sk1', tu: 'sb1', tst: 'completed', ec: 0 }], true)
  const head = (await ui.find({ key: 'node-agents' }))?.text ?? ''
  expect(head).toMatch(/0 running subagents/)
  expect(head).not.toMatch(/shell/)
  // Finished, the subagent opens in the timeline's row, its ended shell under it and not among main's.
  await $.ui.press({ plugin: 'session-lens', key: 'node-done', requestId: 'session-lens', surface: 'terminal' })
  expect((await ui.find({ key: 'node-shells-ab12' }))?.text).toMatch(/▾ Shells\s+1$/)
  const lines = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(lines.some(t => /^\s+\$ Subagent sleep {2}sleep 90 {2}\S+$/.test(t))).toBe(true)
  expect(lines.some(t => /^\$ Subagent sleep/.test(t))).toBe(false)
  // The finished subagents come first, main's shells after them.
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn.indexOf('Build the app')).toBeGreaterThan(drawn.indexOf('Subagent sleep'))
  await ui.unmount()
})

// Twelve shells at once: the Shells fold draws ten, and a row that shows the rest, as every list.
const MAIN_SHELLS = [
  ...MAIN,
  { t: 'assistant', id: 'm30', ts: '2026-01-01T00:00:18.000Z', u: { i: 10, o: 5, cr: 900, cw: 0 }, c: Array.from({ length: 12 }, (_, n) => ({ k: 'use', id: `x${n}`, name: 'Bash', n: 10, sk: null, pl: 0, d: `sleep ${n + 100}`, ds: null })) },
  ...Array.from({ length: 12 }, (_, n) => ({ t: 'user', id: null, ts: '2026-01-01T00:00:19.000Z', u: null, bg: `bx${n}`, c: [{ k: 'res', id: `x${n}`, n: 8, e: false }] })),
]

test('more than ten shells are paged under the Shells fold as every list', async ($, on) => {
  const { ui } = await mountLens($, on, SUB, MAIN_SHELLS)
  expect((await ui.find({ key: 'node-shells-main' }))?.text).toMatch(/12 running$/)
  const count = async () => (await ui.findAll({ type: 'Text' })).filter(t => /^\s+\$ \S+ sleep 1\d\d {2}/.test(t.text ?? '')).length
  expect(await count()).toBe(10)
  const more = (await ui.findAll({ text: /^\s*\+ Show 2 more · 2 not shown/ })) as { props?: { key?: string } }[]
  expect(more.length).toBe(1)
  await $.ui.press({ plugin: 'session-lens', key: more[0]?.props?.key ?? '', requestId: 'session-lens', surface: 'terminal' })
  expect(await count()).toBe(12)
  await ui.unmount()
})

// The live turn starts folded: its requests on one lane, its head turning while the turn runs; a press opens its waterfall.
test('the live turn starts folded to one lane of its requests', async ($, on) => {
  const { ui } = await mountLens($, on)
  const lane = /^\S \d+ requests · \S+\s+█/
  expect((await ui.findAll({ type: 'Text', text: /^Request\s+0/ })).length).toBe(0)
  expect((await ui.findAll({ type: 'Text', text: lane })).length).toBe(1)
  await $.ui.press({ plugin: 'session-lens', key: 'node-live', requestId: 'session-lens', surface: 'terminal' })
  expect((await ui.findAll({ type: 'Text', text: lane })).length).toBe(0)
  expect((await ui.findAll({ type: 'Text', text: /^Request\s+0/ })).length).toBe(1)
  await ui.unmount()
})

// With the session idle the pane's clock stops, but the version's tabs keep it running for their specimens, with no reading
// of the record for it; leaving them, it stops again.
test("the version's tabs play with the session idle, reading nothing more of the record", async ($, on) => {
  const { clock, ui } = await mountLens($, on, SUB, MAIN, true)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'end_turn' } as never)
  await clock.advance(5000)
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  await press('version')
  const fold = async () => (await ui.find({ key: 'node-atom-fold' }))?.text?.[0]
  const reads = usageReads
  const seen = new Set<string | undefined>()
  for (let n = 0; n < 6; n++) {
    seen.add(await fold())
    await clock.advance(12 * 120)
  }
  expect([...seen].sort()).toEqual(['▸', '▾'])
  expect(usageReads).toBe(reads)
  await ui.unmount()
})
