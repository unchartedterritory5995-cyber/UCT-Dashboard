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
  STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS,
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

function _publish() {
  _snapshot = { prices: _streamPrices, staleSymbols: _staleSymbols, connected: _allConnected() }
  for (const sub of _subscribers.values()) {
    try { sub.listener() } catch { /* one bad listener never breaks fanout */ }
  }
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

  const next = []
  for (let i = 0; i < chunks.length; i++) {
    const key = chunks[i].join(',')
    const existing = _buckets[i]
    if (existing && existing.key === key) {
      next.push(existing)  // unchanged bucket keeps its live connection
      continue
    }
    if (existing) _teardownBucket(existing)
    const bucket = {
      key, tickers: chunks[i], es: null, connected: false,
      retryDelay: INITIAL_RETRY_MS, reconnectTimer: null, lastMsg: Date.now(),
    }
    next.push(bucket)
    _connectBucket(bucket)
  }
  for (let i = chunks.length; i < _buckets.length; i++) _teardownBucket(_buckets[i])
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
      _streamPrices = { ..._streamPrices, ...data }
      _publish()
    } catch { /* malformed frame — ignore */ }
  }

  es.addEventListener('heartbeat', touch)

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

// ── test hooks ──────────────────────────────────────────────────────────────

export function _resetForTests() {
  if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null }
  if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null }
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
