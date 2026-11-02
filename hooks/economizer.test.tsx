import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const ask = (ts: string, pv: string) => ({ t: 'user', id: null, o: 'human', pv, ts, u: null, c: [{ k: 'text', n: 8, w: 0 }] })
const reply = (id: string, ts: string) => ({ t: 'assistant', id, ts, u: { i: 100, o: 50, cr: 20_000, cw: 0 }, md: 'claude-opus-5-5', ef: 'medium', c: [{ k: 'text', n: 4, w: 0 }] })
const record = [ask('2026-01-01T00:00:00.000Z', 'first'), reply('m0', '2026-01-01T00:00:03.000Z')].map(r => JSON.stringify(r)).join('\n')
const square = { color: 'permission', isFilled: true, categoryName: 'System tools', tokens: 1, percentage: 1, squareFullness: 1 }
const ran = (exitCode: number, stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

const STATUS = {
  config: { toolprune_quiet_minutes: 60 },
  warnings: [],
  microskills: { profile: 'off', injected_lines: 0, sessions_folded: 0 },
  // Its raw proposal still names GivenBack, which the person gave back: `toolprune show` leaves it out.
  toolprune: { mode: 'auto', sessions: 4, prompts: 36, proposal: ['GivenBack', 'LSP', 'mcp__claude_ai_Gmail__reply', 'mcp__claude_ai_Gmail__forward'], applied: ['Monitor'] },
  loopguard: { mode: 'nudge' },
  ledger: { sessions: 4, turns: 40, overhead_tokens: 1200.5, overhead_frac: 0.004, nudges: 1, aborts: 0 },
}
const SHOW = 'sessions observed: 4 (36 prompts)\napplied (tools): Monitor\nproposed: LSP, mcp__claude_ai_Gmail__reply, mcp__claude_ai_Gmail__forward\npending: written once idle\n'

// The reading of it is not awaited by anything a test can hold, so a test gives it a moment.
const pause = () => new Promise<void>(r => (globalThis as any).setTimeout(r, 50))

// A pane whose TokenEconomizer answers as `answer` says, and every command the lens ran.
async function mounted($: any, on: any, answer: (argv: string[]) => ReturnType<typeof ran>) {
  const clock = mock.clock(on)
  const asked: string[][] = []
  const seen = { readings: 0 }
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('env.get', (_: unknown, e: unknown) => ({ value: JSON.stringify(e).includes('HOME') && !JSON.stringify(e).includes('TOKENECONOMIZER') ? '/home/u' : undefined }))
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: [{ name: 'sid.jsonl', kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false }] }))
  on('fs.read', () => ({ value: '{}' }))
  on('session.usage', () => {
    seen.readings += 1
    return {
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        window: 200000,
        breakdown: {
          model: 'm', maxTokens: 200000, autocompactSource: 'auto' as const, isAutoCompactEnabled: true, apiUsage: null, percentage: 1, totalTokens: 30000, rawMaxTokens: 200000, autoCompactThreshold: 180000,
          categories: [{ name: 'System tools', tokens: 600, color: 'permission', kind: 'used', isDeferred: false }],
          gridRows: [[square]], mcpTools: [], memoryFiles: [], agents: [],
        },
      },
    },
    }
  })
  on('process.run', (_: unknown, e: unknown) => {
    const argv = (e as { argv: string[] }).argv
    if (argv[0]?.endsWith('/bin/te')) {
      asked.push(argv)
      return answer(argv)
    }
    if (argv.includes('--version')) return ran(0, 'jq-1.7')
    if (argv[0] !== 'jq') return ran(2, '')
    return argv.some(a => a.includes('api-request-shape')) ? ran(2, '') : ran(0, record)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  await pause()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 100, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  return { ui, press, text, asked, clock, seen }
}

const answers = (status: unknown, show = SHOW) => (argv: string[]) => (argv.includes('status') ? ran(0, JSON.stringify(status)) : ran(0, show))

test('without TokenEconomizer the pane draws nothing of it', async ($, on) => {
  const { ui } = await mounted($, on, () => ran(127, ''))
  expect(await ui.find({ key: 'node-log' })).toBeTruthy()
  expect(await ui.find({ key: 'node-economizer' })).toBeFalsy()
  await ui.unmount()
})

test('its head says what it did and what is waiting; open, the tools go by where they come from', async ($, on) => {
  const { ui, press, text } = await mounted($, on, answers(STATUS))
  expect((await ui.find({ key: 'node-economizer' }))?.text).toMatch(/TokenEconomizer\s+1 tool left out · 3 tools waiting to be left out · 1 redirect/)
  expect(await text(/waiting to be left out · written by itself after 60 idle minutes here/)).toBeFalsy()
  await press('economizer')
  expect(await text(/written by itself after 60 idle minutes here/)).toBeTruthy()
  expect(await text(/Gmail\s+2$/)).toBeTruthy()
  expect(await text(/1 redirects, 0 still stuck over 40 turns/)).toBeTruthy()
  expect(await text(/≈1\.2k tokens, 0\.4% over 4 sessions/)).toBeTruthy()
  await ui.unmount()
})

test('a tool the person gave back is not counted as waiting', async ($, on) => {
  const { ui } = await mounted($, on, answers(STATUS))
  expect((await ui.find({ key: 'node-economizer' }))?.text).not.toMatch(/4 tools waiting/)
  await ui.unmount()
})

test('it says nothing when it did nothing but watch', async ($, on) => {
  const quiet = { ...STATUS, toolprune: { ...STATUS.toolprune, applied: [] }, ledger: { ...STATUS.ledger, nudges: 0 } }
  const { ui } = await mounted($, on, answers(quiet, 'proposed: -\n'))
  expect((await ui.find({ key: 'node-economizer' }))?.text).toMatch(/nothing yet · 4 sessions watched/)
  await ui.unmount()
})

test('a shape it no longer knows draws nothing, not zeros', async ($, on) => {
  const { nudges: _, ...renamed } = STATUS.ledger
  const { ui } = await mounted($, on, answers({ ...STATUS, ledger: renamed }))
  expect(await ui.find({ key: 'node-economizer' })).toBeFalsy()
  await ui.unmount()
})

test('a list without its proposed line draws nothing', async ($, on) => {
  const { ui } = await mounted($, on, answers(STATUS, 'sessions observed: 4\n'))
  expect(await ui.find({ key: 'node-economizer' })).toBeFalsy()
  await ui.unmount()
})

test('it only asks, once as the pane opens and again as the fold does', async ($, on) => {
  const { ui, press, asked } = await mounted($, on, answers(STATUS))
  const verbs = () => asked.map(a => a.slice(5).join(' '))
  expect(new Set(verbs())).toEqual(new Set(['status --json', 'toolprune show']))
  const before = asked.length
  expect(asked[0]?.slice(1, 5)).toEqual(['--cwd', '/work/app', '--host', 'claude'])
  await press('economizer')
  await pause()
  expect(asked.length).toBeGreaterThan(before)
  const opened = asked.length
  await press('economizer') // shut
  await pause()
  expect(asked.length).toBe(opened)
  expect(new Set(verbs())).toEqual(new Set(['status --json', 'toolprune show']))
  await ui.unmount()
})

test('a reading of the record that nobody asked for does not ask it again', async ($, on) => {
  const { ui, asked, clock, seen } = await mounted($, on, answers(STATUS))
  const before = asked.length
  const read = seen.readings
  // While a turn runs the record is read again every few seconds.
  await $.turn.start({ text: 'go', turnId: 't1' })
  for (let n = 0; n < 30; n++) await clock.advance(120)
  await pause()
  expect(seen.readings).toBeGreaterThan(read)
  expect(asked.length).toBe(before)
  await ui.unmount()
})

test('what it says comes in clean', async ($, on) => {
  const dirty = { ...STATUS, warnings: ['bad \x1b[31mconfig\x07'] }
  const { ui, press, text } = await mounted($, on, answers(dirty))
  await press('economizer')
  expect(await text(/^bad config$/)).toBeTruthy()
  await ui.unmount()
})
