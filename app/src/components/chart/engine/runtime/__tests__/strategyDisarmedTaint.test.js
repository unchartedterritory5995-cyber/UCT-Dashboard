// app/src/components/chart/engine/runtime/__tests__/strategyDisarmedTaint.test.js
//
// ─── ⭐⭐ Engine 77 (#1833, fix/strategy-disarmed-taint) — A REFUSED BACKTEST TAKES AWAY ONLY WHAT IT DECIDES ──────────
//
// Owner rule (coordinator ruling 2026-11-18): an admission must NEVER take away what a member sees today. When a
// strategy's broker run refuses by name on a chart, the same program runs again without its broker
// (`runtimeColumns.js::disarmedAfter`, `vm.js` `brokerDisarmed`). Until this change that stand-in stopped on ANY read
// of a broker value, so a strategy whose ORDER logic reads `strategy.position_size` lost every plot the host lane
// draws for it today (macd-shortlong-strategy-for-tradingview-input-optimizer: six plain MACD plots, on both of its
// captures). Now, under the coordinator's conditions:
//   (a) WHAT is drawn is decided STATICALLY by the host lane's own taint (`strategyTaint.js::strategyTaintSinks`,
//       W9-OQ-N2) through `strategyDisarmOf`, never by watching `na` appear at run time; in the stand-in run a broker
//       number read is `na` only so the order logic can finish;
//   (b) a broker value reaching a sink with no row of its own (`hline`, a `fill` band, `alert()`) or a drawing, a
//       trace that failed, or a throw, keeps the broker's refusal;
//   (c) the member door: a broker document that would withhold a plot or paint the host document shows (a forward
//       `offset`, measured on hull-moving-average-crossover-strategy) does not replace it (`memberPaneDefinition.js`
//       `takesAway`): the member keeps the host document, and reads why the backtest is not run;
//   (d) the rails below, each proved able to fail (mutants recorded in the PR).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission, latchRuntimeLists,
  latchRuntimeAdmission, runtimeSourceHash,
} from '../../runtimeKill'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../runtimeColumns'
import { runtimeStrategyOf } from '../strategyRecord'
import { columnErrors } from '../../astColumns'
import { isStrategyWindowDefinition } from '../../strategyWindow'
import { loadCapture } from '../../__tests__/vendorHarness/harness.js'
import { toProductBars } from '../../__tests__/vendorHarness/ourSide.js'
import { storeExchangeOfCapture } from '../../__tests__/vendorHarness/storeExchange.js'
import { historyWindowBarsOf } from './strategyArmed.js'
import { strategyDisarmOf } from '../../ast/strategyTaint.js'

vi.setConfig({ testTimeout: 300000 })

const ROOT = path.resolve(process.cwd(), '..')
const GATE = (f) => fs.readFileSync(path.resolve(process.cwd(), `src/components/chart/engine/${f}`), 'utf8')
const FLAGS = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js', 'strategyBrokerGate.js']
  .map((f) => (GATE(f).match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1])
const HARNESS = path.join(ROOT, 'tests/fixtures/vendor/harness')
const MACD = {
  rddt: loadCapture(path.join(HARNESS, 'macd-shortlong-strategy-for-tradingview-input-optimizer-rddt-1d-2026-10-02.json')).capture,
  spy: loadCapture(path.join(HARNESS, 'macd-shortlong-strategy-for-tradingview-input-optimizer-spy-1d-2026-10-03.json')).capture,
}
const SPY = loadCapture(path.join(HARNESS, 'supertrend-strategy-spy-1d-2026-10-02.json')).capture
const MACD_TITLES = ['Histogram Long', 'MACD Long', 'Signal Long', 'Histogram Short', 'MACD Short', 'Signal Short']
const DEF_ID = 'u_strategy-disarmed-taint'

const ctxOf = (capture) => ({
  tf: 'D',
  symbol: { ticker: capture.symbol.name, exchange: storeExchangeOfCapture(capture, capture.symbol.exchange) || capture.symbol.exchange },
  newestBarIsForming: false,
  historyFromListing: !!(capture.history && capture.history.startsAtBar0 === true),
  historyWindowBars: historyWindowBarsOf(ROOT),
})

/** The member door's document for `source` on the admission state given, installed, and its columns on `capture`'s
 *  bars as a member's daily chart hands them. `admitted` false is production today (the runtime lane refuses a
 *  strategy: `strategy-decl` has no registry row, so the member reads the host lane). */
function memberColumns(source, capture, { admitted }) {
  if (admitted) __allowEveryRuntimeScriptForTests()
  else {
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    latchRuntimeLists({ kill: [], allow: [], capability_admission: true })
    latchRuntimeAdmission(runtimeSourceHash(source), { admitted: false })
  }
  const d = memberPaneDefinition({ source, id: DEF_ID, name: 'disarmed taint' })
  expect(d.ok, d.reason).toBe(true)
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(installed && installed[0], (errors || []).join(' | ')).toBeTruthy()
  try {
    const bars = toProductBars(capture)
    const cols = admitted ? computeRuntimeColumns(installed[0], bars, ctxOf(capture))
      : registry.computeFor(installed[0], bars, undefined, ctxOf(capture))
    return { d, bars, cols, broker: isStrategyWindowDefinition(d.definition) }
  } finally {
    registry.uninstallUserDefinition(DEF_ID)
    __allowEveryRuntimeScriptForTests()
  }
}
const keyOf = (d, label) => ((d.definition.plots || []).find((p) => p.label === label) || {}).key
/** a column as a plain array (the host lane hands typed arrays, the runtime lane plain ones), or null */
const asList = (col) => (Array.isArray(col) || ArrayBuffer.isView(col) ? Array.from(col) : null)
const drawn = (col) => { const l = asList(col); return !!l && l.some((v) => Number.isFinite(v)) }

const H = '//@version=5\nstrategy("taint rail", overlay = true)\n'
const ORDERS = 'if ta.crossover(close, ta.sma(close, 10))\n    strategy.entry("L", strategy.long)\n'
  + 'if ta.crossunder(close, ta.sma(close, 10))\n    strategy.close("L")\n'

describe('strategyDisarmOf: the static verdict names why it refuses (each ruling (b) case on its own)', () => {
  const sink = (name, line, word = 'strategy.position_size') => [`${line}:0`, { word, name, tok: { line, column: 0 } }]
  const OUT = [{ call: 'plot' }, { call: 'plot' }, { call: 'colour', of: 1 }]
  const LINES = [3, 4, null]
  it('no taint: nothing withheld, nothing refused', () => {
    expect(strategyDisarmOf(new Map(), OUT, LINES)).toEqual({ refused: null, withheld: [] })
  })
  it('a trace that failed (null) refuses: untraced', () => {
    expect(strategyDisarmOf(null, OUT, LINES).refused).toMatchObject({ why: 'untraced' })
  })
  it('a tainted `hline` / `fill` / `alert` has no row of its own: no-row', () => {
    for (const name of ['hline', 'fill', 'alert']) {
      expect(strategyDisarmOf(new Map([sink(name, 9, 'strategy.equity')]), OUT, LINES).refused, name)
        .toMatchObject({ why: 'no-row', name, word: 'strategy.equity', line: 9 })
    }
  })
  it('a tainted drawing refuses: drawing', () => {
    expect(strategyDisarmOf(new Map([sink('label.new', 7)]), OUT, LINES).refused).toMatchObject({ why: 'drawing', name: 'label.new' })
  })
  it('a tainted plot is withheld with its colour output; its neighbour is not', () => {
    expect(strategyDisarmOf(new Map([sink('plot', 4)]), OUT, LINES)).toEqual({ refused: null, withheld: [
      { index: 1, word: 'strategy.position_size', name: 'plot', line: 4 },
      { index: 2, word: 'strategy.position_size', name: 'plot', line: 4 },
    ] })
  })
  it('a tainted plot no output sits on refuses: unmatched; one whose output has no line: unplaced', () => {
    expect(strategyDisarmOf(new Map([sink('plot', 12)]), OUT, LINES).refused).toMatchObject({ why: 'unmatched', line: 12 })
    expect(strategyDisarmOf(new Map([sink('plot', 4)]), OUT, [3, null, null]).refused).toMatchObject({ why: 'unplaced' })
  })
})

describe('a broker run refused by name: the stand-in run draws exactly what no broker value reaches', () => {
  beforeEach(() => {
    for (const f of FLAGS) vi.stubEnv(f, '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
  })
  afterEach(() => { vi.unstubAllEnvs(); __resetRuntimeAllowList(); __resetRuntimeAdmission() })

  for (const [sym, guard, rule] of [['rddt', 'runtime:strategy-unpinned', 'B-EXIT-NA'], ['spy', 'runtime:strategy-unsettled', 'Q-S1n']]) {
    it(`⭐ macd-shortlong on ${sym.toUpperCase()} daily (its ORDER logic reads the broker; refused ${rule}): its six plots are drawn, equal to what the member sees today`, () => {
      const cap = MACD[sym]
      const source = cap.source.text
      const today = memberColumns(source, cap, { admitted: false })
      expect(today.broker).toBe(false)
      const now = memberColumns(source, cap, { admitted: true })
      expect(now.broker, 'the door did not mint the broker document').toBe(true)
      // the backtest alone is refused, by the broker's own name
      const rec = runtimeStrategyOf(now.cols)
      expect(rec, 'no strategy record: the broker refusal took the plots with it').toBeTruthy()
      expect(rec.refusals).toEqual([expect.objectContaining({ guard, rule })])
      expect(rec.refusals[0].sentence).toMatch(/The script's plots are drawn\.$/)
      expect(columnErrors(now.cols)).toEqual({})
      for (const t of MACD_TITLES) {
        const k = keyOf(now.d, t)
        expect(k, t).toBeTruthy()
        expect(keyOf(today.d, t), t).toBe(k)
        expect(drawn(today.cols[k]), `${t}: the member does not see it today`).toBe(true)
        expect(drawn(now.cols[k]), `${t}: taken away by the admission`).toBe(true)
        // the same values, bar for bar, as the host lane draws today
        const a = asList(today.cols[k])
        const b = asList(now.cols[k])
        expect(b).toHaveLength(a.length)
        const differ = a.findIndex((v, i) => !(Number.isFinite(v) ? Number.isFinite(b[i]) && Math.abs(v - b[i]) <= 1e-9 * Math.max(1, Math.abs(v)) : !Number.isFinite(b[i])))
        expect(differ, `${t}: differs from today's host column at bar ${differ}`).toBe(-1)
      }
    })
  }

  it('⭐ a plot COLOURED by `strategy.position_size` is withheld by name (its colour too) while its neighbours draw', () => {
    const src = `${H}plot(close, "a")\nplot(open, "b", color = strategy.position_size > 0 ? color.green : color.red)\nplot(high, "c")\n${ORDERS}`
    const { d, cols, broker } = memberColumns(src, SPY, { admitted: true })
    expect(broker).toBe(true)
    expect(drawn(cols[keyOf(d, 'a')]), 'a').toBe(true)
    expect(drawn(cols[keyOf(d, 'c')]), 'c').toBe(true)
    const b = keyOf(d, 'b')
    expect(cols[b], 'a broker-coloured plot was drawn without the broker').toBeUndefined()
    const errs = columnErrors(cols)
    expect(errs[b]).toMatchObject({ guard: 'runtime:strategy-value' })
    expect(errs[b].message).toContain('`strategy.position_size`')
    // its colour column is withheld with it, never drawn from the `na` the stand-in run read
    const mapped = Object.keys(d.definition.compute.outputs)
    const colourKeys = mapped.filter((k) => ![keyOf(d, 'a'), keyOf(d, 'b'), keyOf(d, 'c')].includes(k))
    expect(colourKeys.length, 'the document maps no colour column for b (vacuous)').toBeGreaterThan(0)
    for (const k of colourKeys) {
      expect(cols[k], k).toBeUndefined()
      expect(errs[k], k).toMatchObject({ guard: 'runtime:strategy-value' })
    }
    expect(runtimeStrategyOf(cols).refusals[0].sentence).toMatch(/except those that show the backtest's own values\.$/)
  })

  it('⭐ (a) STATIC, never watched at run time: `plot(nz(strategy.position_size))` is withheld though the stand-in run computes 0 on every bar', () => {
    const src = `${H}plot(close, "a")\nplot(nz(strategy.position_size), "flat")\n${ORDERS}`
    const { d, cols } = memberColumns(src, SPY, { admitted: true })
    expect(drawn(cols[keyOf(d, 'a')])).toBe(true)
    expect(cols[keyOf(d, 'flat')], 'a value of the backtest was drawn as a flat 0 without the backtest').toBeUndefined()
    expect(columnErrors(cols)[keyOf(d, 'flat')]).toMatchObject({ guard: 'runtime:strategy-value' })
  })

  it('⛔ (b) an `hline` a broker value reaches has no row of its own: the broker\'s refusal stands, nothing is drawn', () => {
    const src = `${H}plot(close, "a")\nhline(strategy.initial_capital, "h")\n${ORDERS}`
    let thrown = null
    try { memberColumns(src, SPY, { admitted: true }) } catch (e) { thrown = e }
    expect(thrown, 'a stand-in run drew beside a broker-valued hline').toBeTruthy()
    expect(thrown.guard).toBe('runtime:strategy-unsettled')
  })

  it('⛔ (b) a `fill` band a broker value colours: the broker\'s refusal stands, nothing is drawn', () => {
    const src = `${H}p1 = plot(close, "a")\np2 = plot(open, "b")\nfill(p1, p2, color = strategy.position_size > 0 ? color.green : color.red)\n${ORDERS}`
    let thrown = null
    try { memberColumns(src, SPY, { admitted: true }) } catch (e) { thrown = e }
    expect(thrown, 'a stand-in run drew beside a broker-coloured fill').toBeTruthy()
    expect(thrown.guard).toBe('runtime:strategy-unsettled')
  })

  it('⭐ the door: a broker document that would NOT draw a plot the host document shows (a forward `offset`) does not replace it', () => {
    const fwd = `${H}plot(ta.sma(close, 5), "fwd", offset = 3)
plot(close, "c")
${ORDERS}`
    __allowEveryRuntimeScriptForTests()
    const d = memberPaneDefinition({ source: fwd, id: DEF_ID, name: 'offset' })
    expect(d.ok, d.reason).toBe(true)
    expect(isStrategyWindowDefinition(d.definition), 'the broker document replaced a host document that shows more').toBe(false)
    expect((d.definition.plots || []).filter((p) => p.hidden !== true).map((p) => p.label)).toEqual(['fwd', 'c'])
    const note = (d.notes || []).find((n) => /backtest is not run/.test(String(n.note)))
    expect(note && note.note).toMatch(/running the backtest here would leave the 'fwd' line undrawn, so the chart draws the script without it\.$/)
    // CONTROL: the same strategy with no forward offset is the broker's
    const d2 = memberPaneDefinition({ source: fwd.replace(', offset = 3', ''), id: DEF_ID, name: 'offset' })
    expect(isStrategyWindowDefinition(d2.definition)).toBe(true)
  })

  it('CONTROL: order logic that reads the broker, plots that do not: every plot drawn, nothing withheld', () => {
    const src = `${H}plot(close, "a")\nplot(ta.sma(close, 10), "b")\n`
      + 'if strategy.position_size == 0 and ta.crossover(close, ta.sma(close, 10))\n    strategy.entry("L", strategy.long)\n'
      + 'if strategy.position_size > 0 and ta.crossunder(close, ta.sma(close, 10))\n    strategy.close("L")\n'
    const { d, cols } = memberColumns(src, SPY, { admitted: true })
    expect(drawn(cols[keyOf(d, 'a')])).toBe(true)
    expect(drawn(cols[keyOf(d, 'b')])).toBe(true)
    expect(columnErrors(cols)).toEqual({})
    expect(runtimeStrategyOf(cols).refusals[0].sentence).toMatch(/The script's plots are drawn\.$/)
  })
})
