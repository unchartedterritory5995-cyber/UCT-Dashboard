import useSWR from 'swr'

// Frozen so the shared fallback can never be mutated by a consumer.
const NULLS = Object.freeze({ name: null, sector: null, industry: null, theme: null })

// Root cause of the "watermark only shows the ticker for an hour" bug:
// the old fetcher swallowed every failure and returned NULLS as a *successful*
// value. SWR then cached that transient miss (e.g. a cold-start backend right
// after a redeploy) as authoritative and — with a 1h dedupe + no revalidation
// — never recovered within the session.
//
// Fix: a failure must be an ERROR, not cached data. We THROW on !ok / parse
// failure so SWR error-handles + retries instead of pinning NULLS, and the
// hook self-heals quickly (short dedupe + revalidate-if-stale). The component
// still degrades gracefully to NULLS while loading/erroring (chart just shows
// the ticker line until real data arrives, then upgrades).
export async function fetcher(url) {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) throw new Error(`ticker-meta ${r.status}`)
  const j = await r.json() // a malformed body throws → SWR retries (not cached)
  return { name: j?.name ?? null, sector: j?.sector ?? null, industry: j?.industry ?? null, theme: j?.theme ?? null }
}

// Per-symbol company metadata for the chart watermark. Never throws to the
// component; returns NULLS until real data resolves.
export default function useTickerMeta(sym) {
  const { data } = useSWR(
    sym ? `/api/ticker-meta/${encodeURIComponent(sym)}` : null,
    fetcher,
    {
      revalidateOnFocus: false,   // don't refetch on every tab focus (decorative)
      revalidateOnReconnect: true,
      revalidateIfStale: true,    // a stale/transient miss self-corrects on next view
      dedupingInterval: 60000,    // 1 min — long enough to dedupe a render storm,
                                  // short enough that a transient miss recovers fast
      errorRetryCount: 4,
      errorRetryInterval: 4000,   // ~4s backoff — recovers within seconds, not an hour
    },
  )
  return data || NULLS
}
