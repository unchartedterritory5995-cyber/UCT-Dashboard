/* Which pane does a drawing live in, and what rectangle is that?
 *
 * ─── THE PROBLEM THIS REPLACES ──────────────────────────────────────────────
 *
 * There was no pane model. A point got a `paneRelY` — a fraction of the WHOLE
 * CANVAS — the moment it was clicked more than 1px below the price pane, and
 * that was the entire concept of "this is in the volume pane". Three things
 * followed from it, all of them wrong:
 *
 *   1. NOTHING WAS CLIPPED. `redraw` clipped horizontally (to keep drawings off
 *      the price axis) and never vertically, so a price-pane trendline painted
 *      straight through the volume bars and a volume-pane note painted up into
 *      the candles.
 *   2. OWNERSHIP WAS PER POINT, RE-DERIVED EVERY FRAME. A two-point line could
 *      legitimately have one anchor in each pane, and dragging an endpoint across
 *      the divider silently converted half a drawing into the other pane.
 *   3. `paneRelY` IS A CANVAS FRACTION, so dragging the volume divider moved
 *      every volume-pane drawing relative to the volume bars it was marking. The
 *      drawing "looked right at one size" and at no other.
 *
 * ─── THE MODEL ──────────────────────────────────────────────────────────────
 *
 * The chart is an ordered stack of ZONES, derived from the renderer itself
 * (`chart.panes()`, the series' own price scales) rather than re-computed from
 * settings — the same discipline `chartRegion.js` follows for the right-click
 * menu, and for the same reason: a second computation can be confidently right
 * about a chart that is not on screen.
 *
 *   price   — the candle pane, minus the volume band when volume is an OVERLAY
 *   volume  — the separate volume pane, or that band
 *   pane1…N — anything else below (oscillator panes under Flip C)
 *
 * ⛔ BOTH VOLUME LAYOUTS ARE REAL AND THE DEFAULT IS THE AWKWARD ONE.
 * `cs.volume.separatePane` defaults to FALSE, so on a stock /charts widget the
 * volume histogram is a BAND inside pane 0 drawn against its own overlay price
 * scale — there is no pane boundary to read, only that scale's `scaleMargins`.
 * Grid cells and Review cards force the separate pane. Code that assumed either
 * one would be wrong on most charts or on some charts; this reads whichever is
 * actually there.
 *
 * ⭐ AND THE FALLBACK IS "DON'T CLIP", NEVER "CLIP TO NOTHING". Every unknown —
 * a missing chart, a disposed series, a stored pane key this chart doesn't have
 * (volume switched off under a volume-pane drawing) — resolves to the whole plot
 * rect. A wrong clip makes a drawing VANISH, which is indistinguishable from
 * losing it; a missing clip merely looks like it did last week.
 *
 * Pure numbers in, pure numbers out. No lightweight-charts import, so it is
 * testable without a chart — see `drawingPanes.test.js`.
 */

/** The zone key a drawing gets when nothing better is known. */
export const PRICE = 'price'
export const VOLUME = 'volume'

/**
 * Build the zone stack from measurements the caller has already taken.
 *
 * @param {object} m
 * @param {number} m.width          canvas CSS width
 * @param {number} m.height         canvas CSS height
 * @param {number} m.axisWidth      right price-axis width (px)
 * @param {number} m.timeAxisHeight bottom time-axis height (px)
 * @param {number[]} m.paneHeights  ordered pane heights (px) from chart.panes()
 * @param {number} [m.separatorHeight=1]
 * @param {number|null} [m.volumePaneIndex]  index into paneHeights when volume
 *        has its OWN pane; null when it is a band (or absent)
 * @param {number|null} [m.volumeBandTop]    volume overlay's scaleMargins.top —
 *        a fraction of the CANDLE pane's height. Used only when
 *        `volumePaneIndex` is null. null = no volume band at all.
 * @param {number} [m.candlePaneIndex=0]
 */
export function resolveZones(m) {
  const {
    width = 0, height = 0, axisWidth = 0, timeAxisHeight = 0,
    paneHeights = [], separatorHeight = 1,
    volumePaneIndex = null, volumeBandTop = null, candlePaneIndex = 0,
  } = m || {}

  const x0 = 0
  // Keep the SHIPPED horizontal clip exactly: `w - axisWidth - 1`. This is what
  // stops a ray streaking across the price scale, and Phase 1 adds vertical
  // clipping beside it rather than replacing it.
  const x1 = Math.max(0, width - axisWidth - 1)

  // Absolute top of each pane, walking the stack with separators between.
  const tops = []
  let y = 0
  for (let i = 0; i < paneHeights.length; i++) {
    tops.push(y)
    y += (paneHeights[i] || 0) + (i < paneHeights.length - 1 ? separatorHeight : 0)
  }
  const stackBottom = paneHeights.length
    ? tops[paneHeights.length - 1] + (paneHeights[paneHeights.length - 1] || 0)
    : 0

  // ⛔ THE PLOT BOTTOM COMES FROM THE PANE STACK, NOT FROM `height - timeAxis`.
  //
  // ⚰️ MEASURED IN-BROWSER, AND IT COLLAPSED THE VOLUME PANE TO ZERO HEIGHT.
  // The overlay canvas does NOT reliably include the time axis: on one layout it
  // was 736px covering pane0 + volume + axis, on another 697px covering pane0 +
  // volume and nothing else. Subtracting the axis height from the second case
  // cut 28px off a plot that never contained it, so the volume zone came back as
  // `{y0: 669, y1: 669}` — and every volume-pane drawing resolved its `paneY`
  // against a zero-height rect and vanished.
  //
  // The panes themselves are the authority on where the plot ends: whatever the
  // canvas happens to span, the last pane's bottom edge is the last row a
  // drawing can occupy. `timeAxisHeight` survives only as the fallback for a
  // chart that reports no panes at all.
  const plotBottom = stackBottom > 0
    ? Math.min(height || stackBottom, stackBottom)
    : Math.max(0, height - timeAxisHeight)
  const plot = { key: 'plot', x0, y0: 0, x1, y1: plotBottom }

  // No usable pane measurements → one zone covering the plot. Every drawing is
  // 'price', and clipping degrades to today's horizontal-only behaviour.
  if (!paneHeights.length || !(x1 > x0) || !(plotBottom > 0)) {
    return { plot, zones: [{ key: PRICE, x0, y0: 0, x1, y1: plotBottom }] }
  }

  const paneRect = (i) => ({
    x0, x1,
    y0: tops[i],
    y1: Math.min(plotBottom, tops[i] + (paneHeights[i] || 0)),
  })

  const zones = []
  const candle = paneRect(candlePaneIndex)

  if (volumePaneIndex == null && volumeBandTop != null && volumeBandTop > 0 && volumeBandTop < 1) {
    // BAND LAYOUT. The candle pane splits at the volume overlay's own top margin.
    const split = candle.y0 + (candle.y1 - candle.y0) * volumeBandTop
    zones.push({ key: PRICE, x0, x1, y0: candle.y0, y1: split })
    zones.push({ key: VOLUME, x0, x1, y0: split, y1: candle.y1 })
  } else {
    zones.push({ key: PRICE, ...candle })
  }

  // Every other pane, in render order. The volume pane keeps the `volume` key so
  // a drawing survives the user toggling between the two layouts.
  let extra = 0
  for (let i = 0; i < paneHeights.length; i++) {
    if (i === candlePaneIndex) continue
    const key = i === volumePaneIndex ? VOLUME : `pane${++extra}`
    zones.push({ key, ...paneRect(i) })
  }
  return { plot, zones }
}

/** The zone containing `y`, or the last zone when `y` is below every zone.
 *  Never null: a click has to land somewhere, and "nowhere" is not a pane. */
export function zoneAtY(geom, y) {
  const zones = geom?.zones
  if (!zones || !zones.length) return null
  for (const z of zones) if (y >= z.y0 && y < z.y1) return z
  return y < zones[0].y0 ? zones[0] : zones[zones.length - 1]
}

/** The key a NEW drawing created at `y` should own. */
export function paneKeyAtY(geom, y) {
  return zoneAtY(geom, y)?.key ?? PRICE
}

/**
 * The clip rectangle for a drawing that claims `key`.
 *
 * ⛔ AN UNKNOWN KEY RETURNS THE WHOLE PLOT, NOT AN EMPTY RECT. A user with a
 * volume-pane drawing who switches volume off would otherwise watch it vanish
 * with no way to know it was still there. Degrading to "unclipped" puts it back
 * exactly where it rendered before Phase 1.
 */
export function rectForKey(geom, key) {
  if (!geom) return null
  if (key) {
    const z = geom.zones?.find((k) => k.key === key)
    // ⛔ A ZERO-HEIGHT ZONE IS "NOT LAID OUT YET", NOT "CLIP EVERYTHING AWAY".
    // ⚰️ MEASURED IN-BROWSER: for the first frames after mount, and again after a
    // relayout, `chart.panes()` can report a sub-pane's height as 0 while the DOM
    // has not caught up. That produced a volume zone of `{y0: 669, y1: 669}`, and
    // every volume-pane drawing clipped to nothing and blinked out until the
    // layout settled. Falling through to the plot keeps them on screen through
    // the transient — which is the same rule as an unknown key, for the same
    // reason: a wrong clip makes a drawing VANISH, and a user cannot tell that
    // apart from having lost it.
    if (z && z.y1 > z.y0 && z.x1 > z.x0) return z
  }
  return geom.plot
}

/**
 * Which zone does a LEGACY drawing (no `pane` field) belong to?
 *
 * ⛔ ONE ANSWER FOR THE WHOLE DRAWING, FROM ITS LOWEST ANCHOR. Ownership used to
 * be per point, so a legacy line can genuinely straddle the divider. Something
 * has to break the tie, and the tie-break has to be deterministic or the drawing
 * changes pane as the chart re-scales.
 *
 * ⭐ THE LOWEST ANCHOR WINS, and that is the conservative choice rather than the
 * obvious one. Picking the FIRST anchor would put a line drawn from the candles
 * down into the volume bars in the price pane and clip its lower half away —
 * hiding part of a drawing the user can currently see. Picking the lowest keeps
 * the whole thing visible in the roomier interpretation: a straddling legacy
 * line becomes a volume-pane drawing whose top half is clipped only if it leaves
 * the volume zone, and a `paneRelY` point (which today can ONLY have been
 * created below the price pane) always resolves below anyway.
 *
 * `resolved` is the index-stable pixel list; invalid points are skipped.
 */
export function inferPaneKey(geom, resolved) {
  if (!geom?.zones?.length) return PRICE
  let lowest = null
  for (const p of resolved || []) {
    if (!p || p.valid === false || !Number.isFinite(p.y)) continue
    if (lowest == null || p.y > lowest) lowest = p.y
  }
  if (lowest == null) return PRICE
  return paneKeyAtY(geom, lowest)
}

/** Fraction (0..1) of a zone's height for an absolute canvas y. */
export function toPaneFraction(rect, y) {
  if (!rect) return null
  const h = rect.y1 - rect.y0
  if (!(h > 0)) return null
  return (y - rect.y0) / h
}

/** Absolute canvas y for a fraction of a zone's height. */
export function fromPaneFraction(rect, frac) {
  if (!rect || frac == null) return null
  const h = rect.y1 - rect.y0
  if (!(h > 0)) return null
  return rect.y0 + frac * h
}
