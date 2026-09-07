/**
 * earningsRows — the Earnings tab's row model and value language.
 *
 * Pure functions, no React: the table's correctness (which rows exist, in what
 * order, what each cell says and what colour it earns) is testable without
 * mounting anything, and the component below it only has to render.
 *
 * ONE ROW SHAPE for quarterly and annual, reported and estimated. That is what
 * makes Quarterly ↔ Annual a change of resolution rather than a second screen,
 * and what keeps estimates and history on one column geometry.
 *
 * VALUE LANGUAGE (the approved colour decision — deliberately simple):
 *   negative growth      → red
 *   positive growth      → green
 *   ≥ +100% growth       → restrained gold, on the value itself, no badge
 *   loss → profit        → the words "Profitable"
 *   profit → loss        → the words "To loss"
 *   unavailable          → an em dash
 * Gold is the whole triple-digit signal. Two gold values in a row already say
 * "EPS and sales both tripled" without a badge repeating it.
 */

// ── formatting ──────────────────────────────────────────────────────────────
export function fmtEps(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`
}

export function fmtSales(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const s = n < 0 ? '-' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`
  return `${s}$${a.toFixed(0)}`
}

/** A growth percentage. Four figures and up compress to "+1.4K%" so the column
 *  never has to widen for a hypergrowth quarter. */
export function fmtPct(v, decimals = 0) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(1)}K%`
  return `${sign}${a.toFixed(decimals)}%`
}

export function fmtDateShort(iso) {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function fmtDateLong(iso) {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/** "FY2026 Q3" → "FY26 Q3" — the narrow-panel form. The fiscal year still reads
 *  unambiguously; only the century goes. */
export function shortLabel(label) {
  return typeof label === 'string' ? label.replace(/^FY(\d{2})(\d{2})/, 'FY$2') : label
}

// ── growth cells ────────────────────────────────────────────────────────────
export const GOLD_THRESHOLD = 100

/**
 * A growth cell: { text, tone, semantic }.
 *
 * `tone` is one of 'gold' | 'up' | 'down' | 'none'. `semantic` marks the two
 * cases that are a STATE rather than a rate, so the renderer can drop the
 * tabular-figure treatment a percentage wants.
 *
 * A swing through zero has no meaningful percentage, and inventing one is the
 * classic earnings-table lie ("+430%" when the year-ago quarter was a loss).
 * The backend hands us a note instead; we render the note.
 */
export function growthCell(pct, note) {
  if (note === 'turned_profitable') return { text: 'Profitable', tone: 'up', semantic: true }
  if (note === 'turned_negative') return { text: 'To loss', tone: 'down', semantic: true }
  if (pct == null || Number.isNaN(Number(pct))) return null
  const n = Number(pct)
  // A loss narrowing from -$2.00 to -$0.50 is a real +75% improvement, but the
  // company lost money in both periods — so it never earns the gold that means
  // "this business tripled". The expansion explains the basis.
  const fromLoss = note === 'loss_narrowing' || note === 'loss_widening'
  const tone = (!fromLoss && n >= GOLD_THRESHOLD) ? 'gold' : n < 0 ? 'down' : 'up'
  return { text: fmtPct(n), tone, semantic: false, fromLoss }
}

// ── surprise (row expansion only) ───────────────────────────────────────────
/**
 * A surprise cell, or null when no comparable consensus existed.
 *
 * Never manufactured: the backend only supplies a surprise when the actual and
 * the estimate share an accounting basis, and reports an ABSOLUTE surprise when
 * the estimate sits near zero (a $0.01 estimate beaten by two cents is not
 * "+200%"). Both of those decisions survive here untouched.
 */
export function surpriseCell(pct, abs, isEps) {
  if (pct == null && abs == null) return null
  const basis = pct != null ? pct : abs
  const positive = basis > 0
  if (pct != null && Math.abs(pct) < 0.5) return { text: 'In line', tone: 'none' }
  const magnitude = pct != null
    ? fmtPct(Math.abs(pct), 1).replace('+', '')
    : (isEps ? fmtEps(Math.abs(abs)) : fmtSales(Math.abs(abs)))
  return { text: `${positive ? 'Beat' : 'Missed'} by ${magnitude}`, tone: positive ? 'up' : 'down' }
}

// ── row + section model ─────────────────────────────────────────────────────
function quarterRow(q, { estimate }) {
  const eps = estimate ? q.eps_estimate : q.eps_actual
  const sales = estimate ? q.revenue_estimate : q.revenue_actual
  return {
    kind: 'row',
    key: `${estimate ? 'e' : 'q'}-${q.fiscal_year}-${q.fiscal_quarter}`,
    label: q.label || '—',
    estimate,
    eps: fmtEps(eps),
    epsNegative: typeof eps === 'number' && eps < 0,
    epsGrowth: growthCell(q.eps_yoy_pct, q.eps_yoy_note),
    sales: fmtSales(sales),
    salesGrowth: growthCell(q.rev_yoy_pct, q.rev_yoy_note),
    // Only a reported quarter has an actual-vs-estimate story to expand into.
    expandable: !estimate,
    source: q,
  }
}

function annualRow(a) {
  return {
    kind: 'row',
    key: `a-${a.fiscal_year}-${a.estimate ? 'e' : 'r'}`,
    label: a.label || `FY${a.fiscal_year}`,
    estimate: !!a.estimate,
    eps: fmtEps(a.eps),
    epsNegative: typeof a.eps === 'number' && a.eps < 0,
    epsGrowth: growthCell(a.eps_yoy_pct, a.eps_yoy_note),
    sales: fmtSales(a.revenue),
    salesGrowth: growthCell(a.rev_yoy_pct, a.rev_yoy_note),
    // An estimate whose growth is measured against another estimate is a
    // projection of a projection; the renderer marks it rather than passing it
    // off as measured history.
    projectedGrowth: a.yoy_basis === 'vs_estimate',
    expandable: false,
    source: a,
  }
}

const section = (title, note) => ({ kind: 'section', key: `s-${title}`, title, note })

/**
 * Build the ordered row list for the table.
 *
 * Reverse-chronological throughout: the furthest estimate at the top, reading
 * down through the present into history — one monotonic time axis, so scanning
 * from "what is expected" to "what happened" never changes mental model.
 *
 * @param intel  the /api/earnings-intel payload
 * @param mode   'quarterly' | 'annual'
 * @param limit  how many REPORTED periods to show (estimates are never capped)
 */
export function buildRows(intel, mode = 'quarterly', limit = 8) {
  const rows = []
  if (!intel) return rows

  if (mode === 'annual') {
    const est = (intel.annual?.estimates) || []
    const rep = (intel.annual?.reported) || []
    if (est.length) {
      rows.push(section('Estimates'))
      est.forEach(a => rows.push(annualRow(a)))
    }
    if (rep.length) {
      rows.push(section('Reported'))
      rep.slice(0, limit).forEach(a => rows.push(annualRow(a)))
    }
    return rows
  }

  const est = intel.estimates || []
  const rep = intel.quarters || []
  if (est.length) {
    rows.push(section('Estimates'))
    est.forEach(q => rows.push(quarterRow(q, { estimate: true })))
  }
  if (rep.length) {
    rows.push(section('Reported'))
    rep.slice(0, limit).forEach(q => rows.push(quarterRow(q, { estimate: false })))
  }
  return rows
}

/** How many reported periods exist beyond the current limit. */
export function hiddenCount(intel, mode, limit) {
  const all = mode === 'annual' ? (intel?.annual?.reported || []) : (intel?.quarters || [])
  return Math.max(0, all.length - limit)
}

// ── the 3-second strip ──────────────────────────────────────────────────────
/**
 * Facts for the one-line summary strip, in plain language.
 *
 * Returns ONLY the entries whose data is genuinely present — never a
 * placeholder. A company with no scheduled date and no acceleration run yields
 * an empty list, and the strip does not render at all.
 */
export function summaryFacts(intel) {
  const s = intel?.summary || {}
  const out = []
  const when = fmtDateShort(s.next_report_date)
  if (when) out.push({ key: 'next', label: 'Next report', value: when })
  else if (s.next_report_label) out.push({ key: 'next', label: 'Next report', value: s.next_report_label })

  if (s.next_eps_estimate != null) {
    out.push({ key: 'est', label: 'EPS estimate', value: fmtEps(s.next_eps_estimate) })
  }
  // "EPS accel ×4" was cryptic; a trader should not have to decode the strip.
  if (s.eps_accel_quarters > 0 && s.eps_trend) {
    out.push({
      key: 'accel',
      label: s.eps_trend === 'decelerating' ? 'EPS slowing' : 'EPS accelerating',
      value: `${s.eps_accel_quarters} ${s.eps_accel_quarters === 1 ? 'qtr' : 'qtrs'}`,
      accent: s.eps_trend === 'accelerating',
    })
  }
  if (s.double_beat_streak > 0) {
    out.push({
      key: 'streak',
      label: 'Beat both',
      value: `${s.double_beat_streak} ${s.double_beat_streak === 1 ? 'qtr' : 'qtrs'}`,
      accent: true,
    })
  }
  return out
}

// ── row expansion ───────────────────────────────────────────────────────────
/**
 * The detail behind a reported quarter — an actual-vs-estimate COMPARISON
 * rather than a restatement of the row above it.
 *
 * Every entry is omitted when its data is absent, so the block never pads
 * itself with em dashes to look complete.
 */
export function expansionModel(q) {
  if (!q) return null
  const epsSurprise = surpriseCell(q.eps_surprise_pct, q.eps_surprise_abs, true)
  const revSurprise = surpriseCell(q.rev_surprise_pct, q.rev_surprise_abs, false)
  const noConsensus = q.eps_surprise_note === 'no_comparable_estimate'

  const groups = []
  if (q.eps_actual != null || q.eps_estimate != null) {
    groups.push({
      key: 'eps',
      title: 'EPS',
      actual: q.eps_actual != null ? fmtEps(q.eps_actual) : null,
      estimate: q.eps_estimate != null ? fmtEps(q.eps_estimate) : null,
      surprise: epsSurprise,
    })
  }
  if (q.revenue_actual != null || q.revenue_estimate != null) {
    groups.push({
      key: 'rev',
      title: 'Revenue',
      actual: q.revenue_actual != null ? fmtSales(q.revenue_actual) : null,
      estimate: q.revenue_estimate != null ? fmtSales(q.revenue_estimate) : null,
      surprise: revSurprise,
    })
  }

  const facts = []
  if (q.net_margin_pct != null) {
    facts.push({ k: 'Net margin', v: `${Number(q.net_margin_pct).toFixed(1)}%` })
  }
  const ended = fmtDateLong(q.period_end)
  if (ended) facts.push({ k: 'Period ended', v: ended })
  const reported = fmtDateLong(q.report_date)
  if (reported) facts.push({ k: 'Reported', v: reported })

  const notes = []
  if (noConsensus) {
    notes.push(
      q.eps_basis === 'gaap_diluted'
        ? 'No consensus on a comparable basis for this quarter, so no surprise is shown. The figures above are GAAP diluted EPS as reported.'
        : 'No consensus on a comparable basis for this quarter, so no surprise is shown.')
  }
  if (q.eps_surprise_note === 'near_zero_estimate') {
    notes.push('The EPS consensus was close to zero, so the surprise is shown as an absolute amount — a percentage would overstate a few cents.')
  }
  if (q.eps_yoy_note === 'loss_narrowing' || q.eps_yoy_note === 'loss_widening') {
    notes.push('EPS was negative in both this quarter and the year-ago quarter, so the change compares the size of the losses.')
  }
  return { groups, facts, notes }
}
