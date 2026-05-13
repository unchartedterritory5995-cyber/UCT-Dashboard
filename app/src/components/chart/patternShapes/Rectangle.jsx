// app/src/components/chart/patternShapes/Rectangle.jsx — rectangle pattern, flat base, range detection.
//
// Anchor layouts:
//   2 anchors → [upper_left, lower_right] (diagonal corners)
//   4 anchors → [top_left, top_right, bottom_right, bottom_left] (full corners) — we just bound them
//
// Either way we compute the SVG <rect> bounding box from the anchor extremes. Forming patterns get
// dashed strokes; triggered patterns get solid thick strokes.
import {
  getColor,
  getOpacity,
  getStrokeWidth,
  getStrokeDasharray,
  getGlowFilter,
  formatLabel,
} from './style'

export default function Rectangle({ detection, tToX, priceToY, onClick }) {
  const anchors = detection?.geometry?.anchors || []
  if (anchors.length < 2) return null

  const pts = anchors.map((a) => ({ x: tToX(a.t), y: priceToY(a.price) }))
  if (pts.some((p) => p.x == null || p.y == null)) return null

  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(...xs) - x
  const height = Math.max(...ys) - y
  if (width <= 0 || height <= 0) return null

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
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={color}
        fillOpacity={opacity * 0.08}
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={dash}
        opacity={opacity}
        filter={glow}
      />
      {/* Top-right label */}
      <text x={x + width + 8} y={y + 12} fontSize="11" fill={color} opacity={opacity}>
        {formatLabel(detection)}
      </text>
    </g>
  )
}
