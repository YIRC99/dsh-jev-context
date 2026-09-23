/** Sidebar foot row: the JEV context trigger and the savings console it opens. */

import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button, Input, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { JevContextView, SegmentOutcome } from '../client.ts'
import type { JevPanelFace } from './index.ts'
import type { JevNotice, JevPanelState } from './store.ts'
import type { JevContextKey } from './locales.ts'
import css from './JevPanel.module.css'

/** Full props composed by the sidebar footer-action slot. */
export type JevPanelProps =
  PropsRuntime<'sidebar.footer.action'> & InjectFace<JevPanelFace> & PropsLocale<'jevContext'>

/** One turn's ledger record, as the projection folds it. */
type TurnRecord = JevContextView['turns'][number]

/** One session row: the ledger the list already carries, or undefined when it has none. */
interface SessionRow {
  /** Session identity, used as the selection key. */
  readonly id: string
  /** Host-computed title, falling back to a short id. */
  readonly title: string
  /** Retained ledger for this session, or undefined when it has no record. */
  readonly view: JevContextView | undefined
}

/** Locale key for each reason the engine left the surface alone. */
const SKIP_LABELS: Readonly<Record<string, JevContextKey>> = {
  'no-key': 'ledger.skipped.no-key',
  'no-segments': 'ledger.skipped.no-segments',
  'no-eligible-segment': 'ledger.skipped.no-eligible-segment',
  aborted: 'ledger.skipped.aborted',
}

/** Sessions listed before the reader asks for the rest. */
const SESSION_PREVIEW = 5

/**
 * The rows the collapsed session list shows.
 *
 * A workspace can hold hundreds of sessions, and a list that grows with them
 * would size the whole console. The leading slice keeps the console's height
 * bounded; the selected row joins it because a reader who reached a session by
 * expanding would otherwise lose sight of the one the report describes.
 * @param rows - every listed session, in list order.
 * @param selectedId - the session the report below describes.
 * @param limit - rows to show before the rest are deferred.
 * @returns the rows to render, in list order.
 */
function previewRows(
  rows: readonly SessionRow[],
  selectedId: string | undefined,
  limit: number,
): readonly SessionRow[] {
  const head = rows.slice(0, limit)
  if (rows.length <= limit) return rows
  const selected = rows.find(row => row.id === selectedId)
  return selected === undefined || head.includes(selected) ? head : [...head, selected]
}

/**
 * Group an integer with thousands separators.
 *
 * Both locales this build ships group digits in threes with a comma, so the
 * report formats counts locally rather than routing a numeric formatter
 * through the string dictionary.
 * @param value - the token count.
 * @returns the grouped decimal string.
 */
function group(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
}

/** Render the notice the last write produced. */
function noticeText(notice: JevNotice, t: TranslateNS<'jevContext'>): string {
  return notice.key === 'notice.error'
    ? t('notice.error', { message: notice.params?.['message'] ?? '' })
    : t(notice.key)
}

/** Render one turn's token outcome. */
function savingText(record: TurnRecord, t: TranslateNS<'jevContext'>): string {
  const saved = Math.round(record.tokensSaved)
  if (saved > 0) return t('ledger.saved', { tokens: group(saved) })
  if (saved < 0) return t('ledger.spent', { tokens: group(-saved) })
  return t('ledger.flat')
}

/** Render the reason a decision was skipped, or the failure it hit. */
function gapText(record: TurnRecord, t: TranslateNS<'jevContext'>): string | null {
  if (record.error !== undefined) return t('ledger.error', { message: record.error })
  if (record.skipped === undefined) return null
  const key = SKIP_LABELS[record.skipped]
  return key === undefined ? record.skipped : t(key)
}

/** One segment line: what it cost, how relevant JEV judged it, and its topic. */
function SegmentLine({ segment, t }: { segment: SegmentOutcome; t: TranslateNS<'jevContext'> }) {
  return (
    <li className={css.segment} data-jev-action={segment.action} data-jev-segment={segment.id}>
      <span className={css.segmentTokens} data-jev-segment-tokens={segment.tokens}>
        {group(segment.tokens)}
      </span>
      <span className={css.segmentLabel} title={segment.label}>{segment.label}</span>
      <span className={css.segmentScore}>
        {segment.relevance === null
          ? t('segment.unscored')
          : t('segment.relevance', { percent: String(Math.round(segment.relevance * 100)) })}
      </span>
    </li>
  )
}

/** Render the JEV row at the sidebar foot and the console it opens. */
export function JevPanel({
  wide, usePanel, useSessions, onWrite, onClearKey, t,
}: JevPanelProps) {
  const state = usePanel(snapshot => snapshot)
  const list = useSessions(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string>()
  const [expanded, setExpanded] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (task: () => Promise<void>) => {
    setBusy(true)
    void task().finally(() => { setBusy(false) })
  }

  const onKeyInput = (event: ChangeEvent<HTMLInputElement>) => { setKeyDraft(event.target.value) }
  const onSaveKey = () => {
    const value = keyDraft.trim()
    /* v8 ignore next -- the save button is disabled while the draft is blank. */
    if (value.length === 0) return
    submit(async () => {
      await onWrite('apiKey', value)
      setKeyDraft('')
    })
  }

  // Every listed session already carries its own projection baseline — the
  // list seeds it without the session being opened — so the console reports the
  // whole workspace rather than only the conversation on screen.
  const rows: SessionRow[] = list.ids.map((id) => {
    const entry = list.byId[id]
    const view = entry?.projectionValues?.['jevContext']
    // The list carries the host title projection, and `displayTitle` before it.
    const title = entry?.title ?? entry?.displayTitle
    return {
      id,
      title: title !== undefined && title !== '' ? title : id.slice(0, 8),
      view,
    }
  })
  const tracked = rows.filter((row): row is SessionRow & { view: JevContextView } => row.view !== undefined)
  const grandSaved = tracked.reduce((sum, row) => sum + Math.round(row.view.savedTokens), 0)
  const totalTurns = tracked.reduce((sum, row) => sum + row.view.turns.length, 0)
  const totalCalls = tracked.reduce((sum, row) => sum + row.view.calls, 0)
  const selected = rows.find(row => row.id === (picked ?? list.current)) ?? tracked[0]
  const visibleRows = expanded ? rows : previewRows(rows, selected?.id, SESSION_PREVIEW)
  const deferred = rows.length - visibleRows.length
  // A session the engine never ran for carries a view with no turns; it reports
  // the same empty state as one with no ledger at all.
  const recorded = selected?.view !== undefined && selected.view.turns.length > 0 ? selected.view : undefined
  const turns = [...(recorded?.turns ?? [])].reverse()
  // The engine records every turn it runs for, so its earliest turn is how far
  // back a session's report reaches.
  const firstTurn = recorded === undefined ? 0 : Math.min(...recorded.turns.map(record => record.turn))

  return (
    <div className={css.layer} data-jev-row>
      <button
        type="button"
        className={css.badge}
        data-jev-badge={turns.length}
        data-jev-configured={state.configured ? 'true' : 'false'}
        data-jev-enabled={state.enabled ? 'true' : 'false'}
        aria-label={t('trigger.aria')}
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className={css.dot} aria-hidden />
        {wide && <span className={css.badgeLabel}>{t('trigger.label')}</span>}
      </button>
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t('panel.title')}
        closeLabel={t('panel.close')}
        description={t('panel.subtitle')}
        className={css.dialog as string}
        contentClassName={css.dialogContent as string}
      >
        <p className={css.hero} data-jev-grand-total={grandSaved}>
          <span className={css.heroLabel}>{t('total.label')}</span>
          <span className={css.heroValue}>{group(grandSaved)}</span>
          <span className={css.heroUnit}>{t('total.unit')}</span>
        </p>
        <p className={css.heroMeta}>
          {tracked.length === 0
            ? t('total.empty')
            : t('total.meta', {
              sessions: String(tracked.length),
              turns: String(totalTurns),
              calls: String(totalCalls),
            })}
        </p>

        <div className={css.columns}>
          <section className={css.sessions}>
            <h3 className={css.group}>{t('sessions.title', { count: String(rows.length) })}</h3>
            <ul className={css.sessionList}>
              {visibleRows.map(row => (
                <li key={row.id}>
                  <button
                    type="button"
                    className={css.session}
                    data-jev-session={row.id}
                    data-jev-selected={row.id === selected?.id ? 'true' : 'false'}
                    aria-pressed={row.id === selected?.id}
                    onClick={() => { setPicked(row.id) }}
                  >
                    <span className={css.sessionName} title={row.title}>{row.title}</span>
                    <span className={css.sessionSaved}>
                      {row.view === undefined
                        ? t('sessions.untracked')
                        : t('sessions.saved', { tokens: group(row.view.savedTokens) })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {(deferred > 0 || expanded) && (
              <button
                type="button"
                className={css.more}
                data-jev-more={deferred}
                aria-expanded={expanded}
                onClick={() => { setExpanded(value => !value) }}
              >
                {expanded ? t('sessions.less') : t('sessions.more', { count: String(deferred) })}
              </button>
            )}
          </section>

          <section className={css.ledger}>
            {recorded === undefined
              ? <p className={css.hint}>{t('ledger.empty')}</p>
              : (
                <>
                  <h3 className={css.group}>{t('ledger.title')}</h3>
                  <p className={css.total} data-jev-total={Math.round(recorded.savedTokens)}>
                    {t('ledger.summary', {
                      turns: String(recorded.turns.length),
                      calls: String(recorded.calls),
                      tokens: group(recorded.savedTokens),
                    })}
                  </p>
                  {firstTurn > 1 && (
                    <p className={css.hint} data-jev-from={firstTurn}>
                      {t('ledger.from', { turn: String(firstTurn) })}
                    </p>
                  )}
                  <ul className={css.turns}>
                    {turns.map((record) => {
                      const killed = record.segments.filter(segment => segment.action === 'pruned')
                      const kept = record.segments.filter(segment => segment.action !== 'pruned')
                      const gap = gapText(record, t)
                      return (
                        <li key={record.turn} className={css.turn} data-jev-turn={record.turn}>
                          <div className={css.turnHead}>
                            <span className={css.turnTitle}>
                              {t('ledger.turn', { turn: String(record.turn) })}
                            </span>
                            <span className={css.turnSaved} data-jev-saved={Math.round(record.tokensSaved)}>
                              {savingText(record, t)}
                            </span>
                          </div>
                          <p className={css.turnRequest} data-jev-request>{record.request}</p>
                          <p className={css.turnWindow}>
                            {t('ledger.window', {
                              before: group(record.tokensBefore),
                              after: group(record.tokensAfter),
                            })}
                          </p>
                          {gap !== null && <p className={css.turnGap}>{gap}</p>}
                          {killed.length > 0
                            ? (
                              <>
                                <p className={css.killedHead} data-jev-killed={killed.length}>
                                  {t('ledger.killed', { count: String(killed.length) })}
                                </p>
                                <ul className={css.segments}>
                                  {killed.map(segment => (
                                    <SegmentLine key={segment.id} segment={segment} t={t} />
                                  ))}
                                </ul>
                              </>
                            )
                            : <p className={css.killedNone}>{t('ledger.killedNone')}</p>}
                          {kept.length > 0 && (
                            <details className={css.kept}>
                              <summary data-jev-kept={kept.length}>
                                {t('ledger.keptGroup', { count: String(kept.length) })}
                              </summary>
                              <ul className={css.segments}>
                                {kept.map(segment => (
                                  <SegmentLine key={segment.id} segment={segment} t={t} />
                                ))}
                              </ul>
                            </details>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
          </section>
        </div>

        <details className={css.config}>
          <summary className={css.configHead}>{t('config.title')}</summary>
          {/* Each field is one grid cell holding its label, control, and hint.
              Laying the three out as siblings let the grid place a hint in a
              different column from the control it explains. */}
          <div className={css.configBody}>
            <div className={css.field} data-jev-field="enabled">
              <span className={css.fieldLabel}>{t('field.enabled')}</span>
              <div className={css.switchRow}>
                <Switch
                  checked={state.enabled}
                  disabled={busy || !state.writable}
                  label={t('field.enabled')}
                  onChange={(next) => { submit(() => onWrite('enabled', next)) }}
                />
              </div>
              <p className={css.hint} data-jev-field-hint>{t('field.enabledHint')}</p>
            </div>

            <div className={css.field} data-jev-field="apiKey">
              <span className={css.fieldLabel}>{t('field.apiKey')}</span>
              <div className={css.keyRow}>
                <Input
                  type="password"
                  value={keyDraft}
                  autoComplete="off"
                  placeholder={t('field.apiKeyPlaceholder')}
                  disabled={busy || !state.writable}
                  data-jev-key-input
                  onChange={onKeyInput}
                />
                <Button
                  variant="primary"
                  disabled={busy || keyDraft.trim().length === 0}
                  data-jev-key-save
                  onClick={onSaveKey}
                >{busy ? t('action.saving') : t('action.save')}</Button>
              </div>
              <p className={css.hint} data-jev-field-hint data-jev-key-state={state.configured ? 'configured' : 'missing'}>
                {state.configured ? t('field.apiKeySet') : t('field.apiKeyUnset')}
                {state.configured && (
                  <Button
                    variant="outline"
                    size="sm"
                    className={css.inlineAction}
                    disabled={busy || !state.writable}
                    data-jev-key-clear
                    onClick={() => { submit(onClearKey) }}
                  >{t('action.clearKey')}</Button>
                )}
              </p>
            </div>

            <div className={css.field} data-jev-field="threshold">
              <span className={css.fieldLabel}>{t('field.threshold')}</span>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={state.threshold}
                disabled={busy || !state.writable}
                data-jev-threshold
                onChange={(event) => {
                  const next = Number(event.target.value)
                  /* v8 ignore next -- a number input sanitizes unparseable text to '' , which reads as 0. */
                  if (!Number.isFinite(next)) return
                  submit(() => onWrite('threshold', next))
                }}
              />
              <p className={css.hint} data-jev-field-hint>{t('field.thresholdHint')}</p>
            </div>

            <div className={css.field} data-jev-field="keepRecent">
              <span className={css.fieldLabel}>{t('field.keepRecent')}</span>
              <Input
                type="number"
                min={0}
                max={50}
                step={1}
                value={state.keepRecentSegments}
                disabled={busy || !state.writable}
                data-jev-keep-recent
                onChange={(event) => {
                  const next = Number(event.target.value)
                  /* v8 ignore next -- a number input sanitizes unparseable text to '' , which reads as 0. */
                  if (!Number.isInteger(next)) return
                  submit(() => onWrite('keepRecentSegments', next))
                }}
              />
              <p className={css.hint} data-jev-field-hint>{t('field.keepRecentHint')}</p>
            </div>

            {state.status === 'unavailable' && <p className={css.error} role="alert">{t('state.unavailable')}</p>}
            {state.notice !== null && <p className={css.notice} role="status">{noticeText(state.notice, t)}</p>}
          </div>
        </details>
      </Modal>
    </div>
  )
}

/** Narrow the notice's message parameter for callers that render it directly. */
export type { JevNotice, JevPanelState }
