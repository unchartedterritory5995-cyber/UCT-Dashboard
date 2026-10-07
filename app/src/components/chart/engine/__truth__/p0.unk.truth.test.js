/** P0 TRUTH CORPUS — slice "unk" (0E UNKNOWN must not become FALSE, 0F current
 *  scalars vs historical series, 0R controls). Browser lane; the Python twin is
 *  `tests/test_p0_truth_unk.py` and reads the SAME controls fixture.
 *
 *  Every case states ASKED / CLAIMED / DID and an outcome class
 *  (VALUE, UNKNOWN, REFUSAL, EXACT, DISCLOSED DIFFERENCE, …). "BEFORE" records
 *  what the engine did at base `a92b96de2`, reproduced before the fix.
 *
 *  ⭐ THE ENGINE'S UNKNOWN MODEL (documented here, NOT changed by this slice):
 *    - unknown is `NaN` (Python: NaN in the walker, `None` on the wire);
 *    - `&&`, `||`, `!`, `?:` PROPAGATE unknown strictly (`interpret.js::logical`,
 *      `UNARY['!']`, `TERNARY`; Python `_logical`, `_ternary`) — not Kleene;
 *    - a COMPARISON against unknown answers 0 (`cmp`, X23) — the one place unknown
 *      collapses to a confident FALSE. Changing it moves warm-up bars of every
 *      comparison (measured: 11 of 176 conformance trees, both lanes), so it is
 *      STOP — owner review (report: gated `meta` flag for new native saves);
 *    - the Pine lane, from the listing and on v4+, reads an `na` condition as
 *      FALSE (`pineBool`, `PINE_TERNARY`) — that is Pine's documented rule;
 *    - consumers ask "is an input unresolved" BEFORE evaluating
 *      (`unresolved_scalars` / `unresolved_inputs` / `unresolved_lookback`) so a
 *      comparison never gets the chance to launder a hole. This slice adds the
 *      CHART lane's and the ALERT lane's copy of that question for scalars. */
import { describe, it, expect } from 'vitest'

import { interpret, BINARY, UNARY, TERNARY, PINE_TERNARY } from '../ast/interpret.js'
import { computeFor, columnErrors } from '../nativeRegistry.js'
import { CHART_SCALAR_GUARD, chartScalarRefusal } from '../chartScalars.js'
import { parseFormula } from '../ast/parse.js'
import CONTROLS from './p0.unk.controls.json'

const SER = (name) => ({ type: 'series', name })
const NUM = (value) => ({ type: 'num', value })
const OP = (name, ...args) => ({ type: 'op', name, args })
const UNK = OP('/', NUM(0), NUM(0)) // a hole every lane evaluates to NaN

const BARS = CONTROLS.bars
const wire = (col) => Array.from(col, (v) => (typeof v === 'number' && Number.isNaN(v) ? null : v))
const last = (ast, scalars) => wire(interpret(ast, BARS, undefined, undefined, scalars, { tf: 'D' })).at(-1)

// --------------------------------------------------------------------------- //
// 0E — the truth table, as the engine computes it TODAY (pinned, both lanes)
// --------------------------------------------------------------------------- //
describe('0E truth table — unknown through operators (native formula lane)', () => {
  // ASKED: "is <unknown> > 1" etc. CLAIMED: {0,1,NaN} domain where NaN = not
  // computable. DID: listed per row. Classes: UNKNOWN rows are honest; the two
  // comparison rows are the documented X23 collapse (DISCLOSED DIFFERENCE at the
  // evaluator; consumers must ask first — STOP for a global change).
  const rows = [
    ['unknown > number', OP('>', UNK, NUM(1)), 0, 'DISCLOSED DIFFERENCE (X23: compare-vs-NaN is 0)'],
    ['unknown == number', OP('==', UNK, NUM(1)), 0, 'DISCLOSED DIFFERENCE (X23)'],
    ['unknown AND true', OP('&&', UNK, NUM(1)), null, 'UNKNOWN'],
    ['unknown AND false', OP('&&', UNK, NUM(0)), null, 'UNKNOWN (strict, not Kleene)'],
    ['unknown OR true', OP('||', UNK, NUM(1)), null, 'UNKNOWN (strict, not Kleene)'],
    ['unknown OR false', OP('||', UNK, NUM(0)), null, 'UNKNOWN'],
    ['NOT unknown', OP('!', UNK), null, 'UNKNOWN'],
    ['unknown ?: a : b', OP('?:', UNK, NUM(2), NUM(3)), null, 'UNKNOWN'],
  ]
  for (const [asked, ast, did, klass] of rows) {
    it(`${asked} -> ${did === null ? 'UNKNOWN' : did} [${klass}]`, () => {
      expect(last(ast)).toBe(did)
    })
  }

  it('the kernels themselves agree with the table (shared by the runtime vm)', () => {
    expect(BINARY['>'](NaN, 1)).toBe(0)
    expect(BINARY['=='](NaN, 1)).toBe(0)
    expect(BINARY['&&'](NaN, 0)).toBeNaN()
    expect(BINARY['||'](NaN, 1)).toBeNaN()
    expect(UNARY['!'](NaN)).toBeNaN()
    expect(TERNARY(NaN, 2, 3)).toBeNaN()
  })

  it('Pine lane (v4+, from the listing): an na test takes the ELSE branch — Pine\'s own rule [EXACT]', () => {
    expect(PINE_TERNARY(NaN, 2, 3)).toBe(3)
  })

  it('crossOver / barssince / valuewhen keep unknown unknown [UNKNOWN]', () => {
    expect(last({ type: 'call', name: 'crossOver', args: [UNK, SER('close')] })).toBe(null)
    expect(wire(interpret({ type: 'call', name: 'barssince', args: [OP('&&', UNK, NUM(1)), NUM(5)] }, BARS)).every((v) => v === null)).toBe(true)
    expect(wire(interpret({ type: 'call', name: 'valuewhen', args: [OP('&&', UNK, NUM(1)), SER('close'), NUM(5)] }, BARS)).every((v) => v === null)).toBe(true)
  })

  it('…but a comparison FEEDING them launders first (X23, residual — owner review)', () => {
    // ASKED barssince(market_cap > 1e9). DID: counts bars since a "false" that is
    // really unknown. Pinned so the gated change in the report is deliberate.
    const col = wire(interpret({ type: 'call', name: 'barssince', args: [OP('>', SER('market_cap'), NUM(1e9)), NUM(5)] }, BARS))
    expect(col.at(-1)).toBe(5)
  })
})

// --------------------------------------------------------------------------- //
// 0F — current scalars are not historical series
// --------------------------------------------------------------------------- //
const astDoc = (source, extra = {}) => {
  const { ast } = parseFormula(source)
  return {
    schemaVersion: 1, id: 'u_p0unk', version: 1,
    compute: { kind: 'ast', fn: 'sha256:p0unk', rev: 1, ast, source, ...extra },
    meta: { name: 'P0', shortName: 'P0', category: 'Custom', tier: 'premium', repaint: 'non-repainting' },
    placement: { target: 'pane', pane: { height: 0.15 } },
    plots: [{ key: 'value', label: 'v', style: 'line', color: '#fff' }],
  }
}
const chart = (def) => {
  const cols = computeFor(def, BARS, {}, { tf: 'D', newestBarIsForming: false })
  return { cols, errs: columnErrors(cols) || {} }
}

describe('0F scalars on the chart lane', () => {
  it('ASKED market_cap > 1e9 on a chart · CLAIMED (GRAMMAR.md) "can chart" · BEFORE: a confident 0 on every bar · NOW: REFUSAL with a sentence', () => {
    const { cols, errs } = chart(astDoc('market_cap > 1000000000'))
    expect(cols.value).toBeUndefined()
    expect(errs.value.guard).toBe(CHART_SCALAR_GUARD)
    expect(errs.value.message).toMatch(/`market_cap` is today's value/)
    expect(errs.value.message).toMatch(/invent a history/)
  })

  it('ASKED !(market_cap > 1e9) · BEFORE: a confident 1 on every bar · NOW: REFUSAL', () => {
    const { cols, errs } = chart(astDoc('!(market_cap > 1000000000)'))
    expect(cols.value).toBeUndefined()
    expect(errs.value.guard).toBe(CHART_SCALAR_GUARD)
  })

  it('ASKED bare market_cap · BEFORE: all-NaN with no reason · NOW: REFUSAL', () => {
    expect(chart(astDoc('market_cap')).errs.value.guard).toBe(CHART_SCALAR_GUARD)
  })

  it('ASKED nz(market_cap, 0) > 1e9 (member-chosen zero) · NOW: REFUSAL — today\'s value has no history either', () => {
    expect(chart(astDoc('nz(market_cap, 0) > 1000000000')).errs.value.guard).toBe(CHART_SCALAR_GUARD)
  })

  it('multi-tree: only the plot that reads a scalar is refused; its sibling draws [PARTIAL]', () => {
    const a = parseFormula('close > 100').ast
    const b = parseFormula('rs_rank > 80').ast
    const def = astDoc('close > 100', { trees: { value: a, rank: b } })
    def.plots = [{ key: 'value', label: 'v', style: 'line', color: '#fff' }, { key: 'rank', label: 'r', style: 'line', color: '#fff' }]
    const { cols, errs } = chart(def)
    expect(Array.from(cols.value).length).toBe(BARS.length)
    expect(errs.value).toBeUndefined()
    expect(errs.rank.guard).toBe(CHART_SCALAR_GUARD)
  })

  it('CONTROL: a price formula still draws [VALUE]', () => {
    const { cols, errs } = chart(astDoc('close > 100'))
    expect(errs.value).toBeUndefined()
    expect(new Set(wire(cols.value))).toEqual(new Set([0, 1]))
  })

  it('the refusal is derived from the manifest, never a hand-list', () => {
    expect(chartScalarRefusal(SER('close'))).toBeNull()
    expect(chartScalarRefusal(OP('>', SER('rs_rank'), SER('market_cap')))).toMatch(/`market_cap`, `rs_rank` are/)
  })

  it('SCREENER contract unchanged: a supplied current scalar is a VALUE; a missing one is UNKNOWN at the leaf', () => {
    expect(last(OP('>', SER('market_cap'), NUM(1e9)), { market_cap: 2e9 })).toBe(1)
    expect(last(SER('market_cap'), {})).toBe(null)
  })
})

// --------------------------------------------------------------------------- //
// 0R — controls: unchanged outputs vs the pre-change snapshot (both lanes)
// --------------------------------------------------------------------------- //
describe('0R controls — SMA EMA RMA RSI ATR crossOver crossUnder (and a warm-up comparison) [EXACT]', () => {
  for (const [name, tree] of Object.entries(CONTROLS.trees)) {
    it(`${name} is byte-for-byte the pre-change snapshot`, () => {
      const got = wire(interpret(tree, BARS)).map((v) => (v === null ? null : Math.round(v * 1e9) / 1e9))
      const want = CONTROLS.expect[name]
      expect(got.length).toBe(want.length)
      got.forEach((v, i) => {
        if (want[i] === null) expect(v, `${name}[${i}]`).toBeNull()
        else expect(Math.abs(v - want[i]), `${name}[${i}]`).toBeLessThan(1e-8)
      })
    })
  }
  it('the snapshot is not degenerate (each control has finite values)', () => {
    for (const [name, col] of Object.entries(CONTROLS.expect)) {
      expect(col.some((v) => typeof v === 'number'), name).toBe(true)
    }
  })
})
