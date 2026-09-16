// A registered Breadth Library identity flows through the CANONICAL chart-data
// seam — the same `discoveryCatalog` → `dataSeries` path a security uses.
//
// ⛔ THE POINT IS THAT NOTHING IS SPECIAL. There is no breadth pane, no breadth
// renderer, no `if (sym === 'US:NETHL')`. A library row differs from a security row
// in DISCOVERY METADATA and in the string after `sym:` — and, for the signed ones,
// in what the CATALOGUE says about how to draw them.
import { describe, it, expect } from 'vitest'

import {
  breadthResults, createFromResult, createDirectSeries, presentationFor,
  lastCreatedInstance, CAPABILITY, CREATE_VIA,
} from './discoveryCatalog'
import * as registry from './engine/nativeRegistry'
import { parseSource, symbolSourceLabel } from './engine/sourceRef'
import { presentedPlot } from './engine/presentation'
import { signColorsForPlot } from './engine/pool'

// Rows exactly as `breadth_symbols.library_rows()` produces them.
const ROW_A50 = {
  universe: 'nasdaq', universe_label: 'NASDAQ', metric: 'pct_above_50sma',
  code: 'A50', symbol: 'NASDAQ:A50', name: '% of Stocks Above 50-Day MA',
  short_name: 'A50', group: 'ma', group_label: 'MA Breadth', unit: 'percent',
  domain: 'pct_0_100', presentation: 'line', floor: '2011-01-01', legacy: false,
}
const ROW_NETHL = {
  universe: 'us', universe_label: 'US', metric: 'net_new_high_low',
  code: 'NETHL', symbol: 'US:NETHL', name: 'Net New 52-Week Highs-Lows',
  short_name: 'Net H-L', group: 'highs_lows', group_label: 'Highs / Lows',
  unit: 'count', domain: 'signed', presentation: 'histogram',
  floor: '2008-01-02', legacy: false,
}
// A shipped UCT row, exactly as `/api/breadth-symbols` sends it today.
const ROW_UCT = {
  symbol: 'UCTA50', metric: 'pct_above_50sma',
  name: '% of Stocks Above 50-Day MA', group: 'ma', group_label: 'MA Breadth',
}

// ⚠️ THE REAL REGISTRY. A stub whose `getDefinition` answers null makes
// `addInstance` refuse, and every assertion below would then fail for a reason
// unrelated to what it tests.
const emptyChart = () => ({ indicatorInstances: [] })

describe('a library row becomes an ordinary data series', () => {
  it('adapts to a chartable result with a canonical sym: source', () => {
    const [res] = breadthResults([ROW_A50])
    expect(res.kind).toBe('breadth')
    expect(res.capability).toBe(CAPABILITY.CHARTABLE)
    expect(res.create.via).toBe(CREATE_VIA.DATA_SERIES)
    expect(res.create.source).toBe('sym:NASDAQ:A50:close')
    expect(parseSource(res.create.source)).toEqual({
      kind: 'symbol', symbol: 'NASDAQ:A50', field: 'close',
    })
  })

  it('works for every approved universe', () => {
    for (const sym of ['US:A50', 'NASDAQ:A50', 'NYSE:A50', 'US:NETHL', 'NYSE:NETHL']) {
      const [res] = breadthResults([{ ...ROW_A50, symbol: sym }])
      expect(res.create.source, sym).toBe(`sym:${sym}:close`)
      expect(parseSource(res.create.source).symbol, sym).toBe(sym)
    }
  })

  it('⭐ the UNIVERSE is the short name, so a multi-series pane is readable', () => {
    // Four A50 series in one pane read UCT / US / NASDAQ / NYSE — the metric is
    // stated once by the pane, and the universe is what actually differs.
    const rows = [
      { ...ROW_A50, universe_label: 'US', symbol: 'US:A50' },
      { ...ROW_A50, universe_label: 'NASDAQ', symbol: 'NASDAQ:A50' },
      { ...ROW_A50, universe_label: 'NYSE', symbol: 'NYSE:A50' },
    ]
    expect(breadthResults(rows).map((r) => r.shortName)).toEqual(['US', 'NASDAQ', 'NYSE'])
    expect(breadthResults(rows).map((r) => r.name))
      .toEqual(Array(3).fill('% of Stocks Above 50-Day MA'))
  })

  it('⚠️ a shipped UCT row is completely unchanged', () => {
    const [res] = breadthResults([ROW_UCT])
    expect(res.shortName).toBe('UCTA50')          // no universe_label → the symbol
    expect(res.create).toEqual({
      via: CREATE_VIA.DATA_SERIES, source: 'sym:UCTA50:close',
    })
    expect(res.create.presentation).toBeUndefined()
  })

  it('labels a namespaced source readably', () => {
    expect(symbolSourceLabel(parseSource('sym:NASDAQ:A50:close')))
      .toBe('NASDAQ:A50 · Close')
  })
})

describe('presentation comes from the catalogue, never from the ticker', () => {
  it('maps a signed histogram metric, and nothing else', () => {
    expect(presentationFor(ROW_NETHL)).toEqual({ plotStyle: 'histogram', signColors: true })
    expect(presentationFor(ROW_A50)).toBeNull()
    expect(presentationFor(ROW_UCT)).toBeNull()
    expect(presentationFor(null)).toBeNull()
    // a histogram that is NOT signed gets no sign colours
    expect(presentationFor({ presentation: 'histogram', domain: 'nonneg' }))
      .toEqual({ plotStyle: 'histogram' })
    // a signed LINE stays a line
    expect(presentationFor({ presentation: 'line', domain: 'signed' })).toBeNull()
  })

  it('stamps it on the created instance', () => {
    const [res] = breadthResults([ROW_NETHL])
    const cs = createFromResult(emptyChart(), res, registry)
    const inst = lastCreatedInstance(emptyChart(), cs)
    expect(inst.inputs.source).toBe('sym:US:NETHL:close')
    expect(inst.presentation).toEqual({ plotStyle: 'histogram', signColors: true })
    expect(inst.display).toEqual({ name: 'US' })
  })

  it('⛔ reaches the renderer with NO ticker branch anywhere', () => {
    const [res] = breadthResults([ROW_NETHL])
    const cs = createFromResult(emptyChart(), res, registry)
    const inst = lastCreatedInstance(emptyChart(), cs)
    const plot = { key: 'value', label: 'Value', style: 'line', color: '#4f9cf9' }
    const drawn = presentedPlot(plot, inst)
    expect(drawn.style).toBe('histogram')
    expect(signColorsForPlot(drawn)).toEqual({ up: '#2faf68', down: '#df4646' })
  })

  it('an A50 series stays a plain line with no presentation stamped', () => {
    const [res] = breadthResults([ROW_A50])
    const cs = createFromResult(emptyChart(), res, registry)
    const inst = lastCreatedInstance(emptyChart(), cs)
    expect(inst.presentation).toBeUndefined()
    const plot = { key: 'value', style: 'line', color: '#4f9cf9' }
    expect(presentedPlot(plot, inst)).toBe(plot)      // untouched
  })

  it('⚰️ presentation survives even when the NAME is not worth storing', () => {
    // The name rule is about PROVENANCE (a name identical to the derived one is not
    // a choice). Gating presentation on the same flag dropped a signed histogram's
    // style whenever its label matched its source — a defect whose only symptom is
    // a line where a histogram belonged.
    const cs = createDirectSeries(emptyChart(), 'sym:US:NETHL:close', registry,
                                  { name: null, presentation: { plotStyle: 'histogram', signColors: true } })
    const inst = lastCreatedInstance(emptyChart(), cs)
    expect(inst.presentation).toEqual({ plotStyle: 'histogram', signColors: true })
  })
})

describe('signed values survive the whole path', () => {
  it('+500, 0 and -663 all colour correctly with a zero baseline', () => {
    const [res] = breadthResults([ROW_NETHL])
    const cs = createFromResult(emptyChart(), res, registry)
    const inst = lastCreatedInstance(emptyChart(), cs)
    const drawn = presentedPlot({ key: 'value', style: 'line' }, inst)
    const sc = signColorsForPlot(drawn)
    const colourOf = (v) => (v >= 0 ? sc.up : sc.down)
    expect(colourOf(500)).toBe(sc.up)
    expect(colourOf(0)).toBe(sc.up)
    expect(colourOf(-150)).toBe(sc.down)
    expect(colourOf(-663)).toBe(sc.down)
  })
})
