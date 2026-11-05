// ⛔ WHAT A MOUNTED CHART WRITES INTO opts ON ITS OWN, AFTER A WRITE THAT WAS NOT ITS OWN.
// `opts.watermarkPos.anchor` is the pixel inset the chart derives from the x/y fraction on its first draw (StockChart's
// migration → ChartWidget.adoptWatermarkAnchor, about 300 ms after any position without one). Only a drawn pane knows it,
// so the Agent cannot write it; x/y IS the member's position. Comparing the anchor would make the chart's own bookkeeping
// read as a later edit: every stale-Undo check, approval binding and read-back compares through here instead.
export const watermarkSpot = (pos) => (pos && typeof pos === 'object' ? { x: pos.x ?? null, y: pos.y ?? null } : null)
export function withoutDerivedOpts(opts) {
  return opts?.watermarkPos ? { ...opts, watermarkPos: watermarkSpot(opts.watermarkPos) } : opts
}
