import type { Combo } from '../../../types'
import { fit, k, left, shortModel, width } from '../layout'
import { T } from '../palette'
import type { UI } from '../ui'

const COMBO_COLS = ['Reqs/turn', 'Tools/turn', 'Skills/turn', 'MCP/turn', 'Calls/turn', 'Thinking/turn']

// What each model / effort setting did a turn: the model first, its efforts beneath. A subagent's run at one setting
// counts as a turn.
export function ComboTable({ ui, combos, indent, rowWidth }: { ui: UI; combos: Combo[]; indent: number; rowWidth: number }) {
  const { Box, Text } = ui
  const pad = ' '.repeat(indent)
  const models = [...new Set(combos.map(x => x.model))]
  const per = (n: number, x: Combo) => n / Math.max(1, x.turns)
  const LW = Math.max(12, rowWidth - indent - COMBO_COLS.reduce((n, c) => n + width(c) + 2, 0))
  const cellsOf = (x: Combo) => [per(x.steps, x).toFixed(1), per(x.tools, x).toFixed(1), per(x.skills, x).toFixed(1), per(x.mcp, x).toFixed(1), per(x.tools + x.skills + x.mcp, x).toFixed(1), k(Math.round(per(x.thinking, x)))]
  const row = (key: string, label: string, x: Combo, depth: number) => (
    <Text key={key}>
      {pad}
      {fit(`${' '.repeat(depth * 2)}${label}`, LW)}
      {cellsOf(x).map((v, n) => left(v, width(COMBO_COLS[n] ?? '') + 2))}
    </Text>
  )
  return (
    <Box flexDirection="column">
      <Text>
        {pad}
        <Text bold>{fit(width('By model / effort') < LW ? 'By model / effort' : 'Model/effort', LW)}</Text>
        <Text color={T.text.muted}>{COMBO_COLS.map(c => left(c, width(c) + 2)).join('')}</Text>
      </Text>
      {models.flatMap(m => [
        <Text key={`combo-m-${m}`}>
          {pad}
          <Text color={T.text.soft}>{shortModel(m)}</Text>
        </Text>,
        ...combos.filter(x => x.model === m).map((x, n) => row(`combo-${m}-${n}`, x.effort, x, 1)),
      ])}
    </Box>
  )
}
