import { Fold } from '../atoms/Fold'
import { cut } from '../layout'
import { T, G, SPACE } from '../palette'
import type { UI } from '../ui'

// The box keeps one height while the turn runs and after: a row for how it stands, and
// the waterfall's head, its newest 10 requests and the row that shows more. What it lacks is left blank at the bottom,
// so the waterfall sits under the title; only more, asked for, makes it taller.
const STATUS_ROWS = 1
const WATERFALL_ROWS = 12

/** The turn running now, or the last one: its prompt as the title, how it stands, and its
 * requests (`waterfall`, drawn in `waterfallRows` rows), or none yet. Folded, it keeps `lane`: its requests on one lane.
 * A subagent's own timeline is the same box (`nodeKey`), its height its own (`isFixed` false), done as `Done`. */
export function TurnBox({ ui, width, title, isRunning, hasTurn, isComplete, waterfall, waterfallRows, isOpen, onToggle, lane = null, nodeKey = 'node-live', summary = '', isFixed = true, doneText = 'Turn complete' }: { ui: UI; width: number; title: string; isRunning: boolean; hasTurn: boolean; isComplete: boolean; waterfall: JSX.Element | null; waterfallRows: number; isOpen: boolean; onToggle: () => unknown; lane?: JSX.Element | null; nodeKey?: string; summary?: string; isFixed?: boolean; doneText?: string }) {
  const { Box, Text } = ui
  const status = isComplete ? [<Text color={T.state.done}>{`${G.done} ${doneText}`}</Text>] : []
  const pad = isFixed ? Math.max(0, STATUS_ROWS - status.length + Math.max(0, WATERFALL_ROWS - waterfallRows)) : 0
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={isRunning ? T.state.live : T.text.muted} paddingX={SPACE.inset} width={width}>
      <Fold ui={ui} key={nodeKey} indent={0} isOpen={isOpen} title={cut(title, width - 8 - (summary ? summary.length + 2 : 0))} summary={summary} room={width - 4} color={isRunning ? T.state.live : hasTurn ? T.state.done : undefined} onToggle={onToggle} />
      {isOpen ? (
        <Box flexDirection="column">
          {status}
          {waterfall ?? <Text color={T.text.muted}>No requests yet</Text>}
          {Array.from({ length: pad }, (_, i) => (
            <Text key={`live-pad-${i}`}> </Text>
          ))}
        </Box>
      ) : lane}
    </Box>
  )
}
