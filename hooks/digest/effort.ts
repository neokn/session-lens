import type { TurnRow } from '../../types'

// Whether more effort makes the main agent call more tools: each run of one effort in one of main's turns is a sample of
// what it called and in how many requests. Subagents are left out, as their effort is set for them and their work is
// another kind. Kept in the store by session, so the answer gathers across sessions.
export type EffortSample = { model: string; effort: string; calls: number; steps: number }
export const effortKey = (id: string) => `effort:${id}`
export const EFFORT_PREFIX = 'effort:'

// The efforts from least to most, as the harness names them; one it does not know goes last.
export const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max']
export const effortRank = (effort: string) => (EFFORT_ORDER.includes(effort) ? EFFORT_ORDER.indexOf(effort) : EFFORT_ORDER.length)
// Fewer samples than this in an effort and its figures are too few to go by.
export const FEW = 5

/** The samples main's turns give: one for each run of an effort, a turn that ran at one effort one sample. */
export const effortSamplesOf = (turns: TurnRow[]): EffortSample[] =>
  turns.flatMap(t => {
    const runs = t.runs ?? (t.calls ? [{ ...t.calls, effort: t.effort, cut: 0 }] : [])
    return runs.filter(r => r.steps > 0 && t.model && r.effort).map(r => ({ model: t.model ?? '?', effort: r.effort ?? '—', calls: r.tools + r.skills + r.mcp, steps: r.steps }))
  })

/** What the store holds under one session's key, read back: anything not a sample is dropped. */
export const samplesIn = (v: unknown): EffortSample[] =>
  Array.isArray(v) ? v.filter((x): x is EffortSample => typeof x?.model === 'string' && typeof x?.effort === 'string' && typeof x?.calls === 'number' && typeof x?.steps === 'number') : []

// The value at a share of the way through a sorted list, between its neighbours.
const at = (sorted: number[], q: number) => {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  return (sorted[lo] ?? 0) + ((sorted[Math.ceil(pos)] ?? 0) - (sorted[lo] ?? 0)) * (pos - lo)
}

export type EffortRow = { effort: string; n: number; q1: number; median: number; q3: number; most: number; perStep: number }
export type EffortModel = { model: string; rows: EffortRow[]; verdict: 'more' | 'fewer' | 'same' | 'few' }

/** For each model, its efforts from least to most: how many calls a turn made, as the middle half and the median, and
 * calls a request. The verdict compares the least effort with the most among those with enough samples: their middle
 * halves apart says more or fewer; overlapping, the same; fewer than two such efforts, too few to say. */
export function effortStudyOf(samples: EffortSample[]): EffortModel[] {
  const models = [...new Set(samples.map(x => x.model))].sort()
  return models.map(model => {
    const efforts = [...new Set(samples.filter(x => x.model === model).map(x => x.effort))].sort((a, b) => effortRank(a) - effortRank(b))
    const rows = efforts.map(effort => {
      const mine = samples.filter(x => x.model === model && x.effort === effort)
      const sorted = mine.map(x => x.calls).sort((a, b) => a - b)
      const steps = mine.reduce((n, x) => n + x.steps, 0)
      return { effort, n: mine.length, q1: at(sorted, 0.25), median: at(sorted, 0.5), q3: at(sorted, 0.75), most: sorted[sorted.length - 1] ?? 0, perStep: sorted.reduce((n, v) => n + v, 0) / Math.max(1, steps) }
    })
    const enough = rows.filter(r => r.n >= FEW)
    const low = enough[0]
    const high = enough[enough.length - 1]
    const verdict = !low || !high || low === high ? 'few' : high.q1 > low.q3 ? 'more' : high.q3 < low.q1 ? 'fewer' : 'same'
    return { model, rows, verdict }
  })
}
