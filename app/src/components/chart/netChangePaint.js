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
 * Wrap `series`' setData / update with the net-change paint, once.
 * @param {object} series  the price series (the render-window facade's, in StockChart)
 * @param {() => object} readNC  the live colours (StockChart `netColorsRef.current`)
 * @param {{netPrevCloseRef, lastNetCloseRef, netPrevBarRef, lastNetBarRef, lastNetTimeRef}} refs  what update()
 *   reads for the developing bar: the close and bar before the last, the last, and the last row's time
 */
export function installNetChangePaint(series, readNC, refs) {
  const { netPrevCloseRef, lastNetCloseRef, netPrevBarRef, lastNetBarRef, lastNetTimeRef } = refs
  const _realSet = series.setData.bind(series)
  const _realUpd = series.update.bind(series)
  series.setData = (data) => {
    if (!Array.isArray(data)) return _realSet(data)
    let prev = null, lastPrev = null, prevBar = null, lastPrevBar = null
    const painted = data.map((b) => {
      if (b && b.close != null) {
        lastPrev = prev
        lastPrevBar = prevBar
        const out = paintNetBar(b, prev, prevBar, readNC)
        prev = b.close
        prevBar = { high: b.high, low: b.low }
        return out
      }
      return b
    })
    // Refs the update() wrap reads for the developing bar: prev-of-last & the last bar.
    netPrevCloseRef.current = lastPrev
    lastNetCloseRef.current = prev
    netPrevBarRef.current = lastPrevBar
    lastNetBarRef.current = prevBar
    lastNetTimeRef.current = painted.length ? data[data.length - 1]?.time : null
    return _realSet(painted)
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
