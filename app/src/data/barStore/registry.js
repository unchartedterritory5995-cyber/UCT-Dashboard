// app/src/data/barStore/registry.js — key → entry map: refcount, LRU, bar budget, depth caps.
//
// Pure in-memory bookkeeping (no IDB, no network — persist.js / network.js own those and
// drive it through `dispatch`). Each entry holds the reducer's Snapshot and its subscribers.
//
//   • An entry with refs > 0 (a mounted chart / a pending ensure) is PINNED: never evicted.
//   • Unpinned entries are evicted least-recently-used first whenever the registry holds
//     more than `maxKeys` entries or more than `barBudget` bars in total.
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
import { parseKey } from './types'

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
export const DEFAULT_BAR_BUDGET = 2_500_000

/**
 * @param {object} [opts]
 * @param {number} [opts.maxKeys]
 * @param {number} [opts.barBudget]
 * @param {Record<string, number>} [opts.depthCaps]
 * @param {() => object} [opts.ctx]  the reducer ctx at call time (clock, streamLive…)
 * @param {(fn: Function) => any} [opts.frame]  the dev-channel coalescing tick (default: one frame)
 */
export function createRegistry({
  maxKeys = DEFAULT_MAX_KEYS, barBudget = DEFAULT_BAR_BUDGET,
  depthCaps = DEFAULT_DEPTH_CAPS, ctx = () => ({}), frame = defaultFrame,
} = {}) {
  /** @type {Map<string, {state:object, base:object, refs:number, subs:Set<{cb:Function, wake:string, pending?:boolean}>, used:number}>} */
  const entries = new Map()
  let clock = 0
  let totalBars = 0

  const ctxFor = (key, extra) => {
    const p = parseKey(key)
    return { ...ctx(), ...(extra || {}), depthCap: depthCaps[p?.tf] ?? undefined }
  }

  function _entry(key) {
    let e = entries.get(key)
    if (!e) {
      const state = initialState(key, ctxFor(key))
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
  function _evict() {
    if (entries.size <= maxKeys && totalBars <= barBudget) return
    const idle = []
    let shown = null
    for (const [key, e] of entries) {
      if (e.subs.size) (shown ??= new Set()).add(parseKey(key)?.sym)
      if (e.refs === 0 && e.subs.size === 0) idle.push([key, e])
    }
    const rank = (key, e) => (e.dwell && !shown?.has(parseKey(key)?.sym) ? 0 : 1)
    idle.sort((a, b) => rank(a[0], a[1]) - rank(b[0], b[1]) || a[1].used - b[1].used)
    for (const [key, e] of idle) {
      if (entries.size <= maxKeys && totalBars <= barBudget) break
      totalBars -= e.state.depth
      entries.delete(key)
    }
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
    acquire(key) { const e = _entry(key); e.refs++; e.used = ++clock; e.dwell = false; return e.state },
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
      return () => { e.subs.delete(sub); _evict() }
    },
    /** Apply one reducer action to `key`; returns the (possibly unchanged) snapshot. */
    dispatch(key, action, extraCtx) {
      const e = _entry(key)
      e.used = ++clock
      _set(key, e, reduce(e.state, action, ctxFor(key, extraCtx)))
      _evict()
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
      _evict()
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
    /** Mark (`on`) an entry a dwell warm made, or make it ordinary; a pinned or subscribed entry is never marked (see
     *  _evict). Returns whether the entry is marked now. */
    setDwell(key, on = true) {
      const e = entries.get(key)
      if (!e) return false
      e.dwell = !!on && e.refs === 0 && e.subs.size === 0
      return e.dwell
    },
    isDwell(key) { return !!entries.get(key)?.dwell },
    stats() {
      let dwell = 0
      for (const e of entries.values()) if (e.dwell) dwell++
      return { keys: entries.size, bars: totalBars, dwell }
    },
  }
}
