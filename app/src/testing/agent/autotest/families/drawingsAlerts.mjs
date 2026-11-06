// Inventory part 1: drawings and price alerts. Fixture bars sit near 100-ish, so the prices below are in range for the
// synthetic chart. A price is the test's, never a real market value.
import { family, op, say, changes, refuses, unsupported, reads, propose, asks, clarify } from './dsl.mjs'

export function drawingsAlerts(L) {
  const dr = (r = 'A') => `$dr:${r}`
  const level = (price, r = 'A', extra = {}) => op('drawing.addLevel', dr(r), { price, color: null, style: null, ...extra })
  const d0 = '$drawing:A:0'
  const d = family(L, 'drawing-level', { inv: ['C1-131', 'C1-121', 'C1-146', 'C1-147'] })
  const oneAt = (price, sym = 'SPY') => [[`drawings.${sym}`, 'len', 1], [`drawings.${sym}.0.type`, 'eq', 'horizontal'], [`drawings.${sym}.0.points.0.price`, 'eq', price]]
  d('phrasing', 'mark 120 on this chart', [level(120)], changes(['A'], oneAt(120), { undo: true }))
  d('phrasing', 'I want a line at 118.5', [level(118.5)], changes(['A'], oneAt(118.5), { undo: true }))
  d('phrasing', 'stick a horizontal level at 95', [level(95)], changes(['A'], oneAt(95), { undo: true }))
  d('params', 'dashed line at 110', [level(110, 'A', { style: 'dashed' })], changes(['A'], oneAt(110), { undo: true }))
  d('params', 'red level at 105', [level(105, 'A', { color: '#ef4444' })], changes(['A'], [...oneAt(105), ['drawings.SPY.0', 're', '#ef4444']], { undo: true }))
  d('target', 'draw a line at 130 on the right chart', [level(130, 'B')], changes(['B'], oneAt(130, 'AAPL'), { undo: true }), { select: null })
  d('combo', 'put lines at 100 and 110', [level(100), level(110)], changes(['A'], [['drawings.SPY', 'len', 2]], { undo: true }))
  d('followup', [say('draw a line at 120', [level(120)]), say('move it to 125', [op('drawing.setLevel', dr(), { drawing: d0, price: 125 })])], null, changes(['A'], oneAt(125)))
  d('followup', [say('draw a line at 120', [level(120)]), say('make that red', [op('drawing.style', dr(), { drawing: d0, color: '#ef4444', style: null, width: null })])], null, changes(['A'], [['drawings.SPY.0', 're', '#ef4444']]))
  d('followup', [say('draw a line at 120', [level(120)]), say('delete that line', [op('drawing.remove', dr(), { drawing: d0 })])], null, changes(['A'], [['drawingCount', 'eq', 0]]))
  d('multistep', [say('draw lines at 100 and 110', [level(100), level(110)]), say('clear all my drawings on this chart', propose([op('drawing.clear', dr(), {})]))], null, changes(['A'], [['drawingCount', 'eq', 0]], { confirm: true }))
  d('invalid', 'draw a line at banana', [], asks(), { turns: [say('draw a line at banana', clarify('At what price?', []))] })
  d('invalid', 'draw a line at minus 40', [level(-40)], refuses())
  d('invalid', 'move the line to 130', [], asks(), { turns: [say('move the line to 130', clarify('There are no lines on this chart. Which line?', []))] })
  d('unsupported', 'draw a gann fan from the march low', [], refuses(), { turns: [say('draw a gann fan from the march low', unsupported('UCT has no Gann fan tool.'))] })

  const t = family(L, 'drawing-dated', { inv: ['C1-128', 'C1-134', 'C1-137', 'C1-142'] })
  const seg = { from: { date: '2025-05-01', price: 110 }, to: { date: '2025-08-01', price: 130 }, color: null, style: null }
  const one = (type) => [['drawings.SPY', 'len', 1], ['drawings.SPY.0.type', 'eq', type]]
  t('phrasing', 'connect may 1 to august 1 2025 with a trendline', [op('drawing.addTrendline', dr(), seg)], changes(['A'], one('trendline'), { undo: true }))
  t('phrasing', 'fib retrace from the may 1 2025 low to the aug 1 2025 high', [op('drawing.addFib', dr(), seg)], changes(['A'], one('fib'), { undo: true }))
  t('phrasing', 'box out may to august 2025 between 110 and 130', [op('drawing.addRectangle', dr(), seg)], changes(['A'], one('rect'), { undo: true }))
  t('phrasing', 'anchor a vwap to may 1 2025', [op('drawing.addAvwap', dr(), { date: '2025-05-01', price: 110, color: null })], changes(['A'], one('avwap'), { undo: true }))
  t('params', 'write "breakout" on the chart at 120 on june 2 2025', [op('drawing.addText', dr(), { text: 'breakout', date: '2025-06-02', price: 120, color: null })], changes(['A'], [['drawings.SPY', 'len', 1], ['drawings.SPY.0', 're', 'breakout']], { undo: true }))
  t('params', 'a ray from june 2 2025 at 120', [op('drawing.addHorizontalRay', dr(), { date: '2025-06-02', price: 120, color: null, style: null })], changes(['A'], [['drawings.SPY', 'len', 1]], { undo: true }))
  t('invalid', 'draw a trendline from may 1 2040 to may 2 2040', [op('drawing.addTrendline', dr(), { ...seg, from: { date: '2040-05-01', price: 110 }, to: { date: '2040-05-02', price: 130 } })], refuses())
  t('followup', [say('draw a trendline from may 1 2025 to aug 1 2025', [op('drawing.addTrendline', dr(), seg)]), say('raise the far end by 12', [op('drawing.setAnchors', dr(), { drawing: d0, points: [{ point: 2, date: null, price: 142 }] })])], null, changes(['A'], [['drawings.SPY.0.points.1.price', 'eq', 142], ['drawings.SPY.0.points.0.price', 'eq', 110]]))

  const a = family(L, 'price-alert', { inv: ['C1-114', 'C3-098', 'C3-127'] })
  const alert = (symbol, price, direction) => op('alert.create', '$list:alertLibrary', { symbol, price, direction })
  const made = (sym, price, dir) => [['alerts', 'len', 1], ['alerts.0.sym', 'eq', sym], ['alerts.0.target_price', 'eq', price], ['alerts.0.direction', 'eq', dir]]
  a('phrasing', 'tell me when SPY gets through 300', [], changes([], made('SPY', 300, 'above'), { confirm: true }), { turns: [say('tell me when SPY gets through 300', propose([alert('SPY', 300, 'above')]))] })
  a('phrasing', 'buzz me if NVDA drops under 90', [], changes([], made('NVDA', 90, 'below'), { confirm: true }), { turns: [say('buzz me if NVDA drops under 90', propose([alert('NVDA', 90, 'below')]))] })
  a('params', 'set a price alert on AMD at 150.25 going up', [], changes([], made('AMD', 150.25, 'above'), { confirm: true }), { turns: [say('set a price alert on AMD at 150.25 going up', propose([alert('AMD', 150.25, 'above')]))] })
  a('target', 'alert when this stock breaks 200', [], changes([], made('SPY', 200, 'above'), { confirm: true }), { turns: [say('alert when this stock breaks 200', propose([alert('SPY', 200, 'above')]))] })
  a('followup', [say('alert me if SPY goes above 300', propose([alert('SPY', 300, 'above')])), say('show my alerts', { ops: [op('alert.list', '$list:alertLibrary', { symbol: null, status: null, triggered_today: null })] })], null, changes([], made('SPY', 300, 'above'), { says: 'SPY' }))
  a('multistep', 'alert me above 300 on SPY and below 90 on NVDA', [], changes([], [['alerts', 'len', 2]], { confirm: true }), { turns: [say('alert me above 300 on SPY and below 90 on NVDA', propose([alert('SPY', 300, 'above'), alert('NVDA', 90, 'below')]))] })
  a('invalid', 'set an alert on SPY at minus 5', [], refuses({ expect: [['alerts', 'len', 0]] }), { turns: [say('set an alert on SPY at minus 5', propose([alert('SPY', -5, 'below')]))] })
  a('unsupported', 'text my phone when SPY hits 300', [], refuses({ expect: [['alerts', 'len', 0]] }), { turns: [say('text my phone when SPY hits 300', unsupported('Alerts arrive in UCT, not by text message.'))] })
  a('phrasing', 'do I have any alerts', [op('alert.list', '$list:alertLibrary', { symbol: null, status: null, triggered_today: null })], reads())
}
