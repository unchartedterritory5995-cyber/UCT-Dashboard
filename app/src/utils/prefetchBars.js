// Prefetch bar data into SWR cache for instant chart loading.
// Uses full bar counts matching StockChart's request so SWR cache keys align.
//
// CRITICAL: prefetches must NEVER compete with the chart the user is actively
// loading. Previously prefetchAllTimeframes fired all 8 timeframes × 5000 bars
// at once (and TickerPopup did it on every hover), so selecting/scanning a list
// launched ~8-14 concurrent cold 3-4s fetches that saturated the server's
// upstream pool and starved the clicked chart → 10-15s loads. Everything now
// funnels through a SHARED, DEFERRED, BOUNDED queue: at most _MAX_CONCURRENT
// background prefetches, started only after a short idle delay so the visible
// chart's own SWR fetch wins first.
import { preload } from 'swr'
import { prefetchTickerMeta } from '../hooks/useTickerMeta'

const fetcher = url => fetch(url).then(r => r.json())

// Must match StockChart's barCount so SWR cache keys align (else prefetch is wasted).
const BAR_COUNTS = { 1: 5000, 5: 5000, 15: 5000, 30: 5000, 60: 5000, D: 8000, W: 8000, M: 5000 }
const ALL_TFS = ['D', 'W', 'M', '60', '30', '15', '5', '1']

// ── Shared bounded/deferred prefetch queue ───────────────────────────────────
const _queue = []
let _active = 0
const _MAX_CONCURRENT = 2 // keep the server's pool free for the active chart
const _seen = new Set() // short-window dedupe so re-hover/re-select doesn't pile up
let _kick = null

function _pump() {
  while (_active < _MAX_CONCURRENT && _queue.length) {
    const url = _queue.shift()
    _active++
    Promise.resolve(preload(url, fetcher)).finally(() => {
      _active--
      _pump()
    })
  }
}

function _kickSoon() {
  if (_kick) return
  const go = () => {
    _kick = null
    _pump()
  }
  // Defer so the visible chart's fetch goes first; idle callback when available.
  if (typeof requestIdleCallback === 'function') _kick = requestIdleCallback(go, { timeout: 1500 })
  else _kick = setTimeout(go, 800)
}

function _enqueue(url, priority = false) {
  const at = _queue.indexOf(url)
  if (at >= 0) {                 // already queued — promote to front if now urgent
    if (priority && at > 0) { _queue.splice(at, 1); _queue.unshift(url) }
    return
  }
  if (_seen.has(url) && !priority) return  // recently done; priority re-allows a jump
  _seen.add(url)
  setTimeout(() => _seen.delete(url), 30000) // allow a fresh prefetch after 30s
  if (priority) _queue.unshift(url)          // front of line (year the user just opened)
  else _queue.push(url)
  _kickSoon()
}

function _url(sym, tf) {
  return `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${BAR_COUNTS[tf] ?? 5000}`
}

// Prefetch a list of tickers for a specific timeframe (e.g. visible list rows).
// `priority` jumps them to the front of the shared queue — e.g. the year the user
// just switched to, so its charts warm before the background catalog trickle.
export function prefetchBars(tickers, tf = 'D', { priority = false } = {}) {
  if (!tickers?.length) return
  for (const sym of tickers) {
    if (!sym) continue
    _enqueue(_url(sym, tf), priority)
    prefetchTickerMeta(sym)
  }
}

// Prefetch a single ticker for one timeframe (hover). ONE request, not eight.
export function prefetchBar(sym, tf = 'D') {
  if (!sym) return
  _enqueue(_url(sym, tf))
  prefetchTickerMeta(sym)
}

// Prefetch all timeframes for a selected ticker so TF-tab switches are instant.
// Bounded + deferred via the shared queue, so it trickles in the background and
// never blocks the chart that's currently loading.
export function prefetchAllTimeframes(sym) {
  if (!sym) return
  prefetchTickerMeta(sym)
  for (const tf of ALL_TFS) _enqueue(_url(sym, tf))
}
