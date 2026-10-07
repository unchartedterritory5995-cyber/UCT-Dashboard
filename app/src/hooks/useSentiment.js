// app/src/hooks/useSentiment.js
// SWR hook: GET /api/earnings/sentiment/{ticker}
// Returns { score, label, rationale, drivers[] } or null.
import useSWR from 'swr'
import { sectionFetcher } from '../components/research/sections/sectionFetch'

// TERM-033: a failed read THROWS, so SWR keeps the last good read through a failed refresh
// instead of a `null` that dropped the gauge. SOFT AT THE RENDER, ON PURPOSE: the gauge is an
// optional enrichment above the recap; on a failed first read it renders nothing (it never
// states "no sentiment"), and the 60 s re-ask below keeps running. A 402 stays absent.
const fetcher = (url) => sectionFetcher(url).then((d) => (d?.paywalled ? null : d))

export default function useSentiment(ticker) {
  return useSWR(
    ticker ? `/api/earnings/sentiment/${ticker}` : null,
    fetcher,
    // A cold name's read is generated in the background now (S2, 2026-10-05): the first
    // answer is null while it runs, so ask again in a minute rather than half an hour.
    { refreshInterval: (data) => (data == null ? 60 * 1000 : 30 * 60 * 1000), revalidateOnFocus: false },
  )
}
