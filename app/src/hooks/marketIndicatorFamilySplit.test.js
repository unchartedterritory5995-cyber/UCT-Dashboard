/**
 * ⛔⛔ TWO CLASSIFIERS, TWO JOBS — the rail that keeps them apart.
 *
 * `canonicalFamily` decides CAPABILITY (may this draw a candle?) and is fail-closed:
 * until both registries have answered it says `'unknown'`, and `ohlcCapabilityOf`
 * refuses `'unknown'`. `presentationFamily` decides a SUBTITLE and may fall back to
 * the breadth-only classification while the market-indicator registry is in flight.
 *
 * ⚰️ THE DEFECT THIS FILE EXISTS FOR. One function did both jobs. Tightening it for
 * the gate blanked the inspector's KIND line for ordinary securities AND — through the
 * same call — withheld candles from every ordinary stock until `/api/market-indicators`
 * answered. A label was paying the price of a security decision.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  canonicalFamily, presentationFamily, __setMarketIndicatorsForTest,
} from './useMarketIndicators'
import { loadBreadthSymbols } from './useBreadthSymbols'
import { ohlcCapabilityOf, OHLC_FAMILY } from '../components/chart/engine/ohlcCapability'

// The registry shape the server ships, trimmed to the rows this rail reasons about.
const REGISTRY = {
  rows: [
    { id: 'CBOE:VIX9D', symbol: 'VIX9D', aliases: [], source_type: 'volatility', ohlc_capable: true },
    { id: 'CBOE:VVIX', symbol: 'VVIX', aliases: [], source_type: 'volatility', ohlc_capable: false },
    { id: 'CBOE:SKEW', symbol: 'SKEW', aliases: [], source_type: 'volatility', ohlc_capable: false },
    { id: 'SENT:NAAIM', symbol: 'NAAIM', aliases: [], source_type: 'survey', ohlc_capable: false },
    { id: 'US:MCO', symbol: 'UCTMCO', aliases: [], source_type: 'breadth_derived', ohlc_capable: false },
  ],
  families: [], dormant: [],
}

// A passthrough definition + parsed source: the shape the capability gate expects.
const PASSTHROUGH = { meta: { name: 'Data Series' }, passthrough: true }
const parsedFor = (symbol) => ({ kind: 'symbol', symbol, field: 'close' })
const withBars = { bars: [{ t: '2026-01-02', o: 1, h: 2, l: 0.5, c: 1.5 }], status: 'ok' }

const capability = (symbol, familyOf) =>
  ohlcCapabilityOf(PASSTHROUGH, parsedFor(symbol), withBars, familyOf)

beforeEach(async () => {
  // The breadth registry is the one this label has always depended on; make it ready
  // so the only variable under test is the MARKET-INDICATOR registry.
  await loadBreadthSymbols()
})

describe('⛔ the MI registry has NOT landed', () => {
  beforeEach(() => { __setMarketIndicatorsForTest(null) })

  it('⭐ an ordinary security still gets its SUBTITLE', () => {
    expect(presentationFamily('AAPL')).toBe(OHLC_FAMILY.SECURITY)
    expect(presentationFamily('QQQ')).toBe(OHLC_FAMILY.SECURITY)
  })

  it('⛔⛔ …while the CAPABILITY gate stays fail-closed', () => {
    expect(canonicalFamily('AAPL')).toBe(OHLC_FAMILY.UNKNOWN)
    expect(capability('AAPL', canonicalFamily).ok).toBe(false)
  })

  it('⛔ the fallback never invents a market indicator it cannot see', () => {
    // VVIX is unknown to the breadth registry, so the breadth-only answer is
    // `security` — a cosmetic subtitle, and the gate is unmoved.
    expect(canonicalFamily('VVIX')).toBe(OHLC_FAMILY.UNKNOWN)
    expect(capability('VVIX', canonicalFamily).ok).toBe(false)
  })
})

describe('⭐ the MI registry HAS landed', () => {
  beforeEach(() => { __setMarketIndicatorsForTest(REGISTRY) })

  it('presentation is AUTHORITATIVE whenever it can be — it is not a permanent fallback', () => {
    for (const sym of ['VIX9D', 'VVIX', 'SKEW', 'NAAIM', 'AAPL']) {
      expect(presentationFamily(sym)).toBe(canonicalFamily(sym))
    }
  })

  it('⭐ an OHLC-capable Cboe series is identified and MAY use candles', () => {
    expect(canonicalFamily('VIX9D')).toBe(OHLC_FAMILY.VOLATILITY)
    expect(capability('VIX9D', canonicalFamily).ok).toBe(true)
  })

  it('⛔⛔ a CLOSE-ONLY Cboe series is identified and MAY NOT use candles', () => {
    for (const sym of ['VVIX', 'SKEW']) {
      expect(canonicalFamily(sym)).toBe(OHLC_FAMILY.INDICATOR)
      expect(capability(sym, canonicalFamily).ok).toBe(false)
    }
  })

  it('a survey is neither a security nor a candle', () => {
    expect(canonicalFamily('NAAIM')).toBe(OHLC_FAMILY.SURVEY)
    expect(capability('NAAIM', canonicalFamily).ok).toBe(false)
  })

  it('⭐ an ordinary security is a security, and keeps candles', () => {
    expect(canonicalFamily('AAPL')).toBe(OHLC_FAMILY.SECURITY)
    expect(capability('AAPL', canonicalFamily).ok).toBe(true)
  })
})

describe('⛔⛔ the two responsibilities may not re-couple', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

  it('no capability gate is handed the PRESENTATION classifier', () => {
    for (const p of ['../components/chart/ChartSettingsIndicators.jsx',
                     '../components/StockChart.jsx']) {
      const src = read(p)
      // every `ohlcCapabilityOf(...)` / `ohlcFamilyOf:` site must name the gate's own
      // classifier, and `presentationFamily` may appear nowhere near one.
      for (const m of src.matchAll(/ohlcCapabilityOf\([^)]*\)|ohlcFamilyOf:\s*\w+/g)) {
        expect(m[0]).not.toMatch(/presentationFamily/)
      }
    }
  })

  it('the subtitle does NOT read the gate classifier', () => {
    const src = read('../components/chart/ChartSettingsIndicators.jsx')
    const i = src.indexOf('const fam = ')
    expect(i).toBeGreaterThan(-1)
    expect(src.slice(i, i + 60)).toMatch(/presentationFamily/)
  })
})
