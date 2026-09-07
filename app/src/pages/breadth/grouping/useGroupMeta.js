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

async function postChunk(syms) {
  const r = await fetch('/api/breadth/industries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tickers: syms }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** Split `syms` into <=CHUNK slices and run them CONCURRENCY-at-a-time, calling
 *  `onBatch` as each lands so groups fill in progressively instead of after all. */
async function runChunked(syms, onBatch, isCancelled) {
  const slices = []
  for (let i = 0; i < syms.length; i += CHUNK) slices.push(syms.slice(i, i + CHUNK))
  let next = 0
  const worker = async () => {
    while (next < slices.length) {
      if (isCancelled()) return
      const slice = slices[next++]
      try {
        const d = await postChunk(slice)
        if (!isCancelled() && d) onBatch(d)
      } catch { /* a failed slice leaves its tickers unanswered; the retry pass takes them */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, worker))
}

export default function useGroupMeta(tickers) {
  const [meta, setMeta] = useState({ industries: {}, sectors: {}, themes: {} })

  // ⛔ KEYED ON CONTENT, NOT ON THE ARRAY'S IDENTITY. A caller that builds its
  // list inline (`useGroupMeta(items.map(i => i.t))`) hands this a new array on
  // every render; keyed on identity, the effect re-runs, `setMeta` renders, and
  // it re-runs again - an endless refetch that looks like a slow endpoint rather
  // than a loop. `useBreadthGrouping` happens to memoize, so the one consumer
  // today is safe; this makes every future one safe by construction, and it is
  // the same `tickerKey` idiom that file already uses for the same reason.
  const key = (tickers || []).filter(Boolean).join(',')

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const isCancelled = () => cancelled
    const syms = key.split(',')

    // What this pass has actually heard back about, so the retry asks for the
    // STRAGGLERS ONLY rather than replaying the whole list. `cold` is read off the
    // RESPONSE (a present-but-null industry = the server is backfilling it), which
    // is why no ref on `meta` is needed - taking `meta` as a dependency here would
    // re-run the whole fetch on every batch it had just merged.
    const answered = new Set()
    const cold = new Set()
    const absorb = (d) => {
      const ind = d.industries || {}
      for (const t in ind) { answered.add(t); if (ind[t]) cold.delete(t); else cold.add(t) }
      setMeta(prev => ({
        industries: { ...prev.industries, ...(d.industries || {}) },
        sectors: { ...prev.sectors, ...(d.sectors || {}) },
        themes: { ...prev.themes, ...(d.themes || {}) },
      }))
    }

    ;(async () => {
      await runChunked(syms, absorb, isCancelled)
      if (cancelled) return
      // Stragglers = never answered (a failed slice) OR answered with a null
      // industry (a cold-cache entry the server is backfilling). One retry.
      //
      // ⛔ BOUNDED. The retry exists to catch a cache the server is warming, NOT to
      // re-ask for names that genuinely have no industry — and on the universe drill
      // (2,667 names) most nulls are the latter, so an unbounded retry would double
      // the load on the biggest list to re-learn the same nulls. Completeness comes
      // from CHUNKING above; this is best-effort on top of it.
      const retry = [...new Set([...syms.filter(s => !answered.has(s)), ...cold])].slice(0, RETRY_CAP)
      if (!retry.length) return
      await new Promise(r => setTimeout(r, 2500))
      if (cancelled) return
      await runChunked(retry, absorb, isCancelled)
    })()

    return () => { cancelled = true }
  }, [key])

  return meta
}
