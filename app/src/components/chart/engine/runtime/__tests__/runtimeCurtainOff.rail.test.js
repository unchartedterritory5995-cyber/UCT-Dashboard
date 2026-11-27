// app/src/components/chart/engine/runtime/__tests__/runtimeCurtainOff.rail.test.js
//
// ⛔⛔ (e102, coordinator ruling 2026-11-27) THE RUNTIME LANE'S OFF-LISTING CURTAIN RELEASES NOTHING until it releases
// only values PROVED equal to a run from the listing. Measured (`vendorHarness/curtainCensus.*.measure.test.js`): the
// curtain released values that a run from an earlier start contradicts on every daily chart of the census (an
// order-block latch released as 0 where the earlier start holds 5.7; plots served `na` where it draws; drawings).
// A listing document off the listing is refused by name (R-W) again. The rails that test the curtain's machinery turn it
// on themselves (`setOffListingCurtainEnabled(true)`); it must never be on by default while this rail stands.
import { describe, it, expect, afterEach } from 'vitest'
import SRC from '../runtimeColumns.js?raw'
import SERVER_ENTRY from '../serverEntry.js?raw'
import {
  computeRuntimeColumns, resetRuntimeSessions, setOffListingCurtainEnabled, RUNTIME_HISTORY_GUARD,
} from '../runtimeColumns.js'
import { runtimeWarmupOf } from '../runtimeObjects.js'

afterEach(() => { setOffListingCurtainEnabled(false); resetRuntimeSessions() })

// a LATCH: `level` is written only on a spike bar, and holds its declared 0.0 until the first one. The only spike lies
// before the chart's first bar, so a run from the chart's first bar and one from 251 bars later both hold 0.0 on every
// bar (two starts agree), while a run from the listing holds the spike's high: the class order-block-finder showed.
const FULL = 4000
const SPIKE = 200
const bars = Array.from({ length: FULL }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 11)
  return { t: 1500000000 + i * 86400, o: c, h: i === SPIKE ? 1000 : c + 1, l: c - 1, c, v: 1000 }
})
const LATCH = { id: 'u_latch', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:u_latch', outputs: { v: 0 },
    source: '//@version=6\nindicator("latch")\nvar float level = 0.0\nif high > 500\n    level := high\nplot(level)\n' } }
const D = { tf: 'D', newestBarIsForming: false }
const refusedWith = (fn) => { try { fn(); return null } catch (e) { return e } }

describe('the off-listing curtain is off for every member', () => {
  it('the module starts with the curtain switched off', () => {
    expect(SRC).toMatch(/^let _offListingCurtainOn = false$/m)
    expect(SRC).not.toMatch(/^let _offListingCurtainOn = true$/m)
  })

  it('the server bundle (pine-runtime: server alerts) runs the same switch and cannot turn it on', () => {
    // `serverEntry.js` re-exports this module's `computeRuntimeColumns` into `dist-server/pine-runtime.mjs`, which
    // `services/pine_runtime/job.mjs` runs: one module, one switch; the seam is not exported to the service
    expect(SERVER_ENTRY).toMatch(/computeRuntimeColumns/)
    expect(SERVER_ENTRY).not.toMatch(/setOffListingCurtainEnabled/)
  })

  it('⛔ TWO STARTS THAT AGREE ARE NOT A PROOF: a listing document off the listing is refused by name, never released', () => {
    const truth = computeRuntimeColumns(LATCH, bars, { ...D, historyFromListing: true }).v
    expect(truth[FULL - 1], 'from the listing the latch holds the spike').toBe(1000)
    const window = bars.slice(1000)
    const err = refusedWith(() => computeRuntimeColumns(LATCH, window, { ...D, historyFromListing: false }))
    expect(err && err.guard, 'off the listing: refused by name, nothing released').toBe(RUNTIME_HISTORY_GUARD)
  })

  it('on the listing nothing changes: every bar drawn, no curtain', () => {
    const got = computeRuntimeColumns(LATCH, bars, { ...D, historyFromListing: true })
    expect(runtimeWarmupOf(got)).toBeNull()
    expect(got.v[FULL - 1]).toBe(1000)
  })

  it('CONTROL — the curtain, switched on, RELEASES the wrong value (what this switch keeps off members)', () => {
    setOffListingCurtainEnabled(true)
    const got = computeRuntimeColumns(LATCH, bars.slice(1000), { ...D, historyFromListing: false })
    const w = runtimeWarmupOf(got)
    expect(w && w.withheldBars).toBeGreaterThanOrEqual(0)
    expect(got.v[got.v.length - 1], 'released 0 where the run from the listing holds 1000').toBe(0)
  })
})
