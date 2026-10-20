// Notebook widgets Task 16: the one bounded read every slash capture makes.
//
// A /charts widget's "Send to Journal" freezes what the widget had fetched. A Notebook slash insert
// fetches the SAME endpoints itself (captures/<kind>Capture.js), through this helper, so a slow or
// dead answer can never hang the editor and nothing here ever throws.
import { PREFERENCE_DEFAULTS, PREFS_URL } from '../../../../hooks/usePreferences'

export const CAPTURE_TIMEOUT_MS = 10000

export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** A failed capture, in the words snapshotCommand reads: `offline` or `failed`. */
export const captureFailure = () => ({ ok: false, reason: isOffline() ? 'offline' : 'failed' })

/** `fetch` with the capture timeout: for a widget fetcher that takes its own fetch (fetchSnapshot), so its
 *  check-and-parse stays the widget's own while a dead answer still cannot hang the editor. Rejects on timeout. */
export function boundedFetch(url, init = {}, { timeoutMs = CAPTURE_TIMEOUT_MS } = {}) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  return fetch(url, { ...init, ...(ctl ? { signal: ctl.signal } : {}) })
    .finally(() => { if (timer) clearTimeout(timer) })
}

/** GET a JSON answer. Never throws: `{ok: true, status, data}` or `{ok: false, status}` (0 = no answer). */
export async function getJson(url, { timeoutMs = CAPTURE_TIMEOUT_MS } = {}) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
  try {
    const res = await fetch(url, { credentials: 'include', ...(ctl ? { signal: ctl.signal } : {}) })
    if (!res || !res.ok) return { ok: false, status: res?.status || 0 }
    return { ok: true, status: res.status, data: await res.json() }
  } catch {
    return { ok: false, status: 0 }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** The member's preferences as usePreferences serves them: DEFAULTS underneath, and a refused
 *  read served as the defaults alone (the hook's own behaviour, so a widget and a slash insert
 *  resolve the same look from the same answer). */
export async function readPreferences() {
  const r = await getJson(PREFS_URL)
  const data = r.ok && r.data && typeof r.data === 'object' ? r.data : {}
  return { ...PREFERENCE_DEFAULTS, ...data }
}

/** ET wall-clock "h:mm AM/PM" for a fetch instant, or null. */
export function fmtEtTime(ms) {
  try {
    return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
  } catch { return null }
}

/** The "h:mm AM/PM ET" stamp a frozen widget's footer reads, for a fetch instant. */
export const etStamp = (ms) => `${fmtEtTime(ms)} ET`

/** The live quotes for some symbols, as the shared live-price store keeps them: an entry only when it
 *  carries a real price (finite, above 0), so a degraded quote reads as no quote. Asked in chunks of
 *  250, the server's own cap. A failed read is no quotes, never a failed capture. Never throws. */
export async function readLivePrices(symbols) {
  const syms = [...new Set((symbols || []).map((s) => String(s || '').toUpperCase()).filter(Boolean))]
  const out = {}
  for (let i = 0; i < syms.length; i += 250) {
    const r = await getJson(`/api/live-prices?tickers=${syms.slice(i, i + 250).join(',')}`)
    if (!r.ok || !r.data || typeof r.data !== 'object') continue
    for (const [sym, q] of Object.entries(r.data)) {
      if (q && typeof q === 'object' && Number(q.price) > 0 && Number.isFinite(Number(q.price))) out[sym] = q
    }
  }
  return out
}
