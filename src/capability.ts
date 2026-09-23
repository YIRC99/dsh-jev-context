/**
 * What the running harness supports.
 *
 * This plugin is installed into profiles whose harness was built somewhere
 * else, so nothing it needs can be assumed from the version it was compiled
 * against. The probe below asks the running build directly, once per process,
 * and the answer decides whether a feature is offered or withheld — never
 * whether the plugin fails.
 *
 * The marker *source shape* is deliberately not probed here: both format
 * generations accept the append and disagree only when the event is encoded,
 * so the shape follows `SESSION_FORMAT_VERSION` instead. See `./source.ts`.
 *
 * @module @yirc99/dsh-jev-context/capability
 */

import { Session, SessionId } from '@deepseek-ai/dsh-session'
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
) => { ignorable?: true }

/** Memoized answer of the one capability probe this process runs. */
let ledgerSupported: boolean | undefined

/**
 * Whether this harness writes the `ignorable` marker of a log-only append.
 * @returns true when an append carrying the marker stores a record that a
 *   reader without this plugin may skip; false when the marker is dropped.
 */
export function supportsIgnorableLedger(): boolean {
  if (ledgerSupported !== undefined) return ledgerSupported
  try {
    // Detached and never registered: the probe reports what this build's
    // `append` stores, not anything about a live session.
    const probe = Session.create(SessionId('jev-context/ignorable-probe'))
    const append = probe.append.bind(probe) as unknown as MarkedAppend
    ledgerSupported = append('context-jev/turn', probeRecord(1), { ignorable: true }).ignorable === true
  } catch {
    // A build whose `append` rejects the marker has answered the question.
    ledgerSupported = false
  }
  return ledgerSupported
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
