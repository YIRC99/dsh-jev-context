/**
 * Reactive view state for the JEV panel row.
 *
 * The store is a factory, never a module-level handle: the plugin creates one
 * per registration and the renderer binds it through the inject `hooks`
 * compartment, so a reloaded plugin gets a fresh store and the old one leaves
 * with its fiber.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Settings namespace the host plugin registers. */
export const JEV_CONTEXT_NAMESPACE = 'jev-context'

/** The section fields this panel reads and writes. */
export interface JevSection {
  /** Whether turn-level context selection runs. */
  enabled?: boolean
  /** Write-only JEV API key; the host never returns it. */
  apiKey?: string
  /** Decision model id. */
  model?: string
  /** System One endpoint base. */
  baseURL?: string
  /** Probability at or above which a segment is treated as relevant. */
  threshold?: number
  /** Trailing segments always kept verbatim. */
  keepRecentSegments?: number
  /** How many recent decisions the ledger retains. */
  retainedTurns?: number
}

/** Everything the panel renders about the host-side configuration. */
export interface JevPanelState {
  /** Settings transport state for this namespace. */
  status: 'loading' | 'ready' | 'unavailable'
  /** Whether the host document accepts writes. */
  writable: boolean
  /** Whether pruning is enabled. */
  enabled: boolean
  /** Whether a JEV API key is stored; the value itself never reaches the browser. */
  configured: boolean
  /** Relevance threshold in force. */
  threshold: number
  /** Retained trailing segments in force. */
  keepRecentSegments: number
  /** Outcome of the last write, as a locale key plus its parameters. */
  notice: JevNotice | null
}

/** One write outcome the panel reports back to its user. */
export interface JevNotice {
  /** Locale key of the message. */
  readonly key: 'notice.saved' | 'notice.error' | 'notice.readonly'
  /** Substitution parameters for that key. */
  readonly params?: Readonly<Record<string, string>>
}

/** The initial, not-yet-read state. */
const INITIAL: JevPanelState = {
  status: 'loading',
  writable: false,
  enabled: true,
  configured: false,
  threshold: 0.5,
  keepRecentSegments: 1,
  notice: null,
}

/**
 * Create the panel's observable state.
 * @returns a snapshot store the inject face publishes and the component reads.
 */
export function createJevPanelStore(): SnapshotStore<JevPanelState> {
  return createSnapshotStore<JevPanelState>({ ...INITIAL })
}
