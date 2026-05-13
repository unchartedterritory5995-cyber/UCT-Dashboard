// app/src/components/chart/patternShapes/TrendlinePair.jsx — flags, wedges, pennants, triangles,
// channels, rectangles drawn as two trendlines.
//
// Geometry.anchors: [upper.p1, upper.p2, lower.p1, lower.p2] — 4 points defining two parallel-ish lines.
// We render both lines plus a low-opacity polygon fill connecting their endpoints (gives channels a
// translucent "lane" look without obscuring candles).
import {
  getColor,
  getOpacity,
  getStrokeWidth,
  getStrokeDasharray,
  getGlowFilter,
  formatLabel,
} from './style'

export default function TrendlinePair({ detection, tToX, priceToY, onClick }) {
  const anchors = detection?.geometry?.anchors || []
  if (anchors.length < 4) return null
  const [a, b, c, d] = anchors

  const x1 = tToX(a.t)
  const y1 = priceToY(a.price)
  const x2 = tToX(b.t)
  const y2 = priceToY(b.price)
  const x3 = tToX(c.t)
  const y3 = priceToY(c.price)
  const x4 = tToX(d.t)
  const y4 = priceToY(d.price)
  if ([x1, y1, x2, y2, x3, y3, x4, y4].some((v) => v == null)) return null

  const color = getColor(detection)
  const opacity = getOpacity(detection)
  const sw = getStrokeWidth(detection)
  const dash = getStrokeDasharray(detection)
  const glow = getGlowFilter(detection)

  return (
    <g
      onClick={() => onClick?.(detection)}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    >
      {/* Translucent fill between the two lines — gives channels a "lane" feel */}
      <polygon
        points={`${x1},${y1} ${x2},${y2} ${x4},${y4} ${x3},${y3}`}
        fill={color}
        opacity={opacity * 0.08}
      />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={dash}
        opacity={opacity}
        filter={glow}
      />
      <line
        x1={x3}
        y1={y3}
        x2={x4}
        y2={y4}
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={dash}
        opacity={opacity}
        filter={glow}
      />
      {/* Label at the end of the upper line — slightly offset so it doesn't sit on the candle */}
      <text x={x2 + 8} y={y2 + 4} fontSize="11" fill={color} opacity={opacity}>
        {formatLabel(detection)}
      </text>
    </g>
  )
}
