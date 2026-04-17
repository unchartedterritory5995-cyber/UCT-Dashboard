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
  const esRef = useRef(null)
  const reconnectRef = useRef(null)

  // Massive REST polling always runs (2s) — provides session OHLC + volume
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
      setStreamPrices({})
      es.close()
      esRef.current = null
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

  // Per-field merge: REST fields (day_open, day_high, day_low, volume, prev_close)
  // are preserved, stream fields (price, change_pct, updated_at, timestamp) overlay.
  // This ensures developing candles get session OHLC from REST + live price from stream.
  const mergedPrices = useMemo(() => {
    const allSyms = new Set([...Object.keys(polledPrices), ...Object.keys(streamPrices)])
    const result = {}
    for (const sym of allSyms) {
      result[sym] = { ...polledPrices[sym], ...streamPrices[sym] }
    }
    return result
  }, [polledPrices, streamPrices])

  return { prices: mergedPrices, isLoading: !connected && isLoading, isStreaming: connected }
}
