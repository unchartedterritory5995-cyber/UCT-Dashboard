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
//
// Event ids (TERM-054): every server frame carries `id:`, and each bucket keeps
// the newest one it saw. When a bucket RECONNECTS (error backoff or watchdog —
// the same subscription coming back) it presents that id as `last_event_id`;
// a bucket built for a changed union is a new subscription and presents none.
// This pool closes and re-creates its EventSource, so the browser's own
// Last-Event-ID header never fires — the query parameter is the door. The
// server answers with `event: resume`: this stream is last-value-wins, so resume
// is `not_applicable`, zero events are replayed, and the current snapshot that
// follows is merged exactly like any other. The declaration is recorded
// (getLastResume) and changes nothing else.

import { registerRecoveryStream } from './recoveryRegistry'
import { rebuildLeft } from './streamRebuildDelay'
import * as realtimeCandle from './realtimeCandle'
import { getQuotePush, whenQuotePush } from './quotePushGate'
import {
  STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS, LIVE_UI_CADENCE_MS,
} from '../utils/streamStatus'

export const MAX_SSE_TICKERS = 50   // mirror of api/routers/stream.py MAX_SSE_TICKERS
export const REBUILD_DEBOUNCE_MS = 400
const INITIAL_RETRY_MS = 5000

let _nextId = 1
const _subscribers = new Map()  // id -> { tickers: string[], listener }
let _buckets = []               // [{ key, tickers, es, connected, retryDelay, reconnectTimer, lastMsg, lastEventId }]
let _lastResume = null          // the newest `event: resume` declaration, with its bucket key
let _streamPrices = {}
let _staleSymbols = new Set()
let _rebuildTimer = null
let _lastActivityAt = -Infinity   // the last subscription change or reconnect (streamRebuildDelay.js)
let _gathering = false            // the pending reconnect is a quiet pool's REBUILD_GATHER_MS wait
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

/** The newest resume declaration the server sent (or null): what it said, which
 *  bucket received it, and when. Diagnostics only — see the header comment. */
export function getLastResume() {
  return _lastResume
}

export function subscribe(tickers, listener) {
  const id = _nextId++
  _subscribers.set(id, { tickers: [...new Set((tickers || []).filter(Boolean))], listener })
  _scheduleRebuild()
  _pushTickers()   // pushed list prices: loads lib/quotePush only when flagged on
  return () => {
    _subscribers.delete(id)
    _scheduleRebuild()
    _pushTickers()
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
  const t = Date.now()
  // gather while a gather is pending, or on a quiet pool; otherwise the full debounce from this change
  _gathering = (!!_rebuildTimer && _gathering) || t - _lastActivityAt >= REBUILD_DEBOUNCE_MS
  _lastActivityAt = t
  // ⚡ one timer per burst: a later change moves the deadline, not the timer (streamRebuildDelay.rebuildLeft)
  if (!_rebuildTimer) _rebuildTimer = setTimeout(_rebuildDue, rebuildLeft(_gathering, t, REBUILD_DEBOUNCE_MS))
}
function _rebuildDue() {
  const left = rebuildLeft(_gathering, _lastActivityAt, REBUILD_DEBOUNCE_MS)
  if (left > 0) _rebuildTimer = setTimeout(_rebuildDue, left)
  else _rebuild()
}

function _rebuild() {
  _rebuildTimer = null
  _lastActivityAt = Date.now()
  _gathering = false
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
      lastEventId: null,   // a NEW subscription presents no id — it is not a resume
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
  const resumeParam = bucket.lastEventId
    ? `&last_event_id=${encodeURIComponent(bucket.lastEventId)}` : ''
  const es = new EventSource(`/api/stream/prices?tickers=${bucket.key}${resumeParam}`)
  bucket.es = es
  bucket.lastMsg = Date.now()

  // Every frame is liveness; every frame's id is the newest this bucket has seen.
  const touch = (event) => {
    bucket.lastMsg = Date.now()
    if (event && event.lastEventId) bucket.lastEventId = event.lastEventId
  }

  es.addEventListener('resume', (event) => {
    if (bucket.es !== es) return
    touch(event)
    try {
      _lastResume = { ...JSON.parse(event.data), bucket: bucket.key, receivedAt: Date.now() }
    } catch { /* malformed frame — ignore */ }
  })

  es.onopen = () => {
    if (bucket.es !== es) return
    bucket.connected = true
    bucket.retryDelay = INITIAL_RETRY_MS
    touch()
    _publish()
  }

  es.onmessage = (event) => {
    if (bucket.es !== es) return
    touch(event)
    try {
      const data = JSON.parse(event.data)
      const prev = _streamPrices
      _streamPrices = { ...prev, ...data }
      // A pushed quote (lib/quotePush.js, `push_ts`) is never replaced by an OLDER trade from this stream.
      for (const k of Object.keys(data)) {
        const p = prev[k]
        if (p && p.push_ts != null && _entryMs(data[k]) < p.push_ts) _streamPrices[k] = p
      }
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

  es.addEventListener('heartbeat', (event) => { if (bucket.es === es) touch(event) })

  es.addEventListener('stale', (event) => {
    if (bucket.es !== es) return
    touch(event)
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
    touch(event)
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
    touch(event)
    try {
      const data = JSON.parse(event.data)
      if (data?.sym) realtimeCandle.applyTick(data.sym, data.price, data.vol, data.ts)
    } catch { /* ignore */ }
  })

  es.addEventListener('bar_close', (event) => {
    if (bucket.es !== es) return
    touch(event)
    try {
      const data = JSON.parse(event.data)
      if (data?.sym && data?.bar) realtimeCandle.applyBarClose(data.sym, data.tf || '1', data.bar)
    } catch { /* ignore */ }
  })

  es.addEventListener('bar_correction', (event) => {
    if (bucket.es !== es) return
    touch(event)
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

// ── pushed list prices (lib/quotePush.js) ─────────────────────────────────────
// The push hands a batch per animation frame. Each quote overlays this snapshot's entry unless the stream
// already holds a newer trade, and only the subscribers holding a changed symbol are told: at once, not
// on this pool's 1 s throttle (the push batches per frame already). A push that stops being healthy takes
// its quotes back out, so a frozen pushed price can never outlive it (REST and this stream remain).

function _entryMs(e) {
  if (!e || typeof e !== 'object') return 0
  const t = Number(e.trade_ts)
  if (Number.isFinite(t) && t > 0) return t
  const u = Number(e.updated_at)
  if (Number.isFinite(u) && u > 0) return u * 1000
  const s = Number(e.timestamp)
  if (Number.isFinite(s) && s > 0) return s > 1e12 ? s : s * 1000
  return 0
}

export function applyPushedQuotes(batch) {
  let next = null
  const changed = new Set()
  for (const sym in batch) {
    const q = batch[sym]
    if (!q || !(q.price > 0)) continue
    const prev = (next || _streamPrices)[sym]
    if (prev && q.trade_ts != null && _entryMs(prev) > q.trade_ts) continue   // the stream is already newer
    if (prev && prev.price === q.price && prev.volume === q.volume) continue
    if (!next) next = { ..._streamPrices }
    const at = q.trade_ts != null ? q.trade_ts : Date.now()
    next[sym] = { ...(prev || {}), price: q.price, volume: q.volume ?? prev?.volume, trade_ts: at,
      updated_at: Math.floor(at / 1000), push_ts: at }
    changed.add(sym)
  }
  if (!next) return
  _streamPrices = next
  _refreshSnapshot()
  for (const sub of _subscribers.values()) {
    if (!sub.tickers.some((t) => changed.has(String(t).toUpperCase()))) continue
    try { sub.listener() } catch { /* one bad listener never breaks fanout */ }
  }
}

export function clearPushedQuotes() {
  let next = null
  for (const sym in _streamPrices) {
    if (_streamPrices[sym]?.push_ts == null) continue
    if (!next) next = { ..._streamPrices }
    delete next[sym]
  }
  if (!next) return
  _streamPrices = next
  _publish()
}

/** The pushed list prices' connection (lib/quotePush.js, loaded lazily) is constructed HERE, by this pool
 *  entry point (lib/panelContract.rail.test.js: transports belong to the pools). */
export function openQuotesEventSource(url) {
  if (typeof EventSource === 'undefined') return null
  return new EventSource(url)
}

let _pushWired = false
function _wirePush(qp) {
  if (!_pushWired) {
    _pushWired = true
    qp.onQuotes(applyPushedQuotes, 'priceStreamManager')
    qp.onHealth((healthy) => { if (!healthy) clearPushedQuotes() }, 'priceStreamManager')
  }
  qp.setTickers('stream', _union())
}
function _pushTickers() {
  const qp = getQuotePush()
  if (qp) _wirePush(qp)
  else whenQuotePush(_wirePush)
}

// ── recovery (lib/recovery.js) ──────────────────────────────────────────────
// After a wake or a network return, recovery reconnects every bucket at once instead of waiting for
// the silence watchdog or a backoff that may already be at its cap, and waits on isConnected().

/** Tear down and reopen every connection now, with the backoff reset. */
export function reconnectNow() {
  for (const bucket of _buckets) {
    _teardownBucket(bucket)
    bucket.retryDelay = INITIAL_RETRY_MS
    _connectBucket(bucket)
  }
  if (_buckets.length) _publish()
}

/** True when every open bucket is connected, or there is nothing to connect. */
export function isConnected() {
  return _buckets.every((b) => b.connected)
}

registerRecoveryStream({ name: 'prices', reconnectNow, isConnected })

// ── test hooks ──────────────────────────────────────────────────────────────

export function _resetForTests() {
  if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null }
  _lastActivityAt = -Infinity
  _gathering = false
  if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null }
  if (_throttleTimer) { clearTimeout(_throttleTimer); _throttleTimer = null }
  _pendingPublish = false
  for (const b of _buckets) _teardownBucket(b)
  _buckets = []
  _subscribers.clear()
  _streamPrices = {}
  _staleSymbols = new Set()
  _lastResume = null
  _snapshot = { prices: {}, staleSymbols: new Set(), connected: false }
}

export function _getBuckets() {
  return _buckets
}
