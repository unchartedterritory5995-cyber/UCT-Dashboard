/**
 * Journal 2.0 — Notebook import: post-migration ticker enrichment.
 * Spec: docs/superpowers/specs/2026-09-01-notebook-migration-program-design.md §8.1
 *
 * The offer: "We found N notes mentioning tickers. Want the live chart on
 * them?" Three exports, each a thin wrapper over an EXISTING endpoint —
 * nothing here invents a new mutation channel:
 *  - scanForTickers(noteIds)       -> POST /api/j2/notes/enrichment/scan (new, read-only)
 *  - addChartEmbed(noteId, ticker) -> POST /api/j2/notes/{id}/embeds (shipped: "Send to Journal")
 *  - revertChartEmbed(noteId, doc) -> PUT  /api/j2/notes/{id} (shipped: the editor's own save path)
 *
 * ⛔⛔ Reversibility is real, not cosmetic: `addChartEmbed`'s server side
 * (`notes_service.append_widget_embed`) only ever APPENDS one node to the
 * END of the doc's `content` array — so the doc it returns, minus its own
 * last node, IS the note's exact pre-enrichment body. `revertChartEmbed`
 * does exactly that and PUTs it back, a full write, not a client-side hide.
 */
import { buildWidgetEmbedAttrs } from '../widgetEmbedCore'

/**
 * @param {string[]} noteIds
 * @returns {Promise<{candidates: Array<{id: string, title: string, tickers: string[]}>, scanned: number, truncated: boolean}>}
 */
export async function scanForTickers(noteIds) {
  if (!noteIds || noteIds.length === 0) return { candidates: [], scanned: 0, truncated: false }
  const res = await fetch('/api/j2/notes/enrichment/scan', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ noteIds }),
  })
  if (!res.ok) throw new Error(`ticker scan failed (HTTP ${res.status})`)
  return res.json()
}

/**
 * Appends a live chart embed for `ticker` to `noteId`. Resolves with the
 * note's bodyJson AFTER the append (needed by `revertChartEmbed` below) —
 * never resolves with a falsy value on success.
 * @returns {Promise<object>} the post-append bodyJson
 */
export async function addChartEmbed(noteId, ticker) {
  const attrs = buildWidgetEmbedAttrs('chart', { symbol: ticker }, { mode: 'live' })
  const res = await fetch(`/api/j2/notes/${noteId}/embeds`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attrs }),
  })
  if (!res.ok) {
    let detail = null
    try {
      const body = await res.json()
      detail = typeof body?.detail === 'string' ? body.detail : null
    } catch {
      // non-JSON body — fall back to the bare status
    }
    throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`)
  }
  const data = await res.json()
  return data.note?.bodyJson || null
}

/**
 * Reverses one `addChartEmbed` call. `bodyJsonAfterAppend` must be exactly
 * what that call returned — dropping its OWN last content node restores the
 * note to its pre-enrichment state, regardless of how many other embeds the
 * note already carried.
 */
export async function revertChartEmbed(noteId, bodyJsonAfterAppend) {
  const content = Array.isArray(bodyJsonAfterAppend?.content) ? bodyJsonAfterAppend.content : []
  const restored = { ...bodyJsonAfterAppend, content: content.slice(0, -1) }
  const res = await fetch(`/api/j2/notes/${noteId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bodyJson: restored }),
  })
  if (!res.ok) throw new Error(`could not undo (HTTP ${res.status})`)
}
