// Notebook widgets: the fetch and the refresh merge (Task 7), split out of notebookWidgets.js in Task 16D.
//
// ⛔ NOT ON THE FIRST OPEN. Only lazy code imports this file statically (SnapshotFrame, TickerCardPopover);
// the / menu loads it when a snapshot command runs (SlashMenu.snapshotCommand). Keep it that way: an eager
// import here puts every byte below back on the Notebook's first open.

export const WIDGETS_URL = '/api/j2/notebook-widgets'

/** The query keys the endpoint passes to its builder. A refresh re-asks with the SAME ones. */
export const REQUEST_KEYS = Object.freeze(['symbol', 'list', 'from', 'to'])

/** The member's own words when the app is offline, and when a refresh fails (Global Constraints). */
export const OFFLINE_SENTENCE = "You're offline. This shows the saved snapshot."
export const REFRESH_FAILED_SENTENCE = "Couldn't refresh. The saved snapshot is unchanged."

const LIST_FROM_LABEL = { Watchlist: 'watchlist', Flagged: 'flagged' }

/** The request a stored snapshot was made with, read back from its params. The explicit request
 *  keys win; otherwise they are recovered from what the payload recorded (`listLabel`, `range`),
 *  because the node's params are normalized through the registry schema at insert. */
export function requestParamsOf(params) {
  const p = params && typeof params === 'object' ? params : {}
  const out = {}
  for (const k of REQUEST_KEYS) {
    if (typeof p[k] === 'string' && p[k]) out[k] = p[k]
  }
  if (!out.list && LIST_FROM_LABEL[p.listLabel]) out.list = LIST_FROM_LABEL[p.listLabel]
  if (p.range && typeof p.range === 'object') {
    if (!out.from && typeof p.range.from === 'string' && p.range.from) out.from = p.range.from
    if (!out.to && typeof p.range.to === 'string' && p.range.to) out.to = p.range.to
  }
  return out
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** One widget payload. Never throws: `{ok: true, payload}` or `{ok: false, reason}` with
 *  reason `offline` (no request made), `unavailable` (a 404: unknown or gated off) or `failed`. */
export async function fetchWidgetPayload(kind, params = {}) {
  if (isOffline()) return { ok: false, reason: 'offline' }
  try {
    const q = new URLSearchParams()
    for (const k of REQUEST_KEYS) {
      const v = params?.[k]
      if (typeof v === 'string' && v) q.set(k, v)
    }
    const qs = q.toString()
    const res = await fetch(`${WIDGETS_URL}/${encodeURIComponent(String(kind))}${qs ? `?${qs}` : ''}`, {
      credentials: 'include',
    })
    if (res.status === 404) return { ok: false, reason: 'unavailable' }
    if (!res.ok) return { ok: false, reason: 'failed' }
    const payload = await res.json()
    if (!payload || typeof payload !== 'object' || typeof payload.asOf !== 'string') {
      return { ok: false, reason: 'failed' }
    }
    return { ok: true, payload }
  } catch {
    return { ok: false, reason: isOffline() ? 'offline' : 'failed' }
  }
}

/** The params a refresh writes: the new payload, the request keys the old snapshot was made
 *  with, and the member's own `share` switch (a refresh never publishes or unpublishes). */
export function refreshParams(oldParams, payload) {
  const old = oldParams && typeof oldParams === 'object' ? oldParams : {}
  const next = { ...(payload && typeof payload === 'object' ? payload : {}) }
  for (const k of REQUEST_KEYS) {
    if (old[k] !== undefined) next[k] = old[k]
  }
  next.share = old.share === true
  return next
}

/** The sentence a failed refresh shows. */
export const refreshFailureText = (reason) => (reason === 'offline' ? OFFLINE_SENTENCE : REFRESH_FAILED_SENTENCE)
