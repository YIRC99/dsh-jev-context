/**
 * The marker message's source, in the shape the running harness accepts.
 *
 * The harness changed how a plugin says "this message is mine" between the two
 * session-format generations this package runs on. Format 3 and earlier take a
 * shared `kind: 'plugin'` carrying the plugin's own name; format 4 rejects that
 * kind outright and requires each producer to own one — `kind: 'jev-context'` —
 * with the same `ContextFormed` form. Both generations validate a message
 * source against a closed set, so neither shape works on the other, and the
 * shape therefore follows the running build's format generation rather than
 * the one this package was compiled against.
 *
 * `SESSION_FORMAT_VERSION` is the discriminator. It is exported for readers
 * that have to write a log the running harness will accept, and reading it is
 * the only reliable test: an append succeeds under both generations, because
 * format 4 refuses the legacy source when the event is encoded rather than when
 * it enters the log.
 *
 * @module @yirc99/dsh-jev-context/source
 */

import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'

/** The producer-owned source kind this package owns on format 4 and later. */
export const MARKER_KIND = 'jev-context'

/** The shared plugin source kind formats 3 and earlier take. */
export const LEGACY_PLUGIN_KIND = 'plugin'

/**
 * The first format generation whose source kinds are producer-owned.
 *
 * Format 4 refuses `kind: 'plugin'`: a reader can no longer tell which plugin
 * produced a message, so each producer names itself in the kind.
 */
const PRODUCER_OWNED_FORMAT = 4

/** Which of this package's two markers a message is. */
export type MarkerForm = 'notice' | 'recall'

/** What every marker source carries besides its kind. */
export interface MarkerFields {
  /** Whether the marker stands in for pruned content or for a recalled copy. */
  readonly form: MarkerForm
  /** One-line description of what the marker covers, when it has one. */
  readonly summary?: string
}

/** The fields a marker source is read through, whichever generation wrote it. */
export interface MarkerSourceLike {
  readonly kind?: unknown
  readonly plugin?: unknown
  readonly form?: unknown
}

/**
 * Whether the running harness takes producer-owned source kinds.
 * @returns true on format 4 and later, false on the earlier shared-kind format.
 */
export function usesProducerOwnedSources(): boolean {
  return SESSION_FORMAT_VERSION >= PRODUCER_OWNED_FORMAT
}

/**
 * Build the marker source the running harness accepts.
 * @param fields - the marker's form and one-line summary.
 * @returns a source object in this harness's generation shape.
 */
export function markerSource(fields: MarkerFields): { kind: string; plugin?: string; form: MarkerForm; summary?: string } {
  return usesProducerOwnedSources()
    ? { kind: MARKER_KIND, ...fields }
    : { kind: LEGACY_PLUGIN_KIND, plugin: MARKER_KIND, ...fields }
}

/**
 * Whether one message source is a marker this package appended.
 * @param source - the message's source, as read from the log.
 * @returns whether this package produced the message.
 */
export function isMarkerSource(source: MarkerSourceLike): boolean {
  if (source.kind === MARKER_KIND) return true
  return source.kind === LEGACY_PLUGIN_KIND && source.plugin === MARKER_KIND
}

/**
 * The marker form one message source carries.
 * @param source - the message's source, as read from the log.
 * @returns the form, or undefined when this package did not produce the message.
 */
export function markerFormOf(source: MarkerSourceLike): MarkerForm | undefined {
  if (!isMarkerSource(source)) return undefined
  return source.form === 'notice' || source.form === 'recall' ? source.form : undefined
}
