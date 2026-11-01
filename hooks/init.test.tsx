import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const line = (o: object) => JSON.stringify(o)
const MAIN: object[] = [
  { t: 'user', id: null, o: 'human', pv: 'hello', ts: '2026-01-01T00:00:00.000Z', u: null, c: [{ k: 'text', n: 40, w: 0 }] },
  { t: 'assistant', id: 'm1', ts: '2026-01-01T00:00:10.000Z', u: { i: 10, o: 50, cr: 900, cw: 100 }, md: 'claude-opus-5-5', c: [{ k: 'text', n: 80, w: 0, x: 'Hi' }] },
]
// Main's system prompt carries the servers' instructions under a heading of their own, between two others.
const SYSTEM = ['You are Claude.', '# Tone', 'Be brief.', '# MCP Server Instructions', '## gh', 'Use gh for issues.', '# Environment', 'cwd: /work/app'].join('\n')
const SHAPE = { system: SYSTEM, tools: [{ name: 'Read', n: 4000 }, { name: 'Bash', n: 8000 }, { name: 'mcp__gh__issue', n: 2000 }] }
const square = { color: 'permission', isFilled: true, categoryName: 'System tools', tokens: 1, percentage: 1, squareFullness: 1 }
const used = (name: string, tokens: number) => ({ name, tokens, color: 'permission', kind: 'used' as const, isDeferred: false })
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
      percentage: 30,
      totalTokens: 60000,
      rawMaxTokens: 200000,
      autoCompactThreshold: 160000,
      categories: [
        used('System prompt', 3000),
        used('System tools', 12000),
        used('MCP tools', 2000),
        used('MCP server instructions', 400),
        used('Custom agents', 300),
        used('Memory files', 700),
        used('Skills', 1300),
        // A part this code has no page for stays a row.
        used('Mystery', 100),
        used('Messages', 30000),
        { name: 'Free space', tokens: 100000, color: 'inactive', kind: 'free' as const, isDeferred: false },
      ],
      gridRows: [[square]],
      skills: {
        totalSkills: 13,
        includedSkills: 13,
        tokens: 1300,
        // Twelve from one plugin, more than a page; one of the person's own.
        skillFrontmatter: [
          ...Array.from({ length: 12 }, (_, n) => ({ name: `p${n + 1}`, source: 'plugin' as const, pluginName: 'pstack', tokens: 10 + n })),
          { name: 'mine', source: 'userSettings' as const, tokens: 900 },
        ],
      },
      mcpTools: [
        { name: 'mcp__gh__issue', serverName: 'gh', tokens: 1200, isLoaded: true },
        { name: 'mcp__gh__pr', serverName: 'gh', tokens: 300, isLoaded: false },
        { name: 'mcp__slack__send', serverName: 'slack', tokens: 500, isLoaded: true },
      ],
      memoryFiles: [
        { path: '/work/app/CLAUDE.md', type: 'Project', tokens: 500 },
        { path: '/home/u/.claude/CLAUDE.md', type: 'User', tokens: 200 },
        { path: '/home/u/mem/MEMORY.md', type: 'AutoMem', tokens: 100 },
      ],
      agents: [{ agentType: 'reviewer', source: 'projectSettings', tokens: 300 }],
    },
  },
}

type On = Parameters<Extract<Parameters<typeof test>[1], (...args: any[]) => unknown>>[1]
const setUp = (on: On, instructions: { name: string; text: string }[] = []) => {
  mock.clock(on)
  const calls = { shape: [] as string[], memory: [] as string[], instructions: 0 }
  let memoryFails = 1
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
  // The project's memory file fails to read the first time, as a file being written would.
  const FILES: Record<string, string> = {
    '/work/app/CLAUDE.md': '# Project\nRun the validators.',
    '/home/u/.claude/CLAUDE.md': '# Me\nBe terse.',
    // An auto-memory index: each entry links the file that holds it, one of them back to the index itself.
    '/home/u/mem/MEMORY.md': '# Memory Index\n\n- [Push via MR](push.md) — master is protected\n- [Index](MEMORY.md) — itself\n- [Docs](https://example.com/a.md) — a web page',
    '/home/u/mem/push.md': '---\nname: push\n---\nOne branch, push with an MR.',
  }
  on('fs.read', (_, e) => {
    const path = Object.keys(FILES).find(p => JSON.stringify(e).includes(`"${p}"`))
    if (!path) return { deny: 'ENOENT' }
    calls.memory.push(path)
    if (path === '/work/app/CLAUDE.md' && memoryFails-- > 0) return { deny: 'EBUSY: resource busy' }
    return { value: FILES[path] ?? "" }
  })
  on('process.run', (_, e) => {
    if (JSON.stringify(e).includes('mcp_instructions_delta')) {
      calls.instructions += 1
      return { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: instructions.map(line).join('\n') } }
    }
    const isShape = JSON.stringify(e).includes('api-request-shape')
    if (isShape) calls.shape.push(JSON.stringify(e))
    return { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: (isShape ? [SHAPE] : MAIN).map(line).join('\n') } }
  })
  on('session.usage', () => ({ value: USAGE }))
  return calls
}

test('each part of main\'s Init opens a page of its own, listing what /context counts in it, and Back is the main view', async ($, on) => {
  setUp(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 80, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  const texts = async (re: RegExp) => (await ui.findAll({ type: 'Text', text: re })).map((t: { text?: string }) => t.text)

  await press('ctx-grid')
  expect((await ui.find({ key: 'node-init-Skills' }))?.text).toMatch(/⛁ Skills ›\s+1\.3k\s+0\.7%/)
  // A part with no page is a row, not a button.
  expect(await ui.find({ key: 'node-init-Mystery' })).toBeFalsy()
  expect(await text(/⛁ Mystery\s+100/)).toBeTruthy()

  // Skills, by where each came from, the largest source first; each source's own list a page at a time.
  await press('init-Skills')
  expect(await text(/^Skills  1\.3k · 0\.7% of context$/)).toBeTruthy()
  expect(await ui.find({ key: 'node-ctx-grid' })).toBeFalsy()
  const heads = await texts(/^(userSettings|plugin:pstack)  /)
  expect(heads).toEqual(['userSettings  1 skills · 900', 'plugin:pstack  12 skills · 186'])
  expect(await text(/^  p12\s+21$/)).toBeTruthy()
  expect(await text(/^  p3\s+12$/)).toBeTruthy()
  expect(await text(/^  p2\s+11$/)).toBeFalsy()
  await press('more-init-skills-plugin:pstack')
  expect(await text(/^  p1\s+10$/)).toBeTruthy()
  await press('init-back')
  expect(await ui.find({ key: 'node-init-Skills' })).toBeTruthy()
  expect(await text(/^Skills  1\.3k/)).toBeFalsy()

  // MCP tools, by server, each tool loaded or deferred.
  await press('init-MCP tools')
  expect(await texts(/^(gh|slack)  /)).toEqual(['gh  1 loaded · 1 deferred · 1.5k', 'slack  1 loaded · 0 deferred · 500'])
  expect(await text(/^  issue\s+loaded\s+1\.2k$/)).toBeTruthy()
  expect(await text(/^  pr\s+deferred\s+300$/)).toBeTruthy()
  await press('init-back')

  // Custom agents, with where each is defined.
  await press('init-Custom agents')
  expect(await text(/^  reviewer\s+projectSettings\s+300$/)).toBeTruthy()
  await press('init-back')
  await ui.unmount()
})

test('a memory file is read only when its fold opens, and a failed read is tried again', async ($, on) => {
  const calls = setUp(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 80, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

  await press('ctx-grid')
  await press('init-Memory files')
  expect((await ui.find({ key: 'node-init-mem-/work/app/CLAUDE.md' }))?.text).toMatch(/^▸ \/work\/app\/CLAUDE\.md  Project · 500$/)
  expect((await ui.find({ key: 'node-init-mem-/home/u/.claude/CLAUDE.md' }))?.text).toMatch(/User · 200$/)
  expect(await text(/Loading…|Could not read it/)).toBeFalsy()
  expect(calls.memory).toEqual([])
  await press('init-mem-/work/app/CLAUDE.md')
  expect(await text(/Could not read it: .*EBUSY/)).toBeTruthy()
  // Closing reads nothing; opened again, it is read again.
  await press('init-mem-/work/app/CLAUDE.md')
  expect(calls.memory).toEqual(['/work/app/CLAUDE.md'])
  await press('init-mem-/work/app/CLAUDE.md')
  expect(await text(/^    # Project$/)).toBeTruthy()
  expect(await text(/^    Run the validators\.$/)).toBeTruthy()
  // Once read it is kept: closed and opened, it is not read a third time.
  await press('init-mem-/work/app/CLAUDE.md')
  await press('init-mem-/work/app/CLAUDE.md')
  expect(calls.memory).toEqual(['/work/app/CLAUDE.md', '/work/app/CLAUDE.md'])
  await ui.unmount()
})

test('an entry of a memory index opens into the file it links, read as it first opens', async ($, on) => {
  const calls = setUp(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 80, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

  await press('ctx-grid')
  await press('init-Memory files')
  await press('init-mem-/home/u/mem/MEMORY.md')
  const entry = 'init-mem-/home/u/mem/MEMORY.md>/home/u/mem/push.md'
  expect((await ui.find({ key: `node-${entry}` }))?.text).toMatch(/^    ▸ Push via MR  — master is protected$/)
  // A link back to a file already open above, and one off the disk, stay lines.
  expect(await ui.find({ key: 'node-init-mem-/home/u/mem/MEMORY.md>/home/u/mem/MEMORY.md' })).toBeFalsy()
  expect(await text(/^    - \[Docs\]\(https:/)).toBeTruthy()
  expect(calls.memory).toEqual(['/home/u/mem/MEMORY.md'])
  await press(entry)
  expect(await text(/^      One branch, push with an MR\.$/)).toBeTruthy()
  expect(calls.memory).toEqual(['/home/u/mem/MEMORY.md', '/home/u/mem/push.md'])
  await ui.unmount()
})

test('each MCP server\'s instructions are read from main\'s attachments as their page opens, a fold each', async ($, on) => {
  const calls = setUp(on, [
    { name: 'slack', text: '## slack\nRead the channel topic first.' },
    { name: 'deepwiki', text: '## deepwiki\nDeepWiki answers questions\nabout a repository.' },
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 80, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

  await press('ctx-grid')
  expect(calls.instructions).toBe(0)
  await press('init-MCP server instructions')
  expect(calls.instructions).toBe(1)
  expect((await ui.find({ key: 'node-init-ins-deepwiki' }))?.text).toMatch(/^▸ deepwiki  ≈\d+ · 2 lines$/)
  expect((await ui.find({ key: 'node-init-ins-slack' }))?.text).toMatch(/^▸ slack  ≈\d+ · 1 lines$/)
  // Not the system prompt's section: the attachments are what main holds.
  expect(await text(/Use gh for issues/)).toBeFalsy()
  expect(await text(/^    DeepWiki answers questions$/)).toBeFalsy()
  await press('init-ins-deepwiki')
  expect(await text(/^    DeepWiki answers questions$/)).toBeTruthy()
  expect(await text(/^    ## deepwiki$/)).toBeFalsy()
  await press('init-back')
  await press('init-MCP server instructions')
  expect(calls.instructions).toBe(2)
  await ui.unmount()
})

test('the system prompt, the system tools and the MCP server instructions are read from the request main sent', async ($, on) => {
  const calls = setUp(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 80, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

  await press('ctx-grid')
  expect(calls.shape).toEqual([])
  // With no compaction, the shape is main's first.
  await press('init-System prompt')
  expect(calls.shape.length).toBe(1)
  expect(calls.shape[0]).toContain('"--arg","b",""')
  expect(await text(/^  You are Claude\.$/)).toBeTruthy()
  expect(await text(/^  cwd: \/work\/app$/)).toBeTruthy()
  await press('init-back')

  // The tools that are not an MCP server's, largest first.
  await press('init-System tools')
  const tools = (await ui.findAll({ type: 'Text', text: /^  (Bash|Read|mcp__)/ })).map((t: { text?: string }) => t.text?.split(/\s+/)[1])
  expect(tools).toEqual(['Bash', 'Read'])
  await press('init-back')

  // With no instructions attached, only the system prompt's section under its own heading, up to the next.
  await press('init-MCP server instructions')
  expect(await text(/^  ## gh$/)).toBeTruthy()
  expect(await text(/^  Use gh for issues\.$/)).toBeTruthy()
  expect(await text(/Be brief|cwd: /)).toBeFalsy()
  // The shape read once is kept for every page that shows it.
  expect(calls.shape.length).toBe(1)
  await ui.unmount()
})
