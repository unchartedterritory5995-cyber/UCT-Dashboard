import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import useLivePrices from './useLivePrices'

/**
 * Real-time price streaming via Server-Sent Events.
 * Merges Finnhub WebSocket (tick-by-tick) with Massive REST (2s polling).
 *
 * Per-field merge: stream provides {price, change_pct, updated_at},
 * REST provides {day_open, day_high, day_low, prev_close, volume}.
 * Both combined give the chart everything it needs.
 */
export default function useRealtimePrices(tickers = []) {
  const [streamPrices, setStreamPrices] = useState({})
  const [connected, setConnected] = useState(false)
  const [staleSymbols, setStaleSymbols] = useState(() => new Set())
  const esRef = useRef(null)
  const reconnectRef = useRef(null)
  const retryDelayRef = useRef(5000)  // exponential backoff: 5→10→20→40→80→120s

  // Massive REST polling always runs (2s) — provides session OHLC + volume
  const { prices: polledPrices, isLoading } = useLivePrices(tickers)

  const sorted = [...new Set(tickers)].sort().join(',')

  const connect = useCallback(() => {
    if (!sorted || esRef.current) return

    const es = new EventSource(`/api/stream/prices?tickers=${sorted}`)
    esRef.current = es

    es.onopen = () => {
      setConnected(true)
      retryDelayRef.current = 5000  // reset backoff on successful connection
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
    }

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setStreamPrices(prev => ({ ...prev, ...data }))
      } catch {}
    }

    // Liveness signals from backend (P2-6): per-ticker stale/fresh events.
    // Backend emits these as named SSE events ("event: stale" / "event: fresh"),
    // so they bypass es.onmessage and require explicit listeners.
    es.addEventListener('stale', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (!data?.sym) return
        const sym = String(data.sym).toUpperCase()
        setStaleSymbols(prev => {
          if (prev.has(sym)) return prev
          const next = new Set(prev)
          next.add(sym)
          return next
        })
      } catch {}
    })

    es.addEventListener('fresh', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (!data?.sym) return
        const sym = String(data.sym).toUpperCase()
        setStaleSymbols(prev => {
          if (!prev.has(sym)) return prev
          const next = new Set(prev)
          next.delete(sym)
          return next
        })
      } catch {}
    })

    es.onerror = () => {
      setConnected(false)
      // Don't clear streamPrices — show last known prices rather than blanking
      // the UI on a transient network hiccup or brief server restart.
      es.close()
      esRef.current = null
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, 120000)  // cap at 120s
      reconnectRef.current = setTimeout(() => connect(), delay)
    }
  }, [sorted])

  useEffect(() => {
    if (sorted) connect()
    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
      }
      setConnected(false)
    }
  }, [sorted, connect])

  // Per-field merge: REST fields (day_open, day_high, day_low, volume, prev_close)
  // are preserved, stream fields (price, change_pct, updated_at, timestamp) overlay.
  // This ensures developing candles get session OHLC from REST + live price from stream.
  //
  // CRITICAL: only merge for tickers in the CURRENT subscription set. streamPrices
  // accumulates entries from prior subscriptions (we never delete keys on unsubscribe);
  // without this filter, charts could see stale prices for unrelated tickers from
  // earlier sessions, e.g. AAPL's old price showing up while viewing MSFT.
  const tickerSet = useMemo(() => new Set(tickers.filter(Boolean)), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  const mergedPrices = useMemo(() => {
    const result = {}
    for (const sym of tickerSet) {
      const merged = { ...polledPrices[sym], ...streamPrices[sym] }
      if (merged.price != null || merged.day_open != null) result[sym] = merged
    }
    return result
  }, [polledPrices, streamPrices, tickerSet])

  return { prices: mergedPrices, isLoading: !connected && isLoading, isStreaming: connected, staleSymbols }
}
