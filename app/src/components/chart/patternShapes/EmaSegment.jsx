// app/src/components/chart/patternShapes/EmaSegment.jsx — the EMA (or SMA: `draw_ema.kind`) a pullback setup names,
// drawn over the pullback window (lab/geometry_eval REPORT_TIERS_V2.md, 2026-10-17: the
// judges saw "a flat line on the pivot high, not the 10 EMA").
//
// Points come from the server (`geometry.extras.draw_ema = {period, points: [{t, price}]}`,
// api/services/pattern_engine/display.py), seeded exactly as the detector seeds its EMA, so
// the last point IS the level the detector measured. Display only.
import { getColor, getOpacity, getStrokeWidth, getStrokeDasharray, formatLabel } from './style'

export default function EmaSegment({ detection, tToX, priceToY, onClick }) {
  const ema = detection?.geometry?.extras?.draw_ema
  const raw = Array.isArray(ema?.points) ? ema.points : []
  const pts = []
  for (const p of raw) {
    const x = tToX(p.t)
    const y = priceToY(p.price)
    if (x == null || y == null) continue
    pts.push([x, y])
  }
  if (pts.length < 2) return null
  const color = getColor(detection)
  const opacity = getOpacity(detection)
  const [lx, ly] = pts[pts.length - 1]
  // Team set (uct_pullback_ma_v5): the MA it tagged may be an SMA, and the tag bar is marked.
  const maName = ema.kind === 'sma' ? 'SMA' : 'EMA'
  const tagX = ema.tag ? tToX(ema.tag.t) : null
  const tagY = ema.tag ? priceToY(ema.tag.price) : null
  return (
    <g
      data-shape="ema-segment"
      onClick={() => onClick?.(detection)}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    >
      <polyline
        data-role="ema"
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={getStrokeWidth(detection)}
        strokeDasharray={getStrokeDasharray(detection)}
        opacity={opacity}
      />
      <text x={lx + 6} y={ly + 4} fontSize="10" fill={color} opacity={opacity}
        style={{ pointerEvents: 'none' }}>
        {`${ema.period} ${maName} · ${formatLabel(detection)}`}
      </text>
      {tagX != null && tagY != null && (
        <path
          data-role="tag-bar"
          d={`M ${tagX} ${tagY + 4} l -5 9 l 10 0 z`}
          fill={color}
          opacity={opacity}
        />
      )}
    </g>
  )
}
