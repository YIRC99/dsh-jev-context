/**
 * The per-turn selection engine: read the segments, ask the decision service
 * which matter, and move each one between the surface and its marker.
 *
 * Every failure is contained. A decision that cannot be made leaves the
 * surface exactly as it was, records why, and lets the turn proceed — a
 * context optimization must never cost a turn.
 *
 * The one await — the decision call — happens before any append, and every
 * append then runs in one uninterrupted synchronous block. That is what the
 * shared shadow-price protocol requires: a metering event and its replacement
 * are appended with no yield between them, so no observer can see an armed
 * claim that prices nothing.
 *
 * @module @yirc99/dsh-jev-context/engine
 */

import type { Message } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'
import { evaluateRelevance, JevError } from './jev.ts'
import { appendLedger } from './ledger.ts'
import { pruneSegment, recallSegment } from './prune.ts'
import { readSegments, surfaceEvent } from './segments.ts'
import type {
  ContextJevTurnRecord,
  ContextSegment,
  JevCallFacts,
  SegmentAction,
  SegmentOutcome,
} from './types.ts'

/** Everything one turn's decision reads. */
export interface SelectionInput {
  /** Session whose surface is rewritten. */
  readonly session: Session
  /** Turn the decision is made for. */
  readonly turn: number
  /** Step the decision is made for; only a turn's first step is selected. */
  readonly step: number
  /** The request text the segments are scored against. */
  readonly request: string
  /** Turn cancellation; an aborted turn is left alone. */
  readonly signal: AbortSignal
  /** Resolved composition and user configuration. */
  readonly config: ResolvedConfig
  /** Resolve the API key for this call, preferring a stored value over the environment. */
  readonly resolveApiKey: () => Promise<string>
  /** Heuristic token price of one derived message. */
  readonly estimate: (message: Message) => number
}

/** Heuristic token total of every node currently on the model-visible surface. */
function surfaceTokens(session: Session, estimate: (message: Message) => number): number {
  let tokens = 0
  for (const seq of session.surface.nodes) {
    const message = deriveEventMessage(surfaceEvent(session, seq))
    if (message !== null) tokens += estimate(message)
  }
  return tokens
}

/** The original events of one segment, in surface order. */
function originalsOf(session: Session, segment: ContextSegment): SessionEvent[] {
  return segment.sourceSeqs.map(seq => surfaceEvent(session, seq))
}

/** What one segment's decision resolved to. */
interface Outcome {
  readonly action: SegmentAction
  readonly relevance: number | null
}

/**
 * Resolve every segment's outcome from the decision service's probabilities.
 *
 * A live segment is omitted only when it is both judged irrelevant and large
 * enough that its marker is cheaper than its content. An omitted segment is
 * recalled on relevance alone: it was already judged worth omitting once, so
 * size is not a reason to keep it hidden.
 * @param segments - every segment, in surface order.
 * @param asked - the ids the decision service was asked about.
 * @param relevance - its probability per asked id.
 * @param config - resolved policy, supplying the threshold and the size floor.
 * @returns one outcome per segment, in surface order.
 */
export function resolveOutcomes(
  segments: readonly ContextSegment[],
  asked: ReadonlySet<string>,
  relevance: ReadonlyMap<string, number>,
  config: ResolvedConfig,
): readonly Outcome[] {
  return segments.map((segment) => {
    if (!asked.has(segment.id)) return { action: 'kept', relevance: null }
    const score = relevance.get(segment.id) ?? 0
    if (segment.pruned) {
      return { action: score >= config.threshold ? 'restored' : 'kept', relevance: score }
    }
    const omit = score < config.threshold && segment.tokens >= config.minSegmentTokens
    return { action: omit ? 'pruned' : 'kept', relevance: score }
  })
}

/**
 * Score the session's earlier segments against one request, bring each one to
 * the state its score calls for, and append the turn's ledger.
 *
 * The caller establishes that selection is enabled and that this is a
 * turn-opening step; this function performs every remaining check, contains
 * every failure, and appends exactly one ledger event per call.
 * @param input - the session, the request, and the resolved policy.
 * @returns the ledger event's data as it was appended.
 */
export async function selectContext(input: SelectionInput): Promise<ContextJevTurnRecord> {
  const { session, config, estimate } = input
  const segments = readSegments(session, config.digestChars, estimate)
  const tokensBefore = surfaceTokens(session, estimate)
  const unchanged = segments.map((): Outcome => ({ action: 'kept', relevance: null }))

  const settle = (
    resolved: readonly Outcome[],
    jev: JevCallFacts | null,
    note: { skipped?: string; error?: string },
  ): ContextJevTurnRecord => {
    const tokensAfter = surfaceTokens(session, estimate)
    return appendLedger(session, {
      turn: input.turn,
      step: input.step,
      request: input.request.slice(0, config.digestChars),
      segments: segments.map((segment, index) => {
        // `resolveOutcomes` maps this same array one-to-one, so every index has
        // an outcome.
        const outcome = resolved[index] as Outcome
        return {
          id: segment.id,
          order: segment.order,
          label: segment.label,
          relevance: outcome.relevance,
          action: outcome.action,
          tokens: segment.tokens,
        } satisfies SegmentOutcome
      }),
      tokensBefore,
      tokensAfter,
      tokensSaved: tokensBefore - tokensAfter,
      jev,
      ...note,
    })
  }

  const eligible = segments.slice(0, Math.max(0, segments.length - config.keepRecentSegments))
  if (eligible.length === 0) {
    return settle(unchanged, null, { skipped: segments.length === 0 ? 'no-segments' : 'no-eligible-segment' })
  }
  if (input.signal.aborted) return settle(unchanged, null, { skipped: 'aborted' })

  let answer: Awaited<ReturnType<typeof evaluateRelevance>>
  try {
    const apiKey = await input.resolveApiKey()
    if (apiKey.length === 0) return settle(unchanged, null, { skipped: 'no-key' })
    const asked = eligible.slice(-config.maxSegmentsPerDecision)
    answer = await evaluateRelevance({
      request: input.request,
      segments: asked.map(segment => ({ id: segment.id, label: segment.label, digest: segment.digest })),
    }, {
      apiKey,
      baseURL: config.baseURL,
      model: config.model,
      timeoutMs: config.timeoutMs,
    })
  } catch (error: unknown) {
    const detail = error instanceof JevError ? `${error.code}: ${error.message}` : String(error)
    return settle(unchanged, null, { error: detail })
  }

  const askedIds = new Set(answer.relevance.keys())
  const resolved = resolveOutcomes(segments, askedIds, answer.relevance, config)
  const applied: Outcome[] = []
  try {
    // No await from here to the end: the whole rewrite is one log transaction.
    for (const [index, outcome] of resolved.entries()) {
      const segment = segments[index] as ContextSegment
      if (outcome.action === 'pruned') pruneSegment(session, segment, estimate)
      else if (outcome.action === 'restored') recallSegment(session, segment, originalsOf(session, segment), estimate)
      applied.push(outcome)
    }
  } catch (error: unknown) {
    // A refused append aborts every later rewrite, so the ledger reports what
    // landed and leaves the rest loaded rather than claiming work that did not
    // happen. A rewrite that threw after its own metering event left the
    // segment's content in place, which is exactly what `kept` says.
    const landed: Outcome[] = resolved.map((outcome, index) => (
      index < applied.length ? outcome : { action: 'kept', relevance: outcome.relevance }
    ))
    return settle(landed, answer.call, { error: String(error) })
  }
  return settle(resolved, answer.call, {})
}
