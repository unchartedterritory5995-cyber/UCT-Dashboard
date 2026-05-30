import { useEffect, useMemo, useState } from 'react'
import { registerTickers, subscribe, getSnapshot, pollNow } from './livePriceStore'

/**
 * Fetch live prices for a list of tickers.
 * Returns { prices, isLoading, error, refresh }
 * where prices = { AAPL: { price: 195.23, change_pct: 1.45 }, ... }
 *
 * Backed by a shared singleton store (livePriceStore): all callers across the
 * app collapse into a SINGLE 2s poll of the union of their tickers, instead of
 * one poll per component. Each caller reads only its own slice. Same return
 * shape as before — consumers are unaffected.
 */
export default function useLivePrices(tickers = []) {
  // Stable, sorted, deduped key for this caller's ticker set.
  const key = tickers.length ? [...new Set(tickers)].filter(Boolean).sort().join(',') : ''

  // Subscribe to store updates (re-render when shared prices change).
  const [all, setAll] = useState(getSnapshot)
  useEffect(() => {
    const unsub = subscribe(() => setAll(getSnapshot()))
    setAll(getSnapshot()) // sync any value that landed before this effect ran
    return unsub
  }, [])

  // Register/unregister this caller's tickers in the shared union.
  useEffect(() => {
    if (!key) return undefined
    return registerTickers(key.split(','))
  }, [key])

  // Select only this caller's slice (stable ref unless its tickers' data changes).
  const prices = useMemo(() => {
    if (!key) return {}
    const out = {}
    for (const t of key.split(',')) if (all[t]) out[t] = all[t]
    return out
  }, [all, key])

  return {
    prices,
    isLoading: key !== '' && Object.keys(prices).length === 0,
    error: null,
    refresh: pollNow,
  }
}
