// AUDIT-ONLY (not committed): the C18 door, production member-pane path,
// objects-only pane ON, runtime pane OFF. One JSON per run.
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { runtimeObjectValues } from '../runtime/runtimeColumns'
import { registerObjectRuntimeValues } from '../objectColumns'
import * as registry from '../nativeRegistry'
import { createHash } from 'node:crypto'

const PROBE_LOG = []
vi.mock('../runtime/runtimeColumns', async (importOriginal) => {
  const m = await importOriginal()
  return { ...m, probeObjectRuntime: (source, specs) => {
    const v = m.probeObjectRuntime(source, specs)
    PROBE_LOG.push({ specs: (specs || []).length, ok: !!(v && v.ok), guard: v && v.refusal ? v.refusal.guard : null,
      msg: v && v.refusal ? String(v.refusal.message || '').slice(0, 160) : null, exclude: v && v.exclude ? v.exclude.length : 0 })
    return v
  } }
})

const OUT = process.env.AUDIT_C18_OUT
const REPO = path.resolve(process.cwd(), '..')
const DIRS = [
  ['committed', 'corpus/committed'],
  ['oos1', 'tests/fixtures/pine_oos'],
  ['blind', 'tests/fixtures/pine_blind'],
  ['community', 'tests/fixtures/pine_community'],
  ['curated', 'tests/fixtures/pine'],
]
const SYMBOL = Object.freeze({ ticker: 'SPY', exchange: 'NYSE Arca' })
const SYNTH = Array.from({ length: 400 }, (_, i) => ({
  t: 1_700_000_000 + i * 86400,
  o: 100 + Math.sin(i / 9) * 3,
  h: 104 + Math.sin(i / 9) * 3 + (i % 5) * 0.3,
  l: 96 + Math.sin(i / 9) * 3 - (i % 3) * 0.4,
  c: 100 + Math.sin(i / 7) * 4,
  v: 40_000_000 + i * 13_000 + (i % 7) * 900_000,
}))
const AGEN = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/agen-1d-bars-2000-2026-09-13.json'), 'utf8')).bars.slice(-600)
const CONFIGS = [
  ['synth-listing', SYNTH, true],
  ['synth-offlisting', SYNTH, false],
  ['agen600-listing', AGEN, true],
]

const r = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? Number(v.toPrecision(10)) : String(v)) : v)
function canon(x, depth = 0) {
  if (depth > 12) return '[deep]'
  if (x === null || x === undefined) return x ?? null
  if (typeof x === 'number') return r(x)
  if (typeof x === 'function') return undefined
  if (x instanceof Map) return canon(Object.fromEntries(x), depth + 1)
  if (x instanceof Set) return canon([...x], depth + 1)
  if (ArrayBuffer.isView(x)) return Array.from(x, r)
  if (Array.isArray(x)) return x.map((e) => canon(e, depth + 1))
  if (typeof x === 'object') {
    const o = {}
    for (const k of Object.keys(x).sort()) { const v = canon(x[k], depth + 1); if (v !== undefined) o[k] = v }
    return o
  }
  return x
}

describe.skipIf(!OUT)('audit c18', () => {
  it('runs', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    if (process.env.AUDIT_C18_NORT === '1') registerObjectRuntimeValues(null)
    const rows = {}
    let n = 0
    for (const [cname, dir] of DIRS) {
      const d = path.join(REPO, dir)
      if (!fs.existsSync(d)) continue
      for (const f of fs.readdirSync(d).filter((x) => /\.(pine|txt)$/i.test(x)).sort()) {
        n += 1
        if (process.env.AUDIT_C18_ONLY && !f.includes(process.env.AUDIT_C18_ONLY)) continue
        if (process.env.AUDIT_C18_LIMIT && n > Number(process.env.AUDIT_C18_LIMIT)) break
        const key = `${cname}/${f}`
        const source = fs.readFileSync(path.join(d, f), 'utf8')
        const row = {}
        let built
        const t0 = Date.now()
        PROBE_LOG.length = 0
        try { built = memberPaneDefinition({ source, id: 'u_audit', name: 'A' }) } catch (e) {
          rows[key] = { threw: String(e && e.message) }; continue
        }
        row.ms = Date.now() - t0
        row.probes = PROBE_LOG.slice()
        row.ok = built.ok === true
        row.guard = built.guard || null
        const t = built.translation || {}
        const rt = t.objects && t.objects.runtime
        row.translationRuntime = rt ? { at: (rt.at || []).length } : null
        const def = built.definition
        const prog = def && def.objects
        row.docObjects = !!(prog && prog.ops && prog.ops.length)
        row.docRuntime = prog && prog.runtime ? (prog.runtime.at || []).length : 0
        row.cfg = {}
        // ⭐ PLOT LANE (plotvar extension): each output's refusal guard, and each
        // bound column per config, hashed (and its last finite value).
        row.outputs = (t.outputs || []).map((o) => (o && o.refusal ? `R:${o.refusal.guard}` : 'ok'))
        row.plots = {}
        if (row.ok && def && def.compute) {
          let installedDef = null
          try {
            const inst = registry.installUserDefinitions([def])
            installedDef = inst.installed && inst.installed[0]
            if (!installedDef) row.plots.install = (inst.errors || []).join(' | ').slice(0, 200)
            for (const [cfg, bars, listing] of (installedDef ? CONFIGS : [])) {
              const pc = {}
              try {
                const cols = registry.computeFor(installedDef, bars, undefined, { tf: 'D', symbol: SYMBOL, newestBarIsForming: false,
                  ...(listing ? { historyFromListing: true } : {}) })
                const errs = registry.columnErrors(cols) || {}
                for (const [k, c] of Object.entries(cols || {})) {
                  if (!c || typeof c.length !== 'number') continue
                  const arr = Array.from(c, r)
                  let lastV = null
                  for (let i = arr.length - 1; i >= 0; i -= 1) if (typeof arr[i] === 'number') { lastV = arr[i]; break }
                  pc[k] = { h: createHash('sha1').update(JSON.stringify(arr)).digest('hex').slice(0, 16), last: lastV }
                }
                for (const [k, e] of Object.entries(errs)) pc[k] = { ...(pc[k] || {}), err: `${e.guard}: ${String(e.message || '').slice(0, 140)}` }
              } catch (e) { pc.threw = String(e && e.message).slice(0, 200) }
              row.plots[cfg] = pc
            }
          } catch (e) { row.plots.threw = String(e && e.message).slice(0, 200) } finally {
            try { registry.uninstallUserDefinition(installedDef ? installedDef.id : 'u_audit') } catch { /* nothing installed */ }
          }
        }
        if (row.ok && row.docObjects) {
          for (const [cfg, bars, listing] of CONFIGS) {
            const out = {}
            try {
              const reader = objectReaderFor(def, bars, {
                inputs: undefined, tf: 'D', symbol: SYMBOL, newestBarIsForming: false,
                ...(listing ? { historyFromListing: true } : {}),
              })
              if (!reader) { out.reader = null } else {
                if (prog.runtime) {
                  const v = runtimeObjectValues(prog.runtime, bars, {
                    tf: 'D', symbol: SYMBOL, newestBarIsForming: false,
                    fromListing: reader.historyFromListing === true, atDefaults: true,
                  })
                  out.rtServed = v.served
                  out.rtReason = v.reason
                }
                const run = evaluateObjects(reader.program, {
                  barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime,
                  readUnknown: reader.readUnknown, offListing: reader.historyFromListing !== true,
                })
                const state = toRenderState(run.live, { bars, tf: 'D', pineVersion: reader.program.pineVersion })
                out.failed = (reader.failed || []).length
                out.state = canon(state)
              }
            } catch (e) { out.threw = String(e && e.message).slice(0, 300) }
            row.cfg[cfg] = out
          }
        }
        rows[key] = row
      }
    }
    if (!process.env.AUDIT_C18_LIMIT) expect(n).toBeGreaterThan(300)
    fs.writeFileSync(OUT, JSON.stringify(rows))
  }, 14_000_000)
})
