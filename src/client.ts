/**
 * Client-namespace projection of this package's vocabulary: the declarations
 * browser code reads, and nothing executable. Projecting the types outlet
 * keeps one source for the ledger record on both sides of the wire.
 *
 * @module @yirc99/dsh-jev-context/client
 */

export type * from './types.ts'
export type { JevContextState, JevContextView } from './projection.ts'
