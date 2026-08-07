// app/src/hooks/useIndicatorAlerts.js
// SWR hook + helpers for chart indicator alerts.
// Talks to /api/indicator-alerts (see api/routers/indicator_alerts.py).
//
// ⛔ WHICH INDICATORS THOSE ARE IS NOT WRITTEN DOWN HERE. This line used to read
// "(RSI / MACD / BB / Stoch / Williams%R / CCI / MFI / Price-vs-MA)" and it went
// stale the moment B5 made the other six definitions alertable — a comment that
// enumerates is a twin like any other, it just cannot be tested. The catalog is
// served: `GET /api/indicator-alerts/catalog`, derived from the module that
// evaluates. An alert now names a PLOT ADDRESS (`adx.plusDI`, `ichimoku.tenkan`),
// with the bare form kept for the eight that shipped before it.
import useSWR, { mutate } from 'swr'
import { useAuth } from '../context/AuthContext'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : { alerts: [] }))

const KEY = '/api/indicator-alerts'
const CATALOG_KEY = '/api/indicator-alerts/catalog'

/** ⚠️ THROWS on a bad response, unlike `fetcher` above.
 *
 *  The alerts fetcher answers a failed request with `{alerts: []}` — for a LIST
 *  that is the same shape as "you have none", and the difference does not
 *  matter. For the CATALOG it is the whole safety argument: a swallowed failure
 *  would render an empty-but-enabled dropdown, which is indistinguishable from a
 *  catalog that genuinely offers nothing and lets a user submit an alert with no
 *  indicator. SWR only populates `error` if the fetcher rejects. */
const catalogFetcher = async (url) => {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`catalog ${r.status}`)
  const body = await r.json()
  if (!Array.isArray(body?.catalog)) throw new Error('catalog: malformed response')
  return body.catalog
}

export function useIndicatorAlerts() {
  const { user } = useAuth()
  const { data, error, isLoading } = useSWR(user ? KEY : null, fetcher, {
    refreshInterval: 30000,
    dedupingInterval: 10000,
  })
  const alerts = Array.isArray(data?.alerts) ? data.alerts : []
  return {
    alerts,
    isLoading: isLoading && !data && !error,
    refresh: () => mutate(KEY),
  }
}

/**
 * What the alert dropdown may offer, served by the module that EVALUATES it.
 *
 * ⛔ NO FALLBACK LIST. `IndicatorAlertPopover.jsx` used to hand-write the eight
 * indicators and their condition map; that literal was a TWIN of the evaluator's
 * `INDICATOR_FUNCS` and the two had already drifted (a `vwap` alert could be
 * created and could never fire). Re-introducing the list as a "safe default"
 * would restore the twin AND hide it, because a fallback only shows when the
 * fetch fails — i.e. exactly when nobody is looking.
 *
 * So: loading offers NOTHING, an error SAYS SO, and both are asserted.
 *
 * ⚠️ A signed-out user is reported as LOADING, not as an error. SWR is passed a
 * null key then, so it reports neither, and "offer nothing, disable submit" is
 * the safe reading of that state.
 *
 * @returns {{catalog: Array, isLoading: boolean, error: any}}
 */
export function useIndicatorAlertCatalog() {
  const { user } = useAuth()
  const { data, error, isLoading } = useSWR(user ? CATALOG_KEY : null, catalogFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 300000,
  })
  return {
    catalog: Array.isArray(data) ? data : [],
    isLoading: !user || (isLoading && !data && !error),
    error: error || null,
  }
}

/**
 * Arm an alert — and say what happened.
 *
 * ⛔ IT USED TO SWALLOW EVERY NON-OK RESPONSE AND RETURN `null`, so the create
 * path's carefully-written 400s — the price-alias routing message, the "not an
 * indicator this chart can evaluate" refusal, and `refusal_for`'s three
 * "this could never fire" gates — reached NOBODY. The user clicked Add Alert,
 * the label flickered, and nothing appeared. Measured 2026-08-06 against a real
 * 400: the returned value carried no part of the message and the popover
 * rendered zero `role="alert"` nodes.
 *
 * That was the exact inverse of the decision one function above, where the
 * CATALOG fetcher was deliberately made to THROW because a swallowed failure is
 * invisible.
 *
 * ⛔ THE MESSAGE IS THE SERVER'S, NEVER A PARAPHRASE OF IT. A client-side
 * restatement of a refusal is a second source of truth for one decision, and
 * the two rot apart the first time the backend rewords a gate. The only
 * sentences written here are the two the server cannot supply: a transport
 * failure (it never answered) and a refusal whose body is unreadable.
 *
 * ⚠️ `detail` IS ONLY USED WHEN IT IS A STRING. FastAPI answers a
 * schema-invalid body with `detail: [{loc, msg, type}, …]`; interpolating that
 * would show the user "[object Object]", which is worse than the silence it
 * replaces.
 *
 * @returns {Promise<{ok: true, id: number|null} | {ok: false, error: string}>}
 *          — never null, on any branch. Callers read `.ok` unconditionally.
 */
export async function createIndicatorAlert(payload) {
  let r
  try {
    r = await fetch(KEY, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // ⛔ A TRANSPORT FAILURE AND A REFUSAL NEED DIFFERENT WORDS. One is "try
    // again", the other is "this alert can never fire". The same sentence for
    // both sends the user to the wrong fix — retrying forever on a structurally
    // mute alert, or abandoning one that would have worked on the next attempt.
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
  }
  if (r.ok) {
    mutate(KEY)
    let id = null
    try { id = (await r.json())?.id ?? null } catch { /* a body-less 200 is still an accepted alert */ }
    return { ok: true, id }
  }
  let detail = ''
  try {
    const body = await r.json()
    if (typeof body?.detail === 'string') detail = body.detail
  } catch { /* not JSON — an HTML error page, or an empty body */ }
  return { ok: false, error: detail || `The server refused this alert (${r.status}).` }
}

/**
 * ⭐ SPEC §8: *"threshold prefilled from current value"*.
 *
 * What this plot reads RIGHT NOW on this symbol and timeframe, from the module
 * that EVALUATES it — never a second compute in the browser. A prefill computed
 * here would suggest a number the alert would not agree with, on the one screen
 * where the two are compared.
 *
 * ⚠️ RESOLVES TO `null` ON EVERY FAILURE, INCLUDING "not enough bars". That is
 * the honest answer for a cold symbol and it renders as the empty box the user
 * already had; a thrown error here would break the form for a missing
 * convenience.
 *
 * @returns {Promise<number|null>}
 */
export async function fetchCurrentValue({ sym, tf, indicator, params }) {
  if (!sym || !tf || !indicator) return null
  const q = new URLSearchParams({ sym, tf, indicator })
  if (params && Object.keys(params).length) q.set('params', JSON.stringify(params))
  try {
    const r = await fetch(`${KEY}/current-value?${q.toString()}`, { credentials: 'include' })
    if (!r.ok) return null
    const body = await r.json()
    return Number.isFinite(body?.value) ? body.value : null
  } catch {
    return null
  }
}

export async function deleteIndicatorAlert(id) {
  try {
    await fetch(`${KEY}/${id}`, { method: 'DELETE', credentials: 'include' })
    mutate(KEY)
  } catch {
    // ignore
  }
}

export async function toggleIndicatorAlert(id) {
  try {
    const r = await fetch(`${KEY}/${id}/toggle`, { method: 'POST', credentials: 'include' })
    mutate(KEY)
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}
