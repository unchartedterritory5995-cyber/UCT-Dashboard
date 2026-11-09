// One cache for every breadth drill list, so opening a cell is instant.
//
// Hovering a cell starts its request; the click then finds the answer already
// here (or in flight) instead of starting a cold fetch. A recorded session never
// changes, so it is kept for the page's life; the live list is re-fetched once
// it is older than LIVE_TTL_MS. Failures are never cached: a retry must really
// retry.

const LIVE_TTL_MS = 30_000
const MAX_ENTRIES = 300
const entries = new Map() // url -> { at, live, data?, promise? }

function fresh(e) {
  return e && (!e.live || Date.now() - e.at < LIVE_TTL_MS)
}

/** The cached answer for `url`, or undefined when there is none yet. */
export function peekDrill(url) {
  const e = entries.get(url)
  return fresh(e) && e.data ? e.data : undefined
}

/** The answer for `url`: cached, the request already in flight, or a new one. */
export function fetchDrill(url, { live = false } = {}) {
  const e = entries.get(url)
  if (fresh(e)) return e.data ? Promise.resolve(e.data) : e.promise
  const promise = fetch(url)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json()
    })
    .then(data => {
      const cur = entries.get(url)
      if (cur && cur.promise === promise) cur.data = data
      return data
    })
    .catch(err => {
      if (entries.get(url)?.promise === promise) entries.delete(url)
      throw err
    })
  entries.set(url, { at: Date.now(), live, promise })
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value)
  return promise
}

/** Start `url` loading without waiting for it (hover, neighbours). */
export function prefetchDrill(url, opts) {
  if (!url) return
  fetchDrill(url, opts).catch(() => {})
}

/** Drop `url` so the next fetch goes to the network (Try again). */
export function forgetDrill(url) {
  entries.delete(url)
}
