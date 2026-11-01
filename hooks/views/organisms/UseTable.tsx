import type { UseRow } from '../../../types'
import { cut, fit, k, left } from '../layout'
import { MoreRow, type PageStep } from '../molecules/MoreRow'
import { T, S } from '../palette'
import type { UI } from '../ui'

// How many calls the rows add up to.
export const callsOf = (list: UseRow[]) => list.reduce((n, r) => n + r.count, 0)
// A list's page: how many rows it draws, and the presses below it.
export type ListPage = { shown: number; more?: PageStep; fewer?: PageStep }

const weight = (r: { sent?: number; back?: number }) => (r.sent ?? 0) + (r.back ?? 0)

// What an agent used of one kind, under its title: rows by where they are defined, the heaviest scope first, each
// scope a dim heading with its own count and paged on its own under listKey-<scope>.
export function UseTable({ ui, listKey, title, color, rows, indent, nameWidth, pageOf }: { ui: UI; listKey: string; title: string; color: string | undefined; rows: UseRow[]; indent: number; nameWidth: number; pageOf: (key: string, total: number) => ListPage }) {
  const { Box, Text } = ui
  const pad = ' '.repeat(indent)
  if (rows.length === 0) {
    return (
      <Text>
        {pad}
        <Text {...S.name} color={color}>{title}</Text>
        <Text color={T.text.muted}>  0 · none</Text>
      </Text>
    )
  }
  const sum = rows.reduce((a, r) => ({ c: a.c + r.count, s: a.s + (r.sent ?? 0), b: a.b + (r.back ?? 0) }), { c: 0, s: 0, b: 0 })
  const scopes = [...new Set(rows.map(r => r.scope))]
    .map(scope => ({ scope, rows: rows.filter(r => r.scope === scope) }))
    .sort((a, b) => a.rows.reduce((n, r) => n + weight(r), 0) - b.rows.reduce((n, r) => n + weight(r), 0) || b.rows.length - a.rows.length)
    .reverse()
  return (
    <Box flexDirection="column">
      <Text>
        {pad}
        <Text {...S.name} color={color}>{title}</Text>
        <Text color={T.text.muted}>{`  ${rows.length} kinds · ${sum.c} calls · ↑≈${k(sum.b)} ↓≈${k(sum.s)}`}</Text>
      </Text>
      <Text color={T.text.muted}>{`${pad}  ${fit('Name', nameWidth)}${left('Calls', 5)}${left('↑', 9)}${left('↓', 9)}`}</Text>
      {scopes.map(g => {
        const key = `${listKey}-${g.scope}`
        const page = pageOf(key, g.rows.length)
        return (
          <Box flexDirection="column" key={`use-${title}-@${g.scope}`}>
            <Text color={T.text.muted}>{`${pad}  ${g.scope} · ${callsOf(g.rows)} calls`}</Text>
            {[...g.rows]
              .sort((a, b) => weight(b) - weight(a) || b.count - a.count)
              .slice(0, page.shown)
              .map(r => (
                <Text key={`use-${title}-${g.scope}-${r.name}`}>
                  {`${pad}    ${fit(cut(r.name, nameWidth - 2), nameWidth - 2)}${left(String(r.count), 5)}${left(r.back === undefined ? '-' : `≈${k(r.back)}`, 9)}${left(r.sent === undefined ? '-' : `≈${k(r.sent)}`, 9)}`}
                </Text>
              ))}
            <MoreRow ui={ui} listKey={key} indent={indent + 4} more={page.more} fewer={page.fewer} />
          </Box>
        )
      })}
    </Box>
  )
}
