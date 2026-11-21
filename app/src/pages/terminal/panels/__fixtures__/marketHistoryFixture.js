// MKTH: an invented market history answer in the route's real shape (api/services/market_history.py).
// EVERY date, level, return, count and ticker here is invented (the dates are in the 2030s on purpose,
// the tickers are not in the site's universe); nothing is a real index or stock.

const NOTE = "From stocks that trade today: companies later delisted or acquired are not in UCT's price history, so this list can leave out some of that rally's leaders."
const SECTORS = ['Technology', 'Healthcare', 'Industrials', 'Energy', 'Financial Services']

/** 25 invented leaders, best first; the third has a suspect one-day move inside the window. */
export function inventedLeaders(indexReturnPct = 21.4) {
  const top = []
  for (let i = 0; i < 25; i += 1) {
    const ret = Math.round((188.4 - i * 6.3) * 100) / 100
    top.push({
      sym: `QZ${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
      sector: i === 4 ? null : SECTORS[i % SECTORS.length],
      return_pct: ret,
      vs_index_pct: Math.round((ret - indexReturnPct) * 100) / 100,
      check: i === 2,
    })
  }
  return top
}

export const SECTOR_MEDIANS = [
  { sector: 'Technology', median_pct: 31.6, count: 412 },
  { sector: 'Industrials', median_pct: 24.2, count: 377 },
  { sector: 'Healthcare', median_pct: 18.9, count: 455 },
  { sector: 'Financial Services', median_pct: 12.1, count: 389 },
  { sector: 'Energy', median_pct: -2.4, count: 140 },
]

const rally = (one, three, six, twelve, dates) => [
  { months: 1, target: dates[0], date: one == null ? null : dates[0], return_pct: one },
  { months: 3, target: dates[1], date: three == null ? null : dates[1], return_pct: three },
  { months: 6, target: dates[2], date: six == null ? null : dates[2], return_pct: six },
  { months: 12, target: dates[3], date: twelve == null ? null : dates[3], return_pct: twelve },
]

export const SPX_EPISODES = [
  {
    id: 'SPX-2035-07-16', kind: 'correction',
    peak: { date: '2035-07-16', close: 7412.55 }, trough: { date: '2035-09-04', close: 6522.1 },
    depth_pct: -12.01, sessions_down: 35, recovered: null, sessions_to_recover: null, ongoing: true,
    peak_at_history_start: false, below_peak_now_pct: -6.42,
    rally: rally(4.1, null, null, null, ['2035-10-04', '2035-12-04', '2036-03-04', '2036-09-04']),
    leaders: { state: 'not_yet', trough: '2035-09-04', end: null, sessions_so_far: 29, needed: 63, note: NOTE },
  },
  {
    id: 'SPX-2033-02-14', kind: 'bear',
    peak: { date: '2033-02-14', close: 6120.4 }, trough: { date: '2033-06-10', close: 4471.85 },
    depth_pct: -26.93, sessions_down: 81, recovered: '2034-03-21', sessions_to_recover: 194, ongoing: false,
    peak_at_history_start: false, below_peak_now_pct: null,
    rally: rally(8.7, 21.4, 26.2, 33.9, ['2033-07-11', '2033-09-12', '2033-12-12', '2034-06-12']),
    leaders: {
      state: 'ok', trough: '2033-06-10', end: '2033-09-09', priced_at_trough: 2861, priced_both: 2844,
      index_return_pct: 21.4, top: inventedLeaders(21.4), sectors: SECTOR_MEDIANS, no_sector: 71, index: 'SPX', note: NOTE,
    },
  },
  {
    id: 'SPX-2031-04-02', kind: 'correction',
    peak: { date: '2031-04-02', close: 5210.0 }, trough: { date: '2031-05-20', close: 4632.75 },
    depth_pct: -11.08, sessions_down: 33, recovered: '2031-08-13', sessions_to_recover: 60, ongoing: false,
    peak_at_history_start: false, below_peak_now_pct: null,
    rally: rally(5.2, 11.9, -1.3, 9.8, ['2031-06-20', '2031-08-20', '2031-11-20', '2032-05-20']),
    leaders: {
      state: 'thin', trough: '2031-05-20', end: '2031-08-19', priced_at_trough: 61, priced_both: 58,
      index_return_pct: 11.6, top: [], sectors: [], no_sector: 0, index: 'SPX', note: NOTE,
    },
  },
]

export const NDX_EPISODES = [
  {
    id: 'NDX-2034-11-06', kind: 'correction',
    peak: { date: '2034-11-06', close: 25120.3 }, trough: { date: '2034-12-18', close: 22301.9 },
    depth_pct: -11.22, sessions_down: 29, recovered: '2035-02-27', sessions_to_recover: 48, ongoing: false,
    peak_at_history_start: true, below_peak_now_pct: null,
    rally: rally(6.6, 15.3, 19.0, null, ['2035-01-18', '2035-03-18', '2035-06-18', '2035-12-18']),
    leaders: {
      state: 'ok', trough: '2034-12-18', end: '2035-03-21', priced_at_trough: 3010, priced_both: 2996,
      index_return_pct: 15.9, top: inventedLeaders(15.9).slice(0, 5), sectors: SECTOR_MEDIANS.slice(0, 2), no_sector: 0, index: 'NDX', note: NOTE,
    },
  },
]

/** The whole answer at its best, a fresh copy each call (a test may change it). `over` replaces top-level keys. */
export function marketHistoryAnswer(over = {}) {
  return JSON.parse(JSON.stringify(answerShape(over)))
}

function answerShape(over) {
  return {
    status: 'ok',
    built_at: '2035-10-15T22:05:00+00:00',
    built_for: '2035-10-15',
    data_through: '2035-10-15',
    refreshing: false,
    definition: {
      correction_min_pct: 10, bear_min_pct: 20, rally_months: [1, 3, 6, 12], leader_sessions: 63, leaders_top: 25, leaders_min_stocks: 100,
      text: 'A decline counts from a closing high to the lowest close before that high is regained: 10% to 20% is a correction, 20% or more a bear market. A new high starts only once the old one is regained, so a double bottom is one decline. Sessions are the index\'s closing days.',
    },
    index_note: 'The Nasdaq Composite is not in UCT\'s index history; the Nasdaq-100 is the closest index it holds.',
    indexes: {
      SPX: {
        symbol: 'SPX', name: 'S&P 500', state: 'ok', source: "UCT's stored daily closes of the index",
        first: '2030-01-02', last: '2035-10-15', closes: 1460,
        summary: { since: '2030-01-02', corrections: 2, bear_markets: 1, ongoing: 1, recovered: 2, median_depth_pct: -12.01, median_recovery_sessions: 127 },
        episodes: SPX_EPISODES,
      },
      NDX: {
        symbol: 'NDX', name: 'Nasdaq-100', state: 'ok', source: "UCT's stored daily closes of the index",
        first: '2034-11-06', last: '2035-10-15', closes: 240,
        summary: { since: '2034-11-06', corrections: 1, bear_markets: 0, ongoing: 0, recovered: 1, median_depth_pct: -11.22, median_recovery_sessions: 48 },
        episodes: NDX_EPISODES,
      },
    },
    leaders: {
      state: 'ok', source: "UCT's stored daily stock closes (split-adjusted, price only)",
      universe: 'UCT\'s stock universe ($300M market value and up), less the funds it lists',
      symbols: 3512, read: 3488, not_held: 24, store_first: '2030-01-02', sectors_held: true, note: NOTE, seconds: 41.2,
    },
    ...over,
  }
}

/** The first stage: the episodes, with the leaders still being worked out. */
export function firstStageAnswer() {
  const strip = (eps) => eps.map((e) => {
    const out = { ...e }
    delete out.leaders
    return out
  })
  const a = marketHistoryAnswer({ leaders: { state: 'computing', note: NOTE } })
  a.indexes.SPX = { ...a.indexes.SPX, episodes: strip(SPX_EPISODES) }
  a.indexes.NDX = { ...a.indexes.NDX, episodes: strip(NDX_EPISODES) }
  return a
}
