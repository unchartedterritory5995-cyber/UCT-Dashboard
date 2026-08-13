// Journal Widgets — the one-action "send this widget to my journal" flow
// (owner decisions #9/#10): last-active note first, Notebook inbox as the
// fallback landing zone. Extracted from ChartWidget so every widget type's
// capture door shares ONE wire — a second hand-rolled copy of this flow is
// how doors drift.

import { buildWidgetEmbedAttrs } from './widgetEmbedCore'
import { kickSnapshotWarm } from './embedArchive'

/** Capture → embed attrs → last-active note (`/embeds` append) → inbox
 *  fallback. Returns the toast line — the CALLER owns its toast surface.
 *  `label` names the capture in toasts (a symbol, a date…). */
export async function sendCaptureToJournal(widgetId, capture, { label } = {}) {
  const attrs = buildWidgetEmbedAttrs(widgetId, capture)
  // Bars-history warm is a chart concept; other widget types have no (ticker,
  // tf) to deep-fill.
  if (widgetId === 'chart') kickSnapshotWarm(attrs.params)
  const name = label || attrs.params?.symbol || widgetId
  let last = null
  try { last = JSON.parse(localStorage.getItem('uct.jw.lastNote') || 'null') } catch { /* noop */ }
  try {
    if (last?.id) {
      const res = await fetch(`/api/j2/notes/${last.id}/embeds`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attrs }),
      })
      if (res.ok) return `${name} sent to your last note`
      // 404 = the note was deleted since — fall through to the inbox.
    }
    const res2 = await fetch('/api/j2/inbox', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        widgetId, params: attrs.params,
        searchText: attrs.searchText, capturedAt: attrs.capturedAt,
      }),
    })
    return res2.ok ? `${name} captured → Notebook inbox` : 'Capture failed — try again'
  } catch {
    return 'Capture failed — try again'
  }
}
