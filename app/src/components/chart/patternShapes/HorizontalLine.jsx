// app/src/components/chart/patternShapes/HorizontalLine.jsx — support/resistance, volume nodes (HVN/LVN),
// major horizontal trendlines, u_and_r, remount level.
//
// Anchors: 1 or 2 points defining the price level. We always extend the line across the full visible
// chart width — horizontal levels are conceptually infinite, not bounded by their detection window.
//
// Subtype hints (from detection):
//   - detection.pattern_id starts with 'support' or detection.direction === 'bullish' → green
//   - 'resistance' / 'bearish' → red
//   - 'volume_profile_nodes' / 'major_trendlines' → neutral gold
//
// Label letter:
//   support → 'S', resistance → 'R', HVN/LVN keep their detection.pattern_label,
//   else fall back to the first letter of the pattern_id.
import {
  getColor,
  getOpacity,
  getStrokeWidth,
  getGlowFilter,
  formatLabel,
} from './style'

function rightEdgeLabel(detection) {
  const pid = (detection?.pattern_id || '').toLowerCase()
  if (pid.includes('support')) return 'S'
  if (pid.includes('resistance')) return 'R'
  if (pid.includes('hvn')) return 'HVN'
  if (pid.includes('lvn')) return 'LVN'
  if (pid.includes('u_and_r')) return 'U&R'
  if (pid.includes('remount')) return 'RM'
  return (pid[0] || '?').toUpperCase()
}

export default function HorizontalLine({ detection, tToX, priceToY, onClick }) {
  const anchors = detection?.geometry?.anchors || []
  if (!anchors.length) return null

  // The "price level" — average if two anchors at slightly different prices, else just the first.
  const level =
    anchors.length >= 2
      ? (anchors[0].price + anchors[1].price) / 2
      : anchors[0].price
  const y = priceToY(level)
  if (y == null) return null

  // Determine line span. SVG <line> across full width by using SVG coordinate space — we'll use
  // a very wide x range and rely on the parent SVG's viewport to clip. Since the parent <svg> in
  // PatternOverlay is sized to the chart container with no viewBox transform, we span from -10000
  // to +10000 (effectively the full chart). The text label uses the rightmost visible anchor x.
  const x1 = -10000
  const x2 = 10000

  // Anchor count heuristic for line weight — high-touch levels get solid stroke, low-touch dashed.
  const touchCount = detection?.touch_count ?? detection?.geometry?.touch_count ?? anchors.length
  const isHighTouch = touchCount >= 3
  const dash = isHighTouch ? 'none' : '6,4'

  const color = getColor(detection)
  const opacity = getOpacity(detection)
  const sw = getStrokeWidth(detection)
  const glow = getGlowFilter(detection)

  // Position the label at the rightmost anchor x, falling back to the second anchor or first.
  const labelAnchor = anchors[anchors.length - 1]
  const labelX = tToX(labelAnchor.t) ?? tToX(anchors[0].t) ?? 100
  const letter = rightEdgeLabel(detection)

  return (
    <g
      onClick={() => onClick?.(detection)}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    >
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={dash}
        opacity={opacity}
        filter={glow}
      />
      {/* Right-edge label badge — letter + pattern name */}
      <rect
        x={(labelX ?? 100) + 6}
        y={y - 9}
        width={letter.length > 1 ? 28 : 18}
        height={18}
        rx={3}
        fill={color}
        opacity={opacity * 0.9}
      />
      <text
        x={(labelX ?? 100) + 6 + (letter.length > 1 ? 14 : 9)}
        y={y + 4}
        fontSize="10"
        fontWeight="600"
        textAnchor="middle"
        fill="#0a0a0a"
        style={{ pointerEvents: 'none' }}
      >
        {letter}
      </text>
      <text
        x={(labelX ?? 100) + 6 + (letter.length > 1 ? 32 : 22)}
        y={y + 4}
        fontSize="10"
        fill={color}
        opacity={opacity * 0.8}
      >
        {formatLabel(detection)}
      </text>
    </g>
  )
}
