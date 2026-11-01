import { SPACE } from '../palette'
import type { UI } from '../ui'

// What a press does below a list drawn a page at a time.
export type PageStep = { label: string; onPress: () => unknown }

// Below a list: › for the next page, ‹ to fold it back to its first rows, side by side when both are offered.
export function MoreRow({ ui, listKey, indent, more, fewer }: { ui: UI; listKey: string; indent: number; more?: PageStep; fewer?: PageStep }) {
  const { Box, Button } = ui
  const next = more ? <Button plain key={`node-more-${listKey}`} label={`${' '.repeat(indent)}${more.label}`} onPress={more.onPress} /> : null
  const back = fewer ? <Button plain key={`node-fewer-${listKey}`} label={`${' '.repeat(next ? 0 : indent)}${fewer.label}`} onPress={fewer.onPress} /> : null
  return next && back ? <Box key={`more-row-${listKey}`} flexDirection="row" columnGap={SPACE.gap}>{next}{back}</Box> : (next ?? back)
}
