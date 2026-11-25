// Shared SSE connection pool for /api/stream/bars — the bars analog of
// priceStreamManager, kept in a SEPARATE module so the always-on price path
// (priceStreamManager.js) is byte-untouched (a bug here must never break live
// prices). DARK until VITE_REALTIME_BARS='1' (every consumer gates on it through
// lib/realtimeBarsGate.realtimeBarsEnabled — useRealtimeBars, data/barStore/liveFeed).
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
//
// Event ids (TERM-054): every server frame carries `id:`, and each bucket keeps
// the newest one it saw. When a bucket RECONNECTS (error backoff or watchdog —
// the same pairs coming back) it presents that id as `last_event_id`; a bucket
// built for a changed union is a new subscription and presents none. The server
// answers with `event: resume`: bars are last-value-wins, so resume is
// `not_applicable` and zero bars are replayed — each pair's next bar supersedes
// what was missed. The declaration is recorded (getLastResume) and is NOT a bar:
// it never reaches onBar, never touches per-key delivery state, and so never
// moves `delivering` or the single developing-bar writer. The existing
// onReconnect gap-backfill is unchanged.

import { registerRecoveryStream } from './recoveryRegistry'
import { REBUILD_GATHER_MS } from './streamRebuildDelay'
import { STREAM_RECONNECT_CAP_MS, LIVE_CANDLE_CADENCE_MS, liveCandleCadenceMs } from '../utils/streamStatus'

export const MAX_BARS_PAIRS = 50   // mirror of api/routers/stream.py MAX_BARS_PAIRS
// ⭐ THE ROWS AHEAD (2026-11-25). A watchlist puts the next 1-2 rows the member is moving towards on this stream
// (`subscribe(..., { ahead: true })`, data/barStore/prefetch.createNeighborHold `live`), so the first press after a minute
// roll finds that row's copy as current as the chart on screen. They are SPECULATIVE pairs:
//   * on the wire as `ahead=` beside `bars=`, so the server can admit them within its own budget and shed them first under
//     load (api/routers/stream.py, STREAM_MAX_AHEAD_PAIRS); a server that does not know `ahead=` subscribes none of them;
//   * they ride the connections the charts already open and only fill the room those leave (the 50-pair cap counts both):
//     ahead pairs alone open NO connection, and never a second one;
//   * at most AHEAD_MAX_PAIRS per page, the oldest subscriptions first;
//   * a pair any ordinary subscriber (a chart) holds is an ordinary pair.
export const AHEAD_MAX_PAIRS = 4
// Stream protocol opt-in. v2 = the server may send a `final: true` correction whose `t`
// is OLDER than the pair's developing bar (a late AM correction of the just-closed
// bucket). Every consumer of this pool handles that: the chart's push writer replaces
// the closed bar in place; the tf='1' price/legend consumers ignore older-t frames;
// and the pool itself drops NON-final older-t frames (see the 'bar' handler).
export const BARS_STREAM_PROTOCOL = '2'
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
const _subscribers = new Map()  // id -> { sym, tf, key, ahead, onBar, onReconnect, onStatus }
let _buckets = []               // [{ key, pairs:Set<string>, ahead:Set<string>, es, connected, retryDelay, reconnectTimer, lastMsg, lastEventId }]
// 'SYM:TF' -> { everDelivered:boolean, lastBarAt:number, lastBarT:number, liveSince:number|null, rejoin?:boolean, rejoinT?:number }
// `liveSince`: when the pair started delivering WITHOUT A BREAK (its first developing frame since the last break). A break
// is an error or a silent death of its connection, the server's vendor-down word, a recovery reconnect, the delivery going
// stale, the pair dropping off every connection, or its last subscriber leaving.
// ⛔ A REBUILD IS A BREAK UNLESS IT FELL INSIDE ONE BUCKET (review of #2721, 1-A). A browser's new connection gets ONE frame
// per pair, the bucket of the symbol's newest trade (api/services/bar_broadcaster.py `subscribe`); the recent-finals replay
// (`snapshot_bars`) is the ingest feed's, never a browser's. So when a roll falls inside the gap, the closed bucket's final
// (and its last trades) never arrive on this connection. At the teardown each pair notes the bucket of its last frame
// (`rejoinT`); the new connection's first frame for the pair keeps `liveSince` only when it is that SAME bucket, and a
// later bucket breaks it (getStatus reports null until that first frame decides).
const _keyState = new Map()
let _lastResume = null          // the newest `event: resume` declaration, with its bucket key
let _rebuildTimer = null
let _lastActivityAt = -Infinity   // the last subscription change or reconnect (streamRebuildDelay.js)
let _gathering = false            // the pending reconnect is a quiet pool's REBUILD_GATHER_MS wait
let _watchdogTimer = null
// ⭐ KEEP THE EDGE ENTITLEMENT FRESH WHILE A LIVE CHART IS OPEN (2026-11-17, stream-edge).
// `/api/stream/bars` may be served by stream-edge, which admits a member by the signed
// `uct_chart_edge` cookie (15-min TTL) that only `/api/auth/me` re-mints. The app calls /me at
// boot and on tab focus, not on a timer, so a chart left in the foreground would reconnect with an
// expired cookie and be quietly served by web instead. One tiny GET every 10 min while any stream
// is open re-mints it (the response body is ignored; the Set-Cookie is the point).
export const EDGE_REFRESH_MS = 10 * 60 * 1000
let _edgeRefreshTimer = null
function _edgeRefresh() {
  try { fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' }).catch(() => {}) } catch { /* no fetch */ }
}

// Coalesce developing-bar dispatch to the live CANDLE cadence (LIVE_CANDLE_CADENCE_MS: 250 ms since
// 2026-11-17, was 500), the same hold realtimeCandle uses, so the candle and its price label move
// together instead of repainting on every sub-second update. A bucket BOUNDARY (a new bar time for a
// key) flushes that key's prior-bucket final bar IMMEDIATELY, so a bar's closing value is never
// coalesced away.
const BAR_THROTTLE_MS = LIVE_CANDLE_CADENCE_MS
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

// Session (RTH / ETH) only changes 60m bucket alignment server-side (RTH = 9:30-aligned,
// ETH = clock hours; 1-30m are identical), and the server takes it PER CONNECTION
// (`?session=`). So a 60m ETH subscription is its own key ('SYM:60@eth') and rides a
// separate ETH connection; everything else normalizes to RTH so pooling isn't fragmented.
function _normSession(tf, session) {
  return String(tf) === '60' && String(session || '').toLowerCase() === 'eth' ? 'eth' : 'rth'
}

function _pairKey(sym, tf, session = 'rth') {
  const base = `${String(sym).toUpperCase()}:${String(tf)}`
  return _normSession(tf, session) === 'eth' ? `${base}@eth` : base
}

function _keySession(key) { return key.endsWith('@eth') ? 'eth' : 'rth' }
function _wirePair(key) { return key.endsWith('@eth') ? key.slice(0, -4) : key }

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
 * @param {{onBar?:(data)=>void, onReconnect?:(lastBarT)=>void, onStatus?:()=>void, session?:'rth'|'eth'}} cbs
 *   session — the chart's session mode; only affects 60m (see _normSession)
 * @returns {() => void} unsubscribe
 */
export function subscribe(sym, tf, { onBar, onReconnect, onStatus, session, ahead = false } = {}) {
  const id = _nextId++
  _subscribers.set(id, { sym: String(sym).toUpperCase(), tf: String(tf), key: _pairKey(sym, tf, session), ahead: ahead === true, onBar, onReconnect, onStatus })
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
export function getStatus(sym, tf, session) {
  const key = _pairKey(sym, tf, session)
  if (_killed()) return { connected: false, healthy: false, delivering: false, liveSince: null }
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
  // VENDOR DOWN (2026-11-18): the server said the Massive socket behind this stream is down
  // (`event: status` {live:false}, stream.py). No bar will come, so stop waiting out the
  // hysteresis: not delivering NOW, and the Finnhub tick writers move the candle meanwhile.
  const recent = ks ? Date.now() - ks.lastBarAt : Infinity
  const wasDelivering = !!(ks && ks.delivering)
  const fresh = recent < (wasDelivering ? BARS_LIVE_DISENGAGE_MS : BARS_LIVE_STALE_MS)
  const delivering = connected && !bucket.vendorDown && !!(ks && ks.everDelivered) && fresh
  if (ks) ks.delivering = delivering   // persist for next call's hysteresis
  if (ks && !fresh) ks.liveSince = null   // gone stale: a break
  // `liveSince` (2026-11-25): when this pair started delivering without a break (see _keyState); null while not delivering
  // and while a rebuilt connection's first frame for it has not decided whether delivery continued (`rejoin`).
  // `lastBarT`: the bucket start (ms) of the newest frame the stream delivered for it (prefetch: a bucket with no frame).
  const live = delivering && ks && !ks.rejoin && Number.isFinite(ks.liveSince)
  return { connected, healthy, delivering, liveSince: live ? ks.liveSince : null, lastBarT: live && Number.isFinite(ks.lastBarT) ? ks.lastBarT : null }
}

/** A break in the pairs' delivery: their `liveSince` starts again at their next developing frame. */
function _breakLive(pairs) {
  for (const k of pairs) { const ks = _keyState.get(k); if (ks) { ks.liveSince = null; ks.rejoin = false } }
}

/** The newest resume declaration the server sent (or null): what it said, which
 *  bucket received it, and when. Diagnostics only — see the header comment. */
export function getLastResume() {
  return _lastResume
}

/** The pairs to stream: { pairs: the ordinary ones, sorted; ahead: the rows ahead no chart holds, oldest first, capped }. */
function _union() {
  if (_killed()) return { pairs: [], ahead: [] }
  const set = new Set()
  for (const sub of _subscribers.values()) if (!sub.ahead) set.add(sub.key)
  const ahead = []
  for (const sub of _subscribers.values()) {
    if (sub.ahead && !set.has(sub.key) && !ahead.includes(sub.key) && ahead.length < AHEAD_MAX_PAIRS) ahead.push(sub.key)
  }
  return { pairs: [...set].sort(), ahead }
}

function _scheduleRebuild() {
  const t = Date.now()
  // gather while a gather is pending, or on a quiet pool; otherwise the full debounce from this change
  _gathering = (!!_rebuildTimer && _gathering) || t - _lastActivityAt >= REBUILD_DEBOUNCE_MS
  _lastActivityAt = t
  if (_rebuildTimer) clearTimeout(_rebuildTimer)
  _rebuildTimer = setTimeout(_rebuild, _gathering ? REBUILD_GATHER_MS : REBUILD_DEBOUNCE_MS)
}

function _rebuild() {
  _rebuildTimer = null
  _lastActivityAt = Date.now()
  _gathering = false
  const union = _union()
  const chunks = []
  for (const sess of ['rth', 'eth']) {
    const part = union.pairs.filter(k => _keySession(k) === sess)
    const mine = []
    for (let i = 0; i < part.length; i += MAX_BARS_PAIRS) mine.push({ pairs: part.slice(i, i + MAX_BARS_PAIRS), ahead: [] })
    // the rows ahead fill the room the charts' connections leave, never a connection of their own
    const ahead = union.ahead.filter(k => _keySession(k) === sess)
    for (const c of mine) while (ahead.length && c.pairs.length + c.ahead.length < MAX_BARS_PAIRS) c.ahead.push(ahead.shift())
    chunks.push(...mine)
  }

  const existingByKey = new Map(_buckets.map(b => [b.key, b]))
  const next = []
  for (const chunk of chunks) {
    const key = chunk.ahead.length ? `${chunk.pairs.join(',')}|${chunk.ahead.join(',')}` : chunk.pairs.join(',')
    const existing = existingByKey.get(key)
    if (existing) { existingByKey.delete(key); next.push(existing); continue }
    const bucket = {
      key, pairs: new Set([...chunk.pairs, ...chunk.ahead]), ahead: new Set(chunk.ahead), session: _keySession(chunk.pairs[0]), es: null, connected: false,
      vendorDown: false,   // the server's `event: status` {live:false}; see getStatus
      retryDelay: INITIAL_RETRY_MS, reconnectTimer: null, lastMsg: Date.now(),
      lastEventId: null,   // a NEW subscription presents no id — it is not a resume
    }
    next.push(bucket)
    _connectBucket(bucket)
  }
  // (review of #2721, 1-A) a pair whose connection is torn down: carried on by a new connection, it notes the bucket of its
  // last frame (decided by its first frame there: see _keyState); carried by none (it dropped off), its delivery breaks
  const carried = new Set()
  for (const b of next) for (const k of b.pairs) carried.add(k)
  for (const stale of existingByKey.values()) {
    for (const k of stale.pairs) {
      const ks = _keyState.get(k)
      if (!ks) continue
      if (carried.has(k)) { ks.rejoin = true; ks.rejoinT = Number.isFinite(ks.lastBarT) ? ks.lastBarT : null } else { ks.liveSince = null; ks.rejoin = false }
    }
    _teardownBucket(stale)
  }
  _buckets = next

  if (_buckets.length > 0 && !_watchdogTimer) {
    _watchdogTimer = setInterval(_watchdogSweep, BARS_WATCHDOG_TICK_MS)
  } else if (_buckets.length === 0 && _watchdogTimer) {
    clearInterval(_watchdogTimer); _watchdogTimer = null
  }
  if (_buckets.length > 0 && !_edgeRefreshTimer) {
    _edgeRefreshTimer = setInterval(_edgeRefresh, EDGE_REFRESH_MS)
  } else if (_buckets.length === 0 && _edgeRefreshTimer) {
    clearInterval(_edgeRefreshTimer); _edgeRefreshTimer = null
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
  const resumeParam = bucket.lastEventId
    ? `&last_event_id=${encodeURIComponent(bucket.lastEventId)}` : ''
  const aheadSet = bucket.ahead || new Set()
  const wire = [...bucket.pairs].filter(k => !aheadSet.has(k)).map(_wirePair).join(',')
  const aheadParam = aheadSet.size ? `&ahead=${[...aheadSet].map(_wirePair).join(',')}` : ''
  const sessionParam = bucket.session === 'eth' ? '&session=eth' : ''
  const es = new EventSource(`/api/stream/bars?bars=${wire}${aheadParam}&v=${BARS_STREAM_PROTOCOL}${sessionParam}${resumeParam}`)
  bucket.es = es
  bucket.lastMsg = Date.now()
  bucket.vendorDown = false   // a new connection hears the server's word again at its start

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
    touch(event)
    try {
      const data = JSON.parse(event.data)   // {sym, tf, bar:{t,o,h,l,c,v}}
      if (!data || !data.sym || data.tf == null) return
      const key = _pairKey(data.sym, data.tf, bucket.session)
      // Per-key delivery state (drives `delivering`).
      const wasDelivering = !!_keyState.get(key)?.everDelivered
      const ks = _keyState.get(key) || {}
      // ⛔ ONLY A DEVELOPING (non-final) FRAME MAKES THE PUSH FEED "DELIVERING" (2026-11-17).
      // On subscribe the server sends the last ~15 min of closed FINALS at once but may hold the
      // current bucket back (a new symbol's partial bar waits for its first seed, up to 3 s). A
      // final is a past bucket, not the live candle: counting it flipped `delivering` on, the
      // tick fallback (barStore liveFeed, the legacy writers) went silent, and nothing opened the
      // current minute until the held bar arrived. Measured in production: every 1m chart opened
      // on the PREVIOUS minute for 2-6+ s after a ticker switch. Set below, AFTER the straggler
      // drop: a discarded late frame is not a live candle either.
      const _developingFrame = !(data.bar && data.bar.final === true)
      ks.lastBarAt = Date.now()
      // Per-key t ordering: a NON-final frame older than the newest bar seen is a
      // straggler (reordered delivery) — drop it so no consumer is moved backwards. An
      // older-t FINAL frame is an authoritative correction and is dispatched.
      const _t = data.bar && Number.isFinite(data.bar.t) ? data.bar.t : null
      if (_t != null && Number.isFinite(ks.lastBarT) && _t < ks.lastBarT && data.bar.final !== true) {
        _keyState.set(key, ks)
        if (!wasDelivering) _notifyStatusForKey(key)
        return
      }
      // (review of #2721, 1-A) the first frame after a rebuild decides: the same bucket as the last one before it keeps
      // the pair's delivery unbroken; a later bucket means a roll fell inside the gap (an older final waits for the next)
      if (ks.rejoin && !(_t != null && Number.isFinite(ks.rejoinT) && _t < ks.rejoinT)) {
        ks.rejoin = false
        if (!(_t != null && Number.isFinite(ks.rejoinT) && _t === ks.rejoinT)) ks.liveSince = null
      }
      if (_t != null && !(Number.isFinite(ks.lastBarT) && ks.lastBarT > _t)) ks.lastBarT = _t
      if (_developingFrame) ks.everDelivered = true
      if (_developingFrame && !Number.isFinite(ks.liveSince)) ks.liveSince = Date.now()
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
      // A server FINAL bar (optional `final: true`) is the closed bucket's truth — dispatch
      // it at once instead of letting a following developing frame for the next bucket (or
      // a straggler for the same one) coalesce it away inside the 500ms window.
      if (data.bar && data.bar.final === true) {
        _pendingBar.delete(key)
        _dispatchBar(key, data)
        if (!wasDelivering) _notifyStatusForKey(key)
        return
      }
      _pendingBar.set(key, data)
      if (!_barThrottleTimer) _barThrottleTimer = setTimeout(_flushPendingBars, liveCandleCadenceMs(BAR_THROTTLE_MS))
      if (!wasDelivering) _notifyStatusForKey(key)  // first bar → status flip
    } catch { /* malformed frame */ }
  })

  // Named heartbeat (see stream.py) — keeps lastMsg fresh during quiet periods so
  // the watchdog doesn't false-reconnect a healthy-but-idle connection.
  es.addEventListener('heartbeat', (event) => { if (bucket.es === es) touch(event) })

  // The server's word on the vendor socket behind this stream (stream.py, `event: status`
  // {live}), sent at the start and on every change. Only a change re-notifies.
  es.addEventListener('status', (event) => {
    if (bucket.es !== es) return
    touch(event)
    let down
    try { down = JSON.parse(event.data)?.live === false } catch { return }
    if (down === bucket.vendorDown) return
    bucket.vendorDown = down
    if (down) _breakLive(bucket.pairs)
    for (const sub of _subscribers.values()) if (bucket.pairs.has(sub.key)) _notifyStatus(sub)
  })

  es.onerror = () => {
    if (bucket.es !== es) return  // a rebuild/watchdog already replaced this connection
    try { es.close() } catch { /* ignore */ }
    bucket.es = null
    bucket.connected = false
    _breakLive(bucket.pairs)
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
      _breakLive(bucket.pairs)
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

// ── recovery (lib/recovery.js) ──────────────────────────────────────────────
// After a wake or a network return, recovery reconnects every bucket at once instead of waiting for
// the silence watchdog or a backoff that may already be at its cap, and waits on isConnected().

/** Tear down and reopen every connection now, with the backoff reset. */
export function reconnectNow() {
  for (const bucket of _buckets) {
    _teardownBucket(bucket)
    _breakLive(bucket.pairs)   // a wake or a network return: whatever the pairs carried meanwhile is lost
    bucket.retryDelay = INITIAL_RETRY_MS
    _connectBucket(bucket)
  }
  if (_buckets.length) _notifyAllStatus()
}

/** True when every open bucket is connected, or there is nothing to connect. */
export function isConnected() {
  return _buckets.every((b) => b.connected)
}

registerRecoveryStream({ name: 'bars', reconnectNow, isConnected })

// ── test hooks ──────────────────────────────────────────────────────────────

export function _resetForTests() {
  if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null }
  _lastActivityAt = -Infinity
  _gathering = false
  if (_watchdogTimer) { clearInterval(_watchdogTimer); _watchdogTimer = null }
  if (_edgeRefreshTimer) { clearInterval(_edgeRefreshTimer); _edgeRefreshTimer = null }
  if (_barThrottleTimer) { clearTimeout(_barThrottleTimer); _barThrottleTimer = null }
  _pendingBar.clear()
  for (const b of _buckets) _teardownBucket(b)
  _buckets = []
  _subscribers.clear()
  _keyState.clear()
  _lastResume = null
  _nextId = 1
}

export function _getBuckets() { return _buckets }
export function _flushRebuild() { if (_rebuildTimer) { clearTimeout(_rebuildTimer); _rebuildTimer = null } _rebuild() }
// Test hook: dispatch any bars buffered by the 500ms throttle right now.
export function _flushBars() { if (_barThrottleTimer) { clearTimeout(_barThrottleTimer); _barThrottleTimer = null } _flushPendingBars() }
