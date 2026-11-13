// app/src/components/chart/builder/memberPane/runHalf.test.jsx
//
// ─── ⭐⭐ ENGINE 53 — THE RUN HALF: DOOR, BIND AND CHART ──────────────────────────────
//
// A host-OK script whose object program lost drawings (`objectLoss` verdict `partial`)
// gets `compute.runtimeObjects` on its `ast` document (`hostPartialRunHalf`), and the
// chart draws the run's drawings ONLY where every gate passes on every run and the run's
// columns equal the host's (`nativeRegistry.js::withRunHalf`). Otherwise the host picture.
// Pending draws an empty object layer, never the host picture then a swap; never both.
//
// The script below plots two lines and, on its last bar, draws one line (the host program
// carries it) and labels each of the five newest bars that closed up — from inside a loop
// the host object program cannot follow (it loses the label: `partial`), and which the
// per-bar run executes as Pine does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { createBinder } from '../../engine/binder'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { validateDefinition } from '../../engine/defSchema'
import { assessObjectLoss, RUN_HALF_DRAWING_SENTENCE, runHalfRefusedSentence } from '../../engine/ast/objectLoss'
import { runHalfOf, runtimeObjectsOf, RUNTIME_OBJECTS_KEY, carriesRunHalf } from '../../engine/runtime/runtimeObjects'
import { runtimeColumnsFor } from '../../engine/runtime/runtimeColumns'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../engine/runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, setRuntimeAllowList, setRuntimeKillList, runtimeSourceHash,
} from '../../engine/runtimeKill'
import { resetObjectRenderDrops } from '../../engine/objectRenderNotice'
import AttachedPineDisclosures from '../../pane/AttachedPineDisclosures'
import { RUN_HALF_SOURCE_STAMP } from './memberPaneDefinition'
import { storedBytesOf } from './storedBytes'
import { DOCUMENT_BYTE_BUDGET } from '../../engine/ast/graphDocument'

const LF = String.fromCharCode(10)
const SRC = ['//@version=5', 'indicator("run half", overlay = true)', 'len = input.int(5, "len")',
  'm = ta.sma(close, len)', 'plot(m, "m")', 'plot(m * 2, "m2")', 'if barstate.islast',
  '    line.new(bar_index - 1, low, bar_index, high)', '    for i = 0 to 4',
  '        if close[i] > open[i]', '            label.new(bar_index - i, high[i], "up")'].join(LF)
// ⛔ CONTROL: the same plots and a label the host program carries — a clean drawing.
const CLEAN = ['//@version=5', 'indicator("clean", overlay = true)', 'm = ta.sma(close, 5)', 'plot(m, "m")',
  'if barstate.islast', '    label.new(bar_index, high, "up")'].join(LF)

const BARS = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 8 * Math.sin(i / 9) + i * 0.02
  return { t: 1420156800 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1e6 }
})
const CTX = Object.freeze({ tf: 'D', symbol: { ticker: 'SPY', exchange: 'AMEX' }, newestBarIsForming: false, historyFromListing: true })
const GUARD_TOKEN = /\b(pane|runtime|run-half|interpret|pine):[a-z]/

let seq = 0
const door = (source = SRC, opts = {}) => memberPaneDefinition({ source, name: 'rh', ...opts, id: opts.id || `u_member-pane-rh${++seq}` })
function install(def) {
  const { installed, errors } = registry.installUserDefinitions([def])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return installed[0]
}
const bind = (def, inputs, ctx = CTX) => registry.computeFor(def, BARS, inputs, ctx)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
})
afterEach(() => {
  cleanup()
  resetObjectRenderDrops()
  setRuntimeKillList([])
  registry.registerRuntimeLane(runtimeColumnsFor)
  for (const d of registry.listDefinitions ? registry.listDefinitions() : []) {
    if (d && typeof d.id === 'string' && d.id.startsWith('u_member-pane-rh')) registry.uninstallUserDefinition(d.id)
  }
  vi.unstubAllEnvs()
})

describe('⭐⭐ the door mints a run half for a host-partial script', () => {
  it('the fixture IS host-partial: plots drawn, the loop label lost by the host program', () => {
    const d = door(SRC, { routeHostPartial: false })
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBeUndefined()
    expect(assessObjectLoss(d.translation).verdict).toBe('partial')
  })

  it('mints compute.runtimeObjects on the ast document, the host program kept as the fallback', () => {
    const d = door()
    expect(d.ok, d.reason).toBe(true)
    expect(d.runHalf).toEqual({ minted: true, columns: 2 })
    const c = d.definition.compute
    expect(c.kind).toBe('ast')
    expect(c.runtimeObjects.source).toBe(SRC)
    expect(Object.keys(c.runtimeObjects.outputs).sort()).toEqual(['out2', 'value'])
    expect(c.runtimeObjects.runtimeLanguage).toBe('pine')
    expect(Array.isArray(c.runtimeObjects.runtimeOutputSignature)).toBe(true)
    expect(d.definition.objects).toBeTruthy()
    const note = d.definition.meta.disclosures.find((n) => n.note.includes(RUN_HALF_DRAWING_SENTENCE))
    expect(note, 'the drawing note says where the drawings may come from').toBeTruthy()
    const v = validateDefinition(d.definition)
    expect(v.ok, (v.errors || []).join(' | ')).toBe(true)
  })

  it('⛔ declined, the document is byte-identical to the door that never asks (routeHostPartial: false)', () => {
    const id = 'u_member-pane-rhsame'
    const base = JSON.stringify(door(SRC, { id, routeHostPartial: false }).definition)
    setRuntimeKillList([runtimeSourceHash(SRC)])
    const killed = door(SRC, { id })
    expect(killed.runHalfDeclined.code).toBe('runtime:killed')
    expect(JSON.stringify(killed.definition)).toBe(base)
    setRuntimeKillList([])
    setRuntimeAllowList([])
    const ungraded = door(SRC, { id })
    expect(ungraded.runHalfDeclined.code).toBe('runtime:not-yet-graded')
    expect(JSON.stringify(ungraded.definition)).toBe(base)
  })

  it('⛔ the runtime pane off (every member without the stage): no run half, byte-identical', () => {
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const id = 'u_member-pane-rhoff'
    const off = door(SRC, { id })
    expect(off.runHalfDeclined.code).toBe('run-half:pane-off')
    expect(JSON.stringify(off.definition)).toBe(JSON.stringify(door(SRC, { id, routeHostPartial: false }).definition))
    expect(JSON.stringify(off.definition)).not.toContain('runtimeObjects')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __resetRuntimePanePermission()
    const unlatched = door()
    expect(unlatched.runHalfDeclined.code).toBe('run-half:pane-off')
    expect(unlatched.definition.compute.runtimeObjects).toBeUndefined()
  })

  it('⛔ CONTROL — a clean drawing is never routed: no run half, no decline, byte-identical', () => {
    const id = 'u_member-pane-rhclean'
    const d = door(CLEAN, { id })
    expect(d.ok, d.reason).toBe(true)
    expect(assessObjectLoss(d.translation).verdict).toBe('clean')
    expect(d.runHalf).toBeUndefined()
    expect(d.runHalfDeclined).toBeUndefined()
    expect(JSON.stringify(d.definition)).toBe(JSON.stringify(door(CLEAN, { id, routeHostPartial: false }).definition))
  })

  it('⛔ a document the run half would push past the store\'s 64 KiB is not minted', () => {
    const pad = `// ${'x'.repeat(70000)}`
    const d = door(`${SRC}${LF}${pad}${LF}`)
    expect(d.ok, d.reason).toBe(true)
    expect(d.runHalfDeclined && d.runHalfDeclined.code).toBe('run-half:size')
    expect(d.definition.compute.runtimeObjects).toBeUndefined()
  })

  it('⛔ at the border the door counts the FINISHED document as the store will (never mint, then fail to save)', () => {
    const withPad = (n) => `${SRC}${LF}// ${'x'.repeat(n)}${LF}`
    const id = 'u_member-pane-rhborder'
    // the largest comment for which the run half is still minted
    let lo = 0
    let hi = 66000
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (door(withPad(mid), { id }).runHalf) lo = mid; else hi = mid
    }
    const minted = door(withPad(lo), { id })
    expect(minted.runHalf).toBeTruthy()
    const bytes = storedBytesOf(minted.definition)
    expect(bytes).toBeLessThanOrEqual(DOCUMENT_BYTE_BUDGET)
    expect(bytes, 'a borderline document, not a small one').toBeGreaterThan(DOCUMENT_BYTE_BUDGET - 64)
    const over = door(withPad(hi), { id })
    expect(over.runHalfDeclined && over.runHalfDeclined.code).toBe('run-half:size')
    expect(JSON.stringify(over.definition)).toBe(JSON.stringify(door(withPad(hi), { id, routeHostPartial: false }).definition))
    expect(over.notes).toEqual(door(withPad(hi), { id, routeHostPartial: false }).notes)
  })
})

describe('⛔⛔ the run half runs the document\'s OWN script (review 1)', () => {
  const FOREIGN = CLEAN
  it('the door stamps the script it translated', () => {
    const d = door()
    expect(d.definition.meta[RUN_HALF_SOURCE_STAMP]).toBe(runtimeSourceHash(SRC))
    const declined = door(SRC, { routeHostPartial: false })
    expect(declined.definition.meta[RUN_HALF_SOURCE_STAMP]).toBeUndefined()
  })

  it('FORGED: another script\'s run half on this document is refused at the bind, nothing drawn from it', () => {
    const minted = door().definition
    const forged = JSON.parse(JSON.stringify(minted))
    forged.id = `${minted.id}f`
    forged.compute.runtimeObjects = { source: FOREIGN, outputs: {} }
    const def = install(forged)
    const cols = bind(def)
    expect(runHalfOf(cols)).toEqual({ state: 'refused', code: 'run-half:source-unbound' })
    expect(runtimeObjectsOf(cols)).toBe(null)
  })

  it('⛔ no stamp, or a stamp naming another script: refused; CONTROL: the honest document is served', () => {
    const minted = door().definition
    const noStamp = JSON.parse(JSON.stringify(minted))
    noStamp.id = `${minted.id}n`
    delete noStamp.meta[RUN_HALF_SOURCE_STAMP]
    expect(runHalfOf(bind(install(noStamp))).code).toBe('run-half:source-unbound')
    const wrong = JSON.parse(JSON.stringify(minted))
    wrong.id = `${minted.id}w`
    wrong.meta[RUN_HALF_SOURCE_STAMP] = runtimeSourceHash(FOREIGN)
    expect(runHalfOf(bind(install(wrong))).code).toBe('run-half:source-unbound')
    expect(runHalfOf(bind(install(minted))).state).toBe('served')
  })

  it('⛔ the schema refuses a run half beside run-read colours of another script', () => {
    const minted = JSON.parse(JSON.stringify(door().definition))
    minted.compute.runtimeColours = { source: FOREIGN, at: [{ line: 3, column: 1, node: {}, kind: 'colour' }], keys: ['rtcolour1'] }
    const v = validateDefinition(minted)
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.startsWith('compute.runtimeObjects.source'))).toBe(true)
  })
})

describe('⛔ the door\'s other gates (review 2: X2, X3, X4, X8)', () => {
  it('X4: a windowed script (calc_bars_count) is declined', () => {
    const w = SRC.replace('indicator("run half", overlay = true)', 'indicator("run half", overlay = true, calc_bars_count = 100)')
    const d = door(w)
    expect(d.ok, d.reason).toBe(true)
    expect(assessObjectLoss(d.translation).verdict).toBe('partial')
    expect(d.runHalfDeclined && d.runHalfDeclined.code).toBe('runtime:calc-bars-count')
    expect(d.definition.compute.runtimeObjects).toBeUndefined()
  })

  it('X8: a hidden row is never mapped into the column rail', () => {
    const h = SRC.replace('plot(m * 2, "m2")', 'plot(m * 2, "m2")\nplot(m * 3, "anchor", display = display.none)')
    const d = door(h)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toEqual({ minted: true, columns: 2 })
    const hiddenKeys = d.definition.plots.filter((p) => p.hidden).map((p) => p.key)
    expect(hiddenKeys.length).toBeGreaterThan(0)
    for (const k of hiddenKeys) expect(Object.keys(d.definition.compute.runtimeObjects.outputs)).not.toContain(k)
  })
})

describe('⛔ the bind\'s other gates (review 2: X5, X7)', () => {
  /** a lane answering with the host's own columns (so only the gate under test can refuse) */
  const hostEcho = (hostCols, tamper = null) => () => {
    const out = { value: Float64Array.from(hostCols.value), out2: Float64Array.from(hostCols.out2) }
    if (tamper) tamper(out)
    Object.defineProperty(out, RUNTIME_OBJECTS_KEY, { value: { status: 'ok', live: [], withheld: {} }, enumerable: false })
    return out
  }

  it('X5: the script\'s own runtime.error, reached on these bars, refuses the run half before the run is asked', () => {
    const stops = SRC.replace('plot(m, "m")', 'plot(m, "m")\nif bar_index == 250\n    runtime.error("stop here")')
    const d = door(stops)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    const def = install(d.definition)
    const host = bind(install(door(SRC).definition))
    let asked = 0
    registry.registerRuntimeLane((...a) => { asked += 1; return hostEcho(host)(...a) })
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'runtime:runtime.error' })
    expect(asked, 'the run is not asked once the host has stopped').toBe(0)
  })

  it('X7: na against a number is a disagreement, in either direction', () => {
    const def = install(door().definition)
    const host = bind(install(door(SRC, { routeHostPartial: false }).definition))
    const i = host.value.findIndex((x) => Number.isFinite(x))
    registry.registerRuntimeLane(hostEcho(host))
    expect(runHalfOf(bind(def)).state, 'CONTROL: the host\'s own columns agree').toBe('served')
    registry.registerRuntimeLane(hostEcho(host, (o) => { o.value[i + 5] = NaN }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: registry.RUN_HALF_COLUMN_RAIL })
    const j = host.out2.findIndex((x) => Number.isNaN(x))
    expect(j, 'the host has a warm-up bar').toBeGreaterThanOrEqual(0)
    registry.registerRuntimeLane(hostEcho(host, (o) => { o.out2[j] = 1 }))
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: registry.RUN_HALF_COLUMN_RAIL })
  })
})

describe('⛔ a refused run half over a host picture with no drawings still says why (review 3)', () => {
  // the original fixture: the host program loses EVERY drawing (`definition.objects` is null)
  const SRC0 = SRC.replace(`${LF}    line.new(bar_index - 1, low, bar_index, high)`, '')
  it('the member reads the refusal sentence, and a layer the run drew before is emptied', () => {
    const d = door(SRC0)
    expect(d.runHalf, JSON.stringify(d.runHalfDeclined)).toBeTruthy()
    expect(d.definition.objects).toBeFalsy()
    const def = install(d.definition)
    const fakeChart = createFakeChart()
    const binder = createBinder({ chart: fakeChart.chart, LWC: fakeChart.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((x) => x.defId === def.id)
    const states = []
    const sync = () => binder.sync({
      enabled: true, cs, instances, registry, bars: BARS, tf: 'D', symbol: CTX.symbol, newestBarIsForming: false,
      historyFromListing: true, adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: (state) => { states.push(state) }, clear: () => { states.push(null) } }),
    })
    sync()
    expect(states[states.length - 1] && states[states.length - 1].labels.length).toBe(5)
    setRuntimeAllowList([])
    sync()
    expect(states[states.length - 1]).toBe(null)
    render(<AttachedPineDisclosures settings={cs} registry={registry} />)
    const t = screen.queryByTestId('pine-attached-disclosures')?.textContent || ''
    expect(t).toContain(runHalfRefusedSentence('pane:not-graded'))
    expect(t).not.toMatch(GUARD_TOKEN)
    binder.teardown()
  })
})

describe('⭐⭐ the bind draws the run\'s drawings only where every gate passes', () => {
  it('served: the run\'s labels ride beside the host columns, which are untouched', () => {
    const def = install(door().definition)
    const cols = bind(def)
    expect(runHalfOf(cols)).toEqual({ state: 'served', code: null })
    expect(runtimeObjectsOf(cols).live.filter((o) => o.family === 'label')).toHaveLength(5)
    expect(Object.keys(cols)).not.toContain(RUNTIME_OBJECTS_KEY)
    const host = install(door(SRC, { routeHostPartial: false }).definition)
    const hostCols = bind(host)
    expect(Array.from(cols.value)).toEqual(Array.from(hostCols.value))
    expect(Array.from(cols.out2)).toEqual(Array.from(hostCols.out2))
  })

  it('⛔ the kill list, at the bind (this tab\'s list AND the server\'s stamp)', () => {
    const minted = door().definition
    const def = install(minted)
    setRuntimeKillList([runtimeSourceHash(SRC)])
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'pane:killed' })
    setRuntimeKillList([])
    const stamped = install({ ...minted, id: `${minted.id}s`, meta: { ...minted.meta, runtimeKilled: 'listed' } })
    expect(runHalfOf(bind(stamped))).toEqual({ state: 'refused', code: 'pane:killed' })
  })

  it('⛔ the allowlist, at the bind (this tab\'s list AND the server\'s stamp)', () => {
    const minted = door().definition
    const def = install(minted)
    setRuntimeAllowList([])
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'pane:not-graded' })
    __allowEveryRuntimeScriptForTests()
    const stamped = install({ ...minted, id: `${minted.id}g`, meta: { ...minted.meta, runtimeNotGraded: 'not graded' } })
    expect(runHalfOf(bind(stamped))).toEqual({ state: 'refused', code: 'pane:not-graded' })
  })

  it('⛔ a revoked latch: refused on the next run, and the memo key moves with it', () => {
    const def = install(door().definition)
    const before = registry.computeSignature(def, undefined, CTX)
    expect(runHalfOf(bind(def)).state).toBe('served')
    __resetRuntimePanePermission()
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'pane:not-permitted' })
    expect(registry.computeSignature(def, undefined, CTX)).not.toBe(before)
  })

  it('⛔ a build without the runtime pane: refused', () => {
    const def = install(door().definition)
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'pane:not-built' })
  })

  it('⛔ the member moved a setting: refused (the run computes the script as written)', () => {
    const def = install(door().definition)
    const k = (def.inputs || []).find((i) => i.key === 'lineWidth')
    expect(k, 'a declared input').toBeTruthy()
    expect(runHalfOf(bind(def, { lineWidth: k.default + 2 }))).toEqual({ state: 'refused', code: 'runtime:member-inputs' })
    expect(runHalfOf(bind(def, { lineWidth: k.default })).state, 'CONTROL: the default').toBe('served')
  })

  it('⛔⛔ THE COLUMN RAIL: a run column that is not the host\'s column refuses the drawings', () => {
    const minted = door().definition
    const { value, out2 } = minted.compute.runtimeObjects.outputs
    const swapped = JSON.parse(JSON.stringify(minted))
    swapped.id = `${minted.id}x`
    swapped.compute.runtimeObjects.outputs = { value: out2, out2: value }
    const def = install(swapped)
    expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: registry.RUN_HALF_COLUMN_RAIL })
    expect(runtimeObjectsOf(bind(def))).toBe(null)
  })

  it('⛔ no ctx (a probe that is not a chart) asks nothing of the run', () => {
    const def = install(door().definition)
    const cols = registry.computeFor(def, BARS, undefined)
    expect(runHalfOf(cols)).toBe(null)
  })

  describe('a run this lane cannot serve', () => {
    const fake = (payload) => (def, bars) => {
      const out = runtimeColumnsFor(def, bars, {}, CTX)
      const res = { ...out }
      if (payload !== undefined) Object.defineProperty(res, RUNTIME_OBJECTS_KEY, { value: payload, enumerable: false })
      return res
    }
    it('pending: a run in flight (no drawings attached yet)', () => {
      const def = install(door().definition)
      registry.registerRuntimeLane(() => ({}))
      expect(runHalfOf(bind(def))).toEqual({ state: 'pending', code: 'runtime:in-flight' })
      expect(runtimeObjectsOf(bind(def))).toBe(null)
    })
    it('⛔ a family the run withholds that the host program draws: refused', () => {
      const def = install(door().definition)
      registry.registerRuntimeLane(fake({ status: 'ok', live: [], withheld: { line: 'not measured' } }))
      expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'run-half:family-withheld' })
      registry.registerRuntimeLane(fake({ status: 'ok', live: [], withheld: { box: 'not measured' } }))
      expect(runHalfOf(bind(def)).state, 'CONTROL: a family the host does not draw').toBe('served')
    })
    it('⛔ drawings withheld whole, or a run that stopped: refused', () => {
      const def = install(door().definition)
      registry.registerRuntimeLane(fake({ status: 'WITHHELD', live: [], guard: 'runtime:history-start', reason: 'r' }))
      expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'runtime:history-start' })
      registry.registerRuntimeLane(fake({ status: 'OBJECT_UNWITNESSED', live: [], reason: 'r' }))
      expect(runHalfOf(bind(def))).toEqual({ state: 'refused', code: 'runtime:objects-stopped' })
    })
  })
})

describe('⭐⭐ the chart: one picture, never both, never host-then-swap', () => {
  function chart(def, { lane } = {}) {
    if (lane) registry.registerRuntimeLane(lane)
    const fakeChart = createFakeChart()
    const binder = createBinder({ chart: fakeChart.chart, LWC: fakeChart.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
    const states = []
    const sync = () => binder.sync({
      enabled: true, cs, instances, registry, bars: BARS, tf: 'D', symbol: CTX.symbol, newestBarIsForming: false,
      historyFromListing: true, adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: (state) => { states.push(state) }, clear: () => { states.push(null) } }),
    })
    const text = () => {
      cleanup()
      render(<AttachedPineDisclosures settings={cs} registry={registry} />)
      return screen.queryByTestId('pine-attached-disclosures')?.textContent || ''
    }
    return { binder, states, sync, text }
  }
  const labels = (s) => (s && Array.isArray(s.labels) ? s.labels.length : null)

  it('served: the run\'s five labels, set ONCE — the host program is not drawn beside them', () => {
    const def = install(door().definition)
    const c = chart(def)
    c.sync()
    expect(c.states).toHaveLength(1)
    expect(labels(c.states[0])).toBe(5)
    expect(c.states[0].lines).toHaveLength(1)
    c.binder.teardown()
  })

  it('⛔ CONTROL: the host document draws the host picture (its line, no loop labels)', () => {
    const def = install(door(SRC, { routeHostPartial: false }).definition)
    expect(carriesRunHalf(def)).toBe(false)
    const c = chart(def)
    c.sync()
    expect(labels(c.states[c.states.length - 1])).toBe(0)
    expect(c.states[c.states.length - 1].lines).toHaveLength(1)
    c.binder.teardown()
  })

  it('⛔ pending: the layer is EMPTY (never the host picture first), and a pending answer is never memoised', () => {
    const def = install(door().definition)
    let landed = false
    const c = chart(def, { lane: (d, bars, inputs, ctx) => (landed ? runtimeColumnsFor(d, bars, inputs, ctx) : {}) })
    c.sync()
    expect(c.states.every((s) => s === null), 'nothing but an empty layer while pending').toBe(true)
    landed = true
    c.sync() // the same bars and inputs: a memoised pending answer would draw nothing again
    expect(labels(c.states[c.states.length - 1])).toBe(5)
    c.binder.teardown()
  })

  it('⛔ refused: the host picture, and the member reads why — in words, never a guard token', () => {
    const def = install(door().definition)
    setRuntimeAllowList([])
    const c = chart(def)
    c.sync()
    expect(labels(c.states[c.states.length - 1])).toBe(0)
    const t = c.text()
    expect(t).toContain(runHalfRefusedSentence('pane:not-graded'))
    expect(t).not.toMatch(GUARD_TOKEN)
    c.binder.teardown()
  })

  it('⛔ a latch revoked under an open chart: the next sync draws the host picture', () => {
    const def = install(door().definition)
    const c = chart(def)
    c.sync()
    expect(labels(c.states[c.states.length - 1])).toBe(5)
    __resetRuntimePanePermission()
    c.sync()
    expect(labels(c.states[c.states.length - 1])).toBe(0)
    c.binder.teardown()
  })
})

describe('the member\'s sentences', () => {
  it('⛔ no refusal code reaches a sentence as a token', () => {
    for (const code of ['pane:not-built', 'pane:not-permitted', 'pane:killed', 'pane:not-graded', 'runtime:member-inputs',
      'runtime:runtime.error', 'runtime:history-start', 'runtime:warmup-never-converges', 'run-half:column-rail',
      'run-half:family-withheld', 'runtime:not-loaded', 'runtime:load-failed', 'runtime:request', 'runtime:limit',
      'runtime:time-budget', 'runtime:CALL_COUNT', 'interpret:bind-time-text', 'runtime:objects-stopped', 'x:y', '', null]) {
      const s = runHalfRefusedSentence(code)
      expect(s, String(code)).not.toMatch(GUARD_TOKEN)
      expect(s.startsWith('The complete set of this script\'s drawings isn\'t shown on this chart: ')).toBe(true)
    }
  })
})
