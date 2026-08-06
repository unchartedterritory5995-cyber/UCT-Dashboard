// app/src/components/research/earningsHistoryModel.js
//
// The per-quarter rows both the Setup hero and the Earnings History section
// consume. Built CLIENT-SIDE for the launch slice: the unified
// GET /api/research/earnings-history/{sym} endpoint is P4 (spec §6 row 3,
// §9 P4), and §9 says the launch modal composes from existing enrichment in
// the interim. The row shape emitted here is the FROZEN one the kit charts
// were built against, so P4 swaps the source with zero component change.
//
// DECISION 1 (amended, P2 T8b review r2, REVERSED review r3) — INDEX
// ALIGNMENT, GUARDED. `beat_history` (Finnhub /stock/earnings, <=4) and
// `hist_stats.last_n` (<=8 next-day moves, newest-first) share no key, so
// they can only be zipped by INDEX. That requires beat_history to ALSO be
// newest-first — which Finnhub does NOT guarantee: live data proved a symbol
// whose /stock/earnings periods arrived non-monotonic
// (`2026-06-30, 2025-12-31, 2026-03-31`). Zipping that raw order pairs the
// WRONG quarter's realized move to the correctly-fiscal-paired implied bar.
// Fix: beat_history is SORTED by period descending before zipping — newest-
// first is now GUARANTEED, not assumed. Still trusted only when every period
// parses (dayKey succeeds) — an unparseable period can't be sorted reliably,
// so its presence revokes trust for the WHOLE zip.
//
// review r2 ALSO required the sorted length to match `moves`' length exactly,
// reasoning a mismatch signals a hidden gap. review r3 REVERSED that: it's
// wrong for the DOMINANT real case. beat_history is Finnhub `/stock/earnings
// ?limit=4` (<=4); `last_n` is FMP/AV `[:8]` (<=8) — two INDEPENDENT provider
// CAPS, not a gap. Live measurement across 12 real symbols: length-match rate
// was 1 in 12; requiring equality blanked `reaction_pct` for ~92% of symbols
// and made the RICH/CHEAP chip permanently unreachable almost everywhere —
// trading a rare wrong number for a universally blank chart, worse than the
// bug it fixed. Both sides are newest-first anchored at the SAME newest
// quarter, so PARTIAL pairing over the shorter list is correct for a
// cap-driven mismatch — `moves[i]` naturally reads `undefined` -> `null`
// beyond its own bound, no length check needed. `historyBasis()` states the
// count AND the method — every number carries its denominator (§2).
//
// RESIDUAL (documented, not fixed — the argument for P4's unified endpoint):
// if the two sides' NEWEST entries are actually different quarters (a gap at
// index 0, not merely a shorter/longer tail), index 0 still pairs wrongly.
// `last_n` is a bare number array with no dates, so that specific alignment
// is unprovable in this client-side shape.
//
// NOT to be confused with (P2 T9 review round 2): `last_n[0]` reading `null`
// specifically on the newest quarter is now a COMMON, CORRECT outcome, not a
// symptom of the residual above. `get_historical_earnings_moves` (backend)
// emits an explicit null for a quarter whose reaction isn't computable YET —
// the dominant case being print night itself, when the newest quarter's
// report is the most recent bar in the price history and there is no
// next-day close to react to. `num()` below already treats that null as
// "unknown", never a phantom zero — this is that contract working as
// intended, on the exact night this modal is most likely to be open.
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
/** Dollars -> millions, the unit `EarningsHistorySection.rev()` renders.
 *  `num()` first so a null/garbage value stays null rather than becoming 0 —
 *  the phantom-zero trap this module already guards everywhere else. */
function _millions(v) {
  const n = num(v)
  return n == null ? null : n / 1e6
}

/** Percent change vs estimate, null-safe and zero-safe. */
function pctChange(actual, estimate) {
  const a = num(actual), e = num(estimate)
  if (a == null || e == null || e === 0) return null
  return ((a - e) / Math.abs(e)) * 100
}

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

  // Trusted when every period parsed (see DECISION 1) — a length mismatch
  // between beat_history and last_n is NOT distrust; it's the DOMINANT case
  // (different provider caps), and moves[i] already reads undefined -> null
  // beyond its own bound, so partial pairing over the shorter list falls out
  // naturally without a length check.
  const everyPeriodParsed = sortedHist.every((h) => dayKey(h?.period) != null)
  const indexAlignmentTrusted = everyPeriodParsed

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
      // Revenue arrives only from the FMP history leg (Finnhub's earnings
      // rows are EPS-only, which is why this column rendered an em dash on
      // every row). Absent on a Finnhub-sourced row -> stays null -> the
      // section still renders the em dash, exactly as before. Provider
      // reports revenue in DOLLARS; the section's `rev()` formats millions,
      // so scale here rather than teaching the formatter two units.
      revenue_actual: _millions(h?.revenue_actual),
      revenue_estimate: _millions(h?.revenue_estimate),
      revenue_surprise_pct: pctChange(h?.revenue_actual, h?.revenue_estimate),
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

/** The caption that states what this composition IS. Null when there is none.
 *  The "reactions aligned by index" clause is conditional on at least one
 *  reaction actually having been paired (P2 T8b review r3, Minor) — an
 *  unparseable period or an empty `last_n` can leave every `reaction_pct`
 *  null, and asserting an alignment method that produced nothing contradicts
 *  §2 ("every number carries its denominator"). */
export function historyBasis(rows) {
  const reportedRows = (rows || []).filter((r) => r.reported)
  if (!reportedRows.length) return null
  const hasReactions = reportedRows.some((r) => r.reaction_pct != null)
  return hasReactions
    ? `${reportedRows.length} reported quarters · reactions aligned by index`
    : `${reportedRows.length} reported quarters`
}
