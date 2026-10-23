// app/src/components/chart/patternLabelLayout.js — PatternOverlay's label-collision pass. Labels only.
//
// Given the rows PatternOverlay is about to draw (its rowView objects) and the learned `drawn` block, this
// decides: which right-edge pattern labels move apart (dy), where each base metrics / textbook block sits
// (top-left of its base, above or just inside the box), and which learned labels lose their TEXT because
// they would print over a pattern or metrics label. No line, box or number is moved. Pure; no React.
import { learnedLabelItems } from './patternShapes/learnedGeometry'
import {
  textBox, placeMetricsBlock, stackLabels, droppedLearnedLabels, levelLabelPosition,
} from './patternShapes/labelLayout'

/**
 * Every right-edge pattern label a row draws through LevelSegment (pivot, flat top, base pivot/low, shape
 * pivot/low, inside-day trigger/stop, rim reference, secondary levels, entry): its LevelSegment detection id,
 * anchors, label and extendRight -- exactly what the render passes. The shelf pivot draws its own label and
 * is listed with `shelf: true`. Used only to lay out TEXT; PatternOverlay.labelCollide.test.jsx pins it to
 * the rendered labels so the two cannot drift. Pure — exported for tests.
 */
export function patternLabelSpecs(v) {
  const { d, flatTop, base, insideDay, shapeDraw, shelf, pivot, rimRef, secondary, entry, anchors } = v
  const out = []
  const add = (suffix, pts, label, ext = 0) => out.push({ id: `${d.id}:${suffix}`, anchors: pts, label, ext })
  const span = (from, to, price) => [{ t: from, price }, { t: to, price }]
  if (pivot) {
    const pp = Number(pivot.price)
    add('pivot', span(pivot.start_t, pivot.end_t, pp),
      rimRef ? `Pivot ${pp.toFixed(2)} · handle high` : `Pivot ${pp.toFixed(2)}`, 40)
  }
  if (flatTop) add('flat-top', span(flatTop.start_t, flatTop.end_t, flatTop.price), flatTop.label, 40)
  if (base) {
    add('base-pivot', span(base.start_t, base.end_t, base.pivot), base.label, 40)
    add('base-low', span(base.start_t, base.end_t, base.low), base.lowLabel, 0)
  }
  if (shapeDraw) {
    add('shape-pivot', span(shapeDraw.pivot_from_t, shapeDraw.end_t, shapeDraw.pivot), shapeDraw.label, 40)
    add('shape-low', span(shapeDraw.start_t, shapeDraw.end_t, shapeDraw.low), shapeDraw.lowLabel, 0)
  }
  if (insideDay) {
    add('inside-day-trigger', span(insideDay.start_t, insideDay.end_t, insideDay.trigger), insideDay.label, 40)
    add('inside-day-stop', span(insideDay.start_t, insideDay.end_t, insideDay.stop), insideDay.stopLabel, 0)
  }
  if (rimRef) {
    const rp = Number(rimRef.price)
    add('rim-ref', span(rimRef.start_t, rimRef.end_t, rp), `Rim ${rp.toFixed(2)}`, 40)
  }
  secondary.forEach((sec, i) => {
    if (!sec || !Array.isArray(sec.anchors) || !sec.anchors.length || sec.shape === 'rectangle') return
    add(`sec${i}`, sec.anchors, sec.label || sec.role || d.pattern_name, sec.draw_stop ? 40 : 0)
  })
  if (Number.isFinite(entry) && anchors.length > 0) {
    add('entry', span(anchors[0].t, anchors[anchors.length - 1].t, entry), `Entry ${entry.toFixed(2)}`, 40)
  }
  if (shelf) {
    out.push({ id: `${d.id}:shelf`, anchors: span(shelf.start_t, shelf.end_t, shelf.price), label: shelf.label, ext: 40, shelf: true })
  }
  return out
}

/** A shelf pivot's label position (it draws its own line, not a LevelSegment). */
function shelfLabelPosition(spec, tToX, priceToY) {
  const x1 = tToX(spec.anchors[0].t)
  const x2 = tToX(spec.anchors[1].t)
  const y = priceToY(spec.anchors[0].price)
  if (x1 == null || x2 == null || y == null || !spec.label) return null
  return { x: Math.max(x1, x2) + spec.ext + 4, y: y + 3, label: spec.label }
}

/**
 * The label layout for one render: which pattern labels move (dy), where each metrics block goes, and
 * which learned labels lose their text. Pattern and metrics text always win over learned text. Labels
 * only -- no line, box or number is touched. Pure — exported for tests.
 */
export function computeLabelLayout({ views, drawn, tToX, priceToY, pane = null, candles = null, halfW = 4 }) {
  const items = []
  for (const v of views) {
    for (const spec of patternLabelSpecs(v)) {
      const pos = spec.shelf
        ? shelfLabelPosition(spec, tToX, priceToY)
        : levelLabelPosition({ id: spec.id, geometry: { anchors: spec.anchors, label: spec.label } }, tToX, priceToY, spec.ext)
      if (pos) items.push({ id: spec.id, box: textBox(pos.x, pos.y, pos.label) })
    }
  }
  const dy = stackLabels(items)
  const patternBoxes = items.map(({ id, box }) => (dy[id] ? { ...box, y0: box.y0 + dy[id], y1: box.y1 + dy[id] } : box))

  const metrics = {}
  for (const v of views) {
    if (!v.metricsLines) continue
    const src = v.base
      ? { start_t: v.base.start_t, end_t: v.base.end_t, top: v.base.pivot, floor: v.base.low }
      : { start_t: v.pivot.start_t, end_t: v.pivot.end_t, top: Number(v.pivot.price), floor: Number(v.ex.floor) }
    const xs = [tToX(src.start_t), tToX(src.end_t)].filter((x) => x != null)
    const yTop = priceToY(src.top)
    if (!xs.length || yTop == null) continue
    const yBottom = Number.isFinite(src.floor) ? priceToY(src.floor) : null
    metrics[v.d.id] = placeMetricsBlock({
      lines: v.metricsLines,
      box: { xL: Math.min(...xs), yTop, yBottom },
      pane,
      candles: typeof candles === 'function' ? candles() : candles,
      halfW,
      obstacles: patternBoxes,
    })
  }

  const learned = learnedLabelItems(drawn, tToX, priceToY).map((l) => ({ key: l.key, box: textBox(l.x, l.y, l.text) }))
  const winners = [...Object.values(metrics).map((m) => m.rect), ...patternBoxes]
  return { dy, metrics, droppedLearned: droppedLearnedLabels(learned, winners) }
}
