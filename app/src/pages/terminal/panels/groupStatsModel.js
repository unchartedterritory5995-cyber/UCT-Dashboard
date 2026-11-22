// Group fundamentals, breadth and weekly rank: the pure half of GRP's sections ("Rank", "Fundamentals",
// "Breadth") and of GRPS, the table of every sector or industry. No React, so the Agent can reuse it.
//
// ONE paid route (api/routers/group_stats.py over api/services/group_stats.py; 401 signed out, 402 no paid
// plan; no flag of its own):
//   GET /api/research/group-stats?kind=sector|industry             every group of the kind (the table)
//   GET /api/research/group-stats?kind=sector|industry&name=NAME   one group in full (GRP's sections)
// The server works every figure out ONCE each evening after the close and holds it; a request never builds.
//   status   'ok' | 'not_built' (no evening build has run on this server yet) | 'computing' (the first one
//            is running) | 'error'
//   sources.fundamentals.state  'ok' | 'off' (FUNDAMENTALS_PIT_ENABLED is off, as for FUND) | 'unavailable' (the
//            filings could not be read that evening) | 'pending' (switched on since the last build)
//   metrics  the catalog's own name, unit, format and method for each fundamental (catalog.py), plus the
//            acceleration share; `agg` 'median' or 'share'
//   a figure {n, median, q1, q3} (or {n, count, share}): `n` members with a value; with fewer than
//            `min_members` (5) the figure is null and only the count is given
//   sources.rank.state  'ok' | 'unavailable' (no closes that evening) | 'pending' (the held figures were built before
//            the weekly rank existed; the next evening build adds it)
//   a group's `rank` {m6, m3}: its place among the groups of its kind by the median 6-month (3-month) price change of
//            its stocks, each point {position (null: fewer than five stocks with a change), of, n, median, date,
//            change (places climbed to now)} now, 4, 13 and 52 weeks back, its best and worst week, and the weekly line
// Names are the ones GRP lists (the same sector and industry map), so GRP asks by the name it shows.
//
// ⛔ A MISSING NUMBER IS NEVER 0: a group with too few members says how many it has; a share with no answer
//    is words; a fundamental switched off is said, never drawn as blank figures.
// Every number goes through the shared formatters (presentationPrimitives.js; the FUND model's valueText for
// a catalog format).
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { sortRows } from '../../../lib/presentation/dataGrid/gridSort'
import { valueText, dateText } from './fundMetricsModel'
import { pathThrough } from './ratesModel'

export const GROUPS_TABLE_CODE = 'GRPS'
export const GROUP_STATS_URL = '/api/research/group-stats'
/** The figures change once each evening: asking every 30 minutes is plenty. */
export const GROUP_STATS_POLL_MS = 30 * 60 * 1000
/** While the first evening build runs, the panel asks again this often. */
export const GROUP_STATS_COMPUTING_POLL_MS = 60 * 1000
export const GROUP_STATS_WHAT = 'The group figures'
export const GROUP_STATS_SOURCE = 'UCT group figures (SEC filings, stored closes)'
export const MIN_MEMBERS = 5

export const GROUP_STATS_KINDS = Object.freeze({
  sector: Object.freeze({ label: 'Sectors', head: 'Sector', one: 'sector', many: 'sectors' }),
  industry: Object.freeze({ label: 'Industries', head: 'Industry', one: 'industry', many: 'industries' }),
})
export const DEFAULT_GROUPS_KIND = 'sector'

/** GRPS's words (args.js keeps a copy, pinned by functions.groupStats.test.js). No word is a function code. */
export const GROUPS_KIND_ARG_WORDS = Object.freeze({
  SECTOR: 'sector', SECTORS: 'sector', INDUSTRY: 'industry', INDUSTRIES: 'industry',
})
export const GROUPS_VIEW_ARG_WORDS = Object.freeze({
  OVERVIEW: 'overview', GROWTH: 'growth', MARGINS: 'margins', MARGIN: 'margins', VALUATION: 'valuation',
  BREADTH: 'breadth', RANK: 'rank', ALL: 'all',
})
export const DEFAULT_GROUPS_VIEW = 'overview'

const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null)
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const count = (n) => formatNumber(n, { decimals: 0 })

export const groupStatsUrl = (kind = DEFAULT_GROUPS_KIND, name = null) => {
  const k = own(GROUP_STATS_KINDS, kind) ? kind : DEFAULT_GROUPS_KIND
  const n = str(name)
  return `${GROUP_STATS_URL}?kind=${k}${n ? `&name=${encodeURIComponent(n)}` : ''}`
}

export const parseGroupsKind = (tok) => { const k = String(tok ?? '').trim().toUpperCase(); return own(GROUPS_KIND_ARG_WORDS, k) ? GROUPS_KIND_ARG_WORDS[k] : null }
export const parseGroupsView = (tok) => { const k = String(tok ?? '').trim().toUpperCase(); return own(GROUPS_VIEW_ARG_WORDS, k) ? GROUPS_VIEW_ARG_WORDS[k] : null }
export const normGroupsKind = (v) => (own(GROUP_STATS_KINDS, v) ? v : parseGroupsKind(v) || DEFAULT_GROUPS_KIND)
export const normGroupsView = (v) => (own(GROUPS_VIEWS, v) ? v : parseGroupsView(v) || DEFAULT_GROUPS_VIEW)

/** The command arguments for a choice: the kind and the view, each left out at its default. */
export function groupsCommandArgs({ kind = DEFAULT_GROUPS_KIND, view = DEFAULT_GROUPS_VIEW } = {}) {
  const k = normGroupsKind(kind)
  const v = normGroupsView(view)
  return [k === DEFAULT_GROUPS_KIND ? null : 'INDUSTRIES', v === DEFAULT_GROUPS_VIEW ? null : v.toUpperCase()].filter(Boolean)
}
export const groupsCommand = (choice = {}) => [GROUPS_TABLE_CODE, ...groupsCommandArgs(choice)].join(' ')

// ── words a member reads ────────────────────────────────────────────────────────────────────────

const ORD = (n) => {
  const t = n % 100
  if (t >= 11 && t <= 13) return 'th'
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'
}
/** '3rd of 11', or null when there is no rank. */
export const rankText = (rank) => (rank && int(rank.position) && int(rank.of) ? `${count(rank.position)}${ORD(rank.position)} of ${count(rank.of)}` : null)
/** A share as a member reads it: '62%'. */
export const shareText = (v) => formatPercent(v, { decimals: 0, absent: null })
/** A change between two shares: '+5 pts', '-3 pts', '0 pts'; null when either side is missing. */
export function pointsText(v) {
  if (num(v) === null) return null
  const r = Math.round(v)
  return `${r > 0 ? '+' : ''}${count(r === 0 ? 0 : r)} pts`
}
/** A signed whole count: '+3', '-2', '0'. */
export const signedCount = (v) => (num(v) === null ? null : `${v > 0 ? '+' : ''}${count(v)}`)
/** 'Nov 20, 2031' for an ISO day. */
export const dayWords = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? dateText(iso) : null)
const fewWords = (n) => `${count(n ?? 0)} with data`

/** A figure in its metric's own format: a median through the catalog's format, a share as a percent. */
export function figureText(v, meta) {
  if (num(v) === null) return null
  return meta?.agg === 'share' ? shareText(v) : valueText(v, meta?.fmt)
}

// ── the metrics and the columns ─────────────────────────────────────────────────────────────────

/** Short headers for the table (the catalog's own name is the header's title). */
export const FUND_SHORT = Object.freeze({
  revenue_growth_q: 'Revenue growth', eps_growth_q: 'EPS growth', revenue_accelerating: 'Accelerating',
  gross_margin: 'Gross margin', operating_margin: 'Operating margin', net_margin: 'Net margin', fcf_margin: 'FCF margin',
  roe: 'ROE', pe_ttm: 'P/E', ps_ttm: 'P/S', fcf_yield: 'FCF yield',
})
export const FUND_IDS = Object.freeze(Object.keys(FUND_SHORT))

/** The breadth measures, in the order every view lists them. */
export const BREADTH_SHARES = Object.freeze({
  above20: Object.freeze({ label: 'Above the 20-day', short: 'Above 20-day', title: 'Share of its stocks closing above their 20-day average' }),
  above50: Object.freeze({ label: 'Above the 50-day', short: 'Above 50-day', title: 'Share of its stocks closing above their 50-day average' }),
  above200: Object.freeze({ label: 'Above the 200-day', short: 'Above 200-day', title: 'Share of its stocks closing above their 200-day average' }),
  near_high: Object.freeze({ label: 'Within 5% of the 52-week high', short: 'Near 52-wk high', title: 'Share of its stocks closing within 5% of their 52-week closing high' }),
})

/** The weekly rank's columns (2026-11-22): the 6-month rank now, the places moved over 4, 13 and 52 weeks, the year's best
 *  and worst, the 3-month rank, and the year's line (not sortable). `order` 'place': a lower number is a better place. */
const RANK_COLUMNS = Object.freeze([
  { key: 'r:now', kind: 'rank', measure: 'm6', order: 'place' },
  { key: 'r:w4', kind: 'rankMove', back: 'w4' },
  { key: 'r:w13', kind: 'rankMove', back: 'w13' },
  { key: 'r:w52', kind: 'rankMove', back: 'w52' },
  { key: 'r:range', kind: 'rankRange', order: 'place' },
  { key: 'r:m3', kind: 'rank', measure: 'm3', order: 'place' },
  { key: 'r:line', kind: 'rankLine', sortable: false },
])
const BACK_WEEKS = Object.freeze({ w4: 4, w13: 13, w52: 52 })
const fundCol = (id, ref = 'now') => ({ key: ref === 'now' ? `f:${id}` : `f:${id}:ya`, kind: 'fund', id, ref })
const shareCol = (id, change = null) => ({ key: change ? `b:${id}:${change}` : `b:${id}`, kind: 'share', id, change })
const NET_HIGHS = { key: 'b:net_highs', kind: 'highs' }
const ADV_DEC = { key: 'b:advdec', kind: 'advdec' }

/** The column sets a member picks from. */
export const GROUPS_VIEWS = Object.freeze({
  overview: Object.freeze({ label: 'Overview', columns: [fundCol('revenue_growth_q'), fundCol('eps_growth_q'), fundCol('net_margin'), fundCol('pe_ttm'), shareCol('above50'), NET_HIGHS] }),
  growth: Object.freeze({ label: 'Growth', columns: [fundCol('revenue_growth_q'), fundCol('revenue_growth_q', 'year_ago'), fundCol('eps_growth_q'), fundCol('eps_growth_q', 'year_ago'), fundCol('revenue_accelerating')] }),
  margins: Object.freeze({ label: 'Margins and returns', columns: ['gross_margin', 'operating_margin', 'net_margin', 'fcf_margin', 'roe'].map((id) => fundCol(id)) }),
  valuation: Object.freeze({ label: 'Valuation', columns: [fundCol('pe_ttm'), fundCol('pe_ttm', 'year_ago'), fundCol('ps_ttm'), fundCol('fcf_yield')] }),
  breadth: Object.freeze({ label: 'Breadth', columns: [shareCol('above20'), shareCol('above50'), shareCol('above50', 'week'), shareCol('above50', 'month'), shareCol('above200'), shareCol('near_high'), NET_HIGHS, ADV_DEC] }),
  rank: Object.freeze({ label: 'Weekly rank', columns: RANK_COLUMNS }),
  all: Object.freeze({ label: 'Every column', columns: [...FUND_IDS.map((id) => fundCol(id)), ...Object.keys(BREADTH_SHARES).map((id) => shareCol(id)), NET_HIGHS, ADV_DEC] }),
})

/** A column's header, its title (hover) and the direction its first click sorts. */
export function columnHead(col, metaById) {
  if (col.kind === 'fund') {
    const meta = metaById?.get(col.id)
    const name = meta?.name || FUND_SHORT[col.id]
    if (col.ref === 'year_ago') return { label: `${FUND_SHORT[col.id]}, a year ago`, title: `${name}: the group's median a year earlier, from the filings known then` }
    const how = meta?.agg === 'share' ? 'share of its members' : "the group's median"
    return { label: FUND_SHORT[col.id], title: `${name}: ${how}${meta?.composed ? ", worked out with UCT's stored close" : ''}` }
  }
  if (col.kind === 'share') {
    const m = BREADTH_SHARES[col.id]
    if (col.change === 'week') return { label: `${m.short}, 1 wk`, title: `${m.title}: change in points from a week ago` }
    if (col.change === 'month') return { label: `${m.short}, 1 mo`, title: `${m.title}: change in points from a month ago` }
    return { label: m.short, title: m.title }
  }
  if (col.kind === 'rank') {
    return col.measure === 'm3'
      ? { label: 'Rank by 3-month', title: 'Its place among the groups of its kind by the median 3-month price change of its stocks, at the last close' }
      : { label: 'Rank now', title: 'Its place among the groups of its kind by the median 6-month price change of its stocks, at the last close, and how many stocks that rests on' }
  }
  if (col.kind === 'rankMove') {
    const wk = BACK_WEEKS[col.back]
    return { label: `${wk}-wk change`, title: `Places climbed (+) or fallen (-) since its 6-month rank ${wk} weeks ago (the last close of that week)` }
  }
  if (col.kind === 'rankRange') return { label: 'Year best / worst', title: 'Its best and worst weekly 6-month rank over the last 52 weeks' }
  if (col.kind === 'rankLine') return { label: 'Weekly rank, 1 yr', title: 'Its 6-month rank each week for a year, 1st at the top' }
  if (col.kind === 'highs') return { label: 'Highs minus lows', title: 'New 52-week closing highs minus new lows, that session' }
  return { label: 'Up / down', title: 'Stocks that closed up and down that session' }
}

// ── the table ───────────────────────────────────────────────────────────────────────────────────

function readMetrics(list) {
  const out = new Map()
  for (const m of Array.isArray(list) ? list : []) {
    if (!isObj(m) || !str(m.id) || !own(FUND_SHORT, m.id)) continue
    out.set(m.id, { id: m.id, name: str(m.name) || FUND_SHORT[m.id], category: str(m.category), unit: str(m.unit), fmt: str(m.fmt),
      agg: m.agg === 'share' ? 'share' : 'median', composed: m.composed === true, subtitle: str(m.subtitle), methodology: str(m.methodology) })
  }
  return out
}

/** What every answer of the route says besides its rows (`sources`: the build-wide state of each source). */
function readCommon(body) {
  const sources = isObj(body.sources) ? body.sources : {}
  const fund = isObj(sources.fundamentals) ? sources.fundamentals : {}
  const breadth = isObj(sources.breadth) ? sources.breadth : {}
  const rank = isObj(sources.rank) ? sources.rank : {}
  const sessions = {}
  for (const m of Array.isArray(rank.measures) ? rank.measures : []) if (isObj(m) && (m.id === 'm6' || m.id === 'm3')) sessions[m.id] = int(m.sessions)
  return {
    kind: own(GROUP_STATS_KINDS, body.kind) ? body.kind : DEFAULT_GROUPS_KIND,
    builtAt: str(body.built_at), builtFor: str(body.built_for), session: str(body.session),
    sessions: isObj(body.sessions) ? body.sessions : {}, fundRefs: isObj(body.fund_refs) ? body.fund_refs : {},
    fundState: ['ok', 'off', 'unavailable', 'pending'].includes(fund.state) ? fund.state : 'unavailable',
    fundWithData: int(fund.with_data), breadthState: breadth.state === 'ok' ? 'ok' : 'unavailable', priced: int(breadth.priced),
    lagging: Array.isArray(body.lagging) ? body.lagging.filter((x) => x === 'prices' || x === 'filings') : [],
    minMembers: int(body.min_members) || MIN_MEMBERS, refreshing: body.refreshing === true,
    metrics: readMetrics(body.metrics),
    // an answer with no rank part (a server from before it) reads as pending: nothing to show, said in words
    rankState: ['ok', 'unavailable', 'pending'].includes(rank.state) ? rank.state : 'pending',
    rankDates: Array.isArray(rank.dates) ? rank.dates.map(str) : [],
    rankSessions: sessions,
  }
}

/** A route answer that is not a held one, as a state. */
function notHeld(body) {
  if (!isObj(body)) return { state: 'bad_shape' }
  if (body.status === 'not_built') return { state: 'not_built', detail: str(body.detail) }
  if (body.status === 'computing') return { state: 'computing' }
  if (body.status !== 'ok') return { state: 'bad_shape' }
  return null
}

/**
 * The table's answer -> `{ state, rows, ... }`. `state` 'ok' | 'empty' | 'not_built' | 'computing' |
 * 'bad_shape'. A row: `{ name, members, fundMembers, fund: {id: {n, value, yearAgo: {n, value}}}, breadth, order }`.
 */
export function readGroupsTable(body) {
  const not = notHeld(body)
  if (not) return { ...not, rows: [] }
  if (!Array.isArray(body.groups)) return { state: 'bad_shape', rows: [] }
  const common = readCommon(body)
  const rows = []
  for (const g of body.groups) {
    if (!isObj(g) || !str(g.name)) continue
    const fund = {}
    for (const [id, m] of Object.entries(isObj(g.fund) ? g.fund : {})) {
      if (!own(FUND_SHORT, id) || !isObj(m)) continue
      fund[id] = { n: int(m.n) ?? 0, value: num(m.value), yearAgo: { n: int(m.year_ago?.n) ?? 0, value: num(m.year_ago?.value) } }
    }
    rows.push({ name: str(g.name), members: int(g.members) ?? 0, fundMembers: int(g.fund_members), fund: isObj(g.fund) ? fund : null,
      breadth: isObj(g.breadth) ? g.breadth : null, rank: readRank(g.rank), order: rows.length })
  }
  return { state: rows.length ? 'ok' : 'empty', rows, ...common }
}

/** The columns a view shows: its fundamentals only while the fundamentals are on hand. */
export function viewColumns(view, fundState) {
  const cols = GROUPS_VIEWS[normGroupsView(view)].columns
  return fundState === 'ok' ? cols : cols.filter((c) => c.kind !== 'fund')
}

/**
 * One cell: `{ value (what it sorts by, null when blank), text, sub, words }`. A group with too few members
 * with a value gives the count and no figure.
 */
export function tableCell(row, col, { metaById = new Map(), minMembers = MIN_MEMBERS, dates = [], scaleMax = null } = {}) {
  const blank = (words) => ({ value: null, text: null, sub: null, words })
  if (RANK_KINDS.has(col.kind)) return rankCell(row, col, { minMembers, dates, scaleMax })
  if (col.kind === 'fund') {
    const meta = metaById.get(col.id) || { agg: col.id === 'revenue_accelerating' ? 'share' : 'median', fmt: 'pct1' }
    const m = row.fund?.[col.id]
    const f = col.ref === 'year_ago' ? m?.yearAgo : m
    if (!f) return blank('No figure.')
    if (f.value === null) {
      return { value: null, text: fewWords(f.n), sub: null, few: true,
        words: `${fewWords(f.n)}: fewer than ${minMembers} members have a figure, so there is no ${meta.agg === 'share' ? 'share' : 'median'}.` }
    }
    const text = figureText(f.value, meta)
    const what = meta.agg === 'share' ? 'share' : 'median'
    return { value: f.value, text, sub: `of ${count(f.n)}`, words: `${col.ref === 'year_ago' ? 'A year ago, ' : ''}${what} ${text} across ${count(f.n)} members with a figure.` }
  }
  const b = row.breadth
  if (!b) return blank('No breadth for this group.')
  if (col.kind === 'share') {
    const m = b[col.id] || {}
    if (col.change) {
      const v = num(m[`${col.change}_change`])
      return v === null ? blank('No change: the share then or now is missing.')
        : { value: v, text: pointsText(v), sub: null, words: `${pointsText(v)} from a ${col.change} ago.` }
    }
    const n = int(m.n) ?? 0
    if (num(m.share) === null) return { value: null, text: fewWords(n), sub: null, few: true, words: `${fewWords(n)}: fewer than ${minMembers} stocks, so there is no share.` }
    return { value: m.share, text: shareText(m.share), sub: `of ${count(n)}`, words: `${shareText(m.share)} of ${count(n)} stocks (${count(int(m.count) ?? 0)}).` }
  }
  if (col.kind === 'highs') {
    const hi = int(b.new_highs?.count) ?? 0
    const lo = int(b.new_lows?.count) ?? 0
    const n = int(b.new_highs?.n) ?? 0
    if (num(b.net_highs) === null) return { value: null, text: fewWords(n), sub: null, few: true, words: `${fewWords(n)}: fewer than ${minMembers} stocks with a year of closes.` }
    return { value: b.net_highs, text: signedCount(b.net_highs), sub: `${count(hi)} ${hi === 1 ? 'high' : 'highs'}, ${count(lo)} ${lo === 1 ? 'low' : 'lows'}`,
      words: `${count(hi)} new 52-week ${hi === 1 ? 'high' : 'highs'} and ${count(lo)} new ${lo === 1 ? 'low' : 'lows'}.` }
  }
  const ad = b.advance_decline || {}
  const up = int(ad.advancers)
  const down = int(ad.decliners)
  if (up === null || down === null || !int(ad.n)) return blank('No stock closed that session.')
  const flat = int(ad.unchanged) ?? 0
  return { value: up - down, text: `${count(up)} / ${count(down)}`, sub: flat ? `${count(flat)} flat` : null,
    words: `${count(up)} up, ${count(down)} down${flat ? `, ${count(flat)} unchanged` : ''}.` }
}

export const DEFAULT_GROUPS_SORT = Object.freeze({ key: 'name', dir: 'asc' })
/** Every column any view shows, by its key. */
export const COLUMN_BY_KEY = Object.freeze(Object.fromEntries(Object.values(GROUPS_VIEWS).flatMap((v) => v.columns).map((c) => [c.key, c])))

/** The rows in a sort's order: by name, or by a column's figure (a blank sinks to the end either way). */
export function sortGroupsRows(rows, sort, ctx = {}) {
  const s = sort?.key ? sort : DEFAULT_GROUPS_SORT
  const col = s.key === 'name' ? null : COLUMN_BY_KEY[s.key]
  if (s.key !== 'name' && !col) return sortGroupsRows(rows, DEFAULT_GROUPS_SORT, ctx)
  return sortRows(Array.isArray(rows) ? rows : [], { key: s.key, dir: s.dir === 'asc' ? 'asc' : 'desc' }, {
    valueOf: (key, r) => (key === 'name' ? r.name : tableCell(r, col, ctx).value),
    isNumeric: (key) => key !== 'name',
    tiebreak: (a, b) => a.name.localeCompare(b.name),
  })
}

/** The first click on a header: names A to Z, a place (a rank) best first, figures highest first. */
export const firstSortDir = (key) => (key === 'name' || COLUMN_BY_KEY[key]?.order === 'place' ? 'asc' : 'desc')

/** The sort a view opens with: the weekly rank by its place now, best first; every other view by name. */
export const defaultGroupsSort = (view) => (normGroupsView(view) === 'rank' ? Object.freeze({ key: 'r:now', dir: 'asc' }) : DEFAULT_GROUPS_SORT)

/** A sort in words, for the table's label: 'by name, A to Z', 'by P/E, highest first', 'by Rank now, best first'. */
export function groupsSortWords(sort, metaById = new Map()) {
  const s = sort?.key ? sort : DEFAULT_GROUPS_SORT
  if (s.key === 'name' || !COLUMN_BY_KEY[s.key]) return s.dir === 'desc' && s.key === 'name' ? 'by name, Z to A' : 'by name, A to Z'
  const col = COLUMN_BY_KEY[s.key]
  if (col.order === 'place') return `by ${columnHead(col, metaById).label}, ${s.dir === 'asc' ? 'best' : 'worst'} first`
  return `by ${columnHead(col, metaById).label}, ${s.dir === 'asc' ? 'lowest' : 'highest'} first`
}

// ── one group (GRP's sections) ──────────────────────────────────────────────────────────────────

/**
 * One group's answer -> `{ state, ... }`. `state` 'ok' | 'not_found' | 'not_built' | 'computing' | 'bad_shape'.
 * On 'ok': `fund` ({id: {now, year_ago, three_years_ago, rank}} or null when off), `breadth`, `members`,
 * `peers`, `lineDates`, and the common fields.
 */
export function readGroupDetail(body) {
  const not = notHeld(body)
  if (not) return not
  const common = readCommon(body)
  if (body.found === false) return { state: 'not_found', name: str(body.name), peers: int(body.peers), ...common }
  if (body.found !== true || !str(body.name)) return { state: 'bad_shape' }
  return {
    state: 'ok', ...common, name: str(body.name), members: int(body.members) ?? 0, fundMembers: int(body.fund_members),
    peers: int(body.peers), fund: isObj(body.fund) ? body.fund : null, breadth: isObj(body.breadth) ? body.breadth : null,
    lineDates: Array.isArray(body.line_dates) ? body.line_dates : [], rank: readRank(body.rank, { full: true }),
  }
}

const figureOf = (f, meta) => {
  if (!isObj(f)) return { n: 0, value: null, text: null }
  const value = num(meta.agg === 'share' ? f.share : f.median)
  return { n: int(f.n) ?? 0, value, text: figureText(value, meta) }
}

/** The fundamentals rows: one per metric, in the catalog order the server sends. */
export function fundRows(detail) {
  if (detail?.state !== 'ok' || !detail.fund) return []
  const out = []
  for (const [id, meta] of detail.metrics) {
    const m = detail.fund[id]
    if (!isObj(m)) continue
    const now = figureOf(m.now, meta)
    const yearAgo = figureOf(m.year_ago, meta)
    const threeYears = figureOf(m.three_years_ago, meta)
    const q1 = meta.agg === 'median' ? num(m.now?.q1) : null
    const q3 = meta.agg === 'median' ? num(m.now?.q3) : null
    const middle = q1 !== null && q3 !== null ? `${valueText(q1, meta.fmt)} to ${valueText(q3, meta.fmt)}` : null
    const rank = rankText(m.rank)
    const what = meta.agg === 'share' ? 'share' : 'median'
    out.push({
      id, meta, now, yearAgo, threeYears, middle, rank,
      words: now.value === null
        ? `${meta.name}: ${fewWords(now.n)}, fewer than ${detail.minMembers}, so no ${what}.`
        : `${meta.name}: ${what} ${now.text} across ${count(now.n)} members${middle ? `, middle half ${middle}` : ''}${rank ? `, ${rank} among ${GROUP_STATS_KINDS[detail.kind].many}` : ''}.`,
    })
  }
  return out
}

/** The breadth rows: each share now, its change from a week and a month ago, and its rank. */
export function breadthRows(detail) {
  const b = detail?.state === 'ok' ? detail.breadth : null
  if (!b) return []
  return Object.entries(BREADTH_SHARES).map(([key, m]) => {
    const per = isObj(b[key]) ? b[key] : {}
    const at = (label) => ({ n: int(per[label]?.n) ?? 0, count: int(per[label]?.count) ?? 0, share: num(per[label]?.share) })
    const now = at('now')
    const week = at('week')
    const month = at('month')
    const ch = (then) => (now.share !== null && then.share !== null ? now.share - then.share : null)
    return { key, label: m.label, title: m.title, now, week, month, weekChange: ch(week), monthChange: ch(month), rank: rankText(per.rank) }
  })
}

/** The day's highs, lows and advance / decline, in words: `{ highs, lows, net, netRank, up, down, flat, n, priced }`. */
export function breadthCounts(detail) {
  const b = detail?.state === 'ok' ? detail.breadth : null
  if (!b) return null
  const ad = isObj(b.advance_decline) ? b.advance_decline : {}
  return {
    highs: int(b.new_highs?.count), lows: int(b.new_lows?.count), yearN: int(b.new_highs?.n) ?? 0, net: num(b.net_highs),
    netRank: rankText(b.net_highs_rank), up: int(ad.advancers), down: int(ad.decliners), flat: int(ad.unchanged), n: int(ad.n) ?? 0,
    priced: int(b.priced) ?? 0,
  }
}

/**
 * The year of "% above the 50-day" as a line on a fixed 0 to 100% scale (a share is not stretched to fill the
 * box), a day with fewer than five stocks breaking the line. `{ w, h, path, mid, first, last, low, high, days }` or null.
 */
export function shareLine(dates, values, { w = 320, h = 90, padX = 2, padY = 6 } = {}) {
  const d = Array.isArray(dates) ? dates : []
  const v = Array.isArray(values) ? values : []
  const have = d.map((date, i) => ({ date, v: num(v[i]) })).filter((p) => typeof p.date === 'string' && p.v !== null)
  if (have.length < 2) return null
  const n = d.length
  const x = (i) => padX + (n > 1 ? i / (n - 1) : 0) * (w - 2 * padX)
  const y = (s) => padY + (1 - Math.max(0, Math.min(100, s)) / 100) * (h - 2 * padY)
  const pts = d.map((_, i) => (num(v[i]) !== null ? { x: x(i), y: y(v[i]) } : null))
  let low = have[0]
  let high = have[0]
  for (const p of have) { if (p.v < low.v) low = p; if (p.v > high.v) high = p }
  return { w, h, path: pathThrough(pts), mid: Math.round(y(50) * 10) / 10, first: have[0], last: have[have.length - 1], low, high, days: have.length }
}

/** The line in words: its accessible name and the sentence under it. */
export function shareLineWords(geo) {
  if (!geo) return ''
  return `Share above the 50-day average, daily, ${dayWords(geo.first.date)} to ${dayWords(geo.last.date)}: low ${shareText(geo.low.v)} on `
    + `${dayWords(geo.low.date)}, high ${shareText(geo.high.v)} on ${dayWords(geo.high.date)}, now ${shareText(geo.last.v)}.`
}

/** GRP's one-line summaries (the closed sections say these). */
export function fundSummary(detail) {
  if (detail?.state !== 'ok') return null
  if (detail.fundState !== 'ok' || !detail.fund) return null
  const rows = fundRows(detail)
  const has = (id) => { const r = rows.find((x) => x.id === id); return r && r.now.value !== null ? r : null }
  const parts = []
  const rev = has('revenue_growth_q')
  if (rev) parts.push(`median revenue growth ${rev.now.text} (of ${count(rev.now.n)})`)
  const net = has('net_margin')
  if (net) parts.push(`net margin ${net.now.text}`)
  const pe = has('pe_ttm')
  if (pe) parts.push(`P/E ${pe.now.text}`)
  if (!parts.length) return `fewer than ${detail.minMembers} members have figures`
  return `${parts.join(', ')}${rev?.rank ? `; ${rev.rank} by revenue growth` : ''}`
}

export function breadthSummary(detail) {
  const rows = breadthRows(detail)
  const c = breadthCounts(detail)
  if (!rows.length || !c) return null
  const a50 = rows.find((r) => r.key === 'above50')
  const parts = []
  if (a50.now.share !== null) parts.push(`${shareText(a50.now.share)} above the 50-day${a50.weekChange !== null ? ` (${pointsText(a50.weekChange)} in a week)` : ''}`)
  if (c.net !== null) parts.push(`${count(c.highs)} new ${c.highs === 1 ? 'high' : 'highs'}, ${count(c.lows)} new ${c.lows === 1 ? 'low' : 'lows'}`)
  return parts.length ? parts.join('; ') : `fewer than ${detail.minMembers} stocks have closes to measure`
}

/** When the figures were worked out, in words: 'after the close of Nov 20, 2031 (built 8:31 PM ET)'. */
export function builtWords(view) {
  const day = dayWords(view?.session) || dayWords(view?.builtFor)
  const at = view?.builtAt ? formatTimeEt(view.builtAt, { zoneSuffix: 'ET', absent: null }) : null
  if (!day) return null
  return `after the close of ${day}${at ? ` (built ${at})` : ''}`
}

/** A failed or not-yet-built read of the fundamentals part, in words, or null when it is on hand. */
export function fundStateWords(state) {
  if (state === 'off') return 'Company figures from SEC filings are switched off for this server, so the fundamentals are not shown. Breadth is.'
  if (state === 'pending') return 'Company figures from SEC filings were switched on after the last evening build; they appear after the next one.'
  if (state === 'unavailable') return 'The SEC filing figures could not be read at the last evening build, so the fundamentals are not shown. The server tries again that evening.'
  return null
}

// ── the weekly rank (2026-11-22) ────────────────────────────────────────────────────────────────

const RANK_KINDS = new Set(['rank', 'rankMove', 'rankRange', 'rankLine'])
const RANK_POINTS = ['now', 'w4', 'w13', 'w52', 'best', 'worst']
const place = (v) => (Number.isInteger(v) && v > 0 ? v : null)

function readPoint(p) {
  if (!isObj(p)) return null
  return { position: place(p.position), of: int(p.of) ?? 0, n: int(p.n) ?? 0, median: num(p.median), date: str(p.date),
    change: Number.isInteger(p.change) ? p.change : null }
}

function readRankMeasure(m, full) {
  if (!isObj(m)) return null
  const out = { weeksRanked: int(m.weeks_ranked) ?? 0 }
  for (const k of RANK_POINTS) out[k] = readPoint(m[k])
  const line = Array.isArray(m.line) ? m.line : Array.isArray(m.rank) ? m.rank : []
  out.line = line.map(place)
  if (full) {
    out.medianLine = Array.isArray(m.median) ? m.median.map(num) : []
    out.nLine = Array.isArray(m.n) ? m.n.map((v) => int(v) ?? 0) : []
    out.ofLine = Array.isArray(m.of_line) ? m.of_line.map((v) => int(v) ?? 0) : []
  }
  return out
}

/** A group's `rank` -> `{ m6, m3 }` (each `{ now, w4, w13, w52, best, worst, weeksRanked, line }`), or null. */
export function readRank(r, { full = false } = {}) {
  if (!isObj(r)) return null
  return { m6: readRankMeasure(r.m6, full), m3: readRankMeasure(r.m3, full) }
}

/** '12th', or null. */
export const placeText = (p) => (place(p) ? `${count(p)}${ORD(p)}` : null)
/** Places moved: '+8', '-3', '0'; null with no change. */
export const placesText = (c) => (Number.isInteger(c) ? `${c > 0 ? '+' : ''}${count(c)}` : null)
/** 'climbed 8 places', 'fell 1 place', 'held its place'. */
export function placesWords(c) {
  if (!Number.isInteger(c)) return null
  if (c === 0) return 'held its place'
  const n = Math.abs(c)
  return `${c > 0 ? 'climbed' : 'fell'} ${count(n)} ${n === 1 ? 'place' : 'places'}`
}
const stocksWords = (n) => `${count(n ?? 0)} ${n === 1 ? 'stock' : 'stocks'}`
/** A median change as a member reads it: '+14.2%'. */
export const changeText = (v) => formatPercent(v, { decimals: 1, signed: true, absent: null })
const measureWords = (mid) => (mid === 'm3' ? '3-month' : '6-month')

function rankCell(row, col, { minMembers, dates, scaleMax }) {
  const blank = (words) => ({ value: null, text: null, sub: null, words })
  const mid = col.measure || 'm6'
  const m = row.rank?.[mid]
  if (!m) return blank('No weekly rank for this group yet.')
  if (col.kind === 'rank') {
    const now = m.now
    if (!now) return blank('No rank: the stored closes hold no week.')
    if (now.position === null) {
      return { value: null, text: `${count(now.n)} with prices`, sub: null, few: true,
        words: `${stocksWords(now.n)} with a ${measureWords(mid)} change: fewer than ${minMembers}, so no rank.` }
    }
    return { value: now.position, text: rankText(now), sub: stocksWords(now.n),
      words: `${rankText(now)} by the median ${measureWords(mid)} change${now.median !== null ? ` (${changeText(now.median)})` : ''} of ${stocksWords(now.n)}.` }
  }
  if (col.kind === 'rankMove') {
    const then = m[col.back]
    const wk = BACK_WEEKS[col.back]
    if (!then) return blank(`No week ${wk} weeks back in the stored closes.`)
    if (then.position === null) return blank(`No rank ${wk} weeks ago: ${stocksWords(then.n)} with a 6-month change then, fewer than ${minMembers}.`)
    const was = `${rankText(then)} on ${dayWords(then.date) || 'that week'} (${stocksWords(then.n)})`
    if (then.change === null) return { value: null, text: `was ${placeText(then.position)}`, sub: null, few: true, words: `${wk} weeks ago ${was}; no rank now.` }
    return { value: then.change, text: placesText(then.change), sub: `was ${placeText(then.position)}`, words: `${wk} weeks ago ${was}; ${placesWords(then.change)} since.` }
  }
  if (col.kind === 'rankRange') {
    const { best, worst } = m
    if (!best || !worst) return blank('No ranked week in the last year.')
    return { value: best.position, text: `${placeText(best.position)} / ${placeText(worst.position)}`, sub: `${count(m.weeksRanked)} weeks ranked`,
      words: `Best ${rankText(best)} on ${dayWords(best.date)}, worst ${rankText(worst)} on ${dayWords(worst.date)}, over ${count(m.weeksRanked)} ranked weeks.` }
  }
  const drawn = rankLine(dates, m.line, null, { w: 72, h: 20, padX: 1, padY: 2, scaleMax })
  // the table's line carries no weekly counts; its last point is now, whose count the answer gives
  const geo = drawn && m.now?.position === drawn.last.position && drawn.last.i === m.line.length - 1
    ? { ...drawn, last: { ...drawn.last, of: m.now.of || null } } : drawn
  return { value: null, text: null, sub: null, geo, words: geo ? rankLineWords(geo) : 'Fewer than two ranked weeks: no line.' }
}

/**
 * A year of weekly ranks as a line, 1st at the top and `top` (the most groups ranked in any week, or `scaleMax`) at
 * the bottom; a week with no rank breaks it. `{ w, h, path, mid, top, first, last, best, worst, weeks }` or null with
 * fewer than two ranked weeks. Each point `{ i, position, date, of }`; best and worst take the later week on a tie.
 */
export function rankLine(dates, positions, ofs = null, { w = 320, h = 90, padX = 2, padY = 6, scaleMax = null } = {}) {
  const p = Array.isArray(positions) ? positions : []
  const d = Array.isArray(dates) ? dates : []
  const o = Array.isArray(ofs) ? ofs : []
  const have = []
  for (let i = 0; i < p.length; i += 1) if (place(p[i])) have.push({ i, position: p[i], date: str(d[i]), of: int(o[i]) })
  if (have.length < 2) return null
  const top = Math.max(2, place(scaleMax) || 0, ...have.map((q) => q.position), ...o.map((v) => int(v) ?? 0))
  const n = p.length
  const x = (i) => padX + (n > 1 ? i / (n - 1) : 0) * (w - 2 * padX)
  const y = (r) => padY + ((r - 1) / (top - 1)) * (h - 2 * padY)
  let best = have[0]
  let worst = have[0]
  for (const q of have) { if (q.position <= best.position) best = q; if (q.position >= worst.position) worst = q }
  return { w, h, path: pathThrough(p.map((r, i) => (place(r) ? { x: x(i), y: y(r) } : null))), mid: Math.round(y((top + 1) / 2) * 10) / 10,
    top, first: have[0], last: have[have.length - 1], best, worst, weeks: have.length }
}

/** The line in words: its accessible name. */
export function rankLineWords(geo, mid = 'm6') {
  if (!geo) return ''
  const on = (q) => (q.date ? ` on ${dayWords(q.date)}` : '')
  const span = geo.first.date && geo.last.date ? `, ${dayWords(geo.first.date)} to ${dayWords(geo.last.date)}` : ''
  return `Rank by the median ${measureWords(mid)} change each week${span}, 1st at the top: best ${placeText(geo.best.position)}${on(geo.best)}, `
    + `worst ${placeText(geo.worst.position)}${on(geo.worst)}, latest ${placeText(geo.last.position)}${geo.last.of ? ` of ${count(geo.last.of)}` : ''}.`
}

/** The largest place any row's line or point reaches: one scale for every small line in the table. */
export function rankScaleMax(rows) {
  let top = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    const m = r?.rank?.m6
    if (!m) continue
    for (const v of m.line || []) if (place(v) && v > top) top = v
    for (const k of RANK_POINTS) if (m[k] && m[k].of > top) top = m[k].of
  }
  return top || null
}

/** The movers strip's windows. */
export const RANK_MOVER_WINDOWS = Object.freeze([Object.freeze({ back: 'w4', label: '4 weeks' }), Object.freeze({ back: 'w13', label: '13 weeks' })])

/**
 * The groups that climbed and fell the most places by their 6-month rank over a window (`w4` or `w13`): `{ up, down,
 * counted }`, each item `{ name, change, from, to }` (two weekly points). Only a group ranked at both ends counts;
 * equal moves go by name.
 */
export function rankMovers(rows, back = 'w4', limit = 3) {
  const moves = []
  for (const r of Array.isArray(rows) ? rows : []) {
    const m = r?.rank?.m6
    const from = m?.[back]
    if (from && Number.isInteger(from.change) && m.now?.position) moves.push({ name: r.name, change: from.change, from, to: m.now })
  }
  const up = moves.filter((x) => x.change > 0).sort((a, b) => b.change - a.change || a.name.localeCompare(b.name)).slice(0, limit)
  const down = moves.filter((x) => x.change < 0).sort((a, b) => a.change - b.change || a.name.localeCompare(b.name)).slice(0, limit)
  return { up, down, counted: moves.length }
}

/** One mover in words: 'from 17th of 140 (Oct 23, 2031) to 5th of 145'. */
export const moverWords = (x) => `${placesWords(x.change)}: from ${rankText(x.from)} on ${dayWords(x.from.date) || 'that week'} to ${rankText(x.to)}`

const RANK_ROWS = [['now', 'Now'], ['w4', '4 weeks ago'], ['w13', '13 weeks ago'], ['w52', '52 weeks ago'], ['best', 'Best of the year'], ['worst', 'Worst of the year']]

function rankDetailCell(m, key, min) {
  const p = m?.[key]
  const span = key === 'best' || key === 'worst'
  if (!p) return { text: null, sub: null, words: span ? 'No ranked week in the last year.' : 'No such week in the stored closes.' }
  if (p.position === null) {
    return { text: `${count(p.n)} with prices`, sub: null, few: true, words: `${stocksWords(p.n)} with a change, fewer than ${min}: no rank.` }
  }
  let sub
  if (key === 'now') sub = `${p.median !== null ? `median ${changeText(p.median)}, ` : ''}${stocksWords(p.n)}`
  else if (span) sub = `${dayWords(p.date) || ''}, ${stocksWords(p.n)}`
  else sub = `${stocksWords(p.n)}${p.change !== null ? `, ${placesWords(p.change)} since` : ''}`
  return { text: rankText(p), sub, words: `${rankText(p)}: ${sub}.` }
}

/** GRP's rank rows: now, 4, 13 and 52 weeks ago, and the year's best and worst, each by the 6-month and the 3-month change. */
export function rankRows(detail) {
  const r = detail?.state === 'ok' && detail.rankState === 'ok' ? detail.rank : null
  if (!r) return []
  return RANK_ROWS.map(([key, label]) => ({
    key, label, date: key === 'best' || key === 'worst' ? null : (r.m6?.[key]?.date || r.m3?.[key]?.date || null),
    cells: ['m6', 'm3'].map((mid) => rankDetailCell(r[mid], key, detail.minMembers)),
  }))
}

/** GRP's one-line rank summary (the closed section says it). */
export function rankSummary(detail) {
  if (detail?.state !== 'ok') return null
  if (detail.rankState === 'pending') return 'appears after the next evening build'
  if (detail.rankState !== 'ok' || !detail.rank?.m6) return 'not shown'
  const m = detail.rank.m6
  if (!m.now) return 'no week in the stored closes'
  if (m.now.position === null) return `${stocksWords(m.now.n)} with prices, fewer than ${detail.minMembers}: no rank`
  const moved = (c, l) => (c === 0 ? `no change in ${l}` : `${placesText(c)} ${Math.abs(c) === 1 ? 'place' : 'places'} in ${l}`)
  const moves = [['w4', '4 weeks'], ['w13', '13 weeks']]
    .map(([k, l]) => (Number.isInteger(m[k]?.change) ? moved(m[k].change, l) : null))
    .filter(Boolean)
  const head = `${rankText(m.now)} by 6-month change (${stocksWords(m.now.n)})`
  return moves.length ? `${head}; ${moves.join(', ')}` : head
}

/** The weekly rank's state in words when it is not on hand, or null. */
export function rankStateWords(state) {
  if (state === 'pending') return 'The weekly rank appears after the next evening build: the figures held now were worked out before it was added.'
  if (state === 'unavailable') return 'No stored closes could be read at the last evening build, so there is no weekly rank.'
  return null
}

/** How a measure is taken, in words: '126 stored sessions (about six months)'. */
export function rankWindowWords(sessions, mid) {
  const about = mid === 'm3' ? 'about three months' : 'about six months'
  return int(sessions) ? `${count(sessions)} stored sessions (${about})` : about
}
