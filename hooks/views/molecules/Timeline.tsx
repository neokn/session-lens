import { LEVELS, stackCells, type StackCell, type TimelineCol, type TimelineMark } from '../../digest/timeline'
import { agentColor, G, T } from '../palette'
import type { UI } from '../ui'

// What main sent the model is main's own hue; what it called, the echo of it: one actor, two tones.
// Read as each cell draws, so a change of theme reaches it.
const REQ = () => T.actor.main
const CALL = () => T.actor.mainEcho

// A drawn cell: its glyph, and its colours.
type Glyph = { ch: string; color?: string; bg?: string }

/** One cell of a stacked column: requests from its foot in main's hue, calls above in its echo. A cell the boundary
 * crosses draws the requests' block on the calls' colour; a top cell too short for both takes the larger part's. */
function cellOf(cell: StackCell): Glyph {
  if (!cell) return { ch: ' ' }
  const glyph = LEVELS[cell.eighths - 1] ?? ' '
  if (cell.split >= cell.eighths) return { ch: glyph, color: REQ() }
  if (cell.split === 0) return { ch: glyph, color: CALL() }
  if (cell.eighths === 8) return { ch: LEVELS[cell.split - 1] ?? ' ', color: REQ(), bg: CALL() }
  return { ch: glyph, color: cell.split * 2 >= cell.eighths ? REQ() : CALL() }
}

/** A line of cells, the neighbours of one colour drawn as one run. */
function Runs({ ui, cells, k }: { ui: UI; cells: Glyph[]; k: string }) {
  const { Text } = ui
  const runs: Glyph[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.color === c.color && last.bg === c.bg) last.ch += c.ch
    else runs.push({ ...c })
  }
  return (
    <Text key={k} wrap="truncate">
      {runs.map(r => (r.color ? <Text color={r.color} backgroundColor={r.bg}>{r.ch}</Text> : r.ch))}
    </Text>
  )
}

/** The session's work on one clock, `rows` tall: each column's requests and calls stacked, a compaction a `┃` through
 * every row. */
export function StackChart({ ui, cols, rows = 2 }: { ui: UI; cols: TimelineCol[]; rows?: number }) {
  const { Box } = ui
  const max = Math.max(0, ...cols.map(c => c.reqs + c.calls))
  const cells = cols.map(c => stackCells(c, max, rows))
  return (
    <Box flexDirection="column">
      {Array.from({ length: rows }, (_, r) => (
        <Runs ui={ui} k={`stack-${r}`} cells={cols.map((c, n) => (c.isCompact ? { ch: '┃', color: T.cost.spend } : cellOf(cells[n]?.[r] ?? null)))} />
      ))}
    </Box>
  )
}

/** The setting each column ran at, as a line in its colour; a compaction's `┃` goes on through it. */
export function SettingLine({ ui, cols, colorOf }: { ui: UI; cols: TimelineCol[]; colorOf: (setting: string) => string }) {
  return <Runs ui={ui} k="setting-line" cells={cols.map(c => (c.isCompact ? { ch: '┃', color: T.cost.spend } : c.setting ? { ch: '━', color: colorOf(c.setting) } : { ch: ' ' }))} />
}

/** The agents and shells by when they started: an agent `@` in its own hue, a shell `$` in the hue of who started it,
 * one still running in live light. */
export function MarkLane({ ui, marks, room }: { ui: UI; marks: TimelineMark[]; room: number }) {
  const at = new Map(marks.map(m => [m.col, m]))
  const cells = Array.from({ length: room }, (_, n): Glyph => {
    const m = at.get(n)
    if (!m) return { ch: ' ' }
    return { ch: m.kind === 'agent' ? G.agent : G.shell, color: m.isLive ? T.state.live : agentColor(m.kind === 'agent' ? Math.max(1, m.depth) : m.depth) }
  })
  return <Runs ui={ui} k="mark-lane" cells={cells} />
}
