// W9-T4 rails: sizing (fixed, cash, percent of equity), the version defaults, capital and margin.
//
// ⛔ EVERY RULE HERE IS UNPINNED (ruling D1). The committed ledger pins nothing, so on the member door
// every one of these scripts refuses `runtime:strategy-unpinned` by name. The behaviour rails below run
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
  it('v6 percent 100, filled at an open ABOVE the signal close, needs more than the funds: Q-S1i (margin calls deferred)', () => {
    // bar 3 close 103.5: 966 units; bar 4 opens 104: 966 x 104 = 100,464 > 100,000
    const { err } = attempt(`//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n`)
    expect(err.guard).toBe('runtime:strategy-unsettled')
    expect(err.message).toMatch(/Q-S1i/)
  })
  it('v4 with no value declared: one unit (the hypothesis Q-S1a size-v4 grades)', () => {
    const { cols, err, res } = attempt('//@version=4\nstrategy("t")\nstrategy.entry("L", true, when = bar_index == 3)\nplot(strategy.position_size)\n')
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
    v4: '//@version=4\nstrategy("t")\nstrategy.entry("L", true, when = bar_index == 3)\nplot(strategy.position_size)\n',
  }
  const BARS = { v6: DOWN }
  it('the committed ledger pins none of the T4 rules', () => {
    for (const r of ['B-QTY', 'B-DEFAULTS', 'B-MARGIN']) expect(Object.keys(RESOLVED.rules)).not.toContain(r)
    expect(BROKER_RULES['B-QTY'].capture).toBe('Q-S1a')
    expect(BROKER_RULES['B-DEFAULTS'].capture).toBe('Q-S1b')
  })
  for (const [name, src] of Object.entries(SIZED)) {
    it(`${name}: with the real ledger the run refuses runtime:strategy-unpinned by name`, () => {
      const { err } = attempt(src, { bars: BARS[name], pins: 'ledger' })
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(BROKER_RULE_IDS).toContain(err.rule)
      expect(err.message).toContain(err.rule)
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
    expect(strategyScorecardWording()).toBe(strategyScorecardWording({ ledger: { rules: {} } }))
    expect(strategyScorecardWording()).toMatch(new RegExp(`^0 of ${BROKER_RULE_IDS.length} broker rules are pinned`))
  })
})

describe('W9-T4 the member door (gate on, committed ledger)', () => {
  afterEach(() => registerStrategyBrokerGate(() => false))
  const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: SYMBOL, historyWindowBars: 30 }
  let seq = 0
  const doc = (source) => ({ id: `w9t4-${seq += 1}`, meta: { runtimeHistory: 'strategy-window' },
    compute: { kind: 'runtime', fn: `runtime:w9t4-${seq}`, outputs: { p: 0 }, source } })
  for (const src of [
    `//@version=5\nstrategy("t", default_qty_type = strategy.percent_of_equity, default_qty_value = 10)\n${CYCLE}`,
    '//@version=6\nstrategy("t")\nif bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n',
  ]) {
    it(`refuses runtime:strategy-unpinned by name: ${src.split('\n')[1]}`, () => {
      registerStrategyBrokerGate(() => true)
      let err
      try { computeRuntimeColumns(doc(src), UP, CTX) } catch (e) { err = e }
      expect(err && err.guard).toBe('runtime:strategy-unpinned')
      expect(err.message).toMatch(/is not pinned by a matching TradingView capture/)
    })
  }
})

describe('W9-T4 readStrategyDeclaration (unit)', () => {
  it('a declaration with no qty type takes the version default type', () => {
    const call = { args: [{ name: 'default_qty_value', value: { type: 'number', value: 25 } }] }
    const v6 = readStrategyDeclaration(call, 6)
    expect([v6.qtyType, v6.qtyValue, v6.defaultQty]).toEqual(['percent_of_equity', 25, null])
    expect(v6.defaulted.qty).toBe(true)
  })
})
