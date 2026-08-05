import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import bars200 from '../../../../pages/parityBars/ramp200.json'
import intraday5m from '../../../../pages/parityBars/intraday5m.json'

// ─── FLIP B: THE INSTANCE LIST IS THE READ AUTHORITY (B3 Task 10) ───────────
//
// ⭐ THIS FILE WAS `flipBWithANonEmptySet.test.jsx`, WHICH MOCKED
// `ENGINE_FLIPPED_DEF_IDS` TO `{rsi}` BECAUSE THE SHIPPED SET WAS EMPTY. Task 10
// flipped `rsi` AND `bb` for real, so the mock would now UNDER-state the shipped
// set: its "an UN-FLIPPED migrated definition is untouched" case named `bb`, and
// it would have gone on passing — green, against a constant that no longer
// matched production. That is the control-rot shape this branch keeps finding, so
// the mock is GONE and every case here drives the real constant. The un-flipped
// subject is `macd`, with a non-vacuity rail that fails when Task 11 takes it.
//
// The lightweight-charts double is `macdHeadMaskRendered.test.jsx`'s, plus the
// binder wrapper from `stockChartWiring.test.jsx` — the band map is handed to the
// binder through its sync ctx, and that is where the layout's effect is
// observable at the component level.
//
// ⚠️ WHY THE MOCKS ARE DUPLICATED RATHER THAN IMPORTED FROM A SHARED HARNESS.
// `vi.mock` factories are hoisted by the transform IN THE FILE THAT CONTAINS
// THEM; a shared `installEngineTestMocks()` called at module top-level registers
// them at RUNTIME, after this file's own static imports have already resolved.
// The brief asked for the extraction; the cost of getting it subtly wrong is a
// suite that silently mocks nothing, which is the exact failure this whole branch
// keeps auditing for. The doubles are ~120 lines and this is the second file that
// needs them, not the fifth.

const H = vi.hoisted(() => ({
  addSeriesCalls: [],
  // Every `series.applyOptions({visible})`, so Alt+Shift+I is observable at all.
  visibilityCalls: [],
  removedSeries: [],
  binderApis: [],
  syncCalls: [],
  // Price lines are not series, so no addSeries count can see MACD's zero guide
  // going missing with the block that drew it.
  priceLineCalls: [],
  // The NON-VACUITY half of `stockChartWiring`'s "the migrator never runs while
  // nothing is flipped". A gate asserted only in its closed state is a gate that
  // could be welded shut.
  migrateCalls: 0,
  reset() {
    H.addSeriesCalls.length = 0
    H.visibilityCalls.length = 0
    H.removedSeries.length = 0
    H.binderApis.length = 0
    H.syncCalls.length = 0
    H.priceLineCalls.length = 0
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

// ⛔ NO `vi.mock` FOR `flipState`. The shipped constant IS the subject now; a
// mock here would make every case below a test of the mock.
vi.mock('lightweight-charts', () => {
  const makeSeries = (ctor) => {
    const s = {
      __ctor: ctor,
      setData: () => {}, update: () => {},
      applyOptions: (o) => { if (o && 'visible' in o) H.visibilityCalls.push({ series: s, visible: o.visible }) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: (o) => { H.priceLineCalls.push({ series: s, options: o }); return {} },
      removePriceLine: () => {}, setMarkers: () => {},
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
    removeSeries: (ser) => { H.removedSeries.push(ser) }, applyOptions: () => {},
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

// ─── ⭐ B5 TASK 12 (FLIP C): THIS FILE IS PINNED TO `'bands'`, DELIBERATELY ───
//
// Every case here is about the READ AUTHORITY — which instance draws, and whether
// the legacy toggle or the instance list decides — and its HANDLE on a pane
// oscillator is the price scale NAMED AFTER THE DEFINITION (`rsiSeries`,
// `macdSeries` below), which is `applyIndScale`'s Flip-A transcription. Flip C
// moves that scale to `'right'` on a real pane (sub-choice 2.2), where it no
// longer discriminates anything: the candles and all five price overlays are on
// `'right'` too, so `filter(priceScaleId === 'right')` would count four unrelated
// series and `bindings()` alone would stop seeing a resurrected legacy block —
// which is precisely what half these cases exist to catch.
//
// ⛔ SO THE MODE IS PINNED RATHER THAN THE ASSERTIONS WEAKENED. `'bands'` is a
// live, tested mode — `paneLayout.js` keeps it for exactly this reason, and it is
// the geometry Flip C reverses TO — and `paneMode()` is a function so that both
// modes can be driven in one process. The band claims below are bands-mode claims
// by construction; the SHIPPED `'panes'` geometry is gated by
// `__tests__/flipCGeometry.test.jsx` and the 46-case pixel gate, not here.
//
// ⚠️ WHAT THAT COSTS, STATED: a Flip-C-only regression in the read authority (an
// instance the `'panes'` branch of `resolvePlacement` drops, say) is invisible in
// this file. `flipCGeometry.test.jsx` is where that lives.
beforeEach(() => {
  cleanup()
  H.reset()
  __setPaneModeForTest('bands')
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => { __setPaneModeForTest(null) })

const { default: StockChart, ENGINE_FLIPPED_DEF_IDS, ENGINE_MIGRATED_DEF_IDS } = await import('../../../StockChart')
const { setIndicatorEnabled, setIndicatorInput, isIndicatorEnabled } = await import('../instanceControls')
const registry = await import('../nativeRegistry')
const { computePaneLayout, __setPaneModeForTest } = await import('../paneLayout')
const { chartStateToUrl, urlToChartState } = await import('../../chartScreenshot')

/** The band map the layout reserves for a chart holding exactly `instances`.
 *
 *  ⭐ THIS REPLACES `computePaneMargins(cs, true, new Set())`, WHICH TASK 12
 *  DELETED. Same arithmetic off the same quantised stack — `paneLayout.js`
 *  absorbed it whole — but keyed on the INSTANCE LIST instead of on
 *  `cs.indicators[key].enabled`, which is the retirement itself: there is no
 *  second blob to project any more. `hasVolumeBand: true` is what `StockChart`
 *  computes for these fixtures (volume visible, not in its own pane). */
const bandsFor = (instances) =>
  computePaneLayout(instances, { hasVolumeBand: true, excludeKeys: new Set() }).bands

const BARS = bars200.bars
const RSI_INSTANCE = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' }, hidden: false }
const BB_COLOUR = 'rgba(156,39,176,0.85)'
const draw = (settingsOverride, extraProps) => render(
  <StockChart sym="AAPL" tf="D" barsOverride={BARS} settingsOverride={settingsOverride} {...extraProps} />,
)
/** Series created on RSI's own named price scale — the deleted legacy block used
 *  it too, which is why the binder count below is the discriminator. */
const rsiSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'rsi')
const bbSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.color === BB_COLOUR)
const ctx = () => {
  const c = H.syncCalls.at(-1)
  expect(c, 'the binder was never synced — this test is vacuous').toBeTruthy()
  return c
}
const bound = () => (H.binderApis[0] ? H.binderApis[0].bindings() : [])

describe('Flip B — the set itself', () => {
  it('flips the four pilots AND B5\'s migrations, and stays a SUBSET of the migrated set', () => {
    // Flipped-but-not-migrated means the legacy block was deleted and nothing
    // replaced it — an indicator that renders nothing at all.
    // ⭐ `stoch` and `atr` joined at B5 Task 5, `sar` and `ichimoku` at Task 6,
    // `mfi`, `cci` and `williamsR` at Task 7, and `adx`, `obv` and `donchian` at
    // Task 8 — each group migrated and flipped in ONE commit. This literal moves
    // once per B5 migration task, deliberately: it is the place a flip has to be
    // WRITTEN DOWN, not derived.
    //
    // ⭐⭐ AND IT HAS MOVED FOR THE LAST TIME. Fourteen is every series-expressible
    // definition there is, so this literal now equals `listDefinitions()` — the
    // equality Task 13 deletes both sets in favour of. Written out rather than
    // derived precisely because a derived expectation agrees with the code by
    // construction: an id silently dropped from the registry would keep a derived
    // version green and fails this one by name.
    expect([...ENGINE_FLIPPED_DEF_IDS].sort()).toEqual(
      ['adx', 'atr', 'bb', 'cci', 'donchian', 'ichimoku', 'macd', 'mfi', 'obv', 'rsi', 'sar',
        'stoch', 'vwap', 'williamsR'])
    for (const id of ENGINE_FLIPPED_DEF_IDS) expect(ENGINE_MIGRATED_DEF_IDS.has(id), id).toBe(true)
  })

  it('⭐ …and NOTHING is migrated-but-UN-FLIPPED — the rail that re-opens three decisions', () => {
    // ⛔ THIS IS NOT A RESTATEMENT OF THE CASE ABOVE. Task 11 deleted three
    // things whose only justification is that this list is EMPTY:
    //
    //   1. StockChart's Flip-A `hidden` projection and its `legacyEnabled`
    //      helper — "an instance of a migrated-but-un-flipped definition whose
    //      legacy toggle is false is projected to hidden";
    //   2. the `engineOn &&` gate on `vwapOverride`'s forced instance;
    //   3. `ChartToolbar.engineInert`'s subject, which is why that file now pins
    //      the WIRING rather than a disabled row.
    //
    // The day B4 migrates a fifth definition WITHOUT flipping it, all three are
    // wrong again — and the symptom of (1) is a double-drawn indicator, which is
    // the single most-repeated defect on this branch and is invisible in a
    // screenshot. So it fails HERE, loudly, at the moment the premise changes.
    const unflipped = [...ENGINE_MIGRATED_DEF_IDS].filter(id => !ENGINE_FLIPPED_DEF_IDS.has(id))
    expect(unflipped,
      'a MIGRATED definition is not FLIPPED. Flip A is live again, and StockChart\'s '
      + '`hidden` projection (deleted in Task 11) has to come back with it — see the '
      + 'note where it used to be, and `vwapOverride`\'s forced-instance gate').toEqual([])
  })
})

describe('Flip B — the instance list is the read authority', () => {
  it('⭐ a LEGACY-ONLY blob still draws BOTH — through the engine', () => {
    // ⛔ THE COMPATIBILITY CASE, AND THE ONE EVERY EXISTING USER IS IN. A user who
    // has not touched a control since the flip has `indicators.rsi.enabled` and no
    // instance anywhere. The read-time migrator projects it; the engine draws it;
    // nothing is missing.
    draw({
      indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' },
                    bb: { enabled: true, period: 20, stdDev: 2, color: BB_COLOUR } },
    })
    expect(rsiSeries()).toHaveLength(1)
    expect(bbSeries()).toHaveLength(3)
    expect(bound(), 'the ENGINE must be what drew them').toHaveLength(4)
  })

  it('⭐ …and with `engineEnabled` ABSENT too, which is every stored blob in production', () => {
    // `mergeChartSettings` computes `engineEnabled: parsed.engineEnabled === true`
    // from the STORED BLOB, not from `CHART_DEFAULTS` — so every existing user
    // reads FALSE and flipping the default cannot heal one. A flipped definition
    // therefore runs the engine regardless: the alternative is not "the engine is
    // dark", it is "RSI and Bollinger Bands are deleted".
    draw({
      indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' },
                    bb: { enabled: true, period: 20, stdDev: 2, color: BB_COLOUR } },
    })
    expect(rsiSeries(), 'a flag-off chart lost its RSI').toHaveLength(1)
    expect(bbSeries(), 'a flag-off chart lost its Bollinger Bands').toHaveLength(3)
    expect(bound()).toHaveLength(4)
  })

  it('…and a definition the engine was NEVER GIVEN never reaches it, leftover flag or not', () => {
    // ⚠️ THE SUBJECT MOVED FOUR TIMES AND THEN RAN OUT, WHICH IS THE POINT OF
    // THIS PARAGRAPH. It was `macd` (Task 11's narrowing), then `stoch` (B5 Task
    // 5), then `mfi` (Task 7), then `adx` — each time going RED by name rather
    // than passing on a definition that had migrated underneath it, and each time
    // the note said the next migrator would have to move it again. B5 TASK 8 TOOK
    // THE LAST THREE (`adx`, `obv`, `donchian`), so **there is no un-migrated
    // definition left and there never will be**: `ENGINE_FLIPPED_DEF_IDS` equals
    // `listDefinitions()`.
    //
    // ⛔ SO IT MOVES DOWN A LEVEL RATHER THAN BEING DELETED, exactly as
    // `stockChartWiring`'s chip control did at Task 6. A control with no subject
    // that stays green is a defect; a control whose subject was a POPULATION is
    // re-pointed at the MECHANISM that population was standing in for. Two
    // subjects, neither of which can ever expire:
    //
    //   1. `volumeProfile` — the ONE indicator key with NO definition at all. It
    //      is structurally carved out (`CARVED_OUT_INDICATOR_KEYS`), it is not
    //      series-expressible (a horizontal histogram on its own canvas), and
    //      spec §5 keeps it that way — so "an indicator the engine has never been
    //      given" has a permanent instance.
    //   2. a defId the registry does not know at all — the shape a stale share
    //      link or a hand-edited blob produces.
    //
    // Both must reach the engine as NOTHING, and neither may throw.
    for (const leftover of [undefined, true]) {
      cleanup(); H.reset()
      draw({
        engineEnabled: leftover,
        indicators: { volumeProfile: { enabled: true } },
        indicatorInstances: [
          { instanceId: 'legacy:volumeProfile', defId: 'volumeProfile', inputs: {}, hidden: false },
          { instanceId: 'x:bogus', defId: '__notADefinition', inputs: {}, hidden: false },
        ],
      })
      expect(bound(), `something reached the engine with a leftover flag ${leftover}`).toHaveLength(0)
      expect(H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'volumeProfile').length,
        'the engine invented a volumeProfile scale').toBe(0)
    }
    // ⛔ AND THE CONTROL THAT THIS IS A FILTER AND NOT A DEAD ENGINE: the same
    // chart with a REAL flipped definition on binds it. Without this the loop
    // above passes on a component that draws nothing at all.
    cleanup(); H.reset()
    draw({
      indicators: { volumeProfile: { enabled: true }, rsi: { enabled: true, period: 14 } },
    })
    expect(bound(), 'the engine bound nothing — the loop above proves nothing').toHaveLength(1)
    expect(rsiSeries()).toHaveLength(1)
    // …and the two reasons the two subjects are refused are DIFFERENT, which is
    // why both are here: one has no definition to resolve, the other is not in
    // the flip set. The first is the durable one.
    expect(registry.getDefinition('volumeProfile'), 'volumeProfile gained a definition — '
      + 'this control needs re-reading, and so does spec §5').toBeNull()
    expect(registry.CARVED_OUT_INDICATOR_KEYS.has('volumeProfile')).toBe(true)
  })

  it('a stored INSTANCE beats a false legacy toggle — instances are authoritative', () => {
    draw({
      indicators: { rsi: { enabled: false } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 21 }, hidden: false }],
    })
    expect(rsiSeries(), 'the toggle says off; the instance says on, and it wins').toHaveLength(1)
    // …and the BAND was reserved for it, which is the LAYOUT half: the band map
    // is keyed off the instance list too, so a stored instance with a false toggle
    // has to reserve space as well as draw (`computePaneLayout`, B5 Task 12 — it
    // was `paneMarginsProjection.js` rewriting a throwaway `cs` until then).
    expect(ctx().paneMargins.rsi, 'no band was reserved — the layout is not wired')
      .toEqual({ top: 0.85, bottom: 0 })
  })

  it('a TOMBSTONE beats a true legacy toggle — "off" stays off', () => {
    // ⚠️ BB IS ON HERE AND IT IS LOAD-BEARING, for two reasons that arrived
    // together at B5 Task 4. The old fixture had RSI alone plus its tombstone,
    // and relied on `engineEnabled: true` to make StockChart construct a binder
    // with nothing in it — the flag is deleted, and `engineNeeded` is now
    // honestly `engineInstances.length > 0`, so that chart builds no binder and
    // `ctx()` has nothing to read.
    //
    // Keeping ONE live instance is also the stronger assertion: `paneMargins.rsi`
    // being undefined on an EMPTY margins object proves nothing, and the BB line
    // below is what makes the object real.
    draw({
      indicators: {
        rsi: { enabled: true, period: 14 },
        bb: { enabled: true, period: 20, stdDev: 2, color: BB_COLOUR },
      },
      indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }],
    })
    expect(rsiSeries()).toHaveLength(0)
    expect(bbSeries(), 'the control indicator did not draw — the margins below are empty')
      .not.toHaveLength(0)
    expect(ctx().paneMargins.rsi, 'a deleted indicator must not reserve a band').toBeUndefined()
  })

  it('the band the engine lands in is EXACTLY the one the legacy layout reserved', () => {
    // ⭐ THE LITERAL IS THE ORACLE NOW, AND IT IS THE SAME NUMBER IT ALWAYS WAS.
    // This case compared the binder's `paneMargins` against `computePaneMargins`
    // called on the same blob — the pre-engine layout function, unmodified. Task
    // 12 deleted that function, and its output is `computePaneLayout(...).bands`;
    // the comparison below is therefore a WIRING claim (StockChart hands the
    // binder the layout's band map for the chart's own instances, not `{}` and not
    // the pane geometry), and `{top: 0.85, bottom: 0}` — RSI's shipped slice,
    // transcribed from the retired table — is what pins the VALUE independently.
    draw({ indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } })
    expect(ctx().paneMargins.rsi).toEqual({ top: 0.85, bottom: 0 })
    expect(ctx().paneMargins).toEqual(bandsFor([RSI_INSTANCE]))
  })

  it('the legacy render blocks are GONE — no ref, no second copy, ever', () => {
    // With the engine holding NOTHING for a flipped id there is no hand-written
    // block left to draw it. A tombstone is the only way to reach that state, and
    // it must produce zero series rather than a legacy fallback.
    draw({
      indicators: { rsi: { enabled: true }, bb: { enabled: true, period: 20, stdDev: 2, color: BB_COLOUR } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }, { instanceId: 'legacy:bb', deleted: true }],
    })
    expect(rsiSeries(), 'a legacy RSI block still exists').toHaveLength(0)
    expect(bbSeries(), 'a legacy Bollinger block still exists').toHaveLength(0)
  })

  it('hide-all still reaches both, through the binding map', () => {
    draw({
      indicators: { rsi: { enabled: true }, bb: { enabled: true, period: 20, stdDev: 2, color: BB_COLOUR } },
    })
    const series = [...rsiSeries(), ...bbSeries()].map(c => c.series)
    expect(series, 'nothing drawn — vacuous').toHaveLength(4)
    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })
    for (const s of series) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === false).length,
        'a flipped indicator dropped out of the declutter toggle').toBeGreaterThan(0)
    }
  })
})

describe('Flip B — the control surfaces write instances', () => {
  it('Ctrl+I toggles RSI by writing an instance AND the mirror', () => {
    const writes = []
    const view = draw({ indicators: { rsi: { enabled: false } } },
      { onSettingsPersist: (next) => writes.push(next) })
    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'i' }) })
    expect(writes, 'Ctrl+I wrote nothing').not.toHaveLength(0)
    const next = writes.at(-1)
    expect(next.indicatorInstances.some(i => i.defId === 'rsi' && !i.deleted)).toBe(true)
    expect(next.indicators.rsi.enabled, 'the mirror keeps the alert evaluator alive').toBe(true)
    view.unmount()
  })

  it('Ctrl+B toggles BB the same way — both pilots, one writer', () => {
    const writes = []
    const view = draw({ indicators: { bb: { enabled: false } } },
      { onSettingsPersist: (next) => writes.push(next) })
    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'b' }) })
    expect(writes, 'Ctrl+B wrote nothing').not.toHaveLength(0)
    const next = writes.at(-1)
    expect(next.indicatorInstances.some(i => i.defId === 'bb' && !i.deleted)).toBe(true)
    expect(next.indicators.bb.enabled).toBe(true)
    view.unmount()
  })

  it('a settings round-trip survives: on → off → re-read stays off', () => {
    let cs = { indicators: { rsi: { enabled: false, period: 14, color: '#7b68ee' } }, indicatorInstances: [] }
    cs = setIndicatorEnabled(cs, 'rsi', true, registry)
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
    cs = setIndicatorEnabled(cs, 'rsi', false, registry)
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS)).toBe(false)

    cleanup(); H.reset()
    draw({ ...cs })
    expect(rsiSeries(), 'it came back on refresh — the tombstone did not persist').toHaveLength(0)
  })

  it('the legacy mirror moves with the instance, in both directions', () => {
    // ⛔ THIS NOTE WAS WRONG TWICE, AND THE ASSERTIONS WERE FINE — corrected at B4
    // rather than deleted, because a comment that states a false REASON is the
    // same rot class as a doc quoting a test's expected literal.
    //
    // It used to read: "`IndicatorAlertPopover` reads its own INDICATORS list and
    // the evaluator reads `cs.indicators`."
    //   1. THE LIST IS GONE. B4's alert-catalog task (`0d0d4c93`) deleted the
    //      popover's `INDICATORS`/`CONDITIONS`; it fetches
    //      `GET /api/indicator-alerts/catalog`, derived from the evaluator.
    //   2. **THE POPOVER NEVER READ `cs.indicators` AT ALL** — not before B4 and
    //      not after. It reads the catalog and writes an alert row.
    //   3. And the EVALUATOR does not read chart settings either: it takes its
    //      parameters from `params_json` on the alert row and its bars from
    //      `bars_sqlite`. `cs.indicators` reaches it through neither.
    //
    // What is actually true — and what these assertions have always checked — is
    // narrower and still worth a case: `setIndicatorEnabled` writes the INSTANCE
    // and the legacy MIRROR together, in both directions, so any surface still
    // reading `cs.indicators.<id>.enabled` (the screener, the `?indicators=`
    // render route, a tab on an older build) agrees with the chart.
    // `instanceControls.test.js` owns the write-through invariant in general;
    // this is the flipped-pilot instance of it.
    let cs = { indicators: { rsi: { enabled: false, period: 14 } }, indicatorInstances: [] }
    cs = setIndicatorEnabled(cs, 'rsi', true, registry)
    expect(cs.indicators.rsi.enabled).toBe(true)
    cs = setIndicatorEnabled(cs, 'rsi', false, registry)
    expect(cs.indicators.rsi.enabled).toBe(false)
  })

  it('a period written through the control reaches the CHART, not just the blob', () => {
    // The end-to-end the two halves above cannot see between them: the writer's
    // output, rendered.
    let cs = {
      indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } },
      indicatorInstances: [],
    }
    cs = setIndicatorInput(cs, 'rsi', 'period', '7', registry)
    draw(cs)
    const b = bound()
    expect(b, 'the written period did not reach a binding').toHaveLength(1)
    expect(b[0].key, 'the instance the control wrote is not the one drawn').toContain('legacy:rsi')
    expect(cs.indicators.rsi.period, 'the mirror was not written').toBe(7)
  })
})

describe('Flip B — the right-click menu is a control surface too', () => {
  it('the Indicators submenu reads the INSTANCE list, not the toggle', () => {
    // A tombstone with a still-true toggle: the menu item must read unchecked, or
    // clicking it would "enable" something already enabled and turn it off.
    const cs = {
      indicators: { rsi: { enabled: true } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }],
    }
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS),
      'the menu and the chart disagree about whether RSI is on').toBe(false)
    draw(cs)
    expect(rsiSeries(), 'and the chart agrees with the menu').toHaveLength(0)
  })
})

// ─── ENUMERATION SITE #20 — "Copy chart link" after the authority flipped ───
//
// ⛔ A FLIP-B LANDMINE THE PLAN ASSIGNED TO THIS TASK. `handleCopyShareUrl`
// carried NEITHER `indicatorInstances` NOR `engineEnabled`. At Flip A that was
// harmless: `cs.indicators.<id>.enabled` was the authority, so a shared link
// reproduced the chart. **At Flip B `enabled` stops being the authority** — the
// sender's RSI may exist only as an instance, and a tombstone can make a
// still-true toggle mean "off" — so the link would have silently dropped RSI and
// Bollinger Bands from every shared chart, and the RECIPIENT's own tombstone
// would have swallowed the toggle it did carry.
//
// ⚠️ THE OTHER HALF OF THAT SENTENCE IS NOW STALE AND IS DELIBERATELY GONE. This
// note used to open "hand-lists exactly the four B3 pilots"; **B4 Task 5 ended
// the hand-list** — `handleCopyShareUrl` derives its key set from `catalogRows()`
// and answers each one through `isIndicatorEnabled`. The cases below are about
// the ENGINE KEYS and are unaffected; the derivation's own gate lives in
// `stockChartWiring.test.jsx` → *"B4 Task 5 — the share link is derived"*.
describe('Flip B — a shared chart link carries what now decides the picture', () => {
  const applyState = (state) => {
    window.history.replaceState({}, '', `?state=${chartStateToUrl(state)}`)
    const persisted = []
    const view = render(
      <StockChart sym="AAPL" tf="D" barsOverride={BARS}
        settingsOverride={{ indicators: { rsi: { enabled: false } } }}
        onSettingsPersist={(s) => persisted.push(s)} />,
    )
    window.history.replaceState({}, '', '/')
    return { view, persisted }
  }

  it('the encoder round-trips both engine keys — they are not dropped by the codec', () => {
    const state = {
      sym: 'AAPL', tf: 'D',
      indicators: { rsi: { enabled: true }, bb: { enabled: false } },
      engineEnabled: true,
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 21 }, hidden: false }],
    }
    const back = urlToChartState(chartStateToUrl(state))
    expect(back.indicatorInstances).toEqual(state.indicatorInstances)
    expect(back.engineEnabled).toBe(true)
  })

  it('⭐ the RECIPIENT gets the sender\'s instances, REPLACING their own', () => {
    // ⚠️ REPLACED, NOT MERGED. `mergeSettingsOverride`'s union-by-id is right for a
    // grid cell holding a partial blob; a share link is a complete description of
    // somebody else's chart. Unioning would leave the recipient's tombstone in
    // place and turn the sender's RSI straight back off on arrival — the exact
    // defect Flip B makes possible, and the reason the apply path assigns rather
    // than merges.
    const { persisted } = applyState({
      sym: 'AAPL', tf: 'D',
      indicators: { rsi: { enabled: true } },
      engineEnabled: true,
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 21 }, hidden: false }],
    })
    expect(persisted.length, 'the share state was never applied — this case is vacuous').toBeGreaterThan(0)
    const next = persisted.at(-1)
    expect(next.indicatorInstances, 'the link\'s instances did not survive the apply')
      .toEqual([{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 21 }, hidden: false }])
    // ⭐ AND THE OLD LINK'S FLAG IS IGNORED, DELIBERATELY (B5 Task 4). This asserted
    // `next.engineEnabled === true` — the decode copied the sender's flag forward.
    // Links minted before the deletion still CARRY it (the fixture above is one),
    // and copying it into the recipient's stored blob would put a key there that
    // nothing declares and nothing removes until their next save.
    expect('engineEnabled' in next,
      'the share-link decode copied a deleted key into the recipient\'s blob').toBe(false)
  })

  it('…and a link that carries a TOMBSTONE turns the recipient\'s copy off', () => {
    // The other direction, and the one a merge would break: the sender deleted
    // RSI, so the recipient must not keep drawing theirs.
    const { persisted } = applyState({
      sym: 'AAPL', tf: 'D',
      indicators: { rsi: { enabled: false } },
      engineEnabled: false,
      indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }],
    })
    const next = persisted.at(-1)
    expect(next.indicatorInstances).toEqual([{ instanceId: 'legacy:rsi', deleted: true }])
    cleanup(); H.reset()
    draw(next)
    expect(rsiSeries(), 'the shared "off" did not survive the trip').toHaveLength(0)
  })

  it('the SENDER reads the enabled bits through the flip-aware reader, not the raw toggle', () => {
    // The emit half, gated structurally because the button is behind a popover.
    // A tombstoned RSI with a still-true toggle must serialise as OFF; reading
    // `cs.indicators.rsi.enabled` directly answers ON.
    const cs = {
      indicators: { rsi: { enabled: true } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }],
    }
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS),
      'the reader the share state uses would put a deleted RSI in the link').toBe(false)
    expect(cs.indicators.rsi.enabled,
      'the raw toggle and the reader agree — this case cannot see the bug').toBe(true)
  })
})

// ─── THE FOUR DOORS, AND THE TWO THAT ONLY SOURCE CAN REACH ────────────────
//
// `cs.indicators.<id>.enabled` has FOUR writers: the toolbar checkbox, the
// keyboard (Ctrl+I / Ctrl+B / Ctrl+O), the right-click **Indicators ▸** submenu
// and right-click **Hide <label>**. Under Flip A they all wrote the same field
// and agreed by construction. After Flip B that field is a MIRROR for a flipped
// id, so a door still writing it directly ticks a box the chart disagrees with —
// and "Hide RSI" clears the mirror while the instance keeps drawing.
//
// The first two are driven behaviourally above.
//
// ⛔ THIS BLOCK'S PREMISE IS DEAD, AND SAYING SO IS THE POINT. It used to open:
// *"the right-click menu is built inside `buildRegionSections`, which is only
// reachable through a real `contextmenu` on a canvas region the jsdom double
// cannot produce, so it is gated STRUCTURALLY here … the alternative is NO gate
// on two of the four doors."* B4 Task 3 produced that contextmenu — the chart
// double records the container `createChart` is handed, a rect is stubbed on it
// for the length of the dispatch, and `stockChartWiring.test.jsx`'s
// `openContextMenu` scans for the region it wants and reads the sections off the
// payload. **Both doors are driven behaviourally now**, including the write, for
// a flipped id and an un-flipped one.
//
// These three cases STAY, downgraded from "the only gate" to a source-level
// backstop: they are what fails if a raw `setCs('indicators.…')` is reintroduced
// anywhere inside those two blocks, including on a branch no fixture happens to
// reach. A rail kept for a reason it still has is not the same thing as a rail
// kept because nobody re-read it.
describe('Flip B — the right-click doors route through the one reader and the one writer', () => {
  // ⚠️ Resolved from the vitest ROOT, not from `import.meta.url` — the module
  // graph here is served through vite, so `import.meta.url` is an http: URL in
  // this environment and `fileURLToPath` throws on it.
  const SRC = readFileSync(resolve(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')

  /** The submenu literal, sliced by its own marker so a rename fails loudly
   *  rather than silently matching nothing. */
  const slice = (from, to) => {
    const a = SRC.indexOf(from)
    expect(a, `marker not found in StockChart.jsx: ${from}`).toBeGreaterThan(-1)
    const b = SRC.indexOf(to, a)
    expect(b, `end marker not found after ${from}`).toBeGreaterThan(a)
    return SRC.slice(a, b)
  }

  it('the Indicators submenu READS through isIndicatorEnabled, not the raw toggle', () => {
    const block = slice("const indicatorsItem = {", "// \"Overlay on volume\"")
    expect(block, 'the submenu still reads the legacy toggle directly')
      .not.toMatch(/checked:\s*!!cs\.indicators/)
    expect(block).toMatch(/checked:\s*indEnabled\(row\.id\)/)
  })

  it('…and WRITES through setIndEnabled, which routes a flipped id at the instance', () => {
    const block = slice("const indicatorsItem = {", "// \"Overlay on volume\"")
    expect(block, 'the submenu writes `indicators.<key>.enabled` directly')
      .not.toMatch(/setCs\(`indicators\./)
    expect(block).toMatch(/setIndEnabled\(row\.id,/)
  })

  it('right-click "Hide <label>" writes through the same door', () => {
    const block = slice("{ id: 'i-hide'", "...settingsLink('i-set'")
    expect(block, '"Hide RSI" clears the mirror while the instance keeps drawing')
      .not.toMatch(/setCs\(`indicators\./)
    expect(block).toMatch(/setIndEnabled\(key, false\)/)
  })

  it('…and setIndEnabled really does route a flipped id — the reader is not the whole fix', () => {
    // The rails above are string matches; this is the behaviour they stand for,
    // asserted on the writer they name. Without it a `setIndEnabled` that called
    // `setCs` for every id would satisfy all three.
    let cs = { indicators: { rsi: { enabled: true, period: 14 } }, indicatorInstances: [] }
    cs = setIndicatorEnabled(cs, 'rsi', false, registry)
    expect(cs.indicatorInstances).toContainEqual({ instanceId: 'legacy:rsi', deleted: true })
    expect(cs.indicators.rsi.enabled).toBe(false)
  })
})


// ═══════════════════════════════════════════════════════════════════════════
// ─── FLIP B FOR MACD AND VWAP (B3 Task 11) ────────────────────────────────
//
// The other two pilots. Three things make them different from RSI and BB, and
// each gets its own case rather than riding on the pair above:
//
//   * MACD is THREE plots under ONE instance, and two of them are legend chips
//     whose slots were fed by `macdLineRef` / `macdSignalRef`. Deleting the refs
//     takes both chips out of the readout at once, and no pixel gate run without
//     a cursor can see a legend nobody hovered. Driven in `stockChartWiring`,
//     which owns the settled-legend harness.
//   * VWAP is INTRADAY-ONLY, so every case here that expects a line has to draw
//     the 5-minute fixture. A VWAP case on `ramp200` renders an empty chart on
//     both sides and reports whatever you asked it to.
//   * VWAP's enable signal is not the toggle alone: `vwapOverride` forces it on,
//     and after the flip there is no legacy block left to catch that.

const INTRADAY_BARS = intraday5m.bars
const drawIntraday = (settingsOverride, extraProps) => render(
  <StockChart sym="AAPL" tf="5" barsOverride={INTRADAY_BARS}
    settingsOverride={settingsOverride} {...extraProps} />,
)
/** Every series on MACD's own named scale — the deleted legacy block used it too,
 *  which is why the binding count is the discriminator and not this alone. */
const macdSeries = () => H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'macd')
/** VWAP is a PRICE overlay: no named scale, so the colour is the handle. */
const vwapSeries = (color = '#26C6DA') =>
  H.addSeriesCalls.filter(c => c.options && c.options.color === color && c.ctor === 'LineSeries')

describe('Flip B — MACD', () => {
  const MACD_ON = { indicators: { macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } } }

  it('is flipped, and its legacy block is GONE', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.has('macd')).toBe(true)
    // ⚠️ REACHED THROUGH A TOMBSTONE, not through a flag-off legacy blob. The
    // brief's version drew `{indicators:{macd:{enabled:true}}}` with the flag off
    // and expected zero series — but that is the COMPATIBILITY case and it draws
    // three (Task 10 §9.9). A tombstone is the only blob for which a flipped
    // definition renders nothing, so it is the only one that can tell "the legacy
    // block is deleted" from "the engine is off".
    draw({ ...MACD_ON, indicatorInstances: [{ instanceId: 'legacy:macd', deleted: true }] })
    expect(macdSeries(), 'a legacy MACD block still exists').toHaveLength(0)
    expect(bound()).toHaveLength(0)
  })

  it('⭐ a legacy-only blob draws all three plots through the engine', () => {
    draw({ ...MACD_ON })
    expect(macdSeries()).toHaveLength(3)
    expect(bound(), 'the ENGINE must be what drew them').toHaveLength(3)
    // …and the three are the three, not one plot bound three times.
    expect(bound().map(b => b.plotKey).sort()).toEqual(['histogram', 'macd', 'signal'])
  })

  it('⭐ …and with `engineEnabled` ABSENT, which is every stored blob in production', () => {
    draw(MACD_ON)
    expect(macdSeries(), 'a flag-off chart lost its MACD').toHaveLength(3)
    expect(bound()).toHaveLength(3)
  })

  it('the zero guide still comes with it — one price line, on the MACD line', () => {
    // The legacy block drew `createPriceLine({price: 0, ...})` on `macdLineRef`.
    // It is not a series, so no series count can see it going missing.
    draw({ ...MACD_ON })
    const lines = H.priceLineCalls.filter(c => c.options && c.options.price === 0)
    expect(lines, 'the zero guide vanished with the legacy block').toHaveLength(1)
  })

  it('Ctrl+O writes an INSTANCE, and the mirror with it', () => {
    const writes = []
    const view = draw({ indicators: { macd: { enabled: false } } },
      { onSettingsPersist: (next) => writes.push(next) })
    act(() => { fireEvent.keyDown(document, { ctrlKey: true, key: 'o' }) })
    expect(writes, 'Ctrl+O wrote nothing').not.toHaveLength(0)
    const next = writes.at(-1)
    expect(next.indicatorInstances.some(i => i.defId === 'macd' && !i.deleted)).toBe(true)
    expect(next.indicators.macd.enabled, 'the mirror keeps the alert evaluator alive').toBe(true)
    view.unmount()
  })

  it('the band still comes from the projection, and it is the LEGACY band', () => {
    // The instance is the switch now, so a false toggle must not shrink the band
    // out from under a live instance.
    draw({
      indicators: { macd: { enabled: false } },
      indicatorInstances: [{ instanceId: 'legacy:macd', defId: 'macd', inputs: {}, hidden: false }],
    })
    expect(ctx().paneMargins.macd, 'no band was reserved — the projection is not wired').toBeTruthy()
    expect(ctx().paneMargins.macd)
      .toEqual(bandsFor([{ instanceId: 'legacy:macd', defId: 'macd', inputs: {}, hidden: false }]).macd)
  })

  it('a tombstone reserves NO band, and draws nothing', () => {
    // ⚠️ RSI IS ON HERE AND IT IS LOAD-BEARING — same reason as the RSI tombstone
    // case above. `engineNeeded` is `engineInstances.length > 0` since B5 Task 4,
    // so a chart holding only a tombstone constructs no binder at all and `ctx()`
    // has nothing to read; and an `undefined` band on an EMPTY margins object
    // proves nothing. The live RSI supplies both.
    draw({
      ...MACD_ON,
      indicators: { ...MACD_ON.indicators, rsi: { enabled: true, period: 14 } },
      indicatorInstances: [{ instanceId: 'legacy:macd', deleted: true }],
    })
    expect(macdSeries()).toHaveLength(0)
    expect(ctx().paneMargins.rsi, 'the control indicator reserved no band — the object is empty')
      .toBeTruthy()
    expect(ctx().paneMargins.macd, 'a deleted indicator must not reserve a band').toBeUndefined()
  })
})

describe('Flip B — VWAP', () => {
  const VWAP_CFG = { enabled: true, color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 }
  const VWAP_ON = { indicators: { vwap: VWAP_CFG } }

  it('is flipped, and its legacy block is GONE', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.has('vwap')).toBe(true)
    // ⚠️ INTRADAY, or the eligibility gate hides it and this proves nothing.
    drawIntraday({ ...VWAP_ON, indicatorInstances: [{ instanceId: 'legacy:vwap', deleted: true }] })
    expect(vwapSeries(), 'a legacy VWAP block still exists').toHaveLength(0)
    expect(bound()).toHaveLength(0)
  })

  it('⭐ a legacy-only blob draws it on an intraday chart, flag or no flag', () => {
    // Same re-pointing as the Stochastic control above: the loop is over a
    // LEFTOVER `engineEnabled` a stale blob can carry, not over a live flag.
    for (const leftover of [true, undefined]) {
      cleanup(); H.reset()
      drawIntraday({ engineEnabled: leftover, ...VWAP_ON })
      expect(vwapSeries(), `leftover=${leftover}: the chart lost its VWAP`).toHaveLength(1)
      expect(bound(), 'the ENGINE must be what drew it').toHaveLength(1)
    }
  })

  it('still draws NOTHING on a daily chart, flipped or not', () => {
    draw({ ...VWAP_ON })
    expect(vwapSeries(), 'a session VWAP on daily bars').toHaveLength(0)
    expect(bound(), 'the engine drew a session VWAP on daily bars').toHaveLength(0)
  })

  it('⭐ vwapOverride still forces it on with no instance, no toggle AND NO FLAG', () => {
    // ⛔ THE ONE THAT CHANGED BEHAVIOUR AT THE FLIP. The forced instance used to
    // be gated on `engineOn`, because VWAP was un-flipped and its legacy block
    // drew the override. There is no legacy block now, and `engineEnabled` is
    // false in every stored blob — so the flag-gated version takes the Model Book
    // intraday popup's VWAP off every existing user's chart, on a surface no user
    // setting can turn off.
    drawIntraday({ indicators: { vwap: { ...VWAP_CFG, enabled: false } } },
      { vwapOverride: { color: '#ffffff' } })
    expect(vwapSeries('#ffffff'), 'the Model Book popup lost its VWAP').toHaveLength(1)
    expect(bound(), 'the forced instance never reached the binder').toHaveLength(1)
  })

  it('…and the override does not resurrect it on a DAILY chart', () => {
    // The forced instance is manufactured before `eligibleInstances` runs, so the
    // timeframe gate still has to drop it. Forcing an indicator on is not the same
    // as forcing it to exist where it has no meaning.
    draw({ indicators: { vwap: { ...VWAP_CFG, enabled: false } } },
      { vwapOverride: { color: '#ffffff' } })
    expect(vwapSeries('#ffffff')).toHaveLength(0)
    expect(bound()).toHaveLength(0)
  })

  it('reserves NO band — it is a price overlay', () => {
    // ⭐ ASSERTED RATHER THAN ASSUMED. The layout stacks a key only when its
    // DEFINITION declares `placement.target: 'pane'` (`paneLayout.paneTargetIds`,
    // derived from the registry — it was `computePaneMargins`' hand-written PANES
    // list until Task 12), so "no band for a price overlay" holds only as long as
    // vwap keeps declaring `'price'`. A band appearing for a price overlay would
    // shrink the price pane under the candles.
    drawIntraday({ ...VWAP_ON })
    expect(vwapSeries(), 'nothing drawn — vacuous').toHaveLength(1)
    expect(ctx().paneMargins.vwap).toBeUndefined()
    // …and the whole margin map is the one this chart's instances reserve: volume
    // and the price area, with nothing stacked at all.
    expect(ctx().paneMargins)
      .toEqual(bandsFor([{ instanceId: 'legacy:vwap', defId: 'vwap', inputs: {}, hidden: false }]))
  })

  it('Alt+U writes an INSTANCE, and the mirror with it', () => {
    const writes = []
    const view = drawIntraday({ indicators: { vwap: { ...VWAP_CFG, enabled: false } } },
      { onSettingsPersist: (next) => writes.push(next) })
    act(() => { fireEvent.keyDown(document, { altKey: true, code: 'KeyU' }) })
    expect(writes, 'Alt+U wrote nothing').not.toHaveLength(0)
    const next = writes.at(-1)
    expect(next.indicatorInstances.some(i => i.defId === 'vwap' && !i.deleted),
      'Alt+U wrote the legacy mirror only — the instance is the authority now').toBe(true)
    expect(next.indicators.vwap.enabled).toBe(true)
    view.unmount()
  })

  it('⭐ a LEGACY-ONLY blob\'s opacity reaches the chart — the migrator\'s projection', () => {
    // 🟡 THE STATED REASON WENT FALSE AT TASK 12, AND THE CLAIM DID NOT.
    //
    // This case used to say "…and this is why VWAP's row is NOT deleted from
    // `indicatorRegistry.listIndicators()`": the row wrote
    // `settings.indicators.vwap.*` raw, `migrateLegacyToInstances` copies every
    // DECLARED input out of that section on every paint, so the row still worked
    // for the only population that existed the day Flip B shipped.
    //
    // Task 12 kept the ROW and deleted the ENUMERATION — the fields are now
    // generated from the definition — and it also found what "the only
    // population that exists today" was hiding: the migrator SKIPS an instance
    // id it already has, so a raw write to the legacy section is read by nobody
    // the moment any control door has created `legacy:vwap`. The row writes
    // through `instanceControls` now.
    //
    // So this case is narrowed to the claim it actually proves — the
    // COMPATIBILITY path, which every existing user's stored blob still takes —
    // and its twin below covers the stored-instance path it could not see.
    drawIntraday({ indicators: { vwap: { ...VWAP_CFG, opacity: 40 } } })
    expect(vwapSeries('rgba(38, 198, 218, 0.4)'),
      'the legacy section stopped reaching the chart').toHaveLength(1)
  })

  it('⭐ …and a STORED INSTANCE\'s opacity wins over a legacy section that disagrees', () => {
    // The state the case above cannot construct, and the one the settings row
    // produces the moment a user has ever ticked VWAP on: an instance exists, so
    // the legacy section is no longer what the chart reads. A writer that only
    // touched the section would leave the slider moving a number nothing renders.
    drawIntraday({
      indicators: { vwap: { ...VWAP_CFG, opacity: 100 } },
      indicatorInstances: [{
        instanceId: 'legacy:vwap', defId: 'vwap', hidden: false,
        inputs: { color: '#26C6DA', opacity: 40, lineStyle: 'solid', lineWidth: 1 },
      }],
    })
    expect(vwapSeries('rgba(38, 198, 218, 0.4)'),
      'the stored instance lost to the legacy mirror').toHaveLength(1)
    expect(vwapSeries('#26C6DA'), 'the un-composed base colour drew as well').toHaveLength(0)
  })
})
