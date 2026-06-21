// Capture a chart-with-drawings as a PNG data URL by compositing every <canvas>
// inside a wrapper element at its true on-screen position. The StockChart area is
// entirely canvas-based (lightweight-charts panes/axes + the annotation overlay),
// so this faithfully reproduces candles + axes + your drawn ideal lines without
// touching the shared StockChart component or adding dependencies.
//
// Sharpness: the source canvases are already rendered at the device's pixel
// resolution (CSS size × the device scale). To keep the export crystal-clear we
// detect that real scale from a canvas itself (native width ÷ CSS width) — NOT
// window.devicePixelRatio, which disagrees under fractional Windows display
// scaling (125%/150%) and made the old export resample → blurry. We then draw
// each source canvas 1:1 onto a same-scale output so there's no rescaling at all.
export function captureChartPng(wrapperEl) {
  if (!wrapperEl) return null
  const canvases = Array.from(wrapperEl.querySelectorAll('canvas')).filter(
    (c) => c.width > 0 && c.height > 0,
  )
  if (!canvases.length) return null

  const rect = wrapperEl.getBoundingClientRect()

  // Real device scale the chart was rendered at: native canvas pixels per CSS
  // pixel. Read from the widest canvas (the price pane) for the most accurate
  // ratio; fall back to devicePixelRatio if a rect is somehow zero.
  let scale = window.devicePixelRatio || 1
  let widest = null
  for (const c of canvases) {
    if (!widest || c.width > widest.width) widest = c
  }
  if (widest) {
    const wr = widest.getBoundingClientRect()
    if (wr.width > 0) scale = widest.width / wr.width
  }

  const out = document.createElement('canvas')
  out.width = Math.round(rect.width * scale)
  out.height = Math.round(rect.height * scale)
  const ctx = out.getContext('2d')
  // Dark background so transparent regions match the app, not white.
  ctx.fillStyle = '#0e0f0d'
  ctx.fillRect(0, 0, out.width, out.height)
  // Keep any unavoidable fractional placement from softening edges.
  ctx.imageSmoothingEnabled = false

  for (const c of canvases) {
    const cr = c.getBoundingClientRect()
    const dx = Math.round((cr.left - rect.left) * scale)
    const dy = Math.round((cr.top - rect.top) * scale)
    try {
      // 9-arg drawImage: blit the canvas's FULL native resolution to a dest box
      // sized to those same native pixels → exact 1:1, no resampling.
      ctx.drawImage(c, 0, 0, c.width, c.height, dx, dy, c.width, c.height)
    } catch {
      // a tainted/empty canvas — skip it rather than fail the whole capture
    }
  }
  try {
    return out.toDataURL('image/png')
  } catch {
    return null
  }
}
