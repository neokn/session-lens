/**
 * What one thing the session ran put through the model, from the model's side:
 * `wrote` is what the model produced (a call's arguments), `read` is what it was
 * handed back (the result). Both are estimates in tokens.
 */
export type Use = { calls: number; errors: number; wrote: number; read: number; server?: boolean }

/** A skill whose prompt the engine expanded for the model; `tokens` is what the model read. */
// One tool, MCP tool, skill or hook an agent used: how often, what it sent and read back, and where it is defined.
export type UseRow = { name: string; count: number; sent?: number; back?: number; scope: string }
export type SkillUse = { count: number; tokens: number; source: string; isEarlier?: boolean }

/** One MCP server: its own totals and a count per tool. */
export type McpUse = Use & { tools: Record<string, Use> }

/**
 * One subagent's own run, from the API's per-request figures: `init` is its first request's whole
 * prompt (system prompt, tools, preloaded skills and the task), `last` and `peak` its context now
 * and at most; `output` is what it wrote, `input` + `cacheRead` + `cacheWrite` what it was handed
 * summed over every request, the same context counted again at each step.
 */
export type AgentRun = {
  turns: number
  steps: number
  /** Requests counted in `steps` that no reply came back to, so with no usage: a `claude -p` child's, killed while it waited. */
  unanswered?: number
  init?: number
  initCached?: number
  last: number
  peak: number
  output: number
  input: number
  cacheRead: number
  cacheWrite: number
  tools: Record<string, Use>
  skills: Record<string, { count: number; tokens: number }>
  /** The model and effort the agent's latest request named, from the session record. */
  model?: string
  effort?: string
  /** What its requests cost at list price, cache reads and writes at their own rates; `unpriced` counts requests whose model has no price. */
  usd?: number
  unpriced?: number
  /** The models named by the requests counted in `unpriced`, so the price table can be told what is missing. */
  unpricedModels?: string[]
  /** Its requests by the model that served each, `?` when none is named; the advisor's under `<model> (advisor)`. */
  byModel?: Record<string, Bill>
  /** What the advisor tool cost it: requests a stronger model served inside its own, billed but never in its window. Counted in `usd` and `byModel` too. */
  advisor?: Bill
  /** Web searches its tools ran, each billed at a flat price apart from the tokens; counted in `usd`. */
  searches?: number
  /** Its requests in runs of one model, in order; only when the model changed. `rewrite` is what the run's first request paid to write the cache again. */
  segments?: Segment[]
  /** The model / effort settings it ran at, in order, once it ran at two or more. */
  settings?: { model: string; effort: string }[]
  /** What each model / effort setting did a turn, in the order first used; only when it used two or more. */
  combos?: Combo[]
}

export type Segment = { model: string; from: string; to: string; steps: number; i: number; o: number; usd: number; rewrite: number; rewriteTokens: number }

/** A model / effort setting and what the turns under it did: a subagent's run of one setting counts as one turn. */
export type Combo = { model: string; effort: string; turns: number; steps: number; tools: number; skills: number; mcp: number; thinking: number }

/** A stretch of the session and what the harness counted it cost, after `start` up to `end` (epoch ms). */
export type Spend = { start: number; end: number; usd: number; byModel?: Record<string, number> }

/**
 * What a count of /cost had reached by `at` (epoch ms), counted from its `start`: the session's launch, which a resume
 * keeps, or the last /login, which starts another. The harness writes one as a process exits, by model; the lens takes
 * one at every priced response, `proc` naming the process that took it.
 */
export type Reading = { start: number; at: number; usd: number; byModel?: Record<string, number>; proc?: number }

/** The session's total: what was measured, plus what the record says the rest cost, scaled by how far off the record was where both are known. */
export type Ledger = { total: number; pm: number; snapped: number; estimated: number; raw: number; ratio?: number; ratios?: Record<string, { ratio: number; isOwn: boolean }>; isFull: boolean }

/** One figure for each kind of token a request is billed by: fresh input, cache read, cache write for five minutes and for an hour, output. */
export type TokenKinds = { i: number; cr: number; w5: number; w1: number; o: number }

/** Requests served by one model: how many, their tokens by kind, and what each kind cost; `usd` is absent when the model has no price. */
export type Bill = { steps: number; tokens: TokenKinds; usd?: TokenKinds }

/**
 * Who a subagent is, and what the Agent call that started it cost the caller, who treats it as a tool: `call` is
 * the arguments it wrote (O), `ack` what the call handed back (I) -- for a background run only the notice that it started.
 * `report` is the final report the subagent handed back, which reaches its caller later as a notification.
 * `skill` names the skill it runs, for a subagent a forked skill started (a `/name` the person typed).
 */
export type AgentMeta = {
  type: string
  description: string
  status: string
  parentId?: string
  model?: string
  startedAt?: string
  call?: number
  ack?: number
  report?: number
  skill?: string
  /** Its initial prompt, every user message before its first reply, in estimated tokens. */
  prompt?: number
  /** A `claude -p` child guessed from the time it started, inside one of the parent's Bash calls, rather than seen starting. */
  inferred?: boolean
}

/** An Agent call no subagent answers (the type did not exist): `host` is who made it, `main` or an agent's id. */
export type FailedCall = { host: string; i: number; o: number; why?: string }

/**
 * A shell an agent left running in the background (`run_in_background`, or a call moved there at its timeout): `id` the
 * harness's task id, `owner` the agent that started it (`main` or a subagent's id), `command` the start of what it runs,
 * `desc` what the call said it does. It runs from `startedAt` until its task notification or a TaskStop ends it at `endedAt`,
 * `status` then the harness's word (`completed`, `failed`, `killed`) and `exit` its exit code when the notice gives one.
 */
export type Shell = { id: string; owner: string; command: string; desc?: string; startedAt: string; endedAt?: string; status: string; exit?: number }

/** A slash command the session ran: how often, who provides it, who ran it. */
export type CommandUse = { count: number; source: string; plugin?: string; origins: Record<string, number> }

/**
 * The conversation's own text since the last compaction, estimated from the transcript. `tool` is the calls' arguments
 * and results, `outputTokens` what the model wrote by the API, thinking included. `user` is what the person typed or pasted
 * (origin human); `injected` is text the harness put into a user turn (a skill's expansion, reminders);
 * `notice` is what other agents and background tasks sent; `reply` the model's visible words; `attach` the harness's
 * own reminders, listings and hook output.
 */
/** A kind of the conversation, each a row of the Breakdown's Conversation. */
export type ChatKind = 'reply' | 'tool' | 'injected' | 'user' | 'attach' | 'notice' | 'toolDef'
/** What one kind holds, by what it is: a tool, a skill, an attachment's type, or the start of a message. */
export type ChatGroup = { label: string; count: number; tokens: number }
export type Chat = {
  userCount: number
  userTokens: number
  replyCount: number
  replyTokens: number
  injectedCount: number
  injectedTokens: number
  noticeCount: number
  noticeTokens: number
  attachCount: number
  attachTokens: number
  toolCount: number
  toolTokens: number
  /** Tool definitions sent in the conversation once a deferred tool is loaded. */
  toolDefCount: number
  toolDefTokens: number
  outputTokens: number
  /** What the API says the model spent thinking; absent when no request says. */
  thinkingTokens?: number
  /** What each kind holds, largest first; absent from a reading saved before it was kept. */
  groups?: Partial<Record<ChatKind, ChatGroup[]>>
}

/**
 * What one prompt cost, from the person's input to the end of the work it started: the main agent's
 * requests and those of every subagent it launched, nested ones included. `ms` runs to the last reply.
 */
export type TurnRow = {
  n: number
  preview: string
  /** What the turn cost at list price: main's requests, the advisor's inside them, its web searches, and every subagent it launched. */
  usd?: number
  steps: number
  wrote: number
  read: number
  cacheRead: number
  subCount: number
  subSteps: number
  subRead: number
  subWrote: number
  ms: number
  /** When the prompt was sent. */
  startedAt?: string
  /** The main agent's window as the turn ended, and when that was. */
  ctx?: number
  endedAt?: string
  /** From the turn's last reply to the next prompt; absent for the newest turn, whose idle runs to now. */
  idleMs?: number
  /** What the turn did: the main agent's tool calls by name, and `thinking` / `回覆` by request. */
  did?: Record<string, number>
  /** The model and effort its first request named; `switched` when that differs from the turn before. A new model mid-turn starts a turn of its own. */
  model?: string
  effort?: string
  switched?: boolean
  /** The main agent's own calls by kind, and its thinking tokens. */
  calls?: { steps: number; tools: number; skills: number; mcp: number; thinking: number }
  /** The same, one entry for each run of an effort: an effort switched mid-turn splits it, and so does a compaction (`cut` counts those before it). */
  runs?: { effort?: string; cut: number; steps: number; tools: number; skills: number; mcp: number; thinking: number }[]
  /** Still going, as the record shows: a request awaits its reply or a tool has not come back. */
  open?: boolean
  /** The waterfall of this turn; kept for the newest turns only. */
  reqs?: Req[]
}

/**
 * One bar of a turn's waterfall: a request of the main agent (`who` is `main`, `no` its place among them) or a whole
 * subagent (`who` its type, `depth` 1 for one the main agent launched, 2 for one that one launched). `startMs` is where
 * it begins on the turn's clock, `ms` how long it lasts (to the next request, tool run included); `i`/`o` are what it was
 * handed and wrote, `n` how many requests that took. A subagent's row has its agent's `id` and `kids`, its own requests
 * on the turn's clock, each with `of` the id of the subagent that sent it. A background shell's row has `who` `$`, `label`
 * its command, `shell` what the call said it does and, once ended, `exit` how it ended.
 */
export type Req = { who: string; depth: number; no?: number; label: string; startMs: number; ms: number; i: number; o: number; n: number; running?: boolean; id?: string; of?: string; kids?: Req[]; prompt?: string }

/**
 * One action in the record, newest last: who did it (`main` or an agent's type, `depth` 0 for main, 1 for a subagent it
 * launched, 2 below that), what kind, its name, what went out (O) and what came back (I; absent while a tool still runs).
 */
/** One action in the event log. `detail` is what the action was given (a command, a path, a pattern, the start of a reply),
 * `result` the first line of what came back, `isError` whether the tool reported a failure, `turn` the turn it belongs to.
 * `agent` is the id of who made a call, a reply, a switch or ran a hook (`main` for main); a hook's `ms` how long it ran, `src` where it is written (`user`, `project`, `local`, `plugin:<name>`, `?` when no source names it).
 * A compaction's `detail` is what set it off, `pre` the context before and `i` after, `restart` what the window restarted from. */
export type EventRow = { ts: string; who: string; depth: number; kind: 'tool' | 'mcp' | 'skill' | 'agent' | 'reply' | 'prompt' | 'hook' | 'compact' | 'switch'; name: string; o: number; i?: number; detail?: string; result?: string; isError?: boolean; turn?: number; agent?: string; ms?: number; src?: string; pre?: number; restart?: Compaction }

/**
 * One compaction of the session, from its boundary in the record: what set it off, and the context before and after.
 * `ms` is how long it took, `summary` the size of the summary it wrote (an estimate), `uuid` the boundary's id and
 * `keep` the ids of the recent messages it carried over word for word.
 */
export type Compaction = { ts: string; trigger: string; pre: number; post: number; ms?: number; summary?: number; uuid?: string; keep?: string[] }

/**
 * What the window restarted from after a compaction. What the compaction chose is here whole: the summary and the messages
 * it kept; the files it read back, the skills it carried and the files it only points to, by name. `fixed` is what every
 * compaction attaches again (instructions, listings, hook output), by name and estimated size.
 */
export type Restart = { summary: string; kept: { role: string; text: string }[]; files: string[]; skills: string[]; refs: string[]; fixed: { name: string; tokens: number }[]; shape?: Shape }

/** The system prompt a request was sent with, whole, and its tools by name and estimated size. */
export type Shape = { system: string; tools: { name: string; tokens: number }[] }

/** A subagent's initial prompt, message by message: `meta` for what the harness injected, otherwise the task it was handed. */
export type Prompt = { meta: boolean; text: string }[]

/** What a subagent's first request was sent: its messages, and the system prompt and tools when the record has them. */
export type Opening = { messages: Prompt; shape?: Shape }

/** One square of the /context grid, as the pane draws it. */
export type GridSquare = { color: string; ch: string }

/** What /context knows, reduced to the rows the pane draws. */
export type Snapshot = {
  model: string
  percent: number
  total: number
  max: number
  window: number
  threshold?: number
  cost?: number
  /** When the count `cost` runs from began (epoch ms). */
  startedAt?: number
  rows: { name: string; tokens: number; kind: string; color: string }[]
  grid: GridSquare[][]
  skills: { name: string; source: string; tokens: number }[]
  mcpTools: { name: string; server: string; tokens: number; isLoaded: boolean }[]
  /** `type` is where /context says it was loaded from (`Project`, `User`, `AutoMem`). */
  memory: { path: string; type: string; tokens: number }[]
  /** `source` is where the agent is defined, in the engine's word (`projectSettings`, `plugin`). */
  agents: { name: string; source: string; tokens: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-lens': {
      /** The theme this session draws in, named at the pane's foot; null until it is first read. */
      themeDrawn: 'dark' | 'light' | null
      snapshot: Snapshot | null
      skills: Record<string, SkillUse>
      mainRun: AgentRun | null
      /** Main agent from its last compaction on: what its own node and its context show. */
      mainNow: AgentRun | null
      agentRuns: Record<string, AgentRun>
      agentInfo: Record<string, AgentMeta>
      failedCalls: FailedCall[]
      /** Every background shell of the session, main's and its subagents', in the order they started. */
      shells: Shell[]
      commands: Record<string, CommandUse>
      chat: Chat
      turns: TurnRow[]
      events: EventRow[]
      slashCounts: Record<string, number>
      compactions: Compaction[]
      sessionCombos: Combo[]
      /** What the total is made of: every reading of /cost, the harness's and the lens's, and every priced request or search. */
      readings: Reading[]
      priced: { ts: number; usd: number; md?: string }[]
      /** When this process started (epoch ms): what names the readings it takes. */
      started: number | null
      /** Where the main agent's turn stands: running or not, when it began, what the person typed for it. Kept apart from the code so a reload keeps it. */
      turnState: { isBusy: boolean; hasHeardTurn: boolean; busySince: number; busyText: string; busyTurn?: string }
      /** Which nodes of the tree are open; every node starts closed. */
      openNodes: Record<string, boolean>
      /** How many rows a long list shows, by the list's key: it starts at a page and grows a page a press. */
      shownRows: Record<string, number>
      history: { status: 'pending' | 'ok' | 'no-jq' | 'error'; detail: string }
      /** What the event log shows: whose actions, and which kind; 'tool' covers tool, MCP and skill, 'talk' prompts and replies, 'hook' the hooks that put something into the context, 'compact' the compactions. */
      logFilter: { who: 'all' | 'main' | 'sub'; kind: 'all' | 'tool' | 'agent' | 'talk' | 'hook' | 'compact' }
      /** What fills the pane: the past turns, the whole event log, or null for the main page. */
      /** The compaction page's content, read when it opens. */
      restart: { uuid: string; status: 'pending' | 'ok' | 'error'; detail: string; data?: Restart } | null
      /** Each subagent's initial prompt, read when its fold first opens. */
      prompts: Record<string, { status: 'pending' | 'ok' | 'error'; detail: string; data?: Opening }>
      /** The system prompt and tools main's request was sent with since `boundary` (the last compaction, '' for none), read when an Init page needs them. */
      mainShape: { boundary: string; status: 'pending' | 'ok' | 'error'; detail: string; data?: Shape } | null
      /** Each MCP server's instructions main holds, read each time their Init page opens. */
      mcpInstructions: { status: 'pending' | 'ok' | 'error'; detail: string; data?: { name: string; text: string }[] } | null
      /** Each memory file's text, by path, read when its fold first opens. */
      memoryText: Record<string, { status: 'pending' | 'ok' | 'error'; detail: string; data?: string }>
      /** The main agent's turns kept from every session, by session id, read when the effort page opens. */
      effortAll: { status: 'pending' | 'ok' | 'error'; bySession: Record<string, { model: string; effort: string; calls: number; steps: number }[]> } | null
      /** Whether the effort page draws every session's turns or this one's. */
      effortScope: 'all' | 'this'
      /** `init:<category>` is the page of one part of main's Init, by the name /context gives it. */
      page: 'turns' | 'log' | 'tokens' | 'components' | 'effort' | `cmp:${'log' | 'main'}:${string}` | `init:${string}` | null
    }
  }
}
