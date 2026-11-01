import { expect, mock, test } from 'claude-code/testing'

import { usdOf } from './digest/cost'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 600 }, view: {} },
} as const

const line = (o: object) => JSON.stringify(o)
const square = { color: 'permission', isFilled: true, categoryName: 'System tools', tokens: 1, percentage: 1, squareFullness: 1 }
const at = (m: number, s = 0) => `2026-01-01T00:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`
const step = { i: 10, o: 50, cr: 900, cw: 100 }
// What the harness measured for the first process: opus 20% over the record's price, fable 10% over.
const price = (md: string, ...steps: object[]) => steps.reduce<number>((n, u) => n + (usdOf({ ...(u as typeof step), md }) ?? 0), 0)
// The advisor opus asked runs at fable: the harness counts it under fable.
const ADVICE = { i: 10_000, o: 200, cr: 0, cw: 0 }
const OPUS = price('claude-opus-5-5', step) * 1.2
const FABLE = price('claude-fable-5-1', { ...step, cw: 2000 }, step, ADVICE) * 1.1
const MAIN = [
  { t: 'user', id: null, o: 'human', pv: 'first', ts: at(0), u: null, c: [{ k: 'text', n: 8, w: 0 }] },
  { t: 'assistant', id: 'm1', ts: at(0, 5), u: { ...step, ad: [{ ...ADVICE, md: 'claude-fable-5-1' }] }, md: 'claude-opus-5-5', ef: 'medium', c: [{ k: 'use', id: 't1', name: 'Bash', n: 10, sk: null, pl: 0 }] },
  { t: 'user', id: null, ts: at(0, 6), u: null, c: [{ k: 'res', id: 't1', n: 8, e: false, r: 'ok 3 files' }] },
  // /model mid-turn: the next request runs at fable, max, and starts a turn of its own.
  { t: 'assistant', id: 'm2', ts: at(1), u: { ...step, cw: 2000 }, md: 'claude-fable-5-1', ef: 'max', c: [{ k: 'use', id: 't2', name: 'mcp__gh__issue', n: 10, sk: null, pl: 0 }] },
  { t: 'user', id: null, ts: at(1, 2), u: null, c: [{ k: 'res', id: 't2', n: 8, e: false }] },
  { t: 'assistant', id: 'm3', ts: at(1, 5), u: step, md: 'claude-fable-5-1', ef: 'max', c: [{ k: 'text', n: 4, w: 0 }] },
  // The process ended: the harness wrote what it cost, by model.
  { t: 'cost', st: Date.parse(at(0)), usd: OPUS + FABLE, bm: { 'claude-opus-5-5': OPUS, 'claude-fable-5-1': FABLE }, c: [], u: null, id: null },
  // The same process written again with less: the most it reached stands.
  { t: 'cost', st: Date.parse(at(0)), usd: OPUS, bm: { 'claude-opus-5-5': OPUS }, c: [], u: null, id: null },
  { t: 'user', id: null, o: 'human', pv: 'second', ts: at(2), u: null, c: [{ k: 'text', n: 8, w: 0 }] },
  { t: 'assistant', id: 'm4', ts: at(2, 5), u: step, md: 'claude-fable-5-1', ef: 'high', c: [{ k: 'use', id: 't3', name: 'Read', n: 10, sk: null, pl: 0 }] },
  { t: 'user', id: null, ts: at(2, 6), u: null, c: [{ k: 'res', id: 't3', n: 8, e: false, r: 'export const x = 1' }] },
  // Effort alone changes mid-turn: the same turn goes on.
  { t: 'assistant', id: 'm5', ts: at(2, 9), u: step, md: 'claude-fable-5-1', ef: 'low', c: [{ k: 'text', n: 4, w: 0 }] },
  // The safeguard declined and fell back to another model.
  { t: 'fallback', ts: at(3), c: [], u: null, id: null },
  { t: 'assistant', id: 'm6', ts: at(3, 1), u: step, md: 'claude-opus-4-8', ef: 'low', c: [{ k: 'text', n: 4, w: 0 }] },
]
const entry = (name: string) => ({ name, kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false })

const missing = { value: { exitCode: 2, stderr: 'jq: error: Could not open file', stdout: '', isStdoutTruncated: false, isStderrTruncated: false } }
const usage = () => ({
  value: {
    startedAt: 0,
    rateLimits: [],
    context: {
      window: 200000,
      breakdown: {
        model: 'm', maxTokens: 200000, autocompactSource: 'auto' as const, isAutoCompactEnabled: true, apiUsage: null, percentage: 1, totalTokens: 2000, rawMaxTokens: 200000,
        categories: [{ name: 'System tools', tokens: 600, color: 'permission', kind: 'used' as const, isDeferred: false }],
        gridRows: [[square]], mcpTools: [], memoryFiles: [], agents: [],
      },
    },
  },
})

// One main agent that changes model twice and effort three times, and a process whose cost the harness wrote by model.
test('a switch of model or effort: in the event log alone, a new turn for a new model, and the figures of each setting', async ($, on) => {
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
  on('fs.list', () => ({ value: [entry('sid.jsonl')] }))
  on('fs.read', () => ({ value: '{}' }))
  on('process.run', (_, e) => (JSON.stringify(e).includes('api-request-shape') ? missing : { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: MAIN.map(line).join('\n') } }))
  on('session.usage', () => usage())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 150 } })
  // Wide enough for every setting beside the other tiles, each keeping its inset.
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 150 }, surface: 'terminal', viewport: { columns: 150, rows: 600 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  const all = async (re: RegExp) => (await ui.findAll({ type: 'Text', text: re })).map((t: { text?: string }) => t.text)

  // The total in the Cost tile: the process the harness measured, and the rest scaled model by model. Half a gap under
  // half a cent is no ± to show.
  expect(await text(/^\$0\.17$/)).toBeTruthy()
  expect(await text(/calibrat/)).toBeFalsy()

  // The event log names each switch and nothing else: no figures. A fallback says the safeguard made it.
  const switches = (await all(/⇄/)).filter((t): t is string => /^#\d/.test(t ?? ''))
  expect([...new Set(switches)].map(t => t.replace(/\s+/g, ' ').replace(/ \d\d:\d\d:\d\d /, ' '))).toEqual([
    '#4 main ⇄ fable-5-1 / low → opus-4-8 / low (safeguard fallback) - -',
    '#3 main ⇄ fable-5-1 / high → low - -',
    '#3 main ⇄ fable-5-1 / max → high - -',
    '#2 main ⇄ opus-5-5 / medium → fable-5-1 / max - -',
  ])

  // Under main in the cost detail, a row for each run of one model, and what the new model paid to write the cache again.
  await press('cost')
  expect(await text(/^  opus-5-5 \d\d:\d\d–\d\d:\d\d\s+1\s/)).toBeTruthy()
  expect(await text(/^  fable-5-1 \d\d:\d\d–\d\d:\d\d\s+4\s/)).toBeTruthy()
  expect(await text(/^  opus-4-8 \d\d:\d\d–\s+1\s/)).toBeTruthy()
  expect(await text(/^    incl\. cache rewrite\s+2\.0k  \$0\.0\d$/)).toBeTruthy()

  // The agent's tile: every setting it ran at, in order, the model named only where it changed; no line of its own.
  expect(await text(/^Model \/ Effort · 4 switches$/)).toBeTruthy()
  expect(await text(/^opus-5-5\/medium → fable-5-1\/max → high → low → opus-4-8\/low$/)).toBeTruthy()
  expect(await text(/^4 switches:/)).toBeFalsy()
  // Its window's box opens on the figures per turn of each setting, model then effort; an effort switched mid-turn takes its requests' share of the turn.
  await press('ctx-grid')
  expect(await text(/^By model \/ effort\s*$/)).toBeTruthy()
  const rows = (await all(/^\s+(medium|max|high|low)\s+\d/)).map(t => (t ?? '').trim().split(/\s+/))
  expect([...new Set(rows.map(r => r.join(' ')))]).toEqual(['medium 1.0 1.0 0.0 0.0 1.0 0', 'max 2.0 0.0 0.0 1.0 1.0 0', 'high 1.0 1.0 0.0 0.0 1.0 0', 'low 1.0 0.0 0.0 0.0 0.0 0'])
  expect(await text(/for reference only/)).toBeFalsy()

  // A new model mid-turn starts a turn of its own, titled by what its first request was sent with; a new effort does not.
  await press('turn-history')
  const label = async (n: number) => (await ui.find({ key: `node-turn:${n}` }))?.text?.replace(/\s{2,}\d.*$/, '')
  expect(await label(1)).toBe('▸ #1「first」')
  expect(await label(2)).toBe('▸ #2「Bash → ok 3 files」  ⇄ fable-5-1/max')
  expect(await label(3)).toBe('▸ #3「second」  ⇄ fable-5-1/high')
  expect(await label(4)).toBe('▸ #4「Read → export const x = 1」  ⇄ opus-4-8/low')
  await ui.unmount()
})

// One model and one effort throughout: nothing about switching shows.
test('an agent that never switched shows no switch, no runs of a model and no table of settings', async ($, on) => {
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
  on('fs.list', () => ({ value: [entry('sid.jsonl')] }))
  on('fs.read', () => ({ value: '{}' }))
  const steady = MAIN.filter(r => !('md' in r) || r.md === 'claude-opus-5-5').filter(r => r.t !== 'fallback')
  on('process.run', (_, e) => (JSON.stringify(e).includes('api-request-shape') ? missing : { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: steady.map(line).join('\n') } }))
  on('session.usage', () => usage())
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 120, rows: 600 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const drawn = async () => JSON.stringify(await ui.drawn())
  await press('cost')
  await press('ctx-grid')
  expect(await drawn()).not.toContain('⇄')
  expect(await drawn()).not.toContain('switches')
  expect(await drawn()).not.toContain('cache rewrite')
  expect(await drawn()).not.toContain('By model / effort')
  expect(await ui.find({ type: 'Text', text: /^opus-5-5 \/ medium$/ })).toBeTruthy()
  await ui.unmount()
  const tile = async (columns: number) => {
    const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: columns }, surface: 'terminal', viewport: { columns, rows: 600 } })
    const shown = (await narrow.find({ type: 'Text', text: /^opus-?5-?5 \/ / }))?.text
    await narrow.unmount()
    return shown
  }
  // Too narrow for the whole, both shorten at once: the model without its dashes, the effort in two letters.
  expect(await tile(60)).toBe('opus55 / md')
})

// Each reading of what /cost counted is kept, the latest of each count by each process; one about the window alone is not.
test('what /cost measures is kept for the session, the latest of each count by each process', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // The count /cost runs from the session's launch, until a /login starts another.
  let since = 1000
  on('session.usage', () => ({ value: { ...usage().value, startedAt: since } }))
  type Kept = { start: number; proc: number; at: number; usd: number }
  // Another process's reading stays; one written before readings named their process is dropped.
  const other: Kept = { start: 1000, proc: 1, at: 2, usd: 3 }
  const kept: Record<string, unknown> = { 'ledger:sid': [other, { start: 1000, at: 2, usd: 3 }] }
  const writes: unknown[] = []
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value
    writes.push(e.value)
    return { value: undefined }
  })
  const before = clock.now()
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.session.measure({ ...usage().value, changed: ['context'], cost: { usd: 0.4 } })
  expect(writes).toEqual([])
  await $.session.measure({ ...usage().value, changed: ['cost'], cost: { usd: 0.5 } })
  await $.session.measure({ ...usage().value, changed: ['cost', 'context'], cost: { usd: 0.75 } })
  // After a /login the count before stays as this process last read it, beside the new one.
  since = 5000
  await $.session.measure({ ...usage().value, changed: ['cost'], cost: { usd: 0.1 } })
  expect(writes.length).toBe(3)
  const [first, mine, again, ...rest] = kept['ledger:sid'] as Kept[]
  expect(first).toEqual(other)
  expect(rest).toEqual([])
  expect(mine?.start).toBe(1000)
  expect(mine?.usd).toBe(0.75)
  expect(mine!.proc).toBeGreaterThanOrEqual(before)
  expect(mine!.at).toBeGreaterThanOrEqual(mine!.proc)
  expect(again).toEqual({ start: 5000, proc: mine!.proc, at: again!.at, usd: 0.1 })
})
