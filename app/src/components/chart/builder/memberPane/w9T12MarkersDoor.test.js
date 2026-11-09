// app/src/components/chart/builder/memberPane/w9T12MarkersDoor.test.js
//
// W9-T12 — the markers at the member door, through the REAL binder: a strategy document built
// by `memberPaneDefinition` (broker gate on, as T11's stamp test does), run, and handed to the
// chart. Asserted on what the renderer is handed (the object layer's render state) and on the
// published outcome a member surface reads, never on a function count.
//
//   1. While W9-MK1 is open the binder draws NO marker and publishes the refusal by name.
//   2. CONTROL: an indicator publishes nothing and its layer is unchanged.
//   3. Behind the test pin (the look pinned), a served record's markers reach the render state.
import { describe, it, expect, vi, afterEach } from 'vitest'

// the broker's own rules pinned (so the run produces a record); the marker look follows a test flag
vi.mock('../../engine/runtime/brokerPins.js', () => ({
  pinned: (id) => String(id).startsWith('B-') || globalThis.__w9t12LookPinned === true,
}))
vi.setConfig({ testTimeout: 120000 })

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { runtimeStrategyOf, withStrategyRecord } from '../../engine/runtime/strategyRecord'
import { tradeMarkersFor, resetTradeMarkers } from '../../engine/runtime/tradeMarkers'
import { createBinder } from '../../engine/binder'
import { createFakeChart } from '../../engine/__tests__/fakeChart'

const NL = String.fromCharCode(10)
const ID = 'u_w9t12-markers'
const SRC = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
  'if bar_index == 8', '    strategy.close("L")', 'plot(strategy.position_size, "pos")', ''].join(NL)
const IND = ['//@version=5', 'indicator("i")', 'var float acc = 0.0', 'acc += close', 'plot(acc, "acc")', ''].join(NL)
const BARS = Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100 + i, h: 101.5 + i, l: 99 + i, c: 100.5 + i, v: 1000 }))
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' }, historyWindowBars: 30 }
const flags = () => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
}

afterEach(() => {
  registry.uninstallUserDefinition(ID)
  vi.unstubAllEnvs()
  resetTradeMarkers()
  globalThis.__w9t12LookPinned = false
})

function build(source) {
  flags()
  const d = memberPaneDefinition({ source, id: ID, name: 'T' })
  expect(d.ok, d.reason).toBe(true)
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(errors).toEqual([])
  return installed[0]
}

/** The real binder over the recording chart, fed `cols`; returns the render states handed to the layer. */
function bind(def, cols) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const layers = []
  const instanceId = `inst:${def.id}:1`
  binder.sync({
    enabled: true,
    instances: [{ instanceId, defId: def.id, inputs: {} }],
    registry: {
      getDefinition: (id) => (id === def.id ? def : null),
      computeFor: () => cols,
      hasAnyFinite: (col) => Array.from(col || []).some(Number.isFinite),
      columnKeys: (x) => (x.plots || []).map((p) => p.key),
    },
    bars: BARS, tf: 'D', adjustTime: (t) => t, plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 's', scaleOptions: {} }),
    createObjectLayer: () => ({ set: (state) => layers.push(state), clear: () => {} }),
  })
  return { binder, instanceId, layers }
}

describe('W9-T12 the markers at the member door', () => {
  it('⭐ a strategy run reaches the binder, which draws no marker and publishes the refusal naming W9-MK1', () => {
    const def = build(SRC)
    const cols = computeRuntimeColumns(def, BARS, CTX)
    const rec = runtimeStrategyOf(cols)
    expect(rec && rec.trades.length).toBe(1)   // the run did trade: the refusal is about the look
    const m = bind(def, cols)
    const out = tradeMarkersFor(m.instanceId)
    expect(out.status).toBe('refused')
    expect(out.guard).toBe('runtime:strategy-unpinned')
    expect(out.capture).toBe('W9-MK1')
    expect(out.sentence).toMatch(/W9-MK1/)
    expect(m.layers.filter(Boolean).flatMap((s) => s.labels)).toEqual([])
    m.binder.teardown()
    expect(tradeMarkersFor(m.instanceId)).toBe(null)   // and it goes with the pane
  })

  it('⛔ CONTROL — an indicator publishes nothing and is handed no layer state', () => {
    const def = build(IND)
    expect(def.meta.runtimeHistory).toBe('listing')
    const m = bind(def, computeRuntimeColumns(def, BARS, CTX))
    expect(tradeMarkersFor(m.instanceId)).toBe(null)
    expect(m.layers).toEqual([])
    m.binder.teardown()
  })

  it('⭐ behind the test pin, a served record (the order log W9-T7 adds, hand-made) reaches the render state', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(SRC)
    const cols = computeRuntimeColumns(def, BARS, CTX)
    const rec = JSON.parse(JSON.stringify(runtimeStrategyOf(cols)))
    const [t] = rec.trades
    expect(t.open).toBe(false)
    t.exitId = 'Close entry(s) order L'
    rec.orders = [{ id: 'L', status: 'filled', fillTime: t.entryTime, comment: null },
      { id: 'Close entry(s) order L', status: 'filled', fillTime: t.exitTime, comment: null }]
    delete rec.unserved.orders
    delete rec.unserved['trades.exitId']
    const served = withStrategyRecord({ ...cols }, rec)
    const m = bind(def, served)
    expect(tradeMarkersFor(m.instanceId).status).toBe('ok')
    const labels = m.layers.filter(Boolean).pop().labels
    expect(labels.map((l) => [l.x, l.y, l.style, l.text])).toEqual([
      [t.entryTime, t.entryPrice, 'arrowup', `L\n+${t.qty}`],
      [t.exitTime, t.exitPrice, 'arrowdown', `Close entry(s) order L\n-${t.qty}`],
    ])
    m.binder.teardown()
  })
})
