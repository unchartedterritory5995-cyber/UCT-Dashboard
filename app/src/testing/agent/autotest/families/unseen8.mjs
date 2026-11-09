// UCT Agent AUTOTEST: UNSEEN batch 8 (2026-11-08), written BEFORE any run of it, for the owner's focus areas:
//   sequences    complex multi-step instructions, a step that fails in the middle, undo of the whole sequence
//   screener     scanner and filter operations (run, refine, sort, save, list, the scanner widget's scans)
//   ind-settings indicator settings and appearance across the catalog (SMA, EMA, BB, MACD, Stochastic, ATR, SAR, RSI), with real
//                input keys read from the native registry (components/chart/engine/nativeRegistry.js)
//   ambiguity    recovery: the Agent asks with concrete choices on screen, and the member's short answer lands on the chart it names
// BROWSER-MOCK-MODEL: plans are scripted; the oracle reads the board, never the receipt. Fixture data only.
import { family, op, say, changes, refuses, reads, answers, unsupported, clarify } from './dsl.mjs'

const ch = (r) => `$chart:${r}`
const ie = (r) => `$ie:${r}`
const dr = (r) => `$dr:${r}`
const tf = (r, t) => op('chart.setTimeframe', ch(r), { timeframe: t })
const scale = (r, s) => op('chart.setScale', ch(r), { scale: s })
const vol = (r, state) => op('volume.setState', ch(r), { state })
const add = (r, defId, inputs = null) => op('indicator.add', ie(r), { defId, inputs })
const upd = (r, inst, inputs) => op('indicator.update', ie(r), { instance: inst, inputs })
const style = (r, inst, property, value) => op('indicatorStyle.set', ie(r), { instance: inst, property, value, output: null })
const level = (price, r) => op('drawing.addLevel', dr(r), { price, color: null, style: null })
const paneUp = (r, n = 1) => [`${r}.panes`, 'delta', n]
const px = (r) => [`${r}.pixels`, 'changed']
const kv = (o) => Object.entries(o).map(([key, value]) => ({ key, value }))

export function unseen8(L) {
  // ── sequences ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const s = family(L, 'u8-sequences', { inv: ['C1-006', 'C1-022', 'C2-004'], board: 'TWO', select: 'A' })
  s('multistep', 'make this weekly, log scale, add rsi and a 34 ema', [tf('A', 'W'), scale('A', 'log'), add('A', 'rsi'), add('A', 'ema', kv({ period: 34 }))], changes(['A'], [['A.tf', 'eq', 'W'], ['A.scale', 'eq', 'log'], paneUp('A'), ['A.chips', 're', 'EMA 34']], { undo: true }))
  s('multistep', 'switch to AAPL, weekly, hide the volume and draw a line at 120', [op('chart.setSymbol', ch('A'), { symbol: 'AAPL' }), tf('A', 'W'), vol('A', 'hidden'), level(120, 'A')], changes(['A', 'B'], [['A.sym', 'eq', 'AAPL'], ['A.tf', 'eq', 'W'], ['A.volume', 'eq', false], ['drawings.AAPL', 'len', 1]], { undo: true }), { inventory: ['C1-001', 'C1-006', 'C1-086', 'C1-131'] })
  s('multistep', 'top left weekly, top right log, bottom left rsi, bottom right no volume', [tf('TL', 'W'), scale('TR', 'log'), add('BL', 'rsi'), vol('BR', 'hidden')], changes(['TL', 'TR', 'BL', 'BR'], [['TL.tf', 'eq', 'W'], ['TR.scale', 'eq', 'log'], paneUp('BL'), ['BR.volume', 'eq', false]], { undo: true }), { board: 'FOUR', select: null, inventory: ['C1-006', 'C1-022', 'C2-004', 'C1-086'] })
  s('multistep', 'weekly, then log, then actually back to daily', [tf('A', 'W'), scale('A', 'log'), tf('A', 'D')], changes(['A'], [['A.tf', 'eq', 'D'], ['A.scale', 'eq', 'log']], { undo: true }))
  s('multistep', 'weekly, add the flux capacitor indicator, then log scale', [tf('A', 'W'), add('A', 'fluxcapacitor'), scale('A', 'log')], { outcome: 'change', only: ['A'], expect: [['A.panes', 'same'], ['A.chips', 'same']], receipt: false, says: 'flux|capacitor|no indicator|not' }, { unverifiable: ['whether the valid steps still apply is the product\'s policy (all or nothing, or the rest with the failure named): the checks are that no indicator appeared and the failed step is named'] })
  s('multistep', 'weekly and a line at minus 40', [tf('A', 'W'), level(-40, 'A')], { outcome: 'change', only: ['A'], expect: [['drawingCount', 'eq', 0]], receipt: false, says: '40|price|negative|positive' }, { inventory: ['C1-131'], unverifiable: ['as above: the weekly may or may not stay; no line may appear and the bad price must be named'] })
  s('followup', [say('left weekly, right log, rsi on both', [tf('A', 'W'), scale('B', 'log'), add('A', 'rsi'), add('B', 'rsi')]), say('undo all of that', [op('agent.undo', '$list:agent', { scope: 'all', about: null })])], null, { outcome: 'change', only: ['A', 'B'], expect: [['A.tf', 'eq', 'D'], ['B.scale', 'eq', 'linear'], ['A.panes', 'same'], ['B.panes', 'same']] }, { select: null })
  s('followup', [say('weekly here and hide the volume', [tf('A', 'W'), vol('A', 'hidden')]), say('add rsi', [add('A', 'rsi')]), say('undo', []), say('undo', [])], null, { outcome: 'change', only: ['A'], expect: [['A.tf', 'eq', 'D'], ['A.volume', 'eq', true], ['A.panes', 'same']] })

  // ── screener and scanner ─────────────────────────────────────────────────────────────────────────────────────────────
  const sc = family(L, 'u8-screener', { inv: ['C3-107', 'C3-118'], board: 'SCAN', select: null })
  const run = (filters, extra = {}) => op('screener.run', '$list:screener', { filters, sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null, logic: null, rank: null, ...extra })
  const f = (field, opr, value, max = null) => ({ field, op: opr, value, max, values: null })
  sc('params', 'stocks with ADR over 4 and price under 100', [run([f('adr_pct', 'gt', 4), f('price', 'lt', 100)])], reads())
  sc('followup', [say('find stocks with ADR above 5', [run([f('adr_pct', 'gt', 5)])]), say('sort those by ADR, highest first', [run([], { mode: 'refine', sort_field: 'adr_pct', sort_dir: 'desc' })])], null, reads())
  sc('followup', [say('screen for ADR above 6', [run([f('adr_pct', 'gt', 6)])]), say('save that screen as High ADR', { disposition: 'propose', ops: [op('screener.saveAs', '$list:savedScreenLibrary', { name: 'High ADR' })] })], null, { outcome: 'change', expect: [['screens', 'has', 'High ADR']], says: 'High ADR', confirm: true }, { unverifiable: ['the saved-screens route is an in-page stand-in for api/routers/screener.py (added after the first run, which had none: the product then honestly said it did not take effect)'] })
  sc('phrasing', 'which saved screens do I have', [op('screener.listSaved', '$list:screener', {})], reads())
  sc('phrasing', 'show the 90 day top gainers in the scanner', [op('widget.showScan', '$list:board', { widget: 'w-scan', scan: 'top-gainers-90d' })], { outcome: 'change', expect: [['faces.scanner', 'changed']] }, { inventory: ['C3-107'] })
  sc('phrasing', 'switch the scanner to IPOs from the last year', [op('widget.showScan', '$list:board', { widget: 'w-scan', scan: 'ipo-1y' })], { outcome: 'change', expect: [['faces.scanner', 'changed']] }, { inventory: ['C3-107'] })
  sc('invalid', 'find stocks priced between 50 and 20', [run([f('price', 'between', 50, 20)])], refuses())
  sc('unsupported', 'show the scanner results as a heatmap', [], refuses(), { turns: [say('show the scanner results as a heatmap', unsupported('The scanner shows a list; it has no heatmap view.'))] })

  // ── indicator settings and appearance across the catalog ─────────────────────────────────────────────────────────────
  const ind = family(L, 'u8-ind-settings', { inv: ['C2-024', 'C2-030'], board: 'TWO', select: 'A' })
  ind('params', 'change the 50 sma to a 55', [upd('A', '$inst:A:SMA 50', kv({ period: 55 }))], changes(['A'], [['A.chips', 'has', 'SMA 55'], ['A.chips', 'lacks', 'SMA 50']], { undo: true }))
  ind('phrasing', 'make the 200 sma dashed', [style('A', '$inst:A:SMA 200', 'lineStyle', 'dashed')], changes(['A'], [px('A')], { undo: true }), { inventory: ['C2-033'] })
  ind('phrasing', 'make the 9 ema thicker', [style('A', '$inst:A:EMA 9', 'lineWidth', 'thicker')], changes(['A'], [px('A')], { undo: true }), { inventory: ['C2-032'] })
  ind('followup', [say('add bollinger bands', [add('A', 'bb')]), say('set the bands to 2.5 standard deviations', [upd('A', '$inst:A:BB', kv({ stdDev: 2.5 }))])], null, changes(['A'], [['A.chips', 're', 'BB\\(20, 2\\.5\\)']]))
  ind('params', 'bollinger bands on 50 periods', [add('A', 'bb', kv({ period: 50 }))], changes(['A'], [['A.chips', 're', 'BB\\(50']], { undo: true }), { inventory: ['C2-005'] })
  ind('followup', [say('add macd', [add('A', 'macd')]), say('make the macd 8, 21 and 5', [upd('A', '$inst:A:MACD', kv({ fastPeriod: 8, slowPeriod: 21, signalPeriod: 5 }))])], null, changes(['A'], [paneUp('A')]), { unverifiable: ['the MACD numbers: its pane has no chip the rig reads, so the check is the pane and a receipt'] })
  ind('params', 'add a stochastic with a 5 period %K', [add('A', 'stoch', kv({ kPeriod: 5 }))], changes(['A'], [paneUp('A')], { undo: true }), { inventory: ['C2-005'] })
  ind('params', 'atr with a 10 period', [add('A', 'atr', kv({ period: 10 }))], changes(['A'], [paneUp('A')], { undo: true }), { inventory: ['C2-005'] })
  ind('params', 'parabolic sar with a 0.03 step', [add('A', 'sar', kv({ step: 0.03 }))], changes(['A'], [px('A')], { undo: true }), { inventory: ['C2-005'] })
  ind('invalid', [say('add rsi', [add('A', 'rsi')]), say('set the rsi length to 5000', [upd('A', '$inst:A:RSI', kv({ period: 5000 }))])], null, { outcome: 'change', only: ['A'], expect: [paneUp('A')], says: '5000|between|max|1|range' }, { unverifiable: ['the RSI length itself (no chip): the check is that the out-of-range value is named, the pane still there'] })
  ind('phrasing', 'move the 20 ema into its own pane', [op('indicatorStyle.placeIn', ie('A'), { instance: '$inst:A:EMA 20', place: 'pane' })], changes(['A'], [paneUp('A')], { undo: true }), { inventory: ['C2-036'] })

  // ── recovery from ambiguity: concrete choices on screen, then the short answer lands ──────────────────────────────────
  const a = family(L, 'u8-ambiguity', { inv: ['C1-006'], board: 'FOUR', select: null })
  const which = (text) => say(text, clarify('Which chart?', ['Top-left chart (SPY)', 'Top-right chart (QQQ)', 'Bottom-left chart (NVDA)', 'Bottom-right chart (TSLA)']))
  const lastOn = (roles, expect) => ({ outcome: 'change', only: roles, expect, says: 'Top-left chart \\(SPY\\)' })
  a('target', [which('add rsi'), say('the QQQ one', [add('TR', 'rsi')])], null, lastOn(['TR'], [paneUp('TR')]), { inventory: ['C2-004'] })
  a('target', [which('make it weekly'), say('2', [tf('TR', 'W')])], null, lastOn(['TR'], [['TR.tf', 'eq', 'W']]))
  a('target', [which('log scale please'), say('the bottom left', [scale('BL', 'log')])], null, lastOn(['BL'], [['BL.scale', 'eq', 'log']]), { inventory: ['C1-022'] })
  a('target', [which('hide volume'), say('all of them', [vol('TL', 'hidden'), vol('TR', 'hidden'), vol('BL', 'hidden'), vol('BR', 'hidden')])], null, lastOn(['TL', 'TR', 'BL', 'BR'], [['TL.volume', 'eq', false], ['BR.volume', 'eq', false]]), { inventory: ['C1-086'] })
  a('target', [which('add a macd'), say('never mind', { disposition: 'answer', reply: 'OK, nothing changed.', ops: [] })], null, { outcome: 'answer', says: 'Top-left chart \\(SPY\\)' }, { inventory: ['C2-004'] })
  a('target', [say('make the NVDA chart weekly', clarify('There are two NVDA charts. Which one?', ['Top-right chart (NVDA)', 'Bottom-left chart (NVDA)'])), say('the bottom one', [tf('BL', 'W')])], null, { outcome: 'change', only: ['BL'], expect: [['BL.tf', 'eq', 'W']], says: 'Top-right chart \\(NVDA\\)' }, { board: 'TWIN' })
  a('target', [which('draw a line at 120'), say('the TSLA chart', [level(120, 'BR')])], null, { outcome: 'change', expect: [['drawings.TSLA', 'len', 1]], says: 'Bottom-right chart \\(TSLA\\)' }, { inventory: ['C1-131'] })
}
