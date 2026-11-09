// app/src/components/chart/engine/runtime/__tests__/w9T11Record.test.js
//
// W9-T11 rails: the run's `strategy` record carried through the runtime pane's run.
//   - SCHEMA: a broker run through `computeRuntimeColumns` carries a v1 record (design 3.2),
//     keyed by bar time, non-enumerable beside the columns; the one shape check refuses an
//     unserved field holding a value.
//   - THE WINDOW COMES FROM THE CONTEXT: the run takes the most recent `ctx.historyWindowBars`
//     bars, a run told none is refused by name, two windows are two answers (memo), and no
//     product source in the runtime path writes the window as a literal.
//   - THE WORKER BOUNDARY: the real worker module posts the record, the main thread re-attaches
//     it, the window crosses in the message, and the worker registers the broker flag reader.
//   - GATE OFF: no broker program, no stamp, no record; a stamped document refuses by name.
//
// ⛔ PINS: the committed ledger pins nothing, so a run that should SERVE mocks the ledger reader
// (`brokerPins.js::pinned`) here, in the test, and only here. No product code takes a pin set.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

vi.mock('../brokerPins.js', () => ({ pinned: () => globalThis.__w9t11Pins !== false }))
vi.setConfig({ testTimeout: 120000 })

import { computeRuntimeColumns, runtimeColumnsFor, probeRuntimeProgram, RUNTIME_TIME_BUDGET_GUARD } from '../runtimeColumns.js'
import { registerStrategyBrokerGate } from '../../strategyBrokerGateRegistry.js'
import { workerRunner, resetRuntimeAsync } from '../runtimeAsync.js'
import {
  STRATEGY_RECORD_SCHEMA, STRATEGY_WINDOW_HISTORY, RUNTIME_STRATEGY_KEY, runtimeStrategyOf,
  strategyRecordShapeErrors, STRATEGY_RECORD_UNSERVED,
} from '../strategyRecord.js'
import { LIMIT_NAMES } from '../limits.js'

const NL = String.fromCharCode(10)
const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const BARS = Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100 + i, h: 101.5 + i, l: 99 + i, c: 100.5 + i, v: 1000 }))
const SRC = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
  'if bar_index == 10', '    strategy.close("L")', 'if bar_index == 20', '    strategy.entry("L2", strategy.long)',
  'plot(strategy.position_size)', ''].join(NL)
const ORDERS_ONLY = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
  'plot(close)', ''].join(NL)
const INDICATOR = ['//@version=5', 'indicator("i")', 'var float acc = 0.0', 'acc += close', 'plot(acc)', ''].join(NL)

let seq = 0
const doc = (source, history = STRATEGY_WINDOW_HISTORY) => ({
  id: `w9t11-${seq += 1}`, meta: { runtimeHistory: history },
  compute: { kind: 'runtime', fn: `runtime:w9t11-${seq}`, outputs: { p: 0 }, source },
})
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL }
const gate = (on) => registerStrategyBrokerGate(on ? () => true : () => false)
const run = (d, ctx, rows = BARS, opts) => {
  try { return { cols: computeRuntimeColumns(d, rows, ctx, opts) } } catch (err) { return { err } }
}

afterEach(() => { gate(false); globalThis.__w9t11Pins = undefined; resetRuntimeAsync(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('W9-T11 the record: schema', () => {
  it('a broker run carries a v1 record, keyed by bar time, beside (not among) the columns', () => {
    gate(true)
    const { cols, err } = run(doc(SRC), { ...CTX, historyWindowBars: 30 })
    expect(err).toBeUndefined()
    expect(Object.keys(cols)).toEqual(['p'])
    expect(Object.getOwnPropertyDescriptor(cols, RUNTIME_STRATEGY_KEY).enumerable).toBe(false)
    const rec = runtimeStrategyOf(cols)
    expect(rec.schema).toBe(STRATEGY_RECORD_SCHEMA)
    expect(strategyRecordShapeErrors(rec)).toEqual([])
    expect(rec.window).toEqual({ startTime: BARS[0].t, startDate: '2023-11-14', startSentence: 'this backtest starts on 2023-11-14 (UTC); TradingView may start elsewhere', fromListing: true, bars: 30, historyWindowBars: 30, asOfBar: BARS[29].t })
    expect(rec.trades.map((t) => [t.n, t.entryId, t.dir, t.open])).toEqual([[1, 'L', 'long', false], [2, 'L2', 'long', true]])
    // market orders fill on the NEXT bar's open: keyed by that bar's TIME, not its index
    expect(rec.trades[0].entryTime).toBe(BARS[4].t)
    expect(rec.trades[0].exitTime).toBe(BARS[11].t)
    expect(rec.trades[1].exitTime).toBe(null)
    expect(rec.settings.version).toBe(5)
    expect(rec.settings.defaulted).toEqual(expect.arrayContaining(['pyramiding', 'initialCapital']))
    expect(rec.rulesUsed.length).toBeGreaterThan(3)
    expect(rec.equity).toBe(null)
    // W9-T7-F1: the order log is served (each order that opened or closed a trade, by trade number)
    expect(rec.orders.map((o) => [o.n, o.kind, o.id, o.from, o.status, o.placedTime, o.fillTime, o.opened, o.closed])).toEqual([
      [1, 'entry', 'L', null, 'filled', BARS[3].t, BARS[4].t, [1], []],
      [2, 'close', null, 'L', 'filled', BARS[10].t, BARS[11].t, [], [1]],
      [3, 'entry', 'L2', null, 'filled', BARS[20].t, BARS[21].t, [2], []],
    ])
    // a strategy.close's exit is named by TradingView itself: no stated id (`exitIdOf`)
    expect(rec.trades.map((t) => t.exitId)).toEqual([null, null])
    expect(rec.unserved).toEqual({ ...STRATEGY_RECORD_UNSERVED })
    expect(cols.p.slice(4, 6)).toEqual([1, 1])
  })

  it('the forming bar is never in the record: asOfBar is the newest CONFIRMED bar', () => {
    gate(true)
    const { cols, err } = run(doc(SRC), { ...CTX, newestBarIsForming: true, historyWindowBars: 30 })
    expect(err).toBeUndefined()
    expect(runtimeStrategyOf(cols).window.asOfBar).toBe(BARS[28].t)
  })

  it('the one shape check refuses an unserved field that holds a value, and a broken window', () => {
    gate(true)
    const rec = runtimeStrategyOf(run(doc(SRC), { ...CTX, historyWindowBars: 30 }).cols)
    expect(strategyRecordShapeErrors({ ...rec, equity: [] })).toContain('equity is unserved and must be null')
    // W9-T7-F1: the order log is checked, not nulled: a trade no order opened is refused
    expect(strategyRecordShapeErrors({ ...rec, orders: [] })).toContain('trades[0] has no opening order')
    expect(strategyRecordShapeErrors({ ...rec, trades: rec.trades.map((t) => ({ ...t, profit: 1 })) }))
      .toContain('trades.profit is unserved and must be null')
    // W9-T5: the costs are served now, so their shape is checked (no longer null)
    expect(strategyRecordShapeErrors({ ...rec, settings: { ...rec.settings, commission: 0 } }))
      .toContain('settings.commission')
    expect(strategyRecordShapeErrors({ ...rec, settings: { ...rec.settings, slippage: 1.5 } }))
      .toContain('settings.slippage')
    expect(strategyRecordShapeErrors({ ...rec, trades: rec.trades.map((t) => ({ ...t, commission: null })) }))
      .toContain('trades[0].commission')
    expect(strategyRecordShapeErrors({ ...rec, window: { ...rec.window, bars: 31 } }))
      .toContain('window.bars <= window.historyWindowBars')
    expect(strategyRecordShapeErrors({ ...rec, window: { ...rec.window, historyWindowBars: undefined } }))
      .toContain('window.historyWindowBars')
    expect(strategyRecordShapeErrors({ ...rec, schema: 'uct.strategy-record/v0' })).toContain('schema')
    expect(runtimeStrategyOf({ [RUNTIME_STRATEGY_KEY]: { ...rec, schema: 'x' } })).toBe(null)
  })
})

describe('W9-T11 the window comes from the context', () => {
  it('a run told no window is refused runtime:strategy-start, by the VM', () => {
    gate(true)
    const { err } = run(doc(SRC), CTX)
    expect(err && err.guard).toBe('runtime:strategy-start')
    expect(err.message).toMatch(/was not told it/)
  })

  it('the record states the window the CONTEXT gave (two values, two records)', () => {
    gate(true)
    const a = runtimeStrategyOf(run(doc(SRC), { ...CTX, historyWindowBars: 30 }).cols)
    const b = runtimeStrategyOf(run(doc(SRC), { ...CTX, historyWindowBars: 4321 }).cols)
    expect(a.window.historyWindowBars).toBe(30)
    expect(b.window.historyWindowBars).toBe(4321)
    expect(b.window.bars).toBe(30)
  })

  it('more bars than the window: the run takes the most recent window bars, which do not reach the listing', () => {
    gate(true)
    // not the VM's "holds more bars" refusal: the run was CUT to the window, then [B-START] spoke
    const { err } = run(doc(SRC), { ...CTX, historyWindowBars: 20 })
    expect(err && err.guard).toBe('runtime:strategy-unsettled')
    expect(err.message).toMatch(/Q-S1n/)
    expect(err.message).not.toMatch(/holds 30/)
  })

  it('two windows over the same bars are two memo entries (the window is in the run key)', () => {
    gate(true)
    const d = doc(SRC)
    const rows = BARS.slice()
    const a = runtimeStrategyOf(runtimeColumnsFor(d, rows, {}, { ...CTX, historyWindowBars: 30 }))
    const b = runtimeStrategyOf(runtimeColumnsFor(d, rows, {}, { ...CTX, historyWindowBars: 31 }))
    expect([a.window.historyWindowBars, b.window.historyWindowBars]).toEqual([30, 31])
  })

  it('ONE BUDGET: the windowed run is stopped by the pane budget it was given, and limits.js names no broker limit', () => {
    gate(true)
    let t = 0
    const { err } = run(doc(SRC), { ...CTX, historyWindowBars: 30 }, BARS, { budgetMs: 5, now: () => (t += 10) })
    expect(err && err.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(LIMIT_NAMES.filter((n) => /BROKER|STRATEGY|TRADE|ORDER/.test(n))).toEqual([])
  })

  it('RAIL: no product source in the runtime path writes the window as a literal', () => {
    const root = path.resolve(__dirname, '../../..')
    const hits = []
    // a line that names the window may hold no number of 3+ digits and no `|| n` / `?? n` default
    const NUMBER = /(?<![\w-])\d[\d_,]{2,}(?![\w])/
    const DEFAULTED = /(?:\|\||\?\?)\s*\d/
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(f); continue }
        if (!/\.jsx?$/.test(e.name) || /\.test\./.test(e.name)) continue
        fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
          if (/historyWindowBars|HISTORY_WINDOW_BARS/.test(line) && (NUMBER.test(line) || DEFAULTED.test(line))) {
            hits.push(`${e.name}:${i + 1}`)
          }
        })
      }
    }
    walk(root)
    expect(hits).toEqual([])
    expect(NUMBER.test('const win = ctx.historyWindowBars || 5000')).toBe(true)
    expect(NUMBER.test('historyWindowBars: 5_000')).toBe(true)
    expect(DEFAULTED.test('ctx.historyWindowBars ?? 7')).toBe(true)
    expect(NUMBER.test('// W9-T11 - ctx.historyWindowBars')).toBe(false)
    // the readers it does name, so the rail cannot pass by reading nothing
    const rc = fs.readFileSync(path.resolve(__dirname, '../runtimeColumns.js'), 'utf8')
    expect(rc).toMatch(/ctx\.historyWindowBars/)
    expect(fs.readFileSync(path.resolve(__dirname, '../vm.js'), 'utf8')).toMatch(/const win = ctx\.historyWindowBars/)
  })
})

describe('W9-T11 a broker run never slides', () => {
  it('a framed instance (its window slides) refuses runtime:strategy-start', () => {
    gate(true)
    const { err } = run(doc(SRC), { ...CTX, historyWindowBars: 30, framed: true })
    expect(err && err.guard).toBe('runtime:strategy-start')
    expect(err.message).toMatch(/slides/)
  })
})

describe('W9-T11 the worker boundary', () => {
  const SELF = { postMessage: (m) => SELF.posted.push(m), posted: [] }
  const workerMessage = async (data) => {
    vi.stubGlobal('self', SELF)
    await import('../runtimeWorker.js')
    SELF.posted.length = 0
    SELF.onmessage({ data })
    return structuredClone(SELF.posted[0])
  }

  it('the window crosses in the message the main thread posts', async () => {
    let sent = null
    const factory = () => ({ postMessage(m) { sent = m }, terminate() {} })
    workerRunner(factory)(doc(SRC), BARS, { ...CTX, historyWindowBars: 30 }, () => {})
    expect(sent.ctx.historyWindowBars).toBe(30)
    expect(sent.def.meta.runtimeHistory).toBe(STRATEGY_WINDOW_HISTORY)
  })

  it('the real worker posts the record, and the main thread re-attaches it unchanged', async () => {
    const msg = await workerMessage({ id: 3, def: doc(SRC), rows: BARS, ctx: { ...CTX, historyWindowBars: 30 } })
    // the worker registered the flag reader; this run is in the worker with the env unset ...
    expect(msg.ok).toBe(false)
    expect(msg.error.guard).toBe('pine:strategy-call')
    // ... and with it '1' the same worker serves the record
    vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
    const on = await workerMessage({ id: 4, def: doc(SRC), rows: BARS, ctx: { ...CTX, historyWindowBars: 30 } })
    expect(on.ok).toBe(true)
    expect(strategyRecordShapeErrors(on.strategy)).toEqual([])
    const factory = () => ({ postMessage(m) { queueMicrotask(() => this.onmessage({ data: { ...on, id: m.id } })) }, terminate() {} })
    const cols = await new Promise((resolve) => workerRunner(factory)(doc(SRC), BARS, CTX, (e, c) => resolve(c)))
    expect(runtimeStrategyOf(cols)).toEqual(on.strategy)
    expect(Object.keys(cols)).toEqual(['p'])
  })
})

describe('W9-T11 gate off', () => {
  it('the probe holds no broker with the gate off, and one with it on', () => {
    gate(false)
    const off = probeRuntimeProgram(SRC)
    expect(off.ok && off.broker).toBeFalsy()
    expect(probeRuntimeProgram(INDICATOR).broker).toBe(false)
    gate(true)
    expect(probeRuntimeProgram(SRC).broker).toBe(true)
    expect(probeRuntimeProgram(INDICATOR).broker).toBe(false)
  })

  it('a stamped strategy document run with the gate off refuses by name', () => {
    gate(false)
    const { err } = run(doc(SRC), { ...CTX, historyWindowBars: 30 })
    expect(err && err.guard).toBe('pine:strategy-call')
  })

  it('a stamped strategy whose plots read no broker value is refused gate-off too, never run plain', () => {
    gate(false)
    const { err } = run(doc(ORDERS_ONLY), { ...CTX, historyWindowBars: 30 })
    expect(err && err.guard).toBe('pine:strategy-call')
    expect(err.message).toMatch(/not switched on in this build/)
  })

  it('an indicator ignores the window: same columns, no record, with or without it', () => {
    for (const on of [false, true]) {
      gate(on)
      const a = run(doc(INDICATOR, 'listing'), CTX).cols
      const b = run(doc(INDICATOR, 'listing'), { ...CTX, historyWindowBars: 7 }).cols
      expect(b).toEqual(a)
      expect(runtimeStrategyOf(b)).toBe(null)
    }
  })
})
