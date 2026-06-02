// app/src/hooks/useFilings.js
// SWR hook: GET /api/filings/{ticker}?count=10
// Returns { ticker, filings: [{ form, filed, url, ... }] } or null.
import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)

export default function useFilings(ticker, count = 10) {
  return useSWR(
    ticker ? `/api/filings/${ticker}?count=${count}` : null,
    fetcher,
    { refreshInterval: 15 * 60 * 1000, revalidateOnFocus: false },
  )
}
