// Shared live-price store.
//
// PROBLEM it solves: every component that called useLivePrices(tickers) spun
// its own SWR key + its own 2s poll of /api/live-prices. On a dashboard with
// several live tiles (each passing a different ticker subset) that's N
// independent 2s pollers hammering the endpoint with overlapping tickers.
//
// FIX: one global, ref-counted ticker registry + a SINGLE 2s poll of the UNION
// of all subscribed tickers. Components subscribe via useLivePrices and read
// their own slice. N polls -> 1. Preserves the old behavior that mattered:
// mobile interval ×2, and pause polling while the tab is hidden.
//
// Deliberately plain module state (not React context) so any component can use
// useLivePrices with zero provider wiring, exactly as before.

const _refcounts = new Map() // ticker -> number of live subscribers
let _prices = {} // latest { SYM: { price, change_pct, day_open, ... } }
const _listeners = new Set() // React re-render callbacks
let _timer = null
let _inflight = false
let _pollAgain = false // a poll was requested while one was in-flight (union grew)

const _isMobile =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth <= 640)
const _intervalMs = () => (_isMobile ? 4000 : 2000) // mirrors useMobileSWR ×2 on mobile

function _union() {
  return [...new Set(_refcounts.keys())].filter(Boolean).sort()
}

function _emit() {
  for (const l of _listeners) l()
}

async function _poll() {
  // If a poll is already running, mark that another is wanted (e.g. the union
  // just grew) and re-run once it finishes — so newly-added tickers populate
  // immediately instead of waiting a full interval.
  if (_inflight) {
    _pollAgain = true
    return
  }
  if (typeof document !== 'undefined' && document.hidden) return // paused when hidden
  const tickers = _union()
  if (tickers.length === 0) return
  _inflight = true
  // Bound the request. WITHOUT this, a fetch that never settles — OS sleep/wake or a
  // Wi-Fi switch tears down the socket mid-flight, or the backend hangs — leaves the
  // `await` pending forever, so `_inflight` never clears and EVERY app-wide quote
  // freezes until a manual refresh. The AbortController guarantees the promise
  // settles (rejects) so `finally` always runs.
  const _ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  const _timeout = _ac ? setTimeout(() => { try { _ac.abort() } catch { /* noop */ } }, 10000) : null
  try {
    const r = await fetch(`/api/live-prices?tickers=${tickers.join(',')}`, _ac ? { signal: _ac.signal } : undefined)
    if (r.ok) {
      const next = (await r.json()) || {}
      // MERGE, don't wholesale-replace. A poll that momentarily omits a ticker
      // (Massive timeout / partial batch) or returns a degraded entry (no real
      // price) must NOT wipe the last-good value — that's what made every quote
      // flash to 0.00% and the after-hours "Post" price vanish every few minutes.
      // We keep the last-good entry for anything missing/degraded and only apply
      // entries that carry a real price (the WHOLE prior entry — incl. its ext /
      // after-hours price — is preserved when this poll's entry is degraded).
      const merged = { ..._prices }
      for (const sym in next) {
        const nv = next[sym]
        if (!nv || typeof nv !== 'object') continue
        const price = Number(nv.price)
        if (!Number.isFinite(price) || price <= 0) continue // degraded → keep last-good
        const prev = merged[sym]
        // Preserve the after-hours "Post" price if this poll momentarily dropped it
        // while nothing actually traded (identical price) — Massive intermittently
        // omits lastTrade on the weekend / after hours. A real new session MOVES the
        // price, so this never pins a stale ext once regular trading resumes.
        if (prev && nv.ext_price == null && prev.ext_price != null && price === Number(prev.price)) {
          merged[sym] = { ...nv, ext_price: prev.ext_price, ext_session: prev.ext_session }
        } else {
          merged[sym] = nv
        }
      }
      _prices = merged
      _emit()
    }
  } catch {
    // transient (network blip / brief restart / timeout-abort) — keep last prices, retry next tick
  } finally {
    if (_timeout) clearTimeout(_timeout)
    _inflight = false
    if (_pollAgain) {
      _pollAgain = false
      _poll()
    }
  }
}

function _startTimer() {
  if (_timer != null) return
  _timer = setInterval(_poll, _intervalMs())
}

function _stopTimer() {
  if (_timer != null) {
    clearInterval(_timer)
    _timer = null
  }
}

// Pause polling while the tab is hidden; resume (and fetch immediately) on return.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _stopTimer()
    } else if (_refcounts.size > 0) {
      _poll()
      _startTimer()
    }
  })
}

/** Register interest in a list of tickers. Returns an unregister fn. */
export function registerTickers(tickers) {
  let grew = false
  for (const t of tickers) {
    if (!_refcounts.has(t)) grew = true
    _refcounts.set(t, (_refcounts.get(t) || 0) + 1)
  }
  if (_refcounts.size > 0) _startTimer()
  if (grew) _poll() // new ticker(s) — populate fast instead of waiting a full interval
  return function unregister() {
    for (const t of tickers) {
      const c = (_refcounts.get(t) || 0) - 1
      if (c <= 0) _refcounts.delete(t)
      else _refcounts.set(t, c)
    }
    if (_refcounts.size === 0) {
      _stopTimer()
      _prices = {}
      _emit()
    }
  }
}

export function subscribe(listener) {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

export function getSnapshot() {
  return _prices
}

export function pollNow() {
  _poll()
}

// Test-only reset hook.
export function __resetForTest() {
  _refcounts.clear()
  _prices = {}
  _listeners.clear()
  _stopTimer()
  _inflight = false
  _pollAgain = false
}
