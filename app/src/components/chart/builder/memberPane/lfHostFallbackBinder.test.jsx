// ⭐⭐ PARITY UNIT LF (2026-11-18) — ON THE CHART: a runtime document whose clean host program rides beside its
// run draws the RUN's drawings, and the host program's whenever the run holds back (its drawings whole, or a
// family the program draws). The binder asks `runtime/runtimeObjects.js::drawsRunObjectsOn`, as the vendor
// harness does, so no member loses a drawing the host program showed. One picture at a time, never both.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { createBinder } from '../../engine/binder'
import { addInstance } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { runtimeColumnsFor } from '../../engine/runtime/runtimeColumns'
import { RUNTIME_OBJECTS_KEY } from '../../engine/runtime/runtimeObjects'
import { toProductBars } from '../../engine/__tests__/vendorHarness/ourSide'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'

const REPO = path.resolve(__dirname, '../../../../../..')
const SRC = fs.readFileSync(path.join(REPO, 'corpus', 'committed', 'trend-targets-algoalpha__92ff5628d7.pine'), 'utf8')
const CAP = JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', 'trend-targets-algoalpha-rddt-1d-2026-11-15.json'), 'utf8'))
const BARS = toProductBars(CAP)
const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }

afterEach(() => {
  vi.unstubAllEnvs()
  registry.registerRuntimeLane(runtimeColumnsFor)
  for (const d of registry.listDefinitions ? registry.listDefinitions() : []) {
    if (d && typeof d.id === 'string' && d.id.startsWith('u_lf-binder')) registry.uninstallUserDefinition(d.id)
  }
})

let seq = 0
function install() {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  const d = memberPaneDefinition({ source: SRC, id: `u_lf-binder${++seq}`, name: 'lf' })
  expect(d.ok, d.reason || '').toBe(true)
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return installed[0]
}
function chart(def, lane) {
  registry.registerRuntimeLane(lane)
  const fakeChart = createFakeChart()
  const binder = createBinder({ chart: fakeChart.chart, LWC: fakeChart.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const states = []
  const sync = () => binder.sync({
    enabled: true, cs, instances, registry, bars: BARS, tf: 'D', symbol: SYMBOL, newestBarIsForming: false,
    historyFromListing: true, adjustTime: (t) => t, applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
    createObjectLayer: () => ({ set: (state) => { states.push(state) }, clear: () => { states.push(null) } }),
  })
  return { binder, states, sync }
}
/** the real run, its drawings replaced by `payload` */
const laneWith = (payload) => (d, bars, inputs, ctx) => {
  const out = runtimeColumnsFor(d, bars, inputs, ctx)
  const res = { ...out }
  Object.defineProperty(res, RUNTIME_OBJECTS_KEY, { value: payload(out[RUNTIME_OBJECTS_KEY]), enumerable: false })
  return res
}
const count = (s, k) => (s && Array.isArray(s[k]) ? s[k].length : 0)

describe('⭐⭐ the chart draws the run\'s drawings, and the host program\'s when the run holds back', () => {
  it('the run draws: its 5 lines, 5 labels and 2 fills', () => {
    const def = install()
    expect(def.compute.objects).toBe(true)
    expect(def.objects).toBeTruthy()
    const c = chart(def, runtimeColumnsFor)
    c.sync()
    const s = c.states[c.states.length - 1]
    expect([count(s, 'lines'), count(s, 'labels'), count(s, 'fills')]).toEqual([5, 5, 2])
    c.binder.teardown()
  })

  it('⛔ the run withholds its drawings whole: the host program draws them (not an empty chart)', () => {
    const def = install()
    const c = chart(def, laneWith(() => ({ status: 'WITHHELD', live: [], guard: 'format:tick-unsettled', reason: 'x' })))
    c.sync()
    const s = c.states[c.states.length - 1]
    expect(count(s, 'lines') + count(s, 'labels'), 'the host program\'s drawings').toBeGreaterThan(0)
    c.binder.teardown()
  })

  it('⛔ the run holds back a family the program draws: the host program draws, never a mix', () => {
    const def = install()
    const c = chart(def, laneWith((p) => ({ ...p, live: p.live.filter((o) => o.family !== 'label'), withheld: { label: 5 } })))
    c.sync()
    const s = c.states[c.states.length - 1]
    expect(count(s, 'labels'), 'the labels the run held back are drawn by the host program').toBeGreaterThan(0)
    c.binder.teardown()
  })
})

// ⭐⭐ LF step 1 (coordinator, 2026-11-18): the host program is translated at mint with every input at its default,
// so it is the AUTHOR'S-SETTINGS picture. Measured first: inside-bar-range with `lineColor` set to #FF00FF drew the
// run's lines in it and, forced onto the fallback, the host program's lines in the author's #b2b5be. Once the member
// moves a setting of the script, the fallback is never drawn: the run's picture is, as for any run-owned document.
describe('⛔ the host program is the author\'s-settings picture: a moved setting never draws it', () => {
  const IB = 'inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat'
  const IB_SRC = fs.readFileSync(path.join(REPO, 'corpus', 'committed', `${IB}__832e485b9c.pine`), 'utf8')
  const IB_BARS = toProductBars(JSON.parse(fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness', `${IB}-rddt-1d-2026-11-15.json`), 'utf8')))
  const WITHHELD = () => ({ status: 'WITHHELD', live: [], guard: 'format:tick-unsettled', reason: 'x' })
  const lineColours = (def, lane, inputs) => {
    registry.registerRuntimeLane(lane)
    const fakeChart = createFakeChart()
    const binder = createBinder({ chart: fakeChart.chart, LWC: fakeChart.LWC })
    const cs0 = addInstance(mergeChartSettings({}), def.id, registry)
    const cs = { ...cs0, indicatorInstances: cs0.indicatorInstances.map((i) => (i.defId === def.id ? { ...i, inputs: { ...(i.inputs || {}), ...inputs } } : i)) }
    const states = []
    binder.sync({
      enabled: true, cs, instances: cs.indicatorInstances.filter((i) => i.defId === def.id), registry, bars: IB_BARS, tf: 'D',
      symbol: SYMBOL, newestBarIsForming: false, historyFromListing: true, adjustTime: (t) => t,
      applyData: (series, data) => series.setData(data), plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 0, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: (state) => { states.push(state) }, clear: () => { states.push(null) } }),
    })
    binder.teardown()
    const s = states.filter(Boolean).pop()
    return ((s && s.lines) || []).map((l) => String(l.color).toLowerCase())
  }
  const installIb = () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const d = memberPaneDefinition({ source: IB_SRC, id: `u_lf-binder${++seq}`, name: 'ib' })
    expect(d.ok, d.reason || '').toBe(true)
    const { installed } = registry.installUserDefinitions([d.definition])
    const def = installed[0]
    expect(def.compute.objects).toBe(true)
    expect(def.inputs.some((i) => i.key === 'lineColor')).toBe(true)
    return def
  }

  it('the run follows the member\'s lineColor', () => {
    const got = lineColours(installIb(), runtimeColumnsFor, { lineColor: '#FF00FF' })
    expect(got.length).toBeGreaterThan(0)
    expect(new Set(got)).toEqual(new Set(['#ff00ff']))
  })

  it('CONTROL: at the author\'s settings a run withheld whole draws the host program (its #b2b5be lines)', () => {
    const got = lineColours(installIb(), laneWith(WITHHELD), {})
    expect(got.length).toBeGreaterThan(0)
    expect(new Set(got)).toEqual(new Set(['#b2b5be']))
  })

  it('⛔ lineColor moved, the run withheld whole: no line in the author\'s colour (the host program is not drawn)', () => {
    const got = lineColours(installIb(), laneWith(WITHHELD), { lineColor: '#FF00FF' })
    expect(got).toEqual([])
  })

  it('a Style knob is not a setting of the script: a moved plot colour keeps the fallback', () => {
    const got = lineColours(installIb(), laneWith(WITHHELD), { color: '#123456' })
    expect(new Set(got)).toEqual(new Set(['#b2b5be']))
  })
})
