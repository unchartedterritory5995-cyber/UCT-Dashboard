// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.w9Strategy.test.js
//
// ─── W9-T3a: the strategy capture's rails and controls ────────────────────────
//
// ⛔ EVERY CAPTURE AND EVERY TESTER-REPORT TREE IN THIS FILE IS SYNTHETIC. Nothing here was read off
// TradingView; W9-C0 (where the report lives in the chart model) has not been taken, so the report
// tree below is an INVENTED shape used to prove the reader's mechanics, never its key names. The
// only real data are the committed strategy fixtures of 2026-10-02/03, used as the
// "existing captures verify unchanged" control.
//
// Each rail has a CONTROL: a fixture that distinguishes (the same reader, a different tree or a
// different read-back, gives a different answer) so a reader that returns a constant cannot pass.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { SCHEMA_ID, BAR_FIELDS, sealCapture, sha256Hex, validateCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import {
  PROPERTY_TABLE, REQUIRED_PROPERTY_KEYS, REPORT_SLOTS, isStrategyCapture, settingsAgreement, declaredStrategyArgs,
  guardsIn, extractReportFields, readReport, propertiesByKey, chartDataOf,
} from '../../../../../../../tools/vendor_harness/strategy_capture.mjs'
import { REPO, VENDOR_DIR } from './harness'

const clone = (x) => JSON.parse(JSON.stringify(x))
const HERE_TOOLS = path.join(REPO, 'tools/vendor_harness')

// ── SYNTHETIC strategy capture ───────────────────────────────────────────────
const SRC = '//@version=6\nstrategy("SYN", overlay = false, initial_capital = 100000, pyramiding = 2, default_qty_type = strategy.fixed, default_qty_value = 3, commission_type = strategy.commission.percent, commission_value = 0.1)\nplot(close, "C")\n'
const T0 = 1700000000
const BARS = Array.from({ length: 12 }, (_, i) => [T0 + i * 86400, 10 + i, 11 + i, 9 + i, 10.5 + i, 100])

const READBACK = {
  'Initial Capital': 100000, pyramiding: 2, "Calculate Strategy on Order's Fill(s)": false,
  'Calculate Strategy on every Tick(s)': false, 'Backtesting Limit Order(s) fill assumption': 0,
  'Default entry/order Qty Type': 'fixed', 'Default entry/order Qty Value': 3, 'Base Currency': 'NONE',
  'Backtesting slippage for market orders': 0, 'Commission Type': 'percent', 'Commission Value': 0.1,
  'Process orders on bar Close': false, 'Close entries rule': 'FIFO', 'Margin Long': 100, 'Margin Short': 100,
  'Risk free rate': 2, 'Use Bar Magnifier': false, 'Fill orders using standard OHLC': false,
  'Calculate Strategy on every History Tick': false,
}
const props = (over = {}) => Object.entries({ ...READBACK, ...over }).map(([name, value], i) => ({ id: `in_${i}`, name, type: 'text', value, defval: value }))

function strategyCapture({ version = 3, provenance, source = SRC, history = { startsAtBar0: true }, drop = [] } = {}) {
  const base = {
    schema: SCHEMA_ID, id: 'synthetic-strategy',
    tool: { snippet: 'tools/vendor_harness/tv_capture.js', version },
    symbol: { name: 'RDDT', pro_name: 'NYSE:RDDT', session: '0930-1600', timezone: 'America/New_York', pricescale: 100 },
    timeframe: '1D', newestBarIsForming: false, history,
    source: { text: source, sha256: sha256Hex(source), chars: source.length },
    bars: { fields: BAR_FIELDS, timeUnit: 'unix-s', count: BARS.length, rows: BARS },
    study: { id: 'StrategyScript$USER;syn@tv-scripting-101', title: 'SYN', plots: [{ id: 'plot_0', type: 'line' }] },
    plotValues: { fields: ['time', 'plot_0'], rows: BARS.map((b) => [b[0], b[4]]) },
  }
  if (provenance !== null) {
    const p = provenance || {
      strategySettings: { properties: props().filter((p) => !drop.includes(p.name)), chartData: { adjustments: [{ path: 'symbolInfo.adjustment', value: 'splits' }] } },
      gradeMethod: 'a',
    }
    base.provenance = p
  }
  return sealCapture(base)
}
const errs = (c) => validateCapture(c).errors.join(' | ')

describe('W9-T3a · 1 · a v3 strategy capture is held to its settings (SYNTHETIC captures)', () => {
  it('a complete v3 strategy capture validates', () => {
    const c = strategyCapture()
    expect(isStrategyCapture(c)).toBe(true)
    expect(validateCapture(c)).toEqual({ ok: true, errors: [] })
  })

  it('⛔ a v3 strategy capture with NO provenance fails; the SAME capture as v2 passes (the version gate)', () => {
    expect(errs(strategyCapture({ provenance: null }))).toMatch(/strategy-capture: provenance is required/)
    expect(validateCapture(strategyCapture({ provenance: null, version: 2 })).ok).toBe(true)
  })

  it('⛔ a read-back that lacks a required Properties input fails, and names it', () => {
    const missing = errs(strategyCapture({ drop: ['Use Bar Magnifier'] }))
    expect(missing).toMatch(/lacks 1 required input\(s\): use_bar_magnifier/)
    // control: every key the table requires is individually required
    for (const p of PROPERTY_TABLE) {
      expect(errs(strategyCapture({ drop: [p.name] }))).toMatch(new RegExp(`lacks 1 required input\\(s\\): ${p.key}`))
    }
    expect(REQUIRED_PROPERTY_KEYS.length).toBe(PROPERTY_TABLE.length)
  })

  it('⛔ no chartData block (the dividend / back-adjustment reads) fails; an empty list is the honest unread', () => {
    const c = strategyCapture()
    delete c.provenance.strategySettings.chartData
    expect(errs(sealCapture(c))).toMatch(/chartData\.adjustments must list/)
    const ok = strategyCapture()
    ok.provenance.strategySettings.chartData = { adjustments: [] }
    expect(validateCapture(sealCapture(ok)).ok).toBe(true)
    expect(chartDataOf(sealCapture(ok)).dividendAdjustment.read).toBe(false)
  })

  it('⛔ gradeMethod is required and method (a) needs startsAtBar0', () => {
    const c = strategyCapture()
    delete c.provenance.gradeMethod
    expect(errs(sealCapture(c))).toMatch(/gradeMethod must be one of/)
    expect(errs(strategyCapture({ history: { startsAtBar0: false } }))).toMatch(/method \(a\) needs history\.startsAtBar0/)
    const none = strategyCapture()
    none.provenance.gradeMethod = 'none'
    expect(validateCapture(sealCapture({ ...none, history: { startsAtBar0: false } })).ok).toBe(true)
  })

  describe('method (b) gradeRange', () => {
    const X = BARS[4][0]
    const Y = BARS[10][0]
    const guarded = SRC + `if time >= ${X * 1000} and time < ${Y * 1000}\n    strategy.entry("L", strategy.long)\n`
    const mk = (g, source = guarded) => {
      const c = strategyCapture({ source, history: { startsAtBar0: false } })
      c.provenance.gradeMethod = 'b'
      c.provenance.gradeRange = g
      return sealCapture(c)
    }
    it('a window with the warm-up bars before it and the matching guard validates', () => {
      expect(validateCapture(mk({ fromTime: X, toTime: Y, warmupBars: 4 }))).toEqual({ ok: true, errors: [] })
    })
    it('⛔ too few bars before fromTime fails (TradingView\'s first bar is not early enough)', () => {
      expect(errs(mk({ fromTime: X, toTime: Y, warmupBars: 5 }))).toMatch(/needs 5 bars before fromTime and the capture holds 4/)
    })
    it('⛔ a source with no guard, or a guard for another window, fails', () => {
      expect(errs(mk({ fromTime: X, toTime: Y, warmupBars: 4 }, SRC))).toMatch(/carries no `time >= X and time < Y` guard/)
      expect(errs(mk({ fromTime: X, toTime: Y + 86400, warmupBars: 4 }))).toMatch(/names a window other than gradeRange/)
    })
    it('⛔ a backwards window fails', () => {
      expect(errs(mk({ fromTime: Y, toTime: X, warmupBars: 0 }))).toMatch(/fromTime < toTime/)
    })
    it('the guard reader reads what range_guard.py writes', () => {
      expect(guardsIn(guarded)).toEqual([{ x: X * 1000, y: Y * 1000 }])
    })
  })

  it('⛔ a malformed report block fails', () => {
    const c = strategyCapture()
    c.provenance.report = { status: 'ok' }
    expect(errs(sealCapture(c))).toMatch(/report status ok but no tree/)
    c.provenance.report = { status: 'weird' }
    expect(errs(sealCapture(c))).toMatch(/report\.status must be one of/)
  })
})

describe('W9-T3a · 2 · existing captures verify unchanged', () => {
  it('every committed StrategyScript fixture (tool v2) still validates, and is not held to provenance', () => {
    const dir = VENDOR_DIR || path.join(REPO, 'tests/fixtures/vendor')
    const files = []
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(path.join(d, f.name))
        else if (f.name.endsWith('.json')) files.push(path.join(d, f.name))
      }
    }
    walk(dir)
    let strategies = 0
    for (const f of files) {
      let c
      try { c = JSON.parse(fs.readFileSync(f, 'utf8')) } catch { continue }
      if (!c || c.schema !== SCHEMA_ID || !isStrategyCapture(c)) continue
      strategies += 1
      expect(c.tool && c.tool.version, f).toBe(2)
      expect(validateCapture(c), f).toEqual({ ok: true, errors: [] })
    }
    expect(strategies).toBeGreaterThanOrEqual(10)
  })

  it('the same real fixture as a v3 capture with no provenance is REFUSED (the gate can fail)', () => {
    const f = path.join(REPO, 'tests/fixtures/vendor/harness/r1-strategy-draws-rddt-1d-2026-10-02.json')
    const c = JSON.parse(fs.readFileSync(f, 'utf8'))
    expect(validateCapture(c).ok).toBe(true)
    c.tool = { ...c.tool, version: 3 }
    expect(errs(sealCapture(c))).toMatch(/strategy-capture: provenance is required/)
  })

  it('the Properties table is the real fixture\'s own input names (the 2026-10-02 RDDT capture)', () => {
    const f = path.join(REPO, 'tests/fixtures/vendor/harness/r1-strategy-draws-rddt-1d-2026-10-02.json')
    const c = JSON.parse(fs.readFileSync(f, 'utf8'))
    const visible = c.study.inputs.filter((i) => !i.isHidden && i.id !== '__profile')
    const { missing } = propertiesByKey({ properties: visible })
    expect(missing).toEqual([])
  })
})

describe('W9-T3a · 3 · the settings read-back agreement', () => {
  it('declared literals that match the read-back AGREE', () => {
    const a = settingsAgreement(strategyCapture())
    expect(a.verdict).toBe('AGREE')
    expect(a.compared).toBeGreaterThanOrEqual(6)
    expect(a.disagreements).toEqual([])
  })

  it('⛔ a disagreement is INCONCLUSIVE and names the key (and a different read-back gives a different answer)', () => {
    const c = strategyCapture()
    c.provenance.strategySettings.properties = props({ pyramiding: 5, 'Commission Type': 'cash_per_order' })
    const a = settingsAgreement(sealCapture(c))
    expect(a.verdict).toBe('INCONCLUSIVE')
    expect(a.disagreements.map((d) => d.key).sort()).toEqual(['commission_type', 'pyramiding'])
    expect(a.disagreements.find((d) => d.key === 'pyramiding')).toMatchObject({ declared: 2, readBack: 5 })
    expect(settingsAgreement(strategyCapture()).verdict).not.toBe(a.verdict)
  })

  it('a parameter the source does not declare as a literal is never compared', () => {
    const src = '//@version=6\nstrategy("X", pyramiding = inputPyr, initial_capital = 10 * 10)\n'
    const c = strategyCapture({ source: src })
    c.provenance.strategySettings.properties = props({ pyramiding: 9 })
    expect(declaredStrategyArgs(src)).toMatchObject({ pyramiding: 'inputPyr' })
    // ⛔ nothing compared is NEVER an AGREE: it is a named inconclusive
    expect(settingsAgreement(sealCapture(c))).toMatchObject({ verdict: 'INCONCLUSIVE', compared: 0, reason: expect.stringMatching(/^strategy-settings:nothing-compared/) })
  })

  describe('B1 (review W9-T3): the declaration is read on comment- and string-blanked text', () => {
    const HEADER = '//@version=6\n// a strategy (simple) demo of the cross\n'
    const decl = 'strategy("REAL", initial_capital = 5000, pyramiding = 2)\n'
    const withProps = (src, over) => {
      const c = strategyCapture({ source: src })
      c.provenance.strategySettings.properties = props(over)
      return sealCapture(c)
    }
    it('the reviewer\'s case: a commented "strategy (" above the real declaration; 5000 declared vs 100000 read back is INCONCLUSIVE, never AGREE', () => {
      const a = settingsAgreement(withProps(HEADER + decl, { 'Initial Capital': 100000 }))
      expect(a.verdict).toBe('INCONCLUSIVE')
      expect(a.compared).toBeGreaterThan(0)
      expect(a.disagreements).toEqual([{ key: 'initial_capital', declared: 5000, readBack: 100000 }])
      expect(declaredStrategyArgs(HEADER + decl)).toMatchObject({ initial_capital: '5000', pyramiding: '2' })
      // control: the same source with a matching read-back agrees
      expect(settingsAgreement(withProps(HEADER + decl, { 'Initial Capital': 5000 }))).toMatchObject({ verdict: 'AGREE', reason: null })
    })
    it('a "strategy (" inside a string literal or after code on a comment tail is not the declaration either', () => {
      const src = '//@version=6\nlbl = "strategy (x)"\nstrategy("R", initial_capital = 5000) // strategy (again)\n'
      expect(declaredStrategyArgs(src)).toMatchObject({ initial_capital: '5000' })
      expect(settingsAgreement(withProps(src, { 'Initial Capital': 100000 })).verdict).toBe('INCONCLUSIVE')
    })
    it('⛔ never AGREE when nothing was compared: no declaration at all, and a declaration with no literal, are named', () => {
      const none = settingsAgreement(withProps('//@version=6\n// strategy (only in a comment)\nplot(close)\n', {}))
      expect(none).toMatchObject({ verdict: 'INCONCLUSIVE', compared: 0, reason: expect.stringMatching(/^strategy-settings:no-declaration/) })
      const bare = settingsAgreement(withProps('//@version=6\nstrategy("X")\n', {}))
      expect(bare).toMatchObject({ verdict: 'INCONCLUSIVE', compared: 0, reason: expect.stringMatching(/^strategy-settings:nothing-compared/) })
    })
    it('the four corpus strategies the reviewer named parse a real declaration', () => {
      const dir = path.join(REPO, 'corpus/committed')
      for (const stem of ['atr-god-strategy-by-tradesmart', 'heikin-ashi-supertrend', 'highlow-channel-swing', 'optimized-trend-tracker']) {
        const f = fs.readdirSync(dir).find((n) => n.startsWith(`${stem}__`))
        expect(f, stem).toBeTruthy()
        const text = fs.readFileSync(path.join(dir, f), 'utf8')
        const args = declaredStrategyArgs(text)
        expect(args, stem).not.toBeNull()
        expect(Object.keys(args).length, stem).toBeGreaterThan(0)
      }
    })
    it('verify_capture prints the reason beside an INCONCLUSIVE it could not compare', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uctw9b1-'))
      const f = path.join(dir, 'c.json')
      fs.writeFileSync(f, JSON.stringify(withProps('//@version=6\nstrategy("X")\n', {})))
      const r = spawnSync(process.execPath, [path.join(HERE_TOOLS, 'verify_capture.mjs'), f], { encoding: 'utf8' })
      fs.rmSync(dir, { recursive: true, force: true })
      expect(r.stdout).toMatch(/SETTINGS: INCONCLUSIVE \(0 compared.*strategy-settings:nothing-compared/)
    })
  })

  it('reads enum literals (strategy.fixed / strategy.commission.percent) as the Properties names them', () => {
    const args = declaredStrategyArgs(SRC)
    expect(args.default_qty_type).toBe('strategy.fixed')
    expect(args.commission_type).toBe('strategy.commission.percent')
  })

  it('unread reads are reported, not hidden', () => {
    const c = strategyCapture()
    c.provenance.strategySettings.chartData.adjustments = []
    const a = settingsAgreement(sealCapture(c))
    expect(a.unread).toEqual(expect.arrayContaining(['chartData:dividendAdjustment', 'chartData:backAdjustment']))
    expect(settingsAgreement(strategyCapture()).unread).toContain('chartData:backAdjustment')
  })
})

describe('W9-T3a · 4 · the tester-report reader (SYNTHETIC tree: the key names are INVENTED)', () => {
  const SLOTS = (over = {}) => ({ ...Object.fromEntries(REPORT_SLOTS.map((s) => [s, null])), netProfit: ['perf', 'all', 'net'], totalClosedTrades: ['perf', 'all', 'closed'], sharpeRatio: ['risk', 'sharpe'], ...over })
  const TREE = { perf: { all: { net: 1234.5, closed: 9 } }, risk: { sharpe: 0.75 } }

  it('extracts the pinned slots and refuses the rest BY NAME', () => {
    const f = extractReportFields(TREE, SLOTS())
    expect(f.netProfit).toEqual({ status: 'ok', path: ['perf', 'all', 'net'], value: 1234.5 })
    expect(f.totalClosedTrades.value).toBe(9)
    expect(f.sharpeRatio.value).toBe(0.75)
    expect(f.sortinoRatio).toEqual({ status: 'unpinned', reason: 'strategy-report:unpinned' })
    expect(Object.keys(f)).toEqual([...REPORT_SLOTS])
  })

  it('FIXTURE DISTINGUISHES: a different tree gives different values; a wrong path is missing, not a default', () => {
    const other = extractReportFields({ perf: { all: { net: -50, closed: 2 } }, risk: { sharpe: -1 } }, SLOTS())
    expect(other.netProfit.value).toBe(-50)
    expect(other.netProfit.value).not.toBe(extractReportFields(TREE, SLOTS()).netProfit.value)
    expect(extractReportFields(TREE, SLOTS({ netProfit: ['perf', 'all', 'netx'] })).netProfit).toEqual({ status: 'missing', path: ['perf', 'all', 'netx'] })
    expect(extractReportFields({ perf: { all: { net: 'n/a' } } }, SLOTS()).netProfit.status).toBe('not-numeric')
  })

  it('⛔ the committed slot map is UNPINNED (W9-C0 is not taken): every slot refuses by name', () => {
    const slots = JSON.parse(fs.readFileSync(path.join(HERE_TOOLS, 'strategy_report_slots.json'), 'utf8'))
    expect(slots.status).toBe('UNPINNED')
    expect(slots.reportPath).toBeNull()
    expect(Object.keys(slots.slots)).toEqual([...REPORT_SLOTS])
    const f = extractReportFields(TREE, slots.slots)
    expect(Object.values(f).every((v) => v.status === 'unpinned')).toBe(true)
  })

  it('N2a: an unpinned slot is never filled by guessing a key of its own name (a tree with a root netProfit stays unpinned)', () => {
    const f = extractReportFields({ netProfit: 77, sharpeRatio: 1 }, Object.fromEntries(REPORT_SLOTS.map((s) => [s, null])))
    expect(f.netProfit).toEqual({ status: 'unpinned', reason: 'strategy-report:unpinned' })
    expect(f.sharpeRatio.status).toBe('unpinned')
  })

  it('N2b: a PARTIAL report is refused by readReport, never read as ok', () => {
    const c = strategyCapture()
    c.provenance.report = { status: 'partial', reason: 'node limit 50000 hit at $.a', tree: TREE }
    expect(readReport(sealCapture(c), SLOTS())).toMatchObject({ status: 'refused', reason: expect.stringMatching(/strategy-report:partial/) })
  })

  it('N2d: method (a) carries no gradeRange', () => {
    const c = strategyCapture()
    c.provenance.gradeRange = { fromTime: 1, toTime: 2, warmupBars: 0 }
    expect(errs(sealCapture(c))).toMatch(/method \(a\) carries no gradeRange/)
  })

  it('readReport: a capture with no report, a refused report, and an ok report each say so', () => {
    const none = strategyCapture()
    expect(readReport(none, SLOTS())).toMatchObject({ status: 'refused', reason: expect.stringMatching(/strategy-report:absent/) })
    const refused = strategyCapture()
    refused.provenance.report = { status: 'refused', reason: 'strategy-report:unpinned: no reportPath' }
    expect(readReport(sealCapture(refused), SLOTS())).toMatchObject({ status: 'refused', reason: expect.stringMatching(/strategy-report:refused/) })
    const ok = strategyCapture()
    ok.provenance.report = { status: 'ok', tree: TREE }
    expect(readReport(sealCapture(ok), SLOTS()).fields.netProfit.value).toBe(1234.5)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
describe('W9-T3a · 5 · the TradingView-side snippet against a RECORDING DOUBLE (not the vendor)', () => {
  const SNIPPET = fs.readFileSync(path.join(HERE_TOOLS, 'tv_capture.js'), 'utf8')
  const each = (items) => ({ each: (cb) => { for (const [i, v] of items) { if (cb(i, v)) break } } })
  const SENTINEL_VALUE = 987654.321

  function install({ strategy = true, reportTree = { perf: { net: SENTINEL_VALUE } }, spy = {}, getters = null } = {}) {
    const mainSeries = {
      bars: () => each([[-1000001, [0, 0, 0, 0, 0, 0]], ...BARS.map((b, i) => [i, b])]),
      symbolInfo: () => ({ name: 'RDDT', pro_name: 'NYSE:RDDT', exchange: 'NYSE', timezone: 'America/New_York', pricescale: 100, minmov: 1, session: '0930-1600', type: 'stock', adjustment: 'splits', backadjustment: 'inherit' }),
      interval: () => '1D',
    }
    const propsList = props()
    const stateInputs = Object.fromEntries(propsList.map((p) => [p.id, p.value]))
    const ds = {
      metaInfo: () => ({
        id: strategy ? 'StrategyScript$USER;syn@tv-scripting-101' : 'Script$USER;syn@tv-scripting-101',
        description: 'SYN', plots: [{ id: 'plot_0', type: 'line' }], styles: { plot_0: { title: 'C' } },
        inputs: [
          { id: 'text', name: 'ILScript', type: 'text', defval: 'SECRETBLOB', isHidden: true },
          ...propsList.map((p) => ({ id: p.id, name: p.name, type: p.type, defval: p.defval, isHidden: false })),
        ],
      }),
      title: () => 'SYN',
      data: () => each(BARS.map((b, i) => [i, [b[0], b[4]]])),
      properties: () => ({ state: () => ({ inputs: { text: 'SECRETBLOB', ...stateInputs } }) }),
      status: () => ({ type: 2 }),
      reportData: () => { spy.reportData = (spy.reportData || 0) + 1; return reportTree },
      exportData: () => { spy.exportData = (spy.exportData || 0) + 1; return 'EXPORT' },
      settings: { depth: { deep: SENTINEL_VALUE }, flag: true },
    }
    if (getters) {
      Object.setPrototypeOf(ds, { get protoGetter() { getters.protoGetter = 1; return 1 } })
      Object.defineProperty(ds, 'ownGetter', { enumerable: true, get() { getters.ownGetter = 1; return 1 } })
    }
    const model = { dataSources: () => [{ metaInfo: () => ({ id: 'Splits@tv-basicstudies', shortId: 'Splits' }), title: () => 'Splits' }, ds], mainSeries: () => mainSeries }
    window._exposed_chartWidgetCollection = { activeChartWidget: { value: () => ({ model: () => ({ model: () => model }) }) } }
    expect((0, eval)(SNIPPET)).toMatch(/ready/)
    return window.__uctVH
  }
  const run = (vh, over = {}) => {
    const sum = vh.capture({ study: 'SYN', source: SRC, newestBarIsForming: false, startsAtBar0: true, chunkSize: 1000000, ...over })
    const text = Array.from({ length: sum.chunks }, (_, i) => vh.chunk(i).text).join('')
    return JSON.parse(text)
  }

  it('a strategy capture is written as tool v3 with provenance that validates', () => {
    const vh = install()
    const c = run(vh, { gradeMethod: 'a' })
    vh.cleanup()
    expect(c.tool.version).toBe(3)
    expect(c.provenance.gradeMethod).toBe('a')
    expect(c.provenance.report).toEqual({ status: 'not-requested' })
    const names = c.provenance.strategySettings.properties.map((p) => p.name)
    expect(names).not.toContain('ILScript')                        // the hidden encoded script is not carried
    expect(JSON.stringify(c.provenance)).not.toMatch(/SECRETBLOB/)   // study.inputs (pre-existing) still carries it
    expect(c.provenance.strategySettings.chartData.adjustments).toEqual(expect.arrayContaining([
      { path: 'symbolInfo.adjustment', value: 'splits' }, { path: 'symbolInfo.backadjustment', value: 'inherit' }]))
    expect(validateCapture(c)).toEqual({ ok: true, errors: [] })
    expect(settingsAgreement(c).verdict).toBe('AGREE')
  })

  it('⛔ a strategy capture with no gradeMethod is refused at the page', () => {
    const vh = install()
    expect(() => vh.capture({ study: 'SYN', source: SRC })).toThrow(/must say how it is graded/)
    vh.cleanup()
  })

  it('an INDICATOR capture is unchanged: tool v2, no provenance key', () => {
    const vh = install({ strategy: false })
    const c = run(vh)
    vh.cleanup()
    expect(c.tool.version).toBe(2)
    expect('provenance' in c).toBe(false)
  })

  it('N1: _strategyKeys never runs a getter, own or inherited; it reports it as an accessor', () => {
    const spy = {}
    const vh = install({ spy, getters: spy })
    const k = vh._strategyKeys()
    vh.cleanup()
    expect(spy.protoGetter).toBeUndefined()
    expect(spy.ownGetter).toBeUndefined()
    expect(k.level1.find((e) => e.name === 'protoGetter')).toEqual({ name: 'protoGetter', type: 'accessor' })
    expect(k.level1.find((e) => e.name === 'ownGetter')).toEqual({ name: 'ownGetter', type: 'accessor' })
  })

  it('N2c: a method (b) capture records the warm-up bars it was given, not zero', () => {
    const X = BARS[4][0]
    const Y = BARS[10][0]
    const src = SRC + `if time >= ${X * 1000} and time < ${Y * 1000}\n    strategy.entry("L", strategy.long)\n`
    const vh = install()
    const c = run(vh, { source: src, gradeMethod: 'b', startsAtBar0: false, gradeRange: { fromTime: X, toTime: Y, warmupBars: 4 } })
    vh.cleanup()
    expect(c.provenance.gradeRange).toEqual({ fromTime: X, toTime: Y, warmupBars: 4 })
    expect(validateCapture(c)).toEqual({ ok: true, errors: [] })
  })

  it('_strategyKeys is names and types only: it calls nothing and carries no value', () => {
    const spy = {}
    const vh = install({ spy })
    const k = vh._strategyKeys()
    vh.cleanup()
    expect(spy.reportData).toBeUndefined()
    expect(spy.exportData).toBeUndefined()
    const text = JSON.stringify(k)
    expect(text).not.toMatch(/987654/)
    expect(k.level1.find((e) => e.name === 'reportData')).toEqual({ name: 'reportData', type: 'function' })
    expect(k.level1.find((e) => e.name === 'settings').type).toBe('object')
    expect(k.level2.settings.map((e) => e.name).sort()).toEqual(['depth', 'flag'])
  })

  it('strategyReport: no path refuses by name; a denied step is refused and never called', () => {
    const spy = {}
    const vh = install({ spy })
    expect(vh.strategyReport({})).toMatchObject({ status: 'refused', reason: expect.stringMatching(/strategy-report:unpinned/) })
    expect(vh.strategyReport({ reportPath: ['exportData'] })).toMatchObject({ status: 'refused', reason: expect.stringMatching(/denied-step exportData/) })
    expect(vh.strategyReport({ reportPath: ['no spaces'] }).status).toBe('refused')
    expect(spy.exportData).toBeUndefined()
    expect(spy.reportData).toBeUndefined()
    vh.cleanup()
  })

  it('strategyReport: reads the named path (a zero-argument accessor is called once) and a different tree reads differently', () => {
    const spy = {}
    const vh = install({ spy, reportTree: { perf: { net: 5 } } })
    const r = vh.strategyReport({ reportPath: ['reportData'] })
    vh.cleanup()
    expect(r.status).toBe('ok')
    expect(r.tree).toEqual({ perf: { net: 5 } })
    expect(spy.reportData).toBe(1)
    const vh2 = install({ reportTree: { perf: { net: 6 } } })
    expect(vh2.strategyReport({ reportPath: ['reportData'] }).tree).not.toEqual(r.tree)
    expect(vh2.strategyReport({ reportPath: ['nothingHere'] })).toMatchObject({ status: 'refused', reason: expect.stringMatching(/is undefined/) })
    vh2.cleanup()
  })

  it('strategyReport: a cycle is flagged, a non-finite number is named, and the report lands in the capture', () => {
    const tree = { a: 1, n: NaN }
    tree.self = tree
    const vh = install({ reportTree: tree })
    const c = run(vh, { gradeMethod: 'none', startsAtBar0: false, reportPath: ['reportData'] })
    vh.cleanup()
    expect(c.provenance.report.status).toBe('ok')
    expect(c.provenance.report.tree.n).toEqual({ $nonfinite: 'NaN' })
    expect(c.provenance.report.tree.self).toEqual({ $cycle: '$.self' })
    expect(validateCapture(c).ok).toBe(true)
  })

  it('the snippet and schema.mjs agree on the strategy id and the guard format', () => {
    expect(SNIPPET).toContain('StrategyScript\\$')
    expect(guardsIn('if time >= 1 and time < 2')).toEqual([{ x: 1, y: 2 }])
  })
})

describe('W9-T3a · 6 · the probe a method (b) capture carries is the one range_guard.py writes', () => {
  it('s1-broker-core-range.pine\'s guards all name the generator\'s window', () => {
    const gen = fs.readFileSync(path.join(HERE_TOOLS, 'w9_probes.py'), 'utf8')
    const x = Number(/^RANGE_X_MS = (\d+)/m.exec(gen)[1])
    const y = Number(/^RANGE_Y_MS = (\d+)/m.exec(gen)[1])
    const src = fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes/s1-broker-core-range.pine'), 'utf8')
    const g = guardsIn(src)
    expect(g.length).toBeGreaterThan(0)
    expect(g.every((q) => q.x === x && q.y === y)).toBe(true)
    expect(guardsIn(fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes/s1-broker-core.pine'), 'utf8'))).toEqual([])
  })
})

describe('W9-T3a · 7 · verify_capture.mjs says whether the settings read back as declared', () => {
  const cli = path.join(HERE_TOOLS, 'verify_capture.mjs')
  const run = (c) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uctw9-'))
    const f = path.join(dir, 'c.json')
    fs.writeFileSync(f, JSON.stringify(c))
    const r = spawnSync(process.execPath, [cli, f], { encoding: 'utf8' })
    fs.rmSync(dir, { recursive: true, force: true })
    return r
  }
  it('prints SETTINGS: AGREE for an agreeing capture and INCONCLUSIVE for a disagreeing one (exit 0 either way)', () => {
    const good = run(strategyCapture())
    expect(good.status, good.stdout + good.stderr).toBe(0)
    expect(good.stdout).toMatch(/SETTINGS: AGREE \(\d+ compared, 0 disagree/)
    const c = strategyCapture()
    c.provenance.strategySettings.properties = props({ pyramiding: 5 })
    const bad = run(sealCapture(c))
    expect(bad.status).toBe(0)
    expect(bad.stdout).toMatch(/SETTINGS: INCONCLUSIVE \(\d+ compared, 1 disagree/)
  })
  it('a v3 strategy capture with no settings exits 1', () => {
    const r = run(strategyCapture({ provenance: null, version: 3 }))
    expect(r.status).toBe(1)
    expect(r.stdout).toMatch(/VERDICT: FAIL/)
  })
  it('an indicator capture prints no SETTINGS line', () => {
    const f = path.join(REPO, 'tests/fixtures/vendor/harness/r1-strategy-draws-rddt-1d-2026-10-02.json')
    const r = spawnSync(process.execPath, [cli, f], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).not.toMatch(/SETTINGS:/)                  // a v2 strategy fixture is not held to the settings read-back
  })
})
