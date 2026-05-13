// app/src/components/chart/patternShapes/CupCurve.jsx — cup-with-handle family + rounded base/top.
//
// Anchors:
//   3 anchors → [left_rim, cup_bottom, right_rim] — bare cup or rounded base/top
//   4–5 anchors → [left_rim, cup_bottom, right_rim, handle_low (, handle_high)] — cup + handle
//
// Quadratic Bezier trick: SVG Q's control point is NOT where the curve passes through. To make the
// curve actually pass through the cup_bottom anchor, the control point must be set so the curve's
// midpoint hits that anchor. For a quadratic, midpoint = 0.5*(p0 + p2) + 0.5*ctrl, so to make the
// midpoint equal to `cup_bottom`, we set ctrl = 2*cup_bottom - 0.5*(p0 + p2)*2 = 2*cup_bottom - p0 - p2.
//
// For inverse_cup_handle / rounded_top (direction === 'bearish'), the same math works — cup_bottom
// is actually the dome peak (higher price = lower pixel y), and the curve naturally bows upward.
import {
  getColor,
  getOpacity,
  getStrokeWidth,
  getStrokeDasharray,
  getGlowFilter,
  formatLabel,
} from './style'

export default function CupCurve({ detection, tToX, priceToY, onClick }) {
  const anchors = detection?.geometry?.anchors || []
  if (anchors.length < 3) return null

  const leftRim = { x: tToX(anchors[0].t), y: priceToY(anchors[0].price) }
  const cupBot = { x: tToX(anchors[1].t), y: priceToY(anchors[1].price) }
  const rightRim = { x: tToX(anchors[2].t), y: priceToY(anchors[2].price) }
  if ([leftRim, cupBot, rightRim].some((p) => p.x == null || p.y == null)) return null

  // Control point for the quadratic Bezier so the curve passes through cup_bottom.
  const ctrlX = 2 * cupBot.x - leftRim.x - rightRim.x + (leftRim.x + rightRim.x) / 2
  const ctrlY = 2 * cupBot.y - leftRim.y - rightRim.y + (leftRim.y + rightRim.y) / 2
  // Simplified: ctrl such that 0.5*ctrl + 0.25*(p0+p2) = cupBot  → ctrl = 2*cupBot - 0.5*(p0+p2)
  // Above formula derives the same result; recompute clean:
  const cleanCtrlX = 2 * cupBot.x - (leftRim.x + rightRim.x) / 2
  const cleanCtrlY = 2 * cupBot.y - (leftRim.y + rightRim.y) / 2

  const color = getColor(detection)
  const opacity = getOpacity(detection)
  const sw = getStrokeWidth(detection)
  const dash = getStrokeDasharray(detection)
  const glow = getGlowFilter(detection)

  // Optional handle as a thin rectangle outline from handle_low to handle_high.
  let handleRect = null
  if (anchors.length >= 5) {
    const hLow = { x: tToX(anchors[3].t), y: priceToY(anchors[3].price) }
    const hHigh = { x: tToX(anchors[4].t), y: priceToY(anchors[4].price) }
    if (hLow.x != null && hLow.y != null && hHigh.x != null && hHigh.y != null) {
      const rx = Math.min(hLow.x, hHigh.x)
      const ry = Math.min(hLow.y, hHigh.y)
      const rw = Math.abs(hHigh.x - hLow.x) || 4
      const rh = Math.abs(hHigh.y - hLow.y) || 4
      handleRect = (
        <rect
          x={rx}
          y={ry}
          width={rw}
          height={rh}
          fill={color}
          fillOpacity={opacity * 0.08}
          stroke={color}
          strokeWidth={sw}
          strokeDasharray={dash}
          opacity={opacity}
        />
      )
    }
  } else if (anchors.length === 4) {
    // Single handle point — draw a small marker at it.
    const h = { x: tToX(anchors[3].t), y: priceToY(anchors[3].price) }
    if (h.x != null && h.y != null) {
      handleRect = <circle cx={h.x} cy={h.y} r={4} fill={color} opacity={opacity} />
    }
  }

  const pathD = `M ${leftRim.x},${leftRim.y} Q ${cleanCtrlX},${cleanCtrlY} ${rightRim.x},${rightRim.y}`
  const labelX = rightRim.x + 8
  const labelY = rightRim.y + 4

  return (
    <g
      onClick={() => onClick?.(detection)}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    >
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeDasharray={dash}
        opacity={opacity}
        filter={glow}
      />
      {/* Rim markers */}
      <circle cx={leftRim.x} cy={leftRim.y} r={3} fill={color} opacity={opacity} />
      <circle cx={rightRim.x} cy={rightRim.y} r={3} fill={color} opacity={opacity} />
      {handleRect}
      <text x={labelX} y={labelY} fontSize="11" fill={color} opacity={opacity}>
        {formatLabel(detection)}
      </text>
    </g>
  )
}
