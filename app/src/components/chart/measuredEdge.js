// app/src/components/chart/measuredEdge.js — the "Measured edge" chip's text (owner decision 2, 2026-10-24).
//
// The server decides WHICH types carry a badge (api/services/measured_edge.py, MEASURED_EDGE, the one authority;
// it ships EMPTY): a row has `measured_edge = {lift_pp, ci, n, period, holdout, method_url}` only for a listed
// type. This file only turns those facts into words. A row without the key shows nothing — never a "no edge" chip.
//
// ⛔ Words: describe history, never forecast the stock. Never "confidence", "probability" or "likely", and no
// bare percentage (the lift is in percentage POINTS). measuredEdge.test.js scans every string built here.

export const MEASURED_EDGE_CHIP = 'Measured edge'
export const MEASURED_EDGE_METHOD_LABEL = 'Method'

/** The served badge facts, or null when the row carries none or they are malformed (fail closed). */
export function measuredEdgeOf(row) {
  const b = row?.measured_edge
  if (!b || typeof b !== 'object') return null
  const lift = Number(b.lift_pp)
  const n = Number(b.n)
  if (!Number.isFinite(lift) || lift <= 0 || !Number.isInteger(n) || n < 1) return null
  if (b.holdout !== true || typeof b.period !== 'string' || !b.period.trim()) return null
  if (typeof b.method_url !== 'string' || !b.method_url.startsWith('/') || b.method_url.startsWith('//')) return null
  return { lift, n, period: b.period.trim(), methodUrl: b.method_url }
}

/** The tooltip text, exactly as the owner worded it. */
export function measuredEdgeTooltip(edge) {
  return `+${edge.lift.toFixed(1)}pp hit rate vs a plain 20-day-high breakout in the same stock `
    + `(n=${edge.n}, ${edge.period}, out-of-sample check passed). `
    + 'Hypothetical back-test, not a guarantee; results vary.'
}
