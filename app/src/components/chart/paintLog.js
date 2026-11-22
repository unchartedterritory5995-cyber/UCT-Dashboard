// ── PAINT LOG (2026-11-19): every `updateChart` pass, its plan, in a 120-entry ring on
// `window.__uctPaints`, so a live measurement can count how many FULL repaints a ticker
// switch costs (a full pass re-sets every series). Read-only diagnostics; nothing reads it.
const _PAINT_LOG_MAX = 120
export function recordPaint(sym, tf, bars, mode) {
  if (typeof window === 'undefined') return
  try {
    const log = window.__uctPaints || (window.__uctPaints = [])
    log.push({ at: Math.round(performance.now()), sym, tf, bars, mode })
    if (log.length > _PAINT_LOG_MAX) log.splice(0, log.length - _PAINT_LOG_MAX)
  } catch { /* diagnostics only */ }
}
