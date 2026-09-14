// app/src/components/chart/engine/__tests__/nativeComputeCtx.test.js
//
// ─── THE NATIVE LANE RECEIVES THE CTX ───────────────────────────────────────
//
// ⭐⭐ THREE LANES, AND ONLY ONE OF THEM DROPPED IT. `computeFor(def, bars,
// inputs, ctx)` handed the ctx to the SERVER lane (which cannot fetch without
// `{sym, tf}`) and to the AST lane, and then called the native as
// `fn(series, inputs)` — so a definition whose input is a SERIES rather than the
// bars had nowhere to read one from. That is the single line this file is about.
//
// ⛔ THE RISK IS NOT THE NEW CAPABILITY, IT IS THE SIXTEEN THAT ALREADY WORK.
// Adding a third argument to a call is only safe because every shipped native
// declares `(bars, p)` and JavaScript discards an argument a function does not
// name. That is a property of the language, not a promise — so it is asserted
// here, over the whole registry, rather than believed.

import { describe, it, expect } from 'vitest'
import { computeFor, listDefinitions, getDefinition } from '../nativeRegistry'

/** Bars long enough for every shipped warm-up (ichimoku needs 52). */
const BARS = Array.from({ length: 300 }, (_, i) => ({
  t: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
  o: 100 + i * 0.1, h: 101 + i * 0.1, l: 99 + i * 0.1, c: 100.5 + i * 0.1, v: 1000 + i,
}))

const NATIVES = listDefinitions().filter((d) => d && d.compute && d.compute.kind === 'native')

describe('the ctx reaches the native lane', () => {
  it('⛔ …and the rail is not vacuous — there ARE native definitions to sweep', () => {
    expect(NATIVES.length).toBeGreaterThan(10)
  })

  it('⭐⭐ EVERY SHIPPED NATIVE IS BYTE-IDENTICAL WITH AND WITHOUT A CTX', () => {
    // The whole safety argument for the change, measured. If any native ever
    // grows a third parameter, THIS is the case that says so — and it says it
    // by name rather than as a mysterious drift in some indicator's values.
    for (const def of NATIVES) {
      const without = computeFor(def, BARS, {})
      const withCtx = computeFor(def, BARS, {}, { sym: 'AAPL', tf: 'D', source: null })
      for (const key of Object.keys(without)) {
        expect(Array.from(withCtx[key]), `${def.id}.${key} moved when a ctx was passed`)
          .toEqual(Array.from(without[key]))
      }
      expect(Object.keys(withCtx).sort()).toEqual(Object.keys(without).sort())
    }
  })

  // ⚠️ WHERE THE *ARRIVAL* PROOF LIVES, AND WHY IT IS NOT HERE. `NATIVE_COMPUTE`
  // is a closed table keyed by `compute.fn`, so there is no way to register a
  // probe native from a test without reaching inside the module — and a probe
  // that bypassed `computeFor` would be testing the test. The definition that
  // genuinely reads `ctx.source` is `dataSeries`, and its two rails in
  // `dataSeriesCompute.test.js` (a finite source passes through; an absent one
  // is all gaps) cannot both hold unless the ctx arrives. This file owns the
  // other half: that passing it broke nothing.

  it('⛔ AN ABSENT CTX IS STILL LEGAL — every existing caller passes three args', () => {
    // `binder.js` and the event-column probe both call `computeFor` with no ctx.
    // A change that made the fourth argument required would break them at a call
    // site no test in this file touches.
    for (const def of NATIVES.slice(0, 4)) {
      expect(() => computeFor(def, BARS, {})).not.toThrow()
    }
  })
})
