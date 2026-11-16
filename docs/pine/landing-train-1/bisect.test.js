// SCRATCH (train-1 attribution, never committed)
import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/builder/memberPane/memberPaneDefinition.js'
import { computeRuntimeColumns } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/runtime/runtimeColumns.js'
import { buildRuntimeIr } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/ast/pineRuntimeFrontend.js'
const REPO = 'C:/Users/Patrick/uct-worktrees/train-1'
const RDDT = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/harness/support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json'), 'utf8')).bars.rows
  .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}
it('bisect', () => {
  const out = {}
  for (const script of ['corpus/committed/opening-range-initial-balance-opening-price__4a7416ab01.pine', 'tests/fixtures/pine_oos/high_engagement__09-on-balance-volume-everget.pine']) {
    let b
    try { b = memberPaneDefinition({ source: fs.readFileSync(path.join(REPO, script), 'utf8'), id: 'u_member-pane-c46', enumInputs: false }) } catch (e) { b = { threw: String(e && e.message) } }
    out[script] = b && b.ok ? JSON.parse(stable(b.definition.compute)) : b
  }
  const src = '//@version=6\nindicator("e57 htf flat")\nfloat y = bar_index >= 60 and bar_index < 75 ? 1000.0 : close\nplot(request.security(syminfo.tickerid, "W", ta.stoch(close, y, y, 5)))'
  const doc = (s) => ({ id: 'e57', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:e57', outputs: { a: 0 }, source: s } })
  const guard = (s) => {
    try { computeRuntimeColumns(doc(s), RDDT, { ...CTX, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }) } catch (e) { return { guard: e.guard || 'threw', message: String(e && e.message).slice(0, 300) } }
    return 'OK'
  }
  out.f5 = { stoch: guard(src), close: guard(src.replace('ta.stoch(close, y, y, 5)', 'close')) }
  const ir = (s) => { try { const r = buildRuntimeIr(s, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true }); return r.ok ? 'OK' : r.refusal } catch (e) { return { threw: String(e && e.message).slice(0, 200) } } }
  out.f5ir = { stoch: ir(src), close: ir(src.replace('ta.stoch(close, y, y, 5)', 'close')) }
  fs.writeFileSync(process.env.TRAIN_OUT, JSON.stringify(out, null, 1))
})
