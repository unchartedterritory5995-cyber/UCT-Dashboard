// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.rt4ObjectsWithRun.test.js
//
// ─── ⭐⭐ RT4 — A RUNTIME DOCUMENT'S DRAWINGS GO WITH ITS RUN ─────────────────────
//
// Integrator ruling (RT4, on RT2's report): a runtime-lane document must NOT draw
// the host object program it carries when its own run computes nothing. RT2
// measured the defect on the committed harness dir with the runtime flag on:
// both `vw-int-array-avg` probes reach a runtime document, every line is withheld
// (`runtime:history-start` — the capture does not start at the listing), and the
// objects row graded DIVERGE (labels 25 vendor vs 1 ours, lines 6 vs 0) for a
// drawing the pane put up ALONE.
//
//   · both captures: the objects row is no longer DIVERGE and did not become
//     MATCH — it is INCONCLUSIVE, withheld BY NAME (`runtime:objects-without-run`);
//   · the gate is one function (`nativeRegistry.runtimeObjectsWithheld`) the
//     binder and this harness both call;
//   · CONTROL: on the same document, a run that computes (the listing fact
//     stated) opens the gate, and a host-lane document is never gated.

import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'
import { createBinder } from '../../binder'
import { addInstance } from '../../instanceControls'
import { mergeChartSettings } from '../../../chartDefaults'
import { createFakeChart } from '../fakeChart'

const REPO = path.resolve(process.cwd(), '..')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const FLAG = 'VITE_PINE_RUNTIME_PANE_ENABLED'
const OBJECTS = 'VITE_PINE_OBJECTS_ONLY_PANE_ENABLED'
const DEF_ID = 'u_member-pane-rt4'
const PROBES = ['vw-int-array-avg-spy-1d-2026-09-30.json', 'vw-int-array-avg-neg-spy-1d-2026-10-01.json']

const capture = (name) => {
  const loaded = loadCapture(path.join(HARNESS, name))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
const on = () => { vi.stubEnv(OBJECTS, '1'); vi.stubEnv(FLAG, '1') }

afterEach(() => {
  registry.uninstallUserDefinition(DEF_ID)
  vi.unstubAllEnvs()
})

describe('RT4 — the object program is not drawn without the run', () => {
  // ⭐ WS-E (2026-10-31) — both probes' HOST object program is PARTIAL (30 of 31
  // drawing ops dropped: drawings under a guard on `var` state), so the runtime
  // document now takes its drawings from its OWN run (`runtimeObjectsDoor.js`)
  // instead of carrying the host program. RT4's rule — no drawing without the run,
  // never DIVERGE or MATCH for a drawing the pane would put up alone — is asserted
  // on that route here; the host-program gate (`runtimeObjectsWithheld`) is held
  // below on a runtime document whose host program is CLEAN and so still carried.
  it.each(PROBES)('%s: the document is a runtime document whose drawings are its RUN\'s (non-vacuity)', (name) => {
    const cap = capture(name)
    on()
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    expect(built.definition.compute.objects).toBe(true)
    expect(built.definition.objects).toBeFalsy()
    expect(cap.history && cap.history.startsAtBar0).not.toBe(true)
  })

  it.each(PROBES)('⭐⭐ %s: its objects row is withheld by name — not DIVERGE, not MATCH', (name) => {
    const cap = capture(name)
    on()
    const { verdict } = gradeCapture(cap)
    expect(verdict.objects, 'the capture records objects, so a row exists').toBeTruthy()
    expect(verdict.objects.verdict).toBe('INCONCLUSIVE')
    expect(verdict.objects.reason).toContain('the run drew nothing')
    // UIE Phase 2: off the listing the run is tried behind its warm-up curtain; these
    // probes plot `bar_index` (their CONTROL row), which never forgets its first bar
    expect(verdict.objects.reason).toContain('runtime:warmup-never-converges')
    expect(verdict.verdict).not.toBe('DIVERGE')
    expect(verdict.verdict).not.toBe('MATCH')
    // and every plot is what it was: not compared, the run computed nothing
    for (const p of verdict.plots) expect(p.verdict, p.title).toBe('INCONCLUSIVE')
  })

  it('⭐ CONTROL: a runtime document CARRYING a clean host program is gated until its run computes', () => {
    on()
    const src = '//@version=6\nindicator("t", overlay = true)\nvar float acc = 0\nacc += close\nplot(acc)\n'
      + 'if bar_index % 50 == 0\n    label.new(bar_index, close, "x")\n'
    const built = memberPaneDefinition({ source: src, id: DEF_ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    const def = built.definition
    expect(def.objects && def.objects.ops.length).toBeGreaterThan(0)
    // nothing computed at all (a run in flight, or a run that refused) is withheld ...
    const why = registry.runtimeObjectsWithheld(def, undefined)
    expect(why && why.guard).toBe(registry.RUNTIME_OBJECTS_GUARD)
    expect(registry.runtimeObjectsWithheld(def, {})).toBeTruthy()
    // ... and a run that computed its columns draws its objects
    const bars = Array.from({ length: 120 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100 + i, h: 101 + i, l: 99 + i, c: 100 + i, v: 1000 }))
    const cols = computeRuntimeColumns(def, bars, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
    expect(Object.keys(cols).length).toBeGreaterThan(0)
    expect(registry.runtimeObjectsWithheld(def, cols)).toBeNull()
  })

  it('⭐ CONTROL: a host-lane document, or a runtime one with no drawings, is never gated', () => {
    expect(registry.runtimeObjectsWithheld({ compute: { kind: 'ast' }, objects: { ops: [{}] } }, undefined)).toBeNull()
    expect(registry.runtimeObjectsWithheld({ compute: { kind: 'runtime', outputs: { a: 0 } }, objects: null }, undefined)).toBeNull()
    expect(registry.runtimeObjectsWithheld({ compute: { kind: 'runtime', outputs: { a: 0 } }, objects: { ops: [] } }, undefined)).toBeNull()
  })
})

describe('RT4 — and the CHART binding asks the same gate', () => {
  /** What the binder hands the object layer for this document over the capture's
   *  bars: `undefined` = never set, `null` = cleared, else the render state. */
  const layerState = (listing) => {
    const cap = capture(PROBES[0])
    on()
    const built = memberPaneDefinition({ source: cap.source.text, id: DEF_ID })
    expect(built.lane).toBe('runtime')
    const { installed, errors } = registry.installUserDefinitions([built.definition])
    expect(errors).toEqual([])
    const def = installed[0]
    const bars = toProductBars(cap)
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
    let state
    binder.sync({
      enabled: true, cs, instances, registry, bars, tf: 'D',
      symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false,
      ...(listing ? { historyFromListing: true } : {}),
      adjustTime: (t) => t,
      applyData: (series, data) => series.setData(data),
      plan: { fresh: true },
      resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
      createObjectLayer: () => ({ set: (st) => { state = st }, clear: () => {} }),
    })
    binder.teardown()
    return state
  }

  it('⭐⭐ the run computed nothing on this chart → the layer is cleared, not drawn', () => {
    expect(layerState(false)).toBeNull()
  })

  it('⭐ CONTROL: the run computes (listing stated) → the same layer is drawn', () => {
    const st = layerState(true)
    expect(st).toBeTruthy()
    expect(st.labels.length).toBeGreaterThan(0)
  })
})
