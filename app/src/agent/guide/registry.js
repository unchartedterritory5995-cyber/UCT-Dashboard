// ── UCT Agent PRODUCT GUIDE: what each Charts feature is, where it lives, how to walk someone to it ────────
//
// EXPLAIN · SHOW ME · DO IT FOR ME (Phase 2 Workstream B, 2026-10-29).
//
//   EXPLAIN       teach — a short, accurate sentence about the feature (or a term: agent/guide/explain.js)
//   SHOW ME       guide visually — highlight the REAL control on the board, step by step (GuideOverlay.jsx);
//                 nothing in the workspace changes
//   DO IT FOR ME  execute — the feature's EXISTING capability (the `caps` below), through the ordinary planner,
//                 policy, receipts and Undo. The guide has no writer of its own.
//
// ⛔ NOT A SECOND SOURCE OF TRUTH. Each feature names the discovery topic it belongs to (agent/discovery.js TOPICS —
// what the Agent can and cannot do) and the registered capabilities that DO it; whether a feature is available to
// THIS member is read from the live manifest (`manifestFor(ctx)`), never stated here. A feature whose capabilities
// are not available is not advertised (guideFeatures(ctx)). Agent itself is admin-only, so the guide is too.
//
// ⛔ TARGETS ARE REGISTERED, NOT GUESSED. A step's `target` is a `data-guide` id the control itself carries (or a
// control's own accessible name inside a registered container) — agentGuideTargets.test.js reads the source to rail
// that every id below is present on a real control. No CSS class, no pixel position, no screenshot.
//
// `control`: what the walkthrough's first control is called, for "I can’t see … on your screen".
// `terms`: the exact words that NAME the feature for an explanation ("what is a layout?") — never a loose word match.
// Steps:
//   { target, text }                    point at it and say what it does
//   { target, text, waitFor }           ask the member to do something; the step advances when `waitFor` appears
//   chart-scoped targets (`chart.*`) are found inside the chart being talked about (data-widget-id)
//
// Adding a feature: one entry here (+ the `data-guide` attribute on its control). Nothing else changes: the guide
// capabilities' argument enum, the fast phrases and the walkthrough all read this list.

import { manifestFor } from '../capabilities'

export const GUIDE_FEATURES = [
  {
    id: 'symbol', terms: ['chart symbol', 'symbol search'], control: 'the symbol search', title: 'Changing a chart’s symbol', topic: 'charts',
    words: [/\b(symbol|ticker|stock)\b/, /\bsearch (for )?(a )?(stock|ticker|symbol)\b/],
    caps: ['chart.setSymbol'],
    explain: 'Each chart shows one symbol. Click the symbol name at the top-left of the chart, type a ticker or a company name, and pick it from the list. Charts that share a link colour change together.',
    steps: [
      { target: 'chart.symbol', text: 'Click the symbol name, then type a ticker or company name and pick it from the list.' },
    ],
    doIt: { say: 'Tell me which one — for example “change this chart to NVDA”.' },
  },
  {
    id: 'timeframe', terms: ['timeframe', 'timeframes', 'time frame', 'chart timeframe'], control: 'the timeframe control', title: 'Changing the timeframe', topic: 'charts',
    words: [/\btime ?frames?\b/, /\b(interval|daily|weekly|monthly|hourly|intraday|minute) (chart|view|bars?)\b/, /\b(daily|weekly|monthly) to (daily|weekly|monthly)\b/],
    caps: ['chart.setTimeframe'],
    explain: 'The timeframe is how much time each bar covers — 5 minutes, a day, a week. Your favourite timeframes are the buttons along the top of each chart; the arrow beside them opens every timeframe, including custom ones like 45 minutes or 2 days.',
    steps: [
      { target: 'chart.timeframe', text: 'These buttons switch this chart’s timeframe — click one.' },
      { target: 'chart.timeframeMore', text: 'Every other timeframe (and your own, like 45 minutes) is under this arrow. Star one there to add it to the buttons.' },
    ],
    doIt: {
      action: 'chart.setTimeframe', arg: 'timeframe', ask: 'Which timeframe?',
      choices: [['5', '5 minutes'], ['15', '15 minutes'], ['60', '1 hour'], ['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']],
    },
  },
  {
    id: 'indicators', terms: ['chart settings indicators'], control: 'the chart’s settings gear', title: 'Adding and configuring an indicator', topic: 'indicators',
    words: [/\bindicators?\b/, /\b(rsi|macd|ema|sma|vwap|atr|bollinger|moving averages?|studies|study)\b/],
    caps: ['indicator.add'],
    explain: 'Indicators are in Chart settings → Indicators: search for one (RSI, MACD, a moving average…) and add it; click an indicator already on the chart to change its settings, colours and the pane it draws in.',
    steps: [
      { target: 'chart.settings', text: 'Open this chart’s settings with the gear.', waitFor: 'chartSettings' },
      { target: 'chartSettings.tab.indicators', text: 'Open the Indicators tab.', waitFor: { within: 'chartSettings', aria: 'Search indicators' } },
      { target: { within: 'chartSettings', aria: 'Search indicators' }, text: 'Search for an indicator and add it. The ones already on the chart are listed here too — click one to change its settings, colours and pane.' },
    ],
    doIt: {
      action: 'indicator.add', arg: 'defId', ask: 'Which indicator?',
      choices: [['rsi', 'RSI'], ['macd', 'MACD'], ['vwap', 'VWAP'], ['atr', 'ATR']],
      extra: { inputs: null }, kind: 'indicatorEdits',
    },
  },
  {
    id: 'charts', terms: ['chart grid', 'multi chart', 'several charts'], control: 'the Widgets menu', title: 'Creating and arranging several charts', topic: 'widgets',
    words: [/\b(more|multiple|several|another|new|second|extra|add(ing)? (a )?)\s?charts?\b/, /\b(arrange|grid|side by side|split)\b/, /\b(two|three|four|2|3|4) charts\b/],
    caps: ['widget.add', 'chartGrid.set'],
    explain: 'Add charts from Widgets ▾ → Chart; drag a widget’s header to move it and its edges to resize. Or ask me — “four charts for SPY, QQQ, NVDA and TSLA” sets them up in an even grid in one step (one Undo).',
    steps: [
      { target: 'workspace.widgets', text: 'Open Widgets ▾.', waitFor: 'workspace.widgetsMenu' },
      { target: 'workspace.widgets.chart', text: 'Click Chart to add one into the free space. Drag a widget’s header to move it, its edges to resize it.' },
    ],
    doIt: { say: 'Tell me the tickers — for example “four daily charts for SPY, QQQ, NVDA and TSLA” — and I’ll set them up.' },
  },
  {
    id: 'watchlists', terms: ['watchlist', 'watchlists', 'watch list', 'watchlist widget'], control: 'the Widgets menu', title: 'Using watchlists', topic: 'watchlists',
    words: [/\bwatch ?lists?\b/, /\bmy lists?\b/],
    caps: ['watchlist.show'],
    explain: 'A Watchlist widget shows one of your lists (or one of UCT’s). Click a ticker in it to load it on the charts linked to it. Add one from Widgets ▾ → Watchlist, then pick the list.',
    steps: [
      { target: { widgetType: 'watchlist' }, text: 'This is your watchlist — click a ticker to load it on the linked charts.', optional: true },
      { target: 'workspace.widgets', text: 'To add a watchlist, open Widgets ▾.', waitFor: 'workspace.widgetsMenu' },
      { target: 'workspace.widgets.watchlist', text: 'Click Watchlist, then pick one of your lists.' },
    ],
    doIt: { say: 'Tell me which list — for example “show my Momentum list” or “add NVDA to Momentum”.' },
  },
  {
    id: 'layouts', terms: ['layout', 'layouts', 'saved layout', 'saved layouts'], control: 'your layouts bar', title: 'Saving and switching layouts', topic: 'layouts',
    words: [/\blayouts?\b/, /\bsave (my |this )?(board|workspace|setup)\b/, /\bswitch (my )?(board|workspace)\b/],
    caps: ['layout.open'],
    explain: 'A layout is a saved board — its widgets, charts and their settings. Your layouts sit in the bar at the top: click one to switch. The + opens the library, where you create, save, rename and copy them.',
    steps: [
      { target: 'workspace.layouts', text: 'Your saved layouts — click one to switch to it.' },
      { target: 'workspace.layoutLibrary', text: 'Open the library to create, save, rename or copy a layout.' },
    ],
    doIt: { say: 'Tell me what to do — for example “open my Swing layout” or “save this as Earnings Week”.' },
  },
  {
    id: 'drawing', terms: ['drawing tools', 'drawing tool', 'drawing toolbar'], control: 'the drawing tools', title: 'Basic drawing tools', topic: 'drawings',
    words: [/\bdraw\w*\b/, /\b(trend ?lines?|horizontal (line|level)s?|rectangles?|fib\w*|annotat\w+)\b/],
    caps: ['drawing.addLevel'],
    explain: 'The drawing tools run along the chart’s toolbar: pick one (a trendline, a horizontal line, a rectangle…) and click on the chart to place it. Click a drawing to restyle, lock or delete it.',
    steps: [
      { target: 'chart.drawingTools', text: 'These are the drawing tools for this chart — pick one, then click on the chart.' },
      { target: 'chart.tool.horizontal', text: 'Horizontal Line: one click at a price draws a level across the chart.' },
      { target: 'chart.tool.trendline', text: 'Trendline: click two points.' },
    ],
    doIt: { say: 'I can draw a horizontal line at a price you give me — for example “draw a line at 450”.' },
  },
  {
    id: 'settings', terms: ['chart settings'], control: 'the chart’s settings gear', title: 'Finding chart settings', topic: 'chartSettings',
    words: [/\b(chart )?settings?\b/, /\b(theme|colou?rs?|background|candles?|grid ?lines?|crosshair|legend)\b/],
    caps: ['chart.setSetting'],
    explain: 'Each chart’s settings open from the gear on its header: price style, canvas (background, grid), indicators, header and markers — and UCT Chart Themes for a one-click look.',
    steps: [
      { target: 'chart.settings', text: 'Click the gear to open this chart’s settings.', waitFor: 'chartSettings' },
      { target: 'chartSettings.tab.price', text: 'Price Style, Canvas, Indicators, Header and Markers are the tabs along the top.' },
    ],
    doIt: { say: 'Tell me the change — for example “dark theme on this chart”, “hide the grid” or “candles to hollow”.' },
  },
]

const BY_ID = new Map(GUIDE_FEATURES.map(f => [f.id, f]))
export const GUIDE_IDS = GUIDE_FEATURES.map(f => f.id)
export const guideFeature = (id) => BY_ID.get(id) || null

/** The features THIS member may be shown: every capability a feature names is in their manifest right now. */
export function guideFeatures(ctx) {
  let names
  try { names = new Set(manifestFor(ctx).map(c => c.name)) } catch { names = new Set() }
  return GUIDE_FEATURES.filter(f => f.caps.every(c => names.has(c)))
}

/** The feature a request is about (its words), among the ones this member may be shown. */
export function matchFeature(text, ctx) {
  const q = String(text || '').toLowerCase()
  const list = ctx ? guideFeatures(ctx) : GUIDE_FEATURES
  return list.find(f => f.words.some(re => re.test(q))) || null
}
