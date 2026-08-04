// app/src/components/research/earningsHistoryModel.js
//
// The per-quarter rows both the Setup hero and the Earnings History section
// consume. Built CLIENT-SIDE for the launch slice: the unified
// GET /api/research/earnings-history/{sym} endpoint is P4 (spec §6 row 3,
// §9 P4), and §9 says the launch modal composes from existing enrichment in
// the interim. The row shape emitted here is the FROZEN one the kit charts
// were built against, so P4 swaps the source with zero component change.
//
// DECISION 1 — INDEX ALIGNMENT. `beat_history` (Finnhub, <=4, newest-first)
// and `hist_stats.last_n` (<=8 next-day moves, newest-first) share no key.
// They are zipped by INDEX over the shorter list, which holds because both are
// walked newest-first off the same quarterly history. It is still an
// approximation, so `historyBasis()` states the count AND the method — every
// number carries its denominator (§2).
//
// DECISION 2 — THE REPORT-DATE ROW STAYS `reported: false` UNTIL ITS REACTION
// IS KNOWN. `ImpliedVsRealized.pairQuarters` identifies the current quarter by
// `reported === false` and only then falls back to `live.pct` for the hollow
// bar. Flipping the row the instant EPS lands would drop tonight's implied bar
// out of the hero exactly when it matters most. The bar's realized value is the
// PRICE REACTION, not the EPS print; the print is carried by the banner result
// line and the History table. Cost: LollipopChart draws that quarter dashed on
// print night. Accepted; P4 fixes it with independent flags.

const num = (v) => {
  // Number(null) === 0 — a bare Number()+isFinite check turns every missing
  // value into a phantom zero, which here would draw zero-height bars for
  // quarters that simply have no data.
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const dayKey = (d) => {
  const s = typeof d === 'string' ? d.trim() : ''
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/** '2026-06-30' -> 'Q2 26'. Calendar-fiscal assumption, same as the Model Book. */
export function quarterLabel(iso) {
  const k = dayKey(iso)
  if (!k) return ''
  const [y, m] = k.split('-')
  const q = Math.floor((Number(m) - 1) / 3) + 1
  return `Q${q} ${y.slice(2)}`
}

function emptyRow(overrides) {
  return {
    quarter: '', report_date: null, period_end: null, session: null, reported: false,
    eps_estimate: null, eps_estimate_low: null, eps_estimate_high: null,
    eps_actual: null, surprise_pct: null,
    revenue_estimate: null, revenue_actual: null, revenue_surprise_pct: null,
    reaction_pct: null, gap_pct: null, drift_pct: null,
    ...overrides,
  }
}

export function buildQuarters({ beatHistory, histStats, reportDate, row } = {}) {
  const hist = Array.isArray(beatHistory) ? beatHistory.filter(Boolean) : []
  const moves = Array.isArray(histStats?.last_n) ? histStats.last_n : []

  // Both sources are newest-first; build newest-first, then reverse ONCE.
  const past = hist.map((h, i) => emptyRow({
    quarter: quarterLabel(h?.period),
    report_date: dayKey(h?.period),
    period_end: dayKey(h?.period),
    reported: true,
    eps_estimate: num(h?.estimate),
    eps_actual: num(h?.actual),
    surprise_pct: num(h?.surprise),
    reaction_pct: num(moves[i]),
  })).reverse()

  const rd = dayKey(reportDate)
  if (!rd && !past.length) return []
  if (!rd) return past

  past.push(emptyRow({
    quarter: quarterLabel(rd),
    report_date: rd,
    period_end: rd,
    reported: false,                       // see DECISION 2
    eps_estimate: num(row?.eps_estimate),
    eps_actual: num(row?.reported_eps),
    revenue_estimate: num(row?.rev_estimate),
    revenue_actual: num(row?.rev_actual),
  }))
  return past
}

/** The caption that states what this composition IS. Null when there is none. */
export function historyBasis(rows) {
  const reported = (rows || []).filter((r) => r.reported).length
  if (!reported) return null
  return `${reported} reported quarters · reactions aligned by index`
}
