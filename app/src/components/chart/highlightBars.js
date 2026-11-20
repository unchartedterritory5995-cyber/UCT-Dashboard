// Which bar(s) a "highlight this day" request paints (StockChart `highlightBarTime`).
//   • an exact bar time wins (daily bars, an intraday epoch);
//   • INTRADAY + a calendar day 'YYYY-MM-DD': every bar of that session (chart time is the ET wall
//     clock as UTC seconds, so its UTC date is the session's ET date) — the breadth drill's Mark day;
//   • otherwise the ENCLOSING bar, the largest bar time <= the date (a weekly / monthly bar holding
//     the day, or a weekend / holiday date on daily bars).
// Pure, so the choice is testable without a chart.
export function resolveHighlightTimes(times, raws, adjustTime = (t) => t) {
  const arr = Array.isArray(raws) ? raws : [raws]
  const exact = new Set(times)
  const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number')
    ? a - b
    : (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
  const out = []
  for (const raw of arr) {
    if (raw == null) continue
    const target = adjustTime(raw)
    if (exact.has(target)) { out.push({ time: target, orig: raw }); continue }
    if (typeof target === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(target) && typeof times[0] === 'number') {
      let hit = false
      for (const t of times) {
        if (new Date(t * 1000).toISOString().slice(0, 10) === target) { out.push({ time: t, orig: raw }); hit = true }
      }
      if (hit) continue
    }
    let best = null
    for (const t of times) if (cmp(t, target) <= 0 && (best == null || cmp(t, best) > 0)) best = t
    if (best != null) out.push({ time: best, orig: raw })
  }
  return out.length ? out : null
}
