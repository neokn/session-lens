import { expect, mock, test, type TestBody } from 'claude-code/testing'
import { clean, cleaned, parsed } from './digest/text'
import { parseChildren } from './record/children'
import { cut, fit, left, width } from './views/layout'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const ESC = '\u001b'
const RED = `${ESC}[31mred${ESC}[0m`
const TITLE = `${ESC}]0;owned\u0007`
// What the record holds of a person's or a tool's text: a colour, a terminal title, a stray escape and a bell.
const dirty = (word: string) => `${RED} ${TITLE}${word}${ESC}!\u0007`
const clear = (word: string) => `red ${word}!`

const line = (o: object) => JSON.stringify(o)
const square = { color: 'permission', isFilled: true, categoryName: 'System tools', tokens: 1, percentage: 1, squareFullness: 1 }
const TS = '2026-01-01T00:00:06.000Z'
const MAIN = [
  { t: 'user', id: null, o: 'human', pv: dirty('asked'), ts: '2026-01-01T00:00:00.000Z', u: null, c: [{ k: 'text', n: 8, w: 0 }] },
  { t: 'assistant', id: 'm1', ts: '2026-01-01T00:00:05.000Z', u: { i: 10, o: 50, cr: 900, cw: 100 }, c: [{ k: 'use', id: 't1', name: 'Read', n: 100, sk: null, pl: 0, d: dirty('given') }, { k: 'use', id: 't2', name: 'Agent', n: 100, sk: null, pl: 40, d: 'scan' }] },
  { t: 'user', id: null, ts: TS, u: null, c: [{ k: 'res', id: 't1', n: 8, e: false, r: dirty('back') }] },
  { t: 'assistant', id: 'm2', ts: '2026-01-01T00:00:07.000Z', u: { i: 10, o: 50, cr: 900, cw: 100 }, c: [{ k: 'text', n: 4, w: 0, x: dirty('replied') }] },
  { t: 'compact', id: null, ts: '2026-01-01T00:00:08.000Z', tr: 'manual', pre: 52000, post: 12000, bu: 'b2', pu: ['k1'], c: [], u: null },
]
const SUB = [{ t: 'assistant', id: 's1', ts: '2026-01-01T00:00:02.000Z', u: { i: 20, o: 5, cr: 100, cw: 0 }, c: [{ k: 'text', n: 4, w: 0 }] }]
const SHAPE = { system: `# Tone\n${dirty('system')}\n# MCP Server Instructions\n## gh\nUse gh.`, tools: [{ name: `Re${ESC}[31mad`, n: 4000 }] }
const RESTART = [
  { k: 'keep', u: 'k1', role: 'user', text: dirty('kept') },
  { k: 'summary', text: `Summary:\n1. Primary Request:\n   ${dirty('summed')}\n` },
  { k: 'file', p: `src/${ESC}[31mread.ts` },
  { k: 'skills', names: [`td${ESC}[31md`] },
  { k: 'fixed', name: `fix${ESC}[31med`, n: 400 },
]
const PROMPT = [{ meta: false, text: dirty('task') }]
const META = { agentType: `Exp${ESC}[31mlore`, description: dirty('scan'), toolUseId: 't2', model: 'haiku', finished: false, version: '9.9.9' }
const FILES: Record<string, string> = {
  '/home/u/CLAUDE.md': `${dirty('memory')}\r\n\tindented\r\nlast`,
}
const USAGE = {
  startedAt: 0,
  rateLimits: [],
  context: {
    window: 200000,
    breakdown: {
      model: 'm', maxTokens: 200000, autocompactSource: 'auto' as const, isAutoCompactEnabled: true, apiUsage: null, percentage: 1, totalTokens: 2000, rawMaxTokens: 200000,
      categories: [{ name: 'System prompt', tokens: 600, color: 'permission', kind: 'used' as const, isDeferred: false }, { name: 'Memory files', tokens: 100, color: 'permission', kind: 'used' as const, isDeferred: false }, { name: 'MCP server instructions', tokens: 100, color: 'permission', kind: 'used' as const, isDeferred: false }, { name: 'Skills', tokens: 100, color: 'permission', kind: 'used' as const, isDeferred: false }],
      gridRows: [[square]],
      skills: { totalSkills: 1, includedSkills: 1, tokens: 100, skillFrontmatter: [{ name: `min${ESC}[31me`, source: 'userSettings' as const, tokens: 100 }] },
      mcpTools: [],
      memoryFiles: [{ path: '/home/u/CLAUDE.md', type: 'User', tokens: 100 }],
      agents: [],
    },
  },
}

type Options = { names?: string[]; files?: Record<string, string>; isSliced?: boolean; fails?: string; shapeFails?: string; main?: object[] }
// `isSliced`: the shell and its slices are there, so the record is read from where it stopped. `fails` and `shapeFails`: what
// a read of the record, or of main's system prompt, says on its way out.
async function mountLens($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], { names = ['sid.jsonl', 'agent-ab12.jsonl', 'agent-ab12.meta.json'], files = FILES, isSliced = false, fails, shapeFails, main = MAIN }: Options = {}) {
  mock.clock(on, { now: Date.parse('2026-01-01T01:00:00.000Z') })
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  on('session.root', () => ({ value: '/w' }))
  on('session.cwd', () => ({ value: '/w' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.messages', () => ({ value: [] }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', () => ({ value: names.map(name => ({ name, kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false })) }))
  on('fs.read', (_, e) => {
    const asked = JSON.stringify(e)
    if (asked.includes('agent-ab12.meta.json')) return { value: JSON.stringify(META) }
    const path = Object.keys(files).find(p => asked.includes(`"${p}"`))
    return path ? { value: files[path] ?? '' } : { deny: 'ENOENT' }
  })
  on('process.run', (_, e) => {
    const asked = JSON.stringify(e)
    const failing = asked.includes('api-request-shape') ? shapeFails : asked.includes('--version') ? undefined : fails
    if (failing) return { value: { exitCode: 2, stderr: failing, stdout: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const rows = asked.includes('api-request-shape') ? [SHAPE] : asked.includes('mcp_instructions_delta') ? [{ name: 'gh', text: `## gh\n${dirty('served')}` }] : asked.includes('"--arg","b","b2"') ? RESTART : asked.includes('break $out') ? PROMPT : asked.includes('agent-ab12') ? SUB : main
    const slice = isSliced && asked.includes('jq -c \\"$4\\"') ? '100 100\n' : ''
    return { value: { exitCode: 0, stderr: '', isStdoutTruncated: false, isStderrTruncated: false, stdout: slice + rows.map(line).join('\n') } }
  })
  on('session.usage', () => ({ value: USAGE }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 120, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const drawn = async () => JSON.stringify(await ui.drawn())
  return { ui, press, drawn }
}

// Nothing the engine refuses, and nothing left of a sequence: not its escape, not the parameters it carried.
const expectClean = (drawing: string) => {
  expect(drawing).not.toMatch(/\\u00(0[0-8b-f]|1[0-9a-f])|\\u007f/)
  expect(drawing).not.toMatch(/\[31m|\[0m|owned/)
}

test('a colour, a terminal title or a stray escape in a text read from outside is taken out, what it wrapped kept', () => {
  expect(clean(`${ESC}[31mred${ESC}[0m`)).toBe('red')
  expect(clean(`a${ESC}[1;38;5;196mb`)).toBe('ab')
  // The same sequences by their one-character introducers.
  expect(clean('a\u009b31mb')).toBe('ab')
  expect(clean('a\u009d0;owned\u0007b')).toBe('ab')
  // A title, ended by a bell or by a string terminator; a hyperlink keeps its words and loses its address.
  expect(clean(`a${ESC}]0;owned\u0007b`)).toBe('ab')
  expect(clean(`a${ESC}]0;owned${ESC}\\b`)).toBe('ab')
  expect(clean(`${ESC}]8;;https://x.example${ESC}\\words${ESC}]8;;${ESC}\\`)).toBe('words')
  // Stray ones, the rest of C0 and C1 and DEL too.
  expect(clean(`a${ESC}b\u0007c`)).toBe('abc')
  expect(clean('a\u0000b\u0008c\u000bd\u000ce\rf\u007fg\u0085h\u009fi')).toBe('abcdefghi')
})

test('a sequence the record cut short leaves nothing of itself, and a title never ended stops at its line', () => {
  expect(clean(`seen${ESC}[3`)).toBe('seen')
  expect(clean(`seen${ESC}[`)).toBe('seen')
  expect(clean(`seen${ESC}]0;owne`)).toBe('seen')
  expect(clean(`seen${ESC}]0;owned\nnext`)).toBe('seen\nnext')
})

test('a newline and a tab stay, and text with nothing to take out is the text itself', () => {
  expect(clean('a\nb\tc')).toBe('a\nb\tc')
  expect(clean(`a\tb${ESC}[31m\nc`)).toBe('a\tb\nc')
  expect(clean('[31m is not a sequence, 漢字 ✓ neither')).toBe('[31m is not a sequence, 漢字 ✓ neither')
})

test('what is parsed from a line is clean all the way down, its keys too, and its figures are left alone', () => {
  expect(parsed(JSON.stringify({ [`k${ESC}[0m`]: [{ x: `a${ESC}b`, n: 1, on: true, none: null }] }))).toEqual({ k: [{ x: 'ab', n: 1, on: true, none: null }] })
  expect(cleaned(`a${ESC}b`)).toBe('ab')
})

test('a tab takes four cells wherever a width is reckoned, and comes out as the spaces it was counted as', () => {
  expect(width('a\tb')).toBe(6)
  expect(fit('a\tb', 8)).toBe('a    b  ')
  expect(fit('a\tb', 3)).toBe('a  ')
  expect(left('a\tb', 8)).toBe('  a    b')
  expect(cut('a\tb', 8)).toBe('a    b')
  expect(cut('a\tbcdef', 8)).toBe('a    bc…')
})

test('a tool result holding a colour and a title does not stop the pane drawing, and the log shows its words', async ($, on) => {
  const { ui, drawn } = await mountLens($, on)
  expect((await ui.find({ type: 'Text', text: new RegExp(`→ ${clear('back')}`) }))?.text).toBeTruthy()
  expectClean(await drawn())
})

test('a prompt typed with an escape in it does not stop the pane drawing', async ($, on) => {
  const { ui, drawn } = await mountLens($, on)
  await $.turn.start({ text: dirty('typed'), turnId: 't9' })
  expectClean(await drawn())
  await ui.unmount()
})

test('a compaction page holding them draws, its summary and kept messages clean', async ($, on) => {
  const { ui, press, drawn } = await mountLens($, on)
  await press('cmp-2026-01-01T00:00:08.000Z|52000')
  await press('cmp-b2-s1')
  await press('cmp-b2-m0')
  expectClean(await drawn())
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(new RegExp(`^\\s*${clear('summed')}$`))).toBeTruthy()
  expect(await text(new RegExp(`^${clear('kept')}$`))).toBeTruthy()
  expect(await text(/^  src\/read\.ts$/)).toBeTruthy()
  expect(await text(/^  tdd$/)).toBeTruthy()
})

test('a memory file holding them draws clean, its lines whole and its tabs kept as lines to draw', async ($, on) => {
  const { ui, press, drawn } = await mountLens($, on)
  await press('ctx-grid')
  await press('init-Memory files')
  await press('init-mem-/home/u/CLAUDE.md')
  expectClean(await drawn())
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  expect(await text(new RegExp(`^    ${clear('memory')}$`))).toBeTruthy()
  // A carriage return before a newline is gone with the rest.
  expect(await text(/^    \tindented$/)).toBeTruthy()
  expect(await text(/^    last$/)).toBeTruthy()
})

test('main\'s system prompt, its tools and the servers\' instructions holding them draw clean', async ($, on) => {
  const { ui, press, drawn } = await mountLens($, on)
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text
  await press('ctx-grid')
  await press('init-System prompt')
  expectClean(await drawn())
  expect(await text(new RegExp(`^  ${clear('system')}$`))).toBeTruthy()
  await press('init-back')
  await press('init-MCP server instructions')
  await press('init-ins-gh')
  expectClean(await drawn())
  expect(await text(new RegExp(`^    ${clear('served')}$`))).toBeTruthy()
  await press('init-back')
  await press('init-Skills')
  expectClean(await drawn())
  expect(await text(/^  mine\s+100$/)).toBeTruthy()
})

test('a subagent whose meta file and initial prompt hold them draws clean', async ($, on) => {
  const { ui, press, drawn } = await mountLens($, on)
  await press('ag-ab12')
  await press('prompt-ab12')
  await press('prompt-m0-ab12')
  expectClean(await drawn())
  expect(await ui.find({ type: 'Text', text: new RegExp(`${clear('task')}$`) })).toBeTruthy()
})

test('a subagent\'s file named with an escape does not stop the pane drawing', async ($, on) => {
  const { drawn } = await mountLens($, on, { names: ['sid.jsonl', `agent-a${ESC}b.jsonl`] })
  expectClean(await drawn())
})

test('the record read in slices comes in as clean as the record read whole', async ($, on) => {
  const { ui, drawn } = await mountLens($, on, { isSliced: true })
  expect(await ui.find({ type: 'Text', text: new RegExp(`→ ${clear('back')}`) })).toBeTruthy()
  expectClean(await drawn())
})

test('a read that fails quoting them says so in a drawing that still draws', async ($, on) => {
  const { ui, drawn } = await mountLens($, on, { fails: dirty('failed') })
  expect(await ui.find({ type: 'Text', text: new RegExp(`${clear('failed')}$`) })).toBeTruthy()
  expectClean(await drawn())
})

test('a page\'s read that fails quoting them says so in a drawing that still draws', async ($, on) => {
  const { ui, press, drawn } = await mountLens($, on, { shapeFails: dirty('failed') })
  await press('ctx-grid')
  await press('init-System prompt')
  expect(await ui.find({ type: 'Text', text: new RegExp(`Could not read main's system prompt: .*${clear('failed')}$`) })).toBeTruthy()
  expectClean(await drawn())
})

test('where a hook is written and what a forked skill is called come in clean from their files', async ($, on) => {
  const HOOK = { t: 'hook', id: null, ts: '2026-01-01T00:00:03.000Z', at: 'hook_additional_context', hn: 'PreToolUse:Bash', cmd: 'run', ms: 5, ec: 0, n: 40, r: 'ok', c: [], u: null }
  const { ui, press, drawn } = await mountLens($, on, {
    names: ['sid.jsonl', 'agent-ab12.jsonl', 'agent-ab12.meta.json', 'agent-ab12.forked-skill.json'],
    main: [...MAIN, HOOK],
    files: {
      '/home/u/.claude/plugins/installed_plugins.json': JSON.stringify({ plugins: { [`gu${ESC}[31mard@mkt`]: [{ installPath: '/plugins/guard' }] } }),
      '/plugins/guard/hooks/hooks.json': JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ command: 'run' }] }] } }),
      '/home/u/.claude/projects/-w/sid/subagents/agent-ab12.forked-skill.json': JSON.stringify({ skillName: dirty('forked') }),
    },
  })
  await press('ag-ab12')
  await press('prompt-ab12')
  expect((await ui.find({ key: 'node-prompt-m0-ab12' }))?.text).toMatch(/▸ \/red forked! prompt/)
  expectClean(await drawn())
  await press('log-all')
  await $.ui.press({ plugin: 'session-lens', key: 'log-kind-hook', requestId: 'session-lens', surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /\[plugin:guard\] / })).toBeTruthy()
  expectClean(await drawn())
})

test('a child named with an escape, in the file that links it, comes in clean', () => {
  expect(parseChildren(JSON.stringify({ pid: 1, child: `ki${ESC}[31md`, cwd: '/w', at: 1 })).links[0]?.child).toBe('kid')
})
