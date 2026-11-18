// app/src/components/chart/engine/__tests__/vendorHarness/strategyLane.test.js
//
// ─── THE STRATEGY LANE'S RAILS (2026-11-17): a strategy capture is graded on the run the MEMBER DOOR made ──────────
//
// `strategyLane.js` grades a strategy's trades and Strategy Tester report on the record the product's own columns
// carry (`ourSide.js::strategyRunOf`), armed the way production arms it: the broker gate's flag, the runtime lane's
// admission granted. Each rail has a control, so a constant answer cannot pass.
//
//   SL1 THE FOLD: MATCH only when both grades are MATCH; DIVERGE when either is; INCONCLUSIVE otherwise.
//   SL2 THE BARS TRADINGVIEW'S STRATEGY RAN: a report capture missing its newest value row is graded without
//       that bar; a capture holding every row, and a non-strategy capture, are graded as they are.
//   SL3 NO REPORT, NO MATCH: a broker document graded against a capture with no Strategy Tester report is
//       INCONCLUSIVE (its trades, its output, were never compared); neither report nor broker: no strategy grade.
//   SL4 ONE CODE PATH, ON A REAL CAPTURE: gate on, the member door mints the broker document and the grade is
//       the product's run, on the COMMITTED pin ledger; gate off (control), the door refuses the strategy and no
//       broker runs.
//   SL5 THE LANE ASSERTION CAN FAIL: runtime-on with the gate dark, or with no broker run, is refused.
//   SL6 ONE CODE PATH, IN THE SOURCE: neither `strategyLane.js` nor `ourSide.js` builds with `strategyBroker` or
//       widens the pin ledger with `brokerPinned`.
//   SL7 A REPORT REFUSED WHOLE IS REFUSED BY NAME: a record the report cannot read (a trade time that is a date, the
//       shape a daily chart's run recorded before 2026-11-17) refuses whole (`runtime:strategy-report-record`); the
//       grade says so, never "profit differs" on a withheld profit. On a member's daily bars the run now records each
//       bar's opening instant and the same capture MATCHes; control: on epoch-second bars it MATCHes too.
//
// Mutation proofs: docs/pine/evidence/2026-11-17-admit-strategy-decl/EVIDENCE.md.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  foldStrategyGrade, strategyRanView, strategyLaneGradeOf, holdsStrategyReport, strategyBrokerFlag,
  assertStrategyLaneMeasured, STRATEGY_SLOT_MAP, laneValueOutputsOf,
} from './strategyLane.js'
import { gradeStrategyCapture } from './strategyHarness.js'
import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { LANE_PRODUCTION, LANE_RUNTIME_ON } from '../../../../../../../tools/pine_coverage/runtime_lane.mjs'

vi.setConfig({ testTimeout: 300000 })

const cap = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const PANE_FLAGS = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js'].map((f) => (fs.readFileSync(
  path.resolve(process.cwd(), `src/components/chart/engine/${f}`), 'utf8').match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1])

afterEach(() => { vi.unstubAllEnvs() })

describe('SL1 the fold', () => {
  const v = (verdict) => ({ verdict, reason: `indicator ${verdict}`, plots: [] })
  const s = (verdict) => ({ verdict, step: 8, reason: `strategy ${verdict}`, broker: true })
  it('MATCH only when both are MATCH; DIVERGE when either is; every other pair INCONCLUSIVE', () => {
    expect(foldStrategyGrade(v('MATCH'), s('MATCH')).verdict).toBe('MATCH')
    expect(foldStrategyGrade(v('MATCH'), s('DIVERGE')).verdict).toBe('DIVERGE')
    expect(foldStrategyGrade(v('DIVERGE'), s('MATCH')).verdict).toBe('DIVERGE')
    expect(foldStrategyGrade(v('INCONCLUSIVE'), s('DIVERGE')).verdict).toBe('DIVERGE')
    for (const x of ['INCONCLUSIVE', 'EXPECTED-REFUSAL', 'UNGRADABLE']) {
      expect(foldStrategyGrade(v('MATCH'), s(x)).verdict, x).toBe('INCONCLUSIVE')
    }
    expect(foldStrategyGrade(v('INCONCLUSIVE'), s('MATCH')).verdict).toBe('INCONCLUSIVE')
  })
  it('keeps the indicator grade beside it, and says the strategy grade in the reason', () => {
    const f = foldStrategyGrade(v('MATCH'), s('DIVERGE'))
    expect(f.verdictWithoutStrategy).toBe('MATCH')
    expect(f.reason).toMatch(/strategy DIVERGE at step 8/)
    expect(f.strategy.verdict).toBe('DIVERGE')
  })
  it('control: no strategy grade leaves the verdict exactly as it was', () => {
    const x = v('MATCH')
    expect(foldStrategyGrade(x, null)).toBe(x)
  })
})

describe('SL2 the bars TradingView\'s strategy ran', () => {
  it('a report capture with one value row fewer than its bars is graded without the newest bar', () => {
    const c = cap('w9-d1-margin50-rpt-rddt-1d-2026-11-16')
    expect(holdsStrategyReport(c)).toBe(true)
    expect(c.plotValues.rows.length).toBe(c.bars.rows.length - 1)
    const { view, unrun } = strategyRanView(c)
    expect(unrun).toBe(c.bars.rows[c.bars.rows.length - 1][0])
    expect(view.bars.rows.length).toBe(c.bars.rows.length - 1)
    expect(view.bars.rows[view.bars.rows.length - 1][0]).toBe(c.plotValues.rows[c.plotValues.rows.length - 1][0])
    // a bar followed it, so the view's newest bar had finished, even where the capture's newest was forming
    expect(view.newestBarIsForming).toBe(false)
    const forming = cap('w9-d1-margin50-rddt-1d-2026-11-16')
    expect(forming.newestBarIsForming).toBe(true)
    expect(strategyRanView(forming).view.newestBarIsForming).toBe(false)
  })
  it('control: a report capture holding every row, and an indicator capture, are graded as they are', () => {
    const full = cap('w9-k1-commission-pct-rddt-1d-2026-11-15')
    expect(full.plotValues.rows.length).toBe(full.bars.rows.length)
    expect(strategyRanView(full)).toEqual({ view: full, unrun: null })
    const ind = cap('adx-and-di-for-v4-rddt-1d-2026-09-27')
    expect(holdsStrategyReport(ind)).toBe(false)
    expect(strategyRanView(ind).view).toBe(ind)
  })
})

describe('SL3 no report, no MATCH', () => {
  const brokerRan = { ok: true, plots: [], strategy: { record: null, refusal: { guard: 'x', message: 'y' } } }
  it('a broker document graded against a capture with no Strategy Tester report is INCONCLUSIVE', () => {
    const plotsOnly = cap('supertrend-strategy-rddt-1d-2026-10-02')
    expect(holdsStrategyReport(plotsOnly)).toBe(false)
    const g = strategyLaneGradeOf(plotsOnly, brokerRan)
    expect(g.verdict).toBe('INCONCLUSIVE')
    expect(g.reason).toMatch(/no Strategy Tester report/)
    expect(foldStrategyGrade({ verdict: 'MATCH', reason: 'plots agree' }, g).verdict).toBe('INCONCLUSIVE')
  })
  it('control: neither a report nor a broker document is no strategy grade at all', () => {
    expect(strategyLaneGradeOf(cap('supertrend-strategy-rddt-1d-2026-10-02'), { ok: true, plots: [], strategy: null })).toBe(null)
    expect(strategyLaneGradeOf(cap('adx-and-di-for-v4-rddt-1d-2026-09-27'), { ok: true, plots: [], strategy: null })).toBe(null)
  })
})

/** The panes on, as production builds them, and the strategy broker gate `on` or off (its own flag). */
const armed = (on) => {
  for (const f of PANE_FLAGS) vi.stubEnv(f, '1')
  vi.stubEnv(strategyBrokerFlag(), on ? '1' : '')
}

describe('SL4 one code path, on a real capture', () => {
  const ID = 'w9-k1-commission-pct-rddt-1d-2026-11-15'
  it('gate on: the member door mints the broker document and the strategy is graded on that run', () => {
    armed(true)
    const { verdict, ours } = gradeCapture(cap(ID))
    expect(ours.ok).toBe(true)
    expect(ours.strategy).toBeTruthy()
    expect(verdict.strategy.broker).toBe(true)
    // the product's run, on the committed ledger: whatever it answers is named (a record graded, or a refusal by name)
    expect(verdict.strategy.reason).toBeTruthy()
    if (verdict.strategy.refusedBy) expect(verdict.strategy.refusedBy).toMatch(/^(runtime|pine|budget):/)
  })
  it('control: gate off, the door refuses the strategy by name and no broker runs', () => {
    armed(false)
    const { verdict, ours } = gradeCapture(cap(ID))
    expect(ours.ok).toBe(false)
    expect(ours.refusal).toMatch(/pine:strategy-call/)
    expect(verdict.strategy.broker).toBe(false)
    expect(verdict.verdict).toBe('INCONCLUSIVE')
  })
})

describe('SL7 a report refused whole is refused by name, never a different answer', () => {
  const ID = 'w9-q-s1a-size-v2-rddt-1d-2026-11-15'
  // ⚰️ (2026-11-17, strategy-epoch-bar-times) this capture was SL7's real refused report: on a member's daily bars the
  // run recorded DATES and the report refused whole. The run now records each bar's opening instant
  // (`runtimeColumns.js::brokerBarTimes`), so the same capture is the positive case below, and the refused-whole branch
  // is held on that run's record with one trade time put back to the date it used to be.
  it('on a member\'s daily bars (ISO date keys) the report is read and the capture is graded on its trades: MATCH', () => {
    armed(true)
    const { verdict } = gradeCapture(cap(ID))
    expect(verdict.strategy.broker).toBe(true)
    expect(verdict.strategy.refusedBy).toBeUndefined()
    expect(verdict.strategy.verdict).toBe('MATCH')
    expect(verdict.verdict).toBe('MATCH')
  })
  it('a record the report cannot read (a trade time that is a date) refuses whole by name: EXPECTED-REFUSAL, no compare', () => {
    armed(true)
    const { ours } = gradeCapture(cap(ID))
    const rec = ours.strategy.record
    expect(rec.trades.length).toBeGreaterThan(0)
    const dated = { ...ours, strategy: { ...ours.strategy,
      record: { ...rec, trades: rec.trades.map((t, i) => (i === 0 ? { ...t, entryTime: '2024-07-30' } : t)) } } }
    const { view, unrun } = strategyRanView(cap(ID))
    const g = strategyLaneGradeOf(view, dated, { unrun })
    expect(g.refusedBy).toBe('runtime:strategy-report-record')
    expect(g.verdict).toBe('EXPECTED-REFUSAL')
  })
  it('control: the same capture on epoch-second bars, every rule allowed (`runOurBroker`, the pin question), is MATCH', () => {
    expect(gradeStrategyCapture(cap(ID), { slotMap: STRATEGY_SLOT_MAP }).verdict).toBe('MATCH')
  })
})

describe('SL5 the strategy lane assertion can fail', () => {
  it('RED: runtime-on with the broker gate dark', () => {
    expect(() => assertStrategyLaneMeasured({ requested: LANE_RUNTIME_ON, brokerGate: false, graded: 0, brokerRuns: 0 }))
      .toThrow(/STRATEGY BROKER IS DARK/)
  })
  it('RED: runtime-on, strategy captures graded, no broker document run', () => {
    expect(() => assertStrategyLaneMeasured({ requested: LANE_RUNTIME_ON, brokerGate: true, graded: 3, brokerRuns: 0 }))
      .toThrow(/NEVER RAN/)
  })
  it('RED: the production lane ran a broker document', () => {
    expect(() => assertStrategyLaneMeasured({ requested: LANE_PRODUCTION, brokerGate: false, graded: 3, brokerRuns: 1 }))
      .toThrow(/PRODUCTION LANE RAN/)
  })
  it('GREEN: runtime-on with the gate on and a broker run; production with none', () => {
    expect(assertStrategyLaneMeasured({ requested: LANE_RUNTIME_ON, brokerGate: true, graded: 3, brokerRuns: 2 })).toMatch(/broker gate ON/)
    expect(assertStrategyLaneMeasured({ requested: LANE_PRODUCTION, brokerGate: false, graded: 3, brokerRuns: 0 })).toMatch(/broker gate off/)
  })
})

// ⚰️ (2026-11-17) supertrend-strategy's `mPlot`, a fill anchor the member pane does not carry, was read as `na` on
// every bar and graded DIVERGE at step 7 against TradingView's `ohlc4`.
describe('SL8 our value outputs, as the lane hands them to the grade', () => {
  const capture = { bars: { rows: [[100, 1, 1, 1, 1, 0], [200, 1, 1, 1, 1, 0]] } }
  it('the value calls, in order, with their call; a carried column is its points (NaN read as na)', () => {
    const ours = { plots: [
      { kind: 'plot', column: [1.5, NaN] }, { kind: 'plotcandle', column: [1, 1] }, { kind: 'plotshape', column: [NaN, 2] },
    ] }
    expect(laneValueOutputsOf(ours, capture)).toEqual([
      { kind: 'plot', points: [{ time: 100, value: 1.5 }, { time: 200, value: null }] },
      { kind: 'plotshape', points: [{ time: 100, value: null }, { time: 200, value: 2 }] },
    ])
  })
  it('⛔ an output our side carried NO column for is named missing, never a series of `na`', () => {
    const ours = { plots: [{ kind: 'plot', column: null, missingReason: 'the member pane did not carry this output (hidden helper)' }] }
    expect(laneValueOutputsOf(ours, capture)).toEqual([
      { kind: 'plot', points: null, missing: 'the member pane did not carry this output (hidden helper)' },
    ])
  })
})

describe('SL6 one code path, in the source', () => {
  const codeOf = (f) => fs.readFileSync(path.resolve(process.cwd(), 'src/components/chart/engine/__tests__/vendorHarness', f), 'utf8')
    .split('\n').filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n')
  const SECOND_PATH = /\bstrategyBroker\s*:|\bbrokerPinned\b|\brunOurBroker\s*\(/
  it('neither the strategy lane nor our side builds with the broker option or widens the pin ledger', () => {
    for (const f of ['strategyLane.js', 'ourSide.js']) expect(codeOf(f), f).not.toMatch(SECOND_PATH)
  })
  it('control: the strategy harness (the pin question) does, so the pattern reads code', () => {
    expect(codeOf('strategyHarness.js')).toMatch(SECOND_PATH)
  })
})
