// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.test.js
//
// ─── THE VENDOR-COMPARISON HARNESS — its rails and its controls ──────────────
//
// Four layers, each tested where it can fail:
//
//   1. the CAPTURE FORMAT   (tools/vendor_harness/schema.mjs)   — shape, receipt, source sha
//   2. the TV-SIDE SNIPPET  (tools/vendor_harness/tv_capture.js) — run against a
//      recording double of TradingView's model. ⚠️ A DOUBLE, NOT THE VENDOR: this
//      proves the packaging (order, census control, receipt, chunking), never
//      that TradingView's model still has these accessors. Only a live capture
//      proves that, and the harness says so in its doc.
//   3. the COMPARATOR       (tools/vendor_harness/compare.mjs)  — tolerance, mapping,
//      warm-up split, first divergence, the three verdicts
//   4. END TO END on real vendor bars, through the member door (ourSide.js), with
//      the three CONTROLS the harness exists to pass:
//        · a perturbed vendor value DIVERGEs at exactly that bar
//        · an unmapped vendor plot is INCONCLUSIVE, never MATCH
//        · a comparator stubbed to always-MATCH cannot pass this file
//
// ⛔ SYNTHETIC CAPTURES LIVE IN THIS FILE, NEVER UNDER tests/fixtures/vendor/.
// That directory's rule is "a number there was read off the vendor's own
// screen". Where a test needs a capture shape no real capture has yet (colour,
// objects), it is built here, from REAL vendor bars, and named synthetic.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

import {
  SCHEMA_ID, BAR_FIELDS, fnv1a, sha256Hex, sealCapture, verifyReceipt, validateCapture,
} from '../../../../../../../tools/vendor_harness/schema.mjs'
import {
  REL_TOL, tolerancePolicy, valuesAgree, normalizeColor, mapPlots, comparePlot, plotVerdict,
  compareCapture, compareObjects, VERDICTS,
} from '../../../../../../../tools/vendor_harness/compare.mjs'
import { detectFormat, fromObservation, declaredPlotTitles } from '../../../../../../../tools/vendor_harness/adapters.mjs'
import { runOurSide, toProductBars, tfCodeOf, isoDateIn } from './ourSide'
import { gradeCapture, loadCapture, REPO, VENDOR_DIR } from './harness'

const read = (rel) => JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'))
const clone = (x) => JSON.parse(JSON.stringify(x))

/** A v1 capture from parts. Unsealed fields first, sealed last. */
function captureFrom({ source, rows, plots, values, timeframe = '1D', timeUnit = 'unix-s', extra = {} }) {
  return sealCapture({
    schema: SCHEMA_ID,
    id: 'synthetic',
    symbol: { name: 'SPY', pro_name: 'AMEX:SPY', exchange: 'NYSE Arca', timezone: 'America/New_York', pricescale: 100 },
    timeframe,
    newestBarIsForming: false,
    history: { startsAtBar0: false },
    source: { text: source, sha256: sha256Hex(source), chars: source.length },
    bars: { fields: BAR_FIELDS, timeUnit, count: rows.length, rows },
    study: { title: 'synthetic', plots },
    plotValues: { fields: ['time', ...plots.map((p) => p.id)], rows: values },
    ...extra,
  })
}

// ── REAL vendor data the end-to-end tests stand on ───────────────────────────
const SMA_OBS = read('tests/fixtures/vendor/observations/sma-close20-2026-09-06.json')
const SMA_CAPTURE = fromObservation(SMA_OBS, { path: 'observations/sma-close20-2026-09-06.json' })

// ═════════════════════════════════════════════════════════════════════════════
describe('1 · the capture format', () => {
  const base = captureFrom({
    source: '//@version=6\nindicator("x")\nplot(close, "c")\n',
    rows: [[1000000000, 1, 2, 0.5, 1.5, 10], [1000086400, 1.5, 2.5, 1, 2, 11]],
    plots: [{ id: 'plot_0', type: 'line', title: 'c' }],
    values: [[1000000000, 1.5], [1000086400, 2]],
  })

  it('a sealed capture validates, and so does its pretty-printed round trip', () => {
    expect(validateCapture(base)).toEqual({ ok: true, errors: [] })
    // ⭐ The receipt is over the canonical body, so indentation on disk is free.
    expect(validateCapture(JSON.parse(JSON.stringify(base, null, 2))).ok).toBe(true)
  })

  it('⛔ one changed digit anywhere breaks the receipt', () => {
    const c = clone(base)
    c.bars.rows[1][4] = 2.0000001
    const v = verifyReceipt(c)
    expect(v.ok).toBe(false)
    expect(validateCapture(c).errors.join(' ')).toMatch(/receipt/)
  })

  it('⛔ the source sha must be the sha of the source text', () => {
    const c = clone(base)
    c.source.text += ' '
    const s = sealCapture(c)                        // re-sealed: transport is fine, the SCRIPT is not
    expect(validateCapture(s).errors.join(' ')).toMatch(/source\.sha256 does not match/)
  })

  it('⛔ plot columns must be in study.plots order — the Aroon trap', () => {
    const c = clone(base)
    c.study.plots = [{ id: 'plot_0', type: 'line' }, { id: 'plot_1', type: 'line' }]
    c.plotValues.fields = ['time', 'plot_1', 'plot_0']
    c.plotValues.rows = c.plotValues.rows.map((r) => [...r, 0])
    expect(validateCapture(sealCapture(c)).errors.join(' ')).toMatch(/plotValues\.fields must be/)
  })

  it('⛔ plot rows off the bar grid are refused — two matrices from two series', () => {
    const c = clone(base)
    c.plotValues.rows.push([1000172800, 3])
    expect(validateCapture(sealCapture(c)).errors.join(' ')).toMatch(/not one of the bars/)
  })

  it('verify_capture.mjs assembles chunks ONLY when every check agrees — and its exit code is the verdict', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uctvh-'))
    const text = JSON.stringify(SMA_CAPTURE)
    const size = 50000
    const n = Math.ceil(text.length / size)
    expect(n).toBeGreaterThan(1)
    const write = (dir, mangle) => {
      fs.mkdirSync(dir, { recursive: true })
      for (let i = 0; i < n; i++) {
        const t = text.slice(i * size, (i + 1) * size)
        const ch = { i, n, text: t, fnv1a: fnv1a(t), total: { chars: text.length, fnv1a: fnv1a(text) } }
        if (mangle && i === 1) ch.text = t.replace(/\d/, (d) => String((Number(d) + 1) % 10))  // one digit, same length
        fs.writeFileSync(path.join(dir, `chunk-${String(i).padStart(3, '0')}.json`), JSON.stringify(ch))
      }
    }
    const cli = path.join(REPO, 'tools/vendor_harness/verify_capture.mjs')
    write(path.join(tmp, 'good'))
    const out = path.join(tmp, 'good.json')
    const ok = spawnSync(process.execPath, [cli, '--assemble', path.join(tmp, 'good'), '--out', out], { encoding: 'utf8' })
    expect(ok.status, ok.stdout + ok.stderr).toBe(0)
    expect(ok.stdout).toMatch(/VERDICT: PASS/)
    expect(validateCapture(JSON.parse(fs.readFileSync(out, 'utf8'))).ok).toBe(true)

    write(path.join(tmp, 'bad'), true)
    const bad = spawnSync(process.execPath, [cli, '--assemble', path.join(tmp, 'bad'), '--out', path.join(tmp, 'bad.json')], { encoding: 'utf8' })
    expect(bad.status).toBe(1)
    expect(bad.stderr).toMatch(/chunk-001\.json: chunk fnv1a/)
    expect(fs.existsSync(path.join(tmp, 'bad.json'))).toBe(false)   // ⛔ NOTHING written
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('the FNV-1a is the one capture_page.js and verify_clipboard.py compute', () => {
    // Known value, computed independently: FNV-1a 32 of "a" is 0xe40c292c.
    expect(fnv1a('a')).toBe(0xe40c292c)
    expect(fnv1a('')).toBe(2166136261)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('2 · the TradingView-side snippet, against a RECORDING DOUBLE of the model', () => {
  const SNIPPET = fs.readFileSync(path.join(REPO, 'tools/vendor_harness/tv_capture.js'), 'utf8')

  const each = (items) => ({ each: (cb) => { for (const [i, v] of items) { if (cb(i, v)) break } } })
  function install({ studies, bars }) {
    const mainSeries = {
      bars: () => each([[-1000001, [0, 0, 0, 0, 0, 0]], ...bars.map((b, i) => [i, b])]),
      symbolInfo: () => ({ name: 'SPY', pro_name: 'AMEX:SPY', exchange: 'NYSE Arca', timezone: 'America/New_York', pricescale: 100, minmov: 1, session: '0930-1600', type: 'fund' }),
      interval: () => '1D',
    }
    const sources = [
      { metaInfo: () => ({ id: 'Splits@tv-basicstudies', shortId: 'Splits' }), title: () => 'Splits' },
      ...studies.map((s) => ({
        metaInfo: () => s.mi,
        title: () => s.title,
        data: () => each(s.rows.map((r, i) => [i, r])),
        properties: () => ({ state: () => s.state || {} }),
        status: () => s.status || { type: 2 },
        ...(s.graphics ? { graphics: () => s.graphics } : {}),
      })),
      { notAStudy: true },
    ]
    const model = { dataSources: () => sources, mainSeries: () => mainSeries }
    window._exposed_chartWidgetCollection = { activeChartWidget: { value: () => ({ model: () => ({ model: () => model }) }) } }
    const ready = (0, eval)(SNIPPET)
    expect(ready).toMatch(/ready/)
    return window.__uctVH
  }

  const BARS = [[1700000000, 10, 11, 9, 10.5, 100], [1700086400, 10.5, 12, 10, 11.5, 120], [1700172800, 11.5, 12.5, 11, 12, 90]]
  const SRC = '//@version=6\nindicator("UCTVH probe é🙂")\nplot(close, "B")\nplot(open, "A")\n'
  const mkStudy = (over = {}) => ({
    title: 'UCTVH probe é🙂',
    mi: {
      id: 'Script$USER;abc@tv-scripting-101', shortId: 'x', description: 'UCTVH probe é🙂',
      // ⛔ styles keys deliberately in the WRONG order — `metaInfo().plots` is the order.
      plots: [{ id: 'plot_0', type: 'line' }, { id: 'plot_1', type: 'line' }, { id: 'plot_2', type: 'colorer', target: 'plot_0', palette: 'palette_0' }],
      styles: { plot_1: { title: 'A' }, plot_0: { title: 'B' } },
      palettes: { palette_0: { valToIndex: { 0: 0, 1: 1 } } },
      defaults: { palettes: { palette_0: { colors: { 0: { color: '#FF5252' }, 1: { color: '#4CAF50' } } } } },
      inputs: [{ id: 'in_0', name: 'Length', type: 'integer', defval: 14 }],
    },
    rows: [[1700000000, 10.5, 10, 0], [1700086400, 11.5, 10.5, 1], [1700172800, 12, NaN, 1]],
    state: { styles: { plot_0: { color: '#2962FF', transparency: 0 } }, inputs: { in_0: 20 } },
    ...over,
  })

  it('its FNV-1a and sha256 are schema.mjs\'s, byte for byte — including non-BMP text', () => {
    const vh = install({ studies: [mkStudy()], bars: BARS })
    for (const s of ['', 'a', 'abc', SRC, 'x'.repeat(1000), 'é🙂☃']) {
      expect(vh._fnv1a(s)).toBe(fnv1a(s))
      expect(vh._sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'))
    }
    vh.cleanup()
  })

  it('captures a valid, sealed v1 capture — plots in metaInfo order, padding dropped, NaN → null', () => {
    const vh = install({ studies: [mkStudy()], bars: BARS })
    const sum = vh.capture({ study: 'UCTVH probe', source: SRC, newestBarIsForming: false, chunkSize: 1500 })
    expect(sum.ok).toBe(true)
    expect(sum.census).toMatchObject({ studies: 2, events: ['Splits'], indicators: 1, controlProbeSawSomething: true, controlFilterRemovedExactlyTheEvents: true })
    const parts = []
    for (let i = 0; i < sum.chunks; i++) {
      const ch = vh.chunk(i)
      expect(ch.fnv1a).toBe(fnv1a(ch.text))
      parts.push(ch.text)
    }
    expect(sum.chunks).toBeGreaterThan(1)          // the chunk path was really exercised
    const text = parts.join('')
    expect(text.length).toBe(sum.chars)
    expect(fnv1a(text)).toBe(sum.fnv1a)
    const cap = JSON.parse(text)
    expect(validateCapture(cap)).toEqual({ ok: true, errors: [] })
    expect(cap.study.plots.map((p) => p.title)).toEqual(['B', 'A', null])
    expect(cap.bars.rows).toHaveLength(3)          // the SENTINEL row is not a bar
    expect(cap.plotValues.rows[2][2]).toBeNull()   // NaN → null
    expect(cap.study.inputs[0]).toMatchObject({ id: 'in_0', defval: 14, value: 20 })
    expect(cap.source.sha256).toBe(sha256Hex(SRC))
    expect(vh.cleanup().globalsLeft).toEqual([])
  })

  it('⛔ refuses an ambiguous study name, and a study that failed to compile', () => {
    let vh = install({ studies: [mkStudy(), mkStudy()], bars: BARS })
    expect(() => vh.capture({ study: 'UCTVH', source: SRC })).toThrow(/matched 2 indicators/)
    vh.cleanup()
    vh = install({ studies: [mkStudy({ status: { type: 3, errorDescription: { error: 'Undeclared identifier' } } })], bars: BARS })
    expect(() => vh.capture({ study: 'UCTVH', source: SRC })).toThrow(/failed to compile/)
    vh.cleanup()
  })

  it('reads a study\'s drawings through graphics() and counts them per family', () => {
    const byId = (recs) => ({ _primitivesDataById: new Map(recs.map((r, i) => [i, r])) })
    const g = {
      dwglines: () => new Map([['a', new Map([['f', byId([{ id: 1 }, { id: 2 }])]])]]),
      dwglabels: () => new Map([['a', new Map([['f', byId([{ id: 3, t: 'hi' }])]])]]),
      dwgboxes: () => new Map(),
      dwgtables: () => new Map([['a', new Map([['f', byId([{ id: 4 }])]])]]),
      dwgtablecells: () => new Map([['a', new Map([['f', byId([{ id: 5, t: 'UCT' }, { id: 6, t: '1.5' }])]])]]),
    }
    const vh = install({ studies: [mkStudy({ graphics: g })], bars: BARS })
    vh.capture({ study: 'UCTVH', source: SRC })
    const cap = JSON.parse(Array.from({ length: 1 }, () => vh.chunk(0).text).join(''))
    expect(cap.objects.counts).toMatchObject({ lines: 2, labels: 1, boxes: 0, tables: 1, tableCells: 2 })
    expect(cap.objects.texts.tableCells).toEqual(['UCT', '1.5'])
    expect(cap.objects.unreadable).toEqual(['linefills'])   // absent accessor is NAMED, not zero
    vh.cleanup()
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('3 · the comparator', () => {
  const tol = { rel: REL_TOL, abs: 1e-8 }

  it('na-ness is exact; floats agree within REL or ABS only', () => {
    expect(valuesAgree(null, null, tol)).toBe(true)
    expect(valuesAgree(NaN, null, tol)).toBe(true)
    expect(valuesAgree(0, null, tol)).toBe(false)            // ⛔ na vs 0 is a divergence
    expect(valuesAgree(100, 100 + 100 * 5e-10, tol)).toBe(true)
    expect(valuesAgree(100, 100 + 100 * 5e-9, tol)).toBe(false)
    expect(valuesAgree(5e-15, 0, tol)).toBe(true)            // the zero-crossing floor
    expect(valuesAgree(1e-6, 0, tol)).toBe(false)
  })

  it('the tolerance is derived from pricescale, and a legacy readDecimals states its own floor', () => {
    expect(tolerancePolicy({ symbol: { pricescale: 100 } })).toMatchObject({ rel: 1e-9, abs: 1e-8 })
    expect(tolerancePolicy({ symbol: {} }).abs).toBe(1e-12)
    expect(tolerancePolicy({ symbol: { pricescale: 100 }, tolerance: { readDecimals: 4 } }).abs).toBe(0.5e-4)
  })

  it('colours normalise to #rrggbbaa', () => {
    expect(normalizeColor('#F23645')).toBe('#f23645ff')
    expect(normalizeColor('#fff')).toBe('#ffffffff')
    expect(normalizeColor('rgba(255, 82, 82, 0.5)')).toBe('#ff525280')
    expect(normalizeColor('red')).toBeNull()
  })

  describe('mapping — and its refusals', () => {
    const ours = [{ title: 'fast', key: 'value' }, { title: 'slow', key: 'out2' }]
    it('M1 by unique title', () => {
      const m = mapPlots([{ id: 'plot_1', title: 'slow' }, { id: 'plot_0', title: 'fast' }], ours)
      expect(m.pairs.map((p) => [p.vendor.id, p.ours.key, p.rule])).toEqual([['plot_1', 'out2', 'M1-title'], ['plot_0', 'value', 'M1-title']])
      expect(m.unmappedVendor).toEqual([])
    })
    it('⛔ a duplicated title is UNMAPPED, not guessed', () => {
      const m = mapPlots([{ id: 'p0', title: 'x' }, { id: 'p1', title: 'x' }], [{ title: 'x', key: 'a' }, { title: 'y', key: 'b' }])
      expect(m.pairs).toEqual([])
      expect(m.unmappedVendor.map((u) => u.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/not unique/)]))
    })
    it('⛔ a vendor title with no counterpart is UNMAPPED', () => {
      const m = mapPlots([{ id: 'p0', title: 'nope' }], ours)
      expect(m.unmappedVendor[0].reason).toMatch(/no plot on our side is titled "nope"/)
    })
    it('M2 pairs by position only when EVERY leftover is untitled on both sides', () => {
      const m = mapPlots([{ id: 'p0', title: 'Plot' }, { id: 'p1', title: 'Plot 2' }], [{ title: '', key: 'a' }, { title: null, key: 'b' }])
      expect(m.pairs.map((p) => p.rule)).toEqual(['M2-position-untitled', 'M2-position-untitled'])
      const bad = mapPlots([{ id: 'p0', title: 'Plot' }, { id: 'p1', title: 'Plot 2' }], [{ title: '', key: 'a' }, { title: 'named', key: 'b' }])
      expect(bad.pairs).toEqual([])
    })
    it('M0 by selector, refusing zero or several matches', () => {
      const f = [{ title: 'a', formula: 'sma(close, 20)', key: 'value' }, { title: 'b', formula: 'ema(close, 20)', key: 'out2' }]
      expect(mapPlots([{ id: 'p', selector: { formula: 'ema(close, 20)' } }], f).pairs[0].ours.key).toBe('out2')
      expect(mapPlots([{ id: 'p', selector: { formula: 'rsi(close, 14)' } }], f).unmappedVendor[0].reason).toMatch(/matches none/)
    })
  })

  it('first divergence, warm-up split and the three verdicts', () => {
    const times = [1, 2, 3, 4, 5, 6]
    const r = comparePlot({ times, vendor: [null, 1, 2, 3, 4, 5], ours: [NaN, 1.5, 2, 3, 9, 5], warmupBars: 2, tol })
    expect(r.warmup).toMatchObject({ compared: 2, divergent: 1 })
    expect(r.steady).toMatchObject({ compared: 4, divergent: 1 })
    expect(r.firstDivergence).toMatchObject({ bar: 1, kind: 'value', vendor: 1, ours: 1.5 })
    expect(r.steady.first).toMatchObject({ bar: 4, time: 5, vendor: 4, ours: 9 })
    expect(plotVerdict(r, {}).verdict).toBe('DIVERGE')

    const ok = comparePlot({ times, vendor: [null, 1, 2, 3, 4, 5], ours: [NaN, 1, 2, 3, 4, 5], warmupBars: 0, tol })
    expect(plotVerdict(ok, {}).verdict).toBe('MATCH')

    // ⛔ a hole AFTER rows began is not an answer
    const gap = comparePlot({ times, vendor: [null, 1, undefined, 3, 4, 5], ours: [NaN, 1, 2, 3, 4, 5], warmupBars: 0, tol })
    expect(plotVerdict(gap, {}).verdict).toBe('INCONCLUSIVE')
    // ⛔ nothing compared is not a MATCH
    const none = comparePlot({ times, vendor: times.map(() => undefined), ours: times.map(() => 1), warmupBars: 0, tol })
    expect(plotVerdict(none, {}).verdict).toBe('INCONCLUSIVE')
  })

  it('a colour disagreement on an otherwise equal bar is a DIVERGE of kind colour', () => {
    const times = [1, 2]
    const r = comparePlot({ times, vendor: [1, 2], ours: [1, 2], vendorColors: ['#ff5252ff', '#ff5252ff'], ourColors: ['#ff5252ff', '#4caf50ff'], tol })
    expect(r.firstDivergence).toMatchObject({ bar: 1, kind: 'color', vendorColor: '#ff5252ff', ourColor: '#4caf50ff' })
    expect(plotVerdict(r, { colorMeasured: true, colorResolvable: true }).verdict).toBe('DIVERGE')
  })

  it('objects: counts and texts, never coordinates (v1)', () => {
    const v = { counts: { lines: 1, labels: 0, boxes: 0, tables: 1, tableCells: 1 }, texts: { labels: [], tableCells: ['UCT'] } }
    expect(compareObjects(v, { ok: true, counts: { ...v.counts }, texts: { labels: [], tableCells: ['UCT'] } }).verdict).toBe('MATCH')
    expect(compareObjects(v, { ok: true, counts: { ...v.counts, lines: 2 }, texts: v.texts }).verdict).toBe('DIVERGE')
    expect(compareObjects(v, { ok: true, counts: v.counts, texts: { labels: [], tableCells: ['XYZ'] } }).verdict).toBe('DIVERGE')
    expect(compareObjects(null, { ok: true }).verdict).toBe('INCONCLUSIVE')
  })

  it('⛔ a study the vendor ran with a NON-DEFAULT input is INCONCLUSIVE — v1 runs our side at defaults', () => {
    const ours = runOurSide(SMA_CAPTURE)
    const edited = { ...SMA_CAPTURE, study: { ...SMA_CAPTURE.study, inputs: [
      { id: 'text', name: 'text', defval: 'x', value: 'y', isHidden: true },          // TradingView's own — ignored
      { id: 'in_0', name: 'Length', defval: 20, value: 50, isHidden: false },
    ] } }
    expect(compareCapture(edited, ours)).toMatchObject({ verdict: 'INCONCLUSIVE', reason: expect.stringMatching(/non-default inputs \(Length=50 vs default 20\)/) })
    const atDefault = { ...edited, study: { ...edited.study, inputs: [{ id: 'in_0', name: 'Length', defval: 20, value: 20 }] } }
    expect(compareCapture(atDefault, ours).verdict).toBe('MATCH')
  })

  it('a refused script and an invalid capture are INCONCLUSIVE with the reason', () => {
    expect(compareCapture(SMA_CAPTURE, { ok: false, refusal: 'pine:function' })).toMatchObject({ verdict: 'INCONCLUSIVE', reason: expect.stringMatching(/refused.*pine:function/) })
    expect(compareCapture(SMA_CAPTURE, null, { integrity: { ok: false, errors: ['receipt: broken'] } })).toMatchObject({ verdict: 'INCONCLUSIVE', reason: expect.stringMatching(/receipt: broken/) })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('4 · end to end on REAL vendor bars, through the member door', () => {
  it('bars reach the product in the product\'s shape: a daily bar is an ISO date in the exchange zone', () => {
    const bars = toProductBars(SMA_CAPTURE)
    expect(bars[0]).toMatchObject({ t: '2018-08-07', o: 285.39, c: 285.58 })
    expect(isoDateIn(1533648600, 'America/New_York')).toBe('2018-08-07')
    expect(tfCodeOf('1D')).toBe('D'); expect(tfCodeOf('D')).toBe('D'); expect(tfCodeOf('5')).toBe('5'); expect(tfCodeOf('12M')).toBe('12M')
  })

  it('our side is the member door: the definition installs and computeFor returns one column per carried plot', () => {
    const ours = runOurSide(SMA_CAPTURE)
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.plots.map((p) => [p.title, p.key])).toEqual([['sma20', 'value'], ['ema20', 'out2']])
    expect(ours.plots.every((p) => p.column && p.column.length === SMA_CAPTURE.bars.count)).toBe(true)
    // the binder DREW them — colours were read off the points it was handed
    expect(ours.plots.every((p) => Array.isArray(p.colors))).toBe(true)
  })

  it('⭐ the SMA observation MATCHes the vendor on every steady-state bar', () => {
    const { verdict } = gradeCapture(SMA_CAPTURE)
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
    const p = verdict.plots[0]
    expect(p.stats.steady.compared).toBeGreaterThan(1900)
    expect(p.stats.maxRel).toBeLessThan(1e-12)
  })

  // ── CONTROL 1: a perturbed value DIVERGEs at exactly that bar ──
  it('⛔ CONTROL — one perturbed vendor value DIVERGEs at exactly that bar, with both readings', () => {
    const c = clone(SMA_CAPTURE)
    const k = 1500
    const t = c.bars.rows[k][0]
    const row = c.plotValues.rows.find((r) => r[0] === t)
    const truth = row[1]
    row[1] = truth + 0.01                          // one cent on one bar
    const perturbed = sealCapture(c)                // a vendor that REPORTED this number
    const { verdict } = gradeCapture(perturbed)
    expect(verdict.verdict).toBe('DIVERGE')
    const s = verdict.plots[0].stats
    expect(s.steady.divergent).toBe(1)
    expect(s.firstDivergence).toMatchObject({ bar: k, time: t, kind: 'value', vendor: truth + 0.01 })
    expect(s.firstDivergence.ours).toBeCloseTo(truth, 9)

    // …and the SAME edit without a re-seal is a transport failure, not a finding.
    const tampered = clone(SMA_CAPTURE)
    tampered.plotValues.rows.find((r) => r[0] === t)[1] = truth + 0.01
    expect(gradeCapture(tampered).verdict).toMatchObject({ verdict: 'INCONCLUSIVE', reason: expect.stringMatching(/receipt/) })
  })

  it('⛔ CONTROL — a vendor `na` where we have a value DIVERGEs as kind na', () => {
    const c = clone(SMA_CAPTURE)
    const k = 800
    const t = c.bars.rows[k][0]
    c.plotValues.rows.find((r) => r[0] === t)[1] = null
    const { verdict } = gradeCapture(sealCapture(c))
    expect(verdict.verdict).toBe('DIVERGE')
    expect(verdict.plots[0].stats.firstDivergence).toMatchObject({ bar: k, kind: 'na', vendor: null })
  })

  // ── CONTROL 2: an unmapped plot is INCONCLUSIVE, never MATCH ──
  it('⛔ CONTROL — a vendor plot with no counterpart makes the capture INCONCLUSIVE, not MATCH', () => {
    const c = clone(SMA_CAPTURE)
    c.study.plots.push({ id: 'plot_1', type: 'line', title: 'NOT_A_PLOT_ON_OUR_SIDE' })
    c.plotValues.fields.push('plot_1')
    c.plotValues.rows.forEach((r) => r.push(1))
    const { verdict } = gradeCapture(sealCapture(c))
    expect(verdict.verdict).toBe('INCONCLUSIVE')
    const u = verdict.plots.find((p) => p.id === 'plot_1')
    expect(u).toMatchObject({ verdict: 'INCONCLUSIVE', reason: expect.stringMatching(/^UNMAPPED — no plot on our side is titled "NOT_A_PLOT_ON_OUR_SIDE"/) })
    // the mapped plot is still graded on its own merits
    expect(verdict.plots.find((p) => p.id === 'plot_0').verdict).toBe('MATCH')
  })

  // ── the non-vacuity of all of the above ──
  it('⛔ the three verdicts are all reachable, and the comparator never returns anything else', () => {
    const seen = new Set()
    seen.add(gradeCapture(SMA_CAPTURE).verdict.verdict)
    const d = clone(SMA_CAPTURE); d.plotValues.rows[1500][1] += 1
    seen.add(gradeCapture(sealCapture(d)).verdict.verdict)
    seen.add(compareCapture(SMA_CAPTURE, { ok: false, refusal: 'x' }).verdict)
    expect([...seen].sort()).toEqual([...VERDICTS].sort())
  })

  describe('colour and objects — SYNTHETIC vendor state over real vendor bars', () => {
    // ⚠️ The per-bar values below are TradingView's own (the SMA observation);
    // the colour and object state are SYNTHETIC — no live capture of those
    // exists yet. This exercises our side's colour and object paths end to end,
    // not a claim about what TradingView drew.
    const rows = SMA_CAPTURE.bars.rows
    const sma = new Map(SMA_CAPTURE.plotValues.rows.map((r) => [r[0], r[1]]))
    const values = rows.map((r) => [r[0], sma.has(r[0]) ? sma.get(r[0]) : null])
    const SRC = '//@version=6\nindicator("uct-sma-colour")\nplot(ta.sma(close, 20), "sma20", color = color.red)\n'

    it('a static plot colour that agrees MATCHes; one that differs DIVERGEs as colour', () => {
      // ⚠️ `SRC` is `@version=6`, whose `color.red` the vendor draws `#F23645` (measured,
      // palette-by-version-rddt-1d-2026-09-27.json). The synthetic state said `#FF5252`
      // — v5's red — while the engine's palette was version-blind.
      const plots = [{ id: 'plot_0', type: 'line', title: 'sma20' }]
      const agree = captureFrom({ source: SRC, rows, plots, values, extra: { study: { title: 'x', plots, styleState: { plot_0: { color: '#F23645', transparency: 0 } } } } })
      const g1 = gradeCapture(agree).verdict
      expect(g1.verdict, JSON.stringify(g1.plots.map((p) => [p.verdict, p.reason, p.color]))).toBe('MATCH')
      expect(g1.plots[0].color).toBe('compared')
      expect(g1.plots[0].stats.colorCompared).toBeGreaterThan(1000)

      const differ = captureFrom({ source: SRC, rows, plots, values, extra: { study: { title: 'x', plots, styleState: { plot_0: { color: '#2962FF', transparency: 0 } } } } })
      const g2 = gradeCapture(differ).verdict
      expect(g2.verdict).toBe('DIVERGE')
      expect(g2.plots[0].stats.firstDivergence).toMatchObject({ kind: 'color', vendorColor: '#2962ffff', ourColor: '#f23645ff' })
    })

    it('objects: a table the script draws is counted, and its cell text compared', () => {
      const src = '//@version=6\nindicator("uct-table", overlay = true)\nplot(close, "c")\nvar t = table.new(position.top_right, 1, 1)\nif barstate.islast\n    table.cell(t, 0, 0, "UCT")\n'
      const cvals = rows.map((r) => [r[0], r[4]])
      const plots = [{ id: 'plot_0', type: 'line', title: 'c' }]
      const counts = { lines: 0, labels: 0, boxes: 0, tables: 1, tableCells: 1 }
      const mk = (cell) => captureFrom({ source: src, rows, plots, values: cvals, extra: { objects: { counts, texts: { labels: [], tableCells: [cell] } } } })
      const ok = gradeCapture(mk('UCT')).verdict
      expect(ok.objects, JSON.stringify(ok)).toMatchObject({ verdict: 'MATCH' })
      expect(ok.verdict).toBe('MATCH')
      const bad = gradeCapture(mk('NOT UCT')).verdict
      expect(bad.objects.verdict).toBe('DIVERGE')
      expect(bad.verdict).toBe('DIVERGE')
    })
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('5 · the legacy adapters never invent a number', () => {
  it('an observation whose readings are NAMED CANDIDATES is refused, not coerced to na', () => {
    const j = read('tests/fixtures/vendor/observations/ta-falling-close3-2026-09-06.json')
    expect(detectFormat(j, 'x.json')).toMatchObject({ format: 'unsupported', reason: expect.stringMatching(/not one plotted number/) })
  })

  it('a probe-rows capture is adapted only if its probe sha matches and every column names a plot', () => {
    const loaded = loadCapture(path.join(VENDOR_DIR, 'seed-warmup-spy-12m-2026-09-21.json'))
    expect(loaded.capture, loaded.reason).toBeTruthy()
    expect(loaded.capture.history.startsAtBar0).toBe(true)
    const titles = declaredPlotTitles(loaded.capture.source.text)
    expect(loaded.capture.study.plots.every((p) => titles.includes(p.title))).toBe(true)
    expect(validateCapture(loaded.capture).ok).toBe(true)
  })

  it('⛔ the vendor numbers survive adaptation byte for byte', () => {
    const vals = Object.entries(SMA_OBS.vendor.values).map(([t, v]) => [Number(t), v])
    const adapted = new Map(SMA_CAPTURE.plotValues.rows.map((r) => [r[0], r[1]]))
    expect(vals.length).toBeGreaterThan(1000)
    for (const [t, v] of vals) expect(adapted.get(t)).toBe(v)
  })
})
