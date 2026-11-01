import { T, G } from '../palette'
import type { UI } from '../ui'

// One choice of a filter: ● and bold in the given colour when it is the one chosen, ○ and grey when not.
export function Chip({ ui, key, label, isOn, color, onPress }: { ui: UI; key: string; label: string; isOn: boolean; color: string; onPress: () => unknown }) {
  const { Button, Text } = ui
  return (
    <Button plain key={key} onPress={onPress}>
      {isOn ? <Text bold color={color}>{`${G.on} ${label}`}</Text> : <Text color={T.text.muted}>{`${G.off} ${label}`}</Text>}
    </Button>
  )
}
