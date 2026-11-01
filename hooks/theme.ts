import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { setTheme, theme, type Theme } from './views/palette'

const themeDrawn = atom({ plugin: 'session-lens', key: 'themeDrawn' } as const, null)

// Which of the palette's themes the pane draws in. An engine's theme is told by its name (`light-daltonized`); a custom one
// names no base a mod can read, and is drawn as the engine falls back, dark. `auto` the engine settles by asking the terminal
// for its background, which it does not hand a mod: the COLORFGBG it falls back on answers here, and dark where that says
// nothing, as the engine falls back too. The button at the foot of the pane switches it for a terminal this reads wrongly.

/** The engine's rule for COLORFGBG: its last field is the background, a colour 0 to 15. Undefined when it does not say. */
export const backgroundOf = (colorfgbg: string | undefined): Theme | undefined => {
  const bg = colorfgbg?.split(';').at(-1)
  if (!bg) return undefined
  const n = Number(bg)
  if (!Number.isInteger(n) || n < 0 || n > 15) return undefined
  return n <= 6 || n === 8 ? 'dark' : 'light'
}

async function resolved($: EngineInterface): Promise<Theme> {
  const rows = await $.config.list().catch(() => [])
  const setting = rows.find(row => row.key === 'theme')?.value
  if (typeof setting !== 'string') return 'dark'
  if (setting.startsWith('light')) return 'light'
  if (setting !== 'auto') return 'dark'
  return backgroundOf((await $.env.get('COLORFGBG').catch(() => undefined)) ?? undefined) ?? 'dark'
}

async function draw($: EngineInterface, next: Theme) {
  setTheme(next)
  // After the palette, as the write is what redraws the pane.
  await update($, themeDrawn, () => next)
}

/** Sets the palette's theme: the one this session already draws in (a reload of this code forgets the palette, not the
 * atom), else what Claude Code's own comes to. So each session starts from Claude Code's. */
export async function followTheme($: EngineInterface) {
  await draw($, (await read($, themeDrawn)) ?? (await resolved($)))
}

/** The person changed Claude Code's theme: that, whatever this session had switched to. */
export async function themeChanged($: EngineInterface) {
  await draw($, await resolved($))
}

/** The person pressed the theme at the foot of the pane: the other one, for this session. */
export async function switchTheme($: EngineInterface) {
  await draw($, theme === 'dark' ? 'light' : 'dark')
}
