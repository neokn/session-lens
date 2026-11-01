import { MoreRow, type PageStep } from '../molecules/MoreRow'
import { TurnEntry, turnHead, type TurnItem } from '../organisms/TurnEntry'
import { T, G, SPACE } from '../palette'
import type { UI } from '../ui'

/** The screen of earlier turns: the way back, how many there are, then the turns, newest first, a page at a time. */
export function HistoryScreen({ ui, width, rowWidth, turnCount, turns, more, fewer, onBack }: { ui: UI; width: number; rowWidth: number; turnCount: number; turns: TurnItem[]; more?: PageStep; fewer?: PageStep; onBack: () => unknown }) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={width}>
      <Button plain key="node-turn-back" label={`${G.back} Back`} onPress={onBack} />
      <Text bold>{`History · ${turnCount} turns`}</Text>
      <Text color={T.text.muted}>{turnHead(rowWidth)}</Text>
      {turns.map(t => (
        <TurnEntry ui={ui} rowWidth={rowWidth} {...t} />
      ))}
      <MoreRow ui={ui} listKey="turns" indent={0} more={more} fewer={fewer} />
    </Box>
  )
}
