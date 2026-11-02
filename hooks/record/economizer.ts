import type { EngineInterface } from 'claude-code'

import type { Economizer } from '../../types'
import { economizerOf } from '../digest/economizer'

// Asks TokenEconomizer's own command what it did here, and only asks: neither command changes anything. Null when it is not
// installed or does not answer as expected, which the pane takes as nothing to show.
export async function readEconomizer($: EngineInterface): Promise<Economizer | null> {
  try {
    const root = (await $.env.get('TOKENECONOMIZER_HOME')) || `${await $.env.get('HOME')}/.tokeneconomizer`
    const te = [`${root}/bin/te`, '--cwd', await $.session.cwd(), '--host', 'claude']
    const [status, prune] = await Promise.all([$.process.run([...te, 'status', '--json'], { timeoutMs: 15_000 }), $.process.run([...te, 'toolprune', 'show'], { timeoutMs: 15_000 })])
    if ([status, prune].some(r => r.exitCode !== 0 || r.isStdoutTruncated)) return null
    return economizerOf(status.stdout, prune.stdout)
  } catch {
    return null
  }
}
