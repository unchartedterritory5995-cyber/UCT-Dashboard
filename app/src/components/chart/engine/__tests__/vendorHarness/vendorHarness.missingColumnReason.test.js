// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.missingColumnReason.test.js
//
// ─── HONESTY-SWEEP r3 — a missing column says WHY, when the door recorded it ─────
//
// The measure-pair of 2026-11-08 read `delta-rsi-oscillator-strategy` RDDT as MATCH on
// master and INCONCLUSIVE on the sweep tip ("computeFor returned no column for value"),
// with nothing saying why. Traced: the runtime pane's wall-clock budget
// (`runtime:time-budget`, 1,000 ms, `runtimeColumns.RUNTIME_PANE_TIME_BUDGET_MS`) stopped
// the run inside a long full-corpus process; alone the capture computes in ~400 ms and
// MATCHes on both sides (`vendorHarness.ptGapsDeltaRsi.test.js`). The harness now names
// the guard `nativeRegistry.columnErrors` recorded for the row, so the next such flip
// reads as the load-sensitive stop it is, not as a lane that dropped its columns.
// The run itself is stubbed here: the budget is wall-clock, and a rail that waits for a
// slow machine is not a rail.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

let stubErrors = null
vi.mock('../../nativeRegistry', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    computeFor: (...args) => {
      if (!stubErrors) return real.computeFor(...args)
      const out = {}
      Object.defineProperty(out, '__columnErrors', { value: Object.freeze(stubErrors), enumerable: false })
      return out
    },
  }
})

const { gradeCapture, loadCapture, HARNESS_DIR } = await import('./harness')

afterEach(() => { vi.unstubAllEnvs(); stubErrors = null })

const CAPTURE = 'delta-rsi-oscillator-strategy-rddt-1d-2026-10-02'
const KEYS = ['value', 'out2', 'out3', 'out4']

function grade(errors) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  stubErrors = errors
  const cap = loadCapture(path.join(HARNESS_DIR, `${CAPTURE}.json`)).capture
  return gradeCapture(cap).verdict
}

describe('HONESTY-SWEEP r3 — the harness names the guard behind a missing column', () => {
  it('a run stopped by its time budget reads "(runtime:time-budget)" on every plot', () => {
    const msg = 'this script took more than 1000 ms to draw bar by bar'
    const v = grade(Object.fromEntries(KEYS.map((k) => [k, { guard: 'runtime:time-budget', message: msg }])))
    expect(v.verdict).toBe('INCONCLUSIVE')
    const plots = v.plots.filter((p) => KEYS.includes(p.ours))
    expect(plots.length).toBe(4)
    for (const p of plots) {
      expect(p.reason).toContain(`computeFor returned no column for ${p.ours} (runtime:time-budget)`)
    }
  }, 600000)

  it('🔴 CONTROL — with no recorded guard the reason stays bare (the suffix is the door\'s record, not a guess)', () => {
    const v = grade({})
    for (const p of v.plots.filter((x) => KEYS.includes(x.ours))) {
      expect(p.reason).toMatch(new RegExp(`computeFor returned no column for ${p.ours}$`))
    }
  }, 600000)
})
