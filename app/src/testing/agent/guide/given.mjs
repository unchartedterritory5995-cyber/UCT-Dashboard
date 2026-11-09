// ⭐ GIVEN — the state a teaching case needs before its words are typed, declared, then built by ONE mechanism:
//
//   board      what the workspace holds (the board pref the app reads: its widgets, a chart's own tabs, a widget's tabs)
//   prefs      any other preference the app reads on load (Multi Chart's `multichart_state`)
//   drawing    a drawing of that type on the chart, added through the app's own drawings store, on the chart's own bars
//   alerts     price alerts, created through the app's own (here simulated) /api/watchlist-alerts route
//   themes     Theme Tracker data, answered on the widget's own route (/api/theme-performance) through the rig's fixtures
//   news       News & Catalysts events, on its own route (/api/news-catalysts/<sym>), shaped as its capture test reads them
//   breadth    Breadth history and its live row, on the widget's own routes (/api/breadth-monitor, …/live)
//   savedGrids a saved Multi Chart grid in the layout library (the harness's own ?multichart fixture)
//   indicatorAlerts  indicator alerts on the chart's symbol, through the (simulated) /api/indicator-alerts route
//   versions   the server's version store switched on (a layout's Version history)
//   chartSettings  the chart's own settings pref (custom intervals, compared symbols)
//   board 'surge' a Volume Surge widget on one of the member's own lists
//   board 'dock'  the chart with Company Info added and open (its company panel)
//   teFeed     the TE News feed loaded, on its own /recent route
//   calendar   a calendar day with reporters and economic events, on the widget's own route
//   scan       a Scanner widget with a preset scan open (its opts.scanKey), the scan's results on its own route
//
// Nothing pokes the DOM: everything is something the app itself reads or writes. `GIVEN` says which cases get what, by the
// walkthrough they reach (a rule) or by id (an override). A case with no given runs on the plain board.

const chart = (id, color, x, y, w, h, opts = {}) => ({ id, type: 'chart', color, x, y, w, h, opts: { tf: 'D', ...opts } })
const GROUPS = { A: 'SPY', B: 'AAPL', C: 'AMD', D: 'MSFT' }
const SCAN = { key: 'highest-volume-1y', name: 'Highest Volume In 1-Year' }
// pages/charts/CompareSymbolsPanel.jsx: { sym, color, enabled, group? } (a group is its name on each of its symbols)
const COMPARED = [{ sym: 'AMD', color: '#f5a623', enabled: true }, { sym: 'NVDA', color: '#4fc3f7', enabled: true, group: 'Semis' }, { sym: 'AVGO', color: '#81c784', enabled: true, group: 'Semis' }]
const watch = (extra = {}) => ({ id: 'w-watch', type: 'watchlist', color: 'A', x: 16, y: 0, w: 8, h: 20, opts: {}, ...extra })
// one chart and one watchlist fill the board: a widget the walkthrough adds goes through the real Place step
const PLAIN = [chart('w-chart-a', 'A', 0, 0, 16, 20), watch()]
const BOARDS = {
  plain: PLAIN,
  // a chart with a second tab of its own, and a watchlist with a second (News) tab: pages/charts/chartTabs.js, widgetTabs.js
  tabs: [chart('w-chart-a', 'A', 0, 0, 16, 20, { chartTabs: [{ id: 'ct-2', tf: 'W' }], activeChartTab: 0 }), watch({ wtabs: [{ id: 'wt-2', type: 'news', opts: {} }], activeWtab: 0 })],
  // the chart with Company Info added and its panel open: pages/charts/widgets/chartDock.js normalizeDock (opts.dock)
  dock: [chart('w-chart-a', 'A', 0, 0, 16, 20, { dock: { company: true, open: true, tab: 'overview' } }), watch()],
  // a Volume Surge widget watching one of the member's own lists (VolumeScanWidget.jsx: opts.volActive; the lists are the
  // account's own volume_scan_lists pref)
  surge: [chart('w-chart-a', 'A', 0, 0, 12, 20), watch({ x: 12, w: 6 }), { id: 'w-surge', type: 'volumescan', color: 'A', x: 18, y: 0, w: 6, h: 20, opts: { volActive: 'teach-semis' } }],
  // a Scanner widget with a preset scan already open: pages/charts/widgets/ScannerWidget.jsx remembers it in opts.scanKey
  scan: [chart('w-chart-a', 'A', 0, 0, 12, 20), watch({ x: 12, w: 6 }), { id: 'w-scan', type: 'scanner', color: 'A', x: 18, y: 0, w: 6, h: 20, opts: { scanKey: SCAN.key, scanName: SCAN.name } }],
}
// pages/charts/grid/gridLayouts.js makeDefaultState: the grid as the app saves it
const MULTI = { mode: 'grid', layout: '2x2', cells: [['g1', 'SPY'], ['g2', 'QQQ'], ['g3', 'NVDA'], ['g4', 'TSLA']].map(([id, sym]) => ({ id, sym, tf: 'D' })), syncCrosshair: false, syncTimeRange: false, groupsMode: false, group: null }

// which drawing a case's words or walkthrough need (a tool the row's control lives on)
function drawingFor(c) {
  const s = `${c.say} ${c.title || ''}`.toLowerCase()
  if (/\bfib/.test(s)) return 'fib'
  if (/\b(box|rect|fill|shade)/.test(s)) return 'rect'
  if (/\bmeasure|show bars\b/.test(s)) return 'measure'
  if (/\btext|note|bold|italic|font/.test(s)) return 'text'
  if (/horizontal|flatten/.test(s)) return 'trendline'   // Make horizontal is on a SLOPED line's menu
  return 'horizontal'
}
const NEEDS_DRAWING = (c) => ['drawingEdit', 'hideDrawings'].includes(c.feature) || /drawing’s|Clearing all drawings/.test(c.title || '')
const NEEDS_ALERTS = (c) => /^(Seeing your alerts|Deleting an alert|Sending Alerts to the Journal|A price alert from the list)$/.test(c.title || '') || c.id === 'C3-099'

export function givenFor(c) {
  const g = {}
  if (NEEDS_DRAWING(c)) g.drawing = drawingFor(c)
  if (NEEDS_ALERTS(c)) g.alerts = [{ sym: 'SPY', target_price: 200, direction: 'above' }, { sym: 'NVDA', target_price: 150, direction: 'below' }]
  // every Multi Chart row: the grid's own flyout shows its saved-grid controls only while the board IS a grid
  if (/^(Pausing|Deleting|Seeing your) an? ?indicator alerts?$|indicator alert/i.test(c.title || '') && c.feature === 'alertAction') g.indicatorAlerts = [{ sym: 'SPY', indicator: 'rsi', condition: 'crosses_above', threshold: 70, tf: 'D' }]
  if (/Theme Tracker|Opening a theme|Theme presets|Ranking themes|Searching themes/.test(c.title || '')) g.themes = true
  if (/Sending News & Catalysts|Filtering catalysts|symbol’s headlines|A headline on the chart/.test(c.title || '')) g.news = true
  if (/Sending Breadth|breadth tiles|Adding or removing a reading/.test(c.title || '')) g.breadth = true
  if (/^(Opening a saved grid|Deleting a saved grid)$/.test(c.title || '')) g.savedGrids = true
  // a layout's Version history shows only while the server's version store says it is on (components/artifactHistory
  // ArtifactHistory.jsx probeArtifactVersions: GET /api/artifact-versions/status → { enabled })
  if (/A layout’s version history/.test(c.title || '')) g.versions = true
  // a calendar day with reporters and economic events (pages/charts/widgets/CalendarWidget.jsx reads data.days[day])
  if (/^(Loading a stock from the earnings list|Filtering economic events)$/.test(c.title || '')) g.calendar = true
  // a control of the chart's company panel: the panel is on the chart (Company Info added, open)
  if (c.feature === 'dockAction') g.board = 'dock'
  // one of the member's own Volume Surge lists, open in the widget
  if (/Volume Surge list/.test(c.title || '')) { g.board = 'surge'; g.prefs = { ...(g.prefs || {}), volume_scan_lists: JSON.stringify([{ id: 'teach-semis', name: 'Semis', syms: ['NVDA', 'AMD'] }]) } }
  // the TE News feed loaded (lib/tradeExchangeNewsStreamManager.js: GET /recent → { items, epoch, last_seq, first_seq })
  if (/^(Saving a headline|A headline’s actions: \w+|Back to the live feed)$/.test(c.title || '')) g.teFeed = true
  // the chart's own settings pref (components/chart/chartDefaults.js parses a partial chart_settings over its defaults):
  // a custom interval to delete, and symbols (one a group's) the Compare panel lists
  if (/^Deleting a custom timeframe$/.test(c.title || '')) g.chartSettings = { header: { customTimeframes: ['45'] } }
  // a row that shows only on a bar chart (Thin bars: the chart type is Bars)
  if (/^Changing Thin bars$/.test(c.title || '')) g.chartSettings = { chartType: 'bars' }
  if (c.feature === 'compareAction' && !/^Comparing a whole group$/.test(c.title || '')) g.chartSettings = { comparisonSymbols: COMPARED }
  // a control that shows on a scan's results, not on the list of scans (picking and searching a scan are on that list)
  if (/^(Reading a scan’s conditions|Sorting a scan|Choosing a scan’s columns|Sending a scan to the Journal|Refreshing a scan|Back to the list of scans)$/.test(c.title || '')) { g.board = 'scan'; g.scan = true }
  if (c.feature === 'gridAction') g.prefs = { multichart_state: JSON.stringify(MULTI) }
  // a grid chart that carries settings of its own (GridChartCell.jsx: `cell.settings` forks it; Reset shows then)
  if (c.feature === 'gridAction' && /^Resetting a chart in the grid$/.test(c.title || '')) g.prefs = { multichart_state: JSON.stringify({ ...MULTI, cells: MULTI.cells.map(x => ({ ...x, settings: { chartType: 'line' } })) }) }
  // a grid filled from a group: Multi Chart's flyout shows Prev/Next, Refresh group and Exit Groups only while one is set
  // (pages/charts/grid/MultiChartMenu.jsx `mc.state.group`; gridLayouts.js sanitizeGroup keeps id, by, n, name)
  if (c.feature === 'gridAction' && /^(Stepping through groups|Refreshing a group|Leaving Groups mode)$/.test(c.title || '')) g.prefs = { multichart_state: JSON.stringify({ ...MULTI, groupsMode: true, group: { id: 'semiconductors', by: 'today', n: 4, name: 'Semiconductors' } }) }
  if (c.feature === 'tabAction' || /tab’s link colour|Renaming a (chart|widget) tab/.test(c.title || '')) g.board = 'tabs'
  // a per-browser switch the case states itself (a release flag the app reads from localStorage, e.g. widgets/captureRelease.js)
  if (c.ls) g.ls = c.ls
  g.setup = setupScript(g)
  if (!g.setup) delete g.setup
  return g
}

// the Theme Tracker's own response shape (pages/ThemeTrackerPage.jsx, captures/themesCapture.js groupReturn)
const PERIODS = ['1d', '1w', '1m', '3m', '1y', 'ytd', '1D', '1W', '1M', '3M', '1Y', 'YTD']
const ret = (v) => Object.fromEntries(PERIODS.map(k => [k, v]))
const THEMES = { themes: [
  { name: 'Semiconductors', ticker: 'SMH', theme_id: 101, sector: 'Technology', group_return: ret(2.4), holdings: [{ sym: 'NVDA', name: 'NVIDIA', returns: ret(3.1) }, { sym: 'AMD', name: 'AMD', returns: ret(1.7) }] },
  { name: 'Software', ticker: 'IGV', theme_id: 102, sector: 'Technology', group_return: ret(-0.8), holdings: [{ sym: 'MSFT', name: 'Microsoft', returns: ret(-0.8) }] },
] }
// three headlines in the feed's own item shape (pages/charts/widgets/TradeExchangeNewsReleaseLink.test.jsx `base`), newest first
const TE_ITEMS = () => [
  { seq: 3, id: 'teach-3', source: 'TX-Breaking', content: 'NVDA - Nvidia raises full-year guidance', received_at_ms: Date.now() - 60000, category: 'Earnings', tickers: ['NVDA'], mentions: [] },
  { seq: 2, id: 'teach-2', source: 'TX-Breaking', content: 'AMD - AMD announces new data-center chip', received_at_ms: Date.now() - 120000, category: 'Company News', tickers: ['AMD'], mentions: [] },
  { seq: 1, id: 'teach-1', source: 'TX-Macro', content: 'US payrolls beat estimates', received_at_ms: Date.now() - 180000, category: 'Macro', tickers: [], mentions: [] },
]
// every day of the last two weeks (the widget opens on the last session day, in New York): two reporters before the open, one
// after, and a high-impact release, in the route's own shape (sym, eps_est; event, time, impact)
function CALENDAR_DAYS() {
  const days = {}
  for (let i = 0; i < 15; i++) {
    const d = new Date(Date.now() - i * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    days[d] = { bmo: [{ sym: 'NVDA', eps_est: 0.75 }, { sym: 'AMD', eps_est: 0.92 }], amc: [{ sym: 'MSFT', eps_est: 3.1 }], tbd: [],
      econ: [{ time: '08:30', event: 'Nonfarm Payrolls', impact: 'high', estimate: '150K', prior: '142K' }, { time: '10:00', event: 'ISM Services', impact: 'medium' }], fed: [] }
  }
  return days
}
/** The rig's fixture routes a given needs (lib.mjs: matched on "METHOD /path" before the harness answers). */
export function fixturesFor(g) {
  const routes = []
  if (g.themes) routes.push({ match: '^GET /api/theme-performance', body: THEMES })
  if (g.teFeed) routes.push({ match: '^GET /api/trade-exchange-news/recent', body: { items: TE_ITEMS(), epoch: 'teach', last_seq: 3, first_seq: 1, tickers_provisional: false } })
  if (g.calendar) routes.push({ match: '^GET /api/calendar[?]week=', body: { days: CALENDAR_DAYS() } })
  if (g.versions) routes.push({ match: '^GET /api/artifact-versions/status', body: { enabled: true } })
  // pages/charts/widgets/ScannerResults.jsx: { as_of, results: [{ sym }] } from the preset's own route (SCAN_ENDPOINTS)
  if (g.scan) routes.push({ match: '^GET /api/scans/' + SCAN.key, body: { as_of: '2026-11-07T15:00:00-05:00', results: [{ sym: 'NVDA' }, { sym: 'AMD' }, { sym: 'MSFT' }] } })
  // hooks/useThemeSets.js: the preset picker shows only when the server says sets are on (C3-174)
  if (g.themes) routes.push({ match: '^GET /api/theme-sets' + '$', body: { enabled: true, sets: [{ id: 1, name: 'My Momentum' }] } })
  // BreadthWidget: rows[] from its history route; hooks/useLiveBreadth.js isLiveRowUsable: { ok, row }
  if (g.breadth) {
    const row = { date: '2026-11-06', pct_above_20: 41, pct_above_50: 46, pct_above_200: 58, up_4pct: 210, down_4pct: 95, nh: 40, nl: 22 }
    routes.push({ match: '^GET /api/breadth-monitor/live', body: { ok: true, row: { ...row, date: '2026-11-07' }, as_of: '2026-11-07T15:00:00Z', market_open: true } })
    routes.push({ match: '^GET /api/breadth-monitor([?]|' + '$)', body: { rows: [row, { ...row, date: '2026-11-05', pct_above_50: 44 }] } })
  }
  // pages/charts/widgets/captures/newsCapture.test.jsx EVENTS: the route's own shape
  if (g.news) routes.push({ match: '^GET /api/news-catalysts/', body: { status: 'ready', events: [
    { date: '2026-10-14', type: 'earnings', direction: 'up', title: 'Q3 earnings beat', description: 'EPS 1.20 vs 1.10', move_pct: 8.8, source: 'earnings' },
    { date: '2026-09-02', type: 'catalyst', direction: 'down', title: 'Guidance cut', description: null, move_pct: -6.1, source: '@DeItaone' },
  ] } })
  return routes.length ? { routes } : null
}

/** Harness query flags a given needs (agentHarness.jsx reads them on load). */
export const queryFor = (g) => ['layouts=1', g.savedGrids ? 'multichart=1' : ''].filter(Boolean).join('&')

export function boardFor(g) {
  const widgets = BOARDS[g.board || 'plain']
  return { charts_workspace_layout: JSON.stringify({ version: 1, cols: 24, widgets }), charts_workspace_groups: JSON.stringify(GROUPS), ...(g.chartSettings ? { chart_settings: JSON.stringify(g.chartSettings) } : {}), ...(g.prefs || {}) }
}

// in the page: the app's own routes and stores, after the board has loaded
function setupScript(g) {
  if (!g.drawing && !g.alerts && !g.indicatorAlerts) return null
  return `(async () => {
    const said = []
    ${g.alerts ? `for (const a of ${JSON.stringify(g.alerts)}) { await fetch('/api/watchlist-alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }) } said.push('alerts ${g.alerts.length}')` : ''}
    ${g.indicatorAlerts ? `for (const a of ${JSON.stringify(g.indicatorAlerts)}) { await fetch('/api/indicator-alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }) } said.push('indicator alerts ${g.indicatorAlerts.length}')` : ''}
    ${g.drawing ? `
    // the chart's own bars: the request the chart itself made (agent harness records it), asked again
    let req = null
    for (let i = 0; i < 40 && !req; i++) { req = (window.__ba?.bars || []).find(b => b.sym === 'SPY' && b.tf === 'D'); if (!req) await new Promise(r => setTimeout(r, 250)) }
    const j = req ? await (await fetch(req.url)).json() : null
    // the bars route's own short keys (t o h l c), read as a bar
    const bars = ((j && j.bars) || []).map(x => ({ time: x.time ?? x.t, open: x.open ?? x.o, high: x.high ?? x.h, low: x.low ?? x.l, close: x.close ?? x.c }))
    if (bars.length > 30) {
      const S = await import('/src/components/chart/drawingsStore.js')
      const n = bars.length, a = bars[n - 25], b = bars[n - 6], mid = bars[n - 12]
      const lo = Math.min(a.low, b.low), hi = Math.max(a.high, b.high)
      const two = [{ time: a.time, price: a.close }, { time: b.time, price: b.close }]
      const shapes = {
        horizontal: { type: 'horizontal', points: [{ price: mid.close }] },
        trendline: { type: 'trendline', points: [{ time: a.time, price: lo }, { time: b.time, price: hi }] },
        rect: { type: 'rect', points: [{ time: a.time, price: lo }, { time: b.time, price: hi }] },
        fib: { type: 'fib', points: two },
        measure: { type: 'measure', points: two },
        text: { type: 'text', points: [{ time: mid.time, price: mid.close }], text: 'Note' },
      }
      S.addDrawing('SPY', { color: '#ffffff', ...shapes[${JSON.stringify(g.drawing)}] })
      said.push('drawing ${g.drawing}')
    } else said.push('no bars for the drawing')` : ''}
    return said.join(', ')
  })()`
}
