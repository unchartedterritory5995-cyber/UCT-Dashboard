// ⭐ THE RIGHT-MARGIN POLICY — ONE OWNER (2026-11-11, chart-data consolidation P2).
//
// Where the newest candle sits when a chart is pinned to the present: at LAST_CANDLE_POS
// of the plot width, with a PIXEL minimum gap (so a narrow workspace widget's newest
// candle clears the price-scale tags) capped at MAX_RIGHT_GAP_FRAC (so a thin widget
// does not spend a sixth of its width on blank space).
//
// Consumers: data/barStore/framing.js (imports this today) and StockChart's default
// zoom + W-R's `pinNewestRange` (charts/symbol-switch-pinned), which still carry their
// own copies of these values — `rightMargin.parity.test.js` pins the copies equal until
// StockChart imports from here (W-R / P3-S3). Do not add a third copy.

export const LAST_CANDLE_POS = 0.95
export const MIN_RIGHT_GAP_PX = 34
export const MAX_RIGHT_GAP_FRAC = 0.16

const finite = (x) => typeof x === 'number' && Number.isFinite(x)

/** The newest candle's x as a fraction of the plot width. */
export function lastCandlePos(plotWidthPx) {
  if (!finite(plotWidthPx) || plotWidthPx <= 0) return LAST_CANDLE_POS
  const gap = Math.min(MAX_RIGHT_GAP_FRAC, Math.max(1 - LAST_CANDLE_POS, MIN_RIGHT_GAP_PX / plotWidthPx))
  return 1 - gap
}

/** Empty logical slots right of the newest bar for a visible width W. */
export function rightMarginBars(width, plotWidthPx) {
  return width * (1 - lastCandlePos(plotWidthPx))
}

/** The one "newest candle pinned right" logical range (W-R's signature): the newest REAL
 *  bar at logical `lastIdx`, `width` bars visible, `reserve` seeded future slots (D/W/M
 *  developing-period slot; 0 intraday) kept between it and the margin. */
export function pinNewestRange(lastIdx, width, plotWidthPx, reserve = 0) {
  const to = lastIdx + (reserve > 0 ? reserve : 0) + rightMarginBars(width, plotWidthPx)
  return { from: to - width, to }
}
