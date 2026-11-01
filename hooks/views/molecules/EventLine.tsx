import type { Compaction, EventRow } from '../../../types'
import { cut, fit, fmtTime, k, left, prompt, toolLabel, width } from '../layout'
import { agentColor, T, G, S } from '../palette'
import type { UI } from '../ui'

// A function, read as each line draws, so a change of theme reaches it.
const KIND_COLOR = (): Record<string, string | undefined> => ({ tool: undefined, mcp: T.source.mcp, skill: T.source.skill, agent: T.actor.sub, reply: T.actor.mainEcho, prompt: T.actor.main, hook: T.source.hook, compact: T.cost.spend, switch: T.text.soft })
const evName = (x: { kind: string; name: string }) => (x.kind === 'mcp' ? toolLabel(x.name) : x.kind === 'prompt' ? prompt(x.name) : x.name)
// Sent and not yet answered: what it read is not known yet.
const isPending = (x: { kind: string; i?: number }) => x.kind !== 'reply' && x.kind !== 'prompt' && x.kind !== 'hook' && x.kind !== 'compact' && x.kind !== 'switch' && x.i === undefined

// One line of the event log. In the Action column, after the action: what it was given, then the first line of what
// came back. A reply shows what it said in place of the word. A compaction opens a page of what the window restarted
// from: onRestart gets the compaction and the key of its page. n tells apart lines of the same time.
export function EventLine({ ui, ev: x, n, actionWidth: EW, onRestart }: { ui: UI; ev: EventRow; n: number; actionWidth: number; onRestart: (c: Compaction, key: string) => () => unknown }) {
  const { Text, Button } = ui
  const isReply = x.kind === 'reply'
  // A hook's name starts with where it is written.
  const cmpKey = x.kind === 'compact' && x.restart ? `${x.ts}|${x.pre ?? 0}` : undefined
  const name = cut(isReply ? (x.detail ?? x.name) : x.kind === 'hook' && x.src ? `[${x.src}] ${evName(x)}` : cmpKey ? `${G.page} ${evName(x)}` : evName(x), EW - 1)
  const room = Math.max(0, EW - 1 - width(name) - 1)
  // A hook: how long it ran, then what ran.
  const said = isReply ? '' : x.kind === 'compact' ? `${x.detail === 'auto' ? 'auto' : 'manual'} ${k(x.pre ?? 0)} → ${k(x.i ?? 0)} -${k(Math.max(0, (x.pre ?? 0) - (x.i ?? 0)))}` : x.kind === 'hook' ? [x.ms === undefined ? '' : `${x.ms}ms`, x.detail ?? ''].filter(Boolean).join(' ') : (x.detail ?? '')
  const back = x.result ? `${said ? ' ' : ''}→ ${x.isError ? `${G.failed} ` : ''}${x.result}` : ''
  const saidText = room > 0 && said ? cut(said, back ? Math.min(width(said), Math.max(12, Math.ceil(room * 0.6))) : room) : ''
  const backText = back && room - width(saidText) > 1 ? cut(back, room - width(saidText)) : ''
  const extra = saidText || backText ? 1 + width(saidText) + width(backText) : 0
  const cells = [
    <Text color={T.text.muted}>{fit(x.turn ? `#${x.turn}` : '', 5)}{fit(fmtTime(x.ts), 9)}</Text>,
    <Text color={agentColor(x.depth)}>{fit(cut(`${' '.repeat(Math.min(4, x.depth))}${x.depth > 0 ? '└' : ''}${x.who}`, 15), 16)}</Text>,
    <Text color={KIND_COLOR()[x.kind]}>{name}</Text>,
    extra > 0 ? ' ' : '',
    saidText ? <Text color={T.text.muted}>{saidText}</Text> : '',
    backText ? <Text color={x.isError ? T.state.danger : T.text.muted}>{backText}</Text> : '',
    ' '.repeat(Math.max(0, EW - width(name) - extra)),
    isPending(x) ? <Text {...S.live}>{left('…', 8)}</Text> : left(x.i === undefined || x.kind === 'compact' ? '-' : k(x.i), 8),
    left(x.kind === 'prompt' || x.kind === 'hook' || x.kind === 'compact' || x.kind === 'switch' ? '-' : k(x.o), 8),
  ]
  if (!cmpKey) return <Text key={`ev-${x.ts}-${n}`}>{cells}</Text>
  return (
    <Button plain key={`node-cmp-${cmpKey}`} onPress={onRestart(x.restart as Compaction, cmpKey)}>
      {cells}
    </Button>
  )
}
