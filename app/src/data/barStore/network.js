// app/src/data/barStore/network.js — the BarStore's server I/O (P2b;
// docs/architecture/barstore.md §Network).
//
// ⭐ ONE LOOP PER SUBSCRIBED KEY, ≤1 REQUEST IN FLIGHT PER KEY (S9). Tail polls, one-shot
// `fetchOnce` (ensure / prefetch) and scroll-back windows of a key share ONE slot: a tail
// request asked while one is in flight JOINS it, a scroll-back waits for it. Every request
// has its own AbortController; stopping the last subscriber aborts it and clears the timer,
// so an unsubscribed key sends nothing more.
//
// ⭐ GEN. Every action this module dispatches carries the snapshot `gen` its request was
// issued under; the reducer drops it when the entry was invalidated (or its history moved)
// meanwhile — a request from before an invalidate can never land after it.
//
// ⭐ WHAT IS ASKED. A `since=` delta from `snapshot.deltaFrom` (the first row after the
// newest seal — `since` is exclusive server-side, so `deltaFrom - 1`) when the entry holds a
// seal and does not need a full read; otherwise a FULL read. D/W/M are never sealed (P1 §8)
// and always read whole, as today. `session=` is sent per key (#1061): the 60m keys carry
// their grid; 1–30m keys use the session their subscribers asked for (eth wins: its answer
// is judged against the wider frontier).
//
// ⭐ CADENCE — one policy, imported: utils/intradayTailPoll `nextTailPollMs` (fast catch-up
// for a tail that is behind or `tail_status: unverified`, honoring the answer's
// `retry_after`, then the 30 s cadence) with `intradayDedupMs` as the floor between two
// requests; a 503 honors Retry-After with a bounded backoff; D/W/M poll every 5 min (the
// chart's daily refresh). Paused while the document is hidden; resumed on visible.
//
// ⭐ THE GATE — the existing one: utils/prefetchBars `barsLaneRequest` (joins in-flight
// chart-lane / warm requests of the same URL, shares the warm queue's concurrency and the
// server's 503 backoff). Priorities: visible (never queued) > urgent > grid > background.
//
// ⭐ SCROLL-BACK — the "N bars before my oldest bar" window of #1116 (utils/historyPrepend):
// its `historyWindowUrl` over prefetchBars `barsBeforeUrl` (the one `to=` URL builder),
// `HISTORY_WINDOW_BARS`, and its `prependOlder` basis/seam rule — a window whose seam bar
// disagrees >2% with the oldest held bar (a split / re-basis since) is refused whole.
// Intraday only (#1116's scope); D/W/M depth comes from the full read.
//
// ⭐ THE ONE /api/bars URL BUILDER of the BarStore is `barsUrl` below (rails: one-url census
// owner). No other barStore file spells the endpoint.

import { barsLaneRequest, barsBeforeUrl, promoteLaneRequest } from '../../utils/prefetchBars'
import { historyWindowUrl, prependOlder, etDateOf, HISTORY_WINDOW_BARS, LAKE_WINDOW_BARS, lakeTargetBars } from '../../utils/historyPrepend'
import {
  nextTailPollMs, createTailPollState, intradayDedupMs, INTRADAY_POLL_MS, REPAIR_DEDUP_MS,
  tailRetriesExhausted,
} from '../../utils/intradayTailPoll'
import { classifyIntradayTail } from '../../utils/marketSession'
import { firstPaintBarsFor, fullBarsFor, FIRST_PAINT_BARS } from '../../utils/barsBackfill'
import { barsSessionQuery } from '../../components/chart/barTime'
import { ACTION, parseKey, isIntradayTf, isDateTf, PERIOD_SEC, unixToDateLabel, dateLabelToUnix } from './types'
import { barsHistorySplitEnabled, historySealedDate } from '../../utils/barsHistorySplit'
import { nextTask } from '../historyLake/source'

/** The D/W/M refresh cadence (StockChart's daily `refreshInterval`). */
export const DAILY_POLL_MS = 300_000
/** Error backoff: first retry, cap. */
export const ERROR_RETRY_MS = 1500
export const ERROR_RETRY_MAX_MS = 30_000
/** A terminal `no_data` key is re-asked this rarely (a listing can start trading). */
export const NO_DATA_POLL_MS = 300_000
/**
 * The server's MUTABLE window (api/services/bars_fetch.py `_DELTA_HEAL_WINDOW_SECONDS`, 8 h):
 * the stretch behind the stored tail a repair may still rewrite. With no seal held, a poll
 * re-reads exactly this window (`since = tail − window`) and lets the answer replace it;
 * anything older changes only with `history_rev` (P1 §2), which forces a full read.
 */
export const MUTABLE_WINDOW_S = 8 * 3600

/**
 * Where the next `since=` delta of snapshot `s` starts, or null for a FULL read.
 * FULL only for: the first load (no server answer yet and nothing restored), a pending full
 * read (`needsFull` — cache_key / history_rev change, a voided restored seal), D/W/M and
 * windowed keys (the legacy client reads those whole too). With a seal: `deltaFrom` (the
 * first row after the newest seal). Without one: the SERVER's tail minus the mutable window.
 * (The caller still turns an over-budget delta into a full read.)
 *
 * ⛔ THE SERVER'S TAIL, NEVER THE HELD ONE (#1125). The server places its mutable-window floor
 * behind ITS stored tail; a push-fed developing bar (or push / final rows) can run N buckets
 * ahead of it, and a window measured from there would start N buckets too late — a
 * correction at the server's floor edge would never be re-read. So the window is measured
 * from `serverTailOf`: the newest row a REST answer supplied. (A REST row a push frame later
 * overwrote no longer counts; that only moves the start earlier — a wider, still-correct
 * window.) No server row held → a full read.
 */
export function deltaStartFor(s, p = parseKey(s.key)) {
  if (!p || !isIntradayTf(p.tf) || p.window || s.needsFull) return null
  if (s.sealedSpans.length && s.deltaFrom != null) return s.deltaFrom
  if (!s.restSeen) return null
  const tail = serverTailOf(s)
  return finite(tail) ? tail - MUTABLE_WINDOW_S : null
}

/** Newest bucket `t` a server (REST) answer supplied to `s`: its developing bar while that is
 *  still server-sourced, else the newest closed row still carrying `src: 'rest'`; or null. */
export function serverTailOf(s) {
  if (s.developing && s.developing.src === 'server' && finite(s.developing.t)) return s.developing.t
  for (let i = s.bars.length - 1; i >= 0; i--) if (s.bars[i].src === 'rest') return s.bars[i].t
  return null
}
export const PRIORITIES = Object.freeze(['visible', 'urgent', 'grid', 'background'])
/** A deep D/W/M history fetched ahead of its join (`deepPrime`) is kept this long for the key's
 *  history job to take, and at most this many at once (each ~1-2 MB parsed). */
export const DEEP_PRIME_TTL_MS = 120_000
export const DEEP_PRIME_MAX = 4
/** A display waiting on a key's deep join (`deepPrime({ want: true })`) sends its history job at
 *  `visible` rank (never queued) for this long. */
export const DEEP_WANT_MS = 5_000

const finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** Bars to ask for: the chart's first-paint count, or the depth a caller ensured. */
export function barsCountFor(key, { depth = 0, session = 'rth' } = {}) {
  const p = parseKey(key)
  if (!p) return FIRST_PAINT_BARS
  const eth = p.session ? p.session === 'eth' : session === 'eth'
  const base = isIntradayTf(p.tf) ? firstPaintBarsFor(p.tf, eth) : FIRST_PAINT_BARS
  const want = Math.max(base, Math.floor(Number(depth) || 0))
  return Math.min(want, fullBarsFor(p.tf) || want)
}

/**
 * Is a since= delta from `deltaFrom` still smaller than the full read it replaces? A seal
 * restored from a copy days old would otherwise ask the server for every bucket since then;
 * past the full read's own bar count (wall-clock buckets — an over-estimate across nights,
 * so the cut errs toward the bounded full read) the full read is asked instead.
 */
export function deltaWithinBudget(tf, deltaFrom, nowMs, bars) {
  const period = PERIOD_SEC[String(tf)]
  if (!period || !finite(deltaFrom)) return false
  return (nowMs / 1000 - deltaFrom) / period <= bars
}

/** THE BarStore /api/bars URL. `session` applies to intraday; a 60m key carries its own. */
export function barsUrl(key, { bars, since = null, to = null, session = 'rth' } = {}) {
  const p = parseKey(key)
  if (!p) return null
  const eth = p.session ? p.session === 'eth' : session === 'eth'
  const sess = isIntradayTf(p.tf) ? barsSessionQuery(p.tf, eth) : ''
  const toDate = to ?? (p.window ? etDateOf(p.window.to) : null)
  let u = `/api/bars/${encodeURIComponent(p.sym)}?tf=${p.tf}&bars=${bars ?? barsCountFor(key, { session })}${sess}`
  if (since != null) u += `&since=${since}`
  if (toDate) u += `&to=${encodeURIComponent(toDate)}`
  return u
}

/**
 * THE /api/bars-history URL: deep SEALED D/W/M history, cached at the edge (utils/barsHistorySplit.js
 * has the why). It must be byte-identical for every client and the pre-warm sweep: the full sealed
 * depth (`fullBarsFor`, fixed per tf) and `d`, the newest held bar before the current period. The
 * legacy chart (useLegacyChartBars) builds its history URL here too: one builder.
 */
export function barsHistoryUrl(sym, tf, sealedDate = '') {
  return `/api/bars-history/${encodeURIComponent(sym)}?tf=${tf}&bars=${fullBarsFor(tf)}${sealedDate ? `&d=${sealedDate}` : ''}`
}

/** The left (older) window ending at the ET date of `oldestT` (#1116's builder). */
export function historyUrl(key, oldestT, { bars = HISTORY_WINDOW_BARS, session = 'rth' } = {}) {
  const p = parseKey(key)
  if (!p || !isIntradayTf(p.tf) || p.window) return null
  const eth = p.session ? p.session === 'eth' : session === 'eth'
  return historyWindowUrl(barsBeforeUrl, p.sym, p.tf, oldestT, barsSessionQuery(p.tf, eth), bars)
}

const _defaultHidden = () => typeof document !== 'undefined' && !!document.hidden
const _defaultOnVisible = (cb) => {
  if (typeof document === 'undefined') return () => {}
  const h = () => { if (!document.hidden) cb() }
  document.addEventListener('visibilitychange', h)
  return () => document.removeEventListener('visibilitychange', h)
}
const _isAbort = (e) => e?.name === 'AbortError'

/**
 * @param {object} o
 * @param {ReturnType<import('./registry').createRegistry>} o.registry
 * @param {(url:string, opts:{priority:string, signal:AbortSignal}) => Promise<object>} [o.request]
 */
export function createNetwork({
  registry, request = barsLaneRequest, promote = promoteLaneRequest,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
  now = () => Date.now(), isHidden = _defaultHidden, onVisible = _defaultOnVisible,
  dailyPollMs = DAILY_POLL_MS,
  // historyFeed.js: older intraday bars from the history lake at the edge, asked before the
  // server's window on every scroll-back (null: the server only, as before).
  history = null,
  // called just before a key's answer is dispatched, with the answer (index.js: persist.flushJoins, review of #2615)
  beforeAnswer = null,
} = {}) {
  /** key → per-key slot + loop state */
  const keys = new Map()
  const lakeSeeds = new Map()      // key -> the lake load in flight (lakeSeed), shared by its callers
  // keys whose lake load a display is WAITING on to paint (lakeSeed `awaited`): their pieces never yield (below)
  const lakeAwaited = new Set()
  /** key -> was its last tail request a `since=` delta (bounded, oldest out): `askedDelta` */
  const lastDelta = new Map()
  // key -> bars its entry held when its lake load finished on this page (whatever it added). A copy
  // now shallower than that was evicted and rebuilt, so its depth is due again; a load that found no
  // entry to join into never settles (review of #1795).
  const lakeSettled = new Map()
  const LAKE_SETTLED_MAX = 2000
  // ⭐ DEEP D/W/M HISTORY, ONE PAINT (2026-11-19, owner: "about 200 bars instantly and then the rest
  // shortly after, definitely in 2 phases"). A daily chart painted the copy it held (the pack's ~300
  // rows, or one 600-bar answer) and its deep history (/api/bars-history, edge-cached) was asked only
  // AFTER the key's tail answer, because the URL's `d` was read from those answered bars: two steps
  // on screen, ~250-500 ms apart. `d` now comes from the NYSE calendar (barsHistorySplit
  // `historySealedDate`), so the history can be fetched from the moment the ticker is typed or Enter
  // is pressed, in parallel with the tail (`deepPrime`). The history JOB still runs where it always
  // did (after the tail answer, through the key's one slot, the same SCROLL_BACK and seam rule); it
  // takes the primed answer instead of asking again. The handoff waits for the join (`deepPending`,
  // `deepJoined`, bounded) so the first frame holds the whole chart.
  const deepPrimes = new Map()     // url -> { p: Promise<json>, at }: a history fetched ahead of its job
  const deepSettled = new Map()    // key -> bars its entry held when its history join settled on this page
  const deepSubs = new Map()       // key -> Set<cb>: waiters on the key's history join settling
  const deepWanted = new Map()     // key -> ms until which a display waits on its join (its job: visible)
  let requests = 0
  /** key → Set<cb>: listeners of the key's catch-up budget (DELAYED badge, `tailExhausted`). */
  const budgetSubs = new Map()
  const _exhausted = (r) => !!r && tailRetriesExhausted(r.pollSt, r.key)
  function _noteBudget(key, before, after) {
    if (before === after) return
    for (const cb of [...(budgetSubs.get(key) || [])]) { try { cb() } catch { /* ignore */ } }
  }
  /** key → Set<cb>: listeners of the key's first settled tail request of this life (`answered`). */
  const answerSubs = new Map()
  /** A tail request of this key's CURRENT life settled with the server's word (rows, no_data or
   *  an error) — after its action was dispatched, so a listener reads the snapshot it produced. */
  function _noteAnswered(r) {
    if (r.answered || keys.get(r.key) !== r) return
    r.answered = true
    // ⭐ DEPTH WITHOUT A SCROLL: a chart that subscribes gets one window of older bars from the
    // lake as soon as its first answer lands, so zooming out finds them already there. Charts
    // only (a warm or a one-shot ask has no refs), and only where the lake can answer.
    // ⭐ ...and where the entry is SHALLOWER than a lake load already left it (a saved copy on another
    // basis replaced the lake's rows before this answer, reducer applyLocal), the depth comes back in
    // ONE join (lakeSeed), not in scroll-back windows; the window is the fallback when that join adds
    // nothing, and the path of a key the lake was never asked for.
    if (history && r.refs > 0 && _lakeCarries(r)) {
      const s = registry.getSnapshot(r.key)
      if (s.bars.length) {
        const window = () => api.scrollBack(r.key, { priority: 'background' }).catch(() => {})
        if (lakeSettled.has(r.key) && api.lakePending(r.key)) {   // a load left it deeper than it is now
          Promise.resolve().then(() => api.lakeSeed(r.key)).catch(() => false)
            .then((joined) => { if (!joined) return window() })
        } else window()
      }
    }
    for (const cb of [...(answerSubs.get(r.key) || [])]) { try { cb() } catch { /* ignore */ } }
  }

  function _rec(key) {
    let r = keys.get(key)
    if (!r) {
      r = {
        key, refs: 0, sessions: new Map(), priority: 'background', depth: 0,
        inflight: null,           // { ac, kind, promise }
        queue: [],                // pending scroll-back jobs
        timer: null, paused: false, lastStart: -Infinity, errors: 0,
        pollSt: createTailPollState(),
        answered: false,          // a tail request of THIS life settled (see `answered`)
      }
      keys.set(key, r)
    }
    return r
  }
  const _session = (r) => ([...r.sessions.keys()].includes('eth') ? 'eth' : 'rth')

  // ── one request ───────────────────────────────────────────────────────────
  // ⭐ D/W/M SPLIT (the legacy chart's Phase 5, utils/barsHistorySplit.js): the origin answers only
  // the recent tail (first-paint depth); everything older comes from the edge-cached sealed history,
  // asked once per key life right after the tail answer. A history answer that fails, is not sealed,
  // or disagrees at the join turns the split off for the key and the full depth is asked from
  // /api/bars, as before the split.
  const _splitFor = (r, p) => !!p && isDateTf(p.tf) && !p.window && !r.splitOff && barsHistorySplitEnabled()

  // `full`: never a `since=` delta (the switch's one re-ask of an own answer still behind: prefetch._askOwn)
  function _tailJob(r, priority, { warm = false, front = false, full = false } = {}) {
    const s = registry.getSnapshot(r.key)
    const p = parseKey(r.key)
    const gen = s.gen
    const session = _session(r)
    const wanted = barsCountFor(r.key, { depth: Math.max(r.depth, s.depthFloor || 0), session })
    const split = _splitFor(r, p)
    const bars = split ? Math.min(wanted, FIRST_PAINT_BARS) : wanted
    const from = deltaStartFor(s, p)
    const delta = !full && from != null && deltaWithinBudget(p.tf, from, now(), bars)
    lastDelta.delete(r.key)
    lastDelta.set(r.key, !!delta)
    if (lastDelta.size > 1000) lastDelta.delete(lastDelta.keys().next().value)
    // `&warm=1` (a best-effort warm the server may skip / shed under load) exactly where the
    // legacy warmers send it; never on a subscriber's own poll.
    const url = barsUrl(r.key, { bars, since: delta ? from - 1 : null, session }) + (warm ? '&warm=1' : '')
    return _send(r, 'tail', url, priority, async (json) => {
      if (json?.no_data) {
        registry.dispatch(r.key, { type: ACTION.REST_ERROR, key: r.key, gen, payload: { error: 'no_data', terminal: true } })
        return { noData: true }
      }
      if (!json || !Array.isArray(json.bars) || json.error) {
        registry.dispatch(r.key, { type: ACTION.REST_ERROR, key: r.key, gen, payload: { error: json?.error || 'bad_answer' } })
        return { error: true, retryAfterSec: json?.retry_after ?? null }
      }
      const type = delta ? ACTION.REST_DELTA : ACTION.REST_FULL
      // a device join waiting for idle on this key goes first, in this task, when this answer can keep some of it
      // (persist.flushJoins)
      try { beforeAnswer?.(r.key, json) } catch { /* a device copy is optional */ }
      const after = registry.dispatch(r.key, { type, key: r.key, gen, payload: delta ? { ...json, since: from } : json })
      // only when more was wanted than the capped tail asked for (today's bar is the developing one,
      // never a row, so `depth` alone would read a full first-paint answer as one bar short).
      // ⭐ WANTED AT ANSWER TIME (2026-11-19): a caller that JOINED this request asking for more
      // depth (the daily handoff joining the typed warm's tail) raised `r.depth` after the request
      // left; read at the start only, its history was never asked.
      const wantNow = Math.max(wanted, barsCountFor(r.key, { depth: Math.max(r.depth, s.depthFloor || 0), session }))
      if (split && !r.histAsked && wantNow > bars && wantNow > (after?.depth ?? 0)) {
        r.histAsked = true
        r.queue.push({ run: () => _historyJob(r), resolve: () => {} })
      }
      return { ok: true, delta, retryAfterSec: json.retry_after ?? null }
    }, { front })
  }

  /** The deep history URL of a D/W/M key as its history job will ask it (calendar `d` for D, the held
   *  bars' sealed date for W/M), or null where the split does not apply or W/M holds nothing yet. */
  function _deepUrl(key) {
    const p = parseKey(key)
    if (!p || !isDateTf(p.tf) || p.window || !barsHistorySplitEnabled()) return null
    const held = registry.peek(key)?.bars || []
    const sealed = historySealedDate(p.tf, held.map((b) => unixToDateLabel(b.t)), now())
    return sealed ? barsHistoryUrl(p.sym, p.tf, sealed) : null
  }
  /** A primed answer of `url` still fresh, or null. */
  function _primed(url) {
    const e = deepPrimes.get(url)
    if (!e) return null
    if (now() - e.at >= DEEP_PRIME_TTL_MS) { deepPrimes.delete(url); return null }
    return e.p
  }
  const _wantedNow = (key) => {
    const until = deepWanted.get(key)
    if (until == null) return false
    if (now() < until) return true
    deepWanted.delete(key)
    return false
  }
  /** The key's history join settled (rows added, nothing older, or the split turned off for it). */
  function _settleDeep(key) {
    deepWanted.delete(key)
    const held = registry.peek(key)?.bars.length
    if (held != null) {
      deepSettled.delete(key)
      deepSettled.set(key, held)
      if (deepSettled.size > LAKE_SETTLED_MAX) deepSettled.delete(deepSettled.keys().next().value)
    }
    for (const cb of [...(deepSubs.get(key) || [])]) { try { cb() } catch { /* ignore */ } }
  }

  /** The deep sealed history of a D/W/M key from the edge (see `_splitFor`). */
  function _historyJob(r) {
    const s = registry.getSnapshot(r.key)
    const p = parseKey(r.key)
    const gen = s.gen
    const sealed = historySealedDate(p.tf, s.bars.map((b) => unixToDateLabel(b.t)), now())
    const url = barsHistoryUrl(p.sym, p.tf, sealed)
    // A display waiting on this join asks at `visible` (never queued behind the warms).
    const priority = _wantedNow(r.key) ? 'visible' : (r.refs > 0 ? 'urgent' : 'background')
    // The answer a prime already fetched (or is fetching) is taken, once: no second request, no
    // second parse. A prime that failed asks again here.
    const primed = _primed(url)
    if (primed) deepPrimes.delete(url)
    const viaPrime = primed
      ? { fetch: (signal) => primed.catch(() => request(url, { priority, signal })) }
      : undefined
    return _send(r, 'scroll', url, priority, async (json) => {
      if (!json?.sealed || !Array.isArray(json.bars)) return { error: true }
      if (json.ticker && String(json.ticker).toUpperCase() !== p.sym) return { error: true }
      const rows = json.bars.map((b) => (typeof b?.t === 'string' ? { ...b, t: dateLabelToUnix(b.t) } : b))
      const before = registry.getSnapshot(r.key)
      if (rows.length && prependOlder(before.bars, rows) === before.bars) {
        // nothing older, or another price basis at the join: refused whole (#1116's seam rule)
        return rows.some((b) => before.bars.length && b.t < before.bars[0].t) ? { error: true } : { ok: true, added: 0 }
      }
      if (!rows.length) return { ok: true, added: 0 }
      const after = registry.dispatch(r.key, { type: ACTION.SCROLL_BACK, key: r.key, gen, payload: { bars: rows, ticker: p.sym } })
      return { ok: true, added: (after?.depth ?? 0) - before.depth, source: 'history' }
    }, viaPrime).then((res) => {
      if (res?.error && keys.get(r.key) === r) {
        // the edge could not give it: the full depth from /api/bars, as before the split
        r.splitOff = true
        _queueTail(r, r.priority)
        _drain(r)
      }
      // A waiting display stops waiting on any outcome but an abort (a failure's full read comes
      // through the tail, as before).
      if (!res?.aborted) _settleDeep(r.key)
      return res
    })
  }

  /** Does the lake carry `key` (intraday, not a replay window, the lake on, not exhausted for it)? */
  function lakeCarriesKey(key) {
    if (!history) return false
    const p = parseKey(key)
    return !!p && !p.window && isIntradayTf(p.tf) && !keys.get(key)?.lakeDone
  }

  const _lakeCarries = (r) => {
    const p = parseKey(r.key)
    return !!p && !p.window && isIntradayTf(p.tf) && !r.lakeDone
  }

  /** Scroll-back: the lake first where it carries the key, then the server's window. A lake that
   *  has nothing older, fails, or disagrees at the join hands over to the server window, queued
   *  behind whatever took the slot meanwhile (≤1 request per key still holds). */
  function _scrollJob(r, opts) {
    if (!history || !_lakeCarries(r)) return _serverScrollJob(r, opts)
    return _lakeScrollJob(r, opts).then((res) => {
      if (res?.aborted || res?.ok) return res
      if (res?.exhausted) r.lakeDone = true            // nothing older in the lake: stop asking it
      return new Promise((resolve) => { r.queue.push({ run: () => _serverScrollJob(r, opts), resolve }); _drain(r) })
    })
  }

  function _lakeScrollJob(r, opts) {
    const s = registry.getSnapshot(r.key)
    const oldest = s.bars.length ? s.bars[0].t : s.developing?.t
    if (!finite(oldest)) return Promise.resolve({ empty: true })
    const gen = s.gen
    // A lake window is as big as a piece (historyPrepend LAKE_WINDOW_BARS), never smaller than asked.
    const want = Math.max(opts.bars ?? HISTORY_WINDOW_BARS, LAKE_WINDOW_BARS)
    return _send(r, 'scroll', `lake:${r.key}<${oldest}`, opts.priority || 'urgent', async (got) => {
      if (!got || !Array.isArray(got.bars) || !got.bars.length) return { fallback: true, exhausted: got?.exhausted === true }
      // (an answer from before a reset is dropped by the reducer: it carries the gen it was asked at)
      const before = registry.getSnapshot(r.key)
      // ⛔⛔ THE LAKE MUST REACH THE CHART (2026-11-17, production). The lake is published up to a date
      // (it ended Fri 11-13 19:59 ET), while the chart's server bars start where its window starts: on
      // 1m for AAPL/NVDA that was Mon 11-16 ~12:30 ET, so Monday's premarket and morning were in
      // NEITHER. `prependOlder` checks the price basis only when the lake HAS the bar at the join, so a
      // lake that ends before the chart's oldest bar was joined straight across the hole: a chart with
      // missing hours, growing every day the lake is not extended. The lake window is used only when it
      // contains the chart's oldest bar (proof the two meet); otherwise the server's window answers this
      // scroll (no hole), and a later scroll, once the chart reaches back into the lake, uses the lake.
      const joinT = before.bars.length ? before.bars[0].t : null
      if (joinT == null || !got.bars.some((b) => b.t === joinT)) return { fallback: true, gap: true }
      // the same seam rule as the server's window: another price basis at the join is refused whole
      if (prependOlder(before.bars, got.bars) === before.bars) return { fallback: true }
      const after = registry.dispatch(r.key, { type: ACTION.SCROLL_BACK, key: r.key, gen, payload: { bars: got.bars } })
      return { ok: true, added: after.depth - before.depth, source: 'lake' }
    }, { fetch: (signal) => history.olderBars(r.key, oldest, { bars: want, signal }) })
  }

  function _serverScrollJob(r, opts) {
    const s = registry.getSnapshot(r.key)
    const oldest = s.bars.length ? s.bars[0].t : s.developing?.t
    if (!finite(oldest)) return Promise.resolve({ empty: true })
    const gen = s.gen
    const url = historyUrl(r.key, oldest, { bars: opts.bars, session: _session(r) })
    if (!url) return Promise.resolve({ empty: true })
    return _send(r, 'scroll', url, opts.priority || 'urgent', async (json) => {
      if (!json || !Array.isArray(json.bars)) return { error: true }
      const before = registry.getSnapshot(r.key)
      // ⛔ `filling` IS NOT "NOTHING OLDER". The server answers a window it is still fetching
      // with the rows it holds, `filling: true` and Retry-After 3 (bars_fetch `to-filling`).
      // Read as refused/exhausted it ended the chart's deep history for good: production
      // 2026-11-15, 4 of 10 60m charts stayed at ~470-510 bars. It is reported as such and the
      // caller asks again (the legacy loader's rule, utils/historyPrepend.js).
      const filling = json.filling === true
      // #1116's seam rule: nothing older, or a window on another basis ⇒ refused whole.
      if (prependOlder(before.bars, json.bars) === before.bars) {
        return filling ? { ok: true, added: 0, filling: true, retryAfterMs: 3000 } : { ok: true, added: 0, refused: true }
      }
      const after = registry.dispatch(r.key, { type: ACTION.SCROLL_BACK, key: r.key, gen, payload: json })
      return { ok: true, added: after.depth - before.depth, ...(filling ? { filling: true, retryAfterMs: 3000 } : {}) }
    })
  }

  function _send(r, kind, url, priority, onJson, { front = false, fetch: fetchFn = null } = {}) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
    r.lastStart = now()
    requests++
    // Read at failure time: the lane may have rewritten a queued warm into a non-warm request.
    const rec = { ac, kind, promise: null, url, priority, warm: /[?&]warm=1(?:&|$)/.test(url), followUp: null }
    // ⛔ A SHED WARM IS NOT THE CHART'S ERROR. A best-effort `&warm=1` that failed while a chart
    // subscribes to the key says nothing about the chart's data: no REST_ERROR (the chart's own
    // non-warm request, queued behind it, owns the answer).
    const quiet = () => rec.warm && r.refs > 0
    const promise = (async () => {
      let json
      try {
        json = fetchFn
          ? await fetchFn(ac?.signal ?? null)
          : await request(url, { priority, signal: ac?.signal ?? null, ...(front ? { front: true } : {}) })
      } catch (e) {
        if (_isAbort(e) || ac?.signal.aborted) return { aborted: true }
        if (quiet()) return { error: true, warmShed: true, retryAfterMs: e?.retryAfterMs ?? null }
        const gen = registry.getSnapshot(r.key).gen
        if (kind === 'tail') {
          registry.dispatch(r.key, { type: ACTION.REST_ERROR, key: r.key, gen, payload: { error: e?.warming ? 'warming' : String(e?.status || 'network') } })
          _noteAnswered(r)
        }
        return { error: true, retryAfterMs: e?.retryAfterMs ?? null }
      }
      if (ac?.signal.aborted) return { aborted: true }   // a joined request outlived our abort
      if (json?.error && !json.no_data && quiet()) return { error: true, warmShed: true, retryAfterSec: json.retry_after ?? null }
      const out = await onJson(json)
      if (kind === 'tail') _noteAnswered(r)
      return out
    })()
    rec.promise = promise
    r.inflight = rec
    promise.finally(() => {
      if (r.inflight?.promise === promise) r.inflight = null
      _drain(r)
    })
    return promise
  }

  /** Run the next queued job once the slot is free. */
  function _drain(r) {
    if (r.inflight || !r.queue.length) return
    const job = r.queue.shift()
    job.started = job.run()
    job.started.then(job.resolve, job.resolve)
  }

  /** A tail request for `r` — joins the one in flight; queued (its `.job`) behind a scroll-back. */
  function _queueTail(r, priority, opts) {
    const job = { run: () => _tailJob(r, priority, opts), resolve: null, started: null, waiters: 1 }
    const out = new Promise((resolve) => { job.resolve = resolve; r.queue.push(job) })
    out.job = job
    return out
  }

  function _tail(r, priority = r.priority, opts = {}) {
    const inf = r.inflight
    if (inf?.kind === 'tail') {
      const best = _best(inf.priority, priority)
      // ⛔ A NON-WARM CALLER NEVER RIDES A `&warm=1` REQUEST (#1118 finding 4): the server may
      // shed a warm, and the chart would get 'warming' for its own data.
      if (inf.warm && !opts.warm) {
        const plain = inf.url.replace(/&warm=1(?=&|$)/, '')
        let moved = 0
        try { moved = promote?.(inf.url, best, { to: plain }) || 0 } catch { moved = 0 }
        if (moved) {
          // Still queued in the lane: it now IS the caller's non-warm request.
          inf.url = plain; inf.warm = false; inf.priority = best
          return inf.promise
        }
        // Already on the network: one non-warm tail right behind it (shared by every non-warm
        // joiner); the warm's answer, if it comes, merges first.
        if (inf.followUp && r.queue.includes(inf.followUp.job)) { inf.followUp.job.waiters++; return inf.followUp }
        inf.followUp = _queueTail(r, priority, { ...opts, warm: false })
        return inf.followUp
      }
      // Joining a request still WAITING in the lane at a worse rank (a warm, then the chart
      // mounts): it is raised to the joiner's rank — the chart never waits behind the herd.
      if (best !== inf.priority) {
        inf.priority = best
        try { promote?.(inf.url, best) } catch { /* the lane is best-effort here */ }
      }
      return inf.promise
    }
    if (inf) return _queueTail(r, priority, opts)
    return _tailJob(r, priority, opts)
  }

  // ── the loop ──────────────────────────────────────────────────────────────
  function _schedule(r, ms) {
    if (r.timer != null) clearTimer(r.timer)
    r.timer = setTimer(() => { r.timer = null; _tick(r) }, Math.max(0, ms))
  }

  async function _tick(r) {
    if (r.refs <= 0 || keys.get(r.key) !== r) return
    if (isHidden()) { r.paused = true; return }
    const res = await _tail(r)
    if (r.refs <= 0 || keys.get(r.key) !== r || res?.aborted) return
    const ms = _nextDelay(r, res)
    if (Number.isFinite(ms)) _schedule(r, ms)   // a windowed (replay) key is read once
  }

  function _nextDelay(r, res) {
    const s = registry.getSnapshot(r.key)
    const p = parseKey(r.key)
    if (res?.noData) return NO_DATA_POLL_MS
    if (res?.error) {
      r.errors++
      const backoff = Math.min(ERROR_RETRY_MAX_MS, ERROR_RETRY_MS * 2 ** Math.min(r.errors - 1, 8))
      const ra = finite(res.retryAfterMs) ? res.retryAfterMs : (Number(res.retryAfterSec) > 0 ? Number(res.retryAfterSec) * 1000 : 0)
      return Math.max(backoff, Math.min(ra, ERROR_RETRY_MAX_MS))
    }
    r.errors = 0
    // A delta that found a new history needs the full read NOW (bounded: needsFull clears on it).
    if (res?.delta && s.needsFull) return 0
    if (!isIntradayTf(p.tf) || p.window) return p.window ? Infinity : dailyPollMs
    const tailT = s.developing ? s.developing.t : (s.bars.length ? s.bars[s.bars.length - 1].t : null)
    const spent0 = _exhausted(r)
    const ms = nextTailPollMs(r.pollSt, r.key, { tailT, tf: p.tf, tailStatus: s.tailStatus, retryAfterSec: res?.retryAfterSec ?? null })
    _noteBudget(r.key, spent0, _exhausted(r))
    const floor = intradayDedupMs({ tailClass: tailT ? classifyIntradayTail(tailT, p.tf) : null, tailStatus: s.tailStatus })
    return Math.max(ms, Math.min(floor, INTRADAY_POLL_MS))
  }

  const offVisible = onVisible(() => {
    for (const r of keys.values()) if (r.paused && r.refs > 0) { r.paused = false; _schedule(r, 0) }
  })

  const _gc = (r) => { if (r.refs <= 0 && !r.inflight && !r.queue.length && keys.get(r.key) === r) keys.delete(r.key) }

  const api = {
    /** Start (refcount) the loop for `key`. First start requests immediately. */
    start(key, { session = 'rth', priority = 'visible', depth = 0 } = {}) {
      const r = _rec(key)
      r.refs++
      r.sessions.set(session, (r.sessions.get(session) || 0) + 1)
      r.priority = _best(r.priority, priority)
      r.depth = Math.max(r.depth, depth || 0)
      if (r.refs === 1) {
        _schedule(r, 0)
        // the lake's first window, fetched IN PARALLEL with this first request (historyFeed `prime`)
        if (history?.prime && _lakeCarries(r)) { try { history.prime(key) } catch { /* a warm only */ } }
      }
      let done = false
      return () => {
        if (done) return
        done = true
        const n = (r.sessions.get(session) || 1) - 1
        if (n > 0) r.sessions.set(session, n); else r.sessions.delete(session)
        api.stop(key)
      }
    },
    /** Drop one ref; the last one aborts the request in flight and clears the timer. */
    stop(key) {
      const r = keys.get(key)
      if (!r) return
      if (--r.refs > 0) return
      if (r.timer != null) { clearTimer(r.timer); r.timer = null }
      if (r.inflight) { r.inflight.ac?.abort(); r.inflight = null }
      for (const j of r.queue.splice(0)) j.resolve({ aborted: true })
      const spent = _exhausted(r)
      keys.delete(key)
      _noteBudget(key, spent, false)
    },
    setPriority(key, priority) { const r = keys.get(key); if (r) r.priority = priority },
    /** Prime the lake for `key` now (historyFeed `prime`: index + newest pieces into the HTTP cache),
     *  ahead of its open: a typed ticker or a row the pointer rests on. No-op where it does not carry. */
    primeLake(key) {
      if (!history?.prime || !lakeCarriesKey(key)) return
      try { history.prime(key) } catch { /* a warm only */ }
    },
    /** Warm the EDGE's copy of `key`'s whole lake depth (historyFeed `edgeWarm`: index into the page,
     *  pieces HEADed, no body). Resolves the pieces asked; 0 where the lake does not carry. */
    lakeEdgeWarm(key, opts) {
      if (!history?.edgeWarm || !lakeCarriesKey(key)) return Promise.resolve(0)
      try { return Promise.resolve(history.edgeWarm(key, opts)).catch(() => 0) } catch { return Promise.resolve(0) }
    },
    /**
     * ⭐ LAKE FIRST PAINT (2026-11-17). A chart with nothing saved in this browser waits on the bar
     * server's first answer, and a cold read there can take seconds (FROG 5m: `bars(sqlite)=1523`,
     * first paint 1,326 ms) while the lake pieces holding the same history were ALREADY in the
     * browser (primed while the ticker was typed). So when the key holds nothing and no server answer
     * has landed, its newest lake bars are painted at once as an UNSTAMPED local copy (LAKE_HIT):
     * provisional / context, never persisted, and the server's full answer keeps those rows only where
     * their overlap with its own rows proves the same basis (reducer applyRest), discarding them
     * otherwise, so a lake that ends early can never be joined across a hole. A lake hit that arrives
     * after the answer only adds deeper rows on a proven overlap (applyLocal). Resolves true when painted.
     */
    /** Is `sym` in the lake (its index exists)? False without a lake; never rejects. */
    lakeHas(sym) {
      if (!history?.hasSymbol) return Promise.resolve(false)
      return history.hasSymbol(sym)
    },
    // ⭐ A LOCAL COPY ALREADY HELD DOES NOT SHUT THE LAKE OUT (2026-11-17). Measured on never-opened
    // tickers with the answer held 1.5 s: 3 of 4 held the universe pack's 240 newest 5m rows
    // (provisional, no server answer) before Enter, and this refused because the key held ANY bars,
    // so the chart waited out the answer. Now only a held SERVER answer refuses (the chart's own
    // scroll-back reaches the lake then); a held local copy is joined by the reducer only where the
    // lake's rows prove its price basis over the bars they share (applyLocal), and the seed counts as
    // painted only when rows were actually added.
    //
    // ⭐ ONE LOAD, THE WHOLE DEPTH (2026-11-17, owner: "it shows a good chunk, then the rest a quick
    // blink later"). The lake's newest lakeTargetBars(tf) come in ONE load (the background
    // depth the chart would otherwise reach in steps after the first paint), and a load that lands
    // AFTER the server's answer still joins: the reducer adds only the rows older than what is held,
    // and only where the shared bars prove the held basis. Resolves 'seed' (rows added before any
    // server answer), 'join' (deeper rows added to an answer) or false; one load per key at a time
    // (the handoff and the chart's subscribe share it), none once the key is that deep.
    // ⭐ ONE PIECE PER TASK, UNLESS A PAINT WAITS (smoothness 2b, 2026-11-26): the load's pieces decode in tasks of their
    // own (historyLake/source `yieldTask`), so a join landing after the chart painted leaves room for frames. A caller that
    // WAITS on the load to paint (`awaited`: the handoff, prefetch._lakeLoad) marks the key, and from then on every piece
    // of that load decodes at once, as before: a first frame is never later for it. Unmarked when the load settles.
    lakeSeed(key, { awaited = false } = {}) {
      if (!history?.olderBars || !lakeCarriesKey(key)) return Promise.resolve(false)
      const target = lakeTargetBars(parseKey(key)?.tf)
      if ((registry.peek(key)?.bars.length ?? 0) >= target) return Promise.resolve(false)
      if (awaited) lakeAwaited.add(key)
      const running = lakeSeeds.get(key)
      if (running) return running
      const yieldTask = () => (lakeAwaited.has(key) ? null : nextTask())
      const p = Promise.resolve()
        .then(() => history.olderBars(key, Math.floor(now() / 1000) + 1, { bars: target, yieldTask }))
        .then((got) => {
          const cur = registry.peek(key)
          if (!got || !Array.isArray(got.bars) || !got.bars.length || !cur) return false
          const before = cur.bars.length
          registry.dispatch(key, { type: ACTION.LAKE_HIT, key, payload: { sym: parseKey(key)?.sym, bars: got.bars } })
          const after = registry.peek(key)
          if (!after || after.bars.length <= before) return false
          return after.restSeen ? 'join' : 'seed'
        })
        .catch(() => false)
        .finally(() => {
          if (lakeSeeds.get(key) === p) { lakeSeeds.delete(key); lakeAwaited.delete(key) }
          const cur = registry.peek(key)
          const held = cur?.bars.length
          if (held == null) return          // nothing to join into: still due when the key is built
          // Before a server answer a settle never LOWERS the depth an earlier load reached (review of
          // #1884): a load refused by a saved copy that replaced the lake's rows would otherwise mark
          // the depth done while the chart is shallow, and it would come back in scroll-back steps.
          // An answered entry settles at what it holds (the answer proved it): no load loops.
          const prev = lakeSettled.get(key)
          const depth = !cur.restSeen && prev != null ? Math.max(prev, held) : held
          lakeSettled.delete(key)
          lakeSettled.set(key, depth)
          if (lakeSettled.size > LAKE_SETTLED_MAX) lakeSettled.delete(lakeSettled.keys().next().value)
        })
      lakeSeeds.set(key, p)
      return p
    },
    /** Is the lake's whole depth still DUE for `key`: the lake carries it, it holds less than that
     *  depth, and its lake load has not finished on this page (in flight, or never asked)? The
     *  handoff's fast path then waits for the join instead of painting a shallow copy (prefetch). */
    lakePending(key) {
      if (!history?.olderBars || !lakeCarriesKey(key)) return false
      const held = registry.peek(key)?.bars.length ?? 0
      if (held >= lakeTargetBars(parseKey(key)?.tf)) return false
      const settled = lakeSettled.get(key)
      return settled == null || held < settled
    },
    /**
     * Is the deep sealed history of D/W/M `key` still DUE (see `deepPrimes`)? The split applies, the
     * entry holds no more than one tail answer's rows (a deeper copy, here or saved in this browser,
     * had its history joined), and its join has not settled on this page at the depth it holds now.
     */
    deepPending(key) {
      const p = parseKey(key)
      if (!p || !isDateTf(p.tf) || p.window || !barsHistorySplitEnabled()) return false
      if (keys.get(key)?.splitOff) return false
      const held = registry.peek(key)?.bars.length ?? 0
      if (held > FIRST_PAINT_BARS) return false
      const settled = deepSettled.get(key)
      return settled == null || held < settled
    },
    /**
     * Fetch `key`'s deep history NOW, ahead of the tail answer its job waits for (the job takes this
     * answer, see `_historyJob`). `want`: a display is waiting on the join, so the job leaves at
     * `visible` rank. Resolves true when the history arrived; never rejects. Nothing when the history
     * is not due or its URL cannot be known yet (W/M holding no bars).
     */
    deepPrime(key, { priority = 'urgent', want = false } = {}) {
      if (!api.deepPending(key)) return Promise.resolve(false)
      if (want) deepWanted.set(key, now() + DEEP_WANT_MS)
      // The depth was lost since the key's last join (the entry was evicted and rebuilt): ask again.
      const r = keys.get(key)
      if (r?.histAsked && !(r.inflight?.kind === 'scroll') && deepSettled.has(key)) r.histAsked = false
      const url = _deepUrl(key)
      if (!url) return Promise.resolve(false)
      const have = _primed(url)
      if (have) return have.then(() => true, () => false)
      const p = Promise.resolve().then(() => request(url, { priority }))
      deepPrimes.set(url, { p, at: now() })
      p.catch(() => { if (deepPrimes.get(url)?.p === p) deepPrimes.delete(url) })
      while (deepPrimes.size > DEEP_PRIME_MAX) deepPrimes.delete(deepPrimes.keys().next().value)
      return p.then(() => true, () => false)
    },
    /** Resolves true when `key`'s history join settles (at once when it is not due), false after
     *  `ms`. Never rejects. */
    deepJoined(key, ms = DEEP_WANT_MS) {
      if (!api.deepPending(key)) return Promise.resolve(true)
      return new Promise((resolve) => {
        let set = deepSubs.get(key)
        if (!set) deepSubs.set(key, (set = new Set()))
        let timer = null
        const done = (v) => {
          if (timer != null) clearTimer(timer)
          set.delete(cb)
          if (!set.size && deepSubs.get(key) === set) deepSubs.delete(key)
          resolve(v)
        }
        const cb = () => done(true)
        set.add(cb)
        timer = setTimer(() => done(false), Math.max(0, ms))
      })
    },
    /** Would a scroll-back of `key` ask the history lake (intraday, not a replay window, the lake on
     *  and not found exhausted for this key)? Sets the background depth target (historyPrepend). */
    lakeCarries(key) { return lakeCarriesKey(key) },
    /** Poll `key` now. `abort`: drop the request in flight first (invalidate). */
    kick(key, { abort = false } = {}) {
      const r = keys.get(key)
      if (!r || r.refs <= 0) return
      if (abort && r.inflight) { r.inflight.ac?.abort(); r.inflight = null }   // its answer is dropped
      // An explicit kick (stream reconnect, invalidate) still never sends two requests
      // inside the repair dedupe window — unless it aborted the one in flight.
      _schedule(r, abort ? 0 : Math.max(0, REPAIR_DEDUP_MS - (now() - r.lastStart)))
    },
    /**
     * One request for `key` (ensure / prefetch), sharing the key's single slot.
     * `signal`: the caller's abort (a symbol switch). One-shot waiters are REF-COUNTED like
     * the lane's joiners: a caller's abort only detaches that caller, and the tail request in
     * flight is aborted only when the last one-shot waiter has left AND no subscriber holds
     * the key — a prefetch or a mounted chart riding the same request never loses it.
     */
    fetchOnce(key, { priority = 'urgent', depth = 0, session = 'rth', signal = null, warm = false, front = false, full = false } = {}) {
      if (signal?.aborted) return Promise.resolve({ aborted: true })
      const r = _rec(key)
      r.depth = Math.max(r.depth, depth || 0)
      if (!r.sessions.size) r.sessions.set(session, 0)
      // A key a chart is subscribed to is LIVE: a one-shot ask of it rides the chart's rank and
      // never goes out as a shed-able `&warm=1` warm.
      const live = r.refs > 0
      const out = _tail(r, live ? _best(r.priority, priority) : priority, live ? { front, full } : { warm, front, full })
      r.once = (r.once || 0) + 1
      let left = false
      const leave = () => { if (!left) { left = true; r.once-- } }
      const onAbort = () => {
        leave()
        // Still QUEUED (behind a scroll-back): the job is this caller's alone — drop it, so it
        // never reaches the network.
        const qi = out.job ? r.queue.indexOf(out.job) : -1
        if (qi >= 0) {
          if (--out.job.waiters > 0) return            // another caller still waits on it
          r.queue.splice(qi, 1); out.job.resolve({ aborted: true }); return
        }
        if (r.once > 0 || r.refs > 0) return
        const running = out.job ? out.job.started : out
        if (r.inflight?.kind === 'tail' && r.inflight.promise === running) { r.inflight.ac?.abort(); r.inflight = null }
      }
      signal?.addEventListener?.('abort', onAbort, { once: true })
      out.finally(() => { signal?.removeEventListener?.('abort', onAbort); leave(); _gc(r) })
      return out
    },
    /** Prepend one older window. Serialized behind the key's tail request. */
    scrollBack(key, { bars = HISTORY_WINDOW_BARS, priority = 'urgent' } = {}) {
      const r = _rec(key)
      const run = () => _scrollJob(r, { bars, priority })
      const out = r.inflight ? new Promise((resolve) => { r.queue.push({ run, resolve }) }) : run()
      out.finally(() => _gc(r))
      return out
    },
    /**
     * ⭐ THE DELAYED SIGNAL. True while `key`'s fast catch-up budget (intradayTailPoll
     * TAIL_CATCHUP_MAX_TRIES) is SPENT: the tail is still behind / unverified after every fast
     * retry and the loop has fallen back to the 30 s cadence. It clears when a poll finds the
     * tail current (nextTailPollMs resets the budget) or the key stops. The chart maps it onto
     * its currentness badge (UPDATING → DELAYED).
     */
    tailExhausted(key) { return _exhausted(keys.get(key)) },
    /** Was `key`'s last tail request a `since=` delta? null when none is known. (prefetch._reaskWhole: a full read is
     *  never followed by another full read, review of #2708 LOW a) */
    askedDelta(key) { return lastDelta.has(key) ? lastDelta.get(key) : null },
    /** Listen to `tailExhausted(key)` flips. Returns the unsubscribe function. */
    subscribeTailBudget(key, cb) {
      let set = budgetSubs.get(key)
      if (!set) { set = new Set(); budgetSubs.set(key, set) }
      set.add(cb)
      return () => { set.delete(cb); if (!set.size && budgetSubs.get(key) === set) budgetSubs.delete(key) }
    },
    /**
     * ⭐ HAS THE SERVER SPOKEN IN THIS LIFE? True once a tail request of `key` settled (rows,
     * no_data or an error — never an aborted request, never a shed `&warm=1` a subscriber
     * ignores) since the key's record was created: its first `start`, or a one-shot ask still
     * riding. A record dies with its last ref (`stop`), so a key re-subscribed later starts
     * unanswered again — whatever its snapshot still holds (an answer or an error from an
     * EARLIER life, taken while no live feed and no poll kept it) is not this life's word.
     * The chart's timeframe-switch hold keys on it (useBarSnapshotBars).
     */
    answered(key) { return !!keys.get(key)?.answered },
    /** Listen to `answered(key)` turning true. Returns the unsubscribe function. */
    subscribeAnswered(key, cb) {
      let set = answerSubs.get(key)
      if (!set) { set = new Set(); answerSubs.set(key, set) }
      set.add(cb)
      return () => { set.delete(cb); if (!set.size && answerSubs.get(key) === set) answerSubs.delete(key) }
    },
    /** Requests in flight for `key` (0|1), or across all keys. */
    inflight(key) {
      if (key != null) return keys.get(key)?.inflight ? 1 : 0
      let n = 0
      for (const r of keys.values()) if (r.inflight) n++
      return n
    },
    stats() { return { keys: keys.size, requests, inflight: api.inflight() } },
    dispose() {
      offVisible?.()
      for (const k of [...keys.keys()]) { const r = keys.get(k); r.refs = 1; api.stop(k) }
    },
  }
  return api
}

const _RANK = { visible: 0, urgent: 1, grid: 2, background: 3 }
function _best(a, b) { return (_RANK[b] ?? 3) < (_RANK[a] ?? 3) ? b : a }

export { etDateOf, HISTORY_WINDOW_BARS }
