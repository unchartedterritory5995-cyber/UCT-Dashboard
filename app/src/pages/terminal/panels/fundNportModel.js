// app/src/pages/terminal/panels/fundNportModel.js
//
// The OWN panel's "Funds (N-PORT)" block: which mutual funds and ETFs hold a stock, how much, and who added or cut
// since each fund's previous report, from the SEC's quarterly Form N-PORT data sets
// (`GET /api/research/ownership/{sym}` -> `funds_nport`, read from the index the server builds out of those data
// sets: api/services/fund_holders_nport.py).
//
// Pure functions, no React, so the UCT Agent can read the same rows and words.
//
// THE RULES THIS FILE HOLDS
//   * A figure the filing does not carry is words, never 0. A real 0 (a fund that held none at its previous report)
//     is a figure.
//   * A report says what a fund held on its period's last day, not what it did or when. So the words are "added",
//     "cut", "new position", "sold out", never "bought" or "sold".
//   * Each fund reports for its own period, so every row carries its period, and the block says the span.
//   * Matching a fund's holding to the ticker is said: how this stock was matched, and what share of the data set
//     was matched at all. A stock nobody could be matched to is "could not be matched", never "no fund holds it".
//   * Across a stock split between a fund's two reports the server puts the earlier shares in post-split terms, and
//     the block says so; a change it could not check (no split list, or a split with no ratio) is "not comparable",
//     never an add or a cut.

import { formatCompactTerminal, formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { dayText } from './shortInterestModel'

export const NPORT_TITLE = 'Funds (N-PORT)'
export const NPORT_SOURCE = 'SEC Form N-PORT (public; filed 60 days after each quarter-end month)'
/** Rows shown before "Show all". */
export const DEFAULT_ROWS = 20
export const NOT_REPORTED = 'not reported'
export const NOT_KNOWN = 'not known'
export const NOT_COMPARABLE = 'not comparable'

const num = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const isoDay = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 10) : null)
const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const plural = (n, one, many) => (n === 1 ? one : many)
const count = (v) => formatNumber(Math.round(v))

/** '2031Q3' -> '2031 Q3' (anything else as given, or null). */
export function quarterWords(q) {
  const m = /^(\d{4})Q([1-4])$/.exec(String(q ?? '').toUpperCase())
  return m ? `${m[1]} Q${m[2]}` : text(q)
}

// ── rows ────────────────────────────────────────────────────────────────────

const STATES = new Set(['added', 'cut', 'unchanged', 'new', 'no_prior', 'not_comparable'])

/** The block's rows from `funds_nport.holders`, in the server's order (value, highest first). */
export function nportRows(block) {
  const list = Array.isArray(block?.holders) ? block.holders : []
  return list.filter((h) => h && typeof h === 'object').map((h, i) => ({
    key: `${text(h.series_id) || text(h.accession) || 'fund'}-${i}`,
    rank: i,
    name: text(h.name),
    family: text(h.family),
    url: /^https:\/\/www\.sec\.gov\//.test(String(h.url ?? '')) ? h.url : null,
    shares: num(h.shares),
    value: num(h.value),
    pct: num(h.pct),
    period: isoDay(h.period),
    priorShares: num(h.prior_shares),
    priorPeriod: isoDay(h.prior_period),
    changeShares: num(h.change_shares),
    changePct: num(h.change_pct),
    state: STATES.has(h.state) ? h.state : null,
  }))
}

/** The words shown under a fund's name for its position, or null. */
export const STATE_WORDS = {
  new: { text: 'New position', tone: 'up' },
  no_prior: { text: 'No earlier report', tone: null },
  not_comparable: { text: 'Change not comparable', tone: null },
}

/** A split ratio (shares after per share before) in words: 4 -> '4-for-1', 0.1 -> '1-for-10', 1.5 -> '1.5-for-1'. */
export function splitWords(ratio) {
  const r = num(ratio)
  if (r == null || r <= 0) return null
  const fmt = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? String(Math.round(x)) : String(Math.round(x * 100) / 100))
  return r >= 1 ? `${fmt(r)}-for-1` : `1-for-${fmt(1 / r)}`
}

// ── cells ───────────────────────────────────────────────────────────────────

const compact = (v, money = false) => (v == null ? NOT_REPORTED : formatCompactTerminal(v, { money }))

/** The change in shares since the fund's previous report. */
export function changeText(row) {
  if (row.state === 'new') return 'new'
  if (row.state === 'no_prior') return 'no earlier report'
  if (row.state === 'not_comparable') return NOT_COMPARABLE
  if (row.changeShares == null) return NOT_KNOWN
  if (Math.abs(row.changeShares) < 0.5) return 'unchanged'
  const body = formatCompactTerminal(row.changeShares)
  return row.changeShares > 0 ? `+${body}` : body
}

/** The change as a percent of the previous holding. A new position has none to measure against. */
export function changePctText(row) {
  if (row.state === 'new') return 'new'
  if (row.state === 'not_comparable') return NOT_COMPARABLE
  if (row.changePct == null) return NOT_KNOWN
  if (Math.abs(row.changePct) < 0.05) return formatPercent(0, { decimals: 1 })
  return formatPercent(row.changePct, { decimals: 1, signed: true })
}

// ── columns and sorting ─────────────────────────────────────────────────────

/** Every column, in order. `optional` columns are drawn only when some row carries the figure. `kind` decides the
 *  first sort direction: numbers and dates largest / newest first, names A to Z. */
export const NPORT_COLUMNS = Object.freeze([
  { key: 'fund', label: 'Fund', words: 'fund', kind: 'text', cell: (r) => r.name || 'Name not reported' },
  { key: 'shares', label: 'Shares', words: 'shares', kind: 'number', value: (r) => r.shares, cell: (r) => compact(r.shares) },
  { key: 'change', label: 'Change', words: 'change in shares', kind: 'number', tone: true, cell: changeText,
    value: (r) => (r.state === 'new' ? Infinity : r.changeShares) },
  { key: 'changePct', label: 'Chg %', words: 'percent change', kind: 'number', tone: true, cell: changePctText, decimals: 1,
    value: (r) => (r.state === 'new' ? Infinity : r.changePct) },
  { key: 'value', label: 'Value (USD)', words: 'value', kind: 'number', value: (r) => r.value, cell: (r) => compact(r.value, true) },
  { key: 'pct', label: '% of fund', words: 'percent of the fund', kind: 'number', value: (r) => r.pct,
    cell: (r) => (r.pct == null ? NOT_REPORTED : formatPercent(r.pct, { decimals: 2 })) },
  { key: 'period', label: 'Period', words: 'period', kind: 'date', value: (r) => r.period,
    cell: (r) => (r.period ? dayText(r.period) : NOT_REPORTED) },
  { key: 'priorShares', label: 'Shares before', words: 'shares at the previous report', kind: 'number', optional: true,
    value: (r) => r.priorShares, cell: (r) => (r.state === 'no_prior' ? NOT_KNOWN : compact(r.priorShares)) },
  { key: 'priorPeriod', label: 'Previous period', words: 'previous period', kind: 'date', optional: true,
    value: (r) => r.priorPeriod, cell: (r) => (r.priorPeriod ? dayText(r.priorPeriod) : NOT_KNOWN) },
].map((c) => Object.freeze(c)))

export const NPORT_COLUMN_BY_KEY = Object.freeze(Object.fromEntries(NPORT_COLUMNS.map((c) => [c.key, c])))

/** The columns to draw: every core column, and an optional one only when some row carries its figure. */
export function nportColumns(rows) {
  return NPORT_COLUMNS.filter((c) => !c.optional || rows.some((r) => c.value(r) != null))
}

/** The sign a numeric cell carries, for its colour (the text carries the sign too). Rounded the way it prints, so a
 *  figure that prints as zero has no colour. */
export function toneOf(column, row) {
  if (!column.tone) return null
  if (row.state === 'new') return 'up'
  const raw = column.value(row)
  if (raw == null || !Number.isFinite(raw)) return null
  const v = column.decimals == null ? (Math.abs(raw) < 0.5 ? 0 : raw) : Math.round(raw * 10 ** column.decimals) / 10 ** column.decimals
  return v > 0 ? 'up' : v < 0 ? 'down' : null
}

export const DEFAULT_SORT = Object.freeze({ key: 'value', dir: 'desc' })

const sortKey = (column, row) => {
  if (column.key === 'fund') return row.name ? row.name.toLowerCase() : null
  const v = column.value(row)
  return v == null ? null : v
}

/** Rows sorted by one column. A missing figure sinks to the bottom in either direction, and ties keep the server's
 *  order, so a re-sort never shuffles equal rows. */
export function sortNportRows(rows, sort = DEFAULT_SORT) {
  const column = NPORT_COLUMN_BY_KEY[sort?.key] || NPORT_COLUMN_BY_KEY[DEFAULT_SORT.key]
  const dir = sort?.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = sortKey(column, a)
    const y = sortKey(column, b)
    if (x == null || y == null) return x == null && y == null ? a.rank - b.rank : x == null ? 1 : -1
    if (x < y) return -dir
    if (x > y) return dir
    return a.rank - b.rank
  })
}

/** The sort after a header press: the same column flips; a new column starts largest / newest first for figures
 *  and dates, A to Z for names. */
export function nextNportSort(current, key) {
  const column = NPORT_COLUMN_BY_KEY[key]
  if (!column) return current || DEFAULT_SORT
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: column.kind === 'text' ? 'asc' : 'desc' }
}

/** The sort in words, for the line under the table. */
export function nportSortWords(sort = DEFAULT_SORT) {
  const column = NPORT_COLUMN_BY_KEY[sort?.key] || NPORT_COLUMN_BY_KEY[DEFAULT_SORT.key]
  const asc = sort?.dir === 'asc'
  if (column.kind === 'text') return `by ${column.words}, ${asc ? 'A to Z' : 'Z to A'}`
  if (column.kind === 'date') return `by ${column.words}, ${asc ? 'oldest first' : 'newest first'}`
  return `by ${column.words}, ${asc ? 'lowest first' : 'highest first'}`
}

// ── the lines around the table ──────────────────────────────────────────────

/** Who holds it and what changed, in words, from the server's summary over EVERY matched fund (not only the rows
 *  kept). `[]` when there is no summary. */
export function nportSummaryLines(block) {
  const s = block?.summary && typeof block.summary === 'object' ? block.summary : null
  if (!s) return []
  const funds = num(s.funds) ?? 0
  const lines = []
  if (funds > 0) {
    const shares = num(s.shares)
    const value = num(s.value)
    const worth = value == null ? '' : s.value_complete === false
      ? ` worth at least ${formatCompactTerminal(value, { money: true })} (some funds gave no value)`
      : ` worth ${formatCompactTerminal(value, { money: true })}`
    lines.push(`${funds === 1 ? 'One fund' : `${count(funds)} funds`} reported a position: ${shares == null ? NOT_REPORTED : formatCompactTerminal(shares)} shares${worth}.`)
  }
  const parts = [['added', 'added'], ['cut', 'cut'], ['unchanged', 'unchanged'], ['new', 'new'], ['sold_out', 'sold out']]
    .map(([k, w]) => [num(s[k]) ?? 0, w])
  const noPrior = num(s.no_prior) ?? 0
  const apart = num(s.not_comparable) ?? 0
  if (apart > 0) parts.push([apart, 'not comparable'])
  if (parts.some(([n]) => n > 0)) {
    lines.push(`Since each fund's previous report: ${parts.map(([n, w]) => `${count(n)} ${w}`).join(', ')}.`
      + (noPrior > 0 ? ` ${count(noPrior)} ${plural(noPrior, 'fund has', 'funds have')} no earlier report in the data, so ${plural(noPrior, 'its', 'their')} change is not known.` : '')
      + (apart > 0 ? ` ${count(apart)} ${plural(apart, "fund's change is", "funds' changes are")} not comparable: a stock split may fall between the two reports and could not be checked, so ${plural(apart, 'it is', 'they are')} not counted as added or cut.` : ''))
  } else if (noPrior > 0) {
    lines.push(`No fund has an earlier report in the data, so no change is known.`)
  }
  const splits = (Array.isArray(s.splits) ? s.splits : [])
    .map((x) => (Array.isArray(x) && isoDay(x[0]) && splitWords(x[1]) ? `${splitWords(x[1])} on ${dayText(isoDay(x[0]))}` : null))
    .filter(Boolean)
  if (splits.length) {
    lines.push(`A stock split fell between some funds' two reports (${splits.join('; ')}): their shares before are counted in post-split shares, so a fund that held still reads unchanged.`)
  }
  const now = num(s.both_now)
  const before = num(s.both_prior)
  if (now != null && before != null && before > 0) {
    const net = now - before
    const sign = Math.abs(net) < 0.5 ? 'no net change' : `${net > 0 ? '+' : ''}${formatCompactTerminal(net)} net`
    lines.push(`The funds with both reports held ${formatCompactTerminal(now)} shares, against ${formatCompactTerminal(before)} at their previous reports (${sign}).`)
  }
  return lines
}

/** The span of the periods, the data sets read and when, and how old a report can be. */
export function nportPeriodLine(block) {
  const ds = block?.data_set && typeof block.data_set === 'object' ? block.data_set : {}
  const s = block?.summary || {}
  const from = isoDay(s.period_from) || isoDay(ds.periods?.from)
  const to = isoDay(s.period_to) || isoDay(ds.periods?.to)
  const q = quarterWords(ds.quarter)
  const pq = quarterWords(ds.prior_quarter)
  const span = from && to ? (from === to ? `Reports for the period ending ${dayText(to)}` : `Reports for periods ending ${dayText(from)} to ${dayText(to)}`) : 'Reports'
  const from_ = q ? `, from the SEC's ${q} data set` : ''
  const cmp = pq ? `, each compared with the fund's previous report (the ${pq} data set or the same one)` : ''
  const read = isoDay(ds.built_at) ? ` Read on ${dayText(isoDay(ds.built_at))}.` : ''
  const missing = !pq && q ? ' The data set before it could not be read, so changes are not known.' : ''
  const noSplits = ds.splits?.state === 'unavailable'
    ? ' The list of stock splits could not be read for this data set, so a change a split may have touched is not compared.'
    : ''
  return `${span}${from_}${cmp}.${read}${missing}${noSplits} A fund files within 60 days after each fiscal quarter ends and the SEC posts these data sets once a quarter, so the newest report shown can be months old.`
}

/** What the table shows, how it is sorted, and where the list stops. */
export function nportHeldLine({ shown, rows, total, limit, sort }) {
  if (!rows) return null
  const head = shown < rows
    ? `Showing ${formatNumber(shown)} of ${formatNumber(rows)} funds, ${nportSortWords(sort)}.`
    : `${rows === 1 ? 'One fund' : `All ${formatNumber(rows)} funds`} listed, ${nportSortWords(sort)}.`
  const t = num(total)
  const lim = num(limit)
  const tail = t != null && t > rows
    ? ` The list keeps the top ${formatNumber(lim ?? rows)} of ${formatNumber(t)} funds by value.`
    : ''
  return `${head}${tail}`
}

/** The funds that held it at their previous report and hold none at their current one. */
export function nportSoldRows(block) {
  const list = Array.isArray(block?.sold_out) ? block.sold_out : []
  return list.filter((h) => h && typeof h === 'object').map((h, i) => ({
    key: `${text(h.series_id) || text(h.accession) || 'sold'}-${i}`,
    name: text(h.name) || 'Name not reported',
    family: text(h.family),
    url: /^https:\/\/www\.sec\.gov\//.test(String(h.url ?? '')) ? h.url : null,
    priorShares: num(h.prior_shares),
    priorValue: num(h.prior_value),
    priorPeriod: isoDay(h.prior_period),
    period: isoDay(h.period),
  }))
}

/** One sold-out fund in words. */
export function soldText(r) {
  const had = r.priorShares == null ? 'held it' : `held ${formatCompactTerminal(r.priorShares)} shares${r.priorValue == null ? '' : ` (${formatCompactTerminal(r.priorValue, { money: true })})`}`
  const at = r.priorPeriod ? ` at ${dayText(r.priorPeriod)}` : ''
  const now = r.period ? `; its ${dayText(r.period)} report holds none` : '; its current report holds none'
  return `${had}${at}${now}.`
}

/** "And N more" under the sold-out list, or null. */
export function soldMoreLine(block, shown) {
  const total = num(block?.sold_out_total)
  return total != null && total > shown ? `${formatNumber(total - shown)} more ${plural(total - shown, 'fund', 'funds')} sold out of it.` : null
}

/** How this stock was matched to the funds' holdings, in words. */
export function nportMatchLine(block, sym) {
  const s = block?.summary || {}
  const votes = num(s.votes)
  switch (s.tier) {
    case 'sec_ftd':
      return `Matched to ${sym} through the SEC's fails-to-deliver records, which pair the security's CUSIP with ${sym}.`
    case 'fund_ticker':
      return `Matched to ${sym} by the ticker the funds gave for the security${votes ? ` (${count(votes)} ${plural(votes, 'report', 'reports')})` : ''}, joined by its CUSIP.`
    case 'sec_name':
      return `Matched to ${sym} by the issuer name the funds gave, which is the SEC's company name for ${sym} and no other ticker.`
    default:
      return null
  }
}

/** What share of the data set could be matched to any ticker, and what that leaves out. */
export function nportCoverageLine(block) {
  const c = block?.coverage || {}
  const pct = num(c.matched_value_pct)
  const head = pct == null
    ? "How much of the data set was matched to a ticker is not known."
    : `Across the data set, ${formatPercent(pct, { decimals: 1 })} of the funds' common-stock holdings by value were matched to a ticker.`
  const units = c.pct_units === 'unclear' ? " The percent of each fund is not shown: the data set's percent figures could not be read with confidence." : ''
  return `${head} A fund whose holding could not be matched is not listed.${units}`
}

/** "2031-11-23T05:50" (New York time, as the server writes it) -> "Nov 23, 2031 at 05:50 New York time". */
export function checkTimeWords(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(iso ?? ''))
  return m ? `${dayText(m[1])} at ${m[2]} New York time` : null
}

const LAST_CHECK_WORDS = {
  not_published: "the SEC has not posted a newer data set yet",
  stopped: "the read was stopped (the SEC's website refused it, or it ran out of time) and is tried again",
  failed: 'the read failed and is tried again',
  shape: 'the data set was not in the layout this reads, so it was not used',
  low_disk: 'the server had too little disk space to download it',
}

/** The block's words for every state that has no table, or null for `ok`. */
export function nportStateWords(block, sym) {
  const state = block?.state
  const q = quarterWords(block?.data_set?.quarter)
  if (state === 'not_built') {
    if (block.building) return "The first read of the SEC's Form N-PORT data sets is running now. This fills in once it finishes."
    const when = checkTimeWords(block.next_check)
    const last = block.last_check && LAST_CHECK_WORDS[block.last_check.state]
    return `The SEC's Form N-PORT data sets have not been read on this server yet${last ? `: ${last}` : ''}.${when ? ` The next check is ${when}.` : ''}`
  }
  if (state === 'not_matched') {
    return `No fund holding in the newest N-PORT data set${q ? ` (${q})` : ''} could be matched to ${sym}. That is not the same as no fund holding it.`
  }
  if (state === 'none_now') {
    return `No fund's current report holds ${sym}. The funds below held it at their previous report.`
  }
  if (state === 'unavailable') {
    return 'The fund holdings index could not be read right now. That is a gap in the read, not a finding.'
  }
  if (state !== 'ok') return 'The fund holdings could not be read right now.'
  return null
}

/** A newer read that did not work, said beside the list that is still shown, or null. */
export function nportCheckLine(block) {
  const c = block?.check
  const words = c && LAST_CHECK_WORDS[c.state]
  return words ? `The last attempt to read a newer data set did not finish: ${words}. The list shown is the last one read.` : null
}

/** The table's accessible name. */
export function nportTableName(block) {
  const q = quarterWords(block?.data_set?.quarter)
  return q ? `${NPORT_TITLE} holders, ${q} data set` : `${NPORT_TITLE} holders`
}
