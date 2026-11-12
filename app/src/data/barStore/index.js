// app/src/data/barStore/index.js — the BarStore's public API (P2b; docs/architecture/barstore.md).
//
//   subscribe(key, cb, {session, priority, depth}) → unsubscribe
//       The first subscriber of a key starts its whole life cycle: hydrate (mem, then IDB),
//       persist (writes on baseRev), the live feed (push, tick fallback) and the network
//       loop. The last one stops all of it (0 requests after unsubscribe, S9).
//   getSnapshot(key) / peek(key)            frozen, identity-stable snapshots (S10)
//   ensure(key, {depth, until, signal, priority, session}) → Promise<snapshot>
//       hydrate + one request, resolved once the status is in `until` (default context |
//       current | unavailable) or the request settled. An answer is persisted even with no
//       subscriber (persist.writeOnce).
//   prefetch(keys, {priority, depth})       ensure for many keys at a lower priority
//   invalidate(key | (key, snap) => bool, reason)   reset + refetch (abort in flight)
//   scrollBack(key, {bars})                 prepend one older window
//   applyLive(key, frame)                   feed one push frame (reducer-gated)
//
// Built OFF TO THE SIDE: no runtime module imports it yet (P3 wires StockChart onto it).
// `createBarStore` takes every collaborator as an option so tests drive it with fakes; the
// module-level functions use one lazily created default store (no side effect on import).

import { createRegistry } from './registry'
import { createPersist } from './persist'
import { createNetwork } from './network'
import { createLiveFeed } from './liveFeed'
import { STATUS } from './types'

export { keyOf, parseKey } from './types'

/** How often time-dependent status (provisional → behind, current → updating) is re-derived. */
export const STATUS_TICK_MS = 15_000
const DEFAULT_UNTIL = Object.freeze([STATUS.CONTEXT, STATUS.CURRENT, STATUS.UNAVAILABLE])

/**
 * @param {object} [o]
 * @param {object} [o.registry]  createRegistry() instance
 * @param {Function} [o.request] network request (default: prefetchBars.barsLaneRequest)
 * @param {object} [o.io]        persist cache functions (default: barsMemCache / barsIDB)
 * @param {object} [o.stream] [o.candle] [o.prices]  live feeds (default: the lib managers)
 * @param {object} [o.timers]    { setTimer, clearTimer, setIntervalFn, clearIntervalFn, now }
 */
export function createBarStore(o = {}) {
  const now = o.timers?.now ?? (() => Date.now())
  const setTimer = o.timers?.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.timers?.clearTimer ?? ((h) => clearTimeout(h))
  const registry = o.registry ?? createRegistry({ ctx: () => ({ nowMs: now() }), ...(o.frame ? { frame: o.frame } : {}) })
  const network = o.network ?? createNetwork({
    registry, request: o.request, setTimer, clearTimer, now,
    ...(o.isHidden ? { isHidden: o.isHidden } : {}), ...(o.onVisible ? { onVisible: o.onVisible } : {}),
  })
  const persist = o.persist ?? createPersist({ registry, io: o.io, setTimer, clearTimer, now, ...(o.idle ? { idle: o.idle } : {}) })
  const live = o.liveFeed ?? createLiveFeed({
    registry, now, onReconnect: (key) => network.kick(key),
    ...(o.stream ? { stream: o.stream } : {}), ...(o.candle !== undefined ? { candle: o.candle } : {}),
    ...(o.prices !== undefined ? { prices: o.prices } : {}),
    ...(o.pushEnabled ? { pushEnabled: o.pushEnabled } : {}),
  })

  /** key → { n, stops: Function[] } for keys with at least one subscriber */
  const active = new Map()
  let statusTimer = null

  function _statusLoop() {
    if (statusTimer != null || !active.size) return
    statusTimer = setTimer(function tick() {
      statusTimer = null
      registry.tick({ nowMs: now() })
      if (active.size) statusTimer = setTimer(tick, STATUS_TICK_MS)
    }, STATUS_TICK_MS)
  }

  function _start(key, { session = 'rth', priority = 'visible', depth = 0 } = {}) {
    let a = active.get(key)
    if (!a) {
      a = { n: 0, stops: [] }
      active.set(key, a)
      registry.acquire(key)
      persist.hydrate(key).catch(() => {})
      a.stops.push(persist.attach(key))
      a.stops.push(live.attach(key, { session }))
      _statusLoop()
    }
    a.stops.push(network.start(key, { session, priority, depth }))
    a.n++
    let done = false
    return () => {
      if (done) return
      done = true
      a.stops.pop()?.()   // this subscriber's network ref (refcounted inside)
      if (--a.n > 0) return
      for (const f of a.stops.splice(0).reverse()) { try { f?.() } catch { /* ignore */ } }
      active.delete(key)
      registry.release(key)
      if (!active.size && statusTimer != null) { clearTimer(statusTimer); statusTimer = null }
    }
  }

  const api = {
    registry, network, persist, live,
    // `opts.wake` ('all' | 'base'): the registry's split notify — a 'base' subscriber is not
    // woken by a developing-bar-only change (read it with getBaseSnapshot).
    subscribe(key, cb, opts) {
      const off = registry.subscribe(key, cb, { wake: opts?.wake === 'base' ? 'base' : 'all' })
      const stop = _start(key, opts)
      let done = false
      return () => { if (done) return; done = true; off(); stop() }
    },
    getSnapshot: (key) => registry.getSnapshot(key),
    getBaseSnapshot: (key) => registry.getBaseSnapshot(key),
    /** Developing-bar changes of `key`, coalesced to one call per frame (no life cycle: the
     *  key's `subscribe` owns that). */
    subscribeDeveloping: (key, cb) => registry.subscribe(key, cb, { wake: 'dev' }),
    peek: (key) => registry.peek(key),
    // `hydrated`: the caller already hydrated the key (prefetch.js) — never read the caches twice.
    // `warm` / `front`: the request's shed-ability (`&warm=1`) and its place in its lane rank.
    // ⭐ An answer is PERSISTED whether or not anyone subscribes: with no subscriber (no
    // watcher) the answer that changed the base is written once through persist.writeOnce —
    // the same monotonic writers, the same server-backed-only rule — so a warm reaches mem +
    // IDB and survives the registry's LRU.
    async ensure(key, {
      depth = 0, until = DEFAULT_UNTIL, signal = null, priority = 'urgent', session = 'rth',
      hydrated = false, warm = false, front = false,
    } = {}) {
      registry.acquire(key)
      try {
        const ok = (s) => until.includes(s.status) && (!depth || s.depth >= depth || s.status === STATUS.UNAVAILABLE)
        if (!active.has(key) && !hydrated) await persist.hydrate(key)
        let s = registry.getSnapshot(key)
        if (ok(s) && s.restSeen) return s
        if (signal?.aborted) return s
        const rev0 = s.baseRev
        const startedAt = now()
        const req = network.fetchOnce(key, { priority, depth, session, signal, warm, front })
        req.then(() => {
          const cur = registry.peek(key)
          if (cur && cur.baseRev !== rev0 && !active.has(key)) persist.writeOnce?.(key, { startedAt })
        })
        await Promise.race([
          req,
          new Promise((resolve) => signal?.addEventListener?.('abort', resolve, { once: true })),
        ])
        return registry.getSnapshot(key)
      } finally {
        registry.release(key)
      }
    },
    prefetch(keys, { priority = 'background', depth = 0 } = {}) {
      // ensure never rejects (network.js turns every failure into a REST_ERROR action)
      return Promise.all((keys || []).map((k) => api.ensure(k, { priority, depth })))
    },
    invalidate(keyOrPred, reason = 'invalidate') {
      const match = typeof keyOrPred === 'function' ? keyOrPred : (k) => k === keyOrPred
      const hit = registry.keys().filter((k) => match(k, registry.peek(k)))
      const n = registry.invalidate(keyOrPred, reason)
      for (const k of hit) network.kick(k, { abort: true })
      return n
    },
    scrollBack: (key, opts) => network.scrollBack(key, opts),
    applyLive: (key, frame) => live.applyFrame(key, frame),
    flush: () => persist.flush(),
    dispose() {
      for (const k of [...active.keys()]) {
        const a = active.get(k)
        for (const f of a.stops.splice(0).reverse()) { try { f?.() } catch { /* ignore */ } }
        registry.release(k)
      }
      active.clear()
      if (statusTimer != null) { clearTimer(statusTimer); statusTimer = null }
      network.dispose()
    },
  }
  return api
}

let _default = null
/** The app's one store (created on first use). */
export function getBarStore() {
  if (!_default) _default = createBarStore()
  return _default
}
/** Test hook. */
export function _resetBarStoreForTests() { _default?.dispose(); _default = null }

export const subscribe = (key, cb, opts) => getBarStore().subscribe(key, cb, opts)
export const getSnapshot = (key) => getBarStore().getSnapshot(key)
export const peek = (key) => getBarStore().peek(key)
export const ensure = (key, opts) => getBarStore().ensure(key, opts)
export const prefetch = (keys, opts) => getBarStore().prefetch(keys, opts)
export const invalidate = (keyOrPred, reason) => getBarStore().invalidate(keyOrPred, reason)
