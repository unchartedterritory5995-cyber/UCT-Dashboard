// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.ptGapsDeltaRsi.test.js
//
// ─── PT-GAPS r2 — delta-rsi's shape: the host-lane gap fixes never reach it ─────
//
// `delta-rsi-oscillator-strategy` is a Pine v4 script whose host translation refuses
// every row (`pine:tuple`: `[drsi, nrmse] = diff(…)`, a helper built from `for` loops),
// and whose RUNTIME pane MATCHES TradingView on RDDT from the listing (all four
// signals; `vendorHarness.coverageAudit`). PT-GAPS changed only the host plot lane's
// stamps (L3, L4, L6, G-c, G-h) and the info row (G-d). A landing run reported this
// capture refused with the host lane's sentence; it did not reproduce (r2, EVIDENCE).
// This rail holds both halves of the shape at once, so a host-lane change that leaks
// into the runtime pane goes red here by name:
//   1. the host translation is what it was: no `meta.blockRuns`, every row `pine:tuple`;
//   2. the runtime pane still draws it and still MATCHES on the captured signals;
//   3. ⭐ and that MATCH is a fact about VALUES, not about how busy the box was: on a
//      host clock that passes the pane's 1,000 ms budget on EVERY read it still MATCHES
//      (the harness grades on `ourSide.js::PARITY_CLOCK`). Before that seam, a cold
//      run on a loaded box passed the budget and this capture graded INCONCLUSIVE
//      ("computeFor returned no column"). The budget itself is railed where members
//      meet it (`runtime/__tests__/runtimeDoorBudget.rail.test.js`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { translatePine } from '../../ast/pine'
import { runtimeColumnsFor, resetRuntimeSessions, RUNTIME_PANE_TIME_BUDGET_MS, RUNTIME_TIME_BUDGET_GUARD } from '../../runtime/runtimeColumns'

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

const REPO = path.resolve(process.cwd(), '..')
const SRC = fs.readFileSync(path.join(REPO, 'corpus/committed/delta-rsi-oscillator-strategy__z4Yj46FVTX.pine'), 'utf8')
const CAPTURE = 'delta-rsi-oscillator-strategy-rddt-1d-2026-10-02'
const T = 600000

describe('PT-GAPS r2 — delta-rsi (v4, runtime-only) is untouched by the host-lane gap fixes', () => {
  it('the host translation: no block-run stamps, every row refused `pine:tuple`', () => {
    const t = translatePine(SRC, { strict: true, paramManifest: true })
    expect(t.blockRuns).toBeUndefined()
    expect(t.outputs.length).toBe(8)
    for (const o of t.outputs) {
      expect(o.refusal && o.refusal.guard).toBe('pine:tuple')
      expect(o.refusal.message).toMatch(/`for` \(reached through `diff`\)/)
    }
  })

  it('the runtime pane draws it and MATCHES TradingView on Buy / Sell / Exit Long / Exit Short', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const cap = loadCapture(path.join(HARNESS_DIR, `${CAPTURE}.json`)).capture
    const v = gradeCapture(cap).verdict
    expect(v.reason).not.toMatch(/member door refused/)
    expect(v.verdict).toBe('MATCH')
    for (const title of ['Buy', 'Sell', 'Exit Long', 'Exit Short']) {
      const hits = v.plots.filter((p) => p.title === title)
      expect(hits.length, title).toBe(1)
      expect(hits[0].verdict, title).toBe('MATCH')
    }
    // 🔴 CONTROL — with the runtime pane off the same capture is refused by the host
    // lane's own sentence: the MATCH above is the runtime pane's, not a vacuous pass
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const off = gradeCapture(cap).verdict
    expect(off.verdict).toBe('INCONCLUSIVE')
    expect(off.reason).toMatch(/member door refused \(pine:tuple\)/)
  }, T)

  it('⛔ the grade does not read the wall clock: a host clock past the 1,000 ms budget on every read still MATCHES', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const cap = loadCapture(path.join(HARNESS_DIR, `${CAPTURE}.json`)).capture
    // ⛔ COLD, as on the box that flipped it: the earlier cases in this file leave a runtime
    // session whose reused build skips the front end, and a warm run MATCHES on any clock.
    // Without this reset the case stayed green with the parity clock removed (review M1).
    resetRuntimeSessions()
    let t = 0
    vi.spyOn(globalThis.performance, 'now').mockImplementation(() => { t += RUNTIME_PANE_TIME_BUDGET_MS + 1; return t })
    const v = gradeCapture(cap).verdict
    // 🔴 CONTROL — that clock really is past the budget for a member's run: the door,
    // on the host clock, stops a one-line script by name
    const tiny = { id: 'u_clock_ctl', version: 1, meta: { name: 'c' }, plots: [{ key: 'v' }],
      compute: { kind: 'runtime', fn: 'clock:ctl', outputs: { v: 0 },
        source: ['//@version=5', 'indicator("c")', 'plot(close)', ''].join(String.fromCharCode(10)) } }
    const bars = Array.from({ length: 20 }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + i, v: 1 }))
    let stopped = null
    try { runtimeColumnsFor(tiny, bars, undefined, { tf: 'D' }) } catch (err) { stopped = err }
    vi.restoreAllMocks()
    expect(stopped && stopped.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(v.reason).not.toMatch(/no column/)
    expect(v.verdict).toBe('MATCH')
    for (const title of ['Buy', 'Sell', 'Exit Long', 'Exit Short']) expect(v.plots.find((p) => p.title === title).verdict, title).toBe('MATCH')
  }, T)
})
