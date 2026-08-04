// app/src/components/research-kit/charts/format.js
//
// Shared numeric-formatting helper for the kit's chart/grid components.
// Extracted out of HeatGrid.jsx (which owned it first) once MetricTrendChart
// also needed it — importing a sibling CHART component's internals for a pure
// formatting function is the wrong coupling; a tiny shared module is not.
// HeatGrid.jsx re-exports this under the same name, so the barrel's
// `export { …, formatSigned } from './charts/HeatGrid'` line is unchanged.

/** "+12.4%" — the sign is ALWAYS visible (§3.3). Em-dash for nothing. */
export function formatSigned(value, { unit = '', decimals = 1 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n) || value === null || value === '' || value === undefined) return '—'
  const sign = n > 0 ? '+' : ''
  // Proper rounding to handle floating point precision (e.g., 12.35 should be 12.4)
  const factor = Math.pow(10, decimals)
  const rounded = Math.round(n * factor) / factor
  return `${sign}${rounded.toFixed(decimals)}${unit}`
}
