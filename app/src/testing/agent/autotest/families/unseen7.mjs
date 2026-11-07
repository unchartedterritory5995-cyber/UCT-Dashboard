// UCT Agent AUTOTEST: UNSEEN batch 7 (2026-11-07), written BEFORE the code lands and before any run of it. The owner's decision: the
// Agent may set ALL of the Options Flow widget's existing filters. The filters were READ from the widget's own code first
// (pages/charts/widgets/OptionsFlowWidget.jsx, read-only), and only those are used:
//   filters.minPrem   0 | 250000 | 500000 | 1000000          (the Min chips: All, $250K, $500K, $1M)
//   filters.cp        'all' | 'C' | 'P'                       (All, Calls, Puts)
//   filters.type      'all' | 'SWEEP' | 'BLOCK'               (Any, Sweep, Block)
//   filters.dir       'all' | 'BULL' | 'BEAR'                 (All, Bull, Bear)
//   lead              'tape' | 'biggest' | 'sentiment'        (the lead view)
//   scope             'market' | 'symbol'                     (the symbol filter: per-symbol follows the LINKED chart's symbol;
//                                                              there is no free-typed ticker box)
// Plans use widget.setOption with the registry's keys (minPremium, callPut, printType, direction, lead, scope). Oracles read the
// widget's opts as the layout wrote them, never the receipt. Informational questions must change nothing; an unsupported value
// gets an honest refusal. Board WIDGETS (w-flow, link colour A = SPY). BROWSER-MOCK-MODEL: the plans are scripted.
import { family, op, say, changes, refuses, reads, answers, unsupported, answer } from './dsl.mjs'

const b = '$list:board'
const set = (key, value) => op('widget.setOption', b, { widget: 'w-flow', key, value })
const wrote = (re) => ['written', 're', re]
const wroteNot = (re) => ['written', 'notRe', re]
const keep = { settleMs: 2500 }
const one = (text, ops) => ({ turns: [say(text, ops, keep)] })
const two = (t1, o1, t2, o2) => ({ turns: [say(t1, o1, keep), say(t2, o2, keep)] })

export function unseen7(L) {
  const cp = family(L, 'u7-calls-puts', { inv: ['C3-166'], board: 'WIDGETS', select: null })
  cp('phrasing', 'show only puts in the flow', null, changes(['A'], [wrote('cp\\W+P\\W')], { undo: true }), one('show only puts in the flow', [set('callPut', 'P')]))
  cp('phrasing', 'options flow, calls only please', null, changes(['A'], [wrote('cp\\W+C\\W')], { undo: true }), one('options flow, calls only please', [set('callPut', 'C')]))
  cp('phrasing', 'hide the calls in the options flow', null, changes(['A'], [wrote('cp\\W+P\\W')], { undo: true }), one('hide the calls in the options flow', [set('callPut', 'P')]))
  cp('followup', 'puts only, then both again', null, changes(['A'], [wroteNot('cp\\W+P\\W')]), two('puts only in the options flow', [set('callPut', 'P')], 'ok show calls and puts again in the flow', [set('callPut', 'all')]))

  const pr = family(L, 'u7-premium', { inv: ['C3-166'], board: 'WIDGETS', select: null })
  pr('params', 'flow prints over 250K only', null, changes(['A'], [wrote('minPrem\\W+250000')], { undo: true }), one('flow prints over 250K only', [set('minPremium', 250000)]))
  pr('params', 'set the options flow minimum to half a million', null, changes(['A'], [wrote('minPrem\\W+500000')], { undo: true }), one('set the options flow minimum to half a million', [set('minPremium', 500000)]))
  pr('params', 'only million dollar prints in the flow', null, changes(['A'], [wrote('minPrem\\W+1000000')], { undo: true }), one('only million dollar prints in the flow', [set('minPremium', 1000000)]))
  pr('followup', 'a floor, then no floor', null, changes(['A'], [wroteNot('minPrem\\W+500000')]), two('flow minimum 500K', [set('minPremium', 500000)], 'remove the premium floor on the flow', [set('minPremium', 0)]))

  const ty = family(L, 'u7-type-direction', { inv: ['C3-166'], board: 'WIDGETS', select: null })
  ty('phrasing', 'only sweeps in the options flow', null, changes(['A'], [wrote('type\\W+SWEEP')], { undo: true }), one('only sweeps in the options flow', [set('printType', 'SWEEP')]))
  ty('phrasing', 'just blocks on the flow widget', null, changes(['A'], [wrote('type\\W+BLOCK')], { undo: true }), one('just blocks on the flow widget', [set('printType', 'BLOCK')]))
  ty('followup', 'sweeps, then any type', null, changes(['A'], [wroteNot('type\\W+SWEEP')]), two('sweeps only in the flow', [set('printType', 'SWEEP')], 'any print type again on the flow', [set('printType', 'all')]))
  ty('phrasing', 'only bullish options flow', null, changes(['A'], [wrote('dir\\W+BULL')], { undo: true }), one('only bullish options flow', [set('direction', 'BULL')]))
  ty('phrasing', 'bearish prints only on the flow', null, changes(['A'], [wrote('dir\\W+BEAR')], { undo: true }), one('bearish prints only on the flow', [set('direction', 'BEAR')]))
  ty('followup', 'bearish, then both directions', null, changes(['A'], [wroteNot('dir\\W+BEAR')]), two('bearish flow only', [set('direction', 'BEAR')], 'show both directions in the flow again', [set('direction', 'all')]))

  const lv = family(L, 'u7-lead-scope', { inv: ['C3-165'], board: 'WIDGETS', select: null })
  lv('phrasing', 'lead the options flow with the biggest prints first', null, changes(['A'], [wrote('lead\\W+biggest')], { undo: true }), one('lead the options flow with the biggest prints first', [set('lead', 'biggest')]))
  lv('phrasing', 'show the flow sentiment view', null, changes(['A'], [wrote('lead\\W+sentiment')], { undo: true }), one('show the flow sentiment view', [set('lead', 'sentiment')]))
  lv('target', 'flow for the linked chart only', null, changes(['A'], [wrote('scope\\W+symbol')], { undo: true }), { inventory: ['C3-164'], ...one('flow for the linked chart only', [set('scope', 'symbol')]) })
  lv('followup', 'linked symbol, then the whole market', null, changes(['A'], [wroteNot('scope\\W+symbol')]), { inventory: ['C3-164'], ...two('just this symbol in the options flow', [set('scope', 'symbol')], 'back to the whole market in the flow', [set('scope', 'market')]) })

  const co = family(L, 'u7-combos', { inv: ['C3-166'], board: 'WIDGETS', select: null })
  co('combo', 'big bullish call sweeps over a million', null, changes(['A'], [wrote('cp\\W+C\\W'), wrote('type\\W+SWEEP'), wrote('dir\\W+BULL'), wrote('minPrem\\W+1000000')], { undo: true }), one('big bullish call sweeps over a million', [set('callPut', 'C'), set('printType', 'SWEEP'), set('direction', 'BULL'), set('minPremium', 1000000)]))
  co('combo', 'puts only and at least 500K in the flow', null, changes(['A'], [wrote('cp\\W+P\\W'), wrote('minPrem\\W+500000')], { undo: true }), one('puts only and at least 500K in the flow', [set('callPut', 'P'), set('minPremium', 500000)]))
  co('combo', 'biggest bearish blocks in the options flow', null, changes(['A'], [wrote('lead\\W+biggest'), wrote('dir\\W+BEAR'), wrote('type\\W+BLOCK')], { undo: true }), { inventory: ['C3-165', 'C3-166'], ...one('biggest bearish blocks in the options flow', [set('lead', 'biggest'), set('direction', 'BEAR'), set('printType', 'BLOCK')]) })

  // ── questions: they change nothing ─────────────────────────────────────────────────────────────────────────────────────
  const q = family(L, 'u7-questions', { inv: ['C3-167'], board: 'WIDGETS', select: null })
  q('phrasing', 'what is the options flow filtered to right now', [op('widget.readOptions', b, { widget: 'w-flow' })], reads())
  q('phrasing', 'which filters can I use on the flow widget', [op('widget.readOptions', b, { widget: 'w-flow' })], reads())
  q('phrasing', 'what does a sweep mean in the options flow', [], answers(), { turns: [say('what does a sweep mean in the options flow', answer('A sweep is an order split across exchanges to fill fast. The flow tags those prints SWEEP.'))] })
  q('phrasing', 'are there any puts in the flow right now', [], answers(), { turns: [say('are there any puts in the flow right now', answer('I can\'t read the prints themselves, only the widget\'s filters. Its Calls / Puts filter is set to All.'))] })

  // ── values the widget does not have: an honest refusal, nothing written ─────────────────────────────────────────────────
  const u = family(L, 'u7-unsupported', { inv: ['C3-166'], board: 'WIDGETS', select: null })
  u('invalid', 'flow prints over 100K only', null, refuses({ expect: [wroteNot('minPrem\\W+100000')] }), one('flow prints over 100K only', [set('minPremium', 100000)]))
  u('invalid', 'only show ML prints in the flow', null, refuses({ expect: [wroteNot('\\WML\\W')] }), one('only show ML prints in the flow', [set('printType', 'ML')]))
  u('unsupported', 'filter the options flow by expiration date', [], refuses(), { turns: [say('filter the options flow by expiration date', unsupported('The Options Flow widget has no expiration filter. Its filters are the premium floor, calls / puts, sweeps / blocks and bull / bear.'))] })
  u('invalid', 'show me the options flow for TSLA', null, refuses({ expect: [wroteNot('TSLA')] }), { unverifiable: ['the per-symbol view follows the LINKED chart (SPY here), there is no ticker box: asking to link a TSLA chart, or refusing, are both right; writing TSLA anywhere is the defect'], ...one('show me the options flow for TSLA', [set('scope', 'TSLA')]) })
}
