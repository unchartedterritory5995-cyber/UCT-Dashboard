// app/src/components/chart/engine/__tests__/vendorHarness/runtimeWarmupEarlyStop.measure.test.js
//
// ⭐⭐ UIE PHASE 3 (M1) — THE EARLY STOP OVER THE WHOLE CORPUS. Every runtime-only
// corpus script, on a daily chart that does not reach the listing and on a 5-minute
// chart, run with the curtain's second run stopped early (`warmupProbe.js`) and run
// to its end: the two must draw EXACTLY the same thing — every value of every plot
// (`Object.is`), the same withheld warm-up, the same refusal. Prints the time of each.
//
// ⛔ OPT-IN (UIE_EARLYSTOP=1, UIE_EARLYSTOP_OUT=<file.json>): it runs every script
// six times on 24,000 bars. It ASSERTS the equivalence.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { runtimeWarmupOf } from '../../runtime/runtimeObjects'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.UIE_EARLYSTOP === '1'
const OUT = process.env.UIE_EARLYSTOP_OUT
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FIX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const rowsOf = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')).bars.rows
  .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const SYM = { ticker: 'AAPL', exchange: 'NASDAQ' }
afterEach(() => { vi.unstubAllEnvs() })

describe.skipIf(!RUN)('UIE Phase 3 M1 — early stop draws exactly what the full check draws (opt-in)', () => {
  it('every runtime-only corpus script, two charts', () => {
    const daily = rowsOf('vw-deadband-ticks-aapl-1d-2026-09-28.json').slice(-5000)
    const five = rowsOf('vw-bar-origin-rddt-5-2026-10-02.json').slice(-19000)
    const charts = [
      { name: 'D off listing (5,000)', rows: daily, ctx: { tf: 'D', newestBarIsForming: false, symbol: SYM } },
      { name: '5m (19,000)', rows: five, ctx: { tf: '5', newestBarIsForming: false, symbol: SYM } },
    ]
    const out = []
    let compared = 0
    for (const f of fs.readdirSync(CORPUS).filter((x) => x.endsWith('.pine')).sort()) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
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
      const row = { slug: f.replace(/\.pine$/, '').split('__')[0], charts: {} }
      for (const c of charts) {
        const run = (es) => {
          const t0 = performance.now()
          try {
            const cols = computeRuntimeColumns(def, c.rows, c.ctx, { warmupEarlyStop: es, incremental: false })
            return { cols, w: runtimeWarmupOf(cols), ms: performance.now() - t0 }
          } catch (e) { return { guard: e.guard || e.name, ms: performance.now() - t0 } }
        }
        // interleaved, best of three each: the first run of a script pays the JIT's warm-up
        const runs = [run(false), run(true), run(false), run(true), run(false), run(true)]
        const full = runs[0]
        const early = runs[1]
        const best = (es) => Math.min(...runs.filter((_, i) => (i % 2 === 1) === es).map((r) => r.ms))
        expect(early.guard, `${row.slug} ${c.name}`).toBe(full.guard)
        if (!full.guard) {
          expect(early.w && early.w.withheldBars).toBe(full.w && full.w.withheldBars)
          for (const k of Object.keys(full.cols)) {
            const a = full.cols[k]; const b = early.cols[k]
            expect(b.length).toBe(a.length)
            for (let i = 0; i < a.length; i += 1) {
              if (!Object.is(a[i], b[i])) expect.fail(`${row.slug} ${c.name} ${k} bar ${i}: ${a[i]} vs ${b[i]}`)
            }
          }
          compared += 1
        }
        row.charts[c.name] = { outcome: full.guard || 'drawn', fullMs: Math.round(best(false)), earlyMs: Math.round(best(true)),
          ...(early.w ? { warmupBars: early.w.withheldBars, stoppedAt: early.w.secondRunStoppedAt ?? null } : {}) }
      }
      out.push(row)
    }
    expect(compared).toBeGreaterThanOrEqual(10)
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  }, 3600000)
})
