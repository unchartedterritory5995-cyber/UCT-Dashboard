// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.fillDefaultLinewidthParity.test.js
//
// ⭐⭐ TRADINGVIEW SET F, THROUGH THE REAL MEMBER DOOR, BINDER AND FILL PRIMITIVE.
// (`tests/fixtures/vendor/reference/F/README.md`)
//
//   F1 (v6): a `fill` whose colour carries no transparency paints OPAQUE; the control
//            `color.new(color.red, 50)` paints 0.5 (byte 128).
//   F2 (v4): a `fill` with no `transp` takes transparency 90 → byte 26 (TradingView's
//            half-up `round((100 − 90) × 255 / 100)`); `transp = 0` paints opaque;
//            v4's `color.red` is #FF5252.
//   F3 (v6): `plot(…, linewidth = N)`, N = 1..10, is NOT clamped.
//
// ⚠️ THE DOOR DRAWS NO PLOT THAT READS NO BAR (`pine.js`: `hiddenReason: 'constant'`
// — a column that is the same number for every symbol is not offered as a screen),
// and set F's scripts plot constants, so the member pane refuses them as written: a
// product gap, reported, not changed here. So each capture is graded twice:
//   • the EXACT `.pine` through `translatePine` — where the band's opacity and the
//     plot's width are decided;
//   • the same script with each `plot(N, …)` read as `plot(close * 0 + N, …)` — the
//     same values, now reading a bar — through the real member door, binder and
//     fill primitive.
// Each band is asserted three ways: its painted `#RRGGBBAA` is TradingView's colour
// at TradingView's byte; that byte composited over the capture's white background
// IS the pixel TradingView painted in the band's interior (`columnRuns`); and the
// byte agrees with `filledAreasStyle`'s transparency. ⚰️ Before set F a static band
// with no transparency drew at the engine's own 0.15 (byte 38) in every version.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { REF } from './cloudsDraw'
import * as registry from '../../nativeRegistry'
import { createBinder } from '../../binder'
import { addInstance } from '../../instanceControls'
import { mergeChartSettings } from '../../../chartDefaults'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { createFakeChart, createRecordingCtx, drawPrimitive, makeBars } from '../fakeChart'
import { translatePine } from '../../ast/pine'
import { staticFillOf } from '../../fillPaint'

const DIR = path.join(REF, 'F')
const read = (name) => ({
  source: fs.readFileSync(path.join(DIR, `${name}.pine`), 'utf8'),
  cap: JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8')),
})
const installed = []
afterAll(() => { for (const id of installed) registry.uninstallUserDefinition(id) })

/** The door → install → one instance → binder over a fake chart; the drawn bands and lines. */
const drawable = (source) => source.replace(/plot\((\d+),/g, 'plot(close * 0 + $1,')

function run(name) {
  const { source: exact, cap } = read(name)
  const source = drawable(exact)
  expect(source).not.toBe(exact)
  const id = `u_member-pane-setf${name.slice(0, 2)}`
  const b = memberPaneDefinition({ source, id })
  expect(b.ok, b.reason).toBe(true)
  const { installed: got, errors } = registry.installUserDefinitions([b.definition])
  expect(got.length, errors.join(' | ')).toBe(1)
  installed.push(id)
  const def = got[0]
  const cs = addInstance(mergeChartSettings({}), def.id, registry)
  const instances = cs.indicatorInstances.filter((i) => i.defId === def.id)
  const bars = makeBars(260)
  const idx = new Map(bars.map((x, i) => [String(x.t), i]))
  const fake = createFakeChart({ timeToX: (t) => (Number.isInteger(t) ? t * 10 : null) })
  const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
  const candles = fake.chart.addSeries(fake.LWC.CandlestickSeries, {}, 0)
  candles.setData(bars.map((x, i) => ({ time: i, open: x.o, high: x.h, low: x.l, close: x.c })))
  binder.sync({
    priceSeries: () => candles, setBarColours: () => {}, enabled: true, cs, instances, registry, bars, tf: 'D',
    symbol: { ticker: 'SPY' }, adjustTime: (t) => idx.get(String(t)),
    applyData: (series, data) => series.setData(data), plan: { fresh: true },
    resolvePlacement: () => ({ paneIndex: 1, scaleId: 'right', scaleOptions: {} }),
  })
  const bands = fake.calls.filter((c) => c.method === 'attachPrimitive').map((a) => {
    const host = fake.seriesCreated.find((s) => s.__id === a.id)
    const rec = drawPrimitive(a.args[0], { chart: fake.chart, series: host, recorder: createRecordingCtx() })
    return [...new Set(rec.fillStyles())]
  })
  const lines = binder.bindings().filter((x) => x && x.series && x.plotKey).map((x) => ({ key: x.plotKey, width: x.series.__options.lineWidth }))
  const t = translatePine(exact, { strict: true })
  return { cap, def, bands, lines, exact: t }
}

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16))
/** TradingView's colour + style transparency → `#RRGGBB` / `#RRGGBBAA` at its half-up byte. */
function tvPaint(style) {
  let rgb
  let a = 255
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(style.color)
  if (m) { rgb = [+m[1], +m[2], +m[3]]; a = Math.round(+m[4] * 255) } else rgb = hex(style.color)
  if (Number.isFinite(style.transparency)) a = Math.round((100 - style.transparency) * 255 / 100)
  const h = `#${rgb.map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('')}`
  return { rgb, a, css: a >= 255 ? h : `${h}${a.toString(16).padStart(2, '0').toUpperCase()}` }
}
/** The pixel TradingView painted inside fill k: the longest run between its two levels, column 150. */
function tvInterior(cap, k) {
  const fa = cap.meta.filledAreas[k]
  const vals = cap.meta.lastRow.slice(1)
  const plotIdx = (id) => Number(id.split('_')[1])
  const ya = cap.levelY[String(vals[plotIdx(fa.objAId)])]
  const yb = cap.levelY[String(vals[plotIdx(fa.objBId)])]
  const [lo, hi] = [Math.min(ya, yb), Math.max(ya, yb)]
  const runs = cap.columnRuns.cols['150'].map((r) => {
    const [pos, col] = r.split('@')
    const [y, n] = pos.split(':').map(Number)
    return { y, n, rgba: col.split(',').map(Number) }
  })
  const inside = runs.filter((r) => r.y > lo + 1 && r.y + r.n < hi).sort((x, y) => y.n - x.n)
  return inside[0].rgba.slice(0, 3)
}
const over = (rgb, a, bg) => rgb.map((c, i) => Math.round(c * (a / 255) + bg[i] * (1 - a / 255)))

for (const [name, version] of [['f1-fill-v6', 6], ['f2-fill-v4', 4]]) {
  describe(`set F — ${name} (Pine v${version})`, () => {
    const r = run(name)
    const styles = r.cap.meta.filledAreasStyleMeta
    it('NON-VACUITY: three bands drawn, one per fill()', () => {
      expect(r.bands).toHaveLength(3)
      r.bands.forEach((b) => expect(b).toHaveLength(1))
    })
    r.cap.meta.filledAreas.forEach((fa, k) => {
      const want = tvPaint(styles[fa.id])
      it(`band ${k}: painted ${want.css} — TradingView's colour at its byte (${want.a})`, () => {
        expect(r.bands[k][0]).toBe(want.css)
      })
      it(`band ${k}: the EXACT script's translation decides that same byte`, () => {
        const f = r.exact.presentation.fills[k]
        const o = Number.isFinite(f.opacity) ? f.opacity : null
        expect(o, 'a static band always states its opacity').not.toBeNull()
        expect(Math.round(o * 255)).toBe(want.a)
      })
      it(`band ${k}: that byte over the white background IS TradingView's interior pixel`, () => {
        expect(over(want.rgb, want.a, [255, 255, 255])).toEqual(tvInterior(r.cap, k))
      })
    })
    if (version === 4) {
      it('⭐ the v4 default: transparency 90 is byte 26 (25.5 half-up), not the 25 of 1 − 0.9 in floating point', () => {
        expect(r.bands.map((b) => b[0])).toEqual(['#FF52521A', '#FF5252', '#2962FF1A'])
      })
    } else {
      it('⭐ the v6 default: OPAQUE — never the engine\'s 0.15 (byte 38)', () => {
        expect(r.bands.map((b) => b[0])).toEqual(['#F23645', '#2962FF', '#F2364580'])
      })
    }
  })
}

describe('set F — f3-linewidth-v6: plot linewidth 1..10, unclamped', () => {
  const r = run('f3-linewidth-v6')
  const tv = Object.values(r.cap.meta.propStyles).map((s) => s.linewidth)
  it('TradingView reads back 1..10 (the capture)', () => {
    expect(tv).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
  it('⭐ every line draws at TradingView\'s width', () => {
    expect(r.lines.map((l) => l.width)).toEqual(tv)
  })
  it('…and the EXACT script\'s translation carries the same widths', () => {
    expect(r.exact.outputs.filter((o) => o.kind === 'plot').map((o) => o.presentation.width)).toEqual(tv)
  })
  it('…and the width control of each admits it', () => {
    const widths = r.def.inputs.filter((i) => i.type === 'int' && /width/i.test(i.label))
    expect(widths.map((w) => w.default)).toEqual(tv)
    widths.forEach((w) => expect(w.max).toBeGreaterThanOrEqual(w.default))
  })
})

describe('set F — a document SAVED before this change', () => {
  it('⛔ an old static band with no `fillOpacity` draws exactly as it always did (no silent change on load)', () => {
    // The old door wrote no `fillOpacity` for a static fill with no transparency, and the
    // engine's own 0.15 painted it. Nothing reinterprets a stored document: it keeps that
    // until it is re-added, when the door states TradingView's opacity.
    expect(staticFillOf({ key: 'a', fill: { with: 'b' }, fillColor: '#F23645' })).toEqual({ color: '#F23645', opacity: 0.15 })
  })
  it('…while a re-add through the door states TradingView\'s opacity explicitly', () => {
    const [, , band2] = run('f1-fill-v6').def.plots.filter((p) => p.fill && typeof p.fill.with === 'string')
    expect(band2.fillOpacity).toBeCloseTo(0.5, 12)
    expect(run('f1-fill-v6').def.plots.filter((p) => p.fill && typeof p.fill.with === 'string').map((p) => p.fillOpacity).slice(0, 2)).toEqual([1, 1])
  })
})
