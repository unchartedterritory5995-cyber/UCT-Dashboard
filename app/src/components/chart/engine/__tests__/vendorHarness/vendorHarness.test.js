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

import { describe, it, expect, vi } from 'vitest'
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
  decodePackedColour, unescapeVendorTitle, readingOf, coloursAgree, NO_COLOUR, vendorColorsFor,
  vendorPlotRoles,
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
  function install({ studies, bars, interval = '1D', symbolInfo = {} }) {
    const mainSeries = {
      bars: () => each([[-1000001, [0, 0, 0, 0, 0, 0]], ...bars.map((b, i) => [i, b])]),
      symbolInfo: () => ({ name: 'SPY', pro_name: 'AMEX:SPY', exchange: 'NYSE Arca', timezone: 'America/New_York', pricescale: 100, minmov: 1, session: '0930-1600', type: 'fund', ...symbolInfo }),
      interval: () => interval,
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

  it('an OBJECTS-ONLY study (no declared plots, no rows) captures its drawings; a study WITH plots and no rows is still refused', () => {
    const byId = (recs) => ({ _primitivesDataById: new Map(recs.map((r, i) => [i, r])) })
    const g = { dwglines: () => new Map([['a', new Map([['f', byId([{ id: 1 }])]])]]) }
    const objectsOnly = mkStudy({ mi: { ...mkStudy().mi, plots: [], styles: {}, palettes: {}, defaults: {} }, rows: [], graphics: g })
    let vh = install({ studies: [objectsOnly], bars: BARS })
    const sum = vh.capture({ study: 'UCTVH', source: SRC })
    const cap = JSON.parse(Array.from({ length: sum.chunks }, (_, i) => vh.chunk(i).text).join(''))
    expect(validateCapture(cap)).toEqual({ ok: true, errors: [] })
    expect(cap.plotValues.rows).toEqual([])
    expect(cap.plotValues.fields).toEqual(['time'])
    expect(cap.objects.counts.lines).toBe(1)
    expect(cap.warnings.join(' ')).toMatch(/objects-only study/)
    // ⛔ CONTROL (schema): zero plots WITHOUT an objects block is still not a capture.
    const { receipt, ...noReceipt } = cap
    const stripped = { ...noReceipt, objects: null }
    const t0 = JSON.stringify(stripped)
    const resealed = { ...stripped, receipt: { ...receipt, chars: t0.length, fnv1a: fnv1a(t0) } }
    expect(validateCapture(resealed).errors).toContain('study.plots must list the metaInfo plots in order')
    vh.cleanup()
    // ⛔ CONTROL: the same empty rows under a study that DECLARES plots is not a capture.
    vh = install({ studies: [mkStudy({ rows: [] })], bars: BARS })
    expect(() => vh.capture({ study: 'UCTVH', source: SRC })).toThrow(/no rows on the bar grid/)
    vh.cleanup()
  })

  // ── newestBarIsForming — DERIVED from the chart, never taken on trust ───────
  //
  // ⚰️ Measured 2026-09-28 (origin/pine/object-gc): AMEX:SPY 1W captured at
  // 2026-09-29T01:12:16Z (Monday 21:12 ET) recorded `newestBarIsForming: false`
  // — the batch's daily-only guess — while the week had four sessions to go, and
  // TradingView's own `barstate.isconfirmed` plot read 0 on that bar
  // (vw-clock-close-tfchange-spy-1w K17; vw-object-gc-{a,b,c,d}-spy-1w *01). The
  // 1D capture of the same bar, same evening, read 1. Those bar times are used here.
  describe('newestBarIsForming — the bar\'s own period end against the capture instant', () => {
    const SPY = { timezone: 'America/New_York', session: '0930-1600' }
    const MON_0928 = 1790602200         // 2026-09-28T13:30Z: SPY's 1D bar AND its 1W bar
    const CAPTURED = '2026-09-29T01:12:16.482Z'
    const at = (iso) => Date.parse(iso)
    let vh
    const state = (t, interval, iso, si = SPY) => vh._newestBarState(t, interval, si, at(iso))

    it('⭐⭐ 1W on a Monday evening is FORMING; the same bar as 1D is closed (the capture that went wrong)', () => {
      vh = install({ studies: [mkStudy()], bars: BARS })
      const w = state(MON_0928, '1W', CAPTURED)
      expect(w.forming).toBe(true)
      expect(w.periodEndUTC).toBe('2026-10-02T20:00:00.000Z')      // Friday 16:00 ET
      // ⛔ CONTROL: the identical bar on 1D closed at Monday 16:00 ET.
      const d = state(MON_0928, '1D', CAPTURED)
      expect(d.forming).toBe(false)
      expect(d.periodEndUTC).toBe('2026-09-28T20:00:00.000Z')
      // and a 1D bar in the middle of its own session is forming
      expect(state(MON_0928, 'D', '2026-09-28T18:00:00Z').forming).toBe(true)
      vh.cleanup()
    })

    it('1W closes at Friday\'s close — and on a holiday Friday, at Thursday\'s, when the symbol lists it', () => {
      vh = install({ studies: [mkStudy()], bars: BARS })
      expect(state(MON_0928, '1W', '2026-10-02T19:59:00Z').forming).toBe(true)
      expect(state(MON_0928, '1W', '2026-10-02T20:01:00Z').forming).toBe(false)
      const GOOD_FRIDAY_WEEK = Date.parse('2026-03-30T13:30:00Z') / 1000
      const thursdayEvening = '2026-04-02T21:00:00Z'
      const hol = state(GOOD_FRIDAY_WEEK, '1W', thursdayEvening, { ...SPY, session_holidays: '20260403' })
      expect(hol.forming).toBe(false)
      expect(hol.periodEndUTC).toBe('2026-04-02T20:00:00.000Z')
      // ⛔ CONTROL: without the holiday list the week runs to Friday.
      expect(state(GOOD_FRIDAY_WEEK, '1W', thursdayEvening).forming).toBe(true)
      vh.cleanup()
    })

    it('60 m: the last bar of the session ends at the session close, not start + 60 min', () => {
      vh = install({ studies: [mkStudy()], bars: BARS })
      const LAST_60 = 1790364600          // 2026-09-25T19:30Z, SPY's 15:30 ET 60 m bar
      expect(state(LAST_60, '60', '2026-09-25T19:45:00Z').forming).toBe(true)
      const after = state(LAST_60, '60', '2026-09-25T20:05:00Z')
      expect(after.forming).toBe(false)
      expect(after.periodEndUTC).toBe('2026-09-25T20:00:00.000Z')
      // ⛔ CONTROL: a mid-session bar runs its full 60 minutes.
      const MID = Date.parse('2026-09-25T14:30:00Z') / 1000
      expect(state(MID, '60', '2026-09-25T15:20:00Z').forming).toBe(true)
      expect(state(MID, '60', '2026-09-25T15:31:00Z').forming).toBe(false)
      vh.cleanup()
    })

    it('1M closes at the close of the month\'s last trading day', () => {
      vh = install({ studies: [mkStudy()], bars: BARS })
      const SEP = Date.parse('2026-09-01T13:30:00Z') / 1000
      expect(state(SEP, '1M', CAPTURED).forming).toBe(true)
      const end = state(SEP, 'M', '2026-09-30T20:01:00Z')        // Wednesday 30th, 16:01 ET
      expect(end.forming).toBe(false)
      expect(end.periodEndUTC).toBe('2026-09-30T20:00:00.000Z')
      vh.cleanup()
    })

    it('⛔ what cannot be derived is null, never false', () => {
      vh = install({ studies: [mkStudy()], bars: BARS })
      expect(state(MON_0928, '2W', CAPTURED).forming).toBeNull()
      expect(state(MON_0928, '1W', CAPTURED, { session: '0930-1600' }).forming).toBeNull()   // no timezone
      expect(state(MON_0928, '1W', CAPTURED, { ...SPY, session: '1800-1700' }).forming).toBeNull()  // overnight
      vh.cleanup()
    })

    // Through capture(): the double's bars end on the real Monday bar.
    const WEEK_BARS = [[MON_0928 - 7 * 86400, 1, 2, 0.5, 1.5, 10], [MON_0928, 1.5, 2, 1, 1.8, 12]]
    const weekStudy = () => mkStudy({ rows: [[MON_0928 - 7 * 86400, 1.5, 1, 0], [MON_0928, 1.8, 1.5, 1]] })
    const captureAt = (iso, interval, opts) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(iso))
      try {
        vh = install({ studies: [weekStudy()], bars: WEEK_BARS, interval })
        const sum = vh.capture({ study: 'UCTVH', source: SRC, ...opts })
        const cap = JSON.parse(Array.from({ length: sum.chunks }, (_, i) => vh.chunk(i).text).join(''))
        vh.cleanup()
        return { sum, cap }
      } finally {
        vi.useRealTimers()
      }
    }

    it('⭐⭐ capture() records the DERIVED state over the caller\'s guess, and says so', () => {
      const { sum, cap } = captureAt(CAPTURED, '1W', { newestBarIsForming: false })
      expect(validateCapture(cap)).toEqual({ ok: true, errors: [] })
      expect(cap.capturedAtUTC).toBe(CAPTURED)
      expect(cap.newestBarIsForming).toBe(true)
      expect(cap.newestBar).toMatchObject({
        time: MON_0928, source: 'derived', derived: true, asserted: false,
        periodEndUTC: '2026-10-02T20:00:00.000Z',
      })
      expect(cap.warnings.join('\n')).toMatch(/the caller asserted false.*recorded true/)
      expect(sum).toMatchObject({ newestBarIsForming: true, newestBarIsFormingSource: 'derived' })
    })

    it('⛔ CONTROL — the same instant on 1D records closed, with no disagreement to report', () => {
      const { cap } = captureAt(CAPTURED, '1D', { newestBarIsForming: false })
      expect(validateCapture(cap).ok).toBe(true)
      expect(cap.newestBarIsForming).toBe(false)
      expect(cap.newestBar.source).toBe('derived')
      expect(cap.warnings.join('\n')).not.toMatch(/the caller asserted/)
      // 01:12Z is 5 h 12 min after the 16:00 ET close: past the confirmation window
      expect(cap.warnings.join('\n')).not.toMatch(/TradingView confirms such a bar/)
      // …and inside that window the capture says so rather than guessing
      const early = captureAt('2026-09-28T23:30:00Z', '1D', {})
      expect(early.cap.newestBarIsForming).toBe(false)
      expect(early.cap.warnings.join('\n')).toMatch(/TradingView confirms such a bar/)
    })

    it('⛔ an underivable interval falls back to the caller\'s assertion — and to null, never false', () => {
      const asserted = captureAt(CAPTURED, '2W', { newestBarIsForming: true })
      expect(asserted.cap.newestBarIsForming).toBe(true)
      expect(asserted.cap.newestBar.source).toBe('asserted')
      const none = captureAt(CAPTURED, '2W', {})
      expect(none.cap.newestBarIsForming).toBeNull()
      expect(none.cap.newestBar.source).toBe('unknown')
      expect(none.cap.warnings.join('\n')).toMatch(/newestBarIsForming not derived/)
    })
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

  // ── colour readings the 2026-09-28 live batch (47 RDDT 1D captures) forced ──
  describe('colour readings — measured on the 2026-09-28 live batch', () => {
    it('a palette-less colorer value IS the colour, packed 0xAABBGGRR — red in the LOWEST byte', () => {
      // Each pair measured against a colour the script's source states literally.
      expect(decodePackedColour(0xff5252ff)).toBe('#ff5252ff')   // sector-rotation, v5 color.red
      expect(decodePackedColour(0xff50af4c)).toBe('#4caf50ff')   // sector-rotation, v5 color.green
      expect(decodePackedColour(0xff35d8fd)).toBe('#fdd835ff')   // dual-view, input.color(color.yellow)
      expect(decodePackedColour(0xb39e9e9e)).toBe('#9e9e9eb3')   // momentum-vol, color.new(color.gray, 30)
      expect(decodePackedColour(0x4dd4bc00)).toBe('#00bcd44d')   // artemis, color.new(#00bcd4, 70)
      // ⛔ CONTROL — the byte order is not symmetric: pure red and pure blue.
      expect(decodePackedColour(0xff0000ff)).toBe('#ff0000ff')
      expect(decodePackedColour(0xffff0000)).toBe('#0000ffff')
      // ⛔ Not a packed colour ⇒ null, never a guess.
      for (const bad of [-1, 2 ** 32, 1.5, '4278190335', null, undefined]) expect(decodePackedColour(bad)).toBeNull()
    })

    it('vendorColorsFor: no palette ⇒ decode; `null` on a reported bar ⇒ the na colour; no row ⇒ unknown', () => {
      const times = [1, 2, 3]
      const plain = { study: { styleState: {} } }
      const packed = [{ id: 'plot_1', target: 'plot_0', column: 2 }]
      const rows = new Map([['1', [1, 5, 0xff0000ff]], ['2', [2, 5, null]]])
      expect(vendorColorsFor(plain, { id: 'plot_0' }, packed, rows, times).colors)
        .toEqual(['#ff0000ff', NO_COLOUR, undefined])
      // The palette path reads `null` the same way — measured on Ultimate Pivot
      // Points, whose palette has NO entry for the `na` branch at all.
      const pal = { study: { styleState: {}, palettes: { palette_0: { valToIndex: { 4: 0 }, colors: { 0: { color: 'rgba(76,175,80,0.9)' } } } } } }
      const withPal = [{ id: 'plot_1', target: 'plot_0', palette: 'palette_0', column: 2 }]
      const rows2 = new Map([['1', [1, 5, 4]], ['2', [2, 5, null]]])
      expect(vendorColorsFor(pal, { id: 'plot_0' }, withPal, rows2, times).colors)
        .toEqual(['#4caf50e6', NO_COLOUR, undefined])
      // ⛔ One undecodable value makes the whole reading undecodable, naming the bar.
      const u = vendorColorsFor(plain, { id: 'plot_0' }, packed, new Map([['1', [1, 5, 1.5]]]), [1])
      expect(u.colors).toBeNull()
      expect(u.reason).toMatch(/at bar 0 is not a packed colour/)
    })

    it('every fully transparent colour is one drawing; alpha may differ by ONE 8-bit unit, never two', () => {
      expect(coloursAgree('#00000000', '#c9a84c00')).toBe(true)      // nothing is nothing
      expect(coloursAgree('#ffd60019', '#ffd6001a')).toBe(true)      // color.new(c, 90): 25.5 units
      expect(coloursAgree('#ffd60019', '#ffd6001b')).toBe(false)     // ⛔ two units is a real alpha
      expect(coloursAgree('#ffd60019', '#ffd70019')).toBe(false)     // ⛔ RGB is exact
      expect(coloursAgree('#c9a84c00', '#c9a84c02')).toBe(false)     // ⛔ nothing vs two units of something
      expect(coloursAgree('#ff5252ff', '#ff5252ff')).toBe(true)
      // …and comparePlot uses it: a transparent line of any RGB agrees with the na colour.
      const r = comparePlot({ times: [1, 2], vendor: [1, 2], ours: [1, 2], vendorColors: [NO_COLOUR, NO_COLOUR], ourColors: ['#00000000', '#c9a84cff'], tol })
      expect(r.colorCompared).toBe(2)
      expect(r.firstDivergence).toMatchObject({ bar: 1, kind: 'color', vendorColor: NO_COLOUR, ourColor: '#c9a84cff' })
    })

    it('a colour divergence prints the two COLOURS, never the two equal values', () => {
      // ⚰️ Artemis' VP Base printed "color: vendor 50 vs ours 50" — which read as a
      // comparator mistaking a value column for a colour.
      const r = comparePlot({ times: [1], vendor: [50], ours: [50], vendorColors: [NO_COLOUR], ourColors: ['#c9a84cff'], tol })
      expect(readingOf(r.firstDivergence)).toBe('color: vendor #00000000 vs ours #c9a84cff at value 50')
      expect(plotVerdict(r, { colorMeasured: true, colorResolvable: true }).reason).toMatch(/vendor #00000000 vs ours #c9a84cff/)
      // CONTROL — a VALUE divergence still prints the values
      const v = comparePlot({ times: [1], vendor: [50], ours: [51], tol })
      expect(readingOf(v.firstDivergence)).toBe('value: vendor 50 vs ours 51')
    })

    it('an undecodable vendor colour is INCONCLUSIVE, never MATCH; a plot drawn on NO bar is complete on values', () => {
      const drawn = comparePlot({ times: [1, 2], vendor: [1, 2], ours: [1, 2], vendorColors: null, ourColors: ['#ff0000ff', '#ff0000ff'], tol })
      // ⚰️ was MATCH: a palette-less colorer read `colors: null` and nothing was compared
      expect(plotVerdict(drawn, { colorMeasured: true, colorResolvable: true, vendorColorReason: 'x' }))
        .toMatchObject({ verdict: 'INCONCLUSIVE', reason: expect.stringMatching(/could not be decoded — x/) })
      // A plot that is `na` on every bar draws no colour on either platform.
      const never = comparePlot({ times: [1, 2], vendor: [null, null], ours: [NaN, NaN], vendorColors: ['#ff0000ff', '#ff0000ff'], ourColors: null, tol })
      expect(never.colorComparable).toBe(0)
      expect(plotVerdict(never, { colorMeasured: true, colorResolvable: false }).verdict).toBe('MATCH')
      // ⛔ CONTROL — ONE bar drawn in a known colour against an unresolved one is INCONCLUSIVE
      const once = comparePlot({ times: [1, 2], vendor: [null, 2], ours: [NaN, 2], vendorColors: ['#ff0000ff', '#ff0000ff'], ourColors: null, tol })
      expect(once.colorComparable).toBe(1)
      expect(plotVerdict(once, { colorMeasured: true, colorResolvable: false, ourColorReason: 'why' }))
        .toMatchObject({ verdict: 'INCONCLUSIVE', reason: expect.stringMatching(/could not be resolved \(why\)/) })
    })

    it('an HTML-escaped vendor title is unescaped before it is mapped', () => {
      // measured: `plot(ph, "Pivot High's")` reads back `Pivot High&#039;s`
      expect(unescapeVendorTitle('Pivot High&#039;s')).toBe("Pivot High's")
      expect(unescapeVendorTitle('a &amp; b &lt;c&gt; &quot;d&quot; &#x41;')).toBe('a & b <c> "d" A')
      expect(unescapeVendorTitle('&nbsp;kept')).toBe('&nbsp;kept')   // ⛔ unknown entity left as written
      expect(unescapeVendorTitle(null)).toBeNull()
      const roles = vendorPlotRoles({ study: { plots: [{ id: 'plot_0', type: 'line', title: 'Pivot High&#039;s' }] } })
      expect(roles.value[0].title).toBe("Pivot High's")
    })

    it('an EMPTY plotchar glyph draws nothing, so its colour is not graded — its values are', () => {
      const mk = (char) => ({
        symbol: { pricescale: 100 },
        history: { startsAtBar0: true },
        bars: { rows: [[1, 1, 1, 1, 1, 1], [2, 1, 1, 1, 1, 1]] },
        plotValues: { rows: [[1, 5], [2, 6]] },
        study: { plots: [{ id: 'plot_0', type: 'chars', title: 'c' }], styles: { plot_0: { char, text: '' } }, styleState: { plot_0: { color: '#2962FF' } } },
      })
      const ours = { ok: true, plots: [{ title: 'c', key: 'value', column: [5, 6], colors: ['#c9a84cff', '#c9a84cff'], lookback: 0 }] }
      const empty = compareCapture(mk(''), ours).plots[0]
      expect(empty).toMatchObject({ verdict: 'MATCH', color: 'not graded — an empty plotchar glyph draws nothing' })
      // ⛔ CONTROL — a visible glyph in the wrong colour DIVERGEs
      expect(compareCapture(mk('X'), ours).plots[0].verdict).toBe('DIVERGE')
      // ⛔ CONTROL — the empty glyph's VALUES are still graded
      const moved = compareCapture(mk(''), { ...ours, plots: [{ ...ours.plots[0], column: [5, 7] }] }).plots[0]
      expect(moved.verdict).toBe('DIVERGE')
    })
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

    // A per-bar two-colour vendor state over the real bars: palette index 0 on
    // an up bar, 1 on a down bar, keyed — like the value — to the COMPUTING bar.
    const upDown = (src, { shiftVendor = 0 } = {}) => {
      const plots = [
        { id: 'plot_0', type: 'line', title: 'c' },
        { id: 'plot_1', type: 'colorer', target: 'plot_0', palette: 'palette_0' },
      ]
      const idxAt = (k) => (rows[k] && rows[k][4] > rows[k][1] ? 0 : 1)
      const vals = rows.map((r, k) => [r[0], r[4], idxAt(k + shiftVendor)])
      return captureFrom({
        source: src, rows, plots, values: vals,
        extra: { study: { title: 'x', plots, styleState: { plot_0: { color: '#2962FF', transparency: 0 } }, palettes: { palette_0: { colors: { 0: { color: '#00FF00' }, 1: { color: '#FF0000' } } } } } },
      })
    }

    it('⭐ an OFFSET plot\'s colour is read where the renderer DREW it — the computing bar\'s colour, shifted with its value', () => {
      // ⚰️ 2026-09-28: liquidity-pools (offset -4) and price-action-as-in-book
      // (-5) graded 46 and 26 bars "vendor #787b86ff vs ours none" — the harness
      // read the point at the UNdisplaced bar, where the renderer drew nothing.
      const src = '//@version=6\nindicator("uct-offset-colour")\nplot(close, "c", color = close > open ? #00FF00 : #FF0000, offset = -2)\n'
      const g = gradeCapture(upDown(src)).verdict
      const p = g.plots.find((x) => x.id === 'plot_0')
      expect(p.verdict, p.reason).toBe('MATCH')
      expect(p.stats.colorCompared).toBeGreaterThan(1000)
      // ⛔ CONTROL — a vendor whose colours sit two bars late (what reading the
      // undisplaced point amounts to) DIVERGEs on colour.
      const late = gradeCapture(upDown(src, { shiftVendor: 2 })).verdict.plots.find((x) => x.id === 'plot_0')
      expect(late.verdict).toBe('DIVERGE')
      expect(late.stats.firstDivergence.kind).toBe('color')
    })

    it('⭐ a POSITIVE offset: TradingView exports the UNSHIFTED series, so our `x[N]` column is read N bars ahead', () => {
      // ⚰️ position-size-calculator (`offset = 20`) graded 20 bars "vendor 0 vs
      // ours na": the vendor's bar 0..19 are its own computed values, ours were
      // the displaced column's warm-up.
      const src = '//@version=6\nindicator("uct-offset-right")\nplot(close, "c", color = close > open ? #00FF00 : #FF0000, offset = 3)\n'
      const g = gradeCapture(upDown(src)).verdict
      const p = g.plots.find((x) => x.id === 'plot_0')
      expect(p.verdict, p.reason).toBe('MATCH')
      expect(p.treeShift).toBe(3)
      expect(p.stats.oursUnread).toBe(3)                         // the last 3 bars: never drawn on our chart
      expect(p.stats.compared).toBe(rows.length - 3)
      expect(p.stats.colorCompared).toBeGreaterThan(1000)
      // ⛔ CONTROL — a vendor that exported the DISPLACED series (close[3]) DIVERGEs
      const c = upDown(src)
      const shifted = clone(c)
      shifted.plotValues.rows.forEach((r, k) => { r[1] = k >= 3 ? c.plotValues.rows[k - 3][1] : null })
      const bad = gradeCapture(sealCapture(shifted)).verdict.plots.find((x) => x.id === 'plot_0')
      expect(bad.verdict).toBe('DIVERGE')
      // ⛔ CONTROL — `plot(close[3])` WITHOUT an offset is a different plot, and is not realigned
      const noOffset = '//@version=6\nindicator("uct-offset-right")\nplot(close[3], "c", color = close[3] > open[3] ? #00FF00 : #FF0000)\n'
      const q = gradeCapture(upDown(noOffset)).verdict.plots.find((x) => x.id === 'plot_0')
      expect(q.treeShift).toBeUndefined()
      expect(q.verdict).toBe('DIVERGE')
    })

    it('⭐ `cond ? colour : na` — drawn in nothing where TradingView drew nothing, read as the colour the renderer was handed', () => {
      // The vendor's palette holds ONLY the green entry; a down bar's colorer
      // reads `null` — the Ultimate Pivot Points shape, measured 2026-09-28.
      const src = '//@version=6\nindicator("uct-na-colour")\nplot(close, "c", color = close > open ? color.new(#00FF00, 10) : na)\n'
      const plots = [
        { id: 'plot_0', type: 'line', title: 'c' },
        { id: 'plot_1', type: 'colorer', target: 'plot_0', palette: 'palette_0' },
      ]
      const mk = (idx) => captureFrom({
        source: src, rows, plots, values: rows.map((r) => [r[0], r[4], idx(r)]),
        extra: { study: { title: 'x', plots, styleState: { plot_0: { color: '#2962FF', transparency: 0 } }, palettes: { palette_0: { valToIndex: { 4: 0 }, colors: { 0: { color: 'rgba(0,255,0,0.9)' } } } } } },
      })
      const g = gradeCapture(mk((r) => (r[4] > r[1] ? 4 : null))).verdict.plots.find((x) => x.id === 'plot_0')
      // ⚰️ The harness used to REPLACE the drawn colour's alpha with the plot's
      // opacity, reading the renderer's `rgba(0, 0, 0, 0)` as a visible #000000e6.
      expect(g.verdict, g.reason).toBe('MATCH')
      expect(g.stats.colorCompared).toBeGreaterThan(1000)
      // ⛔ CONTROL — a vendor that coloured EVERY bar green disagrees on the down bars
      const all = gradeCapture(mk(() => 4)).verdict.plots.find((x) => x.id === 'plot_0')
      expect(all.verdict).toBe('DIVERGE')
      expect(all.stats.firstDivergence).toMatchObject({ kind: 'color', vendorColor: '#00ff00e6' })
      expect(all.stats.firstDivergence.ourColor).toMatch(/00$/)
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
