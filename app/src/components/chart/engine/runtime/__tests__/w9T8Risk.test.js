// W9-T8 rails: strategy.risk.* (W9 design section 4 T8; capture rows W9-R1 and W9-R1i).
//
// ⛔ EVERY RULE HERE IS UNPINNED (ruling D1). The committed ledger pins none of B-RISK-ALLOW, B-RISK-DDOWN or
// B-RISK-INTRADAY-ORDERS, so on the member door every risk script below refuses `runtime:strategy-unpinned` by name.
// The behaviour rails run through the TEST-ONLY pin predicate (`execute(..., { brokerPinned })`, the path the W9-T1,
// T4, T5, T6 and T7 rails use) on hand-built bars. Every expected number is worked by hand in the comment beside it
// from the rule the broker states (`broker.js`, `docs/pine/strategy-broker-spec.md` "W9-T8"); where that rule is a
// HYPOTHESIS the comment says so, and a W9-R1 / W9-R1i capture that disagrees moves the hypothesis, never these numbers
// silently.
//
// Bars: mintick 0.01, pointvalue 1 (NYSE:RDDT). B-PATH: open -> the NEARER extreme -> the other -> close.
//   0: 100 / 101 / 99 / 100     1: 100 / 101 / 99 / 100
//   2: 100 / 101.5 / 99.5 / 101  low nearer: 100 -> 99.5 -> 101.5 -> 101
//   3: 101 / 104 / 100.5 / 103.5 low nearer: 101 -> 100.5 -> 104 -> 103.5
//   4: 103.5 / 105 / 102.5 / 104 low nearer: 103.5 -> 102.5 -> 105 -> 104
//   5..9: 104 / 105 / 103.5 / 104.5
import { describe, it, expect, afterEach } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { BROKER_RULE_IDS, BROKER_RULES, RISK_RULES } from '../brokerRules.js'
import RESOLVED from '../brokerPins.resolved.json'
import { strategyScorecardWording } from '../../ast/strategyScorecard.js'
import { computeRuntimeColumns } from '../runtimeColumns.js'
import { registerStrategyBrokerGate } from '../../strategyBrokerGateRegistry.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const T0 = 1700000000
const DAY = 86400
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: T0 + i * DAY, o, h, l, c, v: 1000 }))
const ALL = () => true
const except = (...ids) => (id) => !ids.includes(id)
const T8_RULES = ['B-RISK-ALLOW', 'B-RISK-DDOWN', 'B-RISK-INTRADAY-ORDERS']
const S1 = new Set(BROKER_RULE_IDS.slice(0, 22))
const HEAD = [[100, 101, 99, 100], [100, 101, 99, 100], [100, 101.5, 99.5, 101], [101, 104, 100.5, 103.5]]
const FILL = (n, row) => Array.from({ length: n }, () => row)
const A = barsOf([...HEAD, [103.5, 105, 102.5, 104], ...FILL(5, [104, 105, 103.5, 104.5])])
const at = (i) => T0 + i * DAY

const attempt = (src, { bars = A, pins = ALL, ctx: extra = {} } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
    historyWindowBars: 5000, ...extra }
  try {
    const res = execute(program, ctx, undefined, pins === 'ledger' ? undefined : { brokerPinned: pins })
    return { res, program, cols: res.outputs.map((o) => Array.from(o)), trades: res.broker.record.trades, used: res.broker.record.rulesUsed }
  } catch (e) { return { err: e } }
}
const served = (src, o) => {
  const r = attempt(src, o)
  expect(r.refused, JSON.stringify(r.refused)).toBeUndefined()
  expect(r.err, r.err && r.err.message).toBeUndefined()
  return r
}
const unsettled = (src, row, o) => {
  const r = attempt(src, o)
  expect(r.refused, JSON.stringify(r.refused)).toBeUndefined()
  expect(r.err, 'the run did not stop').toBeDefined()
  expect(r.err.guard).toBe('runtime:strategy-unsettled')
  expect(r.err.message).toContain(row)
  return r.err
}
const buildRefused = (src) => {
  const r = attempt(src)
  expect(r.refused, 'the build was not refused').toBeDefined()
  expect(r.refused.guard).toBe('runtime:strategy-option')
  return r.refused
}

// every declaration value is the script's own, so B-DEFAULTS is never asked
const DECL = (extra = '') => '//@version=6\nstrategy("t", initial_capital = 100000, default_qty_type = strategy.fixed, '
  + `default_qty_value = 2, pyramiding = 1, margin_long = 0, margin_short = 0${extra ? `, ${extra}` : ''})\n`
const ENTER = 'if bar_index == 1\n    strategy.entry("L", strategy.long)\n'
const SHORT3 = 'if bar_index == 3\n    strategy.entry("S", strategy.short)\n'
const SHORT5 = 'if bar_index == 5\n    strategy.entry("S2", strategy.short)\n'
const CLOSE3 = 'if bar_index == 3\n    strategy.close("L")\n'
// p0 position_size · p1 netprofit · p2 closedtrades · p3 opentrades
const READS = 'plot(strategy.position_size)\nplot(strategy.netprofit)\nplot(strategy.closedtrades)\nplot(strategy.opentrades)\n'
const ALLOW = (dir) => `strategy.risk.allow_entry_in(strategy.direction.${dir})\n`

describe('W9-T8 allow_entry_in (W9-R1, B-RISK-ALLOW)', () => {
  it('a forbidden market entry against the position CLOSES it at the entry\'s fill and opens nothing', () => {
    // long 2 @ bar 2 open 100. The short S placed on bar 3 would reverse at bar 4's open 103.5 (B-REVERSE); with
    // allow_entry_in(long) it closes the long there instead (R6 example: "this command will close long entries";
    // the manual: "generates a market order to close the position without entering a new trade in that direction").
    // HYPOTHESIS (W9-R1): the close fills where the entry would have, the next open. Profit 2 x 3.5 = 7.
    const { cols, trades, used } = served(`${DECL()}${ALLOW('long')}${ENTER}${SHORT3}${READS}`)
    expect(trades).toHaveLength(1)
    expect(trades[0].entry).toEqual({ time: at(2), price: 100, rule: 'B-MARKET' })
    expect(trades[0].exit).toEqual({ time: at(4), price: 103.5, rule: 'B-RISK-ALLOW' })
    expect(cols[0][3]).toBe(2); expect(cols[0][4]).toBe(0)
    expect(cols[1][4]).toBe(7); expect(cols[2][4]).toBe(1); expect(cols[3][4]).toBe(0)
    expect(used).toContain('B-RISK-ALLOW')
    expect(used).not.toContain('B-REVERSE')
  })
  it('CONTROL: without the call the same script reverses (so the close above is the rule, not the script)', () => {
    const { cols, trades, used } = served(`${DECL()}${ENTER}${SHORT3}${READS}`)
    expect(trades).toHaveLength(2)
    expect(trades[0].exit.rule).toBe('B-MARKET')
    expect(cols[0][4]).toBe(-2)
    expect(used).toContain('B-REVERSE')
    expect(used).not.toContain('B-RISK-ALLOW')
  })
  it('a forbidden entry with no position open fills nothing (and the next one still nothing)', () => {
    // flat after bar 4; S2 placed on bar 5 would open a short at bar 6's open: forbidden, nothing to close
    const { cols, trades } = served(`${DECL()}${ALLOW('long')}${ENTER}${SHORT3}${SHORT5}${READS}`)
    expect(trades).toHaveLength(1)
    for (let b = 4; b < 10; b += 1) expect(cols[0][b]).toBe(0)
  })
  it('allow_entry_in(short): the long entry fills nothing at all', () => {
    const { cols, trades, used } = served(`${DECL()}${ALLOW('short')}${ENTER}${READS}`)
    expect(trades).toHaveLength(0)
    for (let b = 0; b < 10; b += 1) expect(cols[0][b]).toBe(0)
    expect(used).toContain('B-RISK-ALLOW')
    // nothing was closed, so the run rests on no closing rule
    expect(used).not.toContain('B-FIFO')
  })
  it('an ALLOWED entry, and strategy.direction.all, change nothing but ask the rule (HYPOTHESIS, W9-R1)', () => {
    const plain = served(`${DECL()}${ENTER}${CLOSE3}${READS}`)
    for (const dir of ['long', 'all']) {
      const r = served(`${DECL()}${ALLOW(dir)}${ENTER}${CLOSE3}${READS}`)
      expect(r.cols).toEqual(plain.cols)
      expect(r.trades).toEqual(plain.trades)
      expect(r.used).toEqual([...plain.used, 'B-RISK-ALLOW'].sort())
    }
    // all: even the short reverses as usual
    const all = served(`${DECL()}${ALLOW('all')}${ENTER}${SHORT3}${READS}`)
    expect(all.cols[0][4]).toBe(-2)
  })
  it('an exit waiting on the forbidden entry binds nothing (the entry opened no trade)', () => {
    const src = `${DECL()}${ALLOW('long')}${ENTER}${SHORT3}if bar_index == 3\n    strategy.exit("XS", "S", stop = 110)\n${READS}`
    const { trades, cols } = served(src)
    expect(trades).toHaveLength(1)
    expect(cols[0][9]).toBe(0)
  })
  it('a forbidden PRICE entry refuses by name (W9-R1: the probe places market entries only)', () => {
    const src = `${DECL()}${ALLOW('long')}${ENTER}if bar_index == 2\n    strategy.entry("S", strategy.short, limit = 103)\n${READS}`
    const err = unsettled(src, 'W9-R1')
    expect(err.message).toMatch(/limit entry `S` is short, which strategy\.risk\.allow_entry_in\(long\) forbids/)
  })
  it('strategy.order beside a risk command refuses by name (R6 and the manual name strategy.entry only)', () => {
    const src = `${DECL()}${ALLOW('long')}if bar_index == 1\n    strategy.order("O", strategy.long)\n${READS}`
    expect(unsettled(src, 'W9-R1').message).toMatch(/`strategy\.order` with a strategy\.risk\.\* command/)
  })
  it('a T7 kind beside a risk command refuses by name (a trailing stop)', () => {
    const src = `${DECL()}${ALLOW('long')}${ENTER}if bar_index == 2\n    strategy.exit("T", "L", trail_points = 50, trail_offset = 10)\n${READS}`
    expect(unsettled(src, 'W9-R1').message).toMatch(/trailing stop with a strategy\.risk\.\* command/)
  })
  it('allow_entry_in under a commission, a slippage or process_orders_on_close refuses by name (W9-R1)', () => {
    for (const [extra, re] of [['commission_type = strategy.commission.percent, commission_value = 0.1', /commission \(percent\)/],
      ['slippage = 2', /slippage of 2 ticks/], ['process_orders_on_close = true', /process_orders_on_close/]]) {
      const err = unsettled(`${DECL(extra)}${ALLOW('long')}${ENTER}${SHORT3}${READS}`, 'W9-R1')
      expect(err.message).toMatch(re)
      expect(err.message).toMatch(/allow_entry_in/)
    }
  })
})

describe('W9-T8 max_drawdown (W9-R1, B-RISK-DDOWN): served below the limit, refused where it may be reached', () => {
  // long 2 @ 100 (bar 2 open), closed by strategy.close at bar 4's open 103.5.
  // Equity WITH open profit at every tick (capital 100000): bar 2: open 100 -> 100000, low 99.5 -> 99999, high 101.5
  // -> 100003, close 101 -> 100002; bar 3: open 101 -> 100002, low 100.5 -> 100001, high 104 -> 100008, close 103.5 ->
  // 100007; bar 4: open 103.5 -> 100007 (closed: 100007 from here on). Its peak-to-trough is largest at bar 3's low:
  // 100003 - 100001 = 2. Closed-only equity: 100000, then 100007: no drawdown.
  // At the CLOSES only (a coarser reading) it would be 0: the widest reading (every tick) is the one the check takes.
  const RUN = (dd) => `${DECL()}strategy.risk.max_drawdown(${dd})\n${ENTER}${CLOSE3}${READS}`
  it('a cash limit of 2.5 is never reached: the run is the run without the call, and asks B-RISK-DDOWN', () => {
    const plain = served(`${DECL()}${ENTER}${CLOSE3}${READS}`)
    const r = served(RUN('2.5, strategy.cash'))
    expect(r.cols).toEqual(plain.cols)
    expect(r.trades).toEqual(plain.trades)
    expect(r.used).toEqual([...plain.used, 'B-RISK-DDOWN'].sort())
  })
  it('a cash limit of exactly 2 MAY be reached at bar 3\'s low (100.5): refused by name (W9-R1), never a halt served', () => {
    const err = unsettled(RUN('2, strategy.cash'), 'W9-R1')
    expect(err.message).toMatch(/max_drawdown\(2, cash\) may reach its limit at 100\.5: a drawdown of 2 from an equity of 100003/)
  })
  it('a cash limit of 1 is reached first at bar 2\'s low (99.5), 1 below the initial capital', () => {
    expect(unsettled(RUN('1, strategy.cash'), 'W9-R1').message).toMatch(/at 99\.5: a drawdown of 1 from an equity of 100000/)
  })
  it('percent: taken of the initial capital (the smaller base): 0.002 % of 100000 = 2 refuses, 0.0025 % = 2.5 is served', () => {
    unsettled(RUN('0.002, strategy.percent_of_equity'), 'W9-R1')
    served(RUN('0.0025, strategy.percent_of_equity'))
  })
  it('a short: the peak is an intrabar FAVOURABLE extreme (bar 2\'s low), the trough the next bar\'s high', () => {
    // short 2 @ 100 (bar 2 open), closed at bar 4's open 103.5 (a loss of 7). Bar 2: low 99.5 -> 100001 (the peak),
    // high 101.5 -> 99997; bar 3: low 100.5 -> 99999, high 104 -> 99992. Drawdown 100001 - 99992 = 9 at 104.
    // (The closed trade's loss, 7, is inside it: the open series already went under water on the way to that fill.)
    const src = (dd) => `${DECL()}strategy.risk.max_drawdown(${dd}, strategy.cash)\nif bar_index == 1\n    strategy.entry("S", strategy.short)\n`
      + `if bar_index == 3\n    strategy.close("S")\n${READS}`
    expect(unsettled(src(9), 'W9-R1').message).toMatch(/at 104: a drawdown of 9 from an equity of 100001/)
    served(src(9.5))
  })
  it('a REVERSAL at a level on the path is an equity extreme no vertex holds: sampled there', () => {
    // bars 0..2: 100 / 100.2 / 99.9 / 100 (low nearer). Long 2 @ 100 (bar 2 open); a short LIMIT at 105, placed on
    // bar 2 (above the market: it waits). Bar 3: 100 / 106 / 99.8 / 105.5, low nearer: 100 -> 99.8 -> 106 -> 105.5.
    // Rising through 105 the short fills and reverses the long (+10: equity 100010, the PEAK, at 105); the short then
    // loses to 106 (100008) and gains back to 105.5 (100009). Drawdown 2 at 106, from the reversal's 100010. The
    // vertices alone (99.8 -> 99999.6, 106 -> 100008, 105.5 -> 100009) read at most 0.4: a limit of 1.5 would be served.
    const B = barsOf([[100, 100.2, 99.9, 100], [100, 100.2, 99.9, 100], [100, 100.2, 99.9, 100], [100, 106, 99.8, 105.5],
      ...FILL(3, [105.5, 105.6, 105.4, 105.5])])
    const src = (dd) => `${DECL()}strategy.risk.max_drawdown(${dd}, strategy.cash)\n${ENTER}`
      + `if bar_index == 2\n    strategy.entry("S", strategy.short, limit = 105)\n${READS}`
    expect(unsettled(src(1.5), 'W9-R1', { bars: B }).message).toMatch(/at 106: a drawdown of 2 from an equity of 100010/)
    const r = served(src(2.5), { bars: B })
    expect(r.trades[0].exit).toEqual({ time: at(3), price: 105, rule: 'B-PATH' })
    expect(r.used).toContain('B-REVERSE')
  })
  it('a stop-loss: the trough is the stop level, where the trade closed, not the bar\'s low past it', () => {
    // long 2 @ 100 (bar 2 open) with a stop at 99.6: bar 2's path 100 -> 99.5 reaches 99.6 first, so the trade closes
    // there (2 x -0.4 = -0.8; equity 99999.2) and is flat at the low. Drawdown 0.8: a limit of 0.8 refuses at 99.6,
    // 0.81 is served (the trade held to the low would read 1).
    const src = (dd) => `${DECL()}strategy.risk.max_drawdown(${dd}, strategy.cash)\n${ENTER}`
      + `if bar_index == 1\n    strategy.exit("X", "L", stop = 99.6)\n${READS}`
    expect(unsettled(src(0.8), 'W9-R1').message).toMatch(/at 99\.6: a drawdown of 0\.8\d* from an equity of 100000/)
    const r = served(src(0.81))
    expect(r.trades[0].exit).toEqual({ time: at(2), price: 99.6, rule: 'B-PATH' })
  })
  it('max_drawdown under process_orders_on_close refuses by name before the first bar', () => {
    expect(unsettled(`${DECL('process_orders_on_close = true')}strategy.risk.max_drawdown(50, strategy.percent_of_equity)\n${READS}`, 'W9-R1')
      .message).toMatch(/max_drawdown` under process_orders_on_close/)
  })
})

describe('W9-T8 max_intraday_filled_orders (W9-R1i, B-RISK-INTRADAY-ORDERS)', () => {
  const RUN = (n, body = `${ENTER}${CLOSE3}`) => `${DECL()}strategy.risk.max_intraday_filled_orders(${n})\n${body}${READS}`
  const EACH_BAR = { tradingDays: A.map((b, i) => `d${i}`) }
  it('the run must be told each bar\'s trading day: without it the first fill refuses by name (W9-R1i)', () => {
    expect(unsettled(RUN(3), 'W9-R1i').message).toMatch(/trading day of each bar \(its session and exchange time zone\) is not known/)
  })
  it('below the limit on every day: the run is the run without the call', () => {
    // one fill on day d2 (the entry), one on d4 (the close): 1 < 2 on each
    const plain = served(`${DECL()}${ENTER}${CLOSE3}${READS}`)
    const r = served(RUN(2), { ctx: EACH_BAR })
    expect(r.cols).toEqual(plain.cols)
    expect(r.trades).toEqual(plain.trades)
    expect(r.used).toEqual([...plain.used, 'B-RISK-INTRADAY-ORDERS'].sort())
  })
  it('a day that REACHES the limit refuses by name: R6 "is reached" against the manual "fills more orders than the limit"', () => {
    // the five bars 0..4 are ONE trading day: the entry (bar 2) and the close (bar 4) are its 2nd fill
    const oneDay = { tradingDays: A.map((b, i) => (i < 5 ? 'd0' : `d${i}`)) }
    const err = unsettled(RUN(2), 'W9-R1i', { ctx: oneDay })
    expect(err.message).toMatch(/max_intraday_filled_orders\(2\) may reach its limit on trading day d0 \(2 fills/)
    served(RUN(3), { ctx: oneDay })
  })
  it('a reversal counts each trade it closes and opens (an upper bound on filled orders): 2 on day d4', () => {
    // bar 4's open: the long closes and the short opens on ONE order; counted as 2, so a limit of 2 refuses there
    const err = unsettled(RUN(2, `${ENTER}${SHORT3}`), 'W9-R1i', { ctx: EACH_BAR })
    expect(err.message).toMatch(/trading day d4 \(2 fills/)
    served(RUN(3, `${ENTER}${SHORT3}`), { ctx: EACH_BAR })
  })
  it('a limit of 1 is reached by the first fill, the entry on d2; a bar whose day is not stated refuses there', () => {
    expect(unsettled(RUN(1), 'W9-R1i', { ctx: EACH_BAR }).message).toMatch(/trading day d2 \(1 fills/)
    const gap = unsettled(RUN(5), 'W9-R1i', { ctx: { tradingDays: A.map((b, i) => (i === 4 ? null : `d${i}`)) } })
    expect(gap.message).toMatch(/not known to this run/)
  })
  it('under a commission it refuses by name with its own row (W9-R1i)', () => {
    const err = unsettled(`${DECL('commission_type = strategy.commission.cash_per_order, commission_value = 1')}`
      + `strategy.risk.max_intraday_filled_orders(5)\n${ENTER}${CLOSE3}${READS}`, 'W9-R1i', { ctx: EACH_BAR })
    expect(err.message).toMatch(/max_intraday_filled_orders` with a commission \(cash_per_order\)/)
  })
})

describe('W9-T8 read at build: what a capture witnesses, and every other shape refused by name', () => {
  it('the three commands no probe calls refuse at build, naming why', () => {
    expect(buildRefused(`${DECL()}strategy.risk.max_intraday_loss(10, strategy.percent_of_equity)\n${READS}`).message)
      .toMatch(/max_intraday_loss\(\)` is not served: capture row W9-R1i's probe \(`w9-r1-risk-intraday\.pine`\) calls only/)
    expect(buildRefused(`${DECL()}strategy.risk.max_cons_loss_days(3)\n${READS}`).message)
      .toMatch(/max_cons_loss_days\(\)` is not served: no TradingView capture row is queued for it/)
    expect(buildRefused(`${DECL()}strategy.risk.max_position_size(10)\n${READS}`).message)
      .toMatch(/max_position_size\(\)` is not served: no TradingView capture row is queued for it/)
  })
  it('a risk command inside a block refuses at build (the probes call it at the top level)', () => {
    expect(buildRefused(`${DECL()}if bar_index > 2\n    ${ALLOW('long')}${ENTER}${READS}`).message).toMatch(/inside a block/)
  })
  it('a version other than 6, a second call, a non-literal and a bad argument refuse at build', () => {
    expect(buildRefused(`${DECL().replace('@version=6', '@version=5')}${ALLOW('long')}${READS}`).message).toMatch(/Pine version 5/)
    expect(buildRefused(`${DECL()}${ALLOW('long')}${ALLOW('short')}${READS}`).message).toMatch(/more than once/)
    expect(buildRefused(`${DECL()}x = input.float(10)\nstrategy.risk.max_drawdown(x, strategy.cash)\n${READS}`).message)
      .toMatch(/`value` is not a positive literal/)
    expect(buildRefused(`${DECL()}strategy.risk.max_drawdown(150, strategy.percent_of_equity)\n${READS}`).message)
      .toMatch(/at most 100/)
    expect(buildRefused(`${DECL()}strategy.risk.max_drawdown(5)\n${READS}`).message).toMatch(/`type` is not/)
    expect(buildRefused(`${DECL()}strategy.risk.max_drawdown(5, strategy.fixed)\n${READS}`).message).toMatch(/`type` is not/)
    expect(buildRefused(`${DECL()}strategy.risk.max_drawdown(5, strategy.cash, alert_message = str.tostring(close))\n${READS}`)
      .message).toMatch(/`alert_message` is not a text literal/)
    expect(buildRefused(`${DECL()}strategy.risk.max_intraday_filled_orders(2.5)\n${READS}`).message).toMatch(/whole-number/)
    expect(buildRefused(`${DECL()}strategy.risk.allow_entry_in("long")\n${READS}`).message).toMatch(/strategy\.direction/)
  })
  it('alert_message is read past as a label (a text literal)', () => {
    served(`${DECL()}strategy.risk.max_drawdown(5, strategy.cash, alert_message = "dd")\n${ENTER}${CLOSE3}${READS}`)
  })
  it('with the broker dark the risk call is skipped as before (C50: drawn like an indicator)', () => {
    const built = buildRuntimeIr(`${DECL()}strategy.risk.max_position_size(10)\nplot(close)\n`, { bars: A, inputs: {}, symbol: SYMBOL })
    expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  })
})

describe('W9-T8 pin before serve (D1): nothing T8 adds serves without its own pin', () => {
  afterEach(() => registerStrategyBrokerGate(() => false))
  const EACH_BAR = { tradingDays: A.map((b, i) => `d${i}`) }
  const SAMPLES = {
    'B-RISK-ALLOW': [`${DECL()}${ALLOW('long')}${ENTER}${SHORT3}${READS}`, {}],
    'B-RISK-DDOWN': [`${DECL()}strategy.risk.max_drawdown(50, strategy.percent_of_equity)\n${ENTER}${CLOSE3}${READS}`, {}],
    'B-RISK-INTRADAY-ORDERS': [`${DECL()}strategy.risk.max_intraday_filled_orders(5)\n${ENTER}${CLOSE3}${READS}`, EACH_BAR],
  }
  it('each T8 rule is named, with the capture row the design gives it; RISK_RULES names exactly them; the ledger pins none', () => {
    expect(T8_RULES.map((r) => BROKER_RULES[r].capture)).toEqual(['W9-R1', 'W9-R1', 'W9-R1i'])
    expect(Object.values(RISK_RULES).sort()).toEqual([...T8_RULES].sort())
    for (const r of T8_RULES) expect(Object.keys(RESOLVED.rules)).not.toContain(r)
  })
  for (const rule of T8_RULES) {
    const [src, ctx] = SAMPLES[rule]
    it(`${rule}: served with every rule pinned, and stops naming ${rule} (and its row) when only it is unpinned`, () => {
      const full = attempt(src, { ctx })
      expect(full.err, full.err && full.err.message).toBeUndefined()
      expect(full.used).toContain(rule)
      const { err } = attempt(src, { pins: except(rule), ctx })
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(err.rule).toBe(rule)
      expect(err.message).toContain(BROKER_RULES[rule].capture)
    })
    it(`${rule}: S1's 22 rules pinned never serve it (it stops naming ${rule})`, () => {
      const { err } = attempt(src, { pins: (id) => S1.has(id), ctx })
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(err.rule).toBe(rule)
    })
    it(`${rule}: on the committed ledger the run refuses runtime:strategy-unpinned`, () => {
      const { err } = attempt(src, { pins: 'ledger', ctx })
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(BROKER_RULE_IDS).toContain(err.rule)
    })
    it(`${rule}: the member door (gate on, committed ledger) refuses by name`, () => {
      registerStrategyBrokerGate(() => true)
      const doc = { id: `w9t8-${rule}`, meta: { runtimeHistory: 'strategy-window' },
        compute: { kind: 'runtime', fn: `runtime:w9t8-${rule}`, outputs: { p: 0 }, source: src } }
      let err
      try { computeRuntimeColumns(doc, A, { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL, historyWindowBars: 30 }) } catch (e) { err = e }
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(err.message).toMatch(/is not pinned by a matching TradingView capture/)
    })
  }
  it('the D7 scorecard stays derived: 0 of every named rule (the size is pinned once, strategiesAreRuled.test.js)', () => {
    for (const r of T8_RULES) expect(BROKER_RULE_IDS).toContain(r)
    expect(strategyScorecardWording()).toMatch(new RegExp(`^0 of ${BROKER_RULE_IDS.length} broker rules are pinned`))
  })
})
