import { LOADING, mix } from './palette'

// The light that sweeps a bar while something is read, and the spinner beside a running node.

// A light that sweeps the bar to the right, again and again, its trail running through the palette and fading into the track: the colour of
// each cell of a bar `w` wide, `f` frames in.
const SWEEP_TRAIL = 18
// Read at each frame, so a change of theme sweeps in the new one.
const SWEEP_HUES = () => [...LOADING.trail, LOADING.track]
// `t` from 0, the light, to 1, the end of its trail.
const hueAt = (t: number) => {
  const hues = SWEEP_HUES()
  const at = Math.min(1, Math.max(0, t)) * (hues.length - 1)
  const n = Math.min(hues.length - 2, Math.floor(at))
  return mix(hues[n] ?? LOADING.track, hues[n + 1] ?? LOADING.track, at - n)
}
export const sweepOf = (w: number, f: number): (string | undefined)[] => {
  // Left to right, again and again: the light comes back in at the left once its whole trail has gone out at the right.
  const head = (f * Math.max(1, Math.round(w / 30))) % (w + SWEEP_TRAIL + 1)
  return Array.from({ length: w }, (_, x) => {
    const behind = head - x
    if (behind === -1) return LOADING.head
    if (behind < 0 || behind > SWEEP_TRAIL) return LOADING.track
    return hueAt(behind / SWEEP_TRAIL)
  })
}
// Neighbouring cells of one colour as one run, so a lane draws in a few pieces.
export const runsOf = (cells: (string | undefined)[]) =>
  cells.reduce<{ color?: string; n: number }[]>((runs, c) => {
    const last = runs[runs.length - 1]
    if (last && last.color === c) last.n++
    else runs.push({ color: c, n: 1 })
    return runs
  }, [])
// Which state a specimen of the version's tabs is in: one beat, about a second and a half, holds each.
export const beatOf = (frame: number) => Math.floor(frame / 12)

export const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
