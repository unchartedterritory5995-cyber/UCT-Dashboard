// app/src/components/chart/engine/__tests__/objectBarstateTriState.test.js
//
// ─── ⭐⭐ THE OBJECT LANE HEARS WHETHER THE NEWEST BAR IS STILL FORMING ──────
//
// `interpret` seeds `barstate.isconfirmed` / `ishistory` / `isrealtime` from the
// caller's `newestBarIsForming` tri-state and leaves them `na` when nobody says
// (fail-closed, correctly). `computeFor` has always passed it; `objectReaderFor`
// did not — so the SAME condition read 1 in a plot and `na` in a drawing guard.
//
// ⚰️ MEASURED against TradingView (2026-09-28, NYSE:RDDT 1D): `liquidity-pools`
// guards every swing with `barstate.isconfirmed ? ta.pivothigh(…) : na`. The
// vendor draws 182 lines and 91 labels; each of our guards was truthy on 0 of
// 632 bars. `docs/pine/vendor-harness/objects-triage-2026-09-28.md`, C2.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from './fakeChart'
import { toGraphDocument } from '../ast/graphDocument'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const N = 10
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400, o: 100, h: 102, l: 98, c: 100 + i, v: 1000,
}))
const SRC = [
  '//@version=5',
  'indicator("t", overlay=true, max_labels_count=100)',
  'if barstate.isconfirmed',
  '    label.new(bar_index, close, "c")',
  'plot(close)',
  // ⭐ a second output, so the document has several trees and CAN be saved in
  // the V2 graph form the last case below reads
  'plot(open)',
].join(String.fromCharCode(10))

const definition = () => {
  const door = memberPaneDefinition({ source: SRC, id: 'u_member-pane-tristate', name: 't' })
  expect(door.ok, door.reason).toBe(true)
  expect(door.definition.objects, 'the drawing was not carried').toBeTruthy()
  return door.definition
}

const labelsWith = (newestBarIsForming) => {
  const reader = objectReaderFor(definition(), BARS, { tf: 'D', newestBarIsForming })
  const run = evaluateObjects(reader.program, {
    barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t,
  })
  return run.live.filter((o) => o.family === 'label')
}

describe('⭐⭐ `barstate.isconfirmed` in an object guard reads the tri-state', () => {
  it('every bar SETTLED → a label on every bar', () => {
    expect(labelsWith(false)).toHaveLength(N)
  })

  it('newest bar still FORMING → no label on that bar', () => {
    const got = labelsWith(true)
    expect(got).toHaveLength(N - 1)
    expect(got.map((o) => o.createdBar)).not.toContain(N - 1)
  })

  it('⛔ CONTROL — nobody said → UNKNOWN, and an unknown guard does not fire', () => {
    // `?? null` keeps unknown unknown; `false` would be a confident "settled".
    expect(labelsWith(undefined)).toHaveLength(0)
    expect(labelsWith(null)).toHaveLength(0)
  })

  it('⭐ the V2 GRAPH form reads it too — one document, two evaluators, one answer', () => {
    // A document over the byte budget is saved as a graph and read through
    // `computeObjectColumns`, a second `interpret` call site.
    const g = toGraphDocument(definition())
    expect(g.ok, g.reason).toBe(true)
    const count = (newestBarIsForming) => {
      const reader = objectReaderFor(g.definition, BARS, { tf: 'D', newestBarIsForming })
      expect(reader.form).toBe('graph')
      const run = evaluateObjects(reader.program, {
        barCount: N, readNode: reader.readNode, readTime: (i) => BARS[i].t,
      })
      return run.live.filter((o) => o.family === 'label').length
    }
    expect(count(false)).toBe(N)
    expect(count(null)).toBe(0)
  })
})

describe('⭐ and the binder hands the object lane the SAME tri-state it hands `computeFor`', () => {
  const drawnLabels = (newestBarIsForming) => {
    const { installed, errors } = registry.installUserDefinitions([definition()])
    expect(errors).toEqual([])
    const def = installed[0]
    try {
      const fake = createFakeChart()
      const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
      const cs = addInstance(mergeChartSettings({}), def.id, registry)
      const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
      let state = null
      binder.sync({
        enabled: true, cs, instances, registry, bars: BARS, tf: 'D',
        symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming,
        adjustTime: (t) => t,
        applyData: (series, data) => series.setData(data),
        plan: { fresh: true },
        resolvePlacement: () => ({ paneIndex: 1, scaleId: def.id, scaleOptions: {} }),
        createObjectLayer: () => ({ set: (s) => { state = s }, clear: () => {} }),
      })
      binder.teardown()
      return state ? state.labels.length : null
    } finally {
      registry.uninstallUserDefinition(def.id)
    }
  }

  it('a settled series draws every bar\'s label through the chart binding', () => {
    expect(drawnLabels(false)).toBe(N)
  })

  it('⛔ CONTROL — an unknown tri-state draws none, through the same binding', () => {
    expect(drawnLabels(null)).toBe(0)
  })
})
