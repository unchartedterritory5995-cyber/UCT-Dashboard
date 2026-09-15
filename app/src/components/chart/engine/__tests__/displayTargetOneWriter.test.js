// app/src/components/chart/engine/__tests__/displayTargetOneWriter.test.js
//
// ─── PROVENANCE ONLY WORKS IF EVERY SURFACE STAMPS IT ───────────────────────
//
// ⚰️⚰️ THERE WERE THREE WRITERS, AND ONE OF THEM WAS HAND-ROLLED. Chart Data and
// the on-chart chip menu went through `setInstanceDisplayTarget`; the indicator
// dialog's "Move to" select wrote `placement.target` straight onto the instance:
//
//     { ...i, placement: { ...(i.placement || {}), target } }
//
// While intent was INFERRED (`explicit !== declared`) that was merely untidy —
// the same byte read the same way wherever it came from. The moment intent
// became a STORED FACT it turned into a correctness hole: a member moving their
// Close series to its own pane from that dialog wrote a marker-less restatement,
// which the resolver is required to go on ignoring, so the pane never appeared —
// while the identical gesture in Chart Data worked.
//
// ⛔ THE RULE IS STRUCTURAL, NOT A CONVENTION TO REMEMBER. A fourth surface gets
// added by someone who has not read this file, so the rail reads the SOURCE and
// refuses a hand-rolled write rather than trusting a reviewer to notice.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as registry from '../nativeRegistry'
import { addInstance, setInstanceDisplayTarget } from '../instanceControls'
import { resolveDisplayTarget, TARGET_EXPLICIT } from '../displayTarget'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

// ⛔ THE FORBIDDEN SHAPE IS SPREADING AN EXISTING PLACEMENT AND SETTING `target`
// ON THE COPY. That is the update-an-instance gesture, and it is the one that
// bypasses the legacy mirror, the return-to-default delete AND the provenance
// stamp.
//
// ⚠️ CONSTRUCTING A FRESH placement IS NOT THE SAME THING and is deliberately
// allowed: `StockChart` manufactures a forced legacy VWAP instance with a literal
// `placement: { target: 'price' }` after `normalizeInstances` has run. That is a
// synthetic instance standing in for a legacy toggle, not a member expressing a
// destination — it carries no marker precisely because nobody chose it, which is
// the correct legacy reading.
const HAND_ROLLED = /placement:\s*\{\s*\.\.\.[\s\S]{0,120}?\btarget\b/

/** The member-facing surfaces that offer a display destination. */
const SURFACES = [
  'components/chart/ChartSettingsIndicators.jsx',   // Chart Data
  'components/chart/IndicatorSettingsDialog.jsx',   // the indicator dialog
  'components/StockChart.jsx',                      // the on-chart chip menu (Track B)
]

describe('⛔ ONE canonical writer for display target', () => {
  for (const rel of SURFACES) {
    it(`${rel.split('/').pop()} writes through setInstanceDisplayTarget`, () => {
      const src = read(rel)
      expect(src.includes('setInstanceDisplayTarget'),
        'this surface does not use the canonical writer at all').toBe(true)
      expect(HAND_ROLLED.test(src),
        'a hand-rolled placement.target write is back in this file').toBe(false)
    })
  }

  it('⭐ …and the rail is not vacuous — it can see the shape it forbids', () => {
    // The exact line that was removed from `IndicatorSettingsDialog`.
    expect(HAND_ROLLED.test('const next = { ...i, placement: { ...(i.placement || {}), target } }'))
      .toBe(true)
    // …while the allowed literal construction is NOT caught by it.
    expect(HAND_ROLLED.test("placement: { target: 'price' }, hidden: false,")).toBe(false)
  })
})

describe('⭐⭐ every surface produces the SAME bytes for the same gesture', () => {
  it('a member choosing Own pane for a Close series is one state, not three', () => {
    // The gesture all three surfaces offer, taken through the one writer they now
    // share. If a surface ever forks again, the shape below is what it must match.
    const cs = addInstance({ indicatorInstances: [] }, 'dataSeries', registry)
    const id = cs.indicatorInstances[0].instanceId
    const moved = setInstanceDisplayTarget(cs, id, 'pane', registry)
    const inst = moved.indicatorInstances.find((i) => i.instanceId === id)

    expect(inst.placement).toEqual({ target: 'pane', [TARGET_EXPLICIT]: true })
    expect(resolveDisplayTarget(inst, moved)).toBe('pane')
  })
})
