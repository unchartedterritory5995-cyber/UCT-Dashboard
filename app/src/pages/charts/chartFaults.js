// app/src/pages/charts/chartFaults.js
// A chart that reached its error boundary, said where a reader can hear it. A change to a chart lands in its settings, so every
// check that reads those settings passes while the chart itself is gone: the render that throws comes later, once its bars
// arrive. Each boundary around a chart reports here, by the id the chart is addressed by, and nothing else writes.
const faults = new Map()
const listeners = new Set()

/** Called by a chart's error boundary. `id`: the widget id, or a Multi Chart cell's id. */
export function noteChartFault(id) {
  if (id == null) return
  const key = String(id)
  faults.set(key, Date.now())
  for (const fn of [...listeners]) { try { fn(key) } catch { /* a listener never breaks a boundary */ } }
}
/** Has this chart faulted at or after `since` (ms)? */
export const chartFaultedSince = (id, since) => (faults.get(String(id)) ?? -1) >= since
/** Hear every fault from now on; → stop listening. */
export function onChartFault(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
export function _resetChartFaults() { faults.clear(); listeners.clear() }
