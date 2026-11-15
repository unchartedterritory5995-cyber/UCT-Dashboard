// SCRATCH (landing train 1 measurement, never committed): the four doors and the member
// door's served columns on the NYSE:RDDT 1D listing bars, on and off the listing, per lane.
//   TRAIN_LANE=0  production: objects-only pane armed, runtime pane DARK
//   TRAIN_LANE=1  runtime-on: both panes on, every runtime script and run half admitted
// TRAIN_IN = sources.json, TRAIN_OUT = output json. Imports point at the train worktree, which
// is checked out at the base ("before") or at the train head ("after").
import { it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { translatePine } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/ast/pine.js'
import { buildRuntimeIr } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/ast/pineRuntimeFrontend.js'
import { memberPaneDefinition } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/builder/memberPane/memberPaneDefinition'
import * as registry from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/nativeRegistry'
import { __permitRuntimePaneForTests } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/runtimeKill'
import { __admitEveryRunHalfForTests } from 'C:/Users/Patrick/uct-worktrees/train-1/app/src/components/chart/engine/runHalfRailSeam'

const APP = 'C:/Users/Patrick/uct-worktrees/train-1/app'
const flagOf = (rel) => (fs.readFileSync(path.join(APP, rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const LANE = process.env.TRAIN_LANE === '1' ? 1 : 0
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), LANE === 1 ? '1' : '')
if (LANE === 1) {
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  __admitEveryRunHalfForTests()
}

const RDDT = JSON.parse(fs.readFileSync(process.env.TRAIN_BARS, 'utf8'))
  .bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }))
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
const h = (x) => crypto.createHash('sha256').update(JSON.stringify(x) || '').digest('hex').slice(0, 16)
const refusalOf = (t) => (t && !t.ok) ? (t.refusal || ((t.outputs || []).find((o) => o && o.refusal) || {}).refusal || { guard: '?' }) : null
const sig = (t) => h(((t && t.outputs) || []).map((o) => [o && o.kind, o && o.formula, o && o.refusal && o.refusal.guard]))
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])
const num = (x) => (Number.isFinite(x) ? Number(x.toPrecision(12)) : null)

async function served(def, ctx) {
  let cols = registry.computeFor(def, RDDT, undefined, ctx)
  if (cols && typeof cols.then === 'function') cols = await withTimeout(cols, 30000)
  if (!cols || typeof cols !== 'object') return { err: 'no columns' }
  const plots = (def.plots || []).filter((p) => p && typeof p.key === 'string')
  const per = {}
  for (const p of plots) {
    const a = cols[p.key]
    if (!a || typeof a.length !== 'number') { per[p.key] = { missing: true }; continue }
    let drawn = 0
    const vals = []
    for (let i = 0; i < a.length; i++) { const v = num(a[i]); if (v !== null) drawn += 1; vals.push(v) }
    per[p.key] = { drawn, len: a.length, sig: h(vals) }
  }
  let clock = []
  try { const c = registry.chartClockReport(cols); clock = c ? c.withheld.map((w) => `${w.code}:${(w.plots || []).length}`) : [] } catch (e) { clock = ['ERR'] }
  let colErr = 0
  try { const e = registry.columnErrors(cols); colErr = e ? Object.keys(e).length : 0 } catch (e) { colErr = -1 }
  return { per, clock, colErr }
}

it('train census', async () => {
  const src = JSON.parse(fs.readFileSync(process.env.TRAIN_IN, 'utf8'))
  const out = []
  for (const s of src) {
    const row = { key: s.key, set: s.set, sha: s.sha }
    const g = (fn) => { try { return fn() } catch (e) { return { threw: String(e && e.message).slice(0, 120) } } }
    const sc = g(() => translatePine(s.text))
    const pa = g(() => translatePine(s.text, { strict: true }))
    const rt = g(() => buildRuntimeIr(s.text, { bars: RDDT, inputs: {}, pane: true, historyFromListing: true }))
    const dr = g(() => memberPaneDefinition({ source: s.text, id: 'u_train', name: 'train' }))
    const gr = (r) => (r ? r.guard : 'OK')
    row.screen = sc.threw ? 'THREW' : gr(refusalOf(sc)); row.screenSig = sc.threw ? null : sig(sc)
    row.pane = pa.threw ? 'THREW' : gr(refusalOf(pa)); row.paneSig = pa.threw ? null : sig(pa)
    row.runtime = rt.threw ? 'THREW' : (rt.ok ? 'OK' : (rt.refusal ? rt.refusal.guard : '?'))
    row.door = dr.threw ? 'THREW' : (dr.ok ? 'OK' : dr.guard)
    row.doorMsg = dr && !dr.ok && !dr.threw ? String(dr.message || dr.reason || '').slice(0, 160) : null
    row.doorKind = dr && dr.ok && dr.definition ? (dr.definition.compute || {}).kind : null
    // the engine identity is dropped from the digest: it moves on every bump by design
    row.doorSig = dr && dr.ok ? crypto.createHash('sha256').update(JSON.stringify(dr.definition || null,
      (k, v) => (/engineVersion|^engine$|scriptEngine/i.test(k) ? undefined : v)) || '').digest('hex').slice(0, 16) : null
    if (dr && dr.ok && dr.definition) {
      try { row.on = await served(dr.definition, CTX) } catch (e) { row.on = { err: String(e && e.message).slice(0, 80) } }
      try { row.off = await served(dr.definition, { ...CTX, historyFromListing: false }) } catch (e) { row.off = { err: String(e && e.message).slice(0, 80) } }
    }
    out.push(row)
  }
  fs.writeFileSync(process.env.TRAIN_OUT, JSON.stringify(out))
})
