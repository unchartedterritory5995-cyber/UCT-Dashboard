// app/src/components/chart/engine/__tests__/dataSeriesCompute.test.js
//
// ─── THE PASSTHROUGH, AND THE SEAM THAT FEEDS IT ────────────────────────────
//
// ⭐⭐ TWO CLAIMS, AND THEY ARE DELIBERATELY THE SAME TEST TWICE. `dataSeries`
// emits `ctx.source` and nothing else, so "a finite source passes through" and
// "an absent source is all gaps" cannot BOTH hold unless the ctx actually
// arrives at the native lane. That is why `nativeComputeCtx.test.js` points here
// for the arrival proof instead of registering a probe native: `NATIVE_COMPUTE`
// is a closed table, and a probe that bypassed `computeFor` would be testing the
// test.
//
// ⛔ AND THE SECOND HALF IS THE BINDER. A compute that reads `ctx.source`
// correctly is worth nothing if nothing ever fills it, so the resolution seam is
// asserted here too — bar field, other instance, and canonical symbol — against
// the real `createBinder`.

import { describe, it, expect, beforeEach } from 'vitest'
import { computeFor, getDefinition } from '../nativeRegistry'
import * as registry from '../nativeRegistry'
import { createBinder } from '../binder'
import { symbolSource, instanceSource } from '../sourceRef'
import { clearSecondaryBars, primeSecondaryBars } from '../secondaryBars'

const DEF = getDefinition('dataSeries')

const bars = (n, base = 100) => Array.from({ length: n }, (_, i) => ({
  t: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
  o: base + i, h: base + i + 1, l: base + i - 1, c: base + i + 0.5, v: 1000 + i,
}))

const finite = (col) => Array.from(col).filter(Number.isFinite)

describe('the dataSeries compute', () => {
  it('⛔ the definition exists and declares exactly one source input', () => {
    expect(DEF, 'dataSeries is not registered — every case below is vacuous').toBeTruthy()
    const sources = (DEF.inputs || []).filter((i) => i.type === 'source')
    expect(sources).toHaveLength(1)
    expect(DEF.passthrough).toBe(true)
  })

  it('⭐⭐ A FINITE SOURCE PASSES THROUGH UNCHANGED — value for value', () => {
    const b = bars(10)
    const src = b.map((_, i) => 500 + i * 3)
    const cols = computeFor(DEF, b, {}, { source: src })
    expect(Array.from(cols.value)).toEqual(src)
  })

  it('⛔⛔ NO SOURCE IS ALL GAPS — never zeros, never an exception', () => {
    const b = bars(10)
    // A flat line at zero looks like DATA. NaN is the shape the renderer and
    // every warm-up rule already understand as "nothing here".
    const cols = computeFor(DEF, b, {}, undefined)
    expect(cols.value).toHaveLength(10)
    expect(finite(cols.value)).toHaveLength(0)
    expect(Array.from(cols.value).some((v) => v === 0)).toBe(false)
  })

  it('⛔ A HOLE IN THE SOURCE IS A HOLE IN THE OUTPUT — one for one', () => {
    const b = bars(10)
    const src = b.map((_, i) => (i === 4 ? NaN : 500 + i))
    const cols = computeFor(DEF, b, {}, { source: src })
    expect(finite(cols.value)).toHaveLength(9)
    expect(Number.isFinite(cols.value[4])).toBe(false)
    // …and it is not bridged: the neighbours keep their own values.
    expect(cols.value[3]).toBe(503)
    expect(cols.value[5]).toBe(505)
  })

  it('⛔ A SHORT SOURCE DOES NOT STRETCH — the tail stays empty', () => {
    const b = bars(10)
    const cols = computeFor(DEF, b, {}, { source: [1, 2, 3] })
    expect(finite(cols.value)).toHaveLength(3)
    expect(cols.value).toHaveLength(10)
  })
})

// ─── THE BINDER FILLS IT ────────────────────────────────────────────────────

/** A chart just real enough for `sync` to bind against. */
function harness() {
  const created = []
  const chart = {
    addSeries: (ctor, options, paneIndex) => {
      const series = {
        __data: [], ctor, options, paneIndex,
        setData: (d) => { series.__data = d },
        update: () => {}, applyOptions: (o) => Object.assign(options, o),
        priceScale: () => ({ applyOptions: () => {} }),
        createPriceLine: () => ({}), removePriceLine: () => {},
        setMarkers: () => {},
      }
      created.push(series)
      return series
    },
    removeSeries: () => {},
    panes: () => [{ paneIndex: () => 0, setHeight: () => {}, getHeight: () => 100 }],
    priceScale: () => ({ applyOptions: () => {} }),
  }
  const LWC = {
    LineSeries: 'LineSeries', HistogramSeries: 'HistogramSeries',
    CandlestickSeries: 'CandlestickSeries', BarSeries: 'BarSeries',
    AreaSeries: 'AreaSeries', BaselineSeries: 'BaselineSeries',
  }
  return { chart, LWC, created }
}

const inst = (id, source) => ({
  instanceId: id, defId: 'dataSeries', inputs: { source }, hidden: false,
})

/** The values the binder actually handed the renderer for one instance. */
function drawnFor(ctxExtra, instances) {
  const h = harness()
  const binder = createBinder({ chart: h.chart, LWC: h.LWC })
  const b = bars(20)
  const res = binder.sync({
    enabled: true,
    registry,
    instances,
    bars: b,
    cs: { indicatorInstances: instances },
    sym: 'NVDA',
    tf: 'D',
    resolvePlacement: () => ({ paneIndex: 1, priceScaleId: 'right', key: 'p' }),
    ...ctxExtra,
  })
  return { res, created: h.created, b }
}

describe('the binder resolves a source into ctx.source', () => {
  beforeEach(() => { clearSecondaryBars() })

  it('⭐ A BAR FIELD — read off the chart\'s own bars', () => {
    const { created, b } = drawnFor({}, [inst('i1', 'close')])
    const series = created[0]
    expect(series, 'nothing was bound for a bar-field source').toBeTruthy()
    const vals = series.__data.map((p) => p.value).filter(Number.isFinite)
    expect(vals).toEqual(b.map((x) => x.c))
  })

  it('⭐⭐ A CANONICAL SYMBOL — projected from the secondary bundle', () => {
    const sec = bars(20, 700)
    primeSecondaryBars('QQQ', 'D', 400, { bars: sec })
    const secondary = new Map([['QQQ', { bars: sec, status: 'ok' }]])
    const { created } = drawnFor({ secondary }, [inst('i1', symbolSource('QQQ', 'close'))])
    const vals = created[0].__data.map((p) => p.value).filter(Number.isFinite)
    // ⛔ THE SECONDARY'S NUMBERS, NOT THE CHART'S. Both series are 20 bars long,
    // so a length check proves nothing — the VALUES are what tell them apart.
    expect(vals[0]).toBeGreaterThan(600)
    expect(vals).toEqual(sec.map((x) => x.c))
  })

  it('⛔⛔ AN UNSUPPLIED SYMBOL DRAWS NOTHING — never the chart\'s own bars', () => {
    // The one failure here that looks exactly like success: falling back to the
    // bars in hand would answer confidently about the WRONG INSTRUMENT.
    const { created } = drawnFor({ secondary: new Map() },
      [inst('i1', symbolSource('QQQ', 'close'))])
    const vals = (created[0]?.__data || []).map((p) => p.value).filter(Number.isFinite)
    expect(vals).toHaveLength(0)
  })

  it('⭐⭐ ANOTHER INSTANCE\'S OUTPUT — and the DEPENDENCY ORDER makes it possible', () => {
    // ⛔ THE CONSUMER IS LISTED FIRST, ON PURPOSE. In stored order it precedes
    // its source, so a loop that walked the array would compute it against a
    // column that does not exist yet and draw nothing. `orderByDependency` is
    // what makes this case pass, and listing them this way is what makes the
    // case able to fail.
    const sec = bars(20, 700)
    const secondary = new Map([['QQQ', { bars: sec, status: 'ok' }]])
    const consumer = inst('i2', instanceSource('i1', 'value'))
    const source = inst('i1', symbolSource('QQQ', 'close'))
    const { created } = drawnFor({ secondary }, [consumer, source])
    expect(created.length).toBeGreaterThan(1)
    const byId = created.map((s) => s.__data.map((p) => p.value).filter(Number.isFinite))
    // Both series carry the SAME numbers — the consumer is an identity over an
    // identity — and neither is empty.
    expect(byId.every((v) => v.length > 0)).toBe(true)
    expect(byId[0]).toEqual(byId[1])
  })

  it('⛔ A CYCLE COMPUTES NOTHING, rather than spinning or half-drawing', () => {
    const a = inst('i1', instanceSource('i2', 'value'))
    const b2 = inst('i2', instanceSource('i1', 'value'))
    const { created } = drawnFor({}, [a, b2])
    for (const s of created) {
      expect(s.__data.map((p) => p.value).filter(Number.isFinite)).toHaveLength(0)
    }
  })

  it('⭐ TWO CONSUMERS OF ONE SYMBOL BOTH DRAW — the cache is shared, not consumed', () => {
    const sec = bars(20, 700)
    const secondary = new Map([['QQQ', { bars: sec, status: 'ok' }]])
    const { created } = drawnFor({ secondary },
      [inst('i1', symbolSource('QQQ', 'close')), inst('i2', symbolSource('QQQ', 'close'))])
    const sets = created.map((s) => s.__data.map((p) => p.value).filter(Number.isFinite))
    expect(sets.filter((v) => v.length > 0)).toHaveLength(2)
  })
})
