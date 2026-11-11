// THE LAST CANDLE, MEASURED (round 21; owner, batch 21, on the lesson: "simpler to read and more direct as a teacher and
// mentor"; batch 16, on the drill's chip: "if anything have % down from highs and % extended from MAs in a table graph").
// A teacher points at the candle and reads it: where it opened against yesterday, how low it went against yesterday's
// low, where it closed against yesterday's close, where in its own range it closed, how heavy the volume was, how far it
// sits under the chart's high, and how far it is stretched from the 20-day and 50-day averages (the averages on his
// chart: EMA 20, SMA 50). Every number is measured from the bars in front of the member (the Blitz "quick read" rule);
// none is written by a model and none claims a rule fired.

const pct = (a, b) => (b ? (a / b - 1) * 100 : null)

function ema(values, n) {
  if (values.length < n) return null
  let e = values.slice(0, n).reduce((s, v) => s + v, 0) / n     // seeded with the first n-session average
  const k = 2 / (n + 1)
  for (let i = n; i < values.length; i++) e = values[i] * k + e * (1 - k)
  return e
}

function sma(values, n) {
  if (values.length < n) return null
  return values.slice(values.length - n).reduce((s, v) => s + v, 0) / n
}

/** The read of bar `i` against bar `i - 1` (and the sessions before it for volume, the high and the averages).
 *  [] when there is no prior bar. */
export function readCandle(bars, i = (bars?.length || 0) - 1) {
  if (!bars || i < 1 || i >= bars.length) return []
  const b = bars[i]
  const p = bars[i - 1]
  const range = b.h - b.l
  const prior = bars.slice(Math.max(0, i - 50), i).map((x) => Number(x.v) || 0).filter((v) => v > 0)
  const avgV = prior.length >= 10 ? prior.reduce((s, v) => s + v, 0) / prior.length : null
  const upTo = bars.slice(0, i + 1)
  const closes = upTo.map((x) => x.c)
  const high = Math.max(...upTo.map((x) => x.h))
  const e20 = ema(closes, 20)
  const s50 = sma(closes, 50)
  const rows = [
    { id: 'open', label: 'Open', value: pct(b.o, p.c), unit: '%', note: 'vs yesterday’s close' },
    { id: 'low', label: 'Low', value: pct(b.l, p.l), unit: '%', note: 'vs yesterday’s low' },
    { id: 'close', label: 'Close', value: pct(b.c, p.c), unit: '%', note: 'vs yesterday’s close' },
    { id: 'range', label: 'Range', value: range > 0 ? ((b.c - b.l) / range) * 100 : null, unit: 'pos', note: 'where it closed in its day' },
    { id: 'volume', label: 'Volume', value: avgV ? (Number(b.v) || 0) / avgV : null, unit: 'x', note: `vs its ${prior.length}-day average` },
    { id: 'offHigh', label: 'Off the high', value: high > 0 ? pct(b.c, high) : null, unit: '%', note: 'close vs the chart’s high' },
    { id: 'vs20', label: 'vs 20-day', value: e20 ? pct(b.c, e20) : null, unit: '%', note: 'close vs the 20-day EMA' },
    { id: 'vs50', label: 'vs 50-day', value: s50 ? pct(b.c, s50) : null, unit: '%', note: 'close vs the 50-day SMA' },
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

/** The tone of one read: up / down / heavy (volume 1.5x and more) / '' (neutral; the distance under the high is a
 *  position, not a gain or a loss, so it is never coloured). */
export function readTone(r) {
  if (!r) return ''
  if (r.id === 'offHigh') return ''
  if (r.unit === '%') return r.value > 0 ? 'up' : r.value < 0 ? 'down' : ''
  if (r.unit === 'pos') return r.value >= 60 ? 'up' : r.value <= 40 ? 'down' : ''
  if (r.unit === 'x') return r.value >= 1.5 ? 'heavy' : ''
  return ''
}
