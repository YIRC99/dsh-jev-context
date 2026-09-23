/**
 * Surface rewriting: the two operations that move one segment between the
 * model-visible surface and its omission marker.
 *
 * Both operations ride the shared shadow-price protocol — a `compaction/prune`
 * event immediately followed by its replacement — so the context-pressure
 * projection subtracts the shadowed range's price exactly and the reported
 * savings are the same number the meter uses. Neither operation edits the log:
 * the original nodes stay readable, which is what lets a later turn recall
 * them.
 *
 * @module @yirc99/dsh-jev-context/prune
 */

import type { Message, UserMessage } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'
import { MARKER_PLUGIN, surfaceEvent } from './segments.ts'
import { pruneSummary, renderPruneMarker, renderRecallMarker } from './render.ts'
import type { ContextSegment } from './types.ts'

/** Heuristic token price of a list of surface seqs under the shared estimator. */
function priceOf(
  session: Session,
  seqs: readonly SessionSeq[],
  estimate: (message: Message) => number,
): number {
  let tokens = 0
  for (const seq of seqs) {
    const message = deriveEventMessage(surfaceEvent(session, seq))
    if (message !== null) tokens += estimate(message)
  }
  return tokens
}

/**
 * Append the shadow-price event and its replacement as the adjacent pair the
 * metering fold requires.
 * @param session - session whose log receives both events.
 * @param spanSeqs - the surface span being replaced, in order.
 * @param replacement - the message that takes the span's place.
 * @param cite - every source seq the replacement must cite.
 * @param estimate - heuristic token price of one derived message.
 */
function replaceSpan(
  session: Session,
  spanSeqs: readonly SessionSeq[],
  replacement: UserMessage,
  cite: readonly SessionSeq[],
  estimate: (message: Message) => number,
): void {
  const start = spanSeqs[0]
  const end = spanSeqs[spanSeqs.length - 1]
  /* v8 ignore next -- callers pass a non-empty span. */
  if (start === undefined || end === undefined) return
  session.append('compaction/prune', {
    shadowedRange: { start, end },
    shadowedSeqs: [...spanSeqs],
    shadowedTokenCount: priceOf(session, spanSeqs, estimate),
  })
  session.append('user/message', replacement, {
    surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
    sourceEventSeqs: [...cite],
  })
}

/** Every source seq a replacement must cite: the shadowed span first, then ancestry. */
function citations(spanSeqs: readonly SessionSeq[], sourceSeqs: readonly SessionSeq[]): SessionSeq[] {
  const cite: SessionSeq[] = []
  for (const seq of [...spanSeqs, ...sourceSeqs]) {
    if (!cite.includes(seq)) cite.push(seq)
  }
  return cite
}

/**
 * Replace one live segment with its omission notice.
 * @param session - session whose surface is rewritten.
 * @param segment - the live segment to omit.
 * @param estimate - heuristic token price of one derived message.
 * @throws when the session rejects the replacement.
 */
export function pruneSegment(
  session: Session,
  segment: ContextSegment,
  estimate: (message: Message) => number,
): void {
  const replacement = createUserMessage({
    content: [{ type: 'text', text: renderPruneMarker(segment) }],
    source: {
      kind: 'plugin',
      plugin: MARKER_PLUGIN,
      form: 'notice',
      summary: pruneSummary(segment),
    },
  })
  replaceSpan(session, segment.spanSeqs, replacement, citations(segment.spanSeqs, segment.sourceSeqs), estimate)
}

/**
 * Replace one omission notice with a recalled copy of the original content.
 * @param session - session whose surface is rewritten.
 * @param segment - the omitted segment to recall.
 * @param events - the segment's original events, in surface order.
 * @param estimate - heuristic token price of one derived message.
 * @throws when the session rejects the replacement.
 */
export function recallSegment(
  session: Session,
  segment: ContextSegment,
  events: readonly SessionEvent[],
  estimate: (message: Message) => number,
): void {
  const replacement = createUserMessage({
    content: [{ type: 'text', text: renderRecallMarker(segment, events) }],
    source: { kind: 'plugin', plugin: MARKER_PLUGIN, form: 'recall' },
  })
  replaceSpan(session, segment.spanSeqs, replacement, citations(segment.spanSeqs, segment.sourceSeqs), estimate)
}
