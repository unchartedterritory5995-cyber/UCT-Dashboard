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
import { FIRST_PAINT_BARS, fullBarsFor } from './barsBackfill'

const fetcher = url => fetch(url).then(r => r.json())

// Viewport-first: prefetch only the shallow first-paint window. Deep history is
// fetched lazily by StockChart's backfill when the user actually pans into it,
// so warming need not pull 5000-8000 bars per ticker/TF. Keeps the SWR cache key
// (bars=FIRST_PAINT_BARS) aligned with the chart's cold fetch.
const BAR_COUNTS = {
  1: FIRST_PAINT_BARS, 5: FIRST_PAINT_BARS, 15: FIRST_PAINT_BARS,
  30: FIRST_PAINT_BARS, 60: FIRST_PAINT_BARS,
  D: FIRST_PAINT_BARS, W: FIRST_PAINT_BARS, M: FIRST_PAINT_BARS,
}
// Common TFs first (Daily, 5min) so those switches warm first; 5min was last-ish
// before, making "click 5min" a cold fetch while other TFs were already warm.
const ALL_TFS = ['D', '5', '60', '30', '15', 'W', 'M', '1']

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

// Warm a WHOLE list across every timeframe users scan, into durable IDB, so
// scrolling the list is instant on ANY timeframe — not just the pre-warmed daily.
//
// Why this exists: daily scans smooth because D/W/M are warm in IDB, but intraday
// TFs (60/30/15/5) were fetched on-DEMAND per ticker switch → the "lag on 5min/
// hourly" while scanning. The backend worker already caches 60/30/15 for the
// active set (watchlists / theme holdings), so warming those into the browser is
// mostly fast cache-hits; 5m is the only cold one. Everything rides the SAME
// bounded (3-concurrent) idle-deferred IDB queue, so it never competes with the
// chart the user is actively loading, and already-warm (sym,tf) pairs skip their
// fetch. Capped so a huge watchlist can't flood the queue.
const SCAN_WARM_TFS = ['D', '5', '60', '30', '15']
const SCAN_WARM_CAP = 100
export function prefetchListAllTimeframes(tickers, { tfs = SCAN_WARM_TFS, cap = SCAN_WARM_CAP } = {}) {
  if (!tickers?.length) return
  const list = [...new Set(tickers.filter(Boolean))].slice(0, cap)
  if (!list.length) return
  for (const tf of tfs) prefetchBarsToIDB(list, tf)
}

// Multi-Chart grid warm: like prefetchListAllTimeframes but covers ALL 8 TFs
// (SCAN_WARM_TFS omits W/M/1). Rides the SAME bounded (3-concurrent) idle-deferred
// IDB queue, so 16 cells × 8 TFs = 128 jobs drain ≤3 at a time — a strict subset
// of the watchlist warm's envelope. Already-warm (sym,tf) pairs skip their fetch.
export const GRID_WARM_TFS = ['D', '5', '60', '30', '15', 'W', 'M', '1']
export function prefetchGridWarm(tickers) {
  prefetchListAllTimeframes(tickers, { tfs: GRID_WARM_TFS })
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

// ── IDB → mem promotion (no network) ─────────────────────────────────────────
// StockChart paints a ticker switch on the FIRST render only when the sync mem
// cache has the (sym, tf) — its memPeek fallback. The durable warmers above
// deliberately skip memPut for already-IDB-warm tickers, so while arrow-key
// scanning a warmed list every switch still paid the async idbGet hop (~2-3
// React commits + IDB latency = the perceptible "pop" delay). This promotes
// already-durable bars straight into mem for a small window of tickers (the
// scan neighbors) so the next press paints in the same frame. Zero network.
//
// Staleness: mirrors StockChart's idbStaleIntraday gate — an intraday entry
// whose newest bar is older than max(6 tf-periods, 20min) is NOT promoted,
// because the chart itself refuses to paint it (it full-refetches instead);
// promoting it would flash an old session mid-scan. D/W/M always promote.
const _INTRADAY_TFS = new Set(['1', '5', '15', '30', '60'])
function _memPromoteFresh(tf, lastT) {
  if (!_INTRADAY_TFS.has(String(tf))) return true
  if (typeof lastT !== 'number') return false
  const tfSec = Math.max(60, (Number(tf) || 5) * 60)
  return (Date.now() / 1000 - lastT) <= Math.max(6 * tfSec, 20 * 60)
}

export function warmMemFromIDB(tickers, tfs = SCAN_WARM_TFS) {
  if (!tickers?.length) return
  for (const sym of tickers) {
    if (!sym) continue
    for (const tf of tfs) {
      if (memHas(sym, tf)) continue        // already hot — pure no-op per press
      idbGet(sym, tf).then(entry => {
        if (entry?.bars?.length && !memHas(sym, tf) && _memPromoteFresh(tf, entry.lastT)) {
          memPut(sym, tf, entry.bars)
        }
      }).catch(() => { /* best-effort accelerator; IDB stays the fallback */ })
    }
  }
}

// ── Deep-history prefetch (SWR + server-cache warm) ──────────────────────────
// The warmers above cover only the shallow first-paint window (FIRST_PAINT_BARS).
// DEEP history — the pre-2024 tail you see when a Weekly/Monthly chart is zoomed
// out — is fetched on-DEMAND by StockChart's dwell-warm/backfill at
// bars=fullBarsFor(tf), a COLD server build that takes seconds the first time.
// This warms that exact deep URL through SWR `preload` so (a) the server disk-
// caches the deep set (shared across users, durable ~48h for D/W/M) and (b)
// StockChart's own deep fetch becomes an instant SWR cache hit — the deep history
// is already loaded by the time the user scrolls into it.
//
// Written to BOTH the server/SWR cache AND IndexedDB. StockChart's cold D/W/M fetch
// used to truncate a deep IDB entry back to the first-paint window on open, but it
// now PRESERVES a deeper IDB history (mergeDelta-heals the recent tail instead of
// replacing), so a pre-warmed deep entry paints the full pre-2024 history INSTANTLY
// on the first render — no dwell, no cold deep fetch. Separate bounded queue (big
// payloads) so it never starves the active chart.
const _deepQueue = []
let _deepActive = 0
const _DEEP_MAX = 2
const _deepSeen = new Set()
let _deepKick = null

function _deepUrl(sym, tf) {
  return `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${fullBarsFor(tf)}`
}
async function _deepWarmOne(sym, tf) {
  try {
    const target = fullBarsFor(tf)
    const have = await idbGet(sym, tf)
    // Already deep enough in IDB → nothing to do (a short-history name never
    // reaches `target`, but the 5-min _deepSeen window keeps it from re-fetching).
    if (have?.bars?.length >= target * 0.9) return
    const json = await preload(_deepUrl(sym, tf), fetcher) // dedupes + warms SWR + server
    if (json?.bars?.length && !json.delta) {
      await idbPut(sym, tf, json.bars)   // durable: the click paints deep from IDB
      memPut(sym, tf, json.bars)
    }
  } catch { /* best-effort; the chart's own dwell-warm remains the fallback */ }
}
function _deepPump() {
  while (_deepActive < _DEEP_MAX && _deepQueue.length) {
    const { sym, tf } = _deepQueue.shift()
    _deepActive++
    _deepWarmOne(sym, tf).finally(() => { _deepActive--; _deepPump() })
  }
}
function _deepKickSoon() {
  if (_deepKick) return
  const go = () => { _deepKick = null; _deepPump() }
  if (typeof requestIdleCallback === 'function') _deepKick = requestIdleCallback(go, { timeout: 2500 })
  else _deepKick = setTimeout(go, 1200)
}

// Zoomed-out TFs first (W/M are cheap — a few thousand bars — and are exactly the
// user's complaint), Daily last (12500 bars, the big payload).
const DEEP_WARM_TFS = ['W', 'M', 'D']
const DEEP_WARM_CAP = 120
export function prefetchListDeep(tickers, { tfs = DEEP_WARM_TFS, cap = DEEP_WARM_CAP } = {}) {
  if (!tickers?.length) return
  const list = [...new Set(tickers.filter(Boolean))].slice(0, cap)
  if (!list.length) return
  // TF-outer: warm ALL symbols' cheap W (then M, then D) before the expensive D
  // pass, so the zoomed-out history the user asked about is ready first.
  for (const tf of tfs) {
    for (const sym of list) {
      const key = `${sym}_${tf}`
      if (_deepSeen.has(key)) continue
      _deepSeen.add(key)
      setTimeout(() => _deepSeen.delete(key), 300000) // 5-min re-warm window
      _deepQueue.push({ sym, tf })
    }
  }
  for (const sym of list) prefetchTickerMeta(sym)
  _deepKickSoon()
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
    // IDB-first: a durable, fresh-enough entry promotes to mem with zero
    // network — the hover/focus click then paints same-frame. Only a cold or
    // stale-intraday miss pays the fetch.
    const have = await idbGet(sym, tf)
    if (have?.bars?.length && _memPromoteFresh(tf, have.lastT)) {
      memPut(sym, tf, have.bars)
      return
    }
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
