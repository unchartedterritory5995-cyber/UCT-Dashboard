// app/src/pages/terminal/panels/fundHoldersModel.js
//
// The OWN panel's "Funds (13F)" block: which funds hold a stock and who added or cut last quarter,
// from the Form 13F holder rows the ownership answer already carries
// (`GET /api/research/ownership/{sym}` -> `thirteen_f`: FMP's holder analytics for the newest
// quarter whose 45-day filing window has closed, and that quarter's position summary).
//
// Pure functions, no React, so the UCT Agent can read the same rows and words.
//
// THE RULES THIS FILE HOLDS
//   * A figure the filing data does not carry is words ("not reported"), never 0 and never blank.
//     A real 0 (a sold-out position holds 0 shares) is a figure and prints as one.
//   * A 13F says what a filer held on the quarter's last day, not what it did or when. So the
//     words are "added", "cut", "new position", "sold out", never "bought" or "sold".
//   * Time is stated, never implied: the quarter end, how long ago it was, the 45-day filing rule,
//     and each holder's own filing date.
//   * The list is bounded (20 by default, the rest on request) and says where it stops: the server
//     reads one page of holders (`holders_limit`), so a list that long may be cut by the vendor.

import {
  formatCompactTerminal, formatCurrency, formatNumber, formatPercent,
} from '../../../lib/presentation/presentationPrimitives'
import { quarterEnd, quarterLabel } from '../../charts/widgets/ownershipModel'
import { dayText } from './shortInterestModel'

export const FUNDS_TITLE = 'Funds (13F)'
export const FUNDS_SOURCE = 'Form 13F filings, through FMP'
/** Rows shown before "Show all". */
export const DEFAULT_ROWS = 20
/** SEC Rule 13f-1: a manager files within 45 days after each calendar quarter ends. */
export const FILING_DEADLINE_DAYS = 45
export const NOT_REPORTED = 'not reported'
/** The server's words for a failed 13F read (`ownership.LEG_13F`), as `legs_failed` carries them. */
export const LEG_13F_WORDS = 'institutional holders (Form 13F)'

const DAY_MS = 86_400_000

const num = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 10) : null)
const flag = (v) => v === true || v === 1
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)

// ── rows ────────────────────────────────────────────────────────────────────

/** What a filing says happened to the position over the quarter, or null when it does not say. */
function positionState(isNew, soldOut, change) {
  if (isNew) return 'new'
  if (soldOut) return 'sold_out'
  if (change == null) return null
  return change > 0 ? 'added' : change < 0 ? 'cut' : 'unchanged'
}

/** The block's rows from the answer's `thirteen_f`, in the vendor's order (`rank`). */
export function fundRows(tf) {
  const list = Array.isArray(tf?.holders) ? tf.holders : []
  return list.filter((h) => h && typeof h === 'object').map((h, i) => {
    const changeShares = num(h.change_shares)
    const isNew = flag(h.is_new)
    const soldOut = !isNew && flag(h.is_sold_out)
    return {
      key: `${text(h.cik) || text(h.name) || 'holder'}-${i}`,
      rank: i,
      name: text(h.name),
      cik: text(h.cik),
      shares: num(h.shares),
      priorShares: num(h.prior_shares),
      changeShares,
      changePct: num(h.change_pct),
      ownership: num(h.ownership),
      priorOwnership: num(h.prior_ownership),
      changeOwnership: num(h.change_ownership),
      value: num(h.market_value),
      priorValue: num(h.prior_market_value),
      weight: num(h.weight),
      priorWeight: num(h.prior_weight),
      changeWeight: num(h.change_weight),
      quarterEndPrice: num(h.quarter_end_price),
      quarterEnd: isoDay(h.quarter_end),
      filed: isoDay(h.filing_date),
      state: positionState(isNew, soldOut, changeShares),
    }
  })
}

/** The words for a position's state (shown beside the holder), or null. */
export const STATE_WORDS = {
  new: { text: 'New position', tone: 'up' },
  sold_out: { text: 'Sold out', tone: 'down' },
}

/** A filer's 13F filings on SEC EDGAR, from its CIK (digits only), or null. */
export function secFilerUrl(cik) {
  const c = String(cik ?? '').trim()
  if (!/^\d{1,10}$/.test(c)) return null
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c}&type=13F-HR&dateb=&owner=include&count=40`
}

// ── cells ───────────────────────────────────────────────────────────────────

const signedText = (v, body) => (v > 0 ? `+${body}` : body)
/** `v` rounded the way its cell prints it, so a figure that prints as zero is zero: no sign, no
 *  colour ("0.00pp", never "-0.00pp" in red). */
const roundTo = (v, decimals) => {
  if (v == null) return null
  const r = Math.round(v * 10 ** decimals) / 10 ** decimals
  return r === 0 ? 0 : r
}

/** Shares or dollars on the terminal ladder; a missing figure is words. */
const compact = (v, money = false) => (v == null ? NOT_REPORTED : formatCompactTerminal(v, { money }))
const signedCompact = (v, money = false) => (v == null ? NOT_REPORTED : signedText(v, formatCompactTerminal(v, { money })))
const pct = (v) => (v == null ? NOT_REPORTED : formatPercent(v, { decimals: 2 }))
const points = (v) => {
  const r = roundTo(v, 2)
  return r == null ? NOT_REPORTED : signedText(r, `${formatNumber(r, { decimals: 2 })}pp`)
}

/** The change in shares as a percent. A new position has no prior holding to measure against. */
export function changePctText(row) {
  if (row.state === 'new') return 'new'
  if (row.changePct == null) return row.state === 'sold_out' ? 'sold out' : NOT_REPORTED
  return formatPercent(row.changePct, { decimals: 1, signed: true })
}

// ── columns and sorting ─────────────────────────────────────────────────────

/** Every column of the table, in order. `optional` columns are drawn only when some row carries
 *  the figure (an answer cached before the server passed it on carries none of them). `kind`
 *  decides the first sort direction: numbers and dates largest / newest first, names A to Z. */
export const FUND_COLUMNS = Object.freeze([
  { key: 'holder', label: 'Holder', words: 'holder', kind: 'text', cell: (r) => r.name || 'Name not reported' },
  { key: 'shares', label: 'Shares', words: 'shares', kind: 'number', value: (r) => r.shares, cell: (r) => compact(r.shares) },
  { key: 'change', label: 'Change', words: 'change in shares', kind: 'number', value: (r) => r.changeShares, cell: (r) => signedCompact(r.changeShares), tone: true },
  {
    key: 'changePct', label: 'Chg %', words: 'percent change', kind: 'number', cell: changePctText, tone: true, decimals: 1,
    // a new position is the largest possible add; a sold-out one gave up all of it
    value: (r) => (r.state === 'new' ? Infinity : r.changePct ?? (r.state === 'sold_out' ? -100 : null)),
  },
  { key: 'ownership', label: '% of shares', words: 'percent of shares', kind: 'number', value: (r) => r.ownership, cell: (r) => pct(r.ownership) },
  { key: 'value', label: 'Value (USD)', words: 'value', kind: 'number', value: (r) => r.value, cell: (r) => compact(r.value, true) },
  { key: 'weight', label: 'Fund weight', words: 'fund weight', kind: 'number', optional: true, value: (r) => r.weight, cell: (r) => pct(r.weight) },
  { key: 'filed', label: 'Filed', words: 'filing date', kind: 'date', optional: true, value: (r) => r.filed, cell: (r) => (r.filed ? dayText(r.filed) : NOT_REPORTED) },
  { key: 'priorShares', label: 'Shares last qtr', words: "last quarter's shares", kind: 'number', optional: true, value: (r) => r.priorShares, cell: (r) => compact(r.priorShares) },
  { key: 'priorValue', label: 'Value last qtr', words: "last quarter's value", kind: 'number', optional: true, value: (r) => r.priorValue, cell: (r) => compact(r.priorValue, true) },
  { key: 'changeOwnership', label: '% of shares chg', words: 'change in percent of shares', kind: 'number', optional: true, value: (r) => r.changeOwnership, cell: (r) => points(r.changeOwnership), tone: true, decimals: 2 },
  { key: 'changeWeight', label: 'Weight chg', words: 'change in fund weight', kind: 'number', optional: true, value: (r) => r.changeWeight, cell: (r) => points(r.changeWeight), tone: true, decimals: 2 },
].map((c) => Object.freeze(c)))

export const COLUMN_BY_KEY = Object.freeze(Object.fromEntries(FUND_COLUMNS.map((c) => [c.key, c])))

/** The columns to draw for these rows: every core column, and an optional one only when some row
 *  carries its figure. */
export function presentColumns(rows) {
  return FUND_COLUMNS.filter((c) => !c.optional || rows.some((r) => c.value(r) != null))
}

/** The sign a numeric cell carries, for its colour (the text carries the sign too). */
export function toneOf(column, row) {
  if (!column.tone) return null
  if (column.key === 'changePct' && row.state === 'new') return 'up'
  const raw = column.value(row)
  const v = column.decimals == null || raw == null || !Number.isFinite(raw) ? raw : roundTo(raw, column.decimals)
  return v == null ? null : v > 0 ? 'up' : v < 0 ? 'down' : null
}

export const DEFAULT_SORT = Object.freeze({ key: 'shares', dir: 'desc' })

const sortKeyOf = (column, row) => {
  if (column.key === 'holder') return row.name ? row.name.toLowerCase() : null
  const v = column.value(row)
  return v == null ? null : v
}

/** Rows sorted by one column. A missing figure sinks to the bottom in either direction, and ties
 *  keep the vendor's order, so a re-sort never shuffles equal rows. */
export function sortFundRows(rows, sort = DEFAULT_SORT) {
  const column = COLUMN_BY_KEY[sort?.key] || COLUMN_BY_KEY[DEFAULT_SORT.key]
  const dir = sort?.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = sortKeyOf(column, a)
    const y = sortKeyOf(column, b)
    if (x == null || y == null) return x == null && y == null ? a.rank - b.rank : x == null ? 1 : -1
    if (x < y) return -dir
    if (x > y) return dir
    return a.rank - b.rank
  })
}

/** The sort after a header press: the same column flips; a new column starts largest / newest
 *  first for figures and dates, A to Z for names. */
export function nextSort(current, key) {
  const column = COLUMN_BY_KEY[key]
  if (!column) return current || DEFAULT_SORT
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: column.kind === 'text' ? 'asc' : 'desc' }
}

/** The sort in words, for the line under the table. */
export function sortWords(sort = DEFAULT_SORT) {
  const column = COLUMN_BY_KEY[sort?.key] || COLUMN_BY_KEY[DEFAULT_SORT.key]
  const asc = sort?.dir === 'asc'
  if (column.kind === 'text') return `by ${column.words}, ${asc ? 'A to Z' : 'Z to A'}`
  if (column.kind === 'date') return `by ${column.words}, ${asc ? 'oldest first' : 'newest first'}`
  return `by ${column.words}, ${asc ? 'lowest first' : 'highest first'}`
}

/** The rows to draw: the first `limit` of the sorted list, or all of them. */
export function boundRows(rows, showAll, limit = DEFAULT_ROWS) {
  return showAll ? rows : rows.slice(0, limit)
}

// ── the lines around the table ──────────────────────────────────────────────

const count = (v) => (v == null ? null : formatNumber(Math.round(v)))

/** The one-line summary from the quarter's own position summary: the shares 13F filers held and
 *  how many positions were new, added to, cut and sold out. A count the summary does not carry
 *  says so in words. Null when the summary carries none of it. */
export function fundsSummaryLine(summary) {
  const s = summary && typeof summary === 'object' ? summary : {}
  const total = num(s.total_shares)
  const totalChange = num(s.total_shares_change)
  const counts = [
    ['new', num(s.new_positions)],
    ['added to', num(s.increased_positions)],
    ['cut', num(s.reduced_positions)],
    ['sold out', num(s.closed_positions)],
  ]
  const pcr = num(s.put_call_ratio)
  if (total == null && counts.every(([, v]) => v == null) && pcr == null) return null
  const parts = []
  if (total != null) {
    parts.push(`13F filers held ${compact(total)} shares${totalChange != null ? ` (${signedCompact(totalChange)} on the quarter)` : ''}.`)
  }
  if (counts.some(([, v]) => v != null)) {
    parts.push(`Positions: ${counts.map(([w, v]) => (v == null ? `${w} ${NOT_REPORTED}` : `${count(v)} ${w}`)).join(', ')}.`)
  }
  if (pcr != null) parts.push(`Put/call ratio of their option positions ${formatNumber(pcr, { decimals: 2 })}.`)
  return parts.join(' ')
}

/** The quarter the filings cover, how long ago it ended, and the filing rule, in words. */
export function quarterFacts(tf, rows = [], now = Date.now()) {
  const days = [...new Set(rows.map((r) => r.quarterEnd).filter(Boolean))]
  const end = quarterEnd(tf?.quarter) || (days.length === 1 ? days[0] : null)
  const label = quarterLabel(tf?.quarter)
  let ago = null
  if (end && Number.isFinite(now)) {
    const [y, m, d] = end.split('-').map(Number)
    const n = Math.floor((now - Date.UTC(y, m - 1, d)) / DAY_MS)
    ago = n >= 0 ? n : null
  }
  const rule = `13F filings are due ${FILING_DEADLINE_DAYS} days after a quarter ends, so the newest quarter shown can be up to about 4.5 months old.`
  const lead = end
    ? `Quarter ended ${dayText(end)}${ago != null ? ` (${formatNumber(ago)} ${ago === 1 ? 'day' : 'days'} ago)` : ''}.`
    : 'The quarter these filings cover is not reported.'
  return { label, end, daysAgo: ago, text: `${lead} ${rule}` }
}

/** "Values use the quarter-end price of $X a share", when every row that carries one agrees. */
export function priceLine(rows) {
  const prices = [...new Set(rows.map((r) => r.quarterEndPrice).filter((v) => v != null))]
  if (prices.length !== 1) return null
  return `Values use the quarter-end price of ${formatCurrency(prices[0])} a share.`
}

/** What the list shows, how it is sorted, and where it stops. */
export function heldLine({ total, shown, limit, investors, sort }) {
  if (!total) return null
  const head = shown < total
    ? `Showing ${formatNumber(shown)} of ${formatNumber(total)} holders, ${sortWords(sort)}.`
    : `${total === 1 ? 'One holder' : `All ${formatNumber(total)} holders`} listed, ${sortWords(sort)}.`
  const lim = num(limit)
  const inv = num(investors)
  // every filer is listed: a list as long as the read was not cut
  const complete = inv != null && inv <= total
  let tail = ''
  if (!complete && lim != null && total >= lim) {
    tail = ` The list stops at the vendor's top ${formatNumber(lim)}${inv != null ? ` of ${formatNumber(inv)} filers` : ''}.`
  } else if (inv != null && inv > total) {
    tail = ` ${formatNumber(inv)} filers reported a position in all.`
  }
  return `${head}${tail}`
}

/** Why there are no holder rows under a quarter summary, in words. */
export function noHoldersWords(failed) {
  return failed
    ? 'The holder list could not be read right now. The summary above is what answered; that is a gap in the read, not a finding.'
    : 'The data vendor lists no individual holders for this quarter.'
}

/** The block's caption and table name. */
export function tableName(tf) {
  const label = quarterLabel(tf?.quarter) || text(tf?.quarter)
  return label ? `${FUNDS_TITLE} holders, ${label}` : `${FUNDS_TITLE} holders`
}
