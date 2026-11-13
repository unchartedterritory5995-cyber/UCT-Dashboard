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
//   optional: true                      leave the step out unless its control is on screen
//   late: true                          …judged when the walkthrough reaches it, not when it starts (the Place box a full
//                                       board shows after a widget is picked)
//   retreat: false                      its control going away does NOT return to the nearest earlier step on screen
//                                       (the default does: a menu closed, a form cancelled — the member reopens it)
//   pin: true                           the board cell this control sits in is the one `{ inWidget }` targets look in
//   nextLabel / noBack                  the card's forward button wording / no Back (the step's outcome can't be stepped back over)
//   chart-scoped targets (`chart.*`) are found inside the chart being talked about (data-widget-id)
//   ⭐ GUIDE SYSTEM — a step's `waitFor` is its RESULT, so a result already true is skipped (a menu open, a tab selected):
//   { target: { within: …, attr, value, text }, … }   controls that exist per instance (guide/targets.js)
//   { id: 'chartSettings.tab.canvas', on: true }      a control in its selected state; { not: target } the state gone
//   off: '…'                            why this control can be greyed out, said when it is
//   name: '…'                           what this step's control is called, for "I can't see …"
//   first: '…'                          what Skip says when the next step depends on this one
//   endsOnClick: true                   the member's click on it (which closes it) finishes the walkthrough
//   also: target                        another control on the same step whose click counts as doing it
//   altText: '…'                        said when `target` is a list and only a later (fallback) entry is on screen
//   match: (q) => …, except: /re/       a feature's words beyond `words`: a test of its slots, and words that rule it out
//   only: 'slot' / unless: 'slot'       a family's step: see guide/slots.js. `slots`: which words a feature reads;
//                                       {slot.field} in a step, its title or its doIt
//
// Adding a feature: one entry here (+ the `data-guide` attribute on its control). Nothing else changes: the guide
// capabilities' argument enum, the fast phrases and the walkthrough all read this list.

import { manifestFor } from '../capabilities'
import { readIndicator, readWidget, readSetting, SLOTS } from './slots'
import { GEAR, TOOLS_MENU, actionFeatures } from './actions'
import { CONTROL_FEATURE } from './controls'

// ── shared openings ──
const INDICATORS_TAB = { target: 'chartSettings.tab.indicators', name: 'the Indicators tab', text: 'Open the Indicators tab.', waitFor: { id: 'chartSettings.tab.indicators', on: true } }
// a full board asks where a new widget goes (pages/charts/placement/GhostPreview.jsx)
const PLACE = { target: 'workspace.place', name: 'the Place button', text: 'Your board is full, so choose where it goes: the arrows move it, and the gold outline shows what makes room. Then click Place.', optional: true, late: true }
// a widget that isn't on the board comes off Widgets ▾ first; one that is, skips straight past (its own control is the result)
const widgetFirst = (result) => [
  { target: 'workspace.widgets', name: 'the Widgets menu', text: 'That’s in the {widget.label} widget. Open Widgets ▾.', waitFor: ['workspace.widgetsMenu', result] },
  { target: 'workspace.widgets.{widget.id}', name: '{widget.label}', text: 'Click {widget.label} to add it to your board.', waitFor: ['workspace.place', result], off: 'Your board is full, so nothing can be added. Close a widget first.' },
  { ...PLACE, waitFor: result },
]
const LAYOUTS_MENU = { target: 'workspace.layoutsMenuBtn', name: 'the Layouts menu', text: 'Open Layouts ▾.', waitFor: 'workspace.layoutsMenu' }
// a row shows the indicator's short name, or its full one: "EMA 20", "Relative Strength Index"
const named = (more = {}) => [{ within: 'chartSettings', attr: 'data-row-primary', named: '{ind.label}', ...more }, { within: 'chartSettings', attr: 'data-row-primary', named: '{ind.labelName}', ...more }]
// the row of a NEW one: it starts at its defaults, so it carries neither the type nor the length asked for
// the whole Moving Average family: "a 50-day WMA on my chart" is an indicator, however much it reads like a timeframe
const MOVING_AVERAGE = /\b(moving averages?|sma|ema|wma|vwma|hma|smma|dema|tema|lsma)\b/
const ROW_ON = { within: 'chartSettings', attr: 'data-row-primary', on: true }
const added = () => [{ within: 'chartSettings', attr: 'data-row-primary', named: '{ind.addedRow}' }, { within: 'chartSettings', attr: 'data-row-primary', named: '{ind.name}' }]
// the row of the indicator asked about; with none named (or not on this chart), any row of the chart's own list
const ROW = { within: 'chartSettings', attr: 'data-row-primary' }
const rowStep = (result) => [
  { only: 'ind', target: [...named(), ROW], name: 'the indicator list', text: 'Click {ind.label} in this list.', altText: '{ind.label} isn’t on this chart. Add it first (ask me how), or click another indicator here.', waitFor: named({ on: true }) },
  { unless: 'ind', target: ROW, name: 'the indicator list', text: 'These are the indicators on this chart. Click the one you want to change.', waitFor: result },
]
const SWATCH = { within: 'chartSettings', attr: 'data-color-swatch' }
const FIELD_ROW = { within: 'chartSettings', attr: 'data-field' }
// ⭐ cov-2: a drawing tool by its own name, which nothing else on Charts is called (components/chart/ChartToolbar.jsx TOOLS)
export const TOOL_NAMED = /\b(pitch ?forks?|parallel channels?|anchored vwaps?|avwap|vertical lines?|horizontal rays?|extended lines?|position calculator|price move|bars (&|and) time|text notes?|cup curve|fibonacci( retracements?| extensions?)?|circles?|ellipses?)\b|\barrows?\b(?!\s*(keys?|buttons?))|\banchor\w*\b.*\bvwap\b|\bcount\w*\b.*\bbars\b.*\b(between|from|since)\b|\bhow many bars\b/
// a tool named with a verb that places it on the chart ("put an arrow on the chart", "use the measure")
const PLACED_TOOL = /\b(add|put|place|draw|use|mark|stick|drop)\b.*\b(arrows?|circles?|ellipses?|channels?|measure|ruler)\b/
// ⭐ cov-1: what else says "change this indicator's settings or look", once the words name an indicator (readIndicator)
// a colour by its name ("make the RSI purple")
export const COLOUR_NAME = /\b(red|green|blue|purple|violet|orange|yellow|gold|white|black|gr[ae]y|pink|teal|cyan|aqua|magenta|brown|lime|navy)\b/
// a value it is set to or uses ("set my RSI to 21", "so it uses 9 bars")
export const SETS_A_VALUE = /\b(set|make|change|switch|put|turn)\b.*\b(to|at)\s+\d+\b|\b(uses?|using)\s+\d+(\s+(bars?|periods?|days?))?\b|\b(make|set)\s+(the |my |this |that )?[a-z]+ \d+\b(?!\s*(m|h|d|w|mins?|minutes?|hours?|hrs?|days?|weeks?|months?|bars?)\b)/
// where it is worked out ("calculate this RSI on the weekly")
export const CALC_ON = /\b(calculat|calc|comput|run|work)\w*\b.*\bon\s+(the\s+|a\s+)?(weekly|daily|monthly|hourly|higher|lower|other|another|different|\d+\s*(m|h|min\w*|hour\w*))\b/
// one part of it by its own name ("the signal line on the MACD", "the upper band"): its settings, not the whole indicator
export const INDICATOR_PART = /\b(signal|upper|lower|middle|basis|zero|center|centre|overbought|oversold)\s+(lines?|bands?|levels?)\b/
// how it is drawn ("as a histogram instead of a line")
export const DRAWN_AS = /\b(as|into)\s+(an?\s+)?(histogram|columns?|area|line|dots?|circles?|steps?)\b|\binstead of\s+(an?\s+)?(histogram|columns?|area|line|bars?)\b/

export const GUIDE_FEATURES = [
  // ⭐ the named-control catalog (guide/controls.js): a control the words fully describe, in a place they name, wins over
  // every broader walkthrough that shares one of its words
  CONTROL_FEATURE,
  // ⭐ the action families (guide/actions.js): one row per small action, ahead of the features whose words they share
  ...actionFeatures({ legendChip: { also: readIndicator, guard: (q) => !INDICATOR_PART.test(q) }, indicatorManage: { also: (q) => readIndicator(q) || /\bplot style\b/.test(q) }, drawingEdit: { guard: (q) => !readIndicator(q) } }),
  // ⭐ PHASE 3 — more specific features sit BEFORE the general ones whose words they share (matchFeature takes the first)
  // ── ⭐ GUIDE SYSTEM: the nested, multi-step Charts families ──
  {
    // the Inspector of one indicator (components/chart/ChartSettingsIndicators.jsx), and its colour panel (ChartSettingsModal)
    id: 'indicatorColor', slots: ['ind'], except: /\b(prev|prior|previous)[- ]?day\b|\b(crosshair|grid|watermark|background)\b/, terms: ['indicator colour', 'indicator color'], control: 'the chart’s settings gear', title: 'Changing the colour of {ind.label}', titleAny: 'Changing an indicator’s colour', topic: 'indicators',
    words: [/\bindicators?\b.*\bcolou?rs?\b|\bcolou?rs?\b.*\bindicators?\b/, /\b(line|plot|moving average|average)\b.*\bcolou?rs?\b|\bcolou?rs?\b.*\b(line|plot|moving average|average)\b/],
    match: (q) => (/\b(re)?colou?r\w*\b/.test(q) || COLOUR_NAME.test(q)) && !!readIndicator(q),
    caps: ['indicatorStyle.set'],
    explain: 'An indicator’s colour is in its own settings: the gear on the chart, the Indicators tab, click the indicator, then click the colour swatch under Appearance.',
    steps: [
      GEAR,
      INDICATORS_TAB,
      ...rowStep(SWATCH),
      { target: SWATCH, name: 'the colour swatch', text: 'Click this swatch to open the colours. An indicator with several lines has one swatch for each.', waitFor: 'chartSettings.colorPanel' },
      { target: 'chartSettings.colorPanel', name: 'the colour panel', text: 'Pick a colour. The line on the chart changes as you pick.' },
    ],
    doIt: { say: 'Tell me the colour and which indicator — for example “make the RSI orange”.' },
  },
  {
    // the same Inspector, one field of it
    id: 'indicatorEdit', slots: ['ind', 'field'], terms: ['indicator settings'], control: 'the chart’s settings gear', title: 'Changing {ind.label}’s settings', titleAny: 'Changing an indicator’s settings', topic: 'indicators',
    words: [/\b(change|edit|set|adjust|configure|modify|tweak)\w*\b.*\bindicators?\b/, /\bindicators?\b.*\b(settings?|period|length|style|width|source|inputs?)\b/],
    match: (q) => (/\b(period|length|lookback|source|type|time ?frame|width|thick\w*|style|settings?|inputs?|offset|pane|panel|visib\w+|dash\w*|dott?ed)\b/.test(q) || SETS_A_VALUE.test(q) || CALC_ON.test(q) || INDICATOR_PART.test(q) || DRAWN_AS.test(q)) && (!!readIndicator(q) || INDICATOR_PART.test(q)) && !/\balert\w*\b/.test(q),
    caps: ['indicator.update'],
    explain: 'Every indicator’s own settings are in the chart’s settings: the gear, the Indicators tab, then click the indicator. Its period, source, type, timeframe, pane, visibility and line style are all there.',
    steps: [
      GEAR,
      INDICATORS_TAB,
      ...rowStep(FIELD_ROW),
      { only: 'field', target: [{ ...FIELD_ROW, value: '{field.id}' }, { ...FIELD_ROW, text: '{field.label}' }, FIELD_ROW], name: 'the setting', text: 'Change {field.label} here. The chart updates as you do.', altText: 'This indicator has no {field.label} setting. These are the settings it has.' },
      { unless: 'field', target: FIELD_ROW, name: 'the settings', text: 'These are this indicator’s settings. The chart updates as you change them.' },
    ],
    doIt: { say: 'Tell me the change — for example “set the RSI length to 21”.' },
  },
  {
    // components/chart/IndicatorAlertPopover.jsx, from the chart toolbar's bell
    id: 'alertIndicator', terms: ['indicator alert', 'indicator alerts'], control: 'the bell on the chart’s toolbar', title: 'Setting an indicator alert', topic: 'alerts',
    words: [/\balerts?\b.*\b(indicators?|rsi|macd|cross\w*|moving average)\b|\b(indicators?|rsi|macd|moving average)\b.*\balerts?\b/],
    match: (q) => /\balert\w*\b/.test(q) && !!readIndicator(q),
    caps: ['indicatorAlert.create'],
    explain: 'The bell on the chart’s toolbar opens Indicator alerts: choose the indicator, the condition and its value, then Add Alert. Your existing alerts for this symbol are listed below the form.',
    steps: [
      { target: 'chart.alerts', name: 'the bell', text: 'Click the bell to open Indicator alerts.', waitFor: 'chart.alertsPopover', off: 'The bell is greyed out until this chart has a symbol.' },
      { target: { within: 'chart.alertsPopover', aria: 'Indicator' }, name: 'the Indicator list', text: 'Choose the indicator to watch.' },
      { target: { within: 'chart.alertsPopover', aria: 'Condition' }, name: 'the Condition list', text: 'Choose the condition: crossing a value, or a line crossing another.' },
      { target: { within: 'chart.alertsPopover', aria: 'Threshold' }, name: 'the value box', text: 'Type the value it should cross.', optional: true },
      { target: 'chart.alertAdd', name: 'Add Alert', text: 'Click Add Alert. Your alert is listed below the form, where you can pause or delete it.', off: 'Add Alert stays greyed out until the form is complete.' },
    ],
    doIt: { say: 'Tell me the rule — for example “alert me when RSI crosses above 70”.' },
  },
  {
    // pages/charts/widgets/AlertsWidget.jsx — the widget's quick-add row; the widget comes off Widgets ▾ when it isn't on the board
    id: 'alertPrice', except: /\bwidget\b.*\b(settings?|gear|appearance|look)\b/, terms: ['price alert', 'price alerts', 'alerts widget'], control: 'the Alerts widget', title: 'Setting a price alert', topic: 'alerts',
    words: [/\balerts?\b/, /\bnotify me\b/, /\b(get|be) alerted\b/],
    caps: ['alert.create'],
    explain: 'The Alerts widget sets a price alert on any ticker: type the ticker, choose Above or Below, type the price, click Set. Add the widget from Widgets ▾ → Alerts. On a chart, Alt+N sets one at the cursor.',
    steps: [
      { target: 'workspace.widgets', name: 'the Widgets menu', text: 'Price alerts live in the Alerts widget. Open Widgets ▾.', waitFor: ['workspace.widgetsMenu', 'alerts.quickAdd'] },
      { target: 'workspace.widgets.alerts', name: 'Alerts', text: 'Click Alerts to add it to your board.', waitFor: ['workspace.place', 'alerts.quickAdd'], off: 'Your board is full, so nothing can be added. Close a widget first.' },
      { ...PLACE, waitFor: 'alerts.quickAdd' },
      { target: { within: 'alerts.quickAdd', aria: 'Ticker' }, name: 'the Ticker box', text: 'Type the ticker.' },
      { target: { within: 'alerts.quickAdd', attr: 'data-guide-dir' }, name: 'Above or Below', text: 'Choose Above or Below: which way the price has to cross.' },
      { target: { within: 'alerts.quickAdd', aria: 'Price' }, name: 'the Price box', text: 'Type the price.' },
      { target: 'alerts.set', name: 'Set', text: 'Click Set. The alert appears in this list, and × deletes it.', off: 'Set stays greyed out until the ticker and price are filled in.' },
    ],
    doIt: { say: 'Tell me the alert — for example “alert me if NVDA goes above 150”.' },
  },
  {
    // pages/charts/grid/MultiChartMenu.jsx, under Layouts ▾ → Multi Chart
    id: 'multiChart', slots: ['grid'], terms: ['multi chart', 'chart grid'], control: 'the Layouts menu', title: 'Setting up a {grid.label} chart grid', topic: 'layouts',
    words: [/\bmulti[- ]?charts?\b/, /\b(four|4|six|6|nine|9|sixteen|16)[- ]charts?\b/, /\b\d ?[x×] ?\d\b/, /\bchart grid\b/, /\bgrid of charts\b/, /\bcharts? (in|on) a grid\b/, /\bquad\b/, /\bside by side\b/],
    caps: ['chartGrid.set'],
    explain: 'Layouts ▾ → Multi Chart turns the board into a grid of linked charts: pick a preset such as 2×2, or type your own rows and columns. Workspace takes you back to your board.',
    steps: [
      LAYOUTS_MENU,
      { target: 'workspace.multiChart', name: 'Multi Chart', text: 'Click Multi Chart.', waitFor: 'multiChart.preset.{grid.id}' },
      { target: 'multiChart.preset.{grid.id}', name: 'the grid preset', text: 'Click {grid.label}. Your board is kept: Workspace brings it back.' },
      { target: 'workspace.exitGrid', name: 'the Workspace button', text: 'This is your grid. Click Workspace whenever you want your board back.', noBack: true },
    ],
    doIt: { say: 'Tell me the tickers — for example “four daily charts for SPY, QQQ, NVDA and TSLA” — and I’ll set them up.' },
  },
  {
    // pages/charts/ChartsWorkspace.jsx CUSTOM_RESIZE_HANDLES; MergedSeamOverlay on a merged board
    id: 'widgetResize', terms: ['resize a chart', 'resize a widget'], control: 'the edge of the chart', title: 'Resizing a chart or widget', topic: 'arrange',
    words: [/\b(resiz\w*|bigger|smaller|wider|narrower|taller|shorter|enlarge|shrink)\b.*\b(charts?|widgets?|panels?|windows?)\b/, /\b(charts?|widgets?)\b.*\b(resiz\w*|bigger|smaller|wider|narrower|taller|shorter)\b/, /\bresiz\w*\b/],
    caps: ['widget.resize'],
    explain: 'Drag any edge or corner of a chart or widget to resize it; neighbours give way, and a merged board resizes along the seams between widgets. Or tell me — “make this chart wider”.',
    steps: [
      { target: ['widget.resize.e', 'workspace.seam'], name: 'the chart’s edge', text: 'Point at this edge until the cursor changes, then drag it. The widget beside it gives way.' },
      { target: 'widget.resize.se', name: 'the chart’s corner', text: 'Or drag a corner to change the width and height together.', optional: true },
    ],
    doIt: { say: 'Tell me the change — for example “make this chart wider”.' },
  },
  {
    id: 'widgetMove', except: MOVING_AVERAGE, terms: ['move a widget', 'moving a widget'], control: 'the widget’s header', title: 'Moving a chart or widget', topic: 'arrange',
    words: [/\b(move|moving|drag|dragging|rearrange|reposition|swap)\b.*\b(charts?|widgets?)\b/],
    caps: ['widget.move'],
    explain: 'Drag a widget by its header to move it. Drop it where the gold outline shows; the other widgets make room.',
    steps: [
      { target: 'widget.headerBar', name: 'the header', text: 'Grab this header and drag the widget where you want it. The gold outline shows where it will land.' },
    ],
    doIt: { say: 'Tell me where — for example “swap these two charts” or “move the watchlist to the left”.' },
  },
  {
    // WidgetHeader.jsx — the buttons every widget carries, on the chart talked about
    id: 'widgetHeader', slots: ['ctl'], terms: ['widget header'], control: 'the widget’s header', title: 'Widget controls: {ctl.label}', topic: 'arrange',
    words: [/\b(float|pop[- ]?out|popout)\b.*\b(widgets?|charts?|window)?\b/, /\b(close|remove|delete|get rid of)\b.*\b(widgets?|panel)\b/, /\b(add|new)\b.*\btab\b.*\bwidget\b/, /\bwidget\b.*\btabs?\b/, /\b(own|separate|new) window\b/, /\bother monitor\b|\bsecond (monitor|screen)\b/],
    caps: [],
    explain: 'Each widget’s header carries its controls: the colour dot links it, + adds a tab, ▣ floats it over other widgets, ⧉ opens it in its own window and × closes it.',
    steps: [
      { target: 'widget.{ctl.id}', name: 'that button', text: '{ctl.say}' },
    ],
    doIt: { say: 'Tell me which widget — for example “close the news widget” or “add a tab to this chart”.' },
  },
  {
    // each widget's own gear (data-guide="widget.settings")
    id: 'widgetSettings', slots: ['widget'], terms: ['widget settings'], control: 'the widget’s gear', title: '{widget.label} widget settings', titleAny: 'A widget’s settings', topic: 'widgets',
    words: [/\bwidgets?\b.*\b(settings?|options?|gear|appearance|customi[sz]e|configure)\b/, /\b(settings?|options?|gear|appearance|customi[sz]e|configure)\b.*\bwidgets?\b/],
    match: (q) => /\b(settings?|options?|gear|appearance|customi[sz]e|configure|look of|font|logos?)\b/.test(q) && !!readWidget(q) && !/\bchart\b/.test(q),
    caps: ['widget.add'],
    explain: 'Most widgets have a gear in their own top bar: it opens that widget’s settings, such as font size, background and what it shows.',
    steps: [
      ...widgetFirst({ widgetType: '{widget.id}', guide: 'widget.settings' }).map(s => ({ ...s, only: 'widget' })),
      { only: 'widget', target: { widgetType: '{widget.id}', guide: 'widget.settings' }, name: 'its gear', text: 'This gear opens the {widget.label} widget’s settings. Your changes apply as you make them.' },
      { unless: 'widget', target: { widgetType: 'watchlist', guide: 'widget.settings' }, name: 'its gear', text: 'A widget’s gear sits in its own top bar and opens its settings. Tell me which widget, and I’ll point to its gear.' },
    ],
    doIt: { say: 'Tell me the change — for example “show logos on the news widget”.' },
  },
  {
    // pages/charts/ChartsWorkspace.jsx Widgets ▾, for any widget the menu offers
    id: 'widgetAdd', slots: ['widget'], terms: ['add a widget', 'adding a widget'], control: 'the Widgets menu', title: 'Adding the {widget.label} widget', titleAny: 'Adding a widget', topic: 'widgets',
    words: [/\b(add|adding|put|place|open|get|bring up|show)\b.*\bwidgets?\b/],
    // a Chart and a Watchlist have their own walkthroughs, and "on the chart" names where, not what
    match: (q) => /\b(add|adding|put|place|bring up|get)\b/.test(q) && !!readWidget(q) && !['chart', 'watchlist'].includes(readWidget(q).id) && !readIndicator(q),
    caps: ['widget.add'],
    explain: 'Widgets ▾ lists everything you can put on your board. Click one to add it; a full board asks you where it goes.',
    steps: [
      { target: 'workspace.widgets', name: 'the Widgets menu', text: 'Open Widgets ▾.', waitFor: 'workspace.widgetsMenu' },
      { only: 'widget', target: 'workspace.widgets.{widget.id}', name: '{widget.label}', text: 'Click {widget.label}.', off: 'Your board is full, so nothing can be added. Close a widget first.' },
      { unless: 'widget', target: 'workspace.widgetsMenu', name: 'the menu', text: 'Click any of these to add it to your board.' },
      PLACE,
    ],
    doIt: { say: 'Tell me which one — for example “add a news widget”.' },
  },
  {
    id: 'widgetMerge', terms: ['merge widgets'], control: 'the Widgets menu', title: 'Merging your widgets', topic: 'arrange',
    words: [/\b(merge|unmerge|merging|lock)\b.*\b(widgets?|board|borders?)\b/, /\b(remove|hide|no)\b.*\bborders\b/],
    caps: [],
    explain: 'Widgets ▾ → Merge Widgets locks the board and removes the borders, so the widgets blend together. The same button unmerges them.',
    steps: [
      { target: 'workspace.widgets', name: 'the Widgets menu', text: 'Open Widgets ▾.', waitFor: 'workspace.widgetsMenu' },
      { target: 'workspace.merge', name: 'Merge Widgets', text: 'Click Merge Widgets. It locks the board and removes the borders; the same button undoes it.' },
    ],
  },
  {
    id: 'compare', terms: ['compare symbols'], control: 'the Tools menu', title: 'Comparing symbols on a chart', topic: 'charts',
    words: [/\b(compare|comparing|comparison|overlay)\b.*\b(symbols?|tickers?|stocks?|charts?|against|with|to)\b/, /\bcompare\b/],
    caps: ['chart.compare'],
    explain: 'Tools ▾ → Compare Symbols overlays other symbols on a chart. Type a ticker in the panel, and each one gets its own colour and scale option.',
    steps: [
      TOOLS_MENU,
      { target: 'workspace.tools.compare', name: 'Compare Symbols', text: 'Click Compare Symbols.', waitFor: 'compare.panel' },
      { target: { within: 'compare.panel', aria: 'Add symbol' }, name: 'the symbol box', text: 'Type a ticker and press Enter. Each symbol you add is listed here, with its scale and a remove button.' },
    ],
    doIt: { say: 'Tell me the ticker — for example “compare this with AMD”.' },
  },
  {
    id: 'replay', terms: ['replay mode', 'bar replay'], control: 'the Tools menu', title: 'Replaying the market', topic: 'charts',
    words: [/\breplay\w*\b/],
    caps: ['chart.replay'],
    explain: 'Tools ▾ → Replay Mode rolls your charts back to a date: choose the date and a timeframe, and click Start replay. Exit it from the same panel.',
    steps: [
      TOOLS_MENU,
      { target: 'workspace.tools.replay', name: 'Replay Mode', text: 'Click Replay Mode.', waitFor: 'replay.panel' },
      { target: { within: 'replay.panel', aria: 'Replay to' }, name: 'the date box', text: 'Choose the date to roll back to.' },
      { target: { within: 'replay.panel', aria: 'Timeframe' }, name: 'the timeframe list', text: 'Choose the timeframe to replay on.' },
      { target: 'replay.start', name: 'Start replay', text: 'Click Start replay.', off: 'Start replay stays greyed out until the date is valid.' },
    ],
    doIt: { say: 'Tell me the date — for example “replay from October 15”.' },
  },
  {
    id: 'periodSort', terms: ['custom period sort'], control: 'the Tools menu', title: 'Custom-period sort', topic: 'charts',
    words: [/\b(custom[- ]period|period) sort\b/, /\bsort\b.*\bmarket\b.*\bperiod\b/, /\brank\b.*\b(market|stocks)\b.*\bperiod\b/],
    caps: [],
    explain: 'Tools ▾ → Custom-Period Sort ranks the whole US market by its % change over a period you highlight on a chart.',
    steps: [
      TOOLS_MENU,
      { target: 'workspace.tools.periodSort', name: 'Custom-Period Sort', text: 'Click Custom-Period Sort, then highlight the period on a chart.' },
    ],
  },
  {
    id: 'goToDate', terms: ['go to date', 'time navigator'], control: 'the date box on the chart', title: 'Going to a date', topic: 'charts',
    words: [/\b(go|jump|scroll|navigate|get) (back )?to (a |an |the |this |that )?(specific |particular |certain )?(date|day|year)\b/, /\b(go|jump|scroll|navigate|get) (back )?to (a year like )?(19|20)\d\d\b/, /\bgo back to\b.*\b\d{4}\b/, /\btime navigator\b/],
    caps: ['chart.goToDate'],
    explain: 'The date box on the chart’s header jumps the chart to a date: type it and press Enter. Its arrows step one bar at a time, and the calendar picks a date or a year.',
    steps: [
      { target: 'chart.goToDate', name: 'the date box', text: 'Click here, type a date and press Enter. The arrows beside it step one bar at a time.' },
    ],
    doIt: { say: 'Tell me the date — for example “go to March 15 2024”.' },
  },
  {
    id: 'chartTab', terms: ['chart tab', 'chart tabs'], control: 'the + on the chart’s header', title: 'Adding a chart tab', topic: 'charts',
    words: [/\b(chart|new|add|another)\b.*\btabs?\b/],
    caps: ['chart.addTab'],
    explain: 'The + on a chart’s header adds a tab to that chart, with its own settings. Tabs sit in a strip above the chart: click to switch, double-click to rename.',
    steps: [
      { target: 'chart.addTab', name: 'the +', text: 'Click this + to add a tab to this chart. It opens with its own settings.', off: 'This chart already has tabs: use the + on its tab strip.' },
    ],
    doIt: { say: 'Say “add a chart tab” and I’ll do it.' },
  },
  {
    id: 'chartThemes', except: /\bwatermark\b/, terms: ['chart themes', 'uct chart themes'], control: 'the chart’s settings gear', title: 'Applying a chart theme', topic: 'chartSettings',
    words: [/\b(chart )?themes?\b/],
    caps: ['chart.applyTheme'],
    explain: 'Chart Settings → UCT Chart Themes gives a chart a ready-made look in one click, on this chart or on all of them.',
    steps: [
      GEAR,
      { target: 'chartSettings.themes', name: 'UCT Chart Themes', text: 'Click UCT Chart Themes, then pick a look.' },
    ],
    doIt: { say: 'Tell me which — for example “apply the nord theme”.' },
  },
  {
    id: 'chartTemplate', terms: ['chart template', 'chart templates'], control: 'the chart’s settings gear', title: 'Chart templates', topic: 'chartSettings',
    words: [/\btemplates?\b/],
    caps: ['chartSetup.saveTemplate'],
    explain: 'A chart template saves a chart’s whole look. In Chart Settings, ＋ Save as Template keeps the current look under a name, and Templates ▾ applies or deletes a saved one.',
    steps: [
      GEAR,
      { target: 'chartSettings.templates', name: 'Templates', text: 'Templates ▾ lists your saved looks: click one to apply it, or its × to delete it.' },
      { target: 'chartSettings.saveTemplate', name: 'Save as Template', text: 'Save as Template keeps this chart’s look under a name.' },
    ],
    doIt: { say: 'Tell me the name — for example “save this as Swing” or “apply my Swing template”.' },
  },
  {
    // components/chart/ChartSettingsModal.jsx Price Style: the Chart Type row
    id: 'chartType', terms: ['chart type'], control: 'the chart’s settings gear', title: 'Changing the chart type', topic: 'charts',
    words: [/\bchart type\b/, /\b(candlesticks?|candles?|bars?|line|area|hollow|baseline)\b.*\bchart\b/, /\b(line|bar|area|candle) chart\b/],
    caps: ['chart.setType'],
    explain: 'Chart Settings → Price Style chooses how price is drawn: candles, hollow candles, bars, a line and the others.',
    steps: [
      GEAR,
      { target: 'chartSettings.tab.price', name: 'the Price Style tab', text: 'Open Price Style.', waitFor: { id: 'chartSettings.tab.price', on: true } },
      { target: [{ within: 'chartSettings', label: 'Type' }, 'chartSettings.tab.price'], name: 'the chart type', text: 'Choose how price is drawn here.', altText: 'The chart type is at the top of this tab.' },
    ],
    doIt: { say: 'Tell me which — for example “make it a line chart”.' },
  },
  {
    // pages/charts/widgets/TimeframeMenu.jsx — the adder at the foot of the menu
    id: 'timeframeCustom', except: MOVING_AVERAGE, terms: ['custom timeframe', 'custom interval'], control: 'the arrow beside the timeframes', title: 'Adding a custom timeframe', topic: 'charts',
    words: [/\bcustom\b.*\b(time ?frames?|intervals?)\b/, /\b(add|create|new|make|save|favou?rite|star)\b.*\b(time ?frames?|intervals?)\b/, /\b\d+[- ]?(minute|min|hour|day|week)\b.*\b(time ?frame|chart|interval)\b/],
    caps: ['chart.addCustomTimeframe'],
    explain: 'The arrow beside the timeframe buttons opens every timeframe. At its foot, Add custom interval makes your own, such as 45 minutes. A star adds any timeframe to the buttons; a custom one can be deleted from the same list.',
    steps: [
      { target: 'chart.timeframeMore', name: 'the arrow', text: 'Click this arrow to open every timeframe.', waitFor: 'chart.timeframeMenu' },
      { target: { within: 'chart.timeframeMenu', aria: 'Interval count' }, name: 'Add custom interval', text: 'Type the number here, choose minutes, hours, days or weeks beside it, and add it. A star on any row puts it on the buttons.' },
    ],
    doIt: { say: 'Tell me the interval — for example “add a 45 minute timeframe”.' },
  },
  {
    // pages/Watchlists.jsx — the + in a list's header
    id: 'watchlistAddSymbol', terms: ['add to a watchlist'], control: 'the + on the list', title: 'Adding a ticker to a watchlist', topic: 'watchlists',
    // ⭐ cov-1: a ticker by its own name counts too ("put NVDA on my watchlist"): one word between the verb and its list
    words: [/\b(add|put|stick|throw|get)\b.*\b(tickers?|symbols?|stocks?|names?)\b.*\b(on|to|into|in)\b.*\b(watch ?lists?|lists?)\b/, /\b(add|put|stick|throw|save)\s+(?!(an?|the|this|that|another|columns?)\b)[a-z][a-z.]{0,5}\s+(on|to|into|in)\s+(my|a|the|this|that|one of my)\s+((?!(surge|scope|volume)\b)\w+\s+)?(watch ?lists?|lists?)\b/,/\b(watch ?lists?|lists?)\b.*\badd\b.*\b(tickers?|symbols?|stocks?)\b/],
    caps: ['watchlist.show'],
    explain: 'Open a list in a Watchlist widget, click the + in its header and type the ticker. Alt+Q adds the chart’s ticker to a list.',
    steps: [
      { target: { widgetType: 'watchlist', attr: 'data-guide', value: 'watchlist.picker' }, name: 'your lists', text: 'Click the list to add to.', waitFor: { widgetType: 'watchlist', guide: 'watchlist.addSymbol' } },
      { target: { widgetType: 'watchlist', guide: 'watchlist.addSymbol' }, name: 'the +', text: 'Click + and type the ticker.' },
    ],
    doIt: { say: 'Tell me both — for example “add NVDA to Momentum”.' },
  },
  {
    // every row of the product's own settings table: the gear, its tab, its place on the tab
    id: 'chartSetting', slots: ['setting'], terms: [], control: 'the chart’s settings gear', title: 'Changing {setting.label}', titleAny: 'Finding a chart setting', topic: 'chartSettings',
    words: [],
    match: (q) => !!readSetting(q),
    caps: ['chart.setSetting'],
    explain: 'Every chart setting is in the chart’s settings: the gear on its header, then the tab it belongs to.',
    steps: [
      GEAR,
      { target: 'chartSettings.tab.{setting.tab}', name: 'the {setting.tabLabel} tab', text: 'Open {setting.tabLabel}.', waitFor: { id: 'chartSettings.tab.{setting.tab}', on: true } },
      { target: [{ within: 'chartSettings', label: '{setting.where}' }, 'chartSettings.tab.{setting.tab}'], name: '{setting.label}', text: '{setting.label} is here, under {setting.where}.{setting.note}', altText: '{setting.alt}' },
    ],
    doIt: { say: 'Tell me the change — for example “hide the grid” or “make the crosshair dashed”.' },
  },
  {
    // pages/charts/ChartsWorkspace.jsx Layouts ▾ → Save Layout ▸
    id: 'layoutSave', terms: ['save a layout', 'save layout'], control: 'the Layouts menu', title: 'Saving a layout', topic: 'layouts',
    words: [/\bsav(e|es|ing)\b.*\b(layouts?|board|workspace|setup|arrangement)\b/, /\b(layouts?|board)\b.*\bsav(e|ed|ing)\b/, /\bkeep\b.*\b(layout|board)\b/],
    caps: ['layout.saveCurrent'],
    explain: 'Layouts ▾ → Save Layout: Save current arrangement updates the layout you have open; to keep a new one, type a name and click Save template. Saved layouts sit on the bar at the bottom.',
    steps: [
      LAYOUTS_MENU,
      { target: 'workspace.saveLayout', name: 'Save Layout', text: 'Click Save Layout.', waitFor: 'workspace.saveCurrent' },
      // this menu closes when the pointer leaves it, so everything it needs is said here rather than behind a Next on the card
      { target: 'workspace.saveCurrent', name: 'Save current arrangement', text: 'Click this to update the layout you have open. To keep this board as a NEW layout instead, type a name in the box below and click Save template.', endsOnClick: true, also: 'workspace.saveTemplate' },
    ],
    doIt: { say: 'Tell me the name — for example “save this as Earnings Week” — or say “save my layout”.' },
  },
  {
    // pages/charts/widgets/WatchlistPicker.jsx — the ONLY place a member creates a list: ＋ New in the picker of a Watchlist
    // widget (PickerHeader), a name, Create; the widget then opens the new list (pages/Watchlists.jsx, pick mode). The
    // picker shows on a fresh widget, or behind ‹ Lists on one already showing a list (a full board can't add a widget).
    // `everyPage`: asked on another page it says where this lives, rather than leaving the words to the model.
    id: 'watchlistCreate', everyPage: true, terms: ['new watchlist', 'create a watchlist', 'creating a watchlist'], control: 'the Widgets menu', title: 'Creating a watchlist', topic: 'watchlists',
    words: [/\b(?:create|creating|make|making|build|building|start|starting|set up|setting up|new)\b(?:\s+(?:a|an|the|my|me|another|new|own|custom|first|second|stock|ticker|personal|blank))*\s+(?:watch ?)?lists?\b/],
    caps: ['watchlist.create'],
    explain: 'You create a watchlist in a Watchlist widget: in its list picker, click ＋ New, name the list and click Create. The picker opens when you add the widget (Widgets ▾ → Watchlist), or from ‹ Lists on a Watchlist widget already on your board.',
    steps: [
      { target: { widgetType: 'watchlist', guide: 'watchlist.lists' }, text: 'New lists start in the list picker. Click ‹ Lists on this widget to open it (the widget will show your new list afterwards), or press Next to add a new Watchlist widget instead.', optional: true, waitFor: 'watchlist.picker', nextLabel: 'Next' },
      { target: 'workspace.widgets', text: 'Open Widgets ▾.', waitFor: ['workspace.widgetsMenu', 'watchlist.picker'] },
      { target: 'workspace.widgets.watchlist', text: 'Click Watchlist to add one to your board. If the board is full, the menu says so — close a widget first.', waitFor: 'watchlist.picker', retreat: true },
      { target: { within: 'watchlist.picker', aria: 'New watchlist' }, text: 'This is the list picker. Click ＋ New to start a list.', waitFor: { within: 'watchlist.picker', aria: 'New watchlist name' }, pin: true },
      { target: { within: 'watchlist.picker', aria: 'New watchlist name' }, text: 'Type a name for the list.', waitFor: { inWidget: 'watchlist.addSymbol' }, nextLabel: 'Next', pin: true, retreat: true },
      { target: 'watchlist.createList', text: 'Click Create. If it can’t be created, the form tells you here and nothing is saved.', waitFor: { inWidget: 'watchlist.addSymbol' }, pin: true, retreat: true },
      { target: { inWidget: 'watchlist.addSymbol' }, text: 'The list is open in this widget and saved in My Lists. Click + to add its first ticker.', noBack: true },
    ],
    doIt: { say: 'Tell me what to call it — for example “create a watchlist called Momentum” — and I’ll make it once you confirm.' },
  },
  {
    id: 'canvas', terms: ['canvas settings', 'chart background', 'grid lines', 'crosshair settings'], control: 'the chart’s settings gear', title: 'Chart background, grid, crosshair and watermark', topic: 'chartSettings',
    words: [/\b(background|grid ?lines?|crosshair|watermark|canvas|scale text)\b/],
    caps: ['chart.setBackground'],
    // the Canvas tab's own rows: components/chart/chartSettingsDescriptors.js (ui: 'Chart Settings → Canvas → …')
    explain: 'Chart Settings → Canvas holds the chart’s background, grid, crosshair, scale text and watermark. Open it from the gear on the chart’s header.',
    steps: [
      { target: 'chart.settings', text: 'Open this chart’s settings with the gear.', waitFor: 'chartSettings' },
      // the last step: the tab IS the answer, so the card offers Done rather than waiting for a click that adds nothing
      { target: 'chartSettings.tab.canvas', text: 'Open Canvas — the background, grid, crosshair, scale text and watermark are here. Scroll down for the rest.' },
    ],
    doIt: { say: 'Tell me the change — for example “make the background black”, “hide the grid lines” or “make the crosshair dashed”.' },
  },
  {
    id: 'link', terms: ['link colour', 'link colours', 'link color', 'link colors', 'linking charts', 'linked charts'], control: 'the colour dot on the chart’s header', title: 'Linking charts and widgets', topic: 'arrange',
    words: [/\b(link|unlink|linking|linked)\b.*\b(charts?|widgets?|watch ?lists?)\b/, /\b(charts?|widgets?)\b.*\b(link|unlink|linked|in sync|sync)\b/, /\bcolou?r (dot|group|link)s?\b/],
    caps: ['widget.setLink'],
    // pages/charts/WidgetHeader.jsx — the dot cycles through the groups on click (nextGroup); grey = not linked
    explain: 'The coloured dot at the left of each widget’s header is its link colour. Widgets with the same colour show the same symbol — pick a ticker in a linked watchlist and every chart in that colour follows. Click the dot to cycle through the colours; grey means not linked.',
    steps: [
      { target: 'widget.link', text: 'This dot is the chart’s link colour — click it to cycle through the colours. Widgets of the same colour show the same symbol; grey means not linked.' },
    ],
    doIt: {
      action: 'widget.setLink', arg: 'color', ask: 'Which link colour?', kind: 'board', widgetArg: 'widget',
      choices: [['A', 'Gold'], ['B', 'Blue'], ['C', 'Green'], ['D', 'Purple'], ['N', 'Not linked']],
    },
  },
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
    words: [/\btime ?frames?\b/, /\b(interval|daily|weekly|monthly|hourly|intraday|minute) (chart|view|bars?)\b/, /\b(daily|weekly|monthly) to (daily|weekly|monthly)\b/, /\b(switch|change|set|put|turn|make)\b.*\bcharts?\b.*\b(to|on|into) (a |the )?(daily|weekly|monthly|hourly|\d+[- ]?(m|min|mins|minutes?|h|hours?))\b/],
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
    id: 'indicators', slots: ['ind'], except: /\banchored vwap\b|\banchor\w*\b.*\bvwap\b/, terms: ['chart settings indicators'], control: 'the chart’s settings gear', title: 'Adding {ind.say}', titleAny: 'Adding and configuring an indicator', topic: 'indicators',
    words: [/\bindicators?\b/, /\b(rsi|macd|vwap|atr|bollinger|studies|study)\b/, MOVING_AVERAGE],
    caps: ['indicator.add'],
    explain: 'Indicators are in Chart settings → Indicators: search for one (RSI, MACD, a moving average…) and add it; click an indicator already on the chart to change its settings, colours and the pane it draws in.',
    steps: [
      GEAR,
      INDICATORS_TAB,
      // with a row selected the right side shows that indicator; ＋ Add to Chart brings the search back (with none selected it is already there)
      { target: { within: 'chartSettings', guide: 'indicators.add' }, name: 'Add to Chart', text: 'Click ＋ Add to Chart.', waitFor: { within: 'chartSettings', aria: 'Search indicators' } },
      { only: 'ind', target: { within: 'chartSettings', aria: 'Search indicators' }, name: 'the search box', text: 'Type {ind.say} here.', waitFor: { within: 'indicators.addSurface', attr: 'data-def-id', value: '{ind.id}' } },
      // one already on the chart shows Active: its row only selects it, and the ＋ beside it is what adds another
      { only: 'ind', target: [{ within: 'indicators.addSurface', aria: 'Add another {ind.name}' }, { within: 'indicators.addSurface', attr: 'data-def-id', value: '{ind.id}' }], name: 'the result', text: '{ind.name} is already on this chart. Click this ＋ to add another.', altText: 'Click {ind.name} to add it to this chart.', waitFor: { not: { within: 'indicators.addSurface', attr: 'data-def-id', value: '{ind.id}' } } },
      // the row just added is the selected one: "SMA 5", not the SMA 50 above it
      { only: 'ind', target: [ROW_ON, ...added()], name: 'the indicator list', text: '{ind.addedSay} is on the chart.{ind.addNext}', noBack: true },
      { unless: 'ind', target: { within: 'chartSettings', aria: 'Search indicators' }, name: 'the search box', text: 'Search for an indicator and add it. The ones already on the chart are listed on the left — click one to change its settings, colours and pane.' },
    ],
    doIt: {
      // the choices are the chart's OWN quick set (catalog rows its right-click menu offers) — never a hand list here
      action: 'indicator.add', arg: 'defId', ask: 'Which indicator?', choicesFrom: 'quickIndicators',
      extra: { inputs: null }, kind: 'indicatorEdits',
    },
  },
  {
    id: 'charts', terms: ['chart grid', 'multi chart', 'several charts'], control: 'the Widgets menu', title: 'Creating and arranging several charts', topic: 'widgets',
    words: [/\b(more|multiple|several|another|new|second|extra|add(ing)? (a )?)\s?charts?\b/, /\b(arrange|grid|side by side|split)\b/, /\b(two|three|four|2|3|4) charts\b/],
    caps: ['widget.add', 'chartGrid.set'],
    explain: 'Add charts from Widgets ▾ → Chart; drag a widget’s header to move it and its edges to resize. Or ask me — “four charts for SPY, QQQ, NVDA and TSLA” sets them up in an even grid in one step (one Undo).',
    steps: [
      { target: 'workspace.widgets', name: 'the Widgets menu', text: 'Open Widgets ▾.', waitFor: 'workspace.widgetsMenu' },
      { target: 'workspace.widgets.chart', name: 'Chart', text: 'Click Chart to add one into the free space. Drag a widget’s header to move it, its edges to resize it.', off: 'Your board is full, so nothing can be added. Close a widget first.' },
      PLACE,
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
      { target: 'workspace.widgets', name: 'the Widgets menu', text: 'To add a watchlist, open Widgets ▾.', waitFor: 'workspace.widgetsMenu' },
      { target: 'workspace.widgets.watchlist', name: 'Watchlist', text: 'Click Watchlist, then pick one of your lists.', off: 'Your board is full, so nothing can be added. Close a widget first.' },
      PLACE,
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
      { target: 'workspace.layoutLibrary', text: 'Open the library.', waitFor: 'workspace.layoutLibraryMenu' },
      // ⭐ PHASE 3: the library itself (pages/charts/LayoutDock.jsx): ＋ New layout and every saved layout; save / rename /
      // duplicate are on each layout's own menu on the bar
      { target: 'workspace.layoutLibraryMenu', text: 'Start a ＋ New layout here, or open any saved one. To save, rename or duplicate a layout, open its own menu on the bar.' },
    ],
    doIt: { say: 'Tell me what to do — for example “open my Swing layout” or “save this as Earnings Week”.' },
  },
  {
    id: 'hideDrawings', terms: ['hide drawings', 'hide all drawings', 'show drawings'], control: 'the drawing toolbar', title: 'Hiding and showing drawings', topic: 'drawings',
    words: [/\b(hide|show|unhide|toggle)\b.*\bdrawings?\b/, /\bdrawings?\b.*\b(hide|hidden|show|disappear)\b/],
    caps: ['drawing.setAllVisible'],
    // components/chart/ChartToolbar.jsx — the eye toggles hideDrawings for this chart; greyed out with no drawings
    explain: 'The eye on the chart’s drawing toolbar hides every drawing on that chart without deleting any of them; click it again to show them. It is greyed out while the chart has no drawings.',
    steps: [
      { target: 'chart.drawingsHide', text: 'This eye hides all the drawings on this chart — nothing is deleted. Click it again to show them.', off: 'This eye hides all the drawings on this chart. It’s greyed out now because this chart has none yet.' },
    ],
    doIt: { say: 'I can hide every drawing on this symbol for you — say “hide all my drawings” (nothing is deleted, and Undo shows them again).' },
  },
  {
    id: 'drawing', slots: ['tool'], terms: ['drawing tools', 'drawing tool', 'drawing toolbar'], control: 'the drawing tools', title: 'Drawing {tool.a} {tool.label}', titleAny: 'Basic drawing tools', topic: 'drawings',
    // a formula's own markers ('put a green arrow under the bar when true') are the Formula Builder's, not a drawing
    except: /\bwhen (it is |it's |its )?(true|false)\b|\bsignal markers?\b|\bformulas?\b/,
    words: [/\bdraw\w*\b/, /\b(trend ?lines?|horizontal (line|level)s?|rectangles?|fib\w*|annotat\w+)\b/, TOOL_NAMED],
    // ⭐ cov-2: a tool that is not only a drawing (an arrow, a note, a measure) counts with a verb that places it
    match: (q) => PLACED_TOOL.test(q) && !!SLOTS.tool.read(q),
    caps: ['drawing.addLevel'],
    explain: 'The drawing tools run along the chart’s toolbar: pick one (a trendline, a horizontal line, a rectangle…) and click on the chart to place it. Click a drawing to restyle, lock or delete it.',
    steps: [
      // a narrow chart squeezes this strip to nothing (two charts with the Agent open): the keyboard still arms a tool
      { unless: 'tool', target: ['chart.drawingTools', 'chart.plot'], text: 'These are the drawing tools for this chart. Scroll this strip for more, pick one, then click on the chart.', altText: 'This chart is too narrow to show its drawing tools right now. Make it wider (close a widget beside it, or close me for a moment), and they appear at its top left.' },
      { unless: 'tool', target: 'chart.tool.horizontal', text: 'Horizontal Line: one click at a price draws a level across the chart.', optional: true },
      { unless: 'tool', target: 'chart.tool.trendline', text: 'Trendline: click two points.', optional: true },
      { only: 'tool', target: ['chart.tool.{tool.id}', 'chart.plot'], name: 'the {tool.label} tool', text: 'Click {tool.label} on the drawing toolbar.', altText: 'I can’t show {tool.label} on the toolbar: this chart is too narrow right now, or you’ve hidden it under Customize. {tool.narrow}', waitFor: { id: 'chart.tool.{tool.id}', on: true, present: true } },
      { only: 'tool', target: 'chart.plot', name: 'the chart', text: '{tool.place}', waitFor: { not: { id: 'chart.tool.{tool.id}', on: true, present: true } } },
      { only: 'tool', target: 'chart.plot', name: 'the chart', text: 'That’s the {tool.label}. Click it to restyle, lock or delete it.', noBack: true },
    ],
    doIt: { say: 'I can draw a horizontal line at a price you give me — for example “draw a line at 450”.' },
  },
  {
    id: 'settings', terms: ['chart settings'], control: 'the chart’s settings gear', title: 'Finding chart settings', topic: 'chartSettings',
    words: [/\b(chart )?settings?\b/, /\b(theme|colou?rs?|background|candles?|grid ?lines?|crosshair|legend)\b/],
    caps: ['chart.setSetting'],
    // C1-127: the gear, right-click → Chart settings and Alt+, are ONE door (ChartPane.openSettings) — the one chartSetup.openSettings opens
    explain: 'Each chart’s settings open from the gear on its header (or right-click the chart → Chart settings, or Alt+,): price style, canvas (background, grid), indicators, header and markers — and UCT Chart Themes for a one-click look.',
    steps: [
      { target: 'chart.settings', text: 'Click the gear to open this chart’s settings.', waitFor: 'chartSettings' },
      { target: 'chartSettings.tab.price', text: 'Price Style, Canvas, Indicators, Header and Markers are the tabs along the top.' },
    ],
    doIt: { say: 'Say “open chart settings” and I’ll open them on this chart for you — or tell me the change, for example “dark theme on this chart”, “hide the grid” or “candles to hollow”.' },
  },

  // ── ⭐ W2-C2: the other pages (/screener, /breadth, /calendar, /journal) ──
  // `surface` = the page a feature lives on (no surface = /charts). A feature is offered, matched and shown ONLY on
  // its own page (guideFeatures / matchFeature), so nothing above changes on /charts. `doIt.kind` names the page's
  // own target kind; a page with no writer for the thing says so and points at the control instead.
  {
    id: 'screenerScreens', surface: 'screener', terms: ['saved screen', 'saved screens', 'screen menu', 'starter screens'], control: 'the Screen menu', title: 'Opening a saved or starter screen', topic: 'savedScreens',
    words: [/\b(saved|starter|my) (screens?|scans?)\b/, /\b(open|switch|load|change|pick)\b.*\b(screens?|scans?)\b/, /\bscreen menu\b/],
    caps: ['screener.openSaved'],
    // pages/screener/focus/ScreenMenu.jsx (Focus layout) · pages/screener/ScreensManager.jsx (classic) — the page's own Screen menu
    explain: 'A screen is a saved set of filters. The Screen menu at the top of the Screener lists your saved screens and UCT’s starter screens — pick one to apply it to the page; Save changes, Save as new and Rename are in the same menu.',
    steps: [
      { target: 'screener.screens', text: 'This is the Screen menu — open it and pick one of your saved screens or a UCT starter to apply it here.' },
    ],
    doIt: { action: 'screener.openSaved', arg: 'screen', ask: 'Which screen?', kind: 'screenerPage', choicesFrom: 'savedScreens' },
  },
  {
    id: 'screenerColumns', surface: 'screener', terms: ['columns', 'screener columns', 'column picker'], control: 'the Columns button', title: 'Choosing the Screener’s columns', topic: 'screener',
    words: [/\bcolumns?\b/],
    caps: ['screener.page'],
    // pages/screener/shell/ShellToolbar.jsx — the Columns picker (the table view)
    explain: 'The Columns button above the results table chooses which columns the table shows — tick the ones you want, start from a ready-made column layout, or reset to the default.',
    steps: [
      { target: 'screener.columns', text: 'Click Columns to choose which columns the table shows (or start from a ready-made layout).' },
    ],
    doIt: { say: 'I can’t change the Screener’s columns for you — the picker is the only place that does it. Click Columns and tick the ones you want.' },
  },
  {
    id: 'screenerFilters', surface: 'screener', terms: ['filters', 'screener filters', 'filter rail'], control: 'the Filters', title: 'Adding and changing Screener filters', topic: 'screener',
    words: [/\bfilters?\b/, /\bfilter(ing)? (by|for|on)\b/, /\bnarrow (down )?(the )?(results|list|screen)\b/],
    caps: ['screener.page'],
    // pages/screener/focus/FocusTopBar.jsx (the Filters button) · pages/screener/shell/FilterRail.jsx (the rail)
    explain: 'Filters decide which stocks the screen keeps — price, volume, ADR, relative strength, sector and the rest. Open Filters (or use the filter rail beside the results), find one by name, set its range, and the matches update as you go.',
    steps: [
      { target: 'screener.filters', text: 'Your filters live here — find one by name, set its range, and the results update as you go.' },
    ],
    doIt: { say: 'I don’t change filters on the page — set them there, or tell me a saved screen to open (“open my Breakout screen”), or ask me to run a screen without changing the page.' },
  },
  {
    id: 'breadthViews', surface: 'breadth', terms: ['breadth tabs', 'breadth views', 'customize breadth', 'breadth metrics'], control: 'the Breadth tabs', title: 'Breadth views and which metrics show', topic: 'breadth',
    words: [/\b(tabs?|views?|customi[sz]e|heat ?map|overview|cot)\b/, /\b(hide|show|choose|pick)\b.*\b(metrics?|columns?)\b/],
    caps: ['breadth.page'],
    // pages/Breadth.jsx — BreadthTabs and the Customize button (the sheet's own CustomizePanel)
    explain: 'The tabs along the top of Breadth switch between its views — the monitor sheet, the heat map, the overview and the others. On the sheet, Customize chooses which metrics show as columns.',
    steps: [
      { target: 'breadth.tabs', text: 'These tabs switch between Breadth’s views.' },
      { target: 'breadth.customize', text: 'On the sheet, Customize chooses which metrics show.', optional: true },
    ],
    doIt: { say: 'Breadth is read only for me — switch the view with the tabs, and ask me what the sheet shows or for a breadth reading.' },
  },
  {
    id: 'breadthTable', surface: 'breadth', terms: ['breadth table', 'breadth sheet', 'breadth monitor', 'monitor sheet'], control: 'the Breadth sheet', title: 'Reading the Breadth sheet', topic: 'breadth',
    words: [/\b(table|sheet|monitor|rows?|readings?)\b/],
    caps: ['breadth.page'],
    // pages/Breadth.jsx — the monitor table (tableWrap)
    explain: 'The Breadth sheet has one row per session, newest at the top, and one column per breadth metric — how many stocks are above their moving averages, up or down big, at new highs or lows. Colours mark how strong or weak each reading is.',
    steps: [
      { target: 'breadth.table', text: 'One row per session, newest at the top; each column is a breadth metric.' },
    ],
    doIt: { say: 'Breadth is read only for me — ask me what the sheet shows, or for a reading (“what’s breadth today?”).' },
  },
  {
    id: 'calendarNextReport', surface: 'calendar', terms: ['next report', 'earnings date', 'calendar search'], control: 'the Calendar search', title: 'Finding when a stock reports', topic: 'calendar',
    words: [/\b(report|reports|reporting|earnings( date)?)\b/, /\b(find|search|look up|jump to)\b.*\b(stock|ticker|symbol|company)\b/],
    caps: ['calendar.nextReport'],
    // pages/calendar/CalendarHeader.jsx — CalendarSearch (filters the week; Enter jumps to the report)
    explain: 'Type a ticker or company in the Calendar’s search: it filters the week on screen, and picking a stock jumps to the week it next reports.',
    steps: [
      { target: 'calendar.search', text: 'Type a ticker here — the week filters as you type, and picking one jumps to when it reports.' },
    ],
    doIt: { say: 'Tell me the ticker — for example “when does NVDA report?” — and I’ll look it up.' },
  },
  {
    id: 'journalNewNote', surface: 'journal', terms: ['new note', 'notes', 'notebook note'], control: 'the + New note button', title: 'Writing a new note', topic: 'journal',
    words: [/\b(new|add|create|write|make|start)\b.*\bnotes?\b/, /\bnotes?\b/],
    caps: ['journal.createNote'],
    // pages/journal-2-0/tabs/NotebookTab.jsx (+ New note) · components/notebook/NewNoteMenu.jsx (Home's New note)
    explain: '+ New note starts a blank note in your Notebook; the arrow beside it starts one from an outline or a template. Notes save as you type.',
    steps: [
      { target: 'journal.newNote', text: 'Click + New note to start a blank note — it saves as you type.' },
    ],
    doIt: { say: 'Tell me what it should say — for example “add a note: NVDA held its 21-day on earnings” — and I’ll add it (Undo moves it to Trash).' },
  },
]

const BY_ID = new Map(GUIDE_FEATURES.map(f => [f.id, f]))
export const GUIDE_IDS = GUIDE_FEATURES.map(f => f.id)
export const guideFeature = (id) => BY_ID.get(id) || null

/** ⭐ W2-C2: the page a feature lives on (no `surface` = the Charts workspace). */
export const surfaceOf = (f) => f?.surface || 'charts'
/** The features of ONE page (no surface = every page — the rails' view). */
export const featuresOn = (surface) => (surface ? GUIDE_FEATURES.filter(f => surfaceOf(f) === surface) : GUIDE_FEATURES)

/** The features THIS member may be shown: on the page they are on, every capability a feature names is in their
 *  manifest right now. */
export function guideFeatures(ctx) {
  let names
  try { names = new Set(manifestFor(ctx).map(c => c.name)) } catch { names = new Set() }
  return featuresOn(ctx?.surface).filter(f => f.caps.every(c => names.has(c)))
}

/** The feature a request is about (its words), among the ones this member may be shown — on THIS page (`surface`,
 *  else ctx.surface, else /charts): a page's words never match on the Charts workspace, nor a chart's on a page. */
export function matchFeature(text, ctx, surface) {
  const q = String(text || '').toLowerCase()
  const on = surface || ctx?.surface || 'charts'
  const list = (ctx ? guideFeatures(ctx) : GUIDE_FEATURES).filter(f => surfaceOf(f) === on)
  return list.find(f => !f.except?.test(q) && (f.words.some(re => re.test(q)) || f.match?.(q))) || null
}
