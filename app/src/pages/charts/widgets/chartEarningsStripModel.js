/**
 * Pure model for the chart's earnings strip. Kept out of the component file so
 * that file only exports a component (react-refresh), and so the cell selection
 * can be tested without mounting a chart.
 *
 * ⛔ Everything here reads the SAME `/api/earnings-intel` payload the Company
 * Panel's Earnings tab reads, formatted with the SAME `earningsRows` helpers —
 * `growthCell` in particular, which owns the green/red/gold rule and the guard
 * that a swing off a loss never earns gold. Nothing re-derives EPS, revenue,
 * YoY or the estimate state.
 */
import { fmtDateShort, fmtEps, growthCell, shortLabel } from './earningsRows'

/**
 * Revenue at strip width: ONE decimal, not two.
 *
 * The panel's `fmtSales` gives "$41.46B", which is right for a table row and
 * ~6px too wide for a cell here — it pushed the value into an ellipsis
 * ("$41.4…") at every width. The second decimal carries nothing at a glance,
 * and losing it is what lets the value column be fixed instead of clipped.
 */
export function stripSales(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(1)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}$${Math.round(a / 1e6)}M`
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`
  return `${sign}$${Math.round(a)}`
}

/**
 * A growth cell at strip width.
 *
 * `growthCell` answers a swing through zero with words rather than a
 * fabricated percentage — correct, and "Profitable" is twice the width of any
 * number beside it, so it broke the horizontal rhythm and squeezed the value.
 * Shortened here for the strip only; the full wording stays as the title, and
 * the panel's table is untouched. The TONE is never re-derived.
 */
const COMPACT = { Profitable: 'PROFIT', 'To loss': 'TO LOSS' }

export function stripGrowth(cell) {
  if (!cell) return null
  const short = COMPACT[cell.text]
  return short
    ? { ...cell, text: short, title: cell.text, semantic: true }
    : { ...cell, title: null }
}

/**
 * The quarter label, at strip width.
 *
 * ⛔ It MUST keep the "FY" marker. This used to render "FY2027 Q2" as "Q2 '27",
 * which reads as CALENDAR 2027 — a date in the future — when it is NVDA's
 * fiscal 2027 Q2: period ending 2026-07-31, reported 2026-08-26. NVDA's fiscal
 * year ends in late January, so its FY label runs roughly a year ahead of the
 * calendar, and dropping "FY" turned correct data into an apparent bug.
 *
 * Delegates to the panel's own `shortLabel`, which was written for exactly this
 * ("the fiscal year still reads unambiguously; only the century goes") — so the
 * strip and the Earnings tab abbreviate identically instead of twice.
 */
export function stripLabel(label) {
  return shortLabel(String(label ?? '').trim())
}

/** Roughly the width one cell needs before EPS and its YoY start colliding.
 *
 * Raised again 134 -> 160: at 134 the cells sat shoulder to shoulder and the
 * strip read as crammed even though nothing collided. This drops roughly two
 * quarters per width and spends the width on breathing room instead.
 *
 * Originally raised 118 -> 134 to BUY FONT SIZE. At 118 the value had to sit
 * at 10.5px and the percentage at 9.5px to fit, and a figure one step smaller
 * than the figure beside it reads as unsettled — the growth number is not
 * secondary, it is half of what the cell says. At 134 both sit at 12px and
 * match. The cost is roughly one quarter per width, which is the trade the
 * owner asked for: fewer quarters, read more easily. */
export const CELL_PX = 160

/**
 * Reported quarters oldest -> newest, then forward estimates.
 *
 * Chronological left-to-right on purpose: the strip sits directly under a time
 * axis that runs the same way, so reversing it would put the newest quarter
 * above the oldest bars.
 */
export function stripCells(intel, max) {
  if (!intel) return []
  const reported = (intel.quarters || [])
    .filter(q => q && q.reported)
    .slice(0, Math.max(0, max))
    .reverse()
    .map(q => ({
      key: `r:${q.label}`,
      label: stripLabel(q.label),
      est: false,
      date: fmtDateShort(q.report_date),
      eps: fmtEps(q.eps_actual),
      epsCell: stripGrowth(growthCell(q.eps_yoy_pct, q.eps_yoy_note)),
      rev: stripSales(q.revenue_actual),
      revCell: stripGrowth(growthCell(q.rev_yoy_pct, q.rev_yoy_note)),
    }))
  const estimates = (intel.estimates || []).map(e => ({
    key: `e:${e.label}`,
    label: stripLabel(e.label),
    est: true,
    date: fmtDateShort(e.report_date),
    eps: fmtEps(e.eps_estimate),
    epsCell: stripGrowth(growthCell(e.eps_yoy_pct, e.eps_yoy_note)),
    rev: stripSales(e.revenue_estimate),
    revCell: stripGrowth(growthCell(e.rev_yoy_pct, e.rev_yoy_note)),
  }))
  // Flag the first forecast so the strip can mark where actuals stop without a
  // separate element or a background fill.
  if (estimates.length) estimates[0].firstEst = true
  const all = [...reported, ...estimates]
  // Trim from the OLD end: a forward estimate is the most valuable cell here.
  return all.length > max ? all.slice(all.length - max) : all
}
