import type { Compaction } from '../../../types'
import { fit, fmtTime, k, left } from '../layout'
import { MoreRow, type PageStep } from '../molecules/MoreRow'
import { T, G, SPACE } from '../palette'
import type { UI } from '../ui'

// Each compaction, from what to what and what it dropped; a row opens the page of what the window restarted from.
// shown is the page of them the list draws; more and fewer page it; indent is where the list starts.
export function Compactions({ ui, indent = SPACE.indent * 2, shown, onOpen, more, fewer }: { ui: UI; indent?: number; shown: Compaction[]; onOpen: (c: Compaction) => () => unknown; more?: PageStep; fewer?: PageStep }) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column" paddingLeft={indent}>
      <Text color={T.text.muted}>{`${fit('Compaction', 24)}${left('Before', 10)}   ${fit('After', 9)}${left('Dropped', 10)}`}</Text>
      {shown.map((x, n) => (
        <Button plain key={`node-compact-${n}`} onPress={onOpen(x)}>
          <Text>
            <Text color={T.text.muted}>{fit(`${G.page} #${n + 1} ${fmtTime(x.ts)}`, 15)}</Text>
            {fit(x.trigger === 'auto' ? 'auto' : 'manual', 9)}
            {left(k(x.pre), 10)}
            <Text color={T.text.muted}>{' → '}</Text>
            {fit(k(x.post), 9)}
            <Text color={T.cost.spend}>{left(`-${k(Math.max(0, x.pre - x.post))}`, 10)}</Text>
          </Text>
        </Button>
      ))}
      <MoreRow ui={ui} listKey="compacts" indent={0} more={more} fewer={fewer} />
    </Box>
  )
}
