import type { EffortModel } from '../../digest/effort'
import { FEW } from '../../digest/effort'
import { fit, left, shortModel } from '../layout'
import { S, T } from '../palette'
import type { UI } from '../ui'

const VERDICT: Record<EffortModel['verdict'], string> = {
  more: '↑ more effort, more calls',
  fewer: '↓ more effort, fewer calls',
  same: '≈ no clear difference',
  few: `not enough turns yet (${FEW} an effort, two efforts)`,
}
// The columns after the range: the median, calls a request, how many turns.
const COLS = 6 + 8 + 9

/** One model's efforts, least to most, on one scale: each a range from the turn a quarter of the way up to the one three
 * quarters up, `┼` at the median, then the median, calls a request and the turns behind it. An effort with too few turns
 * is drawn as an estimate. */
export function EffortChart({ ui, study, scale, room }: { ui: UI; study: EffortModel; scale: number; room: number }) {
  const { Box, Text } = ui
  const LW = 8
  const span = Math.max(8, room - LW - COLS)
  const cell = (v: number) => Math.min(span - 1, Math.round((v / Math.max(1e-9, scale)) * (span - 1)))
  return (
    <Box flexDirection="column">
      <Text>
        <Text {...S.name}>{shortModel(study.model)}</Text>
        <Text {...(study.verdict === 'few' ? S.estimate : S.figure)}>{`  ${VERDICT[study.verdict]}`}</Text>
      </Text>
      {study.rows.map(r => {
        const [a, m, b] = [cell(r.q1), cell(r.median), cell(r.q3)]
        const line = Array.from({ length: span }, (_, n) => (n === m ? '┼' : n === a ? '├' : n === b ? '┤' : n > a && n < b ? '─' : ' ')).join('')
        const isFew = r.n < FEW
        return (
          <Text key={`effort-${study.model}-${r.effort}`}>
            {fit(`  ${r.effort}`, LW)}
            <Text color={isFew ? T.text.muted : T.actor.main}>{line}</Text>
            <Text {...(isFew ? S.estimate : S.figure)}>{left(r.median.toFixed(r.median % 1 ? 1 : 0), 6)}</Text>
            <Text color={T.text.muted}>{left(r.perStep.toFixed(2), 8)}{left(`${r.n} turn${r.n === 1 ? '' : 's'}`, 9)}</Text>
          </Text>
        )
      })}
    </Box>
  )
}

/** The heading over the charts' columns. */
export function EffortHead({ ui, room }: { ui: UI; room: number }) {
  const { Text } = ui
  const span = Math.max(8, room - 8 - COLS)
  return <Text color={T.text.muted}>{`${fit('Effort', 8)}${fit('Calls a turn (middle half, ┼ median)', span)}${left('Median', 6)}${left('Per req', 8)}${left('Turns', 9)}`}</Text>
}
