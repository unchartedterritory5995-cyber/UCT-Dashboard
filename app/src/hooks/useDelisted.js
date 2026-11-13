import useSWR from 'swr'
import { delistedKey, delistedFetcher as fetcher } from './delistedKey'

// Is this ticker DELISTED (a dead company — Yahoo, Twitter, Lehman…)? Returns the
// registry record ({ticker, name, sector, industry, delisted_date, reason}) when it is,
// or null for a live ticker. A dead ticker's status never changes, so this is cached hard
// (no focus/reconnect revalidation, long dedupe). The chart uses it to FREEZE the live
// paths — no streaming, no live-price header, curated watermark, a "Delisted YYYY" badge.
export default function useDelisted(sym) {
  // Skip synthetic pseudo-tickers ($IDX:…) and empty syms outright.
  const key = delistedKey(sym)
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    dedupingInterval: 60 * 60 * 1000, // 1h — status is immutable
    shouldRetryOnError: false,
  })
  return data || null
}
