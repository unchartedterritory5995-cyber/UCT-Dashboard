// app/src/components/chart/engine/__tests__/vendorHarness/runtimeIncremental.measure.test.js
//
// ⭐⭐⭐ UIE PHASE 5 (M2/M7) — EVERY RUNTIME-ONLY CORPUS SCRIPT, A REALTIME SESSION ON
// REAL BARS: THE INCREMENTAL RUN EQUALS THE FULL RUN AT EVERY STEP, AND WHAT IT COSTS.
//
// Real RDDT 5-minute bars, the member door's own document, the product path
// (`computeRuntimeColumns`, the pane budget off so a slow script is measured to its end).
// From the listing (one run) and off it (the warm-up curtain, two runs). Steps: initial
// load; TICKS ticks on the forming bar per bar; BARS new bars; then a correction of an old
// bar (an invalidation). After every step the incremental output is compared with a clean
// full run of the same bars — every column bit for bit, the warm-up, every live drawing —
// and the times of each kind of step are reported (median / p95 / max, ms), beside the
// full run's.
//
// ⛔ OPT-IN (UIE_INCREMENTAL=1, UIE_INCREMENTAL_OUT=<file.json>). It ASSERTS equivalence.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns, resetRuntimeSessions, runtimeIncrementalOf } from '../../runtime/runtimeColumns'
import { runtimeObjectsOf, runtimeWarmupOf } from '../../runtime/runtimeObjects'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import { HARNESS_DIR } from './harness'

const RUN = process.env.UIE_INCREMENTAL === '1'
const OUT = process.env.UIE_INCREMENTAL_OUT
const N = Number(process.env.UIE_INCREMENTAL_BARS || 8000)
const TICKS = 4
const BARS = 5
afterEach(() => { vi.unstubAllEnvs() })

const stats = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { n: s.length, median: Math.round(q(0.5) * 10) / 10, p95: Math.round(q(0.95) * 10) / 10, max: Math.round(s[s.length - 1] * 10) / 10 }
}
const fingerprint = (r) => {
  if (r.err) return `ERR ${r.err}`
  const w = runtimeWarmupOf(r.cols)
  const o = runtimeObjectsOf(r.cols)
  return JSON.stringify([Object.keys(r.cols).sort().map((k) => [k, Array.from(r.cols[k], (v) => (Number.isNaN(v) ? 'NaN' : v))]),
    w ? w.withheldBars : null, w ? w.drawings || null : null, o ? o.live : null])
}

describe.skipIf(!RUN)('UIE Phase 5 — incremental runs over the corpus (opt-in)', () => {
  it('every runtime-only script, from the listing and off it', () => {
    const REPO = path.resolve(process.cwd(), '..')
    const five = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'vw-bar-origin-rddt-5-2026-10-02.json'), 'utf8'))
      .bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
    const base = five.slice(-(N + BARS + 1))
    const out = []
    for (const f of fs.readdirSync(path.join(REPO, 'corpus/committed')).filter((x) => x.endsWith('.pine')).sort()) {
      const source = fs.readFileSync(path.join(REPO, 'corpus/committed', f), 'utf8')
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
      let off
      try { off = enterMemberDoor(source) } catch { off = { def: null } }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (off.def) continue
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (!door.def || !door.built || door.built.lane !== 'runtime') continue
      const def = door.def
      const slug = f.replace(/\.pine$/, '').split('__')[0]
      for (const listing of [true, false]) {
        resetRuntimeSessions()
        const ctx = { tf: '5', newestBarIsForming: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' }, ...(listing ? { historyFromListing: true } : {}) }
        const run = (rows, incremental) => {
          const t0 = performance.now()
          let r
          try { r = { cols: computeRuntimeColumns(def, rows, ctx, { incremental }) } } catch (e) { r = { err: e.guard || e.name } }
          r.ms = performance.now() - t0
          return r
        }
        const times = { initial: [], tick: [], newBar: [], invalidation: [], full: [] }
        let resumed = 0
        let steps = 0
        let mismatch = null
        const step = (rows, kind) => {
          const inc = run(rows, true)
          const full = run(rows, false)
          times[kind].push(inc.ms)
          times.full.push(full.ms)
          steps += 1
          if (inc.cols && (runtimeIncrementalOf(inc.cols) || {}).resumedFrom !== null) resumed += 1
          if (!mismatch && fingerprint(inc) !== fingerprint(full)) mismatch = kind
        }
        let rows = base.slice(0, N).map((b) => ({ ...b }))
        step(rows, 'initial')
        for (let b = 0; b < BARS; b += 1) {
          const next = base[N + b]
          for (let t = 1; t <= TICKS; t += 1) {   // the forming bar walks toward its close
            const last = rows[rows.length - 1]
            const c = last.c + (next.o - last.c) * (t / TICKS) * 0.5
            rows = [...rows.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c), v: last.v + 7 * t }]
            step(rows, 'tick')
          }
          rows = [...rows, { ...next }]
          step(rows, 'newBar')
        }
        rows = rows.map((r, i) => (i === Math.floor(rows.length / 2) ? { ...r, c: r.c * 1.001 } : r))
        step(rows, 'invalidation')
        expect(mismatch, `${slug} listing=${listing}: incremental differs from full at a ${mismatch} step`).toBeNull()
        out.push({ slug, listing, resumed, steps, outcome: rows && fingerprint(run(rows, false)).startsWith('ERR') ? fingerprint(run(rows, false)) : 'drawn',
          ms: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, stats(v)])) })
      }
    }
    expect(out.length).toBeGreaterThanOrEqual(20)
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  }, 7200000)
})
