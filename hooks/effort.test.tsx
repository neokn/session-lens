import { expect, mock, test } from 'claude-code/testing'
import { effortSamplesOf, effortStudyOf, samplesIn, type EffortSample } from './digest/effort'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const ask = (ts: string, pv: string) => ({ t: 'user', id: null, o: 'human', pv, ts, u: null, c: [{ k: 'text', n: 8, w: 0 }] })
const call = (id: string, ts: string, tool: string, ef: string) => ({ t: 'assistant', id, ts, u: { i: 100, o: 50, cr: 20_000, cw: 0 }, md: 'claude-opus-5-5', ef, c: [{ k: 'use', id: `t-${id}`, name: tool, n: 10, sk: null, pl: 0 }] })
const result = (id: string, ts: string) => ({ t: 'user', id: null, ts, u: null, c: [{ k: 'res', id: `t-${id}`, n: 8, e: false }] })
const reply = (id: string, ts: string, ef: string) => ({ t: 'assistant', id, ts, u: { i: 100, o: 50, cr: 20_000, cw: 0 }, md: 'claude-opus-5-5', ef, c: [{ k: 'text', n: 4, w: 0 }] })
const square = { color: 'permission', isFilled: true, categoryName: 'System tools', tokens: 1, percentage: 1, squareFullness: 1 }
const many = (effort: string, calls: number[]): EffortSample[] => calls.map(n => ({ model: 'claude-opus-5-5', effort, calls: n, steps: n + 1 }))

test("each run of an effort in main's turns is a sample; what the store holds is read back as samples alone", () => {
  const turn = { n: 1, preview: '', steps: 3, wrote: 0, read: 0, cacheRead: 0, subCount: 0, subSteps: 0, subRead: 0, subWrote: 0, ms: 1, model: 'claude-opus-5-5', effort: 'high' }
  // A turn that switched effort mid-way gives a sample for each; one with no model or no requests gives none.
  expect(effortSamplesOf([{ ...turn, runs: [{ effort: 'high', cut: 0, steps: 2, tools: 3, skills: 1, mcp: 1, thinking: 0 }, { effort: 'low', cut: 0, steps: 1, tools: 0, skills: 0, mcp: 0, thinking: 0 }] }])).toEqual([
    { model: 'claude-opus-5-5', effort: 'high', calls: 5, steps: 2 },
    { model: 'claude-opus-5-5', effort: 'low', calls: 0, steps: 1 },
  ])
  expect(effortSamplesOf([{ ...turn, calls: { steps: 3, tools: 2, skills: 0, mcp: 0, thinking: 0 } }])).toEqual([{ model: 'claude-opus-5-5', effort: 'high', calls: 2, steps: 3 }])
  expect(effortSamplesOf([{ ...turn, model: undefined, calls: { steps: 3, tools: 2, skills: 0, mcp: 0, thinking: 0 } }])).toEqual([])
  expect(samplesIn([{ model: 'm', effort: 'low', calls: 1, steps: 1 }, { model: 'm' }, 3])).toEqual([{ model: 'm', effort: 'low', calls: 1, steps: 1 }])
  expect(samplesIn('nope')).toEqual([])
})

test("a model's efforts go least to most, each its middle half and median; the verdict compares the least and the most with enough turns", () => {
  const [study] = effortStudyOf([...many('high', [6, 7, 8, 9, 10]), ...many('medium', [1, 2, 3, 4, 5])])
  expect(study?.rows.map(r => r.effort)).toEqual(['medium', 'high'])
  expect(study?.rows.map(r => [r.q1, r.median, r.q3])).toEqual([[2, 3, 4], [7, 8, 9]])
  // Calls a request: all calls over all requests.
  expect(study?.rows[0]?.perStep).toBe(15 / 20)
  expect(study?.verdict).toBe('more')
  expect(effortStudyOf([...many('low', [6, 7, 8, 9, 10]), ...many('max', [1, 2, 3, 4, 5])])[0]?.verdict).toBe('fewer')
  // Middle halves that overlap say nothing either way.
  expect(effortStudyOf([...many('low', [1, 3, 5, 7, 9]), ...many('high', [2, 4, 6, 8, 10])])[0]?.verdict).toBe('same')
  // An effort with fewer than five turns is left out of the verdict: one effort is too few to compare.
  expect(effortStudyOf([...many('low', [1, 2, 3, 4, 5]), ...many('high', [9, 9])])[0]?.verdict).toBe('few')
})

test("the effort page draws main's turns from every session the store keeps, or this one's, and the way back", async ($, on) => {
  mock.clock(on)
  const kept: Record<string, unknown> = { 'effort:other': many('high', [8, 9, 10, 11, 12]) }
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(kept) }))
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [{ name: 'sid.jsonl', kind: 'file' as const, size: record.join('\n').length, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: '{}' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        window: 200000,
        breakdown: {
          model: 'm', maxTokens: 200000, autocompactSource: 'auto' as const, isAutoCompactEnabled: true, apiUsage: null, percentage: 1, totalTokens: 30000, rawMaxTokens: 200000, autoCompactThreshold: 160000,
          categories: [{ name: 'System tools', tokens: 600, color: 'permission', kind: 'used', isDeferred: false }],
          gridRows: [[square]], mcpTools: [], memoryFiles: [], agents: [],
        },
      },
    },
  }))
  // This session: two turns at medium, one tool call each.
  let record = [
    ask('2026-01-01T00:00:00.000Z', 'first'),
    call('m0', '2026-01-01T00:00:01.000Z', 'Bash', 'medium'),
    result('m0', '2026-01-01T00:00:02.000Z'),
    reply('m1', '2026-01-01T00:00:03.000Z', 'medium'),
    ask('2026-01-01T00:01:00.000Z', 'second'),
    call('m2', '2026-01-01T00:01:01.000Z', 'Read', 'medium'),
    result('m2', '2026-01-01T00:01:02.000Z'),
    reply('m3', '2026-01-01T00:01:03.000Z', 'medium'),
  ].map(r => JSON.stringify(r))
  const ran = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    if (argv.includes('--version')) return ran(0, 'jq-1.7')
    if (argv[0] !== 'jq') return ran(2, '')
    return argv.some(a => a.includes('api-request-shape')) ? ran(2, '') : ran(0, record.join('\n'))
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 100, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

  // The session's turns are kept for the next sessions to compare against.
  expect(kept['effort:sid']).toEqual([
    { model: 'claude-opus-5-5', effort: 'medium', calls: 1, steps: 2 },
    { model: 'claude-opus-5-5', effort: 'medium', calls: 1, steps: 2 },
  ])
  // The last turn is written again as it gains calls, not only when a new turn starts.
  record = [...record.slice(0, 7), JSON.stringify(call('m4', '2026-01-01T00:01:02.500Z', 'Grep', 'medium')), JSON.stringify(result('m4', '2026-01-01T00:01:02.700Z')), record[7] ?? '']
  await $.session.measure({ changed: ['context'] } as never)
  expect((kept['effort:sid'] as EffortSample[])[1]).toEqual({ model: 'claude-opus-5-5', effort: 'medium', calls: 2, steps: 3 })
  // The table by model / effort, under Work, leads to the page; the page is no part of the main one.
  expect(await text(/^Effort vs. Tool Calls$/)).toBeFalsy()
  await press('combos')
  await press('effort')
  expect(await text(/^Effort vs. Tool Calls$/)).toBeTruthy()
  expect(await text(/main agent only · 2 sessions · 7 turns/)).toBeTruthy()
  // medium has too few turns to go by, so there is no verdict yet; each effort is a row, least first.
  expect(await text(/not enough turns yet/)).toBeTruthy()
  const rows = (await ui.findAll({ type: 'Text', text: /^ {2}(medium|high)\s/ })).map((t: { text?: string }) => (t.text ?? '').trim().split(/\s+/)[0])
  expect(rows).toEqual(['medium', 'high'])
  expect(await text(/[├┼][─┼]*[┤┼]/)).toBeTruthy()
  // This session alone: only its own effort.
  await press('effort-scope-this')
  expect(await text(/main agent only · 2 turns/)).toBeTruthy()
  expect(await text(/^ {2}high\s/)).toBeFalsy()
  await press('effort-back')
  expect(await text(/^Effort vs. Tool Calls$/)).toBeFalsy()
  await ui.unmount()
})
