// app/src/hooks/useIndicatorAlerts.js
// SWR hook + helpers for chart indicator alerts (RSI / MACD / BB / Stoch / Williams%R / CCI / MFI / Price-vs-MA).
// Talks to /api/indicator-alerts (see api/routers/indicator_alerts.py).
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

export async function createIndicatorAlert(payload) {
  try {
    const r = await fetch(KEY, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (r.ok) {
      mutate(KEY)
      return await r.json()
    }
  } catch {
    // swallow; UI will reflect failure via SWR cache
  }
  return null
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
