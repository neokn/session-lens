import { Fold } from '../atoms/Fold'
import type { Compaction, EventRow } from '../../../types'
import { fit, io, k, left } from '../layout'
import { EventLine } from '../molecules/EventLine'
import { T, G, SPACE } from '../palette'
import type { UI } from '../ui'

// What both views of the log share: how wide they draw, and what a compaction's line opens.
export type LogFrame = { ui: UI; width: number; actionWidth: number; onRestart: (c: Compaction, key: string) => () => unknown }

export function LogHead({ ui, actionWidth: EW }: { ui: UI; actionWidth: number }) {
  const { Text } = ui
  return <Text color={T.text.muted}>{`${fit('Turn', 5)}${fit('Time', 9)}${fit('Agent', 16)}${fit('Action', EW)}${left('↑', 8)}${left('↓', 8)}`}</Text>
}

export const sums = (rows: EventRow[]) => io(k(rows.reduce((n, x) => n + (x.i ?? 0), 0)), k(rows.reduce((n, x) => n + x.o, 0)))

// The main page's box: the newest 10 events but the hooks, as `tail` shows; the rest and the filters are on the log's page.
export function EventLogBox({ ui, width: W, actionWidth, onRestart, log, onAll, isOpen, onToggle }: LogFrame & { log: EventRow[]; onAll: () => unknown; isOpen: boolean; onToggle: () => unknown }) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={W}>
      <Fold ui={ui} key="node-log" indent={0} isOpen={isOpen} title="Event log" summary={`${log.length} events · ${sums(log)}`} room={W - 4} onToggle={onToggle} />
      {isOpen ? (
        <Box flexDirection="column" paddingLeft={SPACE.indent}>
          <LogHead ui={ui} actionWidth={actionWidth} />
          {log.length === 0 ? <Text color={T.text.muted}>No events yet</Text> : null}
          {[...log]
            .reverse()
            .filter(x => x.kind !== 'hook')
            .slice(0, 10)
            .map((x, n) => <EventLine ui={ui} ev={x} n={n} actionWidth={actionWidth} onRestart={onRestart} />)}
          {log.length > 0 ? <Button plain key="node-log-all" label={`${G.page} All events · ${log.length}`} onPress={onAll} /> : null}
        </Box>
      ) : null}
    </Box>
  )
}
