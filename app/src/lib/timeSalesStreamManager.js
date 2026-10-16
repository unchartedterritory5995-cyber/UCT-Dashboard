// app/src/lib/timeSalesStreamManager.js
//
// TAS (COV-08 / FT-077): the Time & Sales tape's ONE client pool (TERM-024: a panel gets a handle,
// never a URL). Before this, `pages/terminal/panels/TimeSalesPanel.jsx` opened its own
// EventSource per open panel, and `lib/panelContract.rail.test.js` refused it by name.
//
// One entry per ticker, shared by every subscriber (two TAS panels on NVDA = ONE stream on
// `/api/stream/time-and-sales/NVDA`, api/routers/time_and_sales.py). Each subscriber receives the
// entry's whole state `{ status, prints (newest first), session, reason, lastAt, sym }`.
//
//   ⛔ EVERY MESSAGE MATTERS. A pushed batch is merged into the entry's prints (deduplicated by
//      `seq`, capped at TAS_CAP) and none is dropped; the `snapshot` the server sends on every
//      open replaces the list.
//   ⛔ ONLY WHILE IT CAN BE SEEN. While the browser tab is hidden every entry's stream is closed
//      (status `paused`, rows kept); on return each is reopened and the snapshot refills it.
//   ⛔ CLOSED vs CONNECTING. An error with readyState 2 (CLOSED) is the server refusing outright
//      (signed out, not paid, 4xx): the browser will not retry, so the status is `dropped` if this
//      open had heard the server and `failed` if it never had. Any other error is a dropped stream
//      the browser is already reopening: `reconnecting`.
//   ⛔ `unavailable` IS FINAL for this open (flag off, caps): the stream is closed, no reconnect
//      loop. Only Retry, a tab return, or a fresh subscribe after the last one left reopens it.
//   The last unsubscribe closes the stream and forgets the entry.

import { TAS_CAP, fromSnapshot, mergePrints } from '../pages/terminal/panels/timeSalesModel'

export const tasStreamUrl = (sym) => `/api/stream/time-and-sales/${encodeURIComponent(sym)}`

export const EMPTY_TAPE = Object.freeze({
  status: 'connecting', prints: Object.freeze([]), session: null, reason: null, lastAt: null,
})

const _entries = new Map()
let _hidden = false
let _listening = false

function pageHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function publish(entry, next) {
  entry.state = typeof next === 'function' ? next(entry.state) : next
  for (const fn of [...entry.listeners]) fn(entry.state)
}

/** Close this entry's open stream (if any). Its handlers go inert: they check `entry.conn`. */
function shut(entry) {
  const conn = entry.conn
  entry.conn = null
  if (conn) { conn.closed = true; conn.es.close() }
}

const readData = (e) => { try { return JSON.parse(e.data) } catch { return null } }
const stamp = () => new Date().toISOString()

/** (Re)open the entry's stream: closes any open one first. */
function open(entry) {
  shut(entry)
  const { sym } = entry
  if (pageHidden()) {
    publish(entry, (s) => ({ ...s, status: s.status === 'unavailable' ? s.status : 'paused' }))
    return
  }
  if (typeof EventSource === 'undefined') {
    publish(entry, (s) => ({ ...s, status: 'failed' }))
    return
  }
  // A new ticker starts empty; the same ticker (tab shown again, Retry) keeps its rows on screen
  // until the snapshot replaces them.
  publish(entry, (s) => (s.sym === sym && s.prints.length
    ? { ...s, status: 'reconnecting', reason: null }
    : { status: 'connecting', prints: [], session: null, reason: null, lastAt: null, sym }))
  const es = new EventSource(tasStreamUrl(sym))
  const conn = { es, heard: false, closed: false }
  entry.conn = conn
  const live = () => entry.conn === conn && !conn.closed

  es.addEventListener('snapshot', (e) => {
    if (!live()) return
    const d = readData(e)
    if (!d) return
    conn.heard = true
    publish(entry, { status: 'live', prints: fromSnapshot(d.prints, TAS_CAP), session: d.session || null, reason: null, lastAt: stamp(), sym })
  })
  es.onmessage = (e) => {
    if (!live()) return
    const d = readData(e)
    if (!d) return
    conn.heard = true
    publish(entry, (s) => ({ ...s, status: 'live', prints: mergePrints(s.prints, d.prints, TAS_CAP), session: d.session || s.session, lastAt: stamp() }))
  }
  es.addEventListener('heartbeat', (e) => {
    if (!live()) return
    const d = readData(e)
    conn.heard = true
    publish(entry, (s) => ({ ...s, status: 'live', session: d?.session || s.session }))
  })
  es.addEventListener('unavailable', (e) => {
    if (!live()) return
    const d = readData(e)
    shut(entry)   // a refusal is final for this open: no automatic reconnect loop
    publish(entry, (s) => ({ ...s, status: 'unavailable', reason: d?.reason || null }))
  })
  es.onerror = () => {
    if (!live()) return
    if (es.readyState === 2) {
      conn.closed = true   // the browser will not retry; Retry or a tab return reopens
      publish(entry, (s) => ({ ...s, status: conn.heard ? 'dropped' : 'failed' }))
    } else {
      publish(entry, (s) => ({ ...s, status: 'reconnecting' }))
    }
  }
}

function onVisibility() {
  const hidden = pageHidden()
  if (hidden === _hidden) return
  _hidden = hidden
  for (const entry of [..._entries.values()]) {
    if (hidden) {
      shut(entry)
      publish(entry, (s) => ({ ...s, status: s.status === 'unavailable' ? s.status : 'paused' }))
    } else {
      open(entry)
    }
  }
}

function listen(on) {
  if (typeof document === 'undefined' || on === _listening) return
  _listening = on
  if (on) {
    _hidden = pageHidden()
    document.addEventListener('visibilitychange', onVisibility)
  } else {
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/** Subscribe to one ticker's tape. `onState` receives the entry's state on every change (and at
 *  once). Returns the unsubscribe. */
export function subscribe(sym, onState) {
  let entry = _entries.get(sym)
  const fresh = !entry
  if (fresh) {
    entry = { sym, state: EMPTY_TAPE, listeners: new Set(), conn: null }
    _entries.set(sym, entry)
    listen(true)
  }
  entry.listeners.add(onState)
  if (fresh) open(entry)
  else onState(entry.state)
  return () => {
    entry.listeners.delete(onState)
    if (entry.listeners.size) return
    shut(entry)
    if (_entries.get(sym) === entry) _entries.delete(sym)
    if (!_entries.size) listen(false)
  }
}

/** Reopen one ticker's stream (the Retry button). A no-op when nobody holds it. */
export function retry(sym) {
  const entry = _entries.get(sym)
  if (entry) open(entry)
}

/** The state of one ticker's tape right now (EMPTY_TAPE when nobody holds it). */
export function getSnapshot(sym) {
  return _entries.get(sym)?.state || EMPTY_TAPE
}

export function _resetForTests() {
  for (const e of _entries.values()) shut(e)
  _entries.clear()
  listen(false)
}
