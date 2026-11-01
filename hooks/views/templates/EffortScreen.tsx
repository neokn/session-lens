import type { EffortModel } from '../../digest/effort'
import { Chip } from '../atoms/Chip'
import { Spacer } from '../atoms/Spacer'
import { EffortChart, EffortHead } from '../molecules/EffortChart'
import { T, G, S, SPACE } from '../palette'
import type { UI } from '../ui'

export type EffortScope = 'all' | 'this'

/** The page that asks whether more effort means more tool calls: the main agent's turns, from every session the lens has
 * seen or from this one, each model's efforts on one scale, and how to read them. */
export function EffortScreen({ ui, width, rowWidth, study, sessions, turns, scope, onScope, status, onBack }: { ui: UI; width: number; rowWidth: number; study: EffortModel[]; sessions: number; turns: number; scope: EffortScope; onScope: (v: EffortScope) => () => unknown; status: 'pending' | 'ok' | 'error'; onBack: () => unknown }) {
  const { Box, Text, Button } = ui
  // One scale for every model, so their ranges can be compared too.
  const scale = Math.max(1, ...study.flatMap(m => m.rows.map(r => r.q3)))
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={width}>
      <Button plain key="node-effort-back" label={`${G.back} Back`} onPress={onBack} />
      <Text>
        <Text bold>Effort vs. Tool Calls</Text>
        <Text color={T.text.muted}>{`  main agent only · ${scope === 'all' ? `${sessions} session${sessions === 1 ? '' : 's'} · ` : ''}${turns} turns`}</Text>
      </Text>
      <Box flexDirection="row" columnGap={SPACE.tight}>
        <Chip ui={ui} key="node-effort-scope-all" label="all sessions" isOn={scope === 'all'} color={T.actor.main} onPress={onScope('all')} />
        <Chip ui={ui} key="node-effort-scope-this" label="this session" isOn={scope === 'this'} color={T.actor.main} onPress={onScope('this')} />
      </Box>
      <Spacer ui={ui} />
      {status === 'pending' ? <Text {...S.live}>Loading…</Text> : null}
      {status === 'error' ? <Text color={T.state.danger}>Could not read the turns kept from other sessions</Text> : null}
      {status !== 'pending' && study.length === 0 ? <Text color={T.text.muted}>No turn of the main agent has named its effort yet</Text> : null}
      {study.length > 0 ? <EffortHead ui={ui} room={rowWidth} /> : null}
      {study.map(m => (
        <Box key={`effort-model-${m.model}`} flexDirection="column" marginTop={SPACE.section}>
          <EffortChart ui={ui} study={m} scale={scale} room={rowWidth} />
        </Box>
      ))}
      <Spacer ui={ui} />
      <Text color={T.text.muted}>A turn is one prompt's work; one that switched effort counts once for each effort.</Text>
      <Text color={T.text.muted}>Calls are tool, skill and MCP calls. Dim rows have too few turns to go by.</Text>
      <Text color={T.text.muted}>A model's verdict compares its least and most effort: their middle halves apart, or overlapping.</Text>
    </Box>
  )
}
