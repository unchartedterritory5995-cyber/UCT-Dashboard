// ⭐ GIVEN — the state a teaching case needs before its words are typed, declared, then built by ONE mechanism:
//
//   board      what the workspace holds (the board pref the app reads: its widgets, a chart's own tabs, a widget's tabs)
//   prefs      any other preference the app reads on load (Multi Chart's `multichart_state`)
//   drawing    a drawing of that type on the chart, added through the app's own drawings store, on the chart's own bars
//   alerts     price alerts, created through the app's own (here simulated) /api/watchlist-alerts route
//
// Nothing pokes the DOM: everything is something the app itself reads or writes. `GIVEN` says which cases get what, by the
// walkthrough they reach (a rule) or by id (an override). A case with no given runs on the plain board.

const chart = (id, color, x, y, w, h, opts = {}) => ({ id, type: 'chart', color, x, y, w, h, opts: { tf: 'D', ...opts } })
const GROUPS = { A: 'SPY', B: 'AAPL', C: 'AMD', D: 'MSFT' }
const watch = (extra = {}) => ({ id: 'w-watch', type: 'watchlist', color: 'A', x: 16, y: 0, w: 8, h: 20, opts: {}, ...extra })
// one chart and one watchlist fill the board: a widget the walkthrough adds goes through the real Place step
const PLAIN = [chart('w-chart-a', 'A', 0, 0, 16, 20), watch()]
const BOARDS = {
  plain: PLAIN,
  // a chart with a second tab of its own, and a watchlist with a second (News) tab: pages/charts/chartTabs.js, widgetTabs.js
  tabs: [chart('w-chart-a', 'A', 0, 0, 16, 20, { chartTabs: [{ id: 'ct-2', tf: 'W' }], activeChartTab: 0 }), watch({ wtabs: [{ id: 'wt-2', type: 'news', opts: {} }], activeWtab: 0 })],
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
  if (c.feature === 'gridAction' && !/^(Opening|Saving|Deleting) a (saved )?grid|prebuilt grid|Groups/i.test(c.title || '')) g.prefs = { multichart_state: JSON.stringify(MULTI) }
  if (c.feature === 'tabAction' || /tab’s link colour|Renaming a (chart|widget) tab/.test(c.title || '')) g.board = 'tabs'
  g.setup = setupScript(g)
  if (!g.setup) delete g.setup
  return g
}

export function boardFor(g) {
  const widgets = BOARDS[g.board || 'plain']
  return { charts_workspace_layout: JSON.stringify({ version: 1, cols: 24, widgets }), charts_workspace_groups: JSON.stringify(GROUPS), ...(g.prefs || {}) }
}

// in the page: the app's own routes and stores, after the board has loaded
function setupScript(g) {
  if (!g.drawing && !g.alerts) return null
  return `(async () => {
    const said = []
    ${g.alerts ? `for (const a of ${JSON.stringify(g.alerts)}) { await fetch('/api/watchlist-alerts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }) } said.push('alerts ${g.alerts.length}')` : ''}
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
