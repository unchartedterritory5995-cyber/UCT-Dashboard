import { createContext, useContext, useState, useCallback, useMemo } from 'react'

// Safe default so useTickerHub() works even outside a provider (no-op).
const TickerHubContext = createContext({ sym: null, openTicker: () => {}, closeTicker: () => {} })

export function TickerHubProvider({ children }) {
  const [sym, setSym] = useState(null)
  const openTicker = useCallback((s) => { if (s) setSym(String(s).toUpperCase()) }, [])
  const closeTicker = useCallback(() => setSym(null), [])
  const value = useMemo(() => ({ sym, openTicker, closeTicker }), [sym, openTicker, closeTicker])
  return <TickerHubContext.Provider value={value}>{children}</TickerHubContext.Provider>
}

export function useTickerHub() {
  return useContext(TickerHubContext)
}
