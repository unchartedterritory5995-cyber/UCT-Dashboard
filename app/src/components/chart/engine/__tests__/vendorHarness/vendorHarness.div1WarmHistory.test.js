// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.div1WarmHistory.test.js
//
// ─── DIV-1 (2026-11-09) — THE PLOT AND OBJECT LANES GRADE WITH THE HISTORY ─────
//     TRADINGVIEW HAD
//
// TradingView computed every SPY 1D capture with SPY's history back to its
// 1993-01-29 listing in front of the window; the harness graded the plot and object
// lanes from a cold start at the window's first bar (the paints were already warm,
// RC1). `ourSide.js` now replays the plot and object lanes over [proved prehistory +
// window] from the SAME supplier (`warmBarsSupply`) and slices back to the window;
// `compare.mjs` shrinks the warm-up excuse by the bars replayed.
//
// Gate, measured before the change (DIV-1 step 1): the member's standalone daily
// chart computes the same way — `fullBarsFor('D')` = 12,500 bars on first paint
// (`StockChart._deepFirstPaint`), the server's deep branch serves SPY from the
// listing (8,502 sessions; the 6,677 before the SPY windows are the supplier's own
// sessions), the binder computes over every loaded bar, `historyFromListing` from
// the listing date. So these rails pin the harness to what the product computes.
//
// ⛔ Never invented history: a capture with no proved supplier, or one that also
// reads bars whose prehistory is not supplied (another symbol, a lower timeframe),
// stays cold — and is railed so.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { columnsInWindow, replayDecisionOf } from './ourSide'
import { fullBarsFor } from '../../../../../utils/barsBackfill'
import { RUNTIME_WARMUP_KEY, runtimeWarmupOf } from '../../runtime/runtimeObjects'
import { columnErrors } from '../../nativeRegistry'
import { colourWarmupOf } from '../../../../../../../tools/vendor_harness/compare.mjs'

const load = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
afterEach(() => { vi.unstubAllEnvs() })
function grade(cap) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  return gradeCapture(cap)
}
const item = (v, title) => v.plots.find((p) => p.title === title)
const SUPPLIER = 'vw-clock-close-tfchange-spy-1d-2026-09-28.json'

describe('DIV-1 — columnsInWindow', () => {
  const full = { a: [1, 2, 3, 4, 5], b: Float64Array.from([10, 20, 30, 40, 50]) }
  Object.defineProperty(full, '__columnErrors', { value: { c: { guard: 'g', message: 'm' } }, enumerable: false })
  Object.defineProperty(full, RUNTIME_WARMUP_KEY, { value: { withheldBars: 7, shift: 0 }, enumerable: false })

  it('slices every column past the prehistory', () => {
    const w = columnsInWindow(full, 3)
    expect(Array.from(w.a)).toEqual([4, 5])
    expect(Array.from(w.b)).toEqual([40, 50])
    expect(Object.keys(w)).toEqual(['a', 'b'])
  })

  it('carries every non-enumerable payload, verbatim', () => {
    expect(columnErrors(columnsInWindow(full, 3))).toEqual({ c: { guard: 'g', message: 'm' } })
  })

  it("moves the runtime's withheld warm-up into the window's indices, never below 0, never dropped", () => {
    expect(runtimeWarmupOf(columnsInWindow(full, 3)).withheldBars).toBe(4)
    expect(runtimeWarmupOf(columnsInWindow(full, 9)).withheldBars).toBe(0)
  })

  it('control: no prehistory is the identity', () => {
    expect(columnsInWindow(full, 0)).toBe(full)
  })
})

// ⭐ r1 (review N2) — the replay is never deeper than what the product computes: the
// standalone daily chart's `fullBarsFor('D')`, read from the product module (one
// authority). A synthetic over-depth supplier must go cold, by name.
describe("DIV-1 r1 — replayDecisionOf: replay only what a member's daily chart computes", () => {
  const DEPTH = fullBarsFor('D')
  const base = { supplyKind: 'warm', supplyBars: 6677, supplyReason: 'proved', file: 'sup.json', windowBars: 1800, tf: 'D' }

  it("the depth is the product's own constant, and SPY today is inside it", () => {
    expect(Number.isInteger(DEPTH) && DEPTH > 8477).toBe(true)
    expect(replayDecisionOf(base)).toMatchObject({ replay: true, kind: 'replayed' })
    expect(replayDecisionOf(base).why).toMatch(/STANDALONE daily chart/)
  })

  it("⛔ a synthetic OVER-DEPTH supplier (prehistory + window > fullBarsFor('D')) goes cold, by name", () => {
    const d = replayDecisionOf({ ...base, supplyBars: DEPTH - 1800 + 1 })
    expect(d).toMatchObject({ replay: false, kind: 'cold' })
    expect(d.why).toMatch(new RegExp(`exceed the ${DEPTH} bars a member's daily chart computes`))
  })

  it('control: exactly at the depth still replays (the product loads that many)', () => {
    expect(replayDecisionOf({ ...base, supplyBars: DEPTH - 1800 }).replay).toBe(true)
  })

  it('every other rule, one at a time: no supplier, the listing, intraday, another symbol, a lower timeframe', () => {
    expect(replayDecisionOf({ ...base, supplyKind: 'cold', supplyReason: 'none' })).toMatchObject({ replay: false, kind: 'cold', why: 'none' })
    expect(replayDecisionOf({ ...base, supplyKind: 'bar0', supplyReason: 'listing' })).toMatchObject({ replay: false, kind: 'bar0' })
    expect(replayDecisionOf({ ...base, tf: '30' }).why).toMatch(/not a daily chart/)
    expect(replayDecisionOf({ ...base, tf: 'W' }).replay).toBe(false)
    expect(replayDecisionOf({ ...base, readsOtherSymbol: true }).why).toMatch(/another symbol/)
    expect(replayDecisionOf({ ...base, readsLowerTf: true }).why).toMatch(/a lower timeframe/)
  })
})

describe('DIV-1 — colourWarmupOf shrinks the colour reach by the bars replayed', () => {
  it('replayed past the reach: no colour warm-up beyond the value\'s', () => {
    expect(colourWarmupOf({ bar0: false, capture: {}, warmupBars: 0, colorLookback: 2, replayedBars: 6677 })).toBe(0)
  })
  it('control: cold, the colour reach stands', () => {
    expect(colourWarmupOf({ bar0: false, capture: {}, warmupBars: 0, colorLookback: 2 })).toBe(2)
  })
})

// ─── the measured flips ─────────────────────────────────────────────────────────
// Each was DIVERGE (a converging prefix) graded cold — triage 2026-11-08 at
// 138960df55. Offline control: `ema(close, n)` over the 1993+ prehistory equals the
// vendor's MMA05/MMA20/MMA90 to ~1e-15 from window bar 0.
describe('DIV-1 — SPY 1D, replayed over the listing', () => {
  const MADRID = load('madrid-moving-average-ribbon-spy-1d-2026-10-03')

  it('our side says which history it computed on: 6,677 bars from the listing supplier', () => {
    const { ours } = grade(MADRID)
    expect(ours.historyReplay).toMatchObject({ kind: 'replayed', file: SUPPLIER, bars: 6677, historyFromListing: true })
    // ⚠️ review N3 — a replayed MATCH speaks for the standalone daily chart, nothing wider
    expect(ours.historyReplay.speaksFor).toMatch(/standalone daily chart.*not a grid cell.*W \/ M stay cold/)
    expect(ours.plots.every((p) => p.historyReplayed && p.historyReplayed.bars === 6677)).toBe(true)
    // the window is still the window
    expect(ours.bars.length).toBe(1800)
    expect(ours.plots[0].column.length).toBe(1800)
  })

  it('⭐ Madrid Ribbon: MATCH on all 1800 bars of all 18 MMAs, no warm-up excused', () => {
    const { verdict } = grade(MADRID)
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
    for (const t of ['MMA05', 'MMA20', 'MMA90']) {
      const p = item(verdict, t)
      expect(p.warmupBars, t).toBe(0)
      expect(p.warmupSource, t).toMatch(/replayed 6677 bars of proved prehistory/)
      expect(p.stats.steady.compared, t).toBe(1800)
      expect(p.stats.maxRel, t).toBeLessThan(1e-12)
    }
  })

  it('⭐ ATR Bands: MATCH (upper - lower = 5 ATR(3) from bar 0 once warm)', () => {
    const { verdict } = grade(load('atr-bands-spy-1d-2026-10-03'))
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
  })

  it('⭐ bar_index from the listing: vw-bar-origin O00 control MATCH (it was withheld by name cold)', () => {
    const { verdict } = grade(load('vw-bar-origin-spy-1d-300-2026-10-02'))
    expect(item(verdict, 'O00_bar_index_CONTROL').verdict).toBe('MATCH')
    expect(item(verdict, 'O06_barssince_isfirst').verdict).toBe('MATCH')
  })
})

describe('DIV-1 — honesty: no supplier, or bars whose prehistory is not supplied, stay cold', () => {
  it('⛔ a script that reads ANOTHER SYMBOL stays cold although SPY\'s supplier exists: htf-liquidity-dashboard-tfo SPY (AUDUSD / GBPUSD)', () => {
    const { ours, verdict } = grade(load('htf-liquidity-dashboard-tfo-spy-1d-2026-10-03'))
    expect(ours.historyReplay).toMatchObject({ kind: 'cold', bars: 0, file: null })
    expect(ours.historyReplay.reason).toMatch(/prehistory is not supplied/)
    expect(ours.notes.some((n) => /^plots\/objects: cold: a proved supplier exists .* reads another symbol/.test(n))).toBe(true)
    expect(ours.plots.every((p) => p.historyReplayed === null)).toBe(true)
    // so its `var` drawing list is still withheld off the listing, by name
    expect(verdict.objects.withheld).toBe('objects:off-listing')
  })

  it('⛔ an INTRADAY chart stays cold although a supplier exists (the chart first-paints a shallow window): vw-time-tf SPY 30m', () => {
    const { ours } = grade(load('vw-time-tf-spy-30-2026-10-02'))
    expect(ours.historyReplay).toMatchObject({ kind: 'cold', bars: 0, file: null })
    expect(ours.historyReplay.reason).toMatch(/not a daily chart/)
  })

  it('a capture from the listing has nothing before bar 0 (kind bar0), and grades as before', () => {
    const { ours } = grade(load('vw-ratchet-stops-rddt-1d-2026-10-02'))
    expect(ours.historyReplay).toMatchObject({ kind: 'bar0', bars: 0, file: null })
    expect(ours.plots.every((p) => p.historyReplayed === null)).toBe(true)
  })
})
