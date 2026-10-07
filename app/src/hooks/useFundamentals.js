// app/src/hooks/useFundamentals.js
// SWR hook: GET /api/fundamentals/{ticker}
// Returns { market_cap, forward_pe, beta, week52_high, week52_low, avg_vol, div_yield } or null.
import useSWR from 'swr'
import { sectionFetcher } from '../components/research/sections/sectionFetch'

// TERM-033: a failed read THROWS (sectionFetcher), so SWR keeps the last good answer and
// retries, instead of a `null` that wiped the profile to dashes on one failed 10-min refresh.
// 402 stays an absent answer, as before.
const fetcher = (url) => sectionFetcher(url).then((d) => (d?.paywalled ? null : d))

export default function useFundamentals(ticker) {
  return useSWR(
    ticker ? `/api/fundamentals/${ticker}` : null,
    fetcher,
    { refreshInterval: 10 * 60 * 1000, revalidateOnFocus: false },
  )
}
