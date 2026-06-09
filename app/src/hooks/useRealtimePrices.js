import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import useLivePrices from './useLivePrices'
import * as realtimeCandle from '../lib/realtimeCandle'
import { STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS } from '../utils/streamStatus'

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
  const retryDelayRef = useRef(5000)  // exponential backoff: 5→10→20s (capped)
  const lastMsgRef = useRef(Date.now())   // epoch ms of the last inbound event (any type, incl. heartbeat)
  const watchdogRef = useRef(null)         // setInterval id for the silent-death watchdog

  // Massive REST polling always runs (2s) — provides session OHLC + volume
  const { prices: polledPrices, isLoading } = useLivePrices(tickers)

  const sorted = [...new Set(tickers)].sort().join(',')

  const connect = useCallback(() => {
    if (!sorted || esRef.current) return

    const es = new EventSource(`/api/stream/prices?tickers=${sorted}`)
    esRef.current = es
    lastMsgRef.current = Date.now()

    es.onopen = () => {
      setConnected(true)
      lastMsgRef.current = Date.now()
      retryDelayRef.current = 5000  // reset backoff on successful connection
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
    }

    es.onmessage = (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        setStreamPrices(prev => ({ ...prev, ...data }))
      } catch {}
    }

    // Heartbeat (named event, 15s): keeps the connection alive AND lets the
    // watchdog distinguish a quiet-but-healthy stream from a dead one.
    es.addEventListener('heartbeat', () => { lastMsgRef.current = Date.now() })

    es.addEventListener('stale', (event) => {
      lastMsgRef.current = Date.now()
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
      lastMsgRef.current = Date.now()
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

    es.addEventListener('tick', (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        if (data?.sym) realtimeCandle.applyTick(data.sym, data.price, data.vol, data.ts)
      } catch {}
    })

    es.addEventListener('bar_close', (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        if (data?.sym && data?.bar) realtimeCandle.applyBarClose(data.sym, data.tf || "1", data.bar)
      } catch {}
    })

    es.addEventListener('bar_correction', (event) => {
      lastMsgRef.current = Date.now()
      try {
        const data = JSON.parse(event.data)
        if (data?.sym && data?.bar) realtimeCandle.applyCorrection(data.sym, data.tf || "1", data.bar)
      } catch {}
    })

    es.onerror = () => {
      setConnected(false)
      // Don't clear streamPrices — show last known prices rather than blanking
      // the UI on a transient network hiccup or brief server restart.
      es.close()
      if (esRef.current === es) esRef.current = null  // identity guard: don't clobber a newer es a watchdog reconnect may have opened
      if (watchdogRef.current) { clearInterval(watchdogRef.current); watchdogRef.current = null }
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, STREAM_RECONNECT_CAP_MS)  // cap at 20s
      reconnectRef.current = setTimeout(() => connect(), delay)
    }

    // Silent-death watchdog: EventSource.onerror is unreliable at detecting a
    // connection dropped behind a proxy. If nothing (not even the 15s heartbeat)
    // arrives for STREAM_WATCHDOG_MS, force a reconnect instead of waiting.
    if (watchdogRef.current) clearInterval(watchdogRef.current)
    watchdogRef.current = setInterval(() => {
      if (esRef.current === es && Date.now() - lastMsgRef.current > STREAM_WATCHDOG_MS) {
        clearInterval(watchdogRef.current)
        watchdogRef.current = null
        setConnected(false)
        try { es.close() } catch {}
        if (esRef.current === es) esRef.current = null
        retryDelayRef.current = 5000  // prompt recovery after a silent stall
        connect()
      }
    }, STREAM_WATCHDOG_TICK_MS)
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
      if (watchdogRef.current) {
        clearInterval(watchdogRef.current)
        watchdogRef.current = null
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
