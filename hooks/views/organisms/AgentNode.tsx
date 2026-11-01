import { cut } from '../layout'
import { T, G, S } from '../palette'
import type { UI } from '../ui'

// A subagent's head: the tree's lines before it, its name and task, its model, how it stands and its counts. Open, the
// tiles under it say the model and the counts, so the head keeps the name and the state.
export type AgentHead = { lead: string; name: string; desc: string; descRoom: number; model: string; status: string; runIo: string; onToggle: () => unknown }

/** One agent in the tree: its head (none for main), its dispatch line, what it shows open (`body`), what it shows open or
 * shut (`tail`, its shells), and the lines down the left of everything under the head, cut to its height: the line to its
 * next sibling and the line to its own children run past all of it, main's too. */
export function AgentNode({ ui, nodeKey, head, isOpen, isRunning, color, meta, pad, rowWidth, rails, body, tail = [] }: { ui: UI; nodeKey: string; head?: AgentHead; isOpen: boolean; isRunning: boolean; color: string; meta: string; pad: number; rowWidth: number; rails: string; body: JSX.Element | null; tail?: JSX.Element[] }) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column">
      {head ? (
        <Button plain key={`node-${nodeKey}`} onPress={head.onToggle}>
          {`${head.lead}${isOpen ? G.open : G.shut} `}
          <Text {...S.name} color={color}>{head.name}</Text>
          {head.desc ? <Text color={T.text.muted}>{` ${cut(head.desc, head.descRoom)}`}</Text> : ''}
          <Text color={T.text.muted}>{isOpen ? ' ' : ` ${head.model} `}</Text>
          {isRunning ? <Text {...S.live}>{head.status}</Text> : <Text color={T.state.done}>{head.status}</Text>}
          {isOpen ? '' : <Text color={T.text.muted}>{'  '}</Text>}
          {isOpen ? '' : head.runIo}
        </Button>
      ) : null}
      {meta ? <Text color={T.text.muted}>{`${' '.repeat(pad)}${cut(meta, rowWidth - pad)}`}</Text> : null}
      {body}
      {tail}
      {rails.includes('│') && (!head || isOpen || meta || tail.length > 0) ? (
        <Box position="absolute" left={0} top={head ? 1 : 0} bottom={0} width={rails.length} overflow="hidden">
          <Text color={T.text.muted}>{Array.from({ length: 400 }, () => rails).join('\n')}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
