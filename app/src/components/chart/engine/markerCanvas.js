// app/src/components/chart/engine/markerCanvas.js
//
// ─── e99 — PINE MARKERS, DRAWN ON CANVAS AS TRADINGVIEW DRAWS THEM ────────────
//
// TradingView draws all twelve `plotshape` styles as distinct glyphs (triangle up
// and down, label up and down, flag, diamond, cross, xcross, circle, square,
// arrow up and down) and a `plotchar` as its character; it substitutes nothing
// (FRED RS, AMEX:SPY 1D captures, 2026-11-26). Each lands on exactly its own bar,
// at the location the author wrote: above the bar's high, below its low, at the
// price scale's top or bottom margin line, or at the plotted value
// (`location.absolute`). Lightweight-charts' series markers draw four shapes at
// the bar, so the translator maps the other eight onto them
// (`pine.js::PINE_MARKER_SHAPES`, `shapeApprox`) and the pane edges onto the bar
// (`positionApprox`).
//
// ⭐ THIS MODULE DRAWS THE AUTHOR'S GLYPH. One series primitive per pane
// (`createMarkerCanvasRegistry`) draws every marker plot of that pane:
//   x = timeScale.timeToCoordinate(bar time), never offset;
//   the ANCHOR y = a size-dependent distance above the bar's high / below its low
//       (`location.abovebar` / `belowbar`), below the price scale's top margin line
//       / above its bottom one (`location.top` / `bottom`), or
//       priceToCoordinate(the plotted value) (`location.absolute`);
//   each glyph has its own anchor point (the centre; a triangle's centroid; a
//       label's pointer TIP), so the anchor rule is one rule for every shape.
// Every size, offset and proportion is read from ONE table, `MARKER_GEOMETRY`,
// which is PINNED from FRED RS's measurement of TradingView's pixels (run
// `markers-2026-11-26`; the derived numbers are committed as
// `tests/fixtures/vendor/tv-marker-geometry-spy-1d-2026-11-26.json` and the rails in
// `markerCanvas.test.js` hold every measured cell within its tolerance).
//
// ⭐ AS TRADINGVIEW DRAWS THEM, MEASURED:
//   - sizes are fixed in px per size word, EXCEPT `size.auto` (Pine's default, about
//     half the bar spacing) and the arrows' width (half the bar spacing);
//   - markers on one bar do NOT stack: one slot per location, each at its own
//     size's offset, the LAST declared plot painted on top;
//   - the candles paint OVER the markers (the view draws in LWC's background pass of
//     the series layer: above the grid, under every series' own drawing).
//
// ⛔ WHAT IS NOT PINNED (`MARKER_GEOMETRY.unmeasured`, and `unmeasuredGeometryOf`):
// a marker's TEXT (one sample per kind), a `plotchar`'s CHARACTER size (the star
// only, and a character's size follows the font), and where a TRIANGLE is pinned to
// a price at `location.absolute` (its rows were clipped by candles). A marker that
// touches one of these is recorded `geometryApprox` (`canvasMarkerRecord`) and the
// member door says which (`memberPaneDefinition.js::markerSubstitutionNotes`).
//
// ⛔ BEHIND `markerCanvasGate.js`, DEFAULT OFF. Off, nothing here is reached: the
// binder draws LWC series markers exactly as before and the record is unchanged.
//
// ⛔ IT NEVER IMPORTS `lightweight-charts`, AND IT NEVER ATTACHES ANYTHING ITSELF.
// The primitive is a plain object; the registry is handed `attach` / `detach`
// by `binder.js`, the one engine file that attaches primitives (where the
// engine's lands-dark gate lives; `primitiveGate.test.js`), so every rail here
// runs with a fake chart and a recording canvas.

import { markerCanvasEnabled } from './markerCanvasGate'

/** ⭐⭐ EVERY GEOMETRY CONSTANT OF THE CANVAS MARKERS, AND NOWHERE ELSE.
 *
 *  PINNED from FRED RS's run `markers-2026-11-26` (AMEX:SPY 1D, light theme, DPR 1,
 *  measured at 90 px bar spacing), except what `unmeasured` names. Nothing else in
 *  this file holds a number but 0, 1, 2 and 0.5 (a rail in `markerCanvas.test.js`
 *  holds that).
 *
 *  `sizePx` is the nominal size S per Pine size word (a square is S x S).
 *  `autoSize` is S for `size.auto` (Pine's default for both calls):
 *  perBarSpacing x the bar spacing + plusPx.
 *  `anchorDistance`: the anchor sits perSize x S - lessPx from its reference line
 *  (the bar's high / low, the scale's margin line).
 *  `box[glyph]`: the glyph's w and h as fractions of S (an arrow's w is
 *  wPerBarSpacing x the bar spacing), and `anchor`, the anchor point's height in
 *  the box as a fraction of h from its TOP (0.5 the centre; 2/3 and 1/3 a
 *  triangle's centroid; 0 and 1 a label's pointer tip).
 *  `label.pointerPerWidth`: a label's pointer height per its width (45 degrees).
 *  `arrow`: the head's height and the shaft's width per the arrow's width.
 *  `flag`: the pole's width in px and the cloth's height per the flag's height.
 *  `strokePx`: the cross's and the xcross's line widths.
 *  `text`: ⛔ NOT PINNED (one sample per kind): the font, its cap height, the gap
 *  from the shape, and a label's padding around its text.
 *  `fallback`: lightweight-charts' own defaults (NOT measurements), used only when
 *  the chart does not say: its default bar spacing and price-scale margins. */
export const MARKER_GEOMETRY = Object.freeze({
  source: 'FRED RS run markers-2026-11-26: AMEX:SPY 1D, light theme, DPR 1, 90 px bar spacing',
  unmeasured: Object.freeze(['text', 'char', 'absoluteTriangle']),
  sizePx: Object.freeze({
    'size.tiny': 9, 'size.small': 17, 'size.normal': 27, 'size.large': 39, 'size.huge': 51,
  }),
  autoSize: Object.freeze({ perBarSpacing: 0.5, plusPx: 1 }),
  anchorDistance: Object.freeze({ perSize: 1.5, lessPx: 2 }),
  box: Object.freeze({
    'shape.circle': Object.freeze({ w: 1, h: 1, anchor: 0.5 }),
    'shape.square': Object.freeze({ w: 1, h: 1, anchor: 0.5 }),
    'shape.diamond': Object.freeze({ w: 1, h: 1, anchor: 0.5 }),
    'shape.cross': Object.freeze({ w: 1, h: 1, anchor: 0.5 }),
    'shape.xcross': Object.freeze({ w: 1, h: 1, anchor: 0.5 }),
    'shape.triangleup': Object.freeze({ w: 1.04, h: 1, anchor: 2 / 3 }),
    'shape.triangledown': Object.freeze({ w: 1.04, h: 1, anchor: 1 / 3 }),
    'shape.labelup': Object.freeze({ w: 0.7, h: 1.14, anchor: 0 }),
    'shape.labeldown': Object.freeze({ w: 0.7, h: 1.14, anchor: 1 }),
    'shape.flag': Object.freeze({ w: 1, h: 1.1, anchor: 0.55 }),
    'shape.arrowup': Object.freeze({ wPerBarSpacing: 0.5, h: 1, anchor: 0.48 }),
    'shape.arrowdown': Object.freeze({ wPerBarSpacing: 0.5, h: 1, anchor: 0.5 }),
    char: Object.freeze({ w: 4 / 3, h: 4 / 3, anchor: 0.5 }),
  }),
  label: Object.freeze({ pointerPerWidth: 0.5 }),
  arrow: Object.freeze({ headPerWidth: 0.5, shaftPerWidth: 0.5 }),
  flag: Object.freeze({ polePx: 4, clothPerHeight: 0.5 }),
  strokePx: Object.freeze({ 'shape.cross': 2, 'shape.xcross': 2.4 }),
  text: Object.freeze({
    fontPx: 12,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
    capPx: 9,
    gapAbovePx: 13,
    gapBelowPx: 11,
    charPx: 6.5,
    labelPadXPx: 10,
    labelPadYPx: 7.75,
  }),
  fallback: Object.freeze({ barSpacingPx: 6, scaleMargins: Object.freeze({ top: 0.2, bottom: 0.1 }) }),
})

const G = MARKER_GEOMETRY
const TEXT = G.text
const TEXT_FONT = `${TEXT.fontPx}px ${TEXT.fontFamily}`

/** A closed polygon through `pts` (pairs in px, centred on the origin). */
function poly(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0], pts[i][1])
  ctx.closePath()
}

const mirrorY = (pts) => pts.map(([x, y]) => [x, -y])

const triangleUp = (w, h) => [[0, -h * 0.5], [w * 0.5, h * 0.5], [-w * 0.5, h * 0.5]]
/** An arrow's head is as wide as the arrow and half as tall (cut to the arrow's
 *  height when the size word is smaller: `size.tiny` / `size.small` are only a
 *  flat head); its shaft is half as wide. */
const arrowUp = (w, h) => {
  const top = -h * 0.5
  const neck = top + Math.min(w * G.arrow.headPerWidth, h)
  const s = w * G.arrow.shaftPerWidth * 0.5
  return [[0, top], [w * 0.5, neck], [s, neck], [s, h * 0.5], [-s, h * 0.5], [-s, neck], [-w * 0.5, neck]]
}
/** A label: a body the label's width, and a 45-degree pointer on top as wide. */
const labelUp = (w, h) => {
  const neck = -h * 0.5 + w * G.label.pointerPerWidth
  return [[0, -h * 0.5], [w * 0.5, neck], [w * 0.5, h * 0.5], [-w * 0.5, h * 0.5], [-w * 0.5, neck]]
}

/** ⭐⭐ THE THIRTEEN GLYPHS: one path function per Pine shape, and the character.
 *  Each draws a `w` x `h` box centred on the origin (y grows downward) and returns
 *  how it is painted. ⛔ No entry stands in for another: the rail holds all
 *  thirteen paths pairwise distinct and each Pine name to its own entry. */
export const GLYPHS = Object.freeze({
  'shape.circle': (ctx, w, h) => { ctx.arc(0, 0, Math.min(w, h) * 0.5, 0, Math.PI * 2); ctx.closePath(); return 'fill' },
  'shape.square': (ctx, w, h) => {
    poly(ctx, [[-w * 0.5, -h * 0.5], [w * 0.5, -h * 0.5], [w * 0.5, h * 0.5], [-w * 0.5, h * 0.5]])
    return 'fill'
  },
  'shape.diamond': (ctx, w, h) => { poly(ctx, [[0, -h * 0.5], [w * 0.5, 0], [0, h * 0.5], [-w * 0.5, 0]]); return 'fill' },
  'shape.triangleup': (ctx, w, h) => { poly(ctx, triangleUp(w, h)); return 'fill' },
  'shape.triangledown': (ctx, w, h) => { poly(ctx, mirrorY(triangleUp(w, h))); return 'fill' },
  'shape.arrowup': (ctx, w, h) => { poly(ctx, arrowUp(w, h)); return 'fill' },
  'shape.arrowdown': (ctx, w, h) => { poly(ctx, mirrorY(arrowUp(w, h))); return 'fill' },
  'shape.labelup': (ctx, w, h) => { poly(ctx, labelUp(w, h)); return 'fill' },
  'shape.labeldown': (ctx, w, h) => { poly(ctx, mirrorY(labelUp(w, h))); return 'fill' },
  'shape.flag': (ctx, w, h) => {
    const pole = -w * 0.5 + G.flag.polePx
    const cloth = -h * 0.5 + h * G.flag.clothPerHeight
    poly(ctx, [[-w * 0.5, h * 0.5], [-w * 0.5, -h * 0.5], [w * 0.5, -h * 0.5], [w * 0.5, cloth], [pole, cloth], [pole, h * 0.5]])
    return 'fill'
  },
  'shape.cross': (ctx, w, h) => {
    ctx.lineWidth = G.strokePx['shape.cross']
    ctx.moveTo(0, -h * 0.5); ctx.lineTo(0, h * 0.5)
    ctx.moveTo(-w * 0.5, 0); ctx.lineTo(w * 0.5, 0)
    return 'stroke'
  },
  'shape.xcross': (ctx, w, h) => {
    ctx.lineWidth = G.strokePx['shape.xcross']
    ctx.moveTo(-w * 0.5, -h * 0.5); ctx.lineTo(w * 0.5, h * 0.5)
    ctx.moveTo(w * 0.5, -h * 0.5); ctx.lineTo(-w * 0.5, h * 0.5)
    return 'stroke'
  },
  char: (ctx, w, h, text) => {
    ctx.font = `${h}px ${TEXT.fontFamily}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(text || ''), 0, 0)
    return 'text'
  },
})

/** The glyph this module draws for a marker record, or null when it draws none
 *  (the LWC series markers keep it). A Pine shape draws its own glyph; a
 *  `plotchar` (the translator writes `pineShape: null` and the character as
 *  `text`) draws its character. A hand-authored marker names no Pine shape and is
 *  left to the LWC markers. */
export function glyphOf(marker) {
  if (!marker || typeof marker !== 'object') return null
  if (typeof marker.pineShape === 'string') return Object.hasOwn(GLYPHS, marker.pineShape) && marker.pineShape !== 'char' ? marker.pineShape : null
  if (marker.pineShape === null && typeof marker.text === 'string' && marker.text) return 'char'
  return null
}

const LOCATIONS = Object.freeze(['location.abovebar', 'location.belowbar', 'location.top', 'location.bottom', 'location.absolute'])

/** The Pine location of a marker record: its `pineLocation` word when the record
 *  carries one, else read back off the LWC fallback (`inBar` is `absolute`; an
 *  approximated `aboveBar` / `belowBar` is the pane's top / bottom). */
export function locationOf(marker) {
  if (marker && LOCATIONS.includes(marker.pineLocation)) return marker.pineLocation
  const pos = marker && marker.position
  if (pos === 'inBar') return 'location.absolute'
  if (pos === 'belowBar') return marker.positionApprox === true ? 'location.bottom' : 'location.belowbar'
  return marker && marker.positionApprox === true ? 'location.top' : 'location.abovebar'
}

const spacingOr = (barSpacing) => (Number.isFinite(barSpacing) && barSpacing > 0 ? barSpacing : G.fallback.barSpacingPx)

/** The nominal size S in CSS px: the size word's, or `size.auto`'s (which follows
 *  the bar spacing) for `size.auto` and for a marker whose `size=` was not written
 *  (Pine's default for both calls is `size.auto`, measured). */
export function sizePxOf(marker, barSpacing) {
  const word = marker && marker.pineSize
  if (Object.hasOwn(G.sizePx, word || '')) return G.sizePx[word]
  return G.autoSize.perBarSpacing * spacingOr(barSpacing) + G.autoSize.plusPx
}

/** A glyph's box at size S: `{w, h, anchor}` (`anchor` as in `MARKER_GEOMETRY.box`). */
export function boxOf(glyph, size, barSpacing) {
  const b = G.box[glyph]
  const w = Number.isFinite(b.wPerBarSpacing) ? b.wPerBarSpacing * spacingOr(barSpacing) : b.w * size
  return { w, h: b.h * size, anchor: b.anchor }
}

/** The price scale's margins of a host series (lightweight-charts' `scaleMargins`),
 *  or LWC's own default when the host does not say. */
export function scaleMarginsOf(host) {
  try {
    const m = host.priceScale().options().scaleMargins
    if (m && Number.isFinite(m.top) && Number.isFinite(m.bottom)) return m
  } catch { /* a host without a price scale */ }
  return G.fallback.scaleMargins
}

/** The y of a glyph's ANCHOR point, or null when it has no place on this pane.
 *  `toY` is the host series' `priceToCoordinate`; `margins` its price scale's
 *  `scaleMargins`. abovebar / belowbar sit a size-dependent distance from the bar's
 *  high / low; top / bottom the same distance INSIDE the price scale's margin lines
 *  (not the pane's edges: TradingView measures them from the margin lines);
 *  absolute is the plotted value, exactly. */
export function placeY(location, { high, low, value, paneHeight, toY, size, margins = G.fallback.scaleMargins }) {
  const d = G.anchorDistance.perSize * size - G.anchorDistance.lessPx
  const at = (price) => {
    if (!Number.isFinite(price)) return null
    const y = toY(price)
    return Number.isFinite(y) ? y : null
  }
  if (location === 'location.absolute') return at(value)
  if (location === 'location.top') return Number.isFinite(paneHeight) ? margins.top * paneHeight + d : null
  if (location === 'location.bottom') return Number.isFinite(paneHeight) ? paneHeight * (1 - margins.bottom) - d : null
  if (location === 'location.belowbar') {
    const y = at(low)
    return y === null ? null : y + d
  }
  const y = at(high)
  return y === null ? null : y - d
}

/** A label grown around its text (⛔ not pinned: one sample, `MARKER_GEOMETRY.text`):
 *  at least the text's width plus its padding, and a body at least the text's cap
 *  height plus its padding; the pointer keeps its proportion. */
function labelAround(box, text) {
  const ppw = G.label.pointerPerWidth
  const w = Math.max(box.w, text.length * TEXT.charPx + TEXT.labelPadXPx * 2)
  const body = Math.max(box.h - box.w * ppw, TEXT.capPx + TEXT.labelPadYPx * 2)
  return { w, h: body + w * ppw, anchor: box.anchor }
}

const isLabel = (glyph) => glyph === 'shape.labelup' || glyph === 'shape.labeldown'

/** ⭐ THE WHOLE PICTURE OF ONE PANE, AS DATA: one entry per marker to draw, in
 *  paint order. `groups` are the pane's marker plots (`{marker, host, items, order}`;
 *  an item is `{time, color, text, value, high, low}`); `timeToCoordinate` is the
 *  chart's, `barSpacing` its time scale's.
 *  ⛔ x is `timeToCoordinate(time)` exactly: a marker lands on its own bar.
 *  ⛔ NO STACKING: a marker's place never depends on another marker on its bar; the
 *  plots are painted in declaration order (`order`), so the last declared is on top.
 *  An entry is `{glyph, x, y, w, h, ...}` with (x, y) the centre of its box. */
export function layoutMarkers(groups, { timeToCoordinate, paneHeight, paneWidth = Infinity, barSpacing }) {
  const out = []
  const orderOf = (g) => (Number.isFinite(g.order) ? g.order : 0)
  const ordered = [...groups].sort((a, b) => orderOf(a) - orderOf(b))
  for (const g of ordered) {
    const glyph = glyphOf(g.marker)
    if (!glyph || !g.host) continue
    const location = locationOf(g.marker)
    const size = sizePxOf(g.marker, barSpacing)
    const box = boxOf(glyph, size, barSpacing)
    const margins = scaleMarginsOf(g.host)
    const toY = (p) => g.host.priceToCoordinate(p)
    const textAbove = location === 'location.abovebar' || location === 'location.bottom'
    for (const it of g.items || []) {
      const x = timeToCoordinate(it.time)
      if (!Number.isFinite(x) || x < -box.w || x > paneWidth + box.w) continue
      const anchor = g.anchorAt ? g.anchorAt(it) : it
      const ay = placeY(location, { high: anchor.high, low: anchor.low, value: it.value, paneHeight, toY, size, margins })
      if (ay === null) continue
      const text = glyph === 'char' ? '' : (it.text || '')
      const b = text && isLabel(glyph) ? labelAround(box, text) : box
      out.push({
        glyph, x, y: ay - b.anchor * b.h + b.h * 0.5, w: b.w, h: b.h, color: it.color,
        text,
        char: glyph === 'char' ? (g.marker.text || '') : '',
        textColor: g.marker.textColor || it.color,
        textAbove,
        textInside: isLabel(glyph),
      })
    }
  }
  return out
}

/** Paint a layout onto a 2D context in media (CSS pixel) coordinates, in order. */
export function paintMarkers(ctx, layout) {
  for (const m of layout) {
    ctx.save()
    ctx.translate(m.x, m.y)
    ctx.fillStyle = m.color
    ctx.strokeStyle = m.color
    ctx.beginPath()
    const how = GLYPHS[m.glyph](ctx, m.w, m.h, m.char)
    if (how === 'fill') ctx.fill()
    if (how === 'stroke') ctx.stroke()
    if (m.text) {
      ctx.font = TEXT_FONT
      ctx.textAlign = 'center'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = m.textColor
      let y = m.h * 0.5 + TEXT.gapBelowPx + TEXT.capPx
      if (m.textInside) {
        const neck = m.w * G.label.pointerPerWidth
        const bodyMid = m.glyph === 'shape.labelup' ? neck * 0.5 : -neck * 0.5
        y = bodyMid + TEXT.capPx * 0.5
      } else if (m.textAbove) {
        y = -m.h * 0.5 - TEXT.gapAbovePx
      }
      ctx.fillText(m.text, 0, y)
    }
    ctx.restore()
  }
}

/** ⛔ THE FACTS A MARKER'S DRAWING TOUCHES THAT THE MEASUREMENT DID NOT PIN, each a
 *  word of `MARKER_GEOMETRY.unmeasured`: `text` (a shape with text), `char` (a
 *  `plotchar`'s character), `absoluteTriangle` (a triangle at `location.absolute`).
 *  Empty for every other marker this module draws: its size and place are pinned. */
export function unmeasuredGeometryOf(marker) {
  const glyph = glyphOf(marker)
  if (!glyph) return []
  const out = []
  if (glyph === 'char') out.push('char')
  else if (typeof marker.text === 'string' && marker.text) out.push('text')
  if ((glyph === 'shape.triangleup' || glyph === 'shape.triangledown') && locationOf(marker) === 'location.absolute') {
    out.push('absoluteTriangle')
  }
  return out.filter((f) => G.unmeasured.includes(f))
}

/** ⭐⭐ THE RECORD, WHEN THIS MODULE DRAWS THE MARKER.
 *
 *  Off (`markerCanvasEnabled`), the marker is returned AS IS (the same object).
 *  On, a marker this module draws (`glyphOf`) is no longer a substituted shape
 *  (`shapeApprox: false`) nor, at the pane's top or bottom, a substituted place
 *  (`positionApprox: false`); and it is `geometryApprox: true` ONLY when its
 *  drawing touches a fact the measurement did not pin (`unmeasuredGeometryOf`),
 *  which the member door names. A marker this module does not draw is returned
 *  as is. */
export function canvasMarkerRecord(marker, enabled = markerCanvasEnabled()) {
  if (!enabled || !glyphOf(marker)) return marker
  const out = { ...marker }
  if (out.shapeApprox === true) out.shapeApprox = false
  const loc = locationOf(marker)
  if ((loc === 'location.top' || loc === 'location.bottom') && out.positionApprox === true) out.positionApprox = false
  if (unmeasuredGeometryOf(marker).length) out.geometryApprox = true
  else delete out.geometryApprox
  return out
}

/** The bar's high / low on a host series, read once per group from its data. */
function anchorReader(host) {
  let byTime = null
  return (it) => {
    if (Number.isFinite(it.high) && Number.isFinite(it.low)) return it
    if (!byTime) {
      byTime = new Map()
      const data = host && typeof host.data === 'function' ? (host.data() || []) : []
      for (const d of data) {
        if (!d) continue
        const hi = Number.isFinite(d.high) ? d.high : d.value
        const lo = Number.isFinite(d.low) ? d.low : d.value
        byTime.set(d.time, { high: hi, low: lo })
      }
    }
    return byTime.get(it.time) || it
  }
}

/** The time scale's bar spacing, or NaN when the chart does not say. */
function barSpacingOf(ts) {
  try {
    const o = typeof ts.options === 'function' ? ts.options() : null
    return o && Number.isFinite(o.barSpacing) ? o.barSpacing : NaN
  } catch { return NaN }
}

/** ⭐⭐ ONE SERIES PRIMITIVE PER PANE, drawing every marker plot of that pane.
 *
 *  `layerFor({host, paneIndex, order})` hands the binder a marker layer with the
 *  shape of `markerPrimitive.createMarkerLayer`'s (`set`, `clear`, `attached`), so
 *  the binder's lifecycle (cleared on a host change, cleared when its binding goes)
 *  is the same for both. `order` is the plot's declaration order (`set` may restate
 *  it): the pane paints its plots in that order, the last declared on top. The
 *  pane's primitive is attached to the first host that draws in it and moved to
 *  another of the pane's hosts when that one's last plot leaves; it is detached
 *  when the pane has no marker plot left. Each plot's y is read through ITS OWN
 *  host (`priceToCoordinate`, `priceScale().options().scaleMargins`), whichever
 *  series carries the primitive.
 *
 *  ⭐ THE CANDLES PAINT OVER THE MARKERS (measured): the view is LWC's `normal`
 *  layer and its renderer draws ONLY in `drawBackground`, which LWC runs for every
 *  source of the pane before any series' own `draw` (`_drawSources`), after the
 *  grid. ⛔ So every series of the pane (indicator lines too) paints over the
 *  markers; TradingView's order between markers and other indicator plots is not
 *  measured.
 *
 *  `attach(series, primitive)` / `detach(series, primitive)` are the binder's: this
 *  module never attaches a primitive itself. Without them nothing is attached. */
export function createMarkerCanvasRegistry({ attach: attachTo = null, detach: detachFrom = null } = {}) {
  const panes = new Map()
  let seq = 0

  function makePane(paneIndex) {
    const pane = { paneIndex, groups: new Map(), attachedTo: null, chart: null, requestUpdate: null }
    const renderer = {
      drawBackground(target) {
        if (!pane.chart || !target || typeof target.useMediaCoordinateSpace !== 'function') return
        const ts = pane.chart.timeScale()
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          const layout = layoutMarkers([...pane.groups.values()], {
            timeToCoordinate: (t) => ts.timeToCoordinate(t),
            paneHeight: mediaSize.height,
            paneWidth: mediaSize.width,
            barSpacing: barSpacingOf(ts),
          })
          paintMarkers(context, layout)
        })
      },
    }
    const view = { zOrder: () => 'normal', renderer: () => renderer }
    pane.primitive = {
      attached({ chart, requestUpdate }) { pane.chart = chart; pane.requestUpdate = requestUpdate || null },
      detached() { pane.chart = null; pane.requestUpdate = null },
      updateAllViews() {},
      paneViews: () => [view],
    }
    return pane
  }

  const detach = (pane) => {
    const host = pane.attachedTo
    pane.attachedTo = null
    if (host && typeof detachFrom === 'function') {
      try { detachFrom(host, pane.primitive) } catch { /* a removed series took it already */ }
    }
  }
  const attach = (pane, host) => {
    if (pane.attachedTo === host) return
    if (!host || typeof attachTo !== 'function') return
    detach(pane)
    try { attachTo(host, pane.primitive); pane.attachedTo = host } catch { pane.attachedTo = null }
  }
  const repaint = (pane) => { if (typeof pane.requestUpdate === 'function') pane.requestUpdate() }

  return {
    layerFor({ host, paneIndex = 0, order = NaN }) {
      const key = ++seq
      let plotOrder = order
      return {
        kind: 'canvas',
        set(items, marker, nextOrder) {
          if (Number.isFinite(nextOrder)) plotOrder = nextOrder
          let pane = panes.get(paneIndex)
          if (!pane) { pane = makePane(paneIndex); panes.set(paneIndex, pane) }
          pane.groups.set(key, { marker, host, items: items || [], anchorAt: anchorReader(host), order: Number.isFinite(plotOrder) ? plotOrder : key })
          if (!pane.attachedTo) attach(pane, host)
          repaint(pane)
        },
        clear() {
          const pane = panes.get(paneIndex)
          if (!pane || !pane.groups.delete(key)) return
          if (!pane.groups.size) { detach(pane); panes.delete(paneIndex); return }
          const rest = [...pane.groups.values()]
          if (!rest.some((g) => g.host === pane.attachedTo)) attach(pane, rest[0].host)
          repaint(pane)
        },
        get attached() { const pane = panes.get(paneIndex); return !!pane && pane.groups.has(key) },
      }
    },
    /** For rails: the pane primitives that exist, by pane index. */
    get panes() { return panes },
  }
}
