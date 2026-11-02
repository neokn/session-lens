// Text from outside the mod, as it comes in: what the engine refuses in a drawing taken out, and how far a link in a file
// may lead. Pure.

// A colour or a cursor move (CSI), then a title or a hyperlink (OSC), each with what it carries, by either introducer. The
// record's slices may cut one short; a title never ended stops at its line, so it cannot swallow the lines after it.
const SEQUENCE = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]?|(?:\x1b\]|\x9d)[^\x07\x1b\x9c\n]*(?:\x07|\x1b\\|\x9c)?/g
// Every other control character of C0 and C1, and DEL: all but the tab and the newline. One of these in any text makes the
// engine refuse the whole drawing, so the pane shows nothing at all.
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

export const clean = (s: string) => s.replace(SEQUENCE, '').replace(CONTROL, '')

// Every string in what was read, the keys of its objects too (a model's name is one).
export const cleaned = <T>(v: T): T => {
  if (typeof v === 'string') return clean(v) as T
  if (Array.isArray(v)) return v.map(x => cleaned(x)) as T
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([key, x]) => [clean(key), cleaned(x)])) as T
  return v
}

// A line of the record or a file of JSON, parsed: how anything read from outside that is drawn comes in.
export const parsed = <T>(text: string): T => cleaned(JSON.parse(text)) as T

// A path with its `.` and `..` worked out on the text alone; a `..` at the top stays there, as it does on a disk.
const normal = (path: string) => {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '..') out.pop()
    else if (part !== '' && part !== '.') out.push(part)
  }
  return `/${out.join('/')}`
}
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

/**
 * The file a memory file's link leads to, normalised; undefined for a link off the disk or out of the folder of `top`, the
 * file /context listed that the reading started from. Every file reached from it stays in that folder, so the folder of the
 * file holding the link is inside it, and a `..` that lands back under it still opens. A `\` is a separator on some disks,
 * so a link holding one is not followed. Only the text is weighed: a symbolic link in the folder is followed as any file is.
 */
export function linkedFile(href: string, from: string, top: string): string | undefined {
  if (/^[a-z]+:/i.test(href) || href.includes('\\')) return undefined
  const target = normal(href.startsWith('/') ? href : `${dirOf(from)}${href}`)
  return target.startsWith(`${normal(dirOf(top))}/`) ? target : undefined
}
