// app/src/hooks/useEarningsAudio.js
// SWR hook: GET /api/earnings/audio/{ticker}
// Returns { stream_url, kind, transcript_url } or null when no audio provider configured.
import useSWR from 'swr'
import { sectionFetcher } from '../components/research/sections/sectionFetch'

// TERM-033: a failed read THROWS, so a failed 2-minute refresh no longer replaces the stream
// with null and pulls the player out from under a listener; SWR keeps the last good answer.
// SOFT AT THE RENDER, ON PURPOSE: audio is an optional enrichment. On a failed first read the
// caller shows the recap's webcast link instead of a player and claims nothing about whether
// audio exists. A 402 stays an absent answer.
const fetcher = (url) => sectionFetcher(url).then((d) => (d?.paywalled ? null : d))

export default function useEarningsAudio(ticker) {
  return useSWR(
    ticker ? `/api/earnings/audio/${ticker}` : null,
    fetcher,
    { refreshInterval: 2 * 60 * 1000, revalidateOnFocus: false },
  )
}
