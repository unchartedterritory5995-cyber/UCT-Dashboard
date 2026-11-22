// app/src/components/chart/engine/runtime/__tests__/w9ValueReadbacks.test.js
//
// ─── VALUE READ-BACKS: WHAT THE BROKER SERVES BECAUSE A CAPTURE WITNESSES IT ─────────────────────
//
// The rules below are served on hand-built bars whose every number is computable from the rule's own
// sentence. Each rule is WITNESSED by the committed strategy captures and by no TradingView text; the
// witness itself is re-derived from the captures in `__tests__/vendorHarness/strategyReadbackWitness.test.js`,
// and each capture's own run is graded bar by bar in `strategyGrading.test.js` (steps 7 and 8).
//
// Every served case has its UNPINNED twin: the same run with only that rule unpinned stops
// `runtime:strategy-unpinned` naming it (ruling D1: pin before serve), and its ON-GRID / FLAT control
// never asks the rule at all.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { makeBroker, BROKER_OPS, BROKER_TRADE_FNS, V4_MARGIN_DEFAULT_SETTING } from '../broker.js'
import { BROKER_RULES } from '../brokerRules.js'
import { pinned } from '../brokerPins.js'
import { strategyRecordOf, witnessedExitIdOf, WITNESSED_EXIT_ID_RULES, exitIdOf } from '../strategyRecord.js'
import { strategyReportOf, REPORT_UNSTATED_GUARD } from '../brokerReport.js'
import BROKER_PINS from '../brokerPins.json'
import { V4_MARGIN0_SHAPES } from '../../ast/strategyBroker.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' } // mintick 0.01, pointvalue 1
const T0 = 1700000000
const DAY = 86400
const ALL = () => true
const except = (...ids) => (id) => !ids.includes(id)
const barsOf = (rows, step = DAY) => rows.map(([o, h, l, c], i) => ({ t: T0 + i * step, o, h, l, c, v: 1000 }))
// bars 0-1 flat at 100; an order placed on bar 1 fills at bar 2's open, one placed on bar 3 at bar 4's
const base = (b2, b4, more = {}) => barsOf([
  [100, 101, 99, 100], [100, 101, 99, 100],
  b2 || [100, 101.5, 99.5, 101],
  more.b3 || [101, 104, 100.5, 103.5],
  b4 || [103.5, 105, 102.5, 104],
  ...Array.from({ length: 5 }, () => more.rest || [104, 105, 103.5, 104.5]),
])
const at = (i, step = DAY) => T0 + i * step

const attempt = (src, { bars = base(), pins = ALL, noTimes = false } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const barTimes = bars.map((b) => b.t)
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, ...(noTimes ? {} : { barTimes }), historyWindowBars: 5000 }
  try {
    const res = execute(program, ctx, undefined, pins === 'ledger' ? undefined : { brokerPinned: pins })
    const rec = strategyRecordOf({ summary: res.broker, decl: program.broker, barTimes, historyWindowBars: 5000, confirmed: true })
    return { res, rec, cols: res.outputs.map((o) => Array.from(o)), trades: res.broker.record.trades, used: res.broker.record.rulesUsed }
  } catch (e) { return { err: e } }
}
const served = (src, o) => {
  const r = attempt(src, o)
  expect(r.refused, JSON.stringify(r.refused)).toBeUndefined()
  expect(r.err, r.err && r.err.message).toBeUndefined()
  return r
}
const unpinnedAt = (src, rule, o = {}) => {
  const r = attempt(src, { ...o, pins: except(rule) })
  expect(r.err, `the run did not stop with ${rule} unpinned`).toBeDefined()
  expect(r.err.guard).toBe('runtime:strategy-unpinned')
  expect(r.err.rule).toBe(rule)
  return r.err
}
const unsettled = (src, row, o) => {
  const r = attempt(src, o)
  expect(r.err, 'the run did not stop').toBeDefined()
  expect(r.err.guard).toBe('runtime:strategy-unsettled')
  expect(r.err.message).toContain(row)
  return r.err
}
const DECL = (extra = '') => `//@version=6\nstrategy("t", initial_capital = 100000, default_qty_type = strategy.fixed, default_qty_value = 2, `
  + `margin_long = 0, margin_short = 0${extra ? `, ${extra}` : ''})\n`
const ENTER = 'if bar_index == 1\n    strategy.entry("L", strategy.long)\n'
const ENTER_SHORT = 'if bar_index == 1\n    strategy.entry("S", strategy.short)\n'
const CLOSE3 = 'if bar_index == 3\n    strategy.close("L")\n'
const close9 = (a, b) => expect(a).toBeCloseTo(b, 9)

describe('the rules are named, each with its capture row; the ledger pins every one whose captures MATCH, except B-ROUND-MARK', () => {
  const UNPINNED = new Set(['B-ROUND-MARK']) // no committed capture of ours reaches it (the AMEX:SPY bind refuses)
  it.each([
    ['B-ROUND', 'Q-S1l'], ['B-ROUND-MARK', 'W9-R1i'], ['B-TXT-CLOSE-ID', 'Q-S1p'], ['B-TXT-CLOSE-ALL-ID', 'Q-S1-core'],
    ['B-TXT-ENTRY-CLOSE-ID', 'Q-S1b'], ['B-TXT-NO-COMMENT', 'Q-S1k'],
  ])('%s -> %s', (rule, row) => {
    expect(BROKER_RULES[rule].capture).toBe(row)
    expect(pinned(rule)).toBe(!UNPINNED.has(rule))
  })
  it('the exit ids the captures witness are the four kinds `witnessedExitIdOf` names, each behind its own rule', () => {
    // + the margin call's (2026-11-17): `Close position order`, behind B-MARGIN-CALL, the rule of the event itself
    expect(Object.values(WITNESSED_EXIT_ID_RULES).sort()).toEqual(['B-MARGIN-CALL', 'B-TXT-CLOSE-ALL-ID', 'B-TXT-CLOSE-ID', 'B-TXT-ENTRY-CLOSE-ID'])
    for (const rule of Object.values(WITNESSED_EXIT_ID_RULES)) expect(Object.keys(BROKER_RULES)).toContain(rule)
  })
})

describe('strategy.closedtrades.entry_time / exit_time, strategy.opentrades.entry_time: the fill BAR\'s time, in ms [B-VAL]', () => {
  const READS = 'plot(strategy.opentrades > 0 ? strategy.opentrades.entry_time(0) : na)\n'
    + 'plot(strategy.closedtrades > 0 ? strategy.closedtrades.entry_time(0) : na)\n'
    + 'plot(strategy.closedtrades > 0 ? strategy.closedtrades.exit_time(0) : na)\nplot(time)\n'
  const SRC = `${DECL()}${ENTER}${CLOSE3}${READS}`

  it('the three are per-trade reads of the one table (so the front end lowers them, and nothing else changed)', () => {
    for (const fn of ['strategy.opentrades.entry_time', 'strategy.closedtrades.entry_time', 'strategy.closedtrades.exit_time']) {
      expect(BROKER_OPS[fn]).toEqual({ params: ['trade_num'], returns: 'number' })
      expect(BROKER_TRADE_FNS).toContain(fn)
    }
  })

  it('daily bars: entry placed on bar 1 fills on bar 2, close placed on bar 3 fills on bar 4; each time is that bar\'s `time`', () => {
    const { cols } = served(SRC)
    const [openEntry, entry, exit, time] = cols
    expect(openEntry.slice(1, 5)).toEqual([NaN, at(2) * 1000, at(2) * 1000, NaN])
    expect(entry.slice(3, 6)).toEqual([NaN, at(2) * 1000, at(2) * 1000])
    expect(exit.slice(3, 6)).toEqual([NaN, at(4) * 1000, at(4) * 1000])
    // Pine's own `time` on the fill bars: the same number, the same unit
    expect(time[2]).toBe(openEntry[2])
    expect(time[4]).toBe(exit[4])
  })

  it('⛔ intraday bars (15 minutes): the time is the BAR\'s, not the day\'s (a daily witness cannot tell them apart)', () => {
    const M15 = 900
    const bars = base().map((b, i) => ({ ...b, t: T0 + i * M15 }))
    const { cols } = served(SRC, { bars })
    expect(cols[1][5]).toBe(at(2, M15) * 1000)
    expect(cols[2][5]).toBe(at(4, M15) * 1000)
    // bars 2 and 4 are the same UTC day, 30 minutes apart
    expect(cols[2][5] - cols[1][5]).toBe(2 * M15 * 1000)
    expect(Math.floor(at(2, M15) / DAY)).toBe(Math.floor(at(4, M15) / DAY))
  })

  it('an index outside the trades stops by name (Q-S1m), as every per-trade read does', () => {
    unsettled(`${DECL()}${ENTER}plot(strategy.closedtrades.entry_time(0))\n`, 'Q-S1m')
  })

  it('unpinned, the read stops naming B-VAL; the committed ledger pins B-VAL and the read runs', () => {
    unpinnedAt(SRC, 'B-VAL')
    // with the committed ledger (B-VAL pinned, with 14 fixtures) this read runs to completion
    const r = attempt(SRC, { pins: 'ledger' })
    expect(r.err, r.err && r.err.message).toBeUndefined()
    expect(r.res.broker.record.rulesUsed).toContain('B-VAL')
  })

  it('⛔ a run handed NO bar times refuses by name: a trade\'s time is never a bar index in disguise', () => {
    const O = [100, 100, 100]; const H = [101, 101, 101]; const L = [99, 99, 99]; const C = [100, 100, 100]
    const cfg = { version: 6, pyramiding: 1, defaultQty: 1, qtyType: 'fixed', qtyValue: 1, initialCapital: 1e6, marginLong: 0, marginShort: 0, defaulted: {} }
    const b = makeBroker(cfg, { series: [O, H, L, C], isPinned: ALL })
    b.call('#symbol', [0.01, 1], 0)
    b.call('strategy.entry', ['L', 1, 1], 0)
    while (b.beginBar(1)) { /* no extra executions */ }
    expect(b.call('strategy.opentrades.entry_bar_index', [0], 1)).toBe(1)
    let err
    try { b.call('strategy.opentrades.entry_time', [0], 1) } catch (e) { err = e }
    expect(err && err.guard).toBe('runtime:strategy-unsettled')
    expect(err.message).toMatch(/reads the time of a bar this run was given no time for/)
    // control: the same broker WITH its bar times answers
    const t = makeBroker(cfg, { series: [O, H, L, C], barTimes: [at(0), at(1), at(2)], isPinned: ALL })
    t.call('#symbol', [0.01, 1], 0)
    t.call('strategy.entry', ['L', 1, 1], 0)
    while (t.beginBar(1)) { /* no extra executions */ }
    expect(t.call('strategy.opentrades.entry_time', [0], 1)).toBe(at(1) * 1000)
  })
})

describe('[B-ROUND] a fill on a bar OPEN off the tick grid is that open rounded to the nearest tick, a tie up', () => {
  const READS = 'plot(strategy.position_avg_price)\nplot(strategy.closedtrades > 0 ? strategy.closedtrades.exit_price(0) : na)\nplot(strategy.netprofit)\n'
  const SRC = `${DECL()}${ENTER}${CLOSE3}${READS}`

  it('a market BUY on a tie (100.005) fills at 100.01; a market close on 103.504 (below a half tick) at 103.50; the values read those', () => {
    const bars = base([100.005, 101.5, 99.5, 101], [103.504, 105, 102.5, 104])
    const { cols, trades, used } = served(SRC, { bars })
    expect(trades[0].entry.price).toBe(100.01)
    expect(trades[0].exit.price).toBe(103.5)
    expect(trades[0].exact).toBe(true) // a rounded fill is ON the grid: nothing downstream refuses Q-S1l
    expect(cols[0][2]).toBe(100.01)
    expect(cols[1][4]).toBe(103.5)
    close9(cols[2][4], (103.5 - 100.01) * 2)
    expect(used).toContain('B-ROUND')
  })

  // ⭐⭐ (2026-11-20, Q-SU-8) the tie is the FLOAT's: 145.265 / 0.01 = 14526.499999999998 lands a hair under the half and
  // TradingView fills it at 145.26 (supertrend-strategy-deep-aapl-1d-2026-11-19, 2022-07-08); an exact x.5 quotient
  // (62.875 / 0.01 = 6287.5, and the 32 other ties of the committed captures) fills UP
  it('a tie whose float quotient sits under the half rounds DOWN (145.265 -> 145.26); an exact x.5 rounds UP (62.875 -> 62.88)', () => {
    const shift = (rows, d) => rows.map(([o, h, l, c]) => [o + d, h + d, l + d, c + d])
    const down = served(SRC, { bars: barsOf([[100, 101, 99, 100], [100, 101, 99, 100], ...shift([[100.265, 101.5, 99.5, 101]], 45),
      [146, 149, 145.5, 148.5], [148.5, 150, 147.5, 149], ...Array.from({ length: 5 }, () => [149, 150, 148.5, 149.5])]) })
    expect(145.265 / 0.01).toBeLessThan(14526.5)
    expect(down.trades[0].entry.price).toBe(145.26)
    const up = served(SRC, { bars: base([62.875, 63.5, 62.5, 63]) })
    expect(62.875 / 0.01).toBe(6287.5)
    expect(up.trades[0].entry.price).toBe(62.88)
  })

  it('above a half tick rounds UP (103.506 -> 103.51); a market SELL on a tie rounds UP too (it is rounding, not slippage)', () => {
    const up = served(SRC, { bars: base(null, [103.506, 105, 102.5, 104]) })
    expect(up.trades[0].exit.price).toBe(103.51)
    const short = served(`${DECL()}${ENTER_SHORT}plot(strategy.position_avg_price)\n`, { bars: base([100.005, 101.5, 99.5, 101]) })
    expect(short.trades[0].entry.price).toBe(100.01)
    expect(short.cols[0][2]).toBe(100.01)
  })

  it('a reversal and a strategy.order on an off-grid open fill at the one rounded price', () => {
    const rev = served(`${DECL()}${ENTER}if bar_index == 3\n    strategy.entry("S", strategy.short)\nplot(strategy.position_size)\n`,
      { bars: base(null, [103.505, 105, 102.5, 104]) })
    expect(rev.trades[0].exit.price).toBe(103.51)
    expect(rev.trades[1].entry.price).toBe(103.51)
    const ord = served(`${DECL()}if bar_index == 1\n    strategy.order("O", strategy.long, qty = 2)\nplot(strategy.position_avg_price)\n`,
      { bars: base([100.004, 101.5, 99.5, 101]) })
    expect(ord.trades[0].entry.price).toBe(100)
    expect(ord.used).toContain('B-ROUND')
  })

  it('a STOP-loss the open gapped through fills at the rounded open (the capture\'s three STOP fills)', () => {
    // long 2 @ 100 on bar 2 with a stop at 99.5 placed with it; bar 3 opens at 98.005, below the stop
    const src = `${DECL()}${ENTER}    strategy.exit("x", "L", stop = 99.4)\n${READS}`
    const bars = base(null, null, { b3: [98.005, 98.5, 97.5, 98], rest: [98, 98.5, 97.5, 98] })
    const { trades, used } = served(src, { bars: bars.map((b, i) => (i === 4 ? { ...b, o: 98, h: 98.5, l: 97.5, c: 98 } : b)) })
    expect(trades[0].exit).toEqual({ time: at(3), price: 98.01, rule: 'B-GAP' })
    expect(used).toContain('B-ROUND')
  })

  it('a STOP entry the open gapped through fills at the rounded open too (a stop order the open reached)', () => {
    // a buy stop at 101.2 placed on bar 1; bar 2 opens at 102.005, above it
    const src = `${DECL()}if bar_index == 1\n    strategy.entry("L", strategy.long, stop = 101.2)\nplot(strategy.position_avg_price)\n`
    const { trades, used } = served(src, { bars: base([102.005, 103, 101.5, 102.5]) })
    expect(trades[0].entry).toEqual({ time: at(2), price: 102.01, rule: 'B-GAP' })
    expect(used).toContain('B-ROUND')
  })

  it('⛔ unpinned, the run stops naming B-ROUND and its row (never the raw open, never a rounded one)', () => {
    const err = unpinnedAt(SRC, 'B-ROUND', { bars: base([100.005, 101.5, 99.5, 101]) })
    expect(err.message).toMatch(/capture row Q-S1l/)
  })

  it('CONTROL: on the grid the run never asks B-ROUND, and runs with it unpinned', () => {
    expect(served(SRC).used).not.toContain('B-ROUND')
    const r = attempt(SRC, { pins: except('B-ROUND') })
    expect(r.err, r.err && r.err.message).toBeUndefined()
    expect(r.trades[0].entry.price).toBe(100)
  })

  it('⛔ a LIMIT order the open gapped through at an off-grid open is NOT witnessed: refused by name (Q-S1l)', () => {
    // a take-profit (a limit) at 101 on a long; bar 3 opens at 102.005, above it
    const tp = unsettled(`${DECL()}${ENTER}    strategy.exit("x", "L", limit = 101.8)\nplot(strategy.position_size)\n`, 'Q-S1l',
      { bars: base(null, null, { b3: [102.005, 104, 101.9, 103.5] }) })
    expect(tp.message).toMatch(/the take-profit of exit `x` fills on a bar's open of 102\.005, off the tick grid/)
    // a limit ENTRY at 99 placed on bar 1; bar 2 opens at 98.005, below it
    const le = unsettled(`${DECL()}if bar_index == 1\n    strategy.entry("L", strategy.long, limit = 99)\nplot(strategy.position_size)\n`, 'Q-S1l',
      { bars: base([98.005, 99.5, 97.5, 98.5]) })
    expect(le.message).toMatch(/the limit entry `L` fills on a bar's open of 98\.005/)
    // controls: on the grid both fill, as before
    expect(served(`${DECL()}if bar_index == 1\n    strategy.entry("L", strategy.long, limit = 99)\nplot(strategy.position_size)\n`,
      { bars: base([98, 99.5, 97.5, 98.5]) }).trades[0].entry.price).toBe(98)
  })

  it('⛔ a LIMIT entry placed beyond the market, which fills on the next open ([B-IMMEDIATE]), is not witnessed off the grid either', () => {
    // a buy limit at 105 with the market at 100 fills on the next tick: bar 2's open, 100.005
    const src = `${DECL()}if bar_index == 1\n    strategy.entry("L", strategy.long, limit = 105)\nplot(strategy.position_size)\n`
    const err = unsettled(src, 'Q-S1l', { bars: base([100.005, 101.5, 99.5, 101]) })
    expect(err.message).toMatch(/the limit entry `L` fills on a bar's open of 100\.005/)
    // control: on the grid it fills at the open, as before
    expect(served(src).trades[0].entry.price).toBe(100)
  })

  it('⛔ a fill on the CLOSING tick (process_orders_on_close) at an off-grid close is not witnessed: refused by name (Q-S1l)', () => {
    const poc = `${DECL('process_orders_on_close = true')}${ENTER}plot(strategy.position_size)\n`
    const bars = base().map((b, i) => (i === 1 ? { ...b, c: 100.005 } : b))
    const err = unsettled(poc, 'Q-S1l', { bars })
    expect(err.message).toMatch(/fills on the bar's closing tick at 100\.005, off the tick grid/)
    // control: the on-grid close fills there
    expect(served(poc).trades[0].entry.price).toBe(100)
  })
})

describe('[B-ROUND-MARK] open trades are marked at the close rounded to the nearest tick, a tie up', () => {
  const SRC = `${DECL()}${ENTER}plot(strategy.openprofit)\nplot(strategy.equity)\n`
  // bar 3 closes at 103.505 (a tie): the mark is 103.51
  const BARS = base(null, null, { b3: [101, 104, 100.5, 103.505] })

  it('openprofit and equity read the ROUNDED close while a trade is open: 2 x (103.51 - 100)', () => {
    const { cols, used } = served(SRC, { bars: BARS })
    close9(cols[0][3], 2 * (103.51 - 100))
    close9(cols[1][3], 100000 + 2 * (103.51 - 100))
    // the raw close would have given 7.01: the two are a half tick x size apart
    expect(Math.abs(cols[0][3] - 2 * (103.505 - 100))).toBeGreaterThan(0.009)
    expect(used).toContain('B-ROUND-MARK')
    // the on-grid bar before it is marked at its own close
    close9(cols[0][2], 2 * (101 - 100))
  })

  it('⛔ unpinned, the read stops naming B-ROUND-MARK (its witness is the AMEX:SPY 15 capture, row W9-R1i)', () => {
    const err = unpinnedAt(SRC, 'B-ROUND-MARK', { bars: BARS })
    expect(err.message).toMatch(/capture row W9-R1i/)
  })

  it('CONTROL: FLAT on an off-grid close asks nothing (no trade is marked); on-grid closes ask nothing either', () => {
    const flat = `${DECL()}plot(strategy.openprofit)\nplot(strategy.equity)\nif bar_index == 7\n    strategy.entry("L", strategy.long)\n`
    const r = attempt(flat, { bars: BARS, pins: except('B-ROUND-MARK') })
    expect(r.err, r.err && r.err.message).toBeUndefined()
    expect(r.cols[1][3]).toBe(100000)
    expect(served(SRC).used).not.toContain('B-ROUND-MARK')
  })
})

describe('the exit texts the captures witness: strategy.closedtrades.exit_id / exit_comment', () => {
  const is = (fn, text) => `plot(strategy.closedtrades > 0 ? (strategy.closedtrades.${fn}(0) == "${text}" ? 1 : 0) : -1)\n`
  const READ_ID = (text) => is('exit_id', text)
  const READ_COMMENT = (text) => is('exit_comment', text)
  const yes = (cols) => expect(cols[0].slice(3, 7)).toEqual([-1, 1, 1, 1])

  it('[B-TXT-CLOSE-ID] strategy.close("L"): the exit id reads `Close entry(s) order L`', () => {
    const src = `${DECL()}${ENTER}${CLOSE3}${READ_ID('Close entry(s) order L')}`
    const { cols, used, rec } = served(src)
    yes(cols)
    expect(used).toContain('B-TXT-CLOSE-ID')
    expect(used).not.toContain('B-TXT-NO-COMMENT')
    expect(rec.trades[0].exitId).toBe(null) // the RECORD's exit id is unchanged: null where R6 states none
    unpinnedAt(src, 'B-TXT-CLOSE-ID')
    // ⛔ a wrong text is not what it reads
    expect(served(`${DECL()}${ENTER}${CLOSE3}${READ_ID('Close position order')}`).cols[0].slice(4, 6)).toEqual([0, 0])
  })

  it('[B-TXT-CLOSE-ALL-ID] strategy.close_all(): `Close position order`; with a comment the id is the same and the comment is the comment', () => {
    const src = `${DECL()}${ENTER}if bar_index == 3\n    strategy.close_all()\n${READ_ID('Close position order')}`
    const { cols, used } = served(src)
    yes(cols)
    expect(used).toContain('B-TXT-CLOSE-ALL-ID')
    unpinnedAt(src, 'B-TXT-CLOSE-ALL-ID')
    // w9-x5-cancel's label: `C>Close position order:flat`
    const flat = `${DECL()}${ENTER}if bar_index == 3\n    strategy.close_all(comment = "flat")\n`
    yes(served(`${flat}${READ_ID('Close position order')}`).cols)
    const c = served(`${flat}${READ_COMMENT('flat')}`)
    yes(c.cols)
    expect(c.used).not.toContain('B-TXT-NO-COMMENT') // a comment that IS there asks nothing new
  })

  it('[B-TXT-ENTRY-CLOSE-ID] a reversal by an entry placed WITHOUT a comment: the exit id is that entry\'s id', () => {
    const rev = `${DECL()}${ENTER}if bar_index == 3\n    strategy.entry("S", strategy.short)\n`
    const { cols, used } = served(`${rev}${READ_ID('S')}`)
    yes(cols)
    expect(used).toContain('B-TXT-ENTRY-CLOSE-ID')
    unpinnedAt(`${rev}${READ_ID('S')}`, 'B-TXT-ENTRY-CLOSE-ID')
    // and its exit comment reads the same id (`L1>S:S`), behind BOTH rules
    const c = served(`${rev}${READ_COMMENT('S')}`)
    yes(c.cols)
    expect(c.used).toEqual(expect.arrayContaining(['B-TXT-ENTRY-CLOSE-ID', 'B-TXT-NO-COMMENT']))
  })

  it('⛔ a reversing entry that CARRIES a comment is not witnessed: its exit id and exit comment stop by name (W9-V1)', () => {
    const rev = `${DECL()}${ENTER}if bar_index == 3\n    strategy.entry("S", strategy.short, comment = "flip")\n`
    expect(unsettled(`${rev}${READ_ID('S')}`, 'W9-V1').message).toMatch(/a reversing entry that carries a comment/)
    expect(unsettled(`${rev}${READ_COMMENT('flip')}`, 'W9-V1').message).toMatch(/reversing entry/)
  })

  it('[B-TXT-NO-COMMENT] an exit with no comment: the exit comment reads the exit id, whatever names it', () => {
    // an exit command (its id is R6's): `L>X:X`
    const x = `${DECL()}${ENTER}    strategy.exit("X", "L", profit = 300)\n${READ_COMMENT('X')}`
    const a = served(x)
    expect(a.cols[0].slice(2, 5)).toEqual([-1, 1, 1])
    expect(a.used).toContain('B-TXT-NO-COMMENT')
    expect(a.used).not.toContain('B-TXT-CLOSE-ID')
    unpinnedAt(x, 'B-TXT-NO-COMMENT')
    // strategy.order closing a trade (its id is R6's): `O1>O2:O2`
    const o = `${DECL()}${ENTER}if bar_index == 3\n    strategy.order("O2", strategy.short, qty = 2)\n${READ_COMMENT('O2')}`
    yes(served(o).cols)
    // strategy.close: the generated id, behind both rules
    const c = `${DECL()}${ENTER}${CLOSE3}${READ_COMMENT('Close entry(s) order L')}`
    const cc = served(c)
    yes(cc.cols)
    expect(cc.used).toEqual(expect.arrayContaining(['B-TXT-CLOSE-ID', 'B-TXT-NO-COMMENT']))
    unpinnedAt(c, 'B-TXT-NO-COMMENT')
  })

  it('⛔ NOT served: an ENTRY comment with no comment (the labels never read it) still stops by name (W9-V1)', () => {
    unsettled(`${DECL()}${ENTER}${CLOSE3}plot(strategy.closedtrades > 0 ? (strategy.closedtrades.entry_comment(0) == "L" ? 1 : 0) : -1)\n`, 'W9-V1')
  })

  it('`witnessedExitIdOf` answers only the witnessed rows; R6\'s own ids stay `exitIdOf`\'s', () => {
    const row = (over) => ({ kind: 'close', id: null, from: 'L', comment: null, commentRecorded: true, ...over })
    expect(witnessedExitIdOf(row())).toEqual({ text: 'Close entry(s) order L', rule: 'B-TXT-CLOSE-ID' })
    expect(witnessedExitIdOf(row({ kind: 'close_all', from: null }))).toEqual({ text: 'Close position order', rule: 'B-TXT-CLOSE-ALL-ID' })
    expect(witnessedExitIdOf(row({ kind: 'entry', id: 'S', from: null }))).toEqual({ text: 'S', rule: 'B-TXT-ENTRY-CLOSE-ID' })
    expect(witnessedExitIdOf(row({ kind: 'margin_call', from: null, comment: 'Margin call' }))).toEqual({ text: 'Close position order', rule: 'B-MARGIN-CALL' })
    // not witnessed: an entry with a comment, or one whose comment the script computes
    expect(witnessedExitIdOf(row({ kind: 'entry', id: 'S', comment: 'flip' }))).toBe(null)
    expect(witnessedExitIdOf(row({ kind: 'entry', id: 'S', commentRecorded: false }))).toBe(null)
    // an exit command and strategy.order are R6's (`exitIdOf`), never this function's
    for (const kind of ['exit', 'order']) {
      expect(witnessedExitIdOf(row({ kind, id: 'X' }))).toBe(null)
      expect(exitIdOf(row({ kind, id: 'X' }))).toBe('X')
    }
    expect(witnessedExitIdOf(null)).toBe(null)
    expect(exitIdOf(row())).toBe(null)
  })
})

describe('(W9-K1..K3) an open trade\'s paid entry fee: off strategy.netprofit at once, never in strategy.openprofit', () => {
  const PCT = 'commission_type = strategy.commission.percent, commission_value = 0.1'
  const SRC = `${DECL(PCT)}${ENTER}${CLOSE3}plot(strategy.netprofit)\nplot(strategy.openprofit)\nplot(strategy.equity)\nplot(strategy.netprofit_percent)\n`

  it('entry 2 @ 100 pays 0.2: on bars 2 and 3 netprofit is -0.2 and openprofit is the price move alone; equity is their sum', () => {
    const { cols } = served(SRC)
    const [net, open, equity, pct] = cols
    close9(net[1], 0); close9(net[2], -0.2); close9(net[3], -0.2)
    close9(open[2], 2 * (101 - 100)); close9(open[3], 2 * (103.5 - 100))
    close9(equity[2], 100000 - 0.2 + 2); close9(equity[3], 100000 - 0.2 + 7)
    close9(pct[2], -0.2 / 100000 * 100)
    // closed on bar 4 at 103.5: exit fee 0.207; net 7 - 0.407, and nothing open
    close9(net[4], 7 - 0.407); expect(open[4]).toBe(0); close9(equity[4], 100000 + 7 - 0.407)
  })

  it('⛔ strategy.grossprofit / grossloss while an open trade has paid a fee are not witnessed: refused by name (W9-K1); flat, served', () => {
    for (const v of ['grossprofit', 'grossloss']) {
      const err = unsettled(`${DECL(PCT)}${ENTER}${CLOSE3}plot(strategy.${v})\n`, 'W9-K1')
      expect(err.message).toMatch(new RegExp(`strategy\\.${v}\` is read while an open trade has paid its entry fee`))
    }
    const flat = served(`${DECL(PCT)}${ENTER}${CLOSE3}plot(strategy.opentrades == 0 ? strategy.grossprofit : na)\nplot(strategy.opentrades == 0 ? strategy.grossloss : na)\n`)
    close9(flat.cols[0][4], 7 - 0.407); expect(flat.cols[1][4]).toBe(0)
    // control: with NO commission the two are read on every bar, open trade or not
    expect(served(`${DECL()}${ENTER}${CLOSE3}plot(strategy.grossprofit)\nplot(strategy.grossloss)\n`).cols[0][4]).toBe(7)
  })

  it('the report: while an open trade has paid its fee, its money figures refuse by name (W9-S1); flat, they are the script\'s', () => {
    const openRun = served(`${DECL(PCT)}${ENTER}plot(strategy.netprofit)\n`)
    const open = strategyReportOf(openRun.rec, { isPinned: ALL })
    for (const k of ['netProfit', 'netProfitPercent', 'grossProfit', 'grossLoss', 'profitFactor', 'commissionPaid']) {
      expect([k, open.metrics[k].status, open.metrics[k].guard, open.metrics[k].row]).toEqual([k, 'refused', REPORT_UNSTATED_GUARD, 'W9-S1'])
    }
    expect(open.metrics.totalOpenTrades).toMatchObject({ status: 'served', value: 1 })
    const flatRun = served(SRC)
    const flat = strategyReportOf(flatRun.rec, { isPinned: ALL })
    expect(flat.metrics.netProfit.status).toBe('served')
    close9(flat.metrics.netProfit.value, flatRun.cols[0][9])
    // control: with no commission an open trade refuses nothing here
    const free = strategyReportOf(served(`${DECL()}${ENTER}plot(strategy.netprofit)\n`).rec, { isPinned: ALL })
    expect(free.metrics.netProfit).toMatchObject({ status: 'served', value: 0 })
  })
})

describe('ruling D12: a Pine v4 strategy that states no margin stops at bind, by name (the v4 default is not settled)', () => {
  const V4 = (decl) => `//@version=4\nstrategy("t"${decl})\nstrategy.entry("L", true, when = bar_index == 1)\nplot(strategy.position_size)\n`

  it('no margin stated: runtime:strategy-unsettled naming the v4 default and Q-S1b, before any rule is asked', () => {
    const r = attempt(V4(''))
    expect(r.err && r.err.guard).toBe('runtime:strategy-unsettled')
    expect(r.err.setting).toBe(V4_MARGIN_DEFAULT_SETTING)
    expect(r.err.message).toMatch(/Pine v4 strategy states no `margin_long` \/ `margin_short`/)
    expect(r.err.message).toContain('Q-S1b')
    // it is a refusal about a SETTING, raised before the first rule: nothing pinned or unpinned changes it
    const none = attempt(V4(''), { pins: () => false })
    expect(none.err.guard).toBe('runtime:strategy-unsettled')
    expect(none.err.setting).toBe(V4_MARGIN_DEFAULT_SETTING)
  })

  // ⭐⭐ RULING D12b (2026-11-17): EXACTLY the declaration shape both v4 captures have (a title and `overlay`, nothing
  // else) runs at the margin TradingView read back for it, 0, behind B-V4-MARGIN0. Every other shape still stops.
  it('D12b: `strategy("t", overlay = true)` (the witnessed shape, title by position) runs at margin 0 under B-V4-MARGIN0', () => {
    const V4OV = (decl) => `//@version=4\nstrategy("t", overlay = true${decl})\nstrategy.entry("L", true, when = bar_index == 1)\nplot(strategy.position_size)\n`
    const ok = served(V4OV(''))
    expect(ok.cols[0][2]).toBe(1)
    expect(ok.rec.rulesUsed).toContain('B-V4-MARGIN0')
    const un = attempt(V4OV(''), { pins: (id) => id !== 'B-V4-MARGIN0' })
    expect(un.err && un.err.rule).toBe('B-V4-MARGIN0')
    // one more argument is another shape: D12's bind refusal, unchanged (a `shorttitle` alone is the shape
    // w9-q-s1b-v4-shape-a settles since 2026-11-19, below)
    for (const extra of [', pyramiding = 1', ', initial_capital = 100000', ', shorttitle = "s", pyramiding = 1']) {
      expect(attempt(V4OV(extra)).err.setting, extra).toBe(V4_MARGIN_DEFAULT_SETTING)
    }
  })

  // ⭐⭐ D12b point 4 (2026-11-19, the strategy unit): two more shapes, each settled by its own committed report capture
  // reading back Margin Long 0 and Margin Short 0 and grading MATCH at it (`ast/strategyBroker.js` V4_MARGIN0_SHAPES)
  it('D12b point 4: the shapes of w9-q-s1b-v4-shape-a (+ shorttitle) and -b (+ commission, size, capital) run at margin 0', () => {
    const SH = (decl) => `//@version=4\nstrategy(${decl})\nstrategy.entry("L", true, when = bar_index == 1)\nplot(strategy.position_size)\n`
    for (const decl of ['title = "t", overlay = false, shorttitle = "s"', '"t", "s", overlay = true',
      'title = "t", overlay = false, commission_type = strategy.commission.cash_per_contract, commission_value = 0.00003, '
        + 'default_qty_value = 2, initial_capital = 1000']) {
      const ok = served(SH(decl))
      expect(ok.rec.rulesUsed, decl).toContain('B-V4-MARGIN0')
      expect(ok.cols[0][2], decl).toBeGreaterThan(0)
    }
    // the shape is the ARGUMENT SET: shape b without its capital is no witnessed shape
    expect(attempt(SH('title = "t", overlay = false, commission_type = strategy.commission.cash_per_contract, '
      + 'commission_value = 0.00003, default_qty_value = 2')).err.setting).toBe(V4_MARGIN_DEFAULT_SETTING)
  })

  it('RAIL: every witnessed v4 shape names captures `brokerPins.json` lists for B-V4-MARGIN0, and the ledger pins it', () => {
    const fixtures = new Set(BROKER_PINS.rules['B-V4-MARGIN0'])
    for (const [shape, ids] of Object.entries(V4_MARGIN0_SHAPES)) {
      expect(ids.length, shape).toBeGreaterThan(0)
      for (const id of ids) expect(fixtures.has(id), `${shape}: ${id}`).toBe(true)
    }
    expect([...fixtures].sort()).toEqual(Object.values(V4_MARGIN0_SHAPES).flat().sort())
    expect(pinned('B-V4-MARGIN0')).toBe(true)
  })

  it('ONE margin stated is still not both: it stops the same way', () => {
    expect(attempt(V4(', margin_long = 100')).err.setting).toBe(V4_MARGIN_DEFAULT_SETTING)
    expect(attempt(V4(', margin_short = 0')).err.setting).toBe(V4_MARGIN_DEFAULT_SETTING)
  })

  it('CONTROL: both stated (100 / 100, or 0 / 0) runs; v5 and v6 with none stated are untouched', () => {
    expect(served(V4(', margin_long = 100, margin_short = 100')).cols[0][2]).toBe(1)
    expect(served(V4(', margin_long = 0, margin_short = 0')).cols[0][2]).toBe(1)
    const v5 = '//@version=5\nstrategy("t")\nif bar_index == 1\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n'
    expect(served(v5).cols[0][2]).toBe(1)
    expect(served(`${DECL()}${ENTER}plot(strategy.position_size)\n`.replace(', margin_long = 0, margin_short = 0', '')).cols[0][2]).toBe(2)
  })

  it('every other refusal carries no `setting` (so only this one grades as an expected refusal)', () => {
    const e = attempt(`${DECL()}${ENTER}plot(strategy.closedtrades.entry_time(0))\n`).err
    expect(e.guard).toBe('runtime:strategy-unsettled')
    expect(e.setting).toBe(null)
  })
})

describe('ruling D11: the broker states the bar each rule was first asked on', () => {
  it('a rule asked at a fill carries that fill\'s bar; one asked at the first read carries bar 0; none is lost from rulesUsed', () => {
    const { res, used } = served(`${DECL()}${ENTER}${CLOSE3}plot(strategy.position_size)\n`)
    const first = res.broker.ruleFirstBars
    expect(Object.keys(first).sort()).toEqual(used)
    expect(first['B-VAL']).toBe(0) // the plot reads on the first bar
    expect(first['B-MARKET']).toBe(2) // the entry placed on bar 1 fills on bar 2
    expect(first['B-CLOSE']).toBe(3) // asked when the close is placed, on bar 3 (it fills on bar 4)
    expect(first['B-QTY']).toBe(1) // the default size is taken when the order is placed
  })
  it('a rule asked before the first bar (the run\'s execution model) carries -1', () => {
    const { res } = served(`${DECL('calc_on_every_tick = true')}${ENTER}plot(strategy.position_size)\n`)
    expect(res.broker.ruleFirstBars['B-TICK-HIST']).toBe(-1)
  })
})

describe('[B-CANCEL] W9-X5 (b): an exit waiting on a cancelled strategy.order binds the order placed again under its id', () => {
  // bar 1: a limit order far below the market, and its exit; bar 2: cancelled; bar 3: placed again at the market, the
  // exit NOT called again. Bar 4 opens 103.5 (the fill); its high 105 reaches the take-profit 150 ticks above.
  const HEAD = `${DECL()}if bar_index == 1\n    strategy.order("O", strategy.long, qty = 2, limit = 50)\n    strategy.exit("XO", "O", profit = 150, loss = 500, comment = "xo")\n`
    + 'if bar_index == 2\n    strategy.cancel("O")\n'
  const AGAIN = (call) => `${HEAD}if bar_index == 3\n    ${call}\nplot(strategy.position_size)\nplot(strategy.closedtrades)\n`

  it('the re-placed order fills at bar 4\'s open and the waiting exit takes its profit on that bar (the capture\'s first trade)', () => {
    const { trades, cols, used } = served(AGAIN('strategy.order("O", strategy.long, qty = 2)'))
    expect(trades).toHaveLength(1)
    expect(trades[0].entry).toEqual({ time: at(4), price: 103.5, rule: 'B-MARKET' })
    expect(trades[0].exit.time).toBe(at(4))
    expect(trades[0].exit.price).toBe(105)
    expect(cols[0].slice(3, 6)).toEqual([0, 0, 0]) // flat again by the close of the fill bar
    expect(cols[1][4]).toBe(1)
    expect(used).toContain('B-CANCEL')
  })

  it('⛔ unpinned, the cancel stops the run naming B-CANCEL (row W9-X5)', () => {
    const err = unpinnedAt(AGAIN('strategy.order("O", strategy.long, qty = 2)'), 'B-CANCEL')
    expect(err.message).toMatch(/capture row W9-X5/)
  })

  it('CONTROL: without the cancel-and-replace nothing waits: an order under ANOTHER id is not bound', () => {
    const { trades } = served(AGAIN('strategy.order("P", strategy.long, qty = 2)'))
    expect(trades).toHaveLength(1)
    expect(trades[0].exit).toBeUndefined() // still open: no exit was ever bound to P
  })

  it('⛔ only the witnessed kind: a cancelled strategy.ENTRY releases its exit, whatever is placed again under its id', () => {
    const head = `${DECL()}if bar_index == 1\n    strategy.entry("O", strategy.long, limit = 50)\n    strategy.exit("XO", "O", profit = 150, loss = 500)\n`
      + 'if bar_index == 2\n    strategy.cancel("O")\nif bar_index == 3\n    '
    for (const again of ['strategy.entry("O", strategy.long)', 'strategy.order("O", strategy.long, qty = 2)']) {
      const { trades } = served(`${head}${again}\nplot(strategy.position_size)\n`)
      expect(trades, again).toHaveLength(1)
      expect(trades[0].exit, again).toBeUndefined() // no capture shows an exit kept across a cancelled ENTRY
    }
  })

  it('⛔ and a cancelled strategy.order placed again as a strategy.ENTRY is not bound either (the witness is order to order)', () => {
    const { trades } = served(AGAIN('strategy.entry("O", strategy.long)'))
    expect(trades).toHaveLength(1)
    expect(trades[0].exit).toBeUndefined()
  })
})
