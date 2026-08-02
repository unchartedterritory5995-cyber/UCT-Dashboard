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

  it('caps the stacked sub-panes so `main` stays a legal band', () => {
    const allOn = {
      rsi: { enabled: true }, macd: { enabled: true }, stoch: { enabled: true },
      atr: { enabled: true }, cci: { enabled: true }, williamsR: { enabled: true },
      mfi: { enabled: true }, adx: { enabled: true }, obv: { enabled: true },
    }
    const m = computePaneMargins(cs(allOn), true)
    // 0.69 is the real ceiling: `main` also carries its own 0.30 top margin, so a
    // 0.72 stack would sum to 1.02 and lightweight-charts rejects >= 1.
    expect(m.main.bottom).toBeLessThanOrEqual(0.69 + 1e-9)
    expect(m.main.top).toBe(0.30)
    expect(m.main.top + m.main.bottom).toBeLessThan(1)
  })
})

// ── The lightweight-charts contract ────────────────────────────────────────
// v5's price-scale setter throws `Invalid margins - sum of top and bottom
// margins must be less than 1` for any band where top + bottom >= 1, and
// StockChart's ErrorBoundary escalates that throw into a blank page. These
// three blocks pin the contract, the crash that broke it, and the pixels.

const BANDABLE = ['obv', 'atr', 'adx', 'macd', 'cci', 'williamsR', 'mfi', 'stoch', 'rsi']

const enabled = keys => Object.fromEntries(keys.map(k => [k, { enabled: true }]))

describe('computePaneMargins — every band is a legal lightweight-charts margin', () => {
  it('holds for all 2^9 indicator combos × volume × volume-overlay sets', () => {
    // Violations are collected and asserted once: a per-band expect() here is
    // ~120k assertions, which is slow enough to push other suites over their
    // timeout when the whole project runs in parallel.
    const bad = []
    let checked = 0
    for (let mask = 0; mask < (1 << BANDABLE.length); mask++) {
      const on = BANDABLE.filter((_, i) => mask & (1 << i))
      const indicators = enabled(on)
      // Overlay sets mirror what StockChart passes: nothing overlaid, one
      // indicator moved into the volume pane, and the whole set moved.
      const overlaySets = [[], on.slice(0, 1), on.slice(0, 2), on.slice()]
      for (const hasVolume of [true, false]) {
        for (const ex of overlaySets) {
          const m = computePaneMargins(cs(indicators), hasVolume, ex)
          for (const [key, band] of Object.entries(m)) {
            if (band.top >= 0 && band.bottom >= 0 && band.top + band.bottom < 1) continue
            bad.push(`${key} {top:${band.top}, bottom:${band.bottom}} sum=${band.top + band.bottom}`
              + ` | on=[${on}] volume=${hasVolume} overlaid=[${ex}]`)
          }
          checked++
        }
      }
    }
    expect(checked).toBe(4096)
    expect(bad.slice(0, 5)).toEqual([])
    expect(bad).toHaveLength(0)
  })

  it('never emits a zero-height band while trimming to fit', () => {
    // Trimming a band down to nothing would make its own top + bottom exactly 1
    // — the same throw, one band over. Sweep every combo so the trim path itself
    // is covered, not just the stacks that happen to fit without trimming.
    const flat = []
    for (let mask = 0; mask < (1 << BANDABLE.length); mask++) {
      const on = BANDABLE.filter((_, i) => mask & (1 << i))
      for (const hasVolume of [true, false]) {
        const m = computePaneMargins(cs(enabled(on)), hasVolume)
        for (const [key, band] of Object.entries(m)) {
          if (key === 'main') continue
          const height = 1 - band.top - band.bottom
          if (height > 0) continue
          flat.push(`${key} height=${height} | on=[${on}] volume=${hasVolume}`)
        }
      }
    }
    expect(flat.slice(0, 5)).toEqual([])
    // Sanity: this sweep really does reach stacks that get trimmed.
    expect(computePaneMargins(cs(enabled(['obv', 'atr', 'adx', 'macd'])), true).main.bottom)
      .toBe(0.69)
  })
})

describe('computePaneMargins — the 4-oscillator overflow crash', () => {
  // Reported live: RSI + MACD + Stochastic + CCI + ATR with volume shown made
  // `main` {top: 0.30, bottom: 0.72}. 0.30 + 0.72 = 1.02 -> lightweight-charts
  // threw `given=1.02` and the ErrorBoundary replaced the whole page.
  const crashSet = { ...enabled(['rsi', 'macd', 'stoch', 'cci', 'atr']) }

  it('no longer sums to 1.02 on the reported combination', () => {
    const m = computePaneMargins(cs(crashSet), true)
    expect(m.main.bottom).not.toBe(0.72)
    expect(m.main.top + m.main.bottom).toBeLessThan(1)
    expect(m.main).toEqual({ top: 0.30, bottom: 0.69 })
  })

  it('holds for every 4-and-5-oscillator layout with volume', () => {
    // Each indicator alone was always fine — it is the accumulation that broke.
    const combos = []
    for (let mask = 0; mask < (1 << BANDABLE.length); mask++) {
      const on = BANDABLE.filter((_, i) => mask & (1 << i))
      if (on.length === 4 || on.length === 5) combos.push(on)
    }
    expect(combos.length).toBeGreaterThan(200)
    for (const on of combos) {
      const m = computePaneMargins(cs(enabled(on)), true)
      expect(m.main.top + m.main.bottom, `on=[${on}]`).toBeLessThan(1)
    }
  })
})

describe('computePaneMargins — today’s working layouts are pixel-identical', () => {
  // The common 1-3 oscillator stacks are a hot visual surface. These are the
  // exact values the pre-fix code produced; the overflow fix must not move them.
  it('pins the 1-oscillator layouts', () => {
    expect(computePaneMargins(cs(enabled(['rsi'])), true)).toEqual({
      rsi: { top: 0.85, bottom: 0 },
      volume: { top: 0.70, bottom: 0.15 },
      main: { top: 0.30, bottom: 0.30 },
    })
    // MACD is the tallest band (0.17), so it exercises a different height.
    expect(computePaneMargins(cs(enabled(['macd'])), true)).toEqual({
      macd: { top: 0.83, bottom: 0 },
      volume: { top: 0.68, bottom: 0.17 },
      main: { top: 0.30, bottom: 0.32 },
    })
  })

  it('pins the 2-oscillator layout', () => {
    expect(computePaneMargins(cs(enabled(['rsi', 'macd'])), true)).toEqual({
      macd: { top: 0.83, bottom: 0 },
      rsi: { top: 0.68, bottom: 0.17 },
      volume: { top: 0.53, bottom: 0.32 },
      main: { top: 0.30, bottom: 0.47 },
    })
    // Short bands (OBV/ATR at 0.13) stack the same way.
    expect(computePaneMargins(cs(enabled(['obv', 'atr'])), true)).toEqual({
      obv: { top: 0.87, bottom: 0 },
      atr: { top: 0.74, bottom: 0.13 },
      volume: { top: 0.59, bottom: 0.26 },
      main: { top: 0.30, bottom: 0.41 },
    })
  })

  it('pins the 3-oscillator layout, with and without volume', () => {
    expect(computePaneMargins(cs(enabled(['rsi', 'macd', 'stoch'])), true)).toEqual({
      macd: { top: 0.83, bottom: 0 },
      stoch: { top: 0.68, bottom: 0.17 },
      rsi: { top: 0.53, bottom: 0.32 },
      volume: { top: 0.38, bottom: 0.47 },
      main: { top: 0.30, bottom: 0.62 },
    })
    expect(computePaneMargins(cs(enabled(['rsi', 'macd', 'stoch'])), false)).toEqual({
      macd: { top: 0.83, bottom: 0 },
      stoch: { top: 0.68, bottom: 0.17 },
      rsi: { top: 0.53, bottom: 0.32 },
      main: { top: 0.30, bottom: 0.47 },
    })
  })

  it('pins an overlaid indicator reclaiming its band', () => {
    expect(computePaneMargins(cs(enabled(['rsi', 'macd'])), true, ['macd'])).toEqual({
      rsi: { top: 0.85, bottom: 0 },
      volume: { top: 0.70, bottom: 0.15 },
      main: { top: 0.30, bottom: 0.30 },
    })
  })

  it('pins the full 9-oscillator stack (already fit before, must not move)', () => {
    const m = computePaneMargins(cs(enabled(BANDABLE)), true)
    expect(m.main).toEqual({ top: 0.30, bottom: 0.69 })
    expect(m.obv).toEqual({ top: 0.94, bottom: 0 })
    expect(m.volume).toEqual({ top: 0.31, bottom: 0.62 })
  })
})
