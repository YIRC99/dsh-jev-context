/**
 * The one place the per-turn ledger enters a harness's session log.
 *
 * `context-jev/turn` is declared by this package, so a harness that does not
 * install the plugin has the type outside its generated known-type vocabulary
 * and refuses a stored log containing it — unless the record carries
 * `ignorable: true`. `Session.append` writes that marker from a log-only
 * intent, but only a harness carrying the corresponding change accepts the
 * third argument at all: an older one ignores it and stores the record as
 * required, which would make the user's own sessions unreadable on reload.
 *
 * The marker is therefore never assumed. {@link supportsIgnorableLedger}
 * appends one throwaway event to a detached session and reads the envelope
 * back, and {@link appendLedger} drops the ledger rather than write a record
 * its reader would refuse.
 *
 * @module @yirc99/dsh-jev-context/ledger
 */

import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ContextJevTurnRecord } from './types.ts'

/**
 * The append signature that carries a log-only reader-compatibility marker.
 *
 * Spelled structurally rather than imported: this package compiles against the
 * harness versions that predate the marker, where the third argument is
 * rejected by the compiler, and must keep running on them.
 */
type MarkedAppend = (
  type: 'context-jev/turn',
  data: ContextJevTurnRecord,
  intent: { ignorable: true },
) => SessionEvent<'context-jev/turn'>

/** Memoized answer of the one capability probe this process runs. */
let supported: boolean | undefined

/**
 * Whether this harness writes the `ignorable` marker of a log-only append.
 * @returns true when an append with the marker stores a record a reader
 *   without this plugin may skip; false when the marker would be dropped.
 */
export function supportsIgnorableLedger(): boolean {
  if (supported !== undefined) return supported
  try {
    // Detached and never registered: the probe reports what this build's
    // `append` stores, not anything about a live session.
    const probe = Session.create(SessionId('jev-context/capability-probe'))
    const append = probe.append.bind(probe) as unknown as MarkedAppend
    supported = append('context-jev/turn', probeRecord(1), { ignorable: true }).ignorable === true
  } catch {
    // A build whose `append` rejects the marker refuses this probe; treat the
    // refusal as the answer rather than letting it fail the plugin.
    supported = false
  }
  return supported
}

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

/** A minimal well-formed record, used only to observe what `append` stores. */
function probeRecord(turn: number): ContextJevTurnRecord {
  return {
    turn,
    step: 1,
    request: '',
    segments: [],
    tokensBefore: 0,
    tokensAfter: 0,
    tokensSaved: 0,
    jev: null,
    skipped: 'capability-probe',
  }
}
