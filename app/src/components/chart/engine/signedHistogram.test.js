// A SIGNED HISTOGRAM WITH A MEANINGFUL ZERO — the generic capability, proven on
// a plain `dataSeries`, with no ticker and no family branch anywhere in the path.
//
// The chain under test is the real one:
//   instance.presentation → presentedPlot → signColorsForPlot → toPoints
import { describe, it, expect } from 'vitest'

import { presentedPlot, resolveSignColors, histogramBaseline,
         DEFAULT_SIGN_UP, DEFAULT_SIGN_DOWN } from './presentation'
import { signColorsForPlot } from './pool'

const PLOT = { key: 'value', label: 'Value', style: 'line', color: '#4f9cf9' }
const HIST = { key: 'value', label: 'Value', style: 'histogram', color: '#4f9cf9' }

const withPres = (presentation) => ({ instanceId: 'inst:dataSeries:1', defId: 'dataSeries', presentation })

describe('resolveSignColors', () => {
  it('is null until something asks for it', () => {
    expect(resolveSignColors(null, HIST)).toBeNull()
    expect(resolveSignColors({}, HIST)).toBeNull()
    expect(resolveSignColors(withPres({ plotStyle: 'histogram' }), HIST)).toBeNull()
  })

  it('turns on at instance level and per output, with the chart green/red', () => {
    expect(resolveSignColors(withPres({ signColors: true }), HIST))
      .toEqual({ up: DEFAULT_SIGN_UP, down: DEFAULT_SIGN_DOWN })
    expect(resolveSignColors(withPres({ plots: { value: { signColors: true } } }), HIST))
      .toEqual({ up: DEFAULT_SIGN_UP, down: DEFAULT_SIGN_DOWN })
  })

  it('lets a per-output choice override the instance, in both directions', () => {
    const off = withPres({ signColors: true, plots: { value: { signColors: false } } })
    expect(resolveSignColors(off, HIST)).toBeNull()
    // ⚰️ THE INSTANCE-LEVEL KEYS WERE `colorUp`/`colorDown` AND NOTHING WROTE THEM.
    // Those two names belong to a PLOT — `nativeRegistry` declares MACD's histogram
    // with them, `defSchema` validates them there — so at the instance level they
    // were a vocabulary with no door, and a member could not choose either colour.
    // ⭐ The instance level now uses `upColor`/`downColor`: the pair
    // `setInstanceCandleColor` already writes, so an instance has ONE up/down pair
    // whether it paints candles or signed bars.
    const custom = withPres({ signColors: true, plots: { value: { upColor: '#0f0', downColor: '#f00' } } })
    expect(resolveSignColors(custom, HIST)).toEqual({ up: '#0f0', down: '#f00' })
    // …and at the instance level, not only per output.
    expect(resolveSignColors(withPres({ signColors: true, upColor: '#0f0' }), HIST).up).toBe('#0f0')
  })

  // ─── THEME ────────────────────────────────────────────────────────────────
  it('⭐⭐ with nothing stored it wears the CHART’S candle pair, not a constant', () => {
    // ⛔ THE THEME GAP. `resolveCandleColors` has always taken the chart's palette
    // as a fallback; this resolver jumped straight to a hard-coded green/red, so a
    // signed breadth histogram ignored every UCT Chart Theme. Same chain now.
    const inst = withPres({ signColors: true })
    expect(resolveSignColors(inst, HIST, { upColor: '#11aa55', downColor: '#cc2233' }))
      .toEqual({ up: '#11aa55', down: '#cc2233' })
    // A DIFFERENT theme repaints it, with nothing migrated and no hex stored.
    expect(resolveSignColors(inst, HIST, { upColor: '#3366ff', downColor: '#ff9900' }))
      .toEqual({ up: '#3366ff', down: '#ff9900' })
  })

  it('⛔ an explicit choice OUTRANKS the theme — provenance is presence', () => {
    const chosen = withPres({ signColors: true, upColor: '#0f0', downColor: '#f00' })
    expect(resolveSignColors(chosen, HIST, { upColor: '#11aa55', downColor: '#cc2233' }))
      .toEqual({ up: '#0f0', down: '#f00' })
  })

  it('⛔ a DEFINITION that declares its colours outranks the theme too', () => {
    // MACD chose its own two colours; a theme must not repaint an indicator whose
    // author specified them. Only a definition that declares NOTHING follows the
    // chart — which is exactly the `dataSeries`/breadth case.
    const declared = { key: 'value', label: 'Value', style: 'histogram',
      colorUp: '#4caf50', colorDown: '#f44336' }
    expect(resolveSignColors(withPres({ signColors: true }), declared,
      { upColor: '#3366ff', downColor: '#ff9900' }))
      .toEqual({ up: '#4caf50', down: '#f44336' })
  })

  it('⚠️ no palette at all still answers — the shipped constants', () => {
    expect(resolveSignColors(withPres({ signColors: true }), HIST))
      .toEqual({ up: DEFAULT_SIGN_UP, down: DEFAULT_SIGN_DOWN })
  })
})

describe('presentedPlot stamps what a definition would have declared', () => {
  it('turns a line into a sign-coloured histogram in one step', () => {
    const out = presentedPlot(PLOT, withPres({ plotStyle: 'histogram', signColors: true }))
    expect(out.style).toBe('histogram')
    expect(out.colorMode).toBe('sign')
    expect(out.colorUp).toBe(DEFAULT_SIGN_UP)
    expect(out.colorDown).toBe(DEFAULT_SIGN_DOWN)
  })

  it('⛔ applies to an output that was ALREADY a histogram', () => {
    // The early-return bug: nothing about the STYLE changed, so the old code
    // handed back the untouched plot and the member saw no effect.
    const out = presentedPlot(HIST, withPres({ signColors: true }))
    expect(out).not.toBe(HIST)
    expect(out.colorMode).toBe('sign')
  })

  it('⛔ never sign-colours a line, an area or a candle', () => {
    for (const style of ['line', 'area', 'dots', 'candles']) {
      const out = presentedPlot(PLOT, withPres({ plotStyle: style, signColors: true }),
                                { ohlcCapable: true })
      expect(out.colorMode, style).toBeUndefined()
    }
  })

  it('⚠️ returns the SAME object when nothing overrode anything', () => {
    // Identity matters downstream (plan diffing, guideSignature).
    expect(presentedPlot(HIST, withPres({}))).toBe(HIST)
    expect(presentedPlot(HIST, null)).toBe(HIST)
  })

  it('leaves MACD — a definition that declares its own sign colours — alone', () => {
    const macd = { key: 'histogram', style: 'histogram', colorMode: 'sign',
                   colorUp: '#26a69a', colorDown: '#ef5350' }
    const out = presentedPlot(macd, null)
    expect(out).toBe(macd)
    expect(signColorsForPlot(out)).toEqual({ up: '#26a69a', down: '#ef5350' })
  })
})

describe('the stamped plot reaches the renderer through the shipped path', () => {
  it('signColorsForPlot reads it with no change to pool.js', () => {
    const out = presentedPlot(PLOT, withPres({ plotStyle: 'histogram', signColors: true }))
    expect(signColorsForPlot(out)).toEqual({ up: DEFAULT_SIGN_UP, down: DEFAULT_SIGN_DOWN })
  })

  it('zero is the baseline, so positive and negative read against it', () => {
    const out = presentedPlot(PLOT, withPres({ plotStyle: 'histogram', signColors: true }))
    expect(histogramBaseline(out, null)).toBe(0)
    // ⛔ and a signed series must NOT inherit a 0-100 floor from a scale domain it
    // does not have — an absent domain means zero, not the visible minimum.
    expect(histogramBaseline(out, undefined)).toBe(0)
  })

  it('a signed series is not clamped — +500, 0 and -663 all survive', () => {
    const sc = signColorsForPlot(
      presentedPlot(PLOT, withPres({ plotStyle: 'histogram', signColors: true })))
    const colorFor = (v) => (v >= 0 ? sc.up : sc.down)
    expect(colorFor(500)).toBe(DEFAULT_SIGN_UP)
    expect(colorFor(200)).toBe(DEFAULT_SIGN_UP)
    expect(colorFor(0)).toBe(DEFAULT_SIGN_UP)      // >= 0 is up, matching MACD exactly
    expect(colorFor(-150)).toBe(DEFAULT_SIGN_DOWN)
    expect(colorFor(-663)).toBe(DEFAULT_SIGN_DOWN)
  })
})
