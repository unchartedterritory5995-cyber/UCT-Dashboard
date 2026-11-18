// OPTIONS FLOW WIDGET FILTERS (F-16 widened by the owner, 2026-11-10; pl-widget, agent/pl/exec-flow-filters). HELD-OUT phrasings,
// written as FAMILIES before the change and never used to tune it. Rows: C3-166 (premium, call/put, type, direction), with the
// widget's own chips exactly as its UI has them (OptionsFlowWidget.jsx): four single-select groups —
//   Min: All / $250K / $500K / $1M (filters.minPrem)   · All / Calls / Puts (filters.cp)
//   Any / Sweep / Block (filters.type)                 · All / Bull / Bear (filters.dir)
// — combined with AND across groups. args = the widget.setOption ops a correct planner sends; want = the widget's filters after.
const op = (key, value) => ({ key, value })
const W = (o) => ({ minPrem: 0, cp: 'all', type: 'all', dir: 'all', ...o })
export const FLOW_SET_HELD_OUT = [
  { text: 'show me just the call side of the options flow', ops: [op('callPut', 'Calls')], want: W({ cp: 'C' }) },
  { text: 'options flow: puts please', ops: [op('callPut', 'Puts')], want: W({ cp: 'P' }) },
  { text: 'flip the options flow widget over to puts', ops: [op('callPut', 'P')], want: W({ cp: 'P' }) },
  { text: 'only sweeps in the options flow', ops: [op('printType', 'Sweep')], want: W({ type: 'SWEEP' }) },
  { text: 'show me just the sweeps on the options flow widget', ops: [op('printType', 'SWEEP')], want: W({ type: 'SWEEP' }) },
  { text: 'block trades only on the options flow', ops: [op('printType', 'Block')], want: W({ type: 'BLOCK' }) },
  { text: 'show me the bearish options flow', ops: [op('direction', 'Bear')], want: W({ dir: 'BEAR' }) },
  { text: 'options flow, bull side only', ops: [op('direction', 'Bull')], want: W({ dir: 'BULL' }) },
  { text: 'options flow prints over a million in premium', ops: [op('minPremium', '$1M')], want: W({ minPrem: 1000000 }) },
  { text: 'only 500k and up on the options flow', ops: [op('minPremium', 500000)], want: W({ minPrem: 500000 }) },
  // AND across groups, as the chips combine
  { text: 'bullish call sweeps on the options flow', ops: [op('callPut', 'Calls'), op('printType', 'Sweep'), op('direction', 'Bull')], want: W({ cp: 'C', type: 'SWEEP', dir: 'BULL' }) },
  { text: 'options flow: bearish put blocks over 250k', ops: [op('callPut', 'Puts'), op('printType', 'Block'), op('direction', 'Bear'), op('minPremium', '$250K')], want: W({ cp: 'P', type: 'BLOCK', dir: 'BEAR', minPrem: 250000 }) },
]
// back to every print: each group's own All / Any chip (the widget has no single "clear" button)
export const FLOW_RESET_HELD_OUT = [
  { text: 'clear the options flow filters', ops: [op('callPut', 'All'), op('printType', 'Any'), op('direction', 'All'), op('minPremium', 'All')], from: { cp: 'C', type: 'SWEEP', dir: 'BULL', minPrem: 500000 }, want: W({}) },
  { text: 'show calls and puts again on the options flow', ops: [op('callPut', 'All')], from: { cp: 'P' }, want: W({}) },
]
// what must NOT happen. conflict = two values of ONE single-select group in one request (the UI allows one chip per group)
export const FLOW_REFUSE_HELD_OUT = [
  { text: 'calls and puts only in the options flow', ops: [op('callPut', 'Calls'), op('callPut', 'Puts')], refuse: /one choice.*All.*Calls.*Puts/i, kind: 'conflict' },
  { text: 'show sweeps and blocks on the options flow', ops: [op('printType', 'Sweep'), op('printType', 'Block')], refuse: /one choice.*Any.*Sweep.*Block/i, kind: 'conflict' },
  { text: 'only bull and bear prints on the options flow', ops: [op('direction', 'Bull'), op('direction', 'Bear')], refuse: /one choice/i, kind: 'conflict' },
  { text: 'options flow premium over 2 million', ops: [op('minPremium', 2000000)], refuse: /\$250K.*\$500K.*\$1M/, kind: 'not a chip' },
  // REASON TEXT CORRECTED after run 2 (2026-11-10; Lead: assert the ACTUAL path). The expectation was /no option “darkPool”/ (the
  // capability's refusal), but "dark pool" is itself a hidden phrase and not the widget's name, so the F-16 SCREEN refusal answers
  // first. The outcome assertions are unchanged and strict: refused, nothing written, no chip changed, nothing proposed.
  // Raw output of the original expectation: docs/agent/program/evidence/f16-run2-dark-pool.txt
  { text: 'only dark pool prints in the options flow', ops: [op('darkPool', 'on')], refuse: /I didn't run it: UCT Agent can't screen on/, kind: 'invented filter' },
]
// two Options Flow widgets: nothing names one → ASK, listing both; a referent → that one only
export const FLOW_TWO_WIDGETS_HELD_OUT = [
  { text: 'just the sweeps in options flow please', which: null },
  { text: 'show me the bearish flow on the options flow widget', which: null },
  { text: 'only sweeps in the left options flow', which: 'left' },
  { text: 'puts only on the right options flow', which: 'right' },
]

import { describe, it, expect } from 'vitest'
describe('options-flow held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...FLOW_SET_HELD_OUT, ...FLOW_RESET_HELD_OUT, ...FLOW_REFUSE_HELD_OUT, ...FLOW_TWO_WIDGETS_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
