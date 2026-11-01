import type { Reading } from '../types'

// What the read cycle and the pane share of what they keep: the main agent's turn as the hooks hear it, and the readings
// of /cost kept in the store. The atoms themselves are declared in each module that uses them.

// Where the main agent's turn stands: whether one runs, whether a turn event has come since the pane was first drawn (until
// one does, the record says whether main is busy), when it began (a newest turn in the record that started well before is the
// last one, already over), what the person typed to start it (empty for a turn nobody typed: a continuation, a notification
// waking main), and its id. In an atom so that a reload of this code, which keeps the pane, keeps this too; `turnLive` mirrors it
// for the code that cannot wait on a read.
export type Turn = { isBusy: boolean; hasHeardTurn: boolean; busySince: number; busyText: string; busyTurn?: string }

// What /cost had counted, kept across processes: a process that dies, or a /login that starts another count, leaves the
// record nothing of it. The latest reading of each count by each process; an older one that names no process is dropped.
export const ledgerKey = (id: string) => `ledger:${id}`
type Measured = Reading & { proc: number }
export const measuredOf = (v: unknown): Measured[] =>
  Array.isArray(v) ? v.filter((x): x is Measured => ['start', 'proc', 'at', 'usd'].every(f => typeof x?.[f] === 'number')) : []
