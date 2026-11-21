// app/src/data/barStore/prefetch.js — ensure / prefetch / peek over the BarStore, and the
// drop-in facade of utils/prefetchBars.js (P2c; docs/architecture/barstore.md §Prefetch).
//
// ⭐ ONE PATH, NOT A SECOND WARMER. Every request this module causes is `store.ensure` →
// network.fetchOnce → prefetchBars.barsLaneRequest: the key's single slot (≤1 request per
// key, S9) and THE lane gate (visible > urgent > grid > background, `_MAX_CONCURRENT`, the
// 503 backoff, the pack-ingest hold for background). No queue, no `_seen` set, no URL of its
// own — the legacy warmer's queues, dedupe sets and four URL builders have no equivalent here.
//
// ⭐ WHAT "WARM" MEANS. A key is warm when its snapshot is DISPLAYABLE (status context |
// current — the store's one freshness verdict, status.js). A warm key costs no request; a
// local copy (mem / IDB) is hydrated first, so a key the caches already hold current costs
// none either. A key the server has ANSWERED for and that is still not displayable (behind,
// unverified — a halt) is re-asked at most once per COOLDOWN (one bucket, ≥ 60 s; D/W/M:
// the daily poll) — the legacy repair cooldown, keyed by the store key + `gen` (an
// invalidate resets it). A request that got no answer (aborted, shed, failed) gives its
// slot back; the lane's 503 backoff is what paces a shedding server.
//
// ⭐ PERSISTED, LIKE THE LEGACY DURABLE WARM. Every answer a warm or prepare gets is written
// to mem + IDB by persist.js (store.ensure → persist.writeOnce when nobody subscribes), and a
// hydrate promotes an IDB copy into mem — so legacy synchronous readers (memPeek: the handoff's
// daily fast path, useDayFacts) see what the facade fetched, and a warm survives the
// registry's LRU (200 keys) for lists of 500. The cooldown only holds while the key's answer
// is still held — in the store, or re-hydrated from what persist wrote.
//
// ⭐ THE LEGACY WIRE SHAPE. `&warm=1` exactly where legacy sends it (prefetchBars non-urgent,
// prefetchBar, the durable / deep / replay warms, prepareForDisplay), never on urgent rows,
// intent, typed or daily-prepare requests; `priority: true` puts a job at the FRONT of its
// lane rank (barsLaneRequest `front`).
//
// ⭐ THE HANDOFF (useSymbolHandoff's contract, unchanged outcomes):
//   peekDisplayable(sym, tf)   SYNCHRONOUS: peek()?.status ∈ {context, current}. The mem half
//                              of a hydrate is synchronous, so a neighbour the warmer left in
//                              memory commits in the same tick, exactly as before.
//   prepareForDisplay(sym, tf, {signal})  ensure(until context | current | unavailable) →
//                              'current' | 'authoritative' | 'nodata' | 'error'. A LOCAL copy
//                              (no server answer yet) is 'current' only when the legacy paint
//                              rule accepts it (`isCacheCurrentForView` with the view's session
//                              — legacy `_paintCurrent`); otherwise the server is asked.
//   prepareDailyForDisplay(sym, tf, {signal})  D/W/M: any held set paints → 'current' |
//                              'nodata' | 'error'. Legacy also offered the answer to SWR
//                              (`preload` of the chart URL); the store has no SWR key — under
//                              BARSTORE the chart (S1) reads the store key `keyOf({sym, tf})`
//                              through useBarSnapshot, and mem / IDB via persist.
//   warmTypedSymbol            legacy `_typedCachePaints` decides 'cache' (with the hydrated
//                              record's savedAt). S1 ADAPTER ITEM: 'stale-answer' is never
//                              returned — a late answer is merged monotonically by the reducer,
//                              so it reports 'network' (pinned by a test).
//   A prepare OWNS its key while it runs: a facade prefetch of the same key (the handoff's own
//   `prefetchBarsToIDB(..., {immediate})`) does not add a second waiter, so aborting the
//   prepare on a symbol switch really cancels the request (network.fetchOnce ref-counts its
//   one-shot waiters; a subscribed chart or another prepare keeps it alive).
//
// ⭐ WIRED BEHIND THE BARSTORE SWITCH (P3-S1, components/chart/barStoreSwitch.js): with it on,
// the symbol handoff (prepare / peek), useDayFacts, the type-to-search warm (ChartPane) and the
// chart's background warm of its other timeframes come here; every other warmer keeps
// `utils/prefetchBars` until P3-S3 (they fill mem / IDB, which the store hydrates from). The
// facade exports the SAME names with the SAME parameter shapes (prefetch.facade.test.js derives
// the list from the app's import graph), plus `peekBars` (the memPeek readers' replacement).

import { getBarStore } from './index'
import { keyOf, parseKey, normTf, isIntradayTf, isDateTf, PERIOD_SEC, STATUS, unixToDateLabel } from './types'
import { DAILY_POLL_MS } from './network'
import { legacyBars } from './adapter'
import { fullBarsFor, firstPaintBarsFor } from '../../utils/barsBackfill'
import { PREFETCH_WINDOWS, prefetchTargetBars } from '../../utils/historyPrepend'
import { viewShowExtended } from '../../utils/viewSession'
import { isNativeTf, fetchTf } from '../../components/chart/timeframes'
import { isCacheCurrentForView, expectedBarsBehind } from '../../utils/marketSession'
import { deviceCopyFresh } from '../deviceStore/fresh'
import { BARSTORE } from '../../components/chart/barStoreSwitch'
import { prefetchTickerMeta as _defaultTickerMeta } from '../../hooks/useTickerMeta'
import {
  _packStillIngesting, URGENT_MAX_PER_CALL, GRID_WARM_TFS, listPrewarmDisabled, _typedCachePaints,
  tellSymbolWarmers, TYPED_REASK_MS,
} from '../../utils/prefetchBars'

// Lane plumbing the chart imports from the same module — re-exported unchanged so one import
// line can be swapped wholesale.
export {
  _packStillIngesting, joinPendingBars, setPrefetchShowExtended, barsBeforeUrl, barsLaneRequest,
  URGENT_MAX_PER_CALL, GRID_WARM_TFS, listPrewarmDisabled,
  // ⭐ ONE REGISTRY OF COMPANION WARMERS (2026-11-12): a lane with its own per-symbol data (the
  // server-computed indicator columns) registers with the legacy module and is told the symbols
  // BOTH warmers are about to warm. The entry points below announce exactly what the legacy
  // ones do (`prefetch.symbolWarmers.test.js` holds the two side by side).
  registerSymbolWarmer,
} from '../../utils/prefetchBars'

export const DISPLAYABLE = Object.freeze([STATUS.CONTEXT, STATUS.CURRENT])
export const PREPARED = Object.freeze([STATUS.CONTEXT, STATUS.CURRENT, STATUS.UNAVAILABLE])
// ⭐ WHAT THE HANDOFF MAY COMMIT ON: every status in which the chart paints the held rows as its
// candles (chart/useBarSnapshotBars.js PAINTS). `updating` is in it: a key a warm answered
// earlier in this page life, now a few buckets behind, is a full chart the member's own request
// catches up. Measured on production 2026-11-15 (5m, 8 flips): such a key was refused here, the
// handoff waited on a lane-held warm request and the candles came 546-1,180 ms after the key,
// while keys the store judged `context` painted in ~30 ms. `provisional` (a local-only copy
// behind the frontier) stays out: that is the legacy handoff's rule too (`seriesDisplayable`).
export const HANDOFF_PAINTS = Object.freeze([STATUS.CONTEXT, STATUS.CURRENT, STATUS.UPDATING])
/** `until` for an ensure that must ask the server whatever the held status says (no status satisfies it). */
const ASK_AGAIN = Object.freeze([])
/** How long the handoff waits for the tail of a copy behind the clock before it paints the copy as it is. */
export const BEHIND_HOLD_MAX_MS = 250
/** An answer this recent that is still behind the clock is the name not printing: it is not asked again. */
export const BEHIND_RECHECK_MS = 5000
/** D/W/M handoff: a held set paints (the daily paint gate decides how), so it is prepared. */
const DAILY_PREPARED = Object.freeze([STATUS.PROVISIONAL, STATUS.CONTEXT, STATUS.CURRENT, STATUS.UNAVAILABLE, STATUS.UPDATING])

// The legacy timeframe sets (same order: the common switches warm first).
export const ALL_TFS = Object.freeze(['D', '5', '60', '30', '15', 'W', 'M', '1'])
export const SCAN_WARM_TFS = Object.freeze(['D', '5', '60', '30', '15'])
const SCAN_WARM_CAP = 100
const DEEP_WARM_TFS = Object.freeze(['D', 'W', 'M'])
const DEEP_WARM_CAP = 120
const REPLAY_WARM_TFS = Object.freeze(['5', '15', '30', '60'])
// The typed warm's re-ask window is the legacy module's TYPED_REASK_MS (imported above), never a
// number of this module's: both warmers skip a re-ask on the same rule.
const COOLDOWN_MAX_KEYS = 400
/** TERM-033: what a FAILED device-cache hydrate resolves to (`_hydrate`). "Nothing was hydrated",
 *  never an answer: the caller takes its verdict on the store as it stands, so the key is asked of
 *  the server like any key the cache does not hold. */
const NOTHING_HYDRATED = null
const nothingHydrated = () => NOTHING_HYDRATED
/** TERM-033: what a neighbor hold's deep window resolves to when the store's `scrollBack` THREW
 *  (`createNeighborHold` → `deepen`). "This window did not arrive", never "nothing older": it ends
 *  that ROW's deepening for now (the chart's own loader asks again when the member lands on it),
 *  and the hold goes on to the next row. Shaped like a refused window (`ok: false`) so the one
 *  stop rule there reads it; `failed` says which kind of stop it was. */
const DEEP_WINDOW_FAILED = Object.freeze({ ok: false, failed: true, added: 0 })
const deepWindowFailed = () => DEEP_WINDOW_FAILED

/** Re-ask cooldown of a key the server already answered (see header). */
export function cooldownMs(tf) {
  const t = normTf(tf)
  if (isIntradayTf(t)) return Math.max(60_000, PERIOD_SEC[t] * 1000)
  return DAILY_POLL_MS
}

const _isSym = (s) => typeof s === 'string' && /^[A-Z0-9][A-Z0-9.^-]{0,11}$/i.test(s.trim())

/**
 * ⭐ THE ONE VIEW → STORE KEY FUNCTION. The store key a chart showing (sym, tf) with extended
 * hours `showExtended` reads — a custom tf reads its native base, `window` is a replay slice.
 * The chart (useBarSnapshotBars.chartKeyFor) and every facade call (keyFor) go through it, so a
 * prepare / peek can never name a different key than the pane it is for: only 60m differs by
 * session (`_60` RTH grid vs `_60e` clock grid), and the pane's own setting decides — never a
 * process-global guess. Null when (sym, tf) has no store key.
 */
export function viewKeyFor(sym, tf, { showExtended = false, window = null } = {}) {
  if (!sym || tf == null) return null
  const native = normTf(tf) ? tf : (isNativeTf(String(tf)) ? null : fetchTf(String(tf)))
  if (native == null || !normTf(native)) return null
  try { return keyOf({ sym: String(sym), tf: native, session: showExtended ? 'eth' : 'rth', window }) } catch { return null }
}

/**
 * @param {object} [o]
 * @param {object} [o.store]   createBarStore() instance (default: the app's one store)
 * @param {(sym:string) => void} [o.tickerMeta]  company-meta warm (legacy side effect)
 * @param {() => boolean} [o.packIngesting]
 * @param {() => boolean} [o.extended]  the view's session (utils/viewSession, the one owner)
 * @param {() => number} [o.now]
 * @param {(fn:Function, ms:number) => any} [o.setTimer]
 */
// ⚡ A SHORT STORED INTRADAY SERIES IS NOT WARM (#1314, ported from utils/prefetchBars.js
// `_shortIntraday`). Measured on production: 34 of 40 hourly charts first drew with fewer than 200
// bars, because the intraday pack seeds a short series for every name and every warmer counted any
// displayable series as warm, however short. A stored intraday series shorter than half the chart's
// first-paint window is warmed to the full window (the store merges under what it holds: nothing
// gets shallower). ⛔ ONCE PER KEY: after this module got an answer for the key, a series still that
// short is all the server holds (a recent listing, a shallow timeframe); the rule stands down for
// SHORT_FULL_TTL_MS, so the load is exactly an empty store's: one full window per key.
export const SHORT_FULL_TTL_MS = 6 * 3600 * 1000

/** How long the symbol handoff waits for the cache read before it asks the server anyway (the
 *  legacy chart's `_IDB_TAIL_WAIT_MS`). */
export const HYDRATE_WAIT_MS = 120
/** How long the typed warm waits on a cache read before it asks anyway (see _warmTypedIntraday). */
export const INTENT_HYDRATE_RACE_MS = 60
/** How long a list selection must rest before the hold deepens the next rows (createNeighborHold
 *  `deep`). Past the chart's own DEEP_ARM_MS (250) and its first window, so the visible chart's
 *  deep history always goes first. */
export const NEIGHBOR_DEEP_MS = 500
/** D/W/M: how long a list selection must rest before the hold fetches the next rows' deep sealed
 *  history (createNeighborHold `deepenDates`). The visible daily chart joins its own history before
 *  it paints (~100 ms after the key when nothing was primed), so this follows it; a held key (rows
 *  ~33 ms apart) never starts one. */
export const DATE_NEIGHBOR_DEEP_MS = 150
/** D/W/M: the longest the hold waits for one row's history join before it goes on to the next. */
export const DATE_NEIGHBOR_JOIN_MS = 3000
/** The neighbor deepening's switch: on unless 'uct.deepNeighbors' (or the chart's whole intraday
 *  deep history, 'uct.intradayDeepBackfill.enabled') is '0' in this browser. */
export function deepNeighborsEnabled() {
  try {
    if (typeof localStorage === 'undefined') return true
    return localStorage.getItem('uct.deepNeighbors') !== '0'
      && localStorage.getItem('uct.intradayDeepBackfill.enabled') !== '0'
  } catch { return true }
}
const LOCAL_PAINTS = Symbol('local copy paints')
const LAKE_PAINTS = Symbol('lake copy painted')
/** How long after Enter a lake copy may be committed ALONE (the server has not answered): a normal
 *  answer (~70-300 ms) lands first and the chart paints it with the lake's depth already joined. */
export const LAKE_ALONE_MS = 450
/** A lake copy whose newest bars are NOT current for the view (during the session the lake never
 *  holds today's bars) waits for the server's answer, so the chart paints once with the newest bars
 *  in place; past this it is committed anyway (the answer then adds the newest bars). Measured
 *  2026-11-18 on production: never-opened tickers' first answers 485-926 ms. */
export const LAKE_BEHIND_MAX_MS = 1200
/** After an answer (or a saved copy) that paints, how long the handoff waits for the lake's whole
 *  depth to join it, so the first paint is the whole chart and nothing loads in view afterwards.
 *  550, not 350 (2026-11-18): on production, never-opened 5m tickers' lake loads landed 441-458 ms
 *  after the key (4/4), so a held copy painted alone at ~370 ms and the depth redrew the averages
 *  ~80 ms later. A lake already in the browser joins in tens of ms; only a cold load waits. */
export const LAKE_JOIN_WAIT_MS = 550
/** D/W/M: the longest the daily handoff's prepare waits, from Enter, for the deep history to join
 *  the tail answer (prepareDailyForDisplay). Just under the handoff's own bound (useSymbolHandoff
 *  DAILY_HOLD_MAX_MS = 400), so the prepare's outcome, not the hang guard, commits. */
export const DEEP_JOIN_WAIT_MS = 380
/** The edge warm of a list (edgeWarmList): the chart timeframes that warm (the chart's own, then 60m,
 *  the deepest and slowest cold), the rows per list, the keys per page (each ~1 index GET + 2-23 HEADs),
 *  and how long after the latest list it starts. */
export const EDGE_WARM_TFS = Object.freeze(['60', '30', '5'])
export const EDGE_WARM_CAP = 40
export const EDGE_WARM_PAGE_BUDGET = 200
export const EDGE_WARM_DELAY_MS = 1500
/** historyFeed.edgeWarm's answer when the edge refused the member (401/403): the warm stops for the page. */
export const EDGE_WARM_REFUSED = -1
/** How long a typed text the daily pack does not know may wait for the lake's answer to "is it a
 *  ticker?" (its index: one edge round trip) before the warm gives up on it. */
export const INTENT_LAKE_INDEX_WAIT_MS = 400
const SHORT_FULL_MAX = 4000

export function createPrefetch(o = {}) {
  const S = () => o.store ?? getBarStore()
  const tickerMeta = o.tickerMeta ?? _defaultTickerMeta
  const packIngesting = o.packIngesting ?? _packStillIngesting
  const extended = o.extended ?? viewShowExtended
  const now = o.now ?? (() => Date.now())
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.clearTimer ?? ((h) => clearTimeout(h))
  const deepNeighbors = o.deepNeighbors ?? deepNeighborsEnabled

  /** key → {at, gen} of the last request this module caused (cooldown). */
  const asked = new Map()
  /** key → number of prepares running (they own the key's request; see header). */
  const preparing = new Map()
  /** Deferred prefetch batch: key → {priority, depth} (flushed on a microtask). */
  let batch = null
  /** key → AbortController of the latest urgent prefetchBars call. */
  const urgentCtl = new Map()
  const intentTimers = new Map()
  /** key -> when this module last got an answer for an intraday key (the short-series stand-down) */
  const shortFullAt = new Map()
  function _noteFull(key) {
    shortFullAt.delete(key)
    shortFullAt.set(key, now())
    if (shortFullAt.size > SHORT_FULL_MAX) shortFullAt.delete(shortFullAt.keys().next().value)
  }
  /** The full window to warm `key` to when its stored series is short, else 0. */
  function _shortWant(key, s) {
    const p = parseKey(key)
    if (!p || p.window || !isIntradayTf(p.tf) || !s?.depth) return 0
    const full = firstPaintBarsFor(p.tf, p.session ? p.session === 'eth' : !!extended())
    if (s.depth >= full / 2) return 0
    const at = shortFullAt.get(key)
    return at != null && now() - at < SHORT_FULL_TTL_MS ? 0 : full
  }
  let typed = null   // { key, ctl, kept }

  // The session of a call: the PANE's own extended setting when the caller passes it
  // (`showExtended`, the handoff of one chart widget); else the view-global fallback (list
  // warmers, which serve whichever chart is open).
  const extOf = (showExtended) => (typeof showExtended === 'boolean' ? showExtended : !!extended())
  const session = (showExtended) => (extOf(showExtended) ? 'eth' : 'rth')
  /** The store key the chart in this view reads for (sym, tf); null when it has none. */
  function keyFor(sym, tf, { showExtended, window = null } = {}) {
    return viewKeyFor(sym, tf, { showExtended: extOf(showExtended), window })
  }

  const peek = (key) => S().peek(key)
  const _satisfied = (s, until, depth = 0) => !!s && until.includes(s.status)
    && (!depth || s.depth >= depth || s.status === STATUS.UNAVAILABLE)

  /** `p`, or undefined when it has not settled within `ms` (the read goes on; nothing waits on it). */
  const _raced = (p, ms) => Promise.race([p, new Promise((resolve) => setTimer(() => resolve(undefined), ms))])

  /** Hydrate a key nothing has loaded yet (mem part synchronous, IDB part async). */
  function _hydrate(key) {
    const st = S()
    const s = st.peek(key)
    // a held DEVICE copy (no server answer) is brought forward to the device's newest first
    if (_deviceHeld(s)) return Promise.resolve(st.persist.refreshDevice?.(key)).catch(() => false).then(() => st.peek(key))
    if (s && (s.depth || s.restSeen || s.developing)) return Promise.resolve(s)
    // Pinned while it reads, so a herd hydrating more keys than the LRU holds cannot evict
    // the entry between its cache read and the verdict taken on it.
    st.registry.acquire(key)
    // TERM-033: a FAILED device-cache read hydrates nothing (NOTHING_HYDRATED). It is never read as
    // an answer: the verdict below is taken on what the store holds, so the warm asks the server.
    return st.persist.hydrate(key).catch(nothingHydrated)
      .then(() => st.peek(key))
      .finally(() => st.registry.release(key))
  }

  /**
   * Is `key` inside its re-ask cooldown? Only while its last ANSWER is still held: in the
   * store (restSeen), or re-hydrated from the copy persist wrote (rows held). A key the LRU
   * evicted before anything was persisted holds nothing — it is re-asked.
   */
  function _cooling(key, s) {
    const a = asked.get(key)
    // ⛔ A REQUEST STILL WAITING IS NOT AN ANSWER (2026-11-17). The ask is noted when the request
    // STARTS; a background warm held in the lane (`_holdBackgroundWarm`: the daily pack still
    // ingesting, a first visit's 90 s+) therefore read as "asked recently" and made every later
    // warm of the key skip — the URGENT next-row warm included, the one meant to bypass that
    // hold. Measured (debug build, flip proof 60m): the rows ahead held a 180-bar copy hours
    // behind (`provisional`), never re-asked, and the flip fetched them itself (129 ms). Only an
    // answered ask cools; a later ask of a key still in flight joins / promotes that request
    // (network.fetchOnce, promoteLaneRequest), so nothing is fetched twice.
    if (!a || !a.answered) return false
    // An INVALIDATE since the answer resets it (gen moved on an entry that says so); a fresh
    // entry re-hydrated after an LRU eviction has a new gen but was never invalidated.
    const invalidated = s?.invalidatedFor != null && s.gen !== a.gen
    const expired = invalidated || now() - a.at >= cooldownMs(s?.tf ?? key.split('_')[1])
    if (expired || !s || !(s.restSeen || s.depth > 0)) { asked.delete(key); return false }
    return true
  }
  function _noteAsked(key) {
    const a = { at: now(), gen: S().peek(key)?.gen ?? 0, answered: false }
    asked.delete(key)
    asked.set(key, a)
    if (asked.size > COOLDOWN_MAX_KEYS) {
      for (const [k, x] of asked) if (now() - x.at >= DAILY_POLL_MS) asked.delete(k)
      // …and by SIZE: the oldest entries go first (Map order = insertion order).
      for (const k of asked.keys()) { if (asked.size <= COOLDOWN_MAX_KEYS) break; asked.delete(k) }
    }
    return a
  }

  /**
   * Make `key` reach a status in `until` (default: context | current | unavailable): a held
   * or hydrated snapshot that already does costs nothing (`local: false` — a local copy
   * never satisfies, only a server answer); otherwise ONE request through the store (joined
   * with any request of the key in flight), hydrated ONCE (here). Never rejects.
   */
  async function ensure(key, {
    until = PREPARED, depth = 0, priority = 'urgent', signal = null, session: sess = session(),
    warm = false, front = false, local = true, _s0 = null,
  } = {}) {
    const s0 = _s0 ?? await _hydrate(key)   // a caller that already hydrated passes its snapshot
    if (_satisfied(s0, until, depth) && (local || s0.restSeen)) return s0
    if (signal?.aborted) return S().peek(key)
    const a = _noteAsked(key)
    const s = await S().ensure(key, { until, depth, priority, signal, session: sess, hydrated: true, warm, front })
    // Only an ANSWER starts the cooldown: an aborted request or a shed / failed one gives
    // the slot back (the lane's 503 backoff is what paces a shedding server).
    if ((signal?.aborted || (s?.error && s.error !== 'no_data')) && asked.get(key) === a) asked.delete(key)
    else if (s) {
      a.gen = s.gen   // the gen the answer landed under
      a.answered = true
      a.at = now()    // the cooldown runs from the ANSWER, not from when the request was queued
      if (isIntradayTf(s.tf ?? parseKey(key)?.tf)) _noteFull(key)   // every request asks a full window
    }
    return s
  }

  /**
   * Warm `keys` to DISPLAYABLE at `priority` (default background). Deduped within a tick,
   * skips keys a prepare owns, respects the re-ask cooldown. Resolves when every warm settles.
   */
  function prefetch(keys, { priority = 'background', depth = 0, signal = null, warm = false, front = false } = {}) {
    return Promise.all((keys || []).filter(Boolean).map(async (key) => {
      const s0 = await _hydrate(key)
      const full = _shortWant(key, s0)            // a short series is not warm (see SHORT_FULL_TTL_MS)
      const flip = _flipPaints(key, s0)
      if (!full && _satisfied(s0, DISPLAYABLE, depth) && flip) return s0
      if (preparing.get(key) || _cooling(key, s0)) return S().peek(key) ?? s0   // s0: the LRU may have evicted it since
      // A local copy the flip would refuse never satisfies the warm: only a server answer does
      // (`local: false`, exactly as prepareForDisplay asks).
      return ensure(key, { until: DISPLAYABLE, depth: Math.max(depth, full), priority, signal, warm, front, local: flip, _s0: s0 })
    }))
  }

  /** Queue warms for the next microtask: one ensure per key; the best priority / depth, front
   *  if any asker wanted it, warm only if every asker sent warm (a non-warm ask is not shed). */
  const RANK = { visible: 0, urgent: 1, grid: 2, background: 3 }
  function _defer(key, priority, { depth = 0, warm = false, front = false } = {}) {
    if (!key) return
    if (!batch) {
      batch = new Map()
      queueMicrotask(() => {
        const b = batch
        batch = null
        for (const [k, j] of b) prefetch([k], j)
      })
    }
    const have = batch.get(key)
    if (!have) { batch.set(key, { priority, depth, warm, front }); return }
    if (RANK[priority] < RANK[have.priority]) have.priority = priority
    have.depth = Math.max(have.depth, depth)
    have.warm = have.warm && warm
    have.front = have.front || front
  }

  // ⚡ A COPY IS JUDGED ON THE CLOCK, NOT ON ITS SAVED STATUS (owner 2026-11-20: typing SPY / QQQ / IWM on a 1m
  // chart "loads a candle or two behind", then takes a second to reach the live candle). A held key's status was
  // derived when its answer landed, and a key off screen is never polled, so a 1m answer from minutes ago still
  // read CURRENT and Enter painted it as it was; a saved copy passed on its one-bucket tolerance. A copy whose
  // newest CLOSED row is a bucket or more behind the session frontier is behind here: the typed warm asks it
  // again while the member types, and the handoff waits for that answer (at most BEHIND_HOLD_MAX_MS) before it
  // paints. An answer that landed within BEHIND_RECHECK_MS and is still behind is the name not printing (an
  // illiquid minute, a late seal): it paints as it is and is not asked again on every keystroke.
  // ⛔ 60m / 1h on an EXTENDED view buckets on the clock grid, which expectedBarsBehind does not measure (it
  // walks the 09:30 session grid): those keys keep the status rule.
  function _behindClock(key, s, showExtended) {
    const rows = s?.bars
    if (!rows?.length) return false
    // a DEVICE copy is judged by its own complete-through stamp (devicePaints / deviceStore/fresh.js)
    if (_deviceHeld(s)) return false
    const p = parseKey(key)
    if (!p || p.window || !isIntradayTf(p.tf)) return false
    const ext = session(showExtended) === 'eth'
    if (ext && Number(p.tf) >= 60) return false
    // the DEVELOPING row counts too: at a bucket roll the just-closed bucket is still the forming row until its
    // seal lands, and a copy holding it holds the frontier (a copy whose forming row is OLDER is still behind)
    const tailT = Math.max(rows[rows.length - 1].t, s.developing?.t ?? -Infinity)
    const n = expectedBarsBehind(tailT, p.tf, now(), { session: ext ? 'extended' : 'rth' })
    if (n == null || n < 1) return false
    const a = asked.get(key)
    return !(a?.answered && now() - a.at < BEHIND_RECHECK_MS)
  }

  // ── the handoff ─────────────────────────────────────────────────────────────
  function peekDisplayable(sym, tf, { showExtended } = {}) {
    if (!sym || !tf) return false
    if (!isNativeTf(tf) || !isIntradayTf(tf)) return true
    const key = keyFor(sym, tf, { showExtended })
    if (!key) return true
    const held = S().peek(key)
    if (!held) _hydrate(key)   // the mem half lands synchronously
    // A held DEVICE copy is brought forward (its synchronous half lands now; a worker read, the poll sees)
    else if (_deviceHeld(held)) { try { S().persist.refreshDevice?.(key) } catch { /* optional */ } }
    // An entry that holds no rows is looked up in mem again, SYNCHRONOUSLY and with no new IDB
    // read: the first peek made the entry, and a warmer may have promoted the key since (the
    // handoff's 25 ms poll exists to see exactly that).
    else if (!(held.depth || held.restSeen || held.developing)) { try { S().persist.hydrateMem(key) } catch { /* derived */ } }
    const s = S().peek(key)
    if (_deviceRthOnly(s, showExtended)) return false
    // (A status in HANDOFF_PAINTS already means rows are held: status.deriveStatus answers
    // empty / unavailable for an entry with none. No second rows test here: it could not be
    // proved by a test, 2026-11-16 mutation run.)
    // ...and a copy behind the clock is not painted at once: prepareForDisplay asks for the tail first
    return !!s && HANDOFF_PAINTS.includes(s.status) && !_behindClock(key, s, showExtended)
  }

  /** Does the entry hold the device's copy alone (no server answer yet)? */
  function _deviceHeld(s) { return !!s && s.source === 'device' && !s.restSeen }
  /**
   * ⛔ A DEVICE COPY IS THE REGULAR-SESSION VIEW (review of #2189): on a key both sessions share
   * (1/5/15/30) an EXTENDED view never paints it, by any rule: the store derives a shared key's status
   * with the 'rth' session, and the server's answer would add the pre/post-market bars after the paint.
   */
  function _deviceRthOnly(s, showExtended) {
    if (!_deviceHeld(s)) return false
    const p = parseKey(s.key)
    return !!p && isIntradayTf(p.tf) && p.session == null && extOf(showExtended)
  }

  /**
   * SYNCHRONOUS: the bars the store holds for (sym, tf) in the legacy shape (adapter.legacyBars,
   * sealed + developing), or null. The P3-S1 replacement of the `memPeek` readers (the handoff's
   * daily fast path, useDayFacts): an unseen key is hydrated, its mem half in this same call.
   */
  function peekBars(sym, tf, { showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    if (!key) return null
    if (!S().peek(key)) _hydrate(key)
    const s = S().peek(key)
    const rows = s ? legacyBars(s) : null
    return rows?.length ? rows : null
  }

  /** SYNCHRONOUS: does the store hold any bars for (sym, tf)? `peekBars(...)?.length` without building the
   *  whole legacy array (a new object + date string per bar: ~11 ms on a deep daily set, on every daily
   *  switch, just to read its length; production CPU profile 2026-11-19). An unseen key is hydrated, its
   *  mem half in this same call, exactly as peekBars does. */
  function holdsBars(sym, tf, { showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    if (!key) return false
    if (!S().peek(key)) _hydrate(key)
    const s = S().peek(key)
    return !!s && (s.bars.length > 0 || !!s.developing)
  }

  /** SYNCHRONOUS: how many rows (closed + the developing one) the store holds for the chart `sym` / `tf`
   *  would show, with no legacy array built. 0 for nothing held, and, with `answered`, 0 until the server
   *  has answered the key in this life (network.answered: never a saved copy alone). Never hydrates: the
   *  handoff asks it after its own peek, which already did. */
  function heldRows(sym, tf, { showExtended, answered = false } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    const s = key ? S().peek(key) : null
    if (!s) return 0
    if (answered && !(s.restSeen && S().network?.answered?.(key))) return 0
    return s.bars.length + (s.developing ? 1 : 0)
  }

  function _own(key) { preparing.set(key, (preparing.get(key) || 0) + 1) }
  function _release(key) { const n = (preparing.get(key) || 1) - 1; if (n > 0) preparing.set(key, n); else preparing.delete(key) }

  /** Map a settled snapshot onto the legacy outcome. */
  function _outcome(s, { aborted = false, date = false } = {}) {
    if (aborted || !s) return 'error'
    if (s.status === STATUS.UNAVAILABLE) return 'nodata'
    if (s.error) return 'error'
    if (DISPLAYABLE.includes(s.status)) return 'current'
    if (!s.restSeen) return date && s.depth ? 'current' : 'error'
    if (s.status === STATUS.EMPTY) return 'nodata'
    // The server answered for this exact key and has nothing newer: the held tail IS the
    // frontier for this symbol (a halt, an illiquid name). D/W/M: the server's set paints.
    return date ? 'current' : 'authoritative'
  }

  /**
   * ⭐ A WARM IS WARM ONLY IF THE FLIP WILL PAINT IT (2026-11-17). The skip above reads the
   * store's status, where a LOCAL intraday copy is `context` by the data rule
   * (`status.deriveStatus`); the handoff (`prepareForDisplay`) paints a local copy only by the
   * view's paint rule (`_localPaints`). Where the two disagree the warm skipped a row the flip
   * then refused, and the chart waited on its own request (production 2026-11-16, 60m: FNGD,
   * SSG first candles 118 / 126 ms against ~35 ms for warmed rows). So a local intraday copy
   * counts as warm only when `_localPaints` accepts it; otherwise the server is asked now, and
   * its answer (held, `restSeen`) is what the flip paints at once. A server answer, a D/W/M
   * set and a windowed (replay) key keep the status rule.
   */
  function _flipPaints(key, s) {
    if (!s || s.restSeen) return true
    const pk = parseKey(key)
    if (!pk || pk.window || !isIntradayTf(pk.tf)) return true
    const ext = pk.session ? pk.session === 'eth' : extOf(undefined)
    return _localPaints(s, pk.tf, ext)
  }

  /** Legacy `_paintCurrent`: would the chart paint this LOCAL copy as current for the view? */
  function _localPaints(s, tf, showExtended) {
    if (!s || s.restSeen || !isIntradayTf(normTf(tf))) return false
    if (_deviceRthOnly(s, showExtended)) return false
    const rows = s.developing ? [...s.bars, s.developing] : s.bars
    const lastT = rows.length ? rows[rows.length - 1].t : null
    return isCacheCurrentForView(rows, lastT, normTf(tf), { session: extOf(showExtended) ? 'extended' : 'rth', nowMs: now() })
  }

  async function prepareForDisplay(sym, tf, { signal = null, showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    if (!key) return 'error'
    if (typed && typed.key === key) typed.kept = true   // Enter on a typed text: never abort its warm
    _own(key)
    try {
      const date = isDateTf(normTf(tf) ?? fetchTf(String(tf)))
      // ⭐ THE CACHE READ IS RACED, NOT AWAITED (2026-11-16). The IDB read can take 400-900 ms
      // while the list warm is writing to the same database; awaiting it held the request for
      // the chart the member just asked for that long (flip proof on the master build: the
      // first three flips' visible request left +412 / +862 ms after the key, first candles
      // ~1 s, while the legacy path, which waits at most `_IDB_TAIL_WAIT_MS` = 120 ms, painted
      // in 42 ms median). A read that answers within HYDRATE_WAIT_MS takes the old path below;
      // otherwise the request leaves now and a local copy that paints still commits if it lands
      // before the answer.
      const t0 = now()
      const hyd = _hydrate(key)
      // The lake's whole depth loads from here, in parallel with the server (after the saved-copy
      // read: a saved copy is never overtaken). See _lakeAlone / _joined.
      const lake = date ? Promise.resolve(false) : _lakeLoad(key, hyd)
      const s0 = await Promise.race([hyd, new Promise((resolve) => setTimer(() => resolve(undefined), HYDRATE_WAIT_MS))])
      if (s0 === undefined) {
        const req = ensure(key, { until: date ? DAILY_PREPARED : PREPARED, priority: 'visible', signal, warm: false, local: false, _s0: S().peek(key) || {}, session: session(showExtended) })
        // a local copy behind the clock paints after BEHIND_HOLD_MAX_MS if the answer has not won by then
        const localFirst = hyd.then((h) => {
          if (!_localPaints(h, fetchTf(String(tf)), showExtended)) return new Promise(() => {})
          if (!_behindClock(key, h, showExtended)) return LOCAL_PAINTS
          return new Promise((resolve) => setTimer(() => resolve(LOCAL_PAINTS), BEHIND_HOLD_MAX_MS))
        })
        const won = await Promise.race([req, localFirst, _lakeAlone(lake, t0, key, fetchTf(String(tf)), showExtended)])
        if (won === LOCAL_PAINTS) { await _joined(lake); return 'current' }
        if (won === LAKE_PAINTS) return 'lake'
        return _whole(_outcome(won, { aborted: !!signal?.aborted, date }), lake)
      }
      // A SERVER answer is already held and the chart paints it (see HANDOFF_PAINTS): commit,
      // the chart's own request catches the tail up. A LOCAL-only copy is judged by the legacy
      // paint rule on the next line, never by this one (#2c).
      const heldPaints = !!s0 && !date && s0.restSeen && HANDOFF_PAINTS.includes(s0.status)
      const localPaints = !heldPaints && _localPaints(s0, fetchTf(String(tf)), showExtended)
      if ((heldPaints || localPaints) && !date && _behindClock(key, s0, showExtended)) {
        // A paintable copy behind the clock: ask for the tail first (one request, ~50-110 ms) and paint the
        // answer; past BEHIND_HOLD_MAX_MS the copy paints as it is and the answer lands on the chart.
        const req = ensure(key, { until: ASK_AGAIN, priority: 'visible', signal, warm: false, local: false, _s0: s0, session: session(showExtended) })
        await Promise.race([req, new Promise((resolve) => setTimer(resolve, BEHIND_HOLD_MAX_MS))])
        await _joined(lake)
        return 'current'
      }
      if (heldPaints) { await _joined(lake); return 'current' }
      if (localPaints) { await _joined(lake); return 'current' }   // legacy: no request
      // Otherwise only a SERVER answer prepares it. ⛔ NOT a `&warm=1` request and NOT in the
      // shared warm lane: this is the request for the chart the member just asked for. As a
      // warm it could be shed by the server (which committed an EMPTY chart: the blank frame
      // measured on 3 of 10 flips, production 2026-11-15) and it waited behind the list
      // warmers' two lane slots and their backoff (first candles 353 ms median against the
      // legacy path's 30 ms). At `visible` rank it leaves at once, and the chart's own request
      // for the same URL joins it.
      const req = ensure(key, { until: date ? DAILY_PREPARED : PREPARED, priority: 'visible', signal, warm: false, local: false, _s0: s0, session: session(showExtended) })
      // (a D/W/M key never paints from the lake: network.lakeSeed carries intraday keys only)
      const s = await Promise.race([req, _lakeAlone(lake, t0, key, fetchTf(String(tf)), showExtended)])
      if (s === LAKE_PAINTS) return 'lake'
      return _whole(_outcome(s, { aborted: !!signal?.aborted, date }), lake)
    } catch {
      return 'error'
    } finally {
      _release(key)
    }
  }

  /**
   * ⭐ THE LAKE IS A CONTESTANT IN THE HANDOFF RACE (2026-11-17). The /charts handoff keeps the old
   * chart until this prepare reports, and the lake paint (store.lakeSeed) used to start only when the
   * NEW chart subscribed: after the commit, so a slow first answer (a cold bar-server read: FROG
   * 1,523 ms) was waited out with the lake's copy of the same history already in the browser. Now
   * the lake's newest bars land in the store while the server request is in flight, and the handoff
   * commits on them ('lake'): the chart paints that history at once (provisional: live paused, the
   * forming candle held back) and the answer completes it. Never resolves when the lake has nothing
   * to paint, so the server request decides as before. `after` (the cache read) goes first: a saved
   * copy is never overtaken by the lake.
   */
  //
  // ⭐⭐ ONE PAINT, THE WHOLE CHART (2026-11-17, owner: "it shows a good chunk, then the rest a quick
  // blink later. I want them ALL instant"). The server's first answer (~70-300 ms) usually beat the
  // lake, the handoff committed on its ~1,150 bars, and the depth came in a second, visible step
  // (DEEP_ARM_MS, then windows: ~1.9 s). Now the lake's whole depth loads from Enter (store.lakeSeed:
  // one load, LAKE_PREFETCH_TARGET_BARS), and the handoff commits ONCE:
  //   * the server answers: commit when the lake's depth has joined it, waiting at most
  //     LAKE_JOIN_WAIT_MS for the join (its pieces are primed at intent);
  //   * the server is slow: commit on the lake's history alone once LAKE_ALONE_MS has passed, if it
  //     is current for the view (overnight, a lake that reaches the close); a copy without the newest
  //     bars waits for the answer, up to LAKE_BEHIND_MAX_MS (2026-11-18: the answer added a whole
  //     session in view);
  //   * a saved copy that paints: the same bounded join before it commits.
  // A key the lake does not carry resolves the load false at once and nothing waits.
  function _lakeLoad(key, after = null) {
    // a key the lake cannot carry (no lake, D/W/M, a replay window, found exhausted) answers at once:
    // nothing waits on the cache read for it
    if (!S().lakeCarries?.(key)) return Promise.resolve(false)
    // ⭐ THE CACHE READ GOES FIRST, BUT FOR AT MOST HYDRATE_WAIT_MS (2026-11-18). Measured live (MDB 1h,
    // never opened): the lake's pieces were in the browser at 862 ms, but the IDB read the load waited
    // for answered at ~1,240 ms (the list warm writes to the same database), and the depth joined then.
    // A read that answers within the bound still lands first (never overtaken); a later one is merged
    // by the reducer's rule (applyLocal: a saved copy after the lake joins it only on a proven basis,
    // otherwise replaces it). The same bound the handoff gives the read before it asks the server.
    const bounded = Promise.race([
      Promise.resolve(after).catch(() => {}),
      new Promise((resolve) => setTimer(resolve, HYDRATE_WAIT_MS)),
    ])
    return bounded
      .then(() => S().lakeSeed?.(key) ?? false)
      .catch(() => false)
  }

  /** A warm's best-effort join of the lake's whole depth (store.lakeSeed). Never rejects. */
  function _joinLake(key) {
    try { if (S().lakeCarries?.(key)) Promise.resolve(S().lakeSeed?.(key)).catch(() => {}) } catch { /* a warm only */ }
  }

  /** D/W/M: fetch `key`'s deep sealed history now and join it, the daily handoff's way with no
   *  display waiting (network.deepPrime beside a tail asked for the chart's full depth; the key's
   *  history job takes the primed answer). Resolves once joined, not due, or after `ms`; never
   *  rejects. The neighbor hold's next rows and a row the pointer rests on. */
  async function _joinDeepDate(key, { priority = 'grid', ms = DATE_NEIGHBOR_JOIN_MS } = {}) {
    await _hydrate(key)                           // a copy saved whole in this browser is not due
    if (!S().deepPending?.(key)) return false     // already whole here (or saved whole), or the split is off
    const p = parseKey(key)
    S().deepPrime?.(key, { priority })
    const s = await ensure(key, { until: DAILY_PREPARED, depth: fullBarsFor(p.tf) || 0, priority, local: false })
    return s?.restSeen && !s.error ? !!(await S().deepJoined?.(key, ms)) : false
  }

  /**
   * ⭐ A CURRENT DEVICE COPY IS A WHOLE FIRST PAINT (data/deviceStore, behind 'uct.deviceStore'). The
   * seed holds each timeframe's newest window (1m 600, 5m-30m 300, 60m 1000, D 350 bars) and its live
   * overlay carries today to the last closed minute: more than the chart's default view and an
   * indicator's warm-up. So when the key holds the device's copy (no server answer yet) and the
   * store's status says it is current enough to paint (HANDOFF_PAINTS), the switch paints it at once
   * instead of waiting for the lake's or the daily history's deep join; the depth joins behind the
   * view, and the server's answer joins or replaces the rows under the reducer's rules.
   * ⛔ Not on an EXTENDED view of a key both sessions share (1/5/15/30): the seed is the regular-session
   * view, and the server's answer would add the pre/post-market bars after the paint (a visible change).
   * ⛔ ONLY WHILE RECENT, for every tf (review of #2189): the copy must be complete through the last
   * 2 minutes during the session, or through the end of the last closed session outside it
   * (deviceStore/fresh.deviceCopyFresh, on the copy's `through`). The store's status alone cannot say
   * it: W and M are never "behind" by status, and a copy warmed hours ago would read current.
   */
  function devicePaints(sym, tf, opts = {}) { return deviceVerdict(sym, tf, opts).paints }

  /**
   * The device rule's whole answer, the ONE decision devicePaints returns the first half of:
   *   paints  true when the switch paints the device copy at once
   *   reason  'paints', or the rule that refused: 'no-key' | 'none' (nothing held) | 'held:<source>' (another
   *           copy holds the key: the device is not consulted) | 'server-answered' | 'ext-hours' (an extended
   *           view of a shared key) | 'status:<status>' (not current enough by the store's status) | 'stale'
   *           (not complete through the last 2 minutes / the last closed session, deviceStore/fresh.js)
   *   held    what the store holds for the key right now: 'device' | 'server' (the device copy joined by an
   *           answer) | another source | 'none'. What a chart committed now paints first.
   */
  function deviceVerdict(sym, tf, { showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    const p = key ? parseKey(key) : null
    if (!p) return { paints: false, reason: 'no-key', held: 'none' }
    // a held copy that is not fresh is brought forward first (its synchronous half lands now)
    if (_deviceHeld(S().peek(key)) && !deviceCopyFresh(S().persist.deviceThroughOf?.(key), p.tf, now())) {
      try { S().persist.refreshDevice?.(key) } catch { /* optional */ }
    }
    const s = S().peek(key)
    const held = !s ? 'none' : s.source === 'device' ? (s.restSeen ? 'server' : 'device') : String(s.source || 'unknown')
    if (!s) return { paints: false, reason: 'none', held }
    if (!_deviceHeld(s)) return { paints: false, reason: s.source === 'device' ? 'server-answered' : `held:${held}`, held }
    if (_deviceRthOnly(s, showExtended)) return { paints: false, reason: 'ext-hours', held }
    if (!HANDOFF_PAINTS.includes(s.status)) return { paints: false, reason: `status:${s.status}`, held }
    if (!deviceCopyFresh(S().persist.deviceThroughOf?.(key), p.tf, now())) return { paints: false, reason: 'stale', held }
    return { paints: true, reason: 'paints', held }
  }

  /**
   * ⭐ (2026-11-21, the cold switch) START THE DEVICE READ NOW: the key handler's, before the chart has rendered
   * the request (hooks/handoffGroups.primeGroup). A copy the device client already holds lands synchronously (its
   * recently-read cache); otherwise one worker read leaves now and lands when it lands, instead of after the
   * render and the handoff's effect (persist.refreshDevice: only an entry with no server answer). Resolves true
   * when the entry moved. Nothing when the device store is off (no source).
   */
  function deviceWarm(sym, tf, { showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    if (!key) return Promise.resolve(false)
    try { return Promise.resolve(S().persist?.refreshDevice?.(key)).catch(() => false) } catch { return Promise.resolve(false) }
  }

  /**
   * ⭐ (2026-11-21) Call `cb` on every change of the entry `sym` / `tf` would show, WITHOUT starting its life cycle
   * (the registry's own subscription: no hydrate, no network). For a waiter that used to poll the entry (the
   * handoff's POLL_MS). Returns the unsubscribe, or null when this store has no registry to watch.
   */
  function watch(sym, tf, { showExtended } = {}, cb) {
    const key = keyFor(sym, tf, { showExtended })
    const reg = S().registry
    if (!key || !reg?.subscribe) return null
    try { return reg.subscribe(key, () => { try { cb() } catch { /* the watcher's */ } }, { wake: 'all' }) } catch { return null }
  }

  /** Is the lake's whole depth still due for the chart `sym` / `tf` would show (store.lakePending)?
   *  The handoff paints a held key at once only when it is not: otherwise it prepares, and the
   *  prepare waits for the join (bounded) so the first paint is the whole chart. */
  function lakePending(sym, tf, { showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    return !!key && !!S().lakePending?.(key)
  }

  /** LAKE_PAINTS once the lake has painted before any answer AND the server has had LAKE_ALONE_MS,
   *  if the copy is current for the view (`_localPaints`); a copy that is behind waits for the answer
   *  until LAKE_BEHIND_MAX_MS. ⛔ During the session the lake never holds today's bars: committed at
   *  LAKE_ALONE_MS, the chart drew yesterday's close as its edge and the answer then added the whole
   *  session in view (the step the owner sees). */
  function _lakeAlone(lake, t0, key, tf, showExtended) {
    const never = new Promise(() => {})
    return lake.then((r) => (r === 'seed'
      ? new Promise((resolve) => {
        const at = (ms, fn) => setTimer(fn, Math.max(0, t0 + ms - now()))
        at(LAKE_ALONE_MS, () => {
          if (_localPaints(S().peek(key), tf, showExtended)) resolve(LAKE_PAINTS)
          else at(LAKE_BEHIND_MAX_MS, () => resolve(LAKE_PAINTS))
        })
      })
      : never), () => never)
  }

  /** The lake load, or LAKE_JOIN_WAIT_MS, whichever comes first. Never rejects. */
  function _joined(lake) {
    return Promise.race([lake, new Promise((resolve) => setTimer(resolve, LAKE_JOIN_WAIT_MS))]).catch(() => {})
  }

  /** A server outcome the chart paints waits for the lake's depth to join it (bounded). */
  async function _whole(outcome, lake) {
    if (outcome === 'current' || outcome === 'authoritative') await _joined(lake)
    return outcome
  }

  async function prepareDailyForDisplay(sym, tf, { signal = null, showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    if (!key) return 'error'
    if (typed && typed.key === key) typed.kept = true   // Enter on a typed text: never abort its warm
    _own(key)
    try {
      // ⭐⭐ ONE PAINT, THE WHOLE DAILY CHART (2026-11-19, owner: "about 200 bars instantly and then
      // the rest shortly after, definitely in 2 phases. I want that all to load perfectly and
      // instantly"). Where the deep history is due (network.deepPending) it leaves NOW, beside the
      // tail (deepPrime), the tail is asked for the chart's full depth so its answer queues the join,
      // and the handoff commits once the join has settled, waiting at most DEEP_JOIN_WAIT_MS from here
      // (the handoff's own bound, DAILY_HOLD_MAX_MS, is just above it). The cache read is raced, not
      // awaited (the intraday prepare's rule, HYDRATE_WAIT_MS): a busy IndexedDB held the daily
      // request 0.15-0.7 s after Enter (production 2026-11-18). A shallow set already in memory has
      // its history due for certain, so it leaves before the read; a saved copy that turns out deep
      // (its history joined on an earlier visit) is not due, and takes the old path.
      const t0 = now()
      if (S().peek(key)?.bars?.length && S().deepPending?.(key)) S().deepPrime?.(key, { priority: 'visible', want: true })
      const hyd = _hydrate(key)
      const s0 = await Promise.race([hyd, new Promise((resolve) => setTimer(() => resolve(undefined), HYDRATE_WAIT_MS))])
      if (!S().deepPending?.(key)) {
        const s = await ensure(key, { until: DAILY_PREPARED, priority: 'urgent', signal, _s0: s0 ?? null })
        return _outcome(s, { aborted: !!signal?.aborted, date: true })
      }
      S().deepPrime?.(key, { priority: 'visible', want: true })   // (joins the one above, if it left)
      const depth = fullBarsFor(normTf(tf) ?? fetchTf(String(tf))) || 0
      const s = await ensure(key, { until: DAILY_PREPARED, depth, priority: 'visible', signal, local: false, _s0: s0 ?? S().peek(key) ?? {} })
      if (!signal?.aborted && s?.restSeen && !s.error) await S().deepJoined?.(key, Math.max(0, DEEP_JOIN_WAIT_MS - (now() - t0)))
      return _outcome(S().peek(key) ?? s, { aborted: !!signal?.aborted, date: true })
    } catch {
      return 'error'
    } finally {
      _release(key)
    }
  }

  /** D/W/M: is the deep sealed history still due for the chart `sym` / `tf` would show? The handoff
   *  then prepares instead of painting a held shallow set at once (see prepareDailyForDisplay). */
  function deepPending(sym, tf, { showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    return !!key && !!S().deepPending?.(key)
  }

  // ── the legacy warmers, as store prefetches ────────────────────────────────
  function _many(tickers, tf, priority, opts = {}, showExtended = undefined) {
    for (const sym of tickers) { _defer(keyFor(sym, tf, { showExtended }), priority, opts); tickerMeta(sym) }
  }

  function prefetchBars(tickers, tf = 'D', { priority = false, urgent = false } = {}) {
    if (!tickers?.length) return
    const syms = tickers.filter(Boolean)
    tellSymbolWarmers(syms, tf, { priority: priority || urgent })
    const nUrgent = urgent ? Math.min(URGENT_MAX_PER_CALL, syms.length) : 0
    if (urgent) {
      // Only the LATEST urgent call stays urgent: rows the member already passed are aborted
      // (a waiting lane request never reaches the network). ⛔ PER TIMEFRAME (2026-11-19): a list
      // linked to a daily AND an hourly chart warms both on every press; aborting every other key
      // made the second call cancel the first timeframe's next rows.
      const keep = new Set(syms.slice(0, nUrgent).map((x) => keyFor(x, tf)))
      const callTf = parseKey([...keep][0] || '')?.tf
      for (const [k, c] of urgentCtl) if (!keep.has(k) && parseKey(k)?.tf === callTf) { c.abort(); urgentCtl.delete(k) }
      for (const sym of syms.slice(0, nUrgent)) {
        const k = keyFor(sym, tf)
        if (!k) continue
        if (!urgentCtl.has(k)) urgentCtl.set(k, new AbortController())
        const c = urgentCtl.get(k)
        // Legacy: the chart's own URL (no `&warm`), at the head of the queue.
        prefetch([k], { priority: 'urgent', signal: c.signal, front: true }).finally(() => { if (urgentCtl.get(k) === c) urgentCtl.delete(k) })
        tickerMeta(sym)
      }
    }
    _many(syms.slice(nUrgent), tf, 'background', { warm: true, front: !!priority })
  }

  function prefetchBar(sym, tf = 'D') {
    if (!sym) return
    tellSymbolWarmers([sym], tf, { priority: true })
    _many([sym], tf, 'background', { warm: true })
  }

  function prefetchBarsToIDB(tickers, tf = 'D', { priority = false, immediate = false, visible = false, showExtended } = {}) {
    if (!tickers?.length) return
    tellSymbolWarmers(tickers.filter(Boolean), tf, { priority, visible })
    _many(tickers.filter(Boolean), tf, immediate ? 'urgent' : (visible ? 'grid' : 'background'), { warm: true, front: !!priority }, showExtended)
  }

  function prefetchAllTimeframes(sym) {
    if (!sym) return
    for (const tf of ALL_TFS) prefetchBarsToIDB([sym], tf)
  }

  function prefetchListAllTimeframes(tickers, { tfs = SCAN_WARM_TFS, cap = SCAN_WARM_CAP } = {}) {
    if (!tickers?.length) return
    const list = [...new Set(tickers.filter(Boolean))].slice(0, cap)
    for (const tf of tfs) prefetchBarsToIDB(list, tf)
  }

  /** Multi-Chart grid: every cell × every tf at `grid` (shares the lane's slots). */
  function prefetchGridWarm(tickers) {
    if (!tickers?.length) return
    const list = [...new Set(tickers.filter(Boolean))].slice(0, SCAN_WARM_CAP)
    for (const tf of GRID_WARM_TFS) _many(list, tf, 'grid', { warm: true })
  }

  /**
   * ⭐ THE ROWS AROUND A LIST'S SELECTION STAY IN THE STORE (2026-11-17). A list warm loads
   * every row at the chart's tf AND daily — ~200 keys for a 100-row list, the registry's whole
   * LRU (`DEFAULT_MAX_KEYS`) — so the rows next to the selection were evicted before the
   * member reached them, and the flip re-read them from IndexedDB (400-900 ms while the warm
   * writes) and lost the race to its own request (flip proof 2026-11-17, 60m UVXY 109 ms, 5m
   * UVXY 100 ms, against ~35 ms for rows still held). A hold PINS its keys (registry refs, never
   * evicted) and hydrates them; `set` swaps the window, `clear` lets them go. One hold per list
   * (two lists on a board never release each other's rows); a dozen keys, a few thousand bars.
   */
  //
  // ⭐ AND THE NEXT ROWS ARRIVE DEEP (2026-11-17, `deep`). A flip painted the next row's first
  // window (~470 bars) in ~30 ms, but its older history came only after the chart had rested
  // DEEP_ARM_MS and asked two 2,000-bar windows in turn: 2,000+ bars at ~470 ms (production
  // flip proof, 60m/15m/5m), where daily paints its whole history in the first frame. So while
  // the member rests on a row, the hold asks the SAME windows the chart would (store scroll-back,
  // PREFETCH_WINDOWS of them, up to HISTORY_PREFETCH_TARGET_BARS) for the rows named in `deep`
  // (the next one or two): the flip then paints them deep. Bounded: only after the selection has
  // rested NEIGHBOR_DEEP_MS (a held key or a fast scan never starts one), one request at a time,
  // at `grid` rank (the chart's own deep windows' rank, behind the visible chart), a new `set`
  // abandons the rest. Intraday, non-replay keys only here; D/W/M below.
  // Off: localStorage 'uct.deepNeighbors' = '0' (or the chart's 'uct.intradayDeepBackfill.enabled'
  // = '0', which turns every intraday deep window off).
  //
  // ⭐ ...AND THE NEXT DAILY ROWS ARRIVE WHOLE TOO (2026-11-19, owner: "only some load instantly, then
  // some take time. Some load 400 candles or so and then load the rest a second later"). D/W/M were
  // left out on the belief that they "come whole from the daily pack", but the pack holds ~300 rows a
  // symbol: every daily flip onto a row not opened before waited for its deep sealed history at the
  // flip (production flip proof, Nasdaq 100 at 0.8 s a row: first frame median 112 ms, and a row whose
  // tail request stalled painted 600 bars at +443 ms and its 11,766 at +659). So once the selection has
  // rested DATE_NEIGHBOR_DEEP_MS, the hold fetches the next rows' deep history the way the daily
  // handoff does (network.deepPrime beside a tail asked for the chart's full depth, joined by the key's
  // history job), one row at a time, at `grid` rank; the flip then paints them whole from memory. The
  // history is one edge-cached request (~50-100 ms), so the rest is shorter than the intraday one.
  // Same switch ('uct.deepNeighbors' = '0').
  function createNeighborHold() {
    let held = new Map()   // key → true
    let deepTimer = null
    let dateTimer = null
    let deepGen = 0
    const stopDeep = () => {
      deepGen++
      if (deepTimer != null) { clearTimer(deepTimer); deepTimer = null }
      if (dateTimer != null) { clearTimer(dateTimer); dateTimer = null }
    }
    // D/W/M: the deep sealed history of each row, joined before the member gets there.
    async function deepenDates(keys, gen) {
      for (const k of keys) {
        if (gen !== deepGen || !held.has(k)) return
        await _joinDeepDate(k, { priority: 'grid' })
      }
    }
    async function deepen(keys, gen) {
      for (const k of keys) {
        for (let i = 0; i < PREFETCH_WINDOWS; i++) {
          if (gen !== deepGen || !held.has(k)) return
          let s = S().peek(k)
          // A window prepends to a SERVER answer (the urgent warm's), never to a local copy alone.
          if (!s?.restSeen) {
            await prefetch([k], { priority: 'grid' })
            if (gen !== deepGen || !held.has(k)) return
            s = S().peek(k)
          }
          // the chart's own target: deeper where the lake carries the key (historyPrepend)
          const lakeCarries = !!S().lakeCarries?.(k)
          // ⭐ A LOCAL COPY GETS THE LAKE'S DEPTH TOO (2026-11-19). A row that still holds only a saved
          // copy after the warm (it paints as it is, so the warm asked nothing; or the ask was cooling or
          // shed) stopped here, and on 5m the flip onto it waited the whole LAKE_JOIN_WAIT_MS for its lake
          // pieces and then painted ~1,000 bars with the rest ~200 ms later (production flip proof: AEP,
          // IDXX, HONA, every piece from the network). The lake joins a local copy only where its rows
          // prove the held basis (reducer applyLocal), exactly as on the typed and hovered paths.
          if (!s?.restSeen && lakeCarries && s?.bars?.length) {
            await Promise.resolve().then(() => S().lakeSeed?.(k)).catch(() => false)
            break
          }
          if (!s?.restSeen || !s.bars?.length || s.status === STATUS.UNAVAILABLE || s.depth >= prefetchTargetBars(lakeCarries, parseKey(k)?.tf)) break
          // ⭐ Where the lake carries it, the WHOLE depth in one load (store.lakeSeed), so the flip paints
          // the row as deep as the chart will ever hold it (2026-11-17: two windows left it at ~13,000 of
          // 20,000, and the chart's own deepening then showed in view). Server windows otherwise.
          if (lakeCarries) {
            const joined = await Promise.resolve().then(() => S().lakeSeed?.(k)).catch(() => false)
            if (joined) break
          }
          const res = await Promise.resolve().then(() => S().scrollBack(k, { priority: 'grid' })).catch(deepWindowFailed)
          // Nothing older, refused at the seam, still filling or failed: this row is done for now
          // (the chart's own loader retries a filling window when the member lands on it).
          if (!res?.ok || !(res.added > 0) || res.filling) break
        }
      }
    }
    return {
      set(syms, tf, { showExtended, deep = null } = {}) {
        const st = S()
        const want = new Map()
        for (const sym of syms || []) { const k = keyFor(sym, tf, { showExtended }); if (k) want.set(k, true) }
        for (const k of want.keys()) if (!held.has(k)) { st.registry.acquire(k); _hydrate(k) }
        for (const k of held.keys()) if (!want.has(k)) st.registry.release(k)
        held = want
        stopDeep()
        if (!deep?.length || !deepNeighbors()) return
        const next = []
        const dates = []
        for (const sym of deep) {
          const k = keyFor(sym, tf, { showExtended })
          const p = k ? parseKey(k) : null
          if (!p || p.window || !want.has(k) || next.includes(k) || dates.includes(k)) continue
          if (isIntradayTf(p.tf)) next.push(k)
          else if (isDateTf(p.tf)) dates.push(k)
        }
        const gen = deepGen
        if (dates.length) dateTimer = setTimer(() => { dateTimer = null; deepenDates(dates, gen).catch(() => {}) }, DATE_NEIGHBOR_DEEP_MS)
        if (!next.length) return
        deepTimer = setTimer(() => { deepTimer = null; deepen(next, gen).catch(() => {}) }, NEIGHBOR_DEEP_MS)
      },
      clear() {
        stopDeep()
        const st = S()
        for (const k of held.keys()) st.registry.release(k)
        held = new Map()
      },
      keys: () => [...held.keys()],
    }
  }

  /** IDB → store, no network (the legacy IDB → mem promotion). */
  function warmMemFromIDB(tickers, tfs = SCAN_WARM_TFS) {
    if (!tickers?.length) return
    for (const sym of tickers) {
      if (!sym) continue
      for (const tf of tfs) { const k = keyFor(sym, tf); if (k) _hydrate(k) }
    }
  }

  function prewarmVisibleList(tickers, { chartTf = 'D', memTop = 24, cap = 500 } = {}) {
    if (listPrewarmDisabled()) return
    const list = [...new Set((tickers || []).filter(Boolean))].slice(0, cap)
    if (!list.length) return
    const tf = chartTf || 'D'
    prefetchBarsToIDB(list.slice(0, memTop), tf, { priority: true, visible: true })
    prefetchBarsToIDB(list.slice(memTop), tf, { priority: true })
    if (tf !== 'D') prefetchBarsToIDB(list, 'D', { priority: true })
    warmMemFromIDB(list.slice(0, memTop), tf !== 'D' ? [tf, 'D'] : ['D'])
    edgeWarmList(list, { chartTf: tf })
  }

  // ── the EDGE warm of a list's intraday history (2026-11-18) ──
  // Owner's standard: a ticker opened on 1h (any intraday tf), zoomed all the way out, shows its whole
  // history at once. Its pieces load in ~70 ms when this data center's edge already holds them and
  // 300-950 ms when it does not (measured live), so a list a member views on an INTRADAY chart warms
  // the edge for its top rows: HEADs, no bodies (historyFeed.edgeWarm). Bounded (review of #1880):
  //  - only intraday callers (a daily list such as Market Map warms nothing), and only the chart's own
  //    timeframe plus 60m (the deepest), for the first EDGE_WARM_CAP rows;
  //  - a new list REPLACES the queue (the old list is off screen); EDGE_WARM_PAGE_BUDGET keys per page;
  //  - one key at a time, EDGE_WARM_DELAY_MS after the latest list (its own bars go first);
  //  - a hidden tab pauses it; a 401/403 (no entitlement) stops it for the page.
  const edgeQueue = []
  const edgeDone = new Set()
  let edgeRunning = false
  let edgeBlocked = false
  let edgeSpent = 0
  let edgeListAt = 0
  const edgeHidden = () => { try { return typeof document !== 'undefined' && document.visibilityState === 'hidden' } catch { return false } }
  function edgeWarmList(tickers, { chartTf = 'D', cap = EDGE_WARM_CAP } = {}) {
    const st = S()
    const tf0 = String(chartTf)
    if (edgeBlocked || !st?.lakeEdgeWarm || !tickers?.length || !EDGE_WARM_TFS.includes(tf0)) return
    const list = [...new Set(tickers.filter(Boolean))].slice(0, cap)
    const fresh = []
    for (const tf of [...new Set([tf0, '60'])]) {
      for (const sym of list) {
        const k = keyFor(sym, tf)
        if (!k || edgeDone.has(k) || fresh.includes(k)) continue
        let carries = false
        try { carries = !!st.lakeCarries?.(k) } catch { carries = false }
        if (carries) fresh.push(k)
      }
    }
    // the list on screen replaces the one before it; the same list sent again (a retime, a refresh)
    // neither restarts the delay nor reorders the queue
    const same = fresh.length === edgeQueue.length && fresh.every((k, i) => k === edgeQueue[i])
    if (!same) {
      edgeQueue.length = 0
      edgeQueue.push(...fresh)
      edgeListAt = Date.now()
    }
    if (edgeRunning || !fresh.length) return
    edgeRunning = true
    const pause = (ms) => new Promise((r) => setTimeout(r, ms))
    ;(async () => {
      try {
        while (edgeQueue.length && !edgeBlocked && edgeSpent < EDGE_WARM_PAGE_BUDGET) {
          const wait = edgeListAt + EDGE_WARM_DELAY_MS - Date.now()
          if (wait > 0) { await pause(wait); continue }
          if (edgeHidden()) break      // the next list a visible page opens resumes it
          const k = edgeQueue.shift()
          if (edgeDone.has(k)) continue
          edgeDone.add(k); edgeSpent++
          let r = 0
          try { r = await S().lakeEdgeWarm(k) } catch { r = 0 }
          if (r === EDGE_WARM_REFUSED) edgeBlocked = true
        }
      } finally { edgeRunning = false }
    })()
  }

  function prefetchListDeep(tickers, { tfs = DEEP_WARM_TFS, cap = DEEP_WARM_CAP, priority = false } = {}) {
    if (!tickers?.length) return
    const list = [...new Set(tickers.filter(Boolean))].slice(0, cap)
    for (const tf of tfs) {
      for (const sym of list) _defer(keyFor(sym, tf), 'background', { depth: fullBarsFor(tf) || 0, warm: true, front: !!priority })
    }
    for (const sym of list) tickerMeta(sym)
  }

  /** Replay: the windowed (`@to=`) key of each intraday tf for the cutoff date. */
  function prefetchReplayTimeframes(sym, cutoffIso, { bars = 4000 } = {}) {
    if (!sym || !cutoffIso || !/^\d{4}-\d{2}-\d{2}$/.test(String(cutoffIso))) return
    const [y, m, d] = String(cutoffIso).split('-').map(Number)
    const to = Date.UTC(y, m - 1, d, 17) / 1000   // 12:00/13:00 ET: its ET date is the cutoff
    for (const tf of REPLAY_WARM_TFS) _defer(keyFor(sym, tf, { window: { to } }), 'background', { depth: bars, warm: true })
  }

  function prefetchBarOnIntent(sym, tf = 'D', { delay = 120 } = {}) {
    if (!sym || !tf) return
    const key = keyFor(sym, tf)
    if (!key || intentTimers.has(key)) return
    // Held bars need nothing; the companion warmers are still told, after the same debounce
    // (legacy `prefetchBarOnIntent`).
    const held = DISPLAYABLE.includes(S().peek(key)?.status)
    intentTimers.set(key, setTimer(() => {
      intentTimers.delete(key)
      tellSymbolWarmers([sym], tf, { priority: true })
      // the pointer rests on the row: its deep history from now too (a no-op off the lake), and its
      // whole depth joins the answer, so the click paints the whole chart at once
      try { S().primeLake?.(key) } catch { /* a warm only */ }
      // D/W/M: its deep sealed history joins now too (2026-11-19: a click onto a daily row not opened
      // before waited for it, ~100 ms, or painted the pack's rows first when the tail stalled)
      if (isDateTf(parseKey(key)?.tf) && S().deepPending?.(key)) { _joinDeepDate(key, { priority: 'urgent' }).catch(() => {}); return }
      Promise.resolve(held ? null : prefetch([key], { priority: 'urgent' })).catch(() => {}).then(() => _joinLake(key))
    }, delay))
    if (!held) tickerMeta(sym)
  }
  // ⭐ TYPED INTRADAY (2026-11-17). The typed warm was D/W/M only, so a member who typed a ticker on a
  // 5m / 60m / 1m chart waited on the chart's own request after Enter (~70-110 ms: a cold first paint
  // measured on production, 40 random stocks) while the same Enter on daily painted from memory. The
  // intraday key of the typed text is now asked when the text settles (SymbolSearch
  // TYPED_INTENT_SETTLE_MS, 140 ms): by Enter it is held and the handoff paints it like a list flip.
  // ⛔ A PREFIX IS NOT A TICKER: the daily pack holds every symbol's daily set, so text with none is a
  // partial word on the way to one and costs nothing (the D path's rule, read from the D key).
  function _warmTypedIntraday(sym, tf) {
    if (!_isSym(String(sym))) return null
    const T = String(sym).trim().toUpperCase()
    const key = keyFor(T, tf)
    const p = key ? parseKey(key) : null
    if (!p || p.window || !isIntradayTf(p.tf)) return null
    if (typed && typed.key !== key) {
      if (!typed.kept) typed.ctl.abort()
      typed = null
    }
    // A copy behind the clock (_behindClock, above the handoff) is asked again while the member types, so the
    // answer is usually held by Enter.
    const closedBehind = (s) => _behindClock(key, s)
    const held = S().peek(key)
    if (held?.restSeen && HANDOFF_PAINTS.includes(held.status) && !closedBehind(held)) return null   // the flip paints it as it is
    if (typed && typed.key === key) return null
    const ctl = new AbortController()
    const mine = { key, ctl, kept: false }
    typed = mine
    return (async () => {
      // ⛔ NEVER WAIT ON THE CACHE HERE (production 2026-11-17, a profile ingesting the daily pack, its
      // IndexedDB busy): the daily and intraday reads outlasted the member's pause, the warm never
      // left before Enter, and NAGE / RIOT painted 229-237 ms after it. Each read gets
      // INTENT_HYDRATE_RACE_MS; one that has not answered by then does not hold the request up.
      // While the pack ingests it cannot vouch either way, so its read is skipped.
      // The lake's index and newest pieces are fetched NOW, before anything is decided (a prefix's
      // index is a cheap 404): by Enter the pieces are in the browser for the lake paint.
      try { S().primeLake?.(key) } catch { /* a warm only */ }
      if (!packIngesting()) {
        const d = await _raced(_hydrate(keyFor(T, 'D')), INTENT_HYDRATE_RACE_MS)
        if (typed !== mine) return 'superseded'
        if (d !== undefined && !d?.depth) {
          // The daily pack does not know it. A partial word, or a real ticker the pack lacks
          // (2026-11-17: 4 of 10 never-opened tickers sent nothing before Enter): the lake's index
          // is the second authority.
          const inLake = await _raced(S().lakeHas?.(T) ?? Promise.resolve(false), INTENT_LAKE_INDEX_WAIT_MS)
          if (typed !== mine) return 'superseded'
          if (inLake !== true) return 'unknown'
        }
      }
      const s0 = (await _raced(_hydrate(key), INTENT_HYDRATE_RACE_MS)) ?? S().peek(key)
      if (typed !== mine) return 'superseded'
      tellSymbolWarmers([T], tf, { priority: true })
      const behind = closedBehind(s0)
      if (!behind && _localPaints(s0, fetchTf(String(tf)))) { _joinLake(key); return 'cache' }
      // a copy behind the clock is asked even when its status says it is satisfied (ASK_AGAIN: no status is)
      const s = await ensure(key, { until: behind ? ASK_AGAIN : DISPLAYABLE, priority: 'urgent', signal: ctl.signal, local: false, _s0: s0 || {} })
      if (ctl.signal.aborted && !mine.kept) return false
      // ⭐ AND ITS WHOLE DEPTH BEFORE ENTER (2026-11-17): the handoff paints a held key at once, so a
      // key held with only the answer's ~1,150 bars painted shallow and the depth joined a blink later
      // (production A/B: first frame ~1,100 bars, the lake's depth ~250 ms after). The lake's whole
      // depth joins it now, while the member is still typing.
      if (typed === mine) _joinLake(key)
      // (an intraday answer early in a bucket can be the forming bar alone: still the server's answer)
      return s?.restSeen && !s.error && (s.depth || s.developing) ? 'network' : false
    })().catch(() => false).finally(() => { if (typed === mine) typed = null })
  }

  function warmTypedSymbol(sym, tf = 'D') {
    if (!sym || !tf) return null
    if (!['D', 'W', 'M'].includes(String(tf))) return _warmTypedIntraday(sym, tf)
    if (!_isSym(String(sym))) return null
    const key = keyFor(String(sym).trim().toUpperCase(), tf)
    if (!key) return null
    if (typed && typed.key !== key) {
      if (!typed.kept) typed.ctl.abort()
      typed = null
    }
    const held = S().peek(key)
    const typedSym = String(sym).trim().toUpperCase()
    if (held?.restSeen && held.status === STATUS.CURRENT && asked.has(key) && now() - asked.get(key).at < TYPED_REASK_MS) {
      tellSymbolWarmers([typedSym], tf, { priority: true })   // a known name, bars current: its companions may not be
      return null
    }
    if (typed && typed.key === key) return null
    const ctl = new AbortController()
    const mine = { key, ctl, kept: false }
    typed = mine
    return (async () => {
      const s0 = await _hydrate(key)
      if (typed !== mine) return 'superseded'
      // Legacy `_typedCachePaints`: the chart's daily paint authority, with the record's savedAt.
      // ⭐ THE WHOLE DEPTH BEFORE ENTER (2026-11-19): a real ticker whose deep history is still due
      // has it fetched now (network.deepPrime) and its tail asked for the chart's depth, so the join
      // lands while the member is still typing and Enter paints the whole chart at once.
      const deep = !!s0?.depth && !!S().deepPending?.(key)
      if (deep) S().deepPrime?.(key, { priority: 'urgent' })
      if (s0?.depth) {
        // A held set exists, so the text IS a ticker (a prefix has none, see below).
        tellSymbolWarmers([typedSym], tf, { priority: true })
        const last = s0.developing ? s0.developing.t : s0.bars[s0.bars.length - 1].t
        if (!deep && _typedCachePaints(key.split('_')[0], String(tf), unixToDateLabel(last), S().persist.savedAtOf?.(key) ?? null)) return 'cache'
      }
      // ⛔ A PREFIX IS NOT A TICKER: with the pack held, uncached text is a partial word.
      if (!s0?.depth && !packIngesting()) return 'unknown'
      const depth = deep ? (fullBarsFor(String(tf)) || 0) : 0
      const s = await ensure(key, { until: DISPLAYABLE, depth, priority: 'urgent', signal: ctl.signal, local: false })
      if (ctl.signal.aborted && !mine.kept) return false
      const answered = !!(s?.restSeen && !s.error && s.depth)
      if (answered && !s0?.depth && typed === mine) tellSymbolWarmers([typedSym], tf, { priority: true })   // the authority just said it is real
      return answered ? 'network' : false
    })().catch(() => false).finally(() => { if (typed === mine) typed = null })
  }

  return {
    keyFor, peek, ensure, prefetch, peekDisplayable, peekBars, holdsBars, heldRows, prepareForDisplay, prepareDailyForDisplay, lakePending, deepPending, devicePaints, deviceVerdict, deviceWarm, watch,
    prefetchBars, prefetchBar, prefetchBarsToIDB, prefetchAllTimeframes, prefetchListAllTimeframes,
    prefetchGridWarm, warmMemFromIDB, prewarmVisibleList, prefetchListDeep, prefetchReplayTimeframes,
    prefetchBarOnIntent, warmTypedSymbol, createNeighborHold, edgeWarmList,
    /** @internal */ _stats: () => ({ asked: asked.size, preparing: preparing.size, urgent: urgentCtl.size }),
  }
}

// ── the module facade: the app's one instance, created on first use ─────────
let _default = null
function _f() { if (!_default) _default = createPrefetch(); return _default }
/** Test hook. */
export function _resetPrefetchForTests() { _default = null }

export const peek = (key) => _f().peek(key)
export const ensure = (key, opts) => _f().ensure(key, opts)
export const prefetch = (keys, opts) => _f().prefetch(keys, opts)
export function peekDisplayable(sym, tf, opts = {}) { return _f().peekDisplayable(sym, tf, opts) }
export function peekBars(sym, tf, opts = {}) { return _f().peekBars(sym, tf, opts) }
export function holdsBars(sym, tf, opts = {}) { return _f().holdsBars(sym, tf, opts) }
export function heldRows(sym, tf, opts = {}) { return _f().heldRows(sym, tf, opts) }
export function prepareForDisplay(sym, tf, opts = {}) { return _f().prepareForDisplay(sym, tf, opts) }
export function lakePending(sym, tf, opts = {}) { return _f().lakePending(sym, tf, opts) }
export function deepPending(sym, tf, opts = {}) { return _f().deepPending(sym, tf, opts) }
export function devicePaints(sym, tf, opts = {}) { return _f().devicePaints(sym, tf, opts) }
export function deviceVerdict(sym, tf, opts = {}) { return _f().deviceVerdict(sym, tf, opts) }
export function deviceWarm(sym, tf, opts = {}) { return _f().deviceWarm(sym, tf, opts) }
export function watch(sym, tf, opts = {}, cb) { return _f().watch(sym, tf, opts, cb) }
export function prepareDailyForDisplay(sym, tf, opts = {}) { return _f().prepareDailyForDisplay(sym, tf, opts) }
export function prefetchBars(tickers, tf = 'D', opts = {}) { return _f().prefetchBars(tickers, tf, opts) }
export function prefetchBar(sym, tf = 'D') { return _f().prefetchBar(sym, tf) }
export function prefetchBarsToIDB(tickers, tf = 'D', opts = {}) { return _f().prefetchBarsToIDB(tickers, tf, opts) }
export function prefetchAllTimeframes(sym) { return _f().prefetchAllTimeframes(sym) }
export function prefetchListAllTimeframes(tickers, opts = {}) { return _f().prefetchListAllTimeframes(tickers, opts) }
export function prefetchGridWarm(tickers) { return _f().prefetchGridWarm(tickers) }
export function warmMemFromIDB(tickers, tfs = SCAN_WARM_TFS) { return _f().warmMemFromIDB(tickers, tfs) }
export function prewarmVisibleList(tickers, opts = {}) { return _f().prewarmVisibleList(tickers, opts) }
export function prefetchListDeep(tickers, opts = {}) { return _f().prefetchListDeep(tickers, opts) }
export function prefetchReplayTimeframes(sym, cutoffIso, opts = {}) { return _f().prefetchReplayTimeframes(sym, cutoffIso, opts) }
export function prefetchBarOnIntent(sym, tf = 'D', opts = {}) { return _f().prefetchBarOnIntent(sym, tf, opts) }
export function warmTypedSymbol(sym, tf = 'D') { return _f().warmTypedSymbol(sym, tf) }
export function createNeighborHold() { return _f().createNeighborHold() }
export function edgeWarmList(tickers, opts = {}) { return _f().edgeWarmList(tickers, opts) }

// ⭐ THE WARMERS' REGISTRY (2026-11-17, utils/barsWarm.js). Under BARSTORE the store's warmers
// stand in for the legacy ones on every list that warms through `barsWarm`, so a list's warm
// lands in the store the flip reads. Registered, not imported by them: an import edge from the
// page chunks split this module out of the chart chunk (first-open bytes, see barsWarm.js).
// The key is barsWarm's STORE_WARMERS_KEY (a test pins the two equal).
export const STORE_WARMERS = Object.freeze({
  prefetchBars, prefetchBar, prefetchBarsToIDB, prefetchAllTimeframes, prefetchListAllTimeframes,
  prefetchGridWarm, warmMemFromIDB, prewarmVisibleList, prefetchListDeep, prefetchReplayTimeframes,
  prefetchBarOnIntent,
  createNeighborHold,   // store only: the legacy caches have no LRU to pin against
})
if (BARSTORE && typeof globalThis !== 'undefined') globalThis.__uctStoreWarmers = STORE_WARMERS
