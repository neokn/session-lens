import type { Shape, Snapshot } from '../../../types'
import { estimateTokens } from '../../digest/record'
import { cut, fit, k, left, width } from '../layout'
import { G, S, SPACE, T } from '../palette'
import type { UI } from '../ui'

export type InitKind = 'skills' | 'mcp' | 'agents' | 'memory' | 'system' | 'tools' | 'instructions'

/** Something read on demand: still being read, failed, or here. */
export type Read<D> = { status: string; data?: D; detail?: string }

/** What the page lends the screen: its paging, its folds, and the press that opens a memory file. */
export type InitHost = {
  paged: <T>(key: string, list: T[]) => T[]
  more: (key: string, total: number, indent: number) => JSX.Element
  bounded: (key: string, pad: string, lines: { head?: boolean; text: string; note?: string }[]) => (JSX.Element | null)[]
  fold: (key: string, indent: number, title: string, summary: string, room: number, color?: string) => JSX.Element
  isOpen: (key: string) => boolean
  openMemory: (path: string, key?: string) => () => unknown
}

/** The screen behind one line of the context bar that holds the session's setup (skills, MCP tools, agents, memory, the
 * system prompt, tools, MCP instructions): what is in it, largest first, each list paged on its own. */
export function InitScreen({ ui, host, name, kind, width: screenWidth, rowWidth, contextNote, snap, shape, memOf, instructionsOf, onBack }: {
  ui: UI
  host: InitHost
  name: string
  kind: InitKind
  width: number
  rowWidth: number
  contextNote?: string
  snap: Pick<Snapshot, 'skills' | 'mcpTools' | 'agents' | 'memory'>
  shape: Read<Shape | null> | null
  memOf: Record<string, Read<string> | undefined>
  instructionsOf: Read<{ name: string; text: string }[]> | null | undefined
  onBack: () => unknown
}) {
  const { Box, Text, Button } = ui
  const got = shape
  const RW = rowWidth - 2 - 10
  const row = (key: string, label: string, tokens: number, note = '') => (
    <Text key={key}>
      {`  ${fit(cut(label, RW - width(note)), RW - width(note))}`}
      <Text color={T.text.muted}>{`${note}${left(k(tokens), 10)}`}</Text>
    </Text>
  )
  const head = (key: string, label: string, note: string) => (
    <Text key={key}>
      <Text bold color={T.actor.main}>{label}</Text>
      <Text color={T.text.muted}>{`  ${note}`}</Text>
    </Text>
  )
  const byTokens = <T extends { tokens: number }>(list: T[]) => [...list].sort((a, b) => b.tokens - a.tokens)
  // The largest group first, and in each its rows largest first, every group paged on its own.
  const grouped = <T extends { tokens: number }>(key: string, list: T[], by: (x: T) => string, line: (x: T, n: number) => JSX.Element, note: (xs: T[]) => string) => {
    const names = [...new Set(list.map(by))]
    const groups = names.map(g => {
      const xs = byTokens(list.filter(x => by(x) === g))
      return { g, xs, sum: xs.reduce((n, x) => n + x.tokens, 0) }
    })
    return groups.sort((a, b) => b.sum - a.sum).flatMap(({ g, xs, sum }) => [
      head(`${key}-${g}`, g || 'unknown', `${note(xs)} · ${k(sum)}`),
      ...host.paged(`${key}-${g}`, xs).map(line),
      host.more(`${key}-${g}`, xs.length, 2),
    ])
  }
  // What /context names but does not list is read from the request main sent.
  const shaped = (draw: (shape: Shape) => (JSX.Element | null)[]) =>
    !got || got.status === 'pending'
      ? [<Text {...S.live}>Loading…</Text>]
      : got.status === 'error'
        ? [<Text color={T.state.danger}>{`Could not read main's system prompt: ${got.detail}`}</Text>]
        : got.data
          ? draw(got.data)
          : [<Text color={T.text.muted}>Main's system prompt and tools are not in the transcript</Text>]
  const linesOf = (text: string) => text.split('\n').map(text => ({ text }))
  // An index such as auto-memory's MEMORY.md links each entry as `- [Title](file.md) — hook`: the entry opens into the
  // file it links, read as its fold first opens, and so on down, never into a file already open above it.
  const memoryBody = (key: string, path: string, indent: number, above: string[]): (JSX.Element | null)[] => {
    const pad = ' '.repeat(indent)
    const text = memOf[path]
    if (!text || text.status === 'pending') return [<Text key={`${key}-wait`} {...S.live}>{`${pad}Loading…`}</Text>]
    if (text.status === 'error') return [<Text key={`${key}-err`} color={T.state.danger}>{`${pad}Could not read it: ${text.detail}`}</Text>]
    const dir = path.slice(0, path.lastIndexOf('/') + 1)
    const lines = (text.data ?? '').split('\n')
    return [
      ...host.paged(key, lines).map((line, n) => {
        const link = /^\s*[-*]\s+\[([^\]]+)\]\(([^)\s]+\.md)\)\s*(.*)$/.exec(line)
        const target = link?.[2] && !/^[a-z]+:/i.test(link[2]) ? (link[2].startsWith('/') ? link[2] : `${dir}${link[2]}`) : undefined
        if (!link || target === undefined || above.includes(target)) return <Text key={`${key}-${n}`}>{`${pad}${line === '' ? ' ' : line}`}</Text>
        const sub = `${key}>${target}`
        return (
          <Box key={`${key}-${n}`} flexDirection="column">
            <Button plain key={`node-${sub}`} onPress={host.openMemory(target, sub)}>
              {`${pad}${host.isOpen(sub) ? G.open : G.shut} `}
              <Text bold>{link[1]}</Text>
              <Text color={T.text.muted}>{`  ${cut(link[3] ?? '', Math.max(8, rowWidth - indent - width(link[1] ?? '') - 6))}`}</Text>
            </Button>
            {host.isOpen(sub) ? memoryBody(sub, target, indent + SPACE.indent, [...above, target]) : null}
          </Box>
        )
      }),
      host.more(key, lines.length, indent),
    ]
  }
  const bodies: Record<InitKind, () => (JSX.Element | null)[]> = {
    skills: () => grouped('init-skills', snap.skills, s => s.source, (s, n) => row(`init-skill-${s.source}-${n}`, s.name, s.tokens), xs => `${xs.length} skills`),
    mcp: () =>
      grouped(
        'init-mcp',
        snap.mcpTools,
        t => t.server,
        (t, n) => row(`init-mcp-${t.server}-${n}`, t.name.split('__').slice(2).join('__') || t.name, t.tokens, fit(t.isLoaded ? 'loaded' : 'deferred', 10)),
        xs => `${xs.filter(t => t.isLoaded).length} loaded · ${xs.filter(t => !t.isLoaded).length} deferred`,
      ),
    agents: () => {
      const list = byTokens(snap.agents)
      return [...host.paged('init-agents', list).map((a, n) => row(`init-agent-${n}`, a.name, a.tokens, fit(a.source, 18))), host.more('init-agents', list.length, 2)]
    },
    memory: () => {
      const list = byTokens(snap.memory)
      return [
        ...host.paged('init-memory', list).map(f => {
          const key = `init-mem-${f.path}`
          const text = memOf[f.path]
          return (
            <Box key={key} flexDirection="column">
              <Button plain key={`node-${key}`} onPress={host.openMemory(f.path)}>
                {`${host.isOpen(key) ? G.open : G.shut} `}
                <Text bold>{cut(f.path, Math.max(8, rowWidth - 24))}</Text>
                <Text color={T.text.muted}>{`  ${f.type ? `${f.type} · ` : ''}${k(f.tokens)}`}</Text>
              </Button>
              {host.isOpen(key) ? memoryBody(key, f.path, 4, [f.path]) : null}
            </Box>
          )
        }),
        host.more('init-memory', list.length, 0),
      ]
    },
    system: () => shaped(shape => host.bounded('init-system', '  ', linesOf(shape.system))),
    tools: () =>
      shaped(shape => {
        const list = byTokens(shape.tools.filter(t => !t.name.startsWith('mcp__')))
        return [...host.paged('init-tools', list).map((t, n) => row(`init-tool-${n}`, t.name, t.tokens)), host.more('init-tools', list.length, 2)]
      }),
    // Each server's instructions, as main's attachments hold them now, a fold each, the largest first; a record
    // with none of those attachments may hold them as a section of main's system prompt, under a heading of its own.
    instructions: () => {
      if (!instructionsOf || instructionsOf.status === 'pending') return [<Text {...S.live}>Loading…</Text>]
      if (instructionsOf.status === 'error') return [<Text color={T.state.danger}>{`Could not read the servers' instructions: ${instructionsOf.detail}`}</Text>]
      const servers = byTokens((instructionsOf.data ?? []).map(x => ({ ...x, tokens: estimateTokens(x.text) })))
      if (servers.length > 0)
        return [
          ...host.paged('init-instructions', servers).map(x => {
            const key = `init-ins-${x.name}`
            const body = x.text.replace(/^## .*\n/, '').replace(/^\n+|\n+$/g, '')
            return (
              <Box key={key} flexDirection="column">
                {host.fold(key, 0, x.name, `≈${k(x.tokens)} · ${body.split('\n').length} lines`, rowWidth)}
                {host.isOpen(key) ? host.bounded(key, '    ', linesOf(body)) : null}
              </Box>
            )
          }),
          host.more('init-instructions', servers.length, 0),
        ]
      return shaped(shape => {
        const lines = shape.system.split('\n')
        const at = lines.findIndex(line => /^# MCP Server Instructions\s*$/i.test(line))
        if (at < 0) return [<Text color={T.text.muted}>The transcript holds no MCP server's instructions</Text>]
        const end = lines.findIndex((line, n) => n > at && /^# /.test(line))
        return host.bounded('init-instructions', '  ', lines.slice(at + 1, end < 0 ? undefined : end).map(text => ({ text })))
      })
    },
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={screenWidth}>
      <Button plain key="node-init-back" label={`${G.back} Back`} onPress={onBack} />
      <Text>
        <Text bold>{name}</Text>
        <Text color={T.text.muted}>{contextNote ? `  ${contextNote}` : ''}</Text>
      </Text>
      {bodies[kind]()}
    </Box>
  )
}
