import { Chip } from '../atoms/Chip'
import { SPACE } from '../palette'
import type { UI } from '../ui'

// Which of a page's views is drawn: one chip for each, the current one on.
export function Tabs<K extends string>({ ui, tabs, current, color, onPick }: { ui: UI; tabs: { key: K; label: string }[]; current: K; color: string; onPick: (key: K) => () => unknown }) {
  const { Box } = ui
  return (
    <Box flexDirection="row" columnGap={SPACE.tight}>
      {tabs.map(t => <Chip ui={ui} key={`node-tab-${t.key}`} label={t.label} isOn={t.key === current} color={color} onPress={onPick(t.key)} />)}
    </Box>
  )
}
