import type { EngineInterface } from 'claude-code'

/**
 * A `claude -p` session that a Bash call of this session started, directly or through anything it ran: `pid` its process,
 * `child` its session id, `cwd` where it started (which names the folder of its record), `at` when it was seen (epoch ms),
 * `call` the Bash call's tool_use_id when it is known. Its record names neither its process nor its parent, so this is the
 * only link between the two, kept in a file because the state of a mod does not outlive its process.
 */
export type ChildLink = { pid: number; child: string; cwd: string; at: number; call?: string; inferred?: true }

/** A stretch of time (epoch ms) in which a process of this session watched for children. */
export type Watched = { from: number; to: number }

/** This session's file: one line per child, and one per process that watched, for what it covered. */
export type Children = { links: ChildLink[]; watched: Watched[] }

export const childrenDirOf = (home: string) => `${home}/.claude/session-lens/children`
const fileOf = (home: string, id: string) => `${childrenDirOf(home)}/${id}.jsonl`

export async function sessionsDirOf($: EngineInterface, home: string): Promise<string> {
  return `${(await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`}/sessions`
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function parseChildren(text: string): Children {
  const out: Children = { links: [], watched: [] }
  for (const line of text.split('\n')) {
    let v: Record<string, unknown>
    try {
      v = JSON.parse(line)
    } catch {
      continue
    }
    if (!v || typeof v !== 'object') continue
    if (typeof v.child === 'string' && isNum(v.pid) && isNum(v.at)) {
      out.links.push({ pid: v.pid, child: v.child, cwd: typeof v.cwd === 'string' ? v.cwd : '', at: v.at, ...(typeof v.call === 'string' ? { call: v.call } : {}) })
    } else if (Array.isArray(v.watched) && isNum(v.watched[0]) && isNum(v.watched[1])) {
      out.watched.push({ from: v.watched[0], to: v.watched[1] })
    }
  }
  return out
}

export async function readChildren($: EngineInterface, home: string, id: string): Promise<Children> {
  try {
    return parseChildren(await $.fs.read(fileOf(home, id)))
  } catch {
    return { links: [], watched: [] }
  }
}

// ── Watching for children, in this process ──

// One process of a session tree, from `ps`.
type Proc = { ppid: number; command: string }

export function treeOf(ps: string): Map<number, Proc> {
  const tree = new Map<number, Proc>()
  for (const line of ps.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(line)
    if (m) tree.set(Number(m[1]), { ppid: Number(m[2]), command: m[3] ?? '' })
  }
  return tree
}

/**
 * The shell a Bash call of `root` ran, when `pid` descends from `root` through it: the process just below `root` on the
 * way up. Undefined when `pid` does not descend from `root`, or `root` started it itself (no Bash call did).
 */
export function shellOf(tree: Map<number, Proc>, root: number, pid: number): Proc | undefined {
  let at = pid
  // Bounded, as `ps` is read in one go and a pid reused in it could close a loop.
  for (let n = 0; n < 64; n++) {
    const p = tree.get(at)
    if (!p) return undefined
    if (p.ppid === root) return at === pid ? undefined : p
    at = p.ppid
  }
  return undefined
}

const flat = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Which Bash call a shell runs. The harness runs each as `zsh -c … eval '<command>' …`, a quote in the command written
 * `'"'"'`, so the command is the start of what follows `eval '`; `ps` may cut a long line, so either may be the start of
 * the other. A command of an open call wins; failing any match, the one call still open, when there is one.
 */
export function callOf(shell: Proc, calls: Map<string, { command: string; isOpen: boolean }>): string | undefined {
  const evald = /\beval '([\s\S]*)$/.exec(shell.command)?.[1]
  const said = evald === undefined ? '' : flat(evald.replaceAll(`'"'"'`, `'`))
  const isSame = (command: string) => {
    const a = flat(command).slice(0, 100)
    return a.length > 0 && said.length > 0 && (said.startsWith(a) || (said.length >= 12 && a.startsWith(said)))
  }
  const all = [...calls]
  const open = all.filter(([, c]) => c.isOpen)
  for (const pool of [open, all]) {
    const hits = pool.filter(([, c]) => isSame(c.command))
    if (hits.length === 1) return hits[0]?.[0]
  }
  return open.length === 1 ? open[0]?.[0] : undefined
}

// Reports each pid file in the folder, those already there first, then each new one as it lands: kqueue wakes it when the
// folder changes, so it costs nothing while idle. A file read while still being written is read once more.
const WATCHER = `
import json, os, select, sys, time
folder = sys.argv[1]
def body(name):
    for n in range(2):
        try:
            with open(os.path.join(folder, name)) as f:
                return json.load(f)
        except FileNotFoundError:
            return None
        except Exception:
            time.sleep(0.05)
    return None
def emit(names):
    for name in sorted(names):
        if name.endswith(".json"):
            b = body(name)
            if isinstance(b, dict):
                print(json.dumps(b), flush=True)
fd = os.open(folder, os.O_RDONLY)
kq = select.kqueue()
kq.control([select.kevent(fd, filter=select.KQ_FILTER_VNODE, flags=select.KQ_EV_ADD | select.KQ_EV_CLEAR, fflags=select.KQ_NOTE_WRITE)], 0, 0)
seen = set(os.listdir(folder))
emit(seen)
while True:
    kq.control(None, 1, None)
    now = set(os.listdir(folder))
    emit(now - seen)
    seen = now
`

type PidFile = { pid: number; child: string; cwd: string }

const pidFileOf = (v: unknown): PidFile | undefined => {
  const o = v as Record<string, unknown> | null
  return o && isNum(o.pid) && typeof o.sessionId === 'string' ? { pid: o.pid, child: o.sessionId, cwd: typeof o.cwd === 'string' ? o.cwd : '' } : undefined
}

// What this process knows. A reload of the code starts it again, and the watcher of the code before dies with that code.
const watcher = {
  watching: undefined as Promise<void> | undefined,
  claudePid: 0,
  home: '',
  sessionId: '',
  sessions: '',
  mine: { links: [], watched: [] } as Children,
  span: undefined as Watched | undefined,
  onLink: (() => undefined) as () => void,
  isPolling: false,
  poller: undefined as { cancel: () => void } | undefined,
  polled: new Set<string>(),
  writing: Promise.resolve(),
}
// Every Bash call this process has seen, by tool_use_id, the latest few hundred: a command run in the background starts its
// children after its call has come back.
const bashCalls = new Map<string, { command: string; isOpen: boolean }>()
const BASH_KEPT = 200
// Each pid file already weighed, by pid and session: a file written again is not weighed again.
const weighed = new Set<string>()

function save($: EngineInterface) {
  const lines = [...watcher.mine.links.map(l => JSON.stringify(l)), ...watcher.mine.watched.map(w => JSON.stringify({ watched: [w.from, w.to] }))]
  const file = fileOf(watcher.home, watcher.sessionId)
  watcher.writing = watcher.writing.then(() => $.fs.write(file, `${lines.join('\n')}\n`)).catch(() => undefined)
  return watcher.writing
}

/**
 * Watches `~/.claude/sessions` for pid files, which every Claude process writes while it runs, `claude -p` too. Started by
 * the first Bash call, as no child comes before one; the files already there are weighed first, so one that call started
 * before the watch began is still found. Without python3's kqueue (not macOS), the folder is listed while a call runs.
 */
async function watch($: EngineInterface) {
  const me = await $.process.run(['sh', '-c', 'echo $PPID']).catch(() => undefined)
  const pid = Number(me?.stdout.trim())
  // Without its own pid nothing can be told to descend from it: no child is linked, rather than every claude on the machine.
  if (!me || me.exitCode !== 0 || !Number.isInteger(pid) || pid <= 1) return
  const h = await $.env.get('HOME')
  if (!h) return
  watcher.claudePid = pid
  watcher.home = h
  watcher.sessionId = await $.session.id()
  watcher.sessions = await sessionsDirOf($, watcher.home)
  watcher.mine = await readChildren($, watcher.home, watcher.sessionId)
  for (const l of watcher.mine.links) weighed.add(`${l.pid}:${l.child}`)
  watcher.span = { from: Date.now(), to: Date.now() }
  watcher.mine.watched.push(watcher.span)
  await save($)
  try {
    let rest = ''
    for await (const { stream, text } of $.process.spawn({ argv: ['/usr/bin/python3', '-c', WATCHER, watcher.sessions] })) {
      if (stream !== 'stdout') continue
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      const found = lines.flatMap(line => {
        try {
          return pidFileOf(JSON.parse(line)) ?? []
        } catch {
          return []
        }
      })
      if (found.length > 0) await weigh($, found)
    }
  } catch {
    // No python3, or no kqueue in it: the folder is listed instead.
  }
  watcher.isPolling = true
  pollWhileOpen($)
}

// Links each pid file of a process that descends from this one through a Bash call's shell, with one `ps` for them all.
async function weigh($: EngineInterface, found: PidFile[]) {
  const fresh = found.filter(f => f.pid !== watcher.claudePid && !weighed.has(`${f.pid}:${f.child}`))
  if (fresh.length === 0) return
  const ps = await $.process.run(['ps', '-axww', '-o', 'pid=,ppid=,command=']).catch(() => undefined)
  if (!ps || ps.exitCode !== 0) return
  const tree = treeOf(ps.stdout)
  let isNew = false
  for (const f of fresh) {
    weighed.add(`${f.pid}:${f.child}`)
    const shell = shellOf(tree, watcher.claudePid, f.pid)
    if (!shell) continue
    const call = callOf(shell, bashCalls)
    watcher.mine.links.push({ pid: f.pid, child: f.child, cwd: f.cwd, at: Date.now(), ...(call ? { call } : {}) })
    isNew = true
  }
  if (!isNew) return
  await save($)
  watcher.onLink()
}

async function poll($: EngineInterface) {
  let names: string[]
  try {
    names = (await $.fs.list(watcher.sessions)).map(f => f.name).filter(n => n.endsWith('.json'))
  } catch {
    return
  }
  const fresh = names.filter(n => !watcher.polled.has(n))
  watcher.polled = new Set(names)
  const found: PidFile[] = []
  for (const name of fresh) {
    try {
      const f = pidFileOf(JSON.parse(await $.fs.read(`${watcher.sessions}/${name}`)))
      if (f) found.push(f)
    } catch {
      // Gone already, or half written: a child that lives on is in the next listing.
    }
  }
  await weigh($, found)
}

function pollWhileOpen($: EngineInterface) {
  if (watcher.isPolling && !watcher.poller && [...bashCalls.values()].some(c => c.isOpen)) watcher.poller = $.clock.every(200, () => void poll($))
}

/** A Bash call starts: `linked` is called each time a child of this session is found. */
export function bashStarted($: EngineInterface, id: string, command: string, linked: () => void) {
  watcher.onLink = linked
  bashCalls.delete(id)
  bashCalls.set(id, { command, isOpen: true })
  for (const old of [...bashCalls.keys()].slice(0, Math.max(0, bashCalls.size - BASH_KEPT))) bashCalls.delete(old)
  watcher.watching ??= watch($).catch(() => undefined)
  pollWhileOpen($)
}

export async function bashEnded($: EngineInterface, id: string) {
  const c = bashCalls.get(id)
  if (c) c.isOpen = false
  if (watcher.poller && ![...bashCalls.values()].some(x => x.isOpen)) {
    watcher.poller.cancel()
    watcher.poller = undefined
    // A child started just before the call came back is in this last listing.
    await poll($)
  }
  // What this process watched now runs to here: a call inside it needs no guessing later.
  if (watcher.span) {
    watcher.span.to = Date.now()
    await save($)
  }
}

// ── Guessing at children no watch saw ──

/** A Bash call's stretch of time (epoch ms), from the call to its result: `call` its tool_use_id. */
export type BashWindow = { call: string; from: number; to: number }

/** A `claude -p` record that began inside a Bash call: `file` the record, `at` its first row's time (epoch ms). */
export type Guess = { child: string; file: string; at: number; call: string }

// Each top-level record changed in the last `$2` minutes whose first rows say `claude -p` (the SDK's own entrypoint)
// started it, with its first row's time: one awk for them all, which reads no more than eight lines of each.
const HEADS = `find "$1" -mindepth 2 -maxdepth 2 -name '*.jsonl' -type f -mmin "-$2" -exec awk '
FNR == 1 { ts = match($0, /"timestamp":"[^"]*"/) ? substr($0, RSTART + 13, RLENGTH - 14) : "" }
FNR <= 8 && index($0, "\\"entrypoint\\":\\"sdk-cli\\"") { print FILENAME "\\t" ts; nextfile }
FNR >= 8 { nextfile }
' {} +`

// What each closed call's window held, by call: a record that began inside it was there when its result came back.
const guessed = new Map<string, Guess[]>()
// Each children file read, by name, with the size it was read at: every session's links rule a guess out.
const linkedIn = new Map<string, { size: number; ids: string[] }>()

async function linkedAnywhere($: EngineInterface, home: string): Promise<Set<string>> {
  const dir = childrenDirOf(home)
  let files: { name: string; size: number }[]
  try {
    files = await $.fs.list(dir)
  } catch {
    return new Set()
  }
  for (const f of files) {
    if (linkedIn.get(f.name)?.size === f.size) continue
    try {
      linkedIn.set(f.name, { size: f.size, ids: parseChildren(await $.fs.read(`${dir}/${f.name}`)).links.map(l => l.child) })
    } catch {
      // Gone, or unreadable: it links nothing.
    }
  }
  return new Set([...linkedIn.values()].flatMap(v => v.ids))
}

/**
 * The `claude -p` sessions that began inside a closed Bash call of this session, for calls no watch covered: a process
 * that ran before this one, or a watch that could not start. Only a guess, as another session's child could begin in
 * the same stretch; a session some watch linked is left out. Each window is looked through once, kept in memory only.
 */
export async function guessChildren($: EngineInterface, home: string, windows: BashWindow[], self: string): Promise<Guess[]> {
  const fresh = windows.filter(w => !guessed.has(w.call))
  if (fresh.length > 0) {
    const from = Math.min(...fresh.map(w => w.from))
    // A record is written to after it begins: one changed before the first window opened began before it too.
    const minutes = Math.ceil((Date.now() - from) / 60_000) + 1
    const base = `${(await $.env.get('CLAUDE_CONFIG_DIR')) || `${home}/.claude`}/projects`
    const out = await $.process.run(['sh', '-c', HEADS, 'sh', base, String(minutes)]).catch(() => undefined)
    // Not run at all: the windows are not marked looked through, and the next reading tries again. A non-zero exit is
    // kept, as a record removed while `find` ran fails it, and the scan is too slow to run on every reading.
    if (!out) return []
    for (const w of fresh) guessed.set(w.call, [])
    for (const line of out.stdout.split('\n')) {
      const [file, ts] = line.split('\t')
      const at = Date.parse(ts ?? '')
      const child = /([^/]+)\.jsonl$/.exec(file ?? '')?.[1]
      if (!file || !child || child === self || Number.isNaN(at)) continue
      // Of calls that ran at once, the one that began last holds it most closely.
      const w = fresh.filter(x => at >= x.from && at <= x.to).sort((a, b) => b.from - a.from)[0]
      if (w) guessed.get(w.call)?.push({ child, file, at, call: w.call })
    }
  }
  const all = windows.flatMap(w => guessed.get(w.call) ?? [])
  if (all.length === 0) return []
  const linked = await linkedAnywhere($, home)
  return all.filter(g => !linked.has(g.child))
}
