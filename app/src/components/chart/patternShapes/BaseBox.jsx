// app/src/components/chart/patternShapes/BaseBox.jsx — a base (flat base, VCP, cup, Darvas…)
// drawn as a translucent zone with its top/floor edges, a dashed pivot line and a small label.
//
// Geometry (from api/services/auto_structures.box_to_detection):
//   anchors: [{t: start_t, price: top}, {t: end_t, price: floor}]
//   extras:  {top, floor, pivot, label, bars, sub_boxes: [{start_t, end_t, top, floor}]}
// Every number comes from base_catalog's own *_state function — this only draws them.
import { getColor, getOpacity, getStrokeDasharray } from './style'

export default function BaseBox({ detection, tToX, priceToY, onClick }) {
  const g = detection?.geometry || {}
  const ex = g.extras || {}
  const anchors = g.anchors || []
  if (anchors.length < 2) return null
  const top = ex.top ?? Math.max(anchors[0].price, anchors[1].price)
  const floor = ex.floor ?? Math.min(anchors[0].price, anchors[1].price)

  const x1 = tToX(anchors[0].t)
  const x2 = tToX(anchors[1].t)
  const yTop = priceToY(top)
  const yFloor = priceToY(floor)
  if ([x1, x2, yTop, yFloor].some((v) => v == null)) return null

  const left = Math.min(x1, x2)
  const width = Math.max(1, Math.abs(x2 - x1))
  const y = Math.min(yTop, yFloor)
  const height = Math.max(1, Math.abs(yFloor - yTop))

  const color = getColor(detection)
  const opacity = getOpacity(detection)
  const dash = getStrokeDasharray(detection) === 'none' ? undefined : getStrokeDasharray(detection)
  const pivotY = ex.pivot != null ? priceToY(ex.pivot) : null
  const label = ex.label || detection?.pattern_name || ''

  // `draw_sub_boxes` (server, display only): a cup's handle capped at the breakout
  // (REPORT_TIERS_V2.md 2026-10-17). Falls back to base_catalog's own sub-boxes.
  const subBoxes = Array.isArray(ex.draw_sub_boxes) ? ex.draw_sub_boxes : (ex.sub_boxes || [])
  const subs = subBoxes.map((sb, i) => {
    const sx1 = tToX(sb.start_t)
    const sx2 = tToX(sb.end_t)
    const sy1 = priceToY(sb.top)
    const sy2 = priceToY(sb.floor)
    if ([sx1, sx2, sy1, sy2].some((v) => v == null)) return null
    return (
      <rect
        key={i}
        data-role="sub-box"
        x={Math.min(sx1, sx2)}
        y={Math.min(sy1, sy2)}
        width={Math.max(1, Math.abs(sx2 - sx1))}
        height={Math.max(1, Math.abs(sy2 - sy1))}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeDasharray="2,2"
        opacity={opacity * 0.7}
      />
    )
  })

  return (
    <g
      data-shape="base-box"
      onClick={() => onClick?.(detection)}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    >
      <rect
        data-role="zone"
        x={left}
        y={y}
        width={width}
        height={height}
        fill={color}
        fillOpacity={opacity * 0.1}
        stroke="none"
      />
      <line data-role="top" x1={left} y1={yTop} x2={left + width} y2={yTop}
        stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={opacity} />
      <line data-role="floor" x1={left} y1={yFloor} x2={left + width} y2={yFloor}
        stroke={color} strokeWidth={1.5} strokeDasharray={dash} opacity={opacity} />
      {subs}
      {pivotY != null && (
        <line data-role="pivot" x1={left} y1={pivotY} x2={left + width + 40} y2={pivotY}
          stroke={color} strokeWidth={1.25} strokeDasharray="6,4" opacity={opacity} />
      )}
      <text
        data-role="label"
        x={left + 4}
        y={y - 5}
        fontSize="11"
        fill={color}
        opacity={opacity}
        style={{ pointerEvents: 'none' }}
      >
        {label}
      </text>
    </g>
  )
}
