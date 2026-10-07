// Create Indicator's right workspace dock. Width = 40% of the pane, clamped to
// [MIN, MAX] (MAX is the Slice 1 panel's own width): a wide /charts pane gets the
// full 360, a ~750px drill-board chart gets 300 and keeps ~450 of chart. Below
// MIN + MIN_CHART the chart would be a sliver, so the dock overlays instead.
export const STUDIO_DOCK_W_MAX = 360
export const STUDIO_DOCK_W_MIN = 300
export const STUDIO_DOCK_MIN_CHART_W = 340
export function studioDockWidth(outerWidth) {
  if (!Number.isFinite(outerWidth) || outerWidth <= 0) return STUDIO_DOCK_W_MAX
  return Math.max(STUDIO_DOCK_W_MIN, Math.min(STUDIO_DOCK_W_MAX, Math.round(outerWidth * 0.4)))
}
