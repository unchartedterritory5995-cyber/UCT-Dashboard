// app/src/components/chart/engine/__tests__/vendorHarness/runtimeWarmupConvergence.measure.test.js
//
// ⭐⭐ UIE PHASE 2 — DOES A RUNTIME SCRIPT FORGET WHERE ITS CHART STARTS?
//
// A runtime document that needs TradingView's bar 0 (`meta.runtimeHistory === 'listing'`)
// is refused on every chart whose history does not reach the listing. This measures, for
// every such corpus script, what ruling R-W's warm-up curtain would need: run it from the
// chart's first bar AND from a later bar, and find the bar after which the two runs agree
// on every output through the end of the chart. Past that bar the values do not depend on
// where the run began; before it they do.
//
// ⛔ OPT-IN, prints JSON (UIE_WARMUP_OUT). Asserts only that the corpus was found.
//   cd app && UIE_WARMUP=1 UIE_WARMUP_OUT=<file.json> node node_modules/vitest/vitest.mjs run \
//     --maxWorkers=1 src/components/chart/engine/__tests__/vendorHarness/runtimeWarmupConvergence.measure.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns, convergedFrom } from '../../runtime/runtimeColumns'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.UIE_WARMUP === '1'
const OUT = process.env.UIE_WARMUP_OUT
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const FIX = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const DAILY = path.join(FIX, 'vw-deadband-ticks-aapl-1d-2026-09-28.json')
const FIVE = path.join(FIX, 'vw-bar-origin-rddt-5-2026-10-02.json')

afterEach(() => { vi.unstubAllEnvs() })
const rowsOf = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).bars.rows
const toBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))

describe.skipIf(!RUN)('UIE Phase 2 — warm-up convergence of listing documents (opt-in)', () => {
  it('measures where two runs from different first bars agree', () => {
    const lengths = [
      { name: 'D 5000 (off listing)', rows: rowsOf(DAILY).slice(-5000), tf: 'D' },
      { name: '5m 19000', rows: rowsOf(FIVE).slice(-19000), tf: '5' },
    ]
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    const out = []
    for (const f of files) {
      const source = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
      let offDoor
      try { offDoor = enterMemberDoor(source) } catch { offDoor = { def: null } }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (offDoor.def) continue
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      let door
      try { door = enterMemberDoor(source) } catch { registry.uninstallUserDefinition(HARNESS_DEF_ID); continue }
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      if (!door.def || door.def.compute.kind !== 'runtime') continue
      if (!(door.def.meta && door.def.meta.runtimeHistory === 'listing')) continue
      const plain = { ...door.def, meta: { ...door.def.meta, runtimeHistory: undefined } }
      const row = { slug: f.replace(/\.pine$/, '').split('__')[0], objects: door.def.compute.objects === true, runs: [] }
      for (const L of lengths) {
        const bars = toBars(L.rows)
        const ctx = { tf: L.tf, newestBarIsForming: false }
        const r = { length: L.name }
        for (const shift of [250, 1000]) {
          try {
            const a = computeRuntimeColumns(plain, bars, ctx, { budgetMs: 600000 })
            const b = computeRuntimeColumns(plain, bars.slice(shift), ctx, { budgetMs: 600000 })
            const c = convergedFrom(a, b, shift)
            r[`shift${shift}`] = c === null ? 'never' : { from: c, warmupBars: c - shift }
          } catch (e) { r[`shift${shift}`] = `error ${e.guard || e.name}` }
        }
        row.runs.push(r)
      }
      out.push(row)
    }
    expect(out.length).toBeGreaterThanOrEqual(10)
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  }, 3600000)
})
