// UPDG's day and full-list read (gap audit P1 + R3, 2026-11-28). Pure functions, no React: the URL for a day, the
// typed day as the command writes it, the held days as picker options, and what the dated answer says about
// itself (which day, whether it was held, which sources fed it, whether the server cut a list).
//
// ⭐ THE ROUTE. `GET /api/analyst-actions` with no argument is unchanged (the last wire, cut to 12/12/15). With
// `full=1` (the latest wire's day) or `date=YYYY-MM-DD` it reads the dated store (api/services/analyst_history.py):
//   { upgrades, downgrades, pt_changes, summary, totals, cut: { limit, lists, from: 'end' },
//     date, requested_date, latest, held, wire_date, wire_status (latest only),
//     sources: { wire: { held, count, recorded_at }, fmp: { count, held_rows, may_grow, settle_days } },
//     store_ok, dates: [YYYY-MM-DD newest first], retention_days, full: true }
// Each item is the wire's shape plus `source` ('wire' | 'fmp'). FMP rows are upgrades and downgrades from the
// nightly analyst pass, dated by the firm's own action date, with no price target.

export const UPGRADES_BASE = '/api/analyst-actions'

/** Pure: a real calendar `YYYY-MM-DD`, else null (an impossible day like 02-30 is refused, never rolled over). */
export function normUpgradesDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw ?? '').trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d, 12))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === mo && dt.getUTCDate() === d ? m[0] : null
}

/** Pure: the read for a day. No day is the latest wire's day, as a FULL list (never the 12/12/15 cut). */
export const upgradesUrl = (date = null) => {
  const d = normUpgradesDate(date)
  return d ? `${UPGRADES_BASE}?date=${d}` : `${UPGRADES_BASE}?full=1`
}

/** Pure: the command's arguments for a kind token and a day (`UPDG DOWN 2026-11-20`); the latest day writes none. */
export const upgradesDayArgs = (kindToken = null, date = null) => [kindToken, normUpgradesDate(date)].filter(Boolean)

/** Pure: `2026-11-20` as `Fri Nov 20, 2026`. A calendar day, so it is read at noon UTC: no zone can move it. */
export function dayLabel(iso) {
  const d = normUpgradesDate(iso)
  if (!d) return null
  const dt = new Date(`${d}T12:00:00Z`)
  const wd = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const md = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return `${wd} ${md}`
}

export const LATEST = ''

/** Pure: the day picker's options: "Latest wire" first, then every held day newest first. A typed day the server
 *  does not list still appears (so the picker shows what is on screen), marked as not held. */
export function dayOptions(dates, current = null) {
  const held = [...new Set((Array.isArray(dates) ? dates : []).map(normUpgradesDate).filter(Boolean))].sort().reverse()
  const cur = normUpgradesDate(current)
  const days = cur && !held.includes(cur) ? [...held, cur].sort().reverse() : held
  return [
    { value: LATEST, label: 'Latest wire' },
    ...days.map((d) => ({ value: d, label: held.includes(d) ? dayLabel(d) : `${dayLabel(d)} (not held)` })),
  ]
}

const LIST_WORDS = { upgrades: 'upgrades', downgrades: 'downgrades', pt_changes: 'target changes' }
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : null)

/**
 * Pure: what a dated / full answer says about itself. `full` is false for the old capped shape (an older server):
 * the panel then keeps its old wording. `cut` lists the lists the server cut, in plain words, with their totals.
 */
export function dayMeta(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
  const full = b.full === true
  const src = b.sources && typeof b.sources === 'object' ? b.sources : {}
  const cutKeys = Array.isArray(b.cut?.lists) ? b.cut.lists.filter((k) => LIST_WORDS[k]) : []
  return {
    full,
    date: normUpgradesDate(b.date),
    latest: full ? b.latest !== false : true,
    held: full ? b.held === true : null,
    wireHeld: full ? src.wire?.held === true : null,
    fmpCount: full ? num(src.fmp?.count) : null,
    fmpMayGrow: full && src.fmp?.may_grow === true,
    fmpSettleDays: num(src.fmp?.settle_days),
    storeOk: b.store_ok !== false,
    dates: Array.isArray(b.dates) ? b.dates.map(normUpgradesDate).filter(Boolean) : [],
    cut: cutKeys.map((k) => ({ list: LIST_WORDS[k], total: num(b.totals?.[k]) })),
    cutLimit: num(b.cut?.limit),
    retentionDays: num(b.retention_days),
  }
}

/** Pure: the source of one row as a member reads it, or null for the wire (the default, named in the footnote). */
export const sourceTag = (source) => (String(source || '').toLowerCase() === 'fmp' ? 'FMP pass' : null)
