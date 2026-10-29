// app/src/components/chart/engine/__tests__/priceHostedBands.test.js
//
// ⭐⭐ BANDS RIDING THE PRICE SERIES (an instance with no visible plot — Uncharted
// Clouds with both MAs off, TradingView set E6), across INSTANCES.
//
//   • N4: two such instances share the price series but NOT a paint layer — each
//     composites its own, so one's erase-then-paint never wipes the other's bands
//     where they overlap (two indicators' fills composite one over the other, as on
//     TradingView). ⚰️ One layer per series made the second instance's bands erase
//     the first's.
//   • N5: a HIDDEN instance draws no bands of its own there.
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBinder } from '../binder'
import * as registry from '../nativeRegistry'
import { addInstance, setInstanceInput, setInstanceHidden } from '../instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { createFakeChart, createRecordingCtx } from './fakeChart'
import { instanceSource } from '../sourceRef'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const CLOUDS = fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine'), 'utf8')
const ID = 'u_member-pane-pricehost'
afterAll(() => registry.uninstallUserDefinition(ID))
afterEach(() => vi.unstubAllGlobals())

function stubOffscreen() {
  const made = []
  class FakeOffscreen {
    constructor(w, h) {
      this.width = w; this.height = h
      this.rec = createRecordingCtx()
      this.rec.ctx.setTransform = () => {}
      this.rec.ctx.clearRect = () => {}
      this.rec.ctx.canvas = this
      made.push(this)
    }
    getContext() { return this.rec.ctx }
  }
  vi.stubGlobal('OffscreenCanvas', FakeOffscreen)
  return made
}

function bitmapTarget() {
  const drawn = []
  const ctx = { save() {}, restore() {}, setTransform() {}, drawImage: (img) => drawn.push(img) }
  return {
    drawn,
    useBitmapCoordinateSpace: (fn) => fn({ context: ctx, bitmapSize: { width: 2400, height: 1400 }, horizontalPixelRatio: 2, verticalPixelRatio: 2 }),
    useMediaCoordinateSpace: () => {},
  }
}

function run({ hideThird = false, readThird = false } = {}) {
  const b = memberPaneDefinition({ source: CLOUDS, id: ID })
  expect(b.ok, b.reason).toBe(true)
  const { installed } = registry.installUserDefinitions([b.definition])
  const def = installed[0]
  let cs = mergeChartSettings({})
  for (let k = 0; k < 3; k += 1) cs = addInstance(cs, def.id, registry)
  const insts = cs.indicatorInstances.filter((i) => i.defId === def.id)
  for (const inst of insts) {
    cs = setInstanceInput(cs, inst.instanceId, 'showMA1', 0, registry)
    cs = setInstanceInput(cs, inst.instanceId, 'showMA2', 0, registry)
  }
  if (hideThird) cs = setInstanceHidden(cs, insts[2].instanceId, true, registry)
  if (readThird) {
    // ⭐ another instance READS the hidden one, so the binder keeps computing it
    // (`dependedOn`) — the case where its bands could reach the price series
    cs = addInstance(cs, 'roc', registry)
    const roc = cs.indicatorInstances.find((i) => i.defId === 'roc')
    cs = setInstanceInput(cs, roc.instanceId, 'source', instanceSource(insts[2].instanceId, 'out3'), registry)
    expect(cs.indicatorInstances.find((i) => i.defId === 'roc').inputs.source).toBe(instanceSource(insts[2].instanceId, 'out3'))
  }
  const instances = cs.indicatorInstances.filter((i) => i.defId === def.id || i.defId === 'roc')
  const n = 120
  const bars = Array.from({ length: n }, (_, i) => {
    const c = 100 + 10 * Math.sin(i / 7)
    return { t: 1700000000 + i * 86400, o: c - 1, h: c + 2, l: c - 2, c, v: 1000 }
  })
  const fake = createFakeChart({ timeToX: (t) => (Number.isInteger(t) ? t * 10 : null), priceToY: (p) => (Number.isFinite(p) ? 1200 - 10 * p : null) })
  const chart = { ...fake.chart, timeScale: () => ({ ...fake.chart.timeScale(), width: () => 1200 }) }
  const binder = createBinder({ chart, LWC: fake.LWC })
  const candles = fake.chart.addSeries(fake.LWC.CandlestickSeries, {}, 0)
  candles.setData(bars.map((x, i) => ({ time: i, open: x.o, high: x.h, low: x.l, close: x.c })))
  const idx = new Map(bars.map((x, i) => [String(x.t), i]))
  binder.sync({
    priceSeries: () => candles, setBarColours: () => {}, enabled: true, cs, instances, registry, bars, tf: 'D',
    symbol: { ticker: 'SPY' }, adjustTime: (t) => idx.get(String(t)),
    applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: {} }),
  })
  const onCandles = fake.calls.filter((c) => c.method === 'attachPrimitive' && c.id === candles.__id).map((c) => c.args[0])
  return { onCandles, chart, candles }
}

describe('bands hosted on the price series, across instances', () => {
  it('⭐ N4: two instances, two layers — each composites its own bands', () => {
    const made = stubOffscreen()
    const { onCandles, chart, candles } = run()
    expect(onCandles.length, 'NON-VACUITY: every instance\'s twenty bands ride the price series').toBe(60)
    const t = bitmapTarget()
    // (the fake records `attachPrimitive` without calling `attached`; a real chart does)
    for (const p of onCandles) p.attached({ chart, series: candles, requestUpdate: () => {} })
    for (const p of onCandles) p.paneViews()[0].renderer().draw(t)
    // one composite per INSTANCE, each from its own layer
    expect(t.drawn).toHaveLength(3)
    expect(new Set(t.drawn).size).toBe(3)
    expect(made).toHaveLength(3)
  })

  it('⛔ N5: a HIDDEN instance hosts no bands on the price series', () => {
    expect(run({ hideThird: true }).onCandles).toHaveLength(40)
  })

  it('⛔ N5: …not even when another instance READS it (it is computed, never drawn)', () => {
    expect(run({ hideThird: true, readThird: true }).onCandles).toHaveLength(40)
  })

  it('CONTROL — the same reader with the instance VISIBLE: all sixty bands', () => {
    expect(run({ readThird: true }).onCandles).toHaveLength(60)
  })
})
