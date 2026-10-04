// app/src/components/chart/engine/runtime/__tests__/runtimePaneClock.test.js
//
// ─── ⭐⭐ RT8 (step 87) — THE PRODUCT PATH KEEPS ITS WALL-CLOCK BUDGET ───────────
//
// The vendor harness grades the computation, not the clock
// (`runtimeColumns.js::__gradeWithoutPaneClockForTests`, set by every harness grade).
// Ruling D3 keeps the runtime pane's 1,000 ms budget on the PRODUCT path. These
// rails hold both halves on one document with a clock that runs slow on demand:
// the synchronous pane lane (`runtimeColumnsFor`, what the registry calls) stops a
// run that passes the budget by name, and only the rails' switch turns that off.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import {
  runtimeColumnsFor, paneBudgetMs, __gradeWithoutPaneClockForTests,
  RUNTIME_PANE_TIME_BUDGET_MS, RUNTIME_TIME_BUDGET_GUARD,
} from '../runtimeColumns.js'

const REPO = path.resolve(process.cwd(), '..')
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); __gradeWithoutPaneClockForTests(false) })

const doc = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const f = fs.readdirSync(path.join(REPO, 'corpus/committed')).find((x) => x.startsWith('trend-targets-algoalpha__'))
  const d = memberPaneDefinition({ source: fs.readFileSync(path.join(REPO, 'corpus/committed', f), 'utf8'), id: 'u_rt8clock0001' })
  expect(d.ok && d.lane).toBe('runtime')
  return d.definition
}
// a fresh array per run: the lane memoises on the bars' identity
const bars = () => Array.from({ length: 300 }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 103 + i + (i % 4), l: 97 + i - (i % 3), c: 100 + i + Math.sin(i), v: 1000,
}))
const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
/** A clock that advances 5 ms per read: 300 bars read it ~300 times, past 1,000 ms. */
const slowClock = () => {
  let t = 0
  vi.spyOn(performance, 'now').mockImplementation(() => (t += 5))
}

describe('RT8 — the runtime pane clock', () => {
  it('the product path applies the 1,000 ms budget by default', () => {
    expect(RUNTIME_PANE_TIME_BUDGET_MS).toBe(1000)
    expect(paneBudgetMs()).toBe(1000)
  })

  it('⭐⭐ a run that passes it STOPS by name on the product path', () => {
    const def = doc()
    slowClock()
    let err = null
    try { runtimeColumnsFor(def, bars(), {}, ctx) } catch (e) { err = e }
    expect(err && err.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
  })

  it('control: the same run, the same slow clock, with the rails\' switch on, completes', () => {
    const def = doc()
    slowClock()
    __gradeWithoutPaneClockForTests(true)
    expect(paneBudgetMs()).toBe(null)
    const out = runtimeColumnsFor(def, bars(), {}, ctx)
    expect(Object.keys(out).length).toBeGreaterThan(0)
  })

  it('control: with a real clock the product path completes (the stop above is the clock, not the script)', () => {
    const def = doc()
    const out = runtimeColumnsFor(def, bars(), {}, ctx)
    expect(Object.keys(out).length).toBeGreaterThan(0)
  })
})
