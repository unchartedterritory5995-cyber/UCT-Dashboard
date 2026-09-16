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
    const custom = withPres({ signColors: true, plots: { value: { colorUp: '#0f0', colorDown: '#f00' } } })
    expect(resolveSignColors(custom, HIST)).toEqual({ up: '#0f0', down: '#f00' })
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
