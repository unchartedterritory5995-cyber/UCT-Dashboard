// app/src/components/chart/patternShapes/CandleEmphasis.jsx — Package 8D
// foundation for the original product requirement: highlight the EXACT
// source candle a detector fired on with a white outline, while the
// candle's own body keeps rendering its normal bullish/bearish color
// underneath (this component draws OVER the existing candle series, never
// recolors it).
//
// KNOWN, DISCLOSED LIMITATION: `halfWidthPx` is an APPROXIMATION derived
// from the chart's timeScale bar-spacing option (see PatternOverlay.jsx),
// not the exact rendered candle-body width from the underlying chart
// library. It tracks zoom level (recomputed every render) but will not be
// pixel-perfect at every zoom/theme combination. Getting exact candle-body
// width would require plumbing the chart/series objects (or a dedicated
// width API) deeper into the shape-renderer prop chain — deliberately not
// done in this package per its own "do not redesign the entire candlestick
// renderer unnecessarily" instruction; this is the smallest correct reusable
// hook, not the final pixel-exact version.
//
// Used today only by CandleMark.jsx for power_earnings_gap's gap candle
// (semantic_subtype "gap_event"). Designed to be reusable by any future
// family with a real open/close-priced source candle (e.g. single-candle
// candlestick families) — nothing here is PEG-specific.
export default function CandleEmphasis({ xCenter, yOpen, yClose, halfWidthPx, opacity = 1 }) {
  if ([xCenter, yOpen, yClose, halfWidthPx].some((v) => v == null || Number.isNaN(v))) return null
  const top = Math.min(yOpen, yClose)
  const bottom = Math.max(yOpen, yClose)
  const height = Math.max(bottom - top, 2) // floor so a doji-like open==close is still visible
  const width = Math.max(halfWidthPx * 2, 2)

  return (
    <rect
      x={xCenter - width / 2}
      y={top}
      width={width}
      height={height}
      rx={1}
      fill="none"
      stroke="#ffffff"
      strokeWidth={1.5}
      opacity={opacity}
      style={{ pointerEvents: 'none' }}
    />
  )
}
