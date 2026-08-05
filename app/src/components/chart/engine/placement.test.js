import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolvePlacement, resolvePreset, PRESET_SURFACES, MAIN_PRICE_SCALE_ID } from './placement'
import * as registry from './nativeRegistry'
import { computePaneMargins } from '../paneMargins'
import { computePaneLayout, __setPaneModeForTest, SEPARATOR_PX } from './paneLayout'
import { PRESETS, CHART_DEFAULTS } from '../chartDefaults'
import { IND_TOKENS } from '../designTokens'

// ─── Fixtures ────────────────────────────────────────────────────────────────
//
// REAL definitions and the REAL `computePaneMargins`, deliberately. This module's
// entire job is to agree with `StockChart.jsx:5457-5480`; a hand-written stand-in
// definition or a hand-typed margin can agree with the adapter while both
// disagree with the chart, and the test would still be green.

const def = (id) => registry.getDefinition(id)

const inst = (defId, extra = {}) => ({
  instanceId: `legacy:${defId}`, defId, inputs: {}, hidden: false, ...extra,
})

/** The ctx the Task-7 wiring hands over, built the way StockChart builds it. */
const ctxFor = (cs, { volOverlay = [], volSeparate = false, hasVolumeBand = false } = {}) => {
  const volOverlaySet = new Set(volOverlay)
  const volSeparatePane = volSeparate || volOverlaySet.size > 0
  return {
    cs,
    paneMargins: computePaneMargins(cs, hasVolumeBand && !volSeparatePane, volOverlaySet),
    volOverlaySet,
    volSeparatePane,
    VOL_PANE_INDEX: 1,
  }
}

/** A settings blob with a set of pane oscillators enabled — the thing that
 *  decides which bands `computePaneMargins` hands back. */
// ⭐ B5 TASK 9: built from the DEFINITIONS, not from `CHART_DEFAULTS.indicators`
// — that table is one key now, so the old spelling produced a blob with no
// oscillator sections at all and `computePaneMargins` handed back no bands. This
// is the shape `csForPaneMargins` builds on the render path.
const csWith = (...enabled) => ({
  ...CHART_DEFAULTS,
  indicators: {
    ...Object.fromEntries(registry.listDefinitions().map(d => [d.id, { enabled: enabled.includes(d.id) }])),
    ...Object.fromEntries(
      Object.entries(CHART_DEFAULTS.indicators).map(([k, v]) => [k, { ...v, enabled: enabled.includes(k) }])),
  },
})

// ─── the pane-0 default (the shipped `indTarget` else-branch) ────────────────

describe('resolvePlacement — pane 0, the indicator\'s own named scale', () => {
  it('puts a pane oscillator in pane 0 on a scale named after its definition', () => {
    const cs = csWith('rsi')
    const p = resolvePlacement(inst('rsi'), def('rsi'), ctxFor(cs))
    expect(p.paneIndex).toBe(0)
    expect(p.scaleId).toBe('rsi')
  })

  it('takes its scaleMargins from computePaneMargins, keyed by definition id', () => {
    const cs = csWith('rsi', 'macd', 'atr')
    const ctx = ctxFor(cs, { hasVolumeBand: true })
    for (const id of ['rsi', 'macd', 'atr']) {
      const p = resolvePlacement(inst(id), def(id), ctx)
      expect(p.scaleOptions.scaleMargins).toEqual(ctx.paneMargins[id])
    }
    // Not the same band — this is the stack, and a shared band would mean the
    // adapter invented one rather than reading the real layout.
    const bands = ['rsi', 'macd', 'atr'].map(id => ctx.paneMargins[id])
    expect(new Set(bands.map(b => `${b.top}/${b.bottom}`)).size).toBe(3)
  })

  it('falls back to the shipped {top:0.82,bottom:0} when the layout reserved no band', () => {
    // `computePaneMargins` only emits a key for an ENABLED indicator. An instance
    // whose legacy toggle is off has no band, and `applyIndScale`'s `|| {...}` is
    // what keeps it on the chart instead of throwing.
    const p = resolvePlacement(inst('rsi'), def('rsi'), ctxFor(csWith()))
    expect(p.scaleOptions.scaleMargins).toEqual({ top: 0.82, bottom: 0 })
  })

  it('always sets borderVisible:false, like every shipped indicator scale', () => {
    const p = resolvePlacement(inst('obv'), def('obv'), ctxFor(csWith('obv')))
    expect(p.scaleOptions.borderVisible).toBe(false)
  })
})

// ─── the volume-overlay path ─────────────────────────────────────────────────

describe('resolvePlacement — overlaid into the volume pane', () => {
  it('sends an overlaid oscillator to the volume pane\'s left axis', () => {
    const cs = csWith('rsi')
    const p = resolvePlacement(inst('rsi'), def('rsi'), ctxFor(cs, { volOverlay: ['rsi'] }))
    expect(p.paneIndex).toBe(1)
    expect(p.scaleId).toBe('left')
  })

  it('uses the autoscaled left-axis options, NOT a stacked band', () => {
    const cs = csWith('rsi')
    const p = resolvePlacement(inst('rsi'), def('rsi'), ctxFor(cs, { volOverlay: ['rsi'] }))
    // Byte-for-byte the object `applyIndScale`'s left-axis branch applies.
    expect(p.scaleOptions).toEqual({
      borderVisible: false, visible: true, autoScale: true,
      scaleMargins: { top: 0.12, bottom: 0.04 },
    })
  })

  it('drops the fixed range when overlaid — the left axis is shared and autoscaled', () => {
    // RSI is 0-100 in its own band. On the volume pane's left axis the shipped
    // code passes `autoScale: true` and no minimum/maximum, because that axis is
    // shared with whatever else got overlaid onto it.
    const p = resolvePlacement(inst('rsi'), def('rsi'), ctxFor(csWith('rsi'), { volOverlay: ['rsi'] }))
    expect(p.scaleOptions.autoScale).toBe(true)
    expect(p.scaleOptions).not.toHaveProperty('minimum')
    expect(p.scaleOptions).not.toHaveProperty('maximum')
  })

  it('honours VOL_PANE_INDEX from the caller rather than hardcoding 1', () => {
    const ctx = { ...ctxFor(csWith('rsi'), { volOverlay: ['rsi'] }), VOL_PANE_INDEX: 3 }
    expect(resolvePlacement(inst('rsi'), def('rsi'), ctx).paneIndex).toBe(3)
  })

  it('does NOT overlay when the volume pane is not separate', () => {
    // The shipped guard is `volSeparatePane && volOverlaySet.has(key)`. A set that
    // is somehow non-empty without a separate pane must still land in pane 0.
    const ctx = { ...ctxFor(csWith('rsi'), { volOverlay: ['rsi'] }), volSeparatePane: false }
    const p = resolvePlacement(inst('rsi'), def('rsi'), ctx)
    expect(p.paneIndex).toBe(0)
    expect(p.scaleId).toBe('rsi')
  })

  it('leaves an indicator that is not in the overlay set alone', () => {
    const ctx = ctxFor(csWith('rsi', 'macd'), { volOverlay: ['macd'] })
    const p = resolvePlacement(inst('rsi'), def('rsi'), ctx)
    expect(p.paneIndex).toBe(0)
    expect(p.scaleId).toBe('rsi')
  })
})

// ─── TRAP #2: the COMPLETE option set, every single resolve ───────────────────

describe('resolvePlacement — the full scale option set, every time (trap #2)', () => {
  // `StockChart` passes `{autoScale:false, minimum:0, maximum:100}` on the CREATE
  // branch only (`:5773`); the update branch calls `applyIndScale` with no extras.
  // Price scales are CHART-LEVEL and keyed by id, so a pooled series that
  // inherited RSI's scale and never had its own asserted keeps 0-100 — and an ATR
  // of 2.7 draws as a flat line on the floor. Every resolve returns the whole set.
  const FIXED = { rsi: [0, 100], stoch: [0, 100], mfi: [0, 100], adx: [0, 100], williamsR: [-100, 0] }
  const AUTO = ['macd', 'atr', 'cci', 'obv']

  for (const [id, [min, max]] of Object.entries(FIXED)) {
    it(`${id}: carries {autoScale:false, minimum:${min}, maximum:${max}} on EVERY resolve`, () => {
      const ctx = ctxFor(csWith(id))
      // Ten resolves, not one: the defect this closes is "correct on the first
      // call, missing on the rest", so a single assertion cannot see it.
      for (let i = 0; i < 10; i++) {
        const p = resolvePlacement(inst(id), def(id), ctx)
        expect(p.scaleOptions.autoScale).toBe(false)
        expect(p.scaleOptions.minimum).toBe(min)
        expect(p.scaleOptions.maximum).toBe(max)
      }
    })
  }

  for (const id of AUTO) {
    it(`${id}: carries autoScale:true and no fixed range on EVERY resolve`, () => {
      const ctx = ctxFor(csWith(id))
      for (let i = 0; i < 10; i++) {
        const p = resolvePlacement(inst(id), def(id), ctx)
        expect(p.scaleOptions.autoScale).toBe(true)
        expect(p.scaleOptions).not.toHaveProperty('minimum')
        expect(p.scaleOptions).not.toHaveProperty('maximum')
      }
    })
  }

  it('the fixed range comes from placement.scale in the DEFINITION, not a table here', () => {
    // A definition the registry does not ship, so nothing in this module can be
    // hardcoding the answer.
    const custom = { ...def('rsi'), id: 'custom', placement: { target: 'pane', scale: { min: -3, max: 7 } } }
    const p = resolvePlacement(inst('custom'), custom, ctxFor(csWith()))
    expect(p.scaleOptions.minimum).toBe(-3)
    expect(p.scaleOptions.maximum).toBe(7)
  })

  it('agrees with what StockChart passes as bandExtra today, definition by definition', () => {
    // Transcribed from the `applyIndScale(..., bandExtra)` call sites
    // (StockChart.jsx:5773 / 5806 / 5845 / 5874 / 5953 / 5977 / 6002 / 6039 / 6067).
    const SHIPPED = {
      rsi: { autoScale: false, minimum: 0, maximum: 100 },
      stoch: { autoScale: false, minimum: 0, maximum: 100 },
      macd: { autoScale: true },
      atr: { autoScale: true },
      mfi: { autoScale: false, minimum: 0, maximum: 100 },
      cci: { autoScale: true },
      williamsR: { autoScale: false, minimum: -100, maximum: 0 },
      adx: { autoScale: false, minimum: 0, maximum: 100 },
      obv: { autoScale: true },
    }
    for (const [id, extra] of Object.entries(SHIPPED)) {
      const ctx = ctxFor(csWith(id))
      const p = resolvePlacement(inst(id), def(id), ctx)
      expect({ ...p.scaleOptions, borderVisible: undefined, scaleMargins: undefined })
        .toEqual({ ...extra, borderVisible: undefined, scaleMargins: undefined })
    }
  })
})

// ─── price overlays ──────────────────────────────────────────────────────────

describe('resolvePlacement — price overlays never touch the main scale', () => {
  it('names the CANDLES\' scale explicitly — never null, which read as "leave it"', () => {
    // ⚠️ THIS ASSERTION USED TO BE `typeof p.scaleId !== 'string'`, and that was
    // the seam a critical defect lived in. `null` was intended as "the main price
    // scale, assert nothing"; `pool.seriesOptionsForPlot` read it as "omit
    // `priceScaleId`". On a CREATED series those agree (LWC resolves an absent id
    // to its default). On a POOLED one they do not — `applyOptions` without the
    // key leaves the series on the previous tenant's NAMED scale, and
    // `scaleOptions: null` means nothing corrects it. Reproduced on the exact B3
    // pilot pair: RSI off + BB on in one write put BB's upper band on the `rsi`
    // scale, still fixed at 0-100, clipped invisible.
    for (const id of ['bb', 'vwap', 'sar', 'ichimoku', 'donchian']) {
      const p = resolvePlacement(inst(id), def(id), ctxFor(csWith()))
      expect(p.paneIndex).toBe(0)
      expect(p.scaleId, id).toBe(MAIN_PRICE_SCALE_ID)
    }
  })

  it('that scale id is the one LWC would have chosen for a series that named none', () => {
    // The constant is only correct because `_internal_defaultVisiblePriceScaleId()`
    // returns the visible scale when exactly one of left/right is visible, and the
    // app configures `rightPriceScale` while never touching `leftPriceScale`
    // (hidden by default). Pinning the value here is what turns "we checked once"
    // into something that fails if anyone edits it to `'left'` or `''`.
    expect(MAIN_PRICE_SCALE_ID).toBe('right')
  })

  it('asserts NO scale options — the main scale belongs to the candle series', () => {
    // `_mainMargins` owns it, and it also carries the user's dragged
    // `vertMarginsRef` placement. An indicator writing scaleMargins there would
    // move the candles.
    const p = resolvePlacement(inst('bb'), def('bb'), ctxFor(csWith()))
    expect(p.scaleOptions).toBeNull()
  })

  it('an instance may override the definition\'s target', () => {
    const p = resolvePlacement(inst('rsi', { placement: { target: 'price' } }), def('rsi'), ctxFor(csWith('rsi')))
    expect(p.scaleId).toBe(MAIN_PRICE_SCALE_ID)
    // An RSI moved onto the price pane must NOT drag its 0-100 fixed range onto
    // the candles' axis — "assert nothing" is `scaleOptions`, and only that.
    expect(p.scaleOptions).toBeNull()
  })
})

// ─── fail-closed ─────────────────────────────────────────────────────────────

describe('resolvePlacement — refuses rather than guesses', () => {
  it('returns null with no definition', () => {
    expect(resolvePlacement(inst('rsi'), null, ctxFor(csWith()))).toBeNull()
  })

  it('returns null for a target outside the schema vocabulary', () => {
    const bogus = { ...def('rsi'), placement: { target: 'somewhere-else' } }
    expect(resolvePlacement(inst('rsi'), bogus, ctxFor(csWith()))).toBeNull()
  })

  it('survives a ctx with nothing in it', () => {
    const p = resolvePlacement(inst('rsi'), def('rsi'), {})
    expect(p.paneIndex).toBe(0)
    expect(p.scaleId).toBe('rsi')
    expect(p.scaleOptions.scaleMargins).toEqual({ top: 0.82, bottom: 0 })
  })
})

// ─── TRAP #5: the preset comes from the CANVAS, never from cs.preset ──────────

describe('resolvePreset — trap #5', () => {
  it('returns oled for an OLED canvas whose preset says "custom"', () => {
    // THE TRAP, exactly as it reaches this function in production: every
    // `handleUpdateChartSettings` call site writes `preset: 'custom'`, and
    // `designTokens.resolveToken` silently falls back to `classic` for an
    // unknown preset — so an OLED user who touches ANY setting would get the
    // classic palette (ink #706b5e on #000000) and never be told.
    const cs = { ...PRESETS.oled.settings, preset: 'custom' }
    expect(resolvePreset(cs)).toBe('oled')
  })

  it('returns the right preset for every shipped preset blob, all marked custom', () => {
    for (const name of ['classic', 'oled', 'tradingview', 'light']) {
      expect(resolvePreset({ ...PRESETS[name].settings, preset: 'custom' })).toBe(name)
    }
  })

  it('ignores cs.preset even when it names a DIFFERENT real preset', () => {
    // A stale/incorrect preset label must not beat the canvas that is actually
    // painted. This is the half of the trap a "read cs.preset first, fall back to
    // the canvas" implementation would still get wrong.
    const cs = { ...PRESETS.light.settings, preset: 'oled' }
    expect(resolvePreset(cs)).toBe('light')
  })

  it('resolves a light canvas to the light palette even at an off-preset white', () => {
    // Contrast is the reason this matters: the dark palettes' bull/bear/ink are
    // unreadable on a near-white canvas.
    expect(resolvePreset({ background: '#fdfdfd', preset: 'custom' })).toBe('light')
    expect(resolvePreset({ background: 'rgb(250, 250, 248)' })).toBe('light')
  })

  it('resolves an off-preset dark canvas to the nearest dark palette', () => {
    // The owner's own live blob: #0f0f0f with preset 'custom' (see __fixtures__).
    expect(resolvePreset({ background: '#0f0f0f', preset: 'custom' })).toBe('classic')
    // Nearer OLED's pure black than classic's #0e0f0d.
    expect(resolvePreset({ background: '#020202', preset: 'custom' })).toBe('oled')
    // Nearer TradingView's navy.
    expect(resolvePreset({ background: '#141824', preset: 'custom' })).toBe('tradingview')
  })

  it('honours cs.theme === "light" over the stored background', () => {
    // `StockChart.themeColors` hard-forces #ffffff in this branch, so the stored
    // background is not what gets painted (`StockChart.jsx:1099-1108`).
    expect(resolvePreset({ ...PRESETS.classic.settings, theme: 'light' })).toBe('light')
  })

  it('samples the gradient top when the canvas is a gradient', () => {
    expect(resolvePreset({
      bgMode: 'gradient', background: '#0e0f0d',
      bgGradient: { top: '#ffffff', bottom: '#ffffff' }, preset: 'custom',
    })).toBe('light')
  })

  it('accepts an explicit canvas override from a caller that knows better', () => {
    // Sunrise (`canvasTheme="sunrise"`) and the Model Book navy are PROPS, not
    // settings — the blob cannot see them, so the caller passes the canvas.
    expect(resolvePreset(PRESETS.classic.settings, { canvas: '#eaf3fb' })).toBe('light')
  })

  it('falls back to classic on junk rather than returning null', () => {
    for (const cs of [null, undefined, {}, { background: 'not-a-color' }, { background: 42 }]) {
      expect(resolvePreset(cs)).toBe('classic')
    }
  })

  it('only ever returns a preset designTokens can resolve', () => {
    const known = Object.keys(IND_TOKENS)
    for (const cs of [null, {}, { background: '#808080' }, { background: '#123456' }, { theme: 'light' }]) {
      expect(known).toContain(resolvePreset(cs))
    }
  })
})

describe('PRESET_SURFACES', () => {
  it('is the presets\' own backgrounds, not a second copy that can drift', () => {
    for (const name of Object.keys(PRESET_SURFACES)) {
      expect(PRESET_SURFACES[name]).toBe(IND_TOKENS[name].surface)
      expect(PRESET_SURFACES[name].toLowerCase()).toBe(PRESETS[name].settings.background.toLowerCase())
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B3 CARRY #1 — the autoscale seam
// ─────────────────────────────────────────────────────────────────────────────

describe('autoscale — the seam a price overlay needs (B3 carry #1)', () => {
  const ctx = {
    paneMargins: { rsi: { top: 0.85, bottom: 0 } },
    volOverlaySet: new Set(),
    volSeparatePane: false,
    VOL_PANE_INDEX: 1,
  }

  it('every PRICE-target definition resolves to exclude — def by def', () => {
    const priceDefs = registry.listDefinitions().filter(d => d.placement.target === 'price')
    // If this list ever empties, every assertion below is vacuous.
    expect(priceDefs.map(d => d.id)).toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
    for (const d of priceDefs) {
      const p = resolvePlacement({ instanceId: `i:${d.id}`, defId: d.id }, d, ctx)
      expect(p.autoscale, `${d.id} may not drag the candles' autoscale`).toBe('exclude')
      expect(p.scaleOptions, `${d.id} must still assert nothing on the candles' scale`).toBeNull()
    }
  })

  it('every PANE-target definition resolves to default — def by def', () => {
    const paneDefs = registry.listDefinitions().filter(d => d.placement.target === 'pane')
    expect(paneDefs.length).toBeGreaterThan(0)
    for (const d of paneDefs) {
      const p = resolvePlacement({ instanceId: `i:${d.id}`, defId: d.id }, d, ctx)
      expect(p.autoscale, `${d.id} OWNS its band's scale and must drive it`).toBe('default')
    }
  })

  it('an oscillator overlaid onto the volume pane still drives the shared left axis', () => {
    const d = def('rsi')
    const p = resolvePlacement(
      { instanceId: 'i:rsi', defId: 'rsi', placement: { target: 'volume' } }, d,
      { ...ctx, volSeparatePane: true, volOverlaySet: new Set(['rsi']) },
    )
    expect(p.scaleId).toBe('left')
    // applyIndScale's left branch autoscales; the shipped code passes no provider.
    expect(p.autoscale).toBe('default')
  })

  it('is a STRING, never a function — placement stays pure and comparable', () => {
    const d = def('bb')
    const a = resolvePlacement({ instanceId: 'i:bb', defId: 'bb' }, d, ctx)
    const b = resolvePlacement({ instanceId: 'i:bb', defId: 'bb' }, d, ctx)
    expect(typeof a.autoscale).toBe('string')
    expect(a).toEqual(b)   // deep equality would be impossible with a fresh closure
  })
})

// ─── the same four cases, under FLIP C (B5 Task 10) ──────────────────────────
//
// ⛔ A MODE WITH NO COVERAGE IS A MODE THAT SHIPS UNTESTED. Every case in the
// `pane 0, the indicator's own named scale` block above describes what `'bands'`
// does; each has its twin here. The `'panes'` branch is DARK on master —
// `paneMode()` is `'bands'` — which is exactly why it needs driving.
//
// The renderer-level twins (does lightweight-charts actually build these panes?)
// live in `__tests__/flipCGeometry.test.jsx`, on a real chart. These are about
// what this pure function ANSWERS.
describe('resolvePlacement — its own REAL pane (PANE_MODE panes)', () => {
  const layoutFor = (ids) => computePaneLayout(
    csWith(...ids), ids.map((id) => inst(id)),
    { chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX },
  )

  beforeEach(() => { __setPaneModeForTest('panes') })
  afterEach(() => { __setPaneModeForTest(null) })

  it('puts a pane oscillator in ITS OWN pane, on a scale named after its definition', () => {
    const cs = csWith('rsi', 'macd')
    const layout = layoutFor(['rsi', 'macd'])
    const p = resolvePlacement(inst('macd'), def('macd'), { ...ctxFor(cs), paneLayout: layout })
    expect(p.paneIndex).toBe(2)          // rsi is 1, macd is 2 — the LIST's order
    expect(p.scaleId).toBe('macd')
    expect(resolvePlacement(inst('rsi'), def('rsi'), { ...ctxFor(cs), paneLayout: layout }).paneIndex).toBe(1)
  })

  it('takes ZERO scaleMargins — the drawable rectangle is the whole pane now', () => {
    // ⚠️ SPELLED OUT, NEVER OMITTED. `applyOptions` MERGES and `merge()` skips
    // `undefined`, so leaving the key out would leave the previous BAND standing
    // on a re-purposed scale — a pooled series drawing into a 15% slice of a pane
    // it owns outright.
    const cs = csWith('rsi')
    const p = resolvePlacement(inst('rsi'), def('rsi'), { ...ctxFor(cs), paneLayout: layoutFor(['rsi']) })
    expect(p.scaleOptions.scaleMargins).toEqual({ top: 0, bottom: 0 })
    expect(Object.keys(p.scaleOptions)).toContain('scaleMargins')
  })

  it('binds NOTHING when the layout reserved no pane — the twin of the 0.82 fallback', () => {
    // In `'bands'` the missing-band answer is a fallback band, because everything
    // shares pane 0 and a band is the worst that can happen. In `'panes'` the
    // equivalent would be a zero-margin scale in PANE 0, i.e. an oscillator drawn
    // across the whole price area. Fail closed instead.
    const cs = csWith('rsi')
    expect(resolvePlacement(inst('rsi'), def('rsi'), { ...ctxFor(cs), paneLayout: layoutFor(['macd']) })).toBeNull()
    expect(resolvePlacement(inst('rsi'), def('rsi'), ctxFor(cs))).toBeNull()
  })

  it('always sets borderVisible:false, like every shipped indicator scale', () => {
    const cs = csWith('rsi', 'atr', 'obv')
    const layout = layoutFor(['rsi', 'atr', 'obv'])
    for (const id of ['rsi', 'atr', 'obv']) {
      const p = resolvePlacement(inst(id), def(id), { ...ctxFor(cs), paneLayout: layout })
      expect(p.scaleOptions.borderVisible, id).toBe(false)
    }
  })

  it('keeps the FULL option set — a fixed range is still the definition s (trap #2)', () => {
    const cs = csWith('rsi', 'atr')
    const layout = layoutFor(['rsi', 'atr'])
    expect(resolvePlacement(inst('rsi'), def('rsi'), { ...ctxFor(cs), paneLayout: layout }).scaleOptions)
      .toEqual({ borderVisible: false, scaleMargins: { top: 0, bottom: 0 }, autoScale: false, minimum: 0, maximum: 100 })
    expect(resolvePlacement(inst('atr'), def('atr'), { ...ctxFor(cs), paneLayout: layout }).scaleOptions)
      .toEqual({ borderVisible: false, scaleMargins: { top: 0, bottom: 0 }, autoScale: true })
  })

  it('autoscale is still default — exclude collapses the band in BOTH modes', () => {
    const cs = csWith('rsi')
    expect(resolvePlacement(inst('rsi'), def('rsi'), { ...ctxFor(cs), paneLayout: layoutFor(['rsi']) }).autoscale)
      .toBe('default')
  })

  it('a price overlay is UNAFFECTED — it has no pane to be given', () => {
    const cs = csWith('rsi')
    expect(resolvePlacement(inst('bb'), def('bb'), { ...ctxFor(cs), paneLayout: layoutFor(['rsi']) }))
      .toEqual({ paneIndex: 0, scaleId: MAIN_PRICE_SCALE_ID, scaleOptions: null, autoscale: 'exclude' })
  })

  it('the VOLUME-OVERLAY branch still wins, so an overlaid oscillator gets no pane', () => {
    // The order of the two branches is load-bearing: `computePaneLayout` is handed
    // `excludeKeys`, so an overlaid oscillator has no pane in the layout at all —
    // reaching the panes branch first would make it resolve to `null` and vanish.
    const cs = csWith('rsi')
    const layout = computePaneLayout(cs, [inst('rsi')], {
      chartHeight: 600, hasVolumeBand: false, separatorPx: SEPARATOR_PX, excludeKeys: ['rsi'],
    })
    const p = resolvePlacement(inst('rsi'), def('rsi'),
      { ...ctxFor(cs, { volOverlay: ['rsi'] }), paneLayout: layout })
    expect(p.paneIndex).toBe(1)
    expect(p.scaleId).toBe('left')
    expect(p.scaleOptions.autoScale).toBe(true)
  })
})
