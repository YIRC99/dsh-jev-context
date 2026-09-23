/**
 * Public vocabulary for JEV-scored conversation segmentation: the segment
 * model, the per-turn ledger a configuration surface renders, and the JEV
 * answer the selection engine consumes.
 *
 * @module @yirc99/dsh-jev-context/types
 */

import type { SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Compact per-segment facts the relevance question is asked about. */
export interface SegmentDigest {
  /** Text of the segment's opening human turn, bounded for the prompt. */
  readonly request: string
  /** Concatenated assistant text of the segment, bounded for the prompt. */
  readonly reply: string
  /** Tool names the segment invoked, in first-use order. */
  readonly tools: readonly string[]
}

/**
 * One conversation segment as it currently stands in the session surface.
 *
 * A segment is a maximal run of surface nodes beginning at one human turn.
 * Pruning never edits a segment: it replaces the segment's whole span with one
 * marker node, and rehydration replaces that marker with a recalled copy. The
 * original nodes stay in the log, so {@link ContextSegment.sourceSeqs} keeps
 * naming them across every rewrite.
 */
export interface ContextSegment {
  /** Segment identity: the decimal form of its first original node's seq. */
  readonly id: string
  /** 1-based position among the session's segments, in surface order. */
  readonly order: number
  /** One-line topic label derived from the segment's own text. */
  readonly label: string
  /** Seq of the segment's first original surface node. */
  readonly anchor: SessionSeq
  /** Seq of the segment's last original surface node. */
  readonly tail: SessionSeq
  /** Original surface nodes of the segment, in order; stable across rewrites. */
  readonly sourceSeqs: readonly SessionSeq[]
  /** Surface nodes currently covering the segment: the originals, or one marker. */
  readonly spanSeqs: readonly SessionSeq[]
  /** Heuristic token price of the original nodes. */
  readonly tokens: number
  /** Whether a pruning marker currently stands in for this segment. */
  readonly pruned: boolean
  /** Facts the relevance question is asked about. */
  readonly digest: SegmentDigest
}

/** What the selection engine decided for one segment in one turn. */
export type SegmentAction = 'kept' | 'pruned' | 'restored'

/** One segment's outcome inside a turn's ledger. */
export interface SegmentOutcome {
  /** {@link ContextSegment.id}. */
  id: string
  /** 1-based position among the session's segments, in surface order. */
  order: number
  /** One-line topic label shown beside the outcome. */
  label: string
  /** JEV's probability that the segment was relevant, or null when it was not asked. */
  relevance: number | null
  /** What the engine did with the segment. */
  action: SegmentAction
  /** Heuristic token price of the segment's original nodes. */
  tokens: number
}

/** The JEV call's own facts, so one decision's cost is readable after the fact. */
export interface JevCallFacts {
  /** Model id the request named. */
  readonly model: string
  /** Wall-clock milliseconds the call took. */
  readonly elapsedMs: number
  /** Provider-reported input tokens. */
  readonly inputTokens: number
  /** Provider-reported output tokens. */
  readonly outputTokens: number
  /** Input-token price in USD at the recorded per-million rate. */
  readonly estimatedUsd: number
}

/** Durable record of one turn's context selection. */
export interface ContextJevTurnRecord {
  /** Turn this decision was made for. */
  turn: number
  /** Step this decision was made for. Always the turn's first step. */
  step: number
  /** The current request text the segments were scored against, bounded. */
  request: string
  /** Every segment the engine considered, in surface order. */
  segments: SegmentOutcome[]
  /** Heuristic tokens on the model-visible surface before the decision. */
  tokensBefore: number
  /** Heuristic tokens on the model-visible surface after the decision. */
  tokensAfter: number
  /** Tokens the decision removed from this request; negative when it restored. */
  tokensSaved: number
  /** The JEV call, or null when no call was needed. */
  jev: JevCallFacts | null
  /** Why the engine left the surface unchanged, when it did. */
  skipped?: string | undefined
  /** Why the decision failed; the surface is unchanged when this is set. */
  error?: string | undefined
}

/** One segment's digest as the relevance question presents it. */
export interface JevSegmentPrompt {
  /** Segment id the answer is keyed by. */
  readonly id: string
  /** One-line topic label. */
  readonly label: string
  /** Facts asked about. */
  readonly digest: SegmentDigest
}

/** One relevance question's inputs. */
export interface JevRelevanceRequest {
  /** Current request text the segments are scored against. */
  readonly request: string
  /** Candidate segments, in surface order. */
  readonly segments: readonly JevSegmentPrompt[]
}

/** One relevance answer set and the call that produced it. */
export interface JevRelevanceAnswer {
  /** Probability that each asked segment is relevant, keyed by segment id. */
  readonly relevance: ReadonlyMap<string, number>
  /** The call's own facts. */
  readonly call: JevCallFacts
}
