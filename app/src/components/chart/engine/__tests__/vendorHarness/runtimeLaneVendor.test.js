// app/src/components/chart/engine/__tests__/vendorHarness/runtimeLaneVendor.test.js
//
// ─── THE RUNTIME-LANE DOOR AGAINST THE VENDOR'S OWN NUMBERS (2026-09-27) ──────
//
// Two pieces of evidence, and each is labelled for exactly what it is.
//
// 1. ⭐ THE ONE NATIVE CAPTURE ON DISK, THROUGH BOTH ENGINES. `keltner-channels-
//    bands-rddt-1d-2026-09-27.json` is a script the HOST lane serves, so a member
//    never reaches the runtime lane with it. It is graded here through the runtime
//    door FORCED (`runOurSide(capture, {lane: 'runtime'})`), and every plot's
//    verdict and every count must equal the host door's. ⛔ It proves the runtime
//    door carries the same rows, the same series and the same values onto the same
//    bars; it does NOT prove the runtime lane's state machinery, because every
//    Keltner row is a pure expression both lanes compute through `interpret`.
//
// 2. ⭐ A SCRIPT THE HOST LANE REFUSES, AGAINST THE VENDOR'S BUILT-IN. `adx-and-di-
//    for-v4` is refused by the host lane (`pine:state`) and reaches a member ONLY
//    through the fallback. Its DI+ and DI- are Wilder's recurrences written as `var`
//    state (`S := nz(S[1]) - nz(S[1])/len + x`), which is `len × RMA` — so their
//    RATIO is the RMA ratio TradingView's own `ta.dmi(14, 14)` computes, and the
//    owner's capture of that built-in (`tests/fixtures/vendor/observations/
//    plus-di-14-…` / `minus-di-14-…`, 300 SPY daily bars) is a real oracle for
//    them. ⛔ IT IS NOT A CAPTURE OF THIS SCRIPT: the script seeds its state at
//    zero on the first bar of the window while the vendor has run since 1993, so
//    the two agree only once that seed has decayed — (13/14)^n — and the comparison
//    starts at a stated bar. The script's ADX is `sma(DX, len)` where the built-in
//    uses an RMA, so ADX is NOT compared, and saying so is part of the evidence.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { compareCapture } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { runOurSide } from './ourSide'
import { HARNESS_DIR, REPO } from './harness'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'

afterEach(() => { vi.unstubAllEnvs() })

const KELTNER = path.join(HARNESS_DIR, 'keltner-channels-bands-rddt-1d-2026-09-27.json')

describe('⭐ the native Keltner capture, through the host door and the runtime door', () => {
  it('every plot gets the same verdict and the same counts through both engines', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const capture = JSON.parse(fs.readFileSync(KELTNER, 'utf8'))
    const integrity = validateCapture(capture)
    expect(integrity.ok, 'the capture itself failed validation').toBe(true)
    const host = compareCapture(capture, runOurSide(capture), { integrity })
    const ours = runOurSide(capture, { lane: 'runtime' })
    expect(ours.ok, ours.refusal).toBe(true)
    const rt = compareCapture(capture, ours, { integrity })
    const plotsOf = (v) => (v.plots || []).filter((p) => p.title !== 'objects')
    expect(plotsOf(rt).length).toBe(plotsOf(host).length)
    expect(plotsOf(host).length).toBeGreaterThan(0)
    for (const [i, p] of plotsOf(host).entries()) {
      const q = plotsOf(rt)[i]
      expect(q.title, `plot ${i}`).toBe(p.title)
      expect(q.verdict, p.title).toBe(p.verdict)
      expect(q.stats.steady.compared, p.title).toBe(p.stats.steady.compared)
      expect(q.stats.steady.compared, p.title).toBeGreaterThan(0)
      expect(q.stats.steady.ok, p.title).toBe(p.stats.steady.ok)
    }
  })
})

/** SPY daily bars + the vendor's `ta.dmi(14, 14)` reading, off the observation files. */
function dmiObservation(name) {
  const o = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/observations', name), 'utf8'))
  return {
    bars: o.market.bars.map((b) => ({ t: Number(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
    vendor: new Map(Object.entries(o.vendor.values).map(([t, v]) => [Number(t), v])),
  }
}

/** The first bar the comparison is allowed to start on.
 *
 *  ⭐ MEASURED 2026-09-27, worst relative difference per 50-bar window (DI+ / DI-):
 *      bars 100-150  1.5e-2 / 2.9e-3
 *      bars 150-200  3.7e-4 / 9.5e-5
 *      bars 200-250  2.9e-6 / 1.6e-6
 *      bars 250-300  2.2e-7 / 3.5e-8
 *  — falling ~40x per 50 bars, which is (13/14)^50: the zero seed decaying, nothing
 *  else. So the window starts at 250, and the test below that it is a DECAY (each
 *  window smaller than the last) is what stops "start later" being a way to hide a
 *  real disagreement. */
const SEED_DECAYED_FROM = 250

describe('⭐ adx-and-di (host-refused, runtime lane only) against the vendor built-in DMI', () => {
  it('DI+ and DI- agree with TradingView to 1e-6 once the script\'s zero seed has decayed', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const source = fs.readFileSync(path.join(REPO, 'corpus/committed/adx-and-di-for-v4__932.pine'), 'utf8')
    const built = memberPaneDefinition({ source, id: 'u_member-pane-dmi' })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    const { installed, errors } = registry.installUserDefinitions([built.definition])
    expect(errors).toEqual([])
    try {
      const plus = dmiObservation('plus-di-14-2026-09-06.json')
      const minus = dmiObservation('minus-di-14-2026-09-06.json')
      const cols = registry.computeFor(installed[0], plus.bars, undefined, { tf: 'D', newestBarIsForming: false })
      expect(registry.columnErrors(cols)).toEqual({})
      const keyOf = (label) => built.rows.find((r) => r.label === label).key
      for (const [label, obs] of [['DI+', plus], ['DI-', minus]]) {
        const col = cols[keyOf(label)]
        let compared = 0
        let worst = 0
        plus.bars.forEach((b, i) => {
          if (i < SEED_DECAYED_FROM) return
          const v = obs.vendor.get(b.t)
          if (!Number.isFinite(v)) return
          compared += 1
          worst = Math.max(worst, Math.abs(col[i] - v) / Math.abs(v))
        })
        expect(compared, `${label}: nothing was compared`).toBeGreaterThanOrEqual(45)
        expect(worst, `${label}: worst relative difference ${worst}`).toBeLessThan(1e-6)
        // ⛔ AND THE PREFIX IS A DECAY, window by window — a real disagreement
        // would not shrink by the seed's own factor every 50 bars.
        const windows = [[100, 150], [150, 200], [200, 250], [250, 300]].map(([a, b]) => {
          let w = 0
          for (let i = a; i < b; i += 1) {
            const v = obs.vendor.get(plus.bars[i].t)
            if (Number.isFinite(v)) w = Math.max(w, Math.abs(col[i] - v) / Math.abs(v))
          }
          return w
        })
        for (let k = 1; k < windows.length; k += 1) {
          expect(windows[k], `${label}: window ${k} did not shrink (${windows.join(', ')})`)
            .toBeLessThan(windows[k - 1] / 5)
        }
      }
    } finally {
      registry.uninstallUserDefinition('u_member-pane-dmi')
    }
  })

  it('⛔ CONTROL — before the seed decays the two DO differ, so the window above is doing work', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
    const source = fs.readFileSync(path.join(REPO, 'corpus/committed/adx-and-di-for-v4__932.pine'), 'utf8')
    const built = memberPaneDefinition({ source, id: 'u_member-pane-dmi2' })
    const { installed } = registry.installUserDefinitions([built.definition])
    try {
      const plus = dmiObservation('plus-di-14-2026-09-06.json')
      const cols = registry.computeFor(installed[0], plus.bars, undefined, { tf: 'D', newestBarIsForming: false })
      const col = cols[built.rows.find((r) => r.label === 'DI+').key]
      let early = 0
      plus.bars.forEach((b, i) => {
        const v = plus.vendor.get(b.t)
        if (i >= 60 || !Number.isFinite(v)) return
        early = Math.max(early, Math.abs(col[i] - v) / Math.abs(v))
      })
      expect(early).toBeGreaterThan(1e-3)
    } finally {
      registry.uninstallUserDefinition('u_member-pane-dmi2')
    }
  })
})
