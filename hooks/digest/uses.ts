import type { AgentMeta, AgentRun, EventRow, SkillUse, UseRow } from '../../types'
import { same } from './record'

// What an agent used: its tools, MCP tools, skills and hooks, a row each, with where each is defined. Pure.

// An MCP tool's scope, from its name: a plugin's server, a claude.ai connector, or one the settings files add.
export const mcpScope = (name: string) => (name.startsWith('mcp__plugin_') ? 'plugin' : name.startsWith('mcp__claude_ai_') ? 'claude.ai' : 'settings')

/** The rows of what agent `id` used. Main's own figures, and its hooks, start at its last compaction (`since`); a skill
 * main forked to a subagent of its own (one of `kids`) counts as main's. `known` are the skills read this session and
 * `listed` the ones the session lists, for where each is defined. An MCP tool keeps its full name. */
export function usesOf(id: string, run: AgentRun, isMain: boolean, o: { known: Record<string, SkillUse>; listed: { name: string; source: string }[]; who: Record<string, AgentMeta>; kids: string[]; log: EventRow[]; since: string }) {
  const { who } = o
  const entries = Object.entries(run.tools)
  // A server tool (the advisor) runs at the API; what it hands back is redacted, its size unknown.
  const toolRows: UseRow[] = entries
    .filter(([n]) => !n.startsWith('mcp__'))
    .map(([n, u]) => (u.server ? { name: n, count: u.calls, sent: u.wrote, scope: 'server tool' } : { name: n, count: u.calls, sent: u.wrote, back: u.read, scope: 'built-in' }))
  const mcpRows: UseRow[] = entries.filter(([n]) => n.startsWith('mcp__')).map(([n, u]) => ({ name: n, count: u.calls, sent: u.wrote, back: u.read, scope: mcpScope(n) }))
  const known = (n: string) => Object.entries(o.known).find(([k]) => same(k, n))?.[1]
  const scopeOf = (n: string) => known(n)?.source ?? o.listed.find(x => same(x.name, n))?.source ?? '?'
  const skillRows: UseRow[] = Object.entries(run.skills).map(([n, x]) => {
    const live = isMain ? (known(n)?.tokens ?? 0) : x.tokens
    return { name: n, count: x.count, back: live > 0 ? live : undefined, scope: scopeOf(n) }
  })
  // A forked skill is main's, run by a subagent of its own: main's ↓ is the skill's prompt it hands that subagent, and
  // main's ↑ the result the subagent sends back.
  const forked = isMain ? o.kids.filter(c => who[c]?.skill && (who[c]?.startedAt ?? '') >= o.since) : []
  for (const c of forked) {
    const n = who[c]?.skill ?? '?'
    const name = `${n} (fork)`
    const row = skillRows.find(r => r.name === name)
    if (row) {
      row.count += 1
      row.back = (row.back ?? 0) + (who[c]?.report ?? 0)
      row.sent = (row.sent ?? 0) + (who[c]?.call ?? 0)
    } else skillRows.push({ name, count: 1, back: who[c]?.report, sent: who[c]?.call, scope: scopeOf(n) })
  }
  // The hooks that put something into its context: grouped by the event they hook, a row for each place one is written,
  // with the matcher it ran under.
  const hookRows: UseRow[] = []
  for (const e of o.log) {
    if (e.kind !== 'hook' || e.agent !== id || (isMain && e.ts < o.since)) continue
    const [event = e.name, matcher] = e.name.split(':')
    const scope = event
    const name = matcher ? `${e.src ?? '?'} · ${matcher}` : (e.src ?? '?')
    const row = hookRows.find(r => r.name === name && r.scope === scope)
    if (row) {
      row.count += 1
      row.back = (row.back ?? 0) + (e.i ?? 0)
    } else hookRows.push({ name, count: 1, back: e.i ?? 0, scope })
  }
  return { toolRows, mcpRows, skillRows, hookRows }
}
