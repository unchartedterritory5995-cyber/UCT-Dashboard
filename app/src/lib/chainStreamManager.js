// app/src/lib/chainStreamManager.js
//
// FT-015 / BRK-01: the streamed option chain's ONE client pool (TERM-024: a panel gets a handle,
// never a URL). Before this, `pages/research/tabs/useChainStream.js` opened its own EventSource,
// and `lib/panelContract.rail.test.js` refused it by name (master red, 2026-10-10).
//
// One entry per (underlying, expiration), shared by every subscriber:
//   ⛔ PROBE FIRST. EventSource cannot see a status code, so the pool asks the one-shot read
//      (`chain-quotes`) and opens the stream ONLY on a 200. A 404 (switched off), 402 (free) or
//      any failure leaves the state `on: false`: the chain stays on its own 60 s poll.
//   ⛔ EVERY MESSAGE MATTERS. The stream sends only the contracts that moved, so each message is
//      merged into the entry's quotes and none is dropped; a subscriber reads the merged state.
//   The last unsubscribe closes the stream and forgets the entry.

export const chainQuotesUrl = (sym, exp) => `/api/live/massive/chain-quotes/${encodeURIComponent(sym)}?expiration=${encodeURIComponent(exp)}`
export const chainStreamUrl = (sym, exp) => `/api/live/massive/chain-stream/${encodeURIComponent(sym)}?expiration=${encodeURIComponent(exp)}`

export const EMPTY_CHAIN = Object.freeze({ on: false, quotes: Object.freeze({}), coverage: null })

const _entries = new Map()
const keyOf = (sym, exp) => `${sym}|${exp}`

function publish(entry, next) {
  entry.state = next
  for (const fn of [...entry.listeners]) fn(next)
}

function open(entry, sym, exp) {
  fetch(chainQuotesUrl(sym, exp), { credentials: 'same-origin' })
    .then((r) => (r.status === 200 ? r.json() : null))
    .then((body) => {
      if (entry.dead || !body || typeof body.quotes !== 'object') return
      publish(entry, { on: true, quotes: body.quotes || {}, coverage: body.coverage || null })
      if (typeof EventSource === 'undefined') return
      const es = new EventSource(chainStreamUrl(sym, exp))
      entry.es = es
      es.onmessage = (ev) => {
        let msg
        try { msg = JSON.parse(ev.data) } catch { return }
        if (entry.dead || !msg || typeof msg.quotes !== 'object') return
        const quotes = { ...entry.state.quotes }
        for (const [c, v] of Object.entries(msg.quotes)) quotes[c] = { ...(quotes[c] || {}), ...v }
        publish(entry, { ...entry.state, quotes })
      }
    })
    .catch(() => { /* the chain keeps its poll; `on` stays false, which is the stated outcome */ })
}

/** Subscribe to one chain. `onState` receives the merged `{on, quotes, coverage}` on every change.
 *  Returns the unsubscribe. */
export function subscribe(sym, exp, onState) {
  const key = keyOf(sym, exp)
  let entry = _entries.get(key)
  if (!entry) {
    entry = { state: EMPTY_CHAIN, listeners: new Set(), es: null, dead: false }
    _entries.set(key, entry)
    open(entry, sym, exp)
  }
  entry.listeners.add(onState)
  if (entry.state !== EMPTY_CHAIN) onState(entry.state)
  return () => {
    entry.listeners.delete(onState)
    if (entry.listeners.size) return
    entry.dead = true
    if (entry.es) { entry.es.close(); entry.es = null }
    if (_entries.get(key) === entry) _entries.delete(key)
  }
}

/** The merged state of one chain right now (EMPTY_CHAIN when nobody holds it). */
export function getSnapshot(sym, exp) {
  return _entries.get(keyOf(sym, exp))?.state || EMPTY_CHAIN
}

export function _resetForTests() {
  for (const e of _entries.values()) { e.dead = true; if (e.es) e.es.close() }
  _entries.clear()
}
