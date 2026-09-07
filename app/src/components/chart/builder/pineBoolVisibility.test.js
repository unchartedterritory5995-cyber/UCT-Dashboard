// app/src/components/chart/builder/pineBoolVisibility.test.js
//
// ─── ⭐⭐ C0R §4: A BOOL INPUT USED AS A VISIBILITY SWITCH KEEPS ITS MEANING ──
//
// `plot(showMa ? ma : na)` is Pine's ordinary "show/hide this series" idiom and
// it is everywhere in the corpus. C0R's requirement is NOT "make Save work" — it
// is that the parameter still MEANS what the author wrote:
//
//   showMa = true   → the series has values, and draws
//   showMa = false  → the series is `na`, and does not
//
// ⛔ MEASURED ON THE COLUMN, NOT ON THE FORMULA TEXT. A test that only asserted
// the formula still contains `showMa` would pass with the toggle wired to
// nothing. This evaluates the tree over real bars at BOTH input values and reads
// what comes out — which is the same fact `pool.js` uses to decide whether a
// series exists at all, and therefore the same fact the legend's
// `data-computed` stamp reports.
//
// ⛔ NO GENERIC JS TRUTHINESS IS ASSERTED OR RELIED ON. The values used are the
// two the trusted parameter contract actually carries for a bool (`1` and `0` —
// `input.bool` maps to `'int'`, byte-identical to the bare-`input()` fold), and
// nothing here coerces a string or an arbitrary number.
import { describe, it, expect } from 'vitest'
import { translatePine } from '../engine/ast/pine'
import { interpret } from '../engine/ast/interpret'
import { memberInputTranslation } from './builderInputs'

/** 60 bars, gently rising — enough for a 9-bar average to be finite. */
const BARS = Array.from({ length: 60 }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 + i,
}))

const script = (dflt) => `//@version=5
indicator("Gate", overlay = false)
showMa = input.bool(${dflt}, "Show MA")
ma = ta.sma(close, 9)
plot(showMa ? ma : na, title = "Gated MA")
`

/** The one gated output, translated through the product door. */
function gated(dflt) {
  const t = memberInputTranslation(translatePine, script(dflt), {})
  const out = (t.outputs || []).find((o) => o && o.ast && o.formula)
  expect(out, 'the gated plot should translate').toBeTruthy()
  return { out, declared: t.declared }
}

const finiteCount = (col) => (col || []).filter((v) => Number.isFinite(v)).length

describe('a bool input used as a visibility gate keeps its semantics', () => {
  for (const dflt of ['true', 'false']) {
    it(`default ${dflt}: the input survives translation as a declared knob`, () => {
      const { out, declared } = gated(dflt)
      expect(declared).toContain('showMa')
      expect((out.memberInputs || []).map((r) => r.key)).toContain('showMa')
      // ⛔ AND IT IS STILL IN THE FORMULA — a knob folded to its default would
      // read as "supported" while being welded shut.
      expect(out.formula).toMatch(/showMa/)
    })

    it(`default ${dflt}: ON draws values, OFF draws none — on the same tree`, () => {
      const { out } = gated(dflt)
      const on = interpret(out.ast, BARS, { showMa: 1 })
      const off = interpret(out.ast, BARS, { showMa: 0 })
      // ON: the average is finite once its window is filled.
      expect(finiteCount(on)).toBeGreaterThan(0)
      // OFF: `na` on every bar — which is exactly what makes `pool.js` drop the
      // series and the legend chip report `data-computed="false"`.
      expect(finiteCount(off)).toBe(0)
    })
  }

  it('⛔ NON-VACUITY: the two readings must actually differ', () => {
    // A gate wired to nothing would return the same column for both values, and
    // every assertion above would still pass on the ON branch alone.
    const { out } = gated('true')
    const on = interpret(out.ast, BARS, { showMa: 1 })
    const off = interpret(out.ast, BARS, { showMa: 0 })
    expect(finiteCount(on)).not.toBe(finiteCount(off))
  })

  it('⭐ the DEFAULT the author wrote is the default the row carries', () => {
    // `input.bool(false, …)` must not arrive switched on. The row's default is
    // what the settings dialog opens at and what a fresh chart draws.
    const offRow = gated('false').out.memberInputs.find((r) => r.key === 'showMa')
    const onRow = gated('true').out.memberInputs.find((r) => r.key === 'showMa')
    expect(offRow.default).toBe(0)
    expect(onRow.default).toBe(1)
  })
})
