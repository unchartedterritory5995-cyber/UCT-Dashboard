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
export const LIVE_UI_CADENCE_MS = 1000

// The live CANDLE's own hold: how long the chart may sit on a tick before repainting the newest
// candle (realtimeCandle) and how long a developing bar from the push stream waits before it is
// dispatched (barsStreamManager). Separate from LIVE_UI_CADENCE_MS (the numeric readouts stay calm at
// 1 s). Was 1000 / 500 ms. Measured on production in RTH, 2026-11-17, 4 charts of 1m, paired runs:
// 250 ms cut the bar push stream's receive-to-paint p90 (see the plan report, section 10e) without
// raising long frames; 100 ms did raise them (2026-11-16), so 250 is the floor this default takes.
export const LIVE_CANDLE_CADENCE_MS = 250

// How long a chart may hold a live candle update before painting it. Defaults keep today's
// behaviour (the caller passes its own default). `localStorage['uct.liveCadenceMs']` overrides it
// for THIS browser only (16 to 1000 ms), so a faster cadence can be measured on production
// (uct-desktop scripts/proofs/tick-latency-proof.mjs --ls=uct.liveCadenceMs=50) before any default
// changes. Measured 2026-11-16: receive-to-paint p90 518 ms, sitting on the 500 ms hold.
export const LIVE_CADENCE_KEY = 'uct.liveCadenceMs'
export function liveCandleCadenceMs(defaultMs) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LIVE_CADENCE_KEY) : null
    if (raw == null || raw === '') return defaultMs
    const n = Number(raw)
    if (!Number.isFinite(n)) return defaultMs
    return Math.min(1000, Math.max(16, Math.round(n)))
  } catch { return defaultMs }
}

// Precedence: a dead connection outranks a server-stale symbol.
export function streamStatus({ isStreaming, isStale }) {
  if (!isStreaming) return { state: 'reconnecting', label: 'RECONNECTING', tone: 'warn' }
  if (isStale) return { state: 'stale', label: 'STALE', tone: 'warn' }
  return { state: 'live', label: 'LIVE', tone: 'live' }
}
