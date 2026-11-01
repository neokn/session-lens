import { cut, fit, IO_W, ioCol, ioHead, left, money, width } from '../layout'
import { T } from '../palette'
import type { UI } from '../ui'

// The columns after the name: requests, tokens in and out, cost, share.
export const COST_COLS = 5 + (IO_W + 2) + 9 + 6

// The head of a cost table: the table's label over the names, then each column's.
export function CostHead({ ui, label, nameWidth }: { ui: UI; label: string; nameWidth: number }) {
  const { Text } = ui
  return <Text color={T.text.muted}>{fit(label, nameWidth) + left('Reqs', 5) + left(ioHead, IO_W + 2) + left('Cost', 9) + left('Share', 6)}</Text>
}

// One line of a cost table: a name, a note in the room the name leaves, then its figures. A row with no tokens shows -.
export function CostRow({ ui, key, nameWidth, indent, name, note, reqs, i, o, cost, share, color, noteColor }: { ui: UI; key: string; nameWidth: number; indent: number; name: string; note: string; reqs: number; i: number; o: number; cost: number | undefined; share: string; color?: string; noteColor?: string }) {
  const { Text } = ui
  const head = `${' '.repeat(indent)}${name}`
  const used = Math.min(nameWidth, width(head))
  return (
    <Text key={key}>
      <Text color={color}>{fit(cut(head, nameWidth), used)}</Text>
      <Text color={noteColor ?? T.text.muted}>{fit(note ? cut(` ${note}`, Math.max(0, nameWidth - used)) : '', nameWidth - used)}</Text>
      {left(String(reqs), 5)}
      {left(i === 0 && o === 0 ? '-' : ioCol(i, o), IO_W + 2)}
      {left(money(cost), 9)}
      {left(share, 6)}
    </Text>
  )
}
