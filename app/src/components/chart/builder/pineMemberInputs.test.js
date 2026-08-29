// app/src/components/chart/builder/pineMemberInputs.test.js
//
// ─── 🔴 A PASTED SCRIPT'S KNOBS COME ACROSS ─────────────────────────────────
//
// `length = input.int(14, "Length")` is the author's CONTROL. Until this landed,
// `translatePine` folded it to the literal `14` — right for the maths, because
// the tree has to stay statically decidable, and wrong for the member, who got
// somebody else's constant welded shut with nothing on screen saying a knob had
// been taken away.
//
// ⭐ THE CONSUMER WAS ALWAYS READY. `inputsFromFolded` has been able to turn a
// folded input into a member row since W1b.9 and refused every entry with the
// same sentence — "no bound name on the folded entry … TO UNBLOCK: `usedInputs[]`
// gaining `name`". This file is the receipt for that hand-back arriving.
//
// ⛔ WHAT IS ACTUALLY BEING TESTED IS THE HAZARD, NOT THE HAPPY PATH. Binding an
// identifier is easy; knowing WHEN NOT TO is the whole feature. Three cases below
// are refusals, and each is refused for a DIFFERENT reason with a different
// sentence — a single "could not import" would be a worse product than the
// constant it replaced.

import { describe, it, expect } from 'vitest'

import { translatePine } from '../engine/ast/pine.js'
import { parseFormula, astHash } from '../engine/ast/parse.js'
import { pineMemberInputs } from './builderInputs.js'

const run = (body, opts) =>
  pineMemberInputs(translatePine, `//@version=5\nindicator("t")\n${body}\n`, opts)

const plain = (body) =>
  translatePine(`//@version=5\nindicator("t")\n${body}\n`)

describe("a pasted script's inputs arrive as knobs the member can turn", () => {
  it('⭐⭐ a threshold input BINDS — the formula reads the identifier', () => {
    const r = run('th = input.int(30, "RSI level")\nplot(ta.rsi(close, 14) < th ? 1 : 0)')
    expect(r.ok).toBe(true)
    expect(r.formula).toBe('rsi(close, 14) < th ? 1 : 0')
    expect(r.inputs).toEqual([
      { key: 'th', type: 'int', label: 'RSI level', default: 30 },
    ])
    // ⛔ AND THE CONTROL THAT MAKES THAT MEAN SOMETHING: without the hand-back
    // the same paste welds the constant in. If this ever matches the line above,
    // the assertion is passing because both paths agree, not because one works.
    expect(plain('th = input.int(30, "RSI level")\nplot(ta.rsi(close, 14) < th ? 1 : 0)')
      .outputs[0].formula).toBe('rsi(close, 14) < 30 ? 1 : 0')
  })

  it("⭐ the author's own minval/maxval come across as the knob's bounds", () => {
    const r = run('m = input.float(2.0, "Mult", minval=0.5, maxval=5.0)\nplot(close * m)')
    expect(r.formula).toBe('close * m')
    expect(r.inputs[0]).toEqual({
      key: 'm', type: 'float', label: 'Mult', default: 2, min: 0.5, max: 5,
    })
  })

  it('⛔ a WINDOW input stays folded and is refused BY NAME, not silently', () => {
    const r = run('len = input.int(14, "Length")\nplot(ta.sma(close, len))')
    // The column is still right — it is the KNOB that cannot exist.
    expect(r.formula).toBe('sma(close, 14)')
    expect(r.inputs).toEqual([])
    expect(r.skipped).toHaveLength(1)
    expect(r.skipped[0].name).toBe('len')
    // ⛔ THE SENTENCE MATTERS AS MUCH AS THE REFUSAL. "the formula never reads
    // `len`" is true of the text and wrong about the reason — it tells a member
    // their knob does nothing, when the fact is that a length cannot be a knob
    // here. Only the pass that did the folding knew; carrying that verdict
    // forward is what this asserts.
    expect(r.skipped[0].reason).toContain('lands in a WINDOW')
    expect(r.skipped[0].reason).toContain('windowLiteral')
    expect(r.skipped[0].reason).not.toContain('never reads')
  })

  it('⛔⛔ THE TRAP: an input used in a window AND elsewhere is refused WHOLE', () => {
    // `sma(close, 14) + len` would be a knob that moves half the formula and
    // silently leaves the other half at the author's default. Nothing on screen
    // could say which half it reached, so the whole input is refused.
    const r = run('len = input.int(14)\nplot(ta.sma(close, len) + len)')
    expect(r.formula).toBe('sma(close, 14) + 14')
    expect(r.inputs).toEqual([])
    expect(r.skipped[0].reason).toContain('lands in a WINDOW')
    // ⛔ THE CONTROL: the identifier must appear NOWHERE in the shipped formula.
    // A half-applied binding is exactly what this case exists to prevent, and it
    // would still satisfy every assertion above.
    expect(r.formula).not.toContain('len')
  })

  it('⭐ two inputs, one bindable and one not, are partitioned correctly', () => {
    const r = run('len = input.int(20, "Len")\nth = input.float(1.5, "Mult")\n'
      + 'plot(ta.sma(close, len) * th)')
    expect(r.formula).toBe('sma(close, 20) * th')
    expect(r.inputs.map((i) => i.key)).toEqual(['th'])
    expect(r.skipped.map((s) => s.name)).toEqual(['len'])
    // ⛔ THE REASON, NOT JUST THE ROSTER. Measured: with the window-detection
    // guard deleted, the two assertions above still pass — `len` is folded by
    // `constantValueOf` regardless, so it drops out of the formula and gets
    // refused as "never reads". Same names, same partition, wrong explanation.
    // A case that cannot tell the guard from its absence is not a rail
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    expect(r.skipped[0].reason).toContain('lands in a WINDOW')
  })

  it('⛔ an input NESTED in a formula is not named after the formula', () => {
    // `x = ta.sma(close, input.int(14))` binds `x` to a moving average, not to
    // the input. Declaring a knob called `x` there would hand the member a
    // control that renames their own indicator.
    const r = run('x = ta.sma(close, input.int(14))\nplot(x)')
    expect(r.formula).toBe('sma(close, 14)')
    expect(r.inputs).toEqual([])
    expect(r.skipped[0].reason).toContain('no bound name')
  })

  it('⛔ a script with NO inputs is byte-identical to the plain translation', () => {
    const body = 'plot(ta.sma(close, 20))'
    expect(run(body).formula).toBe(plain(body).outputs[0].formula)
    expect(run(body).inputs).toEqual([])
  })
})

describe('the emitted formula is a legal tree, not just a legal string', () => {
  it('⭐⭐ it parses, and it hashes to a canonical tree', () => {
    // ⛔ THE REAL RISK OF THIS FEATURE IN ONE ASSERTION. The declared node carries
    // `inputName`/`inputDefault` for the translator's own use; if either were an
    // ordinary enumerable key, `assertCanonical` would refuse the node and every
    // saved definition built this way would be unsaveable. They are defined
    // non-enumerable precisely so the tree stays `{name, type}`.
    const r = run('th = input.int(30)\nplot(ta.rsi(close, 14) < th ? 1 : 0)')
    const back = parseFormula(r.formula)
    expect(back.ok, back.error).toBe(true)
    expect(() => astHash(back.ast)).not.toThrow()
    // …and the tree contains a PLAIN series leaf for the input, with no extra keys.
    const leaf = JSON.parse(JSON.stringify(back.ast))
    const find = (n) => (n && n.type === 'series' && n.name === 'th'
      ? n : (n && n.args || []).map(find).find(Boolean))
    expect(Object.keys(find(leaf)).sort()).toEqual(['name', 'type'])
  })

  it('⛔ the GRAMMAR did not move — declare mode adds no node type and no key', () => {
    // A feature that widened the canonical vocabulary would move every persisted
    // `astHash`, which is the one thing this repo cannot undo without migrating
    // every saved definition.
    const withInputs = run('th = input.int(30)\nplot(close > th ? 1 : 0)')
    const handWritten = parseFormula('close > th ? 1 : 0')
    expect(handWritten.ok).toBe(true)
    expect(astHash(parseFormula(withInputs.formula).ast)).toBe(astHash(handWritten.ast))
  })
})
