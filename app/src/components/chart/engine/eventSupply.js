// app/src/components/chart/engine/eventSupply.js
//
// ─── ⭐⭐ T4 E2 — THE CHART'S OWN CORPORATE EVENTS, ASKED ONCE PER SYMBOL ──────────────────────────────────────
//
// A Pine script's `request.earnings` / `request.dividends` / `request.splits` reads the chart's own symbol's events
// (`pineEvents.js`). They come from ONE door, `GET /api/pine/events/<symbol>` (E1, `api/routers/pine_events.py`), never
// from `/api/bars` (coordinator ruling 2026-11-22 (2)), and this module is the chart's cache of that door's answers:
// one entry per symbol, the same object until it changes (so `useSecondarySources`' identity check sees no change),
// handed to the bind under `pineEvents.EVENTS_KEY`.
//
// What each answer becomes (the entry's `status`, read by `otherSymbols.js::eventDecision`):
//   200 with a document   `available` (`events`: the document; `rev`: its refresh time, so a refreshed copy recomputes)
//   202 `pending`         `pending`: E1 is gathering the symbol; asked again after the door's `Retry-After`, a bounded
//                         number of times, and the reads wait (a load, not a refusal)
//   404 / 401 / 402 / 403 `dark`: the door is not open to this member (`PINE_EVENTS_SUPPLY_ENABLED` unset answers 404 to
//                         every member): a plain named refusal, never an error, and never asked again this session
//   anything else         `error`: refused by name, asked again after `ERROR_RETRY_MS`
//   a switch-abort        forgotten: the next ensure asks again (the chart's fetcher tags it `canceled`)

/** How long a held answer is served before the next ensure asks again (E1's own copy refreshes every 12 hours). */
export const EVENTS_MAX_AGE_MS = 6 * 3600 * 1000
/** How long an errored answer waits before it is asked again. */
export const ERROR_RETRY_MS = 60000
/** A `pending` answer is asked again after the door's `Retry-After` (5 s), at most this many times a symbol. */
export const PENDING_RETRIES = 24
const PENDING_RETRY_MS = 5000
const DARK = new Set([401, 402, 403, 404])

const _statusOf = (err) => {
  const s = err && (err.httpStatus ?? err.status)
  return Number.isInteger(s) ? s : null
}

function _defaultFetch(url) {
  return fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`)
      err.httpStatus = r.status
      throw err
    }
    return r.json()
  })
}

/**
 * ⭐⭐ T4 F1b — ONE CHART-SIDE CACHE PER DATA DOOR, built here so the events door (E2) and the financial door (F1b,
 * `financialSupply.js`) cannot answer differently: `{path, field, maxAgeMs, revOf}` names the door's URL prefix
 * (`/api/pine/events/`), the entry key its document is filed under (`events`), how long an answer is served, and the
 * document's refresh mark (a refreshed copy recomputes). Every rule above holds for each door alike.
 */
export function makeDoorCache({ path, field, maxAgeMs, revOf }) {
  const cache = new Map()        // SYMBOL -> entry
  const inflight = new Map()     // SYMBOL -> promise
  const pendingTries = new Map() // SYMBOL -> how many pending answers in a row
  const timers = new Map()       // SYMBOL -> retry timer
  const subscribers = new Set()

  const urlOf = (symbol) => {
    const s = String(symbol == null ? '' : symbol).trim().toUpperCase()
    return s ? `${path}${encodeURIComponent(s)}` : null
  }
  const notify = (symbol) => {
    for (const fn of [...subscribers]) {
      try { fn(symbol) } catch { /* a bad subscriber must not break the lane */ }
    }
  }
  const subscribe = (fn) => {
    if (typeof fn !== 'function') return () => {}
    subscribers.add(fn)
    return () => { subscribers.delete(fn) }
  }
  const clear = () => {
    for (const t of timers.values()) clearTimeout(t)
    cache.clear(); inflight.clear(); pendingTries.clear(); timers.clear()
  }
  const later = (symbol, ms) => {
    if (timers.has(symbol)) clearTimeout(timers.get(symbol))
    timers.set(symbol, setTimeout(() => {
      timers.delete(symbol)
      const held = cache.get(symbol)
      if (held && (held.status === 'pending' || held.status === 'error')) held.ready = true
      notify(symbol)
    }, ms))
  }
  const fetchOne = (symbol, fetcher) => {
    const s = String(symbol == null ? '' : symbol).trim().toUpperCase()
    const url = urlOf(s)
    if (!url) return Promise.resolve(null)
    if (inflight.has(s)) return inflight.get(s)
    const get = typeof fetcher === 'function' ? fetcher : _defaultFetch
    const p = Promise.resolve()
      .then(() => get(url))
      .then((doc) => {
        if (!doc || typeof doc !== 'object') throw Object.assign(new Error('an empty answer'), { httpStatus: 0 })
        if (doc.state === 'pending') {
          const tries = (pendingTries.get(s) || 0) + 1
          pendingTries.set(s, tries)
          if (tries > PENDING_RETRIES) {
            cache.set(s, { status: 'error', symbol: s, at: Date.now(), why: 'still gathering after every retry' })
            later(s, ERROR_RETRY_MS)
          } else {
            cache.set(s, { status: 'pending', symbol: s, at: Date.now() })
            later(s, PENDING_RETRY_MS)
          }
          return cache.get(s)
        }
        pendingTries.delete(s)
        const entry = { status: 'available', [field]: doc, symbol: s, at: Date.now(), rev: revOf(doc) }
        cache.set(s, entry)
        return entry
      })
      .catch((err) => {
        if (err && err.canceled) { cache.delete(s); return null }
        const status = _statusOf(err)
        if (DARK.has(status)) {
          const entry = { status: 'dark', symbol: s, httpStatus: status }
          cache.set(s, entry)
          return entry
        }
        const entry = { status: 'error', symbol: s, at: Date.now(), httpStatus: status }
        cache.set(s, entry)
        later(s, ERROR_RETRY_MS)
        return entry
      })
      .finally(() => {
        inflight.delete(s)
        notify(s)
      })
    inflight.set(s, p)
    return p
  }
  const ensure = (symbol, fetcher) => {
    const s = String(symbol == null ? '' : symbol).trim().toUpperCase()
    if (!s) return null
    const held = cache.get(s)
    if (held) {
      const stale = held.status === 'available' && Date.now() - held.at > maxAgeMs
      const retry = (held.status === 'pending' || held.status === 'error') && held.ready === true
      if ((stale || retry) && !inflight.has(s)) fetchOne(s, fetcher)
      return held
    }
    if (!inflight.has(s)) fetchOne(s, fetcher)
    const loading = { status: 'loading', symbol: s }
    cache.set(s, loading)
    return loading
  }
  return { urlOf, subscribe, clear, fetch: fetchOne, ensure }
}

const EVENTS = makeDoorCache({ path: '/api/pine/events/', field: 'events', maxAgeMs: EVENTS_MAX_AGE_MS,
  revOf: (doc) => (doc.refreshedAt == null ? '' : String(doc.refreshedAt)) })

/** The one URL this module asks. */
export function eventsUrl(symbol) { return EVENTS.urlOf(symbol) }

/** Notified whenever an entry changes, so a chart can bind again. @returns {() => void} */
export function subscribeEvents(fn) { return EVENTS.subscribe(fn) }

/** Test seam. */
export function clearEvents() { EVENTS.clear() }

/** Ask the door now (the primitive; `ensureEvents` is the paint path that decides whether to). */
export function fetchEvents(symbol, fetcher) { return EVENTS.fetch(symbol, fetcher) }

/**
 * The chart's entry for its symbol's events, asking the door when it must: a synchronous answer now (possibly
 * `{status: 'loading'}`) and a request in flight for the next bind. The same object every call until it changes.
 */
export function ensureEvents(symbol, fetcher) { return EVENTS.ensure(symbol, fetcher) }
