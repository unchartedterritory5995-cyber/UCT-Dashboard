// W9-T4 rails: sizing (fixed, cash, percent of equity), the version defaults, capital and margin.
//
// ⭐ LANDING TRAIN 2 (engine 60): the committed ledger pins B-QTY, B-DEFAULTS and B-MARGIN, the three T4
// rules (ruling D1: each by committed captures that MATCH). On the member door a default CASH or
// PERCENT size still stops, by another name: `runtime:strategy-unsettled`, the symbol's minimum contract
// (Q-S1a), which no pin lifts; a FIXED size runs; a rule the ledger does not pin still refuses
// `runtime:strategy-unpinned` by name (the last describe). The behaviour rails below run
// through the TEST-ONLY pin predicate (`execute(..., { brokerPinned })`, the path the W9-T1 rails use)
// against hand-built bars, and every expected number is computed by hand in the comment beside it from
// the hypothesis `broker.js` `defaultSize` states. A Q-S1a / Q-S1b / W9-D1 capture that disagrees moves
// the hypothesis, never these numbers silently.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { makeBroker } from '../broker.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { readStrategyDeclaration, DECLARATION_DEFAULTS } from '../../ast/strategyBroker.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { BROKER_RULE_IDS, BROKER_RULES } from '../brokerRules.js'
import RESOLVED from '../brokerPins.resolved.json'
import { strategyScorecardWording } from '../../ast/strategyScorecard.js'
import { computeRuntimeColumns } from '../runtimeColumns.js'
import { registerStrategyBrokerGate } from '../../strategyBrokerGateRegistry.js'
import { strategyRecordOf } from '../strategyRecord.js'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' } // mintick 0.01, pointvalue 1
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: 1700000000 + i * 86400, o, h, l, c, v: 1000 }))
/** rising: open 100+i, high +1.5, low -1, close +0.5 */
const UP = barsOf(Array.from({ length: 30 }, (_, i) => [100 + i, 101.5 + i, 99 + i, 100.5 + i]))
/** falling: open 200-i, high +1, low -1.5, close -0.5 (each open is BELOW the previous close) */
const DOWN = barsOf(Array.from({ length: 30 }, (_, i) => [200 - i, 201 - i, 198.5 - i, 199.5 - i]))
const ALL = () => true

// `minContract` is the run context's `syminfo.mincontract` (W9-T4 r1): 1 = a whole-unit symbol such as
// RDDT; null = the caller does not state it (every product caller today)
const attempt = (src, { bars = UP, pins = ALL, minContract = 1 } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
    historyWindowBars: 5000, ...(minContract === null ? {} : { minContract }) }
  try {
    // pins = 'ledger': no test predicate at all, so the run asks the COMMITTED ledger
    const res = execute(program, ctx, undefined, pins === 'ledger' ? undefined : { brokerPinned: pins })
    return { res, cols: res.outputs.map((o) => Array.from(o)), program }
  } catch (e) { return { err: e } }
}
const decl = (text, version) => {
  const built = buildRuntimeIr(`//@version=${version}\n${text}\nplot(strategy.position_size)\n`,
    { bars: UP, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
  return built.ir.broker
}
// enter at bar 3, close at bar 10, enter again at bar 15
const CYCLE = 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nif bar_index == 10\n    strategy.close("L")\n'
  + 'if bar_index == 15\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\nplot(strategy.equity)\n'

describe('W9-T4 the declaration: type and value reach the broker', () => {
  it('cash and percent are read as declared; fixed keeps defaultQty', () => {
    const cash = decl('strategy("t", default_qty_type = strategy.cash, default_qty_value = 10000)', 5)
    expect([cash.qtyType, cash.qtyValue, cash.defaultQty]).toEqual(['cash', 10000, null])
    const pct = decl('strategy("t", default_qty_type = strategy.percent_of_equity, default_qty_value = 10)', 5)
    expect([pct.qtyType, pct.qtyValue, pct.defaultQty]).toEqual(['percent_of_equity', 10, null])
    const fx = decl('strategy("t", default_qty_type = strategy.fixed, default_qty_value = 5)', 6)
    expect([fx.qtyType, fx.qtyValue, fx.defaultQty]).toEqual(['fixed', 5, 5])
  })
  it('the version defaults: v4 fixed 1 (hypothesis), v5 fixed 1 / 1,000,000 / margin 0, v6 percent 100 / 100,000 / margin 100', () => {
    expect(DECLARATION_DEFAULTS[4]).toEqual({ qtyType: 'fixed', qtyValue: 1, initialCapital: 100000, margin: 100 })
    const v4 = decl('strategy("t")', 4)
    expect([v4.qtyType, v4.defaultQty, v4.initialCapital, v4.marginLong, v4.marginShort]).toEqual(['fixed', 1, 100000, 100, 100])
    expect(v4.defaulted).toMatchObject({ qty: true, initialCapital: true, margin: true })
    const v5 = decl('strategy("t")', 5)
    expect([v5.qtyType, v5.defaultQty, v5.initialCapital, v5.marginLong, v5.marginShort]).toEqual(['fixed', 1, 1000000, 0, 0])
    const v6 = decl('strategy("t")', 6)
    expect([v6.qtyType, v6.qtyValue, v6.defaultQty, v6.initialCapital, v6.marginLong]).toEqual(['percent_of_equity', 100, null, 100000, 100])
  })
  it('an account currency other than NONE refuses at build, naming W9-D2', () => {
    const b = buildRuntimeIr('//@version=6\nstrategy("t", currency = currency.USD)\nplot(strategy.position_size)\n',
      { bars: UP, inputs: {}, symbol: SYMBOL, strategyBroker: true })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:strategy-option')
    expect(b.refusal.message).toMatch(/W9-D2/)
  })
  it('the record states the declared type and value', () => {
    const cfg = decl('strategy("t", default_qty_type = strategy.percent_of_equity, default_qty_value = 10)', 5)
    const recOf = (rulesUsed, d) => strategyRecordOf({ summary: { record: { trades: [], rulesUsed } }, decl: d,
      barTimes: [1], historyWindowBars: 5000, confirmed: true })
    expect(recOf(['B-QTY', 'B-VAL'], cfg).settings.default_qty).toEqual({ type: 'percent_of_equity', value: 10 })
    expect(recOf(['B-QTY'], { defaultQty: 3 }).settings.default_qty).toEqual({ type: 'fixed', value: 3 })
  })
  it('r1 P2: the record states no default size unless the run sized an order by it (asked B-QTY)', () => {
    const cfg = decl('strategy("t", default_qty_type = strategy.percent_of_equity, default_qty_value = 10)', 5)
    const rec = strategyRecordOf({ summary: { record: { trades: [], rulesUsed: ['B-VAL', 'B-MARKET'] } }, decl: cfg,
      barTimes: [1], historyWindowBars: 5000, confirmed: true })
    expect(rec.settings.default_qty).toBe(null)
    expect(strategyRecordOf({ summary: {}, decl: { defaultQty: 3 }, barTimes: [1], historyWindowBars: 5000, confirmed: true })
      .settings.default_qty).toBe(null)
    const recFor = (r) => strategyRecordOf({ summary: r.res.broker, decl: r.program.broker, barTimes: UP.map((b) => b.t),
      historyWindowBars: 5000, confirmed: true })
    // through real runs: an explicit qty never asks B-QTY, so the record names no default size
    const explicit = attempt('//@version=5\nstrategy("t", default_qty_type = strategy.cash, default_qty_value = 10000)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long, qty = 2)\nplot(strategy.position_size)\n')
    expect(recFor(explicit).settings.default_qty).toBe(null)
    const sized = attempt(`//@version=5\nstrategy("t", default_qty_type = strategy.cash, default_qty_value = 10000)\n${CYCLE}`)
    const b = recFor(sized)
    expect(b.settings.default_qty).toEqual({ type: 'cash', value: 10000 })
    expect(b.unserved['settings.currency']).toBe('W9-D2 (deferred)')
  })
})

describe('W9-T4 sizing, behind the test-only pin set (hand-computed)', () => {
  it('v5 cash 10000: floor(10000 / signal close)', () => {
    const { cols, err, res } = attempt(`//@version=5\nstrategy("t", default_qty_type = strategy.cash, default_qty_value = 10000)\n${CYCLE}`)
    expect(err).toBeUndefined()
    // bar 3 close 103.5: 10000 / 103.5 = 96.618 -> 96, filled at bar 4's open 104
    expect(cols[0][3]).toBe(0)
    expect(cols[0][4]).toBe(96)
    expect(cols[0][11]).toBe(0) // closed at bar 11's open 111
    // bar 15 close 115.5: 10000 / 115.5 = 86.58 -> 86 (cash does not grow with profit)
    expect(cols[0][16]).toBe(86)
    expect(res.broker.record.rulesUsed).toEqual(expect.arrayContaining(['B-QTY']))
  })
  it('v5 percent 10: floor(equity x 10% / signal close), equity at the signal close', () => {
    const { cols, err, res } = attempt(`//@version=5\nstrategy("t", default_qty_type = strategy.percent_of_equity, default_qty_value = 10)\n${CYCLE}`)
    expect(err).toBeUndefined()
    // equity at bar 3 = 1,000,000 (v5 default capital): 100,000 / 103.5 = 966.18 -> 966
    expect(cols[0][4]).toBe(966)
    // closed at 111: profit (111 - 104) x 966 = 6762; equity 1,006,762
    expect(cols[1][14]).toBe(1006762)
    // bar 15: 100,676.2 / 115.5 = 871.65 -> 871
    expect(cols[0][16]).toBe(871)
    expect(res.broker.record.rulesUsed).toEqual(expect.arrayContaining(['B-QTY', 'B-DEFAULTS'])) // the capital default
  })
  it('v6 with nothing declared: percent of equity 100 of 100,000', () => {
    const { cols, err, res } = attempt(`//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n`, { bars: DOWN })
    expect(err).toBeUndefined()
    // bar 3 close 196.5: 100,000 / 196.5 = 508.9 -> 508, filled at bar 4's open 196 (funds left: 100000 - 508 x 196 = 432)
    expect(cols[0][4]).toBe(508)
    expect(cols[0][29]).toBe(508)
    expect(res.broker.record.trades[0].entry.price).toBe(196)
    expect(res.broker.record.rulesUsed).toEqual(expect.arrayContaining(['B-QTY', 'B-DEFAULTS', 'B-MARGIN']))
  })
  // ⭐⭐ Q-S1i [B-FUNDS] (2026-11-16) — the shape w9-q-s1a-size-v6 witnesses (7 trades taken, 13 entries absent):
  // flat, long, a market entry at the v6 default (100% of equity), margin 100%. It is REJECTED: no trade, no smaller
  // size, and it is not kept waiting. ⚰️ This rail read "Q-S1i (margin calls deferred)" until the capture was read.
  const V6_ENTRY = '//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n'
  it('v6 percent 100, filled at an open ABOVE the signal close, needs more than the funds: the entry is rejected (B-FUNDS)', () => {
    // bar 3 close 103.5: 966 units; bar 4 opens 104: 966 x 104 = 100,464 > 100,000
    const { cols, err, res } = attempt(V6_ENTRY)
    expect(err).toBeUndefined()
    expect(cols[0].every((v) => v === 0)).toBe(true)
    const rec = res.broker.record
    expect(rec.trades).toEqual([])
    expect(rec.orders.map((o) => [o.kind, o.status, o.why, o.fillQty])).toEqual([['entry', 'rejected', 'funds', null]])
    expect(rec.rulesUsed).toEqual(expect.arrayContaining(['B-FUNDS', 'B-MARGIN', 'B-QTY']))
  })
  it('the rejected entry is not kept waiting: a later open the funds would carry fills nothing', () => {
    // bars 0-4 as UP (bar 3 close 103.5, bar 4 open 104: 966 x 104 = 100,464 > 100,000, rejected); from bar 5 the
    // open is 90, where a KEPT order of 966 would fill (966 x 90 = 86,940 <= 100,000)
    const GAP = barsOf(Array.from({ length: 12 }, (_, i) => (i < 5 ? [100 + i, 101.5 + i, 99 + i, 100.5 + i] : [90, 91, 89, 90])))
    const { cols, err, res } = attempt(V6_ENTRY, { bars: GAP })
    expect(err).toBeUndefined()
    expect(cols[0].every((v) => v === 0)).toBe(true)
    expect(res.broker.record.trades).toEqual([])
  })
  it('an entry within the funds is untouched by B-FUNDS (control: the same entry on falling bars fills)', () => {
    // bar 3 close 196.5: 508 units, bar 4 opens 196: 508 x 196 = 99,568 <= 100,000
    const { cols, err, res } = attempt(V6_ENTRY, { bars: DOWN })
    expect(err).toBeUndefined()
    expect(cols[0][4]).toBe(508)
    expect(res.broker.record.rulesUsed).not.toContain('B-FUNDS')
  })
  it('with B-FUNDS unpinned the run stops there by name, under the rule that will pin it', () => {
    const { err } = attempt(V6_ENTRY, { pins: (id) => id !== 'B-FUNDS' })
    expect(err && err.rule).toBe('B-FUNDS')
  })
  it('every shape the capture does not witness still stops at the funds by name (Q-S1i)', () => {
    const stopsAtFunds = (src, bars = UP) => {
      const { err } = attempt(src, { bars })
      expect(err && err.guard, src).toBe('runtime:strategy-unsettled')
      expect(err.message, src).toMatch(/Q-S1i/)
    }
    // ⚰️ a SHORT at the v6 default (966 x 104 = 100,464 > 100,000) stood here until w9-q-s1i-short-v6 was read
    // (2026-11-17): it is rejected now, under B-FUNDS-SHORT (the next rails); a short with an explicit qty is not
    stopsAtFunds('//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("S", strategy.short, qty = 966)\nplot(strategy.position_size)\n')
    // an EXPLICIT qty past the funds (the size is not the default)
    stopsAtFunds('//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("L", strategy.long, qty = 966)\nplot(strategy.position_size)\n')
    // a CASH default past the funds: floor(101,000 / 103.5) = 975, 975 x 104 = 101,400 > 100,000
    stopsAtFunds('//@version=6\nstrategy("t", default_qty_type = strategy.cash, default_qty_value = 101000)\nif bar_index == 3\n'
      + '    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    // a percent default other than 100: bar 3 closes 100, bar 4 opens 110; floor(99,000 / 100) = 990,
    // 990 x 110 = 108,900 > 100,000 (margin 100)
    const JUMP = barsOf(Array.from({ length: 10 }, (_, i) => (i < 4 ? [100, 101, 99, 100] : [110, 111, 109, 110])))
    stopsAtFunds('//@version=6\nstrategy("t", default_qty_value = 99)\nif bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n', JUMP)
    // the same 100% default at a declared margin of 50 never comes short (966 x 104 x 0.5 = 50,232): it fills
    const half = attempt('//@version=6\nstrategy("t", margin_long = 50, margin_short = 50)\nif bar_index == 3\n'
      + '    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(half.err).toBeUndefined()
    expect(half.cols[0][4]).toBe(966)
  })
  // ⭐⭐ Q-S1i [B-FUNDS-SHORT] (2026-11-17) — the SHORT twin, witnessed by w9-q-s1i-short-v6 (9 short entries taken,
  // the 11 whose qty x fill open exceeded the equity absent, none filled and margin-called at its open)
  const V6_SHORT = '//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("S", strategy.short)\nplot(strategy.position_size)\n'
  it('v6 percent 100, a SHORT filled at an open ABOVE the signal close past the funds: rejected (B-FUNDS-SHORT), not margin-called', () => {
    // bar 3 close 103.5: 966 units; bar 4 opens 104: 966 x 104 = 100,464 > 100,000
    const { cols, err, res } = attempt(V6_SHORT)
    expect(err).toBeUndefined()
    expect(cols[0].every((v) => v === 0)).toBe(true)
    const rec = res.broker.record
    expect(rec.trades).toEqual([])
    expect(rec.orders.map((o) => [o.kind, o.status, o.why])).toEqual([['entry', 'rejected', 'funds']])
    expect(rec.rulesUsed).toEqual(expect.arrayContaining(['B-FUNDS-SHORT', 'B-MARGIN']))
    expect(rec.rulesUsed).not.toContain('B-FUNDS')
    expect(rec.rulesUsed).not.toContain('B-MARGIN-CALL')
  })
  it('with B-FUNDS-SHORT unpinned the short stops there by name; B-FUNDS alone never serves it', () => {
    const { err } = attempt(V6_SHORT, { pins: (id) => id !== 'B-FUNDS-SHORT' })
    expect(err && err.rule).toBe('B-FUNDS-SHORT')
  })
  it('v4 with no value declared: one unit (the hypothesis Q-S1a size-v4 grades)', () => {
    // (ruling D12: a v4 strategy states both margins, or stops at bind; the SIZE default is what this rail holds)
    const { cols, err, res } = attempt('//@version=4\nstrategy("t", margin_long = 100, margin_short = 100)\nstrategy.entry("L", true, when = bar_index == 3)\nplot(strategy.position_size)\n')
    expect(err).toBeUndefined()
    expect(cols[0][4]).toBe(1)
    expect(res.broker.record.rulesUsed).toEqual(expect.arrayContaining(['B-QTY', 'B-DEFAULTS']))
  })
  it('v5 margin 0 (the default) sets no limit: 100,000 of a 1,000,000 account at 10x the size still fills', () => {
    const { cols, err } = attempt('//@version=5\nstrategy("t", default_qty_value = 9000)\nif bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(err).toBeUndefined()
    expect(cols[0][4]).toBe(9000) // 9000 x 104 = 936,000 < 1,000,000; and margin 0 limits nothing anyway
  })
  it('margin 50 (W9-D1 margin50): twice the funds fill, three times do not', () => {
    // initial 100,000, margin 50: Available = equity - MVS x 0.5. 1900 x 104 x 0.5 = 98,800 (fills);
    const ok = attempt('//@version=6\nstrategy("t", default_qty_type = strategy.fixed, default_qty_value = 1900, margin_long = 50, margin_short = 50)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(ok.err).toBeUndefined()
    expect(ok.cols[0][4]).toBe(1900)
    // 2000 x 104 x 0.5 = 104,000 > 100,000: refused by name
    const no = attempt('//@version=6\nstrategy("t", default_qty_type = strategy.fixed, default_qty_value = 2000, margin_long = 50, margin_short = 50)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(no.err.message).toMatch(/Q-S1i/)
  })
  it('an explicit qty never asks the sizing rule', () => {
    const { cols, res } = attempt('//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("L", strategy.long, qty = 3)\nplot(strategy.position_size)\n')
    expect(cols[0][4]).toBe(3)
    expect(res.broker.record.rulesUsed).not.toContain('B-QTY')
  })
  it('a whole result is not floored one unit short by binary rounding', () => {
    // 9000.9 / 100.01 is exactly 90, and is 89.99999999999999 in binary floating point
    const FLAT = barsOf(Array.from({ length: 10 }, () => [100, 101, 99, 100.01]))
    const { cols, err } = attempt('//@version=5\nstrategy("t", default_qty_type = strategy.cash, default_qty_value = 9000.9)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n', { bars: FLAT })
    expect(err).toBeUndefined()
    expect(cols[0][4]).toBe(90)
  })
  it('a defaulted size alone asks B-DEFAULTS (capital, margin and pyramiding all declared)', () => {
    const src = '//@version=6\nstrategy("t", initial_capital = 100000, margin_long = 100, margin_short = 100, pyramiding = 1)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n'
    const full = attempt(src, { bars: DOWN })
    expect(full.err).toBeUndefined()
    expect(full.cols[0][4]).toBe(508)
    expect(full.res.broker.record.rulesUsed).toContain('B-DEFAULTS')
    const { err } = attempt(src, { bars: DOWN, pins: (id) => id !== 'B-DEFAULTS' })
    expect(err && err.rule).toBe('B-DEFAULTS')
  })
})

describe('W9-T4 what the sizing hypothesis does not reach refuses by name (Q-S1a)', () => {
  const stop = (src, bars, o = {}) => {
    const r = attempt(src, { bars, ...o })
    expect(r.err, 'the run did not stop').toBeDefined()
    expect(r.err.guard).toBe('runtime:strategy-unsettled')
    expect(r.err.message).toMatch(/Q-S1a/)
    return r.err
  }
  it('a percent order placed while a trade is open', () => {
    const e = stop('//@version=5\nstrategy("t", pyramiding = 2, default_qty_type = strategy.percent_of_equity, default_qty_value = 10)\n'
      + 'if bar_index == 3 or bar_index == 6\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(e.message).toMatch(/available equity/)
  })
  it('a limit entry with a cash default', () => {
    const e = stop('//@version=5\nstrategy("t", default_qty_type = strategy.cash, default_qty_value = 10000)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long, limit = 100)\nplot(strategy.position_size)\n')
    expect(e.message).toMatch(/limit entry/)
  })
  it('a size below one whole unit', () => {
    const e = stop('//@version=5\nstrategy("t", default_qty_type = strategy.cash, default_qty_value = 50)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(e.message).toMatch(/less than one whole unit/)
  })
  it('a percent above 100', () => {
    const e = stop('//@version=5\nstrategy("t", default_qty_type = strategy.percent_of_equity, default_qty_value = 150)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(e.message).toMatch(/more than 100/)
  })
  const SIZE_DECLS = ['default_qty_type = strategy.cash, default_qty_value = 10000',
    'default_qty_type = strategy.percent_of_equity, default_qty_value = 10']
  for (const [what, mc, says, fractional] of [
    ['a fractional symbol (mincontract 0.001)', 0.001, /minimum contract is 0\.001, not 1 \(a fractional symbol/, true],
    ['a symbol whose minimum contract the run was not told', null, /minimum contract is not known to this run/, true],
    // W9-T4-F1 (review r1 note): a lot of MORE than one unit is not "fractional"
    ['a lot-sized symbol (mincontract 100)', 100, /minimum contract is 100, not 1 \(this symbol trades in lots of 100 units/,
      false],
  ]) {
    it(`r1 P1: ${what} is never floored to whole units`, () => {
      for (const d of SIZE_DECLS) {
        const e = stop(`//@version=5\nstrategy("t", ${d})\nif bar_index == 3\n    strategy.entry("L", strategy.long)\n`
          + 'plot(strategy.position_size)\n', UP, { minContract: mc })
        expect(e.message).toMatch(says)
        expect(e.message).toMatch(/Q-S1a/)
        if (fractional) expect(e.message).toMatch(/such as a cryptocurrency/)
        else expect(e.message).not.toMatch(/fractional|cryptocurrency/)
      }
    })
  }
  it('r1 P1: the control, mincontract 1, sizes (cash 96, percent 966)', () => {
    const sizes = SIZE_DECLS.map((d) => attempt(`//@version=5\nstrategy("t", ${d})\nif bar_index == 3\n`
      + '    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n', { minContract: 1 }).cols[0][4])
    expect(sizes).toEqual([96, 966])
  })
  it('r1 P1: a fixed default size does not need the minimum contract', () => {
    const { cols, err } = attempt('//@version=5\nstrategy("t", default_qty_value = 3)\nif bar_index == 3\n'
      + '    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n', { minContract: null })
    expect(err).toBeUndefined()
    expect(cols[0][4]).toBe(3)
  })
})

describe('W9-T4 r1 P3: the point value divides the money (direct broker, pointvalue 50)', () => {
  // mintick 0.25, pointvalue 50 (a futures-like symbol) over the UP bars; sized at bar 3's close 103.5
  const series = ['o', 'h', 'l', 'c'].map((k) => UP.map((b) => b[k]))
  const runDirect = (cfg) => {
    const b = makeBroker({ pyramiding: 0, initialCapital: 1000000, marginLong: 0, marginShort: 0, defaulted: {}, ...cfg },
      { series, barTimes: UP.map((x) => x.t), isPinned: ALL, minContract: 1 })
    const size = []
    for (let bar = 0; bar < 8; bar += 1) {
      b.beginBar(bar)
      b.call('#symbol', [0.25, 50], bar)
      if (bar === 3) b.call('strategy.entry', ['L', 1, undefined, undefined, undefined, undefined], bar)
      size.push(b.call('strategy.position_size', [], bar))
    }
    return size
  }
  it('cash 100,000: floor(100,000 / (103.5 x 50)) = floor(19.32) = 19', () => {
    expect(runDirect({ qtyType: 'cash', qtyValue: 100000, defaultQty: null })[4]).toBe(19)
  })
  it('percent 10 of 1,000,000: floor(100,000 / (103.5 x 50)) = 19', () => {
    expect(runDirect({ qtyType: 'percent_of_equity', qtyValue: 10, defaultQty: null })[4]).toBe(19)
  })
})

describe('W9-T4 r1 P1 / W9-T4-F1: one product source states the minimum contract', () => {
  // W9-T4-F1: `runtimeColumns.js` now names it ONCE, derived from the symbol's witnessed row
  // (`minContractLock.test.js` holds the rest of the lock: no caller, wire or route can state it)
  it('RAIL: `minContract` is named in vm.js (read from ctx), broker.js and runtimeColumns.js only', () => {
    const root = path.resolve(__dirname, '../../..')
    const hits = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(f); continue }
        if (!/\.(jsx?|mjs)$/.test(e.name) || /\.test\./.test(e.name)) continue
        if (/\bminContract\b/.test(fs.readFileSync(f, 'utf8'))) hits.push(e.name)
      }
    }
    walk(root)
    expect(hits.sort()).toEqual(['broker.js', 'runtimeColumns.js', 'vm.js'])
    expect(fs.readFileSync(path.resolve(__dirname, '../vm.js'), 'utf8')).toMatch(/minContract: ctx\.minContract/)
  })
})

describe('W9-T4 pin before serve (D1): nothing T4 adds serves without its pin', () => {
  const SIZED = {
    cash: `//@version=5\nstrategy("t", default_qty_type = strategy.cash, default_qty_value = 10000)\n${CYCLE}`,
    percent: `//@version=5\nstrategy("t", default_qty_type = strategy.percent_of_equity, default_qty_value = 10)\n${CYCLE}`,
    v6: '//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n',
    v4: '//@version=4\nstrategy("t", margin_long = 100, margin_short = 100)\nstrategy.entry("L", true, when = bar_index == 3)\nplot(strategy.position_size)\n',
  }
  const BARS = { v6: DOWN }
  it('the committed ledger pins every T4 rule (every capture that exercises it MATCHes)', () => {
    for (const r of ['B-QTY', 'B-DEFAULTS', 'B-MARGIN']) expect(Object.keys(RESOLVED.rules)).toContain(r)
    expect(BROKER_RULES['B-QTY'].capture).toBe('Q-S1a')
    expect(BROKER_RULES['B-DEFAULTS'].capture).toBe('Q-S1b')
  })
  for (const [name, src] of Object.entries(SIZED)) {
    it(`${name}: with the committed ledger the run completes (every T4 rule the run exercises is pinned)`, () => {
      const { err, res } = attempt(src, { bars: BARS[name], pins: 'ledger' })
      expect(err, err && err.message).toBeUndefined()
      expect(res.broker.record.rulesUsed).toContain('B-QTY')
    })
    it(`${name}: every rule the run used, unpinned alone, stops it naming THAT rule`, () => {
      const full = attempt(src, { bars: BARS[name] })
      expect(full.err).toBeUndefined()
      const used = full.res.broker.record.rulesUsed
      expect(used).toContain('B-QTY')
      for (const rule of used) {
        const { err } = attempt(src, { bars: BARS[name], pins: (id) => id !== rule })
        expect(err && err.guard, rule).toBe('runtime:strategy-unpinned')
        expect(err.rule).toBe(rule)
      }
    })
  }
  it('B-QTY alone unpinned: the sizing stop names B-QTY and its capture row Q-S1a', () => {
    const { err } = attempt(SIZED.percent, { pins: (id) => id !== 'B-QTY' })
    expect(err.rule).toBe('B-QTY')
    expect(err.message).toMatch(/Q-S1a/)
  })
  // T4 adds no rule (it builds behind B-QTY): the count is derived, never typed here (the vocabulary's
  // size is pinned once, in strategiesAreRuled.test.js)
  it('the D7 scorecard is unchanged by T4: 0 of every named rule, derived', () => {
    expect(BROKER_RULE_IDS).toContain('B-QTY')
    expect(strategyScorecardWording()).not.toBe(strategyScorecardWording({ ledger: { rules: {} } }))
    expect(strategyScorecardWording()).toMatch(new RegExp(`^47 of ${BROKER_RULE_IDS.length} broker rules are pinned`))
  })
})

describe('W9-T4 the member door (gate on, committed ledger)', () => {
  afterEach(() => registerStrategyBrokerGate(() => false))
  const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL, historyWindowBars: 30 }
  let seq = 0
  const doc = (source) => ({ id: `w9t4-${seq += 1}`, meta: { runtimeHistory: 'strategy-window' },
    compute: { kind: 'runtime', fn: `runtime:w9t4-${seq}`, outputs: { p: 0 }, source } })
  const door = (src) => {
    registerStrategyBrokerGate(() => true)
    try { return { cols: computeRuntimeColumns(doc(src), UP, CTX) } } catch (err) { return { err } }
  }
  // A default percent-of-equity size (declared at v5, the v6 default): B-QTY and B-DEFAULTS are pinned, so
  // the run no longer stops as unpinned. This door derives the symbol's minimum contract from the witnessed
  // table (`symbolScope.json::min_contract`), which holds NYSE = 1 since 2026-11-16 (the capture of the committed
  // probe on NYSE:RDDT). ⚰️ Both shapes below stopped at Q-S1a (the minimum contract unknown) until then; an
  // exchange with no row still does (`w9MinContractSource.test.js`, NASDAQ:AAPL in its own table).
  it('a declared 10% size on NYSE:RDDT sizes and the run completes (the minimum contract is witnessed)', () => {
    const { err, cols } = door(`//@version=5\nstrategy("t", default_qty_type = strategy.percent_of_equity, default_qty_value = 10)\n${CYCLE}`)
    expect(err, err && err.message).toBeUndefined()
    expect(cols).toBeTruthy()
  })
  // ⚰️ This stopped at the funds by name (Q-S1i) until w9-q-s1a-size-v6 was read (2026-11-16): TradingView rejects
  // the entry. B-FUNDS is pinned by that capture's MATCH, so the member's run completes with the entry rejected.
  it('the v6 default (100% of equity) sized on the signal close and filled at a higher open is rejected (B-FUNDS, pinned): the run completes', () => {
    expect(RESOLVED.rules['B-FUNDS']).toEqual(['w9-q-s1a-size-v6-rddt-1d-2026-11-15'])
    const { err, cols } = door('//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(err, err && err.message).toBeUndefined()
    expect(cols).toBeTruthy()
  })
  // ⚰️ This stopped at the funds by name (Q-S1i) until w9-q-s1i-short-v6 was read (2026-11-17): TradingView rejects
  // the short too. B-FUNDS-SHORT is pinned by that capture's MATCH, so the member's run completes with it rejected.
  it('a short past the funds at the same default is rejected (B-FUNDS-SHORT, pinned): the run completes', () => {
    // (+ w9-q-s1b-defaults-v6, the reversal slice, 2026-11-17: its flat shorts past the funds are absent too)
    expect(RESOLVED.rules['B-FUNDS-SHORT']).toEqual(['w9-q-s1b-defaults-v6-rddt-1d-2026-11-15', 'w9-q-s1i-short-v6-rddt-1d-2026-11-16'])
    const { err, cols } = door('//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("S", strategy.short)\nplot(strategy.position_size)\n')
    expect(err, err && err.message).toBeUndefined()
    expect(cols).toBeTruthy()
  })
  it('a short past the funds with an explicit size still stops at the funds, by name (Q-S1i), never a pin', () => {
    const { err } = door('//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("S", strategy.short, qty = 966)\nplot(strategy.position_size)\n')
    expect(err && err.guard).toBe('runtime:strategy-unsettled')
    expect(err.probe).toBe('Q-S1i')
    expect(err.message).not.toMatch(/is not pinned by a matching TradingView capture/)
  })
  it('a fixed size, every rule it exercises pinned: the run completes', () => {
    const { err, cols } = door(`//@version=6\nstrategy("t", default_qty_type = strategy.fixed, default_qty_value = 1)\n${CYCLE}`)
    expect(err, err && err.message).toBeUndefined()
    expect(cols).toBeTruthy()
  })
  // ⭐ D1's point, kept with an UNPINNED rule as its subject. ⚰️ The subject was B-PYR (the same fixed-size script
  // with one add under `pyramiding = 2`) until w9-q-s1b-defaults-v6 and w9-d11-late-first-use-rpt pinned it
  // (2026-11-17): that add now completes, and a partial close (B-CLOSE-QTY, row W9-X2) is the unpinned subject.
  it('a pyramid add under `pyramiding = 2` completes now that B-PYR is pinned', () => {
    expect(Object.keys(RESOLVED.rules)).toContain('B-PYR')
    const { err, cols } = door('//@version=6\nstrategy("t", default_qty_type = strategy.fixed, default_qty_value = 1, pyramiding = 2)\n'
      + 'if bar_index == 3 or bar_index == 5\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n')
    expect(err, err && err.message).toBeUndefined()
    expect(cols).toBeTruthy()
  })
  it('a rule the ledger does not pin still refuses runtime:strategy-unpinned by name (B-CLOSE-QTY)', () => {
    expect(Object.keys(RESOLVED.rules)).not.toContain('B-CLOSE-QTY')
    const { err } = door('//@version=6\nstrategy("t", default_qty_type = strategy.fixed, default_qty_value = 2)\n'
      + 'if bar_index == 3\n    strategy.entry("L", strategy.long)\nif bar_index == 6\n    strategy.close("L", qty = 1)\n'
      + 'plot(strategy.position_size)\n')
    expect(err && err.guard).toBe('runtime:strategy-unpinned')
    expect(err.rule).toBe('B-CLOSE-QTY')
    expect(err.message).toMatch(/is not pinned by a matching TradingView capture/)
  })
})

describe('W9-T4 readStrategyDeclaration (unit)', () => {
  it('a declaration with no qty type takes the version default type', () => {
    const call = { args: [{ name: 'default_qty_value', value: { type: 'number', value: 25 } }] }
    const v6 = readStrategyDeclaration(call, 6)
    expect([v6.qtyType, v6.qtyValue, v6.defaultQty]).toEqual(['percent_of_equity', 25, null])
    expect(v6.defaulted.qty).toBe(true)
  })
})
