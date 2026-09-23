// app/src/components/chart/engine/__tests__/fundamentalSource.test.js
//
// ─── `fund:` — THE FOURTH SOURCE FAMILY, END TO END IN THE ENGINE ───────────
//
// ⭐ The grammar, the cache (statuses, dedupe, DENIED terminal), the AS-OF
// column, the price composers, and the REAL binder resolving a `fund:` source
// into an ordinary dataSeries / Moving Average column. And the regression that
// matters most: `sym:` keeps its exact-t rule.
import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { parseSource, symbolSource, symbolsNeeded, instanceSource } from '../sourceRef'
import { fundamentalSource, parseFundamentalSource, fundamentalColumn, fundamentalsNeeded } from '../fundamentalSource'
import {
  _resetFundamentalsForTests, primeFundamentalsCatalog, setFundamentalsFetcher, ensureFundamentals,
  fundamentalsCatalog, SOURCE_STATUS,
} from '../fundamentalSeries'
import { closeUtcSeconds } from '../fundamentalAsOf'
import { projectSymbolField } from '../symbolProjection'

const CATALOG = {
  metrics: [
    { id: 'net_margin', name: 'Net Margin', series: 'net_margin_ttm', compose: null, inputs: [],
      presentation: 'step', cadence: 'quarterly', unit: 'percent', fmt: 'pct1', category: 'Profitability' },
    { id: 'market_cap', name: 'Market Cap', series: null, compose: 'market_cap', inputs: ['shares_outstanding'],
      presentation: 'line', cadence: 'daily', unit: 'usd', fmt: 'compact_usd', category: 'Valuation' },
    { id: 'pe_ttm', name: 'P/E (TTM)', series: null, compose: 'pe', inputs: ['eps_diluted_ttm'],
      presentation: 'line', cadence: 'daily', unit: 'ratio', fmt: 'x2', category: 'Valuation' },
  ],
}

// Ascending trading days, Mon 2025-02-10 .. (weekdays only)
function days(n, start = '2025-02-10') {
  const out = []
  const d = new Date(`${start}T00:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const bars = (n, base = 100) => days(n).map((t, i) => ({ t, o: base + i, h: base + i + 1, l: base + i - 1, c: base + i, v: 1000 }))
// a point public at hh:mm ET on `iso`
const at = (iso, hh, mm) => closeUtcSeconds(iso) + (hh - 16) * 3600 + mm * 60
const pt = (iso, hh, mm, v, pe = '2024-12-31') => Object.freeze({ t: at(iso, hh, mm), v, pe })

beforeEach(() => { _resetFundamentalsForTests() })

describe('the grammar', () => {
  it('⭐ own-symbol and pinned forms round-trip', () => {
    expect(fundamentalSource('net_margin')).toBe('fund:net_margin')
    expect(fundamentalSource('net_margin', 'aapl')).toBe('fund:AAPL:net_margin')
    expect(parseSource('fund:net_margin')).toEqual({ kind: 'fundamental', symbol: null, metric: 'net_margin' })
    expect(parseSource('fund:$IDX:AI:revenue_ttm')).toEqual({ kind: 'fundamental', symbol: '$IDX:AI', metric: 'revenue_ttm' })
  })

  it('⛔ malformed is unresolved, never Close', () => {
    for (const bad of ['fund:', 'fund:Net Margin', 'fund:AAPL:', 'fund::net_margin', 'fund:AA PL:net_margin']) {
      expect(parseSource(bad), bad).toBe(null)
    }
    expect(parseFundamentalSource('sym:QQQ:close')).toBe(null)
  })

  it('⛔⛔ sym: is untouched — same parse, same exact-t, no fill', () => {
    expect(parseSource('sym:QQQ:close')).toEqual({ kind: 'symbol', symbol: 'QQQ', field: 'close' })
    const primary = [{ t: '2026-01-02' }, { t: '2026-01-05' }]
    expect(projectSymbolField([{ t: '2026-01-02', c: 5 }], 'close', primary)).toEqual([5, NaN])
  })

  it('a pinned fundamental asks for its symbol\'s bars (for price composition)', () => {
    const defOf = (id) => registry.getDefinition(id)
    const insts = [{ instanceId: 'a', defId: 'dataSeries', inputs: { source: 'fund:AAPL:market_cap' } },
                   { instanceId: 'b', defId: 'dataSeries', inputs: { source: 'fund:net_margin' } }]
    expect(symbolsNeeded(insts, defOf)).toEqual(['AAPL'])
  })
})

describe('the cache', () => {
  it('⭐ the catalogue loads once; 404 (dark feature) is terminal', async () => {
    let calls = 0
    setFundamentalsFetcher(async () => { calls += 1; const e = new Error('404'); e.status = 404; throw e })
    fundamentalsCatalog(); fundamentalsCatalog()
    await new Promise((r) => setTimeout(r, 0))
    expect(fundamentalsCatalog().status).toBe(SOURCE_STATUS.UNSUPPORTED)
    fundamentalsCatalog()
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toBe(1)
  })

  it('⛔ 401/403 is DENIED and never re-asked', async () => {
    let calls = 0
    setFundamentalsFetcher(async () => { calls += 1; const e = new Error('403'); e.status = 403; throw e })
    expect(ensureFundamentals('AAPL', ['net_margin_ttm']).status).toBe(SOURCE_STATUS.LOADING)
    await new Promise((r) => setTimeout(r, 0))
    expect(ensureFundamentals('AAPL', ['net_margin_ttm']).status).toBe(SOURCE_STATUS.DENIED)
    ensureFundamentals('AAPL', ['net_margin_ttm'])
    expect(calls).toBe(1)
  })

  it('⭐ one request per (symbol, series set), however many ask', async () => {
    let calls = 0
    setFundamentalsFetcher(async () => { calls += 1; return { metrics: { net_margin_ttm: [[1, 0.2, '2024-12-31', 'ratio']] } } })
    ensureFundamentals('AAPL', ['net_margin_ttm']); ensureFundamentals('aapl', ['net_margin_ttm'])
    await new Promise((r) => setTimeout(r, 0))
    const e = ensureFundamentals('AAPL', ['net_margin_ttm'])
    expect(calls).toBe(1)
    expect(e.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(e.series.net_margin_ttm[0]).toEqual({ t: 1, v: 0.2, pe: '2024-12-31', m: 'ratio' })
  })
})

describe('the column', () => {
  beforeEach(() => primeFundamentalsCatalog(CATALOG))

  it('⭐⭐ as-of: the value holds from its public time, and not a bar earlier', () => {
    const b = bars(10)                           // 2025-02-10 .. 2025-02-21
    // filed 2025-02-14 16:42 ET -> first applies to Mon 2025-02-17
    const entry = { series: { net_margin_ttm: [pt('2025-02-14', 16, 42, 0.18)] } }
    const col = fundamentalColumn(parseSource('fund:net_margin'), {
      bars: b, tf: 'D', sym: 'AAPL', fundamentals: new Map([['AAPL', entry]]) })
    const byDay = Object.fromEntries(b.map((x, i) => [x.t, col[i]]))
    expect(Number.isNaN(byDay['2025-02-14'])).toBe(true)
    expect(byDay['2025-02-17']).toBe(0.18)
    expect(byDay['2025-02-21']).toBe(0.18)
  })

  it('⛔ not loaded / unknown metric is null — not computable, never zero', () => {
    const b = bars(5)
    expect(fundamentalColumn(parseSource('fund:net_margin'), { bars: b, tf: 'D', sym: 'AAPL', fundamentals: new Map() })).toBe(null)
    expect(fundamentalColumn(parseSource('fund:no_such_metric'), { bars: b, tf: 'D', sym: 'AAPL',
      fundamentals: new Map([['AAPL', { series: {} }]]) })).toBe(null)
  })

  it('⭐ market cap = the bar\'s own close x the shares KNOWN at that close', () => {
    const b = bars(10)
    const entry = { series: { shares_outstanding: [pt('2025-02-10', 10, 0, 1000, '2025-01-31'),
                                                   pt('2025-02-14', 16, 30, 800, '2025-02-10')] } }
    const close = b.map((x) => x.c)
    const col = fundamentalColumn(parseSource('fund:market_cap'), {
      bars: b, tf: 'D', sym: 'AAPL', fundamentals: new Map([['AAPL', entry]]), closeOf: () => close })
    expect(col[0]).toBe(b[0].c * 1000)
    expect(col[4]).toBe(b[4].c * 1000)          // Fri 02-14: the 16:30 filing is after the close
    expect(col[5]).toBe(b[5].c * 800)           // Mon 02-17
  })

  it('⛔ P/E on non-positive EPS is blank, never a negative multiple', () => {
    const b = bars(3)
    const entry = { series: { eps_diluted_ttm: [pt('2025-02-07', 10, 0, -1.5)] } }
    const col = fundamentalColumn(parseSource('fund:pe_ttm'), {
      bars: b, tf: 'D', sym: 'X', fundamentals: new Map([['X', entry]]), closeOf: () => b.map((x) => x.c) })
    expect(col.every((v) => Number.isNaN(v))).toBe(true)
  })

  it('the needed set comes from the catalogue (composers ask for their inputs)', () => {
    const needed = fundamentalsNeeded([parseSource('fund:market_cap'), parseSource('fund:NVDA:net_margin')], 'AAPL')
    expect([...needed.AAPL]).toEqual(['shares_outstanding'])
    expect([...needed.NVDA]).toEqual(['net_margin_ttm'])
  })
})

// ─── through the REAL binder ────────────────────────────────────────────────
function harness() {
  const created = []
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const series = { __data: [], ctor, options, paneIndex,
        setData: (d) => { series.__data = d }, update: () => {}, applyOptions: (o) => Object.assign(options, o),
        priceScale: () => ({ applyOptions: () => {} }), createPriceLine: () => ({}), removePriceLine: () => {},
        setMarkers: () => {} }
      created.push(series)
      return series
    },
    removeSeries: () => {},
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = { LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries', CandlestickSeries: 'CandlestickSeries',
    BarSeries: 'BarSeries', AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries' }
  return { chart, LWC, created }
}

function draw(instances, fundamentals, b = bars(10)) {
  const h = harness()
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  binder.sync({ enabled: true, registry, instances, bars: b, cs: { indicatorInstances: instances },
    sym: 'AAPL', tf: 'D', fundamentals,
    resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }) })
  return h.created.map((s) => s.__data.map((p) => p.value))
}

describe('the binder resolves fund: into an ordinary column', () => {
  beforeEach(() => primeFundamentalsCatalog(CATALOG))
  const entry = { series: { net_margin_ttm: [pt('2025-02-07', 16, 10, 0.2), pt('2025-02-14', 16, 42, 0.25)] } }

  it('⭐⭐ a dataSeries over fund:net_margin draws the as-of steps', () => {
    const [vals] = draw([{ instanceId: 'f1', defId: 'dataSeries', inputs: { source: 'fund:net_margin' }, hidden: false }],
      new Map([['AAPL', entry]]))
    const finite = vals.filter(Number.isFinite)
    expect(finite.slice(0, 5)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2])   // 02-10..02-14
    expect(finite.slice(5)).toEqual([0.25, 0.25, 0.25, 0.25, 0.25]) // 02-17..
  })

  it('⛔ with the series not yet loaded it draws NOTHING (not the chart\'s price)', () => {
    const out = draw([{ instanceId: 'f1', defId: 'dataSeries', inputs: { source: 'fund:net_margin' }, hidden: false }], new Map())
    expect((out[0] || []).filter(Number.isFinite)).toHaveLength(0)
  })

  it('⭐ Moving Average over a fundamental instance composes with no engine change', () => {
    const insts = [
      { instanceId: 'f1', defId: 'dataSeries', inputs: { source: 'fund:net_margin' }, hidden: false },
      { instanceId: 'm1', defId: 'movingAverage', inputs: { source: instanceSource('f1', 'value'), period: 2, maType: 'sma' }, hidden: false },
    ]
    const out = draw(insts, new Map([['AAPL', entry]]))
    const ma = out.find((v) => v.filter(Number.isFinite).some((x) => Math.abs(x - 0.225) < 1e-12))
    expect(ma, 'the MA of the step series should average 0.20 and 0.25 at the step').toBeTruthy()
  })

  it('⛔⛔ a sym: source on the same chart is still exact-t', () => {
    const b = bars(10)
    const sec = b.filter((_, i) => i !== 3).map((x) => ({ ...x, c: x.c + 500 }))
    const out = draw([{ instanceId: 's1', defId: 'dataSeries', inputs: { source: symbolSource('QQQ', 'close') }, hidden: false }],
      new Map(), b)
    expect(out.length).toBeGreaterThanOrEqual(0)
    const h = harness()
    const binder = createBinder({ chart: h.chart, LWC: h.LWC })
    binder.sync({ enabled: true, registry, instances: [{ instanceId: 's1', defId: 'dataSeries', inputs: { source: symbolSource('QQQ', 'close') }, hidden: false }],
      bars: b, cs: {}, sym: 'AAPL', tf: 'D', secondary: new Map([['QQQ', { bars: sec, status: 'ok' }]]),
      resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }) })
    const vals = h.created[0].__data.map((p) => p.value)
    expect(vals.filter(Number.isFinite)).toHaveLength(9)          // the missing bar stays a gap
  })
})
