// ── NET-CHANGE CANDLE COLOURS (moved out of StockChart's updateChart, 2026-11-23, next-row chart walks item ii) ──
//
// Color each candle by close-vs-PREVIOUS-close (TC2000 / StockCharts style) instead of LWC's built-in close-vs-open.
// LWC only auto-colors by open/close at the series level, so net-change coloring requires a per-bar
// color/borderColor/wickColor override on the DATA. Rather than touch the ~20 developing-bar writer sites, the
// series' setData/update are wrapped ONCE so every write path (historical setData, gold setup/catalyst highlight,
// live ticks) is colored consistently. The gold-highlight override is preserved (bars that already carry an explicit
// color are left untouched). Colors are read LIVE (`readNC`, StockChart's `netColorsRef`, updated every render) so a
// color change repaints via setData without recreating the series (no shake).

import { parseColor } from '../../utils/dividerColor'
import { SET_DATA_PAINTED } from './windowedChart'

/** A hollow body: the colour's own RGB at alpha 0 (the pill and the candle keep their hue). */
export const _hollowFill = (c) => {
  const rgb = parseColor(c)
  return rgb ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)` : 'rgba(0,0,0,0)'
}

const isInsideBar = (bar, prevBar) => (
  prevBar
  && bar.high != null && bar.low != null && prevBar.high != null && prevBar.low != null
  && bar.high <= prevBar.high && bar.low >= prevBar.low
)

/** One bar's colours: `prevClose` / `prevBar` are the previous bar WITH a close (null for the first). */
export function paintNetBar(bar, prevClose, prevBar, readNC) {
  if (!bar || bar.close == null) return bar
  if (bar.color != null) return bar   // preserve an explicit override (gold highlight)
  const NC = readNC()
  // Sunrise's black inside-day candles are part of the theme's signature
  // look, so they paint in EVERY color mode — checked before the openclose
  // passthrough (below) which otherwise skips all per-bar painting. The
  // fill still follows close-vs-open (TC2000): an inside day that closed
  // above its open is a HOLLOW black outline, below = filled black.
  if (NC.insideBlack && isInsideBar(bar, prevBar)) {
    const openUpIn = bar.open != null ? bar.close >= bar.open : true
    return { ...bar, color: (NC.noBody || (NC.hollow && openUpIn)) ? 'rgba(0,0,0,0)' : '#000000', borderColor: '#000000', wickColor: '#000000' }
  }
  if (NC.mode === 'openclose') return bar   // native close-vs-open coloring (Body off rides the series colours)
  // One color: every bar the same body/border/wick (shape still hollow on up).
  if (NC.mode === 'onecolor') {
    const up = bar.open != null ? bar.close >= bar.open : true
    const body = NC.noBody ? 'rgba(0,0,0,0)' : (NC.hollow && up) ? _hollowFill(NC.one) : NC.one
    return { ...bar, color: body, borderColor: NC.one, wickColor: NC.one }
  }
  // TC2000 hollow-candle semantics: COLOR and FILL are independent axes.
  // Direction (net-change close-vs-prev-close, or close-vs-open in that
  // mode) drives the green/red palette; close-vs-OPEN alone drives the
  // hollow/filled body. So a green candle that closed below its open is
  // FILLED green, and a red candle that closed above its open is HOLLOW
  // red — all four combinations render.
  let up
  if (NC.mode === 'netchange') {
    if (prevClose == null) return bar   // first bar — no prior close to compare
    up = bar.close >= prevClose
  } else {
    up = bar.open != null ? bar.close >= bar.open : true
  }
  const openUp = bar.open != null ? bar.close >= bar.open : up
  const body = NC.noBody ? 'rgba(0,0,0,0)' : (NC.hollow && openUp) ? _hollowFill(up ? NC.up : NC.down) : (up ? NC.up : NC.down)
  return { ...bar, color: body, borderColor: (up ? NC.borUp : NC.borDown), wickColor: (up ? NC.wickUp : NC.wickDown) }
}

/**
 * ⭐ (2026-11-23, next-row chart walks, item ii) THE PAINTED ROWS `from..end` OF A WHOLE-ARRAY PASS, WITHOUT THE PASS.
 * The pass carries one thing from row to row: the previous row WITH a close (its close and its high/low). So the rows
 * from `from` on are painted from the last such row before `from`, found by stepping back over rows with no close:
 * `paintNetFrom(rows, from, readNC)` equals the whole pass's painted array `.slice(from)` (netChangePaint.window.test.js
 * C1/C2). `prevBar` is the previous row itself here (the paint reads only its high and low).
 */
export function paintNetFrom(rows, from, readNC) {
  let prev = null, prevBar = null
  for (let j = from - 1; j >= 0; j--) {
    const b = rows[j]
    if (b && b.close != null) { prev = b.close; prevBar = b; break }
  }
  const out = new Array(rows.length - from)
  for (let i = from; i < rows.length; i++) {
    const b = rows[i]
    if (b && b.close != null) {
      out[i - from] = paintNetBar(b, prev, prevBar, readNC)
      prev = b.close
      prevBar = b
    } else {
      out[i - from] = b
    }
  }
  return out
}

/** The developing-bar refs a whole pass over `data` ends with: the last row with a close and the one before it. */
function netRefsOf(data) {
  let last = -1, before = -1
  for (let i = data.length - 1; i >= 0; i--) {
    const b = data[i]
    if (b && b.close != null) {
      if (last < 0) last = i
      else { before = i; break }
    }
  }
  const hl = (i) => ({ high: data[i].high, low: data[i].low })
  return {
    netPrevClose: last >= 0 && before >= 0 ? data[before].close : null,
    lastNetClose: last >= 0 ? data[last].close : null,
    netPrevBar: last >= 0 && before >= 0 ? hl(before) : null,
    lastNetBar: last >= 0 ? hl(last) : null,
    lastNetTime: data.length ? data[data.length - 1]?.time : null,
  }
}

/**
 * Wrap `series`' setData / update with the net-change paint, once.
 * ⭐ (2026-11-23, next-row chart walks, item ii) ON A RENDER-WINDOW SERIES ONLY THE ROWS HANDED TO THE LIBRARY ARE
 * PAINTED. The wrap re-mapped EVERY row at each setData (one new object per bar: ~1.3 ms a next-row press on a daily
 * chart, production profile) while the facade (chart/windowedChart.js) handed the library a window of ~750 of them.
 * It now hands the facade the rows as they came and the paint (`SET_DATA_PAINTED`): the facade paints the window it
 * cuts, and the rows an extension adds when it adds them, with the colours read at this setData (as the rows painted
 * here kept them before). What the library holds is what it held before; the refs are the whole pass's, read from the
 * tail. A series without the facade (the window switched off) is painted whole, as before.
 * @param {object} series  the price series (the render-window facade's, in StockChart)
 * @param {() => object} readNC  the live colours (StockChart `netColorsRef.current`)
 * @param {{netPrevCloseRef, lastNetCloseRef, netPrevBarRef, lastNetBarRef, lastNetTimeRef}} refs  what update()
 *   reads for the developing bar: the close and bar before the last, the last, and the last row's time
 */
export function installNetChangePaint(series, readNC, refs) {
  const { netPrevCloseRef, lastNetCloseRef, netPrevBarRef, lastNetBarRef, lastNetTimeRef } = refs
  const _realSet = series.setData.bind(series)
  const _realUpd = series.update.bind(series)
  const _setPainted = typeof series[SET_DATA_PAINTED] === 'function' ? series[SET_DATA_PAINTED] : null
  series.setData = (data) => {
    if (!Array.isArray(data)) return _realSet(data)
    // Refs the update() wrap reads for the developing bar: prev-of-last & the last bar.
    const r = netRefsOf(data)
    netPrevCloseRef.current = r.netPrevClose
    lastNetCloseRef.current = r.lastNetClose
    netPrevBarRef.current = r.netPrevBar
    lastNetBarRef.current = r.lastNetBar
    lastNetTimeRef.current = r.lastNetTime
    if (_setPainted) {
      const NC = readNC()               // this setData's colours, for every cut of these rows
      const ncNow = () => NC
      return _setPainted(data, (rows, from) => paintNetFrom(rows, from, ncNow))
    }
    return _realSet(paintNetFrom(data, 0, readNC))
  }
  series.update = (bar) => {
    if (!bar || bar.close == null) return _realUpd(bar)
    const isNewBar = lastNetTimeRef.current != null && bar.time > lastNetTimeRef.current
    const prevClose = isNewBar ? lastNetCloseRef.current : netPrevCloseRef.current
    const prevBar = isNewBar ? lastNetBarRef.current : netPrevBarRef.current
    const out = paintNetBar(bar, prevClose, prevBar, readNC)
    if (isNewBar) {
      netPrevCloseRef.current = lastNetCloseRef.current
      netPrevBarRef.current = lastNetBarRef.current
      lastNetTimeRef.current = bar.time
    }
    lastNetCloseRef.current = bar.close
    lastNetBarRef.current = { high: bar.high, low: bar.low }
    return _realUpd(out)
  }
  series.__uctNetWrap = true
}
