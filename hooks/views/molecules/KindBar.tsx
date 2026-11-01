import { SPACE } from '../palette'
import type { UI } from '../ui'

// One part of what the session's cost went on: its key, its colour, its name and what it cost.
export type CostKind = [key: string, color: string, name: string, usd: number]

// One bar of colour, each kind a block as many cells wide as the page shares it, and the session's total after it.
export function KindBar({ ui, kinds, cells, barWidth, rowWidth, total }: { ui: UI; kinds: CostKind[]; cells: number[]; barWidth: number; rowWidth: number; total: string }) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="row" width={rowWidth} height={1}>
      <Box key="cost-kind-bar" flexDirection="row" width={barWidth} height={1} flexShrink={0}>
        {kinds.map(([key, color], j) =>
          (cells[j] ?? 0) > 0 ? <Box key={`cost-seg-${key}`} width={cells[j]} height={1} flexShrink={0} backgroundColor={color} /> : null,
        )}
      </Box>
      <Text bold wrap="truncate">{total}</Text>
    </Box>
  )
}

// Beneath the bar, which colour is which kind, in the bar's order, each with its share of the cost.
export function KindKey({ ui, kinds, usd, rowWidth }: { ui: UI; kinds: CostKind[]; usd: number; rowWidth: number }) {
  const { Box, Text } = ui
  return (
    <Box key="cost-kind-key" flexDirection="row" flexWrap="wrap" columnGap={SPACE.gap} width={rowWidth}>
      {kinds.map(([key, color, name, v]) => (
        <Text key={`cost-key-${key}`}>
          <Text color={color}>■</Text>
          {` ${name} (${((v / Math.max(usd, 1e-9)) * 100).toFixed(1)}%)`}
        </Text>
      ))}
    </Box>
  )
}
