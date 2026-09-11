// ─── FORMATTING IS NOT CALCULATION ──────────────────────────────────────────
//
// ⭐⭐ THE STORED VALUE NEVER CHANGES. A formula returns `0.0684`; the FORMAT
// decides whether the header says `0.07`, `6.84%`, `$0.07` or `0`. Switching
// between them re-renders one string and runs no arithmetic — which is why none
// of these arguments appears in the evaluator's memo key.
//
// ⛔ AND A FORMULA MUST NOT MULTIPLY BY 100 "FOR DISPLAY". `Percent` is a
// presentation choice about a ratio; a formula that bakes the ×100 in has
// changed what it MEANS, and the same expression then reads differently
// depending on where it is consumed. ADR is `sma((high-low)/close, 21) * 100`
// because the platform's ADR column IS a percentage figure (`adr_pct`), not
// because the header needs one — and it is formatted as a Number with a `%`
// suffix rather than as a Percent for exactly that reason.

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

/** The empty reading. ⛔ NEVER `0`, `NaN`, `undefined` or `Infinity` — each of
 *  those is a number a trader would act on. */
export const INFO_EMPTY = '—'

/**
 * Compact notation, matching the Info Row's existing volume/dollar-volume shape.
 *
 * ⚠️ ITS OWN PRECISION, DELIBERATELY. `headerFields.fmtVol` has printed `1.2M` /
 * `340K` beside these fields since before this feature, and a custom field that
 * obeyed a `decimals: 3` setting would print `1.234M` next to it. Compact is a
 * SHAPE, and matching the neighbours is what makes the row read as one thing.
 */
function compact(v) {
  const a = Math.abs(v)
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return String(Math.round(v))
}

/**
 * One numeric value → the string the header shows.
 *
 * @param {number|null} value
 * @param {string} format  one of `INFO_FORMATS`
 * @param {number} decimals
 * @param {string} [suffix] a short unit the formats cannot express (`x`, `d`)
 * @returns {string}
 */
export function formatInfoValue(value, format, decimals, suffix) {
  if (!finite(value)) return INFO_EMPTY
  const d = Number.isInteger(decimals) ? Math.max(0, Math.min(4, decimals)) : 2
  const tail = typeof suffix === 'string' && suffix ? suffix : ''
  switch (format) {
    // ⚠️ THE RATIO IS SCALED HERE, not in the formula. `0.0684` → `6.84%`.
    case 'percent': return `${(value * 100).toFixed(d)}%${tail}`
    case 'currency': return `$${value.toFixed(d)}${tail}`
    // Decimals are meaningless for an integer and are ignored rather than
    // clamped, so a field switched to Integer reads as one immediately.
    case 'integer': return `${Math.round(value)}${tail}`
    case 'compact': return `${compact(value)}${tail}`
    case 'number':
    default: return `${value.toFixed(d)}${tail}`
  }
}
