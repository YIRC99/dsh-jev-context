/**
 * Surface segmentation: read the model-visible conversation as the ordered
 * list of human-turn segments a decision can act on.
 *
 * Segmentation reads the current surface only, so it stays correct after this
 * plugin's own rewrites. A pruning marker and a recall marker are themselves
 * segment starts, and every marker carries, in its `sourceEventSeqs`, the
 * original nodes it shadowed — that is what makes a segment's identity and
 * digest survive any number of prune/recall cycles.
 *
 * @module @yirc99/dsh-jev-context/segments
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { isMarkerSource, markerFormOf } from './source.ts'
import type { ContextSegment, SegmentDigest } from './types.ts'

/** Prefix a recalled transcript puts on a failed tool result. */
const TOOL_ERROR_LABEL = '工具报错'

/**
 * Whether one surface event is this plugin's pruning or recall marker.
 * @param event - the surface event to classify.
 * @returns whether the event is a marker this plugin appended.
 */
export function isMarkerEvent(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  return isMarkerSource(event.data.source)
}

/**
 * Whether one surface event opens a segment.
 *
 * A segment opens where the harness recorded a new unit of work, which is not
 * the same as `source.kind === 'user'`: a goal round arrives as `kind: 'goal'`,
 * so segmenting on `user` alone leaves the plugin inert in exactly the sessions
 * that need it most — a goal-driven run has one human prompt and hundreds of
 * rounds.
 *
 * What separates work from context is the `ContextFormed` form. Every injected
 * kind declares one — `instructions` (agent instructions, a skill invocation),
 * `catalog` (the skill catalog), `recall` (a session reference), `notice` (a
 * subagent settlement, a webhook delivery), `relay` (an agent message) — while
 * every work-initiating kind declares none: `user`, `goal`, `team-message`.
 * The plugin's own markers are excluded by identity as well, so neither
 * generation's source shape can be mistaken for work.
 * @param event - the surface event to classify.
 * @returns whether the event begins a segment.
 */
export function opensSegment(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  const source = event.data.source as { kind: string; form?: unknown }
  if (isMarkerSource(source)) return false
  // The injection kinds all declare a `ContextFormed` form; work-initiating
  // messages — `user`, `goal`, a relayless `agent-message` — declare none.
  return source.form === undefined
}

/**
 * Whether one marker stands in for pruned content rather than a recalled copy.
 * @param event - the surface event to classify.
 * @returns whether the event is an omission notice.
 */
export function isPruneMarker(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  return markerFormOf(event.data.source) === 'notice'
}

/** Collapse whitespace and bound one text value. */
function bound(text: string, chars: number): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  return collapsed.length <= chars ? collapsed : `${collapsed.slice(0, Math.max(0, chars - 1))}…`
}

/**
 * Text one event's derived message carries, tool results included.
 *
 * A tool result's model-facing content is a `tool-result` block wrapping the
 * command's own blocks, not a top-level text block, so reading only top-level
 * text would drop every tool result from a recalled transcript — which for a
 * coding session is most of what the segment held.
 */
function textOf(event: SessionEvent): string {
  const message = deriveEventMessage(event)
  if (message === null) return ''
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'tool-result') {
      const inner = block.content
        .filter(entry => entry.type === 'text')
        .map(entry => entry.text)
        .join('\n')
      if (inner.length > 0) parts.push(block.isError === true ? `[${TOOL_ERROR_LABEL}] ${inner}` : inner)
    }
  }
  return parts.join('\n')
}

/** Tool names one event's derived message invoked, in block order. */
function toolNamesOf(event: SessionEvent): readonly string[] {
  const message = deriveEventMessage(event)
  if (message === null) return []
  const names: string[] = []
  for (const block of message.content) {
    if (block.type === 'tool-call') names.push(block.name)
  }
  return names
}

/**
 * Render one segment's original events as a role-labelled transcript.
 *
 * The recalled copy is plain text because the surface admits only a
 * `user/message` as a multi-node replacement: `assistant/message` cannot cite
 * source events, so a faithful node-by-node restore is not expressible. The
 * transcript says whose words each part is rather than silently re-attributing
 * them.
 * @param events - the segment's original events, in surface order.
 * @returns the transcript, or an empty string when no event carried text.
 */
export function transcriptOf(events: readonly SessionEvent[]): string {
  const lines: string[] = []
  for (const event of events) {
    const text = textOf(event)
    if (text.trim().length === 0) continue
    const speaker = event.type === 'assistant/message' ? '助手' : event.type === 'tool/result' ? '工具' : '用户'
    lines.push(`【${speaker}】${text}`)
  }
  return lines.join('\n')
}

/**
 * Derive the compact facts one segment is scored on.
 * @param events - the segment's original events, in surface order.
 * @param chars - character bound applied to each of the two text fields.
 * @returns the digest sent to the decision service.
 */
export function digestOf(events: readonly SessionEvent[], chars: number): SegmentDigest {
  let request = ''
  const replies: string[] = []
  const tools: string[] = []
  for (const event of events) {
    if (request.length === 0 && opensSegment(event)) {
      request = textOf(event)
      continue
    }
    if (event.type === 'assistant/message') {
      const text = textOf(event)
      if (text.length > 0) replies.push(text)
      for (const name of toolNamesOf(event)) {
        if (!tools.includes(name)) tools.push(name)
      }
    }
  }
  return {
    request: bound(request, chars),
    reply: bound(replies.join(' '), chars),
    tools,
  }
}

/**
 * Derive the one-line label a ledger row shows.
 * @param digest - the segment's digest.
 * @param order - 1-based segment position, used as the fallback caption.
 * @returns a short topic caption in the segment's own words.
 */
export function labelOf(digest: SegmentDigest, order: number): string {
  return digest.request.length > 0 ? digest.request : `片段 ${String(order)}`
}

/**
 * Read one surface event.
 *
 * Surface seqs are validated contiguous log references, so every one resolves;
 * callers iterating the current surface or a segment's recorded source seqs
 * never have to handle a miss.
 * @param session - session whose log is read.
 * @param seq - a current surface seq, or one this plugin recorded as such.
 * @returns the logged event at that seq.
 */
export function surfaceEvent(session: Session, seq: SessionSeq): SessionEvent {
  // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
  const event = session.eventAt(seq)
  // oxlint-disable-next-line typescript/no-non-null-assertion -- a surface seq is always a valid log index.
  return event!
}

/**
 * The original nodes one marker shadows, recovered from its cited sources.
 * A cited seq always resolves, for the same reason the marker's own span does.
 */
function sourcesOfMarker(session: Session, event: SessionEvent): readonly SessionSeq[] {
  const cited = event.sourceEventSeqs
  /* v8 ignore next -- every marker this plugin appends cites the span it shadows. */
  if (cited === undefined || cited.length === 0) return [event.seq]
  const originals: SessionSeq[] = []
  for (const seq of cited) {
    // A recalled copy cites the marker it replaced alongside the originals;
    // only the human-turn ancestry identifies the segment.
    if (isMarkerEvent(surfaceEvent(session, seq))) continue
    originals.push(seq)
  }
  /* v8 ignore next -- a marker always cites at least one non-marker node. */
  if (originals.length === 0) return [event.seq]
  return originals
}

/**
 * Read the session's current segments, oldest first.
 *
 * The surface is walked once. A run that begins at a human turn is live; a run
 * that begins at a marker is that segment's current stand-in, and its original
 * nodes are recovered from the marker's cited sources.
 * @param session - session whose current surface is read.
 * @param digestChars - character bound applied to each digest text field.
 * @param estimate - heuristic token price of one derived message.
 * @returns every segment, in surface order.
 */
export function readSegments(
  session: Session,
  digestChars: number,
  estimate: (message: Message) => number,
): readonly ContextSegment[] {
  const nodes = session.surface.nodes
  const events = nodes.map(seq => surfaceEvent(session, seq))
  const starts: number[] = []
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] as SessionEvent
    if (opensSegment(event) || isMarkerEvent(event)) starts.push(index)
  }
  const segments: ContextSegment[] = []
  for (let position = 0; position < starts.length; position += 1) {
    const startIdx = starts[position] as number
    const endIdx = (starts[position + 1] ?? events.length) - 1
    const head = events[startIdx] as SessionEvent
    const spanSeqs = nodes.slice(startIdx, endIdx + 1)
    const marker = isMarkerEvent(head)
    const sourceSeqs = marker ? sourcesOfMarker(session, head) : spanSeqs
    const originals = sourceSeqs.map(seq => surfaceEvent(session, seq))
    let tokens = 0
    for (const event of originals) {
      const message = deriveEventMessage(event)
      if (message !== null) tokens += estimate(message)
    }
    const order = position + 1
    const digest = digestOf(originals, digestChars)
    // `sourceSeqs` is non-empty by construction: a live segment spans at least
    // its opening node, and a marker recovers at least the node it replaced.
    const anchor = sourceSeqs[0] as SessionSeq
    const tail = sourceSeqs[sourceSeqs.length - 1] as SessionSeq
    segments.push({
      id: String(anchor),
      order,
      label: labelOf(digest, order),
      anchor,
      tail,
      sourceSeqs,
      spanSeqs,
      tokens,
      pruned: marker && isPruneMarker(head),
      digest,
    })
  }
  return segments
}
