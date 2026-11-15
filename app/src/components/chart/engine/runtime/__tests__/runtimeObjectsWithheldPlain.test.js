// ─── ⭐ OZ N-2 (engine 50) — A RUN WHOSE DRAWINGS STOPPED ON AN UNNAMED ERROR SAYS ONE PLAIN SENTENCE ─────
//
// Review OZ-STACK-LAND (N-2): when the object run of a runtime-lane script throws an error this
// lane does not NAME (no `guard`), `computeRuntimeColumns` keeps the plots (the plain run) and
// withholds the drawings, guard `runtime:objects`. Its `reason` was `String(err.message)` verbatim,
// so a member read engine text ("Cannot read properties of undefined…", "`label.new`: `x` takes a
// number") through `binder.js` → `stoppedRunSentence(reason, 'withheld')`. Now the reason is one
// fixed sentence (`RUNTIME_OBJECTS_STOPPED_REASON`); the raw text travels in `detail`, which no
// member surface reads. A refusal the lane DOES name keeps its own sentence (control).
import { describe, it, expect, vi } from 'vitest'

// The object run's build throws an unnamed JS error once; the plain run that follows builds for real.
let builds = 0
const RAW = "Cannot read properties of undefined (reading 'x')"
vi.mock('../../ast/pineRuntimeFrontend.js', async () => {
  const real = await vi.importActual('../../ast/pineRuntimeFrontend.js')
  return {
    ...real,
    buildRuntimeIr: (...a) => {
      builds += 1
      if (builds === 1) throw new TypeError(RAW)
      return real.buildRuntimeIr(...a)
    },
  }
})

import { computeRuntimeColumns, runtimeObjectsWithheld, RUNTIME_OBJECTS_STOPPED_REASON } from '../runtimeColumns.js'
import { runtimeObjectsOf, runtimeObjectsWithheldOf, RUNTIME_OBJECTS_KEY } from '../runtimeObjects.js'
import { ObjectRunError } from '../objectStore.js'
import { stoppedRunSentence } from '../../ast/objectLoss.js'

const bars = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7)
  return { t: 1500000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 }
})
const doc = {
  id: 'w', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:w', outputs: { v: 0 }, objects: true,
    source: '//@version=6\nindicator("w", overlay = true)\nplot(ta.ema(close, 10))\nvar l = label.new(bar_index, close, "a")' },
}
const MEMBER = "None of this script's drawings are shown on this chart: working them out stopped at a step "
  + 'this engine could not complete, so none are drawn rather than some of them. Its plots are drawn.'

describe('OZ N-2 — the runtime:objects WITHHELD path', () => {
  it('an unnamed error: the plots are drawn, the drawings are withheld with the fixed sentence, the raw text only in `detail`', () => {
    const cols = computeRuntimeColumns(doc, bars, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
    expect(builds).toBe(2)
    expect(Object.keys(cols)).toEqual(['v'])
    expect(cols.v.some((x) => Number.isFinite(x))).toBe(true)
    expect(runtimeObjectsOf(cols)).toBe(null)
    const w = runtimeObjectsWithheldOf(cols)
    expect(w).toEqual({ guard: 'runtime:objects', reason: RUNTIME_OBJECTS_STOPPED_REASON })
    expect(w.reason).not.toContain('Cannot read')
    expect(cols[RUNTIME_OBJECTS_KEY].detail).toBe(RAW)
    // what the binder hands the member's drawing note
    expect(stoppedRunSentence(w.reason, 'withheld')).toBe(MEMBER)
  })

  it('an ObjectRunError, any other exception: the same fixed sentence; the engine text in `detail`', () => {
    for (const err of [new ObjectRunError('`label.new`: `x` takes a number'), new RangeError('Invalid array length'), 'boom']) {
      const p = runtimeObjectsWithheld(err)
      expect(p.guard).toBe('runtime:objects')
      expect(p.reason).toBe(RUNTIME_OBJECTS_STOPPED_REASON)
      expect(p.detail).toBe(String((err && err.message) || err))
      expect(p.status).toBe('WITHHELD')
      expect(p.live).toEqual([])
    }
  })

  it('CONTROL — a refusal the lane names keeps its own guard and sentence, and carries no `detail`', () => {
    const named = Object.assign(new Error('this script runs on its last 50 bars only (`calc_bars_count`), so nothing is drawn rather than a guess.'),
      { guard: 'runtime:calc-bars-count' })
    expect(runtimeObjectsWithheld(named)).toEqual({ status: 'WITHHELD', live: [], guard: 'runtime:calc-bars-count',
      reason: named.message })
  })
})
