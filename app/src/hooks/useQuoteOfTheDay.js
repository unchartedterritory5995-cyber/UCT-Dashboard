// app/src/hooks/useQuoteOfTheDay.js — the ONE way a surface gets today's quote.
//
// The server (GET /api/quote-of-the-day) owns the pick: it is anchored to the
// latest Morning Wire — that wire's date and exposure tier select from the pool
// of quotes tagged for the regime — so every viewer, every surface and the
// Substack letter show the same line, and it changes once per trading day, when
// the wire lands. The client-side rotation in
// constants/quotes.js is the OFFLINE FALLBACK only: it is used when the API
// errors, never raced against it (that would paint one quote and swap it).
//
// Returns { quote, label, source } where source ∈ 'server' | 'fallback' | 'loading'
// and quote is null while loading — render nothing (or a placeholder) until then.

import useMobileSWR from './useMobileSWR'
import { quoteOfTheDay } from '../constants/quotes'

const FIVE_MIN = 5 * 60 * 1000
const FIFTEEN_MIN = 15 * 60 * 1000

const fetcher = (url) =>
  fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))

export default function useQuoteOfTheDay() {
  // useMobileSWR, not bare useSWR: the poll pauses while the tab is hidden and
  // slows on mobile, like every other polling site (pollingSites.rail.test.js).
  const { data, error } = useMobileSWR('/api/quote-of-the-day', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: FIVE_MIN,
    // The server anchors the pick to the latest WIRE (it changes when the wire
    // lands, ~7:47 ET), so a tab opened pre-market picks up the new quote within
    // minutes; SWR's global revalidateOnFocus is off, so this poll is the path.
    refreshInterval: FIFTEEN_MIN,
  })

  if (data?.quote?.t) return { quote: data.quote, label: data.label ?? null, source: 'server' }
  if (error || (data && !data.quote)) return { quote: quoteOfTheDay(), label: null, source: 'fallback' }
  return { quote: null, label: null, source: 'loading' }
}
