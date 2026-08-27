// ⭐⭐ A PASTED SCRIPT'S OWN INPUTS BECOME THE SHEET'S OWN INPUTS — OR ARE
// REFUSED BY NAME.
//
// `translatePine` folds `input.int(14, "Length")` to `14` so the tree stays
// statically decidable, and records the fold on `outputs[i].inputsFolded`. This
// file drives the door that turns those records into member input rows.
//
// ⛔⛔ THE ONE THING THAT MAKES THIS HARD, AND EVERY ASSERTION BELOW EXISTS
// BECAUSE OF IT: a declared input is NOT free. `sma(close, len)` cannot be
// evaluated by this engine — `interpret.js::windowLiteral` refuses a window that
// is not a whole-number literal — so an `input.int` bound to a LENGTH cannot
// become a knob, while the same call bound to a THRESHOLD can. The rails here
// therefore never assert a refusal on its own: each one also RUNS THE ENGINE on
// the formula it is talking about, so a guard that refused the wrong half would
// go red rather than look tidy.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  inputsFromFolded, formulaNameRoles, FOLDED_INPUT_TYPES, FOLDED_INPUT_INEXPRESSIBLE,
  BUILDER_INPUTS,
} from './builderInputs'
import { evaluateFormula } from './FormulaField'
import { translatePine } from '../engine/ast/pine'
import { declaredInputs } from '../engine/ast/lint'
import { TABLE } from '../engine/ast/parse'

/** The engine's own answer for a formula with these rows declared. ⭐ THE RAIL
 *  IS THE ENGINE, NOT A STRING. Everything this door promises reduces to "the
 *  sheet can still evaluate what you handed it", and that is one call away. */
const evalWith = (source, rows) =>
  evaluateFormula(source, declaredInputs({ inputs: [...BUILDER_INPUTS, ...rows] }))

const SCRIPT = `//@version=5
indicator("t")
len = input.int(21, "Length", minval=1)
mult = input.float(2.5, "Mult")
flag = input.bool(true, "Flag")
plot(ta.sma(close, len) * mult)
`

describe('inputsFromFolded — the translator\'s folded list becomes member input rows', () => {
  it('reads the SHIPPED shape and refuses to guess a key it was not given', () => {
    const out = translatePine(SCRIPT)
    const active = out.outputs[out.selected]
    const folded = active.inputsFolded
    expect(folded[0]).toMatchObject({ call: 'input.int', title: 'Length', folded: '21' })
    // ⛔ AND THE FOLD IS TOTAL: the printed formula carries the LITERALS, which
    // is why nothing can be declared yet however the door is called.
    expect(active.formula).toBe('sma(close, 21) * 2.5')

    const { inputs, skipped } = inputsFromFolded(folded, active.formula)
    expect(inputs).toEqual([])
    expect(skipped.map((s) => s.reason)).toEqual(
      expect.arrayContaining([expect.stringMatching(/no bound name/)]),
    )
    // ⭐ AND IT NAMES WHAT WOULD UNBLOCK IT. `lesson_an_over_refusal_is_invisible`:
    // a wrong "no" has no red test and no complaint, so the honest ceiling is
    // whatever the refusal says would change its mind.
    expect(skipped[0].reason).toMatch(/TO UNBLOCK/)
    expect(skipped[0].reason).toContain('`usedInputs[]` gaining `name`')
  })

  it('🔴 with a bound name, an int THRESHOLD and a float MULTIPLIER become rows — a bool is skipped by name', () => {
    // ⭐ THE POSITIONS ARE REAL ONES. `overbought` is `input.int(60, "Over Bought
    // Level 1")` out of `pine_community/02-wavetrend-oscillator-lazybear.pine`;
    // `mult` is `input.float(2, "Bollinger Band Standard Devaition Up")` out of
    // `pine_community/03-cm-williams-vix-fix.pine`. Both land where this engine
    // takes a number from an input; the lengths beside them do not (next test).
    const source = 'rsi(close, 14) > overbought && close > sma(close, 20) + stdev(close, 20) * mult'
    const folded = [
      { call: 'input.int', title: 'Over Bought', folded: '60', name: 'overbought', min: 1, line: 3, column: 14 },
      { call: 'input.float', title: 'Mult', folded: '2.5', name: 'mult', line: 4, column: 8 },
      { call: 'input.bool', title: 'Flag', folded: '1', name: 'flag', line: 5, column: 8 },
      { call: 'input', title: null, folded: '3', name: 'k', line: 6, column: 5 },
    ]
    const { inputs, skipped } = inputsFromFolded(folded, source)

    expect(inputs).toEqual([
      { key: 'overbought', type: 'int', label: 'Over Bought', default: 60, min: 1 },
      { key: 'mult', type: 'float', label: 'Mult', default: 2.5 },
    ])
    // ⛔ BOTH DIRECTIONS ON ONE FORMULA. The rows this door admitted must leave
    // the sheet able to evaluate the source it admitted them for — that is the
    // entire promise, and it is checked by running it.
    const ran = evalWith(source, inputs)
    expect(ran.error, 'the admitted rows must leave the formula evaluable').toBeNull()
    expect(ran.ok).toBe(true)
    expect(ran.readback).toMatch(/overbought/)
    expect(ran.readback).toMatch(/mult/)

    expect(skipped).toHaveLength(2)
  })

  it('🔴 a bool is skipped BY NAME — it is not a numeric input', () => {
    // ⛔ ITS OWN CASE, so a mutation that deletes the kind gate names THIS test
    // rather than sharing a name with the never-read one below. A rail whose
    // failure cannot be told apart from its neighbour's is half a rail.
    const { skipped } = inputsFromFolded(
      [{ call: 'input.bool', title: 'Flag', folded: '1', name: 'flag' }],
      'close > flag',
    )
    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toMatch(/`input\.bool` is not a numeric input/)
    expect(skipped[0].reason).toMatch(/TO UNBLOCK/)
  })

  it('🔴 a name the formula never reads is skipped, naming the hand-back that would change it', () => {
    // ⭐ NOT A DEFECT IN THE DOOR — it is what EVERY entry looks like today,
    // because the translator still prints the folded literal. The refusal says
    // which hand-back moves it rather than reading as "we could not".
    const { inputs, skipped } = inputsFromFolded(
      [{ call: 'input', title: null, folded: '3', name: 'k' }], 'close * 2',
    )
    expect(inputs).toEqual([])
    expect(skipped[0].reason).toMatch(/the formula never reads `k`/)
    expect(skipped[0].reason).toMatch(/inputs: 'declare'/)
  })

  it('🔴🔴 an int bound to a WINDOW is refused BY NAME — and the engine proves the refusal right', () => {
    // ⛔⛔ THE CASE THAT MAKES THIS DOOR WORTH HAVING. `input.int(21, "Length")`
    // and `input.int(60, "Over Bought")` are the SAME CALL. A guard keyed on the
    // call kind admits both, and the second one is a formula the sheet cannot
    // evaluate — from a script that translated cleanly a moment earlier.
    const source = 'sma(close, len) * mult'
    const folded = [
      { call: 'input.int', title: 'Length', folded: '21', name: 'len', min: 1, line: 3, column: 7 },
      { call: 'input.float', title: 'Mult', folded: '2.5', name: 'mult', line: 4, column: 8 },
    ]
    const { inputs, skipped } = inputsFromFolded(folded, source)

    expect(inputs.map((i) => i.key), 'the multiplier survives; the length does not').toEqual(['mult'])
    const win = skipped.find((s) => s.name === 'len')
    expect(win.reason).toMatch(/`len` lands in a WINDOW/)
    expect(win.reason).toMatch(/resolve:window/)
    expect(win.reason).toMatch(/TO UNBLOCK/)
    expect(win.reason).toMatch(/_no_offset_reopened_by/)

    // ⭐⭐ THE REFUSAL IS MEASURED, NOT ASSERTED. Declaring `len` anyway is
    // exactly what this guard prevents, and the engine says why in its own words.
    const ifWeHadDeclaredIt = evalWith(source, [...inputs, { key: 'len', type: 'int', default: 21 }])
    expect(ifWeHadDeclaredIt.ok).toBe(false)
    expect(ifWeHadDeclaredIt.guard).toBe('resolve:window')
    expect(ifWeHadDeclaredIt.error).toMatch(/a window must be a whole-number literal/)
  })

  it('⛔ a window slot blocks a name even when the same name is ALSO read somewhere legal', () => {
    // ⚠️ THE ADVERSARIAL SHAPE A CORPUS CANNOT PRODUCE
    // (`lesson_a_corpus_is_blind_beside_what_it_measures`). `len` reads fine in
    // `close * len`; the window occurrence is the one that decides, because
    // `windowLiteral` refuses the whole formula and the member gets nothing.
    const source = 'sma(close, len) + close * len'
    const { inputs, skipped } = inputsFromFolded(
      [{ call: 'input.int', title: 'Length', folded: '21', name: 'len' }], source,
    )
    expect(inputs).toEqual([])
    expect(skipped[0].reason).toMatch(/lands in a WINDOW/)
    expect(evalWith(source, [{ key: 'len', type: 'int', default: 21 }]).guard).toBe('resolve:window')
  })

  it('⛔ an EXPRESSION in a window slot blocks every name beneath it, not just a bare identifier', () => {
    // `windowLiteral` requires `arg.type === 'num'` DIRECTLY, so `len + 1` is
    // refused exactly as `len` is. A guard that only looked for a bare `series`
    // node in the slot would admit this and ship an unevaluable formula.
    const source = 'sma(close, len + 1) * mult'
    const { inputs, skipped } = inputsFromFolded([
      { call: 'input.int', title: 'Length', folded: '21', name: 'len' },
      { call: 'input.float', title: 'Mult', folded: '2.5', name: 'mult' },
    ], source)
    expect(inputs.map((i) => i.key)).toEqual(['mult'])
    expect(skipped[0].reason).toMatch(/lands in a WINDOW/)
    expect(evalWith(source, [{ key: 'len', type: 'int', default: 21 }]).guard).toBe('resolve:window')
  })

  it('a key that collides with the builder\'s chrome is skipped, never shadowed', () => {
    const { inputs, skipped } = inputsFromFolded(
      [{ call: 'input.int', title: 'C', folded: '1', name: BUILDER_INPUTS[0].key }],
      `close * ${BUILDER_INPUTS[0].key}`,
    )
    expect(inputs).toEqual([])
    expect(skipped[0].reason).toMatch(/already a name/)
  })

  it('a key that collides with the CLOSED TABLE is skipped — the sheet would refuse it anyway', () => {
    // ⛔ THE ONE THAT DRAWS THE WRONG THING SILENTLY. An input called `close`
    // parses, lints and saves; it just is not the price any more.
    const { inputs, skipped } = inputsFromFolded(
      [{ call: 'input.int', title: 'C', folded: '5', name: 'close' }], 'close * 2',
    )
    expect(inputs).toEqual([])
    expect(skipped[0].reason).toMatch(/already a name this engine computes/)
  })

  it('⛔ WITHOUT the printed formula nothing is admitted, and the refusal says how to fix that', () => {
    // ⭐ THE FAIL-SAFE DIRECTION, AND WHY IT IS SAFE TO TAKE IT: an over-refusal
    // is invisible unless it names what would change its mind, so this one does.
    const { inputs, skipped } = inputsFromFolded(
      [{ call: 'input.float', title: 'Mult', folded: '2.5', name: 'mult' }],
    )
    expect(inputs).toEqual([])
    expect(skipped[0].reason).toMatch(/cannot be admitted without the formula/)
    expect(skipped[0].reason).toMatch(/inputsFromFolded\(folded, formula\)/)
  })

  it('a formula that does not read back here refuses every candidate, naming the reader\'s guard', () => {
    const { inputs, skipped } = inputsFromFolded(
      [{ call: 'input.float', title: 'Mult', folded: '2.5', name: 'mult' }],
      'close * * mult',
    )
    expect(inputs).toEqual([])
    expect(skipped[0].reason).toMatch(/does not read back here/)
  })

  it('a fold that printed an EXPRESSION is not a number, and says so', () => {
    // `input.source(hl2, "Source")` folds to `(high + low) / 2` — measured on
    // `pine/10-supertrend.pine`. Its kind refuses first; this is the guard for a
    // non-numeric fold that reaches an admitted kind.
    const { skipped } = inputsFromFolded(
      [{ call: 'input', title: 'Source', folded: '(high + low) / 2', name: 'src' }],
      'sma(src, 20)',
    )
    expect(skipped[0].reason).toMatch(/is not a number/)
  })

  it('bare `input(…)` takes its type from the default\'s integrality', () => {
    const source = 'close > whole && close < fraction'
    const { inputs } = inputsFromFolded([
      { call: 'input', title: null, folded: '3', name: 'whole' },
      { call: 'input', title: null, folded: '0.85', name: 'fraction' },
    ], source)
    expect(inputs.map((i) => [i.key, i.type, i.default, i.label]))
      .toEqual([['whole', 'int', 3, 'whole'], ['fraction', 'float', 0.85, 'fraction']])
    expect(evalWith(source, inputs).ok).toBe(true)
  })

  it('⭐ every kind this door refuses names what would unblock it — the honest ceiling', () => {
    // `lesson_an_over_refusal_is_invisible`: a doc-blocked "no" that does not say
    // what would move it is how a false refusal survives a task, a sweep and a
    // review. `PINE_INEXPRESSIBLE` holds this standard; so does this list.
    const kinds = Object.keys(FOLDED_INPUT_INEXPRESSIBLE)
    expect(kinds.length).toBeGreaterThan(0)
    for (const kind of kinds) {
      expect(FOLDED_INPUT_INEXPRESSIBLE[kind], kind).toMatch(/TO UNBLOCK/)
      const { inputs, skipped } = inputsFromFolded(
        [{ call: kind, title: 'x', folded: '1', name: 'x' }], 'close * x',
      )
      expect(inputs, kind).toEqual([])
      expect(skipped[0].reason, kind).toContain(`\`${kind}\``)
    }
    // ⛔ AND THE TWO ROSTERS ARE DISJOINT — a kind that is both admitted and
    // refused would resolve by guard ORDER, which is not a decision anybody made.
    for (const kind of Object.keys(FOLDED_INPUT_TYPES)) {
      expect(Object.prototype.hasOwnProperty.call(FOLDED_INPUT_INEXPRESSIBLE, kind), kind).toBe(false)
    }
  })

  it('an input call this door has never heard of is refused, not silently dropped', () => {
    const { inputs, skipped } = inputsFromFolded(
      [{ call: 'input.timeframe', title: 'TF', folded: '1', name: 'tf' }], 'close * tf',
    )
    expect(inputs).toEqual([])
    expect(skipped[0].reason).toMatch(/is not an input call this door knows/)
    expect(skipped[0].reason).toMatch(/silence is the one answer that is never right/)
  })
})

describe('formulaNameRoles — the slot kinds are READ off the manifest, never listed', () => {
  it('every function the manifest declares an `int` slot for blocks a name there', () => {
    // ⛔ DERIVED, NOT TYPED. `sma`/`rsi`/`stdev` are not a hand-list here: this
    // walks every entry in `closedTable.json` that declares an `int` argument and
    // proves the walk finds a name placed in it. A hard-coded roster of "length
    // functions" is the second-authority defect, and it would go quietly wrong
    // the day a function lands.
    const withInt = Object.entries(TABLE.functions || {})
      .filter(([, spec]) => Array.isArray(spec.args) && spec.args.includes('int'))
    expect(withInt.length, 'the manifest must declare int slots for this to test anything')
      .toBeGreaterThan(10)
    for (const [name, spec] of withInt) {
      const i = spec.args.indexOf('int')
      const ast = {
        type: 'call',
        name,
        args: spec.args.map((k, j) => (j === i
          ? { type: 'series', name: 'len' }
          : (k === 'int' ? { type: 'num', value: 3 } : { type: 'series', name: 'close' }))),
      }
      const roles = formulaNameRoles(ast)
      expect(roles.literalOnly.has('len'), `${name} argument ${i}`).toBe(true)
      expect(roles.literalOnly.has('close'), `${name} must not blanket-block`).toBe(false)
    }
  })

  it('a name in a SERIES slot is read and not blocked', () => {
    const roles = formulaNameRoles({
      type: 'call',
      name: 'sma',
      args: [{ type: 'series', name: 'src' }, { type: 'num', value: 20 }],
    })
    expect(roles.read.has('src')).toBe(true)
    expect(roles.literalOnly.has('src')).toBe(false)
  })
})

// ─── THE CORPORA, MEASURED ──────────────────────────────────────────────────
//
// ⭐ A CLAIM ABOUT THE REAL SCRIPTS, NOT ABOUT A FIXTURE. Both committed corpora
// go through the door as a member's paste would, and the answer today is ZERO
// rows for a stated reason — the translator records no bound `name` yet (W3b).
// That is what makes this task's corpus effect a MEASUREMENT: the moment W3b
// lands, this assertion is what tells us the number moved.
const dir = (p) => path.resolve(process.cwd(), p)
const read = (d, f) => fs.readFileSync(path.join(d, f), 'utf8')
const files = (d) => fs.readdirSync(dir(d)).filter((f) => f.endsWith('.pine')).sort()

describe('both committed Pine corpora, through the real door', () => {
  for (const corpus of ['../tests/fixtures/pine', '../tests/fixtures/pine_community']) {
    it(`${corpus} — every folded entry is refused for a reason that names the missing hand-back`, () => {
      const names = files(corpus)
      expect(names.length, 'a gate with no inputs is not a gate').toBeGreaterThanOrEqual(21)
      let entries = 0
      let admitted = 0
      for (const f of names) {
        const out = translatePine(read(dir(corpus), f))
        for (const o of out.outputs || []) {
          const { inputs, skipped } = inputsFromFolded(o.inputsFolded, o.formula)
          entries += (o.inputsFolded || []).length
          admitted += inputs.length
          for (const s of skipped) {
            expect(s.reason, `${f}: ${s.call}`).toMatch(/no bound name/)
            expect(s.reason, `${f}: ${s.call}`).toMatch(/TO UNBLOCK/)
          }
        }
      }
      expect(entries, 'the corpus must actually fold inputs').toBeGreaterThan(0)
      expect(admitted, 'nothing can be declared until the translator binds a name').toBe(0)
    })
  }
})
