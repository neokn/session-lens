import type { TurnRow } from '../../../types'
import { cut, fit, IO_W, ioCol, ioHead, left, money, span, toolLabel, width } from '../layout'
import { T, G, S, SPACE } from '../palette'
import type { UI } from '../ui'

// One earlier turn: the idle time before it, the turn and what it took, then, folded, its requests on one lane in their
// timeline colours, or, opened, what it did and its requests.
export type TurnItem = { turn: TurnRow; tag: string; idle?: number; isOpen: boolean; onToggle: () => unknown; waterfall: JSX.Element | null; lane: JSX.Element | null }

// The columns after a turn's prompt: requests, tokens in and out, cost and time.
const COLS = 5 + (IO_W + 2) + 8 + 8

// The width of a turn's prompt, after the columns.
export const promptWidth = (rowWidth: number) => Math.max(18, rowWidth - 2 - COLS)

// The head of the table of turns.
export const turnHead = (rowWidth: number) => fit('Turn (newest first)', promptWidth(rowWidth)) + left('Reqs', 5) + left(ioHead, IO_W + 2) + left('Cost', 8) + left('Time', 8)

/** An earlier turn, unfolding in place. */
export function TurnEntry({ ui, rowWidth, turn: x, tag, idle, isOpen, onToggle, waterfall, lane }: TurnItem & { ui: UI; rowWidth: number }) {
  const { Box, Text, Button } = ui
  const TW = promptWidth(rowWidth)
        const did = Object.entries(x.did ?? {}).sort((a, b) => b[1] - a[1])
        return (
          <Box flexDirection="column">
            {idle !== undefined ? <Text {...(x.idleMs === undefined ? S.live : { color: T.text.muted })}>{`  ${G.idle} Idle ${span(idle)}${x.idleMs === undefined ? ' (so far)' : ''}`}</Text> : null}
            <Button plain key={`node-turn:${x.n}`} label={fit(cut(`${isOpen ? G.open : G.shut} #${x.n}「${x.preview}」`, TW - width(tag)) + tag, TW) + left(String(x.steps), 5) + left(ioCol(x.read, x.wrote), IO_W + 2) + left(money(x.usd), 8) + left(span(x.ms), 8)} onPress={onToggle} />
            {isOpen ? (
              <Box flexDirection="column" paddingLeft={SPACE.indent}>
                <Text color={T.text.muted}>Activity</Text>
                <Text>
                  {did.length === 0 && x.subCount === 0 ? <Text color={T.text.muted}>No actions recorded</Text> : ''}
                  {did.map(([n, c]) => (
                    <Text>
                      {`${toolLabel(n)} `}
                      <Text bold>×{c}</Text>
                      <Text color={T.text.muted}>{'  '}</Text>
                    </Text>
                  ))}
                  {x.subCount > 0 ? (
                    <Text color={T.actor.sub}>
                      Subagents <Text bold>{x.subCount}</Text>
                    </Text>
                  ) : (
                    ''
                  )}
                </Text>
                {waterfall ?? <Text color={T.text.muted}>Turn too old: no waterfall kept.</Text>}
              </Box>
            ) : lane ? (
              <Box paddingLeft={SPACE.indent}>{lane}</Box>
            ) : null}
          </Box>
        )
}
