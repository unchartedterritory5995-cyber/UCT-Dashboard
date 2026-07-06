import { useEffect, useRef, useState } from 'react'
import * as barsStreamManager from '../lib/barsStreamManager'

/**
 * Real-time bar streaming via the SHARED /api/stream/bars connection pool.
 *
 * Subscribes (sym, tf) to barsStreamManager — ONE pooled EventSource serves every
 * chart (was one per chart, the connection-multiplication class the price stream
 * was pooled to kill), and each `bar` event is dispatched only to its own (sym,tf)
 * so a pooled bar can never land on the wrong chart. Invokes `onBar({sym,tf,bar})`
 * per bar and `onReconnect(lastBarT)` on (re)connect (for a REST gap-backfill).
 *
 * Disabled entirely when VITE_REALTIME_BARS !== '1' — never subscribes and reports
 * not-delivering. Returns the pool's liveness for the consumer's single-writer gate:
 *   connected  — the pooled EventSource is open
 *   healthy    — connected AND a bar/heartbeat arrived within the watchdog window
 *   delivering — healthy AND a real bar for THIS (sym,tf) has arrived (so the chart
 *                only suppresses the Finnhub writers once push is PROVEN live)
 */
export default function useRealtimeBars({ symbol, tf, onBar, onReconnect }) {
  const enabled = import.meta.env.VITE_REALTIME_BARS === '1' && !!symbol && !!tf
  const [status, setStatus] = useState({ connected: false, healthy: false, delivering: false })
  const onBarRef = useRef(onBar)
  const onReconnectRef = useRef(onReconnect)
  const lastBarTRef = useRef(null)

  // Keep callbacks current without re-subscribing.
  useEffect(() => { onBarRef.current = onBar }, [onBar])
  useEffect(() => { onReconnectRef.current = onReconnect }, [onReconnect])

  useEffect(() => {
    if (!enabled) {
      setStatus({ connected: false, healthy: false, delivering: false })
      return undefined
    }
    // Bail when nothing changed so the pool's every-10s re-notify (which drives the
    // delivering recency gate) doesn't re-render a chart whose liveness is unchanged.
    const refresh = () => setStatus((prev) => {
      const next = barsStreamManager.getStatus(symbol, tf)
      return (prev.connected === next.connected && prev.healthy === next.healthy && prev.delivering === next.delivering)
        ? prev : next
    })
    const unsub = barsStreamManager.subscribe(symbol, tf, {
      onBar: (data) => {
        if (data?.bar?.t != null) lastBarTRef.current = data.bar.t
        if (onBarRef.current) onBarRef.current(data)
      },
      onReconnect: (lastBarT) => {
        if (onReconnectRef.current) {
          try { onReconnectRef.current(lastBarT ?? lastBarTRef.current) } catch { /* ignore */ }
        }
      },
      onStatus: refresh,
    })
    refresh()
    return () => unsub()
  }, [enabled, symbol, tf])

  return {
    connected: status.connected,
    healthy: status.healthy,
    delivering: status.delivering,
    lastBarT: lastBarTRef,
  }
}
