// What /autocompact-tuning says, and what it offers to write, from what recommend.sh printed.

export type TuningModel = {
  model: string
  id: string
  // What the formula found, to 1K; its own setting, to 10K; and what to write, the global where it follows.
  computed: number
  own: number
  window: number
  follows: boolean
}
export type Tuning = {
  current: { isOff: boolean; pct: number | null; window: number | null; models: Record<string, number> }
  global: { window: number; computed: number } | null
  byModel: TuningModel[]
}
export type TuningOption = { label: string; args: string[] | null }
export type TuningAdvice = { lines: string[]; question?: string; options: TuningOption[] }

const NOTHING = 'Change nothing'
const K = (tokens: number) => `${Math.round(tokens / 1000)}K`
const NAMES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', fable: 'Fable', haiku: 'Haiku' }
const QUESTION = 'Write to ~/.claude/settings.json? Under Other, type your own, such as "300K" or "global 300K, opus 250K". Esc changes nothing.'
const IDS: Record<string, string> = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', fable: 'claude-fable-5-1', haiku: 'claude-haiku-5-5' }
const GLOBAL_WORDS = new Set(['global', 'all', '全域', '全部'])
const name = (m: TuningModel) => NAMES[m.model] ?? m.model

// Off comes first, then whether there is anything to compute from, then whether what is in force is already the advice.
export function tuningAdvice({ current, global, byModel }: Tuning): TuningAdvice {
  if (current.isOff) {
    return {
      lines: ['Auto-compact is off. Enable it first, then tune it once there are records.'],
      question: 'Enable auto-compact?',
      options: [{ label: 'Enable auto-compact (Recommended)', args: ['--enable'] }, { label: NOTHING, args: null }],
    }
  }
  if (!global) return { lines: ['No session of a known model in the last 30 days, so nothing to compute from. Keep watching.'], options: [] }
  const own = byModel.filter(m => !m.follows)
  const followers = byModel.filter(m => m.follows)
  const isInForce = current.window === global.window
    && own.every(m => current.models[m.model] === m.window)
    && followers.every(m => current.models[m.model] === undefined || current.models[m.model] === global.window)
  if (isInForce) return { lines: [`The setting in force is the advice: autoCompactWindow ${K(global.window)}. No change needed.`], options: [] }

  const verdict = [
    `Recommended: autoCompactWindow ${K(global.window)} (computed ${K(global.computed)})`,
    ...own.map(m => `${name(m)} ${K(m.window)} (computed ${K(m.computed)})`),
    ...(followers.length ? [`${followers.map(name).join(', ')} follow the global (computed ${followers.map(m => K(m.computed)).join(', ')})`] : []),
  ].join('; ')
  // Any other model takes the global, a window of its own from before included.
  const all = {
    label: own.length ? `Global: ${K(global.window)}, and ${own.map(m => `${name(m)} ${K(m.window)}`).join(', ')} (others use Global) (Recommended)` : `Global: ${K(global.window)} (Recommended)`,
    args: ['--global', String(global.window), '--clear-other-models', ...(own.length ? ['--model', ...own.map(m => `${m.id}=${m.window}`)] : [])],
  }
  // The dialog takes two at the least; Other and Esc stand as they do.
  const second = own.length ? { label: `Global: ${K(global.window)} only`, args: ['--global', String(global.window)] } : { label: NOTHING, args: null }
  return { lines: [`${verdict}.`], question: QUESTION, options: [all, second] }
}

// What was typed under Other, as apply.sh's arguments: `300K`, `300000`, `global 300K, opus 250K`, or null when it does not read
// whole. A bare number up to 1000 is thousands, as /autocompact takes it.
export function typedTuning(text: string): string[] | null {
  const found = [...text.toLowerCase().matchAll(/(?:(global|all|全域|全部|opus|sonnet|fable|haiku|claude-[a-z0-9.-]+)\s*[:=]?\s*)?(\d+(?:\.\d+)?)\s*(k|m)?(?![a-z0-9])/g)]
  const rest = found.reduce((left, m) => left.replace(m[0], ' '), text.toLowerCase())
  if (!found.length || /[^\s,;+，、；]/.test(rest)) return null
  let global: number | null = null
  const models: string[] = []
  for (const [, who, figure, unit] of found) {
    const n = Number(figure) * (unit === 'm' ? 1_000_000 : unit === 'k' || Number(figure) <= 1000 ? 1000 : 1)
    if (!Number.isInteger(n) || n < 100_000 || n > 1_000_000) return null
    if (!who || GLOBAL_WORDS.has(who)) global = n
    else models.push(`${IDS[who] ?? who}=${n}`)
  }
  return [...(global === null ? [] : ['--global', String(global)]), ...(models.length ? ['--model', ...models] : [])]
}

// What a run is doing, from what its script reports; percent only where there is a true one to give.
export type TuningStage = { kind: 'reading'; done: number; total: number } | { kind: 'computing' } | { kind: 'asking' } | { kind: 'writing' }

export function tuningStage(line: string): TuningStage | null {
  const reading = /^progress reading (\d+) (\d+)$/.exec(line)
  if (reading) return { kind: 'reading', done: Number(reading[1]), total: Number(reading[2]) }
  return line === 'progress computing' ? { kind: 'computing' } : null
}

export function tuningLabel(stage: TuningStage, seconds: number) {
  if (stage.kind === 'asking') return 'waiting for your answer'
  const doing = stage.kind === 'reading' ? `reading ${stage.total > 0 ? Math.floor((stage.done / stage.total) * 100) : 0}%` : stage.kind
  return `${doing} · ${seconds}s`
}
