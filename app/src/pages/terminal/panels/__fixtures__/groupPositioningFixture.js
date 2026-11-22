// GET /api/research/group-stats?...&part=positioning answers (api/services/group_stats.py `get_group_positioning`), in
// the route's real shape. Every symbol, company, figure, count and date here is INVENTED.

const SOURCES = {
  fundamentals: { state: 'ok', source: 'SEC filings (XBRL), as filed', with_data: 2711 },
  breadth: { state: 'ok', source: "UCT's stored daily closes", priced: 2984 },
  rank: { state: 'ok', source: "UCT's stored daily closes", dates: [] },
}

export const POSITIONING_SOURCES = {
  state: 'ok', min_members: 5, top_n: 3,
  short: { state: 'ok', source: 'FINRA, through Massive', settlement_date: '2031-05-15', previous_settlement_date: '2031-04-30',
    publication_estimate: '2031-05-27', read_at: '2031-05-28T10:00:00+00:00', float_source: 'nightly screener export',
    reason: null, covered: 2950, universe: 3051 },
  insider: { state: 'ok', source: 'SEC Form 4 filings (open-market purchases)', keep_days: 30, from: '2031-05-06', to: '2031-06-03',
    complete: true, listed: 14210, read: 14210, given_up: 0, matched: 611, unmatched: 140, sales: 'not_held', universe: 3051 },
  funds: { state: 'ok', source: 'SEC Form N-PORT', quarter: '2031Q1', prior_quarter: '2030Q4', built_at: '2031-05-20T05:00:00+00:00',
    period_from: '2031-01-31', period_to: '2031-03-31', prior_missing: null, matched_value_pct: 97.5, covered: 2890, known: 2804,
    universe: 3051 },
  institutions: { state: 'not_held', source: 'Form 13F filings, through FMP', detail: 'Not shown.' },
}

const COMMON = {
  status: 'ok', part: 'positioning', built_at: '2031-06-05T00:31:00+00:00', built_for: '2031-06-04', session: '2031-06-04',
  sessions: { now: '2031-06-04' }, fund_refs: {}, sources: { ...SOURCES, positioning: POSITIONING_SOURCES },
  universe: { name: "UCT's stock universe", symbols: 3120, mapped: 3051, not_mapped: 69 }, lagging: [], metrics: [], min_members: 5,
  refreshing: false,
}

const med = (n, median, q1 = null, q3 = null) => ({ n, median, q1, q3 })
const shr = (n, count, share) => ({ n, count, share })

const TECH = {
  short: { reported: 50, pct_float: med(50, 4.2, 2.1, 7.9), days_to_cover: med(50, 2.6, 1.8, 3.9), change: med(48, 3.5, -2.0, 9.0),
    top: [{ sym: 'QTKA', pct_float: 31.5, days_to_cover: 6.2 }, { sym: 'QTKB', pct_float: 24.0, days_to_cover: 4.1 },
      { sym: 'QTKC', pct_float: 19.8, days_to_cover: 8.0 }] },
  insider: { members: 52, buyers: shr(52, 9, 17.3), purchases: 14, value: 6_400_000, unpriced: 1,
    top: [{ sym: 'QTKD', value: 2_500_000, date: '2031-05-21', role: 'ceo' }, { sym: 'QTKD', value: 1_100_000, date: '2031-05-22', role: 'director' },
      { sym: 'QTKE', value: 900_000, date: '2031-06-02', role: 'ten_percent' }] },
  funds: { held: 51, known: 50, adding: shr(50, 31, 62.0), net: med(48, 2.4, -1.5, 6.8) },
}
const ENERGY = {
  short: { reported: 23, pct_float: med(23, 6.8, 4.0, 11.2), days_to_cover: med(23, 3.9, 2.5, 5.0), change: med(23, -4.1, -9.0, 1.0),
    top: [{ sym: 'QENA', pct_float: 18.2, days_to_cover: 7.7 }] },
  insider: { members: 23, buyers: shr(23, 0, 0.0), purchases: 0, value: null, unpriced: 0, top: [] },
  funds: { held: 23, known: 22, adding: shr(22, 8, 36.4), net: med(22, -3.3, -7.0, 1.1) },
}
const UTILITIES = {
  short: { reported: 3, pct_float: med(3, null), days_to_cover: med(3, null), change: med(3, null), top: [{ sym: 'QUTA', pct_float: 3.1, days_to_cover: 2.0 }] },
  insider: { members: 3, buyers: shr(3, 1, null), purchases: 1, value: null, unpriced: 2, top: [] },
  funds: { held: 3, known: 3, adding: shr(3, 2, null), net: med(3, null) },
}

export const SECTOR_POSITIONING = {
  ...COMMON, kind: 'sector', count: 3,
  groups: [
    { name: 'Technology', members: 52, positioning: TECH },
    { name: 'Energy', members: 23, positioning: ENERGY },
    { name: 'Utilities', members: 3, positioning: UTILITIES },
  ],
}

/** The same table with the short interest part not on hand (the data plan refused) and the N-PORT index not built. */
export const SECTOR_POSITIONING_PARTS_DOWN = {
  ...SECTOR_POSITIONING,
  sources: { ...SOURCES, positioning: { ...POSITIONING_SOURCES, short: { state: 'unavailable', reason: 'refused' }, funds: { state: 'not_built' },
    insider: { ...POSITIONING_SOURCES.insider, complete: false } } },
  groups: SECTOR_POSITIONING.groups.map((g) => ({ ...g, positioning: { ...g.positioning, short: null, funds: null } })),
}

/** A held answer built before positioning existed. */
export const SECTOR_POSITIONING_PENDING = {
  ...COMMON, kind: 'sector', count: 2, sources: { ...SOURCES, positioning: { state: 'pending', short: { state: 'pending' } } },
  groups: [{ name: 'Technology', members: 52, positioning: null }, { name: 'Energy', members: 23, positioning: null }],
}

export const INDUSTRY_POSITIONING = {
  ...COMMON, kind: 'industry', count: 1,
  groups: [{ name: 'Semiconductors', members: 17, positioning: TECH }],
}

const row = (sym, f) => ({ sym, short_interest: null, pct_float: null, days_to_cover: null, short_change_pct: null, buys: null, buy_value: null,
  buy_unpriced: null, last_buy: null, funds: null, funds_added: null, funds_cut: null, fund_net_pct: null, ...f })

export const TECH_MEMBERS = {
  ...COMMON, kind: 'sector', name: 'Technology', peers: 3, found: true, members: 4, positioning: TECH,
  member_rows: [
    row('QTKA', { short_interest: 9_000_000, pct_float: 31.5, days_to_cover: 6.2, short_change_pct: 12.5, funds: 40, funds_added: 22, funds_cut: 9, fund_net_pct: 4.4 }),
    row('QTKD', { short_interest: 1_200_000, pct_float: 2.0, days_to_cover: 1.1, short_change_pct: -3.0, buys: 2, buy_value: 3_600_000, buy_unpriced: 0,
      last_buy: '2031-05-22', funds: 12, funds_added: 3, funds_cut: 5, fund_net_pct: -8.0 }),
    row('QTKF', { short_interest: 300_000, pct_float: null, days_to_cover: 0.9, short_change_pct: null, buys: 1, buy_value: null, buy_unpriced: 2,
      last_buy: '2031-05-30', funds: 4, funds_added: null, funds_cut: null, fund_net_pct: null }),
    row('QTKG', {}),
  ],
  member_total: 4, member_limit: 1000, member_cut: false,
}

export const MEMBERS_NOT_FOUND = { ...COMMON, kind: 'sector', name: 'Shipping', peers: 3, found: false }
