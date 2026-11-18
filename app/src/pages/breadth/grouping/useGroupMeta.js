import { useState, useEffect } from 'react'

// Fetches { industries, sectors, themes } maps for a list of tickers from the
// universe industry map. Shared by every grouped breadth surface.
//
//   tickers - array of ticker strings (stable reference preferred)
// Returns { industries: {T:ind|null}, sectors: {T:sec|null}, themes: {T:name|null} }
//
// `themes` comes from the server's `resolve_primary_theme` - the SAME authority
// that decides the theme shown elsewhere in the app - so a stock's theme here can
// never disagree with its theme on a chart or in Theme Tracker.
//
// ⛔⛔ THE ENDPOINT CAPS EACH CALL AT 500 TICKERS AND SAYS NOTHING ABOUT IT.
// `api/routers/breadth_monitor.py` does `tickers = [...][:500]  # cap per call`,
// so a single POST of the whole list comes back answering only the first 500 and
// the rest are simply ABSENT from the response. `groupItems` then buckets every
// unanswered ticker as `Unclassified`, which sorts LAST - so the universe drill
// (2,667 names, measured 2026-09-07) rendered a handful of real industries above
// a 2,167-strong "Unclassified" pile. That is not a gap in the data, it is a
// question we never asked, and the two are indistinguishable on screen.
//
// The cap itself is CORRECT and must stay: the theme half is one SQLite query per
// ticker on the single shared web pod (500 took 3.2s), so lifting it would put
// ~17s of sequential SQLite behind one request - the 2026-07-01 threadpool-
// exhaustion class. So we CHUNK to the server's own limit instead of raising it.
//
// ⛔ CHUNK must not exceed the server cap. `useGroupMeta.chunk.test.js` reads the
// literal out of the router and fails if the two ever drift.
export const CHUNK = 500
// Two in flight: each request occupies one anyio worker for its whole SQLite pass,
// and this pod shares one threadpool with every other request on the site.
const CONCURRENCY = 2
// The one retry pass is capped at two chunks — see where it is used.
const RETRY_CAP = CHUNK * 2

// ⭐ INSTANT (2026-11-09, owner: "the sector sort is slow to load... fix this so
// it's instant"). Three things, together:
//   1. A FAST request first: `fields: ['sector','industry']` skips the per-ticker
//      theme queries, so the sector mix paints in one in-memory lookup instead of
//      waiting ~3 s per 500 names for themes it does not show.
//   2. A page-life CACHE shared by every list: a stock's sector does not change
//      between cells, so a second list (or a stepped day) reads what is known
//      synchronously, on its first render.
//   3. `prefetchGroupSectors` — hovering a calendar cell warms its sectors before
//      the click.
// An older server ignores `fields` and answers everything; such an answer carries
// `themes` and is treated as the full one.
const FAST_FIELDS = ['sector', 'industry']
const cache = new Map()        // T -> { industry, sector, theme?, full }
const fastPending = new Set()
const listeners = new Set()

/** Test-only: forget everything this module has learned. */
export function _resetGroupMetaCache() {
  cache.clear(); fastPending.clear()
}

function absorbAnswer(d) {
  if (!d) return
  const ind = d.industries || {}
  const sec = d.sectors || {}
  const hasThemes = !!d.themes
  const th = d.themes || {}
  for (const t in ind) {
    const prev = cache.get(t)
    const e = { ...(prev || {}), industry: ind[t] ?? null, sector: sec[t] ?? null }
    if (hasThemes) {
      e.theme = th[t] ?? null
      // A null industry is a cold entry the server is backfilling: ask again next time.
      e.full = !!ind[t]
    } else if (!prev) e.full = false
    cache.set(t, e)
  }
  for (const fn of listeners) fn()
}

function snapshot(syms) {
  const industries = {}, sectors = {}, themes = {}
  for (const t of syms) {
    const e = cache.get(t)
    if (!e) continue
    industries[t] = e.industry
    sectors[t] = e.sector
    if ('theme' in e) themes[t] = e.theme
  }
  return { industries, sectors, themes }
}

async function postChunk(syms, fields) {
  const r = await fetch('/api/breadth/industries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields ? { tickers: syms, fields } : { tickers: syms }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** Split `syms` into <=CHUNK slices and run them CONCURRENCY-at-a-time, calling
 *  `onBatch` as each lands so groups fill in progressively instead of after all. */
async function runChunked(syms, onBatch, isCancelled, fields) {
  const slices = []
  for (let i = 0; i < syms.length; i += CHUNK) slices.push(syms.slice(i, i + CHUNK))
  let next = 0
  const worker = async () => {
    while (next < slices.length) {
      if (isCancelled()) return
      const slice = slices[next++]
      try {
        const d = await postChunk(slice, fields)
        if (!isCancelled() && d) onBatch(d)
      } catch { /* a failed slice leaves its tickers unanswered; the retry pass takes them */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, worker))
}

/** Sectors + industries for names nobody has asked about yet. Never throws. */
async function fetchFast(syms, isCancelled = () => false) {
  const need = syms.filter(s => !cache.has(s) && !fastPending.has(s))
  if (!need.length) return
  for (const s of need) fastPending.add(s)
  try {
    await runChunked(need, absorbAnswer, isCancelled, FAST_FIELDS)
  } finally {
    for (const s of need) fastPending.delete(s)
  }
}

/** Warm the sectors for a list about to open (hovered cell). Fire and forget. */
export function prefetchGroupSectors(tickers) {
  const syms = [...new Set((tickers || []).map(t => String(t || '').toUpperCase()).filter(Boolean))]
  if (syms.length) fetchFast(syms).catch(() => {})
}

// drillFetch announces every loaded drill list (hover, neighbours, open). The
// literal is drillFetch's DRILL_ITEMS_EVENT, repeated rather than imported so the
// Breadth page chunk does not pull this module in.
if (typeof window !== 'undefined') {
  window.addEventListener('uct:breadth-drill-items', (e) => prefetchGroupSectors(e?.detail))
}

export default function useGroupMeta(tickers) {
  // ⛔ KEYED ON CONTENT, NOT ON THE ARRAY'S IDENTITY. A caller that builds its
  // list inline (`useGroupMeta(items.map(i => i.t))`) hands this a new array on
  // every render; keyed on identity, the effect re-runs, `setMeta` renders, and
  // it re-runs again - an endless refetch that looks like a slow endpoint rather
  // than a loop. `useBreadthGrouping` happens to memoize, so the one consumer
  // today is safe; this makes every future one safe by construction, and it is
  // the same `tickerKey` idiom that file already uses for the same reason.
  const key = (tickers || []).filter(Boolean).join(',')

  // What is already known paints on the FIRST render — no effect, no request.
  const [state, setState] = useState(() => ({ key, meta: snapshot(key ? key.split(',') : []) }))
  let meta = state.meta
  if (state.key !== key) {
    meta = snapshot(key ? key.split(',') : [])
    setState({ key, meta })
  }

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const isCancelled = () => cancelled
    const syms = key.split(',')
    const refresh = () => { if (!cancelled) setState({ key, meta: snapshot(syms) }) }
    listeners.add(refresh)
    refresh()

    // What the THEME pass has actually heard back about, so the retry asks for
    // the STRAGGLERS ONLY rather than replaying the whole list. `cold` is read
    // off the RESPONSE (a present-but-null industry = the server is backfilling it).
    const answered = new Set()
    const cold = new Set()
    const absorbFull = (d) => {
      const ind = d.industries || {}
      for (const t in ind) { answered.add(t); if (ind[t]) cold.delete(t); else cold.add(t) }
      absorbAnswer(d)
    }

    ;(async () => {
      await fetchFast(syms, isCancelled)
      if (cancelled) return
      const full = syms.filter(s => !cache.get(s)?.full)
      if (!full.length) return
      await runChunked(full, absorbFull, isCancelled)
      if (cancelled) return
      // Stragglers = never answered (a failed slice) OR answered with a null
      // industry (a cold-cache entry the server is backfilling). One retry.
      //
      // ⛔ BOUNDED. The retry exists to catch a cache the server is warming, NOT to
      // re-ask for names that genuinely have no industry — and on the universe drill
      // (2,667 names) most nulls are the latter, so an unbounded retry would double
      // the load on the biggest list to re-learn the same nulls. Completeness comes
      // from CHUNKING above; this is best-effort on top of it.
      const retry = [...new Set([...full.filter(s => !answered.has(s)), ...cold])].slice(0, RETRY_CAP)
      if (!retry.length) return
      await new Promise(r => setTimeout(r, 2500))
      if (cancelled) return
      await runChunked(retry, absorbFull, isCancelled)
    })()

    return () => { cancelled = true; listeners.delete(refresh) }
  }, [key])

  return meta
}
