import type { EngineInterface } from 'claude-code'

import type { AgentRun, Opening, Prompt, Restart, Shape } from '../../types'
import { type Digest, est, type Row, scan } from '../digest/record'
import { type AgentDigest, agentDigestOf, hookKey, sessionOf } from '../digest/session'
import { type Meta, ms, runOf } from '../digest/turns'
import { type BashWindow, type ChildLink, guessChildren, readChildren, sessionsDirOf } from './children'

// Reads the session's record through jq, the file system and the shell: the adapter between the engine's tools and the
// rules in `digest/`. What it reads is cached here, never in `digest/`.

// What jq keeps of each line of a session record: sizes and names, and of the text only a short line for the event log:
// what each tool call was given, the first line of what came back, the start of each reply. Besides what was said it keeps what the
// harness attached (reminders, listings) and the slash commands that ran, which the record stores outside the conversation. An image in a tool's result is
// counted as about 3k tokens (12000 characters), not as the base64 text it is stored as. A 59 MB record comes out
// around 4 MB, which no one command may print over 4 MiB of, so a record is read in slices (see `rowsOf`).
const FILTER = `
(select(.type=="assistant" or .type=="user")
 | {t:.type, id:(.message.id // null), ts:(.timestamp // null), o:(.origin.kind // null), meta:((.isMeta // false) or (.isCompactSummary // false)), cs:(.isCompactSummary // false), ef:(.effort // null), md:(.message.model // null), sc:(.toolUseResult | if type=="object" then .searchCount else null end // null), bg:(.toolUseResult | if type=="object" then .backgroundTaskId else null end // null), su:(.sourceToolUseID // null),
   pv:(if .type=="user" and ((.origin.kind // "human")=="human") and ((.isMeta // false)|not) and ((.isCompactSummary // false)|not) then ((.message.content | if type=="string" then . else ([.[]|select(.type=="text")|.text]|join(" ")) end) | .[0:80]) else null end),
   u:(if .message.usage then {i:.message.usage.input_tokens,o:.message.usage.output_tokens,cr:.message.usage.cache_read_input_tokens,cw:.message.usage.cache_creation_input_tokens,c1:(.message.usage.cache_creation.ephemeral_1h_input_tokens // 0),th:(.message.usage.output_tokens_details.thinking_tokens // null),
      ad:[(.message.usage.iterations // [])[] | select(.type=="advisor_message") | {i:(.input_tokens // 0),o:(.output_tokens // 0),cr:(.cache_read_input_tokens // 0),cw:(.cache_creation_input_tokens // 0),c1:(.cache_creation.ephemeral_1h_input_tokens // 0),md:(.model // null)}]} else null end),
   c:[ (.message.content | if type=="array" then .[] else {type:"text",text:.} end)
       | if .type=="tool_use" then {k:"use",id,name,n:(.input|tostring|length),sk:(.input.skill // null),pl:((.input.prompt // "")|length),ds:(if .name=="Bash" then ((.input.description // "") | tostring | gsub("\\\\s+";" ") | .[0:80]) else null end),tk:(if .name=="TaskStop" or .name=="KillShell" then (.input.task_id // .input.shell_id // null) else null end),
           d:(.name as $nm | .input | if $nm=="Skill" then (.args // "") else (.command // .file_path // .notebook_path // .pattern // .query // .url // .description // .prompt // .message // tostring) end | tostring | gsub("\\\\s+";" ") | .[0:80])}
         elif .type=="tool_result" then {k:"res",id:.tool_use_id,n:(.content | if type=="array" then (map(if .type=="image" then 12000 elif .type=="text" then (.text|length) else (tostring|length) end) | add // 0) else (tostring|length) end),e:(.is_error // false),
           r:(.content | if type=="array" then ([.[]|select(.type=="text")|.text]|join("\\n")) elif type=="string" then . else "" end | [splits("\\n")|select(test("\\\\S"))][0] // "" | gsub("\\\\s+";" ") | .[0:80])}
         elif .type=="server_tool_use" then {k:"use",sv:true,id,name,n:(.input|tostring|length),sk:null,pl:0,d:(.input | if . == {} then "" else tostring end | gsub("\\\\s+";" ") | .[0:80])}
         elif (.type | endswith("_tool_result")) then {k:"res",id:.tool_use_id,n:(.content | if type=="object" and ((.type // "") | endswith("redacted_result")) then 0 else (tostring|length) end),e:false,r:""}
         elif .type=="text" then {k:"text",n:(.text|length),w:([.text|explode[]|select(.>11903)]|length),x:(.text|gsub("\\\\s+";" ")|.[0:80])}
         else {k:.type} end ]}),
(select(.type=="api-request-blob" and (.message.content|type)=="array") | .hash as $h | [.message.content[] | select(.type=="tool_addition") | {k:"tooladd",n:(.tool|tostring|length),name:(.tool.name // .tool.definition.name // null)}] | select(length > 0) | {t:"tooldef", h:$h, c:., u:null, id:null}),
(select(.type=="system" and .subtype=="compact_boundary") | {t:"compact", ts:(.timestamp // null), tr:(.compactMetadata.trigger // null), pre:(.compactMetadata.preTokens // null), post:(.compactMetadata.postTokens // null), ms:(.compactMetadata.durationMs // null), bu:(.uuid // null), pu:(.compactMetadata.preservedMessages.uuids // []), c:[], u:null, id:null}),
(select(.type=="attachment" and ((.attachment.type // "") | startswith("hook_"))) | .attachment as $a | (($a.content // "") | tostring) as $ct
 | {t:"hook", ts:(.timestamp // null), at:$a.type, hn:($a.hookName // $a.hookEvent // null), cmd:(($a.command // "") | tostring | gsub("\\\\s+";" ") | .[0:120]), ms:($a.durationMs // null), ec:($a.exitCode // null), n:(if $ct != "" then ($ct | length) elif ($a.type | test("^hook_blocking_error$")) then (($a.stderr // "") | tostring | length) else 0 end),
   r:((if $ct != "" then $ct else ((($a.stdout // "") | tostring) + (($a.stderr // "") | tostring)) end) | [splits("\\n")|select(test("\\\\S"))][0] // "" | gsub("\\\\s+";" ") | .[0:80]), c:[], u:null, id:null}),
(select(.type=="attachment" and ((.attachment.type // "") != "prompt_snapshot")) | {t:"attachment", ts:(.timestamp // null), n:(.attachment|tostring|length), at:(.attachment.type // null),
   qp:(.attachment | if .type=="queued_command" and .commandMode=="prompt" and ((.origin.kind // "human")=="human") then (.prompt | tostring) as $p | {x:($p | .[0:80]), n:($p | length)} else null end), c:[], u:null, id:null}),
(select(.type=="system" or .type=="attachment") | (.content // .attachment.content // "" | tostring) as $c | select($c | test("<command-name>")) | {t:"cmd", ts:(.timestamp // null), names:[$c | scan("<command-name>/?([^<]+)</command-name>") | .[0]], args:[$c | scan("<command-args>([^<]*)</command-args>") | .[0] | .[0:80]], c:[], u:null, id:null}),
(select(.type=="user" and ((.isMeta // false)|not)) | (.message.content | if type=="string" then . else ([.[]|select(.type=="text")|.text]|join(" ")) end) as $c | select($c | test("^ *<command-(message|name)>")) | {t:"cmd", ts:(.timestamp // null), names:[$c | scan("<command-name>/?([^<]+)</command-name>") | .[0]], args:[$c | scan("<command-args>([^<]*)</command-args>") | .[0] | .[0:80]], c:[], u:null, id:null}),
(select(.type=="cost-state") | {t:"cost", st:(.startTime // null), usd:(.totalCostUSD // null), bm:((.modelUsage // {}) | map_values(.costUSD // 0)), c:[], u:null, id:null}),
(select(.type=="system" and .subtype=="model_refusal_fallback") | {t:"fallback", ts:(.timestamp // null), c:[], u:null, id:null}),
(select(.type=="queue-operation" and .operation=="enqueue" and ((.content // "") | tostring | test("<task-notification>"))) | (.content | tostring) as $q | {t:"task", ts:(.timestamp // null), tid:([$q | scan("<task-id>([^<]+)</task-id>") | .[0]][0] // null), tu:([$q | scan("<tool-use-id>([^<]+)</tool-use-id>") | .[0]][0] // null), tst:([$q | scan("<status>([^<]+)</status>") | .[0]][0] // null), ec:([$q | scan("exit code (-?[0-9]+)") | .[0] | tonumber][0] // null), c:[], u:null, id:null}),
(select(.type=="api-request") | {t:"sent", ts:(.timestamp // null), md:(.params.model? // null), c:[], u:null, id:null})`

// Rows already read from a record, by file: a read takes only the bytes written since the last one. A cache and nothing more,
// so a reloaded module just reads again.
const rowCache = new Map<string, { end: number; rows: Row[] }>()
const SLICE = 16 * 1024 * 1024
// Reads one slice of a record from byte `$2`, at most `$3` bytes and only whole lines, through the filter `$4`. The first
// line it prints is `<where it stopped> <size of the file>`; a line still being written is left for the next read.
const SLICER = `f=$1; o=$2; cap=$3
total=$(wc -c < "$f" | tr -d ' ')
lim=$((o + cap)); [ "$lim" -gt "$total" ] && lim=$total
end=$o
if [ "$lim" -gt "$o" ]; then
  if [ "$(head -c "$lim" "$f" | tail -c 1 | od -An -c | tr -d ' ')" = '\\n' ]; then end=$lim
  else end=$((lim - $(head -c "$lim" "$f" | tail -n 1 | wc -c | tr -d ' '))); fi
fi
echo "$end $total"
if [ "$end" -gt "$o" ]; then tail -c +$((o + 1)) "$f" | head -c $((end - o)) | jq -c "$4" || exit 2; fi`

async function wholeRowsOf($: EngineInterface, file: string): Promise<Row[]> {
  const out = await $.process.run(['jq', '-c', FILTER, file], { timeoutMs: 60_000 })
  if (out.exitCode !== 0) throw new Error(`jq exited with ${out.exitCode}: ${out.stderr.slice(0, 200)}`)
  if (out.isStdoutTruncated) throw new Error('jq output exceeds 4 MiB')
  return out.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as Row)
}

async function rowsOf($: EngineInterface, file: string): Promise<Row[]> {
  let have = rowCache.get(file) ?? { end: 0, rows: [] }
  let cap = SLICE
  try {
    for (;;) {
      const out = await $.process.run(['sh', '-c', SLICER, 'sh', file, String(have.end), String(cap), FILTER], { timeoutMs: 60_000 })
      if (out.exitCode !== 0) throw new Error(`slice exited with ${out.exitCode}: ${out.stderr.slice(0, 200)}`)
      if (out.isStdoutTruncated) throw new Error('jq output exceeds 4 MiB')
      const [head = '', ...lines] = out.stdout.split('\n')
      const [end, total] = head.split(' ').map(Number)
      if (end === undefined || total === undefined || !Number.isFinite(end) || !Number.isFinite(total)) throw new Error('slice printed no position')
      // The file is shorter than what was read of it: it was written over, so it is read again from the start.
      if (total < have.end) {
        have = { end: 0, rows: [] }
        continue
      }
      const progressed = end > have.end
      have = { end, rows: have.rows.concat(lines.filter(Boolean).map(line => JSON.parse(line) as Row)) }
      if (end >= total) break
      if (!progressed) {
        // One line longer than the slice: widen it.
        if (cap >= total) break
        cap *= 2
      }
    }
  } catch {
    // No sh (or no jq in it): the whole record through jq, as before.
    rowCache.delete(file)
    return wholeRowsOf($, file)
  }
  rowCache.set(file, have)
  return have.rows
}

// Each subagent's digest, by its file, with the size it was read at: a file that has not grown is not scanned again, and
// one that has replaces it.
const kept = new Map<string, AgentDigest>()

// Where a session's record was found, by its id: it stays put for the session's life.
const recordDirs = new Map<string, string>()

// Where each subagent's record was found: in `subagents/`, or a workflow run's folder beneath it.
const agentFiles = new Map<string, string>()

// Which of a workflow run's agents have ended, kept until its journal or its run file changes.
const runStates = new Map<string, { sig: string; isOver: boolean; ended: Set<string> }>()

type Entry = { name: string; size: number; mtimeMs: number }
// A run's agents never say they ended: its journal does, a `result` or `failed` for each. An agent cut off (a session
// limit) gets neither, but a resume starts its step again under a new agent, which ends the old one; and once the run's
// own file says it is over, written after the journal's last line, every agent of it is over.
async function runStateOf($: EngineInterface, at: string, journal?: Entry, runFile?: string): Promise<{ isOver: boolean; ended: Set<string> }> {
  const ended = new Set<string>()
  let text = ''
  try {
    text = journal ? await $.fs.read(`${at}/journal.jsonl`) : ''
  } catch {
    // No journal yet: every agent of the run still runs.
  }
  const latest = new Map<string, string>()
  for (const line of text.split('\n')) {
    // A line's own fields come before what an agent handed back, which can run to tens of thousands of characters.
    const head = line.slice(0, 400)
    const type = /"type":"(\w+)"/.exec(head)?.[1]
    const agentId = /"agentId":"([^"]+)"/.exec(head)?.[1]
    const key = /"key":"([^"]+)"/.exec(head)?.[1]
    if (!agentId) continue
    if (type === 'result' || type === 'failed') ended.add(agentId)
    else if (type === 'started' && key) {
      const before = latest.get(key)
      if (before && before !== agentId) ended.add(before)
      latest.set(key, agentId)
    }
  }
  let isOver = false
  if (runFile) {
    try {
      // A run file is written again as the run goes; one written before the journal's last line is from an earlier pass.
      const { status, timestamp } = JSON.parse(await $.fs.read(runFile)) as { status?: string; timestamp?: string }
      const written = Date.parse(timestamp ?? '')
      isOver = status !== undefined && status !== 'running' && status !== 'pending' && (!journal || written >= journal.mtimeMs - 2000)
    } catch {
      // Unreadable: the journal alone says who ended.
    }
  }
  return { isOver, ended }
}

// Where each hook is written, by `hookKey`. A command several sources share names them all.
let sources: { at: number; map: Map<string, string[]> } | undefined
async function hookSources($: EngineInterface, home: string, root: string): Promise<Map<string, string[]>> {
  if (sources && Date.now() - sources.at < 30_000) return sources.map
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`
  const json = async (path: string): Promise<any> => {
    try {
      return JSON.parse(await $.fs.read(path))
    } catch {
      return undefined
    }
  }
  const map = new Map<string, string[]>()
  const add = (hooks: unknown, src: string) => {
    if (!hooks || typeof hooks !== 'object') return
    for (const [event, groups] of Object.entries(hooks)) {
      for (const g of Array.isArray(groups) ? groups : []) {
        for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
          if (typeof h?.command !== 'string') continue
          // A command with `args` runs, and is recorded, as the two joined.
          const key = hookKey(event, [h.command, ...(Array.isArray(h.args) ? h.args : [])].join(' '))
          map.set(key, [...new Set([...(map.get(key) ?? []), src])])
        }
      }
    }
  }
  // The settings files, the project's over the person's, each also saying which plugins are on.
  const enabled: Record<string, boolean> = {}
  for (const [path, src] of [[`${config}/settings.json`, 'user'], [`${root}/.claude/settings.json`, 'project'], [`${root}/.claude/settings.local.json`, 'local']] as const) {
    const s = await json(path)
    add(s?.hooks, src)
    Object.assign(enabled, s?.enabledPlugins ?? {})
  }
  // Every installed plugin that is on: its hooks.json, under `hooks` or at the top.
  const installed = await json(`${config}/plugins/installed_plugins.json`)
  for (const [name, list] of Object.entries<any>(installed?.plugins ?? {})) {
    if (Object.keys(enabled).length > 0 && enabled[name] !== true) continue
    for (const p of Array.isArray(list) ? list : []) {
      if (typeof p?.installPath !== 'string') continue
      const h = await json(`${p.installPath}/hooks/hooks.json`)
      add(h?.hooks ?? h, `plugin:${name.split('@')[0]}`)
    }
  }
  sources = { at: Date.now(), map }
  return map
}

/**
 * The folder holding the session's record. The engine files it under the directory the session started in, which
 * `root()` keeps and `cwd()` loses once a shell `cd` moves it; after a `/cd` or a worktree move neither may name it,
 * so any project folder holding the id will do. Undefined until the session writes its first line. Another session's is
 * looked for under the folder it started in (`startedIn`) first, and only there when `isOnlyThere`.
 */
async function recordDirOf($: EngineInterface, home: string, id: string, startedIn?: string, isOnlyThere?: boolean): Promise<string | undefined> {
  const known = recordDirs.get(id)
  if (known) return known
  const base = `${(await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`}/projects`
  const holds = async (dir: string) => {
    try {
      return (await $.fs.list(dir)).some(f => f.name === `${id}.jsonl`)
    } catch {
      return false
    }
  }
  const named = [...new Set((startedIn ? [startedIn] : [await $.session.root(), await $.session.cwd()]).map(p => `${base}/${p.replace(/[^a-zA-Z0-9]/g, '-')}`))]
  let others: string[] = []
  try {
    if (!isOnlyThere) others = (await $.fs.list(base)).filter(f => f.kind === 'dir').map(f => `${base}/${f.name}`).filter(d => !named.includes(d))
  } catch {
    // No projects folder: nothing to search.
  }
  for (const dir of [...named, ...others]) {
    if (!(await holds(dir))) continue
    recordDirs.set(id, dir)
    return dir
  }
  return undefined
}

async function recordOf($: EngineInterface): Promise<{ home: string; id: string; dir: string }> {
  const home = await $.env.get('HOME')
  if (!home) throw new Error('HOME is not set')
  const id = await $.session.id()
  const dir = await recordDirOf($, home, id)
  if (!dir) throw new Error(`No transcript for this session yet (${id}.jsonl): it is written after the first message`)
  return { home, id, dir }
}

// After the boundary named $b, up to the first request: what the window restarts from, one row each; and the messages
// it kept word for word ($keep), wherever they sit. Files and skills give their names only: their text is fixed.
const RESTART_FILTER = `
def body: if type == "string" then . elif type == "array" then [.[] | if type == "string" then . elif .type == "text" then .text elif .type == "tool_use" then "→ \\(.name) \\(.input | tojson)" elif .type == "tool_result" then (.content | body) else empty end] | join("\\n") else "" end;
foreach inputs as $r ({on: false, done: false, row: null};
  .row = null
  | if (($r.uuid // "") as $u | $keep | index($u)) != null then
      .row = {k: "keep", u: $r.uuid, role: $r.type, name: ($r.attachment.hookName // $r.attachment.type // null), text: (if $r.type == "attachment" then ($r.attachment.content // "" | body) else ($r.message.content | body) end)}
    elif $r.uuid == $b and $r.subtype == "compact_boundary" then .on = true
    elif .on and (.done | not) then
      if $r.type == "assistant" then .done = true
      elif ($r.isCompactSummary // false) then .row = {k: "summary", text: ($r.message.content | body)}
      elif $r.type == "attachment" then
        ($r.attachment.type // "?") as $t
        | if $t == "file" then .row = {k: "file", p: ($r.attachment.displayPath // $r.attachment.content.file.filePath // $r.attachment.filename)}
          elif $t == "invoked_skills" then .row = {k: "skills", names: [($r.attachment.skills // [])[] | .name]}
          elif $t == "compact_file_reference" then .row = {k: "ref", p: ($r.attachment.displayPath // $r.attachment.filename)}
          else .row = {k: "fixed", name: $t, n: ($r.attachment | tojson | length)} end
      else . end
    else . end;
  .row // empty)
`

type RestartRow = { k: 'keep' | 'summary' | 'file' | 'skills' | 'ref' | 'fixed'; u?: string; role?: string; name?: string | null; text?: string; p?: string; names?: string[]; n?: number }

// The system prompt and the tools a request was sent with, from the shape the harness records before it: the last one
// before the first reply after the boundary named $b, or after the start when $b is empty.
const SHAPE_FILTER = `
reduce inputs as $r ({on: ($b == ""), done: false, shape: null};
  if .done then .
  elif $r.type == "api-request-shape" then .shape = $r.shape
  elif $b != "" and $r.uuid == $b then .on = true
  elif .on and $r.type == "assistant" then .done = true
  else . end)
| .shape // empty
| {system: ([.system[]? | .text // ""] | join("\\n\\n")), tools: [.tools[]? | {name: (.name // "?"), n: (tojson | length)}]}`

async function readShape($: EngineInterface, file: string, boundary = ''): Promise<Shape | undefined> {
  const out = await $.process.run(['jq', '-c', '-n', '--arg', 'b', boundary, SHAPE_FILTER, file], { timeoutMs: 60_000 })
  if (out.exitCode !== 0) throw new Error(`jq exited with ${out.exitCode}: ${out.stderr.slice(0, 200)}`)
  const line = out.stdout.split('\n').find(Boolean)
  if (!line) return undefined
  const raw = JSON.parse(line) as { system: string; tools: { name: string; n: number }[] }
  return { system: raw.system, tools: raw.tools.map(t => ({ name: t.name, tokens: est(t.n) })) }
}

/** What the window restarted from after one compaction, read from the record only when its page opens. */
export async function readRestart($: EngineInterface, uuid: string, keep: string[]): Promise<Restart> {
  const { id, dir } = await recordOf($)
  const shape = await readShape($, `${dir}/${id}.jsonl`, uuid)
  const out = await $.process.run(['jq', '-c', '-n', '--arg', 'b', uuid, '--argjson', 'keep', JSON.stringify(keep), RESTART_FILTER, `${dir}/${id}.jsonl`], { timeoutMs: 60_000 })
  if (out.exitCode !== 0) throw new Error(`jq exited with ${out.exitCode}: ${out.stderr.slice(0, 200)}`)
  if (out.isStdoutTruncated) throw new Error('jq output exceeds 4 MiB')
  const rows = out.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as RestartRow)
  // A kept message is written again after the boundary: its latest copy stands, in the order they were kept.
  const byId = new Map(rows.filter(r => r.k === 'keep' && r.u).map(r => [r.u ?? '', r]))
  const fixed = new Map<string, number>()
  for (const r of rows) if (r.k === 'fixed' && r.name) fixed.set(r.name, (fixed.get(r.name) ?? 0) + est(r.n ?? 0))
  return {
    summary: rows.filter(r => r.k === 'summary').map(r => r.text ?? '').join('\n'),
    kept: keep.flatMap(u => {
      const r = byId.get(u)
      return r ? [{ role: r.role === 'attachment' ? (r.name ?? 'attachment') : (r.role ?? '?'), text: r.text ?? '' }] : []
    }),
    files: rows.filter(r => r.k === 'file' && r.p).map(r => r.p ?? ''),
    skills: rows.flatMap(r => (r.k === 'skills' ? (r.names ?? []) : [])),
    refs: rows.filter(r => r.k === 'ref' && r.p).map(r => r.p ?? ''),
    fixed: [...fixed].map(([name, tokens]) => ({ name, tokens })),
    shape,
  }
}

// Each MCP server's instructions reach main as `mcp_instructions_delta` attachments, not in its system prompt: a server
// added with its block (`## <name>` and the text), or removed by name. Folded in order, what is left is what main holds now.
const INSTRUCTIONS_FILTER = `
reduce (inputs | select(.type == "attachment" and .attachment.type == "mcp_instructions_delta" and (.isSidechain | not)) | .attachment) as $a ({};
  (reduce ($a.removedNames // [])[] as $n (.; del(.[$n])))
  | reduce range(0; ($a.addedNames // []) | length) as $i (.; .[$a.addedNames[$i]] = ($a.addedBlocks[$i] // "")))
| to_entries[] | {name: .key, text: .value}`

/** Each MCP server's instructions main holds now, in the order they were attached; none when the record has no such attachment. */
export async function readMcpInstructions($: EngineInterface): Promise<{ name: string; text: string }[]> {
  const { id, dir } = await recordOf($)
  const out = await $.process.run(['jq', '-c', '-n', INSTRUCTIONS_FILTER, `${dir}/${id}.jsonl`], { timeoutMs: 60_000 })
  if (out.exitCode !== 0) throw new Error(`jq exited with ${out.exitCode}: ${out.stderr.slice(0, 200)}`)
  if (out.isStdoutTruncated) throw new Error('jq output exceeds 4 MiB')
  return out.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as { name: string; text: string })
}

/** The system prompt and tools main's request was sent with after the boundary named (its last compaction), or from the start. */
export async function readMainShape($: EngineInterface, boundary: string): Promise<Shape | undefined> {
  const { id, dir } = await recordOf($)
  return readShape($, `${dir}/${id}.jsonl`, boundary)
}

// A subagent's initial prompt: every user message before its first reply -- the task it was handed, or a forked skill's
// prompt, and what the harness injected beside it; and the system prompt and tools its first request was sent with.
const PROMPT_FILTER = `
label $out | inputs | if .type == "assistant" then break $out else . end
| select(.type == "user")
| {meta: (.isMeta // false), text: (.message.content | if type == "string" then . else ([.[] | select(.type == "text") | .text] | join("\\n")) end)}
| select(.text != "")`

export async function readPrompt($: EngineInterface, agentId: string): Promise<Opening> {
  const { id, dir } = await recordOf($)
  const file = agentFiles.get(agentId) ?? `${dir}/${id}/subagents/agent-${agentId}.jsonl`
  const out = await $.process.run(['jq', '-c', '-n', PROMPT_FILTER, file], { timeoutMs: 60_000 })
  if (out.exitCode !== 0) throw new Error(`jq exited with ${out.exitCode}: ${out.stderr.slice(0, 200)}`)
  if (out.isStdoutTruncated) throw new Error('jq output exceeds 4 MiB')
  return { messages: out.stdout.split('\n').filter(Boolean).map(line => JSON.parse(line) as Prompt[number]), shape: await readShape($, file) }
}

// Hard links of this session's record, its transcript and everything in its folder (subagents, workflows, tool results), in
// a projects folder of their own: a reader that walks a projects folder sees this session alone. Kept beside
// ~/.claude/projects, so on the same volume, and made anew at each call.
const LINKER = `set -e
src=$1 id=$2 root=$3 project=$4
rm -rf "$root"
mkdir -p "$root/$project"
ln "$src/$id.jsonl" "$root/$project/$id.jsonl"
if [ -d "$src/$id" ]; then
  cd "$src"
  find "$id" -type d -exec mkdir -p "$root/$project/{}" \\;
  find "$id" -type f -exec ln {} "$root/$project/{}" \\;
fi`

export async function linkSession($: EngineInterface): Promise<{ root: string; out: string }> {
  const { home, id, dir } = await recordOf($)
  const out = `${home}/.claude/session-reports`
  const root = `${out}/.root/${id}`
  const project = dir.split('/').pop() ?? 'project'
  const ran = await $.process.run(['sh', '-c', LINKER, 'sh', dir, id, root, project], { timeoutMs: 60_000 })
  if (ran.exitCode !== 0) throw new Error(`linking the session exited with ${ran.exitCode}: ${ran.stderr.slice(0, 200)}`)
  return { root, out }
}

// The `claude -p` sessions found ended, by id: a pid file once gone, or another session's, never comes back for it.
const childrenEnded = new Set<string>()
// The ended ones whose record no project folder held, after one search of them all.
const childrenLost = new Set<string>()

const ALIVE = 'for p; do kill -0 "$p" 2>/dev/null && echo "$p"; done'

// The children still running: the pid file is there and still names the child, as a pid is soon given to another
// process, and the process lives, as one killed outright leaves its pid file behind. One shell asks for them all.
async function runningOf($: EngineInterface, sessions: string, links: ChildLink[]): Promise<Set<string>> {
  const named: ChildLink[] = []
  for (const link of links) {
    if (link.inferred || childrenEnded.has(link.child)) continue
    try {
      if (JSON.parse(await $.fs.read(`${sessions}/${link.pid}.json`))?.sessionId === link.child) {
        named.push(link)
        continue
      }
    } catch {
      // Gone: it has ended.
    }
    childrenEnded.add(link.child)
  }
  if (named.length === 0) return new Set()
  const out = await $.process.run(['sh', '-c', ALIVE, 'sh', ...named.map(l => String(l.pid))], { timeoutMs: 10_000 })
  const alive = new Set(out.stdout.split('\n').filter(Boolean))
  const running = new Set<string>()
  for (const link of named) {
    if (alive.has(String(link.pid))) running.add(link.child)
    else childrenEnded.add(link.child)
  }
  return running
}

// A child's record: under the folder it started in while it runs, which costs one listing; once it has ended, anywhere.
async function childFileOf($: EngineInterface, home: string, link: ChildLink, isRunning: boolean): Promise<string | undefined> {
  if (childrenLost.has(link.child)) return undefined
  const dir = await recordDirOf($, home, link.child, link.cwd || undefined, isRunning)
  if (!dir && !isRunning) childrenLost.add(link.child)
  return dir && `${dir}/${link.child}.jsonl`
}

// An agent's record, read again only when it has grown: what its node, its log and the totals need of it.
async function digestOf($: EngineInterface, file: string, size: number): Promise<AgentDigest> {
  const hit = kept.get(file)
  if (hit?.size === size) return hit
  const rows = await rowsOf($, file)
  const fresh = agentDigestOf(rows, size)
  kept.set(file, fresh)
  return fresh
}

export async function readHistory($: EngineInterface): Promise<Digest> {
  const { home, id, dir } = await recordOf($)
  const cwd = await $.session.cwd()

  const rows = await rowsOf($, `${dir}/${id}.jsonl`)
  const main = scan(rows.filter(r => r.t !== 'compact'))

  const agents: Record<string, AgentRun> = {}
  const metas: Record<string, Meta> = {}
  const calls: Record<string, AgentDigest> = {}
  type Listing = Awaited<ReturnType<EngineInterface['fs']['list']>>
  const listOf = async (at: string): Promise<Listing> => {
    try {
      return await $.fs.list(at)
    } catch {
      return []
    }
  }
  // A subagent's files sit in `subagents/`; a workflow's agents in `subagents/workflows/<run>/`, beside a journal that says
  // which have ended, for their own records say nothing of it.
  const places: { at: string; files: Listing; ended?: (agentId: string) => boolean }[] = [{ at: `${dir}/${id}/subagents`, files: await listOf(`${dir}/${id}/subagents`) }]
  const runFiles = await listOf(`${dir}/${id}/workflows`)
  for (const run of await listOf(`${dir}/${id}/subagents/workflows`)) {
    if (run.kind !== 'dir') continue
    const at = `${dir}/${id}/subagents/workflows/${run.name}`
    const files = await listOf(at)
    const journal = files.find(f => f.name === 'journal.jsonl')
    const runFile = runFiles.find(f => f.name === `${run.name}.json`)
    const sig = `${journal?.size}:${runFile?.size}:${runFile?.mtimeMs}`
    let state = runStates.get(at)
    if (state?.sig !== sig) {
      state = { sig, ...(await runStateOf($, at, journal, runFile && `${dir}/${id}/workflows/${runFile.name}`)) }
      runStates.set(at, state)
    }
    const { isOver, ended } = state
    places.push({ at, files, ended: agentId => isOver || ended.has(agentId) })
  }
  for (const { at, files, ended } of places) for (const f of files) {
    const m = /^agent-(.+)\.jsonl$/.exec(f.name)
    if (!m) continue
    const agentId = m[1] ?? f.name
    const file = `${at}/${f.name}`
    agentFiles.set(agentId, file)
    const hit = await digestOf($, file, f.size)
    agents[agentId] = hit.run
    calls[agentId] = hit
    try {
      metas[agentId] = JSON.parse(await $.fs.read(`${at}/agent-${agentId}.meta.json`))
    } catch {
      metas[agentId] = {}
    }
    if (ended) metas[agentId] = { ...metas[agentId], finished: ended(agentId) }
    // An agent that has ended writes no more: its digest is all that is needed, so its rows are let go. A session with a
    // workflow in it holds hundreds of these.
    if (metas[agentId]?.finished) rowCache.delete(file)
    // A skill that runs forked (a `/name` the person typed) is a subagent of its own, named in a file beside it.
    if (files.some(x => x.name === `agent-${agentId}.forked-skill.json`)) {
      try {
        const forked = JSON.parse(await $.fs.read(`${at}/agent-${agentId}.forked-skill.json`))
        if (typeof forked?.skillName === 'string') metas[agentId] = { ...metas[agentId], skill: forked.skillName }
      } catch {
        // Unreadable: the agent is still listed, only not as a skill.
      }
    }
  }
  // The `claude -p` sessions a Bash call of this session started, each an agent of its own under whoever made the call;
  // their records sit in their own project folders, and name neither the call nor this session.
  const childOf = new Map<string, { status: string; inferred?: boolean }>()
  const sessions = await sessionsDirOf($, home)
  const { links, watched } = await readChildren($, home, id)
  // A Bash call no watch covered, from start to result, of the main agent or a subagent: a child that began in one is
  // guessed at from the records alone.
  const windows: BashWindow[] = []
  for (const [, c] of [['main', main] as const, ...Object.entries(calls)]) {
    for (const [call, u] of c.uses) {
      const from = ms(u.ts)
      const to = ms(c.results.get(call)?.ts)
      if (u.name !== 'Bash' || Number.isNaN(from) || Number.isNaN(to)) continue
      // A span that meets a call covers it: one that began inside it began at that call's hook, before its shell ran, and a
      // result is written only when the call ended while the process lived.
      if (!watched.some(w => w.from <= to && from <= w.to)) windows.push({ call, from, to })
    }
  }
  const guessedFile = new Map<string, string>()
  const guesses: ChildLink[] = []
  for (const g of windows.length > 0 ? await guessChildren($, home, windows, id) : []) {
    guessedFile.set(g.child, g.file)
    guesses.push({ pid: 0, child: g.child, cwd: '', at: g.at, call: g.call, inferred: true })
  }
  // A guessed one has no process known: it is taken as ended.
  const running = await runningOf($, sessions, links)
  const cutOff: { child: string; ts: string; md?: string }[] = []
  for (const link of [...links, ...guesses]) {
    if (link.child === id || metas[link.child] || childOf.has(link.child)) continue
    const isRunning = running.has(link.child)
    const file = guessedFile.get(link.child) ?? (await childFileOf($, home, link, isRunning))
    let size: number | undefined
    try {
      size = file ? (await $.fs.stat(file)).size : undefined
    } catch {
      // Not written yet.
    }
    const hit = file && size !== undefined ? await digestOf($, file, size) : undefined
    if (file && hit) {
      agentFiles.set(link.child, file)
      calls[link.child] = hit
      if (!isRunning) rowCache.delete(file)
    }
    // A request sent with no reply after it is counted, its usage unknown: in flight, or its process was killed waiting.
    const sent = hit?.unanswered
    const run = hit?.run ?? runOf(scan([]))
    agents[link.child] = sent ? { ...run, steps: run.steps + 1, unanswered: 1, model: run.model ?? sent.md } : run
    if (sent?.ts && !isRunning) cutOff.push({ child: link.child, ts: sent.ts, md: sent.md })
    const host = link.call && !main.uses.has(link.call) ? Object.entries(calls).find(([, c]) => c.uses.has(link.call ?? ''))?.[0] : undefined
    metas[link.child] = { agentType: 'claude -p', description: hit?.said ?? link.child, toolUseId: link.call, parentAgentId: host, model: run.model ?? sent?.md, finished: !isRunning }
    // One that ended waiting on a reply was cut off, or failed before its first request.
    childOf.set(link.child, { status: isRunning ? 'running' : run.steps > 0 && !sent ? 'completed' : 'interrupted', inferred: link.inferred })
  }
  const hookSrc = await hookSources($, home, await $.session.root())
  return sessionOf({ rows, main, agents, metas, calls, childOf, cutOff, cwd, home, hookSrc })
}
