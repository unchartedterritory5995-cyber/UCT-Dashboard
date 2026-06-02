import { describe, it, expect } from 'vitest'
import { computePaneMargins } from './paneMargins'

const cs = (indicators = {}) => ({ indicators })

describe('computePaneMargins', () => {
  it('reserves only the price area when nothing is stacked', () => {
    const m = computePaneMargins(cs(), false)
    expect(m.main).toEqual({ top: 0.30, bottom: 0 })
    expect(m.volume).toBeUndefined()
  })

  it('gives volume a bottom band when hasVolume', () => {
    const m = computePaneMargins(cs(), true)
    expect(m.volume).toEqual({ top: 0.85, bottom: 0 })
    expect(m.main.bottom).toBeCloseTo(0.15, 5)
  })

  it('stacks volume and an enabled indicator into separate bands', () => {
    const m = computePaneMargins(cs({ rsi: { enabled: true } }), true)
    // Array order puts rsi before volume, so rsi takes the very bottom (bottom=0)
    // and volume stacks above it.
    expect(m.rsi.bottom).toBe(0)
    expect(m.volume.bottom).toBeGreaterThan(0)
    expect(m.main.bottom).toBeGreaterThan(0.15)
  })

  it('excludes overlaid indicators from the stack (Set)', () => {
    const withRsi = computePaneMargins(cs({ rsi: { enabled: true } }), true)
    const overlaid = computePaneMargins(cs({ rsi: { enabled: true } }), true, new Set(['rsi']))
    expect(overlaid.rsi).toBeUndefined()
    // main reclaims the rsi band's space
    expect(overlaid.main.bottom).toBeLessThan(withRsi.main.bottom)
    expect(overlaid.main.bottom).toBeCloseTo(0.15, 5) // just the volume band remains
  })

  it('accepts an array for excludeKeys', () => {
    const m = computePaneMargins(cs({ atr: { enabled: true }, rsi: { enabled: true } }), true, ['atr', 'rsi'])
    expect(m.atr).toBeUndefined()
    expect(m.rsi).toBeUndefined()
    expect(m.volume).toBeDefined()
  })

  it('caps stacked sub-panes at 72% so price keeps ≥28%', () => {
    const allOn = {
      rsi: { enabled: true }, macd: { enabled: true }, stoch: { enabled: true },
      atr: { enabled: true }, cci: { enabled: true }, williamsR: { enabled: true },
      mfi: { enabled: true }, adx: { enabled: true }, obv: { enabled: true },
    }
    const m = computePaneMargins(cs(allOn), true)
    expect(m.main.bottom).toBeLessThanOrEqual(0.72 + 1e-9)
    expect(m.main.top).toBe(0.30)
  })
})
