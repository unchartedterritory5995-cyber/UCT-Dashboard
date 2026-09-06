// app/src/components/chart/patternShapes/TrendlinePair.jsx — flags, wedges, pennants, triangles,
// channels, rectangles drawn as two trendlines.
//
// Geometry.anchors: [upper.p1, upper.p2, lower.p1, lower.p2] — 4 points defining two parallel-ish lines.
// We render both lines plus a low-opacity polygon fill connecting their endpoints (gives channels a
// translucent "lane" look without obscuring candles).
//
// Package 8D: when the detection carries `geometry.anchor_roles` (optional,
// additive — Phase-7/8's semantic-labels extension), line 1's label reflects
// its real role (e.g. "Pole" for high_tight_flag's pole_base->pole_top
// segment) instead of the generic pattern-name label every family got
// before. Anchor POSITIONS and the two drawn LINES are UNCHANGED either way
// — this only changes what the label text says, never what geometry the
// detector supplied or how it's drawn. A family with no anchor_roles (every
// family this hasn't been wired to) renders byte-identically to before.
//
// VCP geometry package: vcp.py's contraction sequence (start_high, one low
// per contraction, pivot) is a zigzag through N real points, not two
// independent lines — and, even at its minimum 2-contraction size, N is 4,
// the SAME anchor count every flag/wedge/triangle/channel family already
// uses. Dispatching on count alone would therefore leave VCP's own
// 2-contraction case on the untouched 2-line path (see below), which is
// wrong FOR VCP SPECIFICALLY: the detector's own pivot anchor is always the
// final contraction's HIGH — chronologically earlier than that same
// contraction's low, which sits one position earlier in the array — so the
// existing algorithm would draw that line running backward in time. VCP is
// therefore routed to the zigzag branch by `pattern_id`, exactly like
// CandleMark.jsx already special-cases `pattern_id === 'swing_pivots'` for
// its own family-specific geometry shape. Every OTHER "trendline_pair"
// family (still exactly 4 anchors) is completely unaffected — the
// exactly-4-anchor path below is untouched (no re-sort, no new branch) for
// anything that isn't VCP or doesn't exceed 4 anchors.
import {
  getColor,
  getOpacity,
  getStrokeWidth,
  getStrokeDasharray,
  getGlowFilter,
  formatLabel,
} from './style'

const ROLE_LABELS = {
  pole_base: 'Pole start', pole_top: 'Pole top',
  flag_low: 'Flag low', flag_high: 'Flag high',
}

const _IS_ZIGZAG_FAMILY = (detection) => detection?.pattern_id === 'vcp'

export default function TrendlinePair({ detection, tToX, priceToY, onClick }) {
  const anchors = detection?.geometry?.anchors || []
  if (anchors.length < 4) return null
  const roles = detection?.geometry?.anchor_roles
  const hasRoles = Array.isArray(roles) && roles.length === anchors.length

  const color = getColor(detection)
  const opacity = getOpacity(detection)
  const sw = getStrokeWidth(detection)
  const dash = getStrokeDasharray(detection)
  const glow = getGlowFilter(detection)

  if (anchors.length > 4 || _IS_ZIGZAG_FAMILY(detection)) {
    // Variable-length / zigzag geometry (currently only vcp.py, at every
    // contraction count including its own 4-anchor minimum). Sorting by
    // real timestamp and drawing every point as one connected zigzag draws
    // exactly the points the detector supplied, in the order they actually
    // happened, with nothing dropped and nothing invented. The 2-line/
    // polygon-fill shape below assumes exactly two independent lines, which
    // is undefined for a zigzag — so this path intentionally has no fill.
    const points = anchors
      .map((a, i) => ({ t: a.t, price: a.price, role: hasRoles ? roles[i] : undefined }))
      .sort((p1, p2) => p1.t - p2.t)
      .map((p) => ({ x: tToX(p.t), y: priceToY(p.price), role: p.role }))
    if (points.some((p) => p.x == null || p.y == null)) return null

    const last = points[points.length - 1]
    const lastLabel = hasRoles ? ROLE_LABELS[last.role] : undefined

    return (
      <g
        onClick={() => onClick?.(detection)}
        style={{ cursor: 'pointer', pointerEvents: 'auto' }}
      >
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeDasharray={dash}
          opacity={opacity}
          filter={glow}
        />
        <text x={last.x + 8} y={last.y + 4} fontSize="11" fill={color} opacity={opacity}>
          {lastLabel || formatLabel(detection)}
        </text>
      </g>
    )
  }

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
        {hasRoles ? (ROLE_LABELS[roles[1]] || formatLabel(detection)) : formatLabel(detection)}
      </text>
      {/* Package 8D: a second, smaller role label at line 2's endpoint — only
          when anchor_roles disambiguate what that line actually is (e.g.
          "Flag high" vs. a bare unlabeled second trendline). Purely additive
          text; draws nothing when roles are absent. */}
      {hasRoles && ROLE_LABELS[roles[3]] && (
        <text x={x4 + 8} y={y4 + 4} fontSize="10" fill={color} opacity={opacity * 0.85}>
          {ROLE_LABELS[roles[3]]}
        </text>
      )}
    </g>
  )
}
