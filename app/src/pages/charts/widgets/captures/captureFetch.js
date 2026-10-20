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
