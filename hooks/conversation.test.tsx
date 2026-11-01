import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const line = (o: object) => JSON.stringify(o)
// Since the start: a Skill call whose expansion comes back as an injected turn, a Bash call, a reminder, a notice, an
// attachment and a deferred tool's definition.
const MAIN: object[] = [
  { t: 'user', id: null, o: 'human', pv: 'hello', ts: '2026-01-01T00:00:00.000Z', u: null, c: [{ k: 'text', n: 40, w: 0, x: 'hello there' }] },
  { t: 'assistant', id: 'm1', ts: '2026-01-01T00:00:10.000Z', u: { i: 10, o: 50, cr: 900, cw: 100 }, md: 'claude-opus-5-5', c: [{ k: 'text', n: 80, w: 0, x: 'On it' }, { k: 'use', id: 't1', name: 'Bash', n: 40, d: 'ls' }, { k: 'use', id: 't2', name: 'Skill', n: 20, sk: 'tdk' }] },
  { t: 'user', id: null, ts: '2026-01-01T00:00:11.000Z', u: null, c: [{ k: 'res', id: 't1', n: 400 }, { k: 'res', id: 't2', n: 40 }] },
  { t: 'user', id: null, meta: true, su: 't2', ts: '2026-01-01T00:00:12.000Z', u: null, c: [{ k: 'text', n: 4000, w: 0, x: 'Base directory for this skill: /x/skills/tdk' }] },
  { t: 'user', id: null, meta: true, ts: '2026-01-01T00:00:13.000Z', u: null, c: [{ k: 'text', n: 200, w: 0, x: '<system-reminder> be careful' }] },
  { t: 'user', id: null, o: 'task-notification', ts: '2026-01-01T00:00:14.000Z', u: null, c: [{ k: 'text', n: 120, w: 0, x: 'agent done' }] },
  { t: 'attachment', id: null, ts: '2026-01-01T00:00:15.000Z', n: 800, at: 'skill_listing', u: null, c: [] },
  { t: 'tooldef', id: null, h: 'h1', u: null, c: [{ k: 'tooladd', n: 400, name: 'WebFetch' }] },
  { t: 'assistant', id: 'm2', ts: '2026-01-01T00:00:20.000Z', u: { i: 10, o: 50, cr: 40000, cw: 100 }, md: 'claude-opus-5-5', c: [{ k: 'text', n: 120, w: 0, x: 'Done' }] },
]
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
const setUp = (on: On) => {
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
  on('process.run', () => ({ value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: MAIN.map(line).join('\n') } }))
  on('session.usage', () => ({ value: USAGE }))
}

test('each kind of main\'s Conversation opens a page of what it holds, by what it is, and Back is the main view', async ($, on) => {
  setUp(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 80, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const texts = async (re: RegExp) => (await ui.findAll({ type: 'Text', text: re })).map((t: { text?: string }) => t.text)

  await press('ctx-grid')
  expect((await ui.find({ key: 'node-chat:injected' }))?.text).toMatch(/^⛀ Injected \(skills · remind\S* ›/)
  // Thinking is a figure, not something the transcript lists.
  expect(await texts(/^⛀ thinking \(est\.\)/)).toHaveLength(1)

  // A skill's expansion is named by the skill its Skill call loaded; a reminder by its tag.
  await press('chat:injected')
  expect(await ui.find({ key: 'node-ctx-grid' })).toBeFalsy()
  expect(await texts(/^  (Skill|<system)/)).toEqual([expect.stringMatching(/^  Skill: tdk\s+≈1\.0k$/), expect.stringMatching(/^  <system-reminder>\s+≈50$/)])
  await press('chat-back')
  expect(await ui.find({ key: 'node-ctx-grid' })).toBeTruthy()

  // A tool's calls and results together, under the tool's name.
  await press('chat:tool')
  expect(await texts(/^  (Bash|Skill)/)).toEqual([expect.stringMatching(/^  Bash\s+≈110$/), expect.stringMatching(/^  Skill\s+≈15$/)])
  await press('chat-back')

  // Replies by how each starts; attachments by their type; a notice by who sent it; a definition by its tool.
  await press('chat:reply')
  expect(await texts(/^  (On it|Done)/)).toEqual([expect.stringMatching(/^  Done\s+≈30$/), expect.stringMatching(/^  On it\s+≈20$/)])
  await press('chat-back')
  await press('chat:attach')
  expect(await texts(/^  skill_listing/)).toEqual([expect.stringMatching(/≈200$/)])
  await press('chat-back')
  await press('chat:notice')
  expect(await texts(/^  task-notification: agent done/)).toHaveLength(1)
  await press('chat-back')
  await press('chat:toolDef')
  expect(await texts(/^  WebFetch\s+≈100$/)).toHaveLength(1)
  await press('chat-back')
  await press('chat:user')
  expect(await texts(/^  hello there\s+≈10$/)).toHaveLength(1)
})
