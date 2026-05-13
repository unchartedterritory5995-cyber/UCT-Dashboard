// app/src/components/chart/patternShapes/Neckline.jsx — H&S family + double/triple top/bottom.
//
// Two anchor layouts:
//   5 anchors → full H&S: [shoulder_left, trough_left, head, trough_right, shoulder_right]
//                → polyline silhouette through all 5 + dedicated neckline through the two troughs
//   3 anchors → double top/bottom: [peak1, trough, peak2]
//                → polyline through 3 + horizontal neckline at the trough level
//
// Triple top/bottom can come in as 5 anchors with the middle being the third pivot — we treat
// any 5-anchor case as full polyline + neckline-through-points-2-and-4, which renders correctly
// for triple variants too.
import {
  getColor,
  getOpacity,
  getStrokeWidth,
  getStrokeDasharray,
  getGlowFilter,
  formatLabel,
} from './style'

export default function Neckline({ detection, tToX, priceToY, onClick }) {
  const anchors = detection?.geometry?.anchors || []
  if (anchors.length < 3) return null

  // Project all anchors to pixel coordinates; bail if any are off-screen.
  const pts = anchors.map((a) => ({ x: tToX(a.t), y: priceToY(a.price), price: a.price }))
  if (pts.some((p) => p.x == null || p.y == null)) return null

  const color = getColor(detection)
  const opacity = getOpacity(detection)
  const sw = getStrokeWidth(detection)
  const dash = getStrokeDasharray(detection)
  const glow = getGlowFilter(detection)

  // Silhouette polyline through every anchor — the pattern's shape.
  const polylinePoints = pts.map((p) => `${p.x},${p.y}`).join(' ')

  // Neckline endpoints depend on anchor count.
  let neckStart, neckEnd
  if (pts.length >= 5) {
    // H&S / triple: trough_left = pts[1], trough_right = pts[3]
    neckStart = pts[1]
    neckEnd = pts[3]
  } else {
    // Double top/bottom: trough at pts[1]; extend horizontal beneath the two peaks
    const troughY = pts[1].y
    neckStart = { x: pts[0].x, y: troughY }
    neckEnd = { x: pts[2].x, y: troughY }
  }

  // Extend the neckline ~12% beyond each anchor so it visually continues past the pattern.
  const dx = neckEnd.x - neckStart.x
  const dy = neckEnd.y - neckStart.y
  const ext = 0.12
  const neckX1 = neckStart.x - dx * ext
  const neckY1 = neckStart.y - dy * ext
  const neckX2 = neckEnd.x + dx * ext
  const neckY2 = neckEnd.y + dy * ext

  // Label position — top-right corner of the pattern bounding box.
  const labelX = Math.max(...pts.map((p) => p.x)) + 8
  const labelY = Math.min(...pts.map((p) => p.y))

  return (
    <g
      onClick={() => onClick?.(detection)}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    >
      {/* Silhouette through all anchors */}
      <polyline
        points={polylinePoints}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={dash}
        opacity={opacity * 0.7}
        filter={glow}
      />
      {/* Dedicated neckline — solid (the trigger level) */}
      <line
        x1={neckX1}
        y1={neckY1}
        x2={neckX2}
        y2={neckY2}
        stroke={color}
        strokeWidth={sw}
        opacity={opacity}
        filter={glow}
      />
      {/* Anchor dots for visibility */}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} opacity={opacity} />
      ))}
      <text x={labelX} y={labelY} fontSize="11" fill={color} opacity={opacity}>
        {formatLabel(detection)}
      </text>
    </g>
  )
}
