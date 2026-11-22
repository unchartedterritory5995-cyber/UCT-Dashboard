// GET /api/research/group-stats answers (api/services/group_stats.py `get_group_stats`), in the route's real
// shape. Every group figure, count and date here is INVENTED.

export const METRICS = [
  { id: 'revenue_growth_q', name: 'Revenue Growth (Quarterly)', category: 'Growth', unit: 'percent', fmt: 'pct1', agg: 'median', composed: false, subtitle: 'Year over year', methodology: 'Quarterly revenue versus the same fiscal quarter a year earlier.' },
  { id: 'eps_growth_q', name: 'EPS Growth (Quarterly)', category: 'Growth', unit: 'percent', fmt: 'pct1', agg: 'median', composed: false, subtitle: 'Year over year', methodology: 'Quarterly diluted EPS versus the same quarter a year earlier.' },
  { id: 'revenue_accelerating', name: 'Revenue growth accelerating', category: 'Growth', unit: 'percent', fmt: 'pct1', agg: 'share', composed: false, subtitle: 'Share of members', methodology: 'The share of members whose newest quarter grew faster than the quarter before.' },
  { id: 'gross_margin', name: 'Gross Margin', category: 'Profitability', unit: 'percent', fmt: 'pct1', agg: 'median', composed: false, subtitle: 'TTM', methodology: 'Gross profit TTM / revenue TTM.' },
  { id: 'operating_margin', name: 'Operating Margin', category: 'Profitability', unit: 'percent', fmt: 'pct1', agg: 'median', composed: false, subtitle: 'TTM', methodology: 'Operating income TTM / revenue TTM.' },
  { id: 'net_margin', name: 'Net Margin', category: 'Profitability', unit: 'percent', fmt: 'pct1', agg: 'median', composed: false, subtitle: 'TTM', methodology: 'Net income TTM / revenue TTM.' },
  { id: 'fcf_margin', name: 'FCF Margin', category: 'Profitability', unit: 'percent', fmt: 'pct1', agg: 'median', composed: false, subtitle: 'TTM', methodology: 'Free cash flow TTM / revenue TTM.' },
  { id: 'roe', name: 'Return on Equity', category: 'Profitability', unit: 'percent', fmt: 'pct1', agg: 'median', composed: false, subtitle: 'TTM', methodology: 'Net income TTM / average equity.' },
  { id: 'pe_ttm', name: 'P/E (TTM)', category: 'Valuation', unit: 'ratio', fmt: 'x2', agg: 'median', composed: true, subtitle: 'Trailing', methodology: 'Close / diluted EPS TTM known at that close.' },
  { id: 'ps_ttm', name: 'Price / Sales', category: 'Valuation', unit: 'ratio', fmt: 'x2', agg: 'median', composed: true, subtitle: 'TTM', methodology: 'Market cap / revenue TTM.' },
  { id: 'fcf_yield', name: 'FCF Yield', category: 'Valuation', unit: 'percent', fmt: 'pct1', agg: 'median', composed: true, subtitle: 'TTM', methodology: 'Free cash flow TTM / market cap.' },
]

// ── the weekly rank (2026-11-22): every place, count, median and date here is INVENTED ──
const DAY = 86400000
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)
/** The rank's 53 points: the last close of each of 52 weeks (Fridays), then the session (a Wednesday). */
export const RANK_DATES = [...Array.from({ length: 52 }, (_, i) => isoDay(Date.UTC(2030, 5, 7) + i * 7 * DAY)), '2031-06-04']
/** A point `back` weeks before the session (0 = now); `change` (places climbed since) only on a point back in time. */
const pt = (position, of, n, median, back, change) => ({ position, of, n, median, date: RANK_DATES[52 - back], ...(change === undefined ? {} : { change }) })
/** A point at a week of the year (best and worst). */
const ptAt = (position, of, n, median, i) => ({ position, of, n, median, date: RANK_DATES[i] })
const weekly = (fill, at = {}) => Array.from({ length: 53 }, (_, i) => (i in at ? at[i] : fill))
const RANK_SOURCE = {
  state: 'ok', source: "UCT's stored daily closes (split-adjusted, price only)", weeks: 52,
  measures: [{ id: 'm6', sessions: 126 }, { id: 'm3', sessions: 63 }], dates: RANK_DATES, min_members: 5,
}
/** A year that climbs from `from` to `to`, one point a week. */
const climb = (from, to) => Array.from({ length: 53 }, (_, i) => Math.round(from + ((to - from) * i) / 52))

const TECH_RANK_BRIEF = {
  m6: { now: pt(1, 2, 50, 18.4, 0), w4: pt(2, 2, 49, 9.1, 4, 1), w13: pt(2, 2, 48, 3.0, 13, 1), w52: pt(1, 2, 45, 22.0, 52, 0),
    best: pt(1, 2, 50, 18.4, 0), worst: pt(2, 2, 49, 9.1, 4), weeks_ranked: 53, line: weekly(1, { 30: 2, 39: 2, 48: 2 }) },
  m3: { now: pt(2, 2, 50, 4.2, 0), w4: pt(1, 2, 49, 6.0, 4, -1), w13: pt(1, 2, 48, 1.1, 13, -1), w52: pt(2, 2, 45, 8.0, 52, 0),
    best: pt(1, 2, 49, 6.0, 4), worst: pt(2, 2, 50, 4.2, 0), weeks_ranked: 53 },
}
const ENERGY_RANK_BRIEF = {
  m6: { now: pt(2, 2, 23, -6.5, 0), w4: pt(1, 2, 23, 2.0, 4, -1), w13: pt(1, 2, 22, 5.5, 13, -1), w52: pt(2, 2, 21, -3.0, 52, 0),
    best: pt(1, 2, 23, 2.0, 4), worst: pt(2, 2, 23, -6.5, 0), weeks_ranked: 53, line: weekly(2, { 30: 1, 39: 1, 48: 1 }) },
  m3: { now: pt(1, 2, 23, 5.0, 0), w4: pt(2, 2, 23, -1.0, 4, 1), w13: pt(2, 2, 22, -2.0, 13, 1), w52: pt(1, 2, 21, 2.0, 52, 0),
    best: pt(1, 2, 23, 5.0, 0), worst: pt(2, 2, 23, -1.0, 4), weeks_ranked: 53 },
}
const FEW_RANK = (n) => ({ now: pt(null, 2, n, null, 0), w4: pt(null, 2, n, null, 4, null), w13: pt(null, 2, n, null, 13, null),
  w52: pt(null, 2, n, null, 52, null), best: null, worst: null, weeks_ranked: 0 })
const UTIL_RANK_BRIEF = { m6: { ...FEW_RANK(3), line: weekly(null) }, m3: FEW_RANK(3) }
const SEMIS_RANK_BRIEF = {
  m6: { now: pt(5, 140, 17, 41.3, 0), w4: pt(17, 138, 17, 22.0, 4, 12), w13: pt(35, 139, 16, 8.0, 13, 30), w52: pt(90, 131, 15, -12.5, 52, 85),
    best: ptAt(3, 140, 17, 44.0, 50), worst: ptAt(96, 131, 15, -14.1, 2), weeks_ranked: 53,
    line: Object.assign(climb(90, 5), { 2: 96, 39: 35, 48: 17, 50: 3 }) },
  m3: { now: pt(8, 140, 17, 19.0, 0), w4: pt(12, 138, 17, 11.0, 4, 4), w13: pt(60, 139, 16, 1.0, 13, 52), w52: pt(70, 131, 15, -4.0, 52, 62),
    best: ptAt(2, 139, 17, 25.0, 47), worst: ptAt(101, 131, 15, -9.0, 5), weeks_ranked: 53 },
}
const OIL_RANK_BRIEF = {
  m6: { now: pt(120, 140, 10, -18.2, 0), w4: pt(110, 138, 10, -12.0, 4, -10), w13: pt(75, 139, 10, -2.0, 13, -45), w52: pt(20, 131, 9, 15.0, 52, -100),
    best: ptAt(12, 133, 9, 18.0, 6), worst: pt(120, 140, 10, -18.2, 0), weeks_ranked: 53,
    line: Object.assign(climb(20, 120), { 6: 12, 39: 75, 48: 110 }) },
  m3: { now: pt(131, 140, 10, -11.0, 0), w4: pt(104, 138, 10, -4.0, 4, -27), w13: pt(66, 139, 10, 1.0, 13, -65), w52: pt(30, 131, 9, 6.0, 52, -101),
    best: ptAt(9, 133, 9, 12.0, 8), worst: pt(131, 140, 10, -11.0, 0), weeks_ranked: 53 },
}

const COMMON = {
  status: 'ok', built_at: '2031-06-05T00:31:00+00:00', built_for: '2031-06-04', session: '2031-06-04',
  sessions: { now: '2031-06-04', week: '2031-05-28', month: '2031-05-05' },
  fund_refs: { now: '2031-06-04', year_ago: '2030-06-04', three_years_ago: '2028-06-04' },
  sources: {
    fundamentals: { state: 'ok', source: 'SEC filings (XBRL), as filed', with_data: 2711 },
    breadth: { state: 'ok', source: "UCT's stored daily closes", priced: 2984 },
    rank: RANK_SOURCE,
  },
  universe: { name: "UCT's stock universe", map: 'company details', symbols: 3120, mapped: 3051, not_mapped: 69 },
  lagging: [], metrics: METRICS, min_members: 5, refreshing: false,
}

/** {id: {n, value, year_ago: {n, value}}} from [now, a year ago] pairs and one n. */
const brief = (n, pairs) => Object.fromEntries(Object.entries(pairs).map(([id, [v, ya]]) => [id, { n, value: v, year_ago: { n: n - 3, value: ya } }]))
const share = (share, n, week, month) => ({ share, n, count: share === null ? 0 : Math.round((share * n) / 100), week_change: week, month_change: month })

const TECH_BRIEF = brief(48, {
  revenue_growth_q: [14.2, 9.8], eps_growth_q: [21.5, 12.0], revenue_accelerating: [56.3, 41.0], gross_margin: [61.4, 60.2],
  operating_margin: [18.9, 17.1], net_margin: [14.8, 13.9], fcf_margin: [19.6, 18.0], roe: [22.4, 20.1], pe_ttm: [31.75, 26.4],
  ps_ttm: [6.2, 5.1], fcf_yield: [3.1, 3.8],
})
const ENERGY_BRIEF = brief(21, {
  revenue_growth_q: [-4.6, 7.2], eps_growth_q: [-12.3, 15.4], revenue_accelerating: [23.8, 61.0], gross_margin: [38.0, 40.5],
  operating_margin: [12.2, 15.8], net_margin: [8.7, 11.2], fcf_margin: [9.9, 13.0], roe: [11.5, 16.0], pe_ttm: [12.4, 9.8],
  ps_ttm: [1.4, 1.2], fcf_yield: [7.9, 9.4],
})
const FEW = Object.fromEntries(METRICS.map((m) => [m.id, { n: 3, value: null, year_ago: { n: 3, value: null } }]))

export const SECTOR_BOARD = {
  ...COMMON, kind: 'sector', count: 3,
  groups: [
    { name: 'Technology', members: 52, fund_members: 48, fund: TECH_BRIEF, rank: TECH_RANK_BRIEF,
      breadth: { above20: share(64.0, 50, 4.0, 12.0), above50: share(58.0, 50, 6.0, -8.0), above200: share(71.4, 49, 1.0, 3.0),
        near_high: share(30.0, 50, 2.0, -4.0), new_highs: { n: 47, count: 6 }, new_lows: { n: 47, count: 1 }, net_highs: 5,
        advance_decline: { n: 50, advancers: 31, decliners: 17, unchanged: 2 }, priced: 50 } },
    { name: 'Energy', members: 23, fund_members: 21, fund: ENERGY_BRIEF, rank: ENERGY_RANK_BRIEF,
      breadth: { above20: share(26.1, 23, -9.0, -20.0), above50: share(34.8, 23, -4.0, -10.0), above200: share(47.8, 23, -2.0, -6.0),
        near_high: share(8.7, 23, -4.0, -9.0), new_highs: { n: 23, count: 0 }, new_lows: { n: 23, count: 3 }, net_highs: -3,
        advance_decline: { n: 23, advancers: 7, decliners: 15, unchanged: 1 }, priced: 23 } },
    { name: 'Utilities', members: 3, fund_members: 3, fund: FEW, rank: UTIL_RANK_BRIEF,
      breadth: { above20: share(null, 3, null, null), above50: share(null, 3, null, null), above200: share(null, 3, null, null),
        near_high: share(null, 3, null, null), new_highs: { n: 3, count: 1 }, new_lows: { n: 3, count: 0 }, net_highs: null,
        advance_decline: { n: 3, advancers: 2, decliners: 1, unchanged: 0 }, priced: 3 } },
  ],
}

export const INDUSTRY_BOARD = {
  ...COMMON, kind: 'industry', count: 2,
  groups: [
    { name: 'Semiconductors', members: 18, fund_members: 17, fund: brief(17, { revenue_growth_q: [31.0, 4.0], net_margin: [16.2, 12.0], pe_ttm: [38.0, 22.5] }),
      breadth: SECTOR_BOARD.groups[0].breadth, rank: SEMIS_RANK_BRIEF },
    { name: 'Oil & Gas E&P', members: 11, fund_members: 10, fund: brief(10, { revenue_growth_q: [-8.0, 9.0], net_margin: [10.4, 14.1], pe_ttm: [9.6, 7.7] }),
      breadth: SECTOR_BOARD.groups[1].breadth, rank: OIL_RANK_BRIEF },
  ],
}

const fig = (median, n, q1 = null, q3 = null) => ({ n, median, q1, q3 })
const rank = (position, of) => ({ position, of })
const LINE_DATES = Array.from({ length: 252 }, (_, i) => {
  const d = new Date(Date.UTC(2030, 5, 5) + i * 86400000 * 1.45)
  return d.toISOString().slice(0, 10)
})
/** A year of "% above the 50-day": a slow rise with a dip, invented. A short gap of too few stocks breaks it. */
const LINE = LINE_DATES.map((_, i) => (i >= 40 && i < 43 ? null : Math.round((40 + 25 * Math.sin(i / 30) + i / 12) * 10) / 10))

/** Technology's year among 11 sectors: a gap week (four stocks priced), its worst week, its best week, then now. */
const TECH_LINE = weekly(null).map((_, i) => (i < 20 ? 7 : i < 40 ? 5 : 4))
Object.assign(TECH_LINE, { 10: null, 20: 9, 45: 1, 48: 3, 52: 2 })
const TECH_M3_LINE = weekly(null).map((_, i) => (i < 26 ? 3 : 6))
Object.assign(TECH_M3_LINE, { 12: 10, 48: 4, 52: 1 })
const TECH_N = Object.assign(weekly(50), { 10: 4 })
const OF11 = weekly(11)
export const TECH_RANK = {
  m6: { now: pt(2, 11, 50, 14.0, 0), w4: pt(3, 11, 50, 11.0, 4, 1), w13: pt(5, 11, 50, 5.0, 13, 3), w52: pt(7, 11, 50, -1.0, 52, 5),
    best: ptAt(1, 11, 50, 17.0, 45), worst: ptAt(9, 11, 50, -7.0, 20), weeks_ranked: 52,
    rank: TECH_LINE, median: TECH_LINE.map((p) => (p === null ? null : Math.round((20 - p * 3) * 10) / 10)), n: TECH_N, of_line: OF11 },
  m3: { now: pt(1, 11, 50, 9.0, 0), w4: pt(4, 11, 50, 6.0, 4, 3), w13: pt(6, 11, 50, 4.0, 13, 5), w52: pt(3, 11, 50, 7.0, 52, 2),
    best: pt(1, 11, 50, 9.0, 0), worst: ptAt(10, 11, 50, 0.0, 12), weeks_ranked: 53,
    rank: TECH_M3_LINE, median: TECH_M3_LINE.map((p) => Math.round((10 - p) * 10) / 10), n: weekly(50), of_line: OF11 },
}

export const TECH_DETAIL = {
  ...COMMON, kind: 'sector', name: 'Technology', found: true, peers: 11, members: 52, fund_members: 48,
  line_dates: LINE_DATES, rank: TECH_RANK,
  fund: {
    revenue_growth_q: { now: fig(14.2, 46, 4.1, 27.9), year_ago: fig(9.8, 44), three_years_ago: fig(17.5, 39), rank: rank(2, 11) },
    eps_growth_q: { now: fig(21.5, 41, -3.0, 48.2), year_ago: fig(12.0, 40), three_years_ago: fig(25.1, 35), rank: rank(1, 11) },
    revenue_accelerating: { now: { n: 46, count: 26, share: 56.5 }, year_ago: { n: 44, count: 18, share: 40.9 }, three_years_ago: { n: 3, count: 2, share: null }, rank: rank(3, 11) },
    gross_margin: { now: fig(61.4, 38, 48.0, 74.2), year_ago: fig(60.2, 37), three_years_ago: fig(58.8, 33), rank: rank(1, 10) },
    operating_margin: { now: fig(18.9, 47, 6.5, 30.1), year_ago: fig(17.1, 45), three_years_ago: fig(16.4, 40), rank: rank(2, 11) },
    net_margin: { now: fig(14.8, 48, 3.2, 25.0), year_ago: fig(13.9, 46), three_years_ago: fig(12.7, 41), rank: rank(2, 11) },
    fcf_margin: { now: fig(19.6, 44, 8.0, 31.4), year_ago: fig(18.0, 42), three_years_ago: fig(16.6, 37), rank: rank(1, 11) },
    roe: { now: fig(22.4, 48, 9.9, 38.0), year_ago: fig(20.1, 46), three_years_ago: fig(19.3, 41), rank: rank(3, 11) },
    pe_ttm: { now: fig(31.75, 40, 21.0, 52.4), year_ago: fig(26.4, 38), three_years_ago: fig(null, 3), rank: rank(1, 11) },
    ps_ttm: { now: fig(6.2, 47, 3.3, 11.8), year_ago: fig(5.1, 45), three_years_ago: fig(4.4, 40), rank: rank(1, 11) },
    fcf_yield: { now: fig(3.1, 44, 1.6, 5.0), year_ago: fig(3.8, 42), three_years_ago: fig(4.2, 37), rank: rank(10, 11) },
  },
  breadth: {
    above20: { now: { n: 50, count: 32, share: 64.0 }, week: { n: 50, count: 30, share: 60.0 }, month: { n: 49, count: 25, share: 51.0 }, rank: rank(2, 11) },
    above50: { now: { n: 50, count: 29, share: 58.0 }, week: { n: 50, count: 26, share: 52.0 }, month: { n: 49, count: 32, share: 65.3 }, rank: rank(3, 11) },
    above200: { now: { n: 49, count: 35, share: 71.4 }, week: { n: 49, count: 34, share: 69.4 }, month: { n: 48, count: 33, share: 68.8 }, rank: rank(1, 11) },
    near_high: { now: { n: 47, count: 14, share: 29.8 }, week: { n: 47, count: 13, share: 27.7 }, month: { n: 46, count: 16, share: 34.8 }, rank: rank(2, 11) },
    new_highs: { n: 47, count: 6 }, new_lows: { n: 47, count: 1 }, net_highs: 5, net_highs_rank: rank(1, 11),
    advance_decline: { n: 50, advancers: 31, decliners: 17, unchanged: 2 }, priced: 50, line: LINE,
  },
}

export const SEMIS_DETAIL = {
  ...TECH_DETAIL, kind: 'industry', name: 'Semiconductors', peers: 140, members: 18, fund_members: 17,
}

export const NOT_BUILT = { status: 'not_built', kind: 'sector', detail: 'The group figures are worked out once each evening after the close.' }
export const COMPUTING = { status: 'computing', kind: 'sector' }
