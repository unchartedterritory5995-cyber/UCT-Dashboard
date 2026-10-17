// app/src/components/chart/patternShapes/PoleSegment.jsx — a bull flag's POLE (the run
// before the flag), from `geometry.extras.draw_pole = [{t, price: base low}, {t, price: top
// high}]` (api/services/pattern_engine/display.py). The v2 blind round (REPORT_TIERS_V2.md,
// 2026-10-17) found flags drawn with no pole at all. Display only.
import { getColor, getOpacity, getStrokeWidth } from './style'

export default function PoleSegment({ detection, tToX, priceToY, onClick }) {
  const pole = detection?.geometry?.extras?.draw_pole
  if (!Array.isArray(pole) || pole.length < 2) return null
  const [a, b] = pole
  const x1 = tToX(a.t)
  const x2 = tToX(b.t)
  const y1 = priceToY(a.price)
  const y2 = priceToY(b.price)
  if ([x1, x2, y1, y2].some((v) => v == null)) return null
  return (
    <line
      data-role="pole"
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={getColor(detection)}
      strokeWidth={getStrokeWidth(detection)}
      opacity={getOpacity(detection)}
      onClick={() => onClick?.(detection)}
      style={{ cursor: 'pointer', pointerEvents: 'auto' }}
    />
  )
}
