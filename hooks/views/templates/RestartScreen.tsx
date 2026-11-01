import type { Compaction, Restart } from '../../../types'
import { summaryParts } from '../../digest/summary'
import { estimateTokens } from '../../digest/record'
import { fit, fmtTime, k, left, span, toolLabel } from '../layout'
import { Spacer } from '../atoms/Spacer'
import { G, S, SPACE, T } from '../palette'
import type { UI } from '../ui'

/** What the page lends the screen: its paging and its folds. */
export type RestartHost = {
  paged: <T>(key: string, list: T[]) => T[]
  more: (key: string, total: number, indent: number) => JSX.Element
  fold: (key: string, indent: number, title: string, summary: string, room: number, color?: string) => JSX.Element
  isOpen: (key: string) => boolean
}

/** The screen behind one compaction: what it reattached, what it kept, its summary in sections and the messages it kept,
 * each a fold of its own. `got` is what was read of the record for this compaction, or null before the read starts. */
export function RestartScreen({ ui, host, c, got, width, rowWidth, onBack }: {
  ui: UI
  host: RestartHost
  c: Compaction
  got: { status: string; detail?: string; data?: Restart } | null
  width: number
  rowWidth: number
  onBack: () => unknown
}) {
  const { Box, Text, Button } = ui
  const data = got?.data
  // A kept message with no words (a hook that printed nothing) has nothing to show.
  const kept = (data?.kept ?? []).filter(m => m.text.trim() !== '')
  // Text the compaction chose is printed whole, line by line.
  const whole = (key: string, text: string) => text.split('\n').map((line, n) => <Text key={`${key}-${n}`}>{line === '' ? ' ' : line}</Text>)
  const head = (label: string, note = '') => (
    <Text>
      <Text bold>{label}</Text>
      <Text color={T.text.muted}>{note}</Text>
    </Text>
  )
  const names = (key: string, list: string[]) => list.map((x, n) => <Text key={`${key}-${n}`} color={T.text.muted}>{`  ${x}`}</Text>)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={width}>
      <Button plain key="node-cmp-back" label={`${G.back} Back`} onPress={onBack} />
      <Text>
        <Text bold color={T.cost.spend}>{`compact ${c.trigger === 'auto' ? 'auto' : 'manual'}`}</Text>
        <Text color={T.text.muted}>{`  ${fmtTime(c.ts)} · ${k(c.pre)} → ${k(c.post)} · dropped ${k(Math.max(0, c.pre - c.post))}${c.ms !== undefined ? ` · summarized in ${span(c.ms)}` : ''}`}</Text>
      </Text>
      <Spacer ui={ui} />
      {!got || got.status === 'pending' ? <Text {...S.live}>Loading…</Text> : null}
      {got?.status === 'error' ? <Text color={T.state.danger}>{`Could not read this compaction: ${got.detail}`}</Text> : null}
      {data ? (
        <Box flexDirection="column">
          <Text bold color={T.actor.main}>Reattached after every compaction</Text>
          {data.fixed.map(x => (
            <Text key={`cmp-x-${x.name}`} color={T.text.muted}>{`  ${fit(x.name, 30)}${left(`≈${k(x.tokens)}`, 8)}`}</Text>
          ))}
          {data.shape ? (
            <Box flexDirection="column">
              <Text color={T.text.muted}>{`  ${fit('system prompt', 30)}${left(`≈${k(estimateTokens(data.shape.system))}`, 8)}`}</Text>
              <Text color={T.text.muted}>{`  ${fit(`tools ${data.shape.tools.length}`, 30)}${left(`≈${k(data.shape.tools.reduce((n, t) => n + t.tokens, 0))}`, 8)}`}</Text>
              {host.paged('cmp-tools', [...data.shape.tools].sort((a, b) => b.tokens - a.tokens)).map(t => (
                <Text key={`cmp-t-${t.name}`} color={T.text.muted}>{`    ${fit(toolLabel(t.name), 28)}${left(`≈${k(t.tokens)}`, 8)}`}</Text>
              ))}
              {host.more('cmp-tools', data.shape.tools.length, 4)}
            </Box>
          ) : (
            <Text color={T.text.muted}>  system prompt · tools: not in the transcript, see /context for sizes</Text>
          )}
          <Spacer ui={ui} />
          <Text bold color={T.actor.main}>Kept by this compaction</Text>
          {data.skills.length > 0 ? head(`Invoked skills ${data.skills.length}`) : null}
          {names('cmp-k', data.skills)}
          {data.files.length > 0 ? head(`Files re-read ${data.files.length}`) : null}
          {names('cmp-f', data.files)}
          {data.refs.length > 0 ? head(`Files referenced by path ${data.refs.length}`, '  contents not in the transcript') : null}
          {names('cmp-r', data.refs)}
          <Spacer ui={ui} />
          {head(`Summary ≈${k(c.summary ?? 0)}`)}
          {summaryParts(data.summary).map((part, n) => {
            const key = `cmp-${c.uuid ?? ''}-s${n}`
            const body = part.lines.join('\n').replace(/^\n+|\n+$/g, '')
            return (
              <Box key={key} flexDirection="column">
                {host.fold(key, 2, part.title, `${body ? body.split('\n').length : 0} lines`, rowWidth, part.isAside ? undefined : T.actor.main)}
                {host.isOpen(key) && body ? <Box flexDirection="column" paddingLeft={SPACE.indent * 2}>{whole(key, body)}</Box> : null}
              </Box>
            )
          })}
          <Spacer ui={ui} />
          {head(`Kept messages ${kept.length}`)}
          {kept.map((m, n) => {
            // Each kept message folds on its own, named by who wrote it and how it starts.
            const key = `cmp-${c.uuid ?? ''}-m${n}`
            const body = m.text.replace(/^\n+|\n+$/g, '')
            const first = body.split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? ''
            return (
              <Box key={key} flexDirection="column">
                {host.fold(key, 2, m.role, `${body.split('\n').length} lines · ${first}`, rowWidth, T.actor.sub)}
                {host.isOpen(key) ? <Box flexDirection="column" paddingLeft={SPACE.indent * 2}>{whole(key, body)}</Box> : null}
              </Box>
            )
          })}
        </Box>
      ) : null}
    </Box>
  )
}
