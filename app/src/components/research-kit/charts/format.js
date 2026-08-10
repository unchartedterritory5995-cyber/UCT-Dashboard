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

/**
 * Number, or null — the ONE coercion every chart and readout should use.
 *
 * ⛔ `Number(null)` is 0 and `Number.isFinite(0)` is true, so the obvious
 * one-liner `Number.isFinite(Number(v)) ? Number(v) : null` turns every MISSING
 * value into a real zero. A quarter with no margin draws as a crash to 0%; a
 * price that failed to load renders as $0.00. Both look entirely plausible.
 *
 * This exists because that bug has now been written three times in this
 * codebase by three different hands, twice in one evening. Empty string and
 * whitespace coerce the same way and are excluded for the same reason.
 */
export function toNum(v) {
  if (v == null) return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
