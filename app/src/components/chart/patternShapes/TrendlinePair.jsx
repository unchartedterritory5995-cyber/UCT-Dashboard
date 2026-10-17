// app/src/components/chart/patternShapes/TrendlinePair.jsx — flags, wedges, pennants, triangles,
// channels, rectangles drawn as two trendlines.
//
// Geometry.anchors: [upper.p1, upper.p2, lower.p1, lower.p2] — 4 points defining two parallel-ish lines.
// We render both lines plus a low-opacity polygon fill connecting their endpoints (gives channels a
// translucent "lane" look without obscuring candles).
//
// ⛔ `trendline_pair` IS NOT ONE SHAPE (lab/geometry_eval REPORT.md fix 2, 2026-10-16). Three
// families reuse the shape string with anchors that are NOT two lines, and drawing them
// positionally drew nonsense. They now carry `geometry.semantic_subtype` and are drawn by meaning:
//   pole_and_flag       high_tight_flag: [pole_base, pole_top, flag_low, flag_high] — a POLE
//                       segment plus the FLAG as a box (flag_low..flag_high), not a "lower line"
//                       from flag_low to flag_high.
//   contraction_zigzag  vcp: [start_high, contraction_low…, pivot] — a polyline through the
//                       contraction points plus a dashed pivot level.
//   single_trendline    major_trendlines: [p1, p2, value at last bar] — ONE line.
// A detection with no subtype renders exactly as before.
//
// ⭐ LOG-SPACE LINES ARE CURVES. A line fitted in log space (`geometry.extras.line_spaces[i] ===
// 'log'`) is exponential between its anchors, so a straight segment is only a chord of it. Bars
// are equally spaced in x, and the fit is linear in bar index, so log(price) is linear in x
// between the two anchor xs: we sample the curve at a fixed pixel step with
// price = exp(lerp(ln p1, ln p2, frac)). Exact at every sample, whatever the zoom.
//
// Package 8D: when the detection carries `geometry.anchor_roles`, the line labels reflect the
// real role (e.g. "Pole top") instead of the generic pattern-name label.
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

// Pixel step between curve samples for a log-space line.
export const LOG_SAMPLE_PX = 4

/**
 * Points of a line from (x1, p1) to (x2, p2) as pixel pairs. A 'log' line is sampled as the
 * exponential it was fitted as; anything else is its two endpoints.
 */
export function linePoints(x1, p1, x2, p2, space, priceToY, stepPx = LOG_SAMPLE_PX) {
  if (space !== 'log' || !(p1 > 0) || !(p2 > 0) || x1 === x2) {
    const y1 = priceToY(p1)
    const y2 = priceToY(p2)
    if (y1 == null || y2 == null) return null
    return [[x1, y1], [x2, y2]]
  }
  const n = Math.max(2, Math.ceil(Math.abs(x2 - x1) / stepPx))
  const l1 = Math.log(p1)
  const l2 = Math.log(p2)
  const pts = []
  for (let i = 0; i <= n; i += 1) {
    const f = i / n
    const y = priceToY(Math.exp(l1 + (l2 - l1) * f))
    if (y == null) return null
    pts.push([x1 + (x2 - x1) * f, y])
  }
  return pts
}

const toPath = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')

function PoleAndFlag({ detection, tToX, priceToY, style }) {
  const [base, top, low, high] = detection.geometry.anchors
  const xs = [base, top, low, high].map((a) => tToX(a.t))
  const ys = [base, top, low, high].map((a) => priceToY(a.price))
  if ([...xs, ...ys].some((v) => v == null)) return null
  const flagLeft = xs[1]
  const flagRight = Math.max(xs[2], xs[3], xs[1] + 1)
  const yHigh = Math.min(ys[2], ys[3])
  const yLow = Math.max(ys[2], ys[3])
  return (
    <>
      <line data-role="pole" x1={xs[0]} y1={ys[0]} x2={xs[1]} y2={ys[1]}
        stroke={style.color} strokeWidth={style.sw} strokeDasharray={style.dash}
        opacity={style.opacity} filter={style.glow} />
      <rect data-role="flag" x={flagLeft} y={yHigh} width={flagRight - flagLeft}
        height={Math.max(1, yLow - yHigh)} fill={style.color} fillOpacity={style.opacity * 0.08}
        stroke={style.color} strokeWidth={1} strokeDasharray={style.dash} opacity={style.opacity} />
      <text x={xs[1] + 8} y={ys[1] + 4} fontSize="11" fill={style.color} opacity={style.opacity}>
        {ROLE_LABELS.pole_top}
      </text>
      <text x={flagRight + 6} y={yHigh + 4} fontSize="10" fill={style.color} opacity={style.opacity * 0.85}>
        {ROLE_LABELS.flag_high}
      </text>
    </>
  )
}

function Zigzag({ detection, tToX, priceToY, style }) {
  const anchors = detection.geometry.anchors
  const pts = anchors.map((a) => [tToX(a.t), priceToY(a.price)])
  if (pts.some(([x, y]) => x == null || y == null)) return null
  const [px, py] = pts[pts.length - 1]
  return (
    <>
      <polyline data-role="zigzag" points={pts.map((p) => p.join(',')).join(' ')} fill="none"
        stroke={style.color} strokeWidth={style.sw} strokeDasharray={style.dash}
        opacity={style.opacity} filter={style.glow} />
      <line data-role="pivot" x1={px} y1={py} x2={px + 60} y2={py} stroke={style.color}
        strokeWidth={1.25} strokeDasharray="6,4" opacity={style.opacity} />
      <text x={px + 64} y={py + 4} fontSize="11" fill={style.color} opacity={style.opacity}>
        {formatLabel(detection)}
      </text>
    </>
  )
}

function SingleLine({ detection, tToX, priceToY, style }) {
  const anchors = detection.geometry.anchors
  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  const x1 = tToX(first.t)
  const x2 = tToX(last.t)
  if (x1 == null || x2 == null) return null
  const space = (detection.geometry.extras?.line_spaces || [])[0]
  const pts = linePoints(x1, first.price, x2, last.price, space, priceToY)
  if (!pts) return null
  const [ex, ey] = pts[pts.length - 1]
  return (
    <>
      <path data-role="line" d={toPath(pts)} fill="none" stroke={style.color} strokeWidth={style.sw}
        strokeDasharray={style.dash} opacity={style.opacity} filter={style.glow} />
      <text x={ex + 8} y={ey + 4} fontSize="11" fill={style.color} opacity={style.opacity}>
        {formatLabel(detection)}
      </text>
    </>
  )
}

export default function TrendlinePair({ detection, tToX, priceToY, onClick }) {
  const anchors = detection?.geometry?.anchors || []
  const subtype = detection?.geometry?.semantic_subtype
  const style = {
    color: getColor(detection),
    opacity: getOpacity(detection),
    sw: getStrokeWidth(detection),
    dash: getStrokeDasharray(detection),
    glow: getGlowFilter(detection),
  }
  const wrap = (children) => children && (
    <g onClick={() => onClick?.(detection)} style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
      {children}
    </g>
  )

  if (subtype === 'pole_and_flag' && anchors.length === 4) {
    return wrap(PoleAndFlag({ detection, tToX, priceToY, style }))
  }
  if (subtype === 'contraction_zigzag' && anchors.length >= 2) {
    return wrap(Zigzag({ detection, tToX, priceToY, style }))
  }
  if (subtype === 'single_trendline' && anchors.length >= 2) {
    return wrap(SingleLine({ detection, tToX, priceToY, style }))
  }

  if (anchors.length < 4) return null
  const [a, b, c, d] = anchors
  const roles = detection?.geometry?.anchor_roles
  const hasRoles = Array.isArray(roles) && roles.length === anchors.length
  const spaces = detection?.geometry?.extras?.line_spaces || []

  const x1 = tToX(a.t)
  const x2 = tToX(b.t)
  const x3 = tToX(c.t)
  const x4 = tToX(d.t)
  if ([x1, x2, x3, x4].some((v) => v == null)) return null
  const upper = linePoints(x1, a.price, x2, b.price, spaces[0], priceToY)
  const lower = linePoints(x3, c.price, x4, d.price, spaces[1], priceToY)
  if (!upper || !lower) return null
  const [, y2] = upper[upper.length - 1]
  const [, y4] = lower[lower.length - 1]

  // Fill between the two lines (each side follows its own curve when log-fitted).
  const lane = [...upper, ...[...lower].reverse()].map((p) => p.join(',')).join(' ')

  return wrap(
    <>
      {/* Translucent fill between the two lines — gives channels a "lane" feel */}
      <polygon points={lane} fill={style.color} opacity={style.opacity * 0.08} />
      <path data-role="upper" d={toPath(upper)} fill="none" stroke={style.color} strokeWidth={style.sw}
        strokeDasharray={style.dash} opacity={style.opacity} filter={style.glow} />
      <path data-role="lower" d={toPath(lower)} fill="none" stroke={style.color} strokeWidth={style.sw}
        strokeDasharray={style.dash} opacity={style.opacity} filter={style.glow} />
      {/* Label at the end of the upper line — slightly offset so it doesn't sit on the candle */}
      <text x={x2 + 8} y={y2 + 4} fontSize="11" fill={style.color} opacity={style.opacity}>
        {hasRoles ? (ROLE_LABELS[roles[1]] || formatLabel(detection)) : formatLabel(detection)}
      </text>
      {hasRoles && ROLE_LABELS[roles[3]] && (
        <text x={x4 + 8} y={y4 + 4} fontSize="10" fill={style.color} opacity={style.opacity * 0.85}>
          {ROLE_LABELS[roles[3]]}
        </text>
      )}
    </>,
  )
}
