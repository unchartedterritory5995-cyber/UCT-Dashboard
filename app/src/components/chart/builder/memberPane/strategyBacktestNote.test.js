// app/src/components/chart/builder/memberPane/strategyBacktestNote.test.js
//
// SERVE OR REFUSE BY NAME (owner ruling 2026-11-17, delegated): a strategy the member door draws WITHOUT its backtest
// says so on the pane, and why (`memberPaneDefinition.js::strategyBacktestNote`). The serve audit
// (docs/pine/evidence/2026-11-17-serve-witnessed-strategies/EVIDENCE.md) found three silent cases; each has a rail here,
// and two controls say the note is not stamped where it does not belong.
//
//   S1  the host translator does not read the script's `strategy()` line (a variable title, wrapped over three lines;
//       the reference script best-engulfing-ma): the script is drawn as an INDICATOR. Gate off and gate on.
//   S2  gate on, runtime pane on, the armed route's broker document declined (here: not graded): the host document
//       stands and names the decline.
//   S3  the runtime lane draws a strategy WITHOUT its broker (corpus flawless-victory: the broker build refuses its
//       `currency` argument by name): the note carries the broker build's own refusal. Gate off: the gate is the reason.
//   C1  a served broker document (gate on, admission granted) carries no such note: its report is the answer.
//   C2  an indicator carries no such note.
//
// Mutation proofs (by hand, each restored from a saved copy; the EVIDENCE file records each run):
//   - drop `if (strategyNote) notes.push(strategyNote)` (host path)                -> S1, S2 RED
//   - drop the runtime lane's `notes.push(strategyBacktestNote(...))`              -> S3 RED
//   - drop `brokerDeclined` from `runtimeColumns.js::probeRuntimeProgram`          -> S3 (gate on) RED
//   - stamp the note on every runtime document (`probe.broker !== true` -> `true`) -> C1 RED
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition, STRATEGY_BACKTEST_NOTE, declaresStrategy } from './memberPaneDefinition'
import { isStrategyWindowDefinition } from '../../engine/strategyWindow'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission,
} from '../../engine/runtimeKill'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'

vi.setConfig({ testTimeout: 120000 })
afterEach(() => { vi.unstubAllEnvs(); __allowEveryRuntimeScriptForTests() })

const NL = String.fromCharCode(10)
const ON = (broker) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', broker ? '1' : '')
  __permitRuntimePaneForTests()
}
const noteOf = (d) => (d.notes || []).find((n) => n && n.name === STRATEGY_BACKTEST_NOTE) || null
const corpus = (slug) => fs.readFileSync(path.resolve(process.cwd(), '..', 'corpus', 'committed', `${slug}.pine`), 'utf8')

/** S1: the declaration shape the host translator does not read (best-engulfing-ma's, reduced) */
const UNREAD_DECL = ['//@version=4', 'StrategyName = "wrapped"', '',
  'strategy(title=StrategyName, shorttitle=StrategyName, overlay=true, ',
  ' pyramiding=2, default_qty_value=500, precision=7, currency=currency.USD,',
  ' commission_value=0.2,commission_type=strategy.commission.percent, initial_capital=10000)', '',
  'm = sma(close, 10)', 'plot(m, title="MA")', 'if crossover(close, m)', '    strategy.entry("L", true)',
  'if crossunder(close, m)', '    strategy.close("L")', ''].join(NL)

/** S2 / C1: a plain v5 crossover strategy the broker serves on every pinned rule */
const CROSS = ['//@version=5', 'strategy("cross", overlay=true)', 'f = ta.sma(close, 5)', 's = ta.sma(close, 20)',
  'if ta.crossover(f, s)', '    strategy.entry("L", strategy.long)', 'if ta.crossunder(f, s)', '    strategy.close("L")',
  'plot(f, title="fast")', ''].join(NL)

const INDICATOR = ['//@version=5', 'indicator("ind")', 'plot(ta.sma(close, 5))', ''].join(NL)
const FLAWLESS = 'flawless-victory-strategy__1BVZuaaWOU'

describe('serve or refuse by name: the strategy-backtest disclosure', () => {
  it('the declaration predicate reads the call form only', () => {
    expect(declaresStrategy(UNREAD_DECL)).toBe(true)
    expect(declaresStrategy(CROSS)).toBe(true)
    expect(declaresStrategy(INDICATOR)).toBe(false)
    expect(declaresStrategy('//@version=5\n// strategy("in a comment")\nindicator("x")\nplot(close)\n')).toBe(false)
  })

  for (const broker of [false, true]) {
    it(`S1 (gate ${broker ? 'on' : 'off'}): a strategy whose strategy() line the translator does not read says so`, () => {
      ON(broker)
      const d = memberPaneDefinition({ source: UNREAD_DECL, id: 'u_s1note', name: 's1' })
      expect(d.ok).toBe(true)
      expect((d.translation || {}).declaration).not.toBe('strategy')
      const n = noteOf(d)
      expect(n).not.toBe(null)
      expect(n.note).toMatch(/^This script is a strategy, and its backtest is not run on this chart/)
      expect(n.note).toMatch(/its `strategy\(\)` line is not one this engine reads, so the script is drawn as an indicator\.$/)
      // carried on the document, so a saved copy says it too
      expect((d.definition.meta.disclosures || []).some((x) => x.name === STRATEGY_BACKTEST_NOTE)).toBe(true)
    })
  }

  it('S2 (gate on): the armed route\'s broker document declined (not graded): the host document names the decline', () => {
    ON(true)
    __resetRuntimeAllowList()
    __resetRuntimeAdmission()
    const d = memberPaneDefinition({ source: CROSS, id: 'u_s2note', name: 's2' })
    expect(d.ok).toBe(true)
    expect(isStrategyWindowDefinition(d.definition)).toBe(false)
    const n = noteOf(d)
    expect(n).not.toBe(null)
    expect(n.note).toMatch(/the per-bar lane that runs the backtest declined it: this script \(sha256 [0-9a-f]{12}.\) has not yet been graded against TradingView/)
  })

  it('S2 control (gate off): the same host document gains nothing (its import verdict already names the backtest)', () => {
    ON(false)
    const d = memberPaneDefinition({ source: CROSS, id: 'u_s2off', name: 's2' })
    expect(d.ok).toBe(true)
    expect(noteOf(d)).toBe(null)
  })

  it('S3 (gate on): a runtime document without its broker carries the broker build\'s own refusal', () => {
    ON(true)
    const d = memberPaneDefinition({ source: corpus(FLAWLESS), id: 'u_s3note', name: 's3' })
    expect(d.ok).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(isStrategyWindowDefinition(d.definition)).toBe(false)
    const n = noteOf(d)
    expect(n).not.toBe(null)
    expect(n.note).toMatch(/the backtest could not be built for it \(runtime:strategy-option\): .*`currency`/)
  })

  it('S3 (gate off): the same runtime document names the gate', () => {
    ON(false)
    const d = memberPaneDefinition({ source: corpus(FLAWLESS), id: 'u_s3off', name: 's3' })
    expect(d.ok).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(noteOf(d).note).toMatch(/strategy backtests are switched off in this build\.$/)
  })

  it('C1: a served broker document carries no such note (its report is the answer)', () => {
    ON(true)
    const d = memberPaneDefinition({ source: CROSS, id: 'u_c1note', name: 'c1' })
    expect(d.ok).toBe(true)
    expect(isStrategyWindowDefinition(d.definition)).toBe(true)
    expect(noteOf(d)).toBe(null)
  })

  it('C2: an indicator carries no such note, gate on or off', () => {
    for (const broker of [false, true]) {
      ON(broker)
      const d = memberPaneDefinition({ source: INDICATOR, id: 'u_c2note', name: 'c2' })
      expect(d.ok).toBe(true)
      expect(noteOf(d)).toBe(null)
      vi.unstubAllEnvs()
    }
  })
})
