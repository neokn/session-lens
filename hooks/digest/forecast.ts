import type { Compaction, TurnRow } from '../../types'

// How many turns are left before the window fills. Pure.

/**
 * How many more turns until the window reaches `gap` more tokens, from the window at the end of every turn since the last
 * compaction: the slope of a Theil–Sen line through them (tokens a turn, the median of the slope between every two). With
 * fewer than three turns since the last compaction, or no growth among them, it falls back to the mean of `steps`, each
 * turn's growth since the last compaction. Undefined when neither grows.
 */
export function forecast(ends: number[], gap: number, steps: number[] = []): { turns: number; slope: number; n: number; how: 'fit' | 'mean' } | undefined {
  if (gap <= 0) return undefined
  const ys = ends
  const n = ys.length
  const plan = (slope: number, n: number, how: 'fit' | 'mean') => ({ turns: Math.ceil(gap / slope), slope, n, how })
  if (n >= 3) {
    // Theil–Sen: the median of the slope between every two turns, so a few turns far off the line do not pull it.
    const pairs = ys.flatMap((a, i) => ys.slice(i + 1).map((b, d) => (b - a) / (d + 1))).sort((a, b) => a - b)
    const mid = pairs.length / 2
    const slope = pairs.length % 2 ? (pairs[Math.floor(mid)] ?? 0) : ((pairs[mid - 1] ?? 0) + (pairs[mid] ?? 0)) / 2
    if (slope > 0) return plan(slope, n, 'fit')
  }
  const mean = steps.reduce((a, d) => a + d, 0) / Math.max(1, steps.length)
  return mean > 0 ? plan(mean, steps.length, 'mean') : undefined
}

/** What `forecast` reads from the finished turns: the window at the end of each since the last compaction (`ends`), and
 * each turn's growth over the whole session, leaving out a step a compaction falls in (`steps`), for when too few turns
 * follow the last. */
export function forecastInputs(past: TurnRow[], compacted: Compaction[]): { ends: number[]; steps: number[] } {
  const lastCompact = compacted[compacted.length - 1]?.ts ?? ''
  const ends = past.flatMap(t => (t.ctx !== undefined && (t.endedAt ?? '') > lastCompact ? [t.ctx] : []))
  const steps = past.flatMap((t, n) => {
    const before = past[n - 1]
    if (n === 0 || !before || t.ctx === undefined || before.ctx === undefined) return []
    const from = before.endedAt ?? ''
    const to = t.endedAt ?? ''
    return compacted.some(c => c.ts > from && c.ts <= to) ? [] : [t.ctx - before.ctx]
  })
  return { ends, steps }
}
