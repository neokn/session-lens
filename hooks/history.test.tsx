import { edgesOf } from './edges'
import { expect, mock, test } from 'claude-code/testing'

import type { AgentMeta, AgentRun, Compaction, EventRow, TurnRow } from '../types'
import { agentTreeOf } from './digest/agents'
import { chatPartsOf, fitWithin, subPartsOf } from './digest/context'
import { ledgerOf, spendsOf, usdOf } from './digest/cost'
import { forecast, forecastInputs } from './digest/forecast'
import { noChat } from './digest/record'
import { whyFailed } from './digest/session'
import { laneSpan, liveReqsOf, turnsOf } from './digest/turns'
import { usesOf } from './digest/uses'
import { barCells, waffle } from './views/layout'
import { COLOR_TOKENS, LOADING, P, SERIES, T } from './views/palette'
import { barsOf } from './views/organisms/Waterfall'

const PANE = {
  plugin: 'session-lens',
  component: 'Pane',
  requestId: 'session-lens',
  props: { title: 'Session lens', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 400 }, view: {} },
} as const

const line = (o: object) => JSON.stringify(o)
const step = { i: 10, o: 50, cr: 900, cw: 100 } // 1010 handed to the model, 50 produced
const TOLD = '2025-12-31T23:00:00.000Z'
const TC = '2025-12-31T23:59:00.000Z'
const T0 = '2026-01-01T00:00:00.000Z'
const T1 = '2026-01-01T00:00:10.000Z'
const T2 = '2026-01-01T00:01:00.000Z'
const T3 = '2026-01-01T00:01:05.000Z'

// Prompt one: the person's words, an injected skill expansion, a notice; then a subagent launch, tools, and a failed launch.
// Prompt two: one request whose context has grown to 2990.
// Explore's initial prompt, read when its fold opens: the forked skill's prompt of forty lines, which the harness marks
// injected, then a reminder it put beside it.
const PROMPT: object[] = [
  { meta: true, text: Array.from({ length: 40 }, (_, n) => `task line ${n + 1}`).join('\n') },
  { meta: true, text: '<system-reminder>report back</system-reminder>' },
]
// The system prompt and tools a request was sent with, as the shape filter hands them over: Explore's first request,
// with a system prompt of thirty-five lines; and main's after the compaction.
const SUB_SHAPE = { system: Array.from({ length: 35 }, (_, n) => `sys line ${n + 1}`).join('\n'), tools: [{ name: 'Read', n: 4000 }, { name: 'Bash', n: 8000 }] }
const MAIN_SHAPE = { system: 'You are Claude.', tools: [{ name: 'Bash', n: 4000 }, { name: 'Agent', n: 12000 }] }
const MAIN: object[] = [
  // Before the last compaction: the session counts it, main agent's own figures do not.
  { t: 'assistant', id: 'm0', ts: TOLD, u: { i: 10, o: 50, cr: 1000, cw: 0 }, md: 'claude-opus-5-5', c: [{ k: 'use', id: 't0', name: 'Grep', n: 40, sk: null, pl: 0, d: 'old pattern' }] },
  { t: 'user', id: null, ts: TOLD, u: null, c: [{ k: 'res', id: 't0', n: 8000, e: false }] },
  { t: 'compact', id: null, ts: TC, tr: 'auto', pre: 190000, post: 30000, c: [], u: null },
  { t: 'compact', id: null, ts: TC, tr: 'manual', pre: 52000, post: 12000, ms: 61000, bu: 'b2', pu: ['k1', 'k3', 'k2'], c: [], u: null },
  // What the window restarts from: the summary (no prompt of the person's, and no turn), and a file it points back to.
  { t: 'user', id: null, ts: TC, o: null, meta: true, cs: true, pv: null, u: null, c: [{ k: 'text', n: 4000, w: 0 }] },
  { t: 'attachment', id: null, ts: TC, n: 100, at: 'compact_file_reference', c: [], u: null },
  { t: 'user', id: null, o: 'human', pv: 'hello there', ts: T0, u: null, c: [{ k: 'text', n: 40, w: 0 }] },
  { t: 'user', id: null, meta: true, ts: T0, u: null, c: [{ k: 'text', n: 400, w: 0 }] },
  { t: 'user', id: null, o: 'task-notification', ts: T0, u: null, c: [{ k: 'text', n: 80, w: 0 }] },
  { t: 'assistant', id: 'm1', ts: T1, u: step, ef: 'high', md: 'claude-opus-5-5', c: [{ k: 'text', n: 80, w: 0, x: 'Let me look at the repo' }] },
  { t: 'assistant', id: 'm1', ts: T1, u: step, c: [{ k: 'use', id: 't1', name: 'Agent', n: 900, sk: null, pl: 800 }] },
  // A deferred tool loaded: its definition arrives in the conversation.
  { t: 'tooldef', h: 'b1', id: null, u: null, c: [{ k: 'tooladd', n: 400 }] },
  // The same blob again (a retried request): counted once.
  { t: 'tooldef', h: 'b1', id: null, u: null, c: [{ k: 'tooladd', n: 400 }] },
  { t: 'assistant', id: 'm2', ts: T1, u: step, c: [{ k: 'use', id: 't2', name: 'Bash', n: 40, sk: null, pl: 0, d: 'git status' }] },
  { t: 'user', id: null, ts: T1, u: null, c: [{ k: 'res', id: 't1', n: 200, e: false }] },
  { t: 'user', id: null, ts: T1, u: null, c: [{ k: 'res', id: 't2', n: 400, e: false, r: 'On branch master' }] },
  { t: 'assistant', id: 'm3', ts: T1, u: step, c: [{ k: 'use', id: 't3', name: 'mcp__gh__issue', n: 80, sk: null, pl: 0 }] },
  { t: 'user', id: null, ts: T1, u: null, c: [{ k: 'res', id: 't3', n: 4000, e: false }] },
  { t: 'assistant', id: 'm5', ts: T1, u: step, c: [{ k: 'use', id: 't4', name: 'Agent', n: 200, sk: null, pl: 100 }] },
  { t: 'user', id: null, ts: T1, u: null, c: [{ k: 'res', id: 't4', n: 300, e: true, r: 'Agent type not found' }] },
  { t: 'user', id: null, o: 'human', pv: 'second prompt', ts: T2, u: null, c: [{ k: 'text', n: 20, w: 0 }] },
  { t: 'cmd', id: null, ts: T2, names: ['model'], args: ['opus'], c: [], u: null },
  { t: 'cmd', id: null, ts: T2, names: ['clear'], c: [], u: null },
  // Sent while main worked: it reaches the record as an attachment, and joins the turn already running.
  { t: 'attachment', id: null, ts: T2, n: 300, at: 'queued_command', qp: { x: 'also check the log', n: 18 }, c: [], u: null },
  // It asks the advisor first: a stronger model runs inside the request, billed apart from the request's own figures.
  { t: 'assistant', id: 'm4', ts: T3, u: { i: 1990, o: 50, cr: 900, cw: 100, th: 12, ad: [{ i: 10_000, o: 200, cr: 0, cw: 0, c1: 0, md: 'claude-fable-5-1' }] }, c: [{ k: 'use', sv: true, id: 'sa1', name: 'advisor', n: 2, sk: null, pl: 0, d: '' }, { k: 'res', id: 'sa1', n: 0, e: false, r: '' }, { k: 'text', n: 30, w: 0, x: 'All done' }] },
  // A web search's result: the tool ran two searches on the server, each billed apart from the tokens.
  { t: 'user', id: null, ts: T3, u: null, sc: 2, c: [] },
  // Hooks: one whose words reach the model, one that blocked and told the model why, one whose words only the person sees.
  { t: 'hook', id: null, ts: T3, at: 'hook_success', hn: 'PreToolUse:Bash', cmd: '/home/u/bin/status', ms: 3, ec: 0, n: 30, r: 'Status updated.', c: [], u: null },
  { t: 'hook', id: null, ts: T2, at: 'hook_success', hn: 'UserPromptSubmit', cmd: '/home/u/bin/stamp', ms: 5, ec: 0, n: 400, r: '[17:11]', c: [], u: null },
  { t: 'hook', id: null, ts: T3, at: 'hook_blocking_error', hn: 'PostToolUse:Bash', cmd: 'bash /home/u/bin/check', ms: 12, ec: 2, n: 40, r: 'denied', c: [], u: null },
  { t: 'hook', id: null, ts: T3, at: 'hook_non_blocking_error', hn: 'Stop', cmd: '/home/u/bin/notify', ms: 30, ec: 1, n: 0, r: 'boom', c: [], u: null },
  // A ! line after the last turn: the model never answers it, so it opens no turn.
  { t: 'user', id: null, o: 'human', pv: '<bash-input>ls</bash-input>', ts: '2026-01-01T00:02:00.000Z', u: null, c: [{ k: 'text', n: 30, w: 0 }] },
]
// Explore (launched by t1) loads a skill, launches another agent (k9), and hands its report back.
const SUB: object[] = [
  { t: 'assistant', id: 's1', ts: '2026-01-01T00:00:02.000Z', u: { i: 48, o: 20, cr: 1000, cw: 0 }, ef: 'low', md: 'claude-haiku-5-5', c: [{ k: 'use', id: 'k1', name: 'Skill', n: 30, sk: 'keybindings-help', pl: 0 }] },
  { t: 'user', id: null, u: null, c: [{ k: 'res', id: 'k1', n: 100, e: false }] },
  { t: 'assistant', id: 's2', u: { i: 5, o: 8, cr: 1100, cw: 0 }, c: [{ k: 'use', id: 'k9', name: 'Agent', n: 500, sk: null, pl: 400 }] },
  { t: 'user', id: null, u: null, c: [{ k: 'res', id: 'k9', n: 80, e: false }] },
  // It searched the web three times: $0.03, in its cost and in the cost of the turn that launched it.
  { t: 'user', id: null, u: null, sc: 3, c: [] },
  { t: 'assistant', id: 's3', ts: '2026-01-01T00:00:04.000Z', u: { i: 5, o: 8, cr: 1100, cw: 0 }, c: [{ k: 'use', id: 'h1', name: 'SubagentHandback', n: 240, sk: null, pl: 0, d: 'Found 3 files' }] },
]
const NESTED: object[] = [
  { t: 'assistant', id: 'n1', ts: '2026-01-01T00:00:05.000Z', u: { i: 100, o: 10, cr: 200, cw: 0 }, c: [{ k: 'use', id: 'h2', name: 'SubagentHandback', n: 100, sk: null, pl: 0 }] },
]

const entry = (name: string) => ({ name, kind: 'file' as const, size: 100, mtimeMs: 0, isLink: false })
const square = { color: 'permission', isFilled: true, categoryName: 'System tools', tokens: 1, percentage: 1, squareFullness: 1 }

test('the pane is built from the session record on disk: session, a tree rooted at main, turns', async ($, on) => {
  mock.clock(on) // the idle since the last turn keeps a clock running
  on('command.register', () => ({ value: { command: 'session-lens' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('env.get', (_, e) => ({ value: JSON.stringify(e).includes('HOME') ? '/home/u' : undefined }))
  // A shell cd moved cwd below where the session started; the record is filed under the start, which root() keeps.
  on('session.root', () => ({ value: '/work/app' }))
  on('session.cwd', () => ({ value: '/work/app/plugins/x' }))
  on('session.id', () => ({ value: 'sid' }))
  on('session.messages', () => ({ value: [] }))
  on('skill.prompt', (_, e) => ({ text: e.text, frontmatter: {} }))
  on('agent.list', () => ({ value: [] }))
  on('fs.list', (_, e) =>
    JSON.stringify(e).includes('-work-app-plugins-x')
      ? { value: [] }
      : { value: [entry('sid.jsonl'), entry('agent-ab12.jsonl'), entry('agent-ab12.meta.json'), entry('agent-ab12.forked-skill.json'), entry('agent-cd34.jsonl'), entry('agent-cd34.meta.json')] },
  )
  // Where the hooks are written: the person's settings, which turn on the one plugin installed, and that plugin's hooks.
  const HOOK_FILES: Record<string, object> = {
    '/home/u/.claude/settings.json': { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/home/u/bin/stamp' }] }] }, enabledPlugins: { 'guard@mkt': true } },
    '/home/u/.claude/plugins/installed_plugins.json': { plugins: { 'guard@mkt': [{ installPath: '/plugins/guard' }], 'off@mkt': [{ installPath: '/plugins/off' }] } },
    '/plugins/guard/hooks/hooks.json': { hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'bash', args: ['/home/u/bin/check'] }] }] } },
    '/plugins/off/hooks/hooks.json': { hooks: { Stop: [{ hooks: [{ type: 'command', command: '/home/u/bin/notify' }] }] } },
  }
  on('fs.read', (_, e) => {
    const hit = Object.keys(HOOK_FILES).find(path => JSON.stringify(e).includes(`"${path}"`))
    // Explore runs a forked skill: the person typed `/code-review`, and the skill became this subagent.
    if (JSON.stringify(e).includes('agent-ab12.forked-skill.json')) return { value: JSON.stringify({ skillName: 'code-review' }) }
    return hit ? { value: JSON.stringify(HOOK_FILES[hit]) } : {
    value: JSON.stringify(
      JSON.stringify(e).includes('cd34')
        ? { agentType: 'general-purpose', description: 'read a file', toolUseId: 'k9', parentAgentId: 'ab12', model: 'haiku', finished: true }
        : { agentType: 'Explore', description: 'scan the repo', toolUseId: 't1', model: 'haiku', finished: true },
    ),
  }
  })
  // The page of a compaction reads its own rows: what was attached again, and what the compaction chose.
  const RESTART = [
    { k: 'keep', u: 'k2', role: 'user', text: 'old copy' },
    { k: 'fixed', name: 'instructions', n: 8000 },
    { k: 'summary', text: 'This session is being continued.\n\nSummary:\n1. Primary Request:\n   keep the lens tidy\n\n2. Key Concepts:\n   - folds\n\nIf you need specific details, read the transcript.\nContinue the conversation.' },
    { k: 'ref', p: 'src/app.ts' },
    { k: 'file', p: 'src/read.ts' },
    { k: 'skills', names: ['tdd'] },
    { k: 'fixed', name: 'hook_success', n: 400 },
    { k: 'fixed', name: 'hook_success', n: 400 },
    { k: 'keep', u: 'k1', role: 'assistant', text: 'Fixing it.\n→ Bash {"command":"ls"}' },
    { k: 'keep', u: 'k2', role: 'user', text: 'all green' },
    { k: 'keep', u: 'k3', role: 'attachment', name: 'PostToolUse:Bash', text: '' },
  ]
  // jq fails as it does on a path that does not exist: only the folder the session started in holds the record.
  const missing = { value: { exitCode: 2, stderr: 'jq: error: Could not open file', stdout: '', isStdoutTruncated: false, isStderrTruncated: false } }
  // The first read of what a compaction restarted from fails, as a jq that times out would.
  let restartFails = 1
  on('process.run', (_, e) => (/\/projects\/(?!-work-app\/)/.test(JSON.stringify(e)) || (JSON.stringify(e).includes('"--arg","b"') && restartFails-- > 0) ? missing : {
    value: {
      exitCode: 0,
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
      stdout: (JSON.stringify(e).includes('api-request-shape') ? [JSON.stringify(e).includes('agent-ab12') ? SUB_SHAPE : MAIN_SHAPE] : JSON.stringify(e).includes('break $out') ? PROMPT : JSON.stringify(e).includes('"--arg","b","b2"') ? RESTART : JSON.stringify(e).includes('agent-cd34') ? NESTED : JSON.stringify(e).includes('agent-ab12') ? SUB : MAIN).map(line).join('\n'),
    },
  }))
  // The count /cost keeps began with this process, after everything in the record.
  const since = Date.now()
  on('session.usage', () => ({
    value: {
      startedAt: since,
      rateLimits: [],
      cost: { usd: 1.234 },
      context: {
        window: 200000,
        breakdown: {
          model: 'm',
          maxTokens: 200000,
          autocompactSource: 'auto' as const,
          isAutoCompactEnabled: true,
          apiUsage: null,
          percentage: 10,
          totalTokens: 20000,
          rawMaxTokens: 200000,
          categories: [
            { name: 'System tools', tokens: 600, color: 'permission', kind: 'used', isDeferred: false },
            { name: 'Messages', tokens: 1980, color: 'suggestion', kind: 'used', isDeferred: false },
            { name: 'MCP tools', tokens: 5000, color: 'inactive', kind: 'deferred', isDeferred: true },
          ],
          gridRows: [[square]],
          mcpTools: [],
          memoryFiles: [],
          agents: [],
        },
      },
    },
  }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  // A skill expansion is seen with no loop named: it lands in the main list until the record says who loaded it.
  await $.skill.prompt({ skill: 'keybindings-help', text: 'z'.repeat(400) })
  await $.command.run({ command: 'session-lens', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 120, rows: 400 } })
  const press = (key: string) => $.ui.press({ plugin: 'session-lens', key: `node-${key}`, requestId: 'session-lens', surface: 'terminal' })
  const label = async (key: string) => JSON.stringify(await ui.find({ key: `node-${key}` }))
  const button = async (re: RegExp) => (await ui.find({ type: 'Button', text: re }))?.text
  const text = async (re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

  // SESSION: the whole session's figures, one figure a tile, the cost among them: its box keeps only the bar and the tables.
  // Working: how long something ran, main, a subagent or a shell; the idle is the Timeline's span less it, left to the reader.
  expect(await text(/^Cost$/)).toBeTruthy()
  expect(await text(/^Idle$/)).toBeFalsy()
  expect(await text(/^Work( \(MAX\))?$/)).toBeTruthy()
  expect(JSON.stringify(await ui.drawn()).match(/"children":\["Work(?: \(MAX\))?"\]\},\{[^\]]*?"children":\["([^"]+)"\]/)?.[1]).toBe('15s (10s)')
  // Nothing runs: no spinner beside it.
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/1m45s[^⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]{0,80}[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/)
  expect(await text(/^\+\S+ unpriced$|^#2 done$/)).toBeFalsy()
  // Calls and requests are the session's, main's and the subagents' alike: main 6 requests, one before the compaction,
  // + Explore 3 + the nested one 1; their tool calls beside them on the same tile.
  // The label is the same whole or short, so it is one name at any width.
  expect(await text(/^Req\. \/ Calls$/)).toBeTruthy()
  expect(await text(/^10 \/ \d+$/)).toBe("10 / 6")
  // Compactions are counted from their boundaries in the record, with what they dropped in all.
  expect(await text(/^2 \(-200\.0k\)$/)).toBeTruthy() // (190k - 30k) + (52k - 12k)
  // Every token figure reads one way: ↑ into the model, ↓ out of it.
  expect(await text(/^(Session )?↑↓$/)).toBeTruthy()
  expect(await text(/^↑11\.6k ↓346$/)).toBeTruthy()
  // The last tile is the session's cost; the subagents' share is gone.
  expect(await text(/Subagents/)).toBeFalsy()
  expect(await text(/^\$1\.38$/)).toBeTruthy()
  // The tiles are the whole session's; a window is an agent's own, under it in the tree, never folded away.
  expect(await ui.find({ key: 'node-ctx' })).toBeFalsy()

  // The bar of what each kind of token cost sits under the tiles, the cost table still closed.
  expect(await ui.find({ key: 'cost-kind-bar' })).toBeTruthy()
  // Cost and usage opens into the models and every agent, nested ones beneath their caller.
  expect(await ui.find({ key: 'node-cost' })).toBeTruthy()
  await press('cost')
  // Compactions are no part of the cost: they have a fold of their own, each from what to what, and what it dropped.
  expect(await text(/190\.0k → 30\.0k/)).toBeFalsy()
  // The timeline's head says how many turns and how long; each of its rows opens on its own, what it draws beneath it.
  // The head counts what the chart holds, every request and call, subagents' too; how long the session has run, from its
  // first prompt to now, closes it: more than the 15s its turns ran.
  expect(await text(/^Timeline  2 turns · 2 compactions · \d+ requests · \d+ tool calls$/)).toBeTruthy()
  expect(JSON.stringify(await ui.drawn())).toMatch(/tool calls"?\]?.{0,200}"(\d+h)?(\d+m)?\d+s"/)
  expect(JSON.stringify(await ui.drawn())).not.toMatch(/tool calls"?\]?.{0,200}"15s"/)
  expect(await ui.find({ key: 'node-tuning' })).toBeFalsy()
  // The compactions are the Work row's, as the table by model / effort: both are there to tune by.
  expect(await ui.find({ key: 'node-compacts' })).toBeFalsy()
  expect(await button(/^› #1 /)).toBeFalsy()
  await press('combos')
  expect(await button(/^› #1 \S+\s+auto\s+190\.0k → 30\.0k\s+-160\.0k$/)).toBeTruthy()
  // The key heads the rows it explains; open, Work lists the compactions first, then the table by model / effort.
  const drawnNow = JSON.stringify(await ui.drawn())
  expect(drawnNow.indexOf(' tool calls')).toBeLessThan(drawnNow.indexOf('▾ Work'))
  expect(drawnNow.indexOf('› #1 ')).toBeLessThan(drawnNow.search(/By model \/ effort|Model\/effort/))
  expect(await button(/^› #2 \S+\s+manual\s+52\.0k → 12\.0k\s+-40\.0k$/)).toBeTruthy()
  // A row opens the compaction's page, and back is the main page.
  await press('compact-1')
  expect(await text(/Could not open file/)).toBeTruthy()
  // A read that failed is tried again the next time the page opens.
  await press('cmp-back')
  await press('compact-1')
  expect(await text(/^Kept messages 2$/)).toBeTruthy()
  await press('cmp-back')
  expect(await ui.find({ key: 'node-ctx-grid' })).toBeTruthy()
  // The Cost tile holds the session's total: what /cost measured for this process, and the record's price for what it
  // never saw; nothing measured overlaps the record, so there is nothing to scale it by and no ±. The cost box's head says
  // only what went unpriced: the nested agent's requests name no model.
  expect(await label('cost')).toMatch(/"label":"[▸▾] Cost  \+1 unpriced"/)
  expect(await text(/^\$1\.38$/)).toBeTruthy()
  expect(await text(/main agent.*↑8\.0k\s+↓300\s+\$0\.1\d\s+\d+%$/)).toBeTruthy() // the whole session, the advisor's $0.11 in it
  // By kind of token, each with what it cost; by the model that served each request, the unnamed one unpriced.
  // Under the session's tiles, one bar of colour, a block for each kind of token that cost anything, together as wide as the room.
  const bar = await ui.find({ key: 'cost-kind-bar' })
  expect(bar).toBeTruthy()
  const segs = (await ui.findAll({ type: 'Box' })).filter((b: { key?: string }) => b.key?.startsWith('cost-seg-'))
  // Web searches, billed by the search, close it; cache reads cost too little here to fill a cell.
  expect(segs.map((b: { key?: string }) => b.key)).toEqual(['cost-seg-w5', 'cost-seg-i', 'cost-seg-o', 'cost-seg-search'])
  // Beneath it, which colour is which kind and its share of the bar; a kind that cost nothing is in neither.
  const shares = (await ui.findAll({ type: 'Text', text: /^■ .+ \(\d+\.\d%\)$/ })).map((t: { text?: string }) => Number(t.text?.match(/\((\S+)%\)$/)?.[1]))
  expect(shares.length).toBeGreaterThan(3)
  expect(Math.abs(shares.reduce((n: number, x: number) => n + x, 0) - 100)).toBeLessThan(0.5)
  expect(await text(/^■ web search \(\d+\.\d%\)$/)).toBeTruthy()
  expect(await text(/^■ cache\/r \(\d+\.\d%\)$/)).toBeTruthy()
  expect(await text(/^■ cache\/w 1h/)).toBeFalsy()
  // The lines that spelled the total out are gone: the README says how it is made.
  expect(await text(/^Total /)).toBeFalsy()
  expect(segs.reduce((n: number, b: { props: { width?: number } }) => n + (b.props.width ?? 0), 0)).toBe(80 - 2 - 4 - 2 - 4) // the pane, its border and padding, the indent, and the cost box's border and padding
  expect(await text(/^opus-5-5 · main\s+6\s+↑8\.0k\s+↓300/)).toBeTruthy()
  // A model and the form of agent it served as: main, subagent or advisor, never the agent's type.
  expect(await text(/^haiku-5-5 · subagent\s+3\s/)).toBeTruthy()
  expect(await text(/^Subagents\s+\d/)).toBeFalsy()
  expect(await text(/^unknown · subagent\s+1\s+↑300\s+↓10\s+—\s+-$/)).toBeTruthy()
  // The advisor's request is billed at its own model, apart from main's figures: by model, and on a line under main.
  // Fable 5.1: 10k in at $10, 200 out at $50.
  expect(await text(/^fable-5-1 · advisor\s+1\s+↑10\.0k\s+↓200\s+\$0\.11\s+\d+%$/)).toBeTruthy()
  // The model is a quiet aside, text.soft; the form of agent carries the colour: main, the advisor speaking for main, a subagent.
  const tint = async (re: RegExp) => [...new Set(JSON.stringify(await ui.find({ type: 'Text', text: re })).match(/#[0-9a-f]{6}/g))]
  expect(await tint(/^opus-5-5 · main/)).toEqual([T.text.soft, T.actor.main])
  expect(await tint(/^fable-5-1 · advisor/)).toEqual([T.text.soft, T.actor.mainEcho])
  expect(await tint(/^haiku-5-5 · subagent/)).toEqual([T.text.soft, T.actor.sub])
  // Every colour on the page is an intent token's, a series colour or the loading light's, the theme's names from /context
  // included, and the swatches of the themes to switch to; text left uncoloured is the terminal's own.
  const PALETTE = [...Object.values(COLOR_TOKENS).flatMap(g => Object.values(g).map(t => t.color)), ...SERIES, LOADING.light, LOADING.head, ...LOADING.trail, LOADING.track, ...Object.values(P)]
  const page = JSON.stringify(await ui.drawn())
  expect([...new Set(page.match(/"(color|borderColor|backgroundColor)":"[^"]*"/g))].filter(c => !PALETTE.some(h => c.endsWith(`"${h}"`)))).toEqual([])
  expect(page).not.toContain('"dimColor":true')
  expect(await text(/^  Advisor \(fable-5-1\)\s+1\s+↑10\.0k\s+↓200\s+\$0\.11\s+\d+%$/)).toBeTruthy()
  expect(await text(/of which/)).toBeFalsy()
  // Two web searches at $0.01 each, in main's cost and on a line of their own.
  expect(await text(/^  web search · 2 searches\s+2\s+-\s+\$0\.02\s+\d+%$/)).toBeTruthy()
  expect(await text(/^    web search · 3 searches\s+3\s+-\s+\$0\.03\s+\d+%$/)).toBeTruthy() // Explore's, under it
  expect(await text(/^\s+general-purpose · read.*↑300\s+↓10/)).toBeTruthy() // nested under Explore; the description cut to the room

  // main's window is a box under its tiles, closed at first: the line and the bar, which open it.
  expect((await ui.find({ key: 'node-ctx-line' }))?.text).toMatch(/^▸ /)
  expect(await text(/Breakdown/)).toBeFalsy()
  expect(await text(/^Init · /)).toBeFalsy()
  await press('ctx-grid')
  // Open, main's Context sits under its tiles: one grid of the whole window, a square 1% of it, its key to the right,
  // grouped by what the window opened with and what came in since, each titled with its share.
  // After a compaction the first request's own messages are gone: the window opens with what /context names.
  expect(await text(/^Init · 0\.3% of context · 600$/)).toBeTruthy()
  expect(await text(/⛁ Other init/)).toBeFalsy()
  // The window now less that, 2990 - 600: what the API says, however much the record counts.
  expect(await text(/^Conversation · 1\.2% of context · 2\.4k$/)).toBeTruthy()
  // Init fills the grid from the start, what came in since fills on from there, then the room left as /context draws it:
  // a hundred squares, one grid, no blanks.
  const rowsOfGrid = (await ui.findAll({ type: 'Text', text: /^[⛁⛀⛶⛝ ]{20}$/ })).map(t => t.text ?? '')
  expect(rowsOfGrid.length).toBe(10)
  const grid = rowsOfGrid.join('')
  expect(grid.startsWith('⛁ ⛀ ')).toBe(true) // 600 of 200k is less than a square, but it is there, full; then the chat, half squares
  const count = (s: string, ch: string) => [...s].filter(c => c === ch).length
  expect(count(grid, '⛁') + count(grid, '⛀') + count(grid, '⛶')).toBe(100)
  // The bar above the grid draws the same parts in the same order and colours: one segment for each part the grid fills.
  type Node = { props?: { color?: string }; children?: (Node | string)[] }
  const painted: { color?: string; text: string }[] = []
  const walk = (n: Node | string | undefined) => {
    if (!n || typeof n === 'string') return
    const own = (n.children ?? []).filter((c): c is string => typeof c === 'string').join('')
    if (own) painted.push({ color: n.props?.color, text: own })
    ;(n.children ?? []).forEach(walk)
  }
  walk((await ui.drawn()) as unknown as Node)
  const runs = (xs: (string | undefined)[]) => xs.filter((c, i) => c !== xs[i - 1])
  const barColors = runs(painted.filter(x => /^█+$/.test(x.text)).map(x => x.color))
  // The pane draws more than one grid and other bars: take the first grid's hundred squares, and the window's bar is the last one drawn so far.
  const once = runs(painted.filter(x => /^[⛁⛀⛶⛝·] $/.test(x.text)).slice(0, 100).filter(x => /^[⛁⛀] $/.test(x.text)).map(x => x.color))
  expect(once.length).toBeGreaterThan(1)
  expect(barColors.slice(-once.length)).toEqual(once)
  // A │ splits the bar where what it opened with ends and what came in since begins, once.
  const windowBar = (await ui.findAll({ type: 'Text', text: /^█+│█+░*┃?▒*$/ })).map((t: { text?: string }) => t.text ?? '')
  expect(windowBar).toHaveLength(1)
  expect([...(windowBar[0] ?? '')].filter(c => c === '│')).toHaveLength(1)
  // The key reads in order: the opening's group, the chat's, then the room left.
  const keyOrder = [...new Set((await ui.findAll({ type: 'Text', text: /^(Init|Conversation|⛶ Free space)/ })).map(t => (t.text ?? '').slice(0, 3)))]
  expect(keyOrder).toEqual(['Ini', 'Con', '⛶ F'])
  // The box closes to its line and bar again, and opens again.
  expect((await ui.find({ key: 'node-ctx-line' }))?.text).toMatch(/^▾ /)
  await press('ctx-grid')
  expect(await ui.findAll({ type: 'Text', text: /^[⛁⛀⛶⛝ ]{20}$/ })).toHaveLength(0)
  expect(await text(/^Init · /)).toBeFalsy()
  await press('ctx-grid')
  expect(await ui.findAll({ type: 'Text', text: /^[⛁⛀⛶⛝ ]{20}$/ })).toHaveLength(10)
  expect(await text(/^⛶ Free space\s+197\.0k\s+98\.5%$/)).toBeTruthy()
  // Since the last compaction only; the record's estimates add up to more than the API's 2.4k, so all shrink together.
  expect((await ui.find({ key: 'node-chat:user' }))?.text).toMatch(/⛀ User messages ×4 ›\s+≈24\s+0\.0%$/) // the prompt sent mid-turn and the ! line are the person's too
  expect((await ui.find({ key: 'node-chat:injected' }))?.text).toMatch(/⛀ Injected .* ›\s+≈924\s+0\.5%$/) // a skill expansion, and the compaction summary
  // A deferred tool's definition, sent in the conversation; and thinking as the API counts it, no longer guessed.
  expect((await ui.find({ key: 'node-chat:toolDef' }))?.text).toMatch(/^⛀ Deferred tool definitions\S* ›\s+≈84\s+0\.0%$/)
  expect(await text(/⛀ thinking\s+≈10\s+0\.0%$/)).toBeTruthy()
  expect(await text(/thinking \(est\.\)/)).toBeFalsy()
  expect((await ui.find({ key: 'node-chat:notice' }))?.text).toMatch(/^⛀ Notifications \(subagents\)\S* ›\s+≈17\s+0\.0%$/)
  expect((await ui.find({ key: 'node-chat:tool' }))?.text).toMatch(/⛀ Tool calls & results ×5 ›\s+≈1\.3k\s+0\.6%$/)
  expect((await ui.find({ key: 'node-chat:reply' }))?.text).toMatch(/⛀ Assistant messages ×2 ›\s+≈24\s+0\.0%$/)
  // Main agent's own figures leave out its call from before the compaction; the session's figures count it.
  expect(await text(/^\s+Grep\s/)).toBeFalsy()

  // Turns: the newest one sits on top, then every turn; one opens into what it did and its waterfall.
  // The live turn starts folded to its lane; open, its waterfall.
  expect(await label('live')).toMatch(/"label":"▸ second prompt"/) // the prompt alone, no number
  await press('live')
  // The waterfall's header carries the turn's span: no line of totals above it.
  expect(await text(/^  \S+ · \d+ requests · ↑\S+ ↓\S+$/)).toBeFalsy()
  // The newest turn draws the same waterfall as the others, not a list of steps.
  // Its header names the lane once: the span at the lane's end, and what every request read and wrote under ↑ ↓.
  expect(await text(/^Request\s+0\s+\S+\s+↑\S+\s+↓\S+$/)).toBeTruthy()
  // The one timeline is the session's: the turn draws none of its own.
  expect(await ui.findAll({ type: 'Text', text: /^Timeline$/ })).toHaveLength(1)
  expect(await text(/Who · what/)).toBeFalsy()
  expect(await label('live')).not.toMatch(/Idle/)
  // The past turns are not listed on the main page: one entry opens a page of them.
  expect(await ui.find({ key: 'node-turn:1' })).toBeFalsy()
  // What the session cost sits right under its tiles, above the turns.
  const order = JSON.stringify(await ui.drawn())
  expect(order.indexOf('node-cost')).toBeGreaterThan(-1)
  expect(order.indexOf('node-cost')).toBeLessThan(order.indexOf('node-turn-history'))
  expect(await label('turn-history')).toMatch(/History · \d+ turns"/)
  await press('turn-history')
  expect(await ui.find({ key: 'node-ctx-grid' })).toBeFalsy()
  // Idle sits between turns, not in one: turn 1's last reply to turn 2's prompt (T1 → T2), and turn 2's to the ! line.
  // Its cost: main's four requests ($0.01) and Explore's, its three web searches among them ($0.03).
  expect(await label('turn:1')).toMatch(/8\s+↑7\.6k\s+↓246\s+\$0\.04\s+10s/)
  // What a turn cost: main's request ($0.01), the advisor's inside it ($0.11) and two web searches ($0.02).
  expect(await label('turn:2')).toMatch(/\s+\$0\.14\s+\d+s/)
  expect(await label('turn:1')).not.toMatch(/50s/)
  expect(await text(/Idle 50s$/)).toBeTruthy()
  expect(await text(/Idle 55s$/)).toBeTruthy()
  expect(await text(/Idle \S+ \(so far\)/)).toBeFalsy()
  // On the list a turn unfolds in place into what it did and its waterfall; a second press folds it.
  expect(await text(/^Activity$/)).toBeFalsy()
  // Folded, each turn keeps its requests on one lane in their timeline colours; opened, its waterfall takes the lane's place.
  const lanes = async () => (await ui.findAll({ type: 'Text', text: /^\d+ requests · \S+\s+.*█/ })).map(t => JSON.stringify(t))
  const folded = await lanes()
  expect(folded.length).toBeGreaterThanOrEqual(2)
  expect(folded.some(t => t.includes(T.rank.longest))).toBe(true)
  await press('turn:1')
  expect((await lanes()).length).toBe(folded.length - 1)
  expect(await ui.find({ key: 'node-turn:1' })).toBeTruthy()
  expect(await text(/^Activity$/)).toBeTruthy()
  expect(await text(/Agent ×2/)).toBeTruthy()
  expect(await text(/gh · issue ×1/)).toBeTruthy()
  expect(await text(/Subagents 2/)).toBeTruthy()
  // The turn's waterfall holds main's own requests: a subagent does not hold the turn up, so it has no row there.
  expect(await text(/[├└] Explore · 3 reqs/)).toBeFalsy()
  expect(await text(/[├└] general-purpose · 1 reqs/)).toBeFalsy()
  await press('turn:1')
  expect(await text(/^Activity$/)).toBeFalsy()
  // Back returns to the main page.
  await press('turn-back')
  expect(await ui.find({ key: 'node-ctx-grid' })).toBeTruthy()
  // SESSION: every setting the session ran at, main and its subagents together, the model first and its efforts beneath.
  // The Work row opened it with the compactions; inside the box the room is too narrow for the full title.
  expect(await text(/^Model\/effort\s+Reqs\/turn/)).toBeTruthy()
  const settingRows = (await ui.findAll({ type: 'Text', text: /^\s+(high|low|—)\s+\d/ })).map((t: { text?: string }) => (t.text ?? '').trim().split(/\s+/).slice(0, 2).join(' '))
  expect(settingRows).toEqual(['high 2.5', 'low 3.0', '— 1.0'])

  // AGENTS: main is open at first, every agent has the same three tables: count, what went out, what came back.
  // An open agent heads its tables with its own tiles: model with its effort, requests, ↑ ↓ on one line, and the share of the context window it started from and fills now. Who it is stays in its heading.
  // Too narrow for every title whole, the tile takes its short one.
  expect((await ui.findAll({ type: 'Text', text: /^Model( \/ Effort)?$/ })).length).toBe(1)
  expect(await text(/^Effort$/)).toBeFalsy()
  // Each tile keeps its inset, so at 80 columns the setting takes its shortest form.
  expect(await text(/^opus55 \/ hi$/)).toBeTruthy()
  // Its effort named only from the second request on is no switch.
  expect(await text(/switches/)).toBeFalsy()
  expect(await text(/^main$/)).toBeFalsy()
  expect(await text(/^(Requests|Reqs)$/)).toBeTruthy()
  expect(await text(/^Requests · /)).toBeFalsy()
  expect(await text(/^↑7\.0k ↓250$/)).toBeTruthy()
  // Its own tool calls, and what it has running now: no subagent and no shell.
  expect(await text(/^(Tool )?Calls$/)).toBeTruthy()
  expect(await text(/^Subs$|^Subagents$/)).toBeTruthy()
  expect(await text(/^Shells$/)).toBeTruthy()
  expect(await text(/^Init Context$/)).toBeFalsy()
  // main is always there: no head of its own to fold, its tiles straight under Agents, which counts the subagents still running.
  // The tree shows what each agent started: no count of them beside it.
  expect(await text(/dispatched/)).toBeFalsy()
  expect(await ui.find({ key: 'node-ag-main' })).toBeFalsy()
  expect(await label('agents')).toMatch(/"label":"▾ Agents  0 running subagents"/) // both have finished
  // What it used opens with its window's box, under the Breakdown: a table of counts, no bars, each grouped by scope.
  if ((await ui.find({ key: 'node-ctx-line' }))?.text?.startsWith('▾')) await press('ctx-grid')
  expect(await text(/^\s+Bash\s+1\s/)).toBeFalsy()
  await press('ctx-grid')
  expect(await text(/^\s+built-in · 3 calls$/)).toBeTruthy()
  expect(await text(/^\s+server tool · 1 calls$/)).toBeTruthy()
  expect(await text(/^\s+advisor\s+1\s+-\s+≈1$/)).toBeTruthy() // what it hands back is redacted
  expect(await text(/^\s+Bash\s+1\s+≈100\s+≈10$/)).toBeTruthy()
  expect(await text(/^\s+settings · 1 calls$/)).toBeTruthy()
  // Hooks: the ones that reached main's context, under the event each hooks, a row per place it is written (and its
  // matcher); a hook that added nothing is not there.
  expect(await text(/^\s*Hooks  2 kinds · 2 calls · ↑≈110 ↓≈0$/)).toBeTruthy()
  expect(await text(/^\s+UserPromptSubmit · 1 calls$/)).toBeTruthy()
  expect(await text(/^\s+user\s+1\s+≈100\s+-$/)).toBeTruthy()
  expect(await text(/^\s+PostToolUse · 1 calls$/)).toBeTruthy()
  expect(await text(/^\s+plugin:guard · Bash\s+1\s+≈10\s+-$/)).toBeTruthy()
  expect(await text(/^\s+(Stop|PreToolUse)/)).toBeFalsy()
  // A forked skill is main's: its ↓ is what main handed the subagent (↓225), its ↑ the result that came back (≈60).
  expect(await text(/^\s+code-review \(fork\)\s+1\s+≈60\s+≈225$/)).toBeTruthy()
  expect(await text(/^\s+Agent\s+2\s+≈125\s+≈275/)).toBeTruthy()
  expect(await text(/^\s+gh · issue\s+1\s+≈1\.0k\s+≈20/)).toBeTruthy()
  // A dispatch that started no subagent is not in main's tree: the finished ones total all of them on one line.
  expect(await text(/\(failed\)/)).toBeFalsy()
  // Every subagent has finished: none stays in main's tree, so no line runs down from main; they fold in the Session
  // block, as the compactions do.
  expect(await ui.find({ key: 'node-ag-ab12' })).toBeFalsy()
  expect(await text(/^│(\n│)+$/)).toBeFalsy()
  // The agents' row: a mark for each by when it started, and under it what they did; pressed, it opens the trees.
  expect(await text(/^\s+▸ \d+ subagents · 1 failed · ↑3\.6k ↓46$/)).toBeTruthy()
  await press('done')
  expect(await text(/^\(failed\) Agent type not found · 1 dispatches · ↑≈75 ↓≈50$/)).toBeTruthy()
  // The tree's line runs from a node's ▸ down to its child's connector, which stands before the child's own ▸.
  expect(await label('ag-ab12')).toMatch(/"label":"└ ▸ Explore.*3 requests · ↑3\.3k ↓36/)
  expect(await text(/Dispatch ↑50 ↓225 · Result ↓≈60 to parent/)).toBeTruthy() // the rest is cut to 80 columns
  // Closed, it still has its Dispatch line under it: the line down to its child's connector runs past that, unbroken.
  expect(await text(/^  │(\n  │)+$/)).toBeTruthy()
  // The skill the subagent loaded is its own, with its size, and not main's.
  await press('ag-ab12')
  // Every box ends inside what holds it, and in each the last box of a row ends on its edge: tiles over a box, a box
  // under tiles, the finished subagents' inside the Timeline box, all one right edge.
  const edges = edgesOf(await ui.drawn(), 80).filter(e => e.depth > 1)
  expect(edges.filter(e => e.right > e.room)).toEqual([])
  expect([...new Set(edges.map(e => e.room))].filter(room => !edges.some(e => e.room === room && e.right === room))).toEqual([])
  // Inside the Timeline box at 80 columns its tiles are narrower than main's: their titles and values are cut to fit.
  expect((await ui.findAll({ type: 'Text', text: /^Model \/ Effo/ })).length).toBe(2)
  expect(await text(/^haiku-?5-?5 \/ lo(w)?$/)).toBeTruthy()
  // Its Init Context, folded until asked for and read then: the system prompt and tools its first request was sent
  // with, then each message under what it is; each part folds on its own, its first ten lines, then thirty more.
  expect(await label('prompt-ab12')).toMatch(/▸ Init Context  plus system prompt and tools/)
  expect(await text(/task line 1$/)).toBeFalsy()
  await press('prompt-ab12')
  expect(await label('prompt-ab12')).toMatch(/▾ Init Context  ≈[\d.]+k? · system prompt · tools · messages 2/)
  expect(await label('prompt-sys-ab12')).toMatch(/▸ System prompt  ≈\d+ · 35 lines/)
  expect(await text(/^\s+sys line 1$/)).toBeFalsy()
  await press('prompt-sys-ab12')
  expect(await text(/^\s+sys line 10$/)).toBeTruthy()
  expect(await text(/^\s+sys line 11$/)).toBeFalsy()
  expect(await label('more-prompt-sys-ab12')).toMatch(/\+ Show 25 more · 25 not shown/)
  await press('more-prompt-sys-ab12')
  expect(await text(/^\s+sys line 35$/)).toBeTruthy()
  expect(await ui.find({ key: 'node-more-prompt-sys-ab12' })).toBeFalsy()
  // The tools by size, the largest first: Bash's 8000 characters, then Read's 4000.
  expect(await label('prompt-tools-ab12')).toMatch(/▸ Tools 2  ≈3\.0k/)
  await press('prompt-tools-ab12')
  const toolLines = (await ui.findAll({ type: 'Text', text: /^\s+(Bash|Read)\s+≈/ })).map(t => t.text?.trim().replace(/\s+/g, ' '))
  expect(toolLines).toEqual(['Bash ≈2.0k', 'Read ≈1.0k'])
  expect(await ui.find({ key: 'node-more-prompt-tools-ab12' })).toBeFalsy() // two lines: nothing more to open
  // A forked skill's prompt is its task; the reminder beside it folds apart, named Injected.
  expect(await label('prompt-m0-ab12')).toMatch(/▸ \/code-review prompt  ≈\d+ · 40 lines · task line 1/)
  expect(await label('prompt-m1-ab12')).toMatch(/▸ Injected  ≈\d+ · 1 lines · <system-reminder>report back/)
  expect(await text(/^\s+task line 1$/)).toBeFalsy()
  await press('prompt-m0-ab12')
  expect(await text(/^\s+task line 10$/)).toBeTruthy()
  expect(await text(/^\s+task line 11$/)).toBeFalsy()
  expect(await label('more-prompt-m0-ab12')).toMatch(/\+ Show 30 more · 30 not shown/)
  await press('prompt-m1-ab12')
  expect(await text(/^\s+<system-reminder>report back<\/system-reminder>$/)).toBeTruthy()
  await press('prompt-ab12')
  expect(await text(/task line 1$/)).toBeFalsy()
  // A subagent's window too, a box in view under its tiles, closed at first; opened, its Breakdown (its first request,
  // then what the record shows filled the rest) and what it used.
  expect(await ui.find({ key: 'node-ctx-ab12' })).toBeFalsy()
  expect(await text(/⛁ init \(system/)).toBeFalsy()
  expect(await text(/^\s+keybindings-help\s+1/)).toBeFalsy()
  await press('ctx-ab12-grid')
  expect(await text(/^\s+keybindings-help\s+1\s+≈100\s+-$/)).toBeTruthy()
  // The forked skill it runs is main's, not listed again here.
  expect(await text(/^\s+code-review\s+1/)).toBeFalsy()
  expect(await text(/⛁ init \(system.*1\.0k\s+0\.5%$/)).toBeTruthy() // one figure from the API, its share of the window
  // A grandchild's connector is under its parent's ▸; Explore is main's last child, so no line of main's runs past it.
  expect(await label('ag-cd34')).toMatch(/"label":"  └ ▸ general-purpose.*1 requests · ↑300 ↓10/)
  expect(await text(/^  │(\n  │)+$/)).toBeTruthy()
  await press('done')
  expect(await ui.find({ key: 'node-ag-ab12' })).toBeFalsy()

  // An event row: its turn, its time, then who and what.
  // A compaction's row is a button, opening into what the window restarted from.
  const ROW = /^(#\d+)?\s{2,}\d{2}:\d{2}:\d{2}\s+\S/
  const rows = async () => [...(await ui.findAll({ type: 'Text', text: ROW })), ...(await ui.findAll({ type: 'Button', text: ROW }))]
  // EVENT LOG: the main page shows the newest 10 of every kind but hooks, unfiltered; the whole log, with its filters, is a page.
  expect(await text(/Event log/)).toBeTruthy()
  expect(await text(/main\s+All done/)).toBeTruthy()
  expect(await ui.find({ key: 'log-who-sub' })).toBeFalsy()
  expect((await rows()).length).toBe(10)
  // Hooks wait behind their chip on the log's page.
  expect(await text(/\[plugin:guard\] PostToolUse/)).toBeFalsy()
  expect(await label('log-all')).toMatch(/All events · \d+/)
  await press('log-all')
  expect(await ui.find({ key: 'node-ctx-grid' })).toBeFalsy()
  // Under all kinds the page leaves the hooks out too.
  expect(await text(/\[plugin:guard\] PostToolUse/)).toBeFalsy()
  // Rows sit under their turn: the newest starts open, the others closed until pressed or opened all at once.
  expect(await label('log-t-2')).toMatch(/"▾ #2「second prompt」 \d+ events/)
  expect(await label('log-t-1')).toMatch(/"▸ #1「hello there」 \d+ events/)
  expect(await text(/^#2\s+\S+\s+user\s+second prompt/)).toBeTruthy()
  expect(await text(/^#1\s+\S+\s+main\s+gh · issue/)).toBeFalsy()
  await press('log-t-1')
  expect(await text(/^#1\s+\S+\s+main\s+gh · issue/)).toBeTruthy()
  await press('log-close-all')
  expect(await text(/^#1\s+\S+\s+main\s+gh · issue/)).toBeFalsy()
  expect(await text(/^#2\s+\S+\s+user\s+second prompt/)).toBeFalsy()
  await press('log-open-all')
  expect((await rows()).length).toBeGreaterThan(10)
  expect(await text(/main\s+gh · issue/)).toBeTruthy()
  // Each row starts with the turn it belongs to, the same number the Turns block uses.
  expect(await text(/^#1\s+\S+\s+main\s+gh · issue/)).toBeTruthy()
  expect(await text(/^#2\s+\S+\s+user\s+second prompt/)).toBeTruthy()
  expect(await text(/^#1\s+\S+\s+user\s+hello there/)).toBeTruthy()
  // A ! line that opened no turn is in none: it heads a group of its own after the turn before it.
  expect(await label('log-t-0-2')).toMatch(/"▾ after #2 · no new turn 1 events/)
  expect(await text(/^\s+\S+\s+user\s+! ls/)).toBeTruthy()
  expect(await text(/^#2\s+\S+\s+user\s+! ls/)).toBeFalsy()
  // Each compaction is in the log as main's: what set it off, the window before and after, what it dropped. The last
  // one opens the record that counts, before any turn.
  expect(await button(/^\s+\S+\s+main\s+› compact manual 52\.0k → 1…\s+-\s+-$/)).toBeTruthy()
  // ↑ before ↓: a tool's result went in, its arguments came out; a prompt goes in, a reply comes out.
  expect(await text(/main\s+gh · issue\s+1\.0k\s+20$/)).toBeTruthy()
  // The advisor's result comes back in the reply that called it: done, not still running.
  expect(await text(/^#2\s+\S+\s+main\s+advisor\s+0\s+1$/)).toBeTruthy()
  expect(await text(/user\s+hello there\s+10\s+-$/)).toBeTruthy()
  expect(await text(/main\s+Let me look at the repo\s+-\s+20$/)).toBeTruthy()
  // What the person typed at the prompt is in the log too, as 你.
  expect(await text(/user\s+hello there/)).toBeTruthy()
  // Beside each action, on its own line, what it did and the first line of what came back.
  expect(await text(/main\s+Bash git status → On branc…\s+100\s+10$/)).toBeTruthy() // cut to the Action column
  expect(await text(/Agent → \(not started\) → ✗…/)).toBeTruthy()
  // A reply shows what it said in place of the word, here as under 對話.
  expect(await text(/main\s+Let me look at the repo/)).toBeTruthy()
  expect(await text(/main\s+reply/)).toBeFalsy()
  await $.ui.press({ plugin: 'session-lens', key: 'log-who-sub', requestId: 'session-lens', surface: 'terminal' })
  expect(await text(/main\s+gh · issue/)).toBeFalsy()
  expect(await text(/Explore\s+Skill · keybindings-help/)).toBeTruthy()
  // Tool, MCP and Skill are one kind: 工具.
  await $.ui.press({ plugin: 'session-lens', key: 'log-kind-tool', requestId: 'session-lens', surface: 'terminal' })
  expect(await text(/Skill · keybindings-help/)).toBeTruthy()
  expect(await ui.find({ key: 'log-kind-mcp' })).toBeFalsy()
  await $.ui.press({ plugin: 'session-lens', key: 'log-kind-agent', requestId: 'session-lens', surface: 'terminal' })
  expect(await text(/Skill · keybindings-help/)).toBeFalsy()
  // Under 對話, what the person sent and every reply, each showing what it said in place of the word.
  await $.ui.press({ plugin: 'session-lens', key: 'log-who-all', requestId: 'session-lens', surface: 'terminal' })
  await $.ui.press({ plugin: 'session-lens', key: 'log-kind-talk', requestId: 'session-lens', surface: 'terminal' })
  expect(await ui.find({ key: 'log-kind-reply' })).toBeFalsy()
  expect(await ui.find({ key: 'log-kind-prompt' })).toBeFalsy()
  expect(await text(/main\s+Let me look at the repo/)).toBeTruthy()
  expect(await text(/Explore\s+Found 3 files/)).toBeTruthy()
  expect(await text(/main\s+reply/)).toBeFalsy()
  expect(await text(/user\s+second prompt/)).toBeTruthy()
  expect(await text(/^#2\s+\S+\s+user\s+also check the log/)).toBeTruthy()
  // A slash command typed at the prompt is the person's too, with its arguments.
  expect(await text(/user\s+\/model opus/)).toBeTruthy()
  expect(await text(/user\s+\/clear\s/)).toBeTruthy()
  expect(await text(/main\s+gh · issue/)).toBeFalsy()
  expect(await text(/PostToolUse/)).toBeFalsy()
  // Under hook, each hook that ran: how long, what ran, what it said; only what reached the model has an ↑, none a ↓.
  await $.ui.press({ plugin: 'session-lens', key: 'log-kind-hook', requestId: 'session-lens', surface: 'terminal' })
  // Its name starts with where it is written. A hook that put nothing into the context is not listed.
  expect(await text(/main\s+\[user\] UserPromptSubmit 5ms ~\/bin\/s…\s+100\s+-$/)).toBeTruthy()
  expect(await text(/main\s+\[plugin:guard\] PostToolUse…\s+10\s+-$/)).toBeTruthy() // cut to the Action column
  expect(await text(/Stop|PreToolUse/)).toBeFalsy()
  expect(await text(/main\s+Let me look at the repo/)).toBeFalsy()
  await $.ui.press({ plugin: 'session-lens', key: 'log-kind-tool', requestId: 'session-lens', surface: 'terminal' })
  expect(await text(/PostToolUse/)).toBeFalsy()
  // Under compact, the compactions alone; each opens a page of what the window restarted from, and goes back to the log.
  await $.ui.press({ plugin: 'session-lens', key: 'log-kind-compact', requestId: 'session-lens', surface: 'terminal' })
  expect((await rows()).map(r => r.text?.includes('compact'))).toEqual([true, true])
  await press(`cmp-${TC}|52000`)
  expect(await ui.find({ key: 'node-log-back' })).toBeFalsy()
  expect(await text(/^compact manual  \S+ · 52\.0k → 12\.0k · dropped 40\.0k · summarized in 1m01s$/)).toBeTruthy()
  // What every compaction attaches again, by name and size; what this one chose, whole.
  expect(await text(/^  instructions\s+≈2\.0k$/)).toBeTruthy()
  expect(await text(/^  hook_success\s+≈200$/)).toBeTruthy()
  // The system prompt and tools the first request after it was sent with, from the record: each tool by name and size.
  expect(await text(/^  system prompt\s+≈4$/)).toBeTruthy()
  expect(await text(/^  tools 2\s+≈4\.0k$/)).toBeTruthy()
  expect(await text(/^    Agent\s+≈3\.0k$/)).toBeTruthy()
  expect(await text(/original text not in the transcript/)).toBeFalsy()
  expect(await text(/^  tdd$/)).toBeTruthy()
  expect(await text(/^  src\/read\.ts$/)).toBeTruthy()
  expect(await text(/^Files referenced by path 1  contents not in the transcript$/)).toBeTruthy()
  expect(await text(/^  src\/app\.ts$/)).toBeTruthy()
  // The summary folds by section: the preamble, each numbered section, the closing words to the model; all start closed.
  const parts = await ui.findAll({ type: 'Button', text: /^  [▸▾] / })
  expect(parts.map(b => b.text).slice(0, 4)).toEqual(['  ▸ Preamble  3 lines', '  ▸ 1. Primary Request  1 lines', '  ▸ 2. Key Concepts  1 lines', '  ▸ Closing (instructions to the model)  2 lines'])
  expect(await text(/keep the lens tidy/)).toBeFalsy()
  await press('cmp-b2-s1')
  expect(await text(/^   keep the lens tidy$/)).toBeTruthy()
  expect(await text(/^   - folds$/)).toBeFalsy()
  expect(await text(/^Kept messages 2$/)).toBeTruthy()
  // In the order they were kept, each its latest copy, the one with no words left out, folded under who wrote it and how it starts.
  const kept = (await ui.findAll({ type: 'Button', text: /^  [▸▾] (assistant|user) / })).map(b => b.text)
  expect(kept).toEqual(['  ▸ assistant  2 lines · Fixing it.', '  ▸ user  1 lines · all green'])
  expect(await text(/^→ Bash/)).toBeFalsy()
  await press('cmp-b2-m0')
  const opened = (await ui.findAll({ type: 'Text', text: /^(Fixing it\.|→ Bash .*|all green|old copy)$/ })).map(t => t.text)
  expect(opened).toEqual(['Fixing it.', '→ Bash {"command":"ls"}'])
  await press('cmp-back')
  expect(await ui.find({ key: 'node-log-back' })).toBeTruthy()
  await press('log-back')
  expect(await ui.find({ key: 'node-ctx-grid' })).toBeTruthy()
  await ui.unmount()
})

test('a request is priced at its own model, each kind of token at its own rate', () => {
  const M = 1_000_000
  // To the hundredth of a cent, which floating point reaches.
  const cents = (x: number | object) => Math.round((typeof x === 'number' ? x : (usdOf(x as Parameters<typeof usdOf>[0]) ?? NaN)) * 10_000)
  // Opus 5.5: $4 in, $20 out, $0.20 a cache read; a write 1.25x input for five minutes, 2x for an hour.
  expect(cents({ i: M, o: M, cr: M, cw: 2 * M, c1: M, md: 'claude-opus-5-5' })).toBe(cents(4 + 20 + 0.2 + 5 + 8))
  // Without the split, a write is the five-minute kind.
  expect(cents({ i: 0, o: 0, cr: 0, cw: M, md: 'claude-opus-5-5' })).toBe(cents(5))
  // Fable 5.1 reads its cache at a quarter of Fable 5's; a dated id prices as its model.
  expect(cents({ i: 0, o: 0, cr: M, cw: 0, md: 'claude-fable-5-1' })).toBe(cents(0.25))
  expect(cents({ i: 0, o: 0, cr: M, cw: 0, md: 'claude-fable-5' })).toBe(cents(1))
  expect(cents({ i: 0, o: M, cr: 0, cw: 0, md: 'claude-haiku-4-5-20251001' })).toBe(cents(5))
  // Haiku 5.5 costs five times as much once the prompt passes 100K.
  expect(cents({ i: 100_000, o: 0, cr: 0, cw: 0, md: 'claude-haiku-5-5' })).toBe(cents(0.01))
  expect(cents({ i: 200_000, o: 0, cr: 0, cw: 0, md: 'claude-haiku-5-5' })).toBe(cents(0.1))
  expect(usdOf({ i: M, o: 0, cr: 0, cw: 0, md: 'gpt-x' })).toBeUndefined()
  expect(usdOf({ i: M, o: 0, cr: 0, cw: 0 })).toBeUndefined()
})


test('the total is what was measured, and the rest priced from the record and scaled by what the measure showed, model by model', () => {
  const cents = (x: number) => Math.round(x * 10_000)
  const at = (h: number) => h * 3_600_000
  // Two processes measured, the hours between them not: opus ran in all three, fable in the first and the last.
  const priced = [
    { ts: at(1), usd: 10, md: 'opus' },
    { ts: at(1), usd: 5, md: 'fable' },
    { ts: at(3), usd: 20, md: 'opus' },
    { ts: at(3), usd: 4, md: 'fable' },
    { ts: at(5), usd: 10, md: 'opus' },
    { ts: at(5), usd: 5, md: 'fable' },
  ]
  // The harness names each model's cost: opus 20% over its record, fable on it, and haiku's side requests the record never priced.
  const spends = [
    { start: at(0), end: at(2), usd: 17.15, byModel: { opus: 12, fable: 5, haiku: 0.15 } },
    { start: at(4), end: at(6), usd: 17.15, byModel: { opus: 12, fable: 5, haiku: 0.15 } },
  ]
  const ledger = ledgerOf(spends, priced)
  // haiku's $0.30 over the $30 recorded adds 1% to each model's ratio: opus ×1.21, fable ×1.01.
  expect(cents(ledger.ratios?.opus?.ratio ?? 0)).toBe(cents(1.21))
  expect(cents(ledger.ratios?.fable?.ratio ?? 0)).toBe(cents(1.01))
  // The hours between: opus $20 between 20 and 24.2, fable $4 between 4 and 4.04; each the midpoint, give or take half the gap.
  expect(cents(ledger.raw)).toBe(cents(24))
  expect(cents(ledger.estimated)).toBe(cents(22.1 + 4.02))
  expect(cents(ledger.pm)).toBe(cents(2.1 + 0.02))
  expect(cents(ledger.total)).toBe(cents(34.3 + 26.12))
  // Without the models named, the whole: $34.30 measured over $30 recorded.
  const whole = ledgerOf(spends.map(({ byModel: _, ...s }) => s), priced)
  expect(whole.ratios).toBeUndefined()
  expect(cents(whole.estimated)).toBe(cents((24 + 24 * 34.3 / 30) / 2))
  // A model the measure never saw takes the ratio of the whole.
  const late = ledgerOf(spends, [...priced, { ts: at(3), usd: 2, md: 'sonnet' }])
  expect(cents(late.ratios?.sonnet?.ratio ?? 0)).toBe(cents(34.3 / 30))
  expect(late.ratios?.sonnet?.isOwn).toBe(false)
  expect(late.ratios?.opus?.isOwn).toBe(true)
  // A measure that names no model is the whole's alone: it shares nothing out as side requests.
  const named = ledgerOf([...spends, { start: at(6.5), end: at(7.5), usd: 30, byModel: {} }], [...priced, { ts: at(7), usd: 30, md: 'opus' }])
  expect(cents(named.ratios?.opus?.ratio ?? 0)).toBe(cents(1.21))
  // Nothing measured: the record's price stands, unscaled; everything measured: nothing to estimate.
  expect(ledgerOf([], priced)).toMatchObject({ ratio: undefined, pm: 0, isFull: false })
  expect(cents(ledgerOf([], priced).total)).toBe(cents(54))
  expect(ledgerOf([{ start: 0, end: at(6), usd: 60 }], priced)).toMatchObject({ total: 60, pm: 0, isFull: true })
})

test('each stretch costs what the count reached less the reading written before it, a count to each chain', () => {
  const at = (h: number) => h * 3_600_000
  // One count across two exits and the process running now; the first exit was written twice, the second time with less.
  const exits: Parameters<typeof spendsOf>[0] = [
    { start: at(0), at: at(2), usd: 31, byModel: { opus: 23, fable: 8 } },
    { start: at(0), at: at(2), usd: 23, byModel: { opus: 23 } },
    { start: at(0), at: at(3), usd: 32, byModel: { opus: 24, fable: 8 } },
  ]
  // The process now took the count up from the last exit: it spent 20 of the 52, not 52.
  expect(spendsOf([...exits, { start: at(0), proc: at(3), at: at(5), usd: 52 }])).toEqual([
    { start: at(0), end: at(2), usd: 31, byModel: { opus: 23, fable: 8 } },
    { start: at(2), end: at(3), usd: 1, byModel: { opus: 1 } },
    { start: at(3), end: at(5), usd: 20 },
  ])
  // A /login starts another count; the one before stands as it was last read.
  expect(spendsOf([{ start: at(0), proc: at(0), at: at(1), usd: 5 }, { start: at(1), proc: at(0), at: at(2), usd: 3 }])).toEqual([
    { start: at(0), end: at(1), usd: 5 },
    { start: at(1), end: at(2), usd: 3 },
  ])
  // A process that died wrote nothing: what the lens read of it stays, as the next one took the count up from before it.
  // That one's own reading gives way to what it wrote as it exited.
  expect(
    spendsOf([
      { start: 0, at: at(1), usd: 10 },
      { start: 0, proc: at(1), at: at(2), usd: 12 },
      { start: 0, proc: at(3), at: at(4), usd: 13 },
      { start: 0, at: at(5), usd: 15 },
    ]),
  ).toEqual([
    { start: 0, end: at(1), usd: 10 },
    { start: at(1), end: at(2), usd: 2 },
    { start: at(2), end: at(5), usd: 5 },
  ])
})

test('turns until compaction: a line fitted through the window at the end of each turn', () => {
  // Steady growth: 10k a turn, 50k to go.
  expect(forecast([10_000, 20_000, 30_000, 40_000], 50_000)).toEqual({ turns: 5, slope: 10_000, n: 4, how: 'fit' })
  // A turn far off the line does not pull it: the median of the slope between every two turns. Least squares would make it 11.4k.
  expect(forecast([10_000, 20_000, 30_000, 90_000, 50_000, 60_000], 100_000)?.slope).toBe(10_000)
  // One big turn among small ones: the line stays near the trend, well under the big step.
  const uneven = forecast([10_000, 12_000, 14_000, 34_000, 36_000], 60_000)
  expect(uneven!.slope).toBeLessThan(20_000)
  expect(uneven!.turns).toBeGreaterThan(3)
  // Every turn since the last compaction counts, however many: twenty flat turns then ten that grow is a gentler line than the ten alone.
  const long = forecast([...Array.from({ length: 20 }, () => 0), 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10)
  expect(long?.n).toBe(30)
  expect(long!.slope).toBeLessThan(1)
  // Too few turns since the last compaction, or none of them growing: the mean of each turn's growth.
  expect(forecast([10_000, 20_000], 50_000, [4_000, 6_000, 20_000])).toEqual({ turns: 5, slope: 10_000, n: 3, how: 'mean' })
  expect(forecast([30_000, 20_000, 10_000], 50_000, [10_000])?.how).toBe('mean')
  // Nothing that grows anywhere, or nothing left to go: no guess.
  expect(forecast([10_000, 20_000], 50_000)).toBeUndefined()
  expect(forecast([10_000], 50_000, [-2_000, 1_000])).toBeUndefined()
  expect(forecast([10_000, 20_000, 30_000], 0)).toBeUndefined()
})

test('a waffle hands its hundred squares to the slices by size, the rounding left to the largest remainders', () => {
  const count = (squares: string[]) => squares.reduce<Record<string, number>>((n, c) => ({ ...n, [c]: (n[c] ?? 0) + 1 }), {})
  expect(count(waffle([{ v: 600, color: 'a' }, { v: 410, color: 'b' }]).map(s => s.color))).toEqual({ a: 59, b: 41 })
  expect(count(waffle([{ v: 1, color: 'a' }, { v: 1, color: 'b' }, { v: 1, color: 'c' }]).map(s => s.color))).toEqual({ a: 34, b: 33, c: 33 })
  // In the slices' order, row by row; an empty slice takes no square, and nothing at all draws nothing.
  expect(waffle([{ v: 0, color: 'z' }, { v: 3, color: 'a' }, { v: 1, color: 'b' }], 4).map(s => s.color)).toEqual(['a', 'a', 'a', 'b'])
  expect(waffle([{ v: 0, color: 'a' }])).toEqual([])
  // A slice raised to its one square has had its rounding: the square left over goes to the next largest remainder.
  expect(count(waffle([{ v: 336, color: 'a' }, { v: 334, color: 'b' }, { v: 323, color: 'c' }, { v: 7, color: 'd' }]).map(s => s.color))).toEqual({ a: 34, b: 33, c: 32, d: 1 })
})

test('failed dispatches group by their reason, the names it quotes left out', () => {
  expect(whyFailed("Agent type 'foo' not found. Available agents: a, b")).toBe('Agent type not found')
  expect(whyFailed('<tool_use_error>Agent type "bar" not found. Available agents: c</tool_use_error>')).toBe('Agent type not found')
  expect(whyFailed('')).toBe('no reason given')
})

test('a bar gives each value its share of the cells, and never runs past them however far the values go over', () => {
  expect(barCells([50, 25, 0], 100, 20)).toEqual([10, 5, 0])
  // Anything there at all is drawn; past the scale, the largest give cells up until the bar fits its line.
  expect(barCells([1, 99], 100, 10)).toEqual([1, 10 - 1])
  expect(barCells([310, 10], 243, 40).reduce((n, c) => n + c, 0)).toBeLessThanOrEqual(40)
  expect(barCells([1, 1, 1, 1], 4, 2)).toEqual([1, 1, 1, 1]) // one cell each is the least it draws
})

test('main\'s conversation is split by kind, scaled to what the API counts, with thinking guessed from the output', () => {
  const talk = { ...noChat(), replyCount: 2, replyTokens: 300, toolCount: 1, toolTokens: 900, userCount: 1, userTokens: 100, outputTokens: 500 }
  const parts = chatPartsOf(talk, 1000)
  // 1300 seen in a conversation of 1000: every kind shrinks by the same share, and nothing is left for thinking.
  expect(parts.slice(0, 3).map(p => [p.name, p.v, p.kind])).toEqual([['Tool calls & results ×1', 692, 'tool'], ['Assistant messages ×2', 231, 'reply'], ['User messages ×1', 77, 'user']])
  expect(parts.find(p => p.name === 'thinking (est.)')?.v).toBe(0)
  // With room to spare, thinking is what was written past the reply, and the rest is unaccounted.
  const roomy = chatPartsOf(talk, 2000)
  expect(roomy.find(p => p.name === 'thinking (est.)')?.v).toBe(200)
  expect(roomy.find(p => p.name === 'Other (unaccounted)')?.v).toBe(500)
  // The API's own figure for thinking is counted with the rest, and nothing is guessed.
  expect(chatPartsOf({ ...talk, thinkingTokens: 50 }, 2000).some(p => p.name === 'thinking (est.)')).toBe(false)
  expect(parts.map(p => p.key)).toEqual(parts.map((_, n) => `chat-${n}`))
})

test('a subagent\'s window is its init, then tool calls and skills shrunk to fit what is left, then the rest', () => {
  const run = { turns: 1, steps: 2, last: 1000, peak: 1000, output: 0, input: 0, cacheRead: 0, cacheWrite: 0, init: 400, tools: { Read: { calls: 1, read: 500, wrote: 100 } }, skills: { s: { count: 1, tokens: 300 } } } as unknown as AgentRun
  expect(subPartsOf(run, 0).map(p => [p.key, p.v, p.approx])).toEqual([['init', 400, false], ['tools', 400, true], ['skills', 200, true], ['rest', 0, true]])
  // One that never sent a request: its init is its prompt, with the system prompt and tools once they are read.
  const unsent = { ...run, init: undefined, last: 0, tools: {}, skills: {} } as AgentRun
  expect(subPartsOf(unsent, 120, { system: 'abcd', tools: [{ name: 'Read', tokens: 30 }] }).find(p => p.key === 'init')).toEqual({ key: 'init', name: 'init (system prompt · tools · task)', v: 151, approx: true })
})

test('a forked skill counts as main\'s, merged into its row, and hooks group by event and where they are written', () => {
  const run = { turns: 1, steps: 1, last: 0, peak: 0, output: 0, input: 0, cacheRead: 0, cacheWrite: 0, tools: { Read: { calls: 2, read: 10, wrote: 1 }, mcp__plugin_x__q: { calls: 1, read: 5, wrote: 2 } }, skills: { 'review (fork)': { count: 1, tokens: 0 } } } as unknown as AgentRun
  const fork = (startedAt: string, call: number, report: number) => ({ type: 'general-purpose', description: '', status: 'completed', skill: 'review', startedAt, call, report }) as AgentMeta
  const hook = (ts: string, name: string, src: string, i: number, agent = 'main') => ({ ts, who: 'main', depth: 0, kind: 'hook', name, o: 0, i, src, agent }) as EventRow
  const u = usesOf('main', run, true, {
    known: {},
    listed: [{ name: 'review', source: 'plugin' }],
    who: { a: fork('2026-01-01T00:00:02Z', 30, 40), b: fork('2026-01-01T00:00:00Z', 7, 7) },
    kids: ['a', 'b'],
    log: [hook('2026-01-01T00:00:03Z', 'PreToolUse:Bash', 'guard', 5), hook('2026-01-01T00:00:04Z', 'PreToolUse:Bash', 'guard', 6), hook('2026-01-01T00:00:00Z', 'SessionStart', 'init', 9), hook('2026-01-01T00:00:05Z', 'Stop', 'x', 1, 'sub')],
    since: '2026-01-01T00:00:01Z',
  })
  expect(u.toolRows).toEqual([{ name: 'Read', count: 2, sent: 1, back: 10, scope: 'built-in' }])
  expect(u.mcpRows).toEqual([{ name: 'mcp__plugin_x__q', count: 1, sent: 2, back: 5, scope: 'plugin' }])
  // Only the fork since the last compaction counts, merged into the row the record already has.
  expect(u.skillRows).toEqual([{ name: 'review (fork)', count: 2, back: 40, sent: 30, scope: '?' }])
  // Main's hooks before the compaction and another agent's are left out.
  expect(u.hookRows).toEqual([{ name: 'guard · Bash', count: 2, back: 11, scope: 'PreToolUse' }])
})

test('the forecast reads turns since the last compaction, and growth that no compaction falls in', () => {
  const turn = (ctx: number, endedAt: string) => ({ ctx, endedAt }) as TurnRow
  const past = [turn(100, 't1'), turn(300, 't3'), turn(150, 't5'), turn(250, 't6')]
  const { ends, steps } = forecastInputs(past, [{ ts: 't4' } as Compaction])
  expect(ends).toEqual([150, 250])
  // The step from t3 to t5 spans the compaction at t4.
  expect(steps).toEqual([200, 100])
  expect(forecastInputs(past, []).ends).toEqual([100, 300, 150, 250])
})

test('agents form a tree by who launched them, oldest first, and the session adds main to every one of them', () => {
  const meta = (startedAt: string, parentId?: string, status = 'completed') => ({ type: 'Explore', description: '', status, startedAt, ...(parentId ? { parentId } : {}) })
  const run = (steps: number, input: number, output: number, usd?: number) => ({ turns: 1, steps, last: 0, peak: 0, output, input, cacheRead: 0, cacheWrite: 0, tools: {}, skills: {}, ...(usd === undefined ? {} : { usd }) })
  const who = { b: meta('2026-01-01T00:00:02Z', 'a', 'running'), a: meta('2026-01-01T00:00:01Z'), c: meta('2026-01-01T00:00:03Z', 'gone') }
  const t = agentTreeOf(who, { a: run(2, 100, 10, 0.5), b: run(1, 50, 5) }, run(3, 1000, 100, 1))
  expect(t.ids).toEqual(['a', 'b', 'c'])
  // A parent the session does not know puts its child at the top.
  expect(t.kidsOf(undefined)).toEqual(['a', 'c'])
  expect(t.kidsOf('a')).toEqual(['b'])
  expect(t.running).toEqual(['b'])
  expect(t.runOf('c')).toBeUndefined()
  expect(t.whole).toEqual({ steps: 6, i: 1150, o: 115 })
  expect(t.subTotal).toBe(165)
  expect(t.usd).toBe(1.5)
  expect(agentTreeOf({}, {}, null).whole).toEqual({ steps: 0, i: 0, o: 0 })
})

test('estimates that add up to more than the window holds are scaled down together to the measured figure', () => {
  expect(fitWithin([600, 300, 100], 500)).toEqual([300, 150, 50])
  expect(fitWithin([60, 30], 500)).toEqual([60, 30])
  expect(fitWithin([], 500)).toEqual([])
})

// A request's bar starts when it is sent, not when its reply is written: the first with the prompt, a later one as the
// tool result before it lands. A request sent that no reply has answered yet is in flight, drawn as one still running.
test('a live turn always has main working: from its start, or its last request on when the record shows nothing out, to now', () => {
  const done = { who: 'main', depth: 0, no: 1, label: 'Bash', startMs: 1000, ms: 2000, i: 10, o: 5, n: 1 }
  const sub = { who: 'Explore', depth: 1, label: 'scan', startMs: 1500, ms: 500, i: 1, o: 1, n: 1, running: true }
  expect(liveReqsOf([done, sub], 9000).at(-1)).toEqual({ who: 'main', depth: 0, no: 2, label: 'awaiting reply', startMs: 3000, ms: 6000, i: 0, o: 0, n: 0, running: true })
  // A request already out is the one: none is added, and it runs to now.
  const out = { ...done, no: 2, startMs: 3000, ms: 0, running: true }
  expect(liveReqsOf([done, out], 9000)).toEqual([done, { ...out, ms: 6000 }])
  // Before its first request the turn is working from its start.
  expect(liveReqsOf([], 9000)).toEqual([{ who: 'main', depth: 0, no: 1, label: 'awaiting reply', startMs: 0, ms: 9000, i: 0, o: 0, n: 0, running: true }])
})

test('a request lies on the turn clock from when it was sent, and one in flight is drawn running', () => {
  const at = (s: number) => `2026-01-01T00:00:${String(s).padStart(2, '0')}.000Z`
  const step = { i: 1, o: 1, cr: 0, cw: 0 }
  const rows = [
    { t: 'user', id: null, o: 'human', pv: 'go', ts: at(0), u: null, c: [{ k: 'text', n: 2 }] },
    // The model thought for ten seconds before its reply was written.
    { t: 'assistant', id: 'a', ts: at(10), u: step, c: [{ k: 'use', id: 't1', name: 'Bash', n: 4 }] },
    { t: 'user', id: null, ts: at(14), u: null, c: [{ k: 'res', id: 't1', n: 4 }] },
    { t: 'assistant', id: 'b', ts: at(16), u: step, c: [{ k: 'use', id: 't2', name: 'Read', n: 4 }] },
    { t: 'user', id: null, ts: at(17), u: null, c: [{ k: 'res', id: 't2', n: 4 }] },
  ] as unknown as Parameters<typeof turnsOf>[0]
  const reqs = (turnsOf(rows, {}, {}, {})[0]?.reqs ?? []).map(r => [r.no, r.label, r.startMs / 1000, r.ms / 1000, r.running ?? false])
  expect(reqs).toEqual([
    [1, 'Bash', 0, 14, false],
    [2, 'Read', 14, 3, false],
    [3, 'awaiting reply', 17, 0, true],
  ])
  // Answered, nothing is in flight; an older turn never is.
  const answered = [...rows, { t: 'assistant', id: 'c', ts: at(20), u: step, c: [{ k: 'text', n: 4 }] }] as typeof rows
  expect((turnsOf(answered, {}, {}, {})[0]?.reqs ?? []).map(r => r.label)).toEqual(['Bash', 'Read', 'text'])
  expect(turnsOf(answered, {}, {}, {})[0]?.open).toBeUndefined()
  // A tool called and not yet back keeps the turn open, main working from the reply that called it.
  const calling = [...rows, { t: 'assistant', id: 'c', ts: at(20), u: step, c: [{ k: 'use', id: 'u9', name: 'Bash', n: 4 }] }] as typeof rows
  expect(turnsOf(calling, {}, {}, {})[0]?.open).toBe(true)
  expect((turnsOf(calling, {}, {}, {})[0]?.reqs ?? []).at(-1)?.running).toBe(true)
  const older = [...rows, { t: 'user', id: null, o: 'human', pv: 'next', ts: at(30), u: null, c: [{ k: 'text', n: 2 }] }, { t: 'assistant', id: 'd', ts: at(31), u: step, c: [] }] as typeof rows
  expect((turnsOf(older, {}, {}, {})[0]?.reqs ?? []).some(r => r.running)).toBe(false)
})

// Requests sent one after another, at no round second: each bar starts where the last one ended, the lane one run with no cell left out.
test('bars of requests sent one after another meet end to end on the lane', () => {
  const sends = [0, 6137, 7373, 8611, 9849, 11083, 12321]
  const total = 13557
  for (const laneW of [37, 50, 61, 73, 88]) {
    const spans = sends.slice(0, -1).map((at, n) => laneSpan(at, (sends[n + 1] ?? at) - at, total, laneW))
    spans.slice(1).forEach((s, n) => expect(s.a).toBe((spans[n]?.a ?? 0) + (spans[n]?.b ?? 0)))
  }
  // A request too short for a cell still shows as one, and none runs past the lane's end.
  expect(laneSpan(5000, 1, 10000, 20)).toEqual({ a: 10, b: 1 })
  expect(laneSpan(9990, 5000, 10000, 20)).toEqual({ a: 19, b: 1 })
})

test('a request in a waterfall is one of four colours: the longest, the shortest, the one working, the rest', () => {
  const req = (no: number, startMs: number, ms: number, running = false) => ({ who: 'main', depth: 0, no, label: `r${no}`, startMs, ms, i: 0, o: 0, n: 0, running })
  const reqs = [req(1, 0, 1000), req(2, 1000, 100), req(3, 1100, 500), req(4, 1600, 300, true)]
  const { barOf } = barsOf(reqs, 2000, 40)
  // Clay the longest, Cactus the shortest, Plum the rest; the one still working, neither longest nor shortest, Grey 250.
  expect(reqs.map(r => barOf(r).color)).toEqual([T.rank.longest, T.rank.shortest, T.actor.main, T.rank.working])
  // Once it has run the longest, it takes the longest's colour.
  const late = [...reqs.slice(0, 3), req(4, 1600, 2000, true)]
  expect(late.map(r => barsOf(late, 3600, 40).barOf(r).color)).toEqual([T.actor.main, T.rank.shortest, T.actor.main, T.rank.longest])
})
