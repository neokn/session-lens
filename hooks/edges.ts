// Where each bordered box's edges fall, in columns from the pane's left: a test's check that boxes meant to line up do.
type El = { type?: string; key?: string; props?: Record<string, unknown>; children?: unknown[] }
export type Edge = { key: string; left: number; right: number; depth: number; room: number }

const num = (v: unknown) => (typeof v === 'number' ? v : 0)

export function edgesOf(root: unknown, rootWidth: number): Edge[] {
  const out: Edge[] = []
  // Lays out one element at x, given the width its parent offers; returns the width it takes.
  const walk = (node: unknown, x: number, offered: number, depth: number, room = x + offered - 1): number => {
    if (!node || typeof node !== 'object') return 0
    const el = node as El
    const p = el.props ?? {}
    if (el.type !== 'Box') {
      for (const c of el.children ?? []) walk(c, x, offered, depth, room)
      return offered
    }
    const left = x + num(p.marginLeft) + num(p.marginX)
    const w = typeof p.width === 'number' ? p.width : offered - num(p.marginLeft) - num(p.marginX)
    const border = p.borderStyle ? 1 : 0
    if (border) out.push({ key: String(el.key ?? p.key ?? ''), left, right: left + w - 1, depth, room })
    const padL = num(p.paddingLeft) + num(p.paddingX)
    const padR = num(p.paddingRight) + num(p.paddingX)
    const innerX = left + border + padL
    const innerW = w - border * 2 - padL - padR
    if (p.flexDirection === 'row') {
      let at = innerX
      const gap = num(p.columnGap)
      for (const c of el.children ?? []) {
        const cw = c && typeof c === 'object' && (c as El).type === 'Box' && typeof (c as El).props?.width === 'number' ? ((c as El).props?.width as number) : 0
        walk(c, at, cw || innerW, depth + 1, innerX + innerW - 1)
        if (cw) at += cw + gap
      }
    } else for (const c of el.children ?? []) walk(c, innerX, innerW, depth + 1, innerX + innerW - 1)
    return w
  }
  walk(root, 0, rootWidth, 0)
  return out
}
