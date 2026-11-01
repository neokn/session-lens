import { cut, fit, k, K_W, left } from '../layout'
import { T, G, SPACE } from '../palette'
import type { UI } from '../ui'

// A part of a context window: its size, its colour, and the page it opens when it has one. A free part (the room left,
// the buffer) counts against the model's whole window; the rest against the window auto-compact measures against.
export type WindowPart = { key: string; name: string; v: number; color: string; approx?: boolean; free?: boolean; ch?: string; page?: string }
export type Square = WindowPart & { ch: string }
// The key's groups: a title, when the group has one, over its parts.
export type GridGroup = { key: string; title?: string; parts: WindowPart[] }

export const WAFFLE_W = 20
const pct = (n: number, of: number) => `${((n / Math.max(1, of)) * 100).toFixed(1)}%`

// One grid of the whole window, a square to each hundredth, laid out as /context lays its own. The key sits to its
// right, a group for each part, each titled with the part's share of the window. onOpen opens a part's page.
export function ContextGrid({ ui, gridKey, squares, groups, keyWidth: keyW, windowMax, grid, onOpen }: { ui: UI; gridKey: string; squares: Square[]; groups: GridGroup[]; keyWidth: number; windowMax: number; grid: number; onOpen: (page: string) => () => unknown }) {
  const { Box, Text, Button } = ui
  return (
    <Box key={gridKey} flexDirection="row" columnGap={SPACE.gap}>
      <Box flexDirection="column" width={WAFFLE_W} flexShrink={0}>
        {Array.from({ length: squares.length > 0 ? 10 : 0 }, (_, y) => (
          <Text key={`${gridKey}-r${y}`}>
            {squares.slice(y * 10, y * 10 + 10).map(q => (
              <Text color={q.color}>{`${q.ch} `}</Text>
            ))}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" width={keyW}>
        {groups.map(g => {
          const sum = g.parts.reduce((n, p) => n + p.v, 0)
          return [
            g.title ? (
              <Text key={`${gridKey}-${g.key}`}>
                <Text bold>{g.title}</Text>
                <Text color={T.text.muted}>{` · ${pct(sum, windowMax)} of context · ${k(sum)}`}</Text>
              </Text>
            ) : null,
            ...g.parts
              .filter(p => p.v > 0)
              .map(p => {
                const row = [
                  <Text color={p.color}>{p.ch ?? '■'} </Text>,
                  // A part that opens a page keeps its › however short the name is cut.
                  fit(p.page ? `${cut(p.name, keyW - 19)} ${G.page}` : cut(p.name, keyW - 17), keyW - 17),
                  <Text color={T.text.muted}>{`${left(`${p.approx ? '≈' : ''}${k(p.v)}`, K_W + 2)}${left(pct(p.v, p.free ? grid : windowMax), 6)}`}</Text>,
                ]
                return p.page ? (
                  <Button plain key={p.page.startsWith('chat:') ? `node-${p.page}` : `node-init-${p.page}`} onPress={onOpen(p.page)}>{row}</Button>
                ) : (
                  <Text key={`${gridKey}-${g.key}-${p.key}`}>{row}</Text>
                )
              }),
          ]
        })}
      </Box>
    </Box>
  )
}
