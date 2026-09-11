// Lightweight Charts v5 pane primitive: shades the contiguous TIME RUNS a
// CONDITION is true over, behind everything else in the pane.
//
// ⭐⭐ IT IS THE SESSION SHADER'S SHAPE, DELIBERATELY. `sessionShadingPrimitive`
// has been drawing pre/post-market bands this way since the extended-hours work:
// one `paneView` with `zOrder: 'bottom'`, one `fillRect` per BAND, coordinates
// asked of the time scale at paint. Everything a regime background needs is
// already proven there — the z-order, the geometry, the cost — so the only thing
// this file changes is where the bands come from. A second mechanism would be a
// second set of z-order and zoom bugs.
//
// ⛔ ONE RECTANGLE PER RUN, NEVER ONE PER BAR (Part 28). A regime that holds for
// 4,000 bars is one `fillRect`. The runs are derived upstream by
// `conditionActions.colorRuns`, AFTER priority is resolved — segmenting each
// condition separately and painting them all would stack translucent layers into
// colours nobody picked.
//
// ⛔ AND THE COLOUR CARRIES ITS OWN ALPHA. `opacity` is deliberately NOT an
// option here: the session shader has one because its two tints are fixed and
// the member sets the strength, and a condition's colour is the member's whole
// choice. A second multiplier would make the swatch and the paint disagree
// (Part 32's "do not double-multiply").

/**
 * @param {{enabled?: boolean, runs?: {from: any, to: any, color: string}[]}} initial
 * @returns {{primitive: object, setOptions: (patch: object) => void}}
 */
export function createConditionShadingPrimitive(initial) {
  let opts = { enabled: false, runs: [], ...initial }
  let chart = null
  let requestUpdate = null

  const paneView = {
    // ⭐ BEHIND THE CANDLES, THE WICKS, THE AVERAGES, THE DRAWINGS AND THE
    // CROSSHAIR (Part 29). `'bottom'` is the library's own answer to that, and it
    // is the same one the session shading uses — chart paper, not a highlight.
    zOrder: () => 'bottom',
    renderer: () => ({
      draw: (target) => {
        if (!opts.enabled || !opts.runs.length || !chart) return
        const ts = chart.timeScale()
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save()
          for (const run of opts.runs) {
            let x0
            let x1
            // ⚠️ A RUN WHOSE ENDS ARE OFF-SCREEN YIELDS `null` AND IS SKIPPED —
            // which is the visible clipping, for free and per frame. It also
            // means a run that straddles the whole viewport draws nothing, so
            // the caller clamps its ends to the data range rather than relying
            // on this (see `conditionRuns` in StockChart).
            try {
              x0 = ts.timeToCoordinate(run.from)
              x1 = ts.timeToCoordinate(run.to)
            } catch { continue }
            if (x0 == null || x1 == null) continue
            // Half a slot of padding each side so the bars at the run's ends are
            // fully covered rather than half-shaded.
            const left = Math.min(x0, x1) - 1
            const right = Math.max(x0, x1) + 1
            ctx.fillStyle = run.color
            ctx.fillRect(left, 0, Math.max(1, right - left), mediaSize.height)
          }
          ctx.restore()
        })
      },
    }),
  }

  const primitive = {
    paneViews: () => [paneView],
    updateAllViews: () => {},
    attached: (param) => { chart = param.chart; requestUpdate = param.requestUpdate },
    detached: () => { chart = null; requestUpdate = null },
  }

  return {
    primitive,
    setOptions(patch) { opts = { ...opts, ...patch }; if (requestUpdate) requestUpdate() },
  }
}
