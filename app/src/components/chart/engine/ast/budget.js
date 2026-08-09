// ─── THE BUDGET — AND THE DOOR IT REFUSES AT IS ITS OWN ─────────────────────
//
// `compute.budget` has been RESERVED in `defSchema.js` since the schema was
// written: the validator checks it is null-or-an-object and nothing reads it.
// This module is what makes it mean something — node count, lookback depth and
// base-series reads — and it refuses as a BUDGET refusal, named as such, which
// is the whole point.
//
// ⭐⭐ THE DEFECT THIS FILE WAS WRITTEN AGAINST IS "REFUSED BY A DIFFERENT
// DOOR", AND IT HAS APPEARED THREE TIMES ON THIS BRANCH. The escape census read
// `0 escaped` while every one of its fifteen cases — including the three
// `budget:*` ones — was refused at the ROOT by `interpret:node`, because the
// census handed jsep trees to a lane that deliberately has no parser. The same
// shape reappeared inside a mutation harness (a lane blinded, and the recorder
// refused at an EARLIER door than the one under test). A refusal that arrives
// from the wrong door reads identically to the right one and proves nothing
// about the guard it is credited to.
//
// So the rule this module is built on: **every refusal here must be
// attributable to a cap declared here, and no refusal that belongs to another
// guard may be produced here.** In particular:
//
//   * `checkBudget` calls `nodeCount` and `maxLookback`, and those two REFUSE
//     `interpret:node`, `resolve:function`, `resolve:arity` and `resolve:window`
//     for trees that are malformed, call an unknown name, are called with the
//     wrong arity, or carry a non-literal window. Those refusals PROPAGATE
//     UNCHANGED. They are not caught, not re-wrapped and not renamed — a tree
//     that is refused by `resolve:function` must read `resolve:function` even
//     when the budget check is what happened to touch it first.
//   * a `RangeError` (a tree deep enough to overflow the stack) is NOT a
//     refusal, and this module contains NO `try`, so it cannot become one. See
//     `budget.test.js`'s AST scan, which asserts that structurally rather than
//     by reading this comment.
//
// ⚠️ THIS MODULE AND `interpret.js` IMPORT EACH OTHER. That is a real ES module
// cycle and it is deliberate: the budget consumes the interpreter's measurements
// (there must not be a second `maxLookback` — there are already two in this
// directory and Task 7 paid for the second with an agreement rail), and the
// interpreter consumes the budget's check at COMPUTE time. It resolves because
// every cross-module use is inside a function body: `export function` bindings
// are hoisted and initialised before either module body runs, and no `const`
// from the other module is read at module scope. `budget.test.js` proves it in
// the direction that breaks first — a module graph whose ENTRY is this file.
//
// ⚠️ THE PYTHON LANE'S CYCLE IS RESOLVED THE OTHER WAY ROUND, because Python
// has no live bindings: `ast_budget.py` imports `ast_interpret` at module level
// and `ast_interpret.interpret` imports the budget INSIDE the function. Same
// two edges, same call-time resolution, different mechanism — stated here so
// nobody reads the asymmetry as two different designs.

import { maxLookback, nodeCount, TableRefusal } from './interpret.js'

// --------------------------------------------------------------------------- //
// the caps
// --------------------------------------------------------------------------- //

/** ⭐ THE CAPS, AND WHY EACH IS WHERE IT IS.
 *
 *  maxNodes 128     — the largest hand-written native in this registry is
 *                     `ichimoku` at 5 columns; a 128-node single column is far
 *                     past anything a human composes and far short of anything
 *                     that blocks a frame at the 5,000-bar cap. Measured: the
 *                     whole committed AST corpus tops out at NINE nodes.
 *  maxLookback 500  — the chart holds 5,000 bars on every timeframe, and a
 *                     500-bar warmup already leaves 90% of a full window
 *                     drawable. Above that the user sees a mostly-empty pane and
 *                     reads it as broken. Measured: the corpus tops out at 200.
 *  maxSeriesRefs 8  — spec §5's perf budget is ≤60 series and ≤8 panes per
 *                     chart; eight base-series reads inside ONE definition is
 *                     already the whole pane budget's worth of data in a single
 *                     column. Measured: the corpus tops out at FOUR.
 *
 *  ⚠️ EACH IS DERIVED FROM A NUMBER THAT ALREADY EXISTS IN THIS SYSTEM, on
 *  purpose. A cap chosen by taste is a cap nobody can re-derive when it needs to
 *  move.
 *
 *  ⛔ A CAP MUST BE REACHABLE OR IT IS NOT A GUARD. `maxSeriesRefs` counts
 *  OCCURRENCES, not distinct names, and that is forced rather than stylistic:
 *  the closed table declares FIVE series, so a distinct-name count could never
 *  exceed 8 and `budget:series` would be a latch nothing can trip — the exact
 *  shape of `lesson_gate_that_cannot_fail`.
 */
export const DEFAULT_BUDGET = Object.freeze({
  maxNodes: 128,
  maxLookback: 500,
  maxSeriesRefs: 8,
})

/** cap key → the guard that refuses it. */
export const CAP_GUARD = Object.freeze({
  maxNodes: 'budget:nodes',
  maxLookback: 'budget:lookback',
  maxSeriesRefs: 'budget:series',
})

/** guard → the sentence it always refuses with.
 *
 *  ⛔ PAIRWISE DISJOINT, AND ACROSS `parse.js`'s NINE AND `interpret.js`'s SIX
 *  TOO. Two gates sharing a phrase let a `toThrow(/…/)` pass with the safety
 *  deleted, and that has happened in this repo. `budget.test.js` asserts the
 *  disjointness over the UNION of all three tables, not just this one — and it
 *  asserts it in both directions, because "no fragment is a substring of
 *  another" is the half a set-equality misses. */
export const REFUSALS = Object.freeze({
  'budget:nodes': 'exceeds the node budget',
  'budget:lookback': 'exceeds the lookback budget',
  'budget:series': 'exceeds the series-reference budget',
})

// --------------------------------------------------------------------------- //
// the third measurement
// --------------------------------------------------------------------------- //

/** How many BASE-SERIES READS a canonical tree performs.
 *
 *  ⛔ ITERATIVE, like `nodeCount` and `maxLookback` and for the same reason: the
 *  escape corpus's `too_many_nodes` case is 8,001 nodes deep, and a measurement
 *  that dies inside the guard is not a refusal.
 *
 *  ⚠️ IT COUNTS EVERY `series` NODE, INCLUDING A NAME THE TABLE DOES NOT
 *  DECLARE. That is the conservative direction and it is deliberate: deciding
 *  whether a name resolves is `resolve:name`'s question, and answering it here
 *  would move `escapes.json`'s three `resolve:name` cases out from under the
 *  guard that is supposed to catch them — which is this file's whole subject.
 *  An over-count can only make the budget TIGHTER, never looser. */
export function seriesRefs(ast) {
  let found = 0
  const stack = [ast]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) { for (const child of node) stack.push(child); continue }
    if (node.type === 'series') found += 1
    if (Array.isArray(node.args)) for (const arg of node.args) stack.push(arg)
  }
  return found
}

/** cap key → the measurement it thresholds. The key set IS `DEFAULT_BUDGET`'s,
 *  both directions, and `budget.test.js` asserts that — a cap with no
 *  measurement is a number nothing reads, and a measurement with no cap is a
 *  guard nobody declared. */
const MEASURE = Object.freeze({
  maxNodes: nodeCount,
  maxLookback: maxLookback,
  maxSeriesRefs: seriesRefs,
})

/** The order the caps are consulted in, cheapest-and-most-bounding first.
 *
 *  ⚠️ DECLARED RATHER THAN LEFT TO `Object.keys`. `nodeCount` is what bounds the
 *  cost of everything after it, so an 8,001-node tree is refused before
 *  `maxLookback` ever walks it; and a tree that fails two caps must report the
 *  same one on every run, in both lanes, or the census's guard reconciliation
 *  measures traversal order. `parse.js::OFFENCE_PRIORITY` closed the identical
 *  question for the canonicalise door. */
const CAP_ORDER = Object.freeze(['maxNodes', 'maxLookback', 'maxSeriesRefs'])

// --------------------------------------------------------------------------- //
// the budget a definition actually runs under
// --------------------------------------------------------------------------- //

/** A stored `compute.budget` resolved against the default. **DOWNWARD ONLY.**
 *
 *  ⛔ DOWNWARD ONLY, AND IT IS NOT BELT-AND-BRACES. `compute.budget` arrives
 *  from a stored definition, which is USER DATA. A stored budget that could
 *  RAISE the cap is a stored value that turns off its own limit — the same class
 *  as an `active=0` that also blinds a soak, refused for the same reason.
 *
 *  ⚠️ AND THE CLAMP LIVES HERE, NOT AT THE CALL SITE. `checkBudget` runs every
 *  budget it is handed through this function, so there is NO code path in which
 *  a cap above the default is honoured — not even one a caller constructs by
 *  hand. A clamp a caller has to remember is a clamp somebody forgets.
 *
 *  A value that is not a whole number ≥ 1 falls back to the DEFAULT rather than
 *  refusing: the default is the ceiling, so falling back to it can only ever
 *  tighten relative to no budget at all, and a malformed stored blob must not be
 *  able to make a chart un-drawable. Whether the blob is well-formed is
 *  `defSchema`'s question, at a different door. */
export function effectiveBudget(stored) {
  const from = (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {}
  const out = {}
  for (const key of Object.keys(DEFAULT_BUDGET)) {
    const cap = DEFAULT_BUDGET[key]
    const asked = from[key]
    out[key] = (typeof asked === 'number' && Number.isInteger(asked) && asked >= 1 && asked < cap)
      ? asked
      : cap
  }
  return Object.freeze(out)
}

// --------------------------------------------------------------------------- //
// the check
// --------------------------------------------------------------------------- //

/** Is this tree inside its budget? Returns a RESULT; never throws for a budget.
 *
 *  This is the REGISTRATION half — the UX one. An author typing a formula gets a
 *  message, not an exception, for the same reason `parseFormula` never throws:
 *  the whole surface is a text box somebody is halfway through.
 *
 *  ⚠️ IT CAN STILL THROW — a `TableRefusal` FROM ANOTHER GUARD. `nodeCount`
 *  refuses `interpret:node` for a malformed tree and `maxLookback` refuses
 *  `resolve:function` / `resolve:arity` / `resolve:window`. Those propagate
 *  unchanged, on purpose: the refusal must name the door that decided, not the
 *  function that happened to be on the stack.
 *
 *  @returns {{ok: true, caps: object, measured: object}
 *          | {ok: false, guard: string, error: string, caps: object, measured: object}}
 */
export function checkBudget(ast, budget) {
  const caps = effectiveBudget(budget)
  const measured = {}
  for (const key of CAP_ORDER) {
    const value = MEASURE[key](ast)
    measured[key] = value
    if (value > caps[key]) {
      const guard = CAP_GUARD[key]
      return {
        ok: false,
        guard,
        error: `${REFUSALS[guard]} — this formula measures ${value} and the cap is ${caps[key]}`,
        caps,
        measured,
      }
    }
  }
  return { ok: true, caps, measured }
}

/** The COMPUTE half — the SAFETY one. Throws `interpret.js`'s `TableRefusal`.
 *
 *  ⛔ BOTH HALVES EXIST, AND THE REASON IS NOT BELT-AND-BRACES.
 *    * Registration-only: a definition registered under one budget and run under
 *      a later, smaller one computes forever at the old cost.
 *    * Compute-only: the refusal arrives as a chart that draws sometimes — spec
 *      §6 state 4 — when it should have been an error the author saw while
 *      typing.
 *  The registration check is the UX; this one is the safety, and this is the one
 *  a mutation must not be able to delete quietly.
 *
 *  ⛔ IT THROWS `interpret.js`'s CLASS, not one of its own. The escape census
 *  recognises a refusal BY TYPE; a look-alike class with `name = 'TableRefusal'`
 *  would be exactly the "right type for the wrong reason" blindness Task 2
 *  declared this instrument to have. */
export function assertBudget(ast, budget) {
  const result = checkBudget(ast, budget)
  if (!result.ok) throw new TableRefusal(result.guard, result.error)
  return result
}
