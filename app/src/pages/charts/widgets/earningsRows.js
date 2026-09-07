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
    // projection of a projection. The EST badge says the ROW is a forecast; this
    // says its GROWTH has no measured figure underneath it either, which the
    // section note and the cell tooltip both spell out.
    projectedGrowth: a.yoy_basis === 'vs_estimate',
    expandable: false,
    source: a,
  }
}

const section = (title, { note = null, meta = null } = {}) =>
  ({ kind: 'section', key: `s-${title}`, title, note, meta })

/**
 * The next report date, for the ESTIMATES section head.
 *
 * This is the ONE fact the old snapshot strip carried that the table below does
 * not already state — the EPS and Sales estimates it also showed are literally
 * the next row down. So the date moves here, beside the estimates it belongs to,
 * and the strip goes away.
 *
 * ⚠️ No confirmed/estimated marker. FMP's future `stable/earnings` rows and the
 * Finnhub calendar both hand us a bare date with no scheduling status, so any
 * "confirmed" or "EST" tag would be a confidence signal we invented. A plain
 * date claims nothing; the methodology panel names the source.
 */
export function nextReportNote(intel) {
  const s = intel?.summary || {}
  const when = fmtDateShort(s.next_report_date)
  if (when) return { label: 'Next report', value: when }
  // A forward quarter with consensus but no scheduled date is a real state.
  if ((intel?.estimates || []).length) return { label: 'Next report', value: 'Date TBD' }
  return null
}

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
      const projected = est.filter(a => a.yoy_basis === 'vs_estimate')
      rows.push(section('Estimates', { note: projected.length
        ? `Growth for ${projected.map(a => a.label).join(' and ')} compares one consensus estimate with another, not with a reported result.`
        : null }))
      est.forEach(a => rows.push(annualRow(a)))
    }
    if (rep.length) {
      rows.push(section('Reported'))
      // NOT capped. The Annual tab is the long-term view; truncating the fiscal
      // history here would leave the product with nowhere that shows it whole.
      rep.forEach(a => rows.push(annualRow(a)))
    }
    return rows
  }

  const est = intel.estimates || []
  const rep = intel.quarters || []
  if (est.length) {
    rows.push(section('Estimates', { meta: nextReportNote(intel) }))
    est.forEach(q => rows.push(quarterRow(q, { estimate: true })))
  }
  if (rep.length) {
    rows.push(section('Reported'))
    rep.slice(0, limit).forEach(q => rows.push(quarterRow(q, { estimate: false })))
  }
  return rows
}

/** How many reported quarters exist beyond the current limit. Quarterly only —
 *  the annual history is never truncated. */
export function hiddenCount(intel, mode, limit) {
  if (mode === 'annual') return 0
  return Math.max(0, (intel?.quarters || []).length - limit)
}

// ── Earnings Quality: how good has this run been ────────────────────────────
const MIN_BEAT_SAMPLE = 3        // two quarters is an anecdote, not a rate

/**
 * The retrospective assessment block.
 *
 * Every entry is gated on the data being MEANINGFUL, not merely present:
 * a beat rate needs a real sample, an acceleration count needs a genuine run,
 * and a margin delta needs a year-ago quarter to compare with. The block itself
 * is suppressed below two facts, because a section heading over one number is
 * chrome pretending to be research.
 */
export function qualityFacts(intel) {
  const s = intel?.summary || {}
  const out = []

  const accel = (n, trend, label) => {
    if (!(n > 0) || !trend) return null
    return {
      key: label, label,
      value: `${n} ${n === 1 ? 'quarter' : 'quarters'}`,
      arrow: trend === 'accelerating' ? '↑' : '↓',
      tone: trend === 'accelerating' ? 'up' : 'down',
      hint: trend === 'accelerating'
        ? 'Consecutive quarters in which the year-over-year growth RATE rose.'
        : 'Consecutive quarters in which the year-over-year growth RATE fell.',
    }
  }
  const e = accel(s.eps_accel_quarters, s.eps_trend, 'EPS acceleration')
  const r = accel(s.rev_accel_quarters, s.rev_trend, 'Sales acceleration')
  if (e) out.push(e)
  if (r) out.push(r)

  if (s.eps_beats_of >= MIN_BEAT_SAMPLE) {
    out.push({
      key: 'epsbeat', label: 'EPS beat rate',
      value: `${s.eps_beats} of ${s.eps_beats_of}`,
      tone: s.eps_beats * 2 >= s.eps_beats_of ? 'up' : 'down',
      hint: 'Quarters that beat the EPS consensus, out of those where a comparable consensus existed.',
    })
  }
  if (s.rev_beats_of >= MIN_BEAT_SAMPLE) {
    out.push({
      key: 'revbeat', label: 'Sales beat rate',
      value: `${s.rev_beats} of ${s.rev_beats_of}`,
      tone: s.rev_beats * 2 >= s.rev_beats_of ? 'up' : 'down',
      hint: 'Quarters that beat the revenue consensus, out of those where a comparable consensus existed.',
    })
  }
  if (s.double_beat_streak > 0) {
    out.push({
      key: 'double', label: 'Beat both',
      value: `${s.double_beat_streak} straight`,
      tone: 'up',
      hint: 'Consecutive most-recent quarters beating BOTH the EPS and the revenue consensus. A quarter that cannot be scored ends the run rather than counting as a miss.',
    })
  }
  if (s.net_margin_pct != null) {
    out.push({
      key: 'margin', label: 'Net margin',
      value: `${Number(s.net_margin_pct).toFixed(1)}%`,
      series: s.net_margin_series || null,
      hint: 'Net income as a share of revenue in the latest reported quarter.',
    })
  }
  if (s.net_margin_delta_pp != null) {
    const d = Number(s.net_margin_delta_pp)
    out.push({
      key: 'marginyoy', label: 'Margin vs year ago',
      // Percentage POINTS: 60% to 68% is +8pp, and "+13%" would be a different
      // and misleading claim.
      value: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)} pts`,
      tone: d > 0 ? 'up' : d < 0 ? 'down' : 'none',
      hint: 'Change in net margin against the same fiscal quarter one year earlier, in percentage points.',
    })
  }
  // One fact under its own heading is chrome, not research.
  return out.length >= 2 ? out : []
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
