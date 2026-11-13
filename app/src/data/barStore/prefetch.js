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
import { keyOf, normTf, isIntradayTf, isDateTf, PERIOD_SEC, STATUS, unixToDateLabel } from './types'
import { DAILY_POLL_MS } from './network'
import { legacyBars } from './adapter'
import { fullBarsFor } from '../../utils/barsBackfill'
import { viewShowExtended } from '../../utils/viewSession'
import { isNativeTf, fetchTf } from '../../components/chart/timeframes'
import { isCacheCurrentForView } from '../../utils/marketSession'
import { prefetchTickerMeta as _defaultTickerMeta } from '../../hooks/useTickerMeta'
import {
  _packStillIngesting, URGENT_MAX_PER_CALL, GRID_WARM_TFS, listPrewarmDisabled, _typedCachePaints,
  tellSymbolWarmers,
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
/** D/W/M handoff: a held set paints (the daily paint gate decides how), so it is prepared. */
const DAILY_PREPARED = Object.freeze([STATUS.PROVISIONAL, STATUS.CONTEXT, STATUS.CURRENT, STATUS.UNAVAILABLE, STATUS.UPDATING])

// The legacy timeframe sets (same order: the common switches warm first).
export const ALL_TFS = Object.freeze(['D', '5', '60', '30', '15', 'W', 'M', '1'])
export const SCAN_WARM_TFS = Object.freeze(['D', '5', '60', '30', '15'])
const SCAN_WARM_CAP = 100
const DEEP_WARM_TFS = Object.freeze(['D', 'W', 'M'])
const DEEP_WARM_CAP = 120
const REPLAY_WARM_TFS = Object.freeze(['5', '15', '30', '60'])
const TYPED_FRESH_MS = 60_000
const COOLDOWN_MAX_KEYS = 400

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
    return st.persist.hydrate(key).catch(() => null)
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
    if (!a) return false
    // An INVALIDATE since the answer resets it (gen moved on an entry that says so); a fresh
    // entry re-hydrated after an LRU eviction has a new gen but was never invalidated.
    const invalidated = s?.invalidatedFor != null && s.gen !== a.gen
    const expired = invalidated || now() - a.at >= cooldownMs(s?.tf ?? key.split('_')[1])
    if (expired || !s || !(s.restSeen || s.depth > 0)) { asked.delete(key); return false }
    return true
  }
  function _noteAsked(key) {
    const a = { at: now(), gen: S().peek(key)?.gen ?? 0 }
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
    else if (s) a.gen = s.gen   // the gen the answer landed under
    return s
  }

  /**
   * Warm `keys` to DISPLAYABLE at `priority` (default background). Deduped within a tick,
   * skips keys a prepare owns, respects the re-ask cooldown. Resolves when every warm settles.
   */
  function prefetch(keys, { priority = 'background', depth = 0, signal = null, warm = false, front = false } = {}) {
    return Promise.all((keys || []).filter(Boolean).map(async (key) => {
      const s0 = await _hydrate(key)
      if (_satisfied(s0, DISPLAYABLE, depth)) return s0
      if (preparing.get(key) || _cooling(key, s0)) return S().peek(key) ?? s0   // s0: the LRU may have evicted it since
      return ensure(key, { until: DISPLAYABLE, depth, priority, signal, warm, front })
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
    if (!S().peek(key)) _hydrate(key)   // the mem half lands synchronously
    return DISPLAYABLE.includes(S().peek(key)?.status)
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
      const s0 = await _hydrate(key)
      if (_localPaints(s0, fetchTf(String(tf)), showExtended)) return 'current'   // legacy: no request
      // Otherwise only a SERVER answer prepares it (legacy asks with `&warm=1`).
      // Legacy prepareForDisplay asks with `&warm=1` (`_url(sym, tf)` / `_sinceUrl`) — matched.
      const s = await ensure(key, { until: date ? DAILY_PREPARED : PREPARED, priority: 'urgent', signal, warm: true, local: false, _s0: s0, session: session(showExtended) })
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
    if (held?.restSeen && held.status === STATUS.CURRENT && asked.has(key) && now() - asked.get(key).at < TYPED_FRESH_MS) {
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
    prefetchBarOnIntent, warmTypedSymbol,
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
