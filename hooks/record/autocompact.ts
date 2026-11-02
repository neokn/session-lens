import type { EngineInterface } from 'claude-code'
import type { Tuning } from '../digest/autocompact'
import { clean, parsed } from '../digest/text'

// The scripts need no model and read every session of 30 days: the engine's longest wait.
const WAIT = 600_000
function script($: EngineInterface, name: string, args: string[]) {
  return $.process.run(['bash', `${$.plugin.root}/autocompact-tuning/scripts/${name}`, ...args], { timeoutMs: WAIT })
}

const failed = (stderr: string, exitCode: number) => clean(stderr).trim() || `stopped with code ${exitCode}`

// Writes the data and opens the page; what went wrong, or nothing.
export async function openTuningReport($: EngineInterface) {
  const { exitCode, stderr } = await script($, 'report.sh', ['--no-summary'])
  return exitCode === 0 ? null : failed(stderr, exitCode)
}

export async function readTuning($: EngineInterface): Promise<Tuning> {
  const { exitCode, stdout, stderr } = await script($, 'recommend.sh', ['--settings'])
  if (exitCode !== 0) throw new Error(failed(stderr, exitCode))
  return parsed<Tuning>(stdout)
}

export async function writeTuning($: EngineInterface, args: string[]) {
  const { exitCode, stdout, stderr } = await script($, 'apply.sh', args)
  return exitCode === 0 ? clean(stdout).trim() : `Nothing was written: ${failed(stderr, exitCode)}`
}
