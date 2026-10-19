import { useEffect, useState } from 'react'
import useMobileSWR from './useMobileSWR'

const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))

// A peeking host (the screener) reads the feed for every stock a member arrows past, so it waits
// for the selection to SETTLE first: a held ↓ walks many rows a second and only the stock the walk
// stops on is read.
export const PEEK_SETTLE_MS = 200

/**
 * Per-stock News & Catalysts feed. Polls fast while the historical catalysts are
 * still generating, then settles to a ~20s live cadence (market-hours-aware, so it
 * slows 10x when the market is closed and pauses on a hidden tab). No SSE — the
 * backend reads DBs the app already updates continuously (see service.py).
 *
 * `peek`: read only what is already written (`?generate=0`). ⛔ The ordinary read starts a
 * background LLM generation for a name not yet covered, so a host that reads one feed per row
 * must peek, or a walk down a list starts one generation per row. A peek answers `ready` or `none`
 * and never `generating`.
 */
export default function useNewsCatalysts(sym, { generating = false, peek = false } = {}) {
  const [settled, setSettled] = useState(peek ? null : sym)
  useEffect(() => {
    if (!peek) return undefined
    const t = setTimeout(() => setSettled(sym), PEEK_SETTLE_MS)
    return () => clearTimeout(t)
  }, [sym, peek])
  const target = peek ? (settled === sym ? sym : null) : sym
  const { data, error, isLoading } = useMobileSWR(
    target ? `/api/news-catalysts/${encodeURIComponent(target)}${peek ? '?generate=0' : ''}` : null,
    fetcher,
    {
      refreshInterval: generating && !peek ? 4000 : 20000,
      dedupingInterval: 8000,
      revalidateOnFocus: false,
      marketHoursOnly: true,
    },
  )
  // A peek still settling has not asked yet: it is loading, never an empty answer.
  const waiting = peek && sym && !target
  return {
    status: data?.status || (isLoading || waiting ? 'loading' : 'ready'),
    events: data?.events || [],
    generatedAt: data?.generated_at || null,
    error,
    isLoading: isLoading || waiting,
  }
}
