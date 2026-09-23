/**
 * Model-facing marker text.
 *
 * A marker is one `user/message` that stands in for a whole segment. Two forms
 * exist: the omission notice that replaces a live segment, and the recalled
 * copy that replaces an omission notice. Both are written from the model's
 * perspective and name no host or UI concept.
 *
 * @module @yirc99/dsh-jev-context/render
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { transcriptOf } from './segments.ts'
import type { ContextSegment } from './types.ts'

/**
 * Character bound on a recalled transcript. A recalled segment must stay
 * cheaper than the log it came from only in the sense that it is one node; its
 * content is deliberately verbatim, so the bound exists only to keep one
 * pathological segment from dominating a request.
 */
export const RECALL_MAX_CHARS = 12_000

/** Character bound on a marker's one-line account. */
const SUMMARY_MAX_CHARS = 120

/**
 * Build the text that replaces a live segment when it is pruned.
 * @param segment - the segment being pruned.
 * @returns the omission notice the model reads in place of the segment.
 */
export function renderPruneMarker(segment: ContextSegment): string {
  return `[更早的对话已省略 · 主题：${segment.label}]\n`
    + '这一段更早的对话与当前请求无关，为了给当前请求留出上下文空间已从本轮省略。'
    + '它没有被删除，仍保存在会话记录中。'
    + '如果你判断它可能相关，请直接说明需要该片段，下一轮会自动重新载入。'
}

/**
 * Build the one-line account a collapsed transcript row shows for a prune.
 * @param segment - the segment being pruned.
 * @returns the bounded account.
 */
export function pruneSummary(segment: ContextSegment): string {
  const account = `已省略更早的对话片段「${segment.label}」`
  return account.length <= SUMMARY_MAX_CHARS ? account : `${account.slice(0, SUMMARY_MAX_CHARS - 1)}…`
}

/**
 * Build the text that replaces an omission notice when a segment is recalled.
 * @param segment - the segment being recalled.
 * @param events - the segment's original events, in surface order.
 * @returns the recalled copy the model reads.
 */
export function renderRecallMarker(segment: ContextSegment, events: readonly SessionEvent[]): string {
  const transcript = transcriptOf(events)
  const bounded = transcript.length <= RECALL_MAX_CHARS
    ? transcript
    : `${transcript.slice(0, RECALL_MAX_CHARS - 1)}…`
  return `[更早的对话已重新载入 · 主题：${segment.label}]\n`
    + '这一段更早的对话此前因话题切换被省略，现因与当前请求相关而重新载入。以下为原文，未作改写。\n'
    + '---\n'
    + bounded
}
