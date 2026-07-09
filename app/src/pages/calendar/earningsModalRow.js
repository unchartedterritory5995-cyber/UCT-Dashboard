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
  }
}

// Session timing ('bmo'/'amc' or already-normalized) → EarningsModal label.
export function timingLabel(timing) {
  // An unconfirmed session must read as unconfirmed — never "AFTER MARKET CLOSE".
  if (timing === 'bmo' || timing === 'BEFORE MARKET OPEN') return 'BEFORE MARKET OPEN'
  if (timing === 'amc' || timing === 'AFTER MARKET CLOSE') return 'AFTER MARKET CLOSE'
  return 'TIME TBD'
}
