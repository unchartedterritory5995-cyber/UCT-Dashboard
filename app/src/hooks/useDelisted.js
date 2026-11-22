import useSWR from 'swr'
import { delistedKey, delistedFetcher as fetcher } from './delistedKey'

// Is this ticker DELISTED (a dead company — Yahoo, Twitter, Lehman…)? Returns the
// registry record ({ticker, name, sector, industry, delisted_date, reason}) when it is,
// or null for a live ticker. A dead ticker's status never changes, so this is cached hard
// (no focus/reconnect revalidation, long dedupe). The chart uses it to FREEZE the live
// paths — no streaming, no live-price header, curated watermark, a "Delisted YYYY" badge.
export default function useDelisted(sym, isPaused) {
  // Skip synthetic pseudo-tickers ($IDX:…) and empty syms outright.
  const key = delistedKey(sym)
  // `isPaused` (optional): a chart passes its rest gate, so a symbol the member is racing past is not
  // asked for (components/chart/restedReaders.js). Without it this is an ordinary read.
  const { data } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    dedupingInterval: 60 * 60 * 1000, // 1h — status is immutable
    shouldRetryOnError: false,
    ...(isPaused && { isPaused }),
  })
  return data || null
}
