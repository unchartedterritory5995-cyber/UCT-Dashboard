// app/src/hooks/useQuietRealtimePrices.js
//
// ⭐ THE LIVE QUOTES WITHOUT A HOST RENDER PER PUBLISH (2026-11-20). `useQuietRealtimePrices(tickers, { renderKey,
// onTickRef })` returns what `useRealtimePrices(tickers)` returns, read fresh at each render of the host
// (`lib/liveQuote.js`: the same two feeds, the hook's own merge), but the host re-renders only when `renderKey()`
// (a primitive: what its render shows of the feed) changes. `onTickRef.current()` runs on every publish, between
// renders, for whatever the host updates without rendering. Built for StockChart (`lib/liveQuote.js` has why).
//
// ⛔ ITS OWN MODULE, ON PURPOSE: `hooks/useRealtimePrices.js` is on the Notebook's first-open closure (Journal tabs
// read it), and first-open bytes are a budget (CLAUDE.md rule 5). Only StockChart imports this.
// Under the SSE pool kill-switch (`uct.ssePool.disabled`) it is the ordinary hook, as every reader is.

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import useRealtimePrices from './useRealtimePrices'
import * as priceStreamManager from '../lib/priceStreamManager'
import { readLiveQuotes, watchLiveQuotes } from '../lib/liveQuote'

const EMPTY_SNAPSHOT = Object.freeze({ prices: Object.freeze({}), staleSymbols: new Set(), connected: false })

function useQuiet(tickers = [], opts) {
  const sorted = [...new Set(tickers.filter(Boolean))].sort().join(',')
  const onTickRef = opts.onTickRef   // a ref: stable for the host's life
  const subscribeStore = useCallback((onStoreChange) => {
    if (!sorted) return () => {}
    return watchLiveQuotes(sorted.split(','), () => {
      try { onTickRef?.current?.() } catch { /* the host's next render reads it */ }
      onStoreChange()
    })
  }, [sorted, onTickRef])
  const getKey = () => (opts.renderKey ? opts.renderKey() : '')
  useSyncExternalStore(subscribeStore, getKey, getKey)
  const snap = sorted ? priceStreamManager.getSnapshot() : EMPTY_SNAPSHOT
  // the newest quotes at THIS render (identity-stable while every quote is)
  const prices = readLiveQuotes(sorted)
  const staleSymbols = useMemo(() => {
    const filtered = new Set()
    if (sorted && snap.staleSymbols) for (const t of sorted.split(',')) if (snap.staleSymbols.has(t)) filtered.add(t)
    return filtered
  }, [snap.staleSymbols, sorted])
  return { prices, isLoading: false, isStreaming: !!snap.connected, staleSymbols }
}

const POOL_DISABLED = (() => {
  try { return localStorage.getItem('uct.ssePool.disabled') === '1' } catch { return false }
})()
function useOrdinary(tickers) { return useRealtimePrices(tickers) }

/** Chosen at module load, like the hook's own kill-switch. */
const useQuietRealtimePrices = POOL_DISABLED ? useOrdinary : useQuiet
export default useQuietRealtimePrices
