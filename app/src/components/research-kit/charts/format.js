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

/** Roughly the width of a "Q3 24" label at the 11px axis size, plus breathing
 *  room. Below this a nine-quarter axis cannot show every label legibly. */
export const MIN_LABEL_SLOT_PX = 38

/**
 * How many quarter labels to SKIP on a dense axis: 1 = draw every label,
 * 2 = every other one.
 *
 * Both SVG charts in this kit label nine quarters along the bottom. On a phone
 * that axis is ~270-330px wide, so each slot is ~30-37px while "Q3 24" needs
 * ~32px at the 11px label size — the labels collide. The previous answer was a
 * phone media query shrinking the label to 9px, which is BELOW the smallest
 * type token (--text-xs is 10px, and 11px under the phone comfort scale) and
 * made the axis the smallest text in the modal.
 *
 * ReactionBars' own phone block already said the right thing — "fewer, larger
 * marks read better than the same density shrunk" — and then shrank the marks
 * anyway. This implements the sentence: thin the labels instead, and let them
 * keep a readable size at every width.
 *
 * Driven by the MEASURED slot, not a breakpoint: the same chart is narrow in
 * the phone sheet AND in EarningsHistorySection's 58px-inset strip, and a
 * `max-width` query cannot see the second one.
 */
export function labelStep(slot, { min = MIN_LABEL_SLOT_PX } = {}) {
  const n = Number(slot)
  if (!Number.isFinite(n) || n <= 0) return 1
  return n < min ? 2 : 1
}
