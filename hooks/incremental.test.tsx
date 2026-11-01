import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const ask = (ts: string, pv: string) => ({ t: 'user', id: null, o: 'human', pv, ts, u: null, c: [{ k: 'text', n: 8, w: 0 }] })
const reply = (id: string, ts: string) => ({ t: 'assistant', id, ts, u: { i: 100, o: 50, cr: 20_000, cw: 0 }, md: 'claude-opus-5-5', ef: 'medium', c: [{ k: 'text', n: 4, w: 0 }] })
const square = { color: 'permission', isFilled: true, categoryName: 'System tools', tokens: 1, percentage: 1, squareFullness: 1 }

// The record grows between two readings: the second asks only for the bytes after where the first stopped, and the rows
// of both stand together. A file that shrinks, or no sh at all, reads the whole record again.
test('a record read again is read from where the last reading stopped', async ($, on) => {
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
  // The record as the slicer sees it: a line is its text and a newline, a byte offset is a sum of those.
  let record = [ask('2026-01-01T00:00:00.000Z', 'first'), reply('m0', '2026-01-01T00:00:03.000Z')].map(r => JSON.stringify(r))
  const asked: number[] = []
  const ran = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    if (argv[0] === 'jq' || argv.some(a => a.includes('api-request-shape'))) return argv.includes('--version') ? ran('jq-1.7') : { value: { exitCode: 2, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }
    const from = Number(argv[5])
    asked.push(from)
    let at = 0
    const fresh: string[] = []
    for (const l of record) {
      if (at >= from) fresh.push(l)
      at += l.length + 1
    }
    return ran(`${at} ${at}\n${fresh.join('\n')}${fresh.length > 0 ? '\n' : ''}`)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 100, rows: 400 } })
  const requests = async () => (await ui.find({ type: 'Text', text: /^Requests/ }))?.text
  expect(asked).toEqual([0])
  expect(JSON.stringify(await ui.drawn())).toContain('first')

  // A turn is written to the record: the next reading starts after the two lines it already holds.
  const was = record.reduce((n, l) => n + l.length + 1, 0)
  record = [...record, JSON.stringify(ask('2026-01-01T00:01:00.000Z', 'second')), JSON.stringify(reply('m1', '2026-01-01T00:01:03.000Z'))]
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(asked).toEqual([0, was])
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('first')
  expect(drawn).toContain('second')
  expect(await requests()).toBeDefined()
  await ui.unmount()
})
