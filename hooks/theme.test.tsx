import { describe, expect, test } from 'claude-code/testing'
import { backgroundOf } from './theme'
import { theme, setTheme, T, tokensOf, type Theme } from './views/palette'

const THEMES: Theme[] = ['dark', 'light']
const luminance = (c: string) => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
// What the terminal's own background stands for, and the least a token that carries words or a figure has on it: the
// tones of a hue are the faintest, at 2.7 on a light grey.
const PAGE: Record<Theme, string> = { dark: '#000000', light: '#f5f5f5' }
const READS: Record<Theme, number> = { dark: 3, light: 2.65 }

// A colour's hue in degrees, in OKLab.
const hueOf = (c: string) => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255).map(x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  const [l, m, s] = [0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b].map(Math.cbrt) as [number, number, number]
  return (Math.atan2(0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s) * 180) / Math.PI
}

test('the light theme keeps the brand palette: each hue is the brand\'s, only brought down in lightness', () => {
  const { P } = tokensOf('light')
  for (const [c, brand] of [[P.plum, '#827dbd'], [P.mineral, '#629987'], [P.afternoon, '#d97757'], [P.sky, '#6a9bcc'], [P.sage, '#788c5d']] as const) {
    expect(Math.abs(hueOf(c) - hueOf(brand))).toBeLessThan(3)
    expect(luminance(c)).toBeLessThanOrEqual(luminance(brand))
  }
  expect([P.muted, P.bright]).toEqual(['#73726c', '#141413'])
})

test('no block of a bar is drawn in the darkest grey on a light terminal', () => {
  const { P, T, SERIES } = tokensOf('light')
  expect(SERIES).not.toContain(P.soft)
  expect(T.window.buffer).not.toBe(P.soft)
})

describe('both themes', () => {
  for (const t of THEMES) {
    const { P, T, SERIES, MODEL_SERIES, LOADING } = tokensOf(t)
    test(`${t}: who, which kind and when stay apart`, () => {
      const greys: string[] = [P.muted, P.soft, P.bright]
      const actors = Object.values(T.actor)
      const costs = Object.values(T.cost)
      expect(new Set(costs).size).toBe(costs.length)
      expect(actors.filter(c => costs.includes(c))).toEqual([])
      expect(greys).not.toContain(T.state.live)
      expect([...costs, T.state.live, ...actors]).not.toContain(T.state.danger)
      expect([...actors, ...costs]).not.toContain(T.state.done)
      expect(T.rank.longest).toBe(T.cost.spend)
      expect(T.rank.shortest).toBe(T.cost.fresh)
    })
    test(`${t}: every colour that carries words reads on its page`, () => {
      // Lines and the parts with no hue of their own carry no words.
      const { buffer: _buffer, beyond: _beyond, ...window } = T.window
      const faint = [T.text, T.actor, T.state, T.cost, T.source, T.rank, window].flatMap(g => Object.values(g))
      for (const c of [...faint, ...SERIES, ...MODEL_SERIES, LOADING.light, LOADING.head].filter(c => c !== P.ash)) expect(contrast(c, PAGE[t])).toBeGreaterThanOrEqual(READS[t])
    })
    test(`${t}: a box's line stands off its page`, () => {
      expect(contrast(T.line.frame, PAGE[t])).toBeGreaterThanOrEqual(2.5)
    })
    test(`${t}: what is held back reads fainter than what it is held back from`, () => {
      expect(contrast(T.line.split, PAGE[t])).toBeLessThan(contrast(T.line.frame, PAGE[t]))
      expect(contrast(T.window.beyond, PAGE[t])).toBeLessThan(contrast(T.window.free, PAGE[t]))
      expect(contrast(LOADING.track, PAGE[t])).toBeLessThan(contrast(P.muted, PAGE[t]))
    })
  }
})

test('a change of theme reaches what a view reads next', () => {
  const was = theme
  try {
    setTheme('light')
    expect(T.actor.main).toBe(tokensOf('light').T.actor.main)
    setTheme('dark')
    expect(T.actor.main).toBe(tokensOf('dark').T.actor.main)
    expect(tokensOf('dark').T.actor.main).not.toBe(tokensOf('light').T.actor.main)
  } finally {
    setTheme(was)
  }
})

test('COLORFGBG is read by the rule the engine reads it by', () => {
  expect(backgroundOf('15;0')).toBe('dark')
  expect(backgroundOf('0;15')).toBe('light')
  expect(backgroundOf('0;default;7')).toBe('light')
  expect(backgroundOf('15;8')).toBe('dark')
  expect(backgroundOf('0;default')).toBeUndefined()
  expect(backgroundOf('')).toBeUndefined()
  expect(backgroundOf(undefined)).toBeUndefined()
})
