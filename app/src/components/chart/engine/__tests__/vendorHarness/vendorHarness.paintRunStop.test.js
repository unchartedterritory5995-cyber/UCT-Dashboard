// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.paintRunStop.test.js
//
// ⭐ e98 — A PAINT OUR SIDE DID NOT DRAW BECAUSE OUR RUN STOPPED is INCONCLUSIVE by the run's name, never DIVERGE.
// ⚰️ kernel-channel-backquant-regime-spy-1d (FRED RS's run, local): the run stopped at `runtime:limit` on SPY's deep
// daily history, its `bgcolor` plot_7 drew nothing, and the grade read "notDrawn" -> DIVERGE, the verdict a WRONG
// colour gets. The member's pane names the stop; a stopped run is not a wrong colour. Synthetic fixtures only.
import { describe, it, expect } from 'vitest'
import { gradePaints, runStopOf, RUN_STOP_GUARDS } from './paintColours'
import { comparePaints } from '../../../../../../../tools/vendor_harness/compare.mjs'

const T = [1, 2, 3]
const RED = 4294901760 // TradingView's packed colour, which decodes to #0000ffff
/** A capture with ONE bgcolor TradingView paints on every bar (#0000ffff). */
const capture = () => ({
  bars: { rows: T.map((t) => [t, 1, 1, 1, 1, 1]) },
  plotValues: { fields: ['time', 'plot_7'], rows: T.map((t) => [t, RED]) },
  study: { plots: [{ id: 'plot_7', type: 'bg_colorer', title: null }], styleState: { plot_7: { display: 15 } } },
  history: { startsAtBar0: true },
  warmup: { bars: 0, source: 'synthetic: every bar graded' },
})
const ours = (extra = {}) => ({ ok: true, translationPaints: [{ kind: 'bgcolor', line: 7, title: null }], paints: [],
  bindWithheldPaints: [], ...extra })

describe('e98 — a paint our run did not draw because it stopped', () => {
  it('runStopOf reads the run-stop guards off the column errors, and nothing else', () => {
    expect(runStopOf({ a: { guard: 'runtime:limit', message: 'the VM limit' } })).toEqual({ code: 'runtime:limit', reason: 'the VM limit' })
    expect(runStopOf({ a: { guard: 'other-symbol:not-held' } })).toBe(null)
    expect(runStopOf({})).toBe(null)
    expect([...RUN_STOP_GUARDS].sort()).toEqual(['runtime:failed', 'runtime:limit', 'runtime:time-budget'])
  })

  it('a stopped run\'s missing paint is INCONCLUSIVE, by the run\'s name', () => {
    const g = gradePaints(capture(), ours({ paintRunStop: { code: 'runtime:limit' } }))
    expect(g.rows).toHaveLength(1)
    expect(g.rows[0]).toMatchObject({ state: 'withheld', by: 'run', code: 'runtime:limit' })
    const v = comparePaints(g)
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.reason).toContain('our run stopped (runtime:limit)')
  })

  it('CONTROL: a paint missing with NO run stop is still DIVERGE', () => {
    const v = comparePaints(gradePaints(capture(), ours()))
    expect(v.verdict).toBe('DIVERGE')
  })

  it('CONTROL: a paint DRAWN in the wrong colour is still DIVERGE, run stop or not', () => {
    const drawnWrong = { paints: [{ kind: 'bgcolor', line: 7, title: null, colors: T.map(() => '#00ff00ff') }] }
    expect(comparePaints(gradePaints(capture(), ours({ ...drawnWrong, paintRunStop: { code: 'runtime:limit' } }))).verdict).toBe('DIVERGE')
    expect(comparePaints(gradePaints(capture(), ours(drawnWrong))).verdict).toBe('DIVERGE')
  })
})
