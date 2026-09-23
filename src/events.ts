/**
 * The durable per-turn ledger.
 *
 * The event is log-only: it carries no `surfaceOp` and never enters the
 * model-visible surface. Its type is declared here rather than by the harness,
 * so `selectContext` appends it with the `ignorable` marker — a reader that
 * does not install this plugin recognizes neither the type nor any obligation
 * to interpret it, while an unrecognized required event would make that reader
 * refuse the whole log. The ledger is what makes "which context did this turn
 * load" answerable from the session log alone, after persistence, replay, or
 * fork.
 *
 * @module @yirc99/dsh-jev-context/events
 */

import type { ContextJevTurnRecord } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One turn's context-selection ledger — log-only, no surfaceOp. Records the
     * request the segments were scored against, every segment the engine
     * considered with the decision service's relevance probability and the
     * action taken, the heuristic token totals before and after, and the
     * decision call's own facts, so the context a turn loaded is reconstructable
     * from the log without re-running the decision.
     */
    'context-jev/turn': ContextJevTurnRecord
  }
}

export type { ContextJevTurnRecord }
