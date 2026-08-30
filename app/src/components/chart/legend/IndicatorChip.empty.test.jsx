// app/src/components/chart/legend/IndicatorChip.empty.test.jsx
//
// ─── ⛔⛔ "COMPUTED NOTHING" AND "YOU ARE NOT HOVERING" LOOKED THE SAME ──────
//
// MEASURED before this shipped, through the real `legendChips`:
//
//   bound, cursor OFF : {"value":null,"hidden":false,"text":"d1"}
//   UNBOUND (all-NaN) : {"value":null,"hidden":false,"text":"d1"}
//   identical?        : true
//
// An indicator whose column holds no finite value draws no line and takes no pane
// — `pool.js`'s pane-existence test (trap #4) drops the series — and the legend
// then said exactly what it says when the cursor is simply off the chart. The far
// commoner cause of a null value is the second one, so the natural reading of the
// ambiguity is the WRONG one: a member reaches for the mouse instead of for the
// length.
//
// ⚰️ AND I CLAIMED WORSE THAN THE TRUTH ONE COMMIT EARLIER. `interpret.js` said
// this state was "no line, no pane, no sentence". There IS a chip, carrying the
// indicator's name — it is ambiguous, not absent. The correction matters because
// the fix for "invisible" is a new surface and the fix for "ambiguous" is one
// attribute, and only one of those is proportionate.
//
// ⛔ `computed` IS ABSENT, NOT `true`, FOR A HIDDEN PLOT. `binder.js` skips a
// hidden instance before it computes anything (`if (inst.hidden === true)
// continue`), so nobody looked. Absent is "not asked"; `false` would claim a
// measurement that never ran.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import IndicatorChip from './IndicatorChip'
import { legendChips } from '../engine/readout'

afterEach(cleanup)

const DEF = { id: 'd1', plots: [{ key: 'value', legend: { decimals: 2 }, color: '#fff' }] }
const registry = (id) => (id === 'd1' ? DEF : null)
const VISIBLE = [{ instanceId: 'i1', defId: 'd1', hidden: false, inputs: {} }]
const BOUND = [{ instanceId: 'i1', plotKey: 'value', defId: 'd1', series: { fake: true } }]

const chipOf = (bindings, instances) => legendChips(bindings, null, registry, instances)[0]

describe('a chip says whether its plot computed anything', () => {
  it('⛔⛔ an UNBOUND visible plot is marked, and a bound one off-cursor is NOT', () => {
    // ⭐ THE TWO CASES SIDE BY SIDE, which is the only way this assertion means
    // anything: before the flag they were byte-identical, so a test that checked
    // only the empty case would have passed against a chip that marked EVERY
    // null-valued plot — including every indicator on a chart nobody is hovering.
    expect(chipOf([], VISIBLE).computed).toBe(false)
    expect(chipOf(BOUND, VISIBLE).computed).toBe(true)
  })

  it('⛔ a HIDDEN plot carries no verdict at all — nobody looked', () => {
    const chip = chipOf([], [{ ...VISIBLE[0], hidden: true }])
    expect(chip.hidden).toBe(true)
    expect('computed' in chip).toBe(false)
  })

  it('⭐⭐ …and the mark reaches the DOM, with a sentence that names the fix', () => {
    // ⛔ THE HALF THAT MAKES IT A FEATURE. A flag `legendChips` sets and no
    // renderer reads is the "built, tested, green and unreachable" shape this
    // repo hunts hardest — and this session found four of them.
    render(<IndicatorChip chip={chipOf([], VISIBLE)} />)
    const el = document.querySelector('[data-instance-id="i1"]')
    expect(el).toBeTruthy()
    expect(el.getAttribute('data-computed')).toBe('false')
    // ⭐ THE SENTENCE NAMES WHAT A MEMBER CAN DO, not merely what happened.
    expect(el.getAttribute('title')).toMatch(/no value on these bars/i)
    expect(el.getAttribute('title')).toMatch(/longer timeframe or a shorter length/i)
  })

  it('⛔ a plot that DID compute carries no such attribute or sentence', () => {
    // The discriminator, in the DOM this time. Without it the attribute could be
    // emitted for every chip and the test above would still pass.
    render(<IndicatorChip chip={chipOf(BOUND, VISIBLE)} />)
    const el = document.querySelector('[data-instance-id="i1"]')
    expect(el.getAttribute('data-computed')).toBe(null)
    expect(el.getAttribute('title') || '').not.toMatch(/no value on these bars/i)
  })

  it('⛔ the empty mark is not the hidden mark — they are different facts', () => {
    // ⚠️ `.chipHidden` is the MEMBER'S OWN CHOICE; `.chipEmpty` is a fact about
    // the data. Sharing one style would tell somebody their indicator is hidden
    // when they never hid it.
    render(<IndicatorChip chip={chipOf([], VISIBLE)} />)
    const empty = document.querySelector('[data-instance-id="i1"]')
    expect(empty.getAttribute('data-hidden')).toBe('false')
    expect(empty.className).not.toMatch(/chipHidden/)
    expect(empty.className).toMatch(/chipEmpty/)
  })

  it('⭐ the chip still renders its label, and exactly one text node', () => {
    // The invariant `IndicatorChip`'s own header states: one element, one text
    // node — `stockChartWiring.test.jsx` counts spans by text and a second one
    // would double-count the chip.
    render(<IndicatorChip chip={chipOf([], VISIBLE)} />)
    expect(screen.getByText('d1')).toBeTruthy()
  })
})
