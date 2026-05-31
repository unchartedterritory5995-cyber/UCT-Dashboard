// app/src/components/chart/chartRegion.js
// Pure geometry helper: map a right-click coordinate on a StockChart to the
// chart "region" underneath it (price area, volume, an indicator sub-pane, or
// an axis). The region drives a context-aware right-click menu.
//
// Kept free of Lightweight-Charts / DOM objects so it can be unit-tested with
// plain numbers. Overlay-line (MA) proximity is refined by the caller, which
// has the live series objects — this resolver only decides the coarse region
// and returns 'price' for the open price area.

/**
 * @param {object} p
 * @param {number} p.x            click X relative to the chart container (px)
 * @param {number} p.y            click Y relative to the chart container (px)
 * @param {number} p.width        container width (px)
 * @param {number} p.height       container height (px)
 * @param {number} p.axisWidth    right price-axis width (px)
 * @param {number} p.timeAxisHeight  bottom time-axis height (px)
 * @param {object} p.paneMargins  computePaneMargins() output — { main, volume?, rsi?, ... } as {top,bottom} fractions of pane-0 height
 * @param {boolean} p.separateVolume  true when volume lives in its own pane (pane 1)
 * @param {number} p.pane0Height  height of pane 0 (px). When !separateVolume this equals the plot height.
 * @param {number} [p.separatorHeight=1] pane divider thickness (px)
 * @returns {{type:'priceAxis'|'timeAxis'|'volume'|'indicator'|'price', key?:string}}
 */
export function resolveChartRegion(p) {
  const {
    x, y, width, height,
    axisWidth = 0,
    timeAxisHeight = 0,
    paneMargins = {},
    separateVolume = false,
    pane0Height,
    separatorHeight = 1,
  } = p

  const plotBottom = height - timeAxisHeight

  // Time axis takes precedence at the very bottom.
  if (y >= plotBottom) return { type: 'timeAxis' }

  // Right price axis (anywhere above the time axis).
  if (axisWidth > 0 && x >= width - axisWidth) return { type: 'priceAxis' }

  // Separate volume pane sits below pane 0, above the time axis.
  const H0 = Number.isFinite(pane0Height) ? pane0Height : plotBottom
  if (separateVolume) {
    const divider = H0 + separatorHeight
    if (y >= divider) return { type: 'volume' }
  }

  // Within pane 0: check stacked sub-bands (indicators + overlay-mode volume).
  for (const key of Object.keys(paneMargins)) {
    if (key === 'main') continue
    const band = paneMargins[key]
    if (!band) continue
    const bandTop = band.top * H0
    const bandBot = (1 - band.bottom) * H0
    if (y >= bandTop && y <= bandBot) {
      return key === 'volume' ? { type: 'volume' } : { type: 'indicator', key }
    }
  }

  // Anything else in pane 0 is the open price area.
  return { type: 'price' }
}

// Indicator key → human label for menu titles.
export const INDICATOR_LABELS = {
  rsi: 'RSI',
  macd: 'MACD',
  stoch: 'Stochastic',
  atr: 'ATR',
  cci: 'CCI',
  williamsR: 'Williams %R',
  mfi: 'MFI',
  adx: 'ADX',
  obv: 'OBV',
}
