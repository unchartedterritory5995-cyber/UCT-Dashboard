// UCT Agent AUTOTEST: UNSEEN batch 2 (2026-11-07). Written BEFORE any run of it, after the round-1 results only, by an author who
// had not run these requests. It covers families neither the public set nor batch 1 probed: Multi Chart sync and groups, saved grids,
// indicator templates, indicator alerts, compare and overlay, chart type and style, session and timezone, undo chains.
//
// BROWSER-MOCK-MODEL: each plan is scripted and reads its refs from the request the panel really sent. A pass proves the plan executes
// on the real components (or that a request with no capability is refused without faking a change). It proves nothing about whether a
// model would pick that plan. Indicator templates need VITE_INDICATOR_TEMPLATES_ENABLED=1 (run.mjs --env); without it they report as
// what the product does with the flag off. Fixture prices only.
import { family, op, say, changes, refuses, reads, asks, unsupported, propose, clarify, answer } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const dr = (r) => `$dr:${r}`
const px = (r) => [`${r}.pixels`, 'changed']
const paneUp = (r, n = 1) => [`${r}.panes`, 'delta', n]
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const rsi = (r) => op('indicator.add', ie(r), { defId: 'rsi', inputs: null })
const level = (price, r = 'A') => op('drawing.addLevel', dr(r), { price, color: null, style: null })
const cmp = (r, add, remove = [], clear = false) => op('chart.compare', ch(r), { add, remove, clear })
// a request with no capability behind it. recount.mjs never counts an `unsupported` request as execution coverage of its row
const nope = (text, reply, extra = {}) => [text, [], refuses(), { turns: [say(text, unsupported(reply))], ...extra }]

export function unseen2(L) {
  // ── Multi Chart: sync, groups, cell style and session ─────────────────────────────────────────────────────────────────
  const m = family(L, 'u2-multichart', { inv: ['C3-045'], board: 'MC', select: null })
  m('unsupported', ...nope('sync the crosshair across every cell', 'Crosshair sync is a Multi Chart toolbar switch; I can\'t flip it from here.'))
  m('unsupported', ...nope('lock the time range so all the cells scroll together', 'Time-range sync is a Multi Chart toolbar switch; I can\'t flip it from here.'))
  m('unsupported', ...nope('turn on groups mode and load my Momentum group', 'Groups mode is set from the Multi Chart toolbar.'))
  m('unsupported', ...nope('step to the next group', 'Stepping groups is on the Multi Chart toolbar.'))
  m('unsupported', ...nope('maximize the top right cell', 'Maximize is the cell\'s own button.'))
  m('target', 'make the bottom left cell a line chart', [op('chart.setType', ch('C'), { type: 'line' })], changes(['C'], [px('C')], { undo: true }), { inventory: ['C3-057'] })
  m('target', 'bars instead of candles in the top right cell', [op('chart.setType', ch('B'), { type: 'bars' })], changes(['B'], [px('B')], { undo: true }), { inventory: ['C3-057'] })
  m('target', 'regular hours only in the top left cell', [op('chart.setSession', ch('A'), { mode: 'regular' })], { outcome: 'answer', says: 'already|regular' }, { inventory: ['C3-058'], unverifiable: ['a daily cell already shows regular hours, so the right answer is a no-op that says so: clock-dependent outside regular hours'] })
  m('combo', 'top left weekly, top right monthly', [tf('A', 'W'), tf('B', 'M')], changes(['A', 'B'], [['A.tf', 'eq', 'W'], ['B.tf', 'eq', 'M']], { undo: true }), { inventory: ['C3-056'] })

  // ── saved grids: Multi Chart grids have no Agent capability; a board's layout does ───────────────────────────────────────
  const g = family(L, 'u2-saved-grids', { inv: ['C3-053'], board: 'MC', select: null })
  g('unsupported', ...nope('save this grid as Tech Four', 'Saving a Multi Chart grid is on its toolbar; I can\'t save one.'))
  g('unsupported', ...nope('load my saved grid called Semis', 'Saved grids open from the Multi Chart toolbar.', { inventory: ['C3-052'] }))
  g('unsupported', ...nope('delete the Semis grid', 'Saved grids are managed from the Multi Chart toolbar.', { inventory: ['C3-055'] }))
  g('params', 'a 2 by 2 of SPY QQQ DIA MSFT on the hourly', [op('chartGrid.set', '$list:board', { symbols: ['SPY', 'QQQ', 'DIA', 'MSFT'], timeframe: '60', layout: 'grid', new_charts: null, watchlist: null, replace: true })], { outcome: 'change', expect: [['chartCount', 'eq', 4]], undo: true }, { board: 'FOUR', inventory: ['C3-042'] })

  // ── indicator templates (dark flag) ──────────────────────────────────────────────────────────────────────────────────
  const T = '$list:indicatorTemplateLibrary'
  const t = family(L, 'u2-indicator-templates', { inv: ['C2-049'], board: 'TWO', select: 'A' })
  t('phrasing', 'which indicator templates have I saved', [op('indicatorTemplate.list', T, {})], reads())
  t('followup', [say('add rsi here', [rsi('A')]), say('save the indicators on this chart as Momo Set', propose([op('indicatorTemplate.save', T, { name: 'Momo Set', chart: ch('A') })]))], null, changes(['A'], [['written.indicator_templates', 're', 'Momo Set']], { confirm: true }))
  t('followup', [say('add rsi here', [rsi('A')]), say('save these indicators as Momo Set', propose([op('indicatorTemplate.save', T, { name: 'Momo Set', chart: ch('A') })])), say('now put Momo Set on the right chart', [op('indicatorTemplate.apply', ie('B'), { template: 'Momo Set' })])], null, changes(['A', 'B'], [paneUp('B')]))
  t('followup', [say('add rsi here', [rsi('A')]), say('save these indicators as Momo Set', propose([op('indicatorTemplate.save', T, { name: 'Momo Set', chart: ch('A') })])), say('actually delete the Momo Set template', propose([op('indicatorTemplate.delete', T, { name: 'Momo Set' })]))], null, changes(['A'], [['written.indicator_templates', 'notRe', 'Momo Set']], { confirm: true }))
  t('invalid', 'apply my Banana Split indicator template', [op('indicatorTemplate.apply', ie('A'), { template: 'Banana Split' })], refuses({ expect: [['A.chips', 'same'], ['A.panes', 'same']] }))

  // ── indicator alerts beyond the public threshold cases ───────────────────────────────────────────────────────────────
  const IA = '$list:indicatorAlertLibrary'
  const iac = (args) => op('indicatorAlert.create', IA, { plot: null, threshold: null, crossWith: null, chart: null, trigger: null, timeframe: null, ...args })
  const a = family(L, 'u2-indicator-alerts', { inv: ['C2-089'], board: 'TWO', select: null })
  a('target', [say('rsi on the right chart', [rsi('B')]), say('alert me when that rsi crosses above 50', propose([iac({ instance: '$inst:B:RSI', condition: 'cross_above', threshold: 50, chart: ch('B') })]))], null, changes(['B'], [['ialerts', 'len', 1], ['ialerts.0.sym', 'eq', 'AAPL'], ['ialerts.0.condition', 'eq', 'cross_above'], ['ialerts.0.threshold', 'eq', 50]], { confirm: true }))
  a('params', [say('rsi here', [rsi('A')]), say('warn me if it drops under 25 on the weekly', propose([iac({ instance: '$inst:A:RSI', condition: 'below', threshold: 25, chart: ch('A'), timeframe: 'W' })]))], null, changes(['A'], [['ialerts', 'len', 1], ['ialerts.0.threshold', 'eq', 25], ['ialerts.0.tf', 're', 'W']], { confirm: true }), { select: 'A', inventory: ['C2-093'] })
  a('target', 'tell me when the 9 ema drops below the 20 on the right chart', null, changes(['B'], [['ialerts', 'len', 1], ['ialerts.0.condition', 'eq', 'cross_below'], ['ialerts.0.sym', 'eq', 'AAPL']], { confirm: true }), { inventory: ['C2-090'], turns: [say('tell me when the 9 ema drops below the 20 on the right chart', propose([iac({ instance: '$inst:B:EMA 9', condition: 'cross_below', crossWith: '$inst:B:EMA 20', chart: ch('B') })]))] })
  a('phrasing', 'list my indicator alerts', [op('indicatorAlert.list', IA, { symbol: null, status: null })], reads(), { inventory: ['C2-097'] })
  a('invalid', [say('rsi here', [rsi('A')]), say('alert when rsi goes above 150', propose([iac({ instance: '$inst:A:RSI', condition: 'above', threshold: 150, chart: ch('A') })]))], null, { outcome: 'change', expect: [['ialerts', 'len', 0], paneUp('A')], receipt: true }, { select: 'A', unverifiable: ['whether 150 is refused or accepted is the product\'s rule (RSI tops out at 100): the check is that no alert was made'] })
  a('invalid', 'alert me when the stochastic crosses 80', [], asks(), { select: 'A', turns: [say('alert me when the stochastic crosses 80', clarify('There is no stochastic on this chart. Which indicator should it watch?', ['RSI', 'EMA 9']))] })

  // ── compare and overlay ───────────────────────────────────────────────────────────────────────────────────────────────
  const c = family(L, 'u2-compare', { inv: ['C1-034'], board: 'TWO', select: 'A' })
  c('combo', 'overlay QQQ and DIA on this chart', [cmp('A', ['QQQ', 'DIA'])], changes(['A'], [px('A')], { undo: true }))
  c('followup', [say('overlay QQQ and DIA here', [cmp('A', ['QQQ', 'DIA'])]), say('take QQQ off again', [cmp('A', [], ['QQQ'])])], null, changes(['A'], [px('A')]), { inventory: ['C1-036'] })
  c('followup', [say('compare this with QQQ', [cmp('A', ['QQQ'])]), say('give the comparison its own scale', [op('chartSetup.compareDisplay', ch('A'), { symbols: [], scale: 'new', visible: null, groupOnly: null })])], null, changes(['A'], [px('A')]), { inventory: ['C1-040'] })
  c('followup', [say('compare this with QQQ', [cmp('A', ['QQQ'])]), say('hide SPY itself and just show the comparison', [op('chartSetup.compareDisplay', ch('A'), { symbols: [], scale: null, visible: null, groupOnly: true })])], null, changes(['A'], [px('A')]), { inventory: ['C1-041'] })
  c('target', 'compare the top right chart with SPY', [cmp('TR', ['SPY'])], changes(['TR'], [px('TR')], { undo: true }), { board: 'FOUR', select: 'BL' })
  c('invalid', 'compare SPY against SPY here', [cmp('A', ['SPY'])], refuses({ expect: [['A.pixels', 'same']] }))
  c('invalid', 'overlay ZZQXW on this chart', [cmp('A', ['ZZQXW'])], refuses({ expect: [['A.pixels', 'same']] }))

  // ── chart type and style ──────────────────────────────────────────────────────────────────────────────────────────────
  const s = family(L, 'u2-chart-style', { inv: ['C1-013'], board: 'TWO', select: 'A', unverifiable: ['that the picture is the named style: the check is that the pixels changed'] })
  const set = (r, setting, value) => op('chart.setSetting', ch(r), { setting, value })
  s('phrasing', 'hollow candles please', [op('chart.setType', ch('A'), { type: 'hollow' })], changes(['A'], [px('A')], { undo: true }))
  s('params', 'show the right chart as an area chart', [op('chart.setType', ch('B'), { type: 'area' })], changes(['B'], [px('B')], { undo: true }), { select: null })
  s('params', 'HLC bars on this one', [op('chart.setType', ch('A'), { type: 'hlc' })], changes(['A'], [px('A')], { undo: true }))
  s('phrasing', 'flip the price scale upside down', [set('A', 'invertScale', true)], changes(['A'], [px('A')], { undo: true }), { inventory: ['C1-024'] })
  s('followup', [say('switch this to bars', [op('chart.setType', ch('A'), { type: 'bars' })]), say('now make the bars thin', [set('A', 'candles.thinBars', true)])], null, changes(['A'], [px('A')]), { inventory: ['C1-018'], unverifiable: ['thin bars apply to Bars and HLC only (the product refuses them on candles): the second step is checked as part of the end picture'] })
  s('params', 'bigger text on the chart, size 16', [set('A', 'textSize', 16)], changes(['A'], [px('A')], { undo: true }), { inventory: ['C1-055'] })
  s('phrasing', 'heikin ashi candles on the right chart', [set('B', 'heikinAshi', true)], changes(['B'], [px('B')], { undo: true }), { select: null, inventory: ['C1-016'] })
  s('invalid', 'make the candles triangles', [], refuses(), { turns: [say('make the candles triangles', unsupported('UCT draws candles, hollow candles, bars, HLC, line and area. Triangles aren\'t one of them.'))] })

  // ── session and timezone ──────────────────────────────────────────────────────────────────────────────────────────────
  const z = family(L, 'u2-session-tz', { inv: ['C1-019'], board: 'TWO5', select: null })
  z('target', 'cut premarket and after hours from the right chart', [op('chart.setSession', ch('B'), { mode: 'regular' })], changes(['B'], [['B.session', 'changed']], { undo: true }))
  z('followup', [say('regular hours on both charts', [op('chart.setSession', ch('A'), { mode: 'regular' }), op('chart.setSession', ch('B'), { mode: 'regular' })]), say('bring extended back on the left one only', [op('chart.setSession', ch('A'), { mode: 'extended' })])], null, changes(['A', 'B'], [['B.session', 'changed'], ['A.session', 'same']]))
  z('unsupported', ...nope('show this chart in London time', 'Charts show New York time; there is no timezone setting.'))
  z('phrasing', 'what timezone are these candles in', [], reads({ says: 'New York|Eastern|ET' }), { turns: [say('what timezone are these candles in', answer('These charts show US Eastern (New York) time.'))] })

  // ── undo chains ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const u = family(L, 'u2-undo', { inv: ['C1-006', 'C2-004'], board: 'TWO', select: 'A' })
  u('followup', [say('weekly', [tf('A', 'W')]), say('log scale', [scale('A', 'log')]), say('undo', [])], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'W'], ['A.scale', 'eq', 'linear']] })
  u('followup', [say('weekly, log and an rsi', [tf('A', 'W'), scale('A', 'log'), rsi('A')]), say('undo all of that', [op('agent.undo', '$list:agent', { scope: 'all', about: null })])], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'D'], ['A.scale', 'eq', 'linear'], ['A.panes', 'same']] })
  u('followup', [say('weekly and an rsi', [tf('A', 'W'), rsi('A')]), say('undo just the timeframe change', [op('agent.undo', '$list:agent', { scope: 'last', about: 'timeframe' })])], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'D'], paneUp('A')] })
  u('followup', [say('weekly', [tf('A', 'W')]), say('add rsi', [rsi('A')]), say('line at 120', [level(120)]), say('undo', []), say('undo', []), say('undo', [])], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'D'], ['A.panes', 'same'], ['drawingCount', 'eq', 0]] })
  u('followup', [say('weekly', [tf('A', 'W')]), say('undo', []), say('redo that', [], { plan: unsupported('There is no redo: say what you want again and I will do it.') })], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'D']], receipt: true })
  u('followup', [say('put AMD on the right chart', [op('chart.setSymbol', ch('B'), { symbol: 'AMD' })]), say('weekly on this one', [tf('A', 'W')]), say('undo the symbol change', [op('agent.undo', '$list:agent', { scope: 'last', about: 'symbol' })])], null, { outcome: 'change', only: ['A', 'B'], expect: [['B.sym', 'eq', 'AAPL'], ['A.tf', 'eq', 'W']] })
}
