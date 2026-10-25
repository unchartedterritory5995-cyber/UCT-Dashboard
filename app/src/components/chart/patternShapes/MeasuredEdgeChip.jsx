// app/src/components/chart/patternShapes/MeasuredEdgeChip.jsx — the small "Measured edge" chip on a drawing's
// label (owner decision 2, 2026-10-24). Rendered ONLY for a row the server badged (`measured_edge`, from
// api/services/measured_edge.py); a row without it renders nothing. The tooltip states history with its sample,
// period and the out-of-sample check, plus a "Method" link to the in-app method page.
import { measuredEdgeOf, measuredEdgeTooltip, MEASURED_EDGE_CHIP, MEASURED_EDGE_METHOD_LABEL } from '../measuredEdge'

const CHIP_W = 86
const CHIP_H = 16

/** Where the chip sits: just above the drawing's right-most, highest anchor (null when it cannot be placed). */
export function chipAnchor(row) {
  const g = row?.geometry || {}
  const ex = g.extras || {}
  const pts = []
  const anchors = Array.isArray(ex.draw_anchors) && ex.draw_anchors.length ? ex.draw_anchors : g.anchors
  if (Array.isArray(anchors)) {
    for (const a of anchors) if (a && a.t != null && Number.isFinite(Number(a.price))) pts.push({ t: a.t, price: Number(a.price) })
  }
  for (const k of ['draw_pivot', 'draw_flat_top']) {
    const p = ex[k]
    if (p && Number.isFinite(Number(p.price)) && (p.end_t ?? p.start_t) != null) {
      pts.push({ t: p.end_t ?? p.start_t, price: Number(p.price) })
    }
  }
  if (!pts.length) return null
  const top = Math.max(...pts.map((p) => p.price))
  const last = pts.reduce((a, b) => (Number(b.t) > Number(a.t) ? b : a))
  return { t: last.t, price: top }
}

export default function MeasuredEdgeChip({ row, tToX, priceToY }) {
  const edge = measuredEdgeOf(row)
  if (!edge) return null
  const at = chipAnchor(row)
  if (!at) return null
  const x = tToX(at.t)
  const y = priceToY(at.price)
  if (x == null || y == null) return null
  const cx = x + 6
  const cy = y - CHIP_H - 8
  const tip = measuredEdgeTooltip(edge)
  return (
    <g data-testid="measured-edge-chip" data-pattern={row.pattern_id} style={{ pointerEvents: 'auto' }}>
      <title>{tip}</title>
      <rect x={cx} y={cy} width={CHIP_W} height={CHIP_H} rx={8} ry={8}
        fill="rgba(201,168,76,0.16)" stroke="#c9a84c" strokeWidth={1} />
      <text x={cx + CHIP_W / 2} y={cy + 11.5} textAnchor="middle" fontSize="10" fontWeight="600" fill="#c9a84c">
        {MEASURED_EDGE_CHIP}
      </text>
      <a href={edge.methodUrl} data-testid="measured-edge-method" aria-label="How the measured edge was measured">
        <title>{tip}</title>
        <text x={cx + CHIP_W + 6} y={cy + 11.5} fontSize="10" fill="#c9a84c" textDecoration="underline"
          style={{ cursor: 'pointer' }}>
          {MEASURED_EDGE_METHOD_LABEL}
        </text>
      </a>
    </g>
  )
}
