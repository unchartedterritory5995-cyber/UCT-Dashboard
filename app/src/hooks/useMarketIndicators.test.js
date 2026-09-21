import { describe, it, expect, beforeEach, vi } from 'vitest'

// ⛔ THE BREADTH REGISTRY IS MOCKED RATHER THAN SEAMED. `useBreadthSymbols` is a
// shared, shipped module with no test hook, and adding one to it for this file's
// convenience would be a production change made for a test. Mocking controls both
// of the functions `canonicalFamily` composes, which is all this needs.
const breadth = { family: 'unknown', ready: false }
vi.mock('./useBreadthSymbols', () => ({
  symbolFamily: (s) => (breadth.map && breadth.map.has(String(s).toUpperCase())
    ? 'breadth'
    : (breadth.ready ? 'security' : 'unknown')),
  breadthRegistryReady: () => breadth.ready,
}))

import { OHLC_FAMILY, OHLC_REFUSAL, ohlcCapabilityOf }
  from '../components/chart/engine/ohlcCapability'
import {
  canonicalFamily, isMarketIndicator, marketIndicatorRecord,
  marketIndicatorRegistryReady, __setMarketIndicatorsForTest,
} from './useMarketIndicators'

/** Stand the breadth registry up (or not) for one case. */
function setBreadth(ready, symbols = []) {
  breadth.ready = ready
  breadth.map = new Set(symbols.map((s) => s.toUpperCase()))
}

// A registry payload shaped exactly like `/api/market-indicators` returns.
const PAYLOAD = {
  rows: [
    { id: 'US:MCO', symbol: 'US:MCO', display: 'US · McClellan Oscillator',
      source_type: 'breadth_derived', ohlc_capable: false, aliases: [] },
    { id: 'SENT:NAAIM', symbol: 'NAAIM', display: 'NAAIM Exposure Index',
      source_type: 'survey', ohlc_capable: false, aliases: ['SENT:NAAIM'] },
    { id: 'CBOE:VIX9D', symbol: 'VIX9D', display: 'Cboe S&P 500 9-Day Volatility Index',
      source_type: 'volatility', ohlc_capable: true, aliases: ['CBOE:VIX9D', '$VIX9D'] },
    { id: 'CBOE:VVIX', symbol: 'VVIX', display: 'Cboe VIX of VIX Index',
      source_type: 'volatility', ohlc_capable: false, aliases: ['CBOE:VVIX'] },
  ],
  families: [{ id: 'mcclellan', label: 'McClellan' }],
  // ⛔ NYMO ships in `dormant`, NOT in `rows` — the hook must never index it.
  dormant: [
    { id: 'NYSE:MCO', symbol: 'NYMO', display: 'NYSE McClellan Oscillator',
      source_type: 'breadth_derived', ohlc_capable: false, aliases: ['$NYMO'] },
  ],
}

const PASSTHROUGH = { passthrough: true }
const SYM = (symbol) => ({ kind: 'symbol', symbol, field: 'close' })
const BARS = { bars: [{ t: '2026-01-02', o: 1, h: 2, l: 0.5, c: 1.5 }] }

describe('useMarketIndicators — the second registry, client side', () => {
  beforeEach(() => {
    __setMarketIndicatorsForTest(null)
    setBreadth(false)
  })

  it('classifies nothing until BOTH registries have answered', () => {
    // ⛔⛔ THE FAIL-CLOSED DIRECTION. "Not one of ours" and "we have not been told"
    // are indistinguishable until both fetches land, and only one of them may draw a
    // candle. Answering 'security' early puts a misleading candle on a chart.
    __setMarketIndicatorsForTest(PAYLOAD)
    expect(marketIndicatorRegistryReady()).toBe(true)
    expect(canonicalFamily('AAPL')).toBe(OHLC_FAMILY.UNKNOWN)

    setBreadth(true)
    expect(canonicalFamily('AAPL')).toBe(OHLC_FAMILY.SECURITY)
  })

  it('classifies each source type by what its bars actually mean', () => {
    __setMarketIndicatorsForTest(PAYLOAD)
    setBreadth(true)
    expect(canonicalFamily('US:MCO')).toBe(OHLC_FAMILY.INDICATOR)
    expect(canonicalFamily('NAAIM')).toBe(OHLC_FAMILY.SURVEY)
    expect(canonicalFamily('VIX9D')).toBe(OHLC_FAMILY.VOLATILITY)
  })

  it('refuses candles for a close-only volatility index', () => {
    // ⛔⛔ Cboe publish VIX as DATE,OPEN,HIGH,LOW,CLOSE but VVIX as DATE,VVIX.
    // A family-level claim would draw a tidy candlestick over a synthesised
    // o=h=l=c whose body and range mean nothing, which a member cannot see.
    __setMarketIndicatorsForTest(PAYLOAD)
    setBreadth(true)
    expect(canonicalFamily('VVIX')).toBe(OHLC_FAMILY.INDICATOR)
    expect(ohlcCapabilityOf(PASSTHROUGH, SYM('VVIX'), BARS, canonicalFamily).ok).toBe(false)
    expect(ohlcCapabilityOf(PASSTHROUGH, SYM('VIX9D'), BARS, canonicalFamily).ok).toBe(true)
  })

  it('refuses candles for a derived indicator and for a survey', () => {
    __setMarketIndicatorsForTest(PAYLOAD)
    setBreadth(true)
    for (const sym of ['US:MCO', 'NAAIM']) {
      const cap = ohlcCapabilityOf(PASSTHROUGH, SYM(sym), BARS, canonicalFamily)
      expect(cap.ok).toBe(false)
      expect(cap.reason).toBe(OHLC_REFUSAL.FAMILY_NOT_OHLC)
    }
  })

  it('resolves a series by id, member symbol and alias alike', () => {
    __setMarketIndicatorsForTest(PAYLOAD)
    expect(marketIndicatorRecord('SENT:NAAIM').symbol).toBe('NAAIM')
    expect(marketIndicatorRecord('naaim').id).toBe('SENT:NAAIM')
    expect(marketIndicatorRecord('$VIX9D').id).toBe('CBOE:VIX9D')
  })

  it('never indexes a dormant series', () => {
    // ⛔ NYMO is fully described in `dormant` so a diagnostic surface can explain it,
    // and is unreachable to every capability gate downstream.
    __setMarketIndicatorsForTest(PAYLOAD)
    setBreadth(true)
    expect(isMarketIndicator('NYMO')).toBe(false)
    expect(marketIndicatorRecord('NYMO')).toBe(null)
    expect(canonicalFamily('NYMO')).toBe(OHLC_FAMILY.SECURITY)  // "not one of ours"
  })

  it('lets breadth win over the indicator registry', () => {
    // ⛔ ORDER MATTERS. The 44 shipped pseudo-tickers can never be reclassified by a
    // newer catalogue — the backward-compatibility guarantee the server makes too.
    __setMarketIndicatorsForTest({
      ...PAYLOAD,
      rows: [...PAYLOAD.rows,
             { id: 'UCT:A50', symbol: 'UCTA50', display: 'nope',
               source_type: 'volatility', ohlc_capable: true, aliases: [] }],
    })
    setBreadth(true, ['UCTA50'])
    expect(canonicalFamily('UCTA50')).toBe(OHLC_FAMILY.BREADTH)
  })

  it('survives a registry that never arrives', () => {
    __setMarketIndicatorsForTest(null)
    expect(marketIndicatorRegistryReady()).toBe(false)
    expect(canonicalFamily('VIX9D')).toBe(OHLC_FAMILY.UNKNOWN)
    expect(isMarketIndicator('VIX9D')).toBe(false)
  })
})
