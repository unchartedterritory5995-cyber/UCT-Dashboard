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
import { viewShowExtended } from '../../utils/viewSession'
import { isNativeTf, fetchTf } from '../../components/chart/timeframes'
import { isCacheCurrentForView } from '../../utils/marketSession'
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
const LOCAL_PAINTS = Symbol('local copy paints')
const SHORT_FULL_MAX = 4000

export function createPrefetch(o = {}) {
  const S = () => o.store ?? getBarStore()
  const tickerMeta = o.tickerMeta ?? _defaultTickerMeta
  const packIngesting = o.packIngesting ?? _packStillIngesting
  const extended = o.extended ?? viewShowExtended
  const now = o.now ?? (() => Date.now())
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))

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

  /** Hydrate a key nothing has loaded yet (mem part synchronous, IDB part async). */
  function _hydrate(key) {
    const st = S()
    const s = st.peek(key)
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

  // ── the handoff ─────────────────────────────────────────────────────────────
  function peekDisplayable(sym, tf, { showExtended } = {}) {
    if (!sym || !tf) return false
    if (!isNativeTf(tf) || !isIntradayTf(tf)) return true
    const key = keyFor(sym, tf, { showExtended })
    if (!key) return true
    const held = S().peek(key)
    if (!held) _hydrate(key)   // the mem half lands synchronously
    // An entry that holds no rows is looked up in mem again, SYNCHRONOUSLY and with no new IDB
    // read: the first peek made the entry, and a warmer may have promoted the key since (the
    // handoff's 25 ms poll exists to see exactly that).
    else if (!(held.depth || held.restSeen || held.developing)) { try { S().persist.hydrateMem(key) } catch { /* derived */ } }
    const s = S().peek(key)
    // (A status in HANDOFF_PAINTS already means rows are held: status.deriveStatus answers
    // empty / unavailable for an entry with none. No second rows test here: it could not be
    // proved by a test, 2026-11-16 mutation run.)
    return !!s && HANDOFF_PAINTS.includes(s.status)
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
    const rows = s.developing ? [...s.bars, s.developing] : s.bars
    const lastT = rows.length ? rows[rows.length - 1].t : null
    return isCacheCurrentForView(rows, lastT, normTf(tf), { session: extOf(showExtended) ? 'extended' : 'rth', nowMs: now() })
  }

  async function prepareForDisplay(sym, tf, { signal = null, showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    if (!key) return 'error'
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
      const hyd = _hydrate(key)
      const s0 = await Promise.race([hyd, new Promise((resolve) => setTimer(() => resolve(undefined), HYDRATE_WAIT_MS))])
      if (s0 === undefined) {
        const req = ensure(key, { until: date ? DAILY_PREPARED : PREPARED, priority: 'visible', signal, warm: false, local: false, _s0: S().peek(key) || {}, session: session(showExtended) })
        const localFirst = hyd.then((h) => (_localPaints(h, fetchTf(String(tf)), showExtended) ? LOCAL_PAINTS : new Promise(() => {})))
        const won = await Promise.race([req, localFirst])
        if (won === LOCAL_PAINTS) return 'current'
        return _outcome(won, { aborted: !!signal?.aborted, date })
      }
      // A SERVER answer is already held and the chart paints it (see HANDOFF_PAINTS): commit,
      // the chart's own request catches the tail up. A LOCAL-only copy is judged by the legacy
      // paint rule on the next line, never by this one (#2c).
      if (s0 && !date && s0.restSeen && HANDOFF_PAINTS.includes(s0.status)) return 'current'
      if (_localPaints(s0, fetchTf(String(tf)), showExtended)) return 'current'   // legacy: no request
      // Otherwise only a SERVER answer prepares it. ⛔ NOT a `&warm=1` request and NOT in the
      // shared warm lane: this is the request for the chart the member just asked for. As a
      // warm it could be shed by the server (which committed an EMPTY chart: the blank frame
      // measured on 3 of 10 flips, production 2026-11-15) and it waited behind the list
      // warmers' two lane slots and their backoff (first candles 353 ms median against the
      // legacy path's 30 ms). At `visible` rank it leaves at once, and the chart's own request
      // for the same URL joins it.
      const s = await ensure(key, { until: date ? DAILY_PREPARED : PREPARED, priority: 'visible', signal, warm: false, local: false, _s0: s0, session: session(showExtended) })
      return _outcome(s, { aborted: !!signal?.aborted, date })
    } catch {
      return 'error'
    } finally {
      _release(key)
    }
  }

  async function prepareDailyForDisplay(sym, tf, { signal = null, showExtended } = {}) {
    const key = keyFor(sym, tf, { showExtended })
    if (!key) return 'error'
    if (typed && typed.key === key) typed.kept = true   // Enter on a typed text: never abort its warm
    _own(key)
    try {
      const s = await ensure(key, { until: DAILY_PREPARED, priority: 'urgent', signal })
      return _outcome(s, { aborted: !!signal?.aborted, date: true })
    } catch {
      return 'error'
    } finally {
      _release(key)
    }
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
      // (a waiting lane request never reaches the network).
      const keep = new Set(syms.slice(0, nUrgent).map((x) => keyFor(x, tf)))
      for (const [k, c] of urgentCtl) if (!keep.has(k)) { c.abort(); urgentCtl.delete(k) }
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
  function createNeighborHold() {
    let held = new Map()   // key → true
    return {
      set(syms, tf, { showExtended } = {}) {
        const st = S()
        const want = new Map()
        for (const sym of syms || []) { const k = keyFor(sym, tf, { showExtended }); if (k) want.set(k, true) }
        for (const k of want.keys()) if (!held.has(k)) { st.registry.acquire(k); _hydrate(k) }
        for (const k of held.keys()) if (!want.has(k)) st.registry.release(k)
        held = want
      },
      clear() {
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
      if (!held) prefetch([key], { priority: 'urgent' })
    }, delay))
    if (!held) tickerMeta(sym)
  }
  function warmTypedSymbol(sym, tf = 'D') {
    if (!sym || !tf || !['D', 'W', 'M'].includes(String(tf))) return null
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
      if (s0?.depth) {
        // A held set exists, so the text IS a ticker (a prefix has none, see below).
        tellSymbolWarmers([typedSym], tf, { priority: true })
        const last = s0.developing ? s0.developing.t : s0.bars[s0.bars.length - 1].t
        if (_typedCachePaints(key.split('_')[0], String(tf), unixToDateLabel(last), S().persist.savedAtOf?.(key) ?? null)) return 'cache'
      }
      // ⛔ A PREFIX IS NOT A TICKER: with the pack held, uncached text is a partial word.
      if (!s0?.depth && !packIngesting()) return 'unknown'
      const s = await ensure(key, { until: DISPLAYABLE, priority: 'urgent', signal: ctl.signal, local: false })
      if (ctl.signal.aborted && !mine.kept) return false
      const answered = !!(s?.restSeen && !s.error && s.depth)
      if (answered && !s0?.depth && typed === mine) tellSymbolWarmers([typedSym], tf, { priority: true })   // the authority just said it is real
      return answered ? 'network' : false
    })().catch(() => false).finally(() => { if (typed === mine) typed = null })
  }

  return {
    keyFor, peek, ensure, prefetch, peekDisplayable, peekBars, prepareForDisplay, prepareDailyForDisplay,
    prefetchBars, prefetchBar, prefetchBarsToIDB, prefetchAllTimeframes, prefetchListAllTimeframes,
    prefetchGridWarm, warmMemFromIDB, prewarmVisibleList, prefetchListDeep, prefetchReplayTimeframes,
    prefetchBarOnIntent, warmTypedSymbol, createNeighborHold,
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
export function prepareForDisplay(sym, tf, opts = {}) { return _f().prepareForDisplay(sym, tf, opts) }
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
