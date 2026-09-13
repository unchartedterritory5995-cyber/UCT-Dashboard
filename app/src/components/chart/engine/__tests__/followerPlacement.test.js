import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { makeBars } from './fakeChart'
import { __setPaneModeForTest, computePaneLayout, SEPARATOR_PX } from '../paneLayout'
import * as registry from '../nativeRegistry'
import {
  resolveDisplayTarget, derivedTargetOf, paneFollowerKeys, paneOwnersNeeded,
} from '../displayTarget'
import { instanceSource } from '../sourceRef'

// ─── WHERE A GUEST ACTUALLY LANDS ───────────────────────────────────────────
//
// ⭐ EVERY CASE HERE WAS FOUND IN A BROWSER, NOT IN A TEST, and they are all one
// mistake wearing four hats: **a pane INDEX describes the stack, and the stack is
// not always what the layout says yet.** `PaneApi.moveTo` lands one move per
// animation frame and is remove-and-insert, so for exactly one frame per move the
// index a series is told to join names somebody else's pane — and a series that
// joins on that frame never leaves, because from then on the binding's remembered
// index equals the layout's and nothing looks again.
//
// ⛔ THE SHIPPED FAKE CANNOT MODEL THAT. `fakeChart` has no pane objects at all,
// which is exactly why the unit suite was green while the chart was wrong. The
// double below models a real stack — `moveTo` re-indexes, an emptied pane is
// dropped, and a series belongs to a pane OBJECT rather than to a number — and is
// local to this file so nothing else changes behaviour under it.

const bars = makeBars(120)

/** A lightweight-charts double that models PANES, which the shipped one does not. */
function paneChart() {
  const panes = []
  const mkPane = () => {
    const p = {
      __series: [],
      getSeries: () => p.__series.slice(),
      getHeight: () => 200,
      getHTMLElement: () => null,
      getStretchFactor: () => 1,
      setStretchFactor: () => {},
      paneIndex: () => panes.indexOf(p),
      moveTo: (i) => {
        const from = panes.indexOf(p)
        if (from < 0 || i === from) return
        // Remove-and-insert, as the library does — NOT a swap.
        panes.splice(from, 1)
        panes.splice(i, 0, p)
      },
    }
    return p
  }
  const paneAt = (i) => {
    while (panes.length <= i) panes.push(mkPane())
    return panes[i]
  }
  /** The library drops a pane once nothing is left standing in it. */
  const dropIfEmpty = (p) => {
    const i = panes.indexOf(p)
    if (i >= 0 && !p.__series.length && panes.length > 1) panes.splice(i, 1)
  }

  let n = 0
  const mkSeries = (ctor, options, at) => {
    const id = `s#${++n}`
    let pane = paneAt(Number.isInteger(at) ? at : 0)
    const series = {
      __id: id,
      __ctor: ctor,
      __options: { ...(options || {}) },
      setData: () => {},
      update: () => {},
      applyOptions: (o) => { Object.assign(series.__options, o || {}) },
      options: () => series.__options,
      seriesType: () => ctor && ctor.__type,
      getPane: () => pane,
      moveToPane: (i) => {
        const was = pane
        was.__series = was.__series.filter((x) => x !== series)
        pane = paneAt(i)
        pane.__series.push(series)
        dropIfEmpty(was)
      },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: (o) => ({ options: o }),
      removePriceLine: () => {},
      setMarkers: () => {},
      attachPrimitive: () => {},
      detachPrimitive: () => {},
    }
    pane.__series.push(series)
    return series
  }

  const token = (name) => ({ __type: name, toString: () => name })
  return {
    panes,
    chart: {
      addSeries: (ctor, options, at) => mkSeries(ctor, options, at),
      removeSeries: (s) => {
        const p = s.getPane()
        p.__series = p.__series.filter((x) => x !== s)
        dropIfEmpty(p)
      },
      applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      timeScale: () => ({
        applyOptions: () => {},
        fitContent: () => {},
        getVisibleLogicalRange: () => null,
        setVisibleLogicalRange: () => {},
      }),
      panes: () => panes.slice(),
      remove: () => {},
    },
    LWC: {
      LineSeries: token('LineSeries'),
      HistogramSeries: token('HistogramSeries'),
      AreaSeries: token('AreaSeries'),
      BaselineSeries: token('BaselineSeries'),
      CandlestickSeries: token('CandlestickSeries'),
      BarSeries: token('BarSeries'),
      LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
      createSeriesMarkers: () => ({ setMarkers: () => {} }),
    },
  }
}

const rsi = (over = {}) => ({
  instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false, ...over,
})
const ma = (source, over = {}) => ({
  instanceId: 'inst:ma:1', defId: 'movingAverage', hidden: false,
  inputs: { source, period: 5, maType: 'sma', ...(over.inputs || {}) },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'inputs')),
})
const csOf = (instances, extra) => ({ indicatorInstances: instances, ...(extra || {}) })

const ctxFor = (instances, { cs, topKeys, volume = false } = {}) => {
  const settings = cs || csOf(instances)
  const layout = computePaneLayout(instances, {
    chartHeight: 600,
    hasVolumeBand: false,
    separatorPx: SEPARATOR_PX,
    excludeKeys: paneFollowerKeys(instances, settings),
    keepKeys: paneOwnersNeeded(instances, settings),
    ...(topKeys ? { topKeys: new Set(topKeys), mainPaneIndex: topKeys.length } : {}),
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
    targetOf: (i) => resolveDisplayTarget(i, settings),
    resolvePlacement: (i, def) => resolvePlacement(i, def, {
      paneMargins: layout.bands,
      paneLayout: layout,
      volOverlaySet: new Set(),
      volSeparatePane: volume,
      VOL_PANE_INDEX: 1,
      targetOf: (x) => resolveDisplayTarget(x, settings),
      derivedTargetOf: (x) => derivedTargetOf(x, settings),
    }),
  }
}

beforeEach(() => { __setPaneModeForTest('panes') })
afterEach(() => { __setPaneModeForTest(null); vi.unstubAllGlobals() })

describe('a PRICE overlay and a pane above the candles', () => {
  it('⛔⛔ PANE 0 IS NOT THE CANDLES once something sits above them', () => {
    // Found live: RSI flipped to Above Price, and `MA(Close)` — a price overlay —
    // drew at 494.69 INSIDE RSI's 0-100 rectangle, because the price branch said
    // `paneIndex: 0` and had said so since before a top pane was possible.
    const insts = [rsi({ placement: { position: 'above' } }), ma('close')]
    // ⭐ TOP KEYS ARE PANE KEYS — HOST INSTANCE IDS (P2.0c).
    const ctx = ctxFor(insts, { topKeys: ['legacy:rsi'] })
    expect(ctx.paneLayout.mainPaneIndex, 'the layout stopped knowing where the candles are')
      .toBe(1)
    const p = ctx.resolvePlacement(insts[1], registry.getDefinition('movingAverage'))
    expect(p.paneIndex, 'the price overlay went into the oscillator pane').toBe(1)
    expect(p.autoscale, 'a guest on the candles may never size them').toBe('exclude')
  })

  it('…and with nothing above them it is still pane 0', () => {
    const insts = [rsi(), ma('close')]
    const ctx = ctxFor(insts)
    const p = ctx.resolvePlacement(insts[1], registry.getDefinition('movingAverage'))
    expect(p.paneIndex).toBe(0)
  })
})

describe('a guest in the VOLUME pane, and whose ladder it reads', () => {
  const defMa = () => registry.getDefinition('movingAverage')
  const defRsi = () => registry.getDefinition('rsi')

  it('⭐⭐ MA(Volume) shares VOLUME’s scale — it is an average of those bars', () => {
    // Found live: it landed on the pane's LEFT axis, self-scaled, so the line
    // tracked the histogram's SHAPE while agreeing with none of its VALUES — a
    // readout of 14,446,372 beside a bar of 6.4M.
    const insts = [ma('volume')]
    const ctx = ctxFor(insts, { volume: true })
    const p = ctx.resolvePlacement(insts[0], defMa())
    expect(p.paneIndex).toBe(1)
    expect(p.scaleId, 'the average of volume is not on volume’s axis').toBe('right')
    expect(p.scaleOptions, 'a guest rewrote the host’s margins').toBe(null)
  })

  it('⛔ …and RSI PARKED there keeps its own axis — it reads nothing of volume', () => {
    // The discriminator is where the TARGET came from, not what the indicator is.
    // That is what keeps SOURCE and DISPLAY TARGET separable rather than quietly
    // coupled through the scale.
    const insts = [rsi({ placement: { target: 'volume' } })]
    const ctx = ctxFor(insts, { volume: true })
    const p = ctx.resolvePlacement(insts[0], defRsi())
    expect(p.paneIndex).toBe(1)
    expect(p.scaleId).toBe('left')
  })

  it('⛔ and MA(RSI) parked on Volume keeps its own axis too', () => {
    // Its source is RSI, not volume: 0-100 on volume's ladder is a flat line
    // along the bottom.
    const src = rsi()
    const guest = ma(instanceSource('legacy:rsi', 'rsi'), { placement: { target: 'volume' } })
    const ctx = ctxFor([src, guest], { volume: true })
    const p = ctx.resolvePlacement(guest, defMa())
    expect(p.scaleId).toBe('left')
  })
})

describe('a follower and a stack that is still moving', () => {
  let rafQueue
  beforeEach(() => {
    rafQueue = []
    vi.stubGlobal('requestAnimationFrame', (fn) => { rafQueue.push(fn); return rafQueue.length })
  })
  /** `settlePaneOrder` defers to rAF; drain a bounded number of frames. */
  const runFrames = (n) => {
    for (let i = 0; i < n; i++) {
      const queue = rafQueue.splice(0, rafQueue.length)
      for (const fn of queue) fn()
    }
  }

  it('⭐⭐ MA(RSI) ends up in RSI’s pane even when that pane MOVES after it binds', () => {
    // The live failure: `MA(RSI)` recorded pane 0 and INHABITED pane 1 — drawn
    // across the candles at a value of 56 on a 0-500 axis — and nothing ever
    // corrected it.
    const f = paneChart()
    const binder = createBinder({ chart: f.chart, LWC: f.LWC })
    // The candles already hold pane 0, as they do on a real chart.
    f.chart.addSeries(f.LWC.CandlestickSeries, {}, 0)

    const insts = [rsi({ placement: { position: 'above' } }), ma(instanceSource('legacy:rsi', 'rsi'))]
    binder.sync(ctxFor(insts, { topKeys: ['legacy:rsi'] }))
    runFrames(6)

    const held = binder.bindings()
    const seriesFor = (key) => held.find((b) => b.key === key).series
    const rsiPane = seriesFor('legacy:rsi::rsi').getPane()
    const maPane = seriesFor('inst:ma:1::ma').getPane()
    expect(rsiPane.paneIndex(), 'RSI did not reach the top').toBe(0)
    // ⭐ IDENTITY, NOT AN INDEX THAT HAPPENS TO AGREE.
    expect(maPane, 'the follower was left behind in the candles’ pane').toBe(rsiPane)
  })
})

describe('a BAR FIELD source is the same array every pass', () => {
  it('⛔ so a settings change about somebody ELSE recomputes nothing', () => {
    // Identity IS the invalidation rule, and it only held for indicator columns:
    // `barFieldSeries` allocated a fresh array per pass, so `MA(Close)` recomputed
    // on every write in the chart. Measured live — moving RSI recomputed the
    // moving average twice.
    const f = paneChart()
    const binder = createBinder({ chart: f.chart, LWC: f.LWC })
    const spy = vi.spyOn(registry, 'computeFor')

    const insts = [rsi(), ma('close')]
    binder.sync(ctxFor(insts))
    const maCallsAfterFirst = spy.mock.calls.filter((c) => c[0]?.id === 'movingAverage').length
    expect(maCallsAfterFirst, 'the moving average never computed at all').toBeGreaterThan(0)

    // A new instances ARRAY holding the same instances — what every settings
    // write produces — and the SAME bars.
    binder.sync(ctxFor([{ ...insts[0] }, insts[1]]))
    expect(spy.mock.calls.filter((c) => c[0]?.id === 'movingAverage').length,
      'it recomputed although nothing it reads changed')
      .toBe(maCallsAfterFirst)
    spy.mockRestore()
  })
})
