import useSWR from 'swr'

// Is this ticker DELISTED (a dead company — Yahoo, Twitter, Lehman…)? Returns the
// registry record ({ticker, name, sector, industry, delisted_date, reason}) when it is,
// or null for a live ticker. A dead ticker's status never changes, so this is cached hard
// (no focus/reconnect revalidation, long dedupe). The chart uses it to FREEZE the live
// paths — no streaming, no live-price header, curated watermark, a "Delisted YYYY" badge.
const fetcher = async (url) => {
  const r = await fetch(url)
  if (!r.ok) return null
  const d = await r.json()
  return d && d.delisted ? d : null
}

export default function useDelisted(sym) {
  // Skip synthetic pseudo-tickers ($IDX:…) and empty syms outright.
  const key = sym && !String(sym).startsWith('$IDX:') ? `/api/delisted/${encodeURIComponent(sym)}` : null
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    dedupingInterval: 60 * 60 * 1000, // 1h — status is immutable
    shouldRetryOnError: false,
  })
  return data || null
}
