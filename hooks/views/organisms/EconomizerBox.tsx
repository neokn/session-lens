import type { Economizer } from '../../../types'
import { Fold } from '../atoms/Fold'
import { cut, fit, k, left } from '../layout'
import { S, SPACE, T } from '../palette'
import type { UI } from '../ui'

type Group = { name: string; count: number }

// What TokenEconomizer did in this repository, and what it is about to do. It only tells: what changes anything is the
// other plugin's own command, named here for the person to run.
export function EconomizerBox({ ui, width: W, e, summary, leftOut, waiting, note, isOpen, onToggle }: { ui: UI; width: number; e: Economizer; summary: string; leftOut: Group[]; waiting: Group[]; note: string; isOpen: boolean; onToggle: () => unknown }) {
  const { Box, Text } = ui
  const room = W - 4 - SPACE.indent
  const line = (label: string, said: string) => (
    <Text key={`te-${label}`}>
      <Text color={T.text.muted}>{fit(label, 12)}</Text>
      {cut(said, room - 12)}
    </Text>
  )
  const groups = (title: string, list: Group[], total: number, said: string) =>
    total === 0 ? null : (
      <Box key={`te-${title}`} flexDirection="column" paddingLeft={SPACE.indent}>
        <Text>
          <Text {...S.figure}>{`${total} `}</Text>
          <Text color={T.text.muted}>{cut(`${title}${said ? ` · ${said}` : ''}`, room - SPACE.indent - 8)}</Text>
        </Text>
        {list.map(g => (
          <Text key={`te-${title}-${g.name}`} color={T.text.muted}>{`${fit(g.name, Math.max(8, room - SPACE.indent - 6))}${left(String(g.count), 6)}`}</Text>
        ))}
      </Box>
    )
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={W}>
      <Fold ui={ui} key="node-economizer" indent={0} isOpen={isOpen} title="TokenEconomizer" summary={summary} room={W - 4} onToggle={onToggle} />
      {isOpen ? (
        <Box flexDirection="column" paddingLeft={SPACE.indent}>
          {line('Tools', `${e.tools.mode} · ${e.tools.prompts} prompts over ${e.tools.sessions} sessions watched`)}
          {groups('left out', leftOut, e.tools.applied.length, '')}
          {groups('waiting to be left out', waiting, e.tools.waiting.length, note)}
          {line('Facts', `${e.facts.mode} · ${e.facts.count} injected at session start`)}
          {line('Loop guard', `${e.loop.mode} · ${e.loop.redirects} redirects, ${e.loop.stuck} still stuck over ${e.turns} turns`)}
          {line('Its cost', `≈${k(Math.round(e.overhead.tokens))} tokens, ${(e.overhead.share * 100).toFixed(1)}% over ${e.sessions} sessions`)}
          {e.warnings.map(w => <Text key={`te-warn-${w}`} {...S.danger}>{cut(w, room)}</Text>)}
          {e.tools.applied.length + e.tools.waiting.length > 0 ? <Text color={T.text.muted}>{cut('Look or change: /tokeneconomizer:toolprune (restore, apply)', room)}</Text> : null}
        </Box>
      ) : null}
    </Box>
  )
}
