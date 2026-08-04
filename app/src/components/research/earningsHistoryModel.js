// app/src/components/research/earningsHistoryModel.js
//
// The per-quarter rows both the Setup hero and the Earnings History section
// consume. Built CLIENT-SIDE for the launch slice: the unified
// GET /api/research/earnings-history/{sym} endpoint is P4 (spec §6 row 3,
// §9 P4), and §9 says the launch modal composes from existing enrichment in
// the interim. The row shape emitted here is the FROZEN one the kit charts
// were built against, so P4 swaps the source with zero component change.
//
// DECISION 1 (amended, P2 T8b review r2) — INDEX ALIGNMENT, GUARDED. `beat_
// history` (Finnhub, <=4) and `hist_stats.last_n` (<=8 next-day moves,
// newest-first) share no key, so they can only be zipped by INDEX. That
// requires beat_history to ALSO be newest-first — which Finnhub does NOT
// guarantee: live data proved a symbol whose /stock/earnings periods arrived
// non-monotonic (`2026-06-30, 2025-12-31, 2026-03-31`) AND with only 3 of 4
// quarters present. Zipping that raw order pairs the WRONG quarter's realized
// move to the correctly-fiscal-paired implied bar — not just imprecise
// (the prior framing) but ACTIVELY WRONG, silently feeding a false number
// into the RICH/CHEAP chip. Two guards:
//   1. beat_history is SORTED by period descending before zipping — newest-
//      first is now GUARANTEED, not assumed.
//   2. The zip is only TRUSTED when every period parsed AND the sorted
//      length matches `moves`' length exactly — a length mismatch means one
//      side's window doesn't correspond quarter-for-quarter with the other's
//      (a hidden gap), and index alignment past that point can't be told
//      apart from a coincidence. Untrusted -> every row's `reaction_pct` is
//      null, never guessed. Per §12: showing nothing beats showing a
//      confidently wrong number. `historyBasis()` still states the count AND
//      the method — every number carries its denominator (§2).
//
// DECISION 2 — THE REPORT-DATE ROW STAYS `reported: false` UNTIL ITS REACTION
// IS KNOWN. `ImpliedVsRealized.pairQuarters` identifies the current quarter by
// `reported === false` and only then falls back to `live.pct` for the hollow
// bar. Flipping the row the instant EPS lands would drop tonight's implied bar
// out of the hero exactly when it matters most. The bar's realized value is the
// PRICE REACTION, not the EPS print; the print is carried by the banner result
// line and the History table. Cost: LollipopChart draws that quarter dashed on
// print night. Accepted; P4 fixes it with independent flags.
//
// DECISION 3 (P2 T8b) — `report_date` AND `period_end` ARE NOT THE SAME
// CONCEPT AND MUST NOT COLLAPSE. `beat_history` (Finnhub /stock/earnings)
// gives only the fiscal PERIOD END (e.g. `2026-06-30`); the true announcement
// date (`api/services/implied_store.py` keys its snapshots on it) is 2-8
// weeks later and isn't in this source. A past row therefore carries
// `period_end` but leaves `report_date: null` — filling it with the period
// end is exactly the bug that made `pairQuarters` unable to ever match a real
// implied snapshot. Pairing instead rides `fiscal_year`/`fiscal_quarter` —
// Finnhub's own fiscal identifiers, present on BOTH /stock/earnings and
// /calendar/earnings and verified live to agree for the same event — carried
// on every row below. `report_date` equality remains `pairQuarters`' fallback
// for a snapshot recorded before this task (no fiscal key yet).
//
// DECISION 4 (P2 T8b review r1, IMPORTANT) — THE CURRENT ROW IS SUPPRESSED
// ONCE ITS FISCAL IDENTITY ALREADY EXISTS AMONG THE PAST ROWS. Fiscal-key
// pairing (DECISION 3) fixed real accrued history — but it also means that
// on the night Finnhub's /stock/earnings first carries the just-printed
// quarter while `reportDate` (sourced from the calendar and not yet rolled
// forward to the NEXT quarter) still names that SAME quarter, `buildQuarters`
// would emit TWO rows for one real-world print: the past row (now correctly
// fiscal-keyed) and DECISION 2's `reported:false` current row. Both pair
// against the same implied snapshot and both draw a hollow bar — on the one
// night the modal is most likely open. `row.quarter`/`row.year` (the SAME
// Finnhub fiscal fields as `beat_history`, threaded onto the calendar row by
// whatever wires this modal to a real calendar entry) let this be detected
// deterministically instead of by date heuristics; when the caller hasn't
// supplied them yet, this is a no-op and DECISION 2 behaves exactly as
// before — matches the "before this quarter's fiscal key is known, never
// suppress" safety direction.

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

/**
 * '2026-06-30' -> 'Q2 26'. Calendar-fiscal derivation, same as the Model Book —
 * the FALLBACK when the provider's own `quarter`/`year` aren't available.
 *
 * When `quarter`/`year` ARE passed (Finnhub's own fiscal identifiers, present
 * on both /stock/earnings and /calendar/earnings — verified live to agree for
 * the same event), they win outright. This is what makes an off-calendar
 * fiscal year (AAPL: fiscal Q1 ends in December) label correctly — the
 * period-end derivation below would call a December-ending quarter "Q4",
 * which is wrong for AAPL's actual fiscal Q1.
 */
export function quarterLabel(iso, quarter, year) {
  if (quarter != null && year != null) return `Q${quarter} ${String(year).slice(-2)}`
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
    // The provider's own fiscal identity (Finnhub quarter/year) — the pairing
    // key ImpliedVsRealized.pairQuarters uses instead of report_date equality
    // (P2 T8b). null when the source row didn't carry it.
    fiscal_year: null, fiscal_quarter: null,
    ...overrides,
  }
}

export function buildQuarters({ beatHistory, histStats, reportDate, row } = {}) {
  const hist = Array.isArray(beatHistory) ? beatHistory.filter(Boolean) : []
  const moves = Array.isArray(histStats?.last_n) ? histStats.last_n : []

  // DECISION 1 — beat_history is NOT guaranteed newest-first by the provider
  // (proven false live). Sort by period DESCENDING so the zip below walks a
  // GUARANTEED newest-first order rather than an assumed one. A row with a
  // missing/unparseable period (`dayKey` -> null) sorts to the end (oldest)
  // as a safe default — its presence ALSO revokes trust in the whole zip
  // (see `indexAlignmentTrusted`), so where it lands doesn't matter for the
  // reaction pairing, only for display order.
  const sortedHist = [...hist].sort((a, b) => {
    const ka = dayKey(a?.period) || ''
    const kb = dayKey(b?.period) || ''
    if (ka === kb) return 0
    return ka < kb ? 1 : -1   // descending: newer (larger ISO string) first
  })

  // Trusted ONLY when every period parsed AND the two lists are the SAME
  // length. A length mismatch means one side's window doesn't correspond
  // quarter-for-quarter with the other's (a hidden gap in whichever is
  // shorter) — sorting alone can't fix that, and guessing past it is exactly
  // the "confidently wrong number" §12 forbids.
  const everyPeriodParsed = sortedHist.every((h) => dayKey(h?.period) != null)
  const indexAlignmentTrusted = everyPeriodParsed && sortedHist.length === moves.length

  // Both sources are newest-first (sortedHist now GUARANTEED so); build
  // newest-first, then reverse ONCE.
  const past = sortedHist.map((h, i) => {
    const fiscalYear = num(h?.year)
    const fiscalQuarter = num(h?.quarter)
    return emptyRow({
      quarter: quarterLabel(h?.period, fiscalQuarter, fiscalYear),
      // `h.period` (Finnhub /stock/earnings) is the fiscal PERIOD END, not the
      // announcement date — `report_date` and `period_end` are semantically
      // different concepts (see the module comment above). The true
      // announcement date for an already-reported quarter isn't in this
      // source, so report_date stays null rather than being filled with the
      // period end (that collapse is the P2 T8b bug this guards against).
      report_date: null,
      period_end: dayKey(h?.period),
      fiscal_year: fiscalYear,
      fiscal_quarter: fiscalQuarter,
      reported: true,
      eps_estimate: num(h?.estimate),
      eps_actual: num(h?.actual),
      surprise_pct: num(h?.surprise),
      reaction_pct: indexAlignmentTrusted ? num(moves[i]) : null,
    })
  }).reverse()

  const rd = dayKey(reportDate)
  if (!rd && !past.length) return []
  if (!rd) return past

  // The calendar row's own fiscal identity, when the caller has it (see
  // DECISION 4) — same Finnhub quarter/year fields as beat_history, so the
  // current row labels and keys identically to a past row for the SAME print.
  const currentFiscalYear = num(row?.year)
  const currentFiscalQuarter = num(row?.quarter)
  const alreadyInPast = currentFiscalYear != null && currentFiscalQuarter != null
    && past.some((p) => p.fiscal_year === currentFiscalYear && p.fiscal_quarter === currentFiscalQuarter)
  if (alreadyInPast) {
    // DECISION 4: the print already landed in beat_history under this exact
    // fiscal quarter — the past row above already carries its full outcome
    // (actual EPS, reaction). A second `reported:false` row for the identical
    // quarter would draw the SAME implied bar twice.
    return past
  }

  past.push(emptyRow({
    quarter: quarterLabel(rd, currentFiscalQuarter, currentFiscalYear),
    report_date: rd,
    period_end: rd,
    fiscal_year: currentFiscalYear,
    fiscal_quarter: currentFiscalQuarter,
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
