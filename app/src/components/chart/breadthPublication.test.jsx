// A PUBLISHED breadth identity is BREADTH everywhere — and a dark one is nowhere.
//
// ⭐⭐ THE BL-013 CONSEQUENCE, ON THE CLIENT. The breadth family map is built from
// `/api/breadth-symbols`' `symbols` array, and `symbolFamily()` answers `'security'`
// for anything absent from it. While that array was a hard-wired list of the 44
// shipped UCT records, publishing a universe would have produced an identity that
// `/api/bars` served as breadth and the chart classified as an ordinary security —
// so `ohlcCapabilityOf` would have offered CANDLES over bars whose "open" is
// yesterday's value and whose wick is derived from the pair, not observed.
//
// ⛔ THESE RAILS DRIVE THE REAL MODULES through the real payload shape. Nothing here
// stubs `symbolFamily`; the point is that the PAYLOAD decides.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import CATALOG from './__fixtures__/breadthLibraryRows.json'
import { OHLC_FAMILY, OHLC_REFUSAL, ohlcCapabilityOf } from './engine/ohlcCapability'
import { parseSource, symbolSource } from './engine/sourceRef'
import { breadthResults, createFromResult, presentationFor } from './discoveryCatalog'
import { searchLibrary } from './breadthLibrary'
import * as registry from './engine/nativeRegistry'
import { presentedPlot } from './engine/presentation'
import { signColorsForPlot } from './engine/pool'

const ROWS = CATALOG.rows
const METRIC_ORDER = new Map(CATALOG.metric_order.map((m, i) => [m, i]))

/** The 44 legacy UCT rows — the DARK payload, byte-shaped as the server sends it. */
const LEGACY = ROWS.filter((r) => r.legacy)
  .map((r) => ({ symbol: r.symbol, metric: r.metric, name: r.name,
                 group: r.group, group_label: r.group_label }))

/** …plus the published US rows, as a test-only publication would send them. */
const US_PUBLISHED = ROWS.filter((r) => r.universe === 'us')
  .map((r) => ({ symbol: r.symbol, metric: r.metric, name: r.name,
                 group: r.group, group_label: r.group_label,
                 universe: r.universe, universe_label: r.universe_label }))

/** The client's own family map, built the way `useBreadthSymbols` builds it. */
function familyOfFrom(symbolRows) {
  const map = new Map(symbolRows.map((r) => [String(r.symbol).toUpperCase(), r]))
  return (sym) => (map.has(String(sym || '').toUpperCase())
    ? OHLC_FAMILY.BREADTH : OHLC_FAMILY.SECURITY)
}

/** A definition whose output IS its source — the passthrough `dataSeries`. */
const DATA_SERIES = registry.getDefinition('dataSeries')

/** Breadth bars as the server really builds them: o = yesterday's value, wick
 *  derived from the pair, volume 0. They pass every structural test there is. */
const breadthBars = () => ({
  bars: [{ t: '2015-03-10', o: 47.2, h: 47.9, l: 47.2, c: 47.9, v: 0 },
         { t: '2015-03-11', o: 47.9, h: 47.9, l: 46.1, c: 46.1, v: 0 }],
})

describe('DEFAULT — UCT only', () => {
  const familyOf = familyOfFrom(LEGACY)

  it('the payload carries the 44 shipped symbols and no colon', () => {
    expect(LEGACY).toHaveLength(44)
    expect(LEGACY.some((r) => r.symbol.includes(':'))).toBe(false)
  })

  it('⛔ a dark US identity is NOT classified as breadth — because it is not there', () => {
    expect(familyOf('UCTA50')).toBe(OHLC_FAMILY.BREADTH)
    expect(familyOf('US:A50')).toBe(OHLC_FAMILY.SECURITY)
  })

  it('and it is not discoverable either', () => {
    const rows = ROWS.filter((r) => r.legacy)
    expect(searchLibrary(rows, '50 day', { metricOrder: METRIC_ORDER })
      .map((r) => r.symbol)).toEqual(['UCTA50'])
  })
})

describe('TEST-ONLY US publication', () => {
  const symbols = [...LEGACY, ...US_PUBLISHED]
  const familyOf = familyOfFrom(symbols)

  it('publishes exactly the 18 V1 metrics, legacy untouched and first', () => {
    expect(US_PUBLISHED).toHaveLength(18)
    expect(symbols.slice(0, 44)).toEqual(LEGACY)
  })

  it('⭐ US:A50 is BREADTH, not an ordinary security', () => {
    expect(familyOf('US:A50')).toBe(OHLC_FAMILY.BREADTH)
    expect(familyOf('US:NETHL')).toBe(OHLC_FAMILY.BREADTH)
    expect(familyOf('AAPL')).toBe(OHLC_FAMILY.SECURITY)
  })

  it('⛔⛔ and it is REFUSED candles — for what it MEANS, not for what it lacks', () => {
    const parsed = parseSource(symbolSource('US:A50', 'close'))
    const cap = ohlcCapabilityOf(DATA_SERIES, parsed, breadthBars(), familyOf)
    expect(cap.ok).toBe(false)
    expect(cap.family).toBe(OHLC_FAMILY.BREADTH)
    // the refusal names the FAMILY, not a missing field — the bars have all four
    expect(cap.reason).toBe(OHLC_REFUSAL.FAMILY_NOT_OHLC)
    expect(cap.reason).not.toBe(OHLC_REFUSAL.FIELDS_MISSING)
  })

  it('an ordinary security with the same bars IS candle-capable', () => {
    const parsed = parseSource(symbolSource('AAPL', 'close'))
    expect(ohlcCapabilityOf(DATA_SERIES, parsed, breadthBars(), familyOf).ok).toBe(true)
  })

  it('⚠️ an unknown family FAILS CLOSED — never "ordinary security by default"', () => {
    const parsed = parseSource(symbolSource('US:A50', 'close'))
    const cap = ohlcCapabilityOf(DATA_SERIES, parsed, breadthBars(),
                                 () => OHLC_FAMILY.UNKNOWN)
    expect(cap.ok).toBe(false)
    expect(cap.reason).toBe(OHLC_REFUSAL.FAMILY_UNKNOWN)
  })

  it('⭐ "50 day" surfaces the published US A50, metric first', () => {
    const rows = ROWS.filter((r) => r.legacy || r.universe === 'us')
    const got = searchLibrary(rows, '50 day', { metricOrder: METRIC_ORDER })
    expect(got.map((r) => r.symbol)).toEqual(['UCTA50', 'US:A50'])
    expect(got[0].name).toBe('% of Stocks Above 50-Day MA')
    expect(got[1].universe_label).toBe('US')
  })

  it('⛔ the deferred V1.1 US metrics stay hidden — every one of them', () => {
    const rows = ROWS.filter((r) => r.legacy || r.universe === 'us')
    const usCodes = new Set(rows.filter((r) => r.universe === 'us').map((r) => r.code))
    // V1.1: momentum counts, the 20-day highs/lows, near-high, HVC, the stages…
    for (const code of ['MU', 'MD', 'U20W', 'D20W', 'U25M', 'U50M', 'U25Q',
                        'NH20', 'NL20', 'NRH', 'HVC', 'S2', 'S4', 'ADV', 'DEC',
                        'UV', 'UPV', 'DNV', 'XR', 'MC', 'AD']) {
      expect(usCodes.has(code), code).toBe(false)
      // ⚠️ ASSERT ON THE IDENTITY, NOT ON AN EMPTY RESULT. `US:ADV` legitimately
      // fuzzy-matches "Net Advancers" through the substring tier; what must never
      // exist is the IDENTITY `US:ADV` itself.
      expect(searchLibrary(rows, `US:${code}`, { metricOrder: METRIC_ORDER })
        .some((r) => r.symbol === `US:${code}`), code).toBe(false)
    }
    // …while UCT keeps every one of them, because UCT already shipped them
    const uct = new Set(rows.filter((r) => r.legacy).map((r) => r.code))
    expect(uct.has('MU')).toBe(true)
    expect(uct.has('S2')).toBe(true)
  })

  it('⛔ NASDAQ and NYSE stay hidden while only US is published', () => {
    const rows = ROWS.filter((r) => r.legacy || r.universe === 'us')
    expect(rows.some((r) => r.universe === 'nasdaq' || r.universe === 'nyse')).toBe(false)
  })

  it('⛔ a colon still does not make something breadth', () => {
    const rows = ROWS.filter((r) => r.legacy || r.universe === 'us')
    for (const bad of ['NASDAQ:AAPL', 'FOO:BAR', 'US:NOPE']) {
      expect(searchLibrary(rows, bad, { metricOrder: METRIC_ORDER })).toEqual([])
      expect(familyOf(bad)).toBe(OHLC_FAMILY.SECURITY)
    }
  })
})

describe('the published identity travels the CANONICAL path, with no US branch', () => {
  const pick = (sym) => {
    const rows = ROWS.filter((r) => r.legacy || r.universe === 'us')
    return breadthResults(searchLibrary(rows, sym, { limit: 1, metricOrder: METRIC_ORDER }))[0]
  }

  it('search → result → dataSeries → canonical source', () => {
    const res = pick('US:A50')
    expect(res.kind).toBe('breadth')
    expect(res.create.source).toBe('sym:US:A50:close')
    const cs = createFromResult({ indicatorInstances: [] }, res, registry)
    const [inst] = cs.indicatorInstances
    expect(inst.inputs.source).toBe('sym:US:A50:close')
    expect(parseSource(inst.inputs.source).symbol).toBe('US:A50')
  })

  it('⭐ US:NETHL is a signed histogram with a zero baseline — no NETHL pane code', () => {
    const res = pick('US:NETHL')
    expect(res.create.presentation).toEqual({ plotStyle: 'histogram', signColors: true })
    const cs = createFromResult({ indicatorInstances: [] }, res, registry)
    const plot = presentedPlot({ key: 'value', style: 'line', color: '#4f9cf9' },
                               cs.indicatorInstances[0])
    expect(plot.style).toBe('histogram')
    expect(plot.colorMode).toBe('sign')          // the zero baseline that MEANS something
    expect(signColorsForPlot(plot)).toEqual({ up: '#2faf68', down: '#df4646' })
  })

  it('…and US:A50 is a plain line, from the same chain', () => {
    const res = pick('US:A50')
    expect(res.create.presentation).toBeUndefined()
    const cs = createFromResult({ indicatorInstances: [] }, res, registry)
    const plot = presentedPlot({ key: 'value', style: 'line', color: '#4f9cf9' },
                               cs.indicatorInstances[0])
    expect(plot.style).toBe('line')
    expect(signColorsForPlot(plot)).toBeNull()
  })

  it('⛔ presentation comes from CATALOGUE METADATA, never from the universe', () => {
    const us = ROWS.find((r) => r.symbol === 'US:NETHL')
    const uctLine = ROWS.find((r) => r.symbol === 'UCTA50')
    expect(presentationFor(us)).toEqual({ plotStyle: 'histogram', signColors: true })
    expect(presentationFor(uctLine)).toBeNull()
    // the same metadata under ANY universe gives the same answer
    expect(presentationFor({ ...us, universe: 'nasdaq', universe_label: 'NASDAQ' }))
      .toEqual(presentationFor(us))
  })

  it('save → reopen keeps the published identity and its presentation', () => {
    let cs = { indicatorInstances: [] }
    for (const sym of ['UCTA50', 'US:A50', 'US:NETHL']) {
      cs = createFromResult(cs, pick(sym), registry)
    }
    const reopened = JSON.parse(JSON.stringify(cs))
    expect(reopened).toEqual(cs)
    expect(reopened.indicatorInstances.map((i) => i.inputs.source)).toEqual([
      'sym:UCTA50:close', 'sym:US:A50:close', 'sym:US:NETHL:close'])
    const plot = presentedPlot({ key: 'value', style: 'line', color: '#4f9cf9' },
                               reopened.indicatorInstances[2])
    expect(plot.colorMode).toBe('sign')
  })
})

// ── §17 · "registered breadth but DARK" — the audit, with evidence ───────────
//
// ⭐⭐ THE QUESTION: can the canonical family architecture represent "registered
// breadth, not currently published" as UNAVAILABLE BREADTH rather than as an
// ordinary security — without widening colon symbols, without making
// `NASDAQ:AAPL` breadth, without a ticker-prefix special case, without breaking
// rollback, and WITHOUT EXPOSING THE IDENTITY PUBLICLY?
//
// ⛔ THE ANSWER IS NO, AND THE LAST CONSTRAINT IS WHY. `symbolFamily` knows only
// what the payload told it. For the client to call a dark `US:A50` "breadth" the
// server would have to name it in the payload — which IS exposing the identity,
// the one thing the constraint set forbids. There is no third source of truth: a
// shape test would make `FOO:BAR` breadth, and a prefix test is the special case
// this project reverted once already (BL-008).
//
// ⚠️ AND THE REACHABLE BEHAVIOUR IS ALREADY CORRECT, which these rails measure
// rather than assume. A dark identity is undiscoverable and unservable, so the
// only way to hold one is a chart saved while it WAS published — i.e. after a
// rollback. In that state the server serves no bars, and the refusal that
// actually fires is NO_BARS. The family label differs; the outcome does not.
describe('§17 — a DARK registered identity behaves as unavailable, not as a security', () => {
  const familyOf = familyOfFrom(LEGACY)          // dark: UCT only
  const parsed = parseSource(symbolSource('US:A50', 'close'))

  it('the reachable state is NO BARS — the server refuses to serve a dark identity', () => {
    const cap = ohlcCapabilityOf(DATA_SERIES, parsed, { bars: [] }, familyOf)
    expect(cap.ok).toBe(false)
    expect(cap.reason).toBe(OHLC_REFUSAL.NO_BARS)
  })

  it('…and with no cache entry at all, likewise', () => {
    expect(ohlcCapabilityOf(DATA_SERIES, parsed, null, familyOf).reason)
      .toBe(OHLC_REFUSAL.NO_BARS)
  })

  it('⛔ so a saved chart from before a rollback renders UNAVAILABLE, never candles', () => {
    // the instance survives the round-trip; it simply has nothing to draw
    const cs = { indicatorInstances: [{ instanceId: 'inst:dataSeries:1',
                                        defId: 'dataSeries',
                                        inputs: { source: 'sym:US:A50:close' } }] }
    const reopened = JSON.parse(JSON.stringify(cs))
    expect(reopened.indicatorInstances[0].inputs.source).toBe('sym:US:A50:close')
    expect(ohlcCapabilityOf(DATA_SERIES, parsed, { bars: [] }, familyOf).ok).toBe(false)
  })

  it('⛔ the identity stays out of discovery entirely while dark', () => {
    const rows = ROWS.filter((r) => r.legacy)
    expect(searchLibrary(rows, 'US:A50', { metricOrder: METRIC_ORDER })).toEqual([])
    expect(rows.some((r) => r.symbol === 'US:A50')).toBe(false)
  })

  it('⛔ and nothing else gained breadth identity from any of this', () => {
    for (const sym of ['AAPL', 'NASDAQ:AAPL', 'FOO:BAR', 'UCTT']) {
      expect(familyOf(sym), sym).toBe(OHLC_FAMILY.SECURITY)
    }
    // …while every published UCT symbol still is breadth
    expect(familyOf('UCTA50')).toBe(OHLC_FAMILY.BREADTH)
  })
})
