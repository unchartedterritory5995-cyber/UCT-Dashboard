// UCT Agent AUTOTEST: UNSEEN batch 5 (2026-11-07), written BEFORE any run of it. Teaching-adjacent EXECUTION: requests that put
// a pane, a line, a level or an indicator next to a chart word ("RSI under the chart", "a line above this", "move the MACD pane
// below the price"). "under this chart" is where the pane goes, not "the chart below this one": the indicator-add-02 regression
// class. Each such case sits on a board where a chart really IS below / above / beside the clicked one, so a relation misread
// lands somewhere visible, and a control case per relation says the real relation still works.
// BROWSER-MOCK-MODEL: plans are scripted; targets are graded by the selection oracle.
import { family, op, say, changes } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const dr = (r) => `$dr:${r}`
const add = (r, defId, inputs = null) => op('indicator.add', ie(r), { defId, inputs })
const level = (price, r) => op('drawing.addLevel', dr(r), { price, color: null, style: null })
const tgt = (intended, click) => ({ target: { intended, click } })
const paneUp = (r, n = 1) => [`${r}.panes`, 'delta', n]

export function unseen5(L) {
  // ── an indicator "under / below / over" the chart: the pane, on the clicked chart ────────────────────────────────────────
  const p = family(L, 'u5-pane-words', { inv: ['C2-004'], board: 'FOUR' })
  p('phrasing', 'put an RSI under the chart', [add('sel', 'rsi')], changes(['A'], [paneUp('A')], { undo: true, ...tgt('clicked', 'A') }), { board: 'TWO', select: 'A' })
  p('phrasing', 'add MACD below this chart', [add('sel', 'macd')], changes(['A'], [paneUp('A')], { undo: true, ...tgt('clicked', 'A') }), { board: 'TWO', select: 'A' })
  p('target', 'RSI under this chart', [add('sel', 'rsi')], changes(['TL'], [paneUp('TL')], { undo: true, ...tgt('clicked', 'TL') }), { select: 'TL' })
  p('target', 'put a macd underneath', [add('sel', 'macd')], changes(['TL'], [paneUp('TL')], { undo: true, ...tgt('clicked', 'TL') }), { select: 'TL' })
  p('target', 'rsi beneath this one', [add('sel', 'rsi')], changes(['M'], [paneUp('M')], { undo: true, ...tgt('clicked', 'M') }), { board: 'THREE', select: 'M' })
  p('target', 'an rsi right under it', [add('sel', 'rsi')], changes(['TR'], [paneUp('TR')], { undo: true, ...tgt('clicked', 'TR') }), { select: 'TR' })
  p('target', 'rsi under this cell', [add('sel', 'rsi')], changes(['A'], [paneUp('A')], { undo: true, ...tgt('clicked', 'A') }), { board: 'MC', select: 'A', inventory: ['C2-004', 'C3-056'] })
  p('params', 'overlay a 34 ema on top of this chart', [add('sel', 'ema', [{ key: 'period', value: 34 }])], changes(['TR'], [['TR.chips', 're', 'EMA 34']], { undo: true, ...tgt('clicked', 'TR') }), { select: 'TR', inventory: ['C2-005'] })
  p('phrasing', 'add bollinger bands over this chart', [add('sel', 'bb')], changes(['A'], [['A.pixels', 'changed']], { undo: true, ...tgt('clicked', 'A') }), { board: 'TWO', select: 'A' })
  p('phrasing', 'put the vwap above the candles', [add('sel', 'vwap')], changes(['TL'], [['TL.pixels', 'changed']], { undo: true, ...tgt('clicked', 'TL') }), { select: 'TL' })
  p('phrasing', 'an rsi under this one please', [add('sel', 'rsi')], changes(['B'], [paneUp('B')], { undo: true, ...tgt('clicked', 'B') }), { board: 'TWO', select: 'B' })

  // ── the real relations still work (controls) ───────────────────────────────────────────────────────────────────────────
  const r = family(L, 'u5-relation-controls', { inv: ['C2-004'], board: 'FOUR' })
  r('target', 'add an rsi to the chart below this one', [add('BL', 'rsi')], changes(['BL'], [paneUp('BL')], { undo: true, ...tgt(['BL'], 'TL') }), { select: 'TL' })
  r('target', 'put a macd on the chart above', [add('TL', 'macd')], changes(['TL'], [paneUp('TL')], { undo: true, ...tgt(['TL'], 'BL') }), { select: 'BL' })
  r('target', 'rsi on the chart to the left of this one', [add('L', 'rsi')], changes(['L'], [paneUp('L')], { undo: true, ...tgt(['L'], 'M') }), { board: 'THREE', select: 'M' })
  r('target', 'rsi in the cell under this one', [add('C', 'rsi')], changes(['C'], [paneUp('C')], { undo: true, ...tgt(['C'], 'A') }), { board: 'MC', select: 'A', inventory: ['C2-004', 'C3-056'] })

  // ── a line or level "above / below / under" something: a drawing on the clicked chart's symbol ───────────────────────────
  const d = family(L, 'u5-line-words', { inv: ['C1-131'], board: 'FOUR' })
  d('target', 'a level below this at 90', [level(90, 'sel')], changes(['TL'], [['drawings.SPY', 'len', 1], ['drawings.SPY.0.points.0.price', 'eq', 90]], { undo: true, ...tgt('clicked', 'TL') }), { select: 'TL' })
  d('target', 'put a line right under the high at 130', [level(130, 'sel')], changes(['TR'], [['drawings.QQQ', 'len', 1]], { undo: true, ...tgt('clicked', 'TR') }), { select: 'TR' })
  d('phrasing', 'draw a line at 120 above the current price', [level(120, 'sel')], changes(['A'], [['drawings.SPY', 'len', 1]], { undo: true, ...tgt('clicked', 'A') }), { board: 'TWO', select: 'A' })
  d('phrasing', 'a horizontal line under the last candle at 95', [level(95, 'sel')], changes(['A'], [['drawings.SPY', 'len', 1], ['drawings.SPY.0.points.0.price', 'eq', 95]], { undo: true, ...tgt('clicked', 'A') }), { board: 'TWO', select: 'A' })
  d('target', 'put a line under this chart\'s low at 140', [level(140, 'sel')], changes(['TL'], [['drawings.SPY', 'len', 1]], { undo: true, ...tgt('clicked', 'TL') }), { select: 'TL' })
  d('target', 'mark 110 below the price on this one', [level(110, 'sel')], changes(['BR'], [['drawings.TSLA', 'len', 1]], { undo: true, ...tgt('clicked', 'BR') }), { select: 'BR' })
  d('followup', [say('draw a line at 120 on this chart', [level(120, 'B')]), say('alert me when price gets above that line', { disposition: 'propose', ops: [op('drawing.setAlert', '$dr:B', { drawing: '$drawing:B:0', direction: 'above', level: null })] })], null, changes(['B'], [['alerts', 'lenGte', 1]], { confirm: true }), { board: 'TWO', select: 'B', inventory: ['C1-115'] })

  // ── panes moved "below / above / under" another pane or the price ──────────────────────────────────────────────────────
  const m = family(L, 'u5-pane-moves', { inv: ['C2-038'], board: 'TWO', select: 'A', unverifiable: ['the pane order itself: the rig reads pane heights, so a move is checked as the panes still there and a receipt'] })
  m('followup', [say('add macd here', [add('A', 'macd')]), say('move the MACD pane below the price', [op('pane.move', ie('A'), { pane: 'macd', to: 'below', relativeTo: 'price' })])], null, changes(['A'], [paneUp('A')]))
  m('followup', [say('rsi and macd here', [add('A', 'rsi'), add('A', 'macd')]), say('stack the rsi under the macd', [op('pane.move', ie('A'), { pane: 'rsi', to: 'below', relativeTo: 'macd' })])], null, changes(['A'], [paneUp('A', 2)]))
  m('followup', [say('add rsi here', [add('A', 'rsi')]), say('move the rsi pane above the volume', [op('pane.move', ie('A'), { pane: 'rsi', to: 'above', relativeTo: 'volume' })])], null, changes(['A'], [paneUp('A')]))
  m('followup', [say('add macd to this chart', [add('A', 'macd')]), say('move the macd pane to the bottom of this chart', [op('pane.move', ie('A'), { pane: 'macd', to: 'bottom', relativeTo: null })])], null, changes(['A'], [paneUp('A')]))
  // oracle fixed after the first run: a target case is graded from the board at its last sentence, so the MACD is already there
  m('target', [say('add macd to this chart', [add('sel', 'macd')]), say('put the macd pane under the price on this one', [op('pane.move', ie('sel'), { pane: 'macd', to: 'below', relativeTo: 'price' })])], null, changes(['TL'], [['TL.panes', 'same'], ['TL.pixels', 'changed']], tgt('clicked', 'TL')), { board: 'FOUR', select: 'TL' })

  // ── volume and averages "under / over" the chart: the clicked chart's own ─────────────────────────────────────────────
  const v = family(L, 'u5-volume-words', { inv: ['C1-086'], board: 'FOUR' })
  v('target', 'hide the volume under this chart', [op('volume.setState', ch('sel'), { state: 'hidden' })], changes(['TL'], [['TL.volume', 'eq', false]], { undo: true, ...tgt('clicked', 'TL') }), { select: 'TL' })
  v('target', 'hide the moving averages over this chart', [op('chartSetup.setMovingAverages', ch('sel'), { visible: false })], changes(['TR'], [['TR.pixels', 'changed']], { undo: true, ...tgt('clicked', 'TR') }), { select: 'TR', inventory: ['C1-105'] })
  v('target', 'take the volume bars off the bottom of this one', [op('volume.setState', ch('sel'), { state: 'hidden' })], changes(['BL'], [['BL.volume', 'eq', false]], { undo: true, ...tgt('clicked', 'BL') }), { select: 'BL' })
}
