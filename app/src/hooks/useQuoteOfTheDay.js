// app/src/hooks/useQuoteOfTheDay.js — the ONE way a surface gets today's quote.
//
// The server (GET /api/quote-of-the-day) owns the pick: it reads the Morning
// Wire's exposure tier and selects from the pool of quotes tagged for that
// regime, keyed on the ET calendar day — so every viewer, every surface and the
// Substack letter show the same line. The client-side rotation in
// constants/quotes.js is the OFFLINE FALLBACK only: it is used when the API
// errors, never raced against it (that would paint one quote and swap it).
//
// Returns { quote, label, source } where source ∈ 'server' | 'fallback' | 'loading'
// and quote is null while loading — render nothing (or a placeholder) until then.

import useSWR from 'swr'
import { quoteOfTheDay } from '../constants/quotes'

const ONE_HOUR = 60 * 60 * 1000

const fetcher = (url) =>
  fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))

export default function useQuoteOfTheDay() {
  const { data, error } = useSWR('/api/quote-of-the-day', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: ONE_HOUR,
    // A tab left open overnight rolls to the next day's quote without a reload.
    refreshInterval: ONE_HOUR,
  })

  if (data?.quote?.t) return { quote: data.quote, label: data.label ?? null, source: 'server' }
  if (error || (data && !data.quote)) return { quote: quoteOfTheDay(), label: null, source: 'fallback' }
  return { quote: null, label: null, source: 'loading' }
}
