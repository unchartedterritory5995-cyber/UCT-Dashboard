// Pushed real-time list prices: the client of /api/stream/quotes (api/routers/quote_stream.py).
//
// ONE pooled EventSource carries the union of every list price the tab shows (livePriceStore's tickers and
// priceStreamManager's), split only past MAX_QUOTE_SYMBOLS. The server writes ONE message per wake,
// `[server write ms, [sym, price, day volume, trade ms], ...]`, every price change leaving on the ingest
// batch that brought it. Quotes are held here and handed to the stores ONCE, on the next animation frame,
// as one batch: latest per symbol wins inside the frame, and a list of 100 names repaints at most once a
// frame (never per message, never on a 1 s timer). The stores commit inside that frame (livePriceStore).
//
// A ticker-set change is MAKE BEFORE BREAK (review of #2751, D): the new connection opens while the old one
// keeps delivering, health and pushed quotes are kept, and the old one closes when the new one is open (or
// after RESUBSCRIBE_GRACE_MS, when a replacement that never opened stops counting as healthy).
//
// The REST poll (hooks/livePriceStore) stays the fallback: while this push is healthy it slows to
// PUSH_HEALTHY_POLL_MS (it still brings prev close, day OHLC and the session); the moment the push is not
// healthy (a `status {live:false}`, an error, silence past the watchdog) every listener is told and the
// poll returns to its normal cadence at once. Hidden-tab rules are the poll's own, unchanged; the push
// closes after HIDDEN_CLOSE_MS hidden and reopens on return (a snapshot arrives with the first frame).
//
// ⛔ BEHIND A FLAG, DEFAULT OFF. On only with `localStorage['uct.quotePush'] = '1'` or the cookie
// `uct_quote_push=1`, AND the server's QUOTE_STREAM_ENABLED (off it answers 503 and this backs off).
// KILL SWITCH: `localStorage['uct.quotePush.disabled'] = '1'` beats both. Read on every union change,
// so no reload is needed.
//
// Measuring it (what a live measurement reads): getPushStats() — trade->receive (browser clock vs the
// exchange's trade time: includes clock skew), serialise->receive (server wall clock at serialisation vs
// the browser: skew too), receive->apply (the frame wait, same clock). Also window.__uctQuotePush when on.

import { STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS } from '../utils/streamStatus'
import { _applyLiveChange, _applyLiveExtPrice } from './liveQuoteMerge'

export const QUOTE_PUSH_PATH = '/api/stream/quotes'
export const MAX_QUOTE_SYMBOLS = 250            // mirror of api/routers/quote_stream.py MAX_QUOTE_SYMBOLS
export const PUSH_HEALTHY_POLL_MS = 15000       // the REST poll's cadence while the push is healthy
export const SET_DEBOUNCE_MS = 250              // a page transition rebuilds once, not per component
export const HIDDEN_CLOSE_MS = 60000
export const RESUBSCRIBE_GRACE_MS = 5000
const INITIAL_RETRY_MS = 2000
const RETRY_CAP_MS = 60000
const STATS_CAP = 512

const _owners = new Map()        // owner -> Set(sym)
let _setTimer = null
let _buckets = []                // [{ key, tickers, es, connected, live, lastMsg, retryDelay, reconnectTimer, graceUntil }]
let _retiring = []               // replaced buckets still delivering until their replacements open
let _graceTimer = null
const _quotes = new Map()        // sym -> { price, volume, trade_ts, sent_ms, recv }
let _pending = null              // sym -> quote, waiting for the next frame
let _raf = null
const _quoteSinks = new Set()
const _healthSinks = new Set()
let _healthy = false
let _watchdog = null
let _hiddenTimer = null
let _closedForHidden = false
const _stats = { tradeToRecv: [], sentToRecv: [], recvToApply: [], frames: 0, batches: 0 }

// ── the flag ────────────────────────────────────────────────────────────────

export function quotePushEnabled() {
  try {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('uct.quotePush.disabled') === '1') return false
      if (localStorage.getItem('uct.quotePush') === '1') return true
    }
  } catch { /* storage refused: fall through to the cookie */ }
  try {
    return typeof document !== 'undefined' && /(?:^|;\s*)uct_quote_push=1(?:;|$)/.test(document.cookie || '')
  } catch {
    return false
  }
}

// ── subscriptions ───────────────────────────────────────────────────────────

/** Replace `owner`'s ticker set (livePriceStore: 'rest', priceStreamManager: 'stream'). Debounced. */
export function setTickers(owner, tickers) {
  const set = new Set()
  for (const t of tickers || []) if (t) set.add(String(t).toUpperCase())
  if (set.size) _owners.set(owner, set)
  else _owners.delete(owner)
  if (_setTimer) clearTimeout(_setTimer)
  _setTimer = setTimeout(_rebuild, SET_DEBOUNCE_MS)
}

function _union() {
  const all = new Set()
  for (const s of _owners.values()) for (const t of s) all.add(t)
  return [...all].sort()
}

function _rebuild() {
  _setTimer = null
  const wasHealthy = isHealthy()
  const union = quotePushEnabled() && !_closedForHidden ? _union() : []
  const chunks = []
  for (let i = 0; i < union.length; i += MAX_QUOTE_SYMBOLS) chunks.push(union.slice(i, i + MAX_QUOTE_SYMBOLS))
  const byKey = new Map(_buckets.map((b) => [b.key, b]))
  const next = []
  for (const chunk of chunks) {
    const key = chunk.join(',')
    const had = byKey.get(key)
    if (had) { byKey.delete(key); next.push(had); continue }
    const b = { key, tickers: chunk, es: null, connected: false, live: null, lastMsg: Date.now(),
      retryDelay: INITIAL_RETRY_MS, reconnectTimer: null,
      graceUntil: wasHealthy ? Date.now() + RESUBSCRIBE_GRACE_MS : 0 }
    next.push(b)
    _connect(b)
  }
  const keepOld = wasHealthy && next.some((b) => !b.connected)
  for (const gone of byKey.values()) {
    if (keepOld) _retiring.push(gone)
    else _teardown(gone)
  }
  _buckets = next
  if (_retiring.length && !keepOld) _retireAll()
  if (keepOld && !_graceTimer) _graceTimer = setTimeout(_endGrace, RESUBSCRIBE_GRACE_MS)
  if (_buckets.length && !_watchdog) _watchdog = setInterval(_sweep, STREAM_WATCHDOG_TICK_MS)
  if (!_buckets.length && _watchdog) { clearInterval(_watchdog); _watchdog = null }
  _updateHealth()
}

function _retireAll() {
  for (const b of _retiring) _teardown(b)
  _retiring = []
  if (_graceTimer) { clearTimeout(_graceTimer); _graceTimer = null }
}

function _endGrace() {
  _graceTimer = null
  _retireAll()
  for (const b of _buckets) b.graceUntil = 0
  _updateHealth()
}

function _teardown(b) {
  if (b.reconnectTimer) { clearTimeout(b.reconnectTimer); b.reconnectTimer = null }
  if (b.es) { try { b.es.close() } catch { /* closed */ } b.es = null }
  b.connected = false
}

function _connect(b) {
  if (typeof EventSource === 'undefined') return
  const es = new EventSource(`${QUOTE_PUSH_PATH}?tickers=${b.key}`)
  b.es = es
  b.lastMsg = Date.now()
  const touch = () => { b.lastMsg = Date.now() }
  es.onopen = () => {
    if (b.es !== es) return
    b.connected = true
    b.retryDelay = INITIAL_RETRY_MS
    b.graceUntil = 0
    touch()
    if (_retiring.length && _buckets.every((x) => x.connected)) _retireAll()
    _updateHealth()
  }
  es.onmessage = (e) => {
    if (b.es !== es) return
    touch()
    const m = parseMessage(e.data)
    if (m) for (const q of m.quotes) _onQuote(q, m.sentMs)
  }
  es.addEventListener('status', (e) => {
    if (b.es !== es) return
    touch()
    try { b.live = !!JSON.parse(e.data).live } catch { /* malformed */ }
    _updateHealth()
  })
  es.addEventListener('hello', () => { if (b.es === es) touch() })
  es.addEventListener('heartbeat', () => { if (b.es === es) touch() })
  es.onerror = () => {
    if (b.es !== es) return
    try { es.close() } catch { /* closed */ }
    b.es = null
    b.connected = false
    b.live = null
    b.graceUntil = 0
    const delay = b.retryDelay
    b.retryDelay = Math.min(delay * 2, RETRY_CAP_MS)
    b.reconnectTimer = setTimeout(() => {
      b.reconnectTimer = null
      if (_buckets.includes(b) && quotePushEnabled()) _connect(b)
    }, delay)
    _updateHealth()
  }
}

function _sweep() {
  const now = Date.now()
  for (const b of _buckets) {
    if (b.es && now - b.lastMsg > STREAM_WATCHDOG_MS) {
      _teardown(b)
      b.live = null
      b.retryDelay = INITIAL_RETRY_MS
      _connect(b)
    }
  }
  _updateHealth()
}

// ── frames -> the next animation frame ──────────────────────────────────────

/** One write: `[write ms, ["AAPL",231.45,12345678,1732550000123], ...]` -> { sentMs, quotes }, or null. */
export function parseMessage(data) {
  let a
  try { a = JSON.parse(data) } catch { return null }
  if (!Array.isArray(a) || !a.length || typeof a[0] !== 'number' || !Number.isFinite(a[0])) return null
  const quotes = []
  for (let i = 1; i < a.length; i++) {
    const q = _quote(a[i])
    if (q) quotes.push(q)
  }
  return { sentMs: a[0], quotes }
}

/** `["AAPL",231.45,12345678,1732550000123]` (as JSON text) -> a quote, or null for anything else. */
export function parseFrame(data) {
  let a
  try { a = JSON.parse(data) } catch { return null }
  return _quote(a)
}

function _quote(a) {
  if (!Array.isArray(a) || a.length < 2 || typeof a[0] !== 'string' || !a[0]) return null
  const price = a[1]
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  return { sym: a[0].toUpperCase(), price, volume: num(a[2]), trade_ts: num(a[3]) }
}

function _sample(arr, v) {
  if (!Number.isFinite(v)) return
  arr.push(v)
  if (arr.length > STATS_CAP) arr.shift()
}

function _onQuote(q, sentMs) {
  const recv = Date.now()
  const quote = { price: q.price, volume: q.volume, trade_ts: q.trade_ts, sent_ms: sentMs ?? null, recv }
  _stats.frames += 1
  if (q.trade_ts != null) _sample(_stats.tradeToRecv, recv - q.trade_ts)
  if (sentMs != null) _sample(_stats.sentToRecv, recv - sentMs)
  ;(_pending ||= new Map()).set(q.sym, quote)
  if (_raf == null) _raf = _requestFrame(_applyFrame)
}

function _requestFrame(cb) {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb)
  return setTimeout(cb, 16)
}

function _applyFrame() {
  _raf = null
  const pend = _pending
  _pending = null
  if (!pend || !pend.size) return
  const now = Date.now()
  const batch = {}
  for (const [sym, q] of pend) {
    _quotes.set(sym, q)
    batch[sym] = q
    _sample(_stats.recvToApply, now - q.recv)
  }
  _stats.batches += 1
  for (const fn of _quoteSinks) {
    try { fn(batch) } catch { /* one bad sink never breaks the others */ }
  }
}

export function onQuotes(fn) {
  _quoteSinks.add(fn)
  return () => _quoteSinks.delete(fn)
}

export function getPushedQuote(sym) {
  return sym ? _quotes.get(String(sym).toUpperCase()) || null : null
}

// ── health ──────────────────────────────────────────────────────────────────

/** Every connection open, its feed live, and heard from within the watchdog window. */
export function isHealthy() {
  if (!_buckets.length || !quotePushEnabled()) return false
  const now = Date.now()
  return _buckets.every((b) => (b.es && b.connected && b.live !== false && now - b.lastMsg <= STREAM_WATCHDOG_MS)
    || (b.graceUntil > now && !b.connected))     // a replacement still opening, its predecessor delivering
}

function _updateHealth() {
  const h = isHealthy()
  if (h === _healthy) return
  _healthy = h
  if (!h) _quotes.clear()          // a stale pushed quote must never outlive the push
  for (const fn of _healthSinks) {
    try { fn(h) } catch { /* ignore */ }
  }
}

export function onHealth(fn) {
  _healthSinks.add(fn)
  return () => _healthSinks.delete(fn)
}

// ── what a REST-shaped list row shows ───────────────────────────────────────

/**
 * `rest` (a /api/live-prices entry) with pushed quote `q` applied, by the same rules as the stream merge
 * (lib/liveQuoteMerge.js): in the regular session the pushed price and day volume, and the day % recomputed
 * from the official prev close; in an extended session `price` stays the frozen regular-session close and
 * the pushed print is `ext_price`. Returns `rest` itself when nothing a row shows changed (no render).
 */
export function overlayPushed(rest, q) {
  if (!rest || !q || !(q.price > 0)) return rest
  // Never older over newer (review of #2751, A): a REST row that saw a later trade keeps its own price.
  const restMs = _restMs(rest)
  if (q.trade_ts != null && restMs != null && restMs > q.trade_ts) return rest
  const vol = q.volume != null && q.volume > 0 ? q.volume : rest.volume
  if (rest.ext_session == null ? (q.price === rest.price && vol === rest.volume) : q.price === rest.ext_price) {
    return rest      // the row already shows this (a recompute of the same % would only differ in rounding)
  }
  const out = { ...rest }
  if (rest.ext_session == null) {
    out.price = q.price
    if (q.volume != null && q.volume > 0) out.volume = q.volume
    _applyLiveChange(out, rest)
  } else {
    _applyLiveExtPrice(out, rest, {
      price: q.price, updated_at: q.trade_ts != null ? Math.floor(q.trade_ts / 1000) : undefined,
    })
  }
  const same = ['price', 'volume', 'change_pct', 'change', 'ext_price', 'ext_fresh']
    .every((k) => Object.is(out[k], rest[k]))
  if (same) return rest
  out.push_ts = q.trade_ts
  return out
}

/** A REST row's freshness in ms: its last trade (`last_trade_ms`), else when it was observed. */
function _restMs(r) {
  const t = Number(r.last_trade_ms)
  if (Number.isFinite(t) && t > 0) return t
  const o = Number(r.observed_at)
  if (Number.isFinite(o) && o > 0) return o > 1e12 ? o : o * 1000
  return null
}

// ── measurement ─────────────────────────────────────────────────────────────

function _pct(arr, p) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}

/** p50/p90 (ms) of the last STATS_CAP samples. See the header for what each one includes. */
export function getPushStats() {
  const pp = (a) => ({ n: a.length, p50: _pct(a, 50), p90: _pct(a, 90) })
  return {
    enabled: quotePushEnabled(), healthy: isHealthy(), connections: _buckets.length,
    symbols: _buckets.reduce((n, b) => n + b.tickers.length, 0), frames: _stats.frames, batches: _stats.batches,
    tradeToRecv: pp(_stats.tradeToRecv), sentToRecv: pp(_stats.sentToRecv), recvToApply: pp(_stats.recvToApply),
  }
}

if (typeof window !== 'undefined') {
  try { if (quotePushEnabled()) window.__uctQuotePush = getPushStats } catch { /* ignore */ }
}

// ── hidden tabs: close after a grace, reopen on return ─────────────────────

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (_hiddenTimer == null && _buckets.length) {
        _hiddenTimer = setTimeout(() => {
          _hiddenTimer = null
          _closedForHidden = true
          _rebuild()
        }, HIDDEN_CLOSE_MS)
      }
    } else {
      if (_hiddenTimer != null) { clearTimeout(_hiddenTimer); _hiddenTimer = null }
      if (_closedForHidden) { _closedForHidden = false; _rebuild() }
    }
  })
}

// ── test hooks ──────────────────────────────────────────────────────────────

export function _resetForTests() {
  if (_setTimer) { clearTimeout(_setTimer); _setTimer = null }
  for (const b of _buckets) _teardown(b)
  _buckets = []
  _retireAll()
  if (_watchdog) { clearInterval(_watchdog); _watchdog = null }
  if (_hiddenTimer) { clearTimeout(_hiddenTimer); _hiddenTimer = null }
  _closedForHidden = false
  _owners.clear()
  _quotes.clear()
  _pending = null
  _raf = null
  _healthy = false
  _stats.tradeToRecv = []; _stats.sentToRecv = []; _stats.recvToApply = []; _stats.frames = 0; _stats.batches = 0
}
