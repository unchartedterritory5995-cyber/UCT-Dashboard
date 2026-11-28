// app/src/data/barStore/registry.js — key → entry map: refcount, LRU, bar budget, depth caps.
//
// Pure in-memory bookkeeping (no IDB, no network — persist.js / network.js own those and
// drive it through `dispatch`). Each entry holds the reducer's Snapshot and its subscribers.
//
//   • An entry with refs > 0 (a mounted chart / a pending ensure) is PINNED: never evicted.
//   • Unpinned entries are evicted least-recently-used first whenever the registry holds
//     more than `maxKeys` entries or more than `barBudget` bars in total (the page budget's
//     registry share, lib/barBudget.js); the entries of the `recentSymbols` most recently
//     SHOWN symbols go last. Every eviction is announced (`noteKeyEvicted`): the caches keyed
//     by the same key let it go with it.
//   • Every dispatch passes the tf's depth cap to the reducer (it trims the OLDEST bars).
//   • `invalidate(key | predicate, reason)` resets matching entries (S2's only exception);
//     subscribers stay attached and are notified.
//   • A subscriber is called only when its key's snapshot identity changes, and only for
//     its own key (S7).
//   • ⭐ SPLIT NOTIFY (render cost). A change that moves ONLY the developing bar WITHIN its
//     bucket (devRev — reducer.isDevOnlyChange) is not a base change; opening a bucket is. Subscribers say what they need:
//       wake 'all'  (default) every change, synchronously (persist, the D/W/M fold);
//       wake 'base' only base changes — `getBaseSnapshot` is the snapshot as of the last one
//                   (the chart's setData / indicators / resample input, identity-stable
//                   across every tick);
//       wake 'dev'  only developing-bar changes, COALESCED to one call per animation frame
//                   (the latest snapshot), for a series.update() paint.
//     Invalidation rule of the base view: it is replaced on EVERY non-dev change (baseRev,
//     status, meta, identity) and on invalidate; it is never older than the last such change.

import { reduce, initialState, invalidate as invalidateState, refreshStatus, isDevOnlyChange } from './reducer'
import { parseKey, isDateTf } from './types'
import { BAR_BUDGET_DESKTOP, noteKeyEvicted } from '../../lib/barBudget'

// ⭐ (review of #2935, E1) EVERY ENTRY LIFE HAS ITS OWN GENERATIONS. An action carries the `gen` read when its work began
// (a request, a read) and the reducer refuses another (`staleReason` 'gen'). A new entry started at gen 0, and so had
// the entry an eviction dropped: an answer in flight across the eviction (a `since=` delta asked of the old life) was
// accepted by the new, EMPTY entry, which then held only the rows since `since`, "answered". An entry RE-CREATED after its
// key was evicted now starts at a page-unique base (LIFE_STRIDE apart: a life's own invalidations count up from it, never
// into the next life's). A key's FIRST life keeps gen 0 (nothing earlier can be in flight for it; callers and fixtures
// that dispatch `gen: 0` to a fresh key are its own life). The registry remembers the keys it evicted (EVICTED_KEYS_KEPT,
// oldest forgotten first: a forgotten key's request in flight was aborted at its eviction and its landing is dropped,
// network.js, so the generation is the third of three guards).
const LIFE_STRIDE = 2 ** 20
const EVICTED_KEYS_KEPT = 20_000
let _lives = 0
const _lifeGen = () => (++_lives) * LIFE_STRIDE
/** The first generation of an entry made now (tests). */
export function _nextLifeGenForTests() { return (_lives + 1) * LIFE_STRIDE }

/** ⭐ (review of #2935, D-1) THE SWITCH TARGET STAYS HELD UNTIL ITS CHART SUBSCRIBES. The handoff's prepare pins its key
 *  (ensure) and lets go when it reports; the chart subscribes only at the commit. In between, a never-shown target is an
 *  ordinary idle intraday entry, and another key's landing over the budget could drop it (an exact reload, but the press
 *  the member made would wait for it). `holdUntilShown` pins it until a subscriber arrives, at most HANDOFF_HOLD_MS.
 *  ⭐ (review of #2935, D2-a) BOUNDED BY PRESSES, NOT KEYS. A press hands off one key per linked chart (the group's
 *  timeframes, all on the press's symbol): five linked intraday charts are five keys, and a cap of 4 KEYS dropped the
 *  current press's own holds. The holds kept are those of the HANDOFF_HOLD_SYMBOLS most recent symbols handed off (the
 *  press and the one before it), every key of each; HANDOFF_HOLDS_MAX keys is only the backstop against a pathological
 *  caller (more charts than any board holds), the oldest holds first. */
export const HANDOFF_HOLD_MS = 1500
export const HANDOFF_HOLD_SYMBOLS = 2
export const HANDOFF_HOLDS_MAX = 32

/** One idle moment (requestIdleCallback; a 50 ms timer where there is none). */
export function defaultIdle(fn) {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(() => fn(), { timeout: 1000 })
  return setTimeout(fn, 50)
}

/** One frame (requestAnimationFrame; a 16 ms timer where there is none). */
export function defaultFrame(fn) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => fn())
  return setTimeout(fn, 16)
}

/** Default per-tf depth caps (bars held per entry). */
export const DEFAULT_DEPTH_CAPS = Object.freeze({
  // 30/60 hold the lake's deep load (utils/historyPrepend LAKE_TARGET_BARS_BY_TF)
  '1': 20000, '5': 32000, '15': 32000, '30': 40000, '60': 50000, D: 12000, W: 4000, M: 1200,
})
export const DEFAULT_MAX_KEYS = 200
/** ⛔ (2026-11-27, the heap check) was 2,500,000: it never bound on a 1m + 15m board, so every symbol pressed stayed decoded
 *  (133.7 MB of rows after 50 presses on production's build). Now the page budget's registry share (lib/barBudget.js: its
 *  arithmetic); the app's store passes the tier's (the touch tier keeps less). */
export const DEFAULT_BAR_BUDGET = BAR_BUDGET_DESKTOP.registry
/** The symbols most recently shown whose entries the budget evicts last (lib/barBudget.js). */
export const DEFAULT_RECENT_SYMBOLS = BAR_BUDGET_DESKTOP.recentSymbols

/**
 * @param {object} [opts]
 * @param {number} [opts.maxKeys]
 * @param {number} [opts.barBudget]
 * @param {number} [opts.recentSymbols]  the most recently shown symbols whose idle entries go last
 * @param {Record<string, number>} [opts.depthCaps]
 * @param {() => object} [opts.ctx]  the reducer ctx at call time (clock, streamLive…)
 * @param {(fn: Function) => any} [opts.frame]  the dev-channel coalescing tick (default: one frame)
 * @param {(fn: Function) => any} [opts.idle]   where the eviction a LAST UNSUBSCRIBE asks for runs (default: idle time;
 *                                              never in the press's task that unmounted the old row's chart)
 * @param {(fn: Function, ms: number) => any} [opts.setTimer] [opts.clearTimer]  the handoff hold's bound (holdUntilShown)
 */
export function createRegistry({
  maxKeys = DEFAULT_MAX_KEYS, barBudget = DEFAULT_BAR_BUDGET, recentSymbols = DEFAULT_RECENT_SYMBOLS,
  depthCaps = DEFAULT_DEPTH_CAPS, ctx = () => ({}), frame = defaultFrame, idle = defaultIdle,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h),
} = {}) {
  /** @type {Map<string, {state:object, base:object, refs:number, subs:Set<{cb:Function, wake:string, pending?:boolean}>, used:number}>} */
  const entries = new Map()
  /** onAcquire's listeners (a key gaining its first pin). */
  const acquireFns = new Set()
  let clock = 0
  let totalBars = 0
  /** The keys this registry evicted (a re-created entry's life gets a page-unique generation), oldest first. */
  const evictedKeys = new Set()
  /** This registry's own eviction listeners (its network aborts the dropped key's request in flight). */
  const evictSubs = new Set()
  let idleEvict = false
  /** The handoff holds (holdUntilShown), oldest first: { key, end } */
  const handoffs = []
  function _evictSoon() {
    if (idleEvict) return
    idleEvict = true
    idle(() => { idleEvict = false; _evict() })
  }
  /** The symbols most recently shown (a subscriber came or went), the newest first, at most `recentSymbols`. */
  const recent = []
  function _noteShown(key) {
    const sym = parseKey(key)?.sym
    if (!sym || recentSymbols <= 0) return
    const i = recent.indexOf(sym)
    if (i === 0) return
    if (i > 0) recent.splice(i, 1)
    recent.unshift(sym)
    if (recent.length > recentSymbols) recent.length = recentSymbols
  }

  const ctxFor = (key, extra) => {
    const p = parseKey(key)
    return { ...ctx(), ...(extra || {}), depthCap: depthCaps[p?.tf] ?? undefined }
  }

  function _entry(key) {
    let e = entries.get(key)
    if (!e) {
      const fresh = initialState(key, ctxFor(key))
      const state = evictedKeys.has(key) ? Object.freeze({ ...fresh, gen: _lifeGen() }) : fresh
      e = { state, base: state, refs: 0, subs: new Set(), used: ++clock }
      entries.set(key, e)
    }
    return e
  }

  function _flushDev(e, sub) {
    sub.pending = false
    if (!e.subs.has(sub)) return   // unsubscribed meanwhile
    try { sub.cb(e.state) } catch { /* never blocks the others */ }
  }

  function _set(key, e, next) {
    if (next === e.state) return false
    const devOnly = isDevOnlyChange(e.state, next)
    totalBars += next.depth - e.state.depth
    e.state = next
    if (!devOnly) e.base = next
    for (const sub of [...e.subs]) {
      if (sub.wake === 'dev') {
        if (!devOnly || sub.pending) continue
        sub.pending = true
        frame(() => _flushDev(e, sub))
        continue
      }
      if (sub.wake === 'base' && devOnly) continue
      try { sub.cb(next) } catch { /* a subscriber's failure never blocks the others */ }
    }
    return true
  }

  // ⭐ THE DWELL'S ENTRIES OF A SYMBOL NO CHART SHOWS GO FIRST (2026-11-24). The dwell's all-timeframes warm (the chart's
  // background warm, the watchlist's dwell) makes the other timeframes of the row the member rests on, for one use: a
  // timeframe switch on that row. Once no chart shows the symbol they are the least useful entries held; by recency
  // alone they outlived the rows ahead of a list (warmed earlier), and those were evicted first (minute-feed replay:
  // 5m / 30m / 60m, 82 each in 80 presses, one per row pressed). `setDwell` marks an entry a dwell warm made; an idle
  // one whose symbol no subscriber shows is evicted before every other idle entry (oldest first), and while a chart
  // shows the symbol it is ordinary (a timeframe switch there is exactly as today). A pin (`acquire`: a list's hold,
  // a read) or a subscriber makes it ordinary for good.
  // ⭐ (2026-11-27, the heap check) ...AND THE RECENTLY SHOWN GO LAST. An entry a chart showed (`e.shown`: it had a
  // subscriber) of one of the `recentSymbols` symbols shown most recently is evicted only once every other idle entry is
  // gone: with the budget now sized to the board (lib/barBudget.js), arrowing back to the rows just left is still a held
  // key. A pinned or subscribed entry is never evicted, nor the entry the call that evicts just wrote (`keep`: an answer
  // that lands is never dropped by its own landing, however far over the budget the page is). Each eviction is announced
  // (`noteKeyEvicted`), so no cache keyed by the key keeps its rows alive.
  // ⭐⭐ TWO PRESSURES, TWO ORDERS (oldest first within a rank):
  //   • over `maxKeys` (a COUNT: every entry costs one, whatever it holds) — 0 the dwell's of a symbol no chart shows,
  //     1 every other idle entry, 2 a recent symbol's shown entry (recency decides; the rows ahead a list warmed keep
  //     their place, prefetch.dwellFirstOut W1);
  //   • over `barBudget` (BYTES: a bar costs the same in every timeframe, lib/barBudget.js) — the intraday arrays go
  //     before the daily bases: 0 the dwell's of a symbol no chart shows (a warm nobody looked at, any timeframe), 1 an
  //     idle intraday entry, 2 an idle daily base (D/W/M: a whole history since listing is a few thousand bars), 3 a
  //     recent symbol's intraday entry, 4 a recent symbol's daily base.
  function _evict(keep = null) {
    if (entries.size <= maxKeys && totalBars <= barBudget) return
    const idle = []
    let shown = null
    for (const [key, e] of entries) {
      const p = parseKey(key)
      if (e.subs.size) (shown ??= new Set()).add(p?.sym)
      if (e.refs === 0 && e.subs.size === 0) idle.push({ key, e, sym: p?.sym, daily: isDateTf(p?.tf), rank: 1 })
    }
    // (each entry ranked once per pass, never inside the sort's comparator: a full registry evicts on every landing now)
    const gone = new Set()
    const pass = (over, rankOf) => {
      if (!over()) return
      for (const it of idle) it.rank = rankOf(it)
      idle.sort((a, b) => a.rank - b.rank || a.e.used - b.e.used)
      for (const it of idle) {
        if (!over()) break
        if (it.key === keep || gone.has(it.key)) continue
        gone.add(it.key)
        totalBars -= it.e.state.depth
        entries.delete(it.key)
        evictedKeys.delete(it.key); evictedKeys.add(it.key)
        if (evictedKeys.size > EVICTED_KEYS_KEPT) evictedKeys.delete(evictedKeys.values().next().value)
        for (const cb of [...evictSubs]) { try { cb(it.key) } catch { /* a listener's failure never blocks the rest */ } }
        noteKeyEvicted(it.key)
      }
    }
    const dwellUnshown = (it) => it.e.dwell && !shown?.has(it.sym)
    const recentShown = (it) => it.e.shown && recent.includes(it.sym)
    pass(() => entries.size > maxKeys, (it) => (dwellUnshown(it) ? 0 : (recentShown(it) ? 2 : 1)))
    pass(() => totalBars > barBudget, (it) => {
      if (dwellUnshown(it)) return 0
      const isRecent = recent.includes(it.sym)
      if (it.daily) return isRecent ? 4 : 2
      return it.e.shown && isRecent ? 3 : 1
    })
  }

  return {
    /** Current snapshot (creates an empty entry; touches LRU). */
    getSnapshot(key) { const e = _entry(key); e.used = ++clock; return e.state },
    /** The snapshot as of the last BASE change (split notify; see header). */
    getBaseSnapshot(key) { const e = _entry(key); e.used = ++clock; return e.base },
    /** Snapshot if held, else null — never creates, never touches LRU. */
    peek(key) { return entries.get(key)?.state ?? null },
    has(key) { return entries.has(key) },
    /** Pin an entry (refcount +1). */
    acquire(key) {
      const e = _entry(key); e.refs++; e.used = ++clock; e.dwell = false
      // (2026-11-28, #3034) a key that was held by nothing is held now: the network's cover fallback listens (onAcquire)
      if (e.refs === 1) for (const fn of [...acquireFns]) { try { fn(key) } catch { /* a listener never breaks a pin */ } }
      return e.state
    },
    /** Called with `key` whenever a pin makes a key held that was held by nothing (refs 0 -> 1). Returns the unsubscribe. */
    onAcquire(fn) { acquireFns.add(fn); return () => { acquireFns.delete(fn) } },
    release(key) {
      const e = entries.get(key)
      if (e && e.refs > 0) e.refs--
      _evict()
    },
    refs(key) { return entries.get(key)?.refs ?? 0 },
    /** Subscribe to one key's snapshot changes (`wake`: 'all' | 'base' | 'dev', see header).
     *  Returns the unsubscribe function. */
    subscribe(key, cb, { wake = 'all' } = {}) {
      const e = _entry(key)
      const sub = { cb, wake, pending: false }
      e.subs.add(sub)
      e.used = ++clock
      e.dwell = false
      e.shown = true
      _noteShown(key)
      // the switch target's chart is here: its handoff hold has done its job (the subscriber pins it now)
      for (const h of handoffs.filter((x) => x.key === key)) h.end()
      return () => {
        if (!e.subs.delete(sub)) return
        // the last subscriber gone: the symbol is one just shown, its entry as recent as the moment it left the screen
        if (!e.subs.size) { e.used = ++clock; _noteShown(key) }
        // (review of #2935, L1) a press unmounts the old row's chart in its own task: the eviction it allows waits for
        // idle (every dispatch, release and feed still evicts at once, and holds the budget)
        _evictSoon()
      }
    },
    /** Apply one reducer action to `key`; returns the (possibly unchanged) snapshot. */
    dispatch(key, action, extraCtx) {
      const e = _entry(key)
      e.used = ++clock
      _set(key, e, reduce(e.state, action, ctxFor(key, extraCtx)))
      _evict(key)
      return entries.get(key)?.state ?? e.state
    },
    /**
     * Apply one reducer action to a key that is ALREADY HELD, for the minute feed (minuteFeed.js): it appends the
     * minute that just closed to every held 1m key, once a minute. Unlike `dispatch` it never CREATES an entry (a
     * key nobody holds stays unheld) and never marks the entry USED (a feed that touched every 1m key each minute
     * would re-rank them all ahead of the keys the member last looked at, and the LRU would evict those first).
     * Subscribers are notified as for any change. Returns the snapshot, or null when the key is not held.
     */
    feed(key, action, extraCtx) {
      const e = entries.get(key)
      if (!e) return null
      _set(key, e, reduce(e.state, action, ctxFor(key, extraCtx)))
      _evict(key)
      return entries.get(key)?.state ?? null
    },
    /** Re-derive time-dependent status for every held entry (one clock tick). */
    tick(extraCtx) {
      for (const [key, e] of entries) _set(key, e, refreshStatus(e.state, ctxFor(key, extraCtx)))
    },
    /** Reset entries matching `keyOrPred` (string or (key, snapshot) => bool). */
    invalidate(keyOrPred, reason = 'invalidate') {
      const match = typeof keyOrPred === 'function' ? keyOrPred : (k) => k === keyOrPred
      let n = 0
      for (const [key, e] of entries) {
        if (match(key, e.state)) { if (_set(key, e, invalidateState(e.state, reason, ctxFor(key)))) n++ }
      }
      return n
    },
    keys() { return [...entries.keys()] },
    /** Pin `key` (a switch target its prepare just reported) until a subscriber arrives, at most `ms`; at most
     *  the HANDOFF_HOLD_SYMBOLS most recent symbols' holds (every key of each; HANDOFF_HOLDS_MAX keys the backstop), the
     *  oldest released first. A key not held, or already shown, is not pinned.
     *  Returns the release (idempotent). */
    holdUntilShown(key, { ms = HANDOFF_HOLD_MS } = {}) {
      const e = entries.get(key)
      if (!e || e.subs.size) return () => {}
      e.refs++
      e.used = ++clock
      const h = { key, sym: parseKey(key)?.sym ?? key, timer: null, done: false }
      h.end = () => {
        if (h.done) return
        h.done = true
        if (h.timer != null) { try { clearTimer(h.timer) } catch { /* gone */ } }
        const i = handoffs.indexOf(h)
        if (i >= 0) handoffs.splice(i, 1)
        if (e.refs > 0) e.refs--
        _evictSoon()
      }
      h.timer = setTimer(h.end, ms)
      // a symbol handed off again is the newest press: its holds move to the end
      for (let i = handoffs.length - 1; i >= 0; i--) if (handoffs[i].sym === h.sym) handoffs.push(handoffs.splice(i, 1)[0])
      handoffs.push(h)
      const syms = () => new Set(handoffs.map((x) => x.sym)).size
      while (syms() > HANDOFF_HOLD_SYMBOLS) { const old = handoffs[0].sym; for (const x of handoffs.filter((y) => y.sym === old)) x.end() }
      while (handoffs.length > HANDOFF_HOLDS_MAX) handoffs[0].end()
      return h.end
    },
    /** `cb(key)` whenever THIS registry drops an entry. Returns the unsubscribe. */
    onEvict(cb) { evictSubs.add(cb); return () => { evictSubs.delete(cb) } },
    /** Mark (`on`) an entry a dwell warm made, or make it ordinary; a pinned or subscribed entry is never marked (see
     *  _evict). Returns whether the entry is marked now. */
    setDwell(key, on = true) {
      const e = entries.get(key)
      if (!e) return false
      e.dwell = !!on && e.refs === 0 && e.subs.size === 0
      return e.dwell
    },
    isDwell(key) { return !!entries.get(key)?.dwell },
    /** The symbols most recently shown, the newest first (their entries are evicted last). */
    recentSymbols() { return recent.slice() },
    /** The bounds this registry evicts by (lib/barBudget.js's ledger reads them). */
    limits() { return { barBudget, maxKeys, recentSymbols } },
    stats() {
      let dwell = 0
      for (const e of entries.values()) if (e.dwell) dwell++
      return { keys: entries.size, bars: totalBars, dwell }
    },
  }
}
