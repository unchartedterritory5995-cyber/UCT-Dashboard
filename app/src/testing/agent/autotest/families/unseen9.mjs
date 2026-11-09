// UCT Agent AUTOTEST: UNSEEN batch 9 (2026-11-09), written BEFORE any run of it (owner's overnight focus list):
//   multistep-undo   several steps, then Undo of one step, of the whole request, and past the start
//   scanner-filters  combined filters, ranges, sorting, refining, a saved screen and the scanner widget's scans
//   ind-library      settings across the indicator library beyond the common few (ADX, Keltner, Williams %R, Ichimoku, Donchian,
//                    CCI, SuperTrend), input keys read from components/chart/engine/nativeRegistry.js
//   refs-boards      relative and ambiguous chart references on 3-, 4- and 6-chart boards (SIX: 3 x 2, the bottom row shares
//                    the top row's first two link colours, so SPY and QQQ each name two charts there)
// The walkthrough part of the batch (start, completion, cancel, chart switch on SIX) is in tutorialCases.mjs (`tut9-`).
// BROWSER-MOCK-MODEL: plans are scripted; the oracle reads the board; targets by the selection oracle. Fixture data only.
import { family, op, say, changes, reads, asks, propose, clarify } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const dr = (r) => `$dr:${r}`
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const add = (r, defId, inputs = null) => op('indicator.add', ie(r), { defId, inputs })
const upd = (r, inst, inputs) => op('indicator.update', ie(r), { instance: inst, inputs })
const level = (price, r) => op('drawing.addLevel', dr(r), { price, color: null, style: null })
const kv = (o) => Object.entries(o).map(([key, value]) => ({ key, value }))
const paneUp = (r, n = 1) => [`${r}.panes`, 'delta', n]
const px = (r) => [`${r}.pixels`, 'changed']
const tgt = (intended, click) => ({ target: { intended, click } })

export function unseen9(L) {
  // ── several steps, then Undo ───────────────────────────────────────────────────────────────────────────────────────────
  const u = family(L, 'u9-multistep-undo', { inv: ['C1-006', 'C2-004'], board: 'TWO', select: 'A' })
  u('followup', [say('top left weekly and an rsi on the bottom right', [tf('TL', 'W'), add('BR', 'rsi')]), say('undo all of that', [op('agent.undo', '$list:agent', { scope: 'all', about: null })])], null, { outcome: 'change', only: ['TL', 'BR'], expect: [['TL.tf', 'eq', 'D'], ['BR.panes', 'same']] }, { board: 'FOUR', select: null })
  u('followup', [say('add rsi and a macd here', [add('A', 'rsi'), add('A', 'macd')]), say('set the rsi period to 21', [upd('A', '$inst:A:RSI', kv({ period: 21 }))]), say('undo', [])], null, { outcome: 'change', only: ['A'], expect: [paneUp('A', 2)] }, { unverifiable: ['the RSI period itself (its pane has no chip the rig reads): the check is both panes stay after one undo'] })
  u('followup', [say('draw lines at 100, 110 and 120 here', [level(100, 'A'), level(110, 'A'), level(120, 'A')]), say('undo', [])], null, { outcome: 'change', only: ['A'], expect: [['drawingCount', 'eq', 0]] }, { inventory: ['C1-131'] })
  u('followup', [say('weekly', [tf('A', 'W')]), say('log scale', [scale('A', 'log')]), say('add rsi', [add('A', 'rsi')]), say('undo all of that', [op('agent.undo', '$list:agent', { scope: 'all', about: null })])], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'W'], ['A.scale', 'eq', 'log'], ['A.panes', 'same']] })
  u('followup', [say('switch to NVDA, weekly and log in one go', [op('chart.setSymbol', ch('A'), { symbol: 'NVDA' }), tf('A', 'W'), scale('A', 'log')]), say('undo', [])], null, { outcome: 'change', only: ['A'], expect: [['A.sym', 'eq', 'SPY'], ['A.tf', 'eq', 'D'], ['A.scale', 'eq', 'linear']] }, { inventory: ['C1-001', 'C1-006', 'C1-022'] })
  u('followup', [say('weekly here', [tf('A', 'W')]), say('undo', []), say('undo again', [])], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'D']], says: 'nothing|no more|already' }, { unverifiable: ['the wording when there is nothing left to undo'] })

  // ── scanner and filter combinations ────────────────────────────────────────────────────────────────────────────────────
  const s = family(L, 'u9-scanner-filters', { inv: ['C3-107', 'C3-118'], board: 'SCAN', select: null })
  const run = (filters, extra = {}) => op('screener.run', '$list:screener', { filters, sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null, logic: null, rank: null, ...extra })
  const f = (field, opr, value, max = null) => ({ field, op: opr, value, max, values: null })
  s('combo', 'stocks over 20 dollars with ADR above 5, sorted by ADR', [run([f('price', 'gt', 20), f('adr_pct', 'gt', 5)], { sort_field: 'adr_pct', sort_dir: 'desc' })], reads())
  s('followup', [say('screen for ADR over 4', [run([f('adr_pct', 'gt', 4)])]), say('now only the ones above 50 bucks', [run([f('price', 'gt', 50)], { mode: 'refine' })])], null, reads())
  s('params', 'scan for price between 10 and 50 with ADR over 3', [run([f('price', 'between', 10, 50), f('adr_pct', 'gt', 3)])], reads())
  s('phrasing', 'put the one-year highest volume scan in the scanner', [op('widget.showScan', '$list:board', { widget: 'w-scan', scan: 'highest-volume-1y' })], { outcome: 'change', expect: [['faces.scanner', 'changed']] })
  s('phrasing', 'run the UCT Momentum screen', [op('screener.runSaved', '$list:screener', { screen: 'starter-momentum', show: null, as: null })], reads())
  s('phrasing', 'make me a copy of the UCT Momentum screen called Momo Copy', null, { outcome: 'change', expect: [['screens', 'has', 'Momo Copy']], confirm: true }, { turns: [say('make me a copy of the UCT Momentum screen called Momo Copy', propose([op('screener.duplicateSaved', '$list:savedScreenLibrary', { screen: 'starter-momentum', name: 'Momo Copy' })]))] })

  // ── settings across the indicator library ──────────────────────────────────────────────────────────────────────────────
  const i = family(L, 'u9-ind-library', { inv: ['C2-005'], board: 'TWO', select: 'A' })
  i('params', 'add ADX with a 10 period', [add('A', 'adx', kv({ period: 10 }))], changes(['A'], [paneUp('A')], { undo: true }))
  i('params', 'keltner channels with a 3 ATR multiplier', [add('A', 'keltner', kv({ multiplier: 3 }))], changes(['A'], [px('A')], { undo: true }))
  i('phrasing', 'add williams percent R', [add('A', 'williamsR')], changes(['A'], [paneUp('A')], { undo: true }), { inventory: ['C2-004'] })
  i('params', 'ichimoku with a 7 period tenkan', [add('A', 'ichimoku', kv({ tenkanPeriod: 7 }))], changes(['A'], [px('A')], { undo: true }))
  i('params', 'a 55 period donchian channel', [add('A', 'donchian', kv({ period: 55 }))], changes(['A'], [px('A')], { undo: true }))
  i('followup', [say('add cci', [add('A', 'cci')]), say('make the cci 30 periods', [upd('A', '$inst:A:CCI', kv({ period: 30 }))])], null, changes(['A'], [paneUp('A')]), { inventory: ['C2-024'], unverifiable: ['the CCI period itself (no chip): the pane and a receipt'] })
  i('phrasing', 'put supertrend on this chart', [add('A', 'superTrend')], changes(['A'], [px('A')], { undo: true }), { inventory: ['C2-004'] })

  // ── relative and ambiguous chart references on 3-, 4- and 6-chart boards ──────────────────────────────────────────────
  const r = family(L, 'u9-refs-boards', { inv: ['C1-006'], board: 'SIX' })
  r('target', 'make the one below this weekly', [tf('BM', 'W')], changes(['BM'], [['BM.tf', 'eq', 'W']], { undo: true, ...tgt(['BM'], 'TM') }), { select: 'TM' })
  r('target', 'add rsi to the chart two to the left', [add('BL', 'rsi')], changes(['BL'], [paneUp('BL')], { undo: true, ...tgt(['BL'], 'BR') }), { select: 'BR', inventory: ['C2-004'] })
  r('target', 'the middle chart on the bottom row on log', [scale('BM', 'log')], changes(['BM'], [['BM.scale', 'eq', 'log']], { undo: true, ...tgt(['BM'], 'TL') }), { select: 'TL', inventory: ['C1-022'] })
  r('target', 'make the middle one weekly', [], asks(tgt('ask', null)), { select: null, turns: [say('make the middle one weekly', clarify('The top or the bottom middle chart?', ['Top-middle chart (QQQ)', 'Bottom-middle chart (SPY)']))] })
  r('target', 'every chart in the top row weekly', [tf('TL', 'W'), tf('TM', 'W'), tf('TR', 'W')], changes(['TL', 'TM', 'TR'], [['TL.tf', 'eq', 'W'], ['TM.tf', 'eq', 'W'], ['TR.tf', 'eq', 'W']], { undo: true, ...tgt(['TL', 'TM', 'TR'], 'BM') }), { select: 'BM' })
  r('target', 'the TSLA chart weekly', [tf('BL', 'W')], changes(['BL'], [['BL.tf', 'eq', 'W']], { undo: true, ...tgt(['BL'], 'TR') }), { select: 'TR' })
  r('target', 'make the chart diagonally opposite this one weekly', [tf('BR', 'W')], changes(['BR'], [['BR.tf', 'eq', 'W']], { undo: true, ...tgt(['BR'], 'TL') }), { board: 'FOUR', select: 'TL' })
  r('target', 'both charts to the right of this one on log', [scale('M', 'log'), scale('R', 'log')], changes(['M', 'R'], [['M.scale', 'eq', 'log'], ['R.scale', 'eq', 'log']], { undo: true, ...tgt(['M', 'R'], 'L') }), { board: 'THREE', select: 'L', inventory: ['C1-022'] })
}
