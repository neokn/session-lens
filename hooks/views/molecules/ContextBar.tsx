import { barCells, k } from '../layout'
import { T } from '../palette'
import type { UI } from '../ui'

// A part of the bar: its size and its colour.
export type BarPart = { v: number; color: string }

// One line: the window in use, how far auto-compact is and where, and the turns left before it. figure is the count
// shown, which eases toward now. turnsLeft: a number, null when there is no forecast yet, or undefined to say nothing.
export function ContextLine({ ui, figure, now, max, peak, threshold, isNear, turnsLeft }: { ui: UI; figure: number; now: number; max: number; peak?: number; threshold?: number; isNear: boolean; turnsLeft?: number | null }) {
  const { Text } = ui
  const gap = threshold !== undefined ? threshold - now : undefined
  return (
    <Text wrap="truncate">
      <Text bold>{k(figure)} / {k(max)}</Text>
      <Text color={T.text.muted}>{`${peak !== undefined && peak > now ? ` · peak ${k(peak)}` : ''} · `}</Text>
      {gap === undefined ? (
        <Text color={T.text.muted}>auto-compact off</Text>
      ) : (
        <Text>
          {gap >= 0 ? '' : 'past auto-compact by '}
          <Text bold color={isNear ? T.state.danger : T.state.done}>{k(Math.abs(gap))}</Text>
          <Text color={T.text.muted}>{`${gap >= 0 ? ' to auto-compact' : ''} at ${k(threshold ?? max)}`}</Text>
        </Text>
      )}
      {turnsLeft === undefined ? '' : <Text color={T.text.muted}>{turnsLeft !== null ? ` · ≈${turnsLeft} turns` : ' · no forecast yet'}</Text>}
    </Text>
  )
}

// The window as a bar: the parts it opened with, a │, the parts that came in since, the room left, and auto-compact's
// mark. A window past the one auto-compact measures against fills the bar instead of running off the line.
export function ContextBar({ ui, max, threshold, parts, initParts, barWidth: barW }: { ui: UI; max: number; threshold?: number; parts: BarPart[]; initParts: number; barWidth: number }) {
  const { Text } = ui
  const cellOf = (v: number) => Math.round((v / max) * barW)
  // A │ between what it opened with and what came in since, when there is some of each.
  const hasSplit = initParts > 0 && initParts < parts.length
  // The segments leave room for the split and the threshold's mark.
  const segRoom = barW - (hasSplit ? 1 : 0) - (threshold !== undefined ? 1 : 0)
  const widths = barCells(parts.map(p => p.v), Math.max(max, parts.reduce((n, p) => n + p.v, 0)), segRoom)
  const cells = parts.map((p, n) => ({ ...p, w: widths[n] ?? 0 }))
  const usedCells = Math.min(barW, cells.reduce((n, x) => n + x.w, 0) + (hasSplit ? 1 : 0))
  const thrCell = threshold !== undefined ? Math.max(usedCells, Math.min(barW - 1, cellOf(threshold))) : barW
  return (
    <Text wrap="truncate">
      {cells.map((x, n) => (
        <Text color={x.color}>
          {hasSplit && n === initParts ? <Text color={T.line.split}>│</Text> : ''}
          {'█'.repeat(x.w)}
        </Text>
      ))}
      <Text color={T.text.muted}>{'░'.repeat(Math.max(0, thrCell - usedCells))}</Text>
      {threshold !== undefined ? <Text color={T.state.danger} bold>┃</Text> : ''}
      {threshold !== undefined ? <Text color={T.state.danger}>{'▒'.repeat(Math.max(0, barW - thrCell - 1))}</Text> : ''}
    </Text>
  )
}
