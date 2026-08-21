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
import { idbGet, idbPut, mergeDelta } from './barsIDB'
import { memHas, memPut } from './barsMemCache'
import { FIRST_PAINT_BARS, fullBarsFor } from './barsBackfill'
import { isDailyTailStale } from './marketSession'

const fetcher = url => fetch(url).then(r => r.json())

// ── Cold-start flood guard ───────────────────────────────────────────────────
// On a genuinely fresh browser the universe pack is still downloading + ingesting
// into IndexedDB (the ~120MB D/W/M pack takes ~30-60s). During that window,
// BACKGROUND list-warming (theme-tracker holdings, watchlist, grid) must NOT fall
// through to an ORIGIN /api/bars fetch on an IDB miss.
//
// ⚰️ THE WOUND, measured in a fresh-user HAR 2026-08-21: the widgets warmed ~212
// holdings × 5 timeframes = ~600 origin /api/bars while the pack was still
// ingesting the SAME tickers. Those obscure names (water utils, uranium miners,
// leveraged ETFs) were cold on the SERVER too → 245 shed as 503, 55 took 10-20s,
// and the flood STARVED the visible chart (SPY's first request 503'd; it took ~45s
// and 4 retries to paint) and skipped the developing-bar heals (charts missing
// today's candle). Racing the pack to the origin for the very tickers it's about to
// deliver is pure self-inflicted load.
//
// So while the pack hasn't stamped its version, background warms are IDB-PROMOTE-
// ONLY (no network). The pack fills those tickers into IDB; the visible chart's own
// SWR fetch is separate and unaffected; once the pack ingests (barspack.version
// stamped) warming resumes normally for the genuine long tail. A returning user
// (version already stamped) is never gated.
export function _packStillIngesting() {
  try { return !localStorage.getItem('barspack.version') } catch { return false }
}

// ── Server backpressure — OBEY the 503 shed signal ───────────────────────────
// The pack-ingest gate above only covers the first ~30s. The bigger wound (fresh-
// user HAR 2026-08-21, on the fix build): as a user SCANS, each theme/watchlist
// warms its holdings' charts, and for cold long-tail names the server SHEDS with
// 503 (`{error:"warming"}`, Retry-After) to protect its pool. The warm queue was
// IGNORING that and hammering ~200 more cold fetches on top → 260 × 503 + daily
// deep fetches at 20-23s that STARVED the visible chart. The server literally says
// "back off" and the client didn't listen.
//
// So every background warm result is fed to `_noteWarmResult`: a 503/"warming"
// escalates an exponential backoff (3s→30s cap); a real success resets it. While
// backed off, ALL background warm queues HOLD (the visible chart's own SWR fetch is
// separate and never gated). This makes the warmer self-regulating — it stops
// flooding the instant the server is stressed and resumes as it recovers, so a cold
// long-tail can never again drown the chart the user is looking at.
let _warmBackoffUntil = 0
let _warmBackoffMs = 0
export function _noteWarmResult(json) {
  const shed = json == null || json.error === 'warming' || json.error === 'transient'
  if (shed) {
    _warmBackoffMs = Math.min(_warmBackoffMs ? _warmBackoffMs * 2 : 3000, 30000)
    _warmBackoffUntil = Date.now() + _warmBackoffMs
  } else if (json && Array.isArray(json.bars)) {
    _warmBackoffMs = 0            // genuine data → server healthy, clear the throttle
    _warmBackoffUntil = 0
  }
  return json
}
// Background warms HOLD while the pack is still ingesting OR the server is shedding.
export function _holdBackgroundWarm() {
  return _packStillIngesting() || Date.now() < _warmBackoffUntil
}
// Warm fetcher: reports the HTTP status a plain `.json()` would hide, so a 503 shed
// drives the backoff even though its body parses fine. Shares the URL with the
// chart's own SWR key, so `preload` still dedupes one network request across both.
const warmFetcher = url => fetch(url).then(r =>
  r.status === 503 ? { bars: [], error: 'warming' } : r.json()
)

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
  // Hold ALL SWR list-warming (theme tracker holdings, Breadth drill lists,
  // ModelBook, Screener) while the pack is ingesting OR the server is shedding — it
  // must never race the pack or pile onto a stressed origin. The warm is best-effort
  // in-memory only (wiped on reload); the pack fills IDB, the visible chart's own
  // SWR fetch is separate, and a click fetches its one chart. A pending kick retries
  // once the hold lifts (backoff window or pack-stamp), so nothing is lost forever.
  if (_holdBackgroundWarm()) { if (_queue.length) _kickSoon(); return }
  while (_active < _MAX_CONCURRENT && _queue.length) {
    if (_holdBackgroundWarm()) { _kickSoon(); return }
    const url = _queue.shift()
    _active++
    Promise.resolve(preload(url, warmFetcher)).then(_noteWarmResult).finally(() => {
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

// Replay Mode: warm every intraday timeframe for a chosen cutoff date so switching TF in
// replay is INSTANT. Each request hits the backend's `?to=` replay path, which fetches the
// (capped) pre-cutoff window ONCE and persists it to bars.db — so by the time the user clicks
// 5m/1m the data is already stored server-side and serves from SQLite with no cold fetch.
// Priority-queued (the user just entered replay and will click a TF within seconds) and
// deduped server-side by (sym,tf,to). Fire this the moment a replay cutoff is set.
// `warm=1` makes each request BEST-EFFORT server-side: if the pod is busy it skips the
// provider fetch (the on-demand click will fetch it) so warming can never starve the chart
// the user is waiting on. 1-min is left out (heaviest, rarely the first click) — it fetches
// on demand if clicked.
const REPLAY_WARM_TFS = ['5', '15', '30', '60']
export function prefetchReplayTimeframes(sym, cutoffIso, { bars = 4000 } = {}) {
  if (!sym || !cutoffIso) return
  for (const tf of REPLAY_WARM_TFS) {
    _enqueue(`/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}&to=${encodeURIComponent(cutoffIso)}&warm=1`, false)
  }
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
  // Hold + retry (don't drain) while the pack is ingesting or the server is shedding,
  // so durable IDB warms survive the hold and resume once it lifts.
  if (_holdBackgroundWarm()) { if (_idbQueue.length) _idbKickSoon(); return }
  while (_idbActive < _IDB_MAX && _idbQueue.length) {
    if (_holdBackgroundWarm()) { _idbKickSoon(); return }
    const job = _idbQueue.shift()
    _idbActive++
    _idbWarmOne(job).finally(() => { _idbActive--; _idbPump() })
  }
}

async function _idbWarmOne({ sym, tf }) {
  try {
    const have = await idbGet(sym, tf)
    // A DAILY entry missing recent sessions is NOT fresh: the chart's daily
    // staleness gate refuses to paint it, so leaving it here is what makes the
    // NEXT click cold-load on a black screen. Refresh it so scanning keeps the
    // daily cache current and the click paints instantly. (Intraday is already
    // handled: idbGet returns null for a stale-intraday entry → `have` is null.)
    const staleDaily = tf === 'D' && have?.bars?.length && isDailyTailStale(have.lastT)
    if (have?.bars?.length && !staleDaily) return  // already durable + fresh — no fetch
    // Don't race the pack to origin, and don't pile onto a shedding server (see
    // _holdBackgroundWarm). The pack is writing these tickers into IDB; a click
    // meanwhile fetches its ONE chart via SWR. Warming resumes when the hold lifts.
    if (_holdBackgroundWarm()) return
    const json = _noteWarmResult(await preload(_url(sym, tf), warmFetcher))
    if (json?.bars?.length && !json.delta) {
      // On a stale-daily refresh, PRESERVE any deeper history already in IDB and
      // heal only the recent tail (fresh wins on overlap) — idbPut REPLACES, so a
      // bare shallow write would truncate a deep-warmed series back to ~600 bars.
      const next = (staleDaily && have?.bars?.length > json.bars.length)
        ? mergeDelta(have.bars, json.bars)
        : json.bars
      await idbPut(sym, tf, next)
      memPut(sym, tf, next)   // also warm the synchronous mem cache
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
//
// Options:
//   priority  — put these at the FRONT of the queue (and pull any already-queued
//               copies forward), so a group the user just opened warms before the
//               background catalog trickle. Preserves caller order at the head.
//   immediate — start the pump NOW instead of waiting for the idle callback. Use
//               only when a click on this exact set is imminent (e.g. a theme just
//               expanded) — the chart being left is already loaded, so the burst
//               competes with no active cold fetch.
export function prefetchBarsToIDB(tickers, tf = 'D', { priority = false, immediate = false } = {}) {
  if (!tickers?.length) return
  const front = []
  for (const sym of tickers) {
    if (!sym) continue
    const key = `${sym}_${tf}`
    const at = _idbQueue.findIndex(j => j.sym === sym && j.tf === tf)
    if (at >= 0) {                              // already queued
      if (priority && at > 0) front.push(_idbQueue.splice(at, 1)[0]) // jump the line
      continue
    }
    if (_idbSeen.has(key) && !priority) continue // in-flight/recent — don't pile up
    if (!_idbSeen.has(key)) { _idbSeen.add(key); setTimeout(() => _idbSeen.delete(key), 60000) }
    if (priority) front.push({ sym, tf })
    else _idbQueue.push({ sym, tf })
    prefetchTickerMeta(sym)
  }
  if (front.length) _idbQueue.unshift(...front) // caller order, at the head
  if (immediate) _idbPump()                      // a click on this set is imminent
  else _idbKickSoon()
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
  // Daily: reject a tail missing recent sessions (mirrors the chart's gate — a
  // stale daily promoted to mem would just be suppressed, or flash old data).
  if (String(tf) === 'D') return !isDailyTailStale(lastT)
  if (!_INTRADAY_TFS.has(String(tf))) return true   // W/M always promote
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
const _deepQueue = []   // [{ sym, tf, key }]
let _deepActive = 0
const _DEEP_MAX = 3
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
    // Deep history (bars=12500) is the HEAVIEST fetch and produced the 20-23s cold
    // stalls in the HAR — never race the pack with it, and never pile it onto a
    // shedding server. Holds during pack-ingest OR while backed off (_holdBackgroundWarm).
    if (_holdBackgroundWarm()) return
    const json = _noteWarmResult(await preload(_deepUrl(sym, tf), warmFetcher)) // dedupes + warms SWR + server
    if (json?.bars?.length && !json.delta) {
      await idbPut(sym, tf, json.bars)   // durable: the click paints deep from IDB
      memPut(sym, tf, json.bars)
    }
  } catch { /* best-effort; the chart's own dwell-warm remains the fallback */ }
}
function _deepPump() {
  if (_holdBackgroundWarm()) { if (_deepQueue.length) _deepKickSoon(); return }
  while (_deepActive < _DEEP_MAX && _deepQueue.length) {
    if (_holdBackgroundWarm()) { _deepKickSoon(); return }
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

// DAILY FIRST — it's the timeframe the chart is actually showing, so warming it before
// the zoomed-out W/M is what makes the NEXT ticker's history instant. (Warming W/M first
// left daily — what's on screen — as the LAST ~240 jobs in the queue, which is why a few
// stragglers were still cold. W/M follow daily now.)
const DEEP_WARM_TFS = ['D', 'W', 'M']
const DEEP_WARM_CAP = 120
export function prefetchListDeep(tickers, { tfs = DEEP_WARM_TFS, cap = DEEP_WARM_CAP, priority = false } = {}) {
  if (!tickers?.length) return
  const list = [...new Set(tickers.filter(Boolean))].slice(0, cap)
  if (!list.length) return
  // Build the batch in TF-outer order (Daily first). `priority` (on-screen rows) pulls
  // it — and any of these already queued behind the background trickle — to the FRONT,
  // preserving order, so what the user is about to click warms before the top-N tail.
  const batch = []
  for (const tf of tfs) {
    for (const sym of list) {
      const key = `${sym}_${tf}`
      const at = _deepQueue.findIndex((j) => j.key === key)
      if (at >= 0) {
        if (priority) batch.push(_deepQueue.splice(at, 1)[0])   // re-front an already-queued job
        continue
      }
      if (_deepSeen.has(key) && !priority) continue
      if (!_deepSeen.has(key)) { _deepSeen.add(key); setTimeout(() => _deepSeen.delete(key), 300000) }
      batch.push({ sym, tf, key })
    }
  }
  if (batch.length) (priority ? _deepQueue.unshift(...batch) : _deepQueue.push(...batch))
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
      // Preserve deeper history on a stale-daily refresh (see _idbWarmOne).
      const staleDaily = tf === 'D' && have?.bars?.length && isDailyTailStale(have.lastT)
      const next = (staleDaily && have?.bars?.length > json.bars.length)
        ? mergeDelta(have.bars, json.bars)
        : json.bars
      memPut(sym, tf, next)
      await idbPut(sym, tf, next)                       // durable too
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
