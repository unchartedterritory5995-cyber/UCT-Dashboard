// app/src/components/chart/patternShapes/LevelSegment.jsx — a BOUNDED horizontal level.
//
// Used for a detection's secondary levels (uct_* setups: pad pivot, gap edge, prior low,
// MA…) and for a trusted detector's breakout pivot (levels.entry). Unlike HorizontalLine,
// which spans the whole chart, this runs from the first anchor to the last (and on to
// `extendRight` px past it), so a level reads as belonging to the structure that made it.
import { getColor, getOpacity } from './style'

export default function LevelSegment({ detection, tToX, priceToY, onClick, extendRight = 0, dashed = true }) {
  const anchors = detection?.geometry?.anchors || []
  if (!anchors.length) return null
  const price = anchors[0].price
  const y = priceToY(price)
  if (y == null) return null
  const xs = anchors.map((a) => tToX(a.t)).filter((v) => v != null)
  if (!xs.length) return null
  const x1 = Math.min(...xs)
  const x2 = Math.max(...xs) + extendRight
  if (x2 - x1 < 1) return null

  const color = getColor(detection)
  const opacity = getOpacity(detection)
  const label = detection?.geometry?.label || detection?.pattern_name || ''

  return (
    <g
      data-shape="level-segment"
      onClick={() => onClick?.(detection)}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    >
      <line
        x1={x1}
        y1={y}
        x2={x2}
        y2={y}
        stroke={color}
        strokeWidth={1.25}
        strokeDasharray={dashed ? '4,3' : undefined}
        opacity={opacity}
      />
      {label && (
        <text x={x2 + 4} y={y + 3} fontSize="10" fill={color} opacity={opacity}
          style={{ pointerEvents: 'none' }}>
          {label}
        </text>
      )}
    </g>
  )
}
