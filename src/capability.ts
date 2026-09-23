/**
 * What the running harness supports.
 *
 * This plugin is installed into profiles whose harness was built somewhere
 * else, so nothing it needs can be assumed from the version it was compiled
 * against. Each probe below asks the running build directly, once per process,
 * and every answer decides whether a feature is offered or withheld — never
 * whether the plugin fails.
 *
 * @module @yirc99/dsh-jev-context/capability
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ContextJevTurnRecord } from './types.ts'

/** The plugin name both probes and the omission markers are stamped with. */
export const PROBE_PLUGIN = 'jev-context'

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

/** Memoized answers, one probe per question per process. */
const answers = new Map<string, boolean>()

/** Run one probe at most once. */
function once(key: string, probe: () => boolean): boolean {
  const known = answers.get(key)
  if (known !== undefined) return known
  let answer: boolean
  try {
    answer = probe()
  } catch {
    // A build that rejects the probe has answered it.
    answer = false
  }
  answers.set(key, answer)
  return answer
}

/**
 * Whether this harness writes the `ignorable` marker of a log-only append.
 * @returns true when an append carrying the marker stores a record that a
 *   reader without this plugin may skip; false when the marker is dropped.
 */
export function supportsIgnorableLedger(): boolean {
  return once('ignorable-ledger', () => {
    // Detached and never registered: the probe reports what this build's
    // `append` stores, not anything about a live session.
    const probe = Session.create(SessionId('jev-context/ignorable-probe'))
    const append = probe.append.bind(probe) as unknown as MarkedAppend
    return append('context-jev/turn', probeRecord(1), { ignorable: true }).ignorable === true
  })
}

/**
 * Whether this harness accepts a plugin-owned `user/message` source.
 *
 * The whole mechanism rests on it: an omission notice and a recall are both a
 * `user/message` replacement marked with this plugin's own source, which is
 * what keeps them out of segmentation's "a unit of work began here" predicate
 * and distinguishable from each other. A build without that source rejects the
 * replacement, so nothing this plugin does would reach the surface.
 * @returns true when a plugin-sourced user message survives an append.
 */
export function supportsPluginMessages(): boolean {
  return once('plugin-message-source', () => {
    const probe = Session.create(SessionId('jev-context/source-probe'))
    const message = createUserMessage({
      content: [{ type: 'text', text: 'probe' }],
      source: { kind: 'plugin', plugin: PROBE_PLUGIN, form: 'notice', summary: 'probe' },
    })
    probe.append('user/message', message, { surfaceOp: 'append' })
    return true
  })
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
