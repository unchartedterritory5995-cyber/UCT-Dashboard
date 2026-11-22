// ── THE BARS PUSH FEED BUILD GATE — one owner ───────────────────────────────────────
// Is the Massive bars push feed (/api/stream/bars, lib/barsStreamManager) ON in this build?
// `VITE_REALTIME_BARS === '1'` (docs/feature_flags.json; HELD at 0 by owner ruling 2026-09-12).
// lib/barsStreamManager is DARK until a CONSUMER gates on this — it does not gate itself — so
// every consumer reads it here, never `import.meta.env` directly:
//   • hooks/useRealtimeBars   (legacy Writer B: subscribes only when on)
//   • data/barStore/liveFeed  (the BarStore's push subscription: only when on; off ⇒ the tick
//                              fallback is the one live source, exactly as legacy charts run)
// Read at CALL time (not module load) so a test can stub the env; a build without
// import.meta.env fails CLOSED.
export function realtimeBarsEnabled() {
  try { return import.meta.env.VITE_REALTIME_BARS === '1' } catch { return false }
}
