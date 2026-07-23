// Shared SSE connection pool for /api/stream/prices.
//
// Every useRealtimePrices() instance used to open its OWN EventSource; the
// Dashboard mounts desktop+mobile layouts simultaneously, so one user held
// 4-8 concurrent server-side stream loops — the load class behind the
// 2026-07-01 524 outage. This manager owns ALL price-stream connections:
// subscribers register their tickers, the manager streams the deduped union
// over as few connections as the backend's 50-ticker/connection cap allows
// (usually one), and fans events out via a useSyncExternalStore snapshot.
//
// SSE subscriptions are fixed in the URL, so a changed union requires a
// reconnect — debounced so a page transition causes one rebuild, not five.
// streamPrices is never cleared on rebuild: last-known prices stay on screen
// and the 2s REST poll continues underneath, making reconnects invisible.
//
// Kill-switch: localStorage 'uct.ssePool.disabled' = '1' (read at module load
// in useRealtimePrices.js) reverts to the legacy one-connection-per-hook path.

import * as realtimeCandle from './realtimeCandle'
import {
  STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS, LIVE_UI_CADENCE_MS,
} from '../utils/streamStatus'

export const MAX_SSE_TICKERS = 50   // mirror of api/routers/stream.py MAX_SSE_TICKERS
export const REBUILD_DEBOUNCE_MS = 400
const INITIAL_RETRY_MS = 5000

let _nextId = 1
const _subscribers = new Map()  // id -> { tickers: string[], listener }
let _buckets = []               // [{ key, tickers, es, connected, retryDelay, reconnectTimer, lastMsg }]
let _streamPrices = {}
let _staleSymbols = new Set()
let _rebuildTimer = null
let _watchdogTimer = null
let _snapshot = { prices: {}, staleSymbols: new Set(), connected: false }

function _allConnected() {
  return _buckets.length > 0 && _buckets.every(b => b.connected)
}

// Coalesce re-render notifications to the shared live-UI cadence. Updating the whole
// app (watchlist, theme tracker, header %, chart legend source) on EVERY tick is visual
// churn + a re-render storm across many rows; a calm, fixed cadence looks less chaotic
// AND is lighter. The snapshot is refreshed IMMEDIATELY so getSnapshot() (and a
// freshly-mounting consumer) always reads current data — only the notify (re-render)
// is throttled: leading edge fires at once, then at most once per window. Keep this in
// lockstep with realtimeCandle's flush so numbers and candle move together.
const PUBLISH_THROTTLE_MS = LIVE_UI_CADENCE_MS
let _throttleTimer = null
let _pendingPublish = false

function _refreshSnapshot() {
  _snapshot = { prices: _streamPrices, staleSymbols: _staleSymbols, connected: _allConnected() }
}

function _notifyListeners() {
  for (const sub of _subscribers.values()) {
    try { sub.listener() } catch { /* one bad listener never breaks fanout */ }
  }
}

function _publish() {
  _refreshSnapshot()
  if (_throttleTimer) { _pendingPublish = true; return }
  _notifyListeners()
  _throttleTimer = setTimeout(() => {
    _throttleTimer = null
    if (_pendingPublish) { _pendingPublish = false; _refreshSnapshot(); _notifyListeners() }
  }, PUBLISH_THROTTLE_MS)
}

export function getSnapshot() {
  return _snapshot
}

export function subscribe(tickers, listener) {
  const id = _nextId++
  _subscribers.set(id, { tickers: [...new Set((tickers || []).filter(Boolean))], listener })
  _scheduleRebuild()
  return () => {
    _subscribers.delete(id)
    _scheduleRebuild()
  }
}

function _union() {
  const set = new Set()
  for (const sub of _subscribers.values()) {
    for (const t of sub.tickers) set.add(String(t).toUpperCase())
  }
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
  for (let i = 0; i < union.length; i += MAX_SSE_TICKERS) {
    chunks.push(union.slice(i, i + MAX_SSE_TICKERS))
  }

  const existingByKey = new Map(_buckets.map(b => [b.key, b]))
  const next = []
  for (const chunk of chunks) {
    const key = chunk.join(',')
    const existing = existingByKey.get(key)
    if (existing) {
      existingByKey.delete(key)
      next.push(existing)  // unchanged bucket keeps its live connection
      continue
    }
    const bucket = {
      key, tickers: chunk, es: null, connected: false,
      retryDelay: INITIAL_RETRY_MS, reconnectTimer: null, lastMsg: Date.now(),
    }
    next.push(bucket)
    _connectBucket(bucket)
  }
  for (const stale of existingByKey.values()) _teardownBucket(stale)
  _buckets = next

  if (_buckets.length > 0 && !_watchdogTimer) {
    _watchdogTimer = setInterval(_watchdogSweep, STREAM_WATCHDOG_TICK_MS)
  } else if (_buckets.length === 0 && _watchdogTimer) {
    clearInterval(_watchdogTimer)
    _watchdogTimer = null
  }
  _publish()
}

function _teardownBucket(bucket) {
  if (bucket.reconnectTimer) { clearTimeout(bucket.reconnectTimer); bucket.reconnectTimer = null }
  if (bucket.es) { try { bucket.es.close() } catch { /* already closed */ } bucket.es = null }
  bucket.connected = false
}

function _connectBucket(bucket) {
  if (typeof EventSource === 'undefined') return  // SSR / non-browser safety
  const es = new EventSource(`/api/stream/prices?tickers=${bucket.key}`)
  bucket.es = es
  bucket.lastMsg = Date.now()

  const touch = () => { bucket.lastMsg = Date.now() }

  es.onopen = () => {
    if (bucket.es !== es) return
    bucket.connected = true
    bucket.retryDelay = INITIAL_RETRY_MS
    touch()
    _publish()
  }

  es.onmessage = (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      const prev = _streamPrices
      _streamPrices = { ...prev, ...data }
      // A CHANGED price/volume IS freshness — clear any stale flag for that
      // symbol. The server's 'fresh' event only fires on a stale→fresh
      // transition seen by the SAME connection; a flag raised before a
      // reconnect/bucket-rebuild otherwise sticks forever ("STALE badge while
      // the price is ticking"). Changed-only: the payload carries the whole
      // bucket's map, and a genuinely-quiet symbol's unchanged entry must not
      // clear its flag just because a bucket-mate ticked.
      let nextStale = null
      for (const k of Object.keys(data)) {
        const sym = k.toUpperCase()
        if (!(nextStale || _staleSymbols).has(sym)) continue
        const p = prev[k]
        const n = data[k]
        if (p && n && p.price === n.price && p.volume === n.volume) continue
        if (!nextStale) nextStale = new Set(_staleSymbols)
        nextStale.delete(sym)
      }
      if (nextStale) _staleSymbols = nextStale
      _publish()
    } catch { /* malformed frame — ignore */ }
  }

  es.addEventListener('heartbeat', () => { if (bucket.es === es) touch() })

  es.addEventListener('stale', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (!data?.sym) return
      const sym = String(data.sym).toUpperCase()
      if (_staleSymbols.has(sym)) return
      _staleSymbols = new Set(_staleSymbols)
      _staleSymbols.add(sym)
      _publish()
    } catch { /* ignore */ }
  })

  es.addEventListener('fresh', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (!data?.sym) return
      const sym = String(data.sym).toUpperCase()
      if (!_staleSymbols.has(sym)) return
      _staleSymbols = new Set(_staleSymbols)
      _staleSymbols.delete(sym)
      _publish()
    } catch { /* ignore */ }
  })

  es.addEventListener('tick', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (data?.sym) realtimeCandle.applyTick(data.sym, data.price, data.vol, data.ts)
    } catch { /* ignore */ }
  })

  es.addEventListener('bar_close', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (data?.sym && data?.bar) realtimeCandle.applyBarClose(data.sym, data.tf || '1', data.bar)
    } catch { /* ignore */ }
  })

  es.addEventListener('bar_correction', (event) => {
    if (bucket.es !== es) return
    touch()
    try {
      const data = JSON.parse(event.data)
      if (data?.sym && data?.bar) realtimeCandle.applyCorrection(data.sym, data.tf || '1', data.bar)
    } catch { /* ignore */ }
  })

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
    _publish()
  }
}

function _watchdogSweep() {
  const now = Date.now()
  for (const bucket of _buckets) {
    if (bucket.es && now - bucket.lastMsg > STREAM_WATCHDOG_MS) {
      // Silent death: nothing (not even the 15s heartbeat) arrived — force reconnect.
      _teardownBucket(bucket)
      bucket.retryDelay = INITIAL_RETRY_MS
      _connectBucket(bucket)
      _publish()
    }
  }
}

// Backgrounded/asleep tabs throttle (or fully freeze) the setInterval watchdog, so an
// EventSource that dies silently while hidden (proxy idle-timeout, laptop sleep) isn't
// detected until a delayed tick AFTER the tab returns — the quotes look frozen for a
// beat on refocus. Force an immediate sweep on becoming visible so stale/dead buckets
// reconnect the instant the user comes back.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) _watchdogSweep()
  })
}

// ── test hooks ──────────────────────────────────────────────────────────────

export function _resetForTests() {
  if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null }
  if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null }
  if (_throttleTimer) { clearTimeout(_throttleTimer); _throttleTimer = null }
  _pendingPublish = false
  for (const b of _buckets) _teardownBucket(b)
  _buckets = []
  _subscribers.clear()
  _streamPrices = {}
  _staleSymbols = new Set()
  _snapshot = { prices: {}, staleSymbols: new Set(), connected: false }
}

export function _getBuckets() {
  return _buckets
}
