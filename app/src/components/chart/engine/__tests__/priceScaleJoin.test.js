// app/src/components/chart/engine/__tests__/priceScaleJoin.test.js
//
// PRICE-SCALE JOIN (coordinator ruling 2026-11-16).
//
// On TradingView an `overlay = true` script's plots sit on the price scale and take part in
// its autoscale by default, so a line the author parks under the bars is in view. Seen on
// production (smoke account, RDDT 1D, RS Rating by Fred6724): the RS line's last value was
// 43.57 while the price scale showed about 80 to 220, so most of the line was below the pane.
// The values were right; a member could not see them.
//
// The rule: a Pine translation that declares `overlay = true` stamps
// `placement.joinPriceScale: true` unless its `scale =` takes it off the price scale; the chart
// then lets its plots drive the price scale, unless the surface fits price to the candles.
// Native indicators carry no stamp, so the guest rule (`placement.js`, `'exclude'`) is theirs
// unchanged.
//
// WHAT THIS RESTS ON. No committed capture records TradingView's visible price range, so the
// default is TradingView's documented one, not a witnessed number (queued as a capture row in
// `docs/pine/capture-queue-2026-11-14-rs-rating.md`, Q-RS10). The last block measures OUR
// half on the real `lightweight-charts`: with the look, the parked line is inside the pane.

import { describe, it, expect, beforeAll } from 'vitest'
import { createChart, LineSeries, CandlestickSeries } from 'lightweight-charts'
import { translatePine } from '../ast/pine'
import { memberPaneDefinition, joinsPriceScale } from '../../builder/memberPane/memberPaneDefinition'
import { validateDefinition } from '../defSchema'
import { eligibleInstances } from '../eligibility'
import { resolvePlacement, joinsPriceScaleOf } from '../placement'
import { presentedPlot } from '../presentation'
import { seriesOptionsForPlot, AUTOSCALE_EXCLUDE, AUTOSCALE_DEFAULT } from '../pool'
import * as engineRegistry from '../nativeRegistry'

const script = (decl) => `//@version=5\n${decl}\nplot(close * 0.4, "parked")\n`
const OVERLAY = script('indicator("J", overlay = true)')
const OVERLAY_RIGHT = script('indicator("J", overlay = true, scale = scale.right)')
const OVERLAY_NONE = script('indicator("J", overlay = true, scale = scale.none)')
const OVERLAY_LEFT = script('indicator("J", overlay = true, scale = scale.left)')
const OVERLAY_OTHER = script('s = scale.none\nindicator("J", overlay = true, scale = s)')
const OWN_PANE = script('indicator("J")')
const OWN_PANE_FALSE = script('indicator("J", overlay = false)')

const host = (src) => translatePine(src, { strict: true })
const mint = (src) => memberPaneDefinition({ source: src, id: 'u_join_test', name: 'J' })

describe('the declaration: which scale the author put the script on', () => {
  it('reads `scale =` as right / left / none, and nothing when it is not passed', () => {
    expect(host(OVERLAY).presentation.scale).toBeUndefined()
    expect(host(OVERLAY_RIGHT).presentation.scale).toBe('right')
    expect(host(OVERLAY_NONE).presentation.scale).toBe('none')
    expect(host(OVERLAY_LEFT).presentation.scale).toBe('left')
  })

  it('a result that passes no `scale =` keeps its exact presentation keys', () => {
    expect(Object.keys(host(OVERLAY).presentation)).not.toContain('scale')
    expect(Object.keys(host(OWN_PANE).presentation)).not.toContain('scale')
  })

  it('joins only an overlay script on the right scale', () => {
    expect(joinsPriceScale(host(OVERLAY))).toBe(true)
    expect(joinsPriceScale(host(OVERLAY_RIGHT))).toBe(true)
    expect(joinsPriceScale(host(OVERLAY_NONE))).toBe(false)
    expect(joinsPriceScale(host(OVERLAY_LEFT))).toBe(false)
    expect(joinsPriceScale(host(OWN_PANE))).toBe(false)
    expect(joinsPriceScale(host(OWN_PANE_FALSE))).toBe(false)
    // never guessed: a scale this reader cannot name does not join
    expect(joinsPriceScale({ presentation: { overlay: true, scale: 'other' } })).toBe(false)
    expect(joinsPriceScale(null)).toBe(false)
  })

  it('the argument is still disclosed as chart-only: the scale itself is not carried', () => {
    const notes = host(OVERLAY_NONE).notes.filter((n) => n.code === 'pine:chart-only')
    expect(notes.some((n) => /`scale =`/.test(n.note || n.text || JSON.stringify(n)))).toBe(true)
  })
})

describe('the stored document: the stamp a translation mints', () => {
  it('an overlay script is stamped, and the document is valid', () => {
    const built = mint(OVERLAY)
    expect(built.ok, JSON.stringify(built.reason || null)).toBe(true)
    expect(built.definition.placement).toEqual({ target: 'price', joinPriceScale: true })
    expect(validateDefinition(built.definition).errors || []).toEqual([])
    expect(joinsPriceScaleOf(built.definition)).toBe(true)
  })

  it('`scale = scale.none` / `scale.left` on an overlay script: on price, NOT stamped', () => {
    for (const src of [OVERLAY_NONE, OVERLAY_LEFT]) {
      const built = mint(src)
      expect(built.ok, JSON.stringify(built.reason || null)).toBe(true)
      expect(built.definition.placement).toEqual({ target: 'price' })
      expect(joinsPriceScaleOf(built.definition)).toBe(false)
    }
  })

  it('a script in its own pane is untouched', () => {
    const built = mint(OWN_PANE)
    expect(built.ok, JSON.stringify(built.reason || null)).toBe(true)
    expect(built.definition.placement.target).toBe('pane')
    expect(built.definition.placement.joinPriceScale).toBeUndefined()
  })

  it('only the exact boolean is a stamp, and the schema says so', () => {
    const doc = mint(OVERLAY).definition
    for (const bad of ['true', 1, {}, null]) {
      const d = { ...doc, placement: { ...doc.placement, joinPriceScale: bad } }
      expect(joinsPriceScaleOf(d), String(bad)).toBe(false)
      expect((validateDefinition(d).errors || []).some((e) => /placement\.joinPriceScale/.test(e)), String(bad)).toBe(true)
    }
    // never together with a scale of its own, and never off the price pane
    expect(joinsPriceScaleOf({ placement: { target: 'price', joinPriceScale: true, ownScale: true } })).toBe(false)
    expect(joinsPriceScaleOf({ placement: { target: 'pane', joinPriceScale: true } })).toBe(false)
  })
})

describe('the chart: who may move the candles\' range', () => {
  const DOC = mint(OVERLAY).definition
  const INST = { instanceId: 'i1', defId: DOC.id, inputs: {} }
  const registry = (id) => (id === DOC.id ? DOC : engineRegistry.getDefinition(id))
  const look = (ctx) => eligibleInstances([INST], registry, { tf: 'D', ...ctx }).kept[0].renderLook

  it('drawn on price: the look says the series takes part in the autoscale', () => {
    expect(look({ targetOf: () => 'price' })).toEqual({ autoscale: 'default' })
  })

  it('a surface that fits price to the candles keeps doing so', () => {
    expect(look({ targetOf: () => 'price', fitPriceToCandles: true })).toBeUndefined()
  })

  it('moved to a pane of its own, or with no target answer: nothing is stamped', () => {
    expect(look({ targetOf: () => 'pane' })).toBeUndefined()
    expect(look({})).toBeUndefined()
  })

  it('placement itself still answers `exclude`: the surface decides, not the document', () => {
    const p = resolvePlacement(INST, DOC, { paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1 })
    expect(p.autoscale).toBe('exclude')
  })

  it('CONTROL: a native price overlay carries no stamp and gets no look', () => {
    const natives = engineRegistry.listDefinitions
      ? engineRegistry.listDefinitions()
      : ['bollinger', 'vwap', 'sar', 'donchian', 'ichimoku'].map((id) => engineRegistry.getDefinition(id)).filter(Boolean)
    expect(natives.length).toBeGreaterThan(0)
    const stamped = natives.filter((d) => joinsPriceScaleOf(d)).map((d) => d.id)
    expect(stamped).toEqual([])
    const bb = engineRegistry.getDefinition('bollinger') || natives.find((d) => d.placement && d.placement.target === 'price')
    expect(bb, 'a native price overlay to test with').toBeTruthy()
    const kept = eligibleInstances([{ instanceId: 'n1', defId: bb.id, inputs: {} }], engineRegistry.getDefinition,
      { tf: 'D', targetOf: () => 'price' }).kept[0]
    expect(kept.renderLook && kept.renderLook.autoscale).not.toBe('default')
  })

  it('the look reaches the series as the default provider; without it, the guest provider', () => {
    const plot = DOC.plots.find((p) => p.hidden !== true)
    const joined = eligibleInstances([INST], registry, { tf: 'D', targetOf: () => 'price' }).kept[0]
    const withLook = seriesOptionsForPlot(presentedPlot(plot, joined, {}), { scaleId: 'right', autoscale: 'exclude' })
    const without = seriesOptionsForPlot(presentedPlot(plot, INST, {}), { scaleId: 'right', autoscale: 'exclude' })
    expect(withLook.autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
    expect(without.autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
  })
})

describe('on a real price scale: the parked line is in view', () => {
  beforeAll(() => {
    const ctx = new Proxy({}, {
      get: (_t, k) => {
        if (k === 'canvas') return { width: 800, height: 400 }
        if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
        if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
        if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
        return () => {}
      },
      set: () => true,
    })
    HTMLCanvasElement.prototype.getContext = () => ctx
    Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 800 }, configurable: true })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 400 }, configurable: true })
  })

  const T = (i) => 1_700_000_000 + i * 86_400
  // the screen seen on production: candles between about 100 and 220, the line near 40
  const CANDLES = Array.from({ length: 120 }, (_, i) => ({ time: T(i), open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i }))
  const LINE = CANDLES.map((b) => ({ time: b.time, value: b.close * 0.4 }))
  const HEIGHT = 400

  function lastCoordinate(provider) {
    const el = document.createElement('div')
    document.body.appendChild(el)
    const chart = createChart(el, { width: 800, height: HEIGHT })
    chart.addSeries(CandlestickSeries, {}).setData(CANDLES)
    chart.timeScale().setVisibleLogicalRange({ from: 0, to: CANDLES.length - 1 })
    const s = chart.addSeries(LineSeries, { autoscaleInfoProvider: provider })
    s.setData(LINE)
    const y = s.priceToCoordinate(LINE[0].value)
    const range = s.priceScale().getVisibleRange()
    chart.remove()
    el.remove()
    return { y, range }
  }

  it('CONTROL: as a guest, the line\'s low is below the pane', () => {
    const { y, range } = lastCoordinate(AUTOSCALE_EXCLUDE)
    expect(range.from).toBeGreaterThan(LINE[0].value)
    expect(y).toBeGreaterThan(HEIGHT)
  })

  it('joined, the scale reaches down to it and the candles are still inside', () => {
    const { y, range } = lastCoordinate(AUTOSCALE_DEFAULT)
    expect(range.from).toBeLessThanOrEqual(LINE[0].value)
    expect(range.to).toBeGreaterThanOrEqual(221)
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThanOrEqual(HEIGHT)
  })
})
