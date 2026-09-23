/**
 * JEV context plugin, browser half: the sidebar's JEV configuration row, its
 * panel, and the per-turn context ledger the panel renders.
 *
 * The row occupies `sidebar.footer.action`, so it sits at the sidebar foot
 * beside the shipped Settings row. Configuration crosses to the host through
 * the client settings scope — the API key is a `role('secret')` field the host
 * redacts on the way back, so this half learns only whether one is stored. The
 * ledger arrives as the `jevContext` session projection, which the host folds
 * from the durable per-turn events.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '../client.ts'
import { JevPanel } from './JevPanel.tsx'
import {
  createJevPanelStore,
  JEV_CONTEXT_NAMESPACE,
  type JevNotice,
  type JevPanelState,
  type JevSection,
} from './store.ts'
import { en, NS, zh, type JevContextKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** JEV context row, panel, and ledger copy. */
    'jevContext': JevContextKey
  }
}

export type { JevPanelState, JevNotice } from './store.ts'

/** The callbacks and reactive sources this plugin's row receives. */
export interface JevPanelFace {
  /** Reactive sources the renderer binds to `use<Name>` hooks. */
  hooks: { panel: SnapshotStore<JevPanelState> }
  /** Write one section field. */
  onWrite: (field: keyof JevSection, value: unknown) => Promise<void>
  /** Remove the stored API key. */
  onClearKey: () => Promise<void>
}

/**
 * Required services: the slot registry and the dictionaries.
 *
 * The settings scope is deliberately NOT here. It arrives from the client
 * settings package, which not every harness generation ships, and an entry
 * waiting on a service that never appears stays pending — which blocks the
 * entire web boot, not just this row. The scope is taken through `ctx.inject`
 * below instead, so a harness without it keeps a working web app and simply
 * has no JEV row.
 */
export const inject = ['slots', 'locale']

/**
 * Register the dictionaries and, once the settings scope exists, the sidebar
 * foot row.
 *
 * Nothing here may take the entry down: a failed client entry fails the whole
 * web boot, so a harness that already provides a JEV row, or a second copy of
 * this plugin, must cost the row and nothing more.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  try {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-jev-context: dictionaries')
  } catch (error) {
    // A locale namespace has exactly one owner. Another plugin may already hold
    // this one — a harness shipping its own JEV context row, or a second copy
    // of this plugin — and failing here would fail the boot with it.
    console.warn(`jev-context: locale namespace "${NS}" is already owned; the sidebar row stays off`, error)
    return
  }

  ctx.inject(['settingsScope'], (settingsCtx) => {
    const scope = settingsCtx.settingsScope.bind<JevSection>({ namespace: JEV_CONTEXT_NAMESPACE })
    const mirror = settingsCtx.settingsScope.describe()
    const panel = createJevPanelStore()

    const publish = (notice?: JevNotice): void => {
      const snapshot = scope.getSnapshot()
      const section = snapshot.value ?? {}
      // `secrets` is the only channel a redacted secret field leaves behind: the
      // host states that a value is stored, never what it is.
      const secrets = mirror.getSnapshot().view?.namespaces
        .find(view => view.ns === JEV_CONTEXT_NAMESPACE)?.secrets
      panel.set({
        status: snapshot.status,
        writable: snapshot.writable,
        enabled: section.enabled ?? true,
        configured: secrets?.some(secret => secret.set === true) ?? false,
        threshold: section.threshold ?? 0.5,
        keepRecentSegments: section.keepRecentSegments ?? 1,
        notice: notice ?? panel.getSnapshot().notice,
      })
    }

    ctx.effect(() => scope.subscribe(() => { publish() }), 'ui-jev-context: section changes')
    ctx.effect(() => mirror.subscribe(() => { publish() }), 'ui-jev-context: credential changes')
    publish()

    /** Write one field and report the outcome the host actually landed. */
    const write = async (field: string, value: unknown): Promise<void> => {
      if (!scope.getSnapshot().writable) {
        publish({ key: 'notice.readonly' })
        return
      }
      await scope.set(field, value)
      const section = scope.getSnapshot().value as Record<string, unknown> | undefined
      const landed = section !== undefined && section[field] === value
      publish(landed ? { key: 'notice.saved' } : { key: 'notice.error', params: { message: String(field) } })
    }

    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'jev-context',
      // After the Cordis plugin row: process work reads before context policy.
      order: 20,
      locale: NS,
      inject: (): JevPanelFace => ({
        hooks: { panel },
        onWrite: async (field, value) => { await write(field, value) },
        onClearKey: async () => {
          if (!scope.getSnapshot().writable) {
            publish({ key: 'notice.readonly' })
            return
          }
          await scope.unset('apiKey')
          publish({ key: 'notice.saved' })
        },
      }),
    }, JevPanel))
  })
}
