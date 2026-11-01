import { cut, width } from '../layout'
import { T, G, S } from '../palette'
import type { UI } from '../ui'

// The head of a part that folds: ▾ open or ▸ shut, its title, and what it holds in a line cut to the room left.
export function Fold({ ui, key, indent, isOpen, title, summary, room, color, onToggle }: { ui: UI; key: string; indent: number; isOpen: boolean; title: string; summary: string; room: number; color?: string; onToggle: () => unknown }) {
  const { Button, Text } = ui
  return (
    <Button plain key={key} onPress={onToggle}>
      {`${' '.repeat(indent)}${isOpen ? G.open : G.shut} `}
      <Text {...S.name} color={color}>{title}</Text>
      {summary ? <Text color={T.text.muted}>{`  ${cut(summary, Math.max(8, room - indent - width(title) - 4))}`}</Text> : ''}
    </Button>
  )
}
