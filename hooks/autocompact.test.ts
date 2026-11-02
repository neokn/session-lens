import { expect, test } from 'claude-code/testing'
import { tuningAdvice, type Tuning, type TuningRow } from './digest/autocompact'

const row = (over: Partial<TuningRow> = {}): TuningRow => ({ model: '', id: null, compactions: 10, tooFew: true, window: 264000, lowest: 264000, floored: false, costsMore: 58, hasNumber: true, ...over })
const tuning = (over: Partial<TuningRow> = {}, isOff = false): Tuning => ({
  current: { isOff, pct: null },
  overall: row(over),
  byModel: [row({ model: 'opus', id: 'claude-opus-5-5', window: 267000 }), row({ model: 'sonnet', id: 'claude-sonnet-5-5', window: 200000 }), row({ model: 'fable', id: 'claude-fable-5-1', window: null })],
})
const labels = (t: Tuning) => tuningAdvice(t).options.map(o => o.label)

test('off comes first, whatever the samples', () => {
  const said = tuningAdvice(tuning({}, true))
  expect(said.lines[0]).toContain('Enable it first')
  expect(said.options.map(o => o.args)).toEqual([['--enable'], null])
})

test('with no compaction there is no number and nothing to ask', () => {
  const said = tuningAdvice(tuning({ window: null, compactions: 0 }))
  expect(said.question).toBeUndefined()
  expect(said.options).toEqual([])
})

test('under 30 with no number set, it says to keep watching', () => {
  const t = tuning({ hasNumber: false })
  expect(tuningAdvice(t).lines[0]).toContain('keep watching, no change needed')
  expect(labels(t)[0]).toBe('Change nothing (Recommended)')
})

test('under 30 with a dearer number set, the choice is theirs and none is marked', () => {
  const t = tuning()
  expect(tuningAdvice(t).lines[0]).toContain('costs 58% more')
  expect(labels(t).join()).not.toContain('Recommended')
  expect(labels(t)[0]).toBe('Change nothing')
})

test('5% is clearly dearer, and under it is not', () => {
  expect(labels(tuning({ costsMore: 5 }))[0]).toBe('Change nothing')
  expect(labels(tuning({ costsMore: 4 }))[0]).toBe('Change nothing (Recommended)')
  expect(tuningAdvice(tuning({ costsMore: 4 })).lines[0]).toContain('within 5%')
})

test('with 30 or more, the setting is the recommendation', () => {
  const t = tuning({ tooFew: false, compactions: 40 })
  expect(labels(t)[0]).toBe('Global: 264K (Recommended)')
  expect(tuningAdvice(t).options[0]?.args).toEqual(['--global', '264000'])
})

test('by model writes each model with a number, by its id, and in tokens', () => {
  const by = tuningAdvice(tuning()).options.find(o => o.label.startsWith('By model'))
  expect(by?.label).toBe('By model: Opus 267K, Sonnet 200K')
  expect(by?.args).toEqual(['--model', 'claude-opus-5-5=267000', 'claude-sonnet-5-5=200000'])
})

test('a raised estimate says what it was', () => {
  const said = tuningAdvice(tuning({ window: 200000, lowest: 123000, floored: true }))
  expect(said.lines).toContain('Estimate 123K < 200K, so 200K is recommended.')
})
