// ── UCT Agent PRODUCT GUIDE: held-out teaching phrasings ─────────────────────────────────────────────────────
//
// Written AFTER the registry, by hand, in words the registry's patterns were not designed around. The first run's score
// is the honest number (docs/agent/PHASE2-PRODUCT-GUIDE.md, "Held-out result"). ⛔ Do not edit a pattern to turn a line
// here green and then count it: a row the instant path misses is marked `model` and stays that way, because it reaches
// the real planner (GUIDE_WORDS / the guide routing group carry it there), and a deterministic test proves nothing about
// what that model will do. `model` rows assert only that the instant path does not pick a WRONG walkthrough.

import { describe, it, expect, beforeAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { slotValues } from './guide/slots'
import { guideFeature } from './guide/registry'

beforeAll(() => { registerBuiltins() })

const route = (q) => getCapability('guide.show').fast({ raw: q, host: { surface: 'charts' } })

// [ phrasing, the walkthrough it must reach, { slot: id } it must read ]
const INSTANT = [
  ['how would I go about putting RSI on this chart', 'indicators', { ind: 'rsi' }],
  ['how can I stick a MACD on my chart', 'indicators', { ind: 'macd' }],
  ['where would I find the bollinger bands', 'indicators', {}],
  ['show me how the color of my 50 SMA gets changed', 'indicatorColor', {}],
  ['walk me through recoloring the VWAP line', 'indicatorColor', {}],
  ['how do I make the RSI line thicker', 'indicatorEdit', { field: 'lineWidth' }],
  ['how do I change the RSI length', 'indicatorEdit', { field: 'period' }],
  ['teach me to draw a fib', 'drawing', { tool: 'fib' }],
  ['how do i put a rectangle on the chart', 'drawing', { tool: 'rect' }],
  ['walk me through drawing a pitchfork', 'drawing', { tool: 'pitchfork' }],
  ['how can I sketch a trend line between two lows', 'drawing', { tool: 'trendline' }],
  ['how do I get 4 charts on screen', 'multiChart', { grid: '2x2' }],
  ['show me how to view 9 charts at once', 'multiChart', { grid: '3x3' }],
  ['how do I do a 2x3 layout', 'multiChart', { grid: '2x3' }],
  ['how do I make this chart wider', 'widgetResize', {}],
  ['how can I shrink that widget', 'widgetResize', {}],
  ['where do I save my board', 'layoutSave', {}],
  ['how would I save this workspace', 'layoutSave', {}],
  ['how do I get alerted when RSI goes over 70', 'alertIndicator', {}],
  ['how do I set up an alert for a stock price', 'alertPrice', {}],
  ['how can I drag a widget to the other side', 'widgetMove', {}],
  ['how do I get rid of this widget', 'widgetHeader', { ctl: 'close' }],
  ['how do I put a chart on my second monitor', 'widgetHeader', { ctl: 'popOut' }],
  ['how do I jump to a certain date', 'goToDate', {}],
  ['how do I overlay AMD on this chart to compare', 'compare', {}],
  ['show me how replay works', 'replay', {}],
  ['how do I turn off the watermark', 'chartSetting', {}],
  ['how do I hide the grid lines', 'chartSetting', {}],
  ['how do I get a news widget on my board', 'widgetAdd', { widget: 'tradeExchangeNews' }],   // the menu's "News" chip IS that widget ("News & Catalysts" is the other)
  ['where are the settings for the breadth widget', 'widgetSettings', { widget: 'breadth' }],
]
// the instant path does not recognise these as teaching at all, or not as this feature: they rely on the REAL model
const MODEL = [
  'what is the way to add an EMA here',
  'i want to learn how to draw a channel',
  'could you explain how I would save a layout',
  'i have no idea how to resize these charts',
  'i need four charts, how',
  'which button makes a price alert',
  'is there a way to change an indicator color',
  'how does one change the crosshair',
  'what do I click to change the timeframe',
  'help me add a watchlist',
]

describe('held-out: the instant path', () => {
  it.each(INSTANT)('%s', (q, feature, slots) => {
    const got = route(q)
    expect(got?.feature).toBe(feature)
    const v = slotValues(guideFeature(feature), got.detail || q)
    for (const [k, id] of Object.entries(slots)) expect(v[k]?.id).toBe(id)
  })
})

describe('held-out: what depends on the real model', () => {
  it.each(MODEL)('%s stays the model’s, or reaches a guide walkthrough', (q) => {
    const got = route(q)
    if (got) expect(guideFeature(got.feature)).toBeTruthy()
  })
})
