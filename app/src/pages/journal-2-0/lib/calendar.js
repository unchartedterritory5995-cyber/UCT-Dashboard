/**
 * Calendar helpers — color intensity, date math, formatting.
 */

const DOW_SHORT = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Gain bracket → CSS class suffix; loss bracket → negative suffix */
const PCT_BRACKETS = [
  { min: 0.01, alpha: 0.9 },
  { min: 0.005, alpha: 0.6 },
  { min: 0.001, alpha: 0.25 },
]

const DOLLAR_BRACKETS = [
  { min: 1000, alpha: 0.9 },
  { min: 250, alpha: 0.6 },
  { min: 50, alpha: 0.25 },
]

const R_BRACKETS = [
  { min: 2.0, alpha: 0.9 },
  { min: 1.0, alpha: 0.6 },
  { min: 0.5, alpha: 0.25 },
]

const RGB_GAIN = '60, 184, 104' // var(--gain) #3cb868
const RGB_LOSS = '231, 76, 60'  // var(--loss) #e74c3c

function bucketAlpha(value, brackets) {
  const abs = Math.abs(value)
  for (const b of brackets) {
    if (abs >= b.min) return b.alpha
  }
  return 0
}

/**
 * @param {number} value      - signed metric (pnlPercent, pnlDollar, rSum)
 * @param {'pct'|'dollar'|'r'} mode
 * @returns {string} rgba() background or 'transparent'
 */
export function cellBackground(value, mode = 'pct') {
  if (value == null || value === 0) return 'transparent'
  const brackets =
    mode === 'dollar' ? DOLLAR_BRACKETS :
    mode === 'r'      ? R_BRACKETS :
                        PCT_BRACKETS
  const alpha = bucketAlpha(value, brackets)
  if (alpha === 0) return 'transparent'
  const rgb = value > 0 ? RGB_GAIN : RGB_LOSS
  return `rgba(${rgb}, ${alpha})`
}

/**
 * Build the 7-column grid for a month, rounded to whole weeks.
 * Returns weeks: Array<Array<{date: string, day: number, inMonth: boolean}>>.
 * Sunday-start (US convention).
 */
export function buildMonthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1))
  const firstDow = first.getUTCDay() // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  const cells = []
  // Leading blank padding from prior month
  for (let i = 0; i < firstDow; i++) {
    cells.push(null)
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({ date: dateStr, day: d, inMonth: true })
  }
  // Trailing blanks to round to whole weeks
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return weeks
}

export function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

export function dowLabels() {
  return DOW_SHORT
}

/** Returns YYYY-MM-DD for "today" in America/New_York (consistent with backend). */
export function todayET() {
  // Use Intl to get the current ET date robustly across DST
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date()) // en-CA gives YYYY-MM-DD
}

export function monthOffset(year, month, delta) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

/** Format a P&L $ value like "+$83.00" / "-$50.00" / "$0". */
export function fmtSignedDollar(value) {
  if (value == null) return ''
  if (value === 0) return '$0'
  const sign = value > 0 ? '+' : '-'
  const abs = Math.abs(value).toFixed(2)
  return `${sign}$${abs}`
}

/** Format percent like "+0.17%" / "-1.20%". */
export function fmtSignedPct(value, dp = 2) {
  if (value == null) return ''
  const pct = value * 100
  const sign = pct > 0 ? '+' : (pct < 0 ? '' : '')
  return `${sign}${pct.toFixed(dp)}%`
}

/** Format R like "+4.2R" / "-1.5R" / "0R". */
export function fmtSignedR(value, dp = 1) {
  if (value == null) return ''
  if (value === 0) return '0R'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(dp)}R`
}
