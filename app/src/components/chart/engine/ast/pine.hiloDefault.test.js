// app/src/components/chart/engine/ast/pine.hiloDefault.test.js
//
// ⭐⭐ THE ASYMMETRY IS MEASURED AND THE DOOR NOW SERVES IT.
// The capture says what the 1-argument form defaults to; this file requires the
// door to agree, and requires the two-argument form to be untouched.
//
// `docs/pine/r11-group-b-arity.md` named the risk in the shape it turned out to
// have: "does `ta.highest(20)` default the source to `high` (and `ta.lowest` to
// `low`), or to `close` for both? The asymmetry is the whole risk — guessing
// `close` would be silently wrong on 81 sites." It was measured on a live
// TradingView chart on 2026-09-10 and the reading is
// `tests/fixtures/vendor/groupb-hilo-default-spy-1d-2026-09-10.json`.
//
// ⚰️ THE DOOR CHANGE WAS WRITTEN, SHIPPED AND REVERTED THE SAME NIGHT.
// Adding `ta.highest`/`ta.lowest` to `PINE_NAMESPACED_TREE` supplies the default,
// and it also RECLASSIFIES them: `pineRuntimeFrontend.js`'s `windowTarget` and
// `carriedTarget` both open with `if (tree[name]) return null`, so a name in that
// map is by definition not a carried/windowed builtin. The runtime lane then
// refused `runtime:call-windowed-state` for the TWO-argument form, which had
// worked all along — four `finiteWindow` tests and one `executionShapeCensus`
// script went red. The fix belongs where ARITY is resolved, not in a tree rewrite;
// `requests.md` carries it.
//
// ⭐ IT LANDED AT THE RIGHT LAYER ON 2026-09-11: `PINE_SHORT_FORM` fills the
// missing slot where ARITY is resolved — the same `{series: …}` plan entry
// `ta.atr(14)` has always ridden — so the names never enter
// `PINE_NAMESPACED_TREE` and the runtime classifiers still see them. The four
// `finiteWindow` tests and `executionShapeCensus` are the control, and they pass.

import { describe, it, expect } from 'vitest'

import { translatePine } from './pine.js'
import FIXTURE from '../../../../../../tests/fixtures/vendor/groupb-hilo-default-spy-1d-2026-09-10.json'

/** The vendor's answer, DERIVED from the capture's own tallies. */
function vendorDefault(fn) {
  const c = FIXTURE.agreementCounts
  const usable = FIXTURE.usableBars
  const rivals = fn === 'highest'
    ? { high: c.highest_1arg_equals_highest_HIGH,
        close: c.highest_1arg_equals_highest_CLOSE,
        hl2: c.highest_1arg_equals_highest_HL2 }
    : { low: c.lowest_1arg_equals_lowest_LOW,
        close: c.lowest_1arg_equals_lowest_CLOSE,
        hl2: c.lowest_1arg_equals_lowest_HL2 }
  const winners = Object.entries(rivals).filter(([, n]) => n === usable).map(([k]) => k)
  expect(winners).toHaveLength(1)
  return winners[0]
}

const formulaOf = (pine) => {
  const r = translatePine(`//@version=5\nindicator("t")\nplot(${pine})\n`)
  return { ok: r.ok, formula: (r.outputs || []).map((o) => o && o.formula)[0] || null,
           refusals: (r.refusals || []).map((x) => x.guard || x) }
}

describe('the 1-argument ta.highest / ta.lowest default their SOURCE', () => {
  it('⭐ the capture says `high` for highest and `low` for lowest — an ASYMMETRY', () => {
    expect(vendorDefault('highest')).toBe('high')
    expect(vendorDefault('lowest')).toBe('low')
    // …and they are NOT the same source, which is the entire finding. A capture
    // that had answered `close` for both would make this suite demand `close`.
    expect(vendorDefault('highest')).not.toBe(vendorDefault('lowest'))
  })

  it('⛔ the capture could have DISTINGUISHED them — the spread guard did work', () => {
    // The probe's N06/N07 are the spread between the explicit forms. Bars where
    // they are zero cannot tell `high` from `close` and are excluded, so a
    // fixture whose usable count equals its bar count never applied the guard —
    // and one whose rivals also scored `usable` proves nothing at all.
    expect(FIXTURE.usableBars).toBeGreaterThan(0)
    expect(FIXTURE.usableBars).toBeLessThan(FIXTURE.bars)
    const c = FIXTURE.agreementCounts
    expect(c.highest_1arg_equals_highest_CLOSE).toBe(0)
    expect(c.lowest_1arg_equals_lowest_CLOSE).toBe(0)
    expect(c.highest_1arg_equals_highest_HL2).toBe(0)
    expect(c.lowest_1arg_equals_lowest_HL2).toBe(0)
  })

  it('⭐⭐ the DOOR matches the capture, source for source', () => {
    // ⚰️ THIS WAS `it.skip` FOR ONE NIGHT, beside a test pinning the refusal it
    // replaced. The gap is closed: `PINE_SHORT_FORM` fills the missing slot where
    // ARITY is resolved, so the name never enters `PINE_NAMESPACED_TREE` and the
    // runtime's carried/windowed classifiers still see it.
    expect(formulaOf('ta.highest(20)').formula).toBe(`highest(${vendorDefault('highest')}, 20)`)
    expect(formulaOf('ta.lowest(20)').formula).toBe(`lowest(${vendorDefault('lowest')}, 20)`)
  })

  it('⭐ and it TRANSLATES — the refusal that stood on 97 sites is gone', () => {
    for (const src of ['ta.highest(20)', 'ta.lowest(20)']) {
      const r = formulaOf(src)
      expect(r.ok).toBe(true)
      expect(r.refusals).not.toContain('pine:arity')
    }
  })

  it('⛔ a NAMED short-form call is still refused, not quietly filled', () => {
    // `PINE_ARG_NAMES` carries no evidenced parameter names for these — the v5
    // migration guide lists them with empty parentheses — so a member writing
    // `ta.highest(length = 20)` has named a slot nobody measured. Filling the
    // OTHER slot for them would be a guess wearing a measurement's clothes.
    const r = formulaOf('ta.highest(length = 20)')
    expect(r.ok).toBe(false)
  })

  it('⛔ an EXPLICIT source is honoured, and the TWO-arg form is untouched', () => {
    // ⚰️ THIS IS THE ONE THE REVERTED CHANGE BROKE, and it broke it in the runtime
    // lane rather than here — which is why this file alone could not have caught
    // it. Kept as the near-guard; `finiteWindow.test.js` is the far one.
    expect(formulaOf('ta.highest(close, 20)').formula).toBe('highest(close, 20)')
    expect(formulaOf('ta.lowest(close, 20)').formula).toBe('lowest(close, 20)')
    expect(formulaOf('ta.highest(high, 20)').formula).toBe('highest(high, 20)')
    expect(formulaOf('ta.lowest(low, 20)').formula).toBe('lowest(low, 20)')
  })

  it('⭐ the sibling that already knew the rule is unchanged', () => {
    // `ta.highestbars(20)` has defaulted to `high` all along — and it is allowed to
    // live in PINE_NAMESPACED_TREE because it needs a TRANSFORM (a negation), not
    // merely a default. That distinction is the whole lesson of the revert.
    expect(formulaOf('ta.highestbars(20)').formula).toBe('-highestbars(high, 20)')
    expect(formulaOf('ta.lowestbars(20)').formula).toBe('-lowestbars(low, 20)')
  })

  it('⭐ the capture is the one this test claims to read', () => {
    expect(FIXTURE.symbol).toBe('AMEX:SPY')
    expect(FIXTURE.resolution).toBe('1D')
    expect(FIXTURE._gates).toMatch(/isFailed\(\) === false/)
    expect(FIXTURE._gates).toMatch(/11/)
  })
})
