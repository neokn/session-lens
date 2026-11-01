import { Tile, type TileFigure } from '../atoms/Tile'
import { width } from '../layout'
import { G, SPACE } from '../palette'
import type { UI } from '../ui'

// A row of tiles, each as wide as the page measured it: the session's figures, or an agent's under its name.
export function TileRow({ ui, tiles, widths, pad, paddingLeft, rowWidth, keyPrefix, borderColor, spin, spinColor }: { ui: UI; tiles: TileFigure[]; widths: number[]; pad: number; paddingLeft?: number; rowWidth: number; keyPrefix?: string; borderColor?: string; spin: string; spinColor?: string }) {
  const { Box } = ui
  return (
    <Box flexDirection="row" paddingLeft={paddingLeft} width={rowWidth}>
      {tiles.map((x, n) => (
        <Tile ui={ui} key={keyPrefix === undefined ? undefined : `${keyPrefix}-${n}`} tile={x} width={widths[n] ?? 4} pad={pad} borderColor={borderColor} spin={spin} spinColor={spinColor} />
      ))}
    </Box>
  )
}

// A tile before it is fitted: a figure that keeps `reserve` columns for its widest, as the counts do.
export type TileSpec = TileFigure & { reserve?: number }

/** An agent's tiles fitted into `tileRoom`, with each one's width and the padding they share. The first tile names
 * every setting the agent ran at (`hasSequence`) and the times it switched (`switches`); too narrow for that, it names
 * the setting now and puts the switches in its title. */
export function fitTiles(input: TileSpec[], tileRoom: number, switches: number | undefined, hasSequence: boolean): { tiles: TileSpec[]; widths: number[]; pad: number } {
  const tiles = [...input]
  const first = tiles[0]
  const even = Math.floor(tileRoom / Math.max(1, tiles.length))
  const shortest = (forms: string[]) => Math.min(...forms.map(width))
  const forms = first ? [first.value, ...(first.shorter ?? [])] : []
  // What each tile needs with the first tile's value in its `form`th form, the others in their shortest, and every title
  // whole, at its shortest, or not at all; a figure of counts keeps the room of its widest.
  const switched = switches !== undefined && hasSequence ? `${G.switch}${switches} Model / Effort` : undefined
  const needs = (form: number, title: 'whole' | 'short' | 'none', edge: number) =>
    tiles.map((x, n) => {
      const value = n === 0 ? width(forms[form] ?? '') : shortest([x.value, ...(x.shorter ?? [])])
      const whole = n === 0 && form > 0 && switched ? switched : x.label
      const label = title === 'whole' ? width(whole) : title === 'short' ? shortest([x.label, ...(x.labels ?? [])]) : 0
      return Math.max(value, label, x.reserve ?? 0) + edge
    })
  const roomLeft = (ws: number[]) => tileRoom - ws.reduce((n, w) => n + w, 0)
  // The first that fits, in this order: every setting, then the setting now, then its shortest form; each with the titles
  // whole, then shortened. Inside its border a tile keeps the inset every box does: the setting it names and its titles
  // shorten first, and only a row too narrow for even that gives the inset up, and at the last the titles are cut. A row that fits none falls back to even tiles.
  const titled = (pad: number) => forms.flatMap((_, form) => (['whole', 'short'] as const).map(title => ({ form, title, pad })))
  const tries = [...titled(SPACE.inset), ...titled(0), { form: forms.length - 1, title: 'none' as const, pad: 0 }]
  const chosen = tries.find(t => roomLeft(needs(t.form, t.title, 2 + t.pad * 2)) >= 0)
  const tilePad = chosen?.pad ?? 0
  const edge = 2 + tilePad * 2
  const form = chosen?.form ?? Math.max(0, forms.length - 1)
  if (first && form > 0) {
    const label = switched ?? first.label
    tiles[0] = { ...first, label, labels: first.labels?.filter(l => l !== label), value: forms[form] ?? '', shorter: forms.slice(form + 1) }
  }
  const widths = (() => {
    if (!chosen) {
      // One row, never wrapped: even tiles, but a tile that reserves room no narrower than it needs, the others sharing what it leaves.
      const held = tiles.map(x => (x.reserve === undefined ? 0 : Math.max(even, x.reserve + edge)))
      const share = Math.max(4, Math.floor(roomLeft(held) / Math.max(1, held.filter(w => w === 0).length)))
      return held.map(w => w || share)
    }
    // Each tile takes what it needs, then is topped up to show its value and its title whole; what is left is shared evenly.
    const natural = needs(chosen.form, chosen.title, edge)
    let left = roomLeft(natural)
    const topped = natural.map((w, n) => {
      const x = tiles[n]
      const give = x ? Math.min(left, Math.max(0, Math.max(width(x.value), width(x.label), x.reserve ?? 0) + edge - w)) : 0
      left -= give
      return w + give
    })
    return topped.map((w, n) => w + Math.floor(left / tiles.length) + (n === 0 ? left % tiles.length : 0))
  })()
  // What rounding leaves over, or takes too much, the last tile evens out: the row ends on the room's edge, as the boxes under it do.
  const last = widths.length - 1
  if (last >= 0) widths[last] = Math.max(4, (widths[last] ?? 0) + roomLeft(widths))
  return { tiles, widths, pad: tilePad }
}
