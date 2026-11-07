// UCT Agent AUTOTEST: UNSEEN batch 4 (2026-11-07), written BEFORE pl-exec's round 3 lands and before any run of it:
//   per-clause mixed targets   one sentence, several clauses, each naming its own chart (a name, a position, a symbol, "this one")
//   scoped undo by kind        "undo the indicator" when the newest change was something else
//   alert thresholds vs range  an RSI alert outside 0-100, at its edges, and a price alert at zero
// Targets are graded by the selection oracle (clicked / intended / landed / told). BROWSER-MOCK-MODEL: plans are scripted.
import { family, op, say, changes, refuses, asks, propose, clarify } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const dr = (r) => `$dr:${r}`
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const vol = (r, state) => op('volume.setState', ch(r), { state })
const add = (r, defId) => op('indicator.add', ie(r), { defId, inputs: null })
const level = (price, r) => op('drawing.addLevel', dr(r), { price, color: null, style: null })
const sym = (r, s) => op('chart.setSymbol', ch(r), { symbol: s })
const undo = (about) => op('agent.undo', '$list:agent', { scope: 'last', about })
const tgt = (intended, click) => ({ target: { intended, click } })

export function unseen4(L) {
  // ── per-clause mixed targets ──────────────────────────────────────────────────────────────────────────────────────────
  const m = family(L, 'u4-clauses', { inv: ['C1-006'], board: 'FOUR' })
  m('target', 'put the QQQ chart on weekly and log scale on this one', [tf('TR', 'W'), scale('sel', 'log')], changes(['TR', 'TL'], [['TR.tf', 'eq', 'W'], ['TL.scale', 'eq', 'log']], { undo: true, ...tgt(['TR', 'TL'], 'TL') }), { select: 'TL', inventory: ['C1-006', 'C1-022'] })
  m('target', 'this one weekly, the top left one monthly', [tf('sel', 'W'), tf('TL', 'M')], changes(['BR', 'TL'], [['BR.tf', 'eq', 'W'], ['TL.tf', 'eq', 'M']], { undo: true, ...tgt(['BR', 'TL'], 'BR') }), { select: 'BR' })
  m('target', 'add rsi here and a macd on the top right', [add('sel', 'rsi'), add('TR', 'macd')], changes(['BL', 'TR'], [['BL.panes', 'delta', 1], ['TR.panes', 'delta', 1]], { undo: true, ...tgt(['BL', 'TR'], 'BL') }), { select: 'BL', inventory: ['C2-004'] })
  m('target', 'hide volume on the middle chart and switch this one to AVGO', [vol('M', 'hidden'), sym('sel', 'AVGO')], changes(['M', 'L'], [['M.volume', 'eq', false], ['L.sym', 'eq', 'AVGO']], { undo: true, ...tgt(['M', 'L'], 'L') }), { board: 'THREE', select: 'L', inventory: ['C1-086', 'C1-001'] })
  m('target', 'log scale on this chart, weekly on the other', [scale('sel', 'log'), tf('B', 'W')], changes(['A', 'B'], [['A.scale', 'eq', 'log'], ['B.tf', 'eq', 'W']], { undo: true, ...tgt(['A', 'B'], 'A') }), { board: 'TWO', select: 'A', inventory: ['C1-006', 'C1-022'] })
  m('target', 'draw a line at 120 on this one and on the TSLA chart', [level(120, 'sel'), level(120, 'BR')], changes(['TR', 'BR'], [['drawings.QQQ', 'len', 1], ['drawings.TSLA', 'len', 1]], { undo: true, ...tgt(['TR', 'BR'], 'TR') }), { select: 'TR', inventory: ['C1-131'] })
  m('target', 'this cell weekly and the bottom left cell monthly', [tf('sel', 'W'), tf('C', 'M')], changes(['A', 'C'], [['A.tf', 'eq', 'W'], ['C.tf', 'eq', 'M']], { undo: true, ...tgt(['A', 'C'], 'A') }), { board: 'MC', select: 'A', inventory: ['C3-056'] })
  m('target', 'the TSLA chart to the hourly and this one too', [tf('BR', '60'), tf('sel', '60')], changes(['BR', 'TL'], [['BR.tf', 'eq', '60'], ['TL.tf', 'eq', '60']], { undo: true, ...tgt(['BR', 'TL'], 'TL') }), { select: 'TL' })
  m('target', 'everything except this chart and the top left on weekly', [tf('TR', 'W'), tf('BR', 'W')], changes(['TR', 'BR'], [['TR.tf', 'eq', 'W'], ['BR.tf', 'eq', 'W'], ['TL.tf', 'eq', 'D'], ['BL.tf', 'eq', 'D']], { undo: true, ...tgt(['TR', 'BR'], 'BL') }), { select: 'BL' })
  m('target', 'this one and the one to its left on the weekly', [tf('sel', 'W'), tf('M', 'W')], changes(['R', 'M'], [['R.tf', 'eq', 'W'], ['M.tf', 'eq', 'W']], { undo: true, ...tgt(['R', 'M'], 'R') }), { board: 'THREE', select: 'R' })
  m('target', 'make this one weekly and the SPY chart log', [tf('sel', 'W'), scale('TL', 'log')], changes(['TR', 'TL'], [['TR.tf', 'eq', 'W'], ['TL.scale', 'eq', 'log']], { undo: true, ...tgt(['TR', 'TL'], 'TR') }), { select: 'TR', inventory: ['C1-006', 'C1-022'] })
  m('target', 'weekly on the NVDA chart and log scale on this one', [], asks(tgt('ask', null)), { select: null, turns: [say('weekly on the NVDA chart and log scale on this one', clarify('Which chart is “this one”? Click it, or pick one:', ['Top-left chart (SPY)', 'Top-right chart (QQQ)', 'Bottom-right chart (TSLA)']))] })

  // ── scoped undo by kind ────────────────────────────────────────────────────────────────────────────────────────────────
  const u = family(L, 'u4-undo-kind', { inv: ['C1-006', 'C2-004'], board: 'TWO', select: 'A' })
  u('followup', [say('weekly and an rsi on this chart', [tf('A', 'W'), add('A', 'rsi')]), say('undo the indicator', [undo('indicator')])], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'W'], ['A.panes', 'same']] })
  u('followup', [say('a line at 120 here', [level(120, 'A')]), say('now weekly', [tf('A', 'W')]), say('undo the drawing', [undo('drawing')])], null, { outcome: 'change', only: ['A'], expect: [['drawingCount', 'eq', 0], ['A.tf', 'eq', 'W']] }, { inventory: ['C1-131', 'C1-006'] })
  u('followup', [say('log scale here', [scale('A', 'log')]), say('add rsi', [add('A', 'rsi')]), say('undo the scale change', [undo('chart')])], null, { outcome: 'change', only: ['A'], expect: [['A.scale', 'eq', 'linear'], ['A.panes', 'delta', 1]] }, { inventory: ['C1-022', 'C2-004'] })
  u('followup', [say('weekly here', [tf('A', 'W')]), say('put AMD on the right chart', [sym('B', 'AMD')]), say('undo the timeframe', [undo('timeframe')])], null, { outcome: 'change', only: ['A', 'B'], expect: [['A.tf', 'eq', 'D'], ['B.sym', 'eq', 'AMD']] })
  u('followup', [say('add rsi', [add('A', 'rsi')]), say('add macd', [add('A', 'macd')]), say('undo the rsi', [undo('indicator')])], null, { outcome: 'change', only: ['A'], expect: [['A.panes', 'delta', 1]] }, { unverifiable: ['which of the two panes is left: the rig reads pane heights, so the check is one indicator pane remains'] })
  u('followup', [say('lines at 100 and 110 here', [level(100, 'A'), level(110, 'A')]), say('weekly', [tf('A', 'W')]), say('undo the drawings', [undo('drawing')])], null, { outcome: 'change', only: ['A'], expect: [['drawingCount', 'eq', 0], ['A.tf', 'eq', 'W']] }, { inventory: ['C1-131'] })
  u('invalid', [say('weekly here', [tf('A', 'W')]), say('undo the indicator', [undo('indicator')])], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'W']], says: 'indicator|nothing|wasn' })
  u('followup', [say('put AMD on the right chart', [sym('B', 'AMD')]), say('log scale on this one', [scale('A', 'log')]), say('undo the symbol', [undo('symbol')])], null, { outcome: 'change', only: ['A', 'B'], expect: [['B.sym', 'eq', 'AAPL'], ['A.scale', 'eq', 'log']] }, { inventory: ['C1-001'] })

  // ── alert thresholds against the indicator's range ─────────────────────────────────────────────────────────────────────
  const IA = '$list:indicatorAlertLibrary'
  const iac = (args) => op('indicatorAlert.create', IA, { plot: null, threshold: null, crossWith: null, chart: ch('A'), trigger: null, timeframe: null, ...args })
  const rsiFirst = say('rsi on this chart', [add('A', 'rsi')])
  const a = family(L, 'u4-alert-range', { inv: ['C2-089'], board: 'TWO', select: 'A' })
  const noAlert = { outcome: 'change', expect: [['ialerts', 'len', 0], ['A.panes', 'delta', 1]], receipt: true }
  const oneAlert = (thr, cond) => changes(['A'], [['ialerts', 'len', 1], ['ialerts.0.threshold', 'eq', thr], ['ialerts.0.condition', 'eq', cond]], { confirm: true })
  a('invalid', [rsiFirst, say('alert me when rsi drops below minus 5', propose([iac({ instance: '$inst:A:RSI', condition: 'below', threshold: -5 })]))], null, noAlert)
  a('invalid', [rsiFirst, say('tell me when rsi is above 100', propose([iac({ instance: '$inst:A:RSI', condition: 'above', threshold: 100 })]))], null, noAlert, { unverifiable: ['above 100 can never fire: refusing it or asking are both right; making it is the defect'] })
  a('invalid', [rsiFirst, say('alert if rsi goes above 100.5', propose([iac({ instance: '$inst:A:RSI', condition: 'above', threshold: 100.5 })]))], null, noAlert)
  a('invalid', [rsiFirst, say('alert when rsi falls under 0', propose([iac({ instance: '$inst:A:RSI', condition: 'below', threshold: 0 })]))], null, noAlert, { unverifiable: ['below 0 can never fire'] })
  a('params', [rsiFirst, say('alert me when rsi gets above 99.5', propose([iac({ instance: '$inst:A:RSI', condition: 'above', threshold: 99.5 })]))], null, oneAlert(99.5, 'above'))
  a('params', [rsiFirst, say('ping me when rsi crosses up through 50', propose([iac({ instance: '$inst:A:RSI', condition: 'cross_above', threshold: 50 })]))], null, oneAlert(50, 'cross_above'))
  a('params', [rsiFirst, say('alert when rsi dips below 0.5', propose([iac({ instance: '$inst:A:RSI', condition: 'below', threshold: 0.5 })]))], null, oneAlert(0.5, 'below'))
  a('invalid', [rsiFirst, say('alert when rsi is above banana', [])], null, { outcome: 'change', expect: [['ialerts', 'len', 0]], receipt: true, says: '\\?|which|number|level' }, { turns: [rsiFirst, say('alert when rsi is above banana', clarify('At what RSI level?', []))] })
  a('invalid', 'set a price alert on SPY at zero', null, refuses({ expect: [['alerts', 'len', 0]] }), { inventory: ['C1-114'], turns: [say('set a price alert on SPY at zero', propose([op('alert.create', '$list:alertLibrary', { symbol: 'SPY', price: 0, direction: 'below' })]))] })
  a('params', 'alert me when the 9 ema crosses above the 20 at 50', null, changes(['A'], [['ialerts', 'len', 1], ['ialerts.0.condition', 'eq', 'cross_above']], { confirm: true }), { inventory: ['C2-090'], turns: [say('alert me when the 9 ema crosses above the 20 at 50', propose([iac({ instance: '$inst:A:EMA 9', condition: 'cross_above', crossWith: '$inst:A:EMA 20', threshold: 50 })]))], unverifiable: ['a cross alert has no threshold: the 50 is ignored or refused, either is right; the check is one cross alert'] })
}
