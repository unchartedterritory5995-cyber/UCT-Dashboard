// app/src/components/chart/engine/ast/pine.hiloDefault.test.js
//
// ⭐⭐ THE 81-SITE ASYMMETRY, AND THE DOOR IS PINNED TO THE CAPTURE.
// `docs/pine/r11-group-b-arity.md` named this as the Group B risk in the exact
// shape it turned out to have: "does `ta.highest(20)` default the source to
// `high` (and `ta.lowest` to `low`), or to `close` for both? The asymmetry is the
// whole risk — guessing `close` would be silently wrong on 81 sites."
//
// It was measured on a live TradingView chart on 2026-09-10, and the reading is
// `tests/fixtures/vendor/groupb-hilo-default-spy-1d-2026-09-10.json`. THIS FILE
// READS THAT FIXTURE rather than restating its numbers — a vendor fact retyped
// into a test is the second-authority defect this repo keeps paying for, and the
// one place it would hurt most is a rule about which PRICE a window is measured
// from, because the wrong answer is the right shape with different numbers.
//
// ⛔ A RED HERE IS NOT "UPDATE THE EXPECTATION". Either the door stopped matching
// the vendor, or the capture was replaced by one that says something else. Read
// the fixture's `_ruling` before touching either.

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
    const hi = formulaOf('ta.highest(20)')
    const lo = formulaOf('ta.lowest(20)')
    expect(hi.ok).toBe(true)
    expect(lo.ok).toBe(true)
    expect(hi.formula).toBe(`highest(${vendorDefault('highest')}, 20)`)
    expect(lo.formula).toBe(`lowest(${vendorDefault('lowest')}, 20)`)
  })

  it('⚰️ it used to REFUSE, and that is why 81 sites were stuck', () => {
    // Before 2026-09-11 both answered `pine:arity`: the table declares
    // `args: [series, int]` and nothing supplied the default. An over-refusal is
    // invisible to a member — the script simply does not translate — so this
    // asserts the refusal is GONE rather than trusting that it was.
    for (const src of ['ta.highest(20)', 'ta.lowest(20)']) {
      expect(formulaOf(src).refusals).not.toContain('pine:arity')
    }
  })

  it('⛔ an EXPLICIT source is still honoured, including a deliberately odd one', () => {
    // The default must not become an override. `ta.highest(close, 20)` is a
    // legitimate thing to write and must survive unchanged.
    expect(formulaOf('ta.highest(close, 20)').formula).toBe('highest(close, 20)')
    expect(formulaOf('ta.lowest(close, 20)').formula).toBe('lowest(close, 20)')
    expect(formulaOf('ta.highest(high, 20)').formula).toBe('highest(high, 20)')
    expect(formulaOf('ta.lowest(low, 20)').formula).toBe('lowest(low, 20)')
  })

  it('⭐ the sibling that already knew the rule is unchanged', () => {
    // `ta.highestbars(20)` has defaulted to `high` the whole time, five lines from
    // where the fix landed. If this moves, the fix reached further than intended.
    expect(formulaOf('ta.highestbars(20)').formula).toBe('-highestbars(high, 20)')
    expect(formulaOf('ta.lowestbars(20)').formula).toBe('-lowestbars(low, 20)')
  })

  it('⭐ the capture is the one this test claims to read', () => {
    expect(FIXTURE.symbol).toBe('AMEX:SPY')
    expect(FIXTURE.resolution).toBe('1D')
    // the gates the capture itself had to pass
    expect(FIXTURE._gates).toMatch(/isFailed\(\) === false/)
    expect(FIXTURE._gates).toMatch(/11/)
  })
})
