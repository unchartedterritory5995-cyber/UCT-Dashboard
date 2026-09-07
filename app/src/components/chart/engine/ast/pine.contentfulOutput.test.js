// app/src/components/chart/engine/ast/pine.contentfulOutput.test.js
//
// ─── ⭐⭐ WAVE A: AN ACCEPTANCE MAY NOT REST ON A CONTENTLESS COLUMN ──────────
//
// ⚰️ WHAT THIS FILE EXISTS TO STOP, MEASURED ON REAL PUBLISHED SCRIPTS.
// The 60-script blind out-of-sample corpus (freeze `5df718c2`) accepted THREE
// indicators whose every offered column carried nothing from the script, after
// every series they actually compute had been correctly refused:
//
//   · `mid_engagement__01-zeiierman-trend-pressure` — 2 of 18 outputs survived,
//     and both were the CONSTANTS -12 and -88 (`-max(8, min(42, 20-(7-5)*4))`).
//   · `mid_engagement__05-supertrend-fibonacci-ote` — 4 outputs, all bare
//     `open`/`high`/`low`/`close`, and the door SELECTED `open` as the member's
//     representative column for a script called "Supertrend + Fibonacci OTE".
//   · `long_tail__02-relative-volume-candles-narrow-ranges` — the same shape.
//
// Three independent adjudicators, each given the source and the result but not
// the desired answer and none seeing another's verdicts, called exactly these
// three MISLEADING out of 21 accepted. After the fix the accepted set is
// IDENTICAL to the 18 they called faithful — no over-shoot, no under-shoot.
//
// ⛔ TWO MECHANISMS, AND NEITHER WAS A WRONG NUMBER.
//   A. `readsBars` returned true for ANY node of type `call`, without looking at
//      its arguments — so `max(8, 42)` was "reading bars". Since
//      `hidden = authorHid || !readsBars(ast)`, a constant-valued call walked
//      through the one guard that stops a dead column being offered.
//   B. `plotcandle`'s payload is its `color=` argument, which this door does not
//      read. Strip presentation and the call degenerates into four raw price
//      columns that read bars honestly and mean nothing.
//
// ⚠️ THE SECOND IS DOWNSTREAM OF THE FIRST PROBLEM THIS PROGRAM NAMED: the
// importer discards presentation at the door. This file pins the SAFETY
// contract; carrying presentation is Wave B's job, and when it lands the
// passthrough case should become an import rather than a refusal.

import { describe, it, expect } from 'vitest'

import { translatePine, readsBars, isBareSource } from './pine.js'
import { parseFormula, TABLE, BAR_READERS, RECURRENCES } from './parse.js'

const src = (body) => `//@version=5\nindicator("t")\n${body}\n`
const tree = (f) => {
  const p = parseFormula(f)
  expect(p.ok, `fixture did not parse: ${f}`).toBe(true)
  return p.ast
}

// ─── A1: bar-dependence is SEMANTIC, not syntactic ──────────────────────────

describe('readsBars asks what a tree DEPENDS ON, not what it looks like', () => {
  it('⛔⛔ a call over literals is a constant — the exact OOS false-success shape', () => {
    expect(readsBars(tree('max(8, 42)'))).toBe(false)
    expect(readsBars(tree('-max(8, min(42, 20 - (7 - 5) * 4))'))).toBe(false)
    expect(readsBars(tree('-100 + max(8, min(42, 20 - (7 - 5) * 4))'))).toBe(false)
  })

  it('⛔ nesting does not launder a literal — depth changes nothing', () => {
    expect(readsBars(tree('max(min(1, 2), max(3, max(4, 5)))'))).toBe(false)
    // …and an offset of a constant is still a constant.
    expect(readsBars(tree('max(8, 42)[3]'))).toBe(false)
  })

  it('⭐ ONE bar-dependent argument anywhere makes the whole tree bar-dependent', () => {
    expect(readsBars(tree('max(close, 42)'))).toBe(true)
    expect(readsBars(tree('max(min(1, 2), max(3, sma(close, 5)))'))).toBe(true)
    expect(readsBars(tree('close'))).toBe(true)
    expect(readsBars(tree('close[1]'))).toBe(true)
    expect(readsBars(tree('sma(close, 20)'))).toBe(true)
  })

  it('⭐⭐ EVERY IDENTIFIER IS A `series` NODE — price, clock AND scalar alike', () => {
    // `closedTable.json::_scalars_node` states it: a scalar rides the `series`
    // node type rather than adding one of its own, because `parse.js` turns every
    // identifier into one so the parser needs no table. A scalar is constant
    // ACROSS BARS but varies per SYMBOL, so it is a real column and must stay one
    // — a rule written as "contains a price series" would have silently deleted
    // every fundamentals-based screen in the product.
    for (const name of ['dayofweek', 'barindex', 'hour', 'isweekly']) {
      expect(readsBars(tree(name)), `clock field ${name}`).toBe(true)
    }
    for (const name of ['beta', 'adr_pct', 'above_50sma']) {
      expect(readsBars(tree(name)), `scalar ${name}`).toBe(true)
    }
  })

  it('⭐⭐ a call that varies bar-to-bar WHATEVER it is handed says so IN DATA', () => {
    // Two declarations, both read off the manifest, neither listed in pine.js.
    // ⛔ `vwap` takes NO ARGUMENTS AT ALL, so argument recursion alone would call
    // it a constant — this clause is the reason it does not.
    expect(BAR_READERS.length, 'the bar-reading declaration is empty').toBeGreaterThan(0)
    for (const name of BAR_READERS) {
      const f = TABLE.functions[name]
      const args = (f && Array.isArray(f.args) ? f.args : []).map(() => 'close').join(', ')
      const expr = args ? `${name}(${args})` : name
      const p = parseFormula(expr)
      if (p.ok) expect(readsBars(p.ast), `${expr} declares reads:'bars'`).toBe(true)
    }
    // ⛔⛔ AND A RECURRENCE ITERATES BARS. `x = 1.0 / x := x + 1 / plot(x)` is a
    // COUNTER — 1, 2, 3, 4 … — not a constant. Omitting this clause made exactly
    // that script refuse, and `pine.forLoopReassignSilentWrongResult.test.js`'s
    // non-vacuity control caught it: the regression net doing its job.
    expect(Object.keys(RECURRENCES).length).toBeGreaterThan(0)
    for (const name of Object.keys(RECURRENCES)) {
      expect(readsBars(tree(`${name}(0, self + 1, 250)`)), `${name} declares a recurrence`).toBe(true)
    }
  })

  it('⛔⛔ THE MUTATION: restoring "any call reads bars" must break this file', () => {
    // The control. `readsBars` is a walk, so a mutant is cheap to build here and
    // proves the assertions above are load-bearing rather than coincidentally
    // true. This is the EXACT prior implementation.
    const oldReadsBars = (node) => {
      const stack = [node]
      while (stack.length) {
        const n = stack.pop()
        if (!n || typeof n !== 'object') continue
        if (n.type === 'series' || n.type === 'call') return true
        if (Array.isArray(n.args)) stack.push(...n.args)
      }
      return false
    }
    // Under the old rule the OOS false-success tree is "bar-reading"…
    expect(oldReadsBars(tree('-max(8, min(42, 20 - (7 - 5) * 4))'))).toBe(true)
    // …and under the current one it is not. If these two ever agree, the fix is
    // gone and every assertion above has become vacuous.
    expect(readsBars(tree('-max(8, min(42, 20 - (7 - 5) * 4))'))).toBe(false)
  })
})

// ─── A2/A3: the contentful-output contract ──────────────────────────────────

describe('an import must offer at least one column that carries the script', () => {
  it('⛔⛔ a script whose every column is constant is REFUSED, and says so', () => {
    const out = translatePine(src('plot(max(8, 42))'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:constant-only')
    expect(out.outputs[0].hiddenReason).toBe('constant')
  })

  it('⛔⛔ …and it NEVER declines in silence — that was the defect', () => {
    // `ok:false` with `refusal: null` reached a member as nothing at all. One
    // real published indicator did this because its only `plot()` was the
    // `plot(0)` placeholder that table-drawing scripts conventionally carry.
    for (const body of ['plot(0)', 'plot(max(8, 42))', 'plotcandle(open, high, low, close)']) {
      const out = translatePine(src(body))
      expect(out.ok, body).toBe(false)
      expect(out.refusal, `${body} declined in SILENCE`).toBeTruthy()
      expect(out.refusal.message.length, body).toBeGreaterThan(20)
    }
  })

  it('⛔⛔ a candle built from unchanged price is not an indicator', () => {
    const out = translatePine(src('plotcandle(open, high, low, close)'))
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:presentation-only')
    // ⭐ AND `open` IS NOT HANDED BACK AS THE ANSWER. `selected` was the sharpest
    // symptom in the corpus: a script named "Supertrend + Fibonacci OTE Grid &
    // Bands" whose representative column was the raw open price.
    expect(out.selected).toBe(-1)
  })

  it('⭐ THE CONTROL — ordinary source-derived formulas still import', () => {
    // A rule that banned source series would pass every assertion above and
    // destroy the product. `plot(close)` is a member deliberately plotting the
    // close, and the value of a `plot` IS its payload.
    for (const body of [
      'plot(close)',
      'plot(sma(close, 20))',
      'plot(close > open ? 1 : 0)',
      'plot(ta.rsi(close, 14))',
      'plotcandle(ta.sma(open, 2), ta.sma(high, 2), ta.sma(low, 2), ta.sma(close, 2))',
    ]) {
      const out = translatePine(src(body))
      expect(out.refusal, `${body}: ${out.refusal && out.refusal.message}`).toBe(null)
      expect(out.ok, body).toBe(true)
    }
  })

  it('⭐ a scalar-only screen still imports — constant across bars, not across symbols', () => {
    const out = translatePine(src('plot(beta > 1 ? 1 : 0)'))
    expect(out.refusal, out.refusal && out.refusal.message).toBe(null)
    expect(out.ok).toBe(true)
  })

  it('⭐ ONE contentful column is enough — the gate is not "every column"', () => {
    const out = translatePine(src('plot(max(8, 42))\nplot(sma(close, 20))'))
    expect(out.ok).toBe(true)
    expect(out.outputs.filter((o) => o.hiddenReason === 'constant')).toHaveLength(1)
    // ⭐ and the constant is never what the member is shown first.
    expect(out.outputs[out.selected].formula).toBe('sma(close, 20)')
  })
})

describe('isBareSource is UNCHANGED PRICE, and nothing wider', () => {
  it('⛔ the five price fields, untouched', () => {
    for (const n of ['open', 'high', 'low', 'close', 'volume']) {
      expect(isBareSource(tree(n)), n).toBe(true)
    }
  })

  it('⭐ anything BUILT on a source is the script`s own arithmetic', () => {
    for (const f of ['close * 2', 'sma(close, 20)', 'close[1]', 'hlc3', 'beta']) {
      expect(isBareSource(tree(f)), f).toBe(false)
    }
  })
})
