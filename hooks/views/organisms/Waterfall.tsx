import type { Req } from '../../../types'
import { laneSpan } from '../../digest/turns'
import { cut, fit, IO_W, ioCol, left, span } from '../layout'
import { MoreRow, type PageStep } from '../molecules/MoreRow'
import { T, S } from '../palette'
import { runsOf } from '../sweep'
import type { UI } from '../ui'

// The width of the column that names each request.
const LW = 28

// The request sent and not yet answered: its agent is working on it.
const isWaiting = (r: Req) => (r.who === 'main' || r.of !== undefined) && r.running === true

// Where each request's bar sits on a lane `laneW` wide, and its colour, one of four: the longest clay, the shortest
// Cactus, the one still working Grey 250, the rest its agent's (main Plum, a subagent Mineral). One working that has
// become the longest or the shortest takes that colour.
export function barsOf(reqs: Req[], turnMs: number, laneW: number) {
  const total = Math.max(1, turnMs, ...reqs.map(r => r.startMs + r.ms))
  const by = (pick: (x: number, y: number) => boolean) => reqs.reduce<Req | undefined>((m, r) => (!m || pick(r.ms, m.ms) ? r : m), undefined)
  const longest = by((x, y) => x > y)
  const shortest = by((x, y) => x < y)
  const isRanked = reqs.length > 1 && longest !== undefined && shortest !== undefined && longest.ms > shortest.ms
  const barOf = (r: Req) => {
    const { a, b } = laneSpan(r.startMs, r.ms, total, laneW)
    const color = isRanked && r === longest ? T.rank.longest : isRanked && r === shortest ? T.rank.shortest : isWaiting(r) ? T.rank.working : r.who !== 'main' ? (r.depth > 1 ? T.actor.subEcho : T.actor.sub) : T.actor.main
    return { a, b, color }
  }
  // Laid over one lane in order, a later request over an earlier one.
  const stack = (rs: Req[]) => {
    const cells: (string | undefined)[] = Array.from({ length: laneW }, () => undefined)
    for (const r of rs) {
      const { a, b, color } = barOf(r)
      cells.fill(color, a, a + b)
    }
    return runsOf(cells)
  }
  return { total, barOf, stack }
}

/** A timeline folded to one lane: every request laid over it, as they are drawn open, from 0 to how long it has run;
 * `label` heads it, ↑ ↓ close it. `labelW` narrows the label's column where no row below lines up with it. */
export function Lane({ ui, reqs, turnMs, room, label, labelW = LW }: { ui: UI; reqs: Req[]; turnMs: number; room: number; label: string; labelW?: number }) {
  const { Text } = ui
  const laneW = Math.max(10, room - labelW - IO_W - 2)
  const { stack } = barsOf(reqs, turnMs, laneW)
  return (
    <Text>
      {fit(cut(label, labelW), labelW)}{' '}
      {stack(reqs).map(x => (x.color ? <Text color={x.color}>{'█'.repeat(x.n)}</Text> : ' '.repeat(x.n)))}{' '}
      {ioCol(reqs.reduce((n, r) => n + r.i, 0), reqs.reduce((n, r) => n + r.o, 0))}
    </Text>
  )
}

// One agent's requests, each a bar on a lane as long as its turn. room is the width it may fill; the live box sits inside
// a border, so it has less. isNewestFirst puts the latest request on top. The requests page like every list: shown rows
// are drawn, and the row that shows more lays the hidden bars over one lane in the colours they have when shown.
export function Waterfall({ ui, reqs, turnMs, room, isNewestFirst = false, pageKey, shown, more, fewer, spin, head = 'Request' }: { ui: UI; reqs: Req[]; turnMs: number; room: number; isNewestFirst?: boolean; pageKey: string; shown: number; more: PageStep; fewer?: PageStep; spin: string; head?: string }) {
  const { Box, Text, Button } = ui
  const laneW = Math.max(10, room - LW - IO_W - 2)
  const { total, barOf, stack } = barsOf(reqs, turnMs, laneW)
  const ordered = isNewestFirst ? [...reqs].reverse() : reqs
  const shownReqs = ordered.slice(0, shown)
  const hidden = ordered.slice(shownReqs.length)
  return (
    <Box flexDirection="column">
      {/* The lane's end says how long the turn ran; on the live turn, which has no row of its own, the column under ↑ ↓
          heads with what all its requests read and wrote. */}
      <Text color={T.text.muted}>{`${fit(head, LW)} 0${left(span(total), laneW - 1)}${isNewestFirst ? ` ${ioCol(reqs.reduce((n, r) => n + r.i, 0), reqs.reduce((n, r) => n + r.o, 0))}` : ''}`}</Text>
      {shownReqs.map(r => {
        const { a, b, color } = barOf(r)
        const own = `${r.no} ${isWaiting(r) ? `${spin} working` : `${r.label}${r.ms >= 15000 ? `  ${Math.round(r.ms / 1000)}s` : ''}`}`
        // The row still working says so in the live style, whatever colour its bar has ranked into.
        return (
          <Text>
            {isWaiting(r) ? <Text {...S.live}>{fit(cut(own, LW), LW)}</Text> : fit(cut(own, LW), LW)} {' '.repeat(a)}
            <Text color={color}>{'█'.repeat(b)}</Text>
            {' '.repeat(Math.max(0, laneW - a - b))} {ioCol(r.i, r.o)}
          </Text>
        )
      })}
      {hidden.length > 0 ? (
        // The row that shows more draws what it hides.
        <Button plain key={`node-more-${pageKey}`} onPress={more.onPress}>
          <Text>
            {fit(cut(more.label, LW), LW)}{' '}
            {stack(hidden).map(x => (x.color ? <Text color={x.color}>{'█'.repeat(x.n)}</Text> : ' '.repeat(x.n)))}{' '}
            {ioCol(hidden.reduce((n, r) => n + r.i, 0), hidden.reduce((n, r) => n + r.o, 0))}
          </Text>
        </Button>
      ) : null}
      <MoreRow ui={ui} listKey={pageKey} indent={0} fewer={fewer} />
    </Box>
  )
}
