// app/src/components/chart/engine/runtime/__tests__/strategyBarTimeIdentity.test.js
//
// ─── ONE CLOCK FOR A STRATEGY'S TRADES: THE SAME BARS AS DATES OR AS EPOCH SECONDS, THE SAME BACKTEST (2026-11-17) ───
//
// A member's DAILY chart hands the runtime lane `/api/bars`'s ISO date keys (`t: '2024-03-21'`); an epoch-second
// series (every capture, and #1664's census) hands unix seconds. Pine's `time` reads both as the instant the bar
// opened (`indicators.js::barOpenInstants`, the clock columns' gate); a broker run is handed those same instants
// (`runtimeColumns.js::brokerBarTimes`). Before this, the broker was handed the keys: on a daily chart every trade time
// was a date string, the report refused whole (`runtime:strategy-report-record`) and every trade-time read refused.
//
// ONE strategy (supertrend-strategy, corpus/committed) over ONE committed daily fixture (NYSE:RDDT 1D), given both
// ways, through the member's product path (the member door, the install door, `computeRuntimeColumns`, the report on
// the COMMITTED pin ledger), the broker gate on and the runtime lane's admission granted, as the serve census runs it:
//
//   T1 the record and the report are BYTE-IDENTICAL (their JSON text) across the two shapes, the report is served, and
//      the run trades (non-vacuity: a run with no trade states no trade time);
//   T2 every time the record states (a trade's entry and exit, an order's placing, fill and end, the window) is a bar's
//      opening instant: the capture's own bar time, which is TradingView's `time` for that bar. So the trade list is
//      on TradingView's clock with no harness mapping, and T1 cannot pass by being wrong the same way twice;
//   T3 `strategy.closedtrades.entry_time` (a synthetic probe, no licence-held text) reads the same milliseconds on both
//      shapes, `time` of its fill bar, equal to the record's entry time x 1000; and every column the run drew is equal;
//   control: the product bars really are ISO date strings and the epoch bars numbers, so T1 compares two shapes.
//
// Mutation proofs (each restored from a saved copy, never `git checkout`):
// docs/pine/evidence/2026-11-17-strategy-epoch-bar-times/EVIDENCE.md.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { loadCapture } from '../../__tests__/vendorHarness/harness.js'
import { barsOfCapture } from '../../__tests__/vendorHarness/strategyHarness.js'
import { toProductBars } from '../../__tests__/vendorHarness/ourSide.js'
import { historyWindowBarsOf } from './strategyArmed.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../runtimeColumns'
import { runtimeStrategyOf } from '../strategyRecord'
import { strategyReportOf } from '../brokerReport.js'
import { isStrategyWindowDefinition } from '../../strategyWindow'

vi.setConfig({ testTimeout: 300000, hookTimeout: 300000 })

const ROOT = path.resolve(process.cwd(), '..')
const REFERENCE = path.join(ROOT, 'tests/fixtures/vendor/harness/k-clustering-rddt-1d-2026-09-28.json')
const SUPERTREND = path.join(ROOT, 'corpus/committed/supertrend-strategy__rcRbtoBiKG.pine')
const GATE = (f) => fs.readFileSync(path.resolve(process.cwd(), `src/components/chart/engine/${f}`), 'utf8')
const flagOf = (src) => (src.match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const FLAGS = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js', 'strategyBrokerGate.js'].map((f) => flagOf(GATE(f)))
/** a synthetic strategy written for this rail: a trade every 20 bars, its entry time read back */
const ENTRY_TIME = [
  '//@version=5',
  'strategy("entry time probe", overlay=true)',
  'if bar_index % 20 == 0',
  '    strategy.entry("L", strategy.long)',
  'if bar_index % 20 == 10',
  '    strategy.close("L")',
  'plot(strategy.closedtrades > 0 ? strategy.closedtrades.entry_time(strategy.closedtrades - 1) : na, "entry time")',
  '',
].join('\n')

/** One strategy over `bars` through the member's product path; the run's columns, record and report. */
function runOn(source, bars, id) {
  for (const f of FLAGS) vi.stubEnv(f, '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  const d = memberPaneDefinition({ source, id, name: 'identity' })
  expect(d.ok, d.reason).toBe(true)
  expect(isStrategyWindowDefinition(d.definition)).toBe(true)
  const { installed } = registry.installUserDefinitions([d.definition])
  expect(installed && installed[0]).toBeTruthy()
  const ctx = { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true,
    historyWindowBars: historyWindowBarsOf(ROOT) }
  try {
    const cols = computeRuntimeColumns(installed[0], bars, ctx)
    const record = runtimeStrategyOf(cols)
    return { cols, record, report: record ? strategyReportOf(record) : null, stop: null }
  } catch (e) {
    // a run stopped by name is an answer this rail reads (and fails on, by that name), never a crash of the setup
    return { cols: {}, record: null, report: null, stop: `${(e && e.guard) || (e && e.name)}: ${String(e && e.message).slice(0, 300)}` }
  } finally {
    registry.uninstallUserDefinition(id)
    vi.unstubAllEnvs()
  }
}

/** Every bar time the record states, by where it is stated. */
function recordTimes(rec) {
  const out = [['window.startTime', rec.window.startTime], ['window.asOfBar', rec.window.asOfBar]]
  for (const t of rec.trades) {
    out.push([`trade ${t.n} entryTime`, t.entryTime])
    if (!t.open) out.push([`trade ${t.n} exitTime`, t.exitTime])
  }
  for (const o of rec.orders) {
    for (const k of ['placedTime', 'modifiedTime', 'triggerTime', 'fillTime', 'endTime']) {
      if (o[k] !== null && o[k] !== undefined) out.push([`order ${o.n} ${k}`, o[k]])
    }
  }
  return out
}

const plainColumns = (cols) => JSON.stringify(Object.keys(cols).sort().map((k) => [k, Array.from(cols[k])]))

let capture
let epoch
let product
const runs = {}

beforeAll(() => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in this rail')))
  capture = loadCapture(REFERENCE).capture
  epoch = barsOfCapture(capture)
  product = toProductBars(capture)
  const supertrend = fs.readFileSync(SUPERTREND, 'utf8')
  runs.supertrend = { epoch: runOn(supertrend, epoch, 'u_identity_st_e'), product: runOn(supertrend, product, 'u_identity_st_p') }
  runs.entryTime = { epoch: runOn(ENTRY_TIME, epoch, 'u_identity_et_e'), product: runOn(ENTRY_TIME, product, 'u_identity_et_p') }
})
afterAll(() => { vi.unstubAllGlobals() })

describe('a strategy on a member\'s daily bars records the trade times an epoch-second run records', () => {
  it('control: the two shapes are two shapes (ISO date strings against unix seconds), over the same bars', () => {
    for (const f of FLAGS) expect(f).toMatch(/^VITE_/)
    expect(product.length).toBe(epoch.length)
    expect(product.length).toBeGreaterThan(500)
    expect(product.every((b) => typeof b.t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.t))).toBe(true)
    expect(epoch.every((b) => Number.isInteger(b.t))).toBe(true)
    expect(product.map((b) => [b.o, b.h, b.l, b.c])).toEqual(epoch.map((b) => [b.o, b.h, b.l, b.c]))
  })

  it('T1 supertrend-strategy: the record and the report are byte-identical, the report served, and the run trades', () => {
    const { epoch: e, product: p } = runs.supertrend
    expect(e.stop, 'the epoch run stopped').toBe(null)
    expect(p.stop, 'the product run stopped').toBe(null)
    expect(e.record, 'epoch run published no record').toBeTruthy()
    expect(p.record, 'product run published no record').toBeTruthy()
    expect(e.record.trades.length).toBeGreaterThan(5)
    expect(p.report.status, JSON.stringify(p.report.refusals || null).slice(0, 400)).toBe('ok')
    expect(e.report.status).toBe('ok')
    expect(JSON.stringify(p.record)).toBe(JSON.stringify(e.record))
    expect(JSON.stringify(p.report)).toBe(JSON.stringify(e.report))
  })

  it('T2 every time the record states is a bar\'s opening instant: the capture\'s own bar time (TradingView\'s `time`)', () => {
    const barTimes = new Set(capture.bars.rows.map((r) => r[0]))
    expect(runs.supertrend.product.stop, 'the product run stopped').toBe(null)
    expect(runs.supertrend.product.record, 'the product run published no record').toBeTruthy()
    const times = recordTimes(runs.supertrend.product.record)
    expect(times.length).toBeGreaterThan(20)
    const off = times.filter(([, t]) => !barTimes.has(t))
    expect(off, `times not on a bar of the capture: ${JSON.stringify(off.slice(0, 5))}`).toEqual([])
    expect(runs.supertrend.product.record.window.startTime).toBe(capture.bars.rows[0][0])
  })

  it('T3 `strategy.closedtrades.entry_time` reads `time` of its fill bar, in ms, on both shapes; every column equal', () => {
    const { epoch: e, product: p } = runs.entryTime
    expect(e.stop, 'the epoch run stopped').toBe(null)
    expect(p.stop, 'the product run stopped').toBe(null)
    expect(p.record && e.record).toBeTruthy()
    expect(plainColumns(p.cols)).toBe(plainColumns(e.cols))
    const col = Object.values(p.cols).find((c) => c && c.length === product.length && Array.from(c).some(Number.isFinite))
    expect(col, 'the probe drew no entry time').toBeTruthy()
    const last = Array.from(col).filter(Number.isFinite).pop()
    const closed = p.record.trades.filter((t) => !t.open)
    expect(closed.length).toBeGreaterThan(5)
    expect(last).toBe(closed[closed.length - 1].entryTime * 1000)
    expect(capture.bars.rows.some((r) => r[0] * 1000 === last)).toBe(true)
  })
})
