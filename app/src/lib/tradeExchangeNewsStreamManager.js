// app/src/lib/tradeExchangeNewsStreamManager.js
//
// Trade Exchange News — the ONE client pool (TERM-024: a panel gets a handle via
// `panelContract.declareNeed({ kind: 'trade-exchange-news', ... })`, never a URL).
// Every News widget in the browser shares ONE history load and ONE EventSource on
// `/api/trade-exchange-news/stream` (api/routers/trade_exchange_news.py).
//
//   ⛔ EVERY MESSAGE MATTERS. Headlines are kept in `seq` order (the server's single
//      writer assigns it at commit; it is contiguous within an `epoch`). A headline
//      whose seq is not last+1 means something was missed: the stream is reopened
//      from the last seq and the server replays the hole — never papered over.
//   ⛔ EPOCH. A different epoch (database recreated) discards the cursor and reloads
//      history; a stale cursor is never read as "caught up".
//   ⭐ RESUME. The server stamps `id: <epoch>:<seq>` on every headline, so the
//      browser's own reconnect sends Last-Event-ID; a reopen built here passes
//      `?after=<seq>&epoch=<epoch>` (a new EventSource cannot set the header).
//   ⭐ BOUNDED. The pool holds at most MAX_ITEMS headlines (newest kept): the live
//      edge. History is browsed one America/New_York calendar day at a time, which
//      the SERVER filters and serves in cursor steps (`fetchDay` -> POST /day,
//      `fetchDays` -> GET /days; api/services/trade_exchange_news/archive.py) --
//      the archive is never downloaded to the browser.
//   The last unsubscribe closes the stream and forgets the state.
//
// State: { status, items (seq ascending), epoch, lastSeq, firstSeq, coverage,
//          reason, lastEventAt, lastHeadlineAt, provisional,
//          replayUntil, lastLatencyMs, lastLatencyAt }
//   replayUntil: the server's last seq when this connection opened -- lastSeq below
//                it means the reconnect backlog is still replaying (feed health).
//   lastLatencyMs: the newest MEASURED receipt -> this screen time (reportTiming's
//                  e2e sample, only when the clock sync was trustworthy), else null.
//   status: connecting | live | reconnecting | dropped | failed | unavailable

export const RECENT_URL = '/api/trade-exchange-news/recent'
export const STREAM_URL = '/api/trade-exchange-news/stream'
export const DAY_URL = '/api/trade-exchange-news/day'
export const DAYS_URL = '/api/trade-exchange-news/days'
export const MAX_ITEMS = 1000
export const PAGE = 200
const RETRY_MIN = 1000
const RETRY_MAX = 15000
// Server heartbeats every 10 s; two missed ones and the connection is presumed dead
// and the status says so (measured: a dead upstream can leave the socket open, so
// without this a widget could keep saying Live through an outage).
const WATCHDOG_MS = 22000

export const EMPTY_NEWS = Object.freeze({
  status: 'idle', items: Object.freeze([]), epoch: null, lastSeq: 0, firstSeq: 0,
  coverage: null, reason: null, lastEventAt: null, lastHeadlineAt: null,
  provisional: true,
  replayUntil: 0, lastLatencyMs: null, lastLatencyAt: null,
})

let _state = EMPTY_NEWS
const _listeners = new Set()
let _conn = null
let _retry = RETRY_MIN
let _retryTimer = null
let _watchdog = null
let _gen = 0                 // bumps on every (re)start so stale async work goes inert
const _sounded = new Set()   // seqs already announced (sound dedupe across widgets)

function publish(next) {
  _state = Object.freeze(typeof next === 'function' ? next(_state) : next)
  for (const fn of [..._listeners]) fn(_state)
}

const readData = (e) => { try { return JSON.parse(e.data) } catch { return null } }

function clearTimers() {
  if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null }
  if (_watchdog) { clearTimeout(_watchdog); _watchdog = null }
}

function shut() {
  clearTimers()
  const c = _conn
  _conn = null
  if (c) { c.closed = true; c.es.close() }
}

function armWatchdog() {
  if (_watchdog) clearTimeout(_watchdog)
  _watchdog = setTimeout(() => {
    if (!_conn) return
    shut()
    publish((s) => ({ ...s, status: 'reconnecting' }))
    scheduleReopen()
  }, WATCHDOG_MS)
}

function scheduleReopen() {
  if (_retryTimer || !_listeners.size) return
  const gen = _gen
  _retryTimer = setTimeout(() => {
    _retryTimer = null
    if (gen === _gen && _listeners.size) openStream()
  }, _retry)
  _retry = Math.min(RETRY_MAX, _retry * 2)
}

/** Merge headline rows (any order) into seq-ascending items, at most MAX_ITEMS;
 *  the OLDEST rows are dropped. */
export function mergeItems(items, incoming) {
  if (!incoming?.length) return items
  const bySeq = new Map(items.map((it) => [it.seq, it]))
  for (const it of incoming) bySeq.set(it.seq, { ...(bySeq.get(it.seq) || {}), ...it })
  const out = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  return out.length > MAX_ITEMS ? out.slice(out.length - MAX_ITEMS) : out
}

// ⏱ LATENCY AUDIT (admin-only widget), measurement only. Browser clock vs web
// clock from SEVERAL tiny /clock round trips (the fastest one wins; error <=
// rtt/2, and a best rtt over CLOCK_MAX_RTT_MS is not trusted). A sample counts
// only for a LIVE headline (not a reconnect replay) in a VISIBLE tab that painted
// within RENDER_MAX_MS -- a background tab pauses painting and would report
// minutes. Reports numbers and the event id only.
export const TIMING_URL = '/api/trade-exchange-news/client-timing'
export const CLOCK_URL = '/api/trade-exchange-news/clock'
const CLOCK_SAMPLES = 5
const CLOCK_MAX_RTT_MS = 250
const CLOCK_TTL_MS = 5 * 60_000
const RENDER_MAX_MS = 2000
let _clock = null
let _clockSyncing = null

async function syncClock() {
  if (_clockSyncing) return _clockSyncing
  _clockSyncing = (async () => {
    let best = null
    for (let i = 0; i < CLOCK_SAMPLES; i++) {
      try {
        const sentAt = Date.now()
        const r = await fetch(CLOCK_URL, { credentials: 'include', cache: 'no-store' })
        const gotAt = Date.now()
        const body = r.ok ? await r.json() : null
        if (typeof body?.server_ms !== 'number') continue
        const rtt = gotAt - sentAt
        if (!best || rtt < best.rtt) best = { offset: body.server_ms - (sentAt + gotAt) / 2, rtt }
      } catch { /* best effort */ }
    }
    _clock = best && best.rtt <= CLOCK_MAX_RTT_MS ? { ...best, at: Date.now(), samples: CLOCK_SAMPLES } : null
  })().finally(() => { _clockSyncing = null })
  return _clockSyncing
}

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

function reportTiming(ev, heardAt, heardPerf) {
  if (typeof ev.server_ms !== 'number' || !ev.id || typeof requestAnimationFrame !== 'function') return
  if (!visible()) return
  // The offset does not depend on WHEN it is measured, so a first live headline
  // syncs lazily (no clock traffic until there is news to time) and still counts.
  const clockReady = !_clock || Date.now() - _clock.at > CLOCK_TTL_MS ? syncClock() : Promise.resolve()
  requestAnimationFrame(() => setTimeout(async () => {
    const render = performance.now() - heardPerf
    if (!visible() || render > RENDER_MAX_MS) return          // throttled or hidden: not a sample
    const paintAt = Date.now()
    await clockReady
    const c = _clock
    const body = {
      id: ev.id,
      sse_ms: c ? Math.round(heardAt + c.offset - ev.server_ms) : null,
      render_ms: Math.round(render),
      e2e_ms: c && typeof ev.received_at_ms === 'number' ? Math.round(paintAt + c.offset - ev.received_at_ms) : null,
      clock_rtt_ms: c ? c.rtt : null,
      clock_samples: c ? c.samples : 0,
    }
    // The feed-health popover shows the newest real sample, never an estimate.
    if (typeof body.e2e_ms === 'number' && body.e2e_ms >= 0) {
      publish((s) => ({ ...s, lastLatencyMs: body.e2e_ms, lastLatencyAt: Date.now() }))
    }
    fetch(TIMING_URL, { method: 'POST', credentials: 'include', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
  }, 0))
}

async function fetchJson(url) {
  const r = await fetch(url, { credentials: 'include', cache: 'no-store' })
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`)
    err.status = r.status
    throw err
  }
  return r.json()
}

function refusal(status) {
  if (status === 401) return 'signed_out'
  if (status === 403) return 'admin_only'
  if (status === 404) return 'not_enabled'
  if (status === 503) return 'not_started'
  return 'error'
}

/** Load the newest history page, then open the stream after it. */
async function start() {
  const gen = ++_gen
  shut()
  publish((s) => ({ ...s, status: s.items.length ? 'reconnecting' : 'connecting', reason: null }))
  let body
  try {
    body = await fetchJson(`${RECENT_URL}?limit=${PAGE}`)
  } catch (e) {
    if (gen !== _gen) return
    const final = e.status && e.status !== 503 && e.status < 500
    publish((s) => ({ ...s, status: final ? 'unavailable' : 'reconnecting', reason: refusal(e.status) }))
    if (!final) scheduleReopenStart()
    return
  }
  if (gen !== _gen) return
  const items = mergeItems([], body.items || [])
  publish((s) => ({
    ...s,
    items: s.epoch && s.epoch === body.epoch ? mergeItems(s.items, items) : items,
    epoch: body.epoch, lastSeq: body.last_seq || 0, firstSeq: body.first_seq || 0,
    coverage: body.coverage || null, provisional: body.tickers_provisional !== false,
  }))
  // Everything already on screen at load is history, not news: never announce it.
  for (const it of items) _sounded.add(it.seq)
  openStream()
}

function scheduleReopenStart() {
  if (_retryTimer || !_listeners.size) return
  const gen = _gen
  _retryTimer = setTimeout(() => {
    _retryTimer = null
    if (gen === _gen && _listeners.size) start()
  }, _retry)
  _retry = Math.min(RETRY_MAX, _retry * 2)
}

function openStream() {
  shut()
  if (typeof EventSource === 'undefined') {
    publish((s) => ({ ...s, status: 'failed', reason: 'no_eventsource' }))
    return
  }
  const { lastSeq, epoch } = _state
  const qs = epoch ? `?after=${lastSeq}&epoch=${encodeURIComponent(epoch)}` : ''
  const es = new EventSource(`${STREAM_URL}${qs}`, { withCredentials: true })
  const conn = { es, heard: false, closed: false }
  _conn = conn
  const live = () => _conn === conn && !conn.closed
  const heard = () => {
    conn.heard = true
    _retry = RETRY_MIN
    armWatchdog()
  }

  es.addEventListener('hello', (e) => {
    if (!live()) return
    const d = readData(e) || {}
    heard()
    if (d.reset) {          // epoch changed under us: the cursor means nothing now
      start()
      return
    }
    conn.replayUntil = typeof d.last_seq === 'number' ? d.last_seq : 0   // backlog, not live news
    conn.timing = d.timing === true          // the latency audit: only the browsers the server asks
    publish((s) => ({ ...s, status: 'live', reason: null, coverage: d.coverage || s.coverage,
      truncated: !!d.truncated, lastEventAt: Date.now(), replayUntil: conn.replayUntil }))
  })
  es.addEventListener('headline', (e) => {
    if (!live()) return
    const ev = readData(e)
    if (!ev) return
    heard()
    const s = _state
    if (s.epoch && ev.epoch && ev.epoch !== s.epoch) { start(); return }
    if (ev.seq <= s.lastSeq) return                       // replay overlap
    if (s.lastSeq && ev.seq !== s.lastSeq + 1) {          // a hole: replay it
      openStream()
      return
    }
    const heardAt = Date.now()
    const heardPerf = performance.now()
    publish((st) => ({ ...st, status: 'live', items: mergeItems(st.items, [ev]), lastSeq: ev.seq,
      lastEventAt: Date.now(), lastHeadlineAt: Date.now() }))
    if (conn.timing && ev.seq > (conn.replayUntil || 0)) reportTiming(ev, heardAt, heardPerf)
  })
  es.addEventListener('repeat', (e) => {
    if (!live()) return
    const ev = readData(e)
    if (!ev) return
    heard()
    publish((st) => ({ ...st, lastEventAt: Date.now(),
      items: st.items.map((it) => (it.seq === ev.seq ? { ...it, repeat_count: ev.repeat_count } : it)) }))
  })
  es.addEventListener('heartbeat', () => {
    if (!live()) return
    heard()
    publish((st) => ({ ...st, status: 'live', lastEventAt: Date.now() }))
  })
  es.onerror = () => {
    if (!live()) return
    if (es.readyState === 2) {
      // The server refused (401/403/404/503) or the browser gave up: decide
      // from a fresh history read whether to retry or stop.
      shut()
      publish((st) => ({ ...st, status: conn.heard ? 'dropped' : 'reconnecting' }))
      scheduleReopenStart()
    } else {
      publish((st) => ({ ...st, status: 'reconnecting' }))
    }
  }
}

/** Subscribe to the shared feed. `onState` receives the whole state now and on every
 *  change. Returns the unsubscribe. */
export function subscribe(onState) {
  const first = !_listeners.size
  _listeners.add(onState)
  if (first) start()
  else onState(_state)
  return () => {
    _listeners.delete(onState)
    if (_listeners.size) return
    _gen++
    shut()
    _state = EMPTY_NEWS
    _sounded.clear()
    _retry = RETRY_MIN
  }
}

export function getSnapshot() {
  return _state
}

/** Reopen from scratch (the Retry button). */
export function retry() {
  if (_listeners.size) { _retry = RETRY_MIN; start() }
}

/** A slice of one ET calendar day, filtered by the SERVER over the whole day:
 *  the newest, a time of day (`at`), or a keyset step from `cursor` (`direction`
 *  older | newer). Rows on it are history: never announced. Rejects with
 *  `err.status` on a refusal. */
export async function fetchDay(body) {
  const r = await fetch(DAY_URL, {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  })
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`)
    err.status = r.status
    throw err
  }
  const out = await r.json()
  for (const it of out.items || []) _sounded.add(it.seq)
  return out
}

/** Retained headline counts per ET date and where retention begins (the calendar). */
export function fetchDays() {
  return fetchJson(DAYS_URL)
}

/** True exactly once per headline across every widget in this browser — the
 *  sound/notification dedupe (two News widgets never chime twice for one headline). */
export function claimAnnouncement(seq) {
  if (_sounded.has(seq)) return false
  _sounded.add(seq)
  if (_sounded.size > MAX_ITEMS * 2) {
    const keep = [..._sounded].slice(-MAX_ITEMS)
    _sounded.clear()
    for (const k of keep) _sounded.add(k)
  }
  return true
}

export function _resetForTests() {
  _clock = null
  _clockSyncing = null
  _gen++
  shut()
  _listeners.clear()
  _state = EMPTY_NEWS
  _sounded.clear()
  _retry = RETRY_MIN
}
