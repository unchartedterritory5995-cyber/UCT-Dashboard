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
