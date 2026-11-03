import { expect, test } from 'claude-code/testing'
import { tuningAdvice, tuningLabel, tuningStage, typedTuning, type Tuning } from './digest/autocompact'

const tuning = (over: Partial<Tuning> = {}): Tuning => ({
  current: { isOff: false, pct: null, window: null, models: {} },
  global: { window: 240000, computed: 244000 },
  byModel: [
    { model: 'opus', id: 'claude-opus-5-5', computed: 271000, own: 270000, window: 270000, follows: false },
    { model: 'sonnet', id: 'claude-sonnet-5-5', computed: 201000, own: 200000, window: 240000, follows: true },
  ],
  ...over,
})
const labels = (t: Tuning) => tuningAdvice(t).options.map(o => o.label)

test('off comes first, whatever the records', () => {
  const said = tuningAdvice(tuning({ current: { isOff: true, pct: null, window: null, models: {} } }))
  expect(said.lines[0]).toContain('Enable it first')
  expect(said.options.map(o => o.args)).toEqual([['--enable'], null])
})

test('with no session of a known model there is no number and nothing to ask', () => {
  const said = tuningAdvice(tuning({ global: null, byModel: [] }))
  expect(said.lines[0]).toContain('Keep watching')
  expect(said.question).toBeUndefined()
  expect(said.options).toEqual([])
})

test('the advice already in force needs no change', () => {
  const said = tuningAdvice(tuning({ current: { isOff: false, pct: null, window: 240000, models: { opus: 270000 } } }))
  expect(said.lines[0]).toContain('No change needed')
  expect(said.options).toEqual([])
  // A model following the global with a window of its own still in force is a change.
  expect(tuningAdvice(tuning({ current: { isOff: false, pct: null, window: 240000, models: { opus: 270000, sonnet: 200000 } } })).options.length).toBe(2)
})

test('the line gives each setting and what was computed, the followers named', () => {
  expect(tuningAdvice(tuning()).lines[0]).toBe('Recommended: autoCompactWindow 240K (computed 244K); Opus 270K (computed 271K); Sonnet follow the global (computed 201K).')
})

test('the recommendation sets the global and each model above it, by its id, and clears the rest', () => {
  const said = tuningAdvice(tuning()).options
  expect(said.map(o => o.label)).toEqual(['Global: 240K, and Opus 270K (others use Global) (Recommended)', 'Global: 240K only'])
  expect(said[0]?.args).toEqual(['--global', '240000', '--clear-other-models', '--model', 'claude-opus-5-5=270000'])
  expect(said[1]?.args).toEqual(['--global', '240000'])
})

test('with every model following, the global alone, and the second option is to change nothing', () => {
  const t = tuning({ byModel: [{ model: 'sonnet', id: 'claude-sonnet-5-5', computed: 201000, own: 200000, window: 240000, follows: true }] })
  const said = tuningAdvice(t).options
  expect(labels(t)).toEqual(['Global: 240K (Recommended)', 'Change nothing'])
  expect(said[0]?.args).toEqual(['--global', '240000', '--clear-other-models'])
  expect(said[1]?.args).toBeNull()
})

test('what is typed under Other reads as a setting, or not at all', () => {
  expect(typedTuning('300K')).toEqual(['--global', '300000'])
  expect(typedTuning('300')).toEqual(['--global', '300000'])
  expect(typedTuning('300000')).toEqual(['--global', '300000'])
  expect(typedTuning('1M')).toEqual(['--global', '1000000'])
  expect(typedTuning('global 300K, opus 250k')).toEqual(['--global', '300000', '--model', 'claude-opus-5-5=250000'])
  expect(typedTuning('Sonnet=200k + claude-fable-5-1: 400K')).toEqual(['--model', 'claude-sonnet-5-5=200000', 'claude-fable-5-1=400000'])
  expect(typedTuning('全域 300K，opus 250K')).toEqual(['--global', '300000', '--model', 'claude-opus-5-5=250000'])
  for (const no of ['', 'something else', 'opus', '50K', '2M', 'opus 300K please', '300K 或 opus']) expect(typedTuning(no)).toBeNull()
})

test('the script reports how far it is, and only reading has a percent', () => {
  expect(tuningStage('progress reading 42 100')).toEqual({ kind: 'reading', done: 42, total: 100 })
  expect(tuningStage('progress computing')).toEqual({ kind: 'computing' })
  expect(tuningStage('recommend.sh: jq not found')).toBeNull()
  expect(tuningLabel({ kind: 'reading', done: 42, total: 100 }, 12)).toBe('reading 42% · 12s')
  expect(tuningLabel({ kind: 'computing' }, 38)).toBe('computing · 38s')
  expect(tuningLabel({ kind: 'asking' }, 40)).toBe('waiting for your answer')
})
