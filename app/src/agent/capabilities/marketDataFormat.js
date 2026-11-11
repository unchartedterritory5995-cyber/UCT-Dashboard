// UCT Agent market data — the shared, PURE number and date formatting for the deterministic price and bars answers
// (owner: agent-md). Nothing here reads a clock: every "today" is the read's own time, passed in.

export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** $142.10 · $0.4312 (sub-dollar keeps 4 decimals) · null for a non-number. */
export function money(v) {
  const n = num(v)
  if (n == null) return null
  const d = Math.abs(n) < 1 ? 4 : 2
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}
export function signedMoney(v) {
  const n = num(v)
  return n == null ? null : `${n >= 0 ? '+' : '−'}${money(Math.abs(n))}`
}
export function signedPct(v) {
  const n = num(v)
  return n == null ? null : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}%`
}

/** A session DATE ("2026-10-30", the bar's own ET trading date) → "Fri, Oct 30", or "Fri, Oct 31, 2025" when its year
 *  differs from `refYmd`'s. Read as a calendar date (noon UTC), so no time zone can move it to another day. */
export function sessionDate(ymd, refYmd = null) {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null
  const d = new Date(`${ymd}T12:00:00Z`)
  const sameYear = typeof refYmd === 'string' && refYmd.slice(0, 4) === ymd.slice(0, 4)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }).format(d)
}
