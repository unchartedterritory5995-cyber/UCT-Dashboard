import { describe, it, expect, vi, beforeEach } from 'vitest'
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
// binder wrapper from `stockChartWiring.test.jsx` — `paneMargins` is handed to
// the binder through its sync ctx, and that is where the projection's effect is
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

beforeEach(() => {
  cleanup()
  H.reset()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})

const { default: StockChart, ENGINE_FLIPPED_DEF_IDS, ENGINE_MIGRATED_DEF_IDS } = await import('../../../StockChart')
const { setIndicatorEnabled, setIndicatorInput, isIndicatorEnabled } = await import('../instanceControls')
const registry = await import('../nativeRegistry')
const { computePaneMargins } = await import('../../paneMargins')
const { chartStateToUrl, urlToChartState } = await import('../../chartScreenshot')

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
  it('flips all four pilots, and stays a SUBSET of the migrated set', () => {
    // Flipped-but-not-migrated means the legacy block was deleted and nothing
    // replaced it — an indicator that renders nothing at all.
    expect([...ENGINE_FLIPPED_DEF_IDS].sort()).toEqual(['bb', 'macd', 'rsi', 'vwap'])
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
      engineEnabled: true,
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

  it('…and a NON-MIGRATED definition never reaches the engine, flag on or off', () => {
    // ⚠️ THE SUBJECT MOVED, BECAUSE TASK 11 TOOK THE OLD ONE. This case used to
    // read "an UN-FLIPPED migrated definition still needs the flag", with `macd`
    // as its subject — the narrowing that kept the flip per-definition. `macd` is
    // flipped now and the migrated set has no un-flipped member at all, so that
    // wording has no subject and the case above (`NOTHING is migrated-but-
    // un-flipped`) is what watches for one appearing.
    //
    // What is still true and still worth a rail is the OTHER edge of the same
    // filter: a definition the engine has never been given never reaches it,
    // whatever the flag says, and its legacy block goes on drawing it. Stoch is
    // the subject because it is a pane oscillator with its own named scale —
    // the same shape MACD had — so a filter that leaked would look identical.
    expect(ENGINE_MIGRATED_DEF_IDS.has('stoch'),
      'stoch migrated — this negative control needs a new subject').toBe(false)
    for (const engineEnabled of [false, true]) {
      cleanup(); H.reset()
      draw({ engineEnabled, indicators: { stoch: { enabled: true, kPeriod: 14, dPeriod: 3 } } })
      expect(bound(), `stoch reached the engine with the flag ${engineEnabled}`).toHaveLength(0)
      expect(H.addSeriesCalls.filter(c => c.options && c.options.priceScaleId === 'stoch').length,
        'the legacy Stochastic block stopped drawing').toBeGreaterThan(0)
    }
  })

  it('a stored INSTANCE beats a false legacy toggle — instances are authoritative', () => {
    draw({
      engineEnabled: true,
      indicators: { rsi: { enabled: false } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 21 }, hidden: false }],
    })
    expect(rsiSeries(), 'the toggle says off; the instance says on, and it wins').toHaveLength(1)
    // …and the BAND was reserved for it, which is the paneMarginsProjection half.
    expect(ctx().paneMargins.rsi, 'no band was reserved — the projection is not wired')
      .toEqual({ top: 0.85, bottom: 0 })
  })

  it('a TOMBSTONE beats a true legacy toggle — "off" stays off', () => {
    draw({
      engineEnabled: true,
      indicators: { rsi: { enabled: true, period: 14 } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }],
    })
    expect(rsiSeries()).toHaveLength(0)
    expect(ctx().paneMargins.rsi, 'a deleted indicator must not reserve a band').toBeUndefined()
  })

  it('the band the engine lands in is EXACTLY the one the legacy layout reserved', () => {
    // The whole permission for `csForPaneMargins` to exist: the same answer.
    const cs = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }
    draw({ engineEnabled: true, ...cs })
    expect(ctx().paneMargins.rsi).toEqual({ top: 0.85, bottom: 0 })
    expect(ctx().paneMargins).toEqual(computePaneMargins(cs, true, new Set()))
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
      engineEnabled: true,
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
    const view = draw({ engineEnabled: true, indicators: { rsi: { enabled: false } } },
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
    const view = draw({ engineEnabled: true, indicators: { bb: { enabled: false } } },
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
    draw({ engineEnabled: true, ...cs })
    expect(rsiSeries(), 'it came back on refresh — the tombstone did not persist').toHaveLength(0)
  })

  it('the alert popover still lists RSI, because the mirror is written', () => {
    // `IndicatorAlertPopover` reads its own INDICATORS list and the evaluator
    // reads `cs.indicators`. Neither knows about instances, and neither should
    // have to for the pilot pair to flip.
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
      engineEnabled: true,
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
      engineEnabled: true,
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
// hand-lists exactly the four B3 pilots and carried NEITHER `indicatorInstances`
// NOR `engineEnabled`. At Flip A that was harmless: `cs.indicators.<id>.enabled`
// was the authority, so a shared link reproduced the chart. **At Flip B `enabled`
// stops being the authority** — the sender's RSI may exist only as an instance,
// and a tombstone can make a still-true toggle mean "off" — so the link would
// have silently dropped RSI and Bollinger Bands from every shared chart, and the
// RECIPIENT's own tombstone would have swallowed the toggle it did carry.
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
    expect(next.engineEnabled).toBe(true)
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
// The first two are driven behaviourally above. The right-click menu is built
// inside `buildRegionSections`, which is only reachable through a real
// `contextmenu` on a canvas region the jsdom double cannot produce, so it is
// gated STRUCTURALLY here — anchored on the shipped identifiers, reading the
// shipped file. ⚠️ A structural rail is weaker than a behavioural one and is used
// because the alternative is NO gate on two of the four doors; it fails on
// exactly the edit that would reintroduce the defect.
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
    expect(block).toMatch(/checked:\s*indEnabled\(key\)/)
  })

  it('…and WRITES through setIndEnabled, which routes a flipped id at the instance', () => {
    const block = slice("const indicatorsItem = {", "// \"Overlay on volume\"")
    expect(block, 'the submenu writes `indicators.<key>.enabled` directly')
      .not.toMatch(/setCs\(`indicators\./)
    expect(block).toMatch(/setIndEnabled\(key,/)
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
    draw({ engineEnabled: true, ...MACD_ON })
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
    draw({ engineEnabled: true, ...MACD_ON })
    const lines = H.priceLineCalls.filter(c => c.options && c.options.price === 0)
    expect(lines, 'the zero guide vanished with the legacy block').toHaveLength(1)
  })

  it('Ctrl+O writes an INSTANCE, and the mirror with it', () => {
    const writes = []
    const view = draw({ engineEnabled: true, indicators: { macd: { enabled: false } } },
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
      engineEnabled: true,
      indicators: { macd: { enabled: false } },
      indicatorInstances: [{ instanceId: 'legacy:macd', defId: 'macd', inputs: {}, hidden: false }],
    })
    expect(ctx().paneMargins.macd, 'no band was reserved — the projection is not wired').toBeTruthy()
    expect(ctx().paneMargins.macd)
      .toEqual(computePaneMargins({ indicators: { macd: { enabled: true } } }, true, new Set()).macd)
  })

  it('a tombstone reserves NO band, and draws nothing', () => {
    draw({
      engineEnabled: true,
      ...MACD_ON,
      indicatorInstances: [{ instanceId: 'legacy:macd', deleted: true }],
    })
    expect(macdSeries()).toHaveLength(0)
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
    for (const engineEnabled of [true, false]) {
      cleanup(); H.reset()
      drawIntraday({ engineEnabled, ...VWAP_ON })
      expect(vwapSeries(), `flag=${engineEnabled}: the chart lost its VWAP`).toHaveLength(1)
      expect(bound(), 'the ENGINE must be what drew it').toHaveLength(1)
    }
  })

  it('still draws NOTHING on a daily chart, flipped or not', () => {
    draw({ engineEnabled: true, ...VWAP_ON })
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
    // ⭐ ASSERTED RATHER THAN ASSUMED. `csForPaneMargins` rewrites
    // `indicators.vwap.enabled` from the instance list for every FLIPPED id, and
    // `computePaneMargins`' PANES list does not contain vwap — so the answer is
    // "no band" only as long as those two facts hold together. A band appearing
    // for a price overlay would shrink the price pane under the candles.
    drawIntraday({ engineEnabled: true, ...VWAP_ON })
    expect(vwapSeries(), 'nothing drawn — vacuous').toHaveLength(1)
    expect(ctx().paneMargins.vwap).toBeUndefined()
    // …and the whole margin map is the one the legacy layout produced.
    expect(ctx().paneMargins).toEqual(computePaneMargins(VWAP_ON, true, new Set()))
  })

  it('Alt+U writes an INSTANCE, and the mirror with it', () => {
    const writes = []
    const view = drawIntraday({ engineEnabled: true, indicators: { vwap: { ...VWAP_CFG, enabled: false } } },
      { onSettingsPersist: (next) => writes.push(next) })
    act(() => { fireEvent.keyDown(document, { altKey: true, code: 'KeyU' }) })
    expect(writes, 'Alt+U wrote nothing').not.toHaveLength(0)
    const next = writes.at(-1)
    expect(next.indicatorInstances.some(i => i.defId === 'vwap' && !i.deleted),
      'Alt+U wrote the legacy mirror only — the instance is the authority now').toBe(true)
    expect(next.indicators.vwap.enabled).toBe(true)
    view.unmount()
  })

  it('⭐ the SETTINGS-PAGE row still reaches the chart — opacity, through the migrator', () => {
    // ⚠️ THE BRIEF SAID TO DELETE VWAP'S ROW FROM `indicatorRegistry.listIndicators()`
    // IN THIS TASK. It is not deleted, and this is why: the row writes
    // `settings.indicators.vwap.*`, `migrateLegacyToInstances` copies every
    // DECLARED input out of that section on every paint, and `eligibility` folds
    // `opacity` into the colour. So the row still works for the only population
    // that exists today — users with no stored instance — and removing it would
    // take VWAP's opacity / line-style / width controls away with nothing
    // replacing them until B4 builds the generated settings UI. The plan assigns
    // that removal to Task 12, next to the rail that makes it a test.
    drawIntraday({ indicators: { vwap: { ...VWAP_CFG, opacity: 40 } } })
    expect(vwapSeries('rgba(38, 198, 218, 0.4)'),
      'the settings-page opacity stopped reaching the chart at the flip').toHaveLength(1)
  })
})
