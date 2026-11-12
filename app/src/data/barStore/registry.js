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

import { reduce, initialState, invalidate as invalidateState, refreshStatus } from './reducer'
import { parseKey } from './types'

/** Default per-tf depth caps (bars held per entry). */
export const DEFAULT_DEPTH_CAPS = Object.freeze({
  '1': 20000, '5': 32000, '15': 32000, '30': 32000, '60': 32000, D: 12000, W: 4000, M: 1200,
})
export const DEFAULT_MAX_KEYS = 200
export const DEFAULT_BAR_BUDGET = 2_500_000

/**
 * @param {object} [opts]
 * @param {number} [opts.maxKeys]
 * @param {number} [opts.barBudget]
 * @param {Record<string, number>} [opts.depthCaps]
 * @param {() => object} [opts.ctx]  the reducer ctx at call time (clock, streamLive…)
 */
export function createRegistry({
  maxKeys = DEFAULT_MAX_KEYS, barBudget = DEFAULT_BAR_BUDGET,
  depthCaps = DEFAULT_DEPTH_CAPS, ctx = () => ({}),
} = {}) {
  /** @type {Map<string, {state:object, refs:number, subs:Set<Function>, used:number}>} */
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
      e = { state: initialState(key, ctxFor(key)), refs: 0, subs: new Set(), used: ++clock }
      entries.set(key, e)
    }
    return e
  }

  function _set(key, e, next) {
    if (next === e.state) return false
    totalBars += next.depth - e.state.depth
    e.state = next
    for (const cb of [...e.subs]) {
      try { cb(next) } catch { /* a subscriber's failure never blocks the others */ }
    }
    return true
  }

  function _evict() {
    if (entries.size <= maxKeys && totalBars <= barBudget) return
    const idle = [...entries.entries()].filter(([, e]) => e.refs === 0 && e.subs.size === 0)
      .sort((a, b) => a[1].used - b[1].used)
    for (const [key, e] of idle) {
      if (entries.size <= maxKeys && totalBars <= barBudget) break
      totalBars -= e.state.depth
      entries.delete(key)
    }
  }

  return {
    /** Current snapshot (creates an empty entry; touches LRU). */
    getSnapshot(key) { const e = _entry(key); e.used = ++clock; return e.state },
    /** Snapshot if held, else null — never creates, never touches LRU. */
    peek(key) { return entries.get(key)?.state ?? null },
    has(key) { return entries.has(key) },
    /** Pin an entry (refcount +1). */
    acquire(key) { const e = _entry(key); e.refs++; e.used = ++clock; return e.state },
    release(key) {
      const e = entries.get(key)
      if (e && e.refs > 0) e.refs--
      _evict()
    },
    refs(key) { return entries.get(key)?.refs ?? 0 },
    /** Subscribe to one key's snapshot changes. Returns the unsubscribe function. */
    subscribe(key, cb) {
      const e = _entry(key)
      e.subs.add(cb)
      e.used = ++clock
      return () => { e.subs.delete(cb); _evict() }
    },
    /** Apply one reducer action to `key`; returns the (possibly unchanged) snapshot. */
    dispatch(key, action, extraCtx) {
      const e = _entry(key)
      e.used = ++clock
      _set(key, e, reduce(e.state, action, ctxFor(key, extraCtx)))
      _evict()
      return entries.get(key)?.state ?? e.state
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
    stats() { return { keys: entries.size, bars: totalBars } },
  }
}
