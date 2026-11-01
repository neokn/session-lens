import { cut, width } from '../layout'
import { T, S } from '../palette'
import type { UI } from '../ui'

// What a tile shows: a label over a value, each with shorter forms for a narrow tile, the value maybe still counting.
export type TileFigure = { label: string; labels?: string[]; value: string; shorter?: string[]; color?: string; live?: boolean; isLabelLive?: boolean }

// The longest form that fits, or the shortest cut to fit.
const fitted = (forms: string[], room: number) => cut(forms.find(v => width(v) <= room) ?? forms.at(-1) ?? '', room)

// One tile of a row: a rounded box, its label grey, its value bold, a spinner after a value still counting.
export function Tile({ ui, key, tile, width: w, pad, borderColor, spin, spinColor }: { ui: UI; key?: string; tile: TileFigure; width: number; pad: number; borderColor?: string; spin: string; spinColor?: string }) {
  const { Box, Text } = ui
  const inner = w - 2 - pad * 2
  return (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={pad} width={w} flexShrink={0}>
      <Text {...(tile.isLabelLive ? S.live : { color: T.text.muted })} wrap="truncate">{fitted([tile.label, ...(tile.labels ?? [])], inner)}</Text>
      {tile.live ? (
        <Text wrap="truncate">
          <Text {...S.figure} color={tile.color}>{fitted([tile.value, ...(tile.shorter ?? [])], inner - 2)}</Text>
          <Text color={spinColor}>{` ${spin}`}</Text>
        </Text>
      ) : (
        <Text {...S.figure} color={tile.color} wrap="truncate">{fitted([tile.value, ...(tile.shorter ?? [])], inner)}</Text>
      )}
    </Box>
  )
}
