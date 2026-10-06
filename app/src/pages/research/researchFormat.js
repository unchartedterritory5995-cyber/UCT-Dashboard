// app/src/pages/research/researchFormat.js
//
// Research's percent shapes, as thin calls into the ONE shared formatter
// (lib/presentation/presentationPrimitives.js). This file owns no rounding of
// its own: it exists because the research tabs and depth panels had six
// private `fmtPct` copies, and every one of them reduced to one of these three
// calls. The missing-value glyph is the shared ABSENT ('—') throughout.
//
// ⚠️ `formatPercent({ signed: true })` signs ZERO ("+0.0%"). Every research
// copy signed only a strictly positive value, so `signedPct` passes
// `signed: n > 0` rather than `true` — zero stays "0.0%", exactly as before.
// (Noted for lane 1: a `signed: 'positive'` option on formatPercent would let
// this file disappear.)
import { ABSENT, formatNumberMax, formatPercent } from '../../lib/presentation/presentationPrimitives'

const num = (v) => (v == null || v === '' ? NaN : Number(v))

/** A percent-unit value with a leading "+" when positive: 12.34 -> "+12.3%". */
export function signedPct(v, decimals = 1) {
  const n = num(v)
  return formatPercent(n, { decimals, signed: n > 0 })
}

/** A FRACTION rendered as a percent: 0.1234 -> "12.3%". */
export function fractionPct(v, decimals = 1) {
  const n = num(v)
  return formatPercent(n * 100, { decimals })
}

/** A percent-unit value with up to `maxDecimals` and no padded zeros: 12.5 -> "12.5%". */
export function pctUpTo(v, maxDecimals = 2) {
  const n = num(v)
  const body = formatNumberMax(n, { maxDecimals, absent: null })
  return body == null ? ABSENT : `${body}%`
}
