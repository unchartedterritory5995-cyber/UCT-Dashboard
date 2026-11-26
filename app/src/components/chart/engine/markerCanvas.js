// app/src/components/chart/engine/markerCanvas.js
//
// ─── e99 — PINE MARKERS, DRAWN ON CANVAS AS TRADINGVIEW DRAWS THEM ────────────
//
// TradingView draws all twelve `plotshape` styles as distinct glyphs (triangle up
// and down, label up and down, flag, diamond, cross, xcross, circle, square,
// arrow up and down) and a `plotchar` as its character; it substitutes nothing
// (FRED RS, AMEX:SPY 1D captures, 2026-11-26). Each lands on exactly its own bar,
// at the location the author wrote: above the bar's high, below its low, at the
// pane's top or bottom, or at the plotted value (`location.absolute`).
// Lightweight-charts' series markers draw four shapes at the bar, so the
// translator maps the other eight onto them (`pine.js::PINE_MARKER_SHAPES`,
// `shapeApprox`) and the pane edges onto the bar (`positionApprox`).
//
// ⭐ THIS MODULE DRAWS THE AUTHOR'S GLYPH. One series primitive per pane
// (`createMarkerCanvasRegistry`) draws every marker plot of that pane:
//   x = timeScale.timeToCoordinate(bar time), never offset;
//   y = above the bar's high / below its low (`location.abovebar` / `belowbar`),
//       from the pane's top / bottom edge (`location.top` / `bottom`), or
//       priceToCoordinate(the plotted value) (`location.absolute`).
// Thirteen glyph path functions (twelve shapes and the character) draw at unit
// size; every size, offset and proportion is read from ONE table,
// `MARKER_GEOMETRY`.
//
// ⛔⛔ THE GEOMETRY IS PROVISIONAL. Nothing here is measured against TradingView's
// pixels yet (the pixel read is in progress). While `MARKER_GEOMETRY.provisional`
// is true, a marker drawn here is recorded `geometryApprox` (`canvasMarkerRecord`)
// and the member door says so (`memberPaneDefinition.js::markerSubstitutionNotes`).
// The shape and the place are what this claims; the size and the offset are not.
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
 *  ⛔ PROVISIONAL: these are placeholders chosen to look reasonable, not readings
 *  of TradingView's pixels. When the pixel read pins them, this table changes and
 *  `provisional` becomes false; nothing else in this file holds a number but 0, 1,
 *  2 and 0.5 (a rail in `markerCanvas.test.js` holds that).
 *
 *  `sizePx` is the glyph's box edge, in CSS pixels, per Pine size word.
 *  `unwrittenSizePx` is the box for a marker whose `size=` was not written: Pine's
 *  default size is not measured, so it is not claimed to be any word.
 *  `barGapPx` is the space between the bar's high (low) and the glyph's box;
 *  `edgeInsetPx` the space between the pane's top (bottom) and the box;
 *  `textGapPx` between the box and its text. `glyph` holds each path's proportions
 *  as fractions of the unit box. */
export const MARKER_GEOMETRY = Object.freeze({
  provisional: true,
  sizePx: Object.freeze({
    'size.tiny': 8, 'size.small': 12, 'size.normal': 18, 'size.large': 26, 'size.huge': 36, 'size.auto': 12,
  }),
  unwrittenSizePx: 12,
  barGapPx: 4,
  edgeInsetPx: 4,
  textGapPx: 2,
  fontPx: 11,
  glyph: Object.freeze({
    arrowStemHalf: 0.18,
    labelTail: 0.3,
    labelTailHalf: 0.15,
    flagPole: 0.16,
    flagCloth: 0.55,
    crossHalf: 0.12,
  }),
})

const G = MARKER_GEOMETRY.glyph

/** A polygon through `pts` (pairs at unit size), scaled by `s`. */
function poly(ctx, s, pts) {
  ctx.moveTo(pts[0][0] * s, pts[0][1] * s)
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i][0] * s, pts[i][1] * s)
  ctx.closePath()
}

/** The plus sign's twelve corners at unit size. */
function crossPoints() {
  const h = 0.5
  const c = G.crossHalf
  return [[-c, -h], [c, -h], [c, -c], [h, -c], [h, c], [c, c], [c, h], [-c, h], [-c, c], [-h, c], [-h, -c], [-c, -c]]
}

const mirrorY = (pts) => pts.map(([x, y]) => [x, -y])

const TRIANGLE_UP = [[0, -0.5], [0.5, 0.5], [-0.5, 0.5]]
const ARROW_UP = () => [[0, -0.5], [0.5, 0], [G.arrowStemHalf, 0], [G.arrowStemHalf, 0.5],
  [-G.arrowStemHalf, 0.5], [-G.arrowStemHalf, 0], [-0.5, 0]]
const LABEL_UP = () => {
  const t = -0.5 + G.labelTail
  return [[0, -0.5], [G.labelTailHalf, t], [0.5, t], [0.5, 0.5], [-0.5, 0.5], [-0.5, t], [-G.labelTailHalf, t]]
}

/** ⭐⭐ THE THIRTEEN GLYPHS: one path function per Pine shape, and the character.
 *  Each draws at unit size `s` centred on the origin (y grows downward) and
 *  returns how it is painted. ⛔ No entry stands in for another: the rail holds
 *  all thirteen paths pairwise distinct and each Pine name to its own entry. */
export const GLYPHS = Object.freeze({
  'shape.circle': (ctx, s) => { ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.closePath(); return 'fill' },
  'shape.square': (ctx, s) => { poly(ctx, s, [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]); return 'fill' },
  'shape.diamond': (ctx, s) => { poly(ctx, s, [[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]]); return 'fill' },
  'shape.triangleup': (ctx, s) => { poly(ctx, s, TRIANGLE_UP); return 'fill' },
  'shape.triangledown': (ctx, s) => { poly(ctx, s, mirrorY(TRIANGLE_UP)); return 'fill' },
  'shape.arrowup': (ctx, s) => { poly(ctx, s, ARROW_UP()); return 'fill' },
  'shape.arrowdown': (ctx, s) => { poly(ctx, s, mirrorY(ARROW_UP())); return 'fill' },
  'shape.labelup': (ctx, s) => { poly(ctx, s, LABEL_UP()); return 'fill' },
  'shape.labeldown': (ctx, s) => { poly(ctx, s, mirrorY(LABEL_UP())); return 'fill' },
  'shape.flag': (ctx, s) => {
    const pole = -0.5 + G.flagPole
    const cloth = -0.5 + G.flagCloth
    poly(ctx, s, [[-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [0.5, cloth], [pole, cloth], [pole, 0.5]])
    return 'fill'
  },
  'shape.cross': (ctx, s) => { poly(ctx, s, crossPoints()); return 'fill' },
  'shape.xcross': (ctx, s) => {
    const r = Math.SQRT1_2
    poly(ctx, s, crossPoints().map(([x, y]) => [(x - y) * r, (x + y) * r]))
    return 'fill'
  },
  char: (ctx, s, text) => {
    ctx.font = `${s}px sans-serif`
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

/** The glyph's box edge in CSS pixels, from the size word when written. */
export function sizePxOf(marker) {
  const word = marker && marker.pineSize
  return Object.hasOwn(MARKER_GEOMETRY.sizePx, word || '') ? MARKER_GEOMETRY.sizePx[word] : MARKER_GEOMETRY.unwrittenSizePx
}

/** The y of a glyph's CENTRE, or null when it has no place on this pane.
 *  `toY` is the host series' `priceToCoordinate`. */
export function placeY(location, { high, low, value, paneHeight, toY, size }) {
  const half = size * 0.5
  const at = (price) => {
    if (!Number.isFinite(price)) return null
    const y = toY(price)
    return Number.isFinite(y) ? y : null
  }
  if (location === 'location.top') return MARKER_GEOMETRY.edgeInsetPx + half
  if (location === 'location.bottom') return Number.isFinite(paneHeight) ? paneHeight - MARKER_GEOMETRY.edgeInsetPx - half : null
  if (location === 'location.absolute') return at(value)
  if (location === 'location.belowbar') {
    const y = at(low)
    return y === null ? null : y + MARKER_GEOMETRY.barGapPx + half
  }
  const y = at(high)
  return y === null ? null : y - MARKER_GEOMETRY.barGapPx - half
}

/** ⭐ THE WHOLE PICTURE OF ONE PANE, AS DATA: one entry per marker to draw.
 *  `groups` are the pane's marker plots (`{marker, host, items}`; an item is
 *  `{time, color, text, value, high, low}`); `timeToCoordinate` is the chart's.
 *  ⛔ x is `timeToCoordinate(time)` exactly: a marker lands on its own bar. */
export function layoutMarkers(groups, { timeToCoordinate, paneHeight, paneWidth = Infinity }) {
  const out = []
  for (const g of groups) {
    const glyph = glyphOf(g.marker)
    if (!glyph || !g.host) continue
    const location = locationOf(g.marker)
    const size = sizePxOf(g.marker)
    const toY = (p) => g.host.priceToCoordinate(p)
    const textAbove = location === 'location.abovebar' || location === 'location.top'
    for (const it of g.items || []) {
      const x = timeToCoordinate(it.time)
      if (!Number.isFinite(x) || x < -size || x > paneWidth + size) continue
      const anchor = g.anchorAt ? g.anchorAt(it) : it
      const y = placeY(location, { high: anchor.high, low: anchor.low, value: it.value, paneHeight, toY, size })
      if (y === null) continue
      out.push({
        glyph, x, y, size, color: it.color,
        text: glyph === 'char' ? '' : (it.text || ''),
        char: glyph === 'char' ? (g.marker.text || '') : '',
        textColor: g.marker.textColor || it.color,
        textAbove,
      })
    }
  }
  return out
}

/** Paint a layout onto a 2D context in media (CSS pixel) coordinates. */
export function paintMarkers(ctx, layout) {
  for (const m of layout) {
    ctx.save()
    ctx.translate(m.x, m.y)
    ctx.fillStyle = m.color
    ctx.beginPath()
    const how = GLYPHS[m.glyph](ctx, m.size, m.char)
    if (how === 'fill') ctx.fill()
    if (m.text) {
      ctx.font = `${MARKER_GEOMETRY.fontPx}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = m.textAbove ? 'bottom' : 'top'
      ctx.fillStyle = m.textColor
      const off = m.size * 0.5 + MARKER_GEOMETRY.textGapPx
      ctx.fillText(m.text, 0, m.textAbove ? -off : off)
    }
    ctx.restore()
  }
}

/** ⭐⭐ THE RECORD, WHEN THIS MODULE DRAWS THE MARKER.
 *
 *  Off (`markerCanvasEnabled`), the marker is returned AS IS (the same object).
 *  On, a marker this module draws (`glyphOf`) is no longer a substituted shape
 *  (`shapeApprox: false`) nor, at the pane's top or bottom, a substituted place
 *  (`positionApprox: false`); and while the geometry table is provisional it is
 *  `geometryApprox: true`: drawn at an approximate size and offset, which the
 *  member door says. A marker this module does not draw is returned as is. */
export function canvasMarkerRecord(marker, enabled = markerCanvasEnabled()) {
  if (!enabled || !glyphOf(marker)) return marker
  const out = { ...marker }
  if (out.shapeApprox === true) out.shapeApprox = false
  const loc = locationOf(marker)
  if ((loc === 'location.top' || loc === 'location.bottom') && out.positionApprox === true) out.positionApprox = false
  if (MARKER_GEOMETRY.provisional) out.geometryApprox = true
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

/** ⭐⭐ ONE SERIES PRIMITIVE PER PANE, drawing every marker plot of that pane.
 *
 *  `layerFor({host, paneIndex})` hands the binder a marker layer with the shape of
 *  `markerPrimitive.createMarkerLayer`'s (`set`, `clear`, `attached`), so the
 *  binder's lifecycle (cleared on a host change, cleared when its binding goes)
 *  is the same for both. The pane's primitive is attached to the first host that
 *  draws in it and moved to another of the pane's hosts when that one's last plot
 *  leaves; it is detached when the pane has no marker plot left. Each plot's y is
 *  read through ITS OWN host (`priceToCoordinate`), whichever series carries the
 *  primitive.
 *
 *  `attach(series, primitive)` / `detach(series, primitive)` are the binder's: this
 *  module never attaches a primitive itself. Without them nothing is attached. */
export function createMarkerCanvasRegistry({ attach: attachTo = null, detach: detachFrom = null } = {}) {
  const panes = new Map()
  let seq = 0

  function makePane(paneIndex) {
    const pane = { paneIndex, groups: new Map(), attachedTo: null, chart: null, requestUpdate: null }
    const renderer = {
      draw(target) {
        if (!pane.chart || !target || typeof target.useMediaCoordinateSpace !== 'function') return
        const ts = pane.chart.timeScale()
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          const layout = layoutMarkers([...pane.groups.values()], {
            timeToCoordinate: (t) => ts.timeToCoordinate(t),
            paneHeight: mediaSize.height,
            paneWidth: mediaSize.width,
          })
          paintMarkers(context, layout)
        })
      },
    }
    const view = { zOrder: () => 'top', renderer: () => renderer }
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
    layerFor({ host, paneIndex = 0 }) {
      const key = ++seq
      return {
        kind: 'canvas',
        set(items, marker) {
          let pane = panes.get(paneIndex)
          if (!pane) { pane = makePane(paneIndex); panes.set(paneIndex, pane) }
          pane.groups.set(key, { marker, host, items: items || [], anchorAt: anchorReader(host) })
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
