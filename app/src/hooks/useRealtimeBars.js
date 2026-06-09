import { useEffect, useRef, useState, useCallback } from 'react'
import { STREAM_RECONNECT_CAP_MS } from '../utils/streamStatus'

/**
 * Real-time bar streaming via Server-Sent Events.
 *
 * Opens an EventSource for `/api/stream/bars?bars=<sym>:<tf>` and invokes
 * `onBar({sym, tf, bar})` for every incoming event. On connection drop, retries
 * with exponential backoff (5s → 10s → 20s cap). On (re)connect, calls
 * `onReconnect(lastBarT)` so the consumer can fire a REST gap-backfill.
 *
 * Disabled entirely when VITE_REALTIME_BARS !== '1' — returns {connected:false}
 * and never opens an EventSource.
 *
 * Pass empty `symbol` or `tf` to disable.
 */
export default function useRealtimeBars({ symbol, tf, onBar, onReconnect }) {
  const enabled = import.meta.env.VITE_REALTIME_BARS === '1' && !!symbol && !!tf
  const [connected, setConnected] = useState(false)
  const esRef = useRef(null)
  const reconnectRef = useRef(null)
  const retryDelayRef = useRef(5000)
  const lastBarTRef = useRef(null)
  const onBarRef = useRef(onBar)
  const onReconnectRef = useRef(onReconnect)

  // Keep refs current without re-running connect()
  useEffect(() => { onBarRef.current = onBar }, [onBar])
  useEffect(() => { onReconnectRef.current = onReconnect }, [onReconnect])

  const connect = useCallback(() => {
    if (!enabled || esRef.current) return

    const url = `/api/stream/bars?bars=${encodeURIComponent(symbol)}:${encodeURIComponent(tf)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onopen = () => {
      setConnected(true)
      retryDelayRef.current = 5000
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
      // On (re)connect, ask consumer to backfill from last seen bar.
      if (onReconnectRef.current) {
        try { onReconnectRef.current(lastBarTRef.current) } catch {}
      }
    }

    es.addEventListener('bar', (event) => {
      try {
        const data = JSON.parse(event.data)  // {sym, tf, bar:{t,o,h,l,c,v}}
        if (data?.bar?.t != null) lastBarTRef.current = data.bar.t
        if (onBarRef.current) onBarRef.current(data)
      } catch {}
    })

    es.onerror = () => {
      setConnected(false)
      es.close()
      esRef.current = null
      const delay = retryDelayRef.current
      retryDelayRef.current = Math.min(delay * 2, STREAM_RECONNECT_CAP_MS)  // cap at 20s (was 120s)
      reconnectRef.current = setTimeout(() => connect(), delay)
    }
  }, [enabled, symbol, tf])

  useEffect(() => {
    if (enabled) connect()
    return () => {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current)
        reconnectRef.current = null
      }
      setConnected(false)
    }
  }, [enabled, connect])

  return { connected, lastBarT: lastBarTRef }
}
