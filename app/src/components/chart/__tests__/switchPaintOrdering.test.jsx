// ── The new symbol's LABEL and its CANDLES must land in the same frame ──────
//
// ⛔⛔ THE DEFECT THIS PINS, measured by the frame-accurate browser harness on
// 24/24 switches (p50 31ms, max 47ms): `updateChart()` ran in a PASSIVE effect,
// which fires AFTER the browser composites. So a symbol switch ordered the two
// halves of the member's chart one frame apart —
//
//     React commits B's DOM (the ticker now reads B)
//       -> browser PAINTS            <- B ticker over A's candles
//       -> passive effect, setData(B)
//       -> browser paints again      <- B ticker over B's candles
//
// It was never a cache or latency problem: B's data was already in hand. A
// LAYOUT effect runs after the DOM mutation and BEFORE the paint, so both
// halves land in one composited frame.
//
// ⚠️ WHY NOT JUST DEFER THE LABEL INSTEAD: that does not remove the mismatch,
// it FLIPS it — you get A's ticker over B's candles. With one chart the only
// atomic answer is for both mutations to occur in the same frame.
//
// This rail is structural on purpose. The property is "which React effect
// phase applies the data", and jsdom composites nothing — a behavioural test
// here would pass whatever the phase, which is exactly how the original
// ordering survived a 23,000-test suite.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../StockChart.jsx')
const src = readFileSync(SRC, 'utf8')

describe('symbol-switch paint ordering', () => {
  it('NON-VACUITY: the file is real and holds the effect under test', () => {
    // Every assertion below is satisfied by an empty read.
    expect(src.length).toBeGreaterThan(100_000)
    expect(src).toContain('const updateChart = useCallback(')
  })

  it('⛔ a SWITCH applies through useLayoutEffect, before the browser paints', () => {
    // The guarded pre-paint apply: keyed on sym+tf, skipped when already applied.
    // `updateChart()` is no longer the effect's LAST statement: the legend
    // refresh follows it in the same commit (railed in legendHandoff.test.js).
    const m = src.match(/useLayoutEffect\(\(\) => \{\s*const key = `\$\{sym\}_\$\{resolvedTf\}`[\s\S]{0,320}?updateChart\(\)[\s\S]{0,1200}?\}, \[sym, resolvedTf, updateChart\]\)/)
    expect(m, 'the pre-paint switch apply is gone or was reshaped').toBeTruthy()
  })

  it('⭐ …and it is GUARDED, so it fires on a switch and not on every render', () => {
    const block = src.slice(src.indexOf('const _appliedSymTfRef'))
    expect(block).toContain('if (_appliedSymTfRef.current === key) return')
  })

  it('⚠️ the ORDINARY update path stays PASSIVE — live data must not enter the frame budget', () => {
    // updateChart is the heaviest function in this file (candles + volume +
    // every overlay and indicator) and its deps include live data. Making the
    // ordinary path synchronous would put that work inside every 30s poll's
    // frame. If this ever becomes a layout effect, scanning gets atomic and
    // everything else gets janky.
    expect(src).toMatch(/\/\/ Effect: update chart when data or settings change[\s\S]{0,80}?useEffect\(\(\) => \{\s*updateChart\(\)\s*\}, \[updateChart\]\)/)
  })

  it('the pre-paint apply is declared AFTER updateChart, not hoisted above it', () => {
    // A temporal dead zone here would throw on every mount — this project has
    // already produced three of those.
    expect(src.indexOf('const updateChart = useCallback('))
      .toBeLessThan(src.indexOf('const _appliedSymTfRef'))
  })
})
