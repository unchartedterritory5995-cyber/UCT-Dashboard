// Shared SSE connection pool for /api/stream/bars — the bars analog of
// priceStreamManager, kept in a SEPARATE module so the always-on price path
// (priceStreamManager.js) is byte-untouched (a bug here must never break live
// prices). DARK until VITE_REALTIME_BARS='1' (the consumer gates on it).
//
// Every useRealtimeBars() used to open its OWN EventSource per chart — the exact
// connection-multiplication class the price stream was pooled to kill. This owns
// all bar-stream connections: subscribers register a (sym,tf), the manager streams
// the deduped union over as few connections as the backend's 50-pair/connection
// cap allows (usually one), and dispatches each `bar` event ONLY to subscribers
// whose (sym,tf) matches — a pooled connection carries many pairs, so a global
// fan-out would apply MSFT's bar to an AAPL chart (the data-doubt blocker).
//
// Kill-switch: localStorage 'uct.barsPool.disabled' = '1' → no connection opens and
// every key reports not-delivering, so the consumer's barsPushActive goes false and
// the Finnhub writers stay authoritative (today's behavior). Runtime, no rebuild.

import { STREAM_RECONNECT_CAP_MS } from '../utils/streamStatus'

export const MAX_BARS_PAIRS = 50   // mirror of api/routers/stream.py pairs[:50]
export const REBUILD_DEBOUNCE_MS = 400
const INITIAL_RETRY_MS = 5000
// No bar AND no heartbeat within this window ⇒ the connection is silently dead
// (proxy idle-timeout / laptop sleep) ⇒ force reconnect + report not-healthy so the
// consumer stops trusting a frozen feed. The backend heartbeats every 15s.
export const BARS_WATCHDOG_MS = 45000
const BARS_WATCHDOG_TICK_MS = 10000
// A live developing bar updates ~every minute (Massive AM sub-updates), so if no
// `bar` for this key arrived within this window the feed is effectively dead even if
// the SSE keeps heartbeating — `delivering` must go false so the consumer falls back
// to Finnhub instead of freezing the candle with Finnhub suppressed (review blocker #2).
export const BARS_LIVE_STALE_MS = 120000       // engage: a bar within 2min = push is live
// Hysteresis: once live, hold before handing back to Finnhub. Was 5min — too long a
// visible freeze when Massive push goes silent but the SSE keeps heartbeating (the
// candle stayed push-owned-but-frozen with Finnhub suppressed). 150s keeps a margin
// above the 120s engage window (no thrash) while capping the stale-candle window.
export const BARS_LIVE_DISENGAGE_MS = 150000

let _nextId = 1
const _subscribers = new Map()  // id -> { sym, tf, key, onBar, onReconnect, onStatus }
let _buckets = []               // [{ key, pairs:Set<string>, es, connected, retryDelay, reconnectTimer, lastMsg }]
const _keyState = new Map()     // 'SYM:TF' -> { everDelivered:boolean, lastBarAt:number }
let _rebuildTimer = null
let _watchdogTimer = null

// Coalesce developing-bar dispatch to a ~2x/sec heartbeat (matches the price feed's
// PUBLISH_THROTTLE_MS) so the candle + price label tick on the same calm cadence as
// the quotes instead of repainting on every sub-second update — TC2000-style. A
// bucket BOUNDARY (a new bar time for a key) flushes that key's prior-bucket final
// bar IMMEDIATELY, so a bar's closing value is never coalesced away.
const BAR_THROTTLE_MS = 500
const _pendingBar = new Map()   // key -> latest bar event awaiting the heartbeat flush
let _barThrottleTimer = null

function _dispatchBar(key, data) {
  for (const sub of _subscribers.values()) {
    if (sub.key === key && sub.onBar) { try { sub.onBar(data) } catch { /* never break on a bad listener */ } }
  }
}

function _flushPendingBars() {
  _barThrottleTimer = null
  if (_pendingBar.size === 0) return
  const pending = [..._pendingBar.entries()]
  _pendingBar.clear()
  for (const [key, data] of pending) _dispatchBar(key, data)
}

function _killed() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('uct.barsPool.disabled') === '1'
  } catch { return false }
}

function _pairKey(sym, tf) {
  return `${String(sym).toUpperCase()}:${String(tf)}`
}

// Notify a single subscriber's onStatus (best-effort).
function _notifyStatus(sub) {
  if (sub.onStatus) { try { sub.onStatus() } catch { /* never break on a bad listener */ } }
}

function _notifyStatusForKey(key) {
  for (const sub of _subscribers.values()) if (sub.key === key) _notifyStatus(sub)
}

function _notifyAllStatus() {
  for (const sub of _subscribers.values()) _notifyStatus(sub)
}

/**
 * Subscribe a chart to live bars for one (sym, tf).
 * @param {string} sym
 * @param {string} tf   one of '1','5','15','30','60'
 * @param {{onBar?:(data)=>void, onReconnect?:(lastBarT)=>void, onStatus?:()=>void}} cbs
 * @returns {() => void} unsubscribe
 */
export function subscribe(sym, tf, { onBar, onReconnect, onStatus } = {}) {
  const id = _nextId++
  _subscribers.set(id, { sym: String(sym).toUpperCase(), tf: String(tf), key: _pairKey(sym, tf), onBar, onReconnect, onStatus })
  _scheduleRebuild()
  return () => {
    const wasKey = _subscribers.get(id)?.key
    _subscribers.delete(id)
    // Prune per-key liveness when the LAST subscriber for a key leaves, so a later
    // resubscribe starts fresh (everDelivered=false) instead of instantly reporting
    // delivering on stale state, and _keyState can't grow unbounded (review #3).
    if (wasKey && ![..._subscribers.values()].some(s => s.key === wasKey)) _keyState.delete(wasKey)
    _scheduleRebuild()
  }
}

/**
 * Live status for a (sym, tf), for the consumer's barsPushActive gate.
 * - connected: its bucket's EventSource is open
 * - healthy: connected AND a bar/heartbeat arrived within the watchdog window
 * - delivering: healthy AND at least one real bar for THIS key has arrived
 *   (so the consumer only suppresses the Finnhub writers once push is proven live)
 */
export function getStatus(sym, tf) {
  const key = _pairKey(sym, tf)
  if (_killed()) return { connected: false, healthy: false, delivering: false }
  const bucket = _buckets.find(b => b.pairs.has(key))
  const connected = !!(bucket && bucket.connected)
  const healthy = connected && (Date.now() - bucket.lastMsg < BARS_WATCHDOG_MS)
  const ks = _keyState.get(key)
  // delivering REQUIRES a RECENT real bar for THIS key — NOT just connected/heartbeating.
  // A feed that stops emitting bars but keeps the 15s heartbeat alive would otherwise
  // keep `healthy` true forever, freezing the candle with Finnhub suppressed and no
  // watchdog recovery (review blocker #2). Also closes the resubscribe case (#3): a
  // freshly reconnected key has a stale lastBarAt so delivering stays false until a
  // fresh bar arrives, keeping Finnhub authoritative through the gap.
  // HYSTERESIS: ENGAGE when a bar arrived within BARS_LIVE_STALE_MS, but once delivering stay
  // so until a LONGER silence (BARS_LIVE_DISENGAGE_MS). Massive emits AM only for minutes WITH
  // trades, so a thin name on a 1m chart can cross 120s with no print; a single global boundary
  // would flip delivering false→push-off→Finnhub→true on the next tick, and each handoff is a
  // potential seam (the two feeds disagree on the developing close/volume). Hysteresis turns
  // that recurring thrash into a one-time fallback only when the feed is GENUINELY dead.
  const recent = ks ? Date.now() - ks.lastBarAt : Infinity
  const wasDelivering = !!(ks && ks.delivering)
  const delivering = connected && !!(ks && ks.everDelivered) &&
    recent < (wasDelivering ? BARS_LIVE_DISENGAGE_MS : BARS_LIVE_STALE_MS)
  if (ks) ks.delivering = delivering   // persist for next call's hysteresis
  return { connected, healthy, delivering }
}

function _union() {
  if (_killed()) return []
  const set = new Set()
  for (const sub of _subscribers.values()) set.add(sub.key)
  return [...set].sort()
}

function _scheduleRebuild() {
  if (_rebuildTimer) clearTimeout(_rebuildTimer)
  _rebuildTimer = setTimeout(_rebuild, REBUILD_DEBOUNCE_MS)
}

function _rebuild() {
  _rebuildTimer = null
  const union = _union()
  const chunks = []
  for (let i = 0; i < union.length; i += MAX_BARS_PAIRS) chunks.push(union.slice(i, i + MAX_BARS_PAIRS))

  const existingByKey = new Map(_buckets.map(b => [b.key, b]))
  const next = []
  for (const chunk of chunks) {
    const key = chunk.join(',')
    const existing = existingByKey.get(key)
    if (existing) { existingByKey.delete(key); next.push(existing); continue }
    const bucket = {
      key, pairs: new Set(chunk), es: null, connected: false,
      retryDelay: INITIAL_RETRY_MS, reconnectTimer: null, lastMsg: Date.now(),
    }
    next.push(bucket)
    _connectBucket(bucket)
  }
  for (const stale of existingByKey.values()) _teardownBucket(stale)
  _buckets = next

  if (_buckets.length > 0 && !_watchdogTimer) {
    _watchdogTimer = setInterval(_watchdogSweep, BARS_WATCHDOG_TICK_MS)
  } else if (_buckets.length === 0 && _watchdogTimer) {
    clearInterval(_watchdogTimer); _watchdogTimer = null
  }
  _notifyAllStatus()
}

function _teardownBucket(bucket) {
  if (bucket.reconnectTimer) { clearTimeout(bucket.reconnectTimer); bucket.reconnectTimer = null }
  if (bucket.es) { try { bucket.es.close() } catch { /* already closed */ } bucket.es = null }
  bucket.connected = false
}

function _connectBucket(bucket) {
  if (typeof EventSource === 'undefined') return  // SSR / non-browser safety
  const es = new EventSource(`/api/stream/bars?bars=${bucket.key}`)
  bucket.es = es
  bucket.lastMsg = Date.now()

  const touch = () => { bucket.lastMsg = Date.now() }

  es.onopen = () => {
    if (bucket.es !== es) return
    bucket.connected = true
    bucket.retryDelay = INITIAL_RETRY_MS
    touch()
    // On (re)connect, ask each subscriber in this bucket to gap-backfill.
    for (const sub of _subscribers.values()) {
      if (!bucket.pairs.has(sub.key)) continue
      const ks = _keyState.get(sub.key)
      if (sub.onReconnect) { try { sub.onReconnect(ks ? ks.lastBarT : null) } catch { /* ignore */ } }
      _notifyStatus(sub)
    }
  }

  es.addEventListener('bar', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)   // {sym, tf, bar:{t,o,h,l,c,v}}
      if (!data || !data.sym || data.tf == null) return
      const key = _pairKey(data.sym, data.tf)
      // Per-key delivery state (drives `delivering`).
      const wasDelivering = !!_keyState.get(key)?.everDelivered
      const ks = _keyState.get(key) || {}
      ks.everDelivered = true
      ks.lastBarAt = Date.now()
      if (data.bar && data.bar.t != null) ks.lastBarT = data.bar.t
      _keyState.set(key, ks)
      // THROTTLED keyed dispatch (see _pendingBar): coalesce to ~2x/sec so the candle
      // ticks on the same calm heartbeat as the quotes — but flush the PRIOR bucket's
      // final bar immediately on a boundary so no close is coalesced away. Only
      // subscribers for this exact (sym,tf), never a global fan-out.
      const _pend = _pendingBar.get(key)
      if (_pend && _pend.bar && data.bar && _pend.bar.t !== data.bar.t) {
        _pendingBar.delete(key)
        _dispatchBar(key, _pend)
      }
      _pendingBar.set(key, data)
      if (!_barThrottleTimer) _barThrottleTimer = setTimeout(_flushPendingBars, BAR_THROTTLE_MS)
      if (!wasDelivering) _notifyStatusForKey(key)  // first bar → status flip
    } catch { /* malformed frame */ }
  })

  // Named heartbeat (see stream.py) — keeps lastMsg fresh during quiet periods so
  // the watchdog doesn't false-reconnect a healthy-but-idle connection.
  es.addEventListener('heartbeat', () => { if (bucket.es === es) touch() })

  es.onerror = () => {
    if (bucket.es !== es) return  // a rebuild/watchdog already replaced this connection
    try { es.close() } catch { /* ignore */ }
    bucket.es = null
    bucket.connected = false
    const delay = bucket.retryDelay
    bucket.retryDelay = Math.min(delay * 2, STREAM_RECONNECT_CAP_MS)
    bucket.reconnectTimer = setTimeout(() => {
      bucket.reconnectTimer = null
      if (_buckets.includes(bucket)) _connectBucket(bucket)
    }, delay)
    // Connection dropped → keys in this bucket are no longer healthy.
    for (const sub of _subscribers.values()) if (bucket.pairs.has(sub.key)) _notifyStatus(sub)
  }
}

function _watchdogSweep() {
  const now = Date.now()
  for (const bucket of _buckets) {
    if (bucket.es && now - bucket.lastMsg > BARS_WATCHDOG_MS) {
      // Silent death: not even the 15s heartbeat arrived — force reconnect.
      _teardownBucket(bucket)
      bucket.retryDelay = INITIAL_RETRY_MS
      _connectBucket(bucket)
    }
  }
  // Re-notify every sweep so the TIME-BASED `delivering` recency gate is actually
  // OBSERVED: when a feed stops emitting bars but keeps heartbeating, no event fires,
  // so without this the consumer never re-reads getStatus and the candle stays frozen
  // with Finnhub suppressed (review re-check — the recency gate is otherwise dead code
  // in steady state). Cheap: refresh() in useRealtimeBars bails when the status is
  // unchanged, so this only re-renders a chart when its (connected/healthy/delivering)
  // actually flips.
  _notifyAllStatus()
}

// Backgrounded/asleep tabs throttle (or fully freeze) the setInterval watchdog, so a
// silently-dead bars connection isn't detected until a delayed tick after refocus.
// Force an immediate sweep on becoming visible so a stale/dead feed reconnects (and
// `delivering` is re-evaluated) the instant the user comes back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) _watchdogSweep()
  })
}

// ── test hooks ──────────────────────────────────────────────────────────────

export function _resetForTests() {
  if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null }
  if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null }
  if (_barThrottleTimer) { clearTimeout(_barThrottleTimer); _barThrottleTimer = null }
  _pendingBar.clear()
  for (const b of _buckets) _teardownBucket(b)
  _buckets = []
  _subscribers.clear()
  _keyState.clear()
  _nextId = 1
}

export function _getBuckets() { return _buckets }
export function _flushRebuild() { if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null } _rebuild() }
// Test hook: dispatch any bars buffered by the 500ms throttle right now.
export function _flushBars() { if (_barThrottleTimer) { clearTimeout(_barThrottleTimer); _barThrottleTimer = null } _flushPendingBars() }
