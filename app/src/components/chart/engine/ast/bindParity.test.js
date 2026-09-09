// app/src/components/chart/engine/ast/bindParity.test.js
//
// ─── ⭐⭐ THE JS HALF OF THE BIND-FOLD PARITY ────────────────────────────────
//
// `tests/fixtures/ast/bind_fold_parity.json` is the third party. This file
// asserts THIS lane against it; `tests/test_ast_bind_parity.py` asserts the
// Python lane against the same rows.
//
// ⛔ NEITHER LANE IS THE ORACLE FOR THE OTHER. A test that shelled out to the
// other lane and compared would be GREEN WHEN BOTH ARE WRONG TOGETHER — a
// failure this repo has already paid for (*"a cross-lane equality is satisfied
// by two lanes that are wrong together"*). A pinned expectation fails when either
// moves, including when they move in step. It also means this rail runs on every
// push instead of only when somebody remembers to start a node subprocess.
//
// ⛔ THE REFUSAL STRINGS ARE PINNED, NOT ONLY THE VERDICTS. The owner ruled the
// lanes must produce the same reason string: a member pasting into the builder
// and a sweep evaluating the saved definition must be told the same thing about
// the same length.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { foldBound, foldScalar, bindingConstants, NotFoldable } from './bind.js'
import { maxLookback } from './interpret.js'

const FIXTURE = path.resolve(
  process.cwd(), '..', 'tests/fixtures/ast/bind_fold_parity.json',
)
const CASES = JSON.parse(readFileSync(FIXTURE, 'utf8')).cases

const consts = (c) => bindingConstants({
  timeframe: c.timeframe, inputs: c.inputs, symbol: c.symbol,
})

describe('the fixture is a real population', () => {
  it('⛔ non-vacuity — it carries folds, refusals AND left-alone cases', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(6)
    expect(CASES.some((c) => c.foldsTo !== undefined)).toBe(true)
    expect(CASES.some((c) => c.refusalContains)).toBe(true)
    expect(CASES.some((c) => c.leavesUnfolded)).toBe(true)
    // ⭐ AND THE TEXT HALF, ASSERTED SEPARATELY. Without this the text rows could
    // all be deleted and every remaining assertion below would still pass — the
    // failure mode a shared fixture is most prone to.
    expect(CASES.some((c) => c.foldScalarTo !== undefined)).toBe(true)
    expect(CASES.some((c) => c.notFoldableOn)).toBe(true)
  })
})

describe('this lane answers a TEXT question with the PINNED number', () => {
  for (const c of CASES.filter((x) => x.foldScalarTo !== undefined)) {
    it(`⭐ ${c.id}`, () => {
      expect(foldScalar(c.tree, consts(c))).toBe(c.foldScalarTo)
      if (c.maxLookback !== undefined) {
        // ⛔ AND IT COSTS NO BARS. `syminfo.*` is settled by the BINDING, so a
        // text question over it reads no bar at all — pinned beside the answer
        // because a lookback silently guessed at 0 and a lookback that IS 0 look
        // identical until the day the guess is wrong.
        expect(maxLookback(c.tree)).toBe(c.maxLookback)
      }
    })
  }
})

describe('an unresolvable symbol-scoped field STOPS the fold and names itself', () => {
  for (const c of CASES.filter((x) => x.notFoldableOn)) {
    it(`⛔ ${c.id}`, () => {
      let err = null
      try {
        foldScalar(c.tree, consts(c))
      } catch (e) { err = e }
      expect(err, `${c.id} did not stop at all`).toBeInstanceOf(NotFoldable)
      expect(err.what).toContain(c.notFoldableOn)
      for (const fragment of c.notFoldableSays || []) {
        expect(err.what, `missing ${JSON.stringify(fragment)}`).toContain(fragment)
      }
    })
  }
})

describe('this lane folds to the PINNED literal', () => {
  for (const c of CASES.filter((x) => x.foldsTo !== undefined)) {
    it(`⭐ ${c.id}`, () => {
      const out = foldBound(c.tree, consts(c))
      expect(out.args[1]).toEqual({ type: 'num', value: c.foldsTo })
      if (c.maxLookback !== undefined) {
        // ⛔ THE BUDGET IS PRICED ON THE FOLDED TREE — pinned beside the literal,
        // because a fold can produce the right number and leave a tree the budget
        // then reads differently.
        expect(maxLookback(out)).toBe(c.maxLookback)
      }
    })
  }
})

describe('this lane refuses with the PINNED sentence', () => {
  for (const c of CASES.filter((x) => x.refusalContains)) {
    it(`⛔ ${c.id}`, () => {
      let message = null
      try {
        foldBound(c.tree, consts(c))
      } catch (err) {
        message = String(err.message)
      }
      expect(message, `${c.id} did not refuse at all`).toBeTruthy()
      for (const fragment of c.refusalContains) {
        expect(message, `missing ${JSON.stringify(fragment)}`).toContain(fragment)
      }
    })
  }
})

describe('an unfoldable length is LEFT ALONE and names its operand', () => {
  for (const c of CASES.filter((x) => x.leavesUnfolded)) {
    it(`⛔ ${c.id}`, () => {
      // No partial fold: the slot comes back exactly as it went in, so the
      // window check downstream refuses the member's own expression rather than
      // a half-rewritten version of it.
      const out = foldBound(c.tree, consts(c))
      expect(out.args[1]).toEqual(c.tree.args[1])
      let what = null
      try {
        foldScalar(c.tree.args[1], consts(c))
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoldable)
        what = err.what
      }
      expect(what).toBe(c.notFoldableOperand)
    })
  }
})

describe('the pair cannot silently become a one-lane rail', () => {
  it('⚠️ the PYTHON half exists and reads this same fixture', () => {
    // A parity fixture only one lane reads is not a parity fixture. This is the
    // cheap check that stops somebody deleting the other half and leaving every
    // test here green.
    const py = path.resolve(process.cwd(), '..', 'tests/test_ast_bind_parity.py')
    const text = readFileSync(py, 'utf8')
    expect(text).toContain('bind_fold_parity.json')
  })
})
