/**
 * Dates on the Data Charts x axis and in its tooltip.
 *
 * ⚰️ THE DEFECT (audit A-06): ticks were `MM/DD`, so a year-long window showed
 * "03/31" twice, a year apart, and nothing said which was which. The format now
 * follows the visible span (02-design §4, D-031): ≤ 6 months "Jun 15" (the first
 * session of a year carries it), ≤ 2 years "Jun '26" on month starts, longer
 * "2026" on year starts. Session dates are ISO labels; no time zone is involved.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHORT_SPAN_DAYS = 183
const MEDIUM_SPAN_DAYS = 730

const parts = iso => iso.split('-').map(Number)

/** Calendar days from `fromIso` to `toIso`; 0 when either is missing. */
export function spanDays(fromIso, toIso) {
  if (!fromIso || !toIso) return 0
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000)
}

/** Which categories carry a label: null lets ECharts space them; otherwise month or year starts. */
export function tickBoundary(dates, span) {
  if (span <= SHORT_SPAN_DAYS) return null
  const cut = span <= MEDIUM_SPAN_DAYS ? 7 : 4          // 'YYYY-MM' or 'YYYY'
  return index => index === 0 || dates[index].slice(0, cut) !== dates[index - 1].slice(0, cut)
}

export function formatSessionTick(iso, span, isFirstOfYear = false) {
  const [y, m, d] = parts(iso)
  if (span > MEDIUM_SPAN_DAYS) return String(y)
  if (span > SHORT_SPAN_DAYS) return `${MONTHS[m - 1]} '${String(y).slice(2)}`
  return isFirstOfYear ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${d}`
}

export function formatTooltipDate(iso) {
  const [y, m, d] = parts(iso)
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`
}
