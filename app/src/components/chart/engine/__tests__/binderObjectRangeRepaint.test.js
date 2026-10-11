// app/src/components/chart/engine/__tests__/binderObjectRangeRepaint.test.js
//
// ⭐⭐ UIE PHASE 1 HARDENING (2026-10-11) — THE CHART MOVED, THE DRAWINGS FOLLOW.
//
// An object layer repaints when its STATE changes. Its `invalidate()` exists for the
// other case — "the chart moved, the state did not" — and nothing called it, so a pan
// or a zoom with no new bars left every line, box and label at its old pixels. The
// binder now subscribes once to the time scale's visible-range change and invalidates
// every live layer; teardown lets go. Real member-pane document, real binder, the
// shared fake chart with a time scale that can be subscribed to.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { addInstance } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { createFakeChart } from './fakeChart'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const N = 10
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1_700_000_000 + i * 86400, o: 100, h: 102, l: 98, c: 100 + i, v: 1000,
}))
const SRC = [
  '//@version=5',
  'indicator("t", overlay=true, max_labels_count=100)',
  'label.new(bar_index, close, "c")',
  'plot(close)',
].join(String.fromCharCode(10))

/** The shared fake chart, with a time scale whose range listener can be driven. */
function chartWithRange() {
  const fake = createFakeChart()
  const listeners = new Set()
  const base = fake.chart.timeScale
  fake.chart.timeScale = () => ({
    ...base(),
    subscribeVisibleLogicalRangeChange: (fn) => listeners.add(fn),
    unsubscribeVisibleLogicalRangeChange: (fn) => listeners.delete(fn),
  })
  return { fake, listeners, move: () => { for (const fn of [...listeners]) fn({ from: 0, to: N }) } }
}

function bound(chart) {
  const door = memberPaneDefinition({ source: SRC, id: 'u_range-repaint', name: 't' })
  expect(door.ok, door.reason).toBe(true)
  const { installed, errors } = registry.installUserDefinitions([door.definition])
  expect(errors).toEqual([])
  const def = installed[0]
  const binder = createBinder({ chart: chart.fake.chart, LWC: chart.fake.LWC })
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = (cs.indicatorInstances || []).filter((i) => i.defId === def.id)
  const layer = { sets: 0, invalidated: 0, set() { this.sets += 1 }, clear() {}, invalidate() { this.invalidated += 1 } }
  const ctx = {
    enabled: true, cs, instances, registry, bars: BARS, tf: 'D',
    symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false,
    adjustTime: (t) => t,
    applyData: (series, data) => series.setData(data),
    plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: {} }),
    createObjectLayer: () => layer,
  }
  return { binder, ctx, layer, cleanup: () => registry.uninstallUserDefinition(def.id) }
}

describe('⭐ a pan / zoom repaints the drawings without a new sync', () => {
  it('the binder subscribes once, invalidates the live layer on a range change, and lets go on teardown', () => {
    const chart = chartWithRange()
    const { binder, ctx, layer, cleanup } = bound(chart)
    try {
      binder.sync(ctx)
      binder.sync(ctx)                                     // a second sync does not subscribe twice
      expect(chart.listeners.size).toBe(1)
      expect(layer.sets).toBeGreaterThan(0)
      const setsBefore = layer.sets
      chart.move()
      expect(layer.invalidated).toBe(1)                    // repainted…
      expect(layer.sets).toBe(setsBefore)                  // …without recomputing the drawings
      binder.teardown()
      expect(chart.listeners.size).toBe(0)
      chart.move()
      expect(layer.invalidated).toBe(1)                    // nothing after teardown
    } finally {
      cleanup()
    }
  })

  it('⛔ a chart without the range API (the shared fake as shipped) still binds — no error, no listener', () => {
    const fake = createFakeChart()
    const { binder, ctx, layer, cleanup } = bound({ fake })
    try {
      expect(() => binder.sync(ctx)).not.toThrow()
      expect(layer.sets).toBeGreaterThan(0)
      binder.teardown()
    } finally {
      cleanup()
    }
  })
})
