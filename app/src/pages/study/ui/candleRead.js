// THE LAST CANDLE, MEASURED (round 21; owner, batch 21, on the lesson: "simpler to read and more direct as a teacher and
// mentor"). A teacher points at the candle and reads it: where it opened against yesterday, how low it went against
// yesterday's low, where it closed against yesterday's close and high, where in its own range it closed, and how heavy
// the volume was. Every number is measured from the bars in front of the member (the Blitz "quick read" rule); none is
// written by a model and none claims a rule fired.

const pct = (a, b) => (b ? (a / b - 1) * 100 : null)

/** The read of bar `i` against bar `i - 1` (and up to 50 sessions before it for volume). [] when there is no prior bar. */
export function readCandle(bars, i = (bars?.length || 0) - 1) {
  if (!bars || i < 1 || i >= bars.length) return []
  const b = bars[i]
  const p = bars[i - 1]
  const range = b.h - b.l
  const prior = bars.slice(Math.max(0, i - 50), i).map((x) => Number(x.v) || 0).filter((v) => v > 0)
  const avgV = prior.length >= 10 ? prior.reduce((s, v) => s + v, 0) / prior.length : null
  const rows = [
    { id: 'open', label: 'Open', value: pct(b.o, p.c), unit: '%', note: 'vs yesterday’s close' },
    { id: 'low', label: 'Low', value: pct(b.l, p.l), unit: '%', note: 'vs yesterday’s low' },
    { id: 'close', label: 'Close', value: pct(b.c, p.c), unit: '%', note: 'vs yesterday’s close' },
    { id: 'high', label: 'Close vs high', value: pct(b.c, p.h), unit: '%', note: 'vs yesterday’s high' },
    { id: 'range', label: 'Range', value: range > 0 ? ((b.c - b.l) / range) * 100 : null, unit: 'pos', note: 'where it closed in its day' },
    { id: 'volume', label: 'Volume', value: avgV ? (Number(b.v) || 0) / avgV : null, unit: 'x', note: `vs its ${prior.length}-day average` },
  ]
  return rows.filter((r) => r.value != null && Number.isFinite(r.value))
}

/** The display text of one read: "+0.48%", "72% up", "1.4x". */
export function readText(r) {
  if (!r) return ''
  if (r.unit === '%') return `${r.value >= 0 ? '+' : '−'}${Math.abs(r.value).toFixed(2)}%`
  if (r.unit === 'pos') return `${Math.round(r.value)}% up`
  if (r.unit === 'x') return `${r.value.toFixed(1)}x`
  return String(r.value)
}

/** The tone of one read: up / down / heavy (volume 1.5x and more) / '' (neutral). */
export function readTone(r) {
  if (!r) return ''
  if (r.unit === '%') return r.value > 0 ? 'up' : r.value < 0 ? 'down' : ''
  if (r.unit === 'pos') return r.value >= 60 ? 'up' : r.value <= 40 ? 'down' : ''
  if (r.unit === 'x') return r.value >= 1.5 ? 'heavy' : ''
  return ''
}
