// What /autocompact-tuning says, and what it offers to write, from what recommend.sh --settings printed.

export type TuningRow = {
  model: string
  id: string | null
  compactions: number
  tooFew: boolean
  window: number | null
  lowest?: number | null
  floored?: boolean
  costsMore?: number | null
  hasNumber?: boolean
}
export type Tuning = { current: { isOff: boolean; pct: number | null }; overall: TuningRow | null; byModel: TuningRow[] }
export type TuningOption = { label: string; args: string[] | null }
export type TuningAdvice = { lines: string[]; question?: string; options: TuningOption[] }

// Percent. The cost steps with the compaction count, so a smaller gap can be that step alone.
const CLEARLY = 5
const NOTHING = 'Change nothing'
const K = (tokens: number) => `${Math.round(tokens / 1000)}K`
const NAMES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', fable: 'Fable' }

// Off comes first, then what the samples can carry and whether a number is set.
export function tuningAdvice({ current, overall, byModel }: Tuning): TuningAdvice {
  if (current.isOff) {
    return {
      lines: ['Auto-compact is off. Enable it first, then tune it once there are records.'],
      question: 'Enable auto-compact?',
      options: [{ label: 'Enable auto-compact (Recommended)', args: ['--enable'] }, { label: NOTHING, args: null }],
    }
  }
  if (!overall || overall.window === null) return { lines: ['No compactions yet, so nothing measured to compute from. Keep watching.'], options: [] }
  const { window, compactions, tooFew, hasNumber, costsMore, floored, lowest } = overall
  const few = `Only ${compactions} compaction${compactions === 1 ? '' : 's'}`
  const clearly = (costsMore ?? 0) >= CLEARLY
  const floorNote = floored && lowest ? [`Estimate ${K(lowest)} < ${K(window)}, so ${K(window)} is recommended.`] : []
  const verdict = !tooFew
    ? `Recommended: autoCompactWindow ${K(window)}. The setting in force costs ${costsMore ?? 0}% more.`
    : !hasNumber
      ? `Estimate: autoCompactWindow ${K(window)}. ${few}: keep watching, no change needed.`
      : clearly
        ? `Estimate: autoCompactWindow ${K(window)}. The setting in force costs ${costsMore}% more. ${few}: you can switch, or change nothing and keep watching.`
        : `Estimate: autoCompactWindow ${K(window)}. The setting in force is within ${CLEARLY}%. ${few}: change nothing and keep watching.`

  const models = byModel.filter((m): m is TuningRow & { window: number; id: string } => m.window !== null && m.id !== null)
  const global = { label: `Global: ${K(window)}`, args: ['--global', String(window)] }
  const perModel = models.length
    ? [{ label: `By model: ${models.map(m => `${NAMES[m.model] ?? m.model} ${K(m.window)}`).join(', ')}`, args: ['--model', ...models.map(m => `${m.id}=${m.window}`)] }]
    : []
  const nothing = { label: NOTHING, args: null }
  const options = !tooFew
    ? [{ ...global, label: `${global.label} (Recommended)` }, ...perModel, nothing]
    : hasNumber && clearly
      // Their choice: none is marked.
      ? [nothing, global, ...perModel]
      : [{ ...nothing, label: `${NOTHING} (Recommended)` }, global, ...perModel]
  return { lines: [verdict, ...floorNote], question: 'Write this setting to ~/.claude/settings.json?', options }
}
