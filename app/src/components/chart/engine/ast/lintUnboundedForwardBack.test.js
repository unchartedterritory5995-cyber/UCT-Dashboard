// ⭐ Engine 66 (#1473) (bt, 2026-11-16) — AN UNBOUNDED FORWARD REACH SAYS NOTHING ABOUT HOW FAR BACK.
//
// `lastbaryear` (and its siblings) declare `lookback: 0` and `forward: "unbounded"`: the value is the
// newest bar's, so no bar makes it final, and it reads no earlier bar at all. `lint.js::ownWindow`
// answered `back: UNKNOWN` whenever the FORWARD half was unbounded, so `lint.js::maxLookback` and
// `interpret.js::maxLookback` disagreed on every tree holding such a leaf. The first corpus tree that
// does is chart-champions' "Sun-2DVWAP", reachable once its sessions translated
// (`lookbackAgreement.test.js`: 251 against "unanalysable"). The Python twin is
// `tests/test_ast_lookback_agreement.py::test_an_unbounded_forward_leaf_still_has_a_bounded_back_on_both_readers`.
import { describe, it, expect } from 'vitest'
import { lintRepaint, maxLookback as lintMax } from './lint.js'
import { maxLookback as interpretMax } from './interpret.js'

const leaf = { type: 'series', name: 'lastbaryear' }
const tree = {
  type: 'op', name: '?:', args: [
    { type: 'op', name: '==', args: [{ type: 'series', name: 'year' }, leaf] },
    { type: 'call', name: 'sma', args: [{ type: 'series', name: 'close' }, { type: 'num', value: 20 }] },
    { type: 'num', value: 0 },
  ],
}

describe('an unbounded forward reach says nothing about how far back', () => {
  it('both readers give one number for a tree holding `lastbaryear`', () => {
    const i = interpretMax(tree)
    expect(typeof i).toBe('number')
    expect(lintMax(tree)).toBe(i)
    expect(lintMax(leaf)).toBe(0)
  })
  it('…and the repaint verdict is untouched: the forward reach is still unbounded', () => {
    const r = lintRepaint(tree)
    expect(r.mode).toBe('repaints')
    expect(r.forward).toBe('unbounded')
  })
})
