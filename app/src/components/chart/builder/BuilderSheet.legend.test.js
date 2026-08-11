// ⭐⭐ A MEMBER'S OWN FORMULA GETS A CHIP — ITS NAME, ITS HIDE, ITS REMOVE.
//
// ⚰️ THE BUG, MEASURED IN PRODUCTION 2026-08-10. I saved a real TC2000 column
// through the shipped builder. It drew a pane. The pane had no legend entry, no
// name anywhere in the page text, and none of the three controls RSI had beside
// it — so a member could not tell what the line was, could not configure it, and
// could only remove it by reopening the Indicators dialog and scrolling to the
// bottom.
//
// ⛔ THE CAUSE IS ONE MISSING KEY, AND IT HAS BITTEN THIS REPO BEFORE.
// `readout.js::legendChips` skips a plot outright:
//
//     if (!plot || !plot.legend || plot.legend.hide === true) continue
//
// `nativeRegistry`'s own header records the same defect against TEN shipped
// indicators — "a user who enabled MFI or OBV got a line with NO LABEL AT ANY
// TIME" — and the rail written for it was DERIVED from the natives array, so it
// could never have covered a document `buildDefinition` writes. This is that
// rail's missing half.
//
// ⛔ IT DRIVES THE REAL WRITE DOOR. `buildDefinition` is what the Save button
// calls; asserting against a hand-built document would pass while the shipped
// one stayed broken, which is the whole shape of the bug.

import { describe, it, expect } from 'vitest'
import { buildDefinition } from './BuilderSheet.jsx'
import { legendChips } from '../engine/readout.js'
import { parseFormula } from '../engine/ast/parse.js'

const NAME = '26wk HV'
const SOURCE = 'v >= highest(volume, 130)'

/** A document exactly as the Save button writes it. */
function definition(name = NAME) {
  const { ast } = parseFormula(SOURCE)
  expect(ast, 'the fixture formula must parse').toBeTruthy()
  return buildDefinition({
    defId: 'u_aaaaaaaaaaaa', name, source: SOURCE, ast,
    mode: 'non-repainting', readback: 'volume is at its 130-bar high',
  })
}

const instanceOf = (def) => [{ instanceId: 'i1', defId: def.id, inputs: {} }]
const registryOf = (def) => ({ getDefinition: (id) => (id === def.id ? def : null) })

/** The chips the legend would render for one saved formula, cursor off-chart. */
const chipsFor = (def) => legendChips([], null, registryOf(def), instanceOf(def))

describe('a saved formula reaches the legend', () => {
  it('🔴 emits exactly one chip, and it carries the member`s NAME', () => {
    const def = definition()
    const chips = chipsFor(def)
    expect(chips).toHaveLength(1)
    // ⭐ The name the member typed — not the def_id, not "Value".
    expect(chips[0].label).toContain('26wk HV')
    expect(chips[0].instanceId).toBe('i1')
    expect(chips[0].plotKey).toBe('value')
  })

  it('⛔ THE CONTROL — strip the `legend` block and the chip DISAPPEARS', () => {
    // This is what shipped. Without this case the assertion above would pass on
    // any build that happened to emit a chip for some other reason, and would not
    // prove which key is load-bearing.
    const def = definition()
    const stripped = { ...def, plots: def.plots.map(({ legend, ...rest }) => rest) }
    expect(stripped.plots[0].legend).toBeUndefined()
    expect(chipsFor(stripped)).toHaveLength(0)
  })

  it('the write door DECLARES a legend on every plot it writes', () => {
    // ⛔ Derived from the document, not from a list here — a second plot added
    // tomorrow is covered the day it lands.
    const def = definition()
    expect(def.plots.length).toBeGreaterThan(0)
    for (const plot of def.plots) {
      expect(plot.legend, `plot ${plot.key} has no legend block`).toBeTruthy()
      expect(plot.legend.hide, `plot ${plot.key} is hidden from the legend`).not.toBe(true)
    }
  })

  it('a hidden instance still yields a chip, marked hidden', () => {
    // The chip is what carries "Hide"/"Show", so it has to survive being hidden —
    // otherwise hiding an indicator would delete the only control that unhides it.
    const def = definition()
    const chips = legendChips([], null, registryOf(def),
      [{ instanceId: 'i1', defId: def.id, inputs: {}, hidden: true }])
    expect(chips).toHaveLength(1)
    expect(chips[0].hidden).toBe(true)
  })

  it('an unnamed formula still gets a readable chip rather than a blank one', () => {
    // `buildDefinition` falls back to 'Value' for the plot label; the chip must
    // not come out empty, because an empty chip is the unnamed pane again.
    const chips = chipsFor(definition(''))
    expect(chips).toHaveLength(1)
    expect(String(chips[0].label || '').trim().length).toBeGreaterThan(0)
  })
})
