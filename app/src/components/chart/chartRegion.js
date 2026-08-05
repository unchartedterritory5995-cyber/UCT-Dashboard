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

/**
 * FLIP C. The same question against REAL PANES instead of bands.
 *
 * Under `paneMode() === 'panes'` an oscillator is not a slice of pane 0 any more,
 * so "which band contains this y" stops meaning anything and "which PANE contains
 * this y" starts. The caller reads the rectangles off the renderer
 * (`chart.panes()`) rather than re-deriving them, which is the whole point: the
 * bands resolver above computes geometry a SECOND time and can therefore be
 * right about a chart that does not exist. This one cannot — if the renderer put
 * the pane somewhere else, this resolver says where the renderer put it.
 *
 * Still plain numbers, still no lightweight-charts import. `panes` is an ordered
 * list of `{key, height}`: `key` is `null` for a pane the engine does not own
 * (the candles' pane 0, a separate volume pane), and a definition id for an
 * oscillator's own pane.
 *
 * Pane 0 keeps its BANDS, because two things still live inside it: the price area
 * and — when volume is in overlay mode — the volume band. `pane0Bands` is that
 * much of `computePaneMargins`' output (or `paneLayout`'s `pane0.volumeMargins`),
 * and it is read for pane 0 ONLY.
 *
 * @param {object} p
 * @param {number} p.x            click X relative to the chart container (px)
 * @param {number} p.y            click Y relative to the chart container (px)
 * @param {number} p.width        container width (px)
 * @param {number} p.height       container height (px)
 * @param {number} p.axisWidth    right price-axis width (px)
 * @param {number} p.timeAxisHeight bottom time-axis height (px)
 * @param {{key: string|null, height: number}[]} p.panes the renderer's panes, in order
 * @param {object} [p.pane0Bands] `{volume?: {top,bottom}}` as fractions of pane 0
 * @param {number} [p.separatorHeight=1] pane divider thickness (px)
 * @param {string} [p.volumePaneKey='volume'] the key a separate volume pane carries
 * @returns {{type:'priceAxis'|'timeAxis'|'volume'|'indicator'|'price', key?:string}}
 */
export function resolveChartRegionFromPanes(p) {
  const {
    x, y, width, height,
    axisWidth = 0,
    timeAxisHeight = 0,
    panes = [],
    pane0Bands = {},
    separatorHeight = 1,
    volumePaneKey = 'volume',
  } = p

  const plotBottom = height - timeAxisHeight
  if (y >= plotBottom) return { type: 'timeAxis' }
  if (axisWidth > 0 && x >= width - axisWidth) return { type: 'priceAxis' }

  let top = 0
  for (let i = 0; i < panes.length; i++) {
    const pane = panes[i] || {}
    const h = Number.isFinite(pane.height) ? pane.height : 0
    const bottom = top + h
    // The divider's own pixels are attributed to the pane ABOVE it, so this
    // returns exactly the same five region types the bands resolver does. A
    // sixth type would be a new branch every consumer has to learn for a
    // one-pixel strip, and the menu it would open does not exist yet.
    if (y < bottom + separatorHeight || i === panes.length - 1) {
      if (i === 0) {
        // Pane 0 still holds bands: the overlay-mode volume row is inside it.
        const band = pane0Bands && pane0Bands.volume
        if (band && h > 0) {
          const bandTop = band.top * h
          const bandBot = (1 - band.bottom) * h
          if (y >= bandTop && y <= bandBot) return { type: 'volume' }
        }
        return { type: 'price' }
      }
      if (!pane.key) return { type: 'volume' }
      if (pane.key === volumePaneKey) return { type: 'volume' }
      return { type: 'indicator', key: pane.key }
    }
    top = bottom + separatorHeight
  }
  return { type: 'price' }
}

// ⛔ NO LABEL TABLE HERE. `INDICATOR_LABELS` used to live on this line — nine
// hand-written names in a module whose header says it is "kept free of
// Lightweight-Charts / DOM objects so it can be unit-tested with plain numbers",
// i.e. a module whose whole point is not knowing what an indicator is. It was
// also the THIRD spelling of `Williams %R` in the tree. The resolver returns a
// KEY; `indicatorCatalog.labelFor(key)` names it, at the one call site that
// renders a title. `chartRegion.test.js` asserts this file exports the resolver
// and nothing else, so the table cannot quietly come back.
