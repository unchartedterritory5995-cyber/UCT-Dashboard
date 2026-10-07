// app/src/components/chart/engine/marketCapAuthorityStore.js
//
// ─── THE CHART'S MARKET CAP AUTHORITY: ONE SWITCH, SERVER-SIDE ───────────────
//
// ⭐ The member chart reads Market Cap from `/api/marketcap/pit/{ticker}` only
// while the SERVER says the authority is live. There is no client flag: the
// first chart that needs Market Cap asks `/api/marketcap/pit-status` once.
//   200  -> the authority is ON for this session; series come from it
//   404  -> MCAP_PIT_ENABLED is unset (the route does not exist): OFF, forever
//           for this page load -- the legacy composer is untouched
//   401 / 403 -> not this viewer's data: OFF, the legacy path unchanged
//   else (503: ON but unverifiable, network) -> NOT COMPUTABLE, asked again
//           after RETRY_MS (never a hot loop, never the legacy methodology)
// So the cutover is ONE server variable (web), and so is the rollback.
//
// ⛔ A CHART WITH NO Market Cap SOURCE COSTS NOTHING: nothing here runs until
// `ensureMarketCap` is called with a symbol.
//
// ⛔ ONE BUILD AT A TIME: series are cached by the authority cache under
// (build_id, ticker); the moment a response names another build, every series
// of the old build is dropped here too, so a chart never mixes two builds.
import { createMarketCapAuthorityCache } from './marketCapAuthorityClient'

const RETRY_MS = 5 * 60_000
const PENDING = Object.freeze(new Map())

export function createMarketCapAuthorityStore({ fetchImpl, now = () => Date.now(), revalidateMs } = {}) {
  const cache = createMarketCapAuthorityCache({ fetchImpl, now, revalidateMs })
  let mode = 'unknown'                // 'unknown' | 'probing' | 'on' | 'off' | 'off-final'
  let retryAt = 0
  let build = null
  const points = new Map()            // ticker -> [[date, usd], ...] | null (authority has no series)
  const inflight = new Set()
  const listeners = new Set()
  const notify = () => { for (const fn of listeners) fn() }

  async function probe() {
    mode = 'probing'
    try {
      const r = await fetchImpl('/api/marketcap/pit-status', { headers: {}, credentials: 'include' })
      if (r.status === 200) mode = 'on'
      else if (r.status === 404 || r.status === 401 || r.status === 403) mode = 'off-final'
      else { mode = 'off'; retryAt = now() + RETRY_MS }
    } catch {
      mode = 'off'
      retryAt = now() + RETRY_MS
    }
    notify()
  }

  async function load(sym) {
    inflight.add(sym)
    try {
      const body = await cache.series(sym)
      if (cache.build() !== build) {
        points.clear()
        build = cache.build()
      }
      points.set(sym, body && Array.isArray(body.points) ? body.points : null)
    } catch {
      // unavailable: not cached, the chart keeps "not computable" for this symbol
    } finally {
      inflight.delete(sym)
      notify()
    }
  }

  /**
   * Map(sym -> points) of what is loaded, or null when the authority is OFF
   * (the caller then keeps the legacy path). While the status probe is in
   * flight the answer is PENDING (an empty map: not computable) -- never null,
   * which would paint the legacy composer for a moment after a cutover.
   * Starts whatever is missing.
   */
  function ensureMarketCap(symbols) {
    if (mode === 'off-final') return null
    if (mode === 'off' && now() >= retryAt) mode = 'unknown'
    if (mode === 'unknown') { probe(); return PENDING }
    if (mode === 'probing' || mode === 'off') return PENDING   // ON but unavailable: not computable, never legacy
    for (const s of symbols) {
      const sym = String(s || '').toUpperCase()
      if (sym && !points.has(sym) && !inflight.has(sym)) load(sym)
    }
    return points
  }

  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  return { ensureMarketCap, subscribe, mode: () => mode, build: () => build }
}

let _shared = null
/** The app's one store (window.fetch). */
export function marketCapAuthority() {
  if (!_shared) {
    _shared = createMarketCapAuthorityStore({
      fetchImpl: (url, init) => window.fetch(url, init),
    })
  }
  return _shared
}
