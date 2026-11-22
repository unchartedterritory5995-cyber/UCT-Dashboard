// app/src/components/chart/builder/memberPane/w9ArmedRoute.test.js
//
// W9 ARMED ROUTE (coordinator ruling 2026-11-16) — with the DARK broker flag on, EVERY strategy that places
// orders is run by the broker, not only the ones whose outputs read a `strategy.*` value: a strategy's value to
// a member is its trades. And a tester-only strategy (no plot) attaches with its trades as its output instead of
// refusing "nothing to draw". With the flag OFF the door is exactly as before. Asserted on what the door hands the
// chart (the document, its run's record, the markers outcome), through the real door, binder-free.
//
// ⛔ THE REAL PIN LEDGER, NO MOCK: the run below exercises only rules the committed ledger pins, which is the
// point (a member's armed run of this script would serve). A rule the ledger stops pinning turns it red here.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.setConfig({ testTimeout: 120000 })

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { STRATEGY_WINDOW_HISTORY, runtimeStrategyOf, strategyRecordShapeErrors } from '../../engine/runtime/strategyRecord'
import { drawsTradeMarkers, memberTradeMarkers } from '../../engine/runtime/tradeMarkers'
import { buildRuntimeIr } from '../../engine/ast/pineRuntimeFrontend'
import { runtimeClockOpts } from '../../engine/ast/pineRuntimeClock'
import { armedStrategyVerdict } from '../../engine/runtime/__tests__/strategyArmed.js'

const NL = String.fromCharCode(10)
const ID = 'u_w9-armed-route'
// a strategy that places orders and whose only plot reads NO strategy value (the 16 the door drew clean)
const PLOTS = ['//@version=5', 'strategy("t", overlay = true)', 'if bar_index == 3', '    strategy.entry("L", strategy.long, qty = 1)',
  'if bar_index == 8', '    strategy.close("L")', 'plot(ta.sma(close, 3), "sma")', ''].join(NL)
// a tester-only strategy: orders and nothing else (the 20 that refused `pine:no-output`)
const TESTER = ['//@version=5', 'strategy("t")', 'if bar_index == 3', '    strategy.entry("L", strategy.long, qty = 1)',
  'if bar_index == 8', '    strategy.close("L")', ''].join(NL)
// a risk command the broker refuses at build (`strategyBroker.js`: max_intraday_loss has no probe)
const REFUSED = PLOTS.replace('plot(', 'strategy.risk.max_intraday_loss(2, strategy.percent_of_equity)' + NL + 'plot(')
// a repaint-class input (rule 11) in a strategy whose plots read no strategy value
const REPAINT = PLOTS.replace('plot(ta.sma(close, 3), "sma")', 'plot(barstate.isconfirmed ? close : open, "c")')
const BARS = Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000 }))
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' }, historyWindowBars: 30 }
const flags = (broker) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  if (broker) vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
}
const door = (source) => memberPaneDefinition({ source, id: ID, name: 'T' })
const runOf = (def) => {
  const { installed, errors } = registry.installUserDefinitions([def])
  expect(errors).toEqual([])
  return computeRuntimeColumns(installed[0], BARS, CTX)
}

afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

describe('W9 armed route: the front end', () => {
  it('broker OFF: an order-placing strategy builds as before, orders skipped, no broker', () => {
    const b = buildRuntimeIr(PLOTS, { bars: BARS, inputs: {}, symbol: CTX.symbol, strategyBroker: false })
    expect(b.ok).toBe(true)
    expect(b.ir.broker).toBe(null)
    expect(b.brokerDeclined).toBeUndefined()
  })

  it('broker ON: the same strategy is built by the broker though no output reads it', () => {
    const b = buildRuntimeIr(PLOTS, { bars: BARS, inputs: {}, symbol: CTX.symbol, strategyBroker: true })
    expect(b.ok).toBe(true)
    expect(b.ir.broker && b.ir.broker.version).toBe(5)
  })

  it('broker ON: a tester-only strategy builds (its orders are its output), off it refuses as before', () => {
    expect(buildRuntimeIr(TESTER, { bars: BARS, inputs: {}, symbol: CTX.symbol, strategyBroker: false }).refusal.guard).toBe('runtime:no-output')
    const b = buildRuntimeIr(TESTER, { bars: BARS, inputs: {}, symbol: CTX.symbol, strategyBroker: true })
    expect(b.ok).toBe(true)
    expect(b.ir.broker).toBeTruthy()
    expect(b.ir.outputs).toEqual([])
  })

  it('⛔ broker ON, broker refuses: the plain build stands (as with the broker dark) and names why', () => {
    const b = buildRuntimeIr(REFUSED, { bars: BARS, inputs: {}, symbol: CTX.symbol, strategyBroker: true })
    expect(b.ok).toBe(true)
    expect(b.ir.broker).toBe(null)
    expect(b.brokerDeclined.guard).toBe('runtime:strategy-option')
    // (a closed series: `barstate.isconfirmed` is settled, so the plain build stands)
    const r = buildRuntimeIr(REPAINT, { bars: BARS, inputs: {}, symbol: CTX.symbol, strategyBroker: true, ...runtimeClockOpts(false) })
    expect(r.ok).toBe(true)
    expect(r.ir.broker).toBe(null)
    expect(r.brokerDeclined.guard).toBe('runtime:strategy-repaint')
  })

  it('⛔ W9 rule 4: the C18 object door never reaches broker mode by the new route either', () => {
    const b = buildRuntimeIr(PLOTS, { bars: BARS, inputs: {}, symbol: CTX.symbol, strategyBroker: true, objectDoor: true })
    expect(b.ok).toBe(true)
    expect(b.ir.broker).toBe(null)
  })

  it('⛔ an indicator is never routed to the broker', () => {
    const b = buildRuntimeIr(['//@version=5', 'indicator("i")', 'plot(close)', ''].join(NL), { bars: BARS, inputs: {}, symbol: CTX.symbol, strategyBroker: true })
    expect(b.ok).toBe(true)
    expect(b.ir.broker).toBe(null)
    expect(b.brokerDeclined).toBeUndefined()
  })
})

describe('W9 armed route: the member door', () => {
  it('broker OFF: the strategy is the host document it always was (plots drawn, orders skipped)', () => {
    flags(false)
    const d = door(PLOTS)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.kind).not.toBe('runtime')
    expect(drawsTradeMarkers(d.definition)).toBe(false)
  })

  it('⭐ broker ON: the strategy is run by the broker; its record holds the trade, every rule pinned', () => {
    flags(true)
    const d = door(PLOTS)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.meta.runtimeHistory).toBe(STRATEGY_WINDOW_HISTORY)
    expect(drawsTradeMarkers(d.definition)).toBe(true)
    const cols = runOf(d.definition)
    const rec = runtimeStrategyOf(cols)
    expect(strategyRecordShapeErrors(rec)).toEqual([])
    expect(rec.trades.map((t) => [t.entryTime, t.exitTime, t.qty])).toEqual([[BARS[4].t, BARS[9].t, 1]])
    // its trades are disclosed by name until MK-LOOK pins (W9-MK1)
    const mk = memberTradeMarkers(cols)
    expect(mk.status).toBe('refused')
    expect(mk.capture).toBe('W9-MK1')
    // and the plot it draws is the same plot the host document draws
    expect(d.rows.map((r) => r.label)).toEqual(['sma'])
  })

  it('⭐ broker ON: a tester-only strategy attaches on the price pane with no visible row, and its run trades', () => {
    flags(true)
    const d = door(TESTER)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.meta.runtimeHistory).toBe(STRATEGY_WINDOW_HISTORY)
    expect(d.definition.placement.target).toBe('price')
    expect(d.definition.plots.every((p) => p.hidden === true)).toBe(true)
    const rec = runtimeStrategyOf(runOf(d.definition))
    expect(rec.trades).toHaveLength(1)
  })

  it('⛔ CONTROL (defSchema): the same no-row document without the strategy window is refused, naming its outputs', () => {
    flags(true)
    const d = door(TESTER)
    expect(d.ok, d.reason).toBe(true)
    const listing = { ...d.definition, meta: { ...d.definition.meta, runtimeHistory: 'listing' } }
    const { installed, errors } = registry.installUserDefinitions([listing])
    expect(installed).toEqual([])
    expect(errors.join(' ')).toMatch(/compute\.outputs/)
  })

  it('⛔ broker OFF: the tester-only strategy refuses as before', () => {
    flags(false)
    expect(door(TESTER).ok).toBe(false)
  })

  it('⛔ broker ON, broker refuses: the door keeps the host document (nothing a member has today is lost)', () => {
    flags(true)
    const d = door(REFUSED)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.compute.kind).not.toBe('runtime')
    expect(drawsTradeMarkers(d.definition)).toBe(false)
    expect(d.rows.map((r) => r.label)).toEqual(['sma'])
  })
})

describe('W9 armed: the census predicate (`runtime/__tests__/strategyArmed.js`) can say both', () => {
  const censusDoor = (source) => {
    const d = door(source)
    return { attached: !!d.ok, clean: !!d.ok && (d.definition.compute.kind === 'runtime' || (d.translation.refusals || []).length === 0),
      guard: d.guard || null, refusals: [] }
  }
  it('⭐ an armed strategy whose run is pinned end to end would transfer', () => {
    flags(true)
    const v = armedStrategyVerdict({ source: PLOTS, door: censusDoor, bars: BARS, ctx: CTX })
    expect(v.wall).toBe(null)
    expect(v.transfers).toBe(true)
    expect(v.run.ok).toBe(true)
    expect(v.markers.disclosed).toBe(true)
  })
  it('⛔ CONTROL: the broker refused at build, so the door drew plots only: it would not transfer, and says why', () => {
    flags(true)
    const v = armedStrategyVerdict({ source: REFUSED, door: censusDoor, bars: BARS, ctx: CTX })
    expect(v.transfers).toBe(false)
    expect(v.wall).toBe('strategy:no-broker-run')
  })
  it('⛔ CONTROL: an unpinned rule the run reaches is its wall, by rule', () => {
    flags(true)
    // a partial close: [B-CLOSE-QTY], which no committed capture pins yet. (⚰️ This was a second long entry at the
    // default pyramiding, [B-PYR], until w9-q-s1b-defaults-v5 / -v6 and w9-d11-late-first-use-rpt pinned it, 2026-11-17.)
    const part = PLOTS.replace('strategy.entry("L", strategy.long, qty = 1)', 'strategy.entry("L", strategy.long, qty = 2)')
      .replace('if bar_index == 8', 'if bar_index == 5' + NL + '    strategy.close("L", qty = 1)' + NL + 'if bar_index == 8')
    const v = armedStrategyVerdict({ source: part, door: censusDoor, bars: BARS, ctx: CTX })
    expect(v.transfers).toBe(false)
    expect(v.wall).toBe('run:runtime:strategy-unpinned:B-CLOSE-QTY')
  })
})
