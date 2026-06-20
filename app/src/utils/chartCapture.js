// Capture a chart-with-drawings as a PNG data URL by compositing every <canvas>
// inside a wrapper element at its true on-screen position. The StockChart area is
// entirely canvas-based (lightweight-charts panes/axes + the annotation overlay),
// so this faithfully reproduces candles + axes + your drawn ideal lines without
// touching the shared StockChart component or adding dependencies.
export function captureChartPng(wrapperEl) {
  if (!wrapperEl) return null
  const canvases = Array.from(wrapperEl.querySelectorAll('canvas')).filter(
    (c) => c.width > 0 && c.height > 0,
  )
  if (!canvases.length) return null

  const rect = wrapperEl.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(rect.width * dpr))
  out.height = Math.max(1, Math.round(rect.height * dpr))
  const ctx = out.getContext('2d')
  // Dark background so transparent regions match the app, not white.
  ctx.fillStyle = '#0e0f0d'
  ctx.fillRect(0, 0, out.width, out.height)

  for (const c of canvases) {
    const cr = c.getBoundingClientRect()
    const dx = (cr.left - rect.left) * dpr
    const dy = (cr.top - rect.top) * dpr
    try {
      ctx.drawImage(c, dx, dy, cr.width * dpr, cr.height * dpr)
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
