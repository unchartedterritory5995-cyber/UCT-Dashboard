// Pure derivation of the chart's live-feed status from the realtime-prices hook
// signals, plus the shared stream tuning constants. No React, no side effects.

// No inbound event (incl. the 15s heartbeat) for this long ⇒ treat the SSE as
// silently dead and force a reconnect (EventSource.onerror is unreliable behind
// a proxy).
export const STREAM_WATCHDOG_MS = 30000
// How often the watchdog checks.
export const STREAM_WATCHDOG_TICK_MS = 10000
// Max reconnect backoff (was 120000) — recover within ~20s on a trading chart.
export const STREAM_RECONNECT_CAP_MS = 20000

// Single cadence for how often accumulated live data is FLUSHED TO THE SCREEN —
// governs both the on-chart candle repaint (realtimeCandle) and the number/percent
// readouts (watchlist %, theme %, chart legend, header day-change). Ticks keep
// arriving and accumulating underneath at full speed; this only throttles the
// visible re-render/repaint so the UI feels calm instead of frantic. The 2s REST
// poll stays the freshness floor beneath this. Raise to slow, lower to speed up.
export const LIVE_UI_CADENCE_MS = 750

// Precedence: a dead connection outranks a server-stale symbol.
export function streamStatus({ isStreaming, isStale }) {
  if (!isStreaming) return { state: 'reconnecting', label: 'RECONNECTING', tone: 'warn' }
  if (isStale) return { state: 'stale', label: 'STALE', tone: 'warn' }
  return { state: 'live', label: 'LIVE', tone: 'live' }
}
