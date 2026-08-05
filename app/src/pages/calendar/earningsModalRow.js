// app/src/pages/calendar/earningsModalRow.js
// Normalize a calendar earnings entry → EarningsModal `row` + session `label`.
// Shared by Calendar.jsx and MyStocksHub.jsx so the modal renders identically
// from both surfaces (no drift between the two copies).

function verdict(eps_act, eps_est) {
  if (eps_act == null) return 'pending'
  if (eps_est == null) return 'reported'
  if (eps_act > eps_est) return 'beat'
  if (eps_act < eps_est) return 'miss'
  return 'meet'
}

export function calcSurprise(act, est) {
  if (act == null || est == null || est === 0) return null
  const pct = ((act - est) / Math.abs(est)) * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

// Calendar entry → EarningsModal row shape.
//
// GATE a (Task 12, found in a live browser): this used to return ONLY the eight
// print fields below. That was correct for the OLD tile modal, which never drew
// history — but the research modal's Earnings History section reads
// `row.beat_history` / `row.hist_stats` (see EarningsHistorySection's
// `buildQuarters({beatHistory: row?.beat_history, histStats: row?.hist_stats})`).
// `mergeEnrichment` (useCalendarData.js) already attaches both to the ENTRY, and
// this function then dropped them on the floor, so the section rendered "No
// reported quarters yet" for every symbol on every path — CAT included, on a day
// it had reported $8.17 vs $6.25 est. No unit test caught it because each one
// hand-authored a `row` fixture that already contained `beat_history`; the real
// row never did. Carry the enrichment overlay through.
export function toModalRow(entry) {
  const v = verdict(entry.eps_act, entry.eps_est)
  return {
    sym:              entry.sym,
    verdict:          v === 'meet' ? 'mixed' : v,
    reported_eps:     entry.eps_act,
    eps_estimate:     entry.eps_est,
    surprise_pct:     calcSurprise(entry.eps_act, entry.eps_est),
    rev_actual:       entry.rev_act,
    rev_estimate:     entry.rev_est,
    rev_surprise_pct: calcSurprise(entry.rev_act, entry.rev_est),
    // Enrichment overlay — absent on an un-enriched entry, which the section
    // already handles via its EmptyState. `?? null` keeps "absent" explicit
    // rather than letting `undefined` read as a missing key.
    beat_history:     entry.beat_history ?? null,
    hist_stats:       entry.hist_stats ?? null,
    expected_move:    entry.expected_move ?? null,
  }
}

// Session timing ('bmo'/'amc' or already-normalized) → EarningsModal label.
export function timingLabel(timing) {
  // An unconfirmed session must read as unconfirmed — never "AFTER MARKET CLOSE".
  if (timing === 'bmo' || timing === 'BEFORE MARKET OPEN') return 'BEFORE MARKET OPEN'
  if (timing === 'amc' || timing === 'AFTER MARKET CLOSE') return 'AFTER MARKET CLOSE'
  return 'TIME TBD'
}
