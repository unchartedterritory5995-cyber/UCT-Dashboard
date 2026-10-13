// "Before / after this rule" sentences (spec §P2 item 2; R-P2b-3). The server marks `small` below 10
// trades (rule_versions.SMALL_SAMPLE); this file never prints a bare percentage for a small sample.
// ⛔ SMALL and rule_versions.SMALL_SAMPLE are one fact in two files:
// tests/test_rule_before_after.py::test_the_client_small_sample_is_the_servers reads the line below.
const SMALL = 10
const pct = (x) => `${Math.round(x * 100)}%`

export function windowLines(win) {
  const n = win?.trades || 0
  // The server's `small` when it gives one; without it the sample decides (fix round 1, m5).
  const small = typeof win?.small === 'boolean' ? win.small : n < SMALL
  const winRate = !n ? 'No trades'
    : small ? `${win.wins} of ${n} won (too few trades to read as a rate)`
    : `${pct(win.winRate)} won (${win.wins} of ${n} trades)`
  const avgR = !win?.rCount ? 'No R recorded'
    : `${win.avgR > 0 ? '+' : ''}${Number(win.avgR).toFixed(2)} R average (over ${win.rCount} trades)`
  const a = win?.adherenceCount || 0
  const adherence = !a ? 'No checklist record'
    : a < SMALL ? `${pct(win.adherence)} of checklist items followed (only ${a} trades: too few to read as a rate)`
    : `${pct(win.adherence)} of checklist items followed (over ${a} trades)`
  return { winRate, avgR, adherence }
}
