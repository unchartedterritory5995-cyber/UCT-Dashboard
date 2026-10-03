// app/src/components/chart/engine/barColours.js
//
// ─── ⭐⭐ B1: PINE'S `barcolor(…)` — THE CHART'S OWN CANDLES, RECOLOURED ──────
//
// `barcolor(c)` paints the chart's main bars in `c` on every bar where `c` is not
// `na`. Lightweight-charts carries a colour per data point on a candlestick or bar
// series (`color` / `borderColor` / `wickColor`), so the override is applied to
// the candles' own DATA — drawn by the library exactly as it draws any candle —
// rather than painted over them, which could neither match the candle's geometry
// to the pixel nor make a candle transparent (a script may ask for that).
//
// The binder computes `time → colour` (`binder.syncPaints`); the chart component
// owns the candles and wraps its price series ONCE so every write path — the
// historical `setData`, the gold highlight, every live `update` — passes through
// `applyBarColour`. These are the pure halves of that wrap.
//
// ⛔ AN EXPLICIT COLOUR ON THE INCOMING BAR WINS. The chart already colours some
// bars on purpose (a highlighted setup candle), and a script's paint must not
// silently erase a highlight the member asked for.

/** One bar, recoloured when the map names its time. Anything that is not an OHLC
 *  point (a line chart's `{time, value}`, whitespace) passes through untouched. */
export function applyBarColour(bar, map) {
  if (!map || !bar || bar.open == null || bar.color != null) return bar
  const c = map.get(String(bar.time))
  if (typeof c !== 'string') return bar
  return { ...bar, color: c, borderColor: c, wickColor: c }
}

/** Every bar of a `setData` payload, recoloured where the map names it. Returns
 *  the SAME array when nothing changes, so a chart with no `barcolor` hands the
 *  library exactly the array it always did. */
export function applyBarColours(data, map) {
  if (!map || !map.size || !Array.isArray(data)) return data
  let out = null
  for (let i = 0; i < data.length; i += 1) {
    const b = applyBarColour(data[i], map)
    if (b !== data[i]) {
      if (!out) out = data.slice()
      out[i] = b
    }
  }
  return out || data
}

/** The times whose override differs between two maps (either may be null). */
export function changedBarKeys(prev, next) {
  const out = new Set()
  const a = prev || new Map()
  const b = next || new Map()
  for (const [k, v] of a) if (b.get(k) !== v) out.add(k)
  for (const [k, v] of b) if (a.get(k) !== v) out.add(k)
  return out
}

/**
 * Wrap a price series once so every write is recoloured from `read()`'s current
 * map, and remember the UNcoloured payload so a changed map can be re-applied
 * without the caller re-supplying its data.
 *
 * ⛔ THE RAW COPY TRACKS `update()` TOO. A re-apply from a payload that predates
 * the live writers would roll the developing bar back to the last full paint —
 * the exact defect `_applyData`'s no-op guard exists to prevent.
 *
 * @returns {boolean} true when the series was wrapped by this call
 */
export function wrapSeriesForBarColours(series, read) {
  if (!series || series.__uctBarColourWrap || typeof series.setData !== 'function') return false
  const realSet = series.setData.bind(series)
  const realUpd = typeof series.update === 'function' ? series.update.bind(series) : null
  series.__uctBarRaw = null
  series.setData = (data) => {
    series.__uctBarRaw = Array.isArray(data) ? data.slice() : null
    return realSet(applyBarColours(data, read()))
  }
  if (realUpd) {
    series.update = (bar, ...rest) => {
      const raw = series.__uctBarRaw
      if (raw && bar && bar.time != null) {
        const last = raw[raw.length - 1]
        if (last && last.time === bar.time) raw[raw.length - 1] = bar
        else if (!last || bar.time > last.time) raw.push(bar)
      }
      return realUpd(applyBarColour(bar, read()), ...rest)
    }
  }
  series.__uctBarColourWrap = true
  return true
}

/**
 * Re-apply a changed override map to a wrapped series: an `update()` of the last
 * bar when that is all that changed (the live case), else one `setData` of the
 * remembered payload. Nothing at all when nothing changed.
 * @returns {'none'|'update'|'setData'}
 */
export function reapplyBarColours(series, prev, next) {
  if (!series || !series.__uctBarColourWrap) return 'none'
  const raw = series.__uctBarRaw
  if (!Array.isArray(raw) || !raw.length) return 'none'
  const changed = changedBarKeys(prev, next)
  if (!changed.size) return 'none'
  const last = raw[raw.length - 1]
  if (changed.size === 1 && last && changed.has(String(last.time))) {
    series.update(last)
    return 'update'
  }
  series.setData(raw)
  return 'setData'
}
