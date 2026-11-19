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
