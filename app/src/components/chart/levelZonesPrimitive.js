// Lightweight Charts v5 SERIES primitive: translucent horizontal bands at price
// ranges — the dark-pool level zones behind the price action (bottom z-order).
//
// SERIES, not pane: a pane primitive has no price→Y mapping at all, so the band
// edges could never be placed. `attached({ series })` is what supplies
// `priceToCoordinate` (same reason swingLabelsPrimitive is a series primitive).
//
// CANVAS, not an SVG/DOM overlay, on purpose: composeScreenshot() captures only
// lightweight-charts' own canvases, so a DOM overlay would look right on screen
// and be MISSING from every branded export — visible-but-unexportable is the
// failure this file exists to avoid.

import { GOLD } from './signatureData'

const BASE_ALPHA = 0.10   // every zone
const TOP_ALPHA = 0.14    // rank 1 only
const MIN_H = 1           // px — see zoneRects

/**
 * Map zones ({lo, hi, rank} from dpToZones) to full-width canvas rects.
 * Pure + exported for tests; the canvas path itself is never vitest-booted.
 *
 * `priceToY` is the series' priceToCoordinate. It returns null off-scale, and a
 * series mid-teardown can hand back undefined/NaN — any of those SKIPS that one
 * zone rather than dropping the whole overlay or drawing at a guessed y.
 */
export function zoneRects(zones, priceToY, width) {
  if (!Array.isArray(zones) || zones.length === 0) return []
  const out = []
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i]
    const y0 = priceToY(z?.hi)
    const y1 = priceToY(z?.lo)
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue
    // Math.min/abs also normalizes an inverted lo/hi. dpToZones already orders
    // the pair, so this is belt-and-braces — but a negative height would render
    // as nothing at all, which is the silent-failure direction.
    //
    // MIN_H keeps a band that rounds to sub-pixel (zoomed far out, or a
    // zero-width band) visible instead of letting the indicator vanish.
    // Mirrors sessionShadingPrimitive's Math.max(1, right - left).
    out.push({
      x: 0,
      y: Math.min(y0, y1),
      w: width,
      h: Math.max(MIN_H, Math.abs(y1 - y0)),
      // Rank is carried VERBATIM when it's a real number and null otherwise
      // (dpToZones emits null for an unranked level). It is only ever compared
      // to 1 — never used to index a table — so an unranked or garbage rank
      // lands on base alpha, the low-emphasis direction.
      rank: Number.isFinite(z?.rank) ? z.rank : null,
    })
  }
  return out
}

// Same regex parse as sessionShadingPrimitive's withAlpha. Returns null on an
// unparseable hex so the caller can fall back rather than paint a wrong colour.
function withAlpha(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '')
  if (!m) return null
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${alpha})`
}

// Factory → { primitive, setZones, setOptions }.
// opts: { color, baseAlpha, topAlpha }; zones: [{lo, hi, rank}] from dpToZones.
// There is NO `enabled` flag — `setZones([])` is the off switch, and an empty
// list bails before the media-space callback.
export function createLevelZonesPrimitive(initial = {}) {
  let zones = Array.isArray(initial.zones) ? initial.zones : []
  let opts = {
    color: initial.color || GOLD,
    baseAlpha: initial.baseAlpha ?? BASE_ALPHA,
    topAlpha: initial.topAlpha ?? TOP_ALPHA,
  }
  let series = null
  let requestUpdate = null

  // Fill styles are built ONCE per options change, not per rect per frame — the
  // rgba string is the only other allocation draw() would otherwise make.
  let fillBase = ''
  let fillTop = ''
  function recolor() {
    fillBase = withAlpha(opts.color, opts.baseAlpha) || withAlpha(GOLD, opts.baseAlpha)
    fillTop = withAlpha(opts.color, opts.topAlpha) || withAlpha(GOLD, opts.topAlpha)
  }
  recolor()

  // Declared once, not rebuilt per frame: draw() runs on every frame of a pan or
  // zoom, and a fresh closure per frame is exactly the allocation this primitive
  // must not make. Returns null (not a throw) when the series is gone.
  function priceToY(price) {
    if (!series) return null
    try {
      return series.priceToCoordinate(price)
    } catch {
      return null
    }
  }

  const paneView = {
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!series || zones.length === 0) return
        // A primitive that throws from draw() takes the whole frame — and every
        // other primitive on it — down with it. Nothing escapes this.
        try {
          target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
            const rects = zoneRects(zones, priceToY, mediaSize.width)
            if (rects.length === 0) return
            ctx.save()
            for (let i = 0; i < rects.length; i++) {
              const r = rects[i]
              ctx.fillStyle = r.rank === 1 ? fillTop : fillBase
              ctx.fillRect(r.x, r.y, r.w, r.h)
            }
            ctx.restore()
          })
        } catch { /* never throw from draw() */ }
      },
    }),
  }

  const primitive = {
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (param) => { series = param.series; requestUpdate = param.requestUpdate },
    detached: () => { series = null; requestUpdate = null },
  }

  function redraw() { if (requestUpdate) requestUpdate() }

  return {
    primitive,
    setZones(next) { zones = Array.isArray(next) ? next : []; redraw() },
    setOptions(patch) { opts = { ...opts, ...patch }; recolor(); redraw() },
  }
}
