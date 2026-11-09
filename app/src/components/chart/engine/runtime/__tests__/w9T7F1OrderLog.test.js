// W9-T7-F1 rails: the broker's ORDER LOG (`broker.js`, "THE ORDER LOG"), the record's `orders` and
// `trades.exitId` built from it (`strategyRecord.js`), and the TEXT values read off it
// (`strategy.opentrades.entry_id` / `entry_comment`, `strategy.closedtrades.entry_id` / `exit_id` /
// `entry_comment` / `exit_comment`).
//
// ⛔ THE LOG IS A RECORD OF OUR BROKER'S RUN, NOT A NEW HYPOTHESIS: every row below is what the broker
// already did (the T1-T8 rails, unchanged, hold the fills; the census holds every served value). These
// rails hold what the log SAYS about it, and that the facts TradingView's texts do not state (the name of
// an exit TradingView generates itself, whether an empty comment reads na) are refused by name (W9-V1).
//
// Every rule is UNPINNED in the committed ledger, so these run through the TEST-ONLY pin predicate
// (`execute(..., { brokerPinned })`), on the hand-built bars of the W9-T7 rails.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { BROKER_OPS, ORDER_COMMENT_PARAMS } from '../broker.js'
import { strategyRecordOf, strategyRecordShapeErrors, exitIdOf, STRATEGY_RECORD_UNSERVED } from '../strategyRecord.js'
import { strategyReportOf, REPORT_UNSTATED_GUARD, REPORT_UNRECORDED_GUARD } from '../brokerReport.js'
import { tradeMarkersOf, MARKER_UNLABELLED_GUARD } from '../tradeMarkers.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const T0 = 1700000000
const DAY = 86400
const at = (i) => T0 + i * DAY
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: at(i), o, h, l, c, v: 1000 }))
// bars 0-1 flat; bar 2 opens 100 (an order placed on bar 1 fills there)
//   2: 100 / 101.5 / 99.5 / 101   low nearer: 100 -> 99.5 -> 101.5 -> 101
//   3: 101 / 104 / 100.5 / 103.5  low nearer: 101 -> 100.5 -> 104 -> 103.5
//   4: 103.5 / 105 / 102.5 / 104  low nearer: 103.5 -> 102.5 -> 105 -> 104
//   5..9: 104 / 105 / 103.5 / 104.5
const A = barsOf([[100, 101, 99, 100], [100, 101, 99, 100], [100, 101.5, 99.5, 101], [101, 104, 100.5, 103.5],
  [103.5, 105, 102.5, 104], ...Array.from({ length: 5 }, () => [104, 105, 103.5, 104.5])])
const ALL = () => true

const attempt = (src, { bars = A, pins = ALL } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const barTimes = bars.map((b) => b.t)
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes, historyWindowBars: 5000 }
  try {
    const res = execute(program, ctx, undefined, { brokerPinned: pins })
    const rec = strategyRecordOf({ summary: res.broker, decl: program.broker, barTimes, historyWindowBars: 5000, confirmed: true })
    return { res, rec, cols: res.outputs.map((o) => Array.from(o)) }
  } catch (e) { return { err: e } }
}
const served = (src, o) => {
  const r = attempt(src, o)
  expect(r.refused, JSON.stringify(r.refused)).toBeUndefined()
  expect(r.err, r.err && r.err.message).toBeUndefined()
  expect(strategyRecordShapeErrors(r.rec)).toEqual([])
  return r
}
const refusedAt = (src, row, o) => {
  const r = attempt(src, o)
  expect(r.err, 'the run did not stop').toBeDefined()
  expect(r.err.guard).toBe('runtime:strategy-unsettled')
  if (row) expect(r.err.message).toContain(row)
  return r.err
}
const V5 = '//@version=5\nstrategy("t")\n'
const brief = (o) => [o.n, o.kind, o.id, o.status, o.why, o.opened, o.closed]

describe('W9-T7-F1 the record serves the order log and the exit ids', () => {
  it('neither is unserved any more; both are the ONE log', () => {
    expect(STRATEGY_RECORD_UNSERVED).not.toHaveProperty('orders')
    expect(STRATEGY_RECORD_UNSERVED).not.toHaveProperty(['trades.exitId'])
  })

  it('the broker takes the order commands\' comments as parameters (log only), and the text reads return strings', () => {
    for (const fn of ['strategy.entry', 'strategy.order', 'strategy.close', 'strategy.close_all']) {
      expect(BROKER_OPS[fn].params).toContain('comment')
      expect(BROKER_OPS[fn].params[BROKER_OPS[fn].params.length - 1]).toBe('when')
    }
    expect(BROKER_OPS['strategy.exit'].params.filter((p) => ORDER_COMMENT_PARAMS.includes(p)))
      .toEqual(['comment', 'comment_profit', 'comment_loss', 'comment_trailing'])
    for (const fn of ['strategy.opentrades.entry_id', 'strategy.opentrades.entry_comment', 'strategy.closedtrades.entry_id',
      'strategy.closedtrades.entry_comment', 'strategy.closedtrades.exit_id', 'strategy.closedtrades.exit_comment']) {
      expect(BROKER_OPS[fn]).toEqual({ params: ['trade_num'], returns: 'string' })
    }
  })
})

describe('W9-T7-F1 an exit bracket: its legs, the leg that filled, its comment, and the trade\'s exitId', () => {
  // entry 100 (bar 2 open), take-profit 300 ticks = 103, stop-loss 200 ticks = 98; bar 3 rises through 103
  const SRC = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 2, comment = "go")\n`
    + '    strategy.exit("x", "L", profit = 300, loss = 200, comment_profit = "tp", comment = "base")\n'
    + 'plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_id(0) == "x" and strategy.closedtrades.exit_comment(0) == "tp"'
    + ' and strategy.closedtrades.entry_id(0) == "L" and strategy.closedtrades.entry_comment(0) == "go" ? 1 : 0) : -1)\n'

  it('the take-profit leg fills: the row says so, and its comment is comment_profit (it overrides comment)', () => {
    const { rec, cols } = served(SRC)
    expect(rec.orders.map(brief)).toEqual([
      [1, 'entry', 'L', 'filled', null, [1], []],
      [2, 'exit', 'x', 'filled', null, [], [1]],
    ])
    const [e, x] = rec.orders
    expect([e.side, e.qty, e.type, e.comment, e.placedTime, e.fillTime, e.fillPrice, e.fillQty, e.rule])
      .toEqual(['buy', 2, 'market', 'go', at(1), at(2), 100, 2, 'B-MARKET'])
    expect([x.side, x.type, x.from, x.legs, x.placedTime, x.fillTime, x.fillPrice, x.fillQty, x.leg, x.comment, x.rule])
      .toEqual(['sell', 'bracket', 'L', { profit: 103, loss: 98, trailing: null }, at(2), at(3), 103, 2, 'profit', 'tp', 'B-PATH'])
    expect(rec.trades[0].exitId).toBe('x')
    expect(exitIdOf(x)).toBe('x')
    // the text values read the same log: 1 once the trade is closed (bar 3 on), -1 before
    expect(cols[0].slice(1, 6)).toEqual([-1, -1, 1, 1, 1])
  })

  it('⛔ CONTROL — the stop-loss leg fills instead: no comment_loss, so the comment is `comment`', () => {
    // loss 30 ticks = 99.70, reached on bar 2's fall to 99.5 before any rise
    const { rec } = served(SRC.replace('loss = 200', 'loss = 30'))
    const x = rec.orders[1]
    expect([x.leg, x.fillPrice, x.comment, x.fillTime]).toEqual(['loss', 99.7, 'base', at(2)])
  })

  it('a trailing stop\'s leg takes comment_trailing', () => {
    // W9-T7's trail rail: active on bar 3 (102), best 104, filled on bar 4 at 103
    const { rec } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\n`
      + '    strategy.exit("x", "L", trail_points = 200, trail_offset = 100, comment_trailing = "tr")\nplot(strategy.position_size)\n')
    const x = rec.orders[1]
    expect([x.leg, x.fillPrice, x.fillTime, x.comment, x.rule]).toEqual(['trailing', 103, at(4), 'tr', 'B-TRAIL'])
    expect(x.legs.trailing).toEqual({ activation: 102, offset: 100 })
  })

  it('a bracket whose trade another order closed is cancelled, `trade-closed`', () => {
    const { rec } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\n`
      + '    strategy.exit("x", "L", profit = 5000, loss = 5000)\nif bar_index == 4\n    strategy.close("L", comment = "bye")\n'
      + 'plot(strategy.position_size)\n')
    expect(rec.orders.map(brief)).toEqual([
      [1, 'entry', 'L', 'filled', null, [1], []],
      [2, 'exit', 'x', 'cancelled', 'trade-closed', [], []],
      [3, 'close', null, 'filled', null, [], [1]],
    ])
    expect(rec.orders[1].endTime).toBe(at(5))
    expect([rec.orders[2].from, rec.orders[2].comment, rec.orders[2].fillTime, rec.orders[2].fillPrice]).toEqual(['L', 'bye', at(5), 104])
  })

  it('a partial exit: the closed part is the exit row\'s, the rest stays opened by the entry row', () => {
    const { rec } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 3)\n`
      + '    strategy.exit("x", "L", qty = 1, limit = 103)\nplot(strategy.position_size)\n')
    expect(rec.trades.map((t) => [t.n, t.qty, t.open, t.exitId])).toEqual([[1, 1, false, 'x'], [2, 2, true, null]])
    expect(rec.orders.map(brief)).toEqual([
      [1, 'entry', 'L', 'filled', null, [1, 2], []],
      [2, 'exit', 'x', 'filled', null, [], [1]],
    ])
    expect([rec.orders[1].qty, rec.orders[1].fillQty]).toEqual([1, 1])
  })
})

describe('W9-T7-F1 exits TradingView names itself: no stated id, refused by name when read', () => {
  const CLOSE = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\nif bar_index == 4\n    strategy.close("L", comment = "bye")\n`

  it('strategy.close: exitId null in the record; its comment is served; its exit_id refuses W9-V1', () => {
    const { rec, cols } = served(`${CLOSE}plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_comment(0) == "bye" ? 1 : 0) : -1)\n`)
    expect(rec.trades[0].exitId).toBe(null)
    expect(cols[0].slice(4, 7)).toEqual([-1, 1, 1])
    const err = refusedAt(`${CLOSE}plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_id(0) == "" ? 1 : 0) : -1)\n`, 'W9-V1')
    expect(err.message).toMatch(/strategy\.close.*TradingView generates itself/)
  })

  it('strategy.close_all and `immediately`: the same (the row is close_all, id null)', () => {
    // (a value read AFTER an immediate close on its bar refuses W9-X4, so the plot reads first, as W9-T7's rail does)
    const { rec } = served(`${V5}plot(strategy.position_size)\nif bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\n`
      + 'if bar_index == 4\n    strategy.close_all(immediately = true, comment = "now")\n')
    const c = rec.orders[1]
    expect([c.kind, c.id, c.from, c.status, c.placedTime, c.fillTime, c.fillPrice, c.rule, c.comment])
      .toEqual(['close_all', null, null, 'filled', at(4), at(4), 104, 'B-IMMEDIATELY', 'now'])
    expect(rec.trades[0].exitId).toBe(null)
  })

  it('a reversal: the reversing ENTRY closed the trade; its id is stated only as an entry id', () => {
    const SRC = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\nif bar_index == 4\n`
      + '    strategy.entry("S", strategy.short, qty = 1, comment = "flip")\n'
    const { rec } = served(`${SRC}plot(strategy.position_size)\n`)
    expect(rec.orders.map(brief)).toEqual([
      [1, 'entry', 'L', 'filled', null, [1], []],
      [2, 'entry', 'S', 'filled', null, [2], [1]],
    ])
    expect(rec.trades.map((t) => t.exitId)).toEqual([null, null])
    refusedAt(`${SRC}plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_id(0) == "" ? 1 : 0) : -1)\n`, 'W9-V1')
    const err = refusedAt(`${SRC}plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_comment(0) == "" ? 1 : 0) : -1)\n`, 'W9-V1')
    expect(err.message).toMatch(/reversing entry/)
  })

  it('⛔ CONTROL — strategy.order closing a trade: R6 states its id as the exit id, so it is served', () => {
    const { rec, cols } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 2)\nif bar_index == 4\n`
      + '    strategy.order("O", strategy.short, qty = 2)\n'
      + 'plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_id(0) == "O" ? 1 : 0) : -1)\n')
    expect(rec.orders.map(brief)).toEqual([
      [1, 'entry', 'L', 'filled', null, [1], []],
      [2, 'order', 'O', 'filled', null, [], [1]],
    ])
    expect(rec.trades[0].exitId).toBe('O')
    expect(cols[0].slice(4, 7)).toEqual([-1, 1, 1])
  })
})

describe('W9-T7-F1 comments: a literal is kept; none, or a computed one, is never guessed', () => {
  const ENTER = (c) => `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1${c})\n`
  const READ = 'plot(strategy.opentrades > 0 ? (strategy.opentrades.entry_comment(0) == "x" ? 1 : 0) : -1)\n'

  it('no comment: the row says none; reading it refuses W9-V1 (na or an empty text is not stated)', () => {
    expect(served(`${ENTER('')}plot(strategy.position_size)\n`).rec.orders[0].comment).toBe(null)
    expect(served(`${ENTER(', comment = ""')}plot(strategy.position_size)\n`).rec.orders[0].comment).toBe(null)
    refusedAt(`${ENTER('')}${READ}`, 'W9-V1')
  })

  it('⛔ CONTROL — a literal comment is read back', () => {
    const { cols } = served(`${ENTER(', comment = "x"')}${READ}`)
    expect(cols[0].slice(1, 4)).toEqual([-1, 1, 1])
  })

  it('a computed comment is NOT evaluated (no refusal a label could cause), and is marked unrecorded', () => {
    // reading element 5 of an empty array stops a run wherever it is EVALUATED: the comment is not
    const ARR = 'var a = array.new_float(0)\n'
    const COMPUTED = ', comment = str.tostring(array.get(a, 5))'
    const src = (tail) => `${V5}${ARR}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1${COMPUTED})\n${tail}`
    const r = served(src('plot(strategy.position_size)\n'))
    expect([r.rec.orders[0].comment, r.rec.orders[0].commentRecorded]).toEqual([null, false])
    const err = attempt(src(READ)).err
    expect(err.guard).toBe('runtime:strategy-unsettled')
    expect(err.message).toMatch(/comment the script computes/)
    // CONTROL: the same expression where it IS evaluated stops the run
    const ctl = attempt(`${V5}${ARR}plot(array.get(a, 5))\n`)
    expect(ctl.refused || ctl.err).toBeTruthy()
  })

  it('entry_id reads the log (open and closed)', () => {
    const { cols } = served(`${ENTER('')}plot(strategy.opentrades > 0 ? (strategy.opentrades.entry_id(0) == "L" ? 1 : 0) : -1)\n`)
    expect(cols[0].slice(1, 4)).toEqual([-1, 1, 1])
  })

  it('a text read is a value read: it asks B-VAL, like every per-trade read', () => {
    const r = attempt(`${ENTER(', comment = "x"')}${READ}`, { pins: (id) => id !== 'B-VAL' })
    expect(r.err.rule).toBe('B-VAL')
  })
})

describe('W9-T7-F1 orders that never fill: cancelled or rejected, and why', () => {
  it('strategy.cancel', () => {
    const { rec } = served(`${V5}if bar_index == 1\n    strategy.entry("B", strategy.long, qty = 1, limit = 50)\n`
      + 'if bar_index == 4\n    strategy.cancel("B")\nplot(strategy.position_size)\n')
    expect(rec.orders.map(brief)).toEqual([[1, 'entry', 'B', 'cancelled', 'strategy.cancel', [], []]])
    expect([rec.orders[0].type, rec.orders[0].limit, rec.orders[0].endTime, rec.orders[0].fillTime]).toEqual(['limit', 50, at(4), null])
  })

  it('strategy.cancel_all', () => {
    const { rec } = served(`${V5}if bar_index == 1\n    strategy.entry("B", strategy.long, qty = 1, limit = 50)\n`
      + 'if bar_index == 4\n    strategy.cancel_all()\nplot(strategy.position_size)\n')
    expect(rec.orders.map(brief)).toEqual([[1, 'entry', 'B', 'cancelled', 'strategy.cancel_all', [], []]])
  })

  it('a modification is the same order: one row, its new level, and when it was modified', () => {
    const { rec } = served(`${V5}if bar_index == 1\n    strategy.entry("B", strategy.long, qty = 1, limit = 50)\n`
      + 'if bar_index == 3\n    strategy.entry("B", strategy.long, qty = 2, limit = 60)\nplot(strategy.position_size)\n')
    expect(rec.orders).toHaveLength(1)
    const o = rec.orders[0]
    expect([o.status, o.qty, o.limit, o.placedTime, o.modifiedTime]).toEqual(['placed', 2, 60, at(1), at(3)])
  })

  it('a market entry at the pyramiding limit does not execute: rejected, `pyramiding`', () => {
    const { rec } = served(`${V5}if bar_index == 1 or bar_index == 3\n    strategy.entry("L", strategy.long, qty = 1)\n`
      + 'plot(strategy.position_size)\n')
    expect(rec.orders.map(brief)).toEqual([
      [1, 'entry', 'L', 'filled', null, [1], []],
      [2, 'entry', 'L', 'rejected', 'pyramiding', [], []],
    ])
    expect(rec.orders[1].endTime).toBe(at(4))
  })

  it('OCA cancel: the group\'s other order is cancelled, `oca-cancel`', () => {
    // A long limit 99.6 is reached on bar 2's fall (100 -> 99.5); B at 99.0 is not
    const { rec } = served(`${V5}if bar_index == 1\n`
      + '    strategy.entry("A", strategy.long, qty = 1, limit = 99.6, oca_name = "g", oca_type = strategy.oca.cancel)\n'
      + '    strategy.entry("B", strategy.long, qty = 1, limit = 99.0, oca_name = "g", oca_type = strategy.oca.cancel)\n'
      + 'plot(strategy.position_size)\n')
    expect(rec.orders.map(brief)).toEqual([
      [1, 'entry', 'A', 'filled', null, [1], []],
      [2, 'entry', 'B', 'cancelled', 'oca-cancel', [], []],
    ])
    expect(rec.orders[1].oca).toEqual({ name: 'g', type: 'cancel' })
  })

  it('OCA reduce: the other order loses the filled size (the row\'s qty), and is cancelled at 0', () => {
    const SRC = (qb) => `${V5}if bar_index == 1\n`
      + '    strategy.entry("A", strategy.long, qty = 1, limit = 99.6, oca_name = "g", oca_type = strategy.oca.reduce)\n'
      + `    strategy.entry("B", strategy.long, qty = ${qb}, limit = 99.0, oca_name = "g", oca_type = strategy.oca.reduce)\n`
      + 'plot(strategy.position_size)\n'
    const two = served(SRC(2)).rec.orders[1]
    expect([two.status, two.qty]).toEqual(['placed', 1])
    expect(brief(served(SRC(1)).rec.orders[1])).toEqual([2, 'entry', 'B', 'cancelled', 'oca-reduce', [], []])
  })

  it('a stop-limit records when its stop was reached', () => {
    const { rec } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1, stop = 101.2, limit = 101.1)\n`
      + 'plot(strategy.position_size)\n')
    const o = rec.orders[0]
    expect([o.type, o.stop, o.limit, o.triggerTime]).toEqual(['stoplimit', 101.2, 101.1, at(2)])
  })

  it('allow_entry_in: a forbidden entry with no position is rejected; with one, it fills as the close', () => {
    const ALLOW = 'strategy.risk.allow_entry_in(strategy.direction.long)\n'
    const V6 = '//@version=6\nstrategy("t")\n'
    const none = served(`${V6}${ALLOW}if bar_index == 1\n    strategy.entry("S", strategy.short, qty = 1)\nplot(strategy.position_size)\n`)
    expect(none.rec.orders.map(brief)).toEqual([[1, 'entry', 'S', 'rejected', 'risk-allow-entry-in', [], []]])
    const some = served(`${V6}${ALLOW}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\n`
      + 'if bar_index == 4\n    strategy.entry("S", strategy.short, qty = 1)\nplot(strategy.position_size)\n')
    expect(some.rec.orders.map(brief)).toEqual([
      [1, 'entry', 'L', 'filled', null, [1], []],
      [2, 'entry', 'S', 'filled', null, [], [1]],
    ])
    expect([some.rec.orders[1].rule, some.rec.trades[0].exitId]).toEqual(['B-RISK-ALLOW', null])
  })
})

describe('W9-T7-F1 the one shape check holds the log and its links', () => {
  const base = () => served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 2, comment = "go")\n`
    + '    strategy.exit("x", "L", profit = 300, loss = 200)\nplot(strategy.position_size)\n').rec
  const clone = (r) => JSON.parse(JSON.stringify(r))

  it('a trade opened by two orders', () => {
    const r = clone(base()); r.orders[1].opened = [1]
    expect(strategyRecordShapeErrors(r)).toContain('trade 1 opened twice')
  })
  it('an exitId that is not the closing order\'s', () => {
    const r = clone(base()); r.trades[0].exitId = 'y'
    expect(strategyRecordShapeErrors(r)).toEqual(['trades[0].exitId'])
  })
  it('an empty comment (none is null), and a comment beside commentRecorded false', () => {
    const r = clone(base()); r.orders[0].comment = ''
    expect(strategyRecordShapeErrors(r)).toEqual(['orders[0].comment'])
    const s = clone(base()); s.orders[0].commentRecorded = false
    expect(strategyRecordShapeErrors(s)).toEqual(['orders[0].comment'])
  })
  it('a close with an id, an exit without one', () => {
    const r = clone(base()); r.orders[1].kind = 'close'
    expect(strategyRecordShapeErrors(r)).toContain('orders[1].id')
    const s = clone(base()); s.orders[1].id = null
    expect(strategyRecordShapeErrors(s)).toContain('orders[1].id')
  })
  it('an order that did not fill but links a trade; a cancelled order with no reason', () => {
    const r = clone(base()); r.orders[1].status = 'placed'; r.orders[1].fillTime = null; r.orders[1].fillPrice = null
    expect(strategyRecordShapeErrors(r)).toContain('orders[1] links trades without a fill')
    const s = clone(base()); Object.assign(s.orders[1], { status: 'cancelled', why: 'because', fillTime: null, fillPrice: null, closed: [] })
    expect(strategyRecordShapeErrors(s)).toContain('orders[1].why')
  })
  it('⛔ CONTROL — the run\'s own record has no error', () => {
    expect(strategyRecordShapeErrors(base())).toEqual([])
  })
})

describe('W9-T7-F1 the report\'s trade list reads each fill\'s signal off the same log (`orderLabelOf`)', () => {
  const report = (src) => strategyReportOf(served(src).rec, { isPinned: ALL })
  const sig = (s) => (s === null ? null : s.status === 'served' ? s.value : [s.guard, s.row])

  it('an exit command\'s id, a comment over an id, and a close TradingView names itself', () => {
    const rep = report(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1, comment = "go")\n`
      + '    strategy.exit("x", "L", profit = 300)\nif bar_index == 5\n    strategy.entry("M", strategy.long, qty = 1)\n'
      + 'if bar_index == 7\n    strategy.close("M")\nplot(strategy.position_size)\n')
    expect(rep.trades.rows.map((r) => [r.n, sig(r.entrySignal), sig(r.exitSignal)])).toEqual([
      [1, 'go', 'x'],
      [2, 'M', [REPORT_UNSTATED_GUARD, 'W9-V1']],
    ])
    expect(rep.trades.rows[1].exitSignal.sentence).toBe("Trade 2's exit signal is not shown: TradingView names this kind of "
      + 'exit itself, and that name has not yet been checked against TradingView.')
  })

  it('a computed comment: unrecorded, never guessed; an open trade has no exit signal', () => {
    const rep = report(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1, comment = str.tostring(close))\n`
      + 'plot(strategy.position_size)\n')
    expect(rep.trades.rows.map((r) => [sig(r.entrySignal), r.exitSignal])).toEqual([[[REPORT_UNRECORDED_GUARD, null], null]])
  })
})

describe('W9-T7-F1 a text read is TEXT to the front end', () => {
  it('it joins other text (`+`), which a number could not', () => {
    const { cols } = served(`${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\n`
      + '    strategy.exit("x", "L", profit = 300)\n'
      + 'plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_id(0) + "/" + strategy.closedtrades.entry_id(0) == "x/L" ? 1 : 0) : -1)\n')
    expect(cols[0].slice(1, 5)).toEqual([-1, -1, 1, 1])
  })
})

describe('W9-T7-F1 r1 (review N1, one fact two answers): a reversed trade\'s exit label refuses on EVERY surface', () => {
  const REV = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\nif bar_index == 4\n`
    + '    strategy.entry("S", strategy.short, qty = 1, comment = "flip")\n'
  const READ = 'plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_comment(0) == "flip" ? 1 : 0) : -1)\n'
  const surfaces = (src) => {
    const { rec } = served(`${src}plot(strategy.position_size)\n`)
    return { rec, report: strategyReportOf(rec, { isPinned: ALL }), markers: tradeMarkersOf(rec, { isPinned: ALL }) }
  }

  it('exit_comment refuses W9-V1; the report\'s exit signal refuses W9-V1; the markers refuse whole, naming the fill', () => {
    const err = refusedAt(`${REV}${READ}`, 'W9-V1')
    expect(err.message).toMatch(/reversing entry/)
    const { report, markers } = surfaces(REV)
    const x = report.trades.rows[0].exitSignal
    expect([x.status, x.guard, x.row]).toEqual(['refused', REPORT_UNSTATED_GUARD, 'W9-V1'])
    expect(x.sentence).not.toMatch(/flip/)
    // the reversing entry's OWN entry signal is its comment (stated)
    expect(report.trades.rows[1].entrySignal).toEqual({ status: 'served', value: 'flip' })
    expect(markers.guard).toBe(MARKER_UNLABELLED_GUARD)
    expect(markers.fills).toEqual(['trade 1 exit (order 2, a reversing entry)'])
  })

  it('⛔ CONTROL — an exit command\'s comment is served on all three', () => {
    const SRC = `${V5}if bar_index == 1\n    strategy.entry("L", strategy.long, qty = 1)\n    strategy.exit("x", "L", profit = 300, comment = "tp")\n`
    const { cols } = served(`${SRC}plot(strategy.closedtrades > 0 ? (strategy.closedtrades.exit_comment(0) == "tp" ? 1 : 0) : -1)\n`)
    expect(cols[0].slice(2, 5)).toEqual([-1, 1, 1])
    const { report, markers } = surfaces(SRC)
    expect(report.trades.rows[0].exitSignal).toEqual({ status: 'served', value: 'tp' })
    expect(markers.status).toBe('ok')
    expect(markers.markers.filter((m) => m.role === 'exit').map((m) => m.label)).toEqual(['tp'])
  })
})
