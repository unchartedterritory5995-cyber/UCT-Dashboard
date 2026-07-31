// useTickerSuggest — debounced predictive ticker search over /api/ticker-search.
//
// Extracted so the watchlist add-bar combobox (and any future inline ticker
// input) shares ONE debounce/abort/fallback implementation.
//
// SymbolSearch.jsx deliberately keeps its own copy rather than adopting this:
// its forwardRef `openWith()` surface is load-bearing for ChartWidget's
// type-to-search (see CLAUDE.md "Critical invariants"), and refactoring it to
// consume a hook is risk with no user-visible payoff. This hook is additive.
import { useState, useEffect, useRef } from 'react'

// Shown when the query is empty. Names are baked in so the dropdown is never
// bare on a cold ticker_meta cache (same rationale as SymbolSearch's list).
export const POPULAR_TICKERS = [
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust' },
  { ticker: 'NVDA', name: 'NVIDIA Corp.' },
  { ticker: 'AAPL', name: 'Apple Inc.' },
  { ticker: 'MSFT', name: 'Microsoft Corp.' },
  { ticker: 'AMZN', name: 'Amazon.com Inc.' },
  { ticker: 'META', name: 'Meta Platforms Inc.' },
  { ticker: 'GOOGL', name: 'Alphabet Inc. Class A' },
  { ticker: 'TSLA', name: 'Tesla Inc.' },
  { ticker: 'AVGO', name: 'Broadcom Inc.' },
  { ticker: 'AMD', name: 'Advanced Micro Devices' },
  { ticker: 'PLTR', name: 'Palantir Technologies' },
]

const DEBOUNCE_MS = 150

/**
 * @param {string} query      raw user input
 * @param {object} opts
 * @param {boolean} opts.enabled  skip fetching entirely when false (menu closed)
 * @param {number}  opts.limit    max server results
 * @returns {{results: Array<{ticker, name, _typed?}>, loading: boolean}}
 */
export default function useTickerSuggest(query, { enabled = true, limit = 12 } = {}) {
  // Only SERVER results are state. The empty-query case is derived below rather
  // than written into state — a synchronous setState in an effect body causes a
  // cascading render (and trips react-hooks/set-state-in-effect).
  const [fetched, setFetched] = useState([])
  const [loading, setLoading] = useState(false)
  const abortRef = useRef(null)
  const q = (query || '').trim().toUpperCase()

  useEffect(() => {
    if (!enabled || !q) return

    if (abortRef.current) abortRef.current.abort()
    const ctl = new AbortController()
    abortRef.current = ctl

    const t = setTimeout(() => {
      setLoading(true)
      fetch(`/api/ticker-search?q=${encodeURIComponent(q)}&limit=${limit}`, { signal: ctl.signal })
        .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
        .then(j => {
          const arr = Array.isArray(j?.results) ? j.results : []
          // Always keep a literal "add {q}" escape hatch so a ticker outside the
          // $300M cap universe (or a brand-new listing) can still be added.
          const hasExact = arr.some(r => r.ticker === q)
          setFetched(hasExact ? arr : [...arr, { ticker: q, name: null, _typed: true }])
          setLoading(false)
        })
        .catch(err => {
          if (err?.name === 'AbortError') return
          // Network/4xx — degrade to the typed value so Enter still works.
          setFetched([{ ticker: q, name: null, _typed: true }])
          setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => { clearTimeout(t); ctl.abort() }
  }, [q, enabled, limit])

  // Drop any in-flight request when the consumer unmounts.
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort() }, [])

  return {
    results: q ? fetched : POPULAR_TICKERS,
    loading: q ? loading : false,
  }
}
