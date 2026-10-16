import { useEffect, useRef, useState } from 'react'

// The per-row price line: ~3 months of daily closes for the loaded rows, asked in
// batches of BATCH (the endpoint's cap) as the list grows. One module cache, so a
// re-sort, a page of more rows or a return to a screen asks only for new names.
export const BATCH = 60
const cache = new Map()       // ticker -> number[] (closes, oldest first)
const inFlight = new Set()

export function _resetSparkCache() { cache.clear(); inFlight.clear() }

export default function useSparks(tickers) {
  const [, setTick] = useState(0)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const key = tickers.join(',')
  useEffect(() => {
    alive.current = true
    const want = tickers.filter(t => t && !cache.has(t) && !inFlight.has(t))
    for (let i = 0; i < want.length; i += BATCH) {
      const chunk = want.slice(i, i + BATCH)
      chunk.forEach(t => inFlight.add(t))
      fetch(`/api/screener/sparks?tickers=${encodeURIComponent(chunk.join(','))}`)
        .then(r => (r.ok ? r.json() : null))
        .then(j => {
          const got = j?.sparks || {}
          // A name the answer left out is cached empty, so it is not asked for again.
          chunk.forEach(t => cache.set(t, Array.isArray(got[t]?.c) ? got[t].c : []))
        })
        .catch(() => { /* no line is the honest fallback; the next screen asks again */ })
        .finally(() => {
          chunk.forEach(t => inFlight.delete(t))
          if (alive.current) setTick(n => n + 1)
        })
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps -- `key` is the tickers' identity
  return cache
}
