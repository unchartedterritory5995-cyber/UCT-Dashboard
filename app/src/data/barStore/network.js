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
import { firstPaintBarsFor, fullBarsFor, FIRST_PAINT_BARS, dateCoverMaxFor, dateCoverFor } from '../../utils/barsBackfill'
import { barsSessionQuery } from '../../components/chart/barTime'
import { ACTION, parseKey, isIntradayTf, isDateTf, PERIOD_SEC, unixToDateLabel, dateLabelToUnix } from './types'
import { barsHistorySplitEnabled, historySealedDate } from '../../utils/barsHistorySplit'
import { nextTask } from '../historyLake/source'
import { lakeCopyAddsNothing } from './reducer'
import { _closeMismatch } from '../../utils/barsMerge'

/** (review of #2947, N1) A window answered `filling` is asked again after this many seconds (the server's Retry-After),
 *  at most WINDOW_FILL_ROUNDS times (~30 s), then left to the next chart or warm of the key. */
export const WINDOW_FILL_RETRY_S = 3
export const WINDOW_FILL_ROUNDS = 10

/** (PR 1.1) How long the chart's own read of a window gives the history lake before it asks the origin beside it (a
 *  warm lake answers in tens of ms; a cold one, from R2, in 380-650 ms against the origin's 140-210: measured 2026-11-28). */
export const WINDOW_LAKE_HEAD_START_MS = 80
/** (review of #2986, F-A) Once the origin has answered a window short (or failed), how much longer the lake is waited for. */
export const WINDOW_LAKE_MAX_WAIT_MS = 800
const HEAD_START = Symbol('head start')
const JOINED = Symbol('a non-warm joiner')

/** The D/W/M refresh cadence (StockChart's daily `refreshInterval`). */
export const DAILY_POLL_MS = 300_000
/** Error backoff: first retry, cap. */
export const ERROR_RETRY_MS = 1500
export const ERROR_RETRY_MAX_MS = 30_000
/** (2026-11-28, the cloud sweep) A tail answered 429 or 503 is asked again, at most this many times in a row, before
 *  the key counts as answered with the error: meanwhile a display holding for the key's answer keeps waiting (inside its
 *  hang guard) instead of committing a lake / device copy without its tail as current. */
export const RATE_LIMIT_HOLD_ROUNDS = 3
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
 *  history job to take, and at most this many at once (each ~1-2 MB parsed).
 *  ⭐ (2026-11-28, zero-network plan 1.4 + 1.7, owner: "upgrade rather than downgrade") 16, was 4: the typed candidate
 *  pool (3), the typed slot and its linked charts (up to 3), and a list's neighbour rows (up to 8) each prime one, and at
 *  4 the oldest primes were evicted before their press, so the row the member reached asked its history again at the
 *  flip. ~16-32 MB of client memory at the most, released as each is joined or after the TTL. */
export const DEEP_PRIME_TTL_MS = 120_000
export const DEEP_PRIME_MAX = 16
/** The newest rows the origin answers for a daily view's cover whose deep history the edge brings (`_tailJob`). */
export const EDGE_TAIL_BARS = 30
/** (review of #2938, T1) A cover's edge history not landed this long after the ask: the origin is asked the cover too. */
export const EDGE_FALLBACK_MS = 600

/** A display waiting on a key's deep join (`deepPrime({ want: true })`) sends its history job at
 *  `visible` rank (never queued) for this long. */
export const DEEP_WANT_MS = 5_000

const finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** Bars to ask for: the chart's first-paint count, or the depth a caller ensured. `cover` (D/W/M): the rows a view will
 *  draw (review of #2934, B1: barsBackfill dateCoverFor; 0, a warm, asks the default page). */
export function barsCountFor(key, { depth = 0, session = 'rth', cover = 0 } = {}) {
  const p = parseKey(key)
  if (!p) return FIRST_PAINT_BARS
  const eth = p.session ? p.session === 'eth' : session === 'eth'
  const base = isIntradayTf(p.tf) ? firstPaintBarsFor(p.tf, eth) : dateCoverFor(p.tf, cover)
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

/** A background deepening's window lands within this long even when the page is never idle. */
export const DEEPEN_IDLE_TIMEOUT_MS = 1000
function _inputPending() {
  try { return !!globalThis.navigator?.scheduling?.isInputPending?.() } catch { return false }
}
/**
 * ⭐ (2026-11-27, the second full draw after a switch) Run `fn` in idle time: requestIdleCallback with a timeout so it
 * can never starve, giving way to a key or pointer press that is waiting (navigator.scheduling.isInputPending) until
 * the timeout has passed. No idle signal: the next task. Returns the cancel.
 */
export function idleLand(fn, { timeout = DEEPEN_IDLE_TIMEOUT_MS, now = () => Date.now() } = {}) {
  if (typeof requestIdleCallback !== 'function') {
    const h = setTimeout(fn, 0)
    return () => clearTimeout(h)
  }
  const until = now() + timeout
  let h = null
  const tick = (deadline) => {
    h = null
    const left = until - now()
    if (left > 0 && !deadline?.didTimeout && _inputPending()) { h = requestIdleCallback(tick, { timeout: left }); return }
    fn()
  }
  h = requestIdleCallback(tick, { timeout })
  return () => { if (h != null) { try { cancelIdleCallback(h) } catch { /* gone */ } h = null } }
}

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
  // (fn) => cancel: where a BACKGROUND deepening's window lands (idleLand: idle time, giving way to input; tests pass their own)
  idle = idleLand,
  // (key) => true when the entry already starts at its symbol's first served bar (index.js: persist.deviceWhole, the
  // full-depth daily device copy, zero-network PR 3.2): its deep history join is never due
  wholeHistory = null,
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
  /** (2026-11-28) key -> the depth at which a lake load proved it holds ALL the lake's history (historyFeed `complete`) */
  const lakeComplete = new Map()
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
  // ⭐⭐ (2026-11-28, the cold-coverage run) key -> Set<cb>: listeners of the key's depth SETTLING (its history join or its lake
  // load), whatever it added. A settle that adds nothing moves no entry, so a waiter woken only by the entry (the switch's
  // hold: prefetch.watch) never learned that nothing more was coming, and held the previous chart to the hang guard.
  const settleSubs = new Map()
  function _noteSettled(key) {
    for (const cb of [...(settleSubs.get(key) || [])]) { try { cb() } catch { /* a listener's */ } }
  }
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
  // ⭐⭐ (review of #2947, N1) A WINDOW ANSWERED `filling` IS ASKED AGAIN. The server answers a window it is still fetching
  // with the rows it holds, `filling: true` and Retry-After 3 (bars_fetch `to-filling`; the 3 is a HEADER, the body has no
  // retry_after), and a window key is read once (`_nextDelay`: Infinity) with no lake join or scroll-back. So nothing
  // asked again: `filling` never cleared, heldRows(answered) stayed 0, the handoff waited HANDOFF_HANG_MS, committed short
  // and STAYED short. Now the chart's own ask (not a shed-able warm, unless a chart holds the key) of a window whose
  // answer was filling asks again WINDOW_FILL_RETRY_S later, while the store still holds the key, at most
  // WINDOW_FILL_ROUNDS times; the complete answer clears `filling` and wakes the answered watchers (the handoff's).
  const fillRounds = new Map()   // window key -> { n, timer }
  function _armFillRetry(key) {
    const f = fillRounds.get(key) || { n: 0, timer: null }
    if (f.timer != null || f.n >= WINDOW_FILL_ROUNDS) return
    f.n++
    fillRounds.delete(key)
    fillRounds.set(key, f)
    if (fillRounds.size > 500) { const [k0, f0] = fillRounds.entries().next().value; if (f0.timer != null) clearTimer(f0.timer); fillRounds.delete(k0) }
    f.timer = setTimer(() => {
      f.timer = null
      // (an entry here = the key's last answer was filling: a complete one deletes it, `_send`)
      if (!registry.has(key) || fillRounds.get(key) !== f) { if (fillRounds.get(key) === f) fillRounds.delete(key); return }
      // (review of #2947, LOW) only while something still asks for the key: a chart on it, a one-shot ask in flight, or the
      // entry pinned (the handoff's prepare); a key no chart shows any more is not asked again
      const r = keys.get(key)
      if (!(r?.refs > 0 || r?.once > 0 || (registry.refs?.(key) ?? 0) > 0)) { fillRounds.delete(key); return }
      api.fetchOnce(key, { priority: 'visible', full: true }).catch(() => {})
    }, WINDOW_FILL_RETRY_S * 1000)
  }

  // (the rate-limited tail's repeat for a one-shot ask: `_send`) one timer per key, after Retry-After (bounded), while a
  // one-shot ask or a pin still holds the key
  const limitTimers = new Map()
  // key -> the Set of live waiters' signals (deepPrime wantSignal). Cleared with deepWanted (the join settled, the want
  // expired), so a waiter that finished without aborting leaves nothing behind; at most WANT_HOLDERS_MAX keys.
  const wantHolders = new Map()
  const WANT_HOLDERS_MAX = 500
  const limitRounds = new Map()   // key -> rate-limited tail answers in a row
  function _armLimitRetry(key, retryAfterMs) {
    if (limitTimers.has(key)) return
    const ms = Math.min(ERROR_RETRY_MAX_MS, Math.max(ERROR_RETRY_MS, Number.isFinite(retryAfterMs) ? retryAfterMs : 0))
    limitTimers.set(key, setTimer(() => {
      limitTimers.delete(key)
      const r = keys.get(key)
      if (!registry.has(key) || r?.refs > 0) return   // gone, or a chart's own loop asks again
      if (!(r?.once > 0 || (registry.refs?.(key) ?? 0) > 0)) return
      api.fetchOnce(key, { priority: 'visible' }).catch(() => {})
    }, ms))
    if (limitTimers.size > 500) { const [k0, t0] = limitTimers.entries().next().value; clearTimer(t0); limitTimers.delete(k0) }
  }

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
        cover: 0,                 // D/W/M: the rows a view of this key will draw (barsCountFor `cover`)
        inflight: null,           // { ac, kind, promise }
        side: null,               // the edge fallback's cover tail, beside `inflight` (see _armEdgeFallback)
        queue: [],                // pending scroll-back jobs
        timer: null, paused: false, lastStart: -Infinity, errors: 0,
        pollSt: createTailPollState(),
        answered: false,          // a tail request of THIS life settled (see `answered`)
        filling: false,           // its last tail answer was `filling` (a window the server is still fetching)
      }
      keys.set(key, r)
    }
    return r
  }
  const _session = (r) => ([...r.sessions.keys()].includes('eth') ? 'eth' : 'rth')
  // ⭐ (review of #2935, E1) an entry the registry drops takes its request in flight with it (aborted: its answer is
  // that life's). Its queued jobs stay: one that runs later reads the key's NEW life (no `since=` on an empty entry).
  const offEvict = registry.onEvict?.((key) => {
    const r = keys.get(key)
    if (r?.inflight) { try { r.inflight.ac?.abort() } catch { /* gone */ } r.inflight = null }
    if (r?.side) { try { r.side.ac?.abort() } catch { /* gone */ } r.side = null }
  }) ?? null

  // ── one request ───────────────────────────────────────────────────────────
  // ⭐ D/W/M SPLIT (the legacy chart's Phase 5, utils/barsHistorySplit.js): the origin answers only
  // the recent tail (first-paint depth); everything older comes from the edge-cached sealed history,
  // asked once per key life right after the tail answer. A history answer that fails, is not sealed,
  // or disagrees at the join turns the split off for the key and the full depth is asked from
  // /api/bars, as before the split.
  const _splitFor = (r, p) => !!p && isDateTf(p.tf) && !p.window && !r.splitOff && barsHistorySplitEnabled()

  // `full`: never a `since=` delta (the switch's one re-ask of an own answer still behind: prefetch._askOwn)
  // `fullRead`: the full read a failed edge history queued (F1: its settle, and no other tail's, ends `fullDue`)
  function _tailJob(r, priority, { warm = false, front = false, full = false, side = false, fullRead: asked = false } = {}) {
    // ⛔ (review of #2989, LOW) ANY non-side tail of a split-off key IS its full read (the split off, it asks the whole
    // depth): an abort of the queued one (kick's invalidate, an idle eviction) re-asks through _schedule/_tail without the
    // mark, and only a marked read ended `fullDue`, so the depth stayed "due" for good. Captured when the job runs.
    const fullRead = asked || (!side && !!r.splitOff)
    // (2026-11-28, the cloud sweep) the cover fallback's ONE tail (`_armEdgeFallback`) asks the whole page a view can draw
    const coverPage = !!r.coverPage
    r.coverPage = false
    const s = registry.getSnapshot(r.key)
    const p = parseKey(r.key)
    const gen = s.gen
    const session = _session(r)
    const wanted = barsCountFor(r.key, { depth: Math.max(r.depth, s.depthFloor || 0), session, cover: r.cover })
    const split = _splitFor(r, p)
    let bars = split ? Math.min(wanted, dateCoverFor(p.tf, r.cover)) : wanted
    if (split && coverPage) bars = Math.min(wanted, Math.max(dateCoverFor(p.tf, r.cover), r.cover || 0, dateCoverMaxFor(p.tf)))
    // ⭐⭐ (2026-11-27, approved: the server-tail numbers) THE COVERING DAILY PAGE COMES FROM THE EDGE. A view's cover asked
    // of the origin is a 2,000-row sqlite read and JSON build: 18-275 ms of server work on a cold name (bars-api
    // Server-Timing, production), behind a 76-96 ms network floor. The deep sealed history is edge-cached (br, HIT in
    // 95-152 ms, the floor) and is fetched BESIDE the tail (deepPrime) whenever its join is due. So where a view's cover
    // is asked, the history is due and will be joined (more is wanted than the tail page), the origin answers only the
    // newest EDGE_TAIL_BARS rows: a few ms of server work. The display waits for the join (the daily hold), which brings
    // every covering row in the same frame. A history that fails turns the split off: the full depth from /api/bars.
    // ⛔ (review of #2938, T1) ...BUT NEVER A HOLD ON A COLD EDGE. The history URL carries the sealed date, so a name's
    // first view per POP per trading day is an edge MISS the origin builds (seconds); a 30-row tail then left the hold to
    // the hang guard, which painted 30 bars and filled: the two-phase paint again. So the ask arms a fallback: still
    // unlanded EDGE_FALLBACK_MS later, the origin is asked the view's cover as well, and whichever covers the view first
    // is what the hold commits on (the join then lands behind the left edge).
    // ⭐ (2026-11-28, cold-arch 3.3 item 1) W AND M TOO: their history URL is known from the calendar now (barsHistorySplit
    // calendarSealedDate), so it leaves beside the tail like D's. A cold W cover from the origin was 160-189 ms of server
    // work on production (sqlite get_bars of 2,000 weeks 32-71 ms cold, the W-from-D overlay, the JSON build).
    if (split && isDateTf(p.tf) && r.cover > 0 && wanted > bars && !r.histAsked && !r.edgeFallback && api.deepPending(r.key)) {
      bars = Math.min(bars, EDGE_TAIL_BARS)
      _armEdgeFallback(r)
    } else if (split && r.cover > 0 && wanted > bars && _whole(r.key)) {
      // (zero-network PR 3.2) the entry already holds every older row (a whole device copy): the newest rows are all the
      // origin is asked, and no history follows (`_whole`), so there is nothing to fall back for
      bars = Math.min(bars, EDGE_TAIL_BARS)
    }
    const from = deltaStartFor(s, p)
    const delta = !full && from != null && deltaWithinBudget(p.tf, from, now(), bars)
    lastDelta.delete(r.key)
    lastDelta.set(r.key, !!delta)
    if (lastDelta.size > 1000) lastDelta.delete(lastDelta.keys().next().value)
    // `&warm=1` (a best-effort warm the server may skip / shed under load) exactly where the
    // legacy warmers send it; never on a subscriber's own poll.
    const url = barsUrl(r.key, { bars, since: delta ? from - 1 : null, session }) + (warm ? '&warm=1' : '')
    const viaLake = _windowFromLake(r, p) ? { fetch: (signal, rec) => _windowRead(r, url, bars, priority, signal, { warm, front, rec }), viaLake: true } : null
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
      const wantNow = Math.max(wanted, barsCountFor(r.key, { depth: Math.max(r.depth, s.depthFloor || 0), session, cover: r.cover }))
      // ⭐ ONCE PER PAGE WHILE HELD (2026-11-27): `wantNow` is the full 12,500 for D, deeper than almost any name's
      // history, so after a join the depth stays under it and only `histAsked` (this record's) stopped a repeat; the
      // record goes when the last chart leaves the key, and every return re-asked the history to join nothing older.
      // A join that settled on this page at a depth the entry still holds is not asked again (`_deepJoinedAt`).
      const heldNow = after?.bars?.length ?? 0
      const joinedHere = heldNow > dateCoverMaxFor(p.tf) && _deepJoinedAt(r.key, heldNow)
      // ⭐⭐ (2026-11-28, COV-zo-wm-typed SPGI / AMH held to the 4 s hang guard) A DEPTH LEFT "DUE" IS A HISTORY ASKED. A
      // monthly view zoomed out asks its cover (1,187 rows) and no deeper depth, so `wantNow` was the ask and no history was
      // queued, while deepPending still read "due" (held <= DATE_COVER_MAX, never joined): the daily hold waited for a join
      // nothing would bring. Where a view's cover was asked (`r.cover`: a shown, typed or linked key, never a warm, B1) and
      // the depth is still due after the answer, the history is asked; its join (or its "nothing older") settles it.
      // (A tail shorter than its ask is NOT proof the listing ended: the origin may hold less than the edge's history.)
      const coverDue = r.cover > 0 && api.deepPending(r.key)
      if (split && !r.histAsked && !joinedHere && !_whole(r.key) && ((wantNow > bars && wantNow > (after?.depth ?? 0)) || coverDue)) {
        r.histAsked = true
        r.queue.push({ run: () => _historyJob(r), resolve: () => {} })
      }
      // ⭐ (review of #2947, N1) a window's `filling` answer (bars_fetch `to-filling`: Retry-After 3 is a HEADER only, the
      // body has no retry_after) is asked again (`_armFillRetry`, in bounded rounds) until it is complete
      const filling = json.filling === true
      return { ok: true, delta, retryAfterSec: json.retry_after ?? (filling ? WINDOW_FILL_RETRY_S : null), ...(filling ? { filling: true } : {}) }
    }, { front, side, fullRead, ...(viaLake || {}) })
  }

  // ⭐⭐ A CHART AT A PAST DATE READS THE LAKE (2026-11-28, zero-network plan PR 1.1). A windowed intraday key (`@to=`: the
  // chart anchored at a date, replay) is read ONCE, whole (`_nextDelay`: Infinity), and that read went to the origin's
  // `/api/bars?to=` (95-130 ms server-cold, a store miss a vendor replay of seconds) although the history lake at the edge
  // holds the same bars. Its read now asks the lake first (historyFeed `windowBars`: the newest `bars` bars at or before the
  // origin's cutoff) and lands EXACTLY as the origin's answer would (the same `{ ticker, tf, bars }` shape, the same
  // REST_FULL, the same `answered`), so every reader of a window (the switch, the double buffer, heldRows) is unchanged and
  // the chart draws it once. The origin answers instead when:
  //   - the lake cannot: no index or series, the window's day past the lake's newest session (a `to` the lake has not
  //     published yet MUST use the origin), nothing at or before the cutoff;
  //   - the lake read fails (anything but an abort: an abort is the caller's);
  //   - ⛔ THE SEAM: bars this page already holds for the same series disagree with the lake's on a shared bar by more than
  //     2% (utils/historyPrepend.prependOlder's rule: a split or re-basis the lake's table has not caught up with). The held
  //     series read are the window key's own and the plain (present) key's; a lake window that shares no bar with either is
  //     taken (the lake's adjustment is the present basis, the origin's).
  // `windowLakeOff`: a key whose lake read fell back asks the origin for the rest of its record's life (a later life asks
  // the lake again: the index is held, so a refusal costs nothing).
  const windowSources = new Map()   // window key -> 'lake' | 'origin': where its last read was answered (bounded)
  function _noteWindowSource(key, src) {
    windowSources.delete(key)
    windowSources.set(key, src)
    if (windowSources.size > 500) windowSources.delete(windowSources.keys().next().value)
  }
  function _windowFromLake(r, p) {
    return !!history?.windowBars && !!p?.window && isIntradayTf(p.tf) && !r.windowLakeOff
  }
  async function _windowRead(r, url, bars, priority, signal, { warm, front, rec = null }) {
    const p = parseKey(r.key)
    const abortErr = () => new DOMException('The load was aborted', 'AbortError')
    // (review of #2986, F3) the caller's abort settles every wait below at once: the lake's index read is shared and never
    // takes the signal, so waiting for it after an abort could outlast the abort by a cold index read
    const aborted = signal ? new Promise((_, rej) => {
      if (signal.aborted) rej(abortErr())
      else signal.addEventListener?.('abort', () => rej(abortErr()), { once: true })
    }) : null
    aborted?.catch(() => {})
    const orAbort = (pr) => (aborted ? Promise.race([pr, aborted]) : pr)
    // the plain key held on this page: the lake's NEWEST session is compared with it (the split check, `_windowSeamOk`)
    const at = r.key.indexOf('@to=')
    const plainHeld = at > 0 ? (registry.peek(r.key.slice(0, at))?.bars?.length ?? 0) > 0 : false
    // the lake's answer: the payload, or null when the origin must answer (a refusal, a failure, a seam that disagrees)
    // (review of #2986, F2) `.then(ok).catch(...)`: a throw in the seam or daily check falls back too, never errors the chart
    // (review of #2986, L3) a refusal only because the newest session was not known in time is TRANSIENT: the origin
    // answers this read, and the record keeps asking the lake (`windowLakeOff` stays off)
    let transient = false
    const askedGen = registry.getSnapshot(r.key).gen   // (F-H) the life this read's answer lands in
    const lake = Promise.resolve().then(() => history.windowBars(r.key, { bars, signal, newest: plainHeld })).then(
      (got) => {
        if (got && got.newestUnknown && plainHeld) transient = true
        return got && Array.isArray(got.bars) && got.bars.length && _windowSeamOk(r.key, got)
          ? { ticker: p.sym, tf: p.tf, bars: got.bars, source: 'lake' } : null
      },
    ).catch((e) => { if (signal?.aborted) throw e; return null })   // the caller's abort; any other failure falls back
    lake.catch(() => {})
    // a chart that subscribed, or a non-warm ask that joined, while the lake was read never rides a shed-able warm (`_tail`)
    const plainUrl = () => (warm && (r.refs > 0 || rec?.wantPlain) ? url.replace(/&warm=1(?=&|$)/, '') : url)
    // ⭐ (review of #2986, F1) THE ORIGIN FALLBACK IS A LANE REQUEST: its record says so (url, and `warm` when it really
    // leaves with `&warm=1`), so a joiner promotes or follows it up (`_tail`), a shed warm is never the chart's error
    // (`quiet`), and a warm's `filling` answer arms no repeat (`_armFillRetry`)
    const ask = (u, o) => {
      if (rec) { rec.url = u; rec.warm = /[?&]warm=1(?:&|$)/.test(u); rec.sent = true }
      return request(u, o)
    }
    const refused = () => { if (!transient) r.windowLakeOff = true; _noteWindowSource(r.key, 'origin') }
    const won = (src) => { _noteWindowSource(r.key, src) }
    // ⛔ (review of #2986, F1 blocker) A WINDOW IS WHOLE ONLY WHEN IT HOLDS THE BARS ASKED. The origin serves short windows
    // UNFLAGGED (a read >= 0.9 x asked counts as covered and is cached an hour; a cold fetch with no slot, or a failed
    // fetch thread, re-reads what is stored; nothing stored serves recent bars, an EMPTY window after the cutoff), and the
    // lake can be short too (its 2003-09 floor, the deficit passes' cap). Only a whole answer wins outright.
    const lakeWhole = (x) => !!x && x.bars.length >= bars
    const originWhole = (o) => !!o && o.filling !== true && Array.isArray(o.bars) && o.bars.length >= bars
    // ⭐ (measured 2026-11-28, 12 cold tickers at random dates, production) A COLD LAKE IS SLOWER THAN THE ORIGIN: the
    // index and a piece from R2 took 380-650 ms, the origin's `to=` 138-214 ms. A WARM lake (the date warm, a neighbour's
    // warm, the edge's copy) answers in tens of ms. So the chart's own read gives the lake WINDOW_LAKE_HEAD_START_MS, then
    // asks the origin beside it; the first WHOLE answer lands, else the LONGER of the two once both are in (a tie: the
    // lake's); the other is given up (the origin's request aborted; the lake's pieces still land in the page's cache).
    // A warm never races.
    // ⛔⛔ (review of #2986, F-E) ...UNTIL A CHART JOINS IT. A chart that joins a warm still reading the lake rides this read
    // (`_tail`: a lake-first record is no lane request yet), so the warm's wait was the chart's, with no head start and no
    // ceiling: a stalled R2 never settled the chart, and a cold lake cost it 380-650 ms instead of a race at 80. A non-warm
    // joiner (`rec.onJoin`) or a chart subscribing switches this read to the racing path, from that moment.
    let joinedNow = null
    const joined = new Promise((resolve) => { joinedNow = resolve })
    if (rec) rec.onJoin = () => joinedNow(JOINED)
    if (warm && !(r.refs > 0) && !rec?.wantPlain) {
      const v = await orAbort(Promise.race([lake, joined]))
      if (signal?.aborted) throw abortErr()
      if (v === JOINED) return _windowRace()
      if (lakeWhole(v)) { won('lake'); return v }
      if (!v) refused()
      // ⛔ (review of #2986, F-B) a SHORT lake window from a warm is not landed outright (it would be displayable, and
      // the switch would paint it short): the origin is asked on the warm's lane and the LONGER lands (a tie: the lake's)
      const o = await ask(plainUrl(), { priority, signal, ...(front ? { front: true } : {}) }).then((x) => ({ o: x }), (e) => ({ e }))
      if (signal?.aborted) throw abortErr()
      const on = o.o && Array.isArray(o.o.bars) ? o.o.bars.length : -1
      if (v && v.bars.length >= on) { won('lake'); return v }
      won('origin')
      if (o.e) throw o.e
      return o.o
    }
    return _windowRace()
    async function _windowRace() {
    let timer = null
    const head = new Promise((resolve) => { timer = setTimer(() => { timer = null; resolve(HEAD_START) }, WINDOW_LAKE_HEAD_START_MS) })
    const first = await orAbort(Promise.race([lake, head])).finally(() => { if (timer != null) { clearTimer(timer); timer = null } })
    if (signal?.aborted) throw abortErr()
    if (first !== HEAD_START && lakeWhole(first)) { won('lake'); return first }
    if (first === null) {
      refused()
      return ask(plainUrl(), { priority, signal, ...(front ? { front: true } : {}) })
    }
    // the lake is slow, or short: the origin beside it
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
    let ceil = null
    // (review of #2986, LOW) the ceiling's timer goes with an abort too
    const giveUp = () => { try { ac?.abort() } catch { /* aborted */ } if (ceil != null) { clearTimer(ceil); ceil = null } }
    signal?.addEventListener?.('abort', giveUp, { once: true })
    const origin = ask(plainUrl(), { priority, signal: ac ? ac.signal : signal, ...(front ? { front: true } : {}) })
      .then((o) => ({ o }), (e) => ({ e }))
    try {
      const v = await orAbort(new Promise((resolve) => {
        let done = false
        const fin = (x) => { if (!done) { done = true; resolve(x) } }
        lake.then((x) => { if (lakeWhole(x)) fin({ lake: x }) }, () => {})
        origin.then((res) => {
          if (res.o && originWhole(res.o)) { fin(res); return }
          // ⛔ (review of #2986, F-A) A CEILING ON THE WAIT FOR THE LAKE. The origin answered short (or failed): the lake is
          // waited for at most WINDOW_LAKE_MAX_WAIT_MS more (its piece reads and the shared index read take no timeout of
          // their own: a stalled R2 never settles), then the origin's answer lands (a `filling` one keeps its repeat)
          ceil = setTimer(() => { ceil = null; fin({ ...res, ceiling: true }) }, WINDOW_LAKE_MAX_WAIT_MS)
          lake.then(() => { if (ceil != null) { clearTimer(ceil); ceil = null } }, () => {})
        })
        Promise.allSettled([lake, origin]).then(([lx, ox]) => {
          const x = lx.status === 'fulfilled' ? lx.value : null
          const res = ox.value
          const on = res.o && Array.isArray(res.o.bars) ? res.o.bars.length : -1
          fin(x && x.bars.length >= on ? { lake: x } : res)
        })
      }))
      if (signal?.aborted) throw abortErr()
      if (v.lake) { giveUp(); won('lake'); return v.lake }
      won('origin')
      // ⭐ (review of #2986, the deepening) the origin landed short at the ceiling: a lake that settles WHOLE later adds
      // its older rows behind the left edge, as a background deepening (one visible draw; a right-pinned view stays)
      // ⛔ (review of #2986, round 5) ...NEVER INTO A VISIBLE EMPTY LEFT AREA: a window chart zoomed out past its bar 0
      // shows the space the rows would fill, so they are kept for the member's next scroll-back (`_scrollJob` lands them
      // first, in place of an origin ask), on the life this read answered (`askedGen`)
      if (v.ceiling && v.o) lake.then((x) => { if (lakeWhole(x) && keys.get(r.key) === r) r.pendingDeepen = { rows: x.bars, gen: askedGen } }, () => {})
      if (v.e) throw v.e
      return v.o
    } finally {
      signal?.removeEventListener?.('abort', giveUp)
    }
    }
  }
  /** Do the bars this page holds for the window's series agree with the lake's `rows` on the shared bars (the first and the
   *  last shared one, the 2% rule)? True when none are shared. */
  // ⛔ (review of #2986) ...AND THE DAILY SERIES THE PAGE HOLDS. A window in 2006 shares no bar with the present
  // intraday series, so a split the lake's table has not caught up with (published a session behind) cannot show on an
  // intraday seam. The symbol's held DAILY bars (the origin's, on the present basis; a D chart at a date reads the plain
  // key) span the window's days: each shared day's last regular-session close must sit inside that day's daily range
  // (2% slack). A split moves every lake price by its ratio, far outside it: the origin answers.
  // ⛔ (review of #2986, residual) ...AND THE LAKE'S NEWEST SESSION AGAINST THE HELD PLAIN KEY. A split newer than the lake's
  // last publish moves the lake's WHOLE series off the origin's basis, its newest bars included; the plain (present) key is
  // almost always held before a go-to-date, so the lake's newest rows (`got.newest`, historyFeed windowBars `newest`) are
  // checked against it on the 2% rule. And a lake whose split table is stale (`splitsStale`: `splits_as_of` more than
  // LAKE_SPLITS_STALE_DAYS behind its newest bar) is the origin's.
  function _windowSeamOk(key, got) {
    const rows = Array.isArray(got) ? got : got?.bars
    if (!Array.isArray(got) && got?.splitsStale) return false
    const at = key.indexOf('@to=')
    const plain = at > 0 ? key.slice(0, at) : null
    for (const k of [key, plain]) {
      const held = k ? registry.peek(k)?.bars : null
      if (held?.length && !_seamAgrees(held, rows)) return false
    }
    const plainBars = plain ? registry.peek(plain)?.bars : null
    // ⛔ (review of #2986, F-F) the newest session NOT KNOWN in time (its read timed out) is no pass: with the present key
    // held, an unchecked basis is the origin's
    if (plainBars?.length && got?.newestUnknown) return false
    if (plainBars?.length && got?.newest?.length && !_seamAgrees(plainBars, got.newest)) return false
    const p = parseKey(key)
    const daily = p ? registry.peek(`${p.sym}_D`)?.bars : null
    return !daily?.length || _dailyAgrees(daily, rows)
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
    wantHolders.delete(key)
    return false
  }
  /** ⭐ THE ONE AUTHORITY FOR "IS THE DEEP HISTORY DUE" on this page (`deepPending` and the tail's trigger): did the
   *  key's history join settle here at a depth no greater than the `held` rows the entry holds now? Every reset path (a
   *  cache_key, basis or history change, an eviction and rebuild) leaves the entry shallower than that, so it is due. */
  function _deepJoinedAt(key, held) {
    const settled = deepSettled.get(key)
    return settled != null && held >= settled
  }
  /** The key's history join settled (rows added, nothing older, or the split turned off for it). `joined`: it ended
   *  with the history's answer (res.ok). Only then is the depth recorded (`_deepJoinedAt` reads it as "joined at this
   *  depth"); a join that ended in an error (a bad answer, another ticker, a refused seam: the split is off and a full read
   *  recovers) records nothing, so a later key life asks again (review of #2869). Waiters are released either way. */
  function _settleDeep(key, joined = true) {
    deepWanted.delete(key)
    wantHolders.delete(key)   // (the waiters' asks are answered: none of them holds the key any more)
    const held = registry.peek(key)?.bars.length
    if (joined && held != null) {
      deepSettled.delete(key)
      deepSettled.set(key, held)
      if (deepSettled.size > LAKE_SETTLED_MAX) deepSettled.delete(deepSettled.keys().next().value)
    }
    for (const cb of [...(deepSubs.get(key) || [])]) { try { cb() } catch { /* ignore */ } }
    // (a failed join is not "nothing more is coming": the split is off and the full read it queued wakes the entry)
    if (joined) _noteSettled(key)
  }

  /** The deep sealed history of a D/W/M key from the edge (see `_splitFor`). */
  /** (review of #2938, T1) The cover's fallback: the origin is asked the view's cover when the edge history has not landed. */
  function _armEdgeFallback(r) {
    if (r.edgeTimer != null) return
    r.edgeTimer = setTimer(() => {
      r.edgeTimer = null
      if (keys.get(r.key) !== r || !api.deepPending(r.key)) return   // gone, or the history joined in time
      // ⛔ (review of #3012, F-D) ONLY WHILE SOMETHING STILL SHOWS, HOLDS OR WAITS FOR THE KEY. The record lives while its
      // stuck history job is in flight, so a held arrow through a W/M list during an edge miss sent one 2,000-row origin
      // tail per row passed, the prepares long aborted. A chart on it (refs), a pin (the handoff's holdUntilShown, a
      // prepare's acquire) or a waiting display whose ask was not given up (deepWanted) is what makes the cover worth it.
      if (!(r.refs > 0 || (registry.refs?.(r.key) ?? 0) > 0 || _wantedNow(r.key))) return
      r.edgeFallback = true
      r.coverPage = true
      // ⛔ NEVER QUEUED BEHIND THE STUCK EDGE. A key sends one request at a time (`r.inflight`), and the history it waits
      // on IS that request: a cover tail queued behind it ran only once the edge answered, which is the wait this exists
      // to end. With the slot busy, the cover is asked BESIDE it (`r.side`, the only second request a key ever sends).
      if (r.inflight?.kind === 'scroll' && !r.side) { _tailJob(r, r.priority, { side: true }); return }
      _queueTail(r, r.priority)
      _drain(r)
    }, EDGE_FALLBACK_MS)
  }

  /** Does the entry already hold its symbol's whole series (`wholeHistory`)? Never throws. */
  function _whole(key) {
    try { return wholeHistory?.(key) === true } catch { return false }
  }

  /** History answers slower than EDGE_FALLBACK_MS (most likely an edge MISS), newest last: `{ key, ms }`. */
  const slowHistory = []

  function _historyJob(r) {
    const askedAt = now()
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
    if (primed) { const e = deepPrimes.get(url); if (e) e.pinned = true; deepPrimes.delete(url) }   // the job holds it now
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
        // ⛔ (F1, 2026-11-28) the full read it queues is still to come: the depth stays due until it settles (deepPending)
        r.fullDue = true
        _queueTail(r, r.priority, { fullRead: true })   // (only THIS read's settle clears `fullDue`: _send)
        _drain(r)
      }
      // A waiting display stops waiting on any outcome but an abort (a failure's full read comes
      // through the tail, as before).
      if (!res?.aborted) _settleDeep(r.key, !!res?.ok)
      // (review of #2938, T1) a slow history names itself: the edge MISS rate is what the fallback above pays for
      const ms = now() - askedAt
      if (ms > EDGE_FALLBACK_MS && !res?.aborted) {
        slowHistory.push({ key: r.key, ms: Math.round(ms) })
        if (slowHistory.length > 50) slowHistory.shift()
        try { console.info(`[bars-history] slow ${r.key} ${Math.round(ms)} ms`) } catch { /* diagnostics only */ }
      }
      return res
    })
  }

  /** Does the lake carry `key` (intraday, not a replay window, the lake on, not exhausted for it)? */
  function lakeCarriesKey(key) {
    if (!history) return false
    const p = parseKey(key)
    return !!p && !p.window && isIntradayTf(p.tf) && !keys.get(key)?.lakeDone
  }

  /** Is `key` a window (`@to=`) whose read asks the lake first (`_windowFromLake`)? */
  function lakeCarriesWindow(key) {
    const p = parseKey(key)
    return !!history?.windowBars && !!p?.window && isIntradayTf(p.tf) && !keys.get(key)?.windowLakeOff
  }

  const _lakeCarries = (r) => {
    const p = parseKey(r.key)
    return !!p && !p.window && isIntradayTf(p.tf) && !r.lakeDone
  }

  /**
   * ⭐ (2026-11-27, coordinator ruling) A BACKGROUND DEEPENING LANDS IN IDLE TIME. The window of older history asked
   * right after a chart's first answer (`_noteAnswered`, 'background') or by a deepening loop ('grid': the chart's dwell,
   * the neighbour hold) joined the store in the task its bytes arrived in: one 16-40 ms task 120-170 ms after a switch
   * (the reduce, the chart's re-render over the whole new history, its updateChart, the binder), right where the
   * member's next key press lands. Its rows are older than everything on screen, so WHEN they join changes nothing
   * drawn: the join (`apply`) runs in idle time (`idle`: requestIdleCallback with a timeout, giving way to a waiting key
   * or pointer press). A scroll the member makes ('urgent') joins at once, as before, and any job queued for the key
   * meanwhile (a scroll, a tail) lands the waiting window first, in order.
   * A window for a chart the member has LEFT (a chart held the key when it was asked, none holds it now) is dropped: its
   * bytes stay in the HTTP / lake cache, so coming back is cheap. A key no chart held (a neighbour row) is never dropped.
   */
  function _landBackground(r, priority, apply) {
    if (priority === 'urgent') return apply()
    const heldAtAsk = r.refs > 0
    return new Promise((resolve) => {
      const pending = { run: null, cancel: null }
      pending.run = () => {
        if (r.idleLand !== pending) return
        r.idleLand = null
        if (heldAtAsk && (keys.get(r.key) !== r || r.refs <= 0)) { resolve({ ok: false, dropped: true }); return }
        try { resolve(apply()) } catch { resolve({ error: true }) }
      }
      r.idleLand = pending
      pending.cancel = idle(pending.run)
    })
  }
  /** A job queued for `r` while a background window waits for idle: the window lands now, first. */
  function _flushIdle(r) {
    const p = r.idleLand
    if (!p) return
    try { p.cancel?.() } catch { /* gone */ }
    p.run()
  }

  /** Scroll-back: the lake first where it carries the key, then the server's window. A lake that
   *  has nothing older, fails, or disagrees at the join hands over to the server window, queued
   *  behind whatever took the slot meanwhile (≤1 request per key still holds). */
  function _scrollJob(r, opts) {
    // ⭐ (review of #2986, the deepening; L2) a window's lake rows kept after a short ceiling answer land first, on the
    // life they were asked in (`gen`: the reducer drops another life's), through _joinLakeWindow's rules: the lake must
    // hold the join bar (the gap rule) and agree with it (prependOlder's basis check). Refused or stale: discarded, and
    // the scroll asks as it always did.
    const pend = r.pendingDeepen
    if (pend) {
      r.pendingDeepen = null
      const s0 = registry.getSnapshot(r.key)
      if (pend.gen === s0.gen && s0.bars.length) {
        const oldest = s0.bars[0].t
        return Promise.resolve(_landBackground(r, opts.priority || 'urgent', () => _joinLakeWindow(r, pend.gen, { bars: pend.rows }, oldest)))
          .then((res) => (res?.ok && res.added > 0 ? res : _scrollJob(r, opts)))
      }
    }
    if (!history || !_lakeCarries(r)) return _serverScrollJob(r, opts)
    return _lakeScrollJob(r, opts).then((res) => {
      if (res?.aborted || res?.ok || res?.dropped) return res   // (dropped: a window for a chart the member left, _landBackground)
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
      return _landBackground(r, opts.priority || 'urgent', () => _joinLakeWindow(r, gen, got, oldest))
    }, { fetch: (signal) => history.olderBars(r.key, oldest, { bars: want, signal }) })
  }

  /** A lake window's join (the store's SCROLL_BACK), read against the entry as it is when it lands. */
  function _joinLakeWindow(r, gen, got, askedAt = null) {
    {
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
      // (review of #2904) a window made redundant while it waited for idle (a lake load joined deeper rows meanwhile:
      // every row of it is at or after the oldest bar held) adds nothing: done, and no server window in its place
      if (joinT != null && askedAt != null && joinT < askedAt && got.bars.every((b) => b.t >= joinT)) return { ok: true, added: 0, source: 'lake' }
      if (joinT == null || !got.bars.some((b) => b.t === joinT)) return { fallback: true, gap: true }
      // the same seam rule as the server's window: another price basis at the join is refused whole
      if (prependOlder(before.bars, got.bars) === before.bars) return { fallback: true }
      const after = registry.dispatch(r.key, { type: ACTION.SCROLL_BACK, key: r.key, gen, payload: { bars: got.bars } })
      return { ok: true, added: after.depth - before.depth, source: 'lake' }
    }
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
      return _landBackground(r, opts.priority || 'urgent', () => _joinServerWindow(r, gen, json))
    })
  }

  /** A server window's join (the store's SCROLL_BACK), read against the entry as it is when it lands. */
  function _joinServerWindow(r, gen, json) {
    {
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
    }
  }

  function _send(r, kind, url, priority, onJson, { front = false, fetch: fetchFn = null, side = false, fullRead = false, viaLake = false } = {}) {
    const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
    r.lastStart = now()
    requests++
    // Read at failure time: the lane may have rewritten a queued warm into a non-warm request.
    // (review of #2986, F1) a window read from the lake first is no lane request until its origin fallback leaves
    // (`_windowRead` then marks this record: its url, and `warm` when it leaves with `&warm=1`)
    const rec = { ac, kind, promise: null, url, priority, warm: !viaLake && /[?&]warm=1(?:&|$)/.test(url), followUp: null, viaLake, sent: !viaLake, wantPlain: false }
    // ⛔ A SHED WARM IS NOT THE CHART'S ERROR. A best-effort `&warm=1` that failed while a chart
    // subscribes to the key says nothing about the chart's data: no REST_ERROR (the chart's own
    // non-warm request, queued behind it, owns the answer).
    const quiet = () => rec.warm && r.refs > 0
    const promise = (async () => {
      let json
      try {
        json = fetchFn
          ? await fetchFn(ac?.signal ?? null, rec)
          : await request(url, { priority, signal: ac?.signal ?? null, ...(front ? { front: true } : {}) })
      } catch (e) {
        if (_isAbort(e) || ac?.signal.aborted) return { aborted: true }
        if (!registry.has(r.key)) return { aborted: true, evicted: true }   // (E1: never an error entry for a dropped key)
        if (quiet()) { if (fullRead) r.fullDue = false; return { error: true, warmShed: true, retryAfterMs: e?.retryAfterMs ?? null } }
        // ⛔⛔ (2026-11-28, the cloud sweep: COV-def-m1-typed LNG, /api/bars/LNG?tf=15 answered 429 three times, and the chart
        // showed the lake copy WITHOUT its tail, a 2-day-stale newest bar, then the fresh tail 100 ms later) A RATE-LIMITED
        // TAIL IS NOT AN ANSWER. A 429 / 503 is asked again after its Retry-After (the loop's backoff for a chart, one timer
        // for a held one-shot ask), up to RATE_LIMIT_HOLD_ROUNDS times in a row, and meanwhile the key is NOT answered: a
        // display holding for it keeps waiting, inside its hang guard, instead of committing a copy without its tail as
        // current. Past the rounds it is the error it always was.
        // (the count is the KEY's, not the record's: a one-shot ask's record is collected when it settles)
        // ⛔ (2026-11-28, chart rails: StockChart.warmingTimeout) ...BUT A 503 `warming` IS AN ANSWER: the server telling
        // the chart it is fetching a name it may never find (a typo, a made-up ticker). The chart shows it and gives up
        // honestly after WARMING_GIVE_UP_MS, which counts from the error it sees: held here, it never saw one and its
        // skeleton spun on. Only a 429, or a 503 that is not `warming` (a shed), holds.
        if (kind === 'tail' && (e?.status === 429 || (e?.status === 503 && !e?.warming)) && (limitRounds.get(r.key) || 0) < RATE_LIMIT_HOLD_ROUNDS) {
          limitRounds.set(r.key, (limitRounds.get(r.key) || 0) + 1)
          if (limitRounds.size > 500) limitRounds.delete(limitRounds.keys().next().value)
          if (!(r.refs > 0)) _armLimitRetry(r.key, e?.retryAfterMs)
          // (review of #3012, LOW) a rate-limited FULL read is still to come: `fullDue` stays until its repeat settles
          return { error: true, limited: true, retryAfterMs: e?.retryAfterMs ?? null }
        }
        if (fullRead) r.fullDue = false   // (F1) the full read settled (failed): nothing more is coming from it
        // (review of #3012, LOW) the rounds end with the error: the key's next ask starts a fresh count
        limitRounds.delete(r.key)
        const gen = registry.getSnapshot(r.key).gen
        if (kind === 'tail') {
          registry.dispatch(r.key, { type: ACTION.REST_ERROR, key: r.key, gen, payload: { error: e?.warming ? 'warming' : String(e?.status || 'network') } })
          _noteAnswered(r)
        }
        return { error: true, retryAfterMs: e?.retryAfterMs ?? null }
      }
      if (ac?.signal.aborted) return { aborted: true }   // a joined request outlived our abort
      // ⭐ (review of #2935, E1) the key was evicted while this was in flight: its answer belongs to that life, never to a
      // new entry it would create (a `since=` delta would land on an EMPTY entry as "answered"). Dropped; the next
      // chart or warm of the key asks again, on its own life.
      if (!registry.has(r.key)) return { aborted: true, evicted: true }
      // (F1) a split-off key's full read answered: cleared BEFORE its rows land, so the wake they cause reads it settled.
      // ⛔ ONLY that read (review of #2989): the edge fallback's side cover, or any other tail, settling while it is still
      // queued is a shallow answer, and clearing on it read the depth done before the full depth landed
      if (fullRead) r.fullDue = false
      if (json?.error && !json.no_data && quiet()) return { error: true, warmShed: true, retryAfterSec: json.retry_after ?? null }
      const out = await onJson(json)
      // ⭐ (review of #2947, M1) a WINDOW the server is still fetching answers with the rows it holds, `filling: true` and
      // Retry-After 3 (bars_fetch `to-filling`): this life is answered, but its rows are not the window yet (`filling`)
      if (kind === 'tail') {
        limitRounds.delete(r.key)
        const was = r.filling || fillRounds.has(r.key)   // (the record may be a new one: a one-shot's is collected)
        r.filling = json?.filling === true
        _noteAnswered(r)
        if (r.filling && (!rec.warm || r.refs > 0)) _armFillRetry(r.key)
        else if (!r.filling) fillRounds.delete(r.key)
        // ⭐ (review of #2947, N1) the window's COMPLETE answer after a filling one: the handoff's watcher re-reads
        // heldRows(answered) now (the entry's own change fired while `filling` still said true)
        if (was && !r.filling) for (const cb of [...(answerSubs.get(r.key) || [])]) { try { cb() } catch { /* ignore */ } }
      }
      return out
    })()
    rec.promise = promise
    // `side`: the edge fallback's cover tail, sent beside the request holding the slot (see _armEdgeFallback)
    if (side) r.side = rec
    else r.inflight = rec
    promise.finally(() => {
      if (r.inflight?.promise === promise) r.inflight = null
      if (r.side?.promise === promise) r.side = null
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
    _flushIdle(r)   // a background window waiting for idle lands before the tail, in order
    const out = new Promise((resolve) => { job.resolve = resolve; r.queue.push(job) })
    out.job = job
    return out
  }

  function _tail(r, priority = r.priority, opts = {}) {
    const inf = r.inflight
    if (inf?.kind === 'tail') {
      const best = _best(inf.priority, priority)
      // (review of #2986, F1) a window still reading the lake: a non-warm joiner makes its origin fallback non-warm
      if (inf.viaLake && !inf.sent && !opts.warm) { inf.wantPlain = true; try { inf.onJoin?.() } catch { /* the read's */ } }
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
    // a windowed (replay / at-a-date) key is read ONCE, whole (a `filling` answer is asked again by `_armFillRetry`)
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

  const _gc = (r) => { if (r.refs <= 0 && !r.inflight && !r.side && !r.queue.length && keys.get(r.key) === r) keys.delete(r.key) }

  const api = {
    /** (review of #2938, T1) the slow history answers of this page (diagnostics; the rig reads it). */
    slowHistory: () => slowHistory.slice(),
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
      if (r.side) { r.side.ac?.abort(); r.side = null }
      for (const j of r.queue.splice(0)) j.resolve({ aborted: true })
      // (review of #2947, LOW) the last chart left: a window's filling repeat goes with it unless the entry is still pinned
      const f = fillRounds.get(key)
      if (f && !((registry.refs?.(key) ?? 0) > 0)) { if (f.timer != null) clearTimer(f.timer); fillRounds.delete(key) }
      const spent = _exhausted(r)
      keys.delete(key)
      _noteBudget(key, spent, false)
    },
    setPriority(key, priority) { const r = keys.get(key); if (r) r.priority = priority },
    /** Prime the lake for `key` now (historyFeed `prime`: index + newest pieces into the HTTP cache),
     *  ahead of its open: a typed ticker or a row the pointer rests on. No-op where it does not carry. */
    // ...and a window's (a chart at a past date, PR 1.2's date warm): the pieces its lake read takes (historyFeed `prime`)
    primeLake(key, opts) {
      if (!history?.prime || !(lakeCarriesKey(key) || lakeCarriesWindow(key))) return
      try { if (opts) history.prime(key, opts); else history.prime(key) } catch { /* a warm only */ }
    },
    /** Warm the EDGE's copy of `key`'s whole lake depth (historyFeed `edgeWarm`: index into the page,
     *  pieces HEADed, no body). Resolves the pieces asked; 0 where the lake does not carry. */
    lakeEdgeWarm(key, opts) {
      if (!history?.edgeWarm || !(lakeCarriesKey(key) || lakeCarriesWindow(key))) return Promise.resolve(0)
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
      const held0 = registry.peek(key)
      if ((held0?.bars.length ?? 0) >= target) return Promise.resolve(false)
      const running = lakeSeeds.get(key)
      // ⭐ (2026-11-26, review of #2866) AN ANSWERED ENTRY WHOSE LOAD SETTLED AT WHAT IT HOLDS IS NOT LOADED AGAIN: the typed
      // warm, a hover or a neighbour joined it, and Enter's subscribe (index._start) and the handoff would re-read and
      // re-decode the same pieces to add nothing. EXACTLY `!lakePending` (review of #2871): an entry holding LESS than its
      // settled depth (a basis / cache_key / history_rev reset, an eviction rebuilt shallow) is due and is loaded.
      const settled0 = lakeSettled.get(key)
      if (!running && held0?.restSeen && settled0 != null && held0.bars.length >= settled0) return Promise.resolve(false)
      if (awaited) lakeAwaited.add(key)
      if (running) return running
      const yieldTask = () => (lakeAwaited.has(key) ? null : nextTask())
      let failed = false
      let complete = false
      const p = Promise.resolve()
        .then(() => history.olderBars(key, Math.floor(now() / 1000) + 1, { bars: target, yieldTask }))
        .then((got) => {
          complete = got?.complete === true
          const cur = registry.peek(key)
          if (!got || !Array.isArray(got.bars) || !got.bars.length || !cur) return false
          // ⚡ (2026-11-27) A LOAD THAT PROVABLY ADDS NOTHING IS NOT INGESTED (reducer.lakeCopyAddsNothing): the chart's
          // background warm re-reads the lake on every visit of a board, and the settled-depth skip above does not hold
          // across a new key life or an entry no server answered (about 40-48 ms a board click, profiled). The dispatch
          // stays, empty, for the registry's own bookkeeping (the entry marked used, the eviction check), as
          // persist.hydrateMem does for a saved copy that adds nothing.
          if (lakeCopyAddsNothing(cur, got.bars)) {
            registry.dispatch(key, { type: ACTION.LAKE_HIT, key, payload: { sym: parseKey(key)?.sym, bars: [] } })
            return false
          }
          const before = cur.bars.length
          registry.dispatch(key, { type: ACTION.LAKE_HIT, key, payload: { sym: parseKey(key)?.sym, bars: got.bars } })
          const after = registry.peek(key)
          if (!after || after.bars.length <= before) return false
          return after.restSeen ? 'join' : 'seed'
        })
        .catch(() => { failed = true; return false })
        .finally(() => {
          if (lakeSeeds.get(key) === p) { lakeSeeds.delete(key); lakeAwaited.delete(key) }
          // ⛔ (F2, 2026-11-28) A LOAD THAT FAILED SETTLED NOTHING: recorded as settled at what is held, it read "nothing more
          // is coming" (lakePending false) and woke the hold to paint the shallow rows. Still due; a later load asks again.
          if (failed) return
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
          lakeComplete.delete(key)
          if (complete) {
            lakeComplete.set(key, held)
            if (lakeComplete.size > LAKE_SETTLED_MAX) lakeComplete.delete(lakeComplete.keys().next().value)
          }
          _noteSettled(key)
        })
      lakeSeeds.set(key, p)
      return p
    },
    /** `cb` on each settle of `key`'s depth (its history join, its lake load), whatever it added; returns the unsubscribe. */
    subscribeSettled(key, cb) {
      let set = settleSubs.get(key)
      if (!set) { set = new Set(); settleSubs.set(key, set) }
      set.add(cb)
      return () => { set.delete(cb); if (!set.size && settleSubs.get(key) === set) settleSubs.delete(key) }
    },
    /** The lake load of `key` in flight (lakeSeed's shared promise), or null. Starts nothing. */
    lakeLoading(key) { return lakeSeeds.get(key) || null },
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
    /**
     * ⭐ (2026-11-28, zoomed-out short shadows) IS `key`'s WHOLE HISTORY HERE, honestly? Not "nothing is due" (a failed,
     * partial or pending read can leave that), but proved: D/W/M, the deep SEALED history joined at the depth held (the
     * split on; a partial or unsealed answer never settles it); intraday, a lake load that read the index and took every
     * older piece (`complete`), settled at the depth held, with the server's answer of this life held. Unknown is false.
     */
    historyComplete(key) {
      const p = parseKey(key)
      const r = keys.get(key)
      const cur = registry.peek(key)
      if (!p || p.window || !cur || !cur.bars.length) return false
      const held = cur.bars.length
      if (isDateTf(p.tf)) return barsHistorySplitEnabled() && !r?.splitOff && _deepJoinedAt(key, held)
      if (!isIntradayTf(p.tf) || !cur.restSeen) return false
      const at = lakeComplete.get(key)
      return at != null && held >= at && !api.lakePending(key)
    },
    deepPending(key) {
      const p = parseKey(key)
      if (!p || !isDateTf(p.tf) || p.window || !barsHistorySplitEnabled()) return false
      // ⛔ (F1, 2026-11-28) the edge failed, so the full depth comes from the origin: due until that read settles. It read
      // false at once, and the daily hold took "nothing more is coming" and painted the 30-row tail page, then the full
      // read filled it in (a short paint, then the jump).
      if (keys.get(key)?.splitOff) return !!keys.get(key).fullDue
      if (_whole(key)) return false                // the entry holds the whole series: nothing older to join
      const held = registry.peek(key)?.bars.length ?? 0
      if (held > dateCoverMaxFor(p.tf)) return false
      return !_deepJoinedAt(key, held)
    },
    /**
     * Fetch `key`'s deep history NOW, ahead of the tail answer its job waits for (the job takes this
     * answer, see `_historyJob`). `want`: a display is waiting on the join, so the job leaves at
     * `visible` rank. Resolves true when the history arrived; never rejects. Nothing when the history
     * is not due or its URL cannot be known yet (W/M holding no bars).
     * ⭐ (2026-11-28, cold-arch 3.3 item 2) `signal`: the typed warm's own. Every keystroke that spells a known ticker now
     * primes its history, and a prime with no way to stop held one of the lane's two slots after its text was gone, so
     * the NEWEST text's tail queued behind the older texts' histories. An aborted prime leaves the lane and is forgotten
     * (the history job then asks for itself, as for a prime that failed).
     */
    deepPrime(key, { priority = 'urgent', want = false, signal = null, wantSignal = null } = {}) {
      if (signal?.aborted || !api.deepPending(key)) return Promise.resolve(false)
      // `wantSignal` (review of #3012, F-D): the waiting display's own ask; when every such waiter has given up, the key
      // is no longer wanted (its cover fallback then sends nothing)
      if (want && !wantSignal?.aborted) {
        deepWanted.set(key, now() + DEEP_WANT_MS)
        if (wantSignal) {
          let set = wantHolders.get(key)
          if (!set) {
            set = new Set()
            wantHolders.set(key, set)
            while (wantHolders.size > WANT_HOLDERS_MAX) wantHolders.delete(wantHolders.keys().next().value)
          }
          set.add(wantSignal)
          // ⛔ an abort counts only against the waiters it was one of: after a settle (the set gone) or a newer want (a new
          // set), an old prepare's late abort must not take the key's want away
          wantSignal.addEventListener?.('abort', () => {
            if (wantHolders.get(key) !== set) return
            set.delete(wantSignal)
            if (set.size) return
            wantHolders.delete(key)
            deepWanted.delete(key)
          }, { once: true })
        }
      }
      // ⭐⭐ (2026-11-28, the cloud sweep: zoomed-out W/M waited on /api/bars-history 5-22 s server-side while the origin's
      // /api/bars?tf=W&bars=2000 answered in 467 ms) ANY DISPLAY WAITING ON A DEEP JOIN gets the cover fallback, not only a
      // tail cut to EDGE_TAIL_BARS: still unjoined EDGE_FALLBACK_MS later, the origin is asked the whole page a view can
      // draw (the deepest tail page, DATE_COVER_MAX), so the hold's hang-time commit is nearly whole, not ~600 rows
      if (want && isDateTf(parseKey(key)?.tf)) { const rw = _rec(key); if (!rw.edgeFallback) _armEdgeFallback(rw) }
      // The depth was lost since the key's last join (the entry was evicted and rebuilt): ask again.
      const r = keys.get(key)
      if (r?.histAsked && !(r.inflight?.kind === 'scroll') && deepSettled.has(key)) r.histAsked = false
      const url = _deepUrl(key)
      if (!url) return Promise.resolve(false)
      // ⛔ (2026-11-28, lead's capacity rules) A JOINED PRIME IS DETACHED, NEVER ABORTED. Each caller attaches with its own
      // signal (none: held for good, as the switch's own and the history job's are); the request is aborted only when every
      // attached caller has aborted, so the next text cancels a prime nobody else is waiting on, and never Enter's.
      const attach = (e) => {
        if (!signal) { e.pinned = true; return }
        if (signal.aborted) return
        e.holders += 1
        signal.addEventListener?.('abort', () => { if (--e.holders <= 0 && !e.pinned) e.ac?.abort() }, { once: true })
      }
      const held = deepPrimes.get(url)
      const have = _primed(url)
      if (have) { attach(held); return have.then(() => true, () => false) }
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
      const p = Promise.resolve().then(() => request(url, { priority, ...(signal && ac ? { signal: ac.signal } : {}) }))
      const entry = { p, at: now(), ac, holders: 0, pinned: false }
      attach(entry)
      deepPrimes.set(url, entry)
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
    /** Does a read of window `key` ask the lake first (a chart at a past date: `_windowFromLake`)? */
    lakeCarriesWindow(key) { return lakeCarriesWindow(key) },
    /** Where window `key`'s last read was answered on this page: 'lake' | 'origin' | null (diagnostics, the rig). */
    windowSource(key) { return windowSources.get(key) ?? null },
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
    fetchOnce(key, { priority = 'urgent', depth = 0, session = 'rth', signal = null, warm = false, front = false, full = false, cover = 0 } = {}) {
      if (signal?.aborted) return Promise.resolve({ aborted: true })
      const r = _rec(key)
      r.depth = Math.max(r.depth, depth || 0)
      r.cover = Math.max(r.cover || 0, Number.isFinite(cover) ? cover : 0)
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
      _flushIdle(r)   // a window waiting for idle lands first (its rows are what this scroll reads its oldest bar from)
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
    /** (review of #2947, M1) The key's last tail answer was the server's `filling` one: a window still landing, its rows
     *  short of what it will hold. A later complete answer clears it. */
    // (N1) ...also after the key's record went (a one-shot ask's record is collected when it settles): a repeat still due
    /** (diagnostics, rails) live waiters on the key's deep join that passed a wantSignal */
    wantHolders(key) { return wantHolders.get(key)?.size ?? 0 },
    filling(key) { return !!keys.get(key)?.filling || fillRounds.has(key) },
    /** Listen to `answered(key)` turning true. Returns the unsubscribe function. */
    subscribeAnswered(key, cb) {
      let set = answerSubs.get(key)
      if (!set) { set = new Set(); answerSubs.set(key, set) }
      set.add(cb)
      return () => { set.delete(cb); if (!set.size && answerSubs.get(key) === set) answerSubs.delete(key) }
    },
    /** Requests in flight for `key` (0|1, or 2 while the edge fallback's cover runs beside a stuck history: `r.side`), or
     *  across all keys. */
    inflight(key) {
      const of = (r) => (r?.inflight ? 1 : 0) + (r?.side ? 1 : 0)
      if (key != null) return of(keys.get(key))
      let n = 0
      for (const r of keys.values()) n += of(r)
      return n
    },
    stats() { return { keys: keys.size, requests, inflight: api.inflight() } },
    dispose() {
      offVisible?.()
      offEvict?.()
      for (const k of [...keys.keys()]) { const r = keys.get(k); r.refs = 1; api.stop(k) }
    },
  }
  return api
}

/** Index of the first bar of ascending `rows` with `t >= x` (rows.length when none). */
function _lowerBound(rows, x) {
  let lo = 0, hi = rows.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m].t < x) lo = m + 1; else hi = m }
  return lo
}
/** Do ascending `held` and `rows` agree (historyPrepend's 2% close rule) on their first and last shared bar? True when
 *  they share none. */
export function _seamAgrees(held, rows) {
  if (!held?.length || !rows?.length) return true
  const lo = rows[0].t, hi = rows[rows.length - 1].t
  const i0 = _lowerBound(held, lo)
  const i1 = _lowerBound(held, hi + 1) - 1
  for (const i of i0 <= i1 ? [i0, i1] : []) {
    const h = held[i]
    const j = _lowerBound(rows, h.t)
    if (j < rows.length && rows[j].t === h.t && _closeMismatch(h, rows[j])) return false
  }
  return true
}

/** Do intraday `rows` agree with held `daily` bars (unix t, a UTC-midnight date)? Each ET day both hold: its last bar
 *  starting before 16:00 ET closes inside the day's [low, high] with 2% slack. True when they share no day. Reads at
 *  most the first and the last shared day (a split moves them all). */
export function _dailyAgrees(daily, rows) {
  if (!daily?.length || !rows?.length) return true
  const byDay = new Map()
  for (const b of daily) byDay.set(new Date(b.t * 1000).toISOString().slice(0, 10), b)
  const closes = new Map()   // ET day -> its last regular-session close
  for (const r of rows) {
    const d = etDateOf(r.t)
    if (!d || !byDay.has(d)) continue
    const m = _etMinute(r.t)
    if (m >= 570 && m < 960) closes.set(d, r.c)
  }
  const days = [...closes.keys()].sort()
  for (const d of days.length > 1 ? [days[0], days[days.length - 1]] : days) {
    const b = byDay.get(d), c = closes.get(d)
    if (!(c >= b.l * 0.98 && c <= b.h * 1.02)) return false
  }
  return true
}
let _etMinFmt = null
function _etMinute(unixSec) {
  if (!_etMinFmt) _etMinFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
  const parts = _etMinFmt.formatToParts(new Date(unixSec * 1000))
  const h = Number(parts.find((x) => x.type === 'hour')?.value), mi = Number(parts.find((x) => x.type === 'minute')?.value)
  return h * 60 + mi
}

const _RANK = { visible: 0, urgent: 1, grid: 2, background: 3 }
function _best(a, b) { return (_RANK[b] ?? 3) < (_RANK[a] ?? 3) ? b : a }

export { etDateOf, HISTORY_WINDOW_BARS }
