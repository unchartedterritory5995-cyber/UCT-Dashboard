// S13.6 remainder (audit 2026-11-05, "Hidden gems"): the Model Book reference from inside a note.
//
// `/modelbook NVDA` (and Insert > Model Book) stores the SAME reference the Model Book's "Save to Notebook"
// stores for a stock with no setup selected: year + symbol + the captured title (modelbook/notebookCapture.js
// `buildModelBookCapture`). The year is the stock's most recent Model Book year, read from
// `GET /api/modelbook/appearances/{symbol}` -- the per-ticker research tab's own read (useModelBookAppearances).
// The card itself then re-renders from the Model Book store, exactly as a capture from the page does.
//
// ⛔ NO VENDOR CALL: the appearances list is the curated Model Book store.
// ⛔ NOT IN THE MODEL BOOK IS SAID, never inserted as a tombstone: a reference to nothing would read as
// "this entry was removed" (ModelBookEmbed), which is false.
import { buildModelBookCapture } from '../../../modelbook/notebookCapture'
import { getJson, isOffline, captureFailure } from './captureFetch'

/** The most recent appearance (highest year), or null. */
export function latestAppearance(body) {
  const rows = Array.isArray(body?.appearances) ? body.appearances : []
  return rows.filter((a) => Number.isInteger(Number(a?.year)))
    .reduce((best, a) => (!best || Number(a.year) > Number(best.year) ? a : best), null)
}

/** The slash insert. Never throws. */
export async function slashCapture(params = {}) {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const symbol = String(params.symbol || '').trim().toUpperCase()
  if (!symbol) return { ok: false, reason: 'failed' }
  const res = await getJson(`/api/modelbook/appearances/${encodeURIComponent(symbol)}`)
  if (!res.ok) {
    if (res.status === 402) return { ok: false, message: 'The Model Book needs a paid plan, so nothing was added.' }
    return captureFailure()
  }
  const hit = latestAppearance(res.data)
  if (!hit) return { ok: false, message: `${symbol} is not in the Model Book, so nothing was added.` }
  const payload = buildModelBookCapture({ year: Number(hit.year), symbol })
  return payload ? { ok: true, payload } : captureFailure()
}
