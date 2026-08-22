// app/src/components/research/sections/statementSeries.js
//
// The pure half of StatementPanels: what the six panels are, and how a panel's
// series are built from the /api/research/financial-history payload. Kept
// beside the component rather than inside it so the component file exports
// only components (react-refresh needs that for HMR to keep its state) and so
// the tests can exercise the arithmetic without a render.

const INK = {
  revenue: '#5aa9e6',
  opinc: '#e8a33d',
  net: '#c9a84c',
  cash: '#3ec9c9',
  gross: '#5aa9e6',
  opex: '#e57373',
  eps: '#a97bd6',
  assets: '#7ed957',
  liab: '#e57373',
}

/** The card's chart height. The skeleton reserves the identical box. */
export const PANEL_HEIGHT = 168
/** The pop-out's chart height: about three cards tall, capped by the viewport
 *  so the legend and the controls stay on screen on a short laptop. */
export const EXPANDED_HEIGHT = 'min(560px, 58vh)'

/** $1.59B / $48.8M / -$450M — a statement axis spans nine orders of magnitude. */
export function money(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${a.toFixed(0)}`
}

const eps = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`)

/** The six panels, declared as data so the grid cannot drift from the legend. */
export const PANEL_SPECS = [
  { key: 'income', title: 'Income statement', fmt: money, series: [
    ['revenue', 'Revenue', INK.revenue], ['operating_income', 'Operating income', INK.opinc]] },
  { key: 'net', title: 'Net income', fmt: money, series: [
    ['net_income', 'Net income', INK.net]] },
  { key: 'cash', title: 'Cash flow', fmt: money, series: [
    ['free_cash_flow', 'Free cash flow', INK.cash]] },
  { key: 'gross', title: 'Gross profit & opex', fmt: money, series: [
    ['gross_profit', 'Gross profit', INK.gross], ['operating_expenses', 'Operating expenses', INK.opex]] },
  { key: 'eps', title: 'Earnings per share', fmt: eps, series: [
    ['eps', 'EPS', INK.eps]] },
  { key: 'balance', title: 'Balance sheet', fmt: money, series: [
    ['total_assets', 'Total assets', INK.assets], ['total_liabilities', 'Total liabilities', INK.liab]] },
]

/**
 * The same period one year earlier, aligned to each point.
 *
 * Quarterly statements are seasonal — a retailer's Q4 dwarfs its Q1 every year,
 * so consecutive bars mostly measure the calendar. Against the year-ago bar the
 * question becomes "is this quarter better than the comparable one", which is
 * the one worth asking.
 *
 * Offset by FOUR for quarters and ONE for years. The first four quarters have
 * no comparison and get null — a gap, never a zero, since a zero bar reads as
 * a business that earned nothing.
 */
export function yoyShift(values, period) {
  const back = period === 'annual' ? 1 : 4
  const v = values || []
  return v.map((_, i) => (i >= back ? v[i - back] : null))
}

/**
 * The series a panel draws — ONE builder shared by the card and its pop-out,
 * so the larger chart is the same chart and can never drift from the small one.
 *
 * `period` is the period the DATA was fetched for (the payload echoes it), not
 * the toggle's current value: while the next period is in flight the previous
 * bars stay on screen, and their year-ago shift must stay theirs.
 *
 * Ghost first so the current bar draws IN FRONT of it — the comparison is
 * context, not the subject.
 */
export function panelSeries(spec, series, period, yoy) {
  return [
    ...(yoy ? spec.series.map(([field, name]) => ({
      name: `${name} (yr ago)`,
      color: 'rgba(255,255,255,.20)',
      values: yoyShift(series[field] || [], period),
    })) : []),
    ...spec.series.map(([field, name, color]) => ({
      name, color, values: series[field] || [],
    })),
  ]
}

/** "24 quarters · Q4 2020 – Q3 2026" — or null when there is nothing to span. */
export function spanLabel(periods, period) {
  const n = (periods || []).length
  if (!n) return null
  const unit = period === 'annual' ? 'year' : 'quarter'
  return `${n} ${unit}${n === 1 ? '' : 's'} · ${periods[0]} – ${periods[n - 1]}`
}
