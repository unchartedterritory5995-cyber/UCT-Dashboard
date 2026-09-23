// THE MEMBER-FACING DOORS — the ones production acceptance actually uses.
//
// ⚰️⚰️ WHY THIS FILE EXISTS. The previous acceptance pass drove
// `IndicatorLibraryDialog` (the harness's `＋ Add to Chart…`) and declared the
// feature accepted. The member's door is `ChartSettingsIndicators` — a DIFFERENT
// component with a DIFFERENT merge rule — and on that door the AAII Sentiment
// Survey was invisible. A harness that exercises a surface the product does not
// use cannot accept the product. Every case here pins a rule a real door obeys.

import { describe, it, expect } from 'vitest'
import {
  liveDiscoveryRows, marketIndicatorResults, securityResults,
  createProductSeries, CREATE_VIA,
} from '../discoveryCatalog'
import { matches } from '../IndicatorLibraryDialog'
import { sourceCapabilityOf, primaryChartTypeFor, primaryChartTypesFor } from '../engine/sourceCapability'
import { primaryProductInstances, withPrimaryProduct, isPrimaryProductInstance } from '../engine/primaryProduct'
import * as registry from '../engine/nativeRegistry'

// The catalogue row production's /api/market-indicators emits for the product.
const PRODUCT_ROW = {
  id: 'AAII:SURVEY', symbol: 'AAII:SURVEY', kind: 'product',
  display: 'AAII Sentiment Survey', short: 'AAII Survey',
  family: 'sentiment', family_label: 'Sentiment & Positioning',
  description: 'the weekly AAII member survey',
  source_type: 'survey', frequency: 'weekly',
  unit: 'percent', domain: 'pct_0_100', presentation: 'step',
  aliases: ['AAII', 'AAII:SURVEY', 'AAIISURVEY', 'AAII SENTIMENT', 'AAII SENTIMENT SURVEY'],
  components: ['AAII:BULLS', 'AAII:BEARS', 'AAII:NEUTRAL'],
  primary_component: 'AAII:BULLS',
  component_rows: [
    { id: 'AAII:BULLS', display: 'AAII Bullish', short: 'Bullish' },
    { id: 'AAII:BEARS', display: 'AAII Bearish', short: 'Bearish' },
    { id: 'AAII:NEUTRAL', display: 'AAII Neutral', short: 'Neutral' },
  ],
  ohlc_capable: false, has_ohlc: false, status: 'published', catalogue: 'market_indicators',
}

// ── DOOR 1: the real Indicators search ──────────────────────────────────────

describe('DOOR 1 — Chart Settings, Indicators, Add Indicator, "AAII"', () => {
  const browsed = [
    ...marketIndicatorResults([PRODUCT_ROW], { tf: 'D', bars: 400 }),
    ...securityResults(
      [{ ticker: 'UCTAAII', name: 'AAII Bull-Bear Spread', type: 'breadth', breadth: true }],
      { tf: 'D', bars: 400 },
    ),
  ]

  it('THE SURVEY SURVIVES EVEN WHEN THE REMOTE ANSWER IS EMPTY', () => {
    // ⚰️ THE PRODUCTION FAILURE, EXACTLY. `/api/ticker-search` returns nothing
    // useful (its market-indicator injection is wrapped in `except: pass`), and the
    // member must still find the product — the catalogue they browsed it from has
    // not stopped existing just because they typed.
    const live = liveDiscoveryRows('AAII', [], browsed, matches)
    const names = live.map((r) => r.name)
    expect(names).toContain('AAII Sentiment Survey')
    expect(names).toContain('AAII Bull-Bear Spread')
  })

  it('shows BOTH member-facing AAII products and only those two', () => {
    const live = liveDiscoveryRows('AAII', [], browsed, matches)
    const aaii = live.filter((r) => /AAII/i.test(r.name || ''))
    expect(aaii).toHaveLength(2)
  })

  it('NEVER three primary component rows', () => {
    const live = liveDiscoveryRows('AAII', [], browsed, matches)
    const names = live.map((r) => r.name)
    for (const bad of ['AAII Bullish', 'AAII Bearish', 'AAII Neutral']) {
      expect(names).not.toContain(bad)
    }
  })

  it('the remote answer still leads when it has one', () => {
    const remote = [{ id: 'REMOTE', key: 'security:REMOTE', name: 'REMOTE' }]
    expect(liveDiscoveryRows('AAII', remote, browsed, matches)[0].id).toBe('REMOTE')
  })

  it('browsing with no query is unchanged, by identity', () => {
    expect(liveDiscoveryRows('', [1, 2], browsed, matches)).toBe(browsed)
  })

  it('the product row prints no internal vocabulary', () => {
    const [res] = marketIndicatorResults([PRODUCT_ROW], {})
    const text = [res.name, res.lead, res.sub, res.shortName, res.category]
      .filter(Boolean).join(' ')
    for (const w of ['dataSeries', 'sym:', 'AAII:SURVEY', 'AAII:BULLS', 'survey_key']) {
      expect(text).not.toContain(w)
    }
  })
})

// ── DOOR 2: adding the product as an indicator ──────────────────────────────

describe('DOOR 2 — adding AAII Sentiment Survey as an indicator', () => {
  const liveOf = (cs) => (cs.indicatorInstances || []).filter((i) => i && !i.deleted && i.instanceId)

  it('creates three ordinary series in ONE pane', () => {
    const [res] = marketIndicatorResults([PRODUCT_ROW], {})
    expect(res.create.via).toBe(CREATE_VIA.PRODUCT)
    const cs = createProductSeries({ indicatorInstances: [] }, res.create.components, registry)
    const insts = liveOf(cs)
    expect(insts).toHaveLength(3)
    expect(insts.map((i) => i.display && i.display.name))
      .toEqual(['AAII Bullish', 'AAII Bearish', 'AAII Neutral'])
    const [host, ...rest] = insts
    for (const r of rest) expect(r.placement.target).toBe('@' + host.instanceId)
  })

  it('no output may wear candles', () => {
    const cap = sourceCapabilityOf({ presentation: 'step' }, false)
    expect(cap.allowedStyles).not.toContain('candles')
    expect(cap.defaultStyle).toBe('line')
  })

  it('all three share one percentage unit — the shared-scale precondition', () => {
    // ⛔ THE CLAIM IS THE CATALOGUE'S, NOT THE DISCOVERY ROW'S. `discovery.product_row`
    // reports a unit only when every component agrees and `None` when they do not, so
    // a mixed product cannot silently claim one axis. Asserted on the payload the
    // server actually sends; the refusal itself is pinned by
    // `tests/test_market_indicators_products.py`.
    expect(PRODUCT_ROW.unit).toBe('percent')
    expect(PRODUCT_ROW.domain).toBe('pct_0_100')
  })
})

// ── DOOR 3: a scalar source as the PRIMARY chart ────────────────────────────

describe('DOOR 3 — a scalar source as the PRIMARY chart symbol', () => {
  // ⚰️⚰️ THE SECOND PRODUCTION FAILURE. NAAIM entered as the primary symbol
  // rendered as CANDLES: `cs.chartType` is a chart-WIDE member setting and the
  // primary path had never asked what the SOURCE could mean.
  const scalar = sourceCapabilityOf({ presentation: 'step' }, false)
  const ohlc = sourceCapabilityOf({ presentation: 'line' }, true)

  it('A SCALAR SOURCE CANNOT RENDER AS CANDLES, whatever the member set', () => {
    for (const stored of ['candles', 'hollow', 'bars', 'hlc']) {
      expect(primaryChartTypeFor(stored, scalar)).toBe('line')
    }
  })

  it('and the chart-type MENU stops offering them', () => {
    const offered = primaryChartTypesFor(scalar)
    for (const t of ['candles', 'hollow', 'bars', 'hlc']) expect(offered).not.toContain(t)
    expect(offered).toContain('line')
    expect(offered).toContain('area')
  })

  it('a scalar choice the member made is untouched', () => {
    expect(primaryChartTypeFor('area', scalar)).toBe('area')
    expect(primaryChartTypeFor('line', scalar)).toBe('line')
  })

  it('THE STORED SETTING IS NOT REWRITTEN — chart a security and candles return', () => {
    const stored = 'candles'
    expect(primaryChartTypeFor(stored, scalar)).toBe('line')
    expect(primaryChartTypeFor(stored, ohlc)).toBe('candles')
  })

  it('A GENUINE OHLC SOURCE KEEPS EVERY OHLC TYPE', () => {
    for (const t of ['candles', 'hollow', 'bars', 'hlc']) {
      expect(primaryChartTypeFor(t, ohlc)).toBe(t)
    }
    expect(primaryChartTypesFor(ohlc)).toContain('candles')
  })

  it('AN UNCLASSIFIED SOURCE CHANGES NOTHING — no flash of line on load', () => {
    expect(primaryChartTypeFor('candles', null)).toBe('candles')
    expect(primaryChartTypesFor(null)).toContain('candles')
  })

  it('⛔ AND `unknown` MUST REACH THE CLAMP AS `null`, NOT AS A SCALAR CAPABILITY', () => {
    // ⚰️ MEASURED, AND IT IS THE COMPOSITION THAT BROKE — not the clamp itself.
    // `canonicalFamily` is fail-CLOSED and answers `'unknown'` until both registries
    // land. Building a capability from that answer says "not candle-capable", so
    // EVERY chart clamped to a line until the catalogues arrived: four StockChart
    // suites went red with "the chart never created a candle series". On the primary
    // chart the dangerous error is the mirror image of the indicator lane's, so
    // `unknown` must say NOTHING.
    const asIfUnknownWereScalar = sourceCapabilityOf(null, false)
    expect(primaryChartTypeFor('candles', asIfUnknownWereScalar)).toBe('line')  // the bug
    expect(primaryChartTypeFor('candles', null)).toBe('candles')                // the rule
  })
})

// ── DOOR 4: a PRODUCT as the primary chart ──────────────────────────────────

describe('DOOR 4 — AAII Sentiment Survey as the PRIMARY chart', () => {
  it('draws the other components beside the price series — three lines total', () => {
    const extra = primaryProductInstances(PRODUCT_ROW)
    expect(extra).toHaveLength(2)                         // + the primary = 3
    expect(extra.map((i) => i.inputs.source))
      .toEqual(['sym:AAII:BEARS:close', 'sym:AAII:NEUTRAL:close'])
    expect(extra.map((i) => i.display.compact)).toEqual(['Bearish', 'Neutral'])
  })

  it('THE PRIMARY COMPONENT IS NEVER DRAWN TWICE', () => {
    const extra = primaryProductInstances(PRODUCT_ROW)
    expect(extra.map((i) => i.inputs.source)).not.toContain('sym:AAII:BULLS:close')
  })

  it('they share the price pane — one scale, not three axes', () => {
    for (const i of primaryProductInstances(PRODUCT_ROW)) {
      expect(i.placement.target).toBe('price')
    }
  })

  it('each is an ORDINARY dataSeries — no AAII renderer', () => {
    for (const i of primaryProductInstances(PRODUCT_ROW)) expect(i.defId).toBe('dataSeries')
  })

  it('DERIVED, NEVER PERSISTED — and identifiable as such', () => {
    for (const i of primaryProductInstances(PRODUCT_ROW)) {
      expect(isPrimaryProductInstance(i)).toBe(true)
    }
    expect(isPrimaryProductInstance({ instanceId: 'inst:dataSeries:1' })).toBe(false)
  })

  it('instance ids are STABLE across renders — the binder must not churn series', () => {
    const a = primaryProductInstances(PRODUCT_ROW).map((i) => i.instanceId)
    const b = primaryProductInstances(PRODUCT_ROW).map((i) => i.instanceId)
    expect(a).toEqual(b)
  })

  it('a NON-product primary symbol is untouched, by identity', () => {
    const cs = { indicatorInstances: [{ instanceId: 'inst:dataSeries:1' }] }
    expect(withPrimaryProduct(cs, null)).toBe(cs)
  })

  it('the member own instances survive and come first', () => {
    const mine = { instanceId: 'inst:dataSeries:1' }
    const out = withPrimaryProduct({ indicatorInstances: [mine] }, PRODUCT_ROW)
    expect(out.indicatorInstances[0]).toBe(mine)
    expect(out.indicatorInstances).toHaveLength(3)
  })

  it('a product of one component adds nothing to overlay', () => {
    expect(primaryProductInstances({ ...PRODUCT_ROW, components: ['AAII:BULLS'] })).toEqual([])
  })
})

// ── DOOR 5: regression ──────────────────────────────────────────────────────

describe('DOOR 5 — the sources that must not change', () => {
  const capFor = (presentation, ohlcCapable) =>
    sourceCapabilityOf(presentation ? { presentation } : null, ohlcCapable)

  // [what it is, presentation, ohlcCapable, candles allowed on the primary chart?]
  const CASES = [
    ['ordinary equity (QQQ/AAPL/SPY)', null, true, true],
    ['genuine OHLC index (VXN/VIX9D)', 'line', true, true],
    ['close-only index (VVIX/SKEW)', 'line', false, false],
    ['weekly survey (NAAIM)', 'step', false, false],
    ['breadth-derived (US:MCO/MCS)', 'line', false, false],
    ['AAII Bull-Bear Spread', 'line', false, false],
  ]

  it.each(CASES)('%s', (_label, presentation, ohlcCapable, candles) => {
    const cap = capFor(presentation, ohlcCapable)
    expect(primaryChartTypeFor('candles', cap) === 'candles').toBe(candles)
    expect(primaryChartTypesFor(cap).includes('candles')).toBe(candles)
    expect(cap.allowedStyles.includes('candles')).toBe(candles)
  })
})
