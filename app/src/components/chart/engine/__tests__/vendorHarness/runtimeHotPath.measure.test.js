// app/src/components/chart/engine/__tests__/vendorHarness/runtimeHotPath.measure.test.js
//
// ⭐⭐ UIE PHASE 4 (M3) — A REPEATABLE BENCHMARK OF THE RUNTIME'S SLOW SCRIPTS, AND A
// FINGERPRINT OF WHAT THEY DRAW.
//
// The runtime-only scripts that cost the most, each run ONCE (as from the listing: no
// warm-up check, no pane budget, the shipped limits otherwise) on real 5-minute bars,
// best of RUNS after a JIT warm-up, plus a hash of every output column and the live
// drawings. Run before and after a VM change: the times say what it bought, and the
// fingerprints must be identical — an optimization may never change what is drawn.
//
// ⛔ OPT-IN (UIE_HOTPATH=1, UIE_HOTPATH_OUT=<file.json>). Asserts only that it ran.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { runtimeObjectsOf } from '../../runtime/runtimeObjects'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { HARNESS_DIR } from './harness'

const RUN = process.env.UIE_HOTPATH === '1'
const OUT = process.env.UIE_HOTPATH_OUT
const RUNS = 5
// the whole-run counters lifted, so a slow script is timed to its end (a MEASUREMENT door, `opts.limits`)
const LIFTED = { CALL_COUNT: 1e12, TOTAL_INSTRUCTIONS: 1e12, LOOP_ITERATIONS: 1e12, ARRAY_OPERATIONS: 1e12, CARRIED_STEPS: 1e12, WINDOW_CELLS: 1e12, WALL_TIME: 1e9 }
const SCRIPTS = ['delta-rsi-oscillator-strategy', 'fibonacci-dolphintradebot', 'nadaraya-watson-rational-quadratic',
  'atr-stepped-pdf-ma-loxx', 'cc-yata', 'kalman-price-filter-backquant', 'trend-targets-algoalpha', 'renko-candles-overlay']
afterEach(() => { vi.unstubAllEnvs() })

describe.skipIf(!RUN)('UIE Phase 4 M3 — the runtime hot path (opt-in)', () => {
  it('times and fingerprints the slow scripts', () => {
    const REPO = path.resolve(process.cwd(), '..')
    const five = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'vw-bar-origin-rddt-5-2026-10-02.json'), 'utf8'))
      .bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const bars = five.slice(-10000)
    const ctx = { tf: '5', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
    const out = []
    for (const slug of SCRIPTS) {
      const file = fs.readdirSync(path.join(REPO, 'corpus/committed')).find((x) => x.startsWith(slug))
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      const door = enterMemberDoor(fs.readFileSync(path.join(REPO, 'corpus/committed', file), 'utf8'))
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      const once = () => {
        try { return { cols: computeRuntimeColumns(door.def, bars, ctx, { limits: LIFTED }) } } catch (e) { return { err: e.guard || e.name } }
      }
      once()
      const times = []
      let last
      for (let k = 0; k < RUNS; k += 1) { const t0 = performance.now(); last = once(); times.push(performance.now() - t0) }
      times.sort((a, b) => a - b)
      const h = crypto.createHash('sha256')
      if (last.cols) {
        for (const k of Object.keys(last.cols).sort()) h.update(k + ':' + JSON.stringify(Array.from(last.cols[k])))
        const o = runtimeObjectsOf(last.cols)
        if (o) h.update(JSON.stringify(o.live))
      } else h.update(String(last.err))
      out.push({ slug, bestMs: Math.round(times[0]), medianMs: Math.round(times[2]), fingerprint: h.digest('hex').slice(0, 16), err: last.err || null })
    }
    expect(out.length).toBe(SCRIPTS.length)
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  }, 1800000)
})
