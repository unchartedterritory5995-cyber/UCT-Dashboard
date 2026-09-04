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

export default function TrendlinePair({ detection, tToX, priceToY, onClick }) {
  const anchors = detection?.geometry?.anchors || []
  if (anchors.length < 4) return null
  const [a, b, c, d] = anchors
  const roles = detection?.geometry?.anchor_roles
  const hasRoles = Array.isArray(roles) && roles.length === anchors.length

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
