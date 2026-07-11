/**
 * Journal 2.0 — shared price provider (Task A6).
 *
 * Mounts ONCE at JournalLayout and holds a STABLE base subscription to the
 * browser-wide `priceStreamManager` SSE pool for the current account's
 * open-position symbols. Because the provider lives at the layout (which does
 * NOT remount when the <Outlet/> surface changes), the subscription lifecycle
 * is stable across intra-journal navigation — switching Today → Trades →
 * Insights no longer drops + re-adds the position tickers, so the shared pool
 * never rebuilds its EventSource on a surface switch.
 *
 * This is ADDITIVE. The pool already dedupes sockets across every
 * `useRealtimePrices(symbols)` caller (OpenPositionsTab:146, AnalyticsTab:279,
 * …), so those keep working UNCHANGED — the provider just adds a stable base
 * subscription and exposes the resulting snapshot via `useJ2Prices()` for
 * surfaces that want prices without wiring their own hook.
 *
 * The pool enforces MAX_SSE_TICKERS (it chunks the union); we additionally cap
 * the base subscription at MAX_SSE_TICKERS so it can never single-handedly force
 * a second socket. We never bypass the cap.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react'
import * as priceStreamManager from '../../lib/priceStreamManager'
import useJ2Positions from './hooks/useJ2Positions'

// Frozen empty snapshot shared by every idle provider (no open positions), so
// unrelated app-wide pool publishes can never re-render the journal subtree.
const EMPTY_SNAPSHOT = Object.freeze({
  prices: Object.freeze({}),
  staleSymbols: new Set(),
  connected: false,
})
const getEmptySnapshot = () => EMPTY_SNAPSHOT

const EMPTY_PRICES = Object.freeze({})
const EMPTY_STALE = Object.freeze(new Set())
const EMPTY_VALUE = Object.freeze({
  prices: EMPTY_PRICES,
  staleSymbols: EMPTY_STALE,
  symbols: Object.freeze([]),
  isStreaming: false,
})

const J2PriceContext = createContext(EMPTY_VALUE)

/**
 * Read the shared J2 price snapshot: `{ prices, staleSymbols, symbols,
 * isStreaming }`, filtered to the current account's open-position symbols.
 * Returns the empty default when read outside a J2PriceProvider.
 */
export function useJ2Prices() {
  return useContext(J2PriceContext)
}

export default function J2PriceProvider({ children }) {
  const { positions } = useJ2Positions()

  // Stable, deduped, uppercased, sorted symbol key for the always-relevant set
  // (the open positions). Sorting makes the subscription identity stable
  // regardless of position order; the cap keeps the base subscription within a
  // single socket (the pool also enforces MAX_SSE_TICKERS — this respects it).
  const symbolsKey = useMemo(() => {
    const set = new Set()
    for (const p of positions) {
      if (p && p.symbol) set.add(String(p.symbol).toUpperCase())
    }
    return [...set].sort().slice(0, priceStreamManager.MAX_SSE_TICKERS).join(',')
  }, [positions])

  // The stable base subscription. useSyncExternalStore registers it once per
  // unique symbol set; it only re-subscribes when the OPEN POSITIONS change
  // (account switch / add / close), NOT on a surface switch. The cleanup fires
  // when JournalLayout unmounts (leaving /journal).
  const subscribe = useCallback(
    (onChange) => {
      if (!symbolsKey) return () => {}
      return priceStreamManager.subscribe(symbolsKey.split(','), onChange)
    },
    [symbolsKey],
  )
  // Idle providers read a frozen empty snapshot so unrelated app-wide publishes
  // can never re-render the journal subtree.
  const getSnap = symbolsKey ? priceStreamManager.getSnapshot : getEmptySnapshot
  const snapshot = useSyncExternalStore(subscribe, getSnap, getSnap)

  const value = useMemo(() => {
    if (!symbolsKey) return EMPTY_VALUE
    const symbols = symbolsKey.split(',')
    // The pool's price store is a browser-wide accumulator; expose only THIS
    // provider's symbols so consumers never see unrelated tickers.
    const prices = {}
    for (const sym of symbols) {
      if (snapshot.prices[sym] != null) prices[sym] = snapshot.prices[sym]
    }
    let staleSymbols = EMPTY_STALE
    if (snapshot.staleSymbols && snapshot.staleSymbols.size) {
      const filtered = new Set()
      for (const sym of symbols) {
        if (snapshot.staleSymbols.has(sym)) filtered.add(sym)
      }
      staleSymbols = filtered
    }
    return { prices, staleSymbols, symbols, isStreaming: !!snapshot.connected }
  }, [snapshot, symbolsKey])

  return <J2PriceContext.Provider value={value}>{children}</J2PriceContext.Provider>
}
