// app/src/components/chart/engine/runtime/__tests__/w9T13aReportParity.test.js
//
// W9-T13a parity rail: ONE ARITHMETIC. A real broker run (through `computeRuntimeColumns`)
// plots the broker's own `strategy.netprofit` / `grossprofit` / `grossloss` / `wintrades` /
// `losstrades` / `closedtrades` / `opentrades`; the report computed from the SAME run's record must
// equal the last bar of each, exactly. If the report's formula and the broker's ever drift, this
// goes red (and it is what proves the record's new `symbol` / `exact` fields are populated by
// a real run, not only by hand fixtures).
//
// ⛔ PINS: the committed ledger pins nothing, so this run mocks the ledger reader here, in the
// test, as `w9T11Record.test.js` does. No product code takes a pin set.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../brokerPins.js', () => ({ pinned: () => true }))
vi.setConfig({ testTimeout: 120000 })

import { computeRuntimeColumns } from '../runtimeColumns.js'
import { registerStrategyBrokerGate } from '../../strategyBrokerGateRegistry.js'
import { resetRuntimeAsync } from '../runtimeAsync.js'
import { STRATEGY_WINDOW_HISTORY, runtimeStrategyOf, strategyRecordShapeErrors } from '../strategyRecord.js'
import { strategyReportOf } from '../brokerReport.js'

const NL = String.fromCharCode(10)
const BARS = Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100 + i, h: 101.5 + i, l: 99 + i, c: 100.5 + i, v: 1000 }))
// short 1 filled at bar 4's open (104), closed at bar 11's open (111): -7
// long 1 filled at bar 13's open (113), closed at bar 19's open (119): +6
// long 1 filled at bar 21's open (121): open at the end
const SRC = ['//@version=5', 'strategy("t")',
  'if bar_index == 3', '    strategy.entry("S", strategy.short)',
  'if bar_index == 10', '    strategy.close("S")',
  'if bar_index == 12', '    strategy.entry("L", strategy.long)',
  'if bar_index == 18', '    strategy.close("L")',
  'if bar_index == 20', '    strategy.entry("L2", strategy.long)',
  'plot(strategy.netprofit)', 'plot(strategy.grossprofit)', 'plot(strategy.grossloss)',
  'plot(strategy.wintrades)', 'plot(strategy.losstrades)', 'plot(strategy.closedtrades)', 'plot(strategy.opentrades)', ''].join(NL)
const OUT = { net: 0, gp: 1, gl: 2, win: 3, loss: 4, closed: 5, open: 6 }

afterEach(() => { registerStrategyBrokerGate(() => false); resetRuntimeAsync() })

describe('W9-T13a report = broker, one arithmetic', () => {
  it('the report from a real run\'s record equals the broker\'s own strategy.* values on the last bar', () => {
    registerStrategyBrokerGate(() => true)
    const doc = { id: 'w9t13a-parity', meta: { runtimeHistory: STRATEGY_WINDOW_HISTORY },
      compute: { kind: 'runtime', fn: 'runtime:w9t13a-parity', outputs: OUT, source: SRC } }
    const cols = computeRuntimeColumns(doc, BARS, { tf: 'D', newestBarIsForming: false, historyFromListing: true,
      symbol: { ticker: 'RDDT', exchange: 'NYSE' }, historyWindowBars: 30 })
    const rec = runtimeStrategyOf(cols)
    expect(strategyRecordShapeErrors(rec)).toEqual([])
    expect(rec.symbol.pointvalue).not.toBe(null)
    expect(rec.symbol.mintick).not.toBe(null)
    expect(rec.trades.map((t) => [t.entryId, t.open, t.exact])).toEqual([['S', false, true], ['L', false, true], ['L2', true, true]])
    const last = (k) => cols[k][BARS.length - 1]
    const rep = strategyReportOf(rec)
    const v = (k) => rep.metrics[k].value
    expect(v('netProfit')).toBe(last('net'))
    expect(v('grossProfit')).toBe(last('gp'))
    expect(v('grossLoss')).toBe(last('gl'))
    expect(v('numberWinningTrades')).toBe(last('win'))
    expect(v('numberLosingTrades')).toBe(last('loss'))
    expect(v('totalClosedTrades')).toBe(last('closed'))
    expect(v('totalOpenTrades')).toBe(last('open'))
    // and the hand numbers (pointvalue 1 on this symbol): -7 + 6
    expect([v('netProfit'), v('grossProfit'), v('grossLoss')]).toEqual([-1 * rec.symbol.pointvalue, 6 * rec.symbol.pointvalue, 7 * rec.symbol.pointvalue])
  })
})
