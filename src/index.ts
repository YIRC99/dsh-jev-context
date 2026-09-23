/**
 * JEV-scored conversation segmentation: keep only the earlier context a turn
 * actually needs.
 *
 * On each turn's opening step the plugin segments the model-visible history at
 * human-turn boundaries, asks the JEV decision service which segments are
 * relevant to the request, replaces the irrelevant ones with a one-line
 * omission marker, and recalls any previously omitted segment that became
 * relevant again. Only the surface changes; the log keeps every byte, and each
 * decision is recorded as a durable `context-jev/turn` ledger event.
 *
 * @module @yirc99/dsh-jev-context
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-token-meter'
import {
  JEV_CONTEXT_SETTINGS_NAMESPACE,
  JEV_DEFAULT_API_KEY_ENV,
  resolveConfig,
  type JevContextConfig,
  type ResolvedConfig,
} from './config.ts'
import { selectContext } from './engine.ts'
import {
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
  JEV_DEFAULT_TIMEOUT_MS,
} from './jev.ts'
import { jevContextProjection } from './projection.ts'
import { supportsIgnorableLedger } from './ledger.ts'

export * from './types.ts'
export {
  JEV_CONTEXT_SETTINGS_NAMESPACE,
  JEV_DEFAULT_API_KEY_ENV,
  resolveConfig,
} from './config.ts'
export type { JevContextConfig, ResolvedConfig } from './config.ts'
export {
  JEV_DEFAULT_BASE_URL,
  JEV_DEFAULT_MODEL,
  JEV_DEFAULT_TIMEOUT_MS,
  JEV_PRICE_PER_MILLION,
  JevError,
} from './jev.ts'
export type { JevCallOptions, JevErrorCode } from './jev.ts'
export { isMarkerEvent, MARKER_PLUGIN, readSegments } from './segments.ts'
export { resolveOutcomes, selectContext } from './engine.ts'
export type { SelectionInput } from './engine.ts'
export {
  JEV_CONTEXT_PROJECTION_KEY,
  jevContextProjection,
} from './projection.ts'
export type { JevContextProjection, JevContextState, JevContextView } from './projection.ts'
export type {} from './events.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'jev-context'

/**
 * The token meter prices every segment and its marker, and the projection
 * registry carries the ledger to the browser; both are hard dependencies.
 */
export const inject = ['tokenMeter', 'sessionProjections']

/** Plugin configuration; every field is overridable from the user settings document. */
export type Config = JevContextConfig

/** Schemastery validation for {@link Config}, served to settings clients and the composition. */
export const Config: z<JevContextConfig> = z.object({
  enabled: z.boolean().default(true),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(JEV_DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(JEV_DEFAULT_BASE_URL),
  model: z.string().default(JEV_DEFAULT_MODEL),
  timeoutMs: z.number().step(1).min(1).max(120_000).default(JEV_DEFAULT_TIMEOUT_MS),
  threshold: z.number().min(0).max(1).default(0.5),
  keepRecentSegments: z.number().step(1).min(0).max(50).default(1),
  minSegmentTokens: z.number().step(1).min(0).default(400),
  maxSegmentsPerDecision: z.number().step(1).min(1).max(200).default(40),
  digestChars: z.number().step(1).min(40).max(4_000).default(320),
  retainedTurns: z.number().step(1).min(1).max(200).default(12),
})

/** The request text one step's claimed messages ask about. */
function requestTextOf(messages: readonly UserMessage[]): string {
  const parts: string[] = []
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text') parts.push(block.text)
    }
  }
  return parts.join('\n').trim()
}

/**
 * Resolve the credential one decision authenticates with.
 *
 * A literal setting wins; otherwise the credential reference is resolved
 * through the credentials seam, then the launch environment. Resolution is per
 * call, so a key stored from the browser reaches the next decision without a
 * restart.
 * @param ctx - plugin context supplying the credential and environment planes.
 * @param config - the currently authoritative section.
 * @returns the key, or an empty string while none is configured.
 */
async function resolveApiKey(ctx: Context, config: ResolvedConfig): Promise<string> {
  if (config.apiKey.length > 0) return config.apiKey
  const ref = credentialRef(config.apiKeyEnv)
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const resolved = await credentials.resolve(ref)
    if (resolved !== undefined) return resolved.value
  }
  return launchEnvironmentOf(ctx).get(ref)?.value ?? ''
}

/**
 * Mount the context selector.
 * @param ctx - the plugin's context.
 * @param config - composition-layer configuration; the user document overrides it.
 */
export function apply(ctx: Context, config: JevContextConfig = {}): void {
  // The ledger is the only record this plugin writes into a session log, and a
  // harness that cannot mark it ignorable would store it as a required event
  // that every reader without this plugin refuses. Say so once at mount rather
  // than leaving the console silently empty.
  if (!supportsIgnorableLedger()) {
    ctx.logger.warn(
      'jev-context: this harness does not write the ignorable marker for a log-only event, '
      + 'so the per-turn ledger stays off; context selection runs unchanged. '
      + 'Upgrade the harness to record the ledger.',
    )
  }
  // Read once at mount: a projection's fold state is persisted and versioned,
  // so its retention bound is a composition fact rather than a live knob.
  ctx.sessionProjections.register(jevContextProjection(resolveConfig(config).retainedTurns))
  let current: () => JevContextConfig = () => config
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, JEV_CONTEXT_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => { current = source },
      // The section is projected per decision, so a committed change reaches
      // the next turn without re-registering anything.
      onChange: () => {},
    })
  })

  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    // Only a turn's opening step selects context: later steps of the same turn
    // carry no new request to score against, and re-scoring them would churn
    // the surface between two requests that share a prefix.
    if (step !== 1 || decision.messages.length === 0) return decision
    const section = resolveConfig(current())
    if (!section.enabled) return decision
    const request = requestTextOf(decision.messages)
    if (request.length === 0) return decision
    try {
      await selectContext({
        session: agent.session,
        turn,
        step,
        request,
        signal,
        config: section,
        resolveApiKey: () => resolveApiKey(ctx, section),
        estimate: message => ctx.tokenMeter.estimateMessage(message),
      })
    } catch (error: unknown) {
      // The engine contains its own failures; reaching here means the ledger
      // append itself failed. A context optimization must never cost a turn.
      const detail = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`jev-context: context selection failed for turn ${String(turn)}: ${detail}`)
    }
    return decision
  })
}
