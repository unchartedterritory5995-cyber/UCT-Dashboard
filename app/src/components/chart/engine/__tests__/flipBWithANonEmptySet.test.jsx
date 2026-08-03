import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import bars200 from '../../../../pages/parityBars/ramp200.json'

// ─── THE FLIP-B MACHINERY, EXERCISED WITH A NON-EMPTY SET (B3 Task 9) ───────
//
// Task 9 ships `ENGINE_FLIPPED_DEF_IDS` EMPTY, and `stockChartWiring.test.jsx`
// proves the whole thing is inert in that state. Inertness is only half a gate:
// a projection that returned `cs` unconditionally, a migrator gate wired to a
// constant `false`, a control branch that could never be reached — all three
// would pass the dark suite and every one of them is a machine that does not
// work. So this file MOCKS the set non-empty and drives the real component
// through it, which is the only way to see the wiring before Task 10 flips it
// for real.
//
// ⚠️ IT IS NOT A PREDICTION OF WHAT TASK 10 SHIPS. Task 2's visibility
// projection (`i.hidden || legacyEnabled(defId)`) is still in `StockChart` and
// runs the OPPOSITE direction to this one; the case marked ⏳ below pins that
// collision so Task 10 meets it as a red test instead of as a bug report.
//
// The lightweight-charts double is `macdHeadMaskRendered.test.jsx`'s, plus the
// binder wrapper from `stockChartWiring.test.jsx` — `paneMargins` is handed to
// the binder through its sync ctx, and that is where the projection's effect is
// observable at the component level.

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  binderApis: [],
  syncCalls: [],
  // The NON-VACUITY half of `stockChartWiring`'s "the migrator never runs while
  // nothing is flipped". A gate asserted only in its closed state is a gate that
  // could be welded shut.
  migrateCalls: 0,
  reset() {
    H.addSeriesCalls.length = 0
    H.binderApis.length = 0
    H.syncCalls.length = 0
    H.migrateCalls = 0
  },
}))

vi.mock('../instances', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    migrateLegacyToInstances: (...args) => {
      H.migrateCalls += 1
      return actual.migrateLegacyToInstances(...args)
    },
  }
})

// THE POINT OF THE FILE. `importOriginal` keeps every other export real, so the
// migrated set, `engineDrawnDefIds` and `engineDrawnInputs` all behave normally
// and the only difference from production is the one constant under test.
vi.mock('../flipState', async (importOriginal) => ({
  ...await importOriginal(),
  ENGINE_FLIPPED_DEF_IDS: Object.freeze(new Set(['rsi'])),
}))

vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor) => {
    const s = {
      __ctor: ctor,
      setData: () => {}, update: () => {}, applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300 }),
    }
    return s
  }
  const timeScaleBase = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
    getVisibleRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {}, scrollPosition: () => 0,
    timeToCoordinate: () => 0, coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({}), width: () => 600, height: () => 40, barSpacing: () => 6,
  }
  const timeScale = new Proxy(timeScaleBase, {
    get: (t, p) => {
      if (p in t) return t[p]
      if (typeof p === 'symbol' || p === 'then') return undefined
      return () => undefined
    },
  })
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const s = makeSeries(ctor)
      H.addSeriesCalls.push({ ctor, options, paneIndex, series: s })
      return s
    },
    addCustomSeries: (_impl, options, paneIndex) => {
      const s = makeSeries('custom')
      H.addSeriesCalls.push({ ctor: 'custom', options, paneIndex, series: s })
      return s
    },
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
    CandlestickSeries: 'CandlestickSeries', HistogramSeries: 'HistogramSeries', LineSeries: 'LineSeries',
    AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries', BarSeries: 'BarSeries',
    createSeriesMarkers: () => ({ setMarkers: () => {} }),
  }
})

// The REAL binder, wrapped. A faked one would make every count below vacuous.
vi.mock('../binder', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    createBinder: (deps) => {
      const real = actual.createBinder(deps)
      const api = {
        sync: (ctx) => { H.syncCalls.push(ctx); return real.sync(ctx) },
        teardown: real.teardown,
        bindings: real.bindings,
      }
      H.binderApis.push(api)
      return api
    },
  }
})

vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../../../../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

const CANVAS_2D_NOOPS = [
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc',
  'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform',
  'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData',
]
function fakeCanvasContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of CANVAS_2D_NOOPS) ctx[m] = () => {}
  return ctx
}
HTMLCanvasElement.prototype.getContext = function getContext() { return fakeCanvasContext() }

beforeEach(() => {
  cleanup()
  H.reset()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const { default: StockChart } = await import('../../../StockChart')
const { ENGINE_FLIPPED_DEF_IDS, ENGINE_MIGRATED_DEF_IDS } = await import('../flipState')
const { computePaneMargins } = await import('../../paneMargins')

const BARS = bars200.bars
const RSI_INSTANCE = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' }, hidden: false }
const draw = (settingsOverride) => render(
  <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settingsOverride} />,
)
/** Series created on RSI's own named price scale — the legacy block and the
 *  engine both use it, which is why the binder count below is the discriminator. */
const rsiSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')
const ctx = () => {
  const c = H.syncCalls.at(-1)
  expect(c, 'the binder was never synced — this test is vacuous').toBeTruthy()
  return c
}

describe('the mock itself is the subject — without it every case here is vacuous', () => {
  it('the flipped set is non-empty, and is still a SUBSET of the migrated set', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.size).toBeGreaterThan(0)
    for (const id of ENGINE_FLIPPED_DEF_IDS) expect(ENGINE_MIGRATED_DEF_IDS.has(id), id).toBe(true)
  })
})

describe('with rsi FLIPPED: the instance list is what reserves the band', () => {
  it('a blob with only the legacy toggle draws the ENGINE\'s RSI — the read-time migrator', () => {
    // ⛔ THE GATE, INVERTED. With the set empty this exact blob draws the LEGACY
    // series and the binder holds nothing (`stockChartWiring.test.jsx`). Flipped,
    // `migrateLegacyToInstances` projects the toggle into an instance, the engine
    // binds it, and the legacy block stands down via `engineOwned`. One binding,
    // one series, no double draw.
    draw({ engineEnabled: true, indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } })
    expect(H.binderApis[0].bindings(), 'the migrator did not run').toHaveLength(1)
    expect(rsiSeries(), 'the legacy block drew a second RSI').toHaveLength(1)
    // …and the gate `stockChartWiring` asserts CLOSED is genuinely open here. A
    // gate only ever asserted in one state can be welded shut and stay green.
    expect(H.migrateCalls, 'the read-time migrator never ran with an id flipped').toBeGreaterThan(0)
  })

  it('…and the band it lands in is EXACTLY the one the legacy layout reserved', () => {
    // The whole permission for `csForPaneMargins` to exist: the same answer.
    const cs = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
    draw({ engineEnabled: true, ...cs })
    expect(ctx().paneMargins.rsi).toEqual({ top: 0.85, bottom: 0 })
    expect(ctx().paneMargins).toEqual(computePaneMargins(cs, true, new Set()))
  })

  it('a TOMBSTONE releases the band even though the legacy toggle still says ON', () => {
    // The authority flip, measured on the layout. Under Flip A this blob reserves
    // a band (the toggle is the switch); flipped, the instance list says the
    // indicator is gone and the band goes with it — and the price pane gets the
    // height back, which is the thing a user actually sees.
    draw({
      engineEnabled: true,
      indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }],
    })
    expect(ctx().paneMargins.rsi, 'a band was reserved for a deleted indicator').toBeUndefined()
    expect(H.binderApis[0].bindings()).toHaveLength(0)
    // ⏳ …and the LEGACY block still draws it, because Task 9 does not delete
    // that block — deleting it, per indicator, is Task 10's whole job. So this
    // is the shape of the half-flip and not a bug in the projection: the band is
    // released while the legacy line is still painted, into
    // `resolvePlacement`'s `{top:0.82, bottom:0}` fallback, on top of volume.
    // ⛔ TASK 10 FLIPS THIS TO 0 in the same commit that deletes the block.
    expect(rsiSeries(),
      'the legacy RSI block is gone — flip this to 0 and re-check the band overlap').toHaveLength(1)
  })

  it('an INSTANCE reserves the band with the legacy toggle OFF — bands follow instances', () => {
    // The direction that is impossible under Flip A: `computePaneMargins` reads
    // `cs.indicators.rsi.enabled`, which is false here, and the band exists
    // anyway because the projection rewrote it from the instance list.
    draw({
      engineEnabled: true,
      indicators: { rsi: { enabled: false } },
      indicatorInstances: [RSI_INSTANCE],
    })
    expect(ctx().paneMargins.rsi, 'the projection never reached computePaneMargins')
      .toEqual({ top: 0.85, bottom: 0 })
  })

  it('⏳ …and NOTHING is drawn into it yet, because Task 2\'s projection still runs', () => {
    // ⛔ THE COLLISION, PINNED. `StockChart`'s `legacyEnabled` map projects an
    // instance whose legacy toggle is false to `hidden` — Flip A's "the toggle is
    // still the switch" — while `csForPaneMargins` projects the other way. Both
    // are correct for their own task and they cannot both be right at once.
    //
    // TASK 10 DELETES THE `hidden` PROJECTION, at which point this case goes RED
    // and its assertion becomes `toHaveLength(1)`. That red is the point: the
    // deferred semantic cannot change with the suite green, in either direction.
    draw({
      engineEnabled: true,
      indicators: { rsi: { enabled: false } },
      indicatorInstances: [RSI_INSTANCE],
    })
    expect(H.binderApis[0].bindings(),
      'Task 2\'s hidden projection is gone — update this case and the band assertion above').toHaveLength(0)
  })

  it('an UN-FLIPPED migrated definition is untouched — the flip is per definition', () => {
    // `bb` is migrated but not flipped: its legacy toggle is still its switch and
    // no instance is projected for it. If the gate were global, one flip would
    // move every pilot at once.
    draw({ engineEnabled: true, indicators: { bb: { enabled: true, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' } } })
    expect(H.binderApis[0].bindings(), 'bb was migrated by the read-time migrator').toHaveLength(0)
  })
})
