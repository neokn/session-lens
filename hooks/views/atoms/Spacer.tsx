import { SPACE } from '../palette'
import type { UI } from '../ui'

/** The blank row between two sections of one box, SPACE.section tall. */
export function Spacer({ ui }: { ui: UI }) {
  const { Box } = ui
  return <Box height={SPACE.section} />
}
