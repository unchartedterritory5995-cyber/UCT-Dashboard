// app/src/components/chart/engine/__tests__/ohlcBinding.test.js
//
// ─── PHASE A · A BINDING MAY CARRY FOUR FIELDS INSTEAD OF ONE ───────────────
//
// ⭐⭐ THE CLAIM. One binding key can hold either a scalar column or a
// coordinated bar payload, and choosing the second changes nothing about source
// syntax, instance identity, placement, scale, persistence or compute. The
// canonical bars were always there — `secondaryBars` has cached the whole bundle
// since P2.1 and `symbolProjection` took the close out of it — so this phase is
// a second READER of the same cache, never a second fetch and never a second
// source system.
//
// ⛔ AND `sym:QQQ:close` STILL MEANS THE CLOSE. Nothing here widens the source
// grammar: no `sym:QQQ:ohlc`, no public `open`/`high`/`low` refs. The candle is
// a PRESENTATION of the instrument the scalar source already names.

import { describe, it, expect, beforeEach } from 'vitest'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { createDirectSeries, lastCreatedInstance } from '../../discoveryCatalog'
import { symbolSource, parseSource } from '../sourceRef'
import { clipBarsToDomain, clippedBarsFor, projectionFor } from '../symbolProjection'
import {
  ohlcCapabilityOf, barsCarryOhlc, outputIsSource, OHLC_FAMILY, OHLC_REFUSAL,
} from '../ohlcCapability'
import { poolKey, seriesOptionsForPlot, POOL_KEYS } from '../pool'
import { PLOT_STYLES, PLOT_STYLE_CHOICES, availableStyles, resolvePlotStyle } from '../presentation'
import {
  clearSecondaryBars, primeSecondaryBars, cachedBars, ensureAll,
} from '../secondaryBars'

const TF = 'D'
const COUNT = 400

/** A real-shaped security bar: a genuine auction period. */
const secBar = (t, base) => ({
  t, o: base, h: base + 2.2, l: base - 1.7, c: base + 0.6, v: 1000 + base,
})

/** A breadth bar as `breadth_symbols.py` actually builds one: the OPEN is
 *  yesterday's value and the wick is derived from the pair, not observed. */
const breadthBar = (t, prev, v) => ({
  t, o: prev, h: Math.max(prev, v), l: Math.min(prev, v), c: v, v: 0,
})

const primaryBars = (n) => Array.from({ length: n }, (_, i) => ({
  t: `2026-09-${String(i + 1).padStart(2, '0')}`,
  o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 5000,
}))

const familyOf = (sym) => (sym === 'UCTA50' ? OHLC_FAMILY.BREADTH : OHLC_FAMILY.SECURITY)

// ⭐ THE REAL DEFINITIONS, not shapes typed here. `dataSeries` is the passthrough
// and `movingAverage` is not, and both say so in `nativeRegistry`; a case that
// invented its own `{passthrough: true}` would pass while the product's own
// definition had lost the claim.
const DIRECT = registry.getDefinition('dataSeries')
const DERIVED = registry.getDefinition('movingAverage')

beforeEach(() => { clearSecondaryBars() })

// ─── capability: three dimensions, and only one of them is the bar shape ────

describe('OHLC capability is identity AND semantic AND structural', () => {
  const bars = [secBar('2026-09-01', 700), secBar('2026-09-02', 702)]

  it('⭐ an ordinary security with real bars qualifies', () => {
    const v = ohlcCapabilityOf(DIRECT, parseSource(symbolSource('QQQ', 'close')), { bars }, familyOf)
    expect(v.ok).toBe(true)
    expect(v.family).toBe(OHLC_FAMILY.SECURITY)
    expect(v.reason).toBeNull()
  })

  it('⛔⛔ BREADTH DOES NOT QUALIFY, THOUGH ITS BARS CARRY o/h/l/c', () => {
    // ⚰️ THIS IS THE CASE THE GATE EXISTS FOR. `breadth_symbols.py` writes
    // `o, c = (prev, v); h, l = max(o, c), min(o, c)` — four finite numbers whose
    // body means "change since yesterday" and whose range means nothing. Every
    // structural test passes. A future simplification to
    // `Number.isFinite(o) && Number.isFinite(h) && …` would put a tidy,
    // authoritative-looking, meaningless candle on a member's chart.
    const breadth = [breadthBar('2026-09-01', 45, 47.9), breadthBar('2026-09-02', 47.9, 46.1)]
    expect(barsCarryOhlc(breadth), 'the fixture does not reproduce the real bar shape')
      .toBe(true)

    const v = ohlcCapabilityOf(DIRECT, parseSource(symbolSource('UCTA50', 'close')), { bars: breadth }, familyOf)
    expect(v.ok, 'a breadth pseudo-ticker was admitted as candle-capable').toBe(false)
    expect(v.family).toBe(OHLC_FAMILY.BREADTH)
    // ⛔ AND FOR THE RIGHT REASON: what it MEANS, not what it lacks. Reporting a
    // missing field about a row that has one sends the next reader hunting a data
    // bug instead of finding this decision.
    expect(v.reason).toBe(OHLC_REFUSAL.FAMILY_NOT_OHLC)
  })

  it('⛔⛔ AN UNCLASSIFIED SYMBOL FAILS CLOSED — "not yet" is never "security"', () => {
    // The registry arrives over the network. If absence read as "ordinary
    // security", every breadth measure would be candle-capable for the first few
    // hundred milliseconds of every page load.
    const parsed = parseSource(symbolSource('QQQ', 'close'))
    expect(ohlcCapabilityOf(DIRECT, parsed, { bars }, () => 'unknown').ok).toBe(false)
    expect(ohlcCapabilityOf(DIRECT, parsed, { bars }, undefined).ok).toBe(false)
    expect(ohlcCapabilityOf(DIRECT, parsed, { bars }, undefined).reason).toBe(OHLC_REFUSAL.FAMILY_UNKNOWN)
  })

  it('⛔⛔ A CALCULATION OVER A CANDLE-CAPABLE SYMBOL IS NOT CANDLE-CAPABLE', () => {
    // ⚰️ MEASURED IN A BROWSER 2026-09-13, Phase C. `MA(sym:QQQ:close)` declares
    // the SAME source string a direct QQQ series does, so a source-only gate said
    // yes: the row was offered Candles, and choosing it drew QQQ's OWN BARS in the
    // moving average's pane. The legend read `MA(5) 714.88` beside `QQQ 714.88` —
    // the same number, because the average had been replaced by the instrument.
    const parsed = parseSource(symbolSource('QQQ', 'close'))
    expect(ohlcCapabilityOf(DIRECT, parsed, { bars }, familyOf).ok).toBe(true)
    const v = ohlcCapabilityOf(DERIVED, parsed, { bars }, familyOf)
    expect(v.ok, 'a moving average was admitted as an auction period').toBe(false)
    expect(v.reason).toBe(OHLC_REFUSAL.NOT_PASSTHROUGH)
  })

  it('⛔ …and the claim is DECLARED, so an untaught caller is refused', () => {
    const parsed = parseSource(symbolSource('QQQ', 'close'))
    // The fail-closed shape of a required leading argument: no definition, no
    // candles — never the old source-only answer.
    expect(ohlcCapabilityOf(undefined, parsed, { bars }, familyOf).ok).toBe(false)
    expect(ohlcCapabilityOf({}, parsed, { bars }, familyOf).reason)
      .toBe(OHLC_REFUSAL.NOT_PASSTHROUGH)
    // ⛔ AND IT IS THE PRODUCT'S OWN DEFINITIONS THAT CARRY IT. `domainBehavior`
    // is a claim about RANGE and BOTH of these make it; only one is an identity.
    expect(outputIsSource(DIRECT), 'the direct series stopped declaring passthrough').toBe(true)
    expect(outputIsSource(DERIVED)).toBe(false)
    expect(DIRECT.domainBehavior).toBe('inherit')
    expect(DERIVED.domainBehavior, 'the two claims were collapsed into one').toBe('inherit')
  })

  it('⛔⛔ A CENSUS: exactly ONE definition in the registry may wear candles', () => {
    // ⭐ ENUMERATION-FREE, ON PURPOSE. "Not RSI, not an MA, not a formula, not an
    // Info Value" is a list somebody has to remember to extend; this asks the
    // REGISTRY instead, so a definition added next quarter is refused on the day
    // it appears and its author has to make the identity claim deliberately.
    const parsed = parseSource(symbolSource('QQQ', 'close'))
    const admitted = registry.listDefinitions()
      .filter((d) => ohlcCapabilityOf(d, parsed, { bars }, familyOf).ok)
      .map((d) => d.id)
    expect(admitted, 'a definition that computes something gained candles')
      .toEqual(['dataSeries'])
  })

  it('⛔ a NON-SYMBOL source is never candle-capable', () => {
    expect(ohlcCapabilityOf(DIRECT, parseSource('close'), { bars }, familyOf).ok).toBe(false)
    expect(ohlcCapabilityOf(DIRECT, parseSource('@inst:rsi:1::rsi'), { bars }, familyOf).ok).toBe(false)
    expect(ohlcCapabilityOf(DIRECT, null, { bars }, familyOf).reason).toBe(OHLC_REFUSAL.NOT_SYMBOL)
  })

  it('⛔ a capable FAMILY with no usable bars is still refused', () => {
    const parsed = parseSource(symbolSource('QQQ', 'close'))
    expect(ohlcCapabilityOf(DIRECT, parsed, { bars: [] }, familyOf).reason).toBe(OHLC_REFUSAL.NO_BARS)
    const closeOnly = [{ t: '2026-09-01', c: 700 }]
    expect(ohlcCapabilityOf(DIRECT, parsed, { bars: closeOnly }, familyOf).reason)
      .toBe(OHLC_REFUSAL.FIELDS_MISSING)
  })
})

// ─── the timestamp contract ─────────────────────────────────────────────────

describe('a candle keeps its OWN timestamp, clipped to the chart domain', () => {
  it('⭐⭐ intersection — the secondary’s own bars, never the primary’s times', () => {
    const primary = primaryBars(4)                    // 09-01 … 09-04
    const secondary = [
      secBar('2026-09-01', 700),
      secBar('2026-09-03', 702),
      // ⛔ OUTSIDE THE DOMAIN: the chart has no 09-09 bar, so drawing this would
      // widen the shared time axis — the v1 ruling refuses that.
      secBar('2026-09-09', 710),
    ]
    const out = clipBarsToDomain(secondary, primary)
    expect(out.map((b) => b.t)).toEqual(['2026-09-01', '2026-09-03'])
    // The bars are the SECONDARY's own objects, carrying the secondary's numbers.
    expect(out[0].o).toBe(700)
    expect(out[1].o).toBe(702)
  })

  it('⛔⛔ A MISSING SECONDARY BAR BORROWS NOTHING — no fill, no primary time', () => {
    const primary = primaryBars(3)
    const secondary = [secBar('2026-09-02', 702)]
    const out = clipBarsToDomain(secondary, primary)
    expect(out).toHaveLength(1)
    expect(out[0].t).toBe('2026-09-02')
    // ⛔ The gap is a gap: nothing carries 09-01's or 09-03's time, and nothing
    // carries 09-02's value forward. Same posture as `projectSymbolField`.
    expect(out.some((b) => b.t === '2026-09-01' || b.t === '2026-09-03')).toBe(false)
  })

  it('⛔ the axis is never widened — output is a SUBSET of the chart domain', () => {
    const primary = primaryBars(5)
    const times = new Set(primary.map((b) => b.t))
    const secondary = Array.from({ length: 12 }, (_, i) => secBar(`2026-09-${String(i + 1).padStart(2, '0')}`, 700 + i))
    for (const bar of clipBarsToDomain(secondary, primary)) {
      expect(times.has(bar.t), `${bar.t} is not a chart bar`).toBe(true)
    }
  })

  it('⭐ memoised on both identities, like the scalar projection', () => {
    const primary = primaryBars(3)
    const secondary = [secBar('2026-09-01', 700)]
    expect(clippedBarsFor(secondary, primary)).toBe(clippedBarsFor(secondary, primary))
    // A different primary timeline is a genuinely different clip.
    expect(clippedBarsFor(secondary, primaryBars(3))).not
      .toBe(clippedBarsFor(secondary, primary))
  })
})

// ─── the renderer's series type ─────────────────────────────────────────────

describe('the candlestick series type', () => {
  it('⭐ `candles` maps to its own pool key, and cannot be pooled from a line', () => {
    expect(poolKey({ style: 'candles' })).toBe('candlestick')
    expect(POOL_KEYS).toContain('candlestick')
    // Two series are interchangeable only when their TYPE is — which is exactly
    // what the existing pool rule already says.
    expect(poolKey({ style: 'line' })).not.toBe(poolKey({ style: 'candles' }))
  })

  it('⛔ candle options carry NONE of the line-shaped machinery', () => {
    const opts = seriesOptionsForPlot({ key: 'value', style: 'candles' }, { scaleId: 'right' })
    expect(opts).toBeTruthy()
    expect(opts.priceScaleId).toBe('right')
    for (const k of ['lineWidth', 'lineStyle', 'lineType', 'lineVisible',
      'pointMarkersVisible', 'color', 'base']) {
      expect(opts, `a candlestick was handed ${k}`).not.toHaveProperty(k)
    }
  })
})

// ─── the style vocabulary ───────────────────────────────────────────────────

describe('candles are recognised but not offered (Phase A)', () => {
  it('⭐ a stored `candles` style RESOLVES — for a source that can mean it', () => {
    const inst = { instanceId: 'i', defId: 'dataSeries', presentation: { plots: { value: { style: 'candles' } } } }
    const plot = { key: 'value', style: 'line' }
    expect(PLOT_STYLES).toContain('candles')
    expect(resolvePlotStyle(inst, plot, { ohlcCapable: true })).toBe('candles')
  })

  it('⛔⛔ …AND IS CLAMPED TO A LINE FOR A SOURCE THAT CANNOT — the renderer obeys too', () => {
    // The precedent is the measured one this clamp was written for: an RSI stored
    // as `area` and sent to the Volume pane kept drawing an area until the
    // RESOLVER honoured capability, not just the dropdown. A stored `candles` over
    // a breadth measure is the same failure with a more authoritative-looking
    // result, so it is refused at the same seam.
    const inst = { instanceId: 'i', defId: 'dataSeries', presentation: { plots: { value: { style: 'candles' } } } }
    const plot = { key: 'value', style: 'line' }
    expect(resolvePlotStyle(inst, plot)).toBe('line')
    expect(resolvePlotStyle(inst, plot, { ohlcCapable: false })).toBe('line')
    // ⚠️ AND THE STORED VALUE IS NOT REWRITTEN — the clamp is a reading, not an edit.
    expect(inst.presentation.plots.value.style).toBe('candles')
  })

  it('⛔⛔ CAPABILITY IS THE GATE, NOT THE CHOICE LIST', () => {
    // ⚰️ PHASE A ASSERTED `PLOT_STYLE_CHOICES` DID NOT CARRY `candles` AT ALL —
    // the honest statement of "the engine can do it and the member cannot ask".
    // Phase B gives it a label, and the guarantee moves to where it always
    // belonged: a choice list is a vocabulary, `availableStyles` is the rule.
    expect(PLOT_STYLE_CHOICES.find((c) => c.value === 'candles').label).toBe('Candles')
    expect(availableStyles({ key: 'value', style: 'line' })).not.toContain('candles')
    expect(availableStyles({ key: 'value', style: 'line' }, { ohlcCapable: false }))
      .not.toContain('candles')
    expect(availableStyles({ key: 'value', style: 'line' }, { ohlcCapable: true }))
      .toContain('candles')
  })
})

// ─── the scalar lane is untouched ───────────────────────────────────────────

describe('the scalar pipeline is byte-compatible', () => {
  it('⛔⛔ `sym:QQQ:close` STILL MEANS THE CLOSE — four fields did not become one source', () => {
    const primary = primaryBars(3)
    const secondary = [secBar('2026-09-01', 700), secBar('2026-09-02', 702), secBar('2026-09-03', 704)]
    const col = projectionFor(secondary, 'close', primary)
    expect([...col]).toEqual([700.6, 702.6, 704.6])
    // ⛔ AND THE GRAMMAR DID NOT GROW. No composite ref, no public o/h/l.
    expect(symbolSource('QQQ', 'ohlc')).toBeNull()
    expect(symbolSource('QQQ', 'open')).toBeNull()
    expect(symbolSource('QQQ', 'high')).toBeNull()
    expect(symbolSource('QQQ', 'low')).toBeNull()
    expect(symbolSource('QQQ', 'close')).toBe('sym:QQQ:close')
  })

  it('⭐ a direct series still stores exactly the source it always did', () => {
    let cs = mergeChartSettings({})
    const next = createDirectSeries(cs, symbolSource('QQQ', 'close'), registry, { name: 'QQQ' })
    const minted = lastCreatedInstance(cs, next)
    cs = next
    const inst = (cs.indicatorInstances || []).find((i) => i && i.instanceId === minted.instanceId)
    expect(inst.inputs.source).toBe('sym:QQQ:close')
    expect(JSON.stringify(inst)).not.toMatch(/ohlc|candle/i)
  })
})

// ─── one fetch for every reader of one symbol ───────────────────────────────

describe('the canonical bars are read, never refetched', () => {
  it('⭐⭐ line + MA + candles share ONE cached QQQ bundle', async () => {
    let calls = 0
    const fetcher = () => { calls += 1; return Promise.resolve({ bars: [secBar('2026-09-01', 700)] }) }
    // Three readers, one symbol — the supplier dedups by URL, so the count is the
    // proof that a candle binding is a second READER of the same entry.
    ensureAll(['QQQ', 'QQQ', 'QQQ'], TF, COUNT, fetcher)
    // ⚠️ The supplier calls its fetcher on a MICROTASK, so the count is read after
    // the chain drains rather than synchronously.
    for (let i = 0; i < 6; i++) await Promise.resolve()
    expect(calls, 'a candle reader issued its own request').toBe(1)

    // …and what it reads is the WHOLE bar, which is what makes candles possible
    // without a second endpoint.
    const entry = cachedBars('QQQ', TF, COUNT)
    expect(entry.bars[0]).toMatchObject({ t: '2026-09-01', o: 700, h: 702.2, l: 698.3, c: 700.6 })
  })

  it('⭐ the cache has always held o/h/l/c — only the close was ever projected', () => {
    primeSecondaryBars('QQQ', TF, COUNT, { bars: [secBar('2026-09-01', 700)] })
    const entry = cachedBars('QQQ', TF, COUNT)
    expect(barsCarryOhlc(entry.bars)).toBe(true)
  })
})
