// Notebook widgets Task 16: the Watchlist capture, ONE builder for both doors.
//
// The Watchlists table's "Send <list> to Journal" and the Notebook's `/watchlist` insert both build the
// frozen list here: the names with their notes and the price and move as they stood. The slash insert
// takes the member's DEFAULT list: the first of their own lists that holds names, in the order the
// Watchlists table lists them (the flagged list is not one of them; the server keeps it apart).
import { getJson, isOffline, captureFailure, readLivePrices } from './captureFetch'

/** The member's OWN lists (no admin-curated index lists, which on the admin account come back as "his"),
 *  with their items, newest-updated first. */
export const MY_LISTS_URL = '/api/watchlists?include_prebuilt=0'

/** The frozen list. Pure: every name in list order, its note, and its quote when one stood. */
export function buildWatchlistCapture({ watchKey, watchName, items }, { prices }) {
  const rows = items.map((it) => {
    const sym = typeof it === 'string' ? it : it.sym
    const q = prices[sym]
    return {
      sym,
      ...(typeof it === 'object' && it.notes ? { note: it.notes } : {}),
      ...(Number.isFinite(q?.price) ? { price: q.price } : {}),
      ...(Number.isFinite(q?.change_pct) ? { chgPct: q.change_pct } : {}),
    }
  })
  return { watchKey, watchName, symbols: rows.map((r) => r.sym), rows }
}

/** The sentence a slash insert shows when the member has no list with names in it. */
export const NO_LIST_MESSAGE = 'You have no watchlist with names in it yet, so nothing was added.'

/** The default list and live quotes for its names. A failed read inserts nothing; a failed quote read
 *  leaves the prices off the rows, as the table shows them. Never throws. */
export async function fetchWatchlistCaptureData() {
  if (isOffline()) return { ok: false, reason: 'offline' }
  const res = await getJson(MY_LISTS_URL)
  if (!res.ok || !Array.isArray(res.data)) return captureFailure()
  const wl = res.data.find((l) => Array.isArray(l?.items) && l.items.length > 0)
  if (!wl) return { ok: false, reason: 'empty', message: NO_LIST_MESSAGE }
  const prices = await readLivePrices(wl.items.map((it) => (typeof it === 'string' ? it : it.sym)))
  return { ok: true, data: { watchKey: wl.id, watchName: wl.name, items: wl.items }, prices }
}

/** The slash insert: fetch, then build the capture the list's Send to Journal would build. */
export async function slashCapture() {
  const res = await fetchWatchlistCaptureData()
  if (!res.ok) return res
  return { ok: true, payload: buildWatchlistCapture(res.data, { prices: res.prices }) }
}
