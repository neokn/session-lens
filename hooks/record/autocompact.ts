import type { EngineInterface } from 'claude-code'
import { tuningStage, type Tuning, type TuningStage } from '../digest/autocompact'
import { clean, parsed } from '../digest/text'

// The scripts need no model and may read many logs for the first time: they get ten minutes, the most a run elsewhere does.
const WAIT = 600_000
type OnStage = (stage: TuningStage) => void

// What the script reports of itself goes to onStage, and the rest of its stderr is what went wrong.
async function script($: EngineInterface, name: string, args: string[], onStage: OnStage, env: Record<string, string> = {}) {
  const run = $.process.spawn({ argv: ['bash', `${$.plugin.root}/autocompact-tuning/scripts/${name}`, ...args], env: { AUTOCOMPACT_PROGRESS: '1', ...env } })
  const timer = $.clock.after(WAIT, () => void run.return(undefined as never))
  let stdout = ''
  let stderr = ''
  let rest = ''
  try {
    for await (const { stream, text } of run) {
      if (stream === 'stdout') {
        stdout += text
        continue
      }
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) {
        const stage = tuningStage(line)
        if (stage) onStage(stage)
        else stderr += `${line}\n`
      }
    }
    return { exitCode: (await run.result).code, stdout, stderr: stderr + rest }
  } finally {
    timer.cancel()
  }
}

const failed = (stderr: string, exitCode: number | null) => clean(stderr).trim() || `stopped with code ${exitCode}`

export async function readTuning($: EngineInterface, isFresh: boolean, onStage: OnStage): Promise<Tuning> {
  const { exitCode, stdout, stderr } = await script($, 'recommend.sh', ['--settings'], onStage, isFresh ? { AUTOCOMPACT_FRESH: '1' } : {})
  if (exitCode !== 0) throw new Error(failed(stderr, exitCode))
  return parsed<Tuning>(stdout)
}

export async function writeTuning($: EngineInterface, args: string[], onStage: OnStage) {
  const { exitCode, stdout, stderr } = await script($, 'apply.sh', args, onStage)
  return exitCode === 0 ? clean(stdout).trim() : `Nothing was written: ${failed(stderr, exitCode)}`
}
