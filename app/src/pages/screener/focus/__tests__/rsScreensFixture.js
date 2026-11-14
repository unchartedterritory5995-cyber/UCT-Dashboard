// The RS screens as the server-to-client contract writes them (CONTRACT-SCREENS.md, 2026-11-14):
// the five starters, the seven hidden ones and sample rows. ONE file on purpose, so the server
// unit's real `GET /api/screener/saved-screens` payload can be diffed against it.
//
// Where the contract names an id, a key, a clause or a label, it is copied here. Where it does
// not (a few option labels, the exit-warning option ids), the value below is a placeholder the
// client never reads by name: the client renders whatever label and id the server sends.

const FLOOR = [
  { key: 'price', op: 'gte', min: 10 },
  { key: 'dollar_vol_30d', op: 'gte', min: 20000000 },
]
// saved_screens.STOCKS_ONLY, appended to every starter by `_stocks_only`.
const STOCKS_ONLY = { key: 'security_type', op: 'not_in', values: ['ETF'] }
const GROUP = 'Relative strength'
const between = (key, min, max) => ({ key, op: 'between', min, max })
const gte = (key, min) => ({ key, op: 'gte', min })

const MIN_RATING = (def, ids) => ({
  id: 'min', label: 'Min RS Rating', keys: ['rs_rank'],
  options: ids.map(n => (n === 'any'
    ? { id: 'any', label: 'Any', ...(def === 'any' ? { default: true } : {}), filters: [] }
    : { id: `r${n}`, label: String(n), ...(def === `r${n}` ? { default: true } : {}), filters: [gte('rs_rank', n)] })),
})

export const TOP_RATING = {
  id: 'starter_rs_top_rating', name: 'Top RS Rating', group: GROUP,
  description: 'Every liquid stock ranked by RS Rating, strongest first, with its exact place',
  spec: {
    filters: [...FLOOR, gte('rs_rating_pos', 1), STOCKS_ONLY],
    sort: { key: 'rs_rating_pos', dir: 'asc' }, view: 'rs_top_rating',
  },
  controls: [
    { id: 'rank_by', label: 'Rank by',
      keys: ['rs_rating_pos', 'rs_pos_1m', 'rs_pos_3m', 'rs_pos_6m', 'rs_pos_12m', 'rs_rating_chg_20', 'pct_vs_sma50'],
      options: [
        { id: 'overall', label: 'Overall', default: true, filters: [gte('rs_rating_pos', 1)], sort: { key: 'rs_rating_pos', dir: 'asc' } },
        { id: 'm1', label: '1M', filters: [gte('rs_pos_1m', 1)], sort: { key: 'rs_pos_1m', dir: 'asc' } },
        { id: 'm3', label: '3M', filters: [gte('rs_pos_3m', 1)], sort: { key: 'rs_pos_3m', dir: 'asc' } },
        { id: 'm6', label: '6M', filters: [gte('rs_pos_6m', 1)], sort: { key: 'rs_pos_6m', dir: 'asc' } },
        { id: 'm12', label: '12M', filters: [gte('rs_pos_12m', 1)], sort: { key: 'rs_pos_12m', dir: 'asc' } },
        { id: 'rising', label: 'Rising fastest',
          filters: [gte('rs_rating_pos', 1), gte('rs_rating_chg_20', 1), { key: 'pct_vs_sma50', op: 'gt', min: 0 }],
          sort: { key: 'rs_rating_chg_20', dir: 'desc', then: { key: 'rs_rating_pos', dir: 'asc' } } },
      ] },
    { id: 'show', label: 'Show', keys: ['rs_rank', 'rs_rating_prev20'],
      options: [
        { id: 'all', label: 'All', default: true, filters: [] },
        { id: 'r90', label: '90 and up', filters: [gte('rs_rank', 90)] },
        { id: 'new90', label: 'New to 90+', filters: [gte('rs_rank', 90), { key: 'rs_rating_prev20', op: 'lt', max: 90 }] },
      ] },
  ],
  row: { place: 'rs_rating_pos', caption: ['setup', 'moving'], tags: ['flag', 'new'] },
}

export const NEW_HIGHS = {
  id: 'starter_rs_new_high', name: 'RS New Highs', group: GROUP,
  description: 'Stocks whose RS line (price against SPY) hit a 52-week high this week',
  spec: {
    filters: [...FLOOR, { key: 'pct_vs_sma200', op: 'gt', min: 0 }, between('rs_nh_bars_ago', 0, 4), STOCKS_ONLY],
    sort: { key: 'rs_nh_bars_ago', dir: 'asc', then: { key: 'rs_rating_score', dir: 'desc' } }, view: 'rs_new_highs',
  },
  controls: [
    { id: 'when', label: 'When', keys: ['rs_nh_bars_ago'],
      options: [
        { id: 'today', label: 'Today', filters: [between('rs_nh_bars_ago', 0, 0)] },
        { id: 'week', label: 'This week', default: true, filters: [between('rs_nh_bars_ago', 0, 4)] },
        { id: 'month', label: 'This month', filters: [between('rs_nh_bars_ago', 0, 20)] },
      ] },
    MIN_RATING('any', ['any', 70, 80, 90]),
    { id: 'down', label: 'Market', keys: ['rs_nh_red_bars_ago'],
      options: [
        { id: 'all', label: 'Any day', default: true, filters: [] },
        { id: 'down', label: 'Down days only', filters: [between('rs_nh_red_bars_ago', 0, 9)] },
      ] },
  ],
  row: { place: null, caption: ['rs_high_age', 'group'], tags: ['before_price', 'down_day', 'flag', 'new'] },
}

export const BEFORE_PRICE = {
  id: 'starter_rs_nh_before_price', name: 'RS New High Before Price', group: GROUP,
  description: 'RS line at a 52-week high while price is still below its own high. Often an early sign',
  aliases: ['RSNHBP', 'RS new high before price', 'blue dot'],
  spec: {
    filters: [...FLOOR, { key: 'pct_vs_sma200', op: 'gt', min: 0 }, between('rs_nhbp_age', 0, 4),
      between('px_below_high_pct', -25, -3), STOCKS_ONLY],
    sort: { key: 'px_below_high_pct', dir: 'desc', then: { key: 'rs_rating_score', dir: 'desc' } }, view: 'rs_before_price',
  },
  controls: [
    { id: 'when', label: 'When', keys: ['rs_nhbp_age'],
      options: [
        { id: 'today', label: 'Today', filters: [between('rs_nhbp_age', 0, 0)] },
        { id: 'week', label: 'This week', default: true, filters: [between('rs_nhbp_age', 0, 4)] },
        { id: 'month', label: 'This month', filters: [between('rs_nhbp_age', 0, 20)] },
      ] },
    { id: 'below', label: 'Below its high by', keys: ['px_below_high_pct'],
      options: [
        { id: 'p3', label: '3%', default: true, filters: [between('px_below_high_pct', -25, -3)] },
        { id: 'p5', label: '5%', filters: [between('px_below_high_pct', -25, -5)] },
        { id: 'p10', label: '10%', filters: [between('px_below_high_pct', -25, -10)] },
      ] },
    MIN_RATING('any', ['any', 70, 80]),
  ],
  row: { place: null, caption: ['below_high', 'group'], tags: ['down_day', 'flag', 'new'] },
  empty: {
    text: 'No RS line made a 52-week high ahead of price this week. That is normal in a weak market.',
    actions: [
      { label: 'Show this month', control: 'when', option: 'month' },
      { label: 'Open RS New Highs', open: 'starter_rs_new_high' },
    ],
  },
}

export const LEADERS = {
  id: 'starter_rs_leaders', name: 'UCT RS Leaders', group: GROUP,
  description: 'The strongest liquid stocks in real uptrends, each labelled extended or near a buy point',
  spec: {
    filters: [...FLOOR, gte('adr_pct', 3), gte('market_cap', 300000000), gte('rs_rank', 80),
      { key: 'pct_vs_sma200', op: 'gt', min: 0 }, { key: 'sma200_rising', op: 'eq', value: 1 },
      gte('dist_52w_high_pct', -25), { key: 'rs_line_above_ma', op: 'eq', value: 1 }, STOCKS_ONLY],
    rank: { criteria: [{ key: 'rs_rating_score', weight: 1 }], top_n: 50 }, view: 'rs_leaders',
  },
  controls: [
    { id: 'show', label: 'Show', keys: ['rs_near_buy', 'rs_setup'],
      options: [
        { id: 'all', label: 'All', default: true, filters: [] },
        { id: 'near', label: 'Near a buy point', filters: [{ key: 'rs_near_buy', op: 'eq', value: 1 }] },
        { id: 'noext', label: 'Hide extended', filters: [{ key: 'rs_setup', op: 'not_in', values: ['extended', 'below_50'] }] },
      ] },
    MIN_RATING('r80', [80, 85, 90, 95]),
  ],
  row: { place: 'index', caption: ['setup', 'group'], tags: ['flag', 'new'] },
}

export const EXIT_WARNINGS = {
  id: 'starter_rs_exit_warning_5', name: 'RS exit warnings', group: GROUP,
  description: 'RS line just broke down. A prompt to review a position, not an order to sell',
  spec: {
    filters: [between('rs_exit_bars_ago', 0, 4), ...FLOOR, STOCKS_ONLY],
    sort: { key: 'rs_exit_bars_ago', dir: 'asc' }, view: 'relative_strength',
  },
  controls: [
    { id: 'type', label: 'Type', keys: ['rs_exit_last'],
      options: [
        { id: 'any', label: 'Any', default: true, filters: [] },
        ...['Quick Break', 'Quicksand', 'Grateful Dead Break'].map(n => (
          { id: n.toLowerCase().replace(/\s+/g, '_'), label: n, filters: [{ key: 'rs_exit_last', op: 'eq', value: n }] })),
      ] },
  ],
  row: { place: null, caption: ['group'], tags: ['new'] },
}

// The contract's order inside the "Relative strength" group.
export const RS_STARTERS = [TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS]

// `hidden: true` while the flag is on: out of the picker's groups and search, still resolvable by id.
export const HIDDEN_IDS = ['starter_rs_nh_red_day', 'starter_rs_green_on_red', 'starter_rs_cross_up_21ema',
  'starter_rs_mansfield_positive', 'starter_rs_leaders_equal_weight', 'starter_rs_quicksand_5', 'starter_momentum_leaders']
const HIDDEN_NAMES = {
  starter_rs_nh_red_day: 'RS new highs on a red day',
  starter_rs_green_on_red: 'Up on down days',
  starter_rs_cross_up_21ema: 'RS line crossed above its 21-day avg',
  starter_rs_mansfield_positive: 'Mansfield RS positive',
  starter_rs_leaders_equal_weight: 'RS leaders vs equal weight',
  starter_rs_quicksand_5: 'Quicksand in the last 5 sessions',
  starter_momentum_leaders: 'Leaders (RS ≥ 90)',
}
export const HIDDEN_STARTERS = HIDDEN_IDS.map(id => ({
  id, name: HIDDEN_NAMES[id], group: id === 'starter_momentum_leaders' ? 'Momentum leaders' : GROUP, hidden: true,
  description: 'Kept for members who pinned it',
  spec: { filters: [gte('rs_rank', id === 'starter_momentum_leaders' ? 90 : 70), STOCKS_ONLY], sort: { key: 'rs_rank', dir: 'desc' } },
}))

// Starters that carry NONE of the new fields: today's product.
export const PLAIN_STARTERS = [
  { id: 'starter_power_play', name: 'Power plays', group: 'Momentum leaders', description: 'Up big on volume',
    spec: { filters: [gte('rs_rank', 85), STOCKS_ONLY], sort: { key: 'rs_rank', dir: 'desc' } } },
  { id: 'starter_tight_base', name: 'Tight bases', group: 'Bases & chart patterns', description: 'Tight closes',
    spec: { filters: [gte('rs_rank', 75), STOCKS_ONLY], sort: { key: 'rs_rank', dir: 'desc' } } },
  { id: 'starter_three_weeks_tight', name: '3 weeks tight', group: 'Bases & chart patterns', description: 'Three tight weekly closes',
    spec: { filters: [gte('rs_rank', 65), STOCKS_ONLY], sort: { key: 'rs_rank', dir: 'desc' } } },
]

// The whole starters payload with the flag on.
export const STARTERS_ON = [...RS_STARTERS, ...HIDDEN_STARTERS, ...PLAIN_STARTERS]

// Sample rows carrying the contract's section 1 columns. Values chosen so each caption part and
// each tag rule has a row that fires it and a row that does not.
const row = (ticker, over = {}) => ({
  ticker, company: `${ticker} Corp`, price: 100, chg_pct_1d: 1.2, base_render: 'Flat Base', vol_ratio: 1,
  industry: 'Semiconductors', sector: 'Technology', rs_rank: 97, rs_rating_session: '2026-11-13',
  rs_rating_score: 88.4, rs_rating_pos: 14, rs_rating_pos_n: 1931, rs_rating_pos_prev20: 41, rs_rating_chg_5: 3,
  rs_setup: 'at_pivot', rs_tight: 0, rs_flag: null, rs_near_buy: 1,
  rs_nh_bars_ago: 0, rs_nh_red_bars_ago: null, rs_nhbp_age: null, px_below_high_pct: -0.2,
  ...over,
})
export const RS_ROWS = [
  row('NVDA'),
  row('MU', { rs_rank: 91, rs_rating_pos: 120, rs_rating_pos_prev20: 120, rs_rating_chg_5: -4, rs_setup: 'extended',
    rs_nh_bars_ago: 3, rs_nh_red_bars_ago: 3, px_below_high_pct: -6.4, rs_nhbp_age: 3, sector: 'Technology' }),
  row('LLY', { rs_rank: 84, rs_rating_pos: 300, rs_rating_pos_prev20: null, rs_rating_chg_5: 0, rs_setup: 'uptrend', rs_tight: 1,
    rs_nh_bars_ago: 1, px_below_high_pct: -12, industry: 'Drug makers', sector: 'Healthcare', rs_flag: 'new_issue' }),
  row('XOM', { rs_rank: 80, rs_rating_pos: 380, rs_rating_pos_prev20: null, rs_rating_chg_5: null, rs_setup: 'pullback_21',
    rs_nh_bars_ago: null, px_below_high_pct: null, industry: 'Oil and gas', sector: 'Energy', rs_flag: 'buyout_pending' }),
  row('AMD', { rs_rank: 89, rs_rating_pos: 200, rs_setup: 'below_50', rs_tight: 1, rs_nh_bars_ago: 7, px_below_high_pct: -3,
    rs_nhbp_age: 2, rs_flag: 'one_day_move' }),
]
