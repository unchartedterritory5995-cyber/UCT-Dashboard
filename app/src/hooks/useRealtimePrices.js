import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore } from 'react'
import useLivePrices from './useLivePrices'
import * as realtimeCandle from '../lib/realtimeCandle'
import * as priceStreamManager from '../lib/priceStreamManager'
import { STREAM_WATCHDOG_MS, STREAM_WATCHDOG_TICK_MS, STREAM_RECONNECT_CAP_MS } from '../utils/streamStatus'

/**
 * Real-time price streaming via Server-Sent Events.
 * Merges Finnhub WebSocket (tick-by-tick) with Massive REST (2s polling).
 *
 * Per-field merge: stream provides {price, change_pct, updated_at},
 * REST provides {day_open, day_high, day_low, prev_close, volume}.
 * Both combined give the chart everything it needs.
 *
 * POOLED (default): all hook instances share the priceStreamManager's
 * connection pool — one browser-wide EventSource union instead of one per
 * component (which piled 4-8 stream loops per user onto the single-process
 * backend). KILL-SWITCH: localStorage 'uct.ssePool.disabled' = '1' (then
 * refresh) reverts to the legacy per-instance implementation below.
 */

// Idle consumers (empty ticker list — e.g. a closed TickerPopup or a
// liveUpdates={false} StockChart) must never re-render on unrelated
// app-wide SSE publishes. This frozen object is a stable reference shared
// by every idle consumer, so useSyncExternalStore's Object.is check never
// sees a "change."
const EMPTY_SNAPSHOT = Object.freeze({ prices: Object.freeze({}), staleSymbols: new Set(), connected: false })
const getEmptySnapshot = () => EMPTY_SNAPSHOT

// Set merged.change_pct / merged.change so the day % TICKS with every trade.
//
// The day % drives the header day-change, the chart legend %, the watchlist %, and
// the theme %. We deliberately do NOT trust the SSE stream's own change_pct: its
// prev_close isn't seeded, so it flashes 0.00% (that's why % used to be routed
// straight from the server). But the REST feed is 15s-cached, so sourcing % ONLY
// from it pinned every % to a 15s cadence — the "not updating / updating slowly"
// regression. Instead we recompute the REGULAR-SESSION % on the client from the
// live streamed price + the OFFICIAL prev close (REST): it ticks with every trade
// AND can't flash 0 (the streamed PRICE is a real trade; a bad/≤0 price or missing
// prev close falls back to the server %). Extended hours keeps REST's frozen
// regular-session % — a post-market print must not move the day % — detected via
// ext_session (null only during regular trading).
// The stream's OWN session fields are UNTRUSTED: its change/change_pct are
// computed against an unseeded baseline (measured 2026-08-21: ORCL streamed
// +0.20% while the true day move was +3.78%), and a null field in a stream
// entry would clobber a real REST value in the spread. price / volume /
// timestamps are the stream's only trusted contribution; everything
// session-scoped (prev_close, change, change_pct, day_*, ext_*) belongs to
// REST or to _applyLiveChange's recompute. Without this strip, any moment
// REST is absent (first render, hidden-tab wake, REST blip) painted the
// stream's garbage % on every row.
export function _streamSafe(streamed) {
  if (!streamed) return streamed
  const {
    change_pct: _c1, change: _c2, prev_close: _c3,
    day_open: _c4, day_high: _c5, day_low: _c6, day_close: _c7,
    ext_price: _c8, ext_session: _c9,
    ...safe
  } = streamed
  return safe
}

function _applyLiveChange(merged, rest) {
  if (!rest) return
  const px = Number(merged.price)
  const prevClose = Number(rest.prev_close)
  if (rest.ext_session == null && px > 0 && prevClose > 0) {
    merged.change_pct = ((px - prevClose) / prevClose) * 100
    merged.change = px - prevClose
  } else {
    if (rest.change_pct != null) merged.change_pct = rest.change_pct
    if (rest.change != null) merged.change = rest.change
  }
}

// Freshen `ext_price` — the extended-hours last trade — from the stream.
//
// WHY: ext_price/ext_session are produced ONLY by the 15s-cached REST snapshot
// (`lastTrade.p`); realtime_stream's _STREAM_FIELDS strips them, so nothing on the
// SSE path could ever advance them. The chart's orange "Pre"/"Post" axis chip reads
// ext_price, so pre-market it crawled at 15s while the watchlist's Price cell — fed
// by the same Massive tick feed at ~1s — ran ahead of it. Same feed, same instant,
// two different numbers on screen.
//
// PROVENANCE IS THE WHOLE POINT of doing this here rather than server-side: only
// this merge knows whether `price` came from the STREAM (a real extended-hours
// print) or from REST's fallback chain. That chain is `day.c || lastTrade.p ||
// prevDay.c`, and post-market `day.c` is the REGULAR-session close — promoting that
// to ext_price would paint the 4pm close as the live post-market price. So we only
// promote a STREAMED price, and only while REST says we're in an extended session.
// Exported for test: the "only a STREAMED price, only in an extended session" rule
// is the guard that stops the regular-session close being painted as a live
// post-market print, and it deserves a rail of its own.
export function _applyLiveExtPrice(merged, rest, streamed) {
  if (!rest || rest.ext_session == null) return
  const px = Number(streamed?.price)
  if (px > 0) merged.ext_price = px
}

function usePooledRealtimePrices(tickers = []) {
  // Massive REST polling always runs (2s) — provides session OHLC + volume
  const { prices: polledPrices, isLoading } = useLivePrices(tickers)

  const sorted = [...new Set(tickers)].sort().join(',')

  const subscribeStore = useCallback(
    (onStoreChange) => {
      if (!sorted) return () => {}   // idle consumer: never registers, never notified
      return priceStreamManager.subscribe(sorted.split(','), onStoreChange)
    },
    [sorted],
  )
  // Idle consumers read a frozen empty snapshot so unrelated app-wide publishes
  // can never re-render them (the manager's snapshot is one shared object).
  const getSnap = sorted ? priceStreamManager.getSnapshot : getEmptySnapshot
  const snap = useSyncExternalStore(subscribeStore, getSnap, getSnap)

  // Per-field merge: REST fields are preserved, stream fields overlay.
  // CRITICAL: only merge for tickers in the CURRENT subscription set — the
  // manager's price store is a browser-wide accumulator; without this filter,
  // consumers would see prices for unrelated tickers from other components.
  const tickerSet = useMemo(() => new Set(tickers.filter(Boolean)), [sorted]) // eslint-disable-line react-hooks/exhaustive-deps
  const mergedPrices = useMemo(() => {
    const result = {}
    for (const sym of tickerSet) {
      const rest = polledPrices[sym]
      const streamed = snap.prices[sym]
      const merged = { ...rest, ..._streamSafe(streamed) }
      _applyLiveChange(merged, rest)
      _applyLiveExtPrice(merged, rest, streamed)
      if (merged.price != null || merged.day_open != null) result[sym] = merged
    }
    return result
  }, [polledPrices, snap.prices, tickerSet])

  const staleSymbols = useMemo(() => {
    const filtered = new Set()
    for (const sym of tickerSet) {
      if (snap.staleSymbols.has(sym)) filtered.add(sym)
    }
    return filtered
  }, [snap.staleSymbols, tickerSet])

  return {
    prices: mergedPrices,
    isLoading: !snap.connected && isLoading,
    isStreaming: snap.connected,
    staleSymbols,
  }
}

// ── Legacy per-instance implementation (kill-switch fallback) ────────────────
// This is the pre-pooling implementation, byte-for-byte behavior. Remove only
// after the pool has weeks of green prod.

function useLegacyRealtimePrices(tickers = []) {
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
      const rest = polledPrices[sym]
      const streamed = streamPrices[sym]
      const merged = { ...rest, ..._streamSafe(streamed) }
      _applyLiveChange(merged, rest)
      _applyLiveExtPrice(merged, rest, streamed)
      if (merged.price != null || merged.day_open != null) result[sym] = merged
    }
    return result
  }, [polledPrices, streamPrices, tickerSet])

  return { prices: mergedPrices, isLoading: !connected && isLoading, isStreaming: connected, staleSymbols }
}

// Kill-switch decided at MODULE LOAD (never per-render — that would violate
// the rules of hooks). Flipping the flag requires a page refresh.
const POOL_DISABLED = (() => {
  try { return localStorage.getItem('uct.ssePool.disabled') === '1' } catch { return false }
})()

export default POOL_DISABLED ? useLegacyRealtimePrices : usePooledRealtimePrices
