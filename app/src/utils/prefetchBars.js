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
import { SWRGlobalState, cache as _swrCache } from 'swr/_internal'
import { prefetchTickerMeta } from '../hooks/useTickerMeta'
import { idbGet as _idbGetRaw, idbPutMonotonic as _idbPutMono } from './barsIDB'
import { memHas as _memHasRaw, memPutMonotonic as _memPutMono, memPeek as _memPeekRaw, memPeekSavedAt as _memPeekSavedAtRaw } from './barsMemCache'
import { seriesCacheTf, barsSessionQuery, barsGridQuery } from '../components/chart/barTime'
import { setViewShowExtended } from './viewSession'
import { FIRST_PAINT_BARS, firstPaintBarsFor, fullBarsFor } from './barsBackfill'
import { isDailyTailStale, isDailyTodayCloseProvisionalForPaint, dailyCachePaintVerdict, classifyIntradayTail, isCacheCurrentForView } from './marketSession'
import { getTodayBar, todayPackUsable } from '../lib/todayPackClient'

// ⛔ D10 (2026-11-10): a non-OK body is NOT data. `r.json()` on a 404/429/500 handed the
// error body ({detail:…}) to the caller as if it were bars. Both fetchers now throw the
// same tagged error StockChart's own fetcher throws (`status`, `warming`, `retryAfterMs`).
const fetcher = url => _chartLaneFetch(url)

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
// ⭐ THE ROWS ON SCREEN DO NOT WAIT FOR THE WHOLE UNIVERSE (2026-10-17). A first visit's
// pack ingest takes well over a minute (measured on production: 5,151 of ~11,000 daily
// keys stored after 90 s, version not yet stamped), and for all of it the list the member
// is flipping through stayed cold -- 12 of a 32-row screen in IDB after 90 s -- so every
// ArrowDown past the first rows waited on its own fetch and a fast walk painted nothing.
// A job marked `visible` (the top rows of a list on screen, `prewarmVisibleList`'s
// `memTop`) is held ONLY by the server's 503 backoff, never by the pack: a few dozen
// first-paint requests at <=3 concurrency, the names the pack would deliver anyway, only
// sooner. Everything else keeps the full hold.
function _holdJob(job) {
  return job?.visible ? Date.now() < _warmBackoffUntil : _holdBackgroundWarm()
}
// Warm fetcher: reports the HTTP status a plain `.json()` would hide, so a 503 shed
// drives the backoff even though its body parses fine. Shares the URL with the
// chart's own SWR key, so `preload` still dedupes one network request across both.
const warmFetcher = url => _chartLaneFetch(url)

// ── ONE warm request per URL, and NOTHING LEFT BEHIND ───────────────────────
// ⛔⛔ SWR's `preload` keeps its promise until a hook WITH THAT EXACT KEY consumes it,
// and a second `preload` of the same key returns the FIRST promise. A `&warm=1` URL is
// never a hook key, so its first answer was replayed to every later warm of that URL
// for the whole session — a warm at 10:00 re-wrote 10:00's bars into mem/IDB at 15:00.
// The intraday chart no longer consumes string-key preloads either (StockChart keys its
// primary fetch per load), so every warm promise is dropped from the preload table as
// soon as it settles; an IN-FLIGHT warm is still joinable through `joinPendingBars`.
const _pendingBars = new Map()   // url -> raw promise (rejects on a non-OK answer)
function _dropPreload(url, req) {
  try {
    const st = SWRGlobalState.get(_swrCache)
    const P = st && st[3]
    if (P && P[url] === req) delete P[url]
  } catch { /* SWR internals unavailable → nothing to drop */ }
}
function _warmRaw(url, f = warmFetcher) {
  const have = _pendingBars.get(url)
  if (have) return have
  const req = Promise.resolve(preload(url, f))
  _pendingBars.set(url, req)
  const done = () => { if (_pendingBars.get(url) === req) _pendingBars.delete(url); _dropPreload(url, req) }
  req.then(done, done)
  return req
}
/** The warm answer as a VALUE: data on success, an error SHAPE (never bars) on failure. */
async function _warmLoad(url, f = warmFetcher) {
  try { return await _warmRaw(url, f) } catch (e) {
    if (e?.status === 503 || e?.warming) return { bars: [], error: 'warming' }
    return { error: 'http', status: e?.status ?? null }
  }
}
/** An in-flight warm of exactly `url`, or null. Never a settled (possibly old) answer. */
// ⭐ (W-L 2026-11-11) …AND A TAIL REQUEST JOINS ITS BACKGROUND TWIN. The scan warm repairs a
// row with `<chart url>&since=X&warm=1`; the chart reaching that row a moment later asks
// `<chart url>&since=X` — the same rows. It joins the in-flight warm instead of sending a
// duplicate. (The caller must fall back to its own request if the joined warm is shed.)
export function joinPendingBars(url) {
  const u = String(url)
  return _pendingBars.get(u) || (/[?&]since=/.test(u) ? _pendingBars.get(`${u}&warm=1`) : null) || null
}

// Viewport-first: prefetch only the shallow first-paint window. Deep history is
// fetched lazily by StockChart's backfill when the user actually pans into it,
// so warming need not pull 5000-8000 bars per ticker/TF. Keeps the SWR cache key
// (bars=FIRST_PAINT_BARS) aligned with the chart's cold fetch.
// ⛔⛔ THIS MUST TRACK `firstPaintBarsFor` EXACTLY. The alignment noted above is
// not a nicety — `bars=` is part of the SWR cache key AND of the server's
// `bars_{sym}_{tf}_{n}` key, so a prefetch that warms a DIFFERENT count than the
// chart requests warms a key the chart never reads: every intraday prefetch
// becomes pure cost (a provider fetch, a store write, browser bandwidth) and the
// chart still opens cold. Derive it; never restate the number.
// ⚠️ RTH mode (the default) is assumed: warming is speculative and has no user
// session setting to read, and the RTH budget is the LARGER of the two, so an
// extended-hours viewer reads a warm superset rather than a cold miss.
// ⛔⛔ (2026-11-10) …AND "RTH IS ASSUMED" WAS THE MISMATCH. With EXT on the chart asks
// `firstPaintBarsFor(tf, true)` (5m: bars=600) while this warmed bars=1152, so for an
// extended-hours viewer every intraday warm filled a server key + URL the chart never
// requested. The chart now TELLS the warmer its session (`setPrefetchShowExtended`).
let _prefetchShowExtended = false
export function setPrefetchShowExtended(on) { _prefetchShowExtended = !!on; setViewShowExtended(on) }
// ⭐ (2026-11-10) …AND THE SESSION DECIDES WHICH 60m SERIES A WARM FILLS. With EXT on the
// chart reads the clock-grid 60m under its own cache key ('60e', `seriesCacheTf`) and
// asks `&session=eth`; a warm must fill THAT key with THAT series. Every cache call in
// this module goes through these wrappers so no site can write one grid under the
// other's key. Other tfs map to themselves (one key across sessions).
function _ck(tf) { return seriesCacheTf(tf, _prefetchShowExtended) }
function idbGet(sym, tf) { return _idbGetRaw(sym, _ck(tf)) }
// ⛔ (W-L 2026-11-11, review of #1095) EVERY WRITE IN THIS MODULE IS MONOTONIC. A warmer
// reads, awaits the network, then writes — and the chart may have written a NEWER series
// under the same key in between. `_land` merges into what is stored NOW (barsIDB
// `mergeMonotonic`: never an older tail, never shallower), in IDB and in mem.
async function _land(sym, k, bars, { delta = false, savedAt, startedAt = null } = {}) {
  const stored = await _idbPutMono(sym, k, bars, { delta, startedAt })
  const opts = savedAt === undefined ? { startedAt } : { savedAt, startedAt }
  const inMem = stored?.length ? _memPutMono(sym, k, stored, opts) : _memPutMono(sym, k, bars, { ...opts, delta })
  return stored?.length ? stored : inMem
}
function _promote(sym, k, bars, savedAt) { return _memPutMono(sym, k, bars, { savedAt: savedAt ?? null }) }
function idbPut(sym, tf, bars) { return _idbPutMono(sym, _ck(tf), bars) }
function memHas(sym, tf) { return _memHasRaw(sym, _ck(tf)) }
function memPut(sym, tf, bars, opts) { return _memPutMono(sym, _ck(tf), bars, opts) }
function memPeek(sym, tf) { return _memPeekRaw(sym, _ck(tf)) }
function memPeekSavedAt(sym, tf) { return _memPeekSavedAtRaw(sym, _ck(tf)) }
// The chart's own URL tail: `&session=` on intraday (StockChart's `_primaryBase` adds
// the same, so a warm and the chart's request are ONE SWR key / one in-flight join).
function _sessQ(tf) { return barsSessionQuery(tf, _prefetchShowExtended) }
// ⛔⛔ THE WARMERS ASK THE CHART'S QUESTION, NOT A PRIVATE COPY OF IT (W-L 2026-11-11).
// "Is this cache current for the view?" is `isCacheCurrentForView` in marketSession — the
// SAME call StockChart's mem/IDB paint gates make — with the view's session. The private
// copy that stood here asked the RTH question for an extended-hours chart, so a cache the
// chart refused was "warm" here: promoted, never repaired, and every switch waited on the
// network. One function, so the warmer and the painter cannot disagree again.
function _paintSession() { return _prefetchShowExtended ? 'extended' : 'rth' }
function _paintCurrent(lastT, tf, bars = null) {
  return isCacheCurrentForView(bars, lastT, tf, { session: _paintSession() })
}
// ⛔ THE KEY IS PINNED PER JOB, NEVER RE-READ AT WRITE TIME (#1061 review F3). A job
// decides its cache key ONCE (`_ck` at its start, or from the URL it was queued with)
// and writes only under that key — and only when the SERVER's answer is on that key's
// grid (`session: 'eth'` is stamped on every clock-grid 60m answer). Toggling EXT while
// a 60m warm is in flight can then never land one grid under the other's key.
function _urlCk(url, tf) {
  if (String(tf) !== '60') return String(tf)
  return /[?&]session=eth(?:&|$)/.test(String(url)) ? '60e' : '60'
}
function _gridOk(k, json) {
  if (k !== '60' && k !== '60e') return true
  return (json?.session === 'eth') === (k === '60e')
}
const _INTRADAY_COUNT_TFS = new Set(['1', '5', '15', '30', '60'])
function _barsFor(tf) {
  if (_INTRADAY_COUNT_TFS.has(String(tf))) return firstPaintBarsFor(String(tf), _prefetchShowExtended)
  return ({ D: FIRST_PAINT_BARS, W: FIRST_PAINT_BARS, M: FIRST_PAINT_BARS })[tf] ?? 5000
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

// URLs the caller flagged `urgent` (see prefetchBars). They may run while the
// COLD-START pack-ingest hold is on (the fresh-browser window where every
// ArrowDown otherwise cold-fetches), but they stay in the SAME bounded queue,
// respect _MAX_CONCURRENT, and still obey the server's 503 backoff.
// ⛔ An urgent job warms THE CHART'S key: `_url(sym, tf, false)` (no `&warm=1`,
// exactly what StockChart reads) AND lands the bars in mem + IDB the way
// `_warmIntentNow` does. Filling only the `&warm=1` SWR key would leave the next
// row cold, because StockChart never reads that key.
const _urgent = new Map() // chart-key URL -> { sym, tf }
const _urgentRunning = new Set() // `${sym}_${tf}` of urgent jobs in flight
export const URGENT_MAX_PER_CALL = 2
function _startFetch(url) {
  _active++
  const meta = _urgent.get(url)
  _urgent.delete(url)
  const running = meta ? `${meta.sym}_${meta.tf}` : null
  if (running) _urgentRunning.add(running)
  const job = meta ? _fillUrgent(url, meta.sym, meta.tf) : _warmLoad(url).then(_noteWarmResult)
  job.catch(() => { /* best-effort */ }).finally(() => {
    if (running) _urgentRunning.delete(running)
    _active--
    _pump()
  })
}
async function _fillUrgent(url, sym, tf) {
  const k = _urlCk(url, tf)   // the key this URL's answer belongs to
  if (_memUsable(sym, tf)) return
  let have = null
  try { have = await _idbGetRaw(sym, k) } catch { /* IDB unavailable: fetch instead */ }
  if (have?.bars?.length && _memPromoteFresh(tf, have.lastT, have.savedAt, have.bars)) { _promote(sym, k, have.bars, have.savedAt); return }
  const startedAt = Date.now()
  const json = _noteWarmResult(await _warmLoad(url))
  // Merged into what is stored now — which also keeps a deeper daily history (the
  // stale-daily heal used to special-case that).
  if (json?.bars?.length && !json.delta && _gridOk(k, json)) await _land(sym, k, json.bars, { startedAt })
}
function _drainUrgentWhileHeld() {
  if (Date.now() < _warmBackoffUntil) return // server shedding: nobody goes
  for (let i = 0; i < _queue.length && _active < _MAX_CONCURRENT;) {
    const url = _queue[i]
    if (_urgent.has(url)) { _queue.splice(i, 1); _startFetch(url) } else i++
  }
}

function _pump() {
  // Hold ALL SWR list-warming (theme tracker holdings, Breadth drill lists,
  // ModelBook, Screener) while the pack is ingesting OR the server is shedding — it
  // must never race the pack or pile onto a stressed origin. The warm is best-effort
  // in-memory only (wiped on reload); the pack fills IDB, the visible chart's own
  // SWR fetch is separate, and a click fetches its one chart. A pending kick retries
  // once the hold lifts (backoff window or pack-stamp), so nothing is lost forever.
  // BarStore lane (barsLaneRequest): urgent + grid requests go BEFORE the warm queue,
  // background ones only once it is empty. No waiter ⇒ both calls are no-ops.
  _drainLane(LANE_RANK.grid)
  if (_holdBackgroundWarm()) { _drainUrgentWhileHeld(); if (_queue.length) _kickSoon(); return }
  while (_active < _MAX_CONCURRENT && _queue.length) {
    if (_holdBackgroundWarm()) { _drainUrgentWhileHeld(); _kickSoon(); return }
    _startFetch(_queue.shift())
  }
  if (!_queue.length) _drainLane(LANE_RANK.background)
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

// Urgent enqueue for ONE (sym, tf). Chart-key URL; deliberately skips anything
// already in mem or fetched/queued in the last 30s (`_seen`) so a held key is not
// re-fetched on every ArrowDown. Pumps on the next microtask, never idle-deferred.
function _enqueueUrgent(sym, tf) {
  if (_memUsable(sym, tf)) return
  const url = _url(sym, tf, false)
  _urgent.set(url, { sym, tf })
  // The same symbol may already sit in the queue under its background `&warm=1`
  // URL (e.g. FocusScreener's top-30 warm): drop it, the urgent job replaces it.
  const bg = _url(sym, tf, true)
  const bi = _queue.indexOf(bg)
  if (bi >= 0) _queue.splice(bi, 1)
  const at = _queue.indexOf(url)
  if (at >= 0) {
    if (at > 0) { _queue.splice(at, 1); _queue.unshift(url) }
  } else {
    if (_seen.has(url)) { _urgent.delete(url); return }
    _seen.add(url)
    setTimeout(() => _seen.delete(url), 30000)
    _queue.unshift(url)
  }
}

export function _url(sym, tf, warm = true) {
  // warm=1 marks a best-effort BACKGROUND prefetch so the server de-prioritizes it under
  // load (it sheds a fast 503 rather than starving the chart the user actually clicked).
  // IDB warming is keyed by (sym,tf), not the URL, so the extra param never breaks it.
  // The hover/focus intent-warm passes warm=false so it isn't shed AND its SWR-cache key
  // matches the visible chart's (no `&warm`), letting the imminent click paint from cache.
  return `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${_barsFor(tf)}${_sessQ(tf)}${warm ? '&warm=1' : ''}`
}

// The native intraday codes. Declared ABOVE its first use on purpose: this file
// has already produced one temporal-dead-zone crash class in this project, and a
// module-scope `const` referenced from a function defined earlier is only safe
// while nothing calls that function during module init — a property that is easy
// to break and invisible until it throws.
const _INTRADAY_TFS = new Set(['1', '5', '15', '30', '60'])

// ── REPAIR COOLDOWN ─────────────────────────────────────────────────────────
// ⛔⛔ WITHOUT THIS, THE FIX IS A REQUEST STORM. `prefetchBarsToIDB` deliberately
// BYPASSES the `_idbSeen` skip when `priority` is set (`if (_idbSeen.has(key) &&
// !priority) continue`) so an imminent click can jump the queue — which means
// `useNeighborWarm` re-enqueues all ±6 neighbours on EVERY selection. That was
// free while a behind cache returned early doing nothing; now each one would
// issue a tail fetch, so a fast scan would multiply into ~12 requests per click.
//
// ⭐ THE INTERVAL IS THE TIMEFRAME'S OWN BUCKET, NOT A PICKED NUMBER. A repaired
// cache cannot become stale again faster than one bar can close, so repairing a
// given (sym, tf) more than once per bucket cannot buy a single fresher bar — it
// is pure traffic. 60s floor so 1m does not repair every minute of a long scan.
// ⭐ (W-L 2026-11-11) Keyed by the CACHE KEY AND THE VIEW SESSION — an RTH repair says
// nothing about whether the extended view is current — and a repair the server did not
// ANSWER (shed / failed) gives its slot back (`_repairFailed`), so one 503 at the open no
// longer blocks that row's repair for a whole bucket.
const _repairAt = new Map()   // `${sym}_${cacheKey}_${session}` -> ms of last repair attempt
function _repairKey(sym, tf) { return `${sym}_${_ck(tf)}_${_paintSession()}` }
function _repairFailed(key, at) { if (_repairAt.get(key) === at) _repairAt.delete(key) }
function _repairCooldownOk(sym, tf) {
  const key = _repairKey(sym, tf)
  const now = Date.now()
  const gap = Math.max(60_000, (Number(tf) || 5) * 60_000)
  const last = _repairAt.get(key)
  if (last != null && now - last < gap) return false
  _repairAt.set(key, now)
  // Bounded: a long scanning session must not grow this map without limit.
  if (_repairAt.size > 400) {
    for (const [k, t] of _repairAt) { if (now - t > gap) _repairAt.delete(k) }
  }
  return true
}

/** @internal test seam — a fresh cooldown table per case. */
export function _resetRepairCooldown() { _repairAt.clear() }

// The TAIL-REPAIR url: every row past the cache's newest bar, nothing before it.
// `warm=1` keeps it shed-able under load exactly like the full warm — a repair is
// still a background nicety and must never outrank the chart the member clicked.
function _sinceUrl(sym, tf, lastT) {
  return `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${_barsFor(tf)}${_sessQ(tf)}`
       + `&since=${encodeURIComponent(String(Math.max(0, lastT - 1)))}&warm=1`
}

// ── PREPARE ONE SYMBOL FOR DISPLAY, AND SAY WHAT HAPPENED ───────────────────
//
// ⛔⛔ THE BLIND TIMER THIS REPLACES WAS THE ORIGINAL DEFECT POSTPONED. The
// handoff used to commit the new symbol after a flat 600ms whatever the state
// of its data — so a symbol that never prepared got committed anyway, StockChart
// received it with `bars` null, the empty-bars arm fired, and the member got
// B's header over a black canvas. "Timed out" was being reported as success.
//
// ⭐⭐ AND THERE IS A CASE NEITHER "current" NOR "stale" DESCRIBES. A HALTED or
// thinly-traded symbol legitimately has no print since 10:00. Its cache is not
// behind the market — it IS the market for that symbol. Rejecting it forever
// (there is no newer bar to wait for) and calling it stale are both wrong. Once
// we have ASKED the server with `since=` and been told there is nothing newer,
// the cache is AUTHORITATIVE and fit to display. That is a real answer, not a
// tolerance fudge, and it is why this returns an outcome instead of a boolean.
//
//   'current'       repaired (or already) at the session frontier
//   'authoritative' asked; the server has nothing newer. Correct to display.
//   'nodata'        the symbol yielded no bars at all (dead / delisted / typo)
//   'error'         the request failed
//
// ⛔ 'nodata' AND 'error' ARE NOT SUCCESS. The caller may commit on them — the
// member clicked, and being silently pinned to the previous chart is its own
// bug — but it must classify them as DEGRADED, never count them as a completed
// handoff, and let the chart show its own honest loading/no-data state.
export async function prepareForDisplay(sym, tf) {
  if (!sym || !tf) return 'error'
  try {
    const k = _ck(tf)   // pinned for this job (see _gridOk)
    const have = await _idbGetRaw(sym, k)
    const lastT = have?.lastT
    const hasBars = !!have?.bars?.length
    if (hasBars && _INTRADAY_TFS.has(String(tf)) && typeof lastT === 'number'
        && _paintCurrent(lastT, tf, have.bars)) {
      _promote(sym, k, have.bars, have.savedAt)
      return 'current'
    }
    // Ask for exactly what is missing: the tail when we have a sound base to
    // repair, the window when we have nothing. Same URLs the warmer uses, so
    // this shares its dedupe and its shed-ability rather than opening a door.
    const asked = (hasBars && typeof lastT === 'number'
      && classifyIntradayTail(lastT, tf) !== 'gapped')
    const url = asked ? _sinceUrl(sym, tf, lastT) : _url(sym, tf)
    const startedAt = Date.now()
    const json = _noteWarmResult(await _warmLoad(url))

    // ⛔⛔ VERIFY THAT WE ACTUALLY HEARD FROM THE AUTHORITY BEFORE BELIEVING
    // "there is nothing newer". `warmFetcher` maps a 503 SHED to
    // `{ bars: [], error: 'warming' }` — the server saying "I was too busy to
    // look". An earlier version of this function read that as an empty answer,
    // kept the old cache, and returned 'authoritative': an hours-stale chart
    // committed as though it had been verified. A non-answer is not an answer.
    const answered = _isAuthoritativeAnswer(json, sym, tf)
    if (!answered.ok) return 'error'
    if (!_gridOk(k, json)) return 'error'   // the view flipped grids mid-request

    const rows = json.bars
    if (!rows.length && !hasBars) return 'nodata'
    const next = rows.length ? await _land(sym, k, rows, { delta: !!json.delta, startedAt }) : have.bars
    if (!next?.length) return 'nodata'
    const newestT = next[next.length - 1]?.t
    if (!_INTRADAY_TFS.has(String(tf))) return 'current'
    if (typeof newestT === 'number' && _paintCurrent(newestT, tf, next)) return 'current'
    // We asked the authority for this exact symbol + timeframe and it confirmed
    // there is nothing newer. The cache IS the frontier for this symbol.
    return 'authoritative'
  } catch {
    return 'error'
  }
}

// The handoff's one request for a symbol nothing has cached. A 503 rejects tagged exactly as
// StockChart's fetcher does (`warming`, `retryAfterMs`).
export async function _chartLaneFetch(url, signal) {
  const r = await fetch(url, signal ? { signal } : undefined)
  if (r.ok) return r.json()
  const err = new Error(`HTTP ${r.status}`)
  err.status = r.status
  if (r.status === 503) {
    const ra = parseInt(r.headers?.get?.('Retry-After') || '', 10)
    if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra * 1000
    try {
      const b = await r.clone().json()
      if (b && (b.warming === true || b.error === 'warming')) err.warming = true
    } catch { /* non-JSON body: a generic 5xx */ }
  }
  throw err
}
const _chartLaneInflight = new Map()

// ── THE BarStore's LANE (P2b: data/barStore/network.js) — the SAME gate, not a second one ──
// Every store request goes through here, so it shares with everything already here:
//   • dedupe — a request of the same URL already in flight is JOINED: the lane's own, a
//     chart-lane one (`_chartLaneInflight`) or a warm (`_pendingBars`). Only a NON-visible
//     request may join a tail's shed-able `&warm=1` twin (`joinPendingBars`): a background
//     warm is the first thing the server sheds, and the visible chart must not ride on it;
//   • concurrency — non-visible requests take a slot of THE warm queue's `_MAX_CONCURRENT`;
//   • backpressure — the server's 503 backoff holds urgent + grid, and background also
//     waits out the pack-ingest hold (`_holdBackgroundWarm`), exactly like the warm queue.
// Priorities: visible (the chart on screen — NEVER queued, like StockChart's own fetch)
//   > urgent > grid > [the warm queue] > background.
// ⛔ ONE CALLER'S ABORT NEVER ABORTS ANOTHER. A lane request runs on its OWN controller and
// is ref-counted over the lane callers sharing it: a caller's abort detaches that caller
// (its promise rejects with AbortError) and the network request is aborted only when the
// last one has left. Lane requests live in their own map (`_laneInflight`), so no legacy
// caller (the symbol handoff joins `_chartLaneInflight`) can ever hold one; a lane caller
// that joins a legacy / warm request only detaches on abort, never cancels it.
export const LANE_RANK = Object.freeze({ visible: -1, urgent: 0, grid: 1, background: 2 })
const _laneWaiters = []   // [{ rank, seq, url, signal, resolve, reject }]
const _laneInflight = new Map()   // url -> { req, ic, refs }
let _laneSeq = 0
let _laneTimer = null
function _laneHeld(rank) { return rank >= LANE_RANK.background ? _holdBackgroundWarm() : Date.now() < _warmBackoffUntil }
function _laneAbortError() { const e = new Error('aborted'); e.name = 'AbortError'; return e }
/** What a request of `url` at `rank` may join: { entry } (the lane's own), { req } (legacy / warm), or null. */
function _laneJoin(url, rank) {
  const own = _laneInflight.get(url)
  if (own) return { entry: own }
  const legacy = _chartLaneInflight.get(url) || _pendingBars.get(url)
  if (legacy) return { req: legacy }
  const twin = rank >= 0 ? joinPendingBars(url) : null   // the `&warm=1` twin: never for visible
  return twin ? { req: twin } : null
}
/** Hand `j` (a joinable) to one caller, honoring that caller's own abort only. */
function _laneAttach(j, signal) {
  const entry = j.entry || null
  if (entry) entry.refs++
  let left = false
  const leave = () => {
    if (left || !entry) return
    left = true
    if (--entry.refs <= 0 && _laneInflight.get(entry.url) === entry) { _laneInflight.delete(entry.url); entry.ic?.abort() }
  }
  const shared = entry ? entry.req : j.req
  return new Promise((resolve, reject) => {
    const onAbort = () => { leave(); reject(_laneAbortError()) }
    if (signal?.aborted) return onAbort()
    signal?.addEventListener?.('abort', onAbort, { once: true })
    shared.then(
      (v) => { signal?.removeEventListener?.('abort', onAbort); left = true; resolve(v) },
      (e) => { signal?.removeEventListener?.('abort', onAbort); left = true; reject(e) },
    )
  })
}
function _laneFetch(url, slot) {
  if (slot) _active++
  const ic = typeof AbortController !== 'undefined' ? new AbortController() : null
  const req = _chartLaneFetch(url, ic?.signal)
  const entry = { url, req, ic, refs: 0 }
  _laneInflight.set(url, entry)
  const done = () => {
    if (_laneInflight.get(url) === entry) _laneInflight.delete(url)
    if (slot) { _active--; _pump() }
  }
  req.then(done, done)
  // Background answers drive the shared backoff (a shed holds every warm), as the warm queue's do.
  if (slot) req.then(_noteWarmResult, (e) => { if (e?.status === 503 || e?.warming) _noteWarmResult({ bars: [], error: 'warming' }) })
  return { entry }
}
function _drainLane(maxRank) {
  if (!_laneWaiters.length) return
  _laneWaiters.sort((a, b) => a.rank - b.rank || a.seq - b.seq)
  for (let i = 0; i < _laneWaiters.length;) {
    const w = _laneWaiters[i]
    if (w.rank > maxRank || _laneHeld(w.rank)) { i++; continue }
    const joined = _laneJoin(w.url, w.rank)
    if (!joined && _active >= _MAX_CONCURRENT) break
    _laneWaiters.splice(i, 1)
    w.signal?.removeEventListener?.('abort', w.onAbort)
    _laneAttach(joined || _laneFetch(w.url, true), w.signal).then(w.resolve, w.reject)
  }
  if (_laneWaiters.length && !_laneTimer) {
    // Held waiters re-check when the backoff lifts (or the pack stamps), never spin.
    _laneTimer = setTimeout(() => { _laneTimer = null; _pump() }, Math.max(1000, _warmBackoffUntil - Date.now()))
  }
}
/** One bar request through the shared lane. Resolves with the JSON body; rejects as
 *  `_chartLaneFetch` does (`status`, `warming`, `retryAfterMs`) or with an AbortError.
 *  `front`: the legacy `priority: true` — ahead of every non-front waiter of its rank
 *  (front waiters keep their own arrival order). */
export function barsLaneRequest(url, { priority = 'visible', signal = null, front = false } = {}) {
  const u = String(url)
  if (signal?.aborted) return Promise.reject(_laneAbortError())
  const rank = LANE_RANK[priority] ?? LANE_RANK.background
  const joined = _laneJoin(u, rank)
  if (joined) return _laneAttach(joined, signal)
  if (rank < 0) return _laneAttach(_laneFetch(u, false), signal)
  return new Promise((resolve, reject) => {
    const w = { rank, seq: front ? ++_laneSeq - 1e15 : ++_laneSeq, url: u, signal, resolve, reject, onAbort: null }
    w.onAbort = () => {
      const i = _laneWaiters.indexOf(w)
      if (i >= 0) { _laneWaiters.splice(i, 1); reject(_laneAbortError()) }
    }
    signal?.addEventListener?.('abort', w.onAbort, { once: true })
    _laneWaiters.push(w)
    _pump()
  })
}
/**
 * Raise a WAITING lane request of `url` to `priority` (a subscriber joined a warm still in the
 * queue). `to`: REWRITE its URL too — a non-warm joiner turns a queued `&warm=1` warm into its
 * own non-warm request (the server must not shed the chart's answer). `visible` leaves the
 * queue at once without a slot, exactly as a visible request would have; a better non-visible
 * rank re-sorts. Returns how many waiters moved; a request already on the network is not
 * waiting (0) — the caller then asks again behind it.
 */
export function promoteLaneRequest(url, priority, { to = null } = {}) {
  const u = String(url)
  const rank = LANE_RANK[priority] ?? LANE_RANK.background
  let n = 0
  for (let i = 0; i < _laneWaiters.length;) {
    const w = _laneWaiters[i]
    if (w.url !== u || (w.rank <= rank && !to)) { i++; continue }
    n++
    if (to) w.url = String(to)
    const r = Math.min(w.rank, rank)
    if (r < 0) {
      _laneWaiters.splice(i, 1)
      w.signal?.removeEventListener?.('abort', w.onAbort)
      _laneAttach(_laneJoin(w.url, r) || _laneFetch(w.url, false), w.signal).then(w.resolve, w.reject)
      continue
    }
    w.rank = r
    i++
  }
  if (n) _pump()
  return n
}
/** Test hook: lane occupancy. */
export function _laneStats() { return { waiting: _laneWaiters.length, active: _active, inflight: _chartLaneInflight.size + _laneInflight.size } }

/**
 * Daily/weekly/monthly analogue of `prepareForDisplay` for the symbol handoff: get the
 * set the chart will paint into the synchronous memory cache, without replacing it.
 * A cached set is promoted with its own saved time (so the paint gate still judges it
 * by when it was written). An uncached symbol asks for the chart's own URL.
 *
 * ⛔ ONLY A GOOD ANSWER IS OFFERED TO THE CHART (via `preload`). SWR hands a preloaded
 * value to the key's next reader as DATA, so a shed left there reads as an empty answer,
 * `barsSwrOnErrorRetry` never runs, and the next attempt is the 5-minute daily refresh.
 * On any failure the chart does its own fetch, which retries on its own schedule.
 */
export async function prepareDailyForDisplay(sym, tf, { signal } = {}) {
  if (!sym || !tf) return 'error'
  // Enter on a typed text: its in-flight warm now belongs to this chart — never abort it.
  _keepTypedWarm(_url(sym, tf, false))
  try {
    const have = await idbGet(sym, tf)
    if (have?.bars?.length) {
      memPut(sym, tf, have.bars, { savedAt: have.savedAt ?? null })
      return 'current'
    }
    if (signal?.aborted) return 'error'
    const url = _url(sym, tf, false)
    // A type-to-search warm of this exact URL already in flight is JOINED, never repeated.
    let req = _chartLaneInflight.get(url) || _pendingBars.get(url) || null
    if (!req) {
      req = _chartLaneFetch(url, signal).finally(() => { _chartLaneInflight.delete(url) })
      _chartLaneInflight.set(url, req)
    }
    let json
    try {
      json = await req
    } catch (e) {
      if (e?.status === 503 || e?.warming) _noteWarmResult({ bars: [], error: 'warming' })
      return 'error'
    }
    if (signal?.aborted) return 'error'
    _noteWarmResult(json)
    if (!_isAuthoritativeAnswer(json, sym, tf).ok) return 'error'
    if (json.delta || !json.bars.length) return 'nodata'
    memPut(sym, tf, json.bars)
    idbPut(sym, tf, json.bars)
    preload(url, () => Promise.resolve(json))
    return 'current'
  } catch {
    return 'error'
  }
}

// ── TYPE-TO-SEARCH WARM (D/W/M) ──────────────────────────────────────────────
// ⭐ (2026-11-11) THE SWITCH IS PREPARED WHILE THE MEMBER IS STILL TYPING.
//   1. The symbol's cached set is promoted IndexedDB → memory, so on Enter the handoff
//      finds it synchronously and commits in the same tick (no IDB read after Enter).
//   2. When that cache could NOT be the first frame on its own — a daily chart paints
//      its cache only if today's bar can be supplied locally (`_typedCachePaints`, the
//      chart's paint authority restated) — the chart's own URL is fetched now: a name
//      never opened, the today-pack aged past its 90 s seed ceiling after a pause, a
//      tail sessions behind. By Enter the authoritative set is usually in memory
//      (stamped NOW, which the paint authority accepts); an answer still in flight is
//      JOINED by the handoff (`prepareDailyForDisplay`) and by the chart's SWR key.
// ⚠️ COST. No request when the cache will paint, nor for uncached text on a browser that
// holds the pack (a prefix, not a ticker); otherwise one shallow request
// (~14 KB, a mem/sqlite hit server-side) per settled text, deduped per URL, skipped
// while a network-fresh set is in memory. D/W/M only: intraday has `prepareForDisplay`.
const TYPED_FRESH_MS = 60_000

/** Would the chart paint this cached set as its FIRST frame without the network? Asks the
 *  chart's own authority (`dailyCachePaintVerdict`); the seed it can count on before Enter is
 *  the today-pack (the live-store seed is per-symbol and usually absent for a typed name —
 *  missing it only costs one unneeded request, never a wrong frame). */
export function _typedCachePaints(sym, tf, lastT, savedAt) {
  if (String(tf) !== 'D') return true                       // W/M paint their cache as is
  if (typeof lastT !== 'string' || lastT.length < 10) return false
  let hasSeed = false
  try { hasSeed = todayPackUsable() && !!getTodayBar(sym) } catch { hasSeed = false }
  return dailyCachePaintVerdict(lastT, savedAt, { hasSeed }) === 'ok'
}

function _packStamped() {
  try { return !!localStorage.getItem('barspack.version') } catch { return false }
}

// ONE typed warm is live at a time: the latest text. A newer text ABORTS the previous warm's
// request unless the handoff has already joined it (`kept` — the member pressed Enter on it).
let _typedLatest = null   // { url, ctl, kept }
function _typedSuperseded(url) { return !_typedLatest || _typedLatest.url !== url }
/** @internal the handoff joined this URL's warm: it now belongs to a chart, never abort it. */
function _keepTypedWarm(url) { if (_typedLatest && _typedLatest.url === url) _typedLatest.kept = true }
/** @internal test seam */
export function __resetTypedWarm() { _typedLatest = null }

export function warmTypedSymbol(sym, tf = 'D') {
  if (!sym || !tf || !['D', 'W', 'M'].includes(String(tf))) return null
  const S = String(sym).trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9.^-]{0,11}$/.test(S)) return null
  const url = _url(S, tf, false)
  // A newer text supersedes the previous one at once — its request is aborted (GOO -> GOOGL).
  if (_typedLatest && _typedLatest.url !== url) {
    if (!_typedLatest.kept) { try { _typedLatest.ctl?.abort() } catch { /* ignore */ } }
    _typedLatest = null
  }
  const saved = memPeekSavedAt(S, tf)
  if (memHas(S, tf) && Number.isFinite(saved) && Date.now() - saved < TYPED_FRESH_MS) return null
  if (_typedLatest && _typedLatest.url === url) return null   // this text is already being warmed
  const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null
  _typedLatest = { url, ctl, kept: false }
  return (async () => {
    let lastT = null
    let savedAt = null
    const inMem = memPeek(S, tf)
    if (inMem?.length) {
      lastT = inMem[inMem.length - 1]?.t ?? null
      savedAt = memPeekSavedAt(S, tf)
    } else {
      const have = await idbGet(S, tf)
      if (_typedSuperseded(url)) return 'superseded'   // a newer text arrived: no promote, no fetch
      if (have?.bars?.length) {
        // Promoted with its OWN stamp, so the paint gate still judges it by when it was written.
        if (!memHas(S, tf)) memPut(S, tf, have.bars, { savedAt: have.savedAt ?? null })
        lastT = have.bars[have.bars.length - 1]?.t ?? null
        savedAt = have.savedAt ?? null
      }
    }
    if (lastT != null && _typedCachePaints(S, tf, lastT, savedAt)) return 'cache'
    // ⛔ A PREFIX IS NOT A TICKER. Typing GOOGL settles on G, GO, GOO, GOOG on the way; on a
    // browser holding the whole-universe pack, text with NO cached set is almost always a
    // partial word, and asking /api/bars for it would send unknown symbols to the origin
    // (a possible cold provider lookup each). Only a browser without the pack (a new member)
    // warms an uncached name.
    if (lastT == null && _packStamped()) return 'unknown'
    const startedAt = Date.now()
    const json = await _warmLoad(url, ctl ? ((u) => _chartLaneFetch(u, ctl.signal)) : warmFetcher)
    if (!_isAuthoritativeAnswer(json, S, tf).ok || json.delta || !json.bars?.length) return false
    // NEWER WINS, through the ONE monotonic write path (barsMerge `mergeMonotonic`): a set
    // written for this key after this request began (the chart's own fetch, a later warm)
    // keeps every bar it holds — a late answer only adds history it lacks — and deeper
    // history already in memory is kept while the server wins the overlap otherwise.
    const curSaved = memPeekSavedAt(S, tf)
    const stale = Number.isFinite(curSaved) && curSaved > startedAt
    memPut(S, tf, json.bars, { startedAt })
    return stale ? 'stale-answer' : 'network'
  })().catch(() => false).finally(() => {
    if (_typedLatest && _typedLatest.url === url && _typedLatest.ctl === ctl) _typedLatest = null
  })
}

/**
 * Did this response genuinely come from the authority, FOR THIS REQUEST?
 *
 * ⛔ EVERY CLAUSE HERE EXISTS BECAUSE ITS ABSENCE WOULD MANUFACTURE A FALSE
 * 'authoritative' — and a false 'authoritative' is worse than a stale paint,
 * because it commits stale data while asserting it was checked.
 */
export function _isAuthoritativeAnswer(json, sym, tf) {
  //   a request that never reached the source / network error / aborted
  if (json == null) return { ok: false, why: 'no-response' }
  //   503 shed or any transient — the server did not look
  if (json.error) return { ok: false, why: `server-${json.error}` }
  //   malformed body
  if (!Array.isArray(json.bars)) return { ok: false, why: 'malformed' }
  //   wrong symbol (a dedupe/cache collision must never answer for another name)
  if (json.ticker && String(json.ticker).toUpperCase() !== String(sym).toUpperCase()) {
    return { ok: false, why: 'wrong-symbol' }
  }
  //   wrong timeframe
  if (json.tf != null && String(json.tf) !== String(tf)) {
    return { ok: false, why: 'wrong-timeframe' }
  }
  return { ok: true, why: 'verified' }
}

// Prefetch a list of tickers for a specific timeframe (e.g. visible list rows).
// `priority` jumps them to the front of the shared queue — e.g. the year the user
// just switched to, so its charts warm before the background catalog trickle.
//
// `urgent` (OPT-IN, default false) lets the first URGENT_MAX_PER_CALL symbols of
// the call run during the cold-start pack-ingest hold (they are also jumped to the
// front). Same URL / bar count (FIRST_PAINT_BARS), same bounded queue, same 503
// backoff; symbols beyond the cap fall back to the normal held path. For the one or
// two rows a user is about to reach by keyboard — never for list-wide warming.
export function prefetchBars(tickers, tf = 'D', { priority = false, urgent = false } = {}) {
  if (!tickers?.length) return
  const syms = tickers.filter(Boolean)
  const nUrgent = urgent ? Math.min(URGENT_MAX_PER_CALL, syms.length) : 0
  if (urgent) {
    // Only the LATEST urgent call stays urgent: a fast walk must not leave a trail
    // of stale urgent fetches for rows the user already passed.
    const keep = new Set(syms.slice(0, nUrgent).map(x => _url(x, tf, false)))
    for (const u of [..._urgent.keys()]) {
      if (keep.has(u)) continue
      _urgent.delete(u)
      const qi = _queue.indexOf(u)
      if (qi >= 0) { _queue.splice(qi, 1); _seen.delete(u) }
    }
    // Reverse so caller order (nearest row first) ends up at the head.
    for (let i = nUrgent - 1; i >= 0; i--) { _enqueueUrgent(syms[i], tf); prefetchTickerMeta(syms[i]) }
    queueMicrotask(_pump)
  }
  for (let i = nUrgent; i < syms.length; i++) {
    _enqueue(_url(syms[i], tf), priority)
    prefetchTickerMeta(syms[i])
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
// ⛔⛔ W-L (2026-11-11): INTO THE CACHES THE CHART READS. This used to `_enqueue` the
// `&warm=1` URLs, whose answers land only in SWR's preload table and are dropped there
// on settle (`_warmRaw`) — a `warm=1` URL is never a chart key — so all eight requests
// per selection bought nothing on the client. The durable queue writes mem + IDB under
// the chart's key, skips a (sym, tf) that is already durable and current, and repairs a
// behind one with a `since=` tail.
export function prefetchAllTimeframes(sym) {
  if (!sym) return
  prefetchTickerMeta(sym)
  for (const tf of ALL_TFS) prefetchBarsToIDB([sym], tf)
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
/** THE "bars ending at a date" URL (`to=` — replay's pre-cutoff window and the chart's
 *  scroll-back left window, `utils/historyPrepend.js`). One builder for both askers. */
export function barsBeforeUrl(sym, tf, bars, toIso, q = '') {
  return `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${bars}${q}&to=${encodeURIComponent(toIso)}`
}
export function prefetchReplayTimeframes(sym, cutoffIso, { bars = 4000 } = {}) {
  if (!sym || !cutoffIso) return
  for (const tf of REPLAY_WARM_TFS) {
    _enqueue(`${barsBeforeUrl(sym, tf, bars, cutoffIso, barsGridQuery(tf, _prefetchShowExtended))}&warm=1`, false)
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
  // so durable IDB warms survive the hold and resume once it lifts. Under the pack hold a
  // `visible` job may still run (see _holdJob); it is taken from wherever it sits.
  while (_idbActive < _IDB_MAX && _idbQueue.length) {
    const at = _holdBackgroundWarm() ? _idbQueue.findIndex(j => !_holdJob(j)) : 0
    if (at < 0) { _idbKickSoon(); return }
    const job = _idbQueue.splice(at, 1)[0]
    _idbActive++
    _idbWarmOne(job).finally(() => { _idbActive--; _idbPump() })
  }
}

async function _idbWarmOne({ sym, tf, visible = false }) {
  try {
    const k = _ck(tf)   // pinned for this job (see _gridOk)
    const have = await _idbGetRaw(sym, k)
    // A DAILY entry missing recent sessions is NOT fresh: the chart's daily
    // staleness gate refuses to paint it, so leaving it here is what makes the
    // NEXT click cold-load on a black screen. Refresh it so scanning keeps the
    // daily cache current and the click paints instantly.
    // …and, after the bell, a today bar written DURING the session: the chart refuses
    // it as a first frame (provisional close), so it is refreshed here like a stale one.
    const staleDaily = tf === 'D' && have?.bars?.length && _dailyNeedsRefresh(have.lastT, have.savedAt)

    // ⚰️⚰️ THE COMMENT THAT USED TO SIT HERE SAID "Intraday is already handled:
    // idbGet returns null for a stale-intraday entry → `have` is null". THAT
    // STOPPED BEING TRUE and nothing noticed. `idbGet` was correctly changed to
    // hand BEHIND entries back (they are sound repair bases; discarding them is
    // what forced re-downloading thousands of bars to recover today's last
    // twenty) — and this early return, which had been leaning on that eviction as
    // its staleness signal, silently became "an hours-stale intraday cache is
    // already warm, do nothing". So the warmer stopped repairing exactly the
    // caches that most needed it, and the next click painted 10:00 at 15:55.
    //
    // ⭐ REPAIR IT WITH THE TAIL, NOT A REFETCH. `since=` returns every row past
    // the threshold, so one small request (production-measured 8.5 KB / 59 ms vs
    // 81 KB / 111 ms for the full window) carries the whole gap. This is the
    // difference between "the likely-next symbol is warm" and "the likely-next
    // symbol is CURRENT", which is the only one the member can see.
    const behindIntraday = _INTRADAY_TFS.has(String(tf)) && have?.bars?.length
      && typeof have.lastT === 'number'
      && classifyIntradayTail(have.lastT, tf) !== 'gapped'
      && !_paintCurrent(have.lastT, tf, have.bars)
    if (behindIntraday) {
      if (_holdJob({ visible })) return
      if (!_repairCooldownOk(sym, tf)) return
      const rk = _repairKey(sym, tf)
      const at = _repairAt.get(rk)
      const startedAt = Date.now()
      const tail = _noteWarmResult(
        await _warmLoad(_sinceUrl(sym, tf, have.lastT)))
      // No answer from the authority (503 shed, network/HTTP error): not a repair.
      if (!_isAuthoritativeAnswer(tail, sym, tf).ok) { _repairFailed(rk, at); return }
      if (tail.bars.length && _gridOk(k, tail)) await _land(sym, k, tail.bars, { delta: true, startedAt })
      return
    }
    if (have?.bars?.length && !staleDaily) return  // already durable + fresh — no fetch
    // Don't race the pack to origin, and don't pile onto a shedding server (see
    // _holdBackgroundWarm). The pack is writing these tickers into IDB; a click
    // meanwhile fetches its ONE chart via SWR. Warming resumes when the hold lifts.
    // A `visible` row is held only by the server's backoff (_holdJob).
    if (_holdJob({ visible })) return
    // An urgent job for this symbol is queued or running under the chart's own key, and it lands
    // the bars in mem AND IDB: fetching them again under `&warm=1` downloads the same bars twice
    // (measured on production 2026-10-17: the first three rows of every screener open).
    if (_urgent.has(_url(sym, tf, false)) || _urgentRunning.has(`${sym}_${tf}`)) return
    const startedAt = Date.now()
    const json = _noteWarmResult(await _warmLoad(_url(sym, tf)))
    // Merged into what is stored NOW (monotonic): a deeper history already in IDB is
    // kept and only the recent tail heals — a bare shallow put would truncate a
    // deep-warmed series back to ~600 bars, or roll back a newer chart write.
    if (json?.bars?.length && !json.delta && _gridOk(k, json)) await _land(sym, k, json.bars, { startedAt })
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
//   visible   — rows on screen: may run during the first-visit pack ingest (see
//               _holdJob). Only prewarmVisibleList's top rows pass it.
export function prefetchBarsToIDB(tickers, tf = 'D', { priority = false, immediate = false, visible = false } = {}) {
  if (!tickers?.length) return
  const front = []
  for (const sym of tickers) {
    if (!sym) continue
    const key = `${sym}_${tf}`
    const at = _idbQueue.findIndex(j => j.sym === sym && j.tf === tf)
    if (at >= 0) {                              // already queued
      if (visible) _idbQueue[at].visible = true
      if (priority && at > 0) front.push(_idbQueue.splice(at, 1)[0]) // jump the line
      continue
    }
    if (_idbSeen.has(key) && !priority) continue // in-flight/recent — don't pile up
    if (!_idbSeen.has(key)) { _idbSeen.add(key); setTimeout(() => _idbSeen.delete(key), 60000) }
    const job = visible ? { sym, tf, visible: true } : { sym, tf }
    if (priority) front.push(job)
    else _idbQueue.push(job)
    prefetchTickerMeta(sym)
  }
  if (front.length) _idbQueue.unshift(...front) // caller order, at the head
  if (immediate || (visible && _packStillIngesting())) _idbPump() // rows on screen: now
  else _idbKickSoon()
}

// A DAILY set the chart's paint authority refuses as a first frame for a reason a
// refetch cures: it is missing a closed session, or (after the bell) its today bar
// was written DURING the session and so holds a mid-session close. The Focus
// screener's neighbour warm relies on this: a refused neighbour drew only after its
// own /api/bars landed, 530-850 ms per ArrowDown (2026-10-16).
function _dailyNeedsRefresh(lastT, savedAt) {
  return isDailyTailStale(lastT) || isDailyTodayCloseProvisionalForPaint(lastT, savedAt)
}
// "Already warm" means the chart would PAINT what mem holds, not merely that mem
// holds something: a refused daily entry must not make the warmers skip the repair.
function _memUsable(sym, tf) {
  if (!memHas(sym, tf)) return false
  // ⛔ (2026-11-10) An intraday mem entry is "usable" only if the chart would PAINT it.
  // `true` here made the urgent/intent warm a no-op for exactly the stale entry that
  // most needed repair, so the click then waited on the chart's own fetch.
  if (_INTRADAY_TFS.has(String(tf))) {
    const bars = memPeek(sym, tf)
    return _memPromoteFresh(tf, bars?.[bars.length - 1]?.t, null, bars)
  }
  if (String(tf) !== 'D') return true
  const bars = memPeek(sym, tf)
  return !_dailyNeedsRefresh(bars?.[bars.length - 1]?.t, memPeekSavedAt(sym, tf))
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
function _memPromoteFresh(tf, lastT, savedAt = null, bars = null) {
  // Daily: reject a tail missing recent sessions, or (after the bell) a today bar
  // written mid-session (mirrors the chart's gate — it would just be suppressed).
  if (String(tf) === 'D') return !_dailyNeedsRefresh(lastT, savedAt)
  if (!_INTRADAY_TFS.has(String(tf))) return true   // W/M always promote
  if (typeof lastT !== 'number') return false
  // ⭐ (2026-11-10) THE CHART'S OWN PAINT RULE, not a private 6x-tf/20-min window: a
  // sound base (not gapped) that is within one expected bucket of the frontier. The
  // old window promoted a 20-minute-old 1m tail (19 bars behind) that the chart then
  // refused to paint — or, through the mem fallback, painted as current.
  return _paintCurrent(lastT, tf, bars)
}

export function warmMemFromIDB(tickers, tfs = SCAN_WARM_TFS) {
  if (!tickers?.length) return
  for (const sym of tickers) {
    if (!sym) continue
    for (const tf of tfs) {
      const k = _ck(tf)                    // pinned: read and write the SAME key
      if (_memHasRaw(sym, k)) continue        // already hot — pure no-op per press
      _idbGetRaw(sym, k).then(entry => {
        if (entry?.bars?.length && !_memHasRaw(sym, k) && _memPromoteFresh(tf, entry.lastT, entry.savedAt, entry.bars)) {
          _promote(sym, k, entry.bars, entry.savedAt)   // the SOURCE stamp, never now
        }
      }).catch(() => { /* best-effort accelerator; IDB stays the fallback */ })
    }
  }
}

// ── "A scrollable list just appeared" — warm the WHOLE list up front ─────────
// One call, fired the instant a list of tickers becomes visible: a theme
// expanded, a watchlist opened, a Breadth drill-down opened, scanner results.
// The promise: open a list → its whole set warms → scroll it as fast as you like,
// every chart instant. It composes the durable warmers above, so it inherits ALL
// their guardrails — bounded concurrency (≤3), idle-deferral behind the active
// chart, the pack-ingest hold, and the 503 backpressure backoff. Nothing here can
// stampede the server or starve the chart the user is looking at.
//
//   1) The on-screen timeframe, durable + IMMEDIATE + priority — a click on one of
//      these rows is imminent, so jump the queue and start the pump now (the chart
//      being left is already painted, so the burst competes with no cold fetch).
//   2) The remaining scan timeframes into durable IDB (bounded; capped inside).
//   3) Promote the TOP rows straight to the sync mem cache so the first few scrolls
//      paint in the SAME frame (no async idbGet hop), top-first = what's on screen.
//
// `cap` bounds the daily warm so a pathologically huge list can't flood the queue
// (top-first, so the rows a user will actually reach soon are covered). Kill switch:
// localStorage['uct.listprewarm.off'] = '1' disables it instantly, per browser.
export function listPrewarmDisabled() {
  try { return localStorage.getItem('uct.listprewarm.off') === '1' } catch { return false }
}

export function prewarmVisibleList(tickers, { chartTf = 'D', memTop = 24, cap = 500 } = {}) {
  if (listPrewarmDisabled()) return
  const list = [...new Set((tickers || []).filter(Boolean))].slice(0, cap)
  if (!list.length) return
  // Warm ONLY the on-screen timeframe(s) for the whole list — that's what's scrolled.
  //
  // ⛔ Do NOT warm all five timeframes here. A member HAR at MARKET OPEN (2026-09-01)
  // proved that firing 5m/1h/30m/15m/daily × a 20-name list = ~100 `warm=1` fetches,
  // which the loaded server 503-sheds en masse; the flood saturated the browser's
  // 6-connection pool + added origin load, STARVING the chart the user actually
  // clicked (blank charts + a cascade where one stuck fetch jammed siblings). The
  // other timeframes warm on demand when the user switches TF (prefetchAllTimeframes
  // on selection already covers the viewed symbol).
  //
  // priority (queue order, not extra concurrency) + NO `immediate` so the visible
  // chart's own fetch always goes out first; the warm idle-defers behind it.
  // The top rows are what the member flips through first: they may load during a
  // first visit's pack ingest (`visible`); the rest of the list waits for it as before.
  prefetchBarsToIDB(list.slice(0, memTop), chartTf || 'D', { priority: true, visible: true })
  prefetchBarsToIDB(list.slice(memTop), chartTf || 'D', { priority: true })
  if (chartTf && chartTf !== 'D') prefetchBarsToIDB(list, 'D', { priority: true })
  // Promote only the on-screen TF (not all five) so the same-frame accelerator
  // doesn't fire 5× the local IDB reads for the top rows.
  warmMemFromIDB(list.slice(0, memTop), chartTf && chartTf !== 'D' ? [chartTf, 'D'] : ['D'])
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
  // Deep background warm — best-effort, so it sheds under load like the shallow prefetch.
  return `/api/bars/${encodeURIComponent(sym)}?tf=${tf}&bars=${fullBarsFor(tf)}${_sessQ(tf)}&warm=1`
}
async function _deepWarmOne(sym, tf) {
  try {
    const target = fullBarsFor(tf)
    const k = _ck(tf)   // pinned for this job (see _gridOk)
    const have = await _idbGetRaw(sym, k)
    // Already deep enough in IDB → nothing to do (a short-history name never
    // reaches `target`, but the 5-min _deepSeen window keeps it from re-fetching).
    if (have?.bars?.length >= target * 0.9) return
    // Deep history (bars=12500) is the HEAVIEST fetch and produced the 20-23s cold
    // stalls in the HAR — never race the pack with it, and never pile it onto a
    // shedding server. Holds during pack-ingest OR while backed off (_holdBackgroundWarm).
    if (_holdBackgroundWarm()) return
    const startedAt = Date.now()
    const json = _noteWarmResult(await _warmLoad(_deepUrl(sym, tf))) // dedupes + warms SWR + server
    if (json?.bars?.length && !json.delta && _gridOk(k, json)) await _land(sym, k, json.bars, { startedAt })   // durable: the click paints deep from IDB
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
  if (_memUsable(sym, tf)) return
  try {
    // IDB-first: a durable, fresh-enough entry promotes to mem with zero
    // network — the hover/focus click then paints same-frame. Only a cold or
    // stale-intraday miss pays the fetch.
    const k = _ck(tf)   // pinned for this job (see _gridOk)
    const have = await _idbGetRaw(sym, k)
    if (have?.bars?.length && _memPromoteFresh(tf, have.lastT, have.savedAt, have.bars)) {
      _promote(sym, k, have.bars, have.savedAt)
      return
    }
    const startedAt = Date.now()
    const json = await _warmLoad(_url(sym, tf, false), fetcher) // intent warm: not shed, matches the chart's SWR key
    // Monotonic: deeper history kept, a newer chart write never rolled back.
    if (json?.bars?.length && !json.delta && _gridOk(k, json)) await _land(sym, k, json.bars, { startedAt })
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
