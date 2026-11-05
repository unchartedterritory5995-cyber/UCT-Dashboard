// Inventory part 2: indicators, styles, panes, indicator alerts. Default chips: EMA 9, EMA 20, SMA 50, SMA 200.
import { family, op, say, changes, refuses, unsupported, clarify, propose, asks } from './dsl.mjs'

export function indicators(L) {
  const ie = (r = 'A') => `$ie:${r}`
  const add = (defId, inputs = null, r = 'A') => op('indicator.add', ie(r), { defId, inputs })
  const paneUp = (r = 'A') => [[`${r}.panes`, 'delta', 1]]

  const a = family(L, 'indicator-add', { inv: ['C2-004', 'C2-005'] })
  a('phrasing', 'slap an RSI on here', [add('rsi')], changes(['A'], paneUp(), { undo: true }))
  a('phrasing', 'I want to see MACD under this chart', [add('macd')], changes(['A'], paneUp(), { undo: true }))
  a('phrasing', 'throw bollinger bands on this', [add('bb')], changes(['A'], [['A.pixels', 'changed']], { undo: true }))
  a('phrasing', 'put VWAP on it', [add('vwap')], changes(['A'], [['A.pixels', 'changed']], { undo: true }))
  a('params', 'add a 30 ema', [add('ema', [{ key: 'period', value: 30 }])], changes(['A'], [['A.chips', 're', 'EMA 30']], { undo: true }))
  a('params', 'add a 100 period simple moving average', [add('sma', [{ key: 'period', value: 100 }])], changes(['A'], [['A.chips', 're', 'SMA 100']], { undo: true }))
  a('params', 'RSI with a 7 lookback', [add('rsi', [{ key: 'period', value: 7 }])], changes(['A'], paneUp(), { undo: true }))
  a('target', 'add rsi to the right chart', [add('rsi', null, 'B')], changes(['B'], paneUp('B'), { undo: true }), { select: null })
  a('target', 'rsi on all four charts', ['TL', 'TR', 'BL', 'BR'].map(r => add('rsi', null, r)), changes(['TL', 'TR', 'BL', 'BR'], ['TL', 'TR', 'BL', 'BR'].flatMap(r => paneUp(r)), { undo: true }), { board: 'FOUR', select: null })
  a('target', 'put a macd on the top left and bottom right', [add('macd', null, 'TL'), add('macd', null, 'BR')], changes(['TL', 'BR'], [...paneUp('TL'), ...paneUp('BR')], { undo: true }), { board: 'FOUR', select: null })
  a('target', 'add an rsi', [], asks({ says: 'which' }), { board: 'FOUR', select: null, turns: [say('add an rsi', clarify('Which chart?', ['Top left', 'Top right', 'Bottom left', 'Bottom right']))] })
  a('combo', 'add rsi and macd', [add('rsi'), add('macd')], changes(['A'], [['A.panes', 'delta', 2]], { undo: true }))
  a('combo', 'give me a 10 and a 21 ema', [add('ema', [{ key: 'period', value: 10 }]), add('ema', [{ key: 'period', value: 21 }])], changes(['A'], [['A.chips', 're', 'EMA 10'], ['A.chips', 're', 'EMA 21']], { undo: true }))
  a('invalid', 'add the flux capacitor indicator', [add('fluxcapacitor')], refuses({ expect: [['A.panes', 'same']] }))
  a('invalid', 'add an ema with a period of minus 3', [add('ema', [{ key: 'period', value: -3 }])], refuses({ expect: [['A.chips', 'same']] }))
  a('unsupported', 'turn on volume profile', [], refuses(), { turns: [say('turn on volume profile', unsupported('Volume Profile has to be turned on from the chart.'))] })

  const e = family(L, 'indicator-edit', { inv: ['C2-024', 'C2-025'] })
  const upd = (inst, inputs, r = 'A') => op('indicator.update', ie(r), { instance: inst, inputs })
  e('phrasing', 'bump the 9 ema up to a 12', [upd('$inst:A:EMA 9', [{ key: 'period', value: 12 }])], changes(['A'], [['A.chips', 'has', 'EMA 12'], ['A.chips', 'lacks', 'EMA 9']], { undo: true }))
  e('phrasing', 'the 20 ema should be a 21', [upd('$inst:A:EMA 20', [{ key: 'period', value: 21 }])], changes(['A'], [['A.chips', 'has', 'EMA 21'], ['A.chips', 'lacks', 'EMA 20']], { undo: true }))
  e('params', 'change the 50 sma to an ema', [upd('$inst:A:SMA 50', [{ key: 'maType', value: 'ema' }])], changes(['A'], [['A.chips', 'has', 'EMA 50']], { undo: true }))
  e('params', 'make the 200 a 150', [upd('$inst:A:SMA 200', [{ key: 'period', value: 150 }])], changes(['A'], [['A.chips', 'has', 'SMA 150']], { undo: true }))
  e('target', 'on the right chart, change the 9 ema to 8', [upd('$inst:B:EMA 9', [{ key: 'period', value: 8 }], 'B')], changes(['B'], [['B.chips', 'has', 'EMA 8'], ['A.chips', 'has', 'EMA 9']], { undo: true }), { select: null })
  e('followup', [say('add rsi', [add('rsi')]), say('change the length to 21', [upd('$inst:A:RSI', [{ key: 'period', value: 21 }])])], null, changes(['A'], paneUp()))
  e('invalid', 'set the 9 ema period to banana', [upd('$inst:A:EMA 9', [{ key: 'period', value: 'banana' }])], refuses({ expect: [['A.chips', 'same']] }))
  e('invalid', 'change the 77 ema to a 78', [], asks(), { turns: [say('change the 77 ema to a 78', clarify('I see EMA 9 and EMA 20. Which one?', ['EMA 9', 'EMA 20']))] })

  const s = family(L, 'indicator-style', { inv: ['C2-030', 'C2-032', 'C2-036'], unverifiable: ['the exact shade of a colour word'] })
  const style = (inst, property, value) => op('indicatorStyle.set', ie(), { instance: inst, property, value, output: null })
  s('phrasing', 'turn the 9 ema red', [style('$inst:A:EMA 9', 'color', '#ef4444')], changes(['A'], [['A.pixels', 'changed']], { undo: true }))
  s('phrasing', 'paint the 200 yellow', [style('$inst:A:SMA 200', 'color', '#eab308')], changes(['A'], [['A.pixels', 'changed']], { undo: true }))
  s('params', 'line width 4 on the 20 ema', [style('$inst:A:EMA 20', 'lineWidth', 4)], changes(['A'], [['A.pixels', 'changed']], { undo: true }))
  s('phrasing', 'make the 20 ema dashed', [style('$inst:A:EMA 20', 'lineStyle', 'dashed')], changes(['A'], [['A.pixels', 'changed']], { undo: true }))
  s('phrasing', 'move the 50 sma down into its own pane', [op('indicatorStyle.placeIn', ie(), { instance: '$inst:A:SMA 50', place: 'pane' })], changes(['A'], paneUp(), { undo: true }), { browserOnly: true })
  s('followup', [say('add rsi', [add('rsi')]), say('make it orange', [style('$inst:A:RSI', 'color', '#f97316')])], null, changes(['A'], paneUp()))
  s('invalid', 'make the 9 ema a 99 pixel line', [style('$inst:A:EMA 9', 'lineWidth', 99)], refuses())

  const h = family(L, 'indicator-visibility', { inv: ['C2-018', 'C2-019', 'C2-014', 'C1-103', 'C1-105'] })
  h('phrasing', 'hide the 50 sma for now', [op('indicator.hide', ie(), { instance: '$inst:A:SMA 50' })], changes(['A'], [['A.pixels', 'changed']], { undo: true }))
  h('phrasing', 'take the 200 off the chart', [propose([op('indicator.remove', ie(), { instance: '$inst:A:SMA 200' })])], null, { turns: [say('take the 200 off the chart', propose([op('indicator.remove', ie(), { instance: '$inst:A:SMA 200' })]))], oracle: changes(['A'], [['A.chips', 'lacks', 'SMA 200'], ['B.chips', 'has', 'SMA 200']], { confirm: true }) })
  h('phrasing', 'clean this chart up, hide every indicator', [op('chartSetup.setIndicatorsHidden', '$chart:A', { hidden: true })], changes(['A'], [['A.pixels', 'changed']]))
  h('phrasing', 'no moving averages on this one', [op('chartSetup.setMovingAverages', '$chart:A', { visible: false })], changes(['A'], [['A.pixels', 'changed']]))
  h('followup', [say('hide the 50 sma', [op('indicator.hide', ie(), { instance: '$inst:A:SMA 50' })]), say('show it again', [op('indicator.show', ie(), { instance: '$inst:A:SMA 50' })])], null, changes(['A'], [['A.chips', 'has', 'SMA 50']]))
  h('combo', 'hide the 9 and the 20', [op('indicator.hide', ie(), { instance: '$inst:A:EMA 9' }), op('indicator.hide', ie(), { instance: '$inst:A:EMA 20' })], changes(['A'], [['A.pixels', 'changed']], { undo: true }))

  const al = family(L, 'indicator-alert', { inv: ['C2-089', 'C2-090'] })
  const iac = (args) => op('indicatorAlert.create', '$list:indicatorAlertLibrary', { plot: null, threshold: null, crossWith: null, chart: null, trigger: null, timeframe: null, ...args })
  al('phrasing', [say('add rsi', [add('rsi')]), say('ping me when RSI gets above 70', propose([iac({ instance: '$inst:A:RSI', condition: 'above', threshold: 70 })]))], null, changes(['A'], [['ialerts', 'len', 1], ['ialerts.0.condition', 'eq', 'above'], ['ialerts.0.threshold', 'eq', 70], ['ialerts.0.sym', 'eq', 'SPY']], { confirm: true }))
  al('params', [say('add rsi', [add('rsi')]), say('tell me if rsi falls under 30', propose([iac({ instance: '$inst:A:RSI', condition: 'below', threshold: 30 })]))], null, changes(['A'], [['ialerts', 'len', 1], ['ialerts.0.condition', 'eq', 'below'], ['ialerts.0.threshold', 'eq', 30]], { confirm: true }))
  al('phrasing', 'let me know when the 9 ema crosses over the 20 on this chart', null, changes(['A'], [['ialerts', 'len', 1], ['ialerts.0.condition', 'eq', 'cross_above'], ['ialerts.0.sym', 'eq', 'SPY']], { confirm: true }), { turns: [say('let me know when the 9 ema crosses over the 20 on this chart', propose([iac({ instance: '$inst:A:EMA 9', condition: 'cross_above', crossWith: '$inst:A:EMA 20' })]))] })
  al('invalid', 'alert me when the stock feels bullish', [], refuses({ expect: [['ialerts', 'len', 0]] }), { turns: [say('alert me when the stock feels bullish', unsupported('I can only alert on a price or an indicator level.'))] })
}
