// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.f8Ungraded.test.js
//
// ─── F8 (step 94) — UNKNOWNS TURNED INTO VERDICTS ────────────────────────────
//
// Three rules, each with a control that DIVERGES (or stays unknown) when the
// rule is wrong, so a rule that turned a real disagreement into a MATCH would
// redden this file:
//
//   M3  a repeated title is paired by declaration order, ONLY when the count of
//       that title and the kind of every pair agree (`compare.mjs::pairRepeatedTitles`);
//   ND  a plot TradingView draws visibly while OUR engine hid the row as "reads
//       no bar" is NOT DRAWN — a DIVERGE, not "colour unresolvable";
//   Z   `array.sum` / `array.avg` over zero real elements no longer stops the
//       runtime pane: the run answers two probes and serves only what does not
//       move (delta-rsi's four markers, witnessed MATCH), and names the stop
//       (`runtime:unmeasured`) when a drawn column moves.
//   R   a column the door computed nothing for carries the door's own sentence
//       (`ourSide.js` reads `columnErrors`), never a bare "no column".

import { describe, it, expect, afterEach, vi } from 'vitest'
import path from 'node:path'
import { gradeCapture, loadCapture, HARNESS_DIR, withDoorState } from './harness'
import { compareCapture, pairRepeatedTitles, firstVisibleVendorBar } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { __gradeWithoutPaneClockForTests } from '../../runtime/runtimeColumns'
import { ARRAY_FNS } from '../../runtime/collections'
import { Budget } from '../../runtime/limits'

afterEach(() => { vi.unstubAllEnvs() })

const T = 600000
const memo = new Map()
function grade(id, state) {
  const key = `${id}|${state}`
  if (!memo.has(key)) {
    const cap = loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
    expect(cap, `${id} is a v1 capture`).toBeTruthy()
    memo.set(key, withDoorState(state, () => ({ cap, ...gradeCapture(cap) })))
  }
  return memo.get(key)
}
const itemsTitled = (v, t) => v.plots.filter((p) => p.title === t)

// ─── M3 ───────────────────────────────────────────────────────────────────────
describe('F8 M3 — a repeated title is paired by declaration order, under a guard', () => {
  it.each([
    ['opening-range-initial-balance-opening-price-rddt-1d-2026-10-02'],
    ['opening-range-initial-balance-opening-price-spy-1d-2026-10-03'],
  ])('%s: the 11 repeated-title items are paired (M3) and the capture grades MATCH', (id) => {
    const { verdict: v } = grade(id, 'on')
    expect(v.plots.filter((p) => /UNMAPPED/.test(p.reason || ''))).toEqual([])
    expect(v.plots.filter((p) => p.rule === 'M3-title-order').length).toBe(11)
    expect(v.verdict).toBe('MATCH')
  }, T)

  it('pmax-explorer RDDT: both Buy and both Sell pair by order and MATCH', () => {
    const { verdict: v } = grade('pmax-explorer-rddt-1d-2026-10-02', 'on')
    for (const t of ['Buy', 'Sell']) {
      const hits = itemsTitled(v, t)
      expect(hits.length).toBe(2)
      for (const p of hits) { expect(p.rule).toBe('M3-title-order'); expect(p.verdict).toBe('MATCH') }
    }
  }, T)

  it('⛔ CONTROL — the pairing is not vacuous: swapping our two Buy plots DIVERGES', () => {
    const { cap, ours } = grade('pmax-explorer-rddt-1d-2026-10-02', 'on')
    // The two vendor Buy series differ (one draws on 4 bars, the other never),
    // so a crossed pairing must be seen.
    const idx = ours.plots.map((p, i) => (p.title === 'Buy' ? i : -1)).filter((i) => i >= 0)
    expect(idx.length).toBe(2)
    const plots = [...ours.plots]
    ;[plots[idx[0]], plots[idx[1]]] = [plots[idx[1]], plots[idx[0]]]
    const swapped = compareCapture(cap, { ...ours, plots })
    expect(itemsTitled(swapped, 'Buy').some((p) => p.verdict === 'DIVERGE')).toBe(true)
  }, T)

  it('⛔ GUARD — a count that disagrees leaves the title UNMAPPED', () => {
    const { cap, ours } = grade('pmax-explorer-rddt-1d-2026-10-02', 'on')
    const drop = ours.plots.findIndex((p) => p.title === 'Buy')
    const plots = ours.plots.filter((_, i) => i !== drop)
    const v = compareCapture(cap, { ...ours, plots })
    const buys = itemsTitled(v, 'Buy')
    expect(buys.length).toBe(2)
    for (const p of buys) expect(p.reason).toMatch(/UNMAPPED/)
  }, T)

  it('⛔ GUARD — a kind that disagrees leaves the title UNMAPPED', () => {
    const { cap, ours } = grade('pmax-explorer-rddt-1d-2026-10-02', 'on')
    let flipped = false
    const plots = ours.plots.map((p) => {
      if (!flipped && p.title === 'Buy') { flipped = true; return { ...p, kind: 'plotchar' } }
      return p
    })
    const v = compareCapture(cap, { ...ours, plots })
    for (const p of itemsTitled(v, 'Buy')) expect(p.reason).toMatch(/UNMAPPED/)
  }, T)

  it('the pairing helper: vendor order is by column, ours by source order; unique titles are left alone', () => {
    const vendor = [
      { id: 'b', title: 'X', type: 'line', column: 5 },
      { id: 'a', title: 'X', type: 'line', column: 2 },
      { id: 'u', title: 'Only', type: 'line', column: 3 },
    ]
    const ours = [{ key: 'o1', title: 'X', kind: 'plot' }, { key: 'o2', title: 'X', kind: 'plot' }, { key: 'o3', title: 'Only', kind: 'plot' }]
    const { pairs, left } = pairRepeatedTitles(vendor, ours)
    expect(pairs.map((p) => [p.vendor.id, p.ours.key])).toEqual([['a', 'o1'], ['b', 'o2']])
    expect(left.map((v) => v.id)).toEqual(['u'])
    // an untitled plotshape of ours groups under TradingView's default "Shapes"
    const s = pairRepeatedTitles(
      [{ id: 's1', title: 'Shapes', type: 'shapes', column: 1 }, { id: 's2', title: 'Shapes', type: 'shapes', column: 2 }],
      [{ key: 'k1', title: null, kind: 'plotshape' }, { key: 'k2', title: '', kind: 'plotshape' }])
    expect(s.pairs.length).toBe(2)
  })
})

// ─── ND ───────────────────────────────────────────────────────────────────────
describe('F8 ND — a row this engine hid as "reads no bar" that TradingView draws is NOT DRAWN', () => {
  it('vw-bar-counters RDDT 1D: C05 ta.cum(1) is DIVERGE (not drawn), naming the first drawn bar', () => {
    const { verdict: v } = grade('vw-bar-counters-rddt-1d-2026-09-30', 'on')
    const p = itemsTitled(v, 'C05_ta_cum_1')[0]
    expect(p.verdict).toBe('DIVERGE')
    expect(p.reason).toMatch(/NOT DRAWN/)
    expect(p.stats.steady.first.kind).toBe('not-drawn')
    expect(p.stats.steady.first.bar).toBe(0)
  }, T)

  it('⛔ CONTROL — the same row hidden by the AUTHOR (or for a fill anchor) stays unknown, not DIVERGE', () => {
    const { cap, ours } = grade('vw-bar-counters-rddt-1d-2026-09-30', 'on')
    for (const why of ['author', 'fill-anchor']) {
      const plots = ours.plots.map((p) => (p.hiddenReason === 'constant' ? { ...p, hiddenReason: why } : p))
      const v = compareCapture(cap, { ...ours, plots })
      expect(itemsTitled(v, 'C05_ta_cum_1')[0].verdict, why).toBe('INCONCLUSIVE')
    }
  }, T)

  it('ND with no column (runtime pane): deadband SPY `D01_mintick` (a constant TradingView draws at 0.01) is NOT DRAWN', () => {
    const { verdict: v } = grade('vw-deadband-ticks-spy-1d-2026-09-28', 'runtime')
    const p = itemsTitled(v, 'D01_mintick')[0]
    expect(p.verdict).toBe('DIVERGE')
    expect(p.reason).toMatch(/NOT DRAWN.*hidden on this runtime document \(constant\)/)
    expect(p.stats.steady.first).toMatchObject({ bar: 0, kind: 'not-drawn', vendor: 0.01, ours: null })
  }, T)

  it('⛔ CONTROL — a hidden constant row TradingView never draws visibly stays unknown (cc-yata b1..b5 / s1..s5)', () => {
    const { verdict: v } = grade('cc-yata-rddt-1d-2026-09-27', 'runtime')
    for (const t of ['b1', 'b2', 'b3', 'b4', 'b5', 's1', 's2', 's3', 's4', 's5']) {
      const p = itemsTitled(v, t)[0]
      expect(p.verdict, t).toBe('INCONCLUSIVE')
      expect(p.reason, t).toMatch(/hidden on this runtime document \(constant\)/)
    }
    // and M3 pairs its five repeated titles (b9 / s9 / + / os13 / oa13), all agreeing
    const m3 = v.plots.filter((p) => p.rule === 'M3-title-order')
    expect(m3.length).toBe(10)
    expect(m3.every((p) => p.verdict === 'MATCH')).toBe(true)
  }, T)

  it("R — a row a runtime document withholds by name carries its door's sentence (wyckoff RDDT, `offset`)", () => {
    const { verdict: v } = grade('wyckoff-accumulation-distribution-rddt-1d-2026-10-02', 'runtime')
    const p = itemsTitled(v, 'Automatic Rally')[0]
    expect(p.verdict).toBe('INCONCLUSIVE')
    expect(p.reason).toMatch(/withheld by name on this runtime document — `Automatic Rally` is not drawn: it is drawn away from its own bar \(`offset`\)/)
  }, T)

  it('⛔ CONTROL — a vendor plot that is fully transparent on every bar is not "drawn"', () => {
    expect(firstVisibleVendorBar([1, 1, null], ['#2962ff00', '#00000000', '#2962ffff'])).toBe(null)
    expect(firstVisibleVendorBar([null, 1], ['#2962ffff', '#2962ff80'])).toEqual({ bar: 1, value: 1, colour: '#2962ff80', count: 1 })
    expect(firstVisibleVendorBar([1, 1], ['#2962ffff', '#2962ffff'], 1).bar).toBe(1)
  })
})

// ─── Z + R ────────────────────────────────────────────────────────────────────
describe('F8 Z — array.sum / array.avg over zero real elements, under two probes', () => {
  // ⭐ The zero-reals wall is gone; the NEXT wall is the run-wide LOOP_ITERATIONS
  // ceiling (limits.js, 100,000 for the WHOLE run, provisional): delta-rsi's
  // nested matrix loops pass it on bar 85 of 636. RT10's (runtime walls). Measured
  // by substitution (ceiling raised in a scratch run, bytes restored): all four
  // markers MATCH on 636 / 636 bars — so the computation is right and only the
  // ceiling stands. Pinned here as a NAMED stop, never an unexplained column.
  it('delta-rsi RDDT 1D (runtime pane): past the array.sum wall, stopped BY NAME at the LOOP_ITERATIONS ceiling (RT10)', () => {
    const { verdict: v } = grade('delta-rsi-oscillator-strategy-rddt-1d-2026-10-02', 'runtime')
    for (const t of ['Buy', 'Sell', 'Exit Long', 'Exit Short']) {
      const p = itemsTitled(v, t)[0]
      expect(p.verdict, t).toBe('INCONCLUSIVE')
      expect(p.reason, t).toMatch(/runtime:limit/)
      expect(p.reason, t).toMatch(/LOOP_ITERATIONS/)
      expect(p.reason, t).not.toMatch(/array\.sum/)
    }
  }, T)

  it('R — delta-rsi SPY (not from the listing) is still INCONCLUSIVE, and now says WHY by the door\'s own guard', () => {
    const { verdict: v } = grade('delta-rsi-oscillator-strategy-spy-1d-2026-10-02', 'runtime')
    for (const t of ['Buy', 'Sell', 'Exit Long', 'Exit Short']) {
      const p = itemsTitled(v, t)[0]
      expect(p.verdict).toBe('INCONCLUSIVE')
      expect(p.reason).toMatch(/no column/)
      expect(p.reason).toMatch(/runtime:history-start/)
    }
  }, T)

  const SRC = (plotExpr) => `//@version=5
indicator("f8 zero reals")
var a = array.new_float(3, na)
float s = array.sum(a)
var float acc = 0.0
for i = 0 to 2
    acc := acc + 1
plot(${plotExpr}, "D")
`
  function runtimeColumnsOf(src) {
    const cap = grade('delta-rsi-oscillator-strategy-rddt-1d-2026-10-02', 'runtime').cap
    return withDoorState('runtime', () => {
      __gradeWithoutPaneClockForTests(true)
      try {
        const door = enterMemberDoor(src)
        expect(door.def, door.refusal || '').toBeTruthy()
        expect(door.built.lane).toBe('runtime')
        const cols = registry.computeFor(door.def, toProductBars(cap), undefined, { tf: 'D', historyFromListing: true })
        return { cols, errs: registry.columnErrors(cols) }
      } finally {
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
        __gradeWithoutPaneClockForTests(false)
      }
    })
  }

  it('a drawn column that does NOT read the unmeasured sum is served', () => {
    const { cols, errs } = runtimeColumnsOf(SRC('close + acc * 0'))
    expect(errs).toEqual({})
    expect(cols.value.length).toBeGreaterThan(600)
  }, T)

  it('⛔ CONTROL — a drawn column that MOVES with the unmeasured sum stops by name (runtime:unmeasured), never a guess', () => {
    const { cols, errs } = runtimeColumnsOf(SRC('na(s) ? close + acc * 0 : close + 1 + acc * 0'))
    expect(cols.value).toBeUndefined()
    expect(errs.value.guard).toBe('runtime:unmeasured')
    expect(errs.value.message).toMatch(/array\.sum/)
    expect(errs.value.message).toMatch(/"D"/)
  }, T)

  it('without a probe the stop stands word for word; a probe limited to other names does not reach sum', () => {
    const sum = ARRAY_FNS['array.sum'].fn
    expect(() => sum([[NaN, NaN]], new Budget())).toThrow(/every element is na/)
    const scoped = new Budget()
    scoped.unmeasured = { probe: 7, hits: [], only: ['array.avg'] }
    expect(() => sum([[NaN]], scoped)).toThrow(/every element is na/)
    const probed = new Budget()
    probed.unmeasured = { probe: 7, hits: [], only: ['array.sum'] }
    expect(sum([[NaN, NaN]], probed)).toBe(7)
    expect(sum([[NaN, 2, 3]], probed)).toBe(5)   // RT7: real elements still reduce, na skipped
    expect(probed.unmeasured.hits).toEqual(['array.sum'])
  })
})
