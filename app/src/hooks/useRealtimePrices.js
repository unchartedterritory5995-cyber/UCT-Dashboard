import { useState, useEffect, useRef, useCallback } from 'react'
import useLivePrices from './useLivePrices'

/**
 * Real-time price streaming via Server-Sent Events.
 * Falls back to REST polling (useLivePrices) if SSE unavailable.
 *
 * Returns same shape as useLivePrices: { prices: {SYM: {price, change_pct}}, isLoading }
 */
export default function useRealtimePrices(tickers = []) {
  const [streamPrices, setStreamPrices] = useState({})
  const [connected, setConnected] = useState(false)
  const esRef = useRef(null)
  const reconnectRef = useRef(null)

  // Massive REST polling always runs (2s) as parallel source + fallback.
  // Finnhub WebSocket overlays tick-by-tick on top when connected.
  const { prices: polledPrices, isLoading } = useLivePrices(tickers)

  const sorted = [...new Set(tickers)].sort().join(',')

  const connect = useCallback(() => {
    if (!sorted || esRef.current) return

    const es = new EventSource(`/api/stream/prices?tickers=${sorted}`)
    esRef.current = es

    es.onopen = () => {
      setConnected(true)
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

    es.onerror = () => {
      setConnected(false)
      es.close()
      esRef.current = null
      // Reconnect after 5 seconds
      reconnectRef.current = setTimeout(() => connect(), 5000)
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

  // Merge: stream prices take priority over polled prices
  const mergedPrices = { ...polledPrices, ...streamPrices }

  return { prices: mergedPrices, isLoading: !connected && isLoading, isStreaming: connected }
}
