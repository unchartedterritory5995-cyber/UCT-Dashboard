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
//   4. (review F1) A strategy whose drawings come from the HOST object program draws exactly what
//      the same document draws without the strategy stamp (the base path), markers refused or not.
//   5. (review F2) The published outcome is scoped by binder: two binders on one instance id.
//   6. (review F4) The repaint signature carries the markers: same count, other text => another
//      signature; the same markers => the same signature.
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
import { tradeMarkersFor, resetTradeMarkers, onTradeMarkersChange } from '../../engine/runtime/tradeMarkers'
import { createBinder } from '../../engine/binder'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { RUNTIME_WARMUP_KEY, withRuntimeObjects } from '../../engine/runtime/runtimeObjects'
import { objectRenderDropsFor, resetObjectRenderDrops } from '../../engine/objectRenderNotice'

const NL = String.fromCharCode(10)
const ID = 'u_w9t12-markers'
const SRC = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
  'if bar_index == 8', '    strategy.close("L", comment = "out")', 'plot(strategy.position_size, "pos")', ''].join(NL)
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
  resetObjectRenderDrops()
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
function bind(def, cols, scope = '', bars = BARS, makeLayer = undefined) {
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC, scope })
  const layers = []
  const sigs = []
  const metas = []
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
    bars, tf: 'D', adjustTime: (t) => t, plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 's', scaleOptions: {} }),
    createObjectLayer: makeLayer !== undefined ? makeLayer
      : () => ({ set: (state, sig, meta) => { layers.push(state); sigs.push(sig); metas.push(meta) }, clear: () => {} }),
  })
  return { binder, instanceId, layers, sigs, metas }
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

  it('⭐ behind the test pin, the RUN\'S OWN record (the order log W9-T7-F1 serves, not hand-made) reaches the render state', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(SRC)
    const cols = computeRuntimeColumns(def, BARS, CTX)
    const t = runtimeStrategyOf(cols).trades[0]
    expect(t.open).toBe(false)
    expect(t.exitId).toBe(null)   // a strategy.close: TradingView names that exit itself
    const m = bind(def, cols)
    expect(tradeMarkersFor(m.instanceId).status).toBe('ok')
    const labels = m.layers.filter(Boolean).pop().labels
    expect(labels.map((l) => [l.x, l.y, l.style, l.text])).toEqual([
      [t.entryTime, t.entryPrice, 'arrowup', `L\n+${t.qty}`],
      [t.exitTime, t.exitPrice, 'arrowdown', `out\n-${t.qty}`],
    ])
    m.binder.teardown()
  })

  it('⛔ CONTROL — the same run with a close that carries NO comment refuses by name (its exit has no stated name)', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(SRC.replace('strategy.close("L", comment = "out")', 'strategy.close("L")'))
    const m = bind(def, computeRuntimeColumns(def, BARS, CTX))
    const out = tradeMarkersFor(m.instanceId)
    expect(out.status).toBe('refused')
    expect(out.guard).toBe('runtime:strategy-markers-unlabelled')
    expect(m.layers.filter(Boolean).flatMap((s) => s.labels)).toEqual([])
    m.binder.teardown()
  })
})

/** A strategy run's columns with its own order log (W9-T7-F1), the entry orders' comment set to `c` (one text per
 *  test, so two runs differ only in a marker's text). */
function served(def, c = null) {
  const cols = computeRuntimeColumns(def, BARS, CTX)
  if (c === null) return cols
  const rec = JSON.parse(JSON.stringify(runtimeStrategyOf(cols)))
  for (const o of rec.orders) if (o.kind === 'entry') o.comment = c
  return withStrategyRecord({ ...cols }, rec)
}

const HOSTED = {
  'line.new every bar': 'line.new(bar_index, low, bar_index + 1, high)',
  'label.new every bar': 'label.new(bar_index, high, "x")',
  'var line once': 'var line ln = line.new(0, 100, 5, 120)',
}
const hostedSrc = (draw) => ['//@version=5', 'strategy("t", overlay = true)', 'if bar_index == 3',
  '    strategy.entry("L", strategy.long)', 'if bar_index == 8', '    strategy.close("L", comment = "out")', draw,
  'plot(strategy.position_size, "pos")', ''].join(NL)
const drawn = (states) => {
  const s = states.filter(Boolean).pop()
  return s ? { lines: (s.lines || []).length, labels: (s.labels || []).length } : { lines: 0, labels: 0 }
}

describe('W9-T12 4 (review F1) a strategy drawn by the HOST object program keeps its drawings', () => {
  for (const [name, draw] of Object.entries(HOSTED)) {
    it(`${name}: the strategy draws what the same document draws on the base path`, () => {
      const def = build(hostedSrc(draw))
      // the case under test: the host program draws, the run does not
      expect(def.meta.runtimeHistory).toBe('strategy-window')
      expect(def.compute.objects).toBeFalsy()
      expect(def.objects).toBeTruthy()
      const cols = computeRuntimeColumns(def, BARS, CTX)
      // the base path: the SAME document with the strategy stamp off (drawsTradeMarkers false),
      // which is exactly the branch master takes for it
      const baseDef = { ...def, meta: { ...def.meta, runtimeHistory: 'listing' } }
      const base = bind(baseDef, cols)
      const want = drawn(base.layers)
      base.binder.teardown()
      expect(want.lines + want.labels).toBeGreaterThan(0)
      const tip = bind(def, cols)
      expect(drawn(tip.layers)).toEqual(want)
      // and the markers' refusal is still published for it
      expect(tradeMarkersFor(tip.instanceId).capture).toBe('W9-MK1')
      tip.binder.teardown()
    })
  }

  it('behind the test pin, served markers JOIN the host picture (labels = host + markers)', () => {
    const def = build(hostedSrc(HOSTED['var line once']))
    const base = drawn(bind({ ...def, meta: { ...def.meta, runtimeHistory: 'listing' } }, computeRuntimeColumns(def, BARS, CTX)).layers)
    globalThis.__w9t12LookPinned = true
    const m = bind(def, served(def))
    const s = m.layers.filter(Boolean).pop()
    expect(s.lines.length).toBe(base.lines)
    expect(s.labels.map((l) => l.style)).toEqual(['arrowup', 'arrowdown'])
    m.binder.teardown()
  })
})

describe('W9-T12 5 (review F2) the published outcome is scoped by binder', () => {
  it('two binders on one instance id: each reads its own, and one teardown leaves the other', () => {
    const def = build(SRC)
    globalThis.__w9t12LookPinned = true
    const a = bind(def, served(def), 'chart-A')
    globalThis.__w9t12LookPinned = false
    const b = bind(def, served(def), 'chart-B')
    expect(a.instanceId).toBe(b.instanceId)
    expect(tradeMarkersFor(a.instanceId, 'chart-A').status).toBe('ok')
    expect(tradeMarkersFor(b.instanceId, 'chart-B').status).toBe('refused')
    expect(tradeMarkersFor(a.instanceId)).toBe(null)   // the unscoped store holds neither
    b.binder.teardown()
    expect(tradeMarkersFor(b.instanceId, 'chart-B')).toBe(null)
    expect(tradeMarkersFor(a.instanceId, 'chart-A').status).toBe('ok')
    a.binder.teardown()
    expect(tradeMarkersFor(a.instanceId, 'chart-A')).toBe(null)
  })
})

describe('W9-T12 6 (review F4) the repaint signature carries the markers', () => {
  it('same marker count, other text: another signature; the same markers: the same signature', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(SRC)
    const one = bind(def, served(def, 'first'))
    const two = bind(def, served(def, 'second'))
    const again = bind(def, served(def, 'first'))
    const last = (m) => m.sigs.filter((x, i) => m.layers[i]).pop()
    const n = (m) => m.layers.filter(Boolean).pop().labels.length
    expect(n(one)).toBe(n(two))
    expect(last(one)).not.toBe(last(two))
    expect(last(one)).toBe(last(again))
    for (const m of [one, two, again]) m.binder.teardown()
  })

  it('the host path too: same count, other text => another signature', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(hostedSrc(HOSTED['var line once']))
    const one = bind(def, served(def, 'first'))
    const two = bind(def, served(def, 'second'))
    const last = (m) => m.sigs.filter((x, i) => m.layers[i]).pop()
    expect(last(one)).not.toBe(last(two))
    for (const m of [one, two]) m.binder.teardown()
  })
})

describe('W9-T12 r2 (N1) the published outcome equals the picture', () => {
  const curtained = (cols) => {
    Object.defineProperty(cols, RUNTIME_WARMUP_KEY, { value: { withheldBars: 5, shift: 0 }, enumerable: false, configurable: true })
    return cols
  }

  it('host drawings withheld (the warm-up curtain): the layer is cleared and served markers report the withheld refusal', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(hostedSrc(HOSTED['var line once']))
    const events = []
    onTradeMarkersChange((id) => events.push(id))
    const m = bind(def, curtained(served(def)))
    expect(m.layers.filter(Boolean)).toEqual([])
    // published ONCE, after the picture was decided: never `ok` first and the refusal after
    expect(events).toHaveLength(1)
    const out = tradeMarkersFor(m.instanceId)
    expect(out.status).toBe('refused')
    expect(out.guard).toBe('runtime:strategy-markers-withheld')
    expect(out.sentence).toMatch(/drawn together with the script's own drawings/)
    expect(out.sentence).not.toMatch(/\b[a-z][A-Za-z]*\.[a-z][A-Za-z_]*\b/)
    m.binder.teardown()
  })

  it('CONTROL: the same served record without the curtain is drawn and reported ok', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(hostedSrc(HOSTED['var line once']))
    const m = bind(def, served(def))
    expect(tradeMarkersFor(m.instanceId).status).toBe('ok')
    expect(m.layers.filter(Boolean).pop().labels).toHaveLength(2)
    m.binder.teardown()
  })

  it('CONTROL: a refusal that is not ok passes through unchanged (look unpinned, curtain up)', () => {
    const def = build(hostedSrc(HOSTED['var line once']))
    const m = bind(def, curtained(served(def)))
    expect(tradeMarkersFor(m.instanceId).capture).toBe('W9-MK1')
    m.binder.teardown()
  })
})

describe('W9-T12 r2 (N2) the host-path merge keeps ids and bars in step and counts a dropped marker', () => {
  it('liveIds and createdBars stay aligned; each marker carries the bar it sits on', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(hostedSrc(HOSTED['var line once']))
    const cols = served(def)
    const m = bind(def, cols)
    const meta = m.metas.filter((x, i) => m.layers[i]).pop()
    expect(meta.createdBars.length).toBe(meta.liveIds.length)
    const t = runtimeStrategyOf(cols).trades[0]
    const barOf = (time) => BARS.findIndex((b) => b.t === time)
    expect(meta.liveIds.slice(-2)).toEqual([`mk:${t.entryTime}|buy`, `mk:${t.exitTime}|sell`])
    expect(meta.createdBars.slice(-2)).toEqual([barOf(t.entryTime), barOf(t.exitTime)])
    m.binder.teardown()
  })

  it('a marker the chart cannot place is counted in the drawing note on the host path', () => {
    const def = build(hostedSrc(HOSTED['var line once']))
    const cols = served(def)
    // a date-keyed series that starts AFTER the entry fill: the entry marker has no bar here
    const dateBars = BARS.slice(5).map((b) => ({ ...b, t: new Date(b.t * 1000).toISOString().slice(0, 10) }))
    const base = bind(def, cols, 'base', dateBars)   // look unpinned: no markers drawn
    expect(objectRenderDropsFor(base.instanceId, 'base')).toBe(null)
    base.binder.teardown()
    globalThis.__w9t12LookPinned = true
    const m = bind(def, cols, 'tip', dateBars)
    const drops = objectRenderDropsFor(m.instanceId, 'tip')
    expect(drops && drops.dropped).toBe(1)
    m.binder.teardown()
  })
})

describe('W9-T12 r3 every way the run branch draws nothing turns a served outcome into the withheld refusal', () => {
  const GUARD = 'runtime:strategy-markers-withheld'
  /** served columns that also carry a run-owned drawing payload with one object */
  const withObjects = (cols, obj) => withRuntimeObjects(cols, { status: 'ok', live: [obj], withheld: {}, stats: { nextId: 2 } })
  const goodLine = { id: 1, family: 'line', createdBar: 0, props: { x1: 0, y1: 100, x2: 5, y2: 110 } }

  it('Q1: the render state throws => cleared layer and the withheld refusal, never ok', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(SRC)
    expect(def.objects).toBeFalsy()   // the run branch
    const bad = { id: 1, family: 'line', createdBar: 0, get props() { throw new Error('boom') } }
    const m = bind(def, withObjects(served(def), bad))
    expect(m.layers.filter(Boolean)).toEqual([])
    expect(tradeMarkersFor(m.instanceId).guard).toBe(GUARD)
    m.binder.teardown()
  })

  it('Q1 CONTROL: the same payload with a well-formed object is drawn and reported ok', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(SRC)
    const m = bind(def, withObjects(served(def), goodLine))
    const s = m.layers.filter(Boolean).pop()
    expect(s.labels).toHaveLength(2)
    expect(tradeMarkersFor(m.instanceId).status).toBe('ok')
    m.binder.teardown()
  })

  it('N: a surface with no object layer => the withheld refusal', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(SRC)
    const m = bind(def, served(def), '', BARS, null)
    expect(tradeMarkersFor(m.instanceId).guard).toBe(GUARD)
    m.binder.teardown()
  })

  it('N: a layer that cannot be made (the factory throws, or returns nothing) => the withheld refusal, on both paths', () => {
    globalThis.__w9t12LookPinned = true
    for (const src of [SRC, hostedSrc(HOSTED['var line once'])]) {
      const def = build(src)
      for (const make of [() => { throw new Error('no canvas') }, () => null]) {
        const m = bind(def, served(def), '', BARS, make)
        expect(tradeMarkersFor(m.instanceId).guard, src).toBe(GUARD)
        m.binder.teardown()
      }
      registry.uninstallUserDefinition(ID)
    }
  })

  it('N: the layer refuses the picture (set throws) => the withheld refusal, on both paths', () => {
    globalThis.__w9t12LookPinned = true
    for (const src of [SRC, hostedSrc(HOSTED['var line once'])]) {
      const def = build(src)
      const m = bind(def, served(def), '', BARS, () => ({ set: () => { throw new Error('ctx lost') }, clear: () => {} }))
      expect(tradeMarkersFor(m.instanceId).guard).toBe(GUARD)
      m.binder.teardown()
      registry.uninstallUserDefinition(ID)
    }
  })

  it('N, host path: no object layer => the withheld refusal', () => {
    globalThis.__w9t12LookPinned = true
    const def = build(hostedSrc(HOSTED['var line once']))
    const m = bind(def, served(def), '', BARS, null)
    expect(tradeMarkersFor(m.instanceId).guard).toBe(GUARD)
    m.binder.teardown()
  })

  it('CONTROL: look unpinned with no object layer => the W9-MK1 refusal passes through unchanged', () => {
    const def = build(SRC)
    const m = bind(def, served(def), '', BARS, null)
    expect(tradeMarkersFor(m.instanceId).capture).toBe('W9-MK1')
    m.binder.teardown()
  })
})
