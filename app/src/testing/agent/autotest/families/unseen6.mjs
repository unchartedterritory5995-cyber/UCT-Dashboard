// UCT Agent AUTOTEST: UNSEEN batch 6 (2026-11-07), written BEFORE the code lands and before any run of it. Conversational targeting,
// the owner's decision: the last EXPLICITLY NAMED chart stays the target of bare follow-ups ("Change NVDA to weekly." → "Add RSI." →
// "Make it log.") until something redirects: a new name, a position, an ordinal, or a click followed by "this one". A click alone,
// followed by a bare sentence, is ambiguous here and must ask. Relative, negation and compound rules still hold. Drawings and alerts.
//
// Each case is graded on its LAST sentence by the selection oracle (the board just before that sentence vs after it; clicked /
// intended / landed / told). The earlier turns only build the conversation. FOUR (TL SPY, TR QQQ, BL NVDA, BR TSLA) is clicked on TL
// first, so a follow-up that falls back to the click lands somewhere visible. BROWSER-MOCK-MODEL: the plans are scripted.
import { family, op, say, clarify } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const dr = (r) => `$dr:${r}`
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const add = (r, defId) => op('indicator.add', ie(r), { defId, inputs: null })
const level = (price, r) => op('drawing.addLevel', dr(r), { price, color: null, style: null })
const sym = (r, s) => op('chart.setSymbol', ch(r), { symbol: s })
const click = (role) => ({ act: 'click', role })
const askWhich = (text) => say(text, clarify('Which chart?', ['Top-left chart (SPY)', 'Top-right chart (QQQ)', 'Bottom-left chart (NVDA)', 'Bottom-right chart (TSLA)']))
// the last sentence's own outcome, and which charts it may touch
const lands = (roles, expect, click0 = 'TL') => ({ outcome: 'change', only: roles, expect, target: { intended: roles, click: click0 } })
const asks = (click0 = 'TL') => ({ outcome: 'clarify', target: { intended: 'ask', click: click0 } })
const paneUp = (r, n = 1) => [`${r}.panes`, 'delta', n]

export function unseen6(L) {
  // ── a name, then bare follow-ups: the named chart keeps the conversation ────────────────────────────────────────────────
  const n = family(L, 'u6-named-followup', { inv: ['C1-006', 'C2-004'], board: 'FOUR', select: 'TL' })
  n('followup', [say('Change NVDA to weekly.', [tf('BL', 'W')]), say('Add RSI.', [add('BL', 'rsi')]), say('Make it log scale.', [scale('BL', 'log')])], null, lands(['BL'], [['BL.scale', 'eq', 'log']]))
  n('followup', [say('put the QQQ chart on weekly', [tf('TR', 'W')]), say('add macd', [add('TR', 'macd')])], null, lands(['TR'], [paneUp('TR')]))
  n('followup', [say('make the TSLA chart hourly', [tf('BR', '60')]), say('draw a line at 120', [level(120, 'BR')])], null, lands(['BR'], [['drawings.TSLA', 'len', 1]]), { inventory: ['C1-131'] })
  n('followup', [say('NVDA chart to weekly', [tf('BL', 'W')]), say('alert me if it goes above 150', { disposition: 'propose', ops: [op('alert.create', '$list:alertLibrary', { symbol: '$sym:BL', price: 150, direction: 'above' })] })], null, { ...lands(['BL'], [['alerts', 'len', 1], ['alerts.0.sym', 'eq', 'NVDA']]), only: [], confirm: true }, { inventory: ['C1-114'] })
  n('followup', [say('the middle chart on the weekly', [tf('M', 'W')]), say('add rsi', [add('M', 'rsi')]), say('and a macd', [add('M', 'macd')])], null, lands(['M'], [paneUp('M')], 'L'), { board: 'THREE', select: 'L' })
  n('followup', [say('bottom left cell to weekly', [tf('C', 'W')]), say('add rsi', [add('C', 'rsi')])], null, lands(['C'], [paneUp('C')], 'A'), { board: 'MC', select: 'A', inventory: ['C3-056', 'C2-004'] })
  n('followup', [say('put AMD on the top right chart', [sym('TR', 'AMD')]), say('make it weekly', [tf('TR', 'W')])], null, lands(['TR'], [['TR.tf', 'eq', 'W']]), { inventory: ['C1-001', 'C1-006'] })
  n('followup', [say('what timeframe is the NVDA chart on?', { disposition: 'answer', reply: 'The NVDA chart is on the daily.', ops: [] }), say('make it weekly', [tf('BL', 'W')])], null, lands(['BL'], [['BL.tf', 'eq', 'W']]))
  n('followup', [say('NVDA weekly', [tf('BL', 'W')]), say('add rsi', [add('BL', 'rsi')]), say('add macd', [add('BL', 'macd')]), say('log scale too', [scale('BL', 'log')])], null, lands(['BL'], [['BL.scale', 'eq', 'log']]))
  n('followup', [say('TSLA chart weekly', [tf('BR', 'W')]), say('add rsi to the same chart', [add('BR', 'rsi')])], null, lands(['BR'], [paneUp('BR')]))
  n('followup', [say('the right chart weekly', [tf('B', 'W')]), say('add rsi', [add('B', 'rsi')])], null, lands(['B'], [paneUp('B')], null), { board: 'TWO', select: null })
  n('followup', [say('the right chart weekly', [tf('B', 'W')]), say('log scale', [scale('B', 'log')])], null, lands(['B'], [['B.scale', 'eq', 'log']], 'A'), { board: 'TWO', select: 'A' })
  n('followup', [say('rsi on the NVDA chart', [add('BL', 'rsi')]), say('alert me when it crosses above 70', { disposition: 'propose', ops: [op('indicatorAlert.create', '$list:indicatorAlertLibrary', { instance: '$inst:BL:RSI', plot: null, condition: 'cross_above', threshold: 70, crossWith: null, chart: ch('BL'), trigger: null, timeframe: null })] })], null, { ...lands(['BL'], [['ialerts', 'len', 1], ['ialerts.0.sym', 'eq', 'NVDA']]), only: [], confirm: true }, { inventory: ['C2-089'] })
  n('followup', [say('top right cell to monthly', [tf('B', 'M')]), say('draw a line at 120', [level(120, 'B')])], null, lands(['B'], [['drawings.AMD', 'len', 1]], 'A'), { board: 'MC', select: 'A', inventory: ['C3-056', 'C1-131'] })
  n('followup', [say('NVDA weekly', [tf('BL', 'W')]), say('add rsi', [add('BL', 'rsi')]), say('undo', [])], null, lands(['BL'], [['BL.panes', 'delta', -1], ['BL.tf', 'eq', 'W']]), { inventory: ['C2-004'] })

  // ── drawings carried by the conversation ──────────────────────────────────────────────────────────────────────────────
  const d = family(L, 'u6-drawing-followup', { inv: ['C1-131', 'C1-147'], board: 'FOUR', select: 'TL' })
  d('followup', [say('on the TSLA chart draw a line at 120', [level(120, 'BR')]), say('make it red', [op('drawing.style', dr('BR'), { drawing: '$drawing:BR:0', color: '#ef4444', style: null, width: null })])], null, lands(['BR'], [['drawings.TSLA.0', 're', '#ef4444']]))
  d('followup', [say('draw a line at 110 on the QQQ chart', [level(110, 'TR')]), say('move it to 115', [op('drawing.setLevel', dr('TR'), { drawing: '$drawing:TR:0', price: 115 })])], null, lands(['TR'], [['drawings.QQQ.0.points.0.price', 'eq', 115]]), { inventory: ['C1-121'] })
  d('followup', [say('a line at 100 on the NVDA chart', [level(100, 'BL')]), say('and another at 105', [level(105, 'BL')])], null, lands(['BL'], [['drawings.NVDA', 'len', 2]]))

  // ── explicit redirects override the conversation ──────────────────────────────────────────────────────────────────────
  const r = family(L, 'u6-redirect', { inv: ['C1-006', 'C2-004'], board: 'FOUR', select: 'TL' })
  r('target', [say('NVDA weekly', [tf('BL', 'W')]), say('now the SPY chart log', [scale('TL', 'log')]), say('add rsi', [add('TL', 'rsi')])], null, lands(['TL'], [paneUp('TL')]))
  r('target', [say('NVDA weekly', [tf('BL', 'W')]), click('BR'), say('add rsi to this one', [add('sel', 'rsi')])], null, lands(['BR'], [paneUp('BR')], 'BR'))
  r('target', [say('NVDA weekly', [tf('BL', 'W')]), say('the second chart to monthly', [tf('TR', 'M')]), say('add rsi', [add('TR', 'rsi')])], null, lands(['TR'], [paneUp('TR')]))
  r('target', [say('QQQ weekly', [tf('TR', 'W')]), say('not that one, the TSLA chart: add rsi', [add('BR', 'rsi')])], null, lands(['BR'], [paneUp('BR')]))
  r('target', [say('NVDA weekly', [tf('BL', 'W')]), say('make this one log', [scale('sel', 'log')])], null, lands(['TL'], [['TL.scale', 'eq', 'log']]))
  r('target', [say('NVDA chart weekly', [tf('BL', 'W')]), click('BL'), say('add rsi', [add('BL', 'rsi')])], null, lands(['BL'], [paneUp('BL')], 'BL'))

  // ── ambiguous: it asks ────────────────────────────────────────────────────────────────────────────────────────────────
  const a = family(L, 'u6-ambiguous', { inv: ['C1-006'], board: 'FOUR', select: 'TL' })
  a('target', [say('NVDA weekly', [tf('BL', 'W')]), click('BR'), askWhich('add rsi')], null, asks('BR'))
  a('target', [say('top left weekly and bottom right monthly', [tf('TL', 'W'), tf('BR', 'M')]), askWhich('add rsi')], null, asks())
  a('target', [askWhich('make the NVDA chart weekly')], null, asks(null), { board: 'TWIN', select: null })
  a('target', [say('the SPY chart and the QQQ chart weekly', [tf('TL', 'W'), tf('TR', 'W')]), askWhich('now log scale')], null, asks())

  // ── relative, negation and compound still hold after a name ────────────────────────────────────────────────────────────
  const x = family(L, 'u6-rules-hold', { inv: ['C2-004'], board: 'FOUR', select: 'TL' })
  x('target', [say('NVDA weekly', [tf('BL', 'W')]), say('add rsi to every chart except that one', [add('TL', 'rsi'), add('TR', 'rsi'), add('BR', 'rsi')])], null, lands(['TL', 'TR', 'BR'], [paneUp('TL'), paneUp('TR'), paneUp('BR')]))
  x('target', [say('NVDA weekly', [tf('BL', 'W')]), say('add rsi to the chart above it', [add('TL', 'rsi')])], null, lands(['TL'], [paneUp('TL')]))
  x('target', [say('QQQ weekly', [tf('TR', 'W')]), say('add rsi to it and to the TSLA chart', [add('TR', 'rsi'), add('BR', 'rsi')])], null, lands(['TR', 'BR'], [paneUp('TR'), paneUp('BR')]))
  x('target', [say('the TSLA chart log', [scale('BR', 'log')]), say('the chart to its left too', [scale('BL', 'log')])], null, lands(['BL'], [['BL.scale', 'eq', 'log']]), { inventory: ['C1-022'] })
}
