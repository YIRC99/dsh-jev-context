/**
 * The `jevContext` projection unit: a pure fold of the turn ledger into the
 * bounded record list a browser surface renders.
 *
 * The fold does no computation of its own — `context-jev/turn` already carries
 * the finished decision — so replay, restore, and fork reproduce the same list
 * from the log alone. Only the tail is retained: the list is a view of recent
 * decisions, not an archive, and the session log remains the archive.
 *
 * @module @yirc99/dsh-jev-context/projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SegmentOutcome } from './types.ts'

/** Client-visible projection key carrying this plugin's recent turn ledger. */
export const JEV_CONTEXT_PROJECTION_KEY = 'jevContext'

/** One segment's outcome as it crosses the wire; must satisfy {@link SegmentOutcome}. */
const segmentOutcomeSchema = z.object({
  id: z.string(),
  order: z.number(),
  label: z.string(),
  relevance: z.number().nullable(),
  action: z.enum(['kept', 'pruned', 'restored']),
  tokens: z.number(),
}) satisfies z.ZodType<SegmentOutcome>

const turnRecordSchema = z.object({
  turn: z.number(),
  step: z.number(),
  request: z.string(),
  segments: z.array(segmentOutcomeSchema),
  tokensBefore: z.number(),
  tokensAfter: z.number(),
  tokensSaved: z.number(),
  jev: z.object({
    model: z.string(),
    elapsedMs: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    estimatedUsd: z.number(),
  }).nullable(),
  skipped: z.string().optional(),
  error: z.string().optional(),
})

const stateSchema = z.object({ turns: z.array(turnRecordSchema) })

const viewSchema = z.object({
  turns: z.array(turnRecordSchema),
  savedTokens: z.number(),
  calls: z.number(),
})

/** Fold state: the retained tail, newest last. */
export type JevContextState = z.infer<typeof stateSchema>

/** The value a browser surface receives. */
export type JevContextView = z.infer<typeof viewSchema>

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Retained tail of the per-turn context ledger. */
    jevContext: JevContextState
  }
  interface SessionProjectionMap {
    /** Retained tail of the per-turn context ledger, as a browser surface reads it. */
    jevContext: JevContextView
  }
}

/** The registered unit, with its client view present. */
export type JevContextProjection = ProjectionDefinition<'jevContext', JevContextState> & {
  wire: {
    viewSchema: typeof viewSchema
    view: (state: JevContextState) => JevContextView
  }
}

/**
 * Build the projection unit for one retention bound.
 * @param retainedTurns - how many recent decisions the view keeps.
 * @returns the definition to register with the session projection registry.
 */
export function jevContextProjection(retainedTurns: number): JevContextProjection {
  const bound = Math.max(1, Math.trunc(retainedTurns))
  return {
    key: JEV_CONTEXT_PROJECTION_KEY,
    stateVersion: 1,
    stateSchema,
    init: (): JevContextState => ({ turns: [] }),
    apply: (state: JevContextState, event: SessionEvent): JevContextState => {
      if (event.type !== 'context-jev/turn') return state
      const turns = [...state.turns, event.data].slice(-bound)
      return { turns }
    },
    wire: {
      viewSchema,
      view: (state: JevContextState): JevContextView => {
        let savedTokens = 0
        let calls = 0
        for (const turn of state.turns) {
          savedTokens += turn.tokensSaved
          if (turn.jev !== null) calls += 1
        }
        return { turns: [...state.turns], savedTokens, calls }
      },
    },
  } satisfies ProjectionDefinition<'jevContext', JevContextState>
}
