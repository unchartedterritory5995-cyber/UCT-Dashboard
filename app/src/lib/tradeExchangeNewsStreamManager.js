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
//   ⭐ BOUNDED. The pool holds at most MAX_ITEMS headlines (newest kept); older pages
//      come from `/recent?before=` on demand (`loadOlder`).
//   The last unsubscribe closes the stream and forgets the state.
//
// State: { status, items (seq ascending), epoch, lastSeq, firstSeq, coverage,
//          reason, lastEventAt, lastHeadlineAt, hasOlder, loadingOlder, provisional }
//   status: connecting | live | reconnecting | dropped | failed | unavailable

export const RECENT_URL = '/api/trade-exchange-news/recent'
export const STREAM_URL = '/api/trade-exchange-news/stream'
export const MAX_ITEMS = 1000
// Loading older pages may grow the held history past MAX_ITEMS, up to this.
export const HARD_MAX = 2000
export const PAGE = 200
const RETRY_MIN = 1000
const RETRY_MAX = 15000
// Server heartbeats every 15 s; two missed ones and the connection is presumed dead.
const WATCHDOG_MS = 35000

export const EMPTY_NEWS = Object.freeze({
  status: 'idle', items: Object.freeze([]), epoch: null, lastSeq: 0, firstSeq: 0,
  coverage: null, reason: null, lastEventAt: null, lastHeadlineAt: null,
  hasOlder: false, loadingOlder: false, provisional: true,
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

/** Merge headline rows (any order) into seq-ascending items. Never shrinks a list
 *  the member grew with "Load older" (up to HARD_MAX); the OLDEST rows are dropped. */
export function mergeItems(items, incoming) {
  if (!incoming?.length) return items
  const bySeq = new Map(items.map((it) => [it.seq, it]))
  for (const it of incoming) bySeq.set(it.seq, { ...(bySeq.get(it.seq) || {}), ...it })
  const out = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  const cap = Math.min(HARD_MAX, Math.max(MAX_ITEMS, items.length))
  return out.length > cap ? out.slice(out.length - cap) : out
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
    hasOlder: (items[0]?.seq || 0) > (body.first_seq || 0),
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
    publish((s) => ({ ...s, status: 'live', reason: null, coverage: d.coverage || s.coverage,
      truncated: !!d.truncated, lastEventAt: Date.now() }))
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
    publish((st) => ({ ...st, status: 'live', items: mergeItems(st.items, [ev]), lastSeq: ev.seq,
      lastEventAt: Date.now(), lastHeadlineAt: Date.now() }))
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

/** Fetch the page before the oldest headline held (bounded history). */
export async function loadOlder() {
  const s = _state
  if (s.loadingOlder || !s.hasOlder || !s.items.length) return
  const gen = _gen
  publish((st) => ({ ...st, loadingOlder: true }))
  try {
    const body = await fetchJson(`${RECENT_URL}?limit=${PAGE}&before=${s.items[0].seq}`)
    if (gen !== _gen) return
    const older = body.items || []
    for (const it of older) _sounded.add(it.seq)
    publish((st) => {
      const merged = [...older, ...st.items].sort((a, b) => a.seq - b.seq)
      const seen = new Set()
      const uniq = merged.filter((it) => (seen.has(it.seq) ? false : (seen.add(it.seq), true)))
      const items = uniq.length > HARD_MAX ? uniq.slice(uniq.length - HARD_MAX) : uniq
      return { ...st, loadingOlder: false, items,
        hasOlder: older.length > 0 && older[0].seq > (body.first_seq || 0) && items.length < HARD_MAX }
    })
  } catch {
    if (gen === _gen) publish((st) => ({ ...st, loadingOlder: false }))
  }
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
  _gen++
  shut()
  _listeners.clear()
  _state = EMPTY_NEWS
  _sounded.clear()
  _retry = RETRY_MIN
}
