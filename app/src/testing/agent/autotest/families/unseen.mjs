// UCT Agent AUTOTEST: the UNSEEN set (2026-11-06). Written for the first BROWSER-MOCK-MODEL sweep after the master merge, by an author
// who had not run the public set against the product. Capabilities the public set never drives (lock, hide, rays, fib levels, copy
// look, theme-all, tabs, arrange, duplicate and copy indicators, candle colours, reset), other boards (FOUR, THREE, LINKED, MC), and
// relational / deictic targets ("the one above this", "everything except this one", "both of the other charts").
//
// BROWSER-MOCK-MODEL: each plan is scripted and reads its refs from the request the panel really sent. A pass proves the plan executes
// on the real components and the context named the right chart. It proves nothing about whether a model would pick that plan.
// Fixture prices only: the synthetic bars sit near 100, never a real market value.
import { family, op, say, changes, refuses, asks, propose, clarify } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const dr = (r) => `$dr:${r}`
const b = '$list:board'
const px = (r) => [`${r}.pixels`, 'changed']
const paneUp = (r) => [`${r}.panes`, 'delta', 1]
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const vol = (r, state) => op('volume.setState', ch(r), { state })
const level = (price, r = 'A') => op('drawing.addLevel', dr(r), { price, color: null, style: null })
const tgt = (intended, click) => ({ target: { intended, click } })

export function unseen(L) {
  // ── chart surface on boards with more than two charts ────────────────────────────────────────────────────────────
  const s = family(L, 'u-chart-surface', { inv: ['C1-006', 'C1-022', 'C1-047', 'C1-079'], board: 'FOUR', select: null })
  s('target', 'flip the bottom left one to a 15 minute chart', [tf('BL', '15')], changes(['BL'], [['BL.tf', 'eq', '15']], { undo: true }))
  s('params', 'candles on the top right should be green up and purple down', [op('chart.setCandleColors', ch('TR'), { up: '#22c55e', down: '#a855f7' })], changes(['TR'], [px('TR')], { undo: true }), { inventory: ['C1-017'] })
  s('combo', 'top left weekly and bottom right on log', [tf('TL', 'W'), scale('BR', 'log')], changes(['TL', 'BR'], [['TL.tf', 'eq', 'W'], ['BR.scale', 'eq', 'log']], { undo: true }))
  s('target', 'nord colours on every chart', [op('chart.applyThemeAll', b, { theme: 'nord' })], changes(['TL', 'TR', 'BL', 'BR'], ['TL', 'TR', 'BL', 'BR'].map(px), { undo: true }), { inventory: ['C1-079', 'C1-080'] })
  s('followup', [say('log scale on the top right', [scale('TR', 'log')]), say('put that one back to its defaults', [op('chart.resetDefaults', ch('TR'), {})])], null, changes(['TR'], [['TR.scale', 'eq', 'linear']]), { inventory: ['C1-076'] })
  s('followup', [say('black background on the top left', [op('chart.setBackground', ch('TL'), { color: '#000000' })]), say('make the bottom right look just like it', [op('chartSetup.copyLook', ch('BR'), { from: ch('TL') })])], null, changes(['TL', 'BR'], [px('BR')]), { inventory: ['C1-049', 'C1-085'] })
  s('followup', [say('three months on the bottom left', [op('chartSetup.setRange', ch('BL'), { range: '3M' })]), say('reset the zoom there', [op('chartSetup.resetView', ch('BL'), {})])], null, changes(['BL'], [px('BL')]), { inventory: ['C1-029', 'C1-027'] })
  s('target', 'hide every indicator on the middle chart', [op('chartSetup.setIndicatorsHidden', ch('M'), { hidden: true })], changes(['M'], [px('M')], { undo: true }), { board: 'THREE', inventory: ['C1-103'] })
  s('invalid', 'set the bottom right chart to the banana timeframe', [tf('BR', 'banana')], refuses({ expect: [['BR.tf', 'same']] }))
  s('target', 'extended hours on the right chart', [op('chart.setSession', ch('B'), { mode: 'extended' })], changes(['B'], [['B.session', 'changed']], { undo: true }), { board: 'TWO5', inventory: ['C1-019'] })
  s('multistep', 'top right: AMD, weekly, log, no volume', [op('chart.setSymbol', ch('TR'), { symbol: 'AMD' }), tf('TR', 'W'), scale('TR', 'log'), vol('TR', 'hidden')], changes(['TR'], [['TR.sym', 'eq', 'AMD'], ['TR.tf', 'eq', 'W'], ['TR.scale', 'eq', 'log'], ['TR.volume', 'eq', false]], { undo: true }), { inventory: ['C1-001', 'C1-006', 'C1-022', 'C1-086'] })

  // ── drawings and alerts the public set never drives ──────────────────────────────────────────────────────────────
  const d0 = '$drawing:A:0', d1 = '$drawing:A:1'
  const d = family(L, 'u-drawings', { inv: ['C1-131', 'C1-146'] })
  d('followup', [say('draw a line at 120', [level(120)]), say('lock that line', [op('drawing.lock', dr('A'), { drawing: d0, locked: true })])], null, changes(['A'], [['drawings.SPY.0.locked', 'eq', true]]), { inventory: ['C1-158'] })
  d('followup', [say('draw a line at 120', [level(120)]), say('lock it', [op('drawing.lock', dr('A'), { drawing: d0, locked: true })]), say('now delete it', [op('drawing.remove', dr('A'), { drawing: d0 })])], null, { outcome: 'change', expect: [['drawings.SPY', 'len', 1], ['drawings.SPY.0.locked', 'eq', true]], says: 'locked' }, { inventory: ['C1-158', 'C1-146'] })
  d('followup', [say('draw a line at 120', [level(120)]), say('hide that line for now', [op('drawing.setVisible', dr('A'), { drawing: d0, visible: false })])], null, changes(['A'], [['drawings.SPY', 'len', 1], ['drawings.SPY.0.hidden', 'eq', true]]), { inventory: ['C1-159'] })
  d('followup', [say('lines at 100 and 110', [level(100), level(110)]), say('hide all my drawings', [op('drawing.setAllVisible', dr('A'), { visible: false })])], null, changes(['A'], [['drawings.SPY', 'len', 2], ['drawings.SPY.0.hidden', 'eq', true], ['drawings.SPY.1.hidden', 'eq', true]]), { inventory: ['C1-126'] })
  d('phrasing', 'ray from may 1 2025 at 110 through june 2 2025 at 115', [op('drawing.addRay', dr('A'), { from: { date: '2025-05-01', price: 110 }, to: { date: '2025-06-02', price: 115 }, color: null, style: null })], changes(['A'], [['drawings.SPY', 'len', 1], ['drawings.SPY.0.type', 're', 'ray']], { undo: true }), { inventory: ['C1-129'] })
  d('followup', [say('fib from may 1 2025 at 110 to aug 1 2025 at 130', [op('drawing.addFib', dr('A'), { from: { date: '2025-05-01', price: 110 }, to: { date: '2025-08-01', price: 130 }, color: null, style: null })]), say('turn off the 0.786 level', [op('drawing.setFibLevels', dr('A'), { drawing: d0, levels: [{ level: 0.786, visible: false, color: null }], bands: [], reset: false })])], null, changes(['A'], [['drawings.SPY.0', 'changed']]), { inventory: ['C1-137', 'C1-151'] })
  d('target', 'mark 140 on the top right chart', [level(140, 'TR')], changes(['TR'], [['drawings.QQQ', 'len', 1], ['drawings.QQQ.0.points.0.price', 'eq', 140]], { undo: true, ...tgt(['TR'], 'BL') }), { board: 'FOUR', select: 'BL' })
  d('target', 'draw a line at 120 here', [level(120, 'sel')], changes(['BR'], [['drawings.TSLA', 'len', 1]], { undo: true, ...tgt('clicked', 'BR') }), { board: 'FOUR', select: 'BR' })
  d('target', 'draw a line at 120 on the bottom left cell', [level(120, 'C')], changes(['C'], [['drawings.TSLA', 'len', 1]], { undo: true }), { board: 'MC', select: null })
  d('followup', [say('draw a line at 120', [level(120)]), say('alert me when price breaks above it', propose([op('drawing.setAlert', dr('A'), { drawing: d0, direction: 'above', level: null })]))], null, changes(['A'], [['alerts', 'lenGte', 1]], { confirm: true }), { inventory: ['C1-115'] })
  d('invalid', 'lock the line', [], asks(), { turns: [say('lock the line', clarify('There are no lines on this chart. Which line?', []))] })
  d('followup', [say('lines at 100 and 110', [level(100), level(110)]), say('make the second one dashed', [op('drawing.style', dr('A'), { drawing: d1, color: null, style: 'dashed', width: null })])], null, changes(['A'], [['drawings.SPY.1', 're', 'dash'], ['drawings.SPY.0', 'notRe', 'dash']]), { inventory: ['C1-148'] })

  // ── indicators on charts other than the first ───────────────────────────────────────────────────────────────────
  const n = family(L, 'u-indicators', { inv: ['C2-005'], board: 'FOUR', select: null })
  n('params', 'a 34 ema on the bottom right', [op('indicator.add', ie('BR'), { defId: 'ema', inputs: [{ key: 'period', value: 34 }] })], changes(['BR'], [['BR.chips', 're', 'EMA 34']], { undo: true }))
  n('target', 'take the 9 ema off the right chart', [], changes(['B'], [['B.chips', 'lacks', 'EMA 9'], ['A.chips', 'has', 'EMA 9']], { confirm: true }), { board: 'TWO', inventory: ['C2-014'], turns: [say('take the 9 ema off the right chart', propose([op('indicator.remove', ie('B'), { instance: '$inst:B:EMA 9' })]))] })
  n('phrasing', 'duplicate the 20 ema', [op('indicatorCopy.duplicate', ie('A'), { instance: '$inst:A:EMA 20' })], changes(['A'], [['A.chips', 'delta', 1]], { undo: true }), { board: 'TWO', select: 'A', inventory: ['C2-042'] })
  n('followup', [say('rsi on the left chart', [op('indicator.add', ie('A'), { defId: 'rsi', inputs: null })]), say('copy it to the right chart', [op('indicatorCopy.copyTo', ie('B'), { from: ie('A'), instances: ['$inst:A:RSI'] })])], null, changes(['A', 'B'], [paneUp('B'), paneUp('A')]), { board: 'TWO', inventory: ['C2-049'] })
  n('phrasing', 'make the 200 sma on the top right thick', [op('indicatorStyle.set', ie('TR'), { instance: '$inst:TR:SMA 200', property: 'lineWidth', value: 4, output: null })], changes(['TR'], [px('TR')], { undo: true }), { inventory: ['C2-032'] })
  n('target', 'add macd to the top right cell', [op('indicator.add', ie('B'), { defId: 'macd', inputs: null })], changes(['B'], [paneUp('B')], { undo: true }), { board: 'MC' })
  n('target', 'hide the 50 sma on the middle chart', [op('indicator.hide', ie('M'), { instance: '$inst:M:SMA 50' })], changes(['M'], [px('M')], { undo: true }), { board: 'THREE', inventory: ['C2-018'] })
  n('followup', [say('rsi and macd here', [op('indicator.add', ie('A'), { defId: 'rsi', inputs: null }), op('indicator.add', ie('A'), { defId: 'macd', inputs: null })]), say('move the rsi to the bottom', [op('pane.move', ie('A'), { pane: 'rsi', to: 'bottom', relativeTo: null })])], null, changes(['A'], [['A.panes', 'delta', 2], ['A.panePx', 'changed']]), { board: 'TWO', select: 'A', inventory: ['C2-038'] })
  n('invalid', 'remove the 13 ema from the bottom left', [], asks(), { turns: [say('remove the 13 ema from the bottom left', clarify('The bottom-left chart has EMA 9, EMA 20, SMA 50 and SMA 200. Which one?', ['EMA 9', 'EMA 20']))] })

  // ── workspace, tabs, Multi Chart ────────────────────────────────────────────────────────────────────────────────
  const w = family(L, 'u-workspace', { inv: ['C3-006'], board: 'TWO', select: null })
  w('phrasing', 'line the widgets up in columns', [op('widget.arrange', b, { widgets: null, pattern: 'columns' })], { outcome: 'change', expect: [['widgets', 'changed']], undo: true }, { inventory: ['C3-002'] })
  w('phrasing', 'add a weekly tab to the left chart', [op('chart.addTab', b, { widget: 'w-chart-a', timeframe: 'W', name: null })], { outcome: 'change', expect: [['A.tf', 'eq', 'W']], undo: true }, { inventory: ['C3-020'] })
  w('phrasing', 'close the watchlist', [op('widget.remove', b, { widget: '$widget:watchlist' })], changes(['A', 'B'], [['types', 'lacks', 'watchlist']], { undo: true }), { inventory: ['C3-004'] })
  w('phrasing', 'link the right chart to the left one', [op('widget.setLink', b, { widget: 'w-chart-b', color: 'A' })], changes(['B'], [['B.sym', 'eq', 'SPY']], { undo: true }), { inventory: ['C3-006'] })
  w('params', 'give me three charts: NVDA, AMD and AVGO', [op('chartGrid.set', b, { symbols: ['NVDA', 'AMD', 'AVGO'], timeframe: null, layout: 'grid', new_charts: null, watchlist: null, replace: null })], { outcome: 'change', expect: [['chartCount', 'eq', 3]], undo: true }, { inventory: ['C3-042'] })
  w('phrasing', 'make a copy of the Intraday Scan layout', null, { outcome: 'change', expect: [['layouts', 'lenGte', 4]], confirm: true }, { board: 'LAYOUTS', inventory: ['C3-034'], turns: [say('make a copy of the Intraday Scan layout', propose([op('layout.duplicate', '$list:layouts', { layout: '12', name: null })]))] })
  w('target', 'every cell on the weekly', [tf('A', 'W'), tf('B', 'W'), tf('C', 'W')], changes(['A', 'B', 'C'], [['A.tf', 'eq', 'W'], ['B.tf', 'eq', 'W'], ['C.tf', 'eq', 'W']], { undo: true }), { board: 'MC', inventory: ['C3-056', 'C1-006'] })
  w('target', 'put AMD in the top left cell', [op('chart.setSymbol', ch('A'), { symbol: 'AMD' })], { outcome: 'change', expect: [['A.sym', 'eq', 'AMD'], ['C.sym', 'eq', 'TSLA']], undo: true }, { board: 'MC', inventory: ['C3-056', 'C1-001'] })
  w('target', 'log scale in the empty cell', [scale('D', 'log')], { outcome: 'change', expect: [['D.scale', 'eq', 'log']], undo: true }, { board: 'MC', inventory: ['C3-056', 'C1-022'] })

  // ── relational and deictic targets: which chart the words mean, given the click ──────────────────────────────────
  const t = family(L, 'u-target', { inv: ['C1-006'], board: 'FOUR' })
  t('target', 'make it weekly', [tf('sel', 'W')], changes(['B'], [['B.tf', 'eq', 'W']], { undo: true, ...tgt('clicked', 'B') }), { board: 'TWO', select: 'B' })
  t('target', 'make the one above this weekly', [tf('TL', 'W')], changes(['TL'], [['TL.tf', 'eq', 'W']], { undo: true, ...tgt(['TL'], 'BL') }), { select: 'BL' })
  t('target', 'the QQQ chart should be on log', [scale('TR', 'log')], changes(['TR'], [['TR.scale', 'eq', 'log']], { undo: true, ...tgt(['TR'], 'TL') }), { select: 'TL', inventory: ['C1-022'] })
  t('target', 'hide volume on both of the other charts', [vol('M', 'hidden'), vol('R', 'hidden')], changes(['M', 'R'], [['M.volume', 'eq', false], ['R.volume', 'eq', false]], { undo: true, ...tgt(['M', 'R'], 'L') }), { board: 'THREE', select: 'L', inventory: ['C1-086'] })
  t('target', 'weekly on everything except this one', [tf('TL', 'W'), tf('TR', 'W'), tf('BL', 'W')], changes(['TL', 'TR', 'BL'], [['TL.tf', 'eq', 'W'], ['TR.tf', 'eq', 'W'], ['BL.tf', 'eq', 'W'], ['BR.tf', 'eq', 'D']], { undo: true, ...tgt(['TL', 'TR', 'BL'], 'BR') }), { select: 'BR' })
  t('target', 'put SPY in the cell under this one', [op('chart.setSymbol', ch('C'), { symbol: 'SPY' })], { outcome: 'change', expect: [['C.sym', 'eq', 'SPY'], ['A.sym', 'eq', 'NVDA']], undo: true, ...tgt(['C'], 'A') }, { board: 'MC', select: 'A', inventory: ['C1-001', 'C3-056'] })
  t('target', 'make the NVDA chart weekly and this one log', [tf('BL', 'W'), scale('sel', 'log')], changes(['BL', 'TL'], [['BL.tf', 'eq', 'W'], ['TL.scale', 'eq', 'log']], { undo: true, ...tgt(['BL', 'TL'], 'TL') }), { select: 'TL', inventory: ['C1-006', 'C1-022'] })
  t('target', 'not this chart, the other one: weekly', [tf('A', 'W')], changes(['A'], [['A.tf', 'eq', 'W']], { undo: true, ...tgt(['A'], 'B') }), { board: 'TWO', select: 'B' })
  t('target', 'make the QQQ chart weekly', [tf('R', 'W')], changes(['R'], [['R.tf', 'eq', 'W']], { undo: true, ...tgt(['R'], 'L') }), { board: 'LINKED', select: 'L' })
  t('target', 'add rsi to the chart next to this one', [], asks({ ...tgt('ask', 'TR') }), { select: 'TR', inventory: ['C2-004'], turns: [say('add rsi to the chart next to this one', clarify('The one on its left (SPY) or the one below it (TSLA)?', ['Top-left chart (SPY)', 'Bottom-right chart (TSLA)']))] })
  t('target', 'turn this cell weekly', [tf('sel', 'W')], changes(['C'], [['C.tf', 'eq', 'W']], { undo: true, ...tgt('clicked', 'C') }), { board: 'MC', select: 'C', inventory: ['C3-056', 'C1-006'] })
  t('target', 'switch this one to AVGO', [op('chart.setSymbol', ch('sel'), { symbol: 'AVGO' })], changes(['M'], [['M.sym', 'eq', 'AVGO']], { undo: true, ...tgt('clicked', 'M') }), { board: 'THREE', select: 'M', inventory: ['C1-001'] })
}
