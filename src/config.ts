/**
 * Configuration vocabulary and the settings namespace that owns it.
 *
 * Every deployment-varying choice is a schema field: the composition supplies
 * the base layer, the user document overrides it, and a configuration surface
 * renders the resolved section. The API key is a `role('secret')` field, so a
 * remote settings read strips it before it reaches a browser.
 *
 * The schema itself lives beside the plugin body in `index.ts`, where the
 * config catalog reads it.
 *
 * @module @yirc99/dsh-jev-context/config
 */

import {
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
  JEV_DEFAULT_TIMEOUT_MS,
} from './jev.ts'

/** Settings namespace carrying this plugin's endpoint, credential, and policy. */
export const JEV_CONTEXT_SETTINGS_NAMESPACE = 'jev-context'

/** Environment variable read when no key is stored and no reference is named. */
export const JEV_DEFAULT_API_KEY_ENV = 'TYPESAFE_API_KEY'

/**
 * Every deployment-varying choice this plugin makes.
 *
 * A field is validated here rather than clamped at use, so a composition that
 * misconfigures the engine fails loud at load instead of silently pruning
 * nothing.
 */
export interface JevContextConfig {
  /** Whether turn-level context selection runs at all. */
  enabled?: boolean
  /** Literal JEV API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each decision; defaults to `TYPESAFE_API_KEY`. */
  apiKeyEnv?: string
  /** System One endpoint base; `/systemone` is appended. */
  baseURL?: string
  /** Decision model id. */
  model?: string
  /** Per-call deadline in milliseconds. */
  timeoutMs?: number
  /**
   * Probability at or above which a candidate segment is treated as relevant.
   * The demo measured relevant segments near 0.95 and unrelated ones below
   * 0.2, so the usable band is wide; the default sits in the middle of it.
   */
  threshold?: number
  /** Trailing segments always kept verbatim, whatever their score. */
  keepRecentSegments?: number
  /**
   * Smallest segment, in heuristic tokens, worth rewriting. Below this the
   * marker costs about what the segment does, so pruning would save nothing.
   */
  minSegmentTokens?: number
  /** Largest number of segments asked about in one decision. */
  maxSegmentsPerDecision?: number
  /** Character bound applied to each digest field sent to the decision service. */
  digestChars?: number
  /** How many recent decisions the browser ledger retains. */
  retainedTurns?: number
}

/**
 * Config with every field resolved.
 *
 * Cordis applies the schema defaults, so this only has to settle the values a
 * direct construction can leave absent.
 */
export interface ResolvedConfig {
  /** {@link JevContextConfig.enabled}. */
  readonly enabled: boolean
  /** {@link JevContextConfig.apiKey}, empty when unset. */
  readonly apiKey: string
  /** {@link JevContextConfig.apiKeyEnv}. */
  readonly apiKeyEnv: string
  /** {@link JevContextConfig.baseURL}. */
  readonly baseURL: string
  /** {@link JevContextConfig.model}. */
  readonly model: string
  /** {@link JevContextConfig.timeoutMs}. */
  readonly timeoutMs: number
  /** {@link JevContextConfig.threshold}. */
  readonly threshold: number
  /** {@link JevContextConfig.keepRecentSegments}. */
  readonly keepRecentSegments: number
  /** {@link JevContextConfig.minSegmentTokens}. */
  readonly minSegmentTokens: number
  /** {@link JevContextConfig.maxSegmentsPerDecision}. */
  readonly maxSegmentsPerDecision: number
  /** {@link JevContextConfig.digestChars}. */
  readonly digestChars: number
  /** {@link JevContextConfig.retainedTurns}. */
  readonly retainedTurns: number
}

/**
 * Resolve a section into the values the engine reads.
 * @param config - a validated section, possibly missing the fields a direct construction omitted.
 * @returns the same choices with every default filled in.
 */
export function resolveConfig(config: JevContextConfig): ResolvedConfig {
  return {
    enabled: config.enabled ?? true,
    apiKey: config.apiKey ?? '',
    apiKeyEnv: config.apiKeyEnv ?? JEV_DEFAULT_API_KEY_ENV,
    baseURL: config.baseURL ?? JEV_DEFAULT_BASE_URL,
    model: config.model ?? JEV_DEFAULT_MODEL,
    timeoutMs: config.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS,
    threshold: config.threshold ?? 0.5,
    keepRecentSegments: config.keepRecentSegments ?? 1,
    minSegmentTokens: config.minSegmentTokens ?? 400,
    maxSegmentsPerDecision: config.maxSegmentsPerDecision ?? 40,
    digestChars: config.digestChars ?? 320,
    retainedTurns: config.retainedTurns ?? 12,
  }
}
