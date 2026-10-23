// app/src/components/chart/patternShapes/learnedGeometry.js — the learned auto-drawer's line and label
// geometry. ONE authority shared by LearnedDrawn (which draws it) and PatternOverlay's label-collision
// pass (which only decides whether a learned label's TEXT is drawn). Pure; no React.

import { nudgeLabelOffsets } from './learnedLabelNudge'

export const LEARNED_COLOR = '#a78bfa'
export const LEARNED_TAG = 'learned'
const EXTEND_PX = 48

export function levelLabel(h) {
  const price = Number(h.price).toFixed(2)
  const what = h.label && h.label !== LEARNED_TAG ? ` · ${h.label}` : ''
  return `${LEARNED_TAG}${what} ${price}`
}

// Line geometry, ONE authority for the drawing and for the label-collision pass (labels only).
export function trendGeom(line, asofT, tToX, priceToY) {
  const x1 = tToX(line.t1)
  const y1 = priceToY(line.p1)
  let x2 = asofT != null ? tToX(asofT) : null
  let y2 = priceToY(line.p_now)
  if (x2 == null || y2 == null) {
    x2 = tToX(line.t2)
    y2 = priceToY(line.p2)
  }
  if (x1 == null || y1 == null || x2 == null || y2 == null || x2 - x1 < 1) return null
  const slope = (y2 - y1) / (x2 - x1)
  const xe = x2 + EXTEND_PX
  const ye = y2 + slope * EXTEND_PX
  return { x1, y1, xe, ye }
}

export function levelGeom(level, asofT, tToX, priceToY) {
  const y = priceToY(level.price)
  if (y == null) return null
  const xEnd = asofT != null ? tToX(asofT) : null
  let x1 = level.t_from != null ? tToX(level.t_from) : null
  if (xEnd == null && x1 == null) return null
  const x2 = (xEnd ?? x1) + EXTEND_PX
  if (x1 == null || x1 > x2 - EXTEND_PX) x1 = x2 - EXTEND_PX * 2
  return { x1, x2, y }
}

/**
 * Every learned label as it will be drawn: key ('tl<i>' / 'h<i>'), text and position (baseline y, after
 * the learned levels' own nudge). PatternOverlay uses it to drop a learned label that would print over
 * pattern or metrics text. Pure — exported for tests.
 */
export function learnedLabelItems(drawn, tToX, priceToY) {
  if (!drawn) return []
  const trendlines = Array.isArray(drawn.trendlines) ? drawn.trendlines : []
  const horizontals = Array.isArray(drawn.horizontals) ? drawn.horizontals : []
  const asofT = drawn.asof_t ?? null
  const out = []
  trendlines.forEach((line, i) => {
    const g = trendGeom(line, asofT, tToX, priceToY)
    if (g) out.push({ key: `tl${i}`, x: g.xe + 4, y: g.ye + 3, text: LEARNED_TAG })
  })
  const labelDy = nudgeLabelOffsets(horizontals.map((h) => priceToY(h.price) ?? null))
  horizontals.forEach((level, i) => {
    const g = levelGeom(level, asofT, tToX, priceToY)
    if (g) out.push({ key: `h${i}`, x: g.x2 + 4, y: g.y + 3 + (labelDy[i] || 0), text: levelLabel(level) })
  })
  return out
}

