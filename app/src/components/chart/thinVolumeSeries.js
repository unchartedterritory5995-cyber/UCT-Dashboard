// Thin "histogram" volume bars — a Lightweight Charts v5 CUSTOM series.
//
// WHY: the built-in HistogramSeries always draws full-slot columns (bars touch
// edge-to-edge; there is no width option), which is the "Columns" look. The
// "Histogram" bar style in Chart Settings → Indicators → Volume wants TC2000-style
// thin bars with a visible gap between each one — that needs custom drawing.
//
// This implements ICustomSeriesPaneView (chart.addCustomSeries). Data shape is the
// SAME as the histogram's ({ time, value, color? }), so every existing writer —
// _applyData, the live developing-bar .update() sites, the HVC gold per-point
// colors, the crossfade re-tints — works unchanged. priceValueBuilder exposes
// `value` so autoscale + param.seriesData.get(...) behave like the histogram too.

class ThinVolumeRenderer {
  constructor() {
    this._data = null
    this._options = null
  }

  update(data, options) {
    this._data = data
    this._options = options
  }

  draw(target, priceConverter) {
    const data = this._data
    const options = this._options
    if (!data || !data.bars?.length || !data.visibleRange || !options) return
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context
      const hpr = scope.horizontalPixelRatio
      const vpr = scope.verticalPixelRatio
      // Volume baseline: y of value 0 (the pane's bottom under autoScale margins).
      const zeroMedia = priceConverter(0)
      const zeroY = Math.round((zeroMedia != null ? zeroMedia : scope.mediaSize.height) * vpr)
      // Bar width = a fraction of the bar slot, so the gap scales with zoom.
      // Clamped: never wider than slot−1px (the gap must survive tight zooms),
      // never thinner than 1 device px (visible at extreme zoom-out).
      const slot = data.barSpacing * hpr
      const ratio = Math.min(0.9, Math.max(0.1, Number(options.widthRatio) || 0.62))
      let w = Math.round(slot * ratio)
      // Floor of 2 device px when the slot allows it — a 1px sliver + dark gap
      // reads as "50% opacity" next to the full-slot columns (owner report,
      // 2026-07-22: pixel-probe showed IDENTICAL RGB in both styles; the dimness
      // was pure perception from the bar:gap area ratio).
      if (w < 2 && slot >= 4) w = 2
      if (w >= slot) w = Math.floor(slot) - 1
      if (w < 1) w = 1
      for (let i = data.visibleRange.from; i < data.visibleRange.to; i++) {
        const bar = data.bars[i]
        const item = bar?.originalData
        if (!item || item.value == null || !Number.isFinite(Number(item.value))) continue
        const yMedia = priceConverter(item.value)
        if (yMedia == null) continue
        const y = Math.round(yMedia * vpr)
        const left = Math.round(bar.x * hpr - w / 2)
        const top = Math.min(y, zeroY)
        const h = Math.max(1, Math.abs(zeroY - y))
        // Per-point color arrives as bar.barColor, NOT originalData.color — LWC's
        // getCustomSeriesPlotRow destructures `color` OUT of the item
        // (`const { time, color, ...data } = item`) and surfaces it here (falling
        // back to the series options color itself). Reading item.color instead
        // silently painted every bar the series default (the launch bug: user
        // up/down volume colors never applied in Histogram style).
        ctx.fillStyle = bar.barColor || options.color
        ctx.fillRect(left, top, w, h)
      }
    })
  }
}

export class ThinVolumeSeries {
  constructor() {
    this._renderer = new ThinVolumeRenderer()
  }

  priceValueBuilder(plotRow) {
    // Include 0 so autoscale anchors the pane at the zero baseline (like the
    // built-in histogram does via its `base`) — without it the range would be
    // [minVolume, maxVolume] and bar heights read exaggerated. The LAST entry is
    // the row's "current price" (crosshair / last-value label) — keep it `value`.
    return [0, plotRow.value]
  }

  isWhitespace(data) {
    return data?.value == null
  }

  renderer() {
    return this._renderer
  }

  update(data, seriesOptions) {
    this._renderer.update(data, seriesOptions)
  }

  defaultOptions() {
    return {
      color: '#1ae51a',
      // Bar width as a fraction of the bar slot (gap = the rest). 0.62 keeps a
      // clear gap while the bars carry enough area to match the columns style's
      // visual weight (0.45 read ~"50% opacity" to the owner at daily zoom).
      widthRatio: 0.62,
    }
  }
}
