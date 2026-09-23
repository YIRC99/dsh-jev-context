/**
 * The one place the per-turn ledger enters a harness's session log.
 *
 * `context-jev/turn` is declared by this package, so a harness that does not
 * install the plugin has the type outside its generated known-type vocabulary
 * and refuses a stored log containing it — unless the record carries
 * `ignorable: true`. Whether this build writes that marker is
 * {@link supportsIgnorableLedger}'s question; this module only decides what to
 * do with the answer, which is to drop the ledger rather than store a record
 * the user's own harness would later refuse to load.
 *
 * @module @yirc99/dsh-jev-context/ledger
 */

import type { Session } from '@deepseek-ai/dsh-session'
import { supportsIgnorableLedger } from './capability.ts'
import type { ContextJevTurnRecord } from './types.ts'

/**
 * The append signature that carries a log-only reader-compatibility marker.
 *
 * Spelled structurally rather than imported: this package also runs on harness
 * versions that predate the marker, where the compiler rejects the third
 * argument, so the call cannot be typed against them.
 */
type MarkedAppend = (
  type: 'context-jev/turn',
  data: ContextJevTurnRecord,
  intent: { ignorable: true },
) => { data: ContextJevTurnRecord }

/**
 * Append one turn's ledger record when the harness can mark it skippable.
 * @param session - the live session the record belongs to.
 * @param record - the completed record for this turn.
 * @returns the logged record, or `record` unchanged when this harness cannot
 *   store it safely and the ledger is dropped.
 */
export function appendLedger(session: Session, record: ContextJevTurnRecord): ContextJevTurnRecord {
  if (!supportsIgnorableLedger()) return record
  const append = session.append.bind(session) as unknown as MarkedAppend
  return append('context-jev/turn', record, { ignorable: true }).data
}
