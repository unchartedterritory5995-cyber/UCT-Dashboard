// app/src/components/chart/patternShapes/LearnedDrawn.jsx — the learned auto-drawer's lines.
//
// Draws the `drawn` block GET /api/patterns/{sym} carries for an admin while
// AUTO_STRUCTURES_ENABLED (api/services/auto_draw.py, lab model 2026-10-16):
//   trendlines   {t1, p1, t2, p2, p_now, score, why}   from the first anchor to the last bar
//   horizontals  {price, t_from, label, source, ...}    from the anchoring bar to past the last bar
// Styled apart from every engine shape — violet, long-dash, and every label tagged "learned" — so a
// learned line is never read as a detector's. Display-only; never clickable as a detection.

import { nudgeLabelOffsets } from './learnedLabelNudge'
import { LEARNED_COLOR, LEARNED_TAG, levelLabel, trendGeom, levelGeom } from './learnedGeometry'

export { LEARNED_COLOR, LEARNED_TAG }

function Trendline({ line, asofT, tToX, priceToY, index, dropLabel = false }) {
  const g = trendGeom(line, asofT, tToX, priceToY)
  if (!g) return null
  const { x1, y1, xe, ye } = g
  return (
    <g data-shape="learned-trendline" data-learned-index={index} data-label-dropped={dropLabel ? '1' : undefined}>
      <title>{`${LEARNED_TAG} trendline${line.why ? ` — ${line.why}` : ''}`}</title>
      <line x1={x1} y1={y1} x2={xe} y2={ye} stroke={LEARNED_COLOR} strokeWidth={1.5}
        strokeDasharray="8,4" opacity={0.85} />
      {!dropLabel && (
        <text x={xe + 4} y={ye + 3} fontSize="10" fill={LEARNED_COLOR} opacity={0.9}
          style={{ pointerEvents: 'none' }}>
          {LEARNED_TAG}
        </text>
      )}
    </g>
  )
}

function Level({ level, asofT, tToX, priceToY, index, labelDy = 0, dropLabel = false }) {
  const g = levelGeom(level, asofT, tToX, priceToY)
  if (!g) return null
  const { x1, x2, y } = g
  return (
    <g data-shape="learned-level" data-learned-source={level.source || ''} data-learned-index={index}
      data-label-dropped={dropLabel ? '1' : undefined}>
      <title>{level.why ? `${levelLabel(level)} — ${level.why}` : levelLabel(level)}</title>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={LEARNED_COLOR} strokeWidth={1.25}
        strokeDasharray="8,4" opacity={0.8} />
      {!dropLabel && (
        <text x={x2 + 4} y={y + 3 + labelDy} fontSize="10" fill={LEARNED_COLOR} opacity={0.9}
          style={{ pointerEvents: 'none' }} data-label-dy={labelDy || undefined}>
          {levelLabel(level)}
        </text>
      )}
    </g>
  )
}

// `droppedLabels`: keys from learnedLabelItems whose TEXT is not drawn because it would print over a pattern
// or metrics label (PatternOverlay decides; pattern and metrics text always win). The lines always draw.
export default function LearnedDrawn({ drawn, tToX, priceToY, droppedLabels = null }) {
  if (!drawn) return null
  const trendlines = Array.isArray(drawn.trendlines) ? drawn.trendlines : []
  const horizontals = Array.isArray(drawn.horizontals) ? drawn.horizontals : []
  if (!trendlines.length && !horizontals.length) return null
  const asofT = drawn.asof_t ?? null
  const dropped = (key) => !!droppedLabels && droppedLabels.has(key)
  // display only: labels of levels a few px apart are spaced vertically; the lines are not moved
  const labelDy = nudgeLabelOffsets(horizontals.map((h) => priceToY(h.price) ?? null))
  return (
    <g data-layer="learned" style={{ pointerEvents: 'none' }}>
      {trendlines.map((line, i) => (
        <Trendline key={`tl${i}`} line={line} asofT={asofT} tToX={tToX} priceToY={priceToY} index={i}
          dropLabel={dropped(`tl${i}`)} />
      ))}
      {horizontals.map((level, i) => (
        <Level key={`h${i}`} level={level} asofT={asofT} tToX={tToX} priceToY={priceToY} index={i}
          labelDy={labelDy[i]} dropLabel={dropped(`h${i}`)} />
      ))}
    </g>
  )
}
