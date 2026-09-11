import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { createFakeChart, makeBars } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import * as registry from '../nativeRegistry'
import { autoscaleProvider, AUTOSCALE_DEFAULT, AUTOSCALE_EXCLUDE } from '../pool'

// ─── TRUE OSCILLATOR BOUNDS ──────────────────────────────────────────────────
//
// ⛔⛔ `minimum` / `maximum` ARE NOT LIGHTWEIGHT-CHARTS 5.2.0 PRICE-SCALE OPTIONS.
// They pin nothing. Passing them changes exactly one thing that works —
// `autoScale: false` — which FREEZES the scale at whatever range it happens to
// be holding, and on a pooled scale that is the "an ATR of 2.7 draws as a flat
// line at the bottom" bug. `autoscaleInfoProvider` is the only mechanism that
// actually says "this scale means 0 to 100 whatever the data is doing".
//
// ⭐ AND THE DOMAIN IS DEFINITION METADATA, NOT PLACEMENT METADATA. RSI is 0-100
// in its own pane, above Price, and overlaid on Volume; the number does not
// depend on where it is standing. The registry has always said so — `fixedPane(0,
// 100, …)` versus `autoPane(…)` — it just never reached the renderer.

const bars = makeBars()
const RSI_DOMAIN = { min: 0, max: 100 }

const inst = (defId, extra = {}) => ({
  instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra,
})

const ctxFor = (instances, { volOverlay = null, topKeys } = {}) => {
  const layout = computePaneLayout(instances, {
    chartHeight: 600,
    hasVolumeBand: false,
    separatorPx: SEPARATOR_PX,
    excludeKeys: volOverlay ? new Set(volOverlay) : new Set(),
    ...(topKeys ? { topKeys: new Set(topKeys), mainPaneIndex: 0 } : {}),
  })
  return {
    enabled: true,
    instances,
    registry,
    bars,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    paneLayout: layout,
    resolvePlacement: (i, def) => resolvePlacement(i, def, {
      paneMargins: layout.bands,
      paneLayout: layout,
      volOverlaySet: volOverlay ? new Set(volOverlay) : new Set(),
      volSeparatePane: !!volOverlay,
      VOL_PANE_INDEX: 1,
    }),
  }
}

let fake
let binder
beforeEach(() => {
  __setPaneModeForTest('panes')
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})
afterEach(() => { __setPaneModeForTest(null) })

/** Every provider handed to a series this sync, keyed by the scale it sits on. */
const providers = () => fake.callsOf('addSeries').map(c => ({
  scaleId: c.args[1].priceScaleId,
  paneIndex: c.args[2],
  provider: c.args[1].autoscaleInfoProvider,
}))

describe('autoscaleProvider — fixed vs dynamic', () => {
  it('⭐ a declared domain becomes a provider that ANSWERS it, ignoring the data', () => {
    const p = autoscaleProvider('default', RSI_DOMAIN)
    // The base implementation is what the library would have said. A fixed domain
    // does not consult it — that is the whole difference from `AUTOSCALE_DEFAULT`.
    expect(p(() => ({ priceRange: { minValue: 42, maxValue: 68 } })))
      .toEqual({ priceRange: { minValue: 0, maxValue: 100 } })
  })

  it('⭐ NEGATIVE domains work — the range is whatever the definition declares', () => {
    // `williamsR` is -100..0. An oscillator does not necessarily start at zero.
    const p = autoscaleProvider('default', { min: -100, max: 0 })
    expect(p(() => null)).toEqual({ priceRange: { minValue: -100, maxValue: 0 } })
  })

  it('⛔ MEMOISED — the same domain is the SAME function, or every tick looks changed', () => {
    // Option sets are deep-compared to decide what to re-apply. A fresh closure
    // per sync would make every series look different on every repaint.
    expect(autoscaleProvider('default', RSI_DOMAIN))
      .toBe(autoscaleProvider('default', { min: 0, max: 100 }))
    expect(autoscaleProvider('default', RSI_DOMAIN))
      .not.toBe(autoscaleProvider('default', { min: -100, max: 0 }))
  })

  it('⛔ "exclude" OUTRANKS a domain — a price overlay may never pin the candles', () => {
    expect(autoscaleProvider('exclude', RSI_DOMAIN)).toBe(AUTOSCALE_EXCLUDE)
  })

  it('no domain, or a malformed one, leaves the shipped dynamic autoscale', () => {
    for (const bad of [null, undefined, {}, { min: 0 }, { min: 5, max: 5 },
      { min: 100, max: 0 }, { min: NaN, max: 1 }]) {
      expect(autoscaleProvider('default', bad)).toBe(AUTOSCALE_DEFAULT)
    }
  })
})

describe('the binder, applying a definition\'s declared domain', () => {
  const providerFor = (defId) => {
    const found = providers()
    expect(found.length, `${defId} bound nothing`).toBeGreaterThan(0)
    return found[0].provider
  }

  it('⭐ RSI in its OWN PANE is a true 0-100 ladder', () => {
    binder.sync(ctxFor([inst('rsi')]))
    expect(providerFor('rsi')).toBe(autoscaleProvider('default', RSI_DOMAIN))
  })

  it('⭐ RSI in a TOP pane is the same ladder — the domain does not know where it is', () => {
    binder.sync(ctxFor([inst('rsi', { placement: { position: 'above' } })], { topKeys: ['rsi'] }))
    expect(providerFor('rsi')).toBe(autoscaleProvider('default', RSI_DOMAIN))
  })

  it('⭐⭐ RSI OVERLAID ON VOLUME keeps 0-100 — and it lands on the LEFT scale', () => {
    // The constraint must reach the oscillator and NOT the volume histogram. They
    // are different scales, which is what makes "independent" true rather than
    // hopeful: pinning `left` says nothing about `right`.
    binder.sync(ctxFor([inst('rsi', { placement: { target: 'volume' } })], { volOverlay: ['rsi'] }))
    const found = providers()
    expect(found).toHaveLength(1)
    expect(found[0].scaleId, 'the overlay did not land on its own axis').toBe('left')
    expect(found[0].provider).toBe(autoscaleProvider('default', RSI_DOMAIN))
  })

  it('⛔ a DYNAMIC indicator is untouched — half the split is "do not change this"', () => {
    // `macd` and `atr` declare `autoPane(…)`: no domain, no provider, no change.
    for (const id of ['macd', 'atr', 'obv']) {
      fake.reset()
      const f2 = createFakeChart()
      const b2 = createBinder({ chart: f2.chart, LWC: f2.LWC })
      b2.sync(ctxFor([inst(id)]))
      const found = f2.callsOf('addSeries').map(c => c.args[1].autoscaleInfoProvider)
      expect(found.length, `${id} bound nothing`).toBeGreaterThan(0)
      for (const p of found) expect(p, `${id} gained a fixed ladder`).toBe(AUTOSCALE_DEFAULT)
    }
  })

  it('every fixed-domain definition in the registry gets ITS OWN declared range', () => {
    // Not just RSI. The rail is that the renderer reads the metadata rather than
    // knowing any indicator's name.
    const expected = { rsi: [0, 100], stoch: [0, 100], mfi: [0, 100], williamsR: [-100, 0], adx: [0, 100] }
    for (const [id, [min, max]] of Object.entries(expected)) {
      const def = registry.getDefinition(id)
      expect(def?.placement?.scale, `${id} stopped declaring a domain`).toEqual({ min, max })
      const f2 = createFakeChart()
      const b2 = createBinder({ chart: f2.chart, LWC: f2.LWC })
      b2.sync(ctxFor([inst(id)]))
      const found = f2.callsOf('addSeries').map(c => c.args[1].autoscaleInfoProvider)
      expect(found.length, `${id} bound nothing`).toBeGreaterThan(0)
      for (const p of found) expect(p, `${id} is not on its declared ladder`)
        .toBe(autoscaleProvider('default', { min, max }))
    }
  })

  it('⭐ the guides land where the fixed ladder puts them — 70/50/30 inside 0..100', () => {
    // With a true 0-100 scale the reference lines are meaningful positions rather
    // than wherever the visible data happened to stretch to.
    binder.sync(ctxFor([inst('rsi')]))
    const guides = fake.callsOf('createPriceLine').map(c => c.args[0].price).sort((a, b) => a - b)
    expect(guides).toEqual([30, 50, 70])
    for (const g of guides) {
      expect(g).toBeGreaterThan(RSI_DOMAIN.min)
      expect(g).toBeLessThan(RSI_DOMAIN.max)
    }
  })
})
