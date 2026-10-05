// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.f9Divergences.test.js
//
// ─── F9 — values we DREW that TradingView does not, graded against the captures
//     that proved each, in both door states the member can reach (objects pane on,
//     runtime pane permitted) ────────────────────────────────────────────────────
//
// Each case is a DIVERGE the wave-17 tree drew (triage doc § F9):
//   1. `color.new(<per-bar rule>, t)`  — `pine.js::colorNewOverRule` (rt8 S03)
//   2. a `var` colour set by its `if`s — `pine.js::colourStateRule` (rt6 C01/C02/B01)
//   3. `ta.wma`'s rule A warm-up       — `interpret.js::rolling` (rt8 W01-W03)
//   4. `ta.cum(<constant>)` off the listing is the index (`bar-index:window`) —
//      `barIndexShift.js::countingCumStep` (vw-bar-counters SPY 1 / 30)
//   5. a capture whose own `bar_index` control contradicts its listing sentence is
//      not from the listing — `ourSide.js::barIndexControlContradicts` (vw-int-cast)
// Every DIVERGE the fix removes is asserted MATCH (colour compared where it was a
// colour), or INCONCLUSIVE BY NAME where the right answer is to withhold; a control
// per case shows the grade can still fail or that nothing else moved.
import { describe, it, expect } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR, VENDOR_DIR, withDoorState } from './harness'
import { decodePackedColour, coloursAgree } from '../../../../../../../tools/vendor_harness/compare.mjs'

const T = 900000
const cap = (id, dir = HARNESS_DIR) => loadCapture(path.join(dir, `${id}.json`)).capture
const plot = (v, title) => v.plots.find((p) => p.title === title)
const STATES = ['on', 'runtime']
const graded = (id, state, dir) => withDoorState(state, () => gradeCapture(cap(id, dir)).verdict)

describe('F9 (1, 3) — vw-rt8-runtime-followups RDDT: S03 colour and the wma warm-up', () => {
  for (const state of STATES) {
    it(`(${state}) the whole capture MATCHES: W01-W03 from their rule-A bar, S03 per bar in its colour`, () => {
      const v = graded('vw-rt8-runtime-followups-rddt-1d-2026-10-04', state)
      for (const t of ['W01 wma gap warmup', 'W02 ema of wma', 'W03 wma bar0 then gap']) {
        const p = plot(v, t)
        expect(p.verdict, `${t}: ${p.reason}`).toBe('MATCH')
        expect(p.stats.compared, t).toBeGreaterThan(500)
      }
      const s03 = plot(v, 'S03 shape color.new per-bar')
      expect(s03.verdict, s03.reason).toBe('MATCH')
      expect(s03.color).toBe('compared')
      expect(s03.stats.colorCompared).toBeGreaterThan(600)
      expect(v.verdict).toBe('MATCH')
    }, T)
  }
})

describe('F9 (2) — vw-rt6-runtime-colour: a var colour, its color.new, and its barcolor', () => {
  for (const id of ['vw-rt6-runtime-colour-rddt-1d-2026-10-03', 'vw-rt6-runtime-colour-spy-1d-2026-10-03']) {
    for (const state of STATES) {
      it(`${id} (${state}): C01 / C02 MATCH, EVERY drawn bar in TradingView's colour; the B01 barcolor agrees`, () => {
        const c = cap(id)
        const fromListing = id.includes('rddt')
        const { verdict: v, ours } = withDoorState(state, () => gradeCapture(c))
        for (const [t, colorer] of [['C01_var_colour', 'plot_2'], ['C02_new_var_40', 'plot_4']]) {
          const p = plot(v, t)
          expect(p.verdict, `${t}: ${p.reason}`).toBe('MATCH')
          expect(p.color, t).toBe('compared')
          // ⛔ The harness excuses a colour rule's own reach off the listing; this
          // reads past that excuse: every bar we DRAW, against the vendor's colorer.
          const row = ours.plots.find((x) => x.key === p.ours)
          const at = c.plotValues.fields.indexOf(colorer)
          let drawn = 0
          c.plotValues.rows.forEach((r, i) => {
            if (row.colors[i] == null) return
            drawn += 1
            expect(coloursAgree(decodePackedColour(r[at]), row.colors[i]), `${t} bar ${i}`).toBe(true)
          })
          if (fromListing) {
            expect(drawn, t).toBe(c.bars.rows.length)
            expect(p.stats.seedWithheld, t).toBe(0)
          } else {
            // off the listing the running index is not computable on bars 0-250:
            // those bars are WITHHELD by name (seed:held), never drawn in gold
            expect(p.stats.seedWithheld, t).toBe(251)
            expect(drawn, t).toBe(c.bars.rows.length - 251)
          }
        }
        const b01 = v.paints.rows.find((r) => r.id === 'plot_12')
        expect(b01.kind).toBe('barcolor')
        expect(b01.state).toBe('agree')
      }, T)
    }
  }
})

describe('F9 (4) — ta.cum(1) off the listing is withheld by name, never drawn from 1', () => {
  for (const id of ['vw-bar-counters-spy-1-2026-10-02', 'vw-bar-counters-spy-30-2026-10-02']) {
    for (const state of STATES) {
      it(`${id} (${state}): C05 is INCONCLUSIVE, withheld as bar-index:window`, () => {
        const v = graded(id, state)
        const p = plot(v, 'C05_ta_cum_1')
        expect(p.verdict, p.reason).toBe('INCONCLUSIVE')
        expect(p.reason).toMatch(/bar-index:window/)
        // the index itself, its control row, is withheld the same way
        expect(plot(v, 'C00_bar_index_CONTROL').reason).toMatch(/bar-index:window/)
      }, T)
    }
  }
  it('control: from the vendor\'s bar 0 (RDDT 5 minute, control row 0, 1, 2 …) C05 is drawn and MATCHES', () => {
    const v = graded('vw-bar-counters-rddt-5-2026-09-30', 'on')
    expect(plot(v, 'C00_bar_index_CONTROL').verdict).toBe('MATCH')
    expect(plot(v, 'C05_ta_cum_1').verdict).toBe('MATCH')
  }, T)
  it('control: a threshold on it (atr-trailing-stoploss `ta.cum(1) < 16`) masks early bars only — SPY still MATCHES', () => {
    const v = graded('atr-trailing-stoploss-spy-1d-2026-10-03', 'on')
    const p = plot(v, 'ATR Trailing Stoploss')
    expect(p.verdict, p.reason).toBe('MATCH')
    expect(p.stats.compared).toBeGreaterThan(1600)
  }, T)
})

describe('F9 (5) — vw-int-cast SPY: the capture\'s own bar_index control outranks its listing sentence', () => {
  it('I00 is withheld by name (bar-index:window); I01-I10 still MATCH', () => {
    const c = cap('vw-int-cast-spy-1d-2026-09-27', VENDOR_DIR)
    expect(c.history.startsAtBar0).toBe(true) // the sentence the control contradicts
    const v = withDoorState('on', () => gradeCapture(c).verdict)
    const i00 = plot(v, 'I00_bar_index_CONTROL')
    expect(i00.verdict, i00.reason).toBe('INCONCLUSIVE')
    expect(i00.reason).toMatch(/bar-index:window/)
    for (const p of v.plots.filter((x) => x.title !== 'I00_bar_index_CONTROL')) {
      expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
    }
  }, T)
})
