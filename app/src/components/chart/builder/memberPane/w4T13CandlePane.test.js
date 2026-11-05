// app/src/components/chart/builder/memberPane/w4T13CandlePane.test.js
//
// W4-T13 - `plotcandle` / `plotbar` from the run, end to end on the runtime pane:
//   source -> memberPaneDefinition (the document) -> registry.computeFor (the run) -> binder.sync
//   (the series payload the chart library is handed).
// The reference is the formula written in the TEST (what the script says per bar), never the
// engine's own output: open / high / low / close columns, the body / wick / border colours, an `na`
// open hiding the candle. TradingView's own behaviour is the open item W4-P1 (a capture); see
// docs/pine/capture-queue-2026-11-04-w4-t13.md.
import { describe, it, expect, vi, afterEach } from 'vitest'

import * as registry from '../../engine/nativeRegistry'
import { createBinder, computedOhlcPayload } from '../../engine/binder'
import { validateDefinition } from '../../engine/defSchema'
import { createFakeChart } from '../../engine/__tests__/fakeChart'
import { memberPaneDefinition } from './memberPaneDefinition'

afterEach(() => { vi.unstubAllEnvs() })

const BARS = [
  { t: 1700000000, o: 10, h: 12, l: 9, c: 11, v: 1 },   // up
  { t: 1700086400, o: 11, h: 13, l: 10, c: 10.5, v: 1 }, // down  -> open is na
  { t: 1700172800, o: 10.5, h: 14, l: 8.5, c: 13, v: 1 }, // up
  { t: 1700259200, o: 13, h: 13.5, l: 11, c: 12, v: 1 }, // down  -> open is na
  { t: 1700345600, o: 12, h: 15, l: 8, c: 14, v: 1 }, // up
]
const GREEN = '#4CAF50'
const RED = '#F23645'
const BLUE = '#2962FF'

// The LOW is a running minimum held in `var` state: the host (columnar) lane declines it, so the
// runtime pane is the door (the host lane draws a candle's four columns as four lines: master).
// Reference per bar: open = open when the bar closed up, else na; high and close as the bar's;
// low = the lowest low so far.
const H = '//@version=6\nindicator("cndl", overlay = true)\nvar float mn = na\nmn := na(mn) ? low : math.min(mn, low)\nup = close > open\n'
const CANDLE = `${H}plotcandle(up ? open : na, high, mn, close, "Cnd", color = up ? color.green : color.red, wickcolor = color.blue, bordercolor = up ? color.green : na)\n`
const BAR = `${H}plotbar(up ? open : na, high, mn, close, "Bar", color = up ? color.green : color.red)\n`

const door = (source, id) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  return memberPaneDefinition({ source, id, name: 'T' })
}

/** Mint, install, run, bind: the points the series is handed for the candle row. */
function drawn(source, id, extra) {
  const built = door(source, id)
  expect(built.ok, JSON.stringify(built.runtimeDeclined || built.reason)).toBe(true)
  const { installed, errors } = registry.installUserDefinitions([built.definition])
  expect(installed.length, errors.join(' | ')).toBe(1)
  const fake = createFakeChart()
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const priceSeries = fake.chart.addSeries(fake.LWC.CandlestickSeries, {}, 0)
  binder.sync({
    enabled: true,
    instances: [{ instanceId: `i:${id}`, defId: id, inputs: {} }],
    registry,
    bars: BARS,
    adjustTime: (t) => t,
    plan: { fresh: true },
    applyData: (series, data) => series.setData(data),
    resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null }),
    priceSeries: () => priceSeries,
    tf: 'D',
    newestBarIsForming: false,
    historyFromListing: true,
    ...(extra || {}),
  })
  const series = fake.seriesCreated.filter((s) => s !== priceSeries)
  registry.uninstallUserDefinition(id)
  return { built, fake, series }
}

describe('W4-T13 - the document', () => {
  it('a plotcandle is ONE candles row naming its price and colour columns, and the schema accepts it', () => {
    const { definition } = door(CANDLE, 'u_t13_doc')
    const row = definition.plots.find((p) => p.style === 'candles')
    expect(row, JSON.stringify(definition.plots.map((p) => p.style))).toBeTruthy()
    expect(row.label).toBe('Cnd')
    expect(Object.keys(row.ohlc).sort()).toEqual(['high', 'low', 'open'])
    expect(Object.keys(row.ohlcColors).sort()).toEqual(['body', 'border', 'wick'])
    for (const key of [...Object.values(row.ohlc), ...Object.values(row.ohlcColors)]) {
      expect(definition.plots.find((p) => p.key === key).hidden, key).toBe(true)
      expect(definition.compute.outputs[key], key).toBeGreaterThanOrEqual(0)
    }
    expect(validateDefinition(definition).ok).toBe(true)
  })

  it('a plotbar is an ohlcBars row with a body colour only', () => {
    const { definition } = door(BAR, 'u_t13_bar')
    const row = definition.plots.find((p) => p.style === 'ohlcBars')
    expect(row).toBeTruthy()
    expect(Object.keys(row.ohlcColors)).toEqual(['body'])
    expect(validateDefinition(definition).ok).toBe(true)
  })

  it('a candle is WITHHELD BY NAME, never drawn in a stand-in', () => {
    const why = (call, header = H) => {
      const d = door(`${header}${call}\nplot(mn, "mn")\n`, 'u_t13_w')
      expect(d.ok, JSON.stringify(d.runtimeDeclined)).toBe(true)
      expect(d.definition.plots.some((p) => p.style === 'candles')).toBe(false)
      return d.definition.meta.disclosures.map((n) => n.note).join(' | ')
    }
    const full = 'open, high, low, close, "C", color.green, color.green, bordercolor = color.green'
    // a colour the call did not write: TradingView's default is NOT CAPTURED (W4-P1)
    expect(why('plotcandle(open, high, low, close, "C", color = color.green)'))
      .toMatch(/`C` is not drawn: it does not write `wickcolor =`.*not captured/)
    expect(why(`plotcandle(${full}, show_last = 5)`)).toMatch(/show_last/)
    expect(why(`plotcandle(${full}, display = display.status_line)`)).toMatch(/display = display\.status_line/)
    // force_overlay over a script that is not an overlay asks for the price chart
    expect(why(`plotcandle(${full}, force_overlay = true)`, H.replace('overlay = true', 'overlay = false')))
      .toMatch(/force_overlay = true/)
    // v4 candles carry a transparency default no capture shows
    expect(why('plotcandle(open, high, low, close, "C", color.green, color.green, bordercolor = color.green)',
      H.replace('@version=6', '@version=4').replace('indicator(', 'study(')))
      .toMatch(/v4 candle have no capture/)
  })

  it('…and a hidden one (display.none) or an overlay\'s force_overlay is not withheld', () => {
    const full = 'open, high, low, close, "C", color.green, color.green, bordercolor = color.green'
    const hidden = door(`${H}plotcandle(${full}, display = display.none)\nplot(mn, "mn")\n`, 'u_t13_h')
    expect(hidden.ok).toBe(true)
    expect(hidden.definition.plots.some((p) => p.style === 'candles')).toBe(false)
    expect(hidden.definition.meta.disclosures.map((n) => n.note).join(' ')).not.toMatch(/not drawn/)
    const forced = door(`${H}plotcandle(${full}, force_overlay = true)\nplot(mn, "mn")\n`, 'u_t13_f')
    expect(forced.definition.plots.some((p) => p.style === 'candles')).toBe(true)
  })
})

/** The newest `setData` the chart library was handed for a series. */
const dataOf = (fake, series) => {
  const sets = fake.calls.filter((c) => c.id === series.__id && c.method === 'setData')
  return sets.length ? sets[sets.length - 1].args[0] : null
}

describe('W4-T13 - the series payload the chart is handed', () => {
  // the reference, written from the script: what bar i draws
  const lowest = (i) => Math.min(...BARS.slice(0, i + 1).map((b) => b.l))
  const up = (b) => b.c > b.o

  it('⭐ a candle is drawn from the run: o/h/l/c per bar, the body / wick / border colours, an na open is WHITESPACE', () => {
    const { series, fake } = drawn(CANDLE, 'u_t13_draw')
    expect(series.length).toBe(1)
    expect(series[0].seriesType()).toBe('CandlestickSeries')
    const points = dataOf(fake, series[0])
    expect(points.length).toBe(BARS.length)
    BARS.forEach((b, i) => {
      if (!up(b)) { expect(points[i], `bar ${i}`).toEqual({ time: b.t }); return }
      expect(points[i], `bar ${i}`).toEqual({
        time: b.t, open: b.o, high: b.h, low: lowest(i), close: b.c,
        color: GREEN, wickColor: BLUE, borderColor: GREEN,
      })
    })
  })

  it('⛔ the library draws the per-point colours: borders and wicks are not switched off on the series', () => {
    const { series } = drawn(CANDLE, 'u_t13_opts')
    const o = series[0].options()
    expect(o.borderVisible).not.toBe(false)
    expect(o.wickVisible).not.toBe(false)
  })

  it('a wickcolor of `na` draws NO wick (the transparent entry), never the series colour', () => {
    const src = `${H}plotcandle(up ? open : na, high, mn, close, "Cnd", color = color.green, wickcolor = na, bordercolor = color.red)\n`
    const { series, fake } = drawn(src, 'u_t13_nawick')
    const points = dataOf(fake, series[0])
    BARS.forEach((b, i) => {
      if (!up(b)) return
      expect(points[i].wickColor, `bar ${i}`).toBe('rgba(0, 0, 0, 0)')
      expect(points[i].color).toBe(GREEN)
      expect(points[i].borderColor).toBe(RED)
    })
  })

  it('a colour that is `na` on a bar hides that PART on that bar (a per-bar na colour)', () => {
    const src = `${H}plotcandle(up ? open : na, high, mn, close, "Cnd", color = color.green, wickcolor = color.green, bordercolor = close > 13 ? color.red : na)\n`
    const { series, fake } = drawn(src, 'u_t13_nabar')
    const points = dataOf(fake, series[0])
    expect(points[0].borderColor).toBe('rgba(0, 0, 0, 0)') // close 11
    expect(points[4].borderColor).toBe(RED) // close 14
  })

  it('a plotbar is a bar series fed the same four columns and a body colour (the library has no wick / border on a bar)', () => {
    const { series, fake } = drawn(BAR, 'u_t13_bardraw')
    expect(series[0].seriesType()).toBe('BarSeries')
    const points = dataOf(fake, series[0])
    BARS.forEach((b, i) => {
      if (!up(b)) { expect(points[i]).toEqual({ time: b.t }); return }
      expect(points[i]).toEqual({ time: b.t, open: b.o, high: b.h, low: lowest(i), close: b.c, color: GREEN })
    })
  })

  it('the payload is memoised on the identity of every column it reads (so an unchanged run keeps its points)', () => {
    const plot = { key: 'c', style: 'candles', ohlc: { open: 'o', high: 'h', low: 'l' }, ohlcColors: { body: 'k' } }
    const col = (...v) => Float64Array.from(v)
    const cols = { o: col(1, 2), h: col(3, 4), l: col(0, 1), c: col(2, 3), k: col(NaN, 5394687) }
    const bars = [{ t: 1 }, { t: 2 }]
    const a = computedOhlcPayload(plot, cols, bars)
    expect(computedOhlcPayload(plot, cols, bars)).toBe(a)
    // a column that moved, or other bars, is a new payload: stale colours would be the failure
    expect(computedOhlcPayload(plot, { ...cols, k: col(5394687, 5394687) }, bars)).not.toBe(a)
    expect(computedOhlcPayload(plot, cols, [{ t: 1 }, { t: 2 }])).not.toBe(a)
    expect(a.bars[0].color).toBe('rgba(0, 0, 0, 0)') // an na colour is the transparent entry
    expect(a.bars[1].color).toMatch(/^#/)
  })

  // W4-T13 r1 (review B1): a script that writes BOTH calls. The front end numbers candles per call
  // kind and the pane pairs per kind, so each row gets ITS host output and ITS run columns.
  describe('a script with both plotcandle and plotbar', () => {
    const C = (hi, title) => `plotcandle(up ? open : na, high + ${hi}, mn, close, "${title}", color = color.green, wickcolor = color.blue, bordercolor = color.green)\n`
    const B = (hi, title) => `plotbar(up ? open : na, high + ${hi}, mn, close, "${title}", color = color.red)\n`
    const rowsOf = (src, id) => {
      const { built, series, fake } = drawn(src, id)
      const styles = built.definition.plots.filter((p) => p.style === 'candles' || p.style === 'ohlcBars')
        .map((p) => [p.label, p.style])
      return { styles, series, fake, built }
    }
    const highs = (fake, sr) => dataOf(fake, sr).filter((p) => p.high !== undefined).map((p) => p.high)
    const upBars = BARS.filter(up)

    it.each([
      ['candle then bar', `${H}${C(0, 'C1')}${B(1, 'B1')}`, [['C1', 'candles'], ['B1', 'ohlcBars']], [0, 1]],
      ['bar then candle', `${H}${B(1, 'B1')}${C(0, 'C1')}`, [['B1', 'ohlcBars'], ['C1', 'candles']], [1, 0]],
    ])('%s draws two rows, each from its own call', (_n, src, expectedRows, plus) => {
      const { styles, series, fake } = rowsOf(src, `u_t13_mix_${plus.join('')}`)
      expect(styles).toEqual(expectedRows)
      expect(series.length).toBe(2)
      series.forEach((sr, k) => {
        expect(highs(fake, sr), `series ${k}`).toEqual(upBars.map((b) => b.h + plus[k]))
      })
    })

    it('candle, bar, candle draws three rows paired in order', () => {
      const src = `${H}${C(0, 'C1')}${B(1, 'B1')}${C(2, 'C2')}`
      const { styles, series, fake } = rowsOf(src, 'u_t13_mix_cbc')
      expect(styles).toEqual([['C1', 'candles'], ['B1', 'ohlcBars'], ['C2', 'candles']])
      expect(series.length).toBe(3)
      ;[0, 1, 2].forEach((plus, k) => {
        expect(highs(fake, series[k]), `series ${k}`).toEqual(upBars.map((b) => b.h + plus))
      })
    })

    it('two bars then a candle pair per kind as well', () => {
      const src = `${H}${B(1, 'B1')}${B(2, 'B2')}${C(3, 'C1')}`
      const { styles, series, fake } = rowsOf(src, 'u_t13_mix_bbc')
      expect(styles).toEqual([['B1', 'ohlcBars'], ['B2', 'ohlcBars'], ['C1', 'candles']])
      ;[1, 2, 3].forEach((plus, k) => {
        expect(highs(fake, series[k]), `series ${k}`).toEqual(upBars.map((b) => b.h + plus))
      })
    })
  })

  it('a declared OHLC row whose columns are missing draws NOTHING (never the scalar close)', () => {
    const built = door(CANDLE, 'u_t13_nocols')
    const def = JSON.parse(JSON.stringify(built.definition))
    const row = def.plots.find((p) => p.style === 'candles')
    // the row's price columns are gone from the compute table: the binder is handed no such columns
    for (const key of Object.values(row.ohlc)) delete def.compute.outputs[key]
    for (const key of Object.values(row.ohlc)) def.plots = def.plots.filter((p) => p.key !== key)
    row.ohlc = { open: 'zz1', high: 'zz2', low: 'zz3' }
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const price = fake.chart.addSeries(fake.LWC.CandlestickSeries, {}, 0)
    const reg = {
      getDefinition: () => def,
      computeFor: () => ({ [row.key]: Float64Array.from(BARS.map((b) => b.c)) }),
      hasAnyFinite: (c) => c.some(Number.isFinite),
      columnKeys: () => [row.key],
    }
    binder.sync({
      enabled: true, instances: [{ instanceId: 'i:x', defId: def.id, inputs: {} }], registry: reg, bars: BARS,
      adjustTime: (t) => t, plan: { fresh: true }, applyData: (sr, data) => sr.setData(data),
      resolvePlacement: () => ({ paneIndex: 0, scaleId: 'right', scaleOptions: null }), priceSeries: () => price,
      tf: 'D', newestBarIsForming: false, historyFromListing: true,
    })
    const mine = fake.seriesCreated.filter((sr) => sr !== price)
    for (const sr of mine) expect(dataOf(fake, sr) || []).toEqual([])
  })
})
