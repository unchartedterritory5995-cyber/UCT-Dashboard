// app/src/components/chart/chromeGeometry.js
//
// ─── WHICH EDGE DOES EACH PIECE OF CHROME BELONG TO? ────────────────────────
//
// ⚰️⚰️ THREE SURFACES WERE POSITIONED FROM ONE NUMBER — `panes[0].getHeight()` —
// and that number meant "the price pane" only for as long as Price had to be the
// first pane. Pane ordering made it wrong, and it was wrong in two different
// directions at once (owner, on production, UCTA50 with QQQ moved above it):
//
//   · the OHLC legend stayed at the top, over QQQ, labelling the wrong pane;
//   · the 3M/6M/YTD/1Y/5Y/Origin lookback bar flew to the top of the workspace,
//     because `containerHeight − height(QQQ)` is nearly the whole chart.
//
// ⭐⭐ THE FIX IS NOT AN OFFSET, IT IS AN OWNERSHIP QUESTION, and the two kinds
// must not be collapsed into one coordinate system:
//
//   PRICE-OWNED      the OHLC legend, the drawing toolbar, the responsive
//     collapse. These belong to the pane the CANDLES are in, wherever it sits.
//   WORKSPACE-OWNED  the lookback bar. It belongs to the GLOBAL TIME AXIS — the
//     bottom of the whole pane stack — and must not move when Price does.
//
// These are pure so the answer can be asserted per layout instead of inferred
// from a screenshot; `__tests__/chromeGeometry.test.js` walks Price top, middle
// and bottom and pins both kinds at once.

/** The separator lightweight-charts draws between panes. */
export const PANE_SEPARATOR_PX = 1

const heightsOf = (paneHeights) => (Array.isArray(paneHeights) ? paneHeights : [])

/**
 * The top edge of pane `index`, in container coordinates.
 *
 * ⛔ IT SUMS THE PANES ABOVE IT, INCLUDING THEIR SEPARATORS — the same rule
 * `pinPaneLegend` uses for an oscillator readout, so every label on the chart is
 * placed by one piece of arithmetic rather than three that can drift apart.
 */
export function paneTopPx(paneHeights, index, separatorPx = PANE_SEPARATOR_PX) {
  const hs = heightsOf(paneHeights)
  if (!Number.isInteger(index) || index <= 0) return 0
  let top = 0
  for (let i = 0; i < index && i < hs.length; i++) {
    top += (Number.isFinite(hs[i]) ? hs[i] : 0) + separatorPx
  }
  return top
}

/**
 * Where the PRICE pane is — `{ top, height, bottom }` — by identity.
 *
 * @param {number[]} paneHeights every pane's height, in render order
 * @param {number}   priceIndex  the pane the CANDLE SERIES is in
 *
 * ⚠️ `priceIndex` IS ASKED OF THE SERIES, NEVER GUESSED. The caller reads
 * `candleSeriesRef.current.getPane().paneIndex()`; a non-integer degrades to 0,
 * which is the unarranged chart and therefore the old behaviour exactly.
 */
export function pricePaneBox(paneHeights, priceIndex, separatorPx = PANE_SEPARATOR_PX) {
  const hs = heightsOf(paneHeights)
  const idx = (Number.isInteger(priceIndex) && priceIndex >= 0 && priceIndex < hs.length)
    ? priceIndex : 0
  const top = paneTopPx(hs, idx, separatorPx)
  const height = Number.isFinite(hs[idx]) ? hs[idx] : 0
  return { top, height, bottom: top + height }
}

/**
 * How far above the container's bottom the LOOKBACK BAR sits.
 *
 * ⛔⛔ IT TAKES NO PANE ARGUMENT AT ALL, AND THAT IS THE POINT. This bar is not
 * Price's, not pane 0's, not the last pane's — it belongs to the global time
 * axis, so the only thing it may depend on is the axis' own height. Anything
 * that made it a function of a pane would move it the next time the member
 * reordered one, which is the defect it exists to prevent.
 *
 * @param {number} timeAxisHeight `chart.timeScale().height()`
 */
export function lookbackBottomPx(timeAxisHeight, gapPx = 8, fallbackAxisPx = 28) {
  const axis = Number.isFinite(timeAxisHeight) && timeAxisHeight > 0
    ? timeAxisHeight : fallbackAxisPx
  return Math.round(Math.max(30, axis + gapPx))
}

/**
 * The top of the VOLUME pane's own readout.
 *
 * ⚠️ THE THIRD INSTANCE OF THE SAME STALE ASSUMPTION, found while tracing the
 * other two: this was `height(pane 0) + 5`, i.e. "just under the first pane",
 * which is the volume pane only on an unarranged chart. Volume is independently
 * orderable, so it is asked for by index like everything else.
 */
export function volumePaneTopPx(paneHeights, volumeIndex, separatorPx = PANE_SEPARATOR_PX) {
  return paneTopPx(paneHeights, volumeIndex, separatorPx)
}

/**
 * ⭐⭐ THE WHOLE CHROME DECISION, IN ONE PURE FUNCTION.
 *
 * The sampler used to make four placement decisions inline, from one shared
 * `panes[0].getHeight()`. Sharing that number is what let one stale assumption
 * become three bugs, and keeping the decisions inline is what made them
 * un-assertable — they could only be checked by photographing the chart.
 *
 * So the sampler now READS the chart and APPLIES this plan, and nothing else.
 * Every ownership claim in the header above is a line in the returned object,
 * and `__tests__/chromeGeometry.test.js` asserts the object per layout.
 *
 * ⛔ NOTE WHICH INPUTS REACH WHICH OUTPUT. `lookbackBottom` is computed from
 * `timeAxisHeight` alone — if a future edit makes it read `paneHeights`, the
 * lookback bar starts moving when panes are reordered, and that is the exact
 * defect the owner photographed.
 *
 * @param {object} m                 what the sampler measured off the live chart
 * @param {number[]} m.paneHeights   every pane's height, in render order
 * @param {number}   m.priceIndex    the pane the CANDLE series is in
 * @param {number|null} [m.volumeIndex] the pane the VOLUME series is in, or null
 * @param {number}   m.timeAxisHeight `chart.timeScale().height()`
 * @param {number}   [m.separatorPx]
 */
export function chromePlan(m) {
  const heights = heightsOf(m?.paneHeights)
  const sep = Number.isFinite(m?.separatorPx) ? m.separatorPx : PANE_SEPARATOR_PX
  const price = pricePaneBox(heights, m?.priceIndex, sep)

  // PRICE-OWNED. The legend, the drawing toolbar and the responsive-collapse
  // threshold are all questions about the pane the candles are in.
  const volumeIndex = Number.isInteger(m?.volumeIndex) ? m.volumeIndex : null
  return {
    priceTop: price.top,
    priceHeight: price.height,
    priceBottom: price.bottom,
    // The CSS custom property `--price-pane-top`; every Price-owned surface
    // offsets by it, so they cannot drift apart from one another.
    pricePaneTopPx: price.top,
    // The band the vertical legend must stay clear of — Price's own bottom,
    // less the range-selector strip. Was `height(pane 0) - 34`.
    collapseThresholdPx: price.bottom - 34,
    // WORKSPACE-OWNED. No pane term appears on this line, by design.
    lookbackBottom: lookbackBottomPx(m?.timeAxisHeight),
    // The volume pane's own readout, +5 for the inset the CSS expects.
    volumeLegendTop: volumeIndex === null
      ? Math.round(price.bottom + sep + 5)
      : Math.round(volumePaneTopPx(heights, volumeIndex, sep) + 5),
  }
}

/**
 * The vertical range an axis drag should PIN, given the pane the candles are in.
 *
 * ⚰️�idea THE CAPTURE USED PHYSICAL PANE 0'S HEIGHT AND CALLED IT PRICE'S.
 * The result is not a transient misdraw: it is handed to the candle series'
 * `autoscaleInfoProvider`, which returns it in place of autoscale, and the
 * view-lock persists it — so one drag on a chart with a pane above Price writes
 * a wrong range that survives every reload. Measured on production: NVDA ~212
 * with the scale reading 200 → 880 and the candles pressed into the bottom ~8%.
 *
 * ⛔ THE MARGINS ARE WHY THE PIXELS ARE INSET. `autoscaleInfoProvider` returns
 * `{minValue,maxValue}` and lightweight-charts re-adds `scaleMargins` as padding
 * AROUND it. Capturing at the full pane extent hands back a range that already
 * includes the margins, which are then applied a second time and the candles
 * compress once more on release. Reading at the INSET boundaries captures
 * exactly the range that maps back to those same pixels.
 *
 * @param {number} paneHeight        the CANDLE pane's own height
 * @param {{top:number,bottom:number}} scaleMargins
 * @param {(y:number)=>number} coordinateToPrice  the candle series' mapping
 * @returns {{minValue:number,maxValue:number}|null} null when unusable
 */
export function capturedPriceRange(paneHeight, scaleMargins, coordinateToPrice) {
  if (!(Number.isFinite(paneHeight) && paneHeight > 0)) return null
  if (typeof coordinateToPrice !== 'function') return null
  const sm = (scaleMargins && Number.isFinite(scaleMargins.top) && Number.isFinite(scaleMargins.bottom))
    ? scaleMargins : { top: 0, bottom: 0 }
  const hi = coordinateToPrice(sm.top * paneHeight)
  const lo = coordinateToPrice(paneHeight - sm.bottom * paneHeight)
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || !(hi > lo)) return null
  return { minValue: lo, maxValue: hi }
}

/**
 * The view lock a vertical gesture should STORE, as fractions of the candle pane.
 *
 * ⚰️⚰️ THE FRAME MIX THAT POISONED SAVED LAYOUTS. `priceToCoordinate` answers in
 * the CANDLES' pane; the caller used to divide by `chart.paneSize().height`,
 * which is the FIRST pane. While Price was always first those were one number.
 * With a pane above Price they are not, and `yHi / paneHeight` saturates — `top`
 * lands on the 0.9 clamp and the stored lock leaves the candles ~10% of their
 * pane. `persistViewLock` writes it and `vertMarginsRef` re-applies it ahead of
 * the computed margins, so it survives every reload.
 *
 * ⛔ THE CLAMPS ARE REAL AND STAY. 0.9 per side and a 0.95 combined ceiling are
 * the shipped guards; the defect was never the clamp, it was reaching it from a
 * denominator that did not belong to the measured coordinates.
 *
 * @param {number} paneHeight  the CANDLE pane's own height
 * @param {number} yHi         pixel row of the highest visible price
 * @param {number} yLo         pixel row of the lowest visible price
 * @returns {{top:number,bottom:number}|null}
 */
export function viewLockFractions(paneHeight, yHi, yLo) {
  if (!(Number.isFinite(paneHeight) && paneHeight > 8)) return null
  if (!Number.isFinite(yHi) || !Number.isFinite(yLo)) return null
  let top = Math.min(0.9, Math.max(0, yHi / paneHeight))
  let bottom = Math.min(0.9, Math.max(0, (paneHeight - yLo) / paneHeight))
  if (top + bottom > 0.95) { const k = 0.95 / (top + bottom); top *= k; bottom *= k }
  return { top: +top.toFixed(4), bottom: +bottom.toFixed(4) }
}
