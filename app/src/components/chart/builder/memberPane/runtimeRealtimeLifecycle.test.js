// app/src/components/chart/builder/memberPane/runtimeRealtimeLifecycle.test.js
//
// ⭐⭐⭐ UIE PHASE 5 (M6) — THE ADVANCED INDICATOR'S LIFE, WITH REALTIME UPDATES, THROUGH
// THE BINDER'S OWN CALL (`registry.computeFor` → the runtime lane's memo → its sessions).
//
// Imported (the member door) → saved/reloaded (JSON) → customized (instance settings) →
// source revised (a new document under the same id) → reused on a second chart → a
// timeframe switch — and on the live chart, ticks on the forming bar and new bars. At
// every realtime step: the drawn columns EQUAL a clean full run of the same bars, and the
// step RESUMED (it did not re-run the history). Across a revision, a settings change or
// a timeframe switch: no state leaks (the columns equal a cold run). A formula-lane
// indicator on the same chart is untouched (the control).
// The UI halves of this life (the sheet, the dialog) are `BuilderSheet.runtimeSourceEdit
// .test.jsx`, `runtimeProductWorkflow.test.jsx` and the dialog's own tests.
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as registry from '../../engine/nativeRegistry'
import { memberPaneDefinition } from './memberPaneDefinition'
import { computeRuntimeColumns, resetRuntimeSessions } from '../../engine/runtime/runtimeColumns'

const ID = 'u_00000000rt01'
let seed = 11
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const makeBars = (n, step = 300) => {
  seed = 11
  const out = []
  let p = 100
  for (let i = 0; i < n; i += 1) {
    const c = p + (rnd() - 0.5) * 2
    out.push({ t: 1700000000 + i * step, o: p, h: Math.max(p, c) + rnd(), l: Math.min(p, c) - rnd(), c, v: 1000 + Math.round(rnd() * 300) })
    p = c
  }
  return out
}
const V1 = '//@version=5\nindicator("Live", overlay = false)\nlen = input.int(14, "Length", minval = 2, maxval = 100)\n'
  + 'var float e = na\ne := na(e) ? close : e + (close - e) / len\nfloat s = 0.0\nfor i = 0 to 4\n    s += close[i]\nplot(e, "EMA")\nplot(s / 5, "Mean")\n'
const V2 = V1.replace('e + (close - e) / len', 'e + 2 * (close - e) / (len + 1)')
const mint = (src) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const b = memberPaneDefinition({ source: src, id: ID })
  expect(b.ok, b.reason).toBe(true)
  expect(b.lane).toBe('runtime')
  return JSON.parse(JSON.stringify(b.definition))   // saved, and reloaded
}
const install = (doc) => {
  registry.uninstallUserDefinition(ID)
  const { installed, errors } = registry.installUserDefinitions([doc])
  expect(errors).toEqual([])
  return installed[0]
}
const full = (def, bars, inputs, ctx) => {
  // a clean full run, as the registry would compute it with no session
  const values = {}
  for (const spec of def.inputs || []) if (inputs && inputs[spec.key] !== undefined && inputs[spec.key] !== spec.default) values[spec.key] = inputs[spec.key]
  return computeRuntimeColumns(def, bars, { ...ctx, ...(Object.keys(values).length ? { runtimeInputs: values } : {}) }, { incremental: false })
}
const same = (a, b, keys, at) => { for (const k of keys) expect(Array.from(a[k]), `${at} ${k}`).toEqual(Array.from(b[k])) }
afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs(); resetRuntimeSessions() })

describe('⭐⭐⭐ realtime on a live chart: every step equals a full run, and resumes', () => {
  it('import → customize → ticks and new bars → revise the source → reuse → switch timeframe', () => {
    resetRuntimeSessions()
    let def = install(mint(V1))
    const keys = def.plots.filter((p) => !p.hidden).map((p) => p.key)
    const ctx = { tf: '5', newestBarIsForming: true }
    const inputs = { len: 20 }
    const all = makeBars(3200)
    let bars = all.slice(0, 3000)
    let cols = registry.computeFor(def, bars, inputs, ctx)
    same(cols, full(def, bars, inputs, ctx), keys, 'first load')

    // ── realtime: three ticks per bar, five bars ──
    const resumedSteps = []
    for (let b = 0; b < 5; b += 1) {
      for (let t = 0; t < 3; t += 1) {
        const last = bars[bars.length - 1]
        const c = last.c + (rnd() - 0.5)
        bars = [...bars.slice(0, -1), { ...last, c, h: Math.max(last.h, c), l: Math.min(last.l, c) }]
        cols = registry.computeFor(def, bars, inputs, ctx)
        same(cols, full(def, bars, inputs, ctx), keys, `bar ${b} tick ${t}`)
        resumedSteps.push(probeResumed(def, bars, inputs, ctx))
      }
      bars = [...bars, { ...all[3000 + b], o: bars[bars.length - 1].c }]
      cols = registry.computeFor(def, bars, inputs, ctx)
      same(cols, full(def, bars, inputs, ctx), keys, `bar ${b} opens`)
    }
    expect(resumedSteps.every(Boolean), 'every tick resumed').toBe(true)

    // ── a settings change: no state carried from the other settings ──
    const len30 = registry.computeFor(def, bars, { len: 30 }, ctx)
    same(len30, full(def, bars, { len: 30 }, ctx), keys, 'settings changed')

    // ── the source is revised (same id): no state carried from the old script ──
    def = install(mint(V2))
    const revised = registry.computeFor(def, bars, inputs, ctx)
    same(revised, full(def, bars, inputs, ctx), keys, 'revised')
    expect(Array.from(revised[keys[0]])).not.toEqual(Array.from(cols[keys[0]]))

    // ── reused on a second chart (another symbol's bars): its own state ──
    const other = makeBars(2500).map((b) => ({ ...b, c: b.c * 2, o: b.o * 2, h: b.h * 2, l: b.l * 2 }))
    const ctxB = { tf: '5', newestBarIsForming: true, symbol: { ticker: 'MSFT', exchange: 'NASDAQ' } }
    same(registry.computeFor(def, other, { len: 10 }, ctxB), full(def, other, { len: 10 }, ctxB), keys, 'second chart')
    // …and the first chart still resumes from its own
    const last = bars[bars.length - 1]
    bars = [...bars.slice(0, -1), { ...last, c: last.c + 0.1, h: Math.max(last.h, last.c + 0.1) }]
    same(registry.computeFor(def, bars, inputs, ctx), full(def, bars, inputs, ctx), keys, 'first chart again')

    // ── a timeframe switch: other bars, no state carried ──
    const hourly = makeBars(2500, 3600)
    const ctxH = { tf: '60', newestBarIsForming: true }
    same(registry.computeFor(def, hourly, inputs, ctxH), full(def, hourly, inputs, ctxH), keys, '60m')
  })

  it('⭐ CONTROL — a formula-lane indicator on the same chart draws what it always drew', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const b = memberPaneDefinition({ source: '//@version=5\nindicator("F")\nplot(ta.sma(close, 10))\n', id: 'u_00000000fm01' })
    expect(b.ok).toBe(true)
    expect(b.definition.compute.kind).not.toBe('runtime')
    const { installed } = registry.installUserDefinitions([b.definition])
    const bars = makeBars(300)
    const cols = registry.computeFor(installed[0], bars, undefined, { tf: '5', newestBarIsForming: true })
    const k = installed[0].plots[0].key
    let s = 0
    for (let i = 0; i < 10; i += 1) s += bars[200 - i].c
    expect(cols[k][200]).toBeCloseTo(s / 10, 9)
    registry.uninstallUserDefinition('u_00000000fm01')
  })
})

/** Whether the run for these bars resumes (asked of the session the registry used). */
function probeResumed(def, bars, inputs, ctx) {
  const values = {}
  for (const spec of def.inputs || []) if (inputs && inputs[spec.key] !== undefined && inputs[spec.key] !== spec.default) values[spec.key] = inputs[spec.key]
  const r = computeRuntimeColumns(def, bars, { ...ctx, ...(Object.keys(values).length ? { runtimeInputs: values } : {}) })
  return Object.getOwnPropertyDescriptor(r, '__runtimeIncremental').value.resumedFrom !== null
}
