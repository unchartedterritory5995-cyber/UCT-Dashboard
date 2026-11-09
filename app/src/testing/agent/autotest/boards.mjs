// UCT Agent AUTOTEST: the fixture boards, one description for every mode. Synthetic only: no real market value.
//
// `roles` names each chart the way a request does: `position` is what the Agent's context says, `id` the widget id.
// SIMULATED mounts `sim` (the fixture board in jsdom). BROWSER modes open `browser` on agent-harness.html.
const chart = (id, color, x, y, w, h, tf = 'D') => ({ id, type: 'chart', color, x, y, w, h, opts: { tf } })
const WATCH = (x = 18, y = 0, h = 20) => ({ id: 'w-watch', type: 'watchlist', color: 'A', x, y, w: 6, h, opts: {} })
const prefsOf = (widgets, groups) => ({ charts_workspace_layout: JSON.stringify({ version: 1, cols: 24, widgets }), charts_workspace_groups: JSON.stringify(groups) })
const GROUPS = { A: 'SPY', B: 'AAPL', C: 'AMD', D: 'MSFT' }
const LISTS = [{ id: 'm1', name: 'Momentum', symbols: ['NVDA', 'TSLA', 'META', 'AAPL'] }, { id: 's1', name: 'Swing', symbols: ['MSFT'] }, { id: 'l1', name: 'Long Term', symbols: [] }]

const OSC = [{ value: 'above', label: 'Above threshold', needs_threshold: true }, { value: 'below', label: 'Below threshold', needs_threshold: true }, { value: 'cross_above', label: 'Crosses above', needs_threshold: true }, { value: 'cross_below', label: 'Crosses below', needs_threshold: true }]
const XC = [{ value: 'cross_above', label: 'Fast MA crosses above slow MA', needs_threshold: false }, { value: 'cross_below', label: 'Fast MA crosses below slow MA', needs_threshold: false }]
export const IA_CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, plots: [{ value: 'rsi', label: 'RSI', conditions: OSC, default_threshold: 70, inputs: { period: 14 }, instance_label: 'RSI (14)' }] },
  { indicator: 'ma_cross', label: 'MA Cross', conditions: XC, default_threshold: null, plots: [{ value: 'ma_cross', label: 'MA Cross', conditions: XC, default_threshold: null, inputs: { ma_type: 'ema', fast: 9, slow: 20 }, instance_defs: ['movingAverage'], instance_label: 'EMA(9) vs EMA(20)' }] },
]

const two = () => [chart('w-chart-a', 'A', 0, 0, 9, 20), chart('w-chart-b', 'B', 9, 0, 9, 20), WATCH()]
const two5 = () => [chart('w-chart-a', 'A', 0, 0, 9, 20, '5'), chart('w-chart-b', 'B', 9, 0, 9, 20, '5'), WATCH()]
const four = () => [chart('c-tl', 'A', 0, 0, 9, 10), chart('c-tr', 'B', 9, 0, 9, 10), chart('c-bl', 'C', 0, 10, 9, 10), chart('c-br', 'D', 9, 10, 9, 10), WATCH()]
const three = () => [chart('c-l', 'A', 0, 0, 6, 20), chart('c-m', 'B', 6, 0, 6, 20), chart('c-r', 'C', 12, 0, 6, 20), WATCH()]
const linked = () => [chart('c-l', 'A', 0, 0, 6, 20), chart('c-m', 'A', 6, 0, 6, 20), chart('c-r', 'B', 12, 0, 6, 20), WATCH()]
const tfmix = () => [chart('c-tl', 'A', 0, 0, 9, 10, 'D'), chart('c-tr', 'B', 9, 0, 9, 10, 'W'), chart('c-bl', 'C', 0, 10, 9, 10, '5'), chart('c-br', 'D', 9, 10, 9, 10, 'D'), WATCH()]
// a chart beside the widgets whose own controls the Agent sets by name (unseen batch 3). Fixture board: the widgets mount with no
// backend behind them, so a control whose choices come from the widget's data ("door" rows) may have none here
const W = (id, type, x, y) => ({ id, type, color: 'A', x, y, w: 8, h: 4, opts: {} })
const widgets = () => [chart('w-chart-a', 'A', 0, 0, 8, 20), W('w-flow', 'optionsflow', 8, 0), W('w-themes', 'themes', 16, 0), W('w-breadth', 'breadth', 8, 4), W('w-idx', 'indexes', 16, 4),
  W('w-term', 'calendar', 8, 8), W('w-nhnl', 'nhnl', 16, 8), W('w-vol', 'volumescan', 8, 12), W('w-map', 'scatter', 16, 12), W('w-news', 'tradeExchangeNews', 8, 16)]
// 3 x 2: a middle column, so "the middle one" names two charts and "the one below this" is exact. Link colours E-H are dark (an
// auth flag), so the bottom middle and bottom right share A and B with the top row: SPY and QQQ name two charts each here
const six = () => [chart('c-tl', 'A', 0, 0, 6, 10), chart('c-tm', 'B', 6, 0, 6, 10), chart('c-tr', 'C', 12, 0, 6, 10), chart('c-bl', 'D', 0, 10, 6, 10), chart('c-bm', 'A', 6, 10, 6, 10), chart('c-br', 'B', 12, 10, 6, 10), WATCH()]
const one = () => [chart('w-chart-a', 'A', 0, 0, 18, 20), WATCH()]
const scan = () => [chart('w-chart-a', 'A', 0, 0, 12, 20), { id: 'w-scan', type: 'scanner', color: 'A', x: 12, y: 0, w: 12, h: 20, opts: {} }]

export const BOARDS = {
  TWO: {
    roles: { A: { id: 'w-chart-a', position: 'left', sym: 'SPY' }, B: { id: 'w-chart-b', position: 'right', sym: 'AAPL' } },
    browser: { prefs: prefsOf(two(), GROUPS), iaCatalog: IA_CATALOG },
    sim: { widgets: two, groups: GROUPS, extra: { watchlists: LISTS, drawings: true, indicatorAlerts: true, timeNav: true, prefs: true } },
  },
  // both charts on 5 minutes: the session toggle on daily and above works only outside regular hours, so it would depend on the clock
  TWO5: {
    roles: { A: { id: 'w-chart-a', position: 'left', sym: 'SPY' }, B: { id: 'w-chart-b', position: 'right', sym: 'AAPL' } },
    browser: { prefs: prefsOf(two5(), GROUPS) },
    sim: { widgets: two5, groups: GROUPS, extra: { watchlists: LISTS, drawings: true } },
  },
  FOUR: {
    roles: { TL: { id: 'c-tl', position: 'top-left', sym: 'SPY' }, TR: { id: 'c-tr', position: 'top-right', sym: 'QQQ' }, BL: { id: 'c-bl', position: 'bottom-left', sym: 'NVDA' }, BR: { id: 'c-br', position: 'bottom-right', sym: 'TSLA' } },
    browser: { prefs: prefsOf(four(), { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA' }), iaCatalog: IA_CATALOG },
    sim: { widgets: four, groups: { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA' }, extra: { watchlists: LISTS, drawings: true, indicatorAlerts: true } },
  },
  // three across; the middle one has no left or right. These four are the selection oracle's boards: BROWSER modes only
  THREE: {
    roles: { L: { id: 'c-l', position: 'left', sym: 'SPY' }, M: { id: 'c-m', position: 'middle', sym: 'QQQ' }, R: { id: 'c-r', position: 'right', sym: 'NVDA' } },
    browser: { prefs: prefsOf(three(), { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA' }), iaCatalog: IA_CATALOG },
    sim: null,
  },
  // two charts in ONE link colour: a symbol reaches both, a timeframe only one
  LINKED: {
    roles: { L: { id: 'c-l', position: 'left', sym: 'SPY' }, M: { id: 'c-m', position: 'middle', sym: 'SPY' }, R: { id: 'c-r', position: 'right', sym: 'QQQ' } },
    browser: { prefs: prefsOf(linked(), { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA' }) },
    sim: null,
  },
  // 2x2 with mixed timeframes: "the weekly chart" and "the 5 minute chart" name exactly one, "the daily chart" names two
  TFMIX: {
    roles: { TL: { id: 'c-tl', position: 'top-left', sym: 'SPY' }, TR: { id: 'c-tr', position: 'top-right', sym: 'QQQ' }, BL: { id: 'c-bl', position: 'bottom-left', sym: 'NVDA' }, BR: { id: 'c-br', position: 'bottom-right', sym: 'TSLA' } },
    browser: { prefs: prefsOf(tfmix(), { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA' }) },
    sim: null,
  },
  // 2x2 where two charts in different colours show the same symbol: a symbol does not name a chart here
  TWIN: {
    roles: { TL: { id: 'c-tl', position: 'top-left', sym: 'SPY' }, TR: { id: 'c-tr', position: 'top-right', sym: 'NVDA' }, BL: { id: 'c-bl', position: 'bottom-left', sym: 'NVDA' }, BR: { id: 'c-br', position: 'bottom-right', sym: 'TSLA' } },
    browser: { prefs: prefsOf(four(), { A: 'SPY', B: 'NVDA', C: 'NVDA', D: 'TSLA' }) },
    sim: null,
  },
  WIDGETS: {
    roles: { A: { id: 'w-chart-a', position: null, sym: 'SPY' } },
    // the widgets load lazily: a request is typed only once each one with its own state has published its door. The Market Map's
    // axis choices are its metric catalog, served here through its own route with synthetic labels (no market values)
    browser: { prefs: prefsOf(widgets(), GROUPS), waitDoors: ['w-themes', 'w-idx', 'w-term', 'w-nhnl', 'w-map', 'w-vol', 'w-breadth'],
      routes: [{ match: '^GET /api/scatter/metrics', body: { metrics: [{ key: 'rvol', label: 'RVOL', group: 'Volume', live: true }, { key: 'chg_today', label: 'Change today', group: 'Price', live: true }, { key: 'mcap', label: 'Market cap', group: 'Size', live: false }] } }] },
    sim: null,
  },
  SIX: {
    roles: { TL: { id: 'c-tl', position: 'top-left', sym: 'SPY' }, TM: { id: 'c-tm', position: 'top-middle', sym: 'QQQ' }, TR: { id: 'c-tr', position: 'top-right', sym: 'NVDA' },
      BL: { id: 'c-bl', position: 'bottom-left', sym: 'TSLA' }, BM: { id: 'c-bm', position: 'bottom-middle', sym: 'SPY' }, BR: { id: 'c-br', position: 'bottom-right', sym: 'QQQ' } },
    browser: { prefs: prefsOf(six(), { A: 'SPY', B: 'QQQ', C: 'NVDA', D: 'TSLA' }), iaCatalog: IA_CATALOG },
    sim: null,
  },
  ONE: {
    roles: { A: { id: 'w-chart-a', position: null, sym: 'SPY' } },
    browser: { query: 'charts=1', iaCatalog: IA_CATALOG },
    sim: { widgets: one, groups: GROUPS, extra: { watchlists: LISTS, drawings: true, indicatorAlerts: true } },
  },
  GAP: {
    roles: { A: { id: 'w-chart-a', position: null, sym: 'SPY' } },
    browser: { query: 'board=gap' },
    sim: { widgets: () => [chart('w-chart-a', 'A', 0, 0, 12, 20)], groups: GROUPS, extra: { watchlists: LISTS } },
  },
  WL: {
    roles: { A: { id: 'w-chart-a', position: null, sym: 'NVDA' } },
    browser: { query: 'board=wl', prefs: { charts_workspace_groups: JSON.stringify({ A: 'NVDA', B: 'AAPL', C: 'AMD', D: 'MSFT' }) } },
    sim: null,        // the real Watchlist widget is not in jsdom (its LISTVIEW board is a stand-in): BROWSER modes only
  },
  LAYOUTS: {
    roles: { A: { id: 'w-chart-a', position: 'left', sym: 'SPY' }, B: { id: 'w-chart-b', position: 'right', sym: 'NVDA' } },
    browser: { query: 'charts=2&layouts=1' },
    sim: null,        // the fixture library's ids differ from the browser harness: BROWSER modes only
  },
  SCAN: {
    roles: { A: { id: 'w-chart-a', position: null, sym: 'SPY' } },
    browser: { prefs: prefsOf(scan(), GROUPS) },
    sim: null,        // the scanner widget and its scan store are real only in a browser
  },
  MC: {
    roles: { A: { id: 'g0', sym: 'NVDA', position: null, word: 'top-left' }, B: { id: 'g1', sym: 'AMD', position: null, word: 'top-right' }, C: { id: 'g2', sym: 'TSLA', position: null, word: 'bottom-left' }, D: { id: 'g3', sym: null, position: null, word: 'bottom-right' } },
    browser: { query: 'multichart=1' },
    sim: null,        // Multi Chart's cells are real only in a browser
  },
}

export const roleOf = (boardName, role) => BOARDS[boardName]?.roles?.[role]
