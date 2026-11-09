// app/src/components/chart/engine/ast/strategiesAreRuled.test.js
//
// ─── ⭐⭐ "strategies" IS A RULING, NOT A BACKLOG ITEM ────────────────────────
//
// The product scorecard read `strategies  NOT BUILT (Segment A)` for as long as
// the row existed, which reads as debt — something a later wave owes. It is not.
// A strategy is a different QUESTION with a different SHAPE OF ANSWER, and this
// file is what lets the row say so.
//
// ⛔⛔ THE BAR FOR CALLING SOMETHING RULED IS SET IN THIS REPO ALREADY, and it is
// high. `doorScorecard.test.js` rejected four candidates from its ruled table and
// left them OPEN with the sentence "being difficult is not being ruled". So cost
// is not a ruling. What follows has to be a category fact.
//
// ⭐ AND IT IS ONE, BUT NOT THE OBVIOUS ONE. The tempting argument — "order state
// is path-dependent, so the engine cannot express it" — is FALSE AS STATED, and
// this file proves it false below: a long/flat position flag folds into `accum`
// today, which is exactly how `01-supertrend` translates. Bounded state is a
// thing this engine has.
//
// ⭐⭐ THE REAL RULING IS ABOUT WHAT AN ANSWER IS. A screen asks one yes/no of
// every symbol as of today: 3,742 answers, one bar. A strategy asks for a trade
// list and an equity curve for ONE symbol across time. The engine's two doors say
// this in their own words, and they are quoted here rather than paraphrased:
//
//   pine:declaration-strategy — "a strategy places orders to be backtested, and
//                               a screen filters symbols"
//   thinkscript:strategy      — "placing an order is a backtest instruction and
//                               answers with no value to filter on"
//
// Neither says "not yet". Both say what the thing IS.
//
// ⚰️ THIS PARAGRAPH SHIPPED WITH TWO FALSE SENTENCES IN IT, and they are corrected
// here rather than quietly deleted, because both were the comfortable kind: a
// ruling reads better with a consolation beside it, and I wrote the consolation
// without checking it.
//
//   ⛔ "That is a different row on the scorecard and it is measured." — THERE IS
//      NO SUCH ROW. The scorecard prints nine: authoring, charting, scanning,
//      screener author., alerting, sharing, verifiability, strategies, import
//      fidelity. None of them is evidence.
//   ⛔ "the hit rate against its base rate" — THAT PAIRING IS THE ONE THE CODE
//      REFUSES TO MAKE. `definition_record.HIT_RATE_MEANS` says it in as many
//      words: "an occurrence rate, not a win rate: the forward record stores
//      whether the screen fired, never what happened next, so there is no return
//      here and no baseline to put beside it". The case below pins that sentence,
//      so this file cannot re-invent the pairing.
//
// ⭐ WHAT IS ACTUALLY TRUE is narrower and still worth saying: a per-horizon
// backtest surface DOES exist — `api/services/screener/backtest.py` and
// `EvidenceTab.jsx`, each horizon carrying a structurally mandatory baseline —
// and it is dark. `api/main.py` mounts it only under `SCREEN_BACKTEST_ENABLED`,
// which is set on no service, so every member sees "Backtested evidence is not
// switched on for this site yet." Whether to arm it is an owner's decision, not
// a build.
//
// ⚠️ AND THE SCOPE OF THIS ROW IS THE SCREEN DOOR. A single-symbol position
// simulator ships (`api/services/backtest_engine.py`); what is ruled out is
// asking 3,742 symbols a question that has no per-symbol answer today.

import { describe, it, expect } from 'vitest'

import { translatePine, REFUSALS as PINE_REFUSALS } from './pine.js'
import { translateThinkScript, REFUSALS as TS_REFUSALS } from './thinkscript.js'
import fs from 'node:fs'
import path from 'node:path'

import { parseFormula } from './parse.js'
import { strategyScorecardWording, pinnedBrokerRules } from './strategyScorecard.js'
import { BROKER_RULE_IDS } from '../runtime/brokerRules.js'

const STRATEGY_PINE = `//@version=6
strategy("mine", overlay=true)
if ta.crossover(close, ta.sma(close, 50))
    strategy.entry("long", strategy.long)
plot(close)
`
const STRATEGY_TS = `def up = close > Average(close, 50);
AddOrder(OrderType.BUY_TO_OPEN, up, close, 100);
`

describe('a strategy is ruled out because of what it ANSWERS', () => {
  it('⭐⭐ both doors refuse it, and neither says "not yet"', () => {
    const pine = translatePine(STRATEGY_PINE)
    expect(pine.ok).toBe(false)
    expect(pine.refusal.guard).toBe('pine:declaration-strategy')
    expect(PINE_REFUSALS['pine:declaration-strategy'])
      .toBe('a strategy places orders to be backtested, and a screen filters symbols')

    const ts = translateThinkScript(STRATEGY_TS)
    expect(ts.ok).toBe(false)
    expect(ts.refusal.guard).toBe('thinkscript:strategy')
    expect(TS_REFUSALS['thinkscript:strategy'])
      .toBe('placing an order is a backtest instruction and answers with no value to filter on')
  })

  it('⛔⛔ the refusals name the KIND of thing, not a missing capability', () => {
    // ⚠️ THIS IS THE ASSERTION THAT KEEPS THE SCORECARD HONEST. The day either
    // sentence becomes "not supported yet" or "coming soon", the row claiming a
    // RULING is no longer entitled to, and this goes red.
    for (const sentence of [PINE_REFUSALS['pine:declaration-strategy'],
      TS_REFUSALS['thinkscript:strategy']]) {
      expect(sentence).not.toMatch(/not yet|coming soon|unsupported|for now|later/i)
      // …and each one says what a screen IS, which is the whole argument.
      expect(sentence).toMatch(/filter|screen/i)
    }
  })

  it('⭐⭐ the EASY argument for the ruling is FALSE, and here is the proof', () => {
    // "Order state is path-dependent, so this engine cannot hold it" — no. A
    // long/flat flag that carries its own previous bar folds into the bounded
    // accumulator, which is how `01-supertrend-mobius` translates once its first
    // bar is stated. If the ruling rested on expressibility it would be wrong.
    const flag = `//@version=6
indicator("s")
inPos = 0.0
inPos := na(inPos[1]) ? 0.0 : (ta.crossover(close, ta.sma(close, 50)) ? 1.0 : (ta.crossunder(close, ta.sma(close, 50)) ? 0.0 : inPos[1]))
plot(inPos > 0 ? 1 : 0)
`
    const out = translatePine(flag)
    expect(out.ok, out.ok ? '' : `${out.refusal.guard}: ${out.refusal.message}`).toBe(true)
    const formula = out.outputs[out.selected].formula
    expect(formula).toContain('accum')
    // and it is a real column the engine will draw
    expect(parseFormula(formula).ok).toBe(true)
  })

  it('⛔⛔ the consolation this file offers is one the code actually makes', () => {
    // ⚰️ THE SENTENCE THIS REPLACES CLAIMED "the hit rate against its base rate",
    // which is precisely the pairing `definition_record` was written to prevent.
    // Pinning its wording here means a future edit cannot re-introduce the claim
    // without this going red — a ruling is allowed a consolation only if the
    // consolation is true.
    // ⛔ READ FROM THE PYTHON SOURCE, NOT FROM A COPY. Two JS test files keep
    // their own fixture copies of this string; asserting against one of those
    // would pin a duplicate and let the real sentence move underneath it.
    const src = fs.readFileSync(path.resolve(process.cwd(),
      '../api/routers/definition_record.py'), 'utf8')
    // ⚠️ THE SENTENCE IS SPLIT ACROSS CONCATENATED PYTHON LITERALS, so the
    // adjacent quote pairs are joined before matching — otherwise this asserts
    // against `an " "occurrence` and fails for a reason that is about formatting
    // rather than about the claim.
    const flat = src.replace(/"\s*"/g, '').replace(/\s+/g, ' ')
    expect(flat).toContain('an occurrence rate, not a win rate')
    expect(flat).toContain('no baseline to put beside it')
  })

  it('⛔ what a screen answers and what a strategy answers are different shapes', () => {
    // ⭐ THE RULING IN ONE ASSERTION. A screen's column is a yes/no per symbol on
    // the current bar — `treeYieldsBool` is the gate the scan lane applies, and
    // `assert_scannable`'s `yields` gate exists to stop anything else being
    // screened. A trade list and an equity curve have no such column: there is
    // nothing to ask 3,742 symbols today.
    const screen = translatePine(`//@version=6
indicator("s")
plot(ta.crossover(close, ta.sma(close, 50)) ? 1 : 0)
`)
    expect(screen.ok).toBe(true)
    // The SAME condition, as a screen, is a first-class column…
    expect(parseFormula(screen.outputs[screen.selected].formula).ok).toBe(true)
    // …and wrapped in an order, it is refused. Same maths, different question.
    expect(translatePine(STRATEGY_PINE).ok).toBe(false)
  })
})

// ─── W9-T15, RULING D7: THE SCORECARD'S STRATEGY-BACKTEST WORDING ──────────────
//
// The ruling above stays: a strategy is not a screen. D7 adds one plain row for the
// OTHER door, the single-symbol backtest W9 builds. It says three things and nothing
// else: how many broker rules are pinned (verified against TradingView captures), that
// an unpinned rule refuses by name, and that strategy backtests are not served yet.
// Counts come from the committed ledger, so the row cannot claim a pin that is not there.
describe('D7: the strategy-backtest scorecard wording', () => {
  it('states the pinned count from the ledger, the refusal by name, and that it is not served', () => {
    expect(pinnedBrokerRules()).toEqual([])
    expect(strategyScorecardWording()).toBe(
      `0 of ${BROKER_RULE_IDS.length} broker rules are pinned, each verified against a TradingView capture. `
      + 'A backtest that reaches an unpinned rule stops and refuses by name (runtime:strategy-unpinned). '
      + 'Strategy backtests are not served to members yet.')
    // ⭐ THE ONE PLACE THE VOCABULARY'S SIZE IS PINNED (dated 2026-11-08): 22 S1/T1 rules + 6 W9-T6
    // fill-timing rules (B-POC, B-POC-PRICE, B-POC-PYR, B-POC-FILLS, B-FILLS, B-TICK-HIST) + 8 W9-T7 rules
    // (B-TRAIL, B-EXIT-QTY, B-CLOSE-QTY, B-OCA, B-ORDER, B-IMMEDIATELY, B-STOP-LIMIT, B-EXIT-LEVELS).
    // W9-J1 is a pin-resolver precondition and fill limits refuse at build (T6 r1): neither is a rule.
    // + 5 W9-T5 cost rules (dated 2026-11-08), one per capture row the design names for T5: B-COMM-PCT
    // (W9-K1), B-COMM-CONTRACT (W9-K2), B-COMM-ORDER (W9-K3), B-SLIPPAGE (W9-K4), B-POC-COST (W9-P1,
    // design T6's "costs are taken at the close").
    // Every other rail DERIVES the count; a rule added without moving this line is the drift it catches.
    // + 3 W9-T8 risk rules (dated 2026-11-08), one per probe that calls its command: B-RISK-ALLOW (W9-R1,
    // allow_entry_in), B-RISK-DDOWN (W9-R1, max_drawdown), B-RISK-INTRADAY-ORDERS (W9-R1i,
    // max_intraday_filled_orders). The three commands no probe calls refuse at build and are not rules.
    expect(BROKER_RULE_IDS.length).toBe(44)
  })

  it('counts a pin only when the ledger holds it, and only for a rule the broker names', () => {
    const ledger = { rules: { 'B-MARKET': ['fx'], 'B-FILL': ['fx'], 'NOT-A-RULE': ['fx'] } }
    expect(pinnedBrokerRules(ledger)).toEqual(['B-FILL', 'B-MARKET'])
    expect(strategyScorecardWording({ ledger })).toMatch(new RegExp(`^2 of ${BROKER_RULE_IDS.length} broker rules are pinned`))
  })

  it('drops the not-served sentence only when the caller says it is served', () => {
    expect(strategyScorecardWording({ served: true })).not.toMatch(/not served/)
    expect(strategyScorecardWording()).toMatch(/not served to members yet\.$/)
  })

  it('is plain: no em dash, no marketing words, and the screener ruling is untouched', () => {
    const w = strategyScorecardWording()
    expect(w).not.toMatch(/—|–/)
    expect(w).not.toMatch(/coming soon|powerful|seamless|best|world-class|instant|!/i)
    expect(PINE_REFUSALS['pine:declaration-strategy'])
      .toBe('a strategy places orders to be backtested, and a screen filters symbols')
  })
})
