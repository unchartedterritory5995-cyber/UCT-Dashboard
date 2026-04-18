/**
 * Journal 2.0 — display formatters.
 * Spec §14.8.
 *
 * Separation of concerns: calculations.js returns raw numbers (or null).
 * This module turns them into display strings. Every render call goes
 * through here so rounding and dash-rendering rules live in one place.
 */

const DASH = '—'

/**
 * USD with thousands separator and 2 dp.
 *   $1,234.56   -$250.00   $0.00
 * Null → `—`.
 * @param {number|null|undefined} n
 */
export const money = (n) => {
  if (n == null || !Number.isFinite(n)) return DASH
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Money with an explicit + sign on positives. Used for P&L cells.
 *   +$1,234.56   -$250.00   $0.00
 * @param {number|null|undefined} n
 */
export const moneySigned = (n) => {
  if (n == null || !Number.isFinite(n)) return DASH
  if (n > 0) return `+${money(n)}`
  return money(n)
}

/**
 * Percent formatter. Input is a ratio (0.20 → "20.00%") OR already a
 * percent (20 → "20.00%") — controlled by `isRatio`.
 * Null → `—`.
 *
 * @param {number|null|undefined} n
 * @param {{ dp?: number, signed?: boolean, isRatio?: boolean }} [opts]
 */
export const percent = (n, opts = {}) => {
  if (n == null || !Number.isFinite(n)) return DASH
  const { dp = 2, signed = false, isRatio = true } = opts
  const value = isRatio ? n * 100 : n
  const formatted = value.toFixed(dp)
  if (signed && value > 0) return `+${formatted}%`
  return `${formatted}%`
}

/**
 * R-multiple. 1 dp per §14.8. Signed. Null → `—`.
 * @param {number|null|undefined} n
 */
export const rMultiple = (n) => {
  if (n == null || !Number.isFinite(n)) return DASH
  const formatted = n.toFixed(1)
  if (n > 0) return `+${formatted}R`
  return `${formatted}R`
}

/**
 * Share count.
 * - Non-fractional: integer display.
 * - Fractional: up to 4 dp, trailing zeros stripped (0.5, not 0.5000).
 *
 * @param {number|null|undefined} n
 * @param {boolean} allowFractional
 */
export const shares = (n, allowFractional) => {
  if (n == null || !Number.isFinite(n)) return DASH
  if (!allowFractional) return String(Math.round(n))
  // 4 dp then strip trailing zeros and trailing decimal point
  const rounded = Math.round(n * 10000) / 10000
  const s = rounded.toFixed(4)
  return s.replace(/\.?0+$/, '') || '0'
}

/**
 * Date for table cells: MM/DD/YY.
 * @param {string|Date|null|undefined} d
 */
export const dateShort = (d) => {
  if (!d) return DASH
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return DASH
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${mm}/${dd}/${yy}`
}

/**
 * Date for modal/form inputs: MM/DD/YYYY.
 * @param {string|Date|null|undefined} d
 */
export const dateLong = (d) => {
  if (!d) return DASH
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return DASH
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yyyy = String(date.getFullYear())
  return `${mm}/${dd}/${yyyy}`
}

/**
 * Profit factor: number or '∞' or '0'.
 * @param {number|null|undefined} n
 */
export const profitFactor = (n) => {
  if (n == null || !Number.isFinite(n)) {
    return n === Infinity ? '∞' : DASH
  }
  if (n === 0) return '0.00'
  return n.toFixed(2)
}

/**
 * Hold-days formatter: "1.2d", "0d".
 * @param {number|null|undefined} n
 */
export const holdDaysDisplay = (n) => {
  if (n == null || !Number.isFinite(n)) return DASH
  return `${n.toFixed(1)}d`
}
