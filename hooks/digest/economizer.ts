import type { Economizer } from '../../types'
import { clean, parsed } from './text'

// What TokenEconomizer, another plugin, says it did in this repository: read from `te status --json` for its figures and
// `te toolprune show` for its tools, as that list alone leaves out the tools the person gave back. Pure.

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isText = (v: unknown): v is string => typeof v === 'string'
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isText) : [])

// Another project's output with no promise of its shape: a figure gone missing draws nothing, never a zero that reassures.
export function economizerOf(status: string, prune: string): Economizer | null {
  let v: any
  try {
    v = parsed(status)
  } catch {
    return null
  }
  const { config: c, microskills: m, toolprune: t, loopguard: g, ledger: l } = v ?? {}
  const figures = [l?.sessions, l?.turns, l?.overhead_tokens, l?.overhead_frac, l?.nudges, l?.aborts, t?.sessions, t?.prompts, m?.injected_lines, c?.toolprune_quiet_minutes]
  if (!figures.every(isNum) || ![m?.profile, t?.mode, g?.mode].every(isText) || !Array.isArray(t?.applied)) return null
  const proposed = /^proposed: (.*)$/m.exec(prune)?.[1]
  if (proposed === undefined) return null
  const waiting = proposed === '-' || t.mode === 'off' ? [] : clean(proposed).split(', ').filter(Boolean)
  return {
    sessions: l.sessions,
    turns: l.turns,
    overhead: { tokens: l.overhead_tokens, share: l.overhead_frac },
    facts: { mode: m.profile, count: m.injected_lines },
    tools: { mode: t.mode, sessions: t.sessions, prompts: t.prompts, applied: texts(t.applied), waiting, isPending: /^pending:/m.test(prune), quietMinutes: c.toolprune_quiet_minutes },
    loop: { mode: g.mode, redirects: l.nudges, stuck: l.aborts },
    warnings: texts(v.warnings),
  }
}

const counted = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

// What it holds, for the fold's head: only what it did or is about to do.
export function economizerSummary(e: Economizer): string {
  const said = [
    e.tools.applied.length > 0 ? `${counted(e.tools.applied.length, 'tool')} left out` : '',
    e.tools.waiting.length > 0 ? `${counted(e.tools.waiting.length, 'tool')} waiting to be left out` : '',
    e.facts.count > 0 ? `${counted(e.facts.count, 'fact')} injected` : '',
    e.loop.redirects > 0 ? counted(e.loop.redirects, 'redirect') : '',
    e.loop.stuck > 0 ? `${e.loop.stuck} still stuck` : '',
  ].filter(Boolean)
  return said.length > 0 ? said.join(' · ') : `nothing yet · ${counted(e.sessions, 'session')} watched`
}

// When the waiting tools are written, in its own terms.
export function waitingNote(e: Economizer): string {
  if (e.tools.isPending) return `written by itself after ${e.tools.quietMinutes} idle minutes here`
  return e.tools.mode === 'propose' ? 'written only when you apply them' : 'proposed'
}

// Tools by where they come from, as a long list of names says less than how many of each: an MCP server's, or the harness's own.
export function toolGroups(names: string[]): { name: string; count: number }[] {
  const by = new Map<string, number>()
  for (const n of names) {
    const server = /^mcp__(.+?)__/.exec(n)?.[1]?.replace(/^(claude_ai|plugin)_/, '') ?? 'built-in'
    by.set(server, (by.get(server) ?? 0) + 1)
  }
  return [...by].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}
