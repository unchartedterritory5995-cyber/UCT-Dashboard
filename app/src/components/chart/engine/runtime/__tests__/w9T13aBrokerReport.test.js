// app/src/components/chart/engine/runtime/__tests__/w9T13aBrokerReport.test.js
//
// W9-T13a rails: `brokerReport.js`, the strategy report's metrics from the run's record.
//   - SERVED: each served metric against a HAND-COMPUTED fixture record (the numbers in the
//     comments are worked by hand, never read back from the module), with the edge cases the
//     design names: zero trades, all losers, an open trade at the end, fewer than 5 closed
//     trades (D10 is NOT applied to our counts), a point value other than 1, an off-grid fill.
//   - REFUSED BY NAME (D8): every Strategy Tester figure we cannot define exactly names its
//     guard and a member sentence; the harness's report slots are all accounted for.
//   - PIN BEFORE SERVE (D1): a metric resting on an unpinned rule inherits
//     `runtime:strategy-unpinned`, naming the rule and its capture row.
//   - D2: the start sentence, exactly, on every record, from the listing too (W9-T13b r1).
//
// ⛔ PINS: tests pass `isPinned` (a predicate). The committed ledger is read once, unmocked,
// to show the product default refuses what it does not pin.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  strategyReportOf, SERVED_METRICS, REFUSED_METRICS, STRATEGY_REPORT_SCHEMA, startSentenceOf,
  REPORT_UNSTATED_GUARD, REPORT_UNRECORDED_GUARD, REPORT_UNDEFINED_GUARD, REPORT_RECORD_GUARD,
} from '../brokerReport.js'
import { strategyRecordOf, strategyRecordShapeErrors } from '../strategyRecord.js'
import { orderLogFor } from './orderLogFixture.js'
import { UNPINNED_GUARD, BROKER_RULE_IDS, COMMISSION_RULE, COMMISSION_NET_VALUES } from '../brokerRules.js'
import { BROKER_UNSETTLED_GUARD, BROKER_OPS, makeBroker } from '../broker.js'
import { pinned } from '../brokerPins.js'

const ALL = () => true
const except = (...ids) => (id) => !ids.includes(id)
const T0 = 1711027800 // 2024-03-21 13:30 UTC
const DAY = 86400
const at = (i) => T0 + i * DAY
const BAR_TIMES = Array.from({ length: 40 }, (_, i) => at(i))

/** a broker trade record (`broker.js::tradeRecord`): exit omitted = open */
const tr = (id, dir, qty, e, x, exact = true) => ({
  id, dir: dir === 'long' ? 1 : -1, qty, exact,
  entry: { time: at(e[0]), price: e[1], rule: 'B-MARKET' },
  ...(x ? { exit: { time: at(x[0]), price: x[1], rule: 'B-CLOSE' } } : {}),
})
const recordOf = (trades, { pointvalue = 1, mintick = 0.01, initialCapital = 100000, fromListing = false,
  rulesUsed = ['B-MARKET', 'B-CLOSE'], defaulted = {} } = {}) => strategyRecordOf({
  summary: { record: { trades, orders: orderLogFor(trades), rulesUsed, symbol: { mintick, pointvalue } } },
  decl: { version: 5, initialCapital, defaultQty: 1, pyramiding: 1, fromListing, defaulted },
  barTimes: BAR_TIMES, historyWindowBars: 5000, confirmed: true,
})
const vals = (rep, keys) => Object.fromEntries(keys.map((k) => [k, rep.metrics[k].status === 'served' ? rep.metrics[k].value : rep.metrics[k].guard]))
const SERVED_KEYS = Object.keys(SERVED_METRICS)

// ─── FIXTURE A: mixed, 4 closed + 1 open, pointvalue 1 ─────────────────────────
//  1 long  2 @ 10 -> 13   = +6
//  2 short 1 @ 20 -> 25   = -5
//  3 long  3 @ 5  -> 5    =  0  (break-even)
//  4 long  1 @ 50 -> 54   = +4
//  5 long  1 @ 30, open
//  net 5 · gross profit 10 · gross loss 5 · PF 2 · win 2 / loss 1 / even 1 · 5/100000*100 = 0.005 %
const A = recordOf([
  tr('L1', 'long', 2, [1, 10], [3, 13]),
  tr('S1', 'short', 1, [4, 20], [6, 25]),
  tr('L2', 'long', 3, [7, 5], [9, 5]),
  tr('L3', 'long', 1, [10, 50], [12, 54]),
  tr('L4', 'long', 1, [13, 30], null),
])

describe('W9-T13a served metrics, hand-computed', () => {
  it('the fixture is a v1 record, and the record now carries the symbol and each trade\'s exactness', () => {
    expect(strategyRecordShapeErrors(A)).toEqual([])
    expect(A.symbol).toEqual({ mintick: 0.01, pointvalue: 1 })
    expect(A.trades.map((t) => t.exact)).toEqual([true, true, true, true, true])
  })

  it('fixture A: every served metric, and the trade list in full (open trade at the end)', () => {
    const rep = strategyReportOf(A, { isPinned: ALL })
    expect(rep.schema).toBe(STRATEGY_REPORT_SCHEMA)
    expect(rep.status).toBe('ok')
    expect(vals(rep, SERVED_KEYS)).toEqual({
      totalClosedTrades: 4, totalOpenTrades: 1,
      numberWinningTrades: 2, numberLosingTrades: 1, numberEvenTrades: 1,
      netProfit: 5, netProfitPercent: 0.005, grossProfit: 10, grossLoss: 5, profitFactor: 2,
      // W9-T5: no commission declared, so the closed trades paid 0 (resting on B-DEFAULTS)
      commissionPaid: 0,
    })
    for (const k of SERVED_KEYS) {
      expect(rep.metrics[k].source).toMatch(k === 'commissionPaid' ? /strategy\.closedtrades\.commission/ : /strategy-broker-spec\.md B-VAL/)
      expect(rep.metrics[k].pine).toBe(SERVED_METRICS[k].pine)
    }
    expect(rep.trades.status).toBe('served')
    expect(rep.trades.rows.map((r) => [r.n, r.entryId, r.dir, r.open, r.profit.status === 'served' ? r.profit.value : r.profit.guard]))
      .toEqual([[1, 'L1', 'long', false, 6], [2, 'S1', 'short', false, -5], [3, 'L2', 'long', false, 0],
        [4, 'L3', 'long', false, 4], [5, 'L4', 'long', true, REPORT_UNRECORDED_GUARD]])
    // never a trade missing: one row per record trade
    expect(rep.trades.rows.length).toBe(A.trades.length)
    expect(rep.trades.rows[4].profit.sentence).toMatch(/^This open trade's profit is not shown/)
  })

  it('D10 is not applied to our counts: 4 closed trades (< 5) is reported in full, nothing graded or withheld', () => {
    const rep = strategyReportOf(A, { isPinned: ALL })
    expect(rep.metrics.totalClosedTrades.value).toBe(4)
    expect(Object.values(rep.metrics).filter((m) => m.status === 'refused').map((m) => m.guard))
      .not.toContain(expect.stringMatching(/floor|grad/))
    expect(JSON.stringify(rep)).not.toMatch(/grad/i)
  })

  it('point value 50 (a future): currency values are price x size x pointvalue; counts do not move', () => {
    // long 2 @ 100.25 -> 101.5 = 2.5 points x 50 = 125 · net% 125 / 100000 * 100 = 0.125
    const rep = strategyReportOf(recordOf([tr('F', 'long', 2, [1, 100.25], [2, 101.5])], { pointvalue: 50 }), { isPinned: ALL })
    expect(vals(rep, ['netProfit', 'grossProfit', 'grossLoss', 'netProfitPercent', 'numberWinningTrades']))
      .toEqual({ netProfit: 125, grossProfit: 125, grossLoss: 0, netProfitPercent: 0.125, numberWinningTrades: 1 })
    expect(rep.trades.rows[0].profit.value).toBe(125)
  })

  it('all losers: net -5, gross profit 0, gross loss 5, profit factor 0 (served, 0 / 5 is defined)', () => {
    // long 1 @ 10 -> 7 = -3 · short 2 @ 4 -> 5 = -2
    const rep = strategyReportOf(recordOf([tr('a', 'long', 1, [1, 10], [2, 7]), tr('b', 'short', 2, [3, 4], [4, 5])]), { isPinned: ALL })
    expect(vals(rep, SERVED_KEYS)).toEqual({
      totalClosedTrades: 2, totalOpenTrades: 0, numberWinningTrades: 0, numberLosingTrades: 2, numberEvenTrades: 0,
      netProfit: -5, netProfitPercent: -0.005, grossProfit: 0, grossLoss: 5, profitFactor: 0, commissionPaid: 0,
    })
  })

  it('zero trades: counts 0, sums 0, profit factor REFUSED (no gross loss to divide by), an empty list', () => {
    const rep = strategyReportOf(recordOf([]), { isPinned: ALL })
    expect(vals(rep, SERVED_KEYS)).toEqual({
      totalClosedTrades: 0, totalOpenTrades: 0, numberWinningTrades: 0, numberLosingTrades: 0, numberEvenTrades: 0,
      netProfit: 0, netProfitPercent: 0, grossProfit: 0, grossLoss: 0, profitFactor: REPORT_UNDEFINED_GUARD, commissionPaid: 0,
    })
    expect(rep.metrics.profitFactor.sentence).toBe('Profit factor is not shown: it is gross profit divided by gross loss, and this backtest has no gross loss to divide by.')
    expect(rep.trades).toEqual({ status: 'served', rows: [] })
  })

  it('only an open trade: nothing closed, one open, its profit refused by name, never dropped', () => {
    const rep = strategyReportOf(recordOf([tr('o', 'long', 1, [1, 10], null)]), { isPinned: ALL })
    expect(vals(rep, ['totalClosedTrades', 'totalOpenTrades', 'netProfit'])).toEqual({ totalClosedTrades: 0, totalOpenTrades: 1, netProfit: 0 })
    expect(rep.trades.rows).toHaveLength(1)
    expect(rep.trades.rows[0].profit.guard).toBe(REPORT_UNRECORDED_GUARD)
  })
})

describe('W9-T13a off-grid fills (Q-S1l): refused exactly where the broker refuses', () => {
  it('an off-grid trade far from zero: its sign is served, every currency value refuses unsettled', () => {
    // long 1 @ 10.004 -> 12, off grid; |profit| 1.996 > 1 x 0.01, so it is a win whatever the rounding
    const rep = strategyReportOf(recordOf([tr('x', 'long', 1, [1, 10.004], [2, 12], false)]), { isPinned: ALL })
    expect(rep.metrics.numberWinningTrades).toMatchObject({ status: 'served', value: 1 })
    for (const k of ['netProfit', 'grossProfit', 'grossLoss', 'netProfitPercent', 'profitFactor']) {
      expect(rep.metrics[k]).toMatchObject({ status: 'refused', guard: BROKER_UNSETTLED_GUARD, row: 'Q-S1l' })
    }
    expect(rep.trades.rows[0].profit).toMatchObject({ guard: BROKER_UNSETTLED_GUARD, row: 'Q-S1l' })
  })

  it('an off-grid trade within one tick of zero: the win/loss/even counts refuse, the trade counts serve', () => {
    // long 2 @ 10.004 -> 10.01 = 0.012 <= 2 x 0.01
    const rep = strategyReportOf(recordOf([tr('x', 'long', 2, [1, 10.004], [2, 10.01], false)]), { isPinned: ALL })
    for (const k of ['numberWinningTrades', 'numberLosingTrades', 'numberEvenTrades']) {
      expect(rep.metrics[k]).toMatchObject({ status: 'refused', guard: BROKER_UNSETTLED_GUARD, row: 'Q-S1l' })
    }
    expect(rep.metrics.totalClosedTrades).toMatchObject({ status: 'served', value: 1 })
  })

  it('an unknown point value refuses the currency values by name, never as 1', () => {
    const rep = strategyReportOf(recordOf([tr('a', 'long', 1, [1, 10], [2, 12])], { pointvalue: null }), { isPinned: ALL })
    expect(rep.metrics.netProfit).toMatchObject({ status: 'refused', guard: REPORT_UNRECORDED_GUARD })
    expect(rep.metrics.netProfit.sentence).toMatch(/point value/)
    expect(rep.metrics.numberWinningTrades.value).toBe(1)
  })
})

describe('W9-T13a pin before serve (D1)', () => {
  it('B-VAL unpinned: every served metric refuses runtime:strategy-unpinned, naming B-VAL and Q-S1-core', () => {
    const rep = strategyReportOf(A, { isPinned: except('B-VAL') })
    for (const k of SERVED_KEYS) {
      expect(rep.metrics[k]).toMatchObject({ status: 'refused', guard: UNPINNED_GUARD, rule: 'B-VAL', row: 'Q-S1-core' })
    }
    // W9-T13b r2 plain words: the rule and row are FIELDS (above); the sentence names neither
    expect(rep.metrics.netProfit.sentence).toBe('Net profit is not shown: it depends on a rule of how TradingView runs a '
      + 'backtest that has not yet been checked against TradingView.')
    // the list's fills rest on the fill rules only, so it serves; its profits rest on B-VAL too
    expect(rep.trades.status).toBe('served')
    expect(rep.trades.rows[0].profit).toMatchObject({ guard: UNPINNED_GUARD, rule: 'B-VAL' })
  })

  it('B-DEFAULTS unpinned (the commission is 0 only by the default): trade counts serve; signs and currency values refuse naming Q-S1b', () => {
    const rep = strategyReportOf(A, { isPinned: except('B-DEFAULTS') })
    expect(rep.metrics.totalClosedTrades.status).toBe('served')
    expect(rep.metrics.totalOpenTrades.status).toBe('served')
    // review N1: a commission can flip a break-even or small win, so the sign rests on B-DEFAULTS too
    for (const k of ['numberWinningTrades', 'numberLosingTrades', 'numberEvenTrades',
      'netProfit', 'netProfitPercent', 'grossProfit', 'grossLoss', 'profitFactor']) {
      expect(rep.metrics[k]).toMatchObject({ guard: UNPINNED_GUARD, rule: 'B-DEFAULTS', row: 'Q-S1b' })
    }
  })

  // r3: every broker value net of commission asks COMMISSION_RULE (B-DEFAULTS); the list is TYPED here,
  // not read from COMMISSION_NET_VALUES, so dropping a figure from the shared list goes red
  const NET_FIGURES = ['strategy.wintrades', 'strategy.losstrades', 'strategy.eventrades', 'strategy.netprofit',
    'strategy.netprofit_percent', 'strategy.grossprofit', 'strategy.grossloss', 'strategy.openprofit',
    'strategy.equity', 'strategy.closedtrades.profit',
    // W9-T5: the fee itself rests on the commission's rules too
    'strategy.closedtrades.commission', 'strategy.opentrades.commission']
  const TRADE_FN = (fn) => fn.includes('trades.')
  const NOT_NET = ['strategy.closedtrades', 'strategy.opentrades', 'strategy.position_size', 'strategy.initial_capital']
  const brokerWith = (isPinned) => {
    const b = makeBroker({ pyramiding: 1, defaultQty: 1, initialCapital: 100000, marginLong: 0, marginShort: 0, defaulted: {} },
      { series: [[1], [1], [1], [1]], barTimes: [T0], isPinned })
    b.call('#symbol', [0.01, 1], 0)
    return b
  }
  const callOf = (b, fn) => { try { return { v: b.call(fn, TRADE_FN(fn) ? [0] : [], 0) } } catch (e) { return { e } } }

  for (const fn of NET_FIGURES) {
    it(`r3 broker: ${fn} is net of commission, so it asks B-DEFAULTS (refused unpinned without it)`, () => {
      const { e } = callOf(brokerWith(except('B-DEFAULTS')), fn)
      expect(e && e.guard).toBe(UNPINNED_GUARD)
      expect(e.rule).toBe('B-DEFAULTS')
    })
  }
  it('r3 broker: the values that read no profit do not ask B-DEFAULTS; with it pinned the net figures serve', () => {
    const b = brokerWith(except('B-DEFAULTS'))
    for (const fn of NOT_NET) expect(callOf(b, fn).e).toBeUndefined()
    const all = brokerWith(ALL)
    for (const fn of NET_FIGURES.filter((f) => !TRADE_FN(f))) expect(callOf(all, fn).e).toBeUndefined()
  })
  it('r3 ONE AUTHORITY: the shared list names real broker values, and every non-count report metric is one of them', () => {
    for (const fn of COMMISSION_NET_VALUES) expect(Object.keys(BROKER_OPS)).toContain(fn)
    expect([...COMMISSION_NET_VALUES].sort()).toEqual([...NET_FIGURES].sort())
    expect(COMMISSION_RULE).toBe('B-DEFAULTS')
    for (const m of Object.values(SERVED_METRICS)) {
      if (m.kind !== 'count' && m.pine) expect(COMMISSION_NET_VALUES).toContain(m.pine)
    }
  })

  it('a fill rule the run used is unpinned: every metric and the whole list refuse (never a partial list)', () => {
    const rep = strategyReportOf(A, { isPinned: except('B-CLOSE') })
    for (const k of SERVED_KEYS) expect(rep.metrics[k]).toMatchObject({ guard: UNPINNED_GUARD, rule: 'B-CLOSE' })
    expect(rep.trades).toMatchObject({ status: 'refused', guard: UNPINNED_GUARD, rule: 'B-CLOSE', row: 'Q-S1-core' })
    expect(rep.trades.rows).toBeUndefined()
  })

  it('several unpinned: the FIRST in sorted order is named, all are listed', () => {
    const rep = strategyReportOf(A, { isPinned: except('B-VAL', 'B-CLOSE', 'B-DEFAULTS') })
    expect(rep.metrics.netProfit).toMatchObject({ rule: 'B-CLOSE', rules: ['B-CLOSE', 'B-DEFAULTS', 'B-VAL'] })
  })

  it('the product default asks the COMMITTED ledger: a metric serves only if every rule it rests on is pinned there', () => {
    const rep = strategyReportOf(A)
    const needs = ['B-CLOSE', 'B-DEFAULTS', 'B-MARKET', 'B-VAL']
    const missing = needs.filter((id) => !pinned(id))
    if (missing.length) expect(rep.metrics.netProfit).toMatchObject({ guard: UNPINNED_GUARD, rule: missing[0] })
    else expect(rep.metrics.netProfit.status).toBe('served')
  })
})

describe('W9-T13a refused by name (D8)', () => {
  it('every refused metric carries its guard and a member sentence naming it, and is refused on every run', () => {
    const rep = strategyReportOf(A, { isPinned: ALL })
    for (const [k, r] of Object.entries(REFUSED_METRICS)) {
      expect(rep.metrics[k].status).toBe('refused')
      expect(rep.metrics[k].guard).toBe(r.guard)
      expect([REPORT_UNSTATED_GUARD, REPORT_UNRECORDED_GUARD]).toContain(r.guard)
      expect(rep.metrics[k].sentence).toMatch(/ is not shown: /)
      if (r.guard === REPORT_UNSTATED_GUARD) expect(rep.metrics[k].sentence).toMatch(/has not yet been checked against TradingView\.$/)
    }
    expect(rep.metrics.maxDrawdown.sentence).toBe("Max drawdown is not shown: we do not yet know exactly how TradingView's "
      + 'Strategy Tester computes it, and it has not yet been checked against TradingView.')
    expect(rep.metrics.sharpeRatio.row).toBe('W9-S2')
    // W9-T5 served it (the closed trades' fees; w9T5Costs.test.js has the non-zero cases)
    expect(rep.metrics.commissionPaid).toMatchObject({ status: 'served', value: 0 })
  })

  it('the served and refused sets are disjoint and cover every report slot the capture harness reads', () => {
    const slots = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../../tools/vendor_harness/strategy_report_slots.json'), 'utf8')).slots
    const served = new Set(Object.keys(SERVED_METRICS))
    const refused = new Set(Object.keys(REFUSED_METRICS))
    expect([...served].filter((k) => refused.has(k))).toEqual([])
    expect(Object.keys(slots).filter((k) => !served.has(k) && !refused.has(k))).toEqual([])
  })

  it('a served metric is only a B-VAL value, the manual\'s profit factor, or (W9-T5) the reference\'s trade fees', () => {
    for (const m of Object.values(SERVED_METRICS)) expect(m.source).toMatch(/B-VAL|`strategy\.closedtrades\.commission`/)
    expect(BROKER_RULE_IDS).toContain('B-VAL')
  })
})

describe('W9-T13a window and run-wide refusals', () => {
  it('D2: a window that does not reach the listing carries the exact sentence with its start date', () => {
    const rep = strategyReportOf(A, { isPinned: ALL })
    expect(rep.window.sentence).toBe('this backtest starts on 2024-03-21 (UTC); TradingView may start elsewhere')
    expect(rep.window.sentence).toBe(startSentenceOf(T0))
    expect(rep.window.sentence).toBe(A.window.startSentence)
    expect(rep.window).toMatchObject({ startTime: T0, startDate: '2024-03-21', fromListing: false, asOfBar: at(39), asOfDate: '2024-04-29' })
  })

  it('D2 ALWAYS (W9-T13b r1): a window from the listing carries the same sentence (the plan bar limit can move TradingView start)', () => {
    const rec = recordOf([], { fromListing: true })
    const rep = strategyReportOf(rec, { isPinned: ALL })
    expect(rep.window).toMatchObject({ fromListing: true, sentence: 'this backtest starts on 2024-03-21 (UTC); TradingView may start elsewhere' })
    expect(rec.window.startSentence).toBe(startSentenceOf(T0))
    // a from-listing record WITHOUT the sentence is not a v1 record
    const bare = { ...rec, window: { ...rec.window, startSentence: null } }
    expect(strategyReportOf(bare, { isPinned: ALL }).refusals[0].fields).toContain('window.startSentence')
  })

  it('D2 ONE AUTHORITY: the report READS the record sentence, never recomputes it', () => {
    const rec = { ...A, window: { ...A.window } }
    // a record carrying a sentence other than the rule's is not a v1 record (the shape check owns the rule)
    rec.window.startSentence = 'this backtest starts on 1999-01-01 (UTC); TradingView may start elsewhere'
    expect(strategyReportOf(rec, { isPinned: ALL }).refusals[0].fields).toContain('window.startSentence')
  })

  it('D2 FIXTURE: a non-US daily session (ASX, 10:00 AEDT = 23:00 UTC the day BEFORE) — record and report say the same sentence, and the route reads this file', () => {
    // ASX session 2024-03-21 opens 10:00 AEDT = 2024-03-20T23:00:00Z; NYSE 2024-01-02 opens 09:30 ET = 14:30Z
    const cases = [
      { name: 'ASX 2024-03-21 session, 10:00 AEDT', startTime: Date.UTC(2024, 2, 20, 23, 0) / 1000 },
      { name: 'NYSE 2024-01-02 session, 09:30 ET', startTime: Date.UTC(2024, 0, 2, 14, 30) / 1000 },
      // review N3: 00:00-05:59 UTC is the PREVIOUS day in every US zone, so a host-local date is told apart
      { name: 'TSE 2024-03-21 session, 09:00 JST', startTime: Date.UTC(2024, 2, 21, 0, 0) / 1000 },
      // W9-T13b r1, D2 ALWAYS: a run from the listing states the same sentence
      { name: 'NYSE 2024-01-02 session, 09:30 ET, from the listing', startTime: Date.UTC(2024, 0, 2, 14, 30) / 1000, fromListing: true },
    ].map((c) => {
      const rec = strategyRecordOf({ summary: { record: { trades: [], orders: [], rulesUsed: [] } },
        decl: { version: 5, fromListing: c.fromListing === true }, barTimes: [c.startTime, c.startTime + DAY],
        historyWindowBars: 5000, confirmed: true })
      const rep = strategyReportOf(rec, { isPinned: ALL })
      expect(rep.window.sentence).toBe(rec.window.startSentence)
      expect(rep.window.startDate).toBe(rec.window.startDate)
      return { ...c, fromListing: rec.window.fromListing, startDate: rec.window.startDate, recordSentence: rec.window.startSentence, reportSentence: rep.window.sentence }
    })
    expect(cases[0].reportSentence).toBe('this backtest starts on 2024-03-20 (UTC); TradingView may start elsewhere')
    expect(cases[2].startDate).toBe('2024-03-21')
    expect(cases[3]).toMatchObject({ fromListing: true, reportSentence: cases[1].reportSentence })
    const text = `${JSON.stringify({ why: 'W9-T13a r1, ruling D2: written by w9T13aBrokerReport.test.js from strategyRecord.js; read by tests/test_pine_strategy_backtest.py', cases }, null, 1)}
`
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../../tests/fixtures/pine_runtime/w9t13a_start_sentence.json')
    if (globalThis.process && globalThis.process.env.W9T13A_WRITE_FIXTURE === '1') fs.writeFileSync(file, text)
    expect(fs.readFileSync(file, 'utf8')).toBe(text)
  })

  it('a record with a run-wide refusal: the report holds only the refusal', () => {
    const rec = { ...A, refusals: [{ rule: 'B-PATH', guard: UNPINNED_GUARD, time: at(5), sentence: 'stopped' }] }
    const rep = strategyReportOf(rec, { isPinned: ALL })
    expect(rep).toMatchObject({ status: 'refused', metrics: null, trades: null, refusals: rec.refusals })
    expect(rep.window.sentence).toMatch(/^this backtest starts on /)
  })

  it('not a v1 record: refused by name, nothing computed', () => {
    const rep = strategyReportOf({ schema: 'nope' }, { isPinned: ALL })
    expect(rep).toMatchObject({ status: 'refused', metrics: null, trades: null })
    expect(rep.refusals[0].guard).toBe(REPORT_RECORD_GUARD)
    const noExact = { ...A, trades: A.trades.map((t) => ({ ...t, exact: undefined })) }
    const bad = strategyReportOf(noExact, { isPinned: ALL }).refusals[0]
    expect(bad.fields).toContain('trades[0].exact')
    expect(bad.sentence).toBe('the backtest record is incomplete or in a form this report cannot read, so there is no report.')
  })
})

// ─── W9-T13b r2: PLAIN WORDS. No member sentence names a rule id, a capture row, a field path
// or a guard id; the engineer's detail rides the refusal's own fields (`rule`, `row`, `fields`).
const ENGINEER_WORDS = [/\bB-[A-Z]+\b/, /\bQ-S1/, /\bW9-[A-Z0-9]+/, /capture row/,
  /\b[a-z][a-zA-Z_]*\.[a-zA-Z_]+/, /\[\d+\]/, /runtime:|pine:/]
const memberTexts = (rep) => [
  ...Object.values(rep.metrics || {}).map((m) => m.sentence).filter(Boolean),
  ...((rep.trades && rep.trades.rows) || []).map((r) => r.profit && r.profit.sentence).filter(Boolean),
  ...(rep.trades && rep.trades.sentence ? [rep.trades.sentence] : []),
  ...(rep.refusals || []).map((r) => r.sentence),
]
describe('W9-T13b r2 plain words in every member sentence the report writes', () => {
  const OFF = recordOf([tr('L1', 'long', 1, [1, 10], [3, 10.004], false)])
  const reports = {
    allPinned: strategyReportOf(A, { isPinned: ALL }),
    unpinnedVal: strategyReportOf(A, { isPinned: except('B-VAL') }),
    unpinnedFill: strategyReportOf(A, { isPinned: except('B-CLOSE') }),
    unpinnedDefaults: strategyReportOf(A, { isPinned: except('B-DEFAULTS') }),
    offGrid: strategyReportOf(OFF, { isPinned: ALL }),
    badRecord: strategyReportOf({ schema: 'nope' }, { isPinned: ALL }),
    productDefault: strategyReportOf(A),
  }
  for (const [name, rep] of Object.entries(reports)) {
    it(`${name}: no rule id, capture row, field path or guard id`, () => {
      const texts = memberTexts(rep)
      expect(texts.length).toBeGreaterThan(0)
      for (const t of texts) for (const re of ENGINEER_WORDS) expect(t, `${re} in: ${t}`).not.toMatch(re)
    })
  }
  it('the exact sentences', () => {
    expect(reports.offGrid.metrics.netProfit.sentence).toBe("Net profit is not shown: a trade filled at a price between the "
      + "symbol's price steps, and how TradingView treats such a fill has not yet been checked.")
    expect(reports.unpinnedFill.trades.sentence).toBe('The list of trades is not shown: it depends on a rule of how '
      + 'TradingView runs a backtest that has not yet been checked against TradingView.')
    // the engineer's detail is still there, as fields
    expect(reports.unpinnedVal.metrics.netProfit).toMatchObject({ rule: 'B-VAL', row: 'Q-S1-core' })
    expect(reports.offGrid.metrics.netProfit.row).toBe('Q-S1l')
  })
  it('CONTROL: the rail can fail (the T13a r0 wording is caught)', () => {
    const r0 = ['Net profit is not shown: it rests on the broker rule B-VAL, which no matching TradingView capture pins yet (capture row Q-S1-core).',
      'the backtest record is not one this report reads (window.startSentence), so there is no report.',
      'the backtest record is not one this report reads (trades[0].exact), so there is no report.']
    for (const t of r0) expect(ENGINEER_WORDS.some((re) => re.test(t)), t).toBe(true)
  })
})
