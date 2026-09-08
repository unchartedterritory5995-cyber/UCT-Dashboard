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

/** Roughly the width of the FULL "FY2026 Q3" fiscal form at the axis size.
 *  Below this a slot cannot hold it and the labels run into each other. */
export const FULL_LABEL_MIN_PX = 62

/**
 * "FY2026 Q3" -> "Q3 '26". The axis form, for slots that cannot hold the full one.
 *
 * `labelStep` above assumes a label about the width of "Q3 24" (~32px) and
 * thins the axis below a 38px slot. The Company Panel feeds this chart the
 * FISCAL form instead -- "FY2026 Q3" is ~56px -- so in a ~380px dock the slots
 * are ~50px: too wide to trip the thinning, too narrow to hold the label. Every
 * label overlapped its neighbours and the axis was unreadable.
 *
 * Thinning is the wrong answer here (it hides half the quarters when there is
 * room for all seven); the label just needs its axis form. Year is kept, as
 * '26, because a reaction strip spans a fiscal-year boundary and bare quarter
 * numbers would repeat.
 *
 * Anything that is not a recognisable fiscal quarter is returned untouched --
 * the reaction rows fall back to a raw report DATE when a quarter label is
 * missing, and mangling that would be worse than a wide label.
 */
export function compactQuarter(label) {
  const s = String(label ?? '').trim()
  if (!s) return ''
  const fy = s.match(/^FY\s*(\d{4})\s*Q([1-4])$/i)
  if (fy) return `Q${fy[2]} '${fy[1].slice(2)}`
  const q = s.match(/\bQ([1-4])\b/i)
  const y = s.match(/\b(\d{4})\b/)
  if (q && y) return `Q${q[1]} '${y[1].slice(2)}`
  return s
}
/** A move, sized for a ~48px slot: one decimal only where it carries meaning.
 *  "+18%" reads at a glance; "+18.1%" costs a character for nothing, while
 *  "+2.6%" would lose its whole magnitude rounded to "+3%". */
export function fmtMove(v) {
  // ⚠️ Reject the empties BEFORE Number(): Number(null) and Number('') are both
  // 0, so a quarter we could not compute would have printed "0.0%" — claiming
  // the stock did not move on a result we never measured.
  if (v == null || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  const digits = Math.abs(n) < 10 ? 1 : 0
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`
}
