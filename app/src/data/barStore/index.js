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
import { createHistoryFeed, historyLakeEnabled, appHistoryFeed } from './historyFeed'
import { createLiveFeed } from './liveFeed'
import { appMinuteFeed } from './minuteFeedSwitch'
import { STATUS } from './types'
import { onDeskHiddenChange } from '../../lib/deskVisibility'
import { serverNow } from '../../lib/serverClock'

export { keyOf, parseKey } from './types'

/** How often time-dependent status (provisional → behind, current → updating) is re-derived. */
export const STATUS_TICK_MS = 15_000
/** ⭐ THE ROWS AHEAD ON THE LIVE STREAM (2026-11-25): at most this many keys per page ride the bars stream as a neighbour
 *  (`watchLive`; the watchlist's next 1-2 rows on each of the board's intraday timeframes). One more is refused (its row
 *  keeps the switch's own rule: it asks after a roll). The mux's own backstop is barsStreamManager.AHEAD_MAX_PAIRS. */
export const NEIGHBOR_LIVE_MAX_KEYS = 4
const DEFAULT_UNTIL = Object.freeze([STATUS.CONTEXT, STATUS.CURRENT, STATUS.UNAVAILABLE])

/**
 * @param {object} [o]
 * @param {object} [o.registry]  createRegistry() instance
 * @param {Function} [o.request] network request (default: prefetchBars.barsLaneRequest)
 * @param {object} [o.io]        persist cache functions (default: barsMemCache / barsIDB)
 * @param {object} [o.stream] [o.candle] [o.prices]  live feeds (default: the lib managers)
 * @param {object} [o.timers]    { setTimer, clearTimer, setIntervalFn, clearIntervalFn, now }
 * @param {Function} [o.minuteFeed]  (store) => { stop() } | null: starts the minute feed into the registry
 *                               (minuteFeedSwitch.appMinuteFeed; only the app's store passes it). Called ONCE, when
 *                               the store gets its first subscriber (a chart on the page), never before.
 */
export function createBarStore(o = {}) {
  // ⭐ (2026-11-25) the server's clock (lib/serverClock.js): the registry's `nowMs` decides every status and bucket roll
  const now = o.timers?.now ?? serverNow
  const setTimer = o.timers?.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = o.timers?.clearTimer ?? ((h) => clearTimeout(h))
  const registry = o.registry ?? createRegistry({ ctx: () => ({ nowMs: now() }), ...(o.frame ? { frame: o.frame } : {}) })
  /** key → { n, stops: Function[] } for keys with at least one subscriber (declared first: persist's `onScreen` reads it) */
  const active = new Map()
  /** key → { n, stop } for the rows ahead riding the push stream (`watchLive`), at most NEIGHBOR_LIVE_MAX_KEYS */
  const watched = new Map()
  // the history lake (per-browser switch until its edge route is live; historyFeed.js)
  const history = o.history !== undefined ? o.history : (historyLakeEnabled() ? createHistoryFeed() : null)
  // `beforeAnswer` names `persist`, created below: it is called only when an answer lands, long after both exist.
  const network = o.network ?? createNetwork({
    beforeAnswer: (key, answer) => persist?.flushJoins?.(key, answer),
    history,
    registry, request: o.request, setTimer, clearTimer, now,
    ...(o.isHidden ? { isHidden: o.isHidden } : {}), ...(o.onVisible ? { onVisible: o.onVisible } : {}),
  })
  // `o.device`: the on-device bar store (deviceStore/source); omitted = the app's, off unless switched on
  const persist = o.persist ?? createPersist({ registry, io: o.io, setTimer, clearTimer, now, ...(o.idle ? { idle: o.idle } : {}),
    // a kill seen on this page re-asks the keys holding device rows now (network.kick: only a key a chart is on)
    onDeviceKill: (keys) => { for (const k of keys) network.kick(k) },
    // a device copy joining the lake's rows of a key a chart shows, its answer on the way, waits for idle (persist _joinWaits)
    onScreen: (key) => active.has(key),
    answerPending: (key) => (network.inflight?.(key) ?? 0) > 0,
    ...(o.device !== undefined ? { device: o.device } : {}) })
  const live = o.liveFeed ?? createLiveFeed({
    registry, now, onReconnect: (key) => network.kick(key), onReanchor: (key) => network.kick(key),
    ...(o.stream ? { stream: o.stream } : {}), ...(o.candle !== undefined ? { candle: o.candle } : {}),
    ...(o.prices !== undefined ? { prices: o.prices } : {}),
    ...(o.pushEnabled ? { pushEnabled: o.pushEnabled } : {}),
  })

  let statusTimer = null
  // The minute feed (minuteFeedSwitch.js): asked for once, by the first chart. null = off (or not asked yet).
  let minuteFeed = null
  let minuteFeedAsked = false
  function _minuteFeedOnce() {
    if (minuteFeedAsked || typeof o.minuteFeed !== 'function') return
    minuteFeedAsked = true
    try { minuteFeed = o.minuteFeed(api) ?? null } catch { minuteFeed = null }
  }

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
      // Saved copy first; with none (and no server answer yet) the lake's newest bars paint at once
      // (network.lakeSeed: never persisted, kept only where the server's answer proves them).
      // (urgent: a subscriber is a chart on screen, so its device read goes ahead of every warm's)
      // ⭐ (review of #2786) A key with no bars (no saved copy, no answer yet; a lone developing bar is not a chart)
      // paints the lake's newest bars FIRST: that paint waits on the load, so its pieces never yield (network.lakeSeed
      // `awaited`). A key that already painted a saved copy only deepens: its pieces decode one per task, leaving room for frames.
      persist.hydrate(key, { urgent: true }).catch(() => {}).then(() => {
        const s = registry.peek(key)
        const awaited = !s?.bars?.length
        try { network.lakeSeed?.(key, { awaited }) } catch { /* paint only */ }
      })
      a.stops.push(persist.attach(key))
      a.stops.push(live.attach(key, { session }))
      // P3-S2b: a live gap (reducer.liveGapStart) asks the server NOW — once per gap; the answer
      // clears it. (The network keeps ≤ 1 request per key; a kick joins one in flight.)
      let gapSeen = null
      a.stops.push(registry.subscribe(key, (s) => {
        const g = s?.liveGapFrom ?? null
        if (g != null && g !== gapSeen) { gapSeen = g; try { network.kick(key) } catch { /* not started */ } }
        else if (g == null) gapSeen = null
      }))
      _statusLoop()
      _minuteFeedOnce()
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
    /** Does a chart hold `key` right now (a subscriber with a life cycle: its own stream and its own requests)? */
    isActive: (key) => active.has(key),
    /** The minute feed's handle once the first chart asked for it and the switch is on, else null (tests, diagnostics). */
    minuteFeed: () => minuteFeed,
    getBaseSnapshot: (key) => registry.getBaseSnapshot(key),
    /** Developing-bar changes of `key`, coalesced to one call per frame (no life cycle: the
     *  key's `subscribe` owns that). */
    subscribeDeveloping: (key, cb) => registry.subscribe(key, cb, { wake: 'dev' }),
    peek: (key) => registry.peek(key),
    // `hydrated`: the caller already hydrated the key (prefetch.js) — never read the caches twice.
    // `warm` / `front`: the request's shed-ability (`&warm=1`) and its place in its lane rank. `full`: no `since=` delta.
    // ⭐ An answer is PERSISTED whether or not anyone subscribes: with no subscriber (no
    // watcher) the answer that changed the base is written once through persist.writeOnce —
    // the same monotonic writers, the same server-backed-only rule — so a warm reaches mem +
    // IDB and survives the registry's LRU.
    async ensure(key, {
      depth = 0, until = DEFAULT_UNTIL, signal = null, priority = 'urgent', session = 'rth',
      hydrated = false, warm = false, front = false, full = false,
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
        const req = network.fetchOnce(key, { priority, depth, session, signal, warm, front, full })
        req.then(() => {
          const cur = registry.peek(key)
          // (after the debounce and at idle, never in the task that handled the answer: persist.writeSoon)
          if (cur && cur.baseRev !== rev0 && !active.has(key)) persist.writeSoon?.(key, { startedAt })
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
    /** Prime the history lake for `key` ahead of its open (network.primeLake). */
    primeLake: (key) => network.primeLake?.(key),
    /** Warm the edge's copy of `key`'s whole lake depth, no download (network.lakeEdgeWarm). */
    lakeEdgeWarm: (key, opts) => network.lakeEdgeWarm?.(key, opts) ?? Promise.resolve(0),
    /** Paint `key` from the lake's newest bars now, if it holds nothing and no answer landed (network.lakeSeed).
     *  `{ awaited: true }`: the caller waits on it to paint (its pieces then decode without yielding). */
    lakeSeed: (key, opts) => network.lakeSeed?.(key, opts) ?? Promise.resolve(false),
    /** Is the lake's whole depth still due for `key` (network.lakePending)? */
    lakePending: (key) => !!network.lakePending?.(key),
    /** D/W/M: is the deep sealed history still due for `key` (network.deepPending)? */
    deepPending: (key) => !!network.deepPending?.(key),
    /** D/W/M: fetch `key`'s deep history now, ahead of its join (network.deepPrime). */
    deepPrime: (key, opts) => network.deepPrime?.(key, opts) ?? Promise.resolve(false),
    /** D/W/M: resolves when `key`'s deep history join settles, or false after `ms` (network.deepJoined). */
    deepJoined: (key, ms) => network.deepJoined?.(key, ms) ?? Promise.resolve(true),
    /** Is `sym` in the history lake (network.lakeHas)? */
    lakeHas: (sym) => network.lakeHas?.(sym) ?? Promise.resolve(false),
    /** Does the history lake carry `key`'s scroll-back (network.lakeCarries)? */
    lakeCarries: (key) => !!network.lakeCarries?.(key),
    applyLive: (key, frame) => live.applyFrame(key, frame),
    NEIGHBOR_LIVE_MAX_KEYS,
    /**
     * ⭐ A ROW AHEAD OF THE MEMBER ON THE PUSH STREAM (2026-11-25, prefetch.createNeighborHold `live`). The key is held in
     * the registry (never evicted while watched) and its push frames land on its copy (liveFeed `pushOnly`: no tick
     * fallback, no polling, no requests). Refcounted; at most NEIGHBOR_LIVE_MAX_KEYS keys per page, the rest refused (a
     * no-op release). Returns the release.
     */
    watchLive(key, { session = 'rth' } = {}) {
      let wl = watched.get(key)
      if (!wl) {
        // refused: a no-op release that says so (the hold asks again once, later: review of #2721, LOW)
        if (!key || watched.size >= NEIGHBOR_LIVE_MAX_KEYS) { const no = () => {}; no.refused = true; return no }
        registry.acquire(key)
        const off = live.attach(key, { session, pushOnly: true })
        wl = { n: 0, stop: () => { try { off() } catch { /* ignore */ } registry.release(key) } }
        watched.set(key, wl)
      }
      wl.n++
      let done = false
      return () => {
        if (done) return
        done = true
        if (--wl.n > 0) return
        if (watched.get(key) === wl) watched.delete(key)
        wl.stop()
      }
    },
    flush: () => persist.flush(),
    dispose() {
      for (const wl of [...watched.values()]) wl.stop()
      watched.clear()
      for (const k of [...active.keys()]) {
        const a = active.get(k)
        for (const f of a.stops.splice(0).reverse()) { try { f?.() } catch { /* ignore */ } }
        registry.release(k)
      }
      active.clear()
      if (statusTimer != null) { clearTimer(statusTimer); statusTimer = null }
      try { minuteFeed?.stop?.() } catch { /* ignore */ }
      minuteFeed = null
      network.dispose()
      try { persist.dispose?.() } catch { /* ignore */ }
    },
  }
  return api
}

let _default = null
let _unwireFlush = null
/**
 * ⭐ NO WRITE IS LOST ON A TAB CLOSE (2026-11-23). A watched key's write waits PERSIST_DEBOUNCE_MS and then idle, and a warm
 * answer's too (persist.writeSoon): a tab closed or hidden in between used to drop them. The app's store writes everything
 * pending at once on `pagehide`, when the document becomes hidden, and when the desktop desk is hidden
 * (lib/deskVisibility). Wired once, for the app's store only.
 */
function _wireFlush() {
  if (_unwireFlush || typeof window === 'undefined') return
  const flush = () => { try { Promise.resolve(_default?.flush()).catch(() => {}) } catch { /* best-effort */ } }
  const onVisibility = () => { try { if (document.visibilityState === 'hidden') flush() } catch { /* no document */ } }
  window.addEventListener('pagehide', flush)
  try { document.addEventListener('visibilitychange', onVisibility) } catch { /* no document */ }
  let offDesk = null
  try { offDesk = onDeskHiddenChange((hidden) => { if (hidden) flush() }) } catch { offDesk = null }
  _unwireFlush = () => {
    window.removeEventListener('pagehide', flush)
    try { document.removeEventListener('visibilitychange', onVisibility) } catch { /* no document */ }
    try { offDesk?.() } catch { /* gone */ }
    _unwireFlush = null
  }
}
/** The app's one store (created on first use). */
export function getBarStore() {
  // The history lake is ON for the app's store unless this browser says '0' (historyFeed.js).
  // The minute feed into the registry is the app store's alone, and off unless its switch says on (minuteFeedSwitch.js).
  if (!_default) { _default = createBarStore({ history: appHistoryFeed(), minuteFeed: appMinuteFeed }); _wireFlush() }
  return _default
}
/** Test hook. */
export function _resetBarStoreForTests() { _unwireFlush?.(); _default?.dispose(); _default = null }

export const subscribe = (key, cb, opts) => getBarStore().subscribe(key, cb, opts)
export const getSnapshot = (key) => getBarStore().getSnapshot(key)
export const peek = (key) => getBarStore().peek(key)
export const ensure = (key, opts) => getBarStore().ensure(key, opts)
export const prefetch = (keys, opts) => getBarStore().prefetch(keys, opts)
export const invalidate = (keyOrPred, reason) => getBarStore().invalidate(keyOrPred, reason)
