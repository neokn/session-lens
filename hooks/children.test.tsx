import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T00:00:10.000Z'
const T2 = '2026-01-01T00:01:00.000Z'
const PROJECT = '/home/u/.claude/projects/-work-app'
const SESSIONS = '/home/u/.claude/sessions'
const CHILDREN = '/home/u/.claude/session-lens/children/sid.jsonl'
const square = { color: 'permission', isFilled: true, categoryName: 'System tools', tokens: 1, percentage: 1, squareFullness: 1 }

// Rows as the record's filter hands them over. Opus 5.5 is $4 a million in and $20 out: main's request is $0.40, a
// child's $0.60. A child's record also holds the /cost it printed as it ended, a figure of its own process, not this one's.
const ask = (pv: string, ts = T0) => ({ t: 'user', id: null, o: 'human', pv, ts, u: null, c: [{ k: 'text', n: 8, w: 0 }] })
const bash = (id: string, mid: string) => ({ t: 'assistant', id: mid, ts: T1, md: 'claude-opus-5-5', u: { i: 100_000, o: 0, cr: 0, cw: 0 }, c: [{ k: 'use', id, name: 'Bash', n: 40, sk: null, pl: 0, d: 'claude -p' }] })
const ran = (id: string) => ({ t: 'user', id: null, ts: T2, u: null, c: [{ k: 'res', id, n: 40, e: false, r: 'ok' }] })
const MAIN = [ask('look at the log'), bash('b1', 'm1'), ran('b1')]
const childRows = (said: string) => [
  ask(said, T1),
  { t: 'assistant', id: `r-${said}`, ts: T1, md: 'claude-opus-5-5', u: { i: 100_000, o: 10_000, cr: 0, cw: 0 }, c: [{ k: 'text', n: 8, w: 0 }] },
  { t: 'cost', id: null, ts: T2, st: 0, usd: 99, u: null, c: [] },
]
const lines = (rows: object[]) => rows.map(r => JSON.stringify(r)).join('\n')
const pidFile = (pid: number, sessionId: string) => JSON.stringify({ pid, sessionId, cwd: '/work/app', kind: 'print', entrypoint: 'sdk-cli' })
// This claude is pid 100; each Bash call runs in a zsh beneath it, as the harness writes it.
const shell = (pid: number, command: string) => `  ${pid}   100 /bin/zsh -c source /tmp/snapshot.sh && eval '${command.replaceAll("'", `'"'"'`)}' \\< /dev/null && pwd -P >| /tmp/cwd`

// `alive`: the pids still running, every one asked about when not given.
type World = { files: Map<string, string>; ps: string; spawn?: 'reject'; out?: string[]; isWeighed?: boolean; heads?: string; alive?: number[] }

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>(r => (resolve = r))
  return { promise, resolve }
}

// The engine beneath the lens: files in memory, `ps` as given, and the watcher's output once `release` is called.
function engine(on: On, world: World) {
  const released = deferred()
  // Everyone waiting on the next write: two Bash calls may wait at once.
  const waiting = new Set<() => void>()
  const done = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
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
  // A path not in memory falls to the bottom of the chain, which throws as a missing file would.
  on('fs.read', (_, e, next) => {
    const text = world.files.get(e.path)
    return text === undefined ? next(e) : { value: text }
  })
  on('fs.stat', (_, e, next) => {
    const text = world.files.get(e.path)
    return text === undefined ? next(e) : { value: { kind: 'file' as const, size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.write', (_, e) => {
    world.files.set(e.path, e.text)
    for (const wake of waiting) wake()
    waiting.clear()
    return { value: undefined }
  })
  on('fs.list', (_, e) => {
    const under = [...world.files.keys()].filter(p => p.startsWith(`${e.path}/`)).map(p => p.slice(e.path.length + 1))
    const names = [...new Set(under.map(p => p.split('/')[0] ?? p))]
    return { value: names.map(name => ({ name, kind: under.includes(name) ? ('file' as const) : ('dir' as const), size: world.files.get(`${e.path}/${name}`)?.length ?? 0, mtimeMs: 0, isLink: false })) }
  })
  on('process.run', (_, e) => {
    const [cmd, , script] = e.argv
    if (cmd === 'jq' && e.argv.includes('--version')) return done('jq-1.7')
    if (cmd === 'sh' && script === 'echo $PPID') return done('100\n')
    if (cmd === 'sh' && script?.startsWith('for p;')) return done(e.argv.slice(4).filter(pid => !world.alive || world.alive.includes(Number(pid))).join('\n'))
    if (cmd === 'ps') {
      world.isWeighed = true
      return done(world.ps)
    }
    // The `claude -p` records changed lately, each with its first row's time.
    if (cmd === 'sh' && script?.startsWith('find ')) return done(world.heads ?? '')
    // The record's slicer: the whole file, from the start.
    if (cmd === 'sh' && e.argv.length >= 8) {
      const text = world.files.get(e.argv[4] ?? '')
      if (text === undefined) return done('', 2)
      return done(`${text.length} ${text.length}\n${text}\n`)
    }
    return done('', 2)
  })
  on('process.spawn', async function* () {
    if (world.spawn === 'reject') throw new Error('python3: no such file')
    await released.promise
    for (const text of world.out ?? []) yield { stream: 'stdout' as const, text }
    return { value: { code: 0, signal: null } }
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
  // Waits for the lens to write its file of children until `isDone` holds of it.
  const written = async (isDone: (text: string) => boolean) => {
    while (!isDone(world.files.get(CHILDREN) ?? '')) {
      await new Promise<void>(wake => waiting.add(wake))
    }
  }
  return { release: released.resolve, written }
}

async function open($: Engine) {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 100, rows: 400 } })
  const read = () => $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  // A child found reads the record again on its own; a reading asked for while that one runs is skipped, so it is asked again.
  const label = async (key: string) => {
    for (let n = 0; n < 5; n++) {
      await read()
      const node = await ui.find({ key: `node-${key}` })
      if (node) return JSON.stringify(node)
    }
    return undefined
  }
  // The session's total is the Cost tile's figure.
  const total = async () => (await ui.find({ type: 'Text', text: /^\$\d+\.\d\d/ }))?.text
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  return { ui, read, label, total, press }
}

const files = (extra: Record<string, string> = {}) =>
  new Map<string, string>(Object.entries({ [`${PROJECT}/sid.jsonl`]: lines(MAIN), [`${PROJECT}/kid.jsonl`]: lines(childRows('summarise the log')), ...extra }))

test('a claude -p a Bash call starts beneath this claude is drawn under main, and what it spent is in the total', async ($, on) => {
  mock.clock(on)
  const world: World = {
    files: files({ [`${SESSIONS}/300.json`]: pidFile(300, 'kid') }),
    ps: ['  100     1 claude', shell(201, 'claude -p "summarise the log"'), '  300   201 claude -p summarise the log'].join('\n'),
    out: [`${pidFile(300, 'kid')}\n`],
  }
  const { release, written } = engine(on, world)
  on('tool.call', async () => {
    release()
    await written(text => text.includes('"child":"kid"'))
    return { deny: 'ran' }
  })
  const lens = await open($)
  await $.tool.call({ tool: 'Bash', command: 'claude -p "summarise the log"', tool_use_id: 'b1' })
  expect(JSON.parse(world.files.get(CHILDREN)?.split('\n')[0] ?? '{}')).toMatchObject({ pid: 300, child: 'kid', call: 'b1' })
  // It runs: its pid file is there. Main's tree holds it, named for what it was asked.
  expect(await lens.label('ag-kid')).toMatch(/"label":"└ ▸ claude -p summarise the log.*1 requests/)
  // Main's $0.40 and the child's $0.60; the $99 its own /cost printed is another process's and stays out.
  expect(await lens.total()).toMatch(/^\$1\.00/)
  await lens.ui.unmount()
})

test('a claude that does not descend from this one is not linked', async ($, on) => {
  mock.clock(on)
  const world: World = {
    files: files({ [`${SESSIONS}/300.json`]: pidFile(300, 'kid') }),
    // Another terminal's claude -p: its parent is that terminal's shell, not a Bash call of this claude.
    ps: ['  100     1 claude', '  900     1 -zsh', '  300   900 claude -p summarise the log', shell(201, 'ls')].join('\n'),
    out: [`${pidFile(300, 'kid')}\n`],
  }
  const { release, written } = engine(on, world)
  on('tool.call', async () => {
    release()
    // The file the watcher started with is written; the child would be the second.
    await written(text => text.includes('watched'))
    for (let n = 0; n < 50 && !world.isWeighed; n++) await Promise.resolve()
    return { deny: 'ran' }
  })
  const lens = await open($)
  await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'b1' })
  await lens.read()
  expect(world.files.get(CHILDREN) ?? '').not.toContain('"child"')
  expect(await lens.ui.find({ key: 'node-ag-kid' })).toBeFalsy()
  expect(await lens.total()).toMatch(/^\$0\.40/)
  await lens.ui.unmount()
})

test('with two Bash calls running, each child goes to the call whose command its shell runs, a subagent\'s under that subagent', async ($, on) => {
  mock.clock(on)
  const SUB = [ask('check the tests'), bash('b2', 's1'), ran('b2')]
  const world: World = {
    files: files({
      [`${PROJECT}/sid/subagents/agent-ab12.jsonl`]: lines(SUB),
      [`${PROJECT}/sid/subagents/agent-ab12.meta.json`]: JSON.stringify({ agentType: 'Explore', description: 'scan the repo', toolUseId: 'x1' }),
      [`${PROJECT}/kid2.jsonl`]: lines(childRows('check the tests')),
      [`${SESSIONS}/300.json`]: pidFile(300, 'kid'),
      [`${SESSIONS}/301.json`]: pidFile(301, 'kid2'),
    }),
    ps: [
      '  100     1 claude',
      shell(201, 'claude -p "summarise the log"'),
      shell(202, "cd sub && claude -p 'check the tests'"),
      '  300   201 claude -p summarise the log',
      '  401   202 node runner.js',
      '  301   401 claude -p check the tests',
    ].join('\n'),
  }
  // The watcher's output comes in pieces that need not end at a line.
  const said = `${pidFile(301, 'kid2')}\n${pidFile(300, 'kid')}\n`
  world.out = [said.slice(0, 40), said.slice(40)]
  const { release, written } = engine(on, world)
  const bothOpen = deferred()
  let running = 0
  on('tool.call', async () => {
    running += 1
    if (running === 2) {
      bothOpen.resolve()
      release()
    }
    await bothOpen.promise
    await written(text => text.includes('"child":"kid"') && text.includes('"child":"kid2"'))
    return { deny: 'ran' }
  })
  const lens = await open($)
  await Promise.all([
    $.tool.call({ tool: 'Bash', command: 'claude -p "summarise the log"', tool_use_id: 'b1' }),
    $.tool.call({ tool: 'Bash', command: "cd sub && claude -p 'check the tests'", tool_use_id: 'b2', agentId: 'ab12' }),
  ])
  const links = (world.files.get(CHILDREN) ?? '').split('\n').filter(l => l.includes('"child"')).map(l => JSON.parse(l))
  expect(links.find(l => l.child === 'kid')?.call).toBe('b1')
  expect(links.find(l => l.child === 'kid2')?.call).toBe('b2')
  // Explore runs (no meta says it finished), and the child its Bash call started sits one level under it.
  expect(await lens.label('ag-kid2')).toMatch(/"label":"[│ ]+└ ▸ claude -p check the tests/)
  expect(await lens.label('ag-kid')).toMatch(/"label":"[├└] ▸ claude -p summarise the log/)
  // Each start is in the event log as an Agent call is, under whoever made the Bash call.
  const starts = (await lens.ui.findAll({ type: 'Text', text: /Agent → claude -p \w/ })).map(t => t.text?.replace(/\s+/g, ' '))
  expect(starts).toEqual([
    expect.stringMatching(/ main Agent → claude -p summarise the log /),
    expect.stringMatching(/ └Explore Agent → claude -p check the tests /),
  ])
  await lens.ui.unmount()
})

test('after a restart the children on disk are drawn again, their own /cost kept out of the total', async ($, on) => {
  mock.clock(on)
  // No Bash call in this process: only the file the one before wrote says the child is this session's.
  const world: World = {
    files: files({ [CHILDREN]: `${JSON.stringify({ pid: 300, child: 'kid', cwd: '/work/app', at: 1, call: 'b1' })}\n${JSON.stringify({ watched: [0, 2] })}\n` }),
    ps: '',
  }
  engine(on, world)
  const lens = await open($)
  // It ended (no pid file) after its reply: it is done, and folds with the finished agents.
  expect(await lens.label('done')).toBeTruthy()
  await lens.press('done')
  expect(await lens.label('ag-kid')).toMatch(/"label":"└ ▸ claude -p summarise the log.*1 requests/)
  expect(await lens.total()).toMatch(/^\$1\.00/)
  await lens.ui.unmount()
})

test('a child that ended before its first reply is drawn as interrupted, with no usage', async ($, on) => {
  mock.clock(on)
  const world: World = {
    files: files({
      [`${PROJECT}/kid.jsonl`]: lines([ask('summarise the log', T1)]),
      [CHILDREN]: `${JSON.stringify({ pid: 300, child: 'kid', cwd: '/work/app', at: 1, call: 'b1' })}\n`,
    }),
    ps: '',
  }
  engine(on, world)
  const lens = await open($)
  await lens.label('done')
  await lens.press('done')
  expect(await lens.label('ag-kid')).toMatch(/claude -p summari/)
  expect(JSON.stringify(await lens.ui.drawn())).toContain('✗ interrupted · usage unknown')
  expect(await lens.total()).toMatch(/^\$0\.40/)
  await lens.ui.unmount()
})

test('a child killed while it waited on its first reply: ended though its pid file stays, one request with no usage, in the log', async ($, on) => {
  mock.clock(on)
  const world: World = {
    files: files({
      [`${PROJECT}/kid.jsonl`]: lines([ask('summarise the log', T1), { t: 'sent', ts: T1, md: 'claude-haiku-5-5', c: [], u: null, id: null }]),
      [CHILDREN]: `${JSON.stringify({ pid: 300, child: 'kid', cwd: '/work/app', at: 1, call: 'b1' })}\n`,
      // Killed outright, it never removed its pid file.
      [`${SESSIONS}/300.json`]: pidFile(300, 'kid'),
    }),
    ps: '',
    alive: [],
  }
  engine(on, world)
  const lens = await open($)
  await lens.label('done')
  await lens.press('done')
  expect(await lens.label('ag-kid')).toMatch(/claude -p summari.* haiku-5-5 ✗ interrupted · usage unknown .*1 requests/)
  const drawn = JSON.stringify(await lens.ui.drawn())
  expect(drawn).toContain('✗ request on haiku-5-5 · no reply')
  expect(await lens.total()).toMatch(/^\$0\.40/)
  await lens.ui.unmount()
})

test('without the watcher, the sessions folder is listed while a Bash call runs', async ($, on) => {
  const clock = mock.clock(on)
  const world: World = {
    files: files(),
    ps: ['  100     1 claude', shell(201, 'claude -p "summarise the log"'), '  300   201 claude -p summarise the log'].join('\n'),
    spawn: 'reject',
  }
  const { written } = engine(on, world)
  on('tool.call', async () => {
    await written(text => text.includes('watched'))
    // The child starts a moment into the call: the next listing finds it.
    world.files.set(`${SESSIONS}/300.json`, pidFile(300, 'kid'))
    for (let n = 0; n < 10 && !(world.files.get(CHILDREN) ?? '').includes('"child"'); n++) await clock.advance(200)
    return { deny: 'ran' }
  })
  const lens = await open($)
  await $.tool.call({ tool: 'Bash', command: 'claude -p "summarise the log"', tool_use_id: 'b1' })
  expect(await lens.label('ag-kid')).toMatch(/"label":"└ ▸ claude -p summarise the log/)
  await lens.ui.unmount()
})

// Main's Bash call b1 runs from T1 to T2; no process of this session watched it.
const T_IN = '2026-01-01T00:00:30.000Z'

test('a claude -p record that began inside an unwatched Bash call is guessed to be its child, and drawn as a guess', async ($, on) => {
  mock.clock(on)
  const world: World = {
    files: files({ [`${PROJECT}/early.jsonl`]: lines(childRows('ran before the call')) }),
    ps: '',
    heads: `${PROJECT}/kid.jsonl\t${T_IN}\n${PROJECT}/early.jsonl\t${T0}\n${PROJECT}/sid.jsonl\t${T_IN}\n`,
  }
  engine(on, world)
  const lens = await open($)
  expect(await lens.label('done')).toBeTruthy()
  await lens.press('done')
  expect(await lens.label('ag-kid')).toMatch(/"label":"└ ▸ claude -p \(≈\) summarise the log.*1 requests/)
  expect(await lens.ui.find({ type: 'Text', text: /main\s+Agent → claude -p \(≈\) summarise the log/ })).toBeTruthy()
  // One that began before the call is no child of it.
  expect(await lens.ui.find({ key: 'node-ag-early' })).toBeFalsy()
  expect(await lens.total()).toMatch(/^\$1\.00/)
  await lens.ui.unmount()
})

test('a record that began inside the call but another session linked is not guessed to be this one\'s', async ($, on) => {
  mock.clock(on)
  const world: World = {
    files: files({ '/home/u/.claude/session-lens/children/other.jsonl': `${JSON.stringify({ pid: 300, child: 'kid', cwd: '/work/app', at: 1, call: 'x1' })}\n` }),
    ps: '',
    heads: `${PROJECT}/kid.jsonl\t${T_IN}\n`,
  }
  engine(on, world)
  const lens = await open($)
  await lens.read()
  await lens.read()
  expect(await lens.ui.find({ key: 'node-ag-kid' })).toBeFalsy()
  expect(await lens.ui.find({ key: 'node-done' })).toBeFalsy()
  expect(await lens.total()).toMatch(/^\$0\.40/)
  await lens.ui.unmount()
})

test('a Bash call a watch covered is not guessed at, though its span began after the call did', async ($, on) => {
  mock.clock(on)
  const world: World = {
    files: files({ [CHILDREN]: `${JSON.stringify({ watched: [Date.parse(T1) + 1000, Date.parse(T2) - 1000] })}\n` }),
    ps: '',
    heads: `${PROJECT}/kid.jsonl\t${T_IN}\n`,
  }
  engine(on, world)
  const lens = await open($)
  await lens.read()
  await lens.read()
  expect(await lens.ui.find({ key: 'node-done' })).toBeFalsy()
  expect(await lens.total()).toMatch(/^\$0\.40/)
  await lens.ui.unmount()
})
