// app/src/components/chart/engine/__tests__/everyIndicatorParameterSweep.test.js
//
// ─── EVERY INDICATOR, ACROSS EVERY VALUE ITS OWN FORM WILL ACCEPT ───────────
//
// MACD's signal line was NaN for its whole length whenever a member set Fast
// above Slow — a combination the settings form permits, because Fast declares
// `max: 100` and Slow declares `max: 200`. It shipped because every test of that
// function used the DEFAULT parameters, and the defect lives in the corner of the
// parameter space no fixture visited.
//
// ⭐ SO THIS SWEEP IS DERIVED, NOT TYPED. It walks `listDefinitions()`, reads each
// definition's OWN declared inputs, and drives `computeFor` across the range each
// input advertises to the form. A definition added tomorrow is swept the day it
// registers, at the bounds it chose, with no edit here — which is the property
// that matters, because the next bug of this shape will not be in MACD.
//
// THE INVARIANT: a value the form will accept must not produce a plot that draws
// nothing. Anything else is a control the member can set, that silently empties a
// line, with no error — exactly what `Fast 30 / Slow 26` did.
//
// ⛔ THE EXEMPTIONS ARE NAMED AND NARROW. `hasAnyFinite` over an EVENT column is
// not the same claim (an event that never fires on this fixture is correct), and
// two definitions genuinely cannot draw without something the fixture does not
// carry. Each is listed with its reason rather than the assertion being loosened
// for everybody.
import { describe, it, expect } from 'vitest'
import {
  listDefinitions, getDefinition, computeFor, columnKeys, hasAnyFinite,
} from '../nativeRegistry'

/**
 * 1500 bars at 5-minute spacing with real session boundaries.
 *
 * Intraday timestamps rather than daily ones because the session-anchored
 * definitions (VWAP, AVWAP) reset per session and would draw a single point on a
 * daily fixture — and every other native reads only OHLCV, so one fixture serves
 * both. 1500 clears the largest declared warm-up (`slow: 200`) many times over.
 */
function bars(n = 1500) {
  const out = []
  let px = 100
  const START = Date.UTC(2026, 0, 5, 14, 30) / 1000   // a Monday, 09:30 ET
  for (let i = 0; i < n; i++) {
    px += Math.sin(i / 11) * 0.8 + Math.cos(i / 37) * 0.5 + ((i * 29) % 13 - 6) * 0.07
    const c = Math.max(2, px)
    const h = c * (1 + 0.004 + (i % 7) * 0.0004)
    const l = c * (1 - 0.004 - (i % 5) * 0.0004)
    out.push({
      t: START + i * 300,
      o: (h + l) / 2, h, l, c,
      v: 50_000 + ((i * 7919) % 40_000),
    })
  }
  return out
}

const BARS = bars(1500)

const NUMERIC = new Set(['int', 'float'])

/** Definitions that cannot draw on this fixture, and why. Narrow on purpose. */
const CANNOT_DRAW_HERE = {
  // Needs a SECOND symbol's bars (the benchmark) through `ctx`; with none it has
  // nothing to divide by. Kept out of `listDefinitions()` for its own reasons too.
  rsLine: 'needs benchmark bars via ctx',
  // Draws from a volume histogram built over the visible range, not a per-bar
  // series — it declares no per-bar plot column to be finite.
  volumeProfile: 'renders a range histogram, not a per-bar column',
}

/** Values to try for one numeric input: both bounds, the default, and the two
 *  quarter points — the bounds are where the arithmetic breaks. */
function valuesFor(input) {
  const lo = Number.isFinite(input.min) ? input.min : 1
  const hi = Number.isFinite(input.max) ? input.max : 50
  const def = Number.isFinite(input.default) ? input.default : lo
  const q1 = Math.round(lo + (hi - lo) * 0.25)
  const q3 = Math.round(lo + (hi - lo) * 0.75)
  const step = input.type === 'int' ? Math.round : (x) => x
  return [...new Set([lo, step(q1), def, step(q3), hi])].filter(v => v >= lo && v <= hi)
}

function numericInputs(def) {
  return (def.inputs || []).filter(i => i && NUMERIC.has(i.type))
}

function defaultsOf(def) {
  const out = {}
  for (const i of (def.inputs || [])) if (i && i.default !== undefined) out[i.key] = i.default
  return out
}

/** Only PLOT columns — an event column that never fires on this fixture is not a
 *  defect, and conflating the two would force a bogus exemption for every
 *  event-declaring definition. */
function plotKeys(def) {
  const events = new Set((def.events || []).map(e => e && e.key))
  return columnKeys(def).filter(k => !events.has(k))
}

const DEFS = listDefinitions()
  .map(d => getDefinition(d.id) || d)
  .filter(Boolean)

describe('the sweep has something to sweep — the control', () => {
  it('the registry lists definitions, with inputs and plots', () => {
    // Without this, an empty registry would make every loop below vacuous.
    expect(DEFS.length).toBeGreaterThan(10)
    expect(DEFS.filter(d => numericInputs(d).length > 0).length).toBeGreaterThan(8)
    expect(DEFS.filter(d => plotKeys(d).length > 0).length).toBeGreaterThan(10)
  })

  it('the fixture is long enough for the largest declared warm-up', () => {
    const biggest = Math.max(...DEFS.flatMap(d => numericInputs(d).map(i => (Number.isFinite(i.max) ? i.max : 0))))
    expect(BARS.length).toBeGreaterThan(biggest * 2)
  })
})

describe('every declared plot draws something, at every value the form accepts', () => {
  for (const def of DEFS) {
    const keys = plotKeys(def)
    if (!keys.length) continue

    const why = CANNOT_DRAW_HERE[def.id]
    const inputs = numericInputs(def)

    // One case per (input, value) with the others at their declared defaults.
    for (const input of inputs) {
      for (const v of valuesFor(input)) {
        const label = `${def.id}: ${input.key}=${v}`
        if (why) {
          it.skip(`${label} — skipped: ${why}`, () => {})
          continue
        }
        it(label, () => {
          const cols = computeFor(def, BARS, { ...defaultsOf(def), [input.key]: v })
          for (const k of keys) {
            expect(cols[k], `${def.id}.${k} missing from computeFor output`).toBeTruthy()
            expect(hasAnyFinite(cols[k]),
              `${def.id}.${k} drew NOTHING with ${input.key}=${v} — a value this `
              + `indicator's own form accepts (min ${input.min}, max ${input.max})`).toBe(true)
          }
        })
      }
    }

    // …and the two corners, where several inputs are extreme together. This is
    // the shape MACD's bug lived in: each input in range, the PAIR degenerate.
    for (const corner of ['min', 'max']) {
      if (!inputs.length || why) continue
      it(`${def.id}: every numeric input at its ${corner}`, () => {
        const combo = { ...defaultsOf(def) }
        for (const i of inputs) {
          const b = corner === 'min' ? i.min : i.max
          if (Number.isFinite(b)) combo[i.key] = b
        }
        const cols = computeFor(def, BARS, combo)
        for (const k of keys) {
          expect(hasAnyFinite(cols[k]),
            `${def.id}.${k} drew NOTHING with every input at its ${corner}: `
            + JSON.stringify(combo)).toBe(true)
        }
      })
    }
  }
})

describe('no accepted value makes a compute throw', () => {
  for (const def of DEFS) {
    const inputs = numericInputs(def)
    if (!inputs.length) continue
    it(`${def.id} survives its whole declared range`, () => {
      for (const input of inputs) {
        for (const v of valuesFor(input)) {
          expect(() => computeFor(def, BARS, { ...defaultsOf(def), [input.key]: v }),
            `${def.id} threw on ${input.key}=${v}`).not.toThrow()
        }
      }
    })
  }
})

describe('every column is index-aligned to the bars it was computed over', () => {
  // A column shorter than the series silently shifts every value onto the wrong
  // bar — the same family of defect as MACD's alignment, and invisible in a chip.
  for (const def of DEFS) {
    const keys = plotKeys(def)
    if (!keys.length || CANNOT_DRAW_HERE[def.id]) continue
    it(`${def.id} returns full-length columns`, () => {
      const cols = computeFor(def, BARS, defaultsOf(def))
      for (const k of keys) {
        expect(cols[k].length, `${def.id}.${k} is not bar-aligned`).toBe(BARS.length)
      }
    })
  }
})
