import type { AgentRun, Chat, ChatKind, Shape } from '../../types'
import { estimateTokens } from './record'

// The context window: how the parts read from the record are fitted to what the API says the window holds. Pure.

/** Estimates scaled down together so they add up to no more than `cap`, the figure the API gives. */
export function fitWithin(vs: number[], cap: number): number[] {
  const sum = vs.reduce((n, v) => n + v, 0)
  return sum > cap && sum > 0 ? vs.map(v => Math.round((v * cap) / sum)) : vs
}

// A part of the window: its name, its tokens, whether they are estimated, and the page it opens, if any.
export type ContextPart = { key: string; name: string; v: number; approx: boolean; kind?: ChatKind }

/** Main's conversation since the last compaction, by kind, the largest first. Character counts only estimate tokens, so
 * the kinds are scaled down together when they add up to more than `messages`, what the API says the conversation holds.
 * Thinking is the API's figure when it gives one, else what was written past the visible reply, out of what is left. */
export function chatPartsOf(talk: Chat, messages: number): ContextPart[] {
  const seen: { name: string; v: number; kind?: ChatKind }[] = [
    { name: `Assistant messages ×${talk.replyCount}`, v: talk.replyTokens, kind: 'reply' },
    { name: `Tool calls & results ×${talk.toolCount}`, v: talk.toolTokens, kind: 'tool' },
    { name: `Injected (skills · reminders) ×${talk.injectedCount}`, v: talk.injectedTokens, kind: 'injected' },
    { name: `User messages ×${talk.userCount}`, v: talk.userTokens, kind: 'user' },
    { name: `Attachments (reminders · lists · hooks) ×${talk.attachCount}`, v: talk.attachTokens, kind: 'attach' },
    { name: `Notifications (subagents) ×${talk.noticeCount}`, v: talk.noticeTokens, kind: 'notice' },
    { name: `Deferred tool definitions ×${talk.toolDefCount}`, v: talk.toolDefTokens, kind: 'toolDef' },
    ...(talk.thinkingTokens !== undefined ? [{ name: 'thinking', v: talk.thinkingTokens }] : []),
  ]
  const fitted = fitWithin(seen.map(x => x.v), messages)
  const afterSeen = Math.max(0, messages - fitted.reduce((n, v) => n + v, 0))
  const guessed = talk.thinkingTokens === undefined ? Math.min(Math.max(0, talk.outputTokens - talk.replyTokens), afterSeen) : 0
  return [
    ...seen.map((x, n) => ({ ...x, v: fitted[n] ?? 0 })),
    ...(talk.thinkingTokens === undefined ? [{ name: 'thinking (est.)', v: guessed }] : []),
    { name: 'Other (unaccounted)', v: afterSeen - guessed },
  ]
    .sort((a, b) => b.v - a.v)
    .map((x, n) => ({ key: `chat-${n}`, approx: true, ...x }))
}

/** A subagent's window, the largest part first. It has no /context of its own: its first request is the init, its tool
 * calls and skills are counted from the record, and the rest is what it wrote and thought. One that never sent a request
 * has no figure from the API: its init is its initial prompt, estimated (`prompt`), with the system prompt and tools once
 * they are read (`shape`). */
export function subPartsOf(run: AgentRun, prompt: number, shape?: Shape): ContextPart[] {
  const guessed = run.init === undefined ? prompt + (shape ? estimateTokens(shape.system) + shape.tools.reduce((n, t) => n + t.tokens, 0) : 0) : undefined
  const init = guessed ?? Math.min(run.last, run.init ?? 0)
  const room = Math.max(0, run.last - init)
  const used = Object.values(run.tools).reduce((n, u) => n + u.read + u.wrote, 0)
  const skilled = Object.values(run.skills).reduce((n, x) => n + x.tokens, 0)
  // After a compaction the counts can exceed what is left of the window: they share it in proportion.
  const scale = used + skilled > room ? room / (used + skilled) : 1
  const toolsV = Math.round(used * scale)
  const skillsV = Math.round(skilled * scale)
  return [
    { key: 'init', name: 'init (system prompt · tools · task)', v: init, approx: guessed !== undefined },
    { key: 'tools', name: 'Tool calls & results', v: toolsV, approx: true },
    { key: 'skills', name: 'Skill expansions', v: skillsV, approx: true },
    { key: 'rest', name: 'Other (replies · thinking · notifications)', v: Math.max(0, room - toolsV - skillsV), approx: true },
  ].sort((a, b) => b.v - a.v)
}
