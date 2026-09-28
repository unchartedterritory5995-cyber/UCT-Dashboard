// app/src/pages/cot/cotFormat.js — number/date formatting shared by the COT
// chart panes and the positioning rail. ONE copy; both surfaces import it.
//
// ⭐ The magnitude suffix is `lib/presentation`'s since TERM-066; this module
// keeps only the COT ladder and its missing-value rule.
import { formatCompact } from '../../lib/presentation/presentationPrimitives'

/** "2025-11-07" → "11/7/2025" */
export function fmtDate(iso) {
  const [y, m, d] = iso.split('-')
  return `${parseInt(m)}/${parseInt(d)}/${y}`
}

/** Full integer with separators; negatives in accounting parentheses. */
export function fmtNum(v) {
  if (v == null) return ''
  const abs = Math.abs(Math.round(v)).toLocaleString()
  return v < 0 ? `(${abs})` : abs
}

/** The COT ladder, as it has always been: M at two decimals, K by `Math.round`
 *  (NOT `toFixed(0)` — "-2K" for -2,500, where toFixed would say "-3K"), and no
 *  B tier, so a billion reads "1000.00M". Recorded as disagreements with the
 *  other grammars in TERM-066, and preserved rather than unified. */
const COT_TIERS = [
  { at: 1e6, suffix: 'M', decimals: 2 },
  { at: 1e3, suffix: 'K', decimals: 'round' },
]

/** 2,072,358 → "2.07M"; 10,560 → "11K"; 512 → "512" (sign preserved). */
export function fmtCompact(v) {
  if (v == null) return ''
  // `+v` is the coercion the retired body's `Math.abs(v)` performed — it throws
  // on a BigInt exactly as that did, where `Number(v)` would not.
  const n = +v
  // ⚠️ A non-finite value keeps its retired rendering verbatim: 'NaN', and
  // 'InfinityM' / '-InfinityM' (an infinite magnitude fell into the M tier).
  // Odd, recorded, and NOT fixed under a refactor — `compactAdoption.test.jsx`.
  if (!Number.isFinite(n)) return Number.isNaN(n) ? 'NaN' : `${n}M`
  return formatCompact(n, { tiers: COT_TIERS })
}

/** Week-over-week change: "▲ 5K" / "▼ 5K"; zero or missing → "—". */
export function fmtSignedCompact(v) {
  if (v == null || v === 0) return '—'
  return `${v > 0 ? '▲' : '▼'} ${fmtCompact(Math.abs(v))}`
}

/** Net as a share of open interest: "−5.5%" / "+0.0%"; missing → "—". */
export function fmtPct(v) {
  if (v == null || !Number.isFinite(v)) return '—'
  const s = Math.abs(v).toFixed(1)
  return v < 0 ? `−${s}%` : `+${s}%`
}
