// app/src/components/chart/engine/__tests__/vendorHarness/uieCompatibility.measure.test.js
//
// ⭐⭐ UIE PHASE 2 (M6) — WHAT EVERY RUNTIME-ONLY CORPUS SCRIPT DOES ON A MEMBER'S CHART,
// through the PRODUCT path (`computeRuntimeColumns` under the pane's own 1,000 ms
// budget, the worker's call), on three charts: a daily chart from the listing, a daily
// chart that does not reach the listing (its last 5,000 bars), and a 5-minute chart of
// 19,000 bars (under HISTORY). It prints, per script and chart, what a member sees:
// `drawn` (and how many warm-up bars are withheld), or the NAMED refusal. Parity with
// TradingView is NOT decided here — it is the harness's, on committed captures
// (`uieRuntimeAcceptance.measure.test.js`).
//
// ⛔ OPT-IN (UIE_COMPAT=1, UIE_COMPAT_OUT=<file.json>). Asserts only that it ran.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns, RUNTIME_PANE_TIME_BUDGET_MS } from '../../runtime/runtimeColumns'
import { runtimeWarmupOf, runtimeObjectsWithheldOf, runtimeObjectsOf } from '../../runtime/runtimeObjects'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.UIE_COMPAT === '1'
const OUT = process.env.UIE_COMPAT_OUT
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FIX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const rowsOf = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8')).bars.rows
  .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))

// a member's chart always names its symbol (the binder's `ctx.symbol`)
const SYM = { ticker: 'AAPL', exchange: 'NASDAQ' }
afterEach(() => { vi.unstubAllEnvs() })

describe.skipIf(!RUN)('UIE Phase 2 — runtime-only corpus scripts on three member charts (opt-in)', () => {
  it('classifies every runtime-only script', () => {
    const daily = rowsOf('vw-deadband-ticks-aapl-1d-2026-09-28.json')
    const five = rowsOf('vw-bar-origin-rddt-5-2026-10-02.json').slice(-19000)
    const charts = [
      { name: 'D from listing', rows: daily, ctx: { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: SYM } },
      { name: 'D off listing (5,000)', rows: daily.slice(-5000), ctx: { tf: 'D', newestBarIsForming: false, symbol: SYM } },
      { name: '5m (19,000)', rows: five, ctx: { tf: '5', newestBarIsForming: false, symbol: SYM } },
      // ⭐ UIE PHASE 3 (M2) — a full intraday load, under the raised HISTORY ceiling
      { name: '5m (32,000)', rows: [...five.slice(0, 32000 - five.length).map((b) => ({ ...b, t: b.t - (five[five.length - 1].t - five[0].t + 300) })), ...five].slice(-32000), ctx: { tf: '5', newestBarIsForming: false, symbol: SYM } },
    ]
    const out = []
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
      const row = {
        slug: f.replace(/\.pine$/, '').split('__')[0],
        inputs: (def.inputs || []).filter((i) => !['color', 'lineWidth'].includes(i.key)).length,
        drawsObjects: def.compute.objects === true || !!(def.objects && (def.objects.ops || []).length),
        withheldPlots: (door.built.withheld || []).length,
        charts: {},
      }
      for (const c of charts) {
        const t0 = performance.now()
        try {
          const cols = computeRuntimeColumns(def, c.rows, c.ctx, { budgetMs: RUNTIME_PANE_TIME_BUDGET_MS })
          const w = runtimeWarmupOf(cols)
          const objWithheld = runtimeObjectsWithheldOf(cols)
          const objs = runtimeObjectsOf(cols)
          row.charts[c.name] = { outcome: 'drawn', ms: Math.round(performance.now() - t0),
            ...(w ? { warmupBars: w.withheldBars } : {}),
            ...(objWithheld ? { drawings: `withheld (${objWithheld.guard})` } : objs ? { drawings: objs.live.length } : {}) }
        } catch (e) {
          row.charts[c.name] = { outcome: e.guard || e.name, ms: Math.round(performance.now() - t0),
            why: String(e.message).slice(0, 140) }
        }
      }
      out.push(row)
    }
    expect(out.length).toBeGreaterThanOrEqual(10)
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  }, 3600000)
})
