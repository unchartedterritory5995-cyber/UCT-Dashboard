// app/src/components/chart/patternShapes/LearnedDrawn.jsx — the learned auto-drawer's lines.
//
// Draws the `drawn` block GET /api/patterns/{sym} carries for an admin while
// AUTO_STRUCTURES_ENABLED (api/services/auto_draw.py, lab model 2026-10-16):
//   trendlines   {t1, p1, t2, p2, p_now, score, why}   from the first anchor to the last bar
//   horizontals  {price, t_from, label, source, ...}    from the anchoring bar to past the last bar
// Styled apart from every engine shape — violet, long-dash, and every label tagged "learned" — so a
// learned line is never read as a detector's. Display-only; never clickable as a detection.

export const LEARNED_COLOR = '#a78bfa'
export const LEARNED_TAG = 'learned'
const EXTEND_PX = 48

function levelLabel(h) {
  const price = Number(h.price).toFixed(2)
  const what = h.label && h.label !== LEARNED_TAG ? ` · ${h.label}` : ''
  return `${LEARNED_TAG}${what} ${price}`
}

function Trendline({ line, asofT, tToX, priceToY, index }) {
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
  return (
    <g data-shape="learned-trendline" data-learned-index={index}>
      <title>{`${LEARNED_TAG} trendline${line.why ? ` — ${line.why}` : ''}`}</title>
      <line x1={x1} y1={y1} x2={xe} y2={ye} stroke={LEARNED_COLOR} strokeWidth={1.5}
        strokeDasharray="8,4" opacity={0.85} />
      <text x={xe + 4} y={ye + 3} fontSize="10" fill={LEARNED_COLOR} opacity={0.9}
        style={{ pointerEvents: 'none' }}>
        {LEARNED_TAG}
      </text>
    </g>
  )
}

function Level({ level, asofT, tToX, priceToY, index }) {
  const y = priceToY(level.price)
  if (y == null) return null
  const xEnd = asofT != null ? tToX(asofT) : null
  let x1 = level.t_from != null ? tToX(level.t_from) : null
  if (xEnd == null && x1 == null) return null
  const x2 = (xEnd ?? x1) + EXTEND_PX
  if (x1 == null || x1 > x2 - EXTEND_PX) x1 = x2 - EXTEND_PX * 2
  return (
    <g data-shape="learned-level" data-learned-source={level.source || ''} data-learned-index={index}>
      <title>{level.why ? `${levelLabel(level)} — ${level.why}` : levelLabel(level)}</title>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={LEARNED_COLOR} strokeWidth={1.25}
        strokeDasharray="8,4" opacity={0.8} />
      <text x={x2 + 4} y={y + 3} fontSize="10" fill={LEARNED_COLOR} opacity={0.9}
        style={{ pointerEvents: 'none' }}>
        {levelLabel(level)}
      </text>
    </g>
  )
}

export default function LearnedDrawn({ drawn, tToX, priceToY }) {
  if (!drawn) return null
  const trendlines = Array.isArray(drawn.trendlines) ? drawn.trendlines : []
  const horizontals = Array.isArray(drawn.horizontals) ? drawn.horizontals : []
  if (!trendlines.length && !horizontals.length) return null
  const asofT = drawn.asof_t ?? null
  return (
    <g data-layer="learned" style={{ pointerEvents: 'none' }}>
      {trendlines.map((line, i) => (
        <Trendline key={`tl${i}`} line={line} asofT={asofT} tToX={tToX} priceToY={priceToY} index={i} />
      ))}
      {horizontals.map((level, i) => (
        <Level key={`h${i}`} level={level} asofT={asofT} tToX={tToX} priceToY={priceToY} index={i} />
      ))}
    </g>
  )
}
