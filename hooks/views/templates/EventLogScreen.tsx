import type { EventRow } from '../../../types'
import { KIND_FILTERS, type KindFilter, type WhoFilter } from '../../digest/events'
import { Chip } from '../atoms/Chip'
import { cut, fit, width } from '../layout'
import { EventLine } from '../molecules/EventLine'
import { MoreRow, type PageStep } from '../molecules/MoreRow'
import { LogHead, sums, type LogFrame } from '../organisms/EventLog'
import { T, G, SPACE } from '../palette'

// One turn's events on the log's page: a fold with what they read and wrote, its rows a page at a time.
export type EventFold = { key: string; title: string; isOpen: boolean; onToggle: () => unknown; all: EventRow[]; shown: EventRow[]; more?: PageStep; fewer?: PageStep }

// The log's page: every event, filtered by who and what, under the turn it belongs to.
export function EventLogScreen({ ui, width: W, rowWidth: IW, actionWidth, onRestart, total, picked, who, kind, onWho, onKind, folds, onExpand, more, fewer, onBack }: LogFrame & { rowWidth: number; total: EventRow[]; picked: number; who: WhoFilter; kind: KindFilter; onWho: (v: WhoFilter) => () => unknown; onKind: (v: KindFilter) => () => unknown; folds: EventFold[]; onExpand?: (isOn: boolean) => () => unknown; more?: PageStep; fewer?: PageStep; onBack: () => unknown }) {
  const { Box, Text, Button } = ui
  const WHO: [WhoFilter, string][] = [['all', 'all'], ['main', 'main'], ['sub', 'subagents']]
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={T.line.frame} paddingX={SPACE.inset} width={W}>
      <Button plain key="node-log-back" label={`${G.back} Back`} onPress={onBack} />
      <Text>
        <Text bold>All events</Text>
        <Text color={T.text.muted}>{`  ${picked} / ${total.length} events · ${sums(total)}`}</Text>
      </Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={SPACE.tight}>
        {WHO.map(([v, label]) => <Chip ui={ui} key={`log-who-${v}`} label={label} isOn={who === v} color={T.actor.main} onPress={onWho(v)} />)}
        <Text color={T.text.muted}>│</Text>
        {KIND_FILTERS.map(v => <Chip ui={ui} key={`log-kind-${v}`} label={v} isOn={kind === v} color={T.actor.main} onPress={onKind(v)} />)}
      </Box>
      <LogHead ui={ui} actionWidth={actionWidth} />
      {picked === 0 ? <Text color={T.text.muted}>No matching events</Text> : null}
      {onExpand ? (
        <Box flexDirection="row" columnGap={SPACE.gap}>
          <Button plain key="node-log-open-all" label={`${G.expandAll} Expand all`} onPress={onExpand(true)} />
          <Button plain key="node-log-close-all" label={`${G.collapseAll} Collapse all`} onPress={onExpand(false)} />
        </Box>
      ) : null}
      {folds.map(g => {
        const tail = ` ${g.all.length} events · ${sums(g.all)}`
        return (
          <Box key={`grp-${g.key}`} flexDirection="column">
            <Button plain key={`node-${g.key}`} label={fit(`${g.isOpen ? G.open : G.shut} ${cut(g.title, Math.max(8, IW - 2 - width(tail)))}${tail}`, IW)} onPress={g.onToggle} />
            {g.isOpen ? g.shown.map((x, n) => <EventLine ui={ui} ev={x} n={n} actionWidth={actionWidth} onRestart={onRestart} />) : null}
            {g.isOpen ? <MoreRow ui={ui} listKey={g.key} indent={0} more={g.more} fewer={g.fewer} /> : null}
          </Box>
        )
      })}
      <MoreRow ui={ui} listKey="log-turns" indent={0} more={more} fewer={fewer} />
    </Box>
  )
}

