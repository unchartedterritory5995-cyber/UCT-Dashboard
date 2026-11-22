// A lightweight-charts time as the day key the Study bars carry. The library reports a daily bar's time as a
// BusinessDay object { year, month, day }; the bars (and the crosshair's `day`) use 'YYYY-MM-DD'. Intraday times
// are unix seconds on both sides and pass through.
export function tapDayKey(t) {
  if (t && typeof t === 'object' && t.year) return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
  return t
}
