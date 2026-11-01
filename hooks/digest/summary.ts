// The summary is numbered sections ("1. Primary Request and Intent:"), after a preamble and before the engine's
// closing instructions to the model; each is a fold of its own.
export const summaryParts = (text: string) => {
  const parts: { title: string; lines: string[]; isAside?: boolean }[] = [{ title: 'Preamble', lines: [], isAside: true }]
  for (const line of text.split('\n')) {
    const heading = /^(\d+\. .+?):\s*$/.exec(line)
    if (heading) parts.push({ title: heading[1] ?? line, lines: [] })
    else if (parts.length > 1 && /^(If you need specific details|Continue the conversation)/.test(line) && !parts[parts.length - 1]?.isAside)
      parts.push({ title: 'Closing (instructions to the model)', lines: [line], isAside: true })
    else parts[parts.length - 1]?.lines.push(line)
  }
  return parts.filter(x => !x.isAside || x.lines.some(l => l.trim() !== ''))
}
