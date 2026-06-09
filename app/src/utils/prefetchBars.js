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
import { idbGet, idbPut } from './barsIDB'
import { memHas, memPut } from './barsMemCache'

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

// ── Durable (IndexedDB) prefetch ─────────────────────────────────────────────
// prefetchBars (above) warms only SWR's IN-MEMORY cache, which is wiped on every
// page reload — so after a HARD REFRESH every chart re-fetches and the user waits
// again. This variant writes the bars into IndexedDB (the SAME store StockChart
// paints from), so once a ticker is warmed it loads INSTANTLY on every subsequent
// visit/refresh, permanently (until the IDB cache-logic version bumps).
//
// Efficient by construction: IDB is keyed by (sym, tf), NOT by year — daily bars
// are identical regardless of which calendar year frames them, so a ticker that
// appears in many Model Book years is warmed ONCE. Already-warm tickers are
// skipped (no fetch). The fetch goes through SWR `preload`, so it DEDUPES with
// prefetchBars' fetch of the same URL (one network request feeds both caches).
// Bounded + idle-deferred so it never starves the chart the user is viewing.
const _idbQueue = []
let _idbActive = 0
const _IDB_MAX = 3
const _idbSeen = new Set()
let _idbKick = null

function _idbPump() {
  while (_idbActive < _IDB_MAX && _idbQueue.length) {
    const job = _idbQueue.shift()
    _idbActive++
    _idbWarmOne(job).finally(() => { _idbActive--; _idbPump() })
  }
}

async function _idbWarmOne({ sym, tf }) {
  try {
    const have = await idbGet(sym, tf)
    if (have?.bars?.length) return                 // already durable — no fetch
    const json = await preload(_url(sym, tf), fetcher)  // dedupes with prefetchBars
    // Prefetch URLs carry no `since`, so the response is always a full (non-delta)
    // set — exactly what StockChart's own D/W/M full-fetch path writes to IDB.
    if (json?.bars?.length && !json.delta) {
      await idbPut(sym, tf, json.bars)
      memPut(sym, tf, json.bars)   // also warm the synchronous mem cache
    }
  } catch { /* best-effort; the chart's own fetch remains the source of truth */ }
}

function _idbKickSoon() {
  if (_idbKick) return
  const go = () => { _idbKick = null; _idbPump() }
  if (typeof requestIdleCallback === 'function') _idbKick = requestIdleCallback(go, { timeout: 2000 })
  else _idbKick = setTimeout(go, 1000)
}

// Warm a list of tickers' bars into IndexedDB for instant, refresh-proof loads.
export function prefetchBarsToIDB(tickers, tf = 'D') {
  if (!tickers?.length) return
  for (const sym of tickers) {
    if (!sym) continue
    const key = `${sym}_${tf}`
    if (_idbSeen.has(key)) continue           // in-flight/recent — don't pile up
    _idbSeen.add(key)
    setTimeout(() => _idbSeen.delete(key), 60000)
    _idbQueue.push({ sym, tf })
    prefetchTickerMeta(sym)
  }
  _idbKickSoon()
}

// ── Intent prefetch (hover / keyboard focus) ─────────────────────────────────
// Warms mem + IDB + SWR for ONE timeframe on hover/focus so the eventual click
// paints instantly. Debounced (so brushing across a list doesn't fire), and a
// no-op when the (sym, tf) is already in the synchronous mem cache. Current-TF
// only — selection still calls prefetchAllTimeframes for the rest.
const _intentTimers = new Map()

async function _warmIntentNow(sym, tf) {
  if (memHas(sym, tf)) return
  try {
    const json = await preload(_url(sym, tf), fetcher) // dedupes + warms SWR cache
    if (json?.bars?.length && !json.delta) {
      memPut(sym, tf, json.bars)
      await idbPut(sym, tf, json.bars)                 // durable too
    }
  } catch { /* best-effort; the chart's own fetch remains source of truth */ }
}

export function prefetchBarOnIntent(sym, tf = 'D', { delay = 120 } = {}) {
  if (!sym || !tf) return
  if (memHas(sym, tf)) return
  const key = `${String(sym).toUpperCase()}_${tf}`
  if (_intentTimers.has(key)) return // debounce: a fire is already pending
  const t = setTimeout(() => {
    _intentTimers.delete(key)
    _warmIntentNow(sym, tf)
  }, delay)
  _intentTimers.set(key, t)
  prefetchTickerMeta(sym)
}
