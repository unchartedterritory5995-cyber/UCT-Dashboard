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

import { maxLookback, nodeCount, sessionAnchoredIn, TableRefusal } from './interpret.js'
// ⭐ THE CAP READS THE SESSION CONSTANT FROM THE TABLE'S OWN READER, not from a
// digit of its own — see `DEFAULT_BUDGET`. `parse.js` is already in this module's
// graph through `interpret.js`, so this adds no reach: it names what was implicit.
import { SESSION_MAX_BARS } from './parse.js'

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
 *  maxLookback      — the chart holds 5,000 bars on every timeframe, and the
 *                     warmup a formula may ask for is capped so the user is not
 *                     left reading a mostly-empty pane as broken. ⭐⭐ IT IS
 *                     DERIVED, NOT TYPED: `Math.max(NESTED_RECURRENCE_WARMUP,
 *                     SESSION_MAX_BARS)` — the larger of the two families it has
 *                     to hold. See both constants below.
 *                     ⚠️ 500 UNTIL 2026-08-22, and that move is recorded rather
 *                     than smoothed over: a NESTED recurrence legitimately needs
 *                     TWO warmups. Script 10's trailing stop is `accum` inside
 *                     `accum` — the outer needs the inner correct across its own
 *                     250-bar window — so 250 + 250 + ATR's 22 + 1 = 524, and the
 *                     old cap refused the whole trailing-stop family by 24 bars.
 *  maxSeriesRefs 8  — spec §5's perf budget is ≤60 series and ≤8 panes per
 *                     chart; eight base-series reads inside ONE definition is
 *                     already the whole pane budget's worth of data in a single
 *                     column. Measured: the corpus tops out at FOUR. ⭐ IT COUNTS
 *                     DISTINCT SERIES, not references — see `seriesRefs` for the
 *                     false refusal that made the difference visible.
 *
 *  ⚠️ EACH IS DERIVED FROM A NUMBER THAT ALREADY EXISTS IN THIS SYSTEM, on
 *  purpose. A cap chosen by taste is a cap nobody can re-derive when it needs to
 *  move.
 *
 *  ⭐ `maxLookback` IS ALSO THE CEILING ON A BAR OFFSET, AND THERE IS NO SECOND
 *  NUMBER. `close[100000]` is a well-formed backward offset — `parse.js` has no
 *  ceiling of its own on purpose — and what refuses it is `budget:lookback`,
 *  because `maxLookback` counts an offset node as `value + child`. `close[600]`
 *  and `sma(close, 600)` are the same 600 bars of warmup and they meet the same
 *  cap, which is the only arrangement in which the two cannot drift apart. And
 *  because `effectiveBudget` clamps DOWNWARD ONLY, a stored blob cannot raise
 *  it — the offset ceiling is unforgeable for the same reason the others are.
 *
 *  ⚠️ SO RAISING THIS CAP TO HOLD A SESSION RAISED THE BAR-OFFSET CEILING WITH
 *  IT, from the old warmup to one session, and that is BY DESIGN rather than a
 *  side effect nobody costed: it is the same number, and the paragraph above is
 *  the reason there is only one. `close[<one session>]` is now well-formed and
 *  `close[<one session> + 1]` still refuses. Stated here so the next reader does
 *  not discover a second moved ceiling by surprise — nothing else widens:
 *  `DEFAULT_BUDGET` has no non-test consumer outside this module and its Python
 *  twin, and `effectiveBudget` still clamps a stored budget DOWNWARD only.
 *
 *  ⛔ A CAP MUST BE REACHABLE OR IT IS NOT A GUARD. `maxSeriesRefs` counts
 *  OCCURRENCES, not distinct names, and that is forced rather than stylistic:
 *  the closed table declares FIVE series, so a distinct-name count could never
 *  exceed 8 and `budget:series` would be a latch nothing can trip — the exact
 *  shape of `lesson_gate_that_cannot_fail`.
 */
/** The nested-recurrence family's warmup — the driver the lookback cap had
 *  BEFORE a session had to fit inside it, kept and named rather than deleted.
 *  `accum` inside `accum` needs TWO warmups: 250 + 250 + ATR's 22 + 1 = 524,
 *  rounded up.
 *
 *  ⛔ IT IS STILL LOAD-BEARING. If a corrected session were ever SHORTER than
 *  this, dropping it would silently refuse the whole trailing-stop family the
 *  2026-08-22 move was made to admit. `Math.max` is what keeps both promises. */
const NESTED_RECURRENCE_WARMUP = 550

/** ⭐⭐ THE LOOKBACK CAP — DERIVED FROM THE LARGER OF THE TWO FAMILIES IT HOLDS,
 *  AND NEVER TYPED. Controller ruling O7, 2026-08-26.
 *
 *  ⛔ WHY IT MOVED, so the next reader does not see a raised budget and assume
 *  somebody was making a script pass. `lookback: 'session'` bounds to one ET
 *  calendar day (`closedTable.json::sessionMaxBars`), which is LONGER than
 *  `NESTED_RECURRENCE_WARMUP`. Under the old cap every session-anchored call
 *  refused `budget:lookback` at the save door and at compute — the declared
 *  grammar shipped unusable, which is worse than the depth it costs. The note
 *  above forbids moving this *"to make one script pass"*, and that prohibition
 *  is right; this is not one script but an entire declared grammar the spec
 *  requires, and the number comes from this engine's own definition of a session
 *  rather than being chosen to fit. That is the distinction the note protects.
 *
 *  📏 THE MEASURED COST, at the site rather than only in a report: on the
 *  5,000-bar window the chart holds, a 550-bar warmup left **89%** drawable and
 *  one session leaves **81%**. Eight points of one pane, against a grammar that
 *  otherwise cannot be used at all. Reversible in one constant.
 *
 *  ⚠️ THE UX RULE DID NOT CHANGE, only the number it yields — the same sentence
 *  the 500 → 550 move was recorded with. */
export const DEFAULT_BUDGET = Object.freeze({
  maxNodes: 128,
  maxLookback: Math.max(NESTED_RECURRENCE_WARMUP, SESSION_MAX_BARS),
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

/** How many DISTINCT BASE SERIES a canonical tree reads.
 *
 *  ⭐⭐ DISTINCT, NOT REFERENCES, AND THE CAP'S OWN RATIONALE IS WHY. The note
 *  above says eight reads are "the whole pane budget's worth of DATA in a single
 *  column" — and data is a function of how many columns must be fetched, held
 *  and walked, not of how many times the tree mentions one of them. `high` read
 *  four times is ONE column by every one of those measures.
 *
 *  ⚰️ IT COUNTED REFERENCES until 2026-08-09, and that was a false refusal with
 *  no Pine anywhere near it: `(high + low + close) / 3 > sma((high + low +
 *  close) / 3, 20)` is three distinct series and SIX references, and two of those
 *  in one formula met the cap. What surfaced it was `tr` — the Pine built-in,
 *  expanded to `max(high - low, max(abs(high - close[1]), abs(low - close[1])))`
 *  — which made a real published ATR script translate and then refuse AT THE SAVE
 *  DOOR, which is the worst outcome available: worse than refusing early, because
 *  the member has already been told it worked.
 *
 *  ⚠️ THE CAP DID NOT MOVE. Only the measurement did, and distinct ≤ references
 *  always, so nothing that passed before can fail now. Tree SIZE is still capped
 *  — by `maxNodes`, which is the measurement that was always about size.
 *
 *  ⛔ ITERATIVE, like `nodeCount` and `maxLookback` and for the same reason: the
 *  escape corpus's `too_many_nodes` case is 8,001 nodes deep, and a measurement
 *  that dies inside the guard is not a refusal.
 *
 *  ⚠️ IT STILL COUNTS A NAME THE TABLE DOES NOT DECLARE. That is the conservative
 *  direction and it is deliberate: deciding whether a name resolves is
 *  `resolve:name`'s question, and answering it here would move `escapes.json`'s
 *  three `resolve:name` cases out from under the guard that is supposed to catch
 *  them — which is this file's whole subject. */
export function seriesRefs(ast) {
  const found = new Set()
  const stack = [ast]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node)) { for (const child of node) stack.push(child); continue }
    // ⛔ KEYED BY NAME, AND A NON-STRING NAME IS ITS OWN KEY RATHER THAN SKIPPED.
    // A malformed `{type:'series'}` with no name is still a read this measurement
    // cannot account for, and dropping it would make a broken tree look CHEAPER
    // than a working one.
    if (node.type === 'series') found.add(typeof node.name === 'string' ? node.name : JSON.stringify(node.name))
    if (Array.isArray(node.args)) for (const arg of node.args) stack.push(arg)
  }
  return found.size
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
/** The half-sentence that turns a number into a reason, for the one case where
 *  the number alone reads as an arbitrary rejection.
 *
 *  🔴 THE MEASURED CASE. `crossOver(close, vwap())` is the formula a member
 *  will type first, and it measures ONE BAR over the cap — because the cap is
 *  DERIVED to hold exactly one trading session and a session-anchored call
 *  spends all of it. `sma(vwap(), 20)`, `change(vwap())`, `highest(vwap(), 2)`
 *  and `vwap()[1]` are the same story. Without this clause the member reads two
 *  bare numbers one apart and has no way to know that the fix is not a smaller
 *  window.
 *
 *  ⛔ IT CHANGES NO VERDICT. The refusal is decided by the number, above; this
 *  is the sentence after the dash. And it is DERIVED — `sessionAnchoredIn` reads
 *  the manifest, so a third session-anchored entry names itself here on the day
 *  it lands, and this module still spells `session` nowhere. */
function whyOverBudget(key, ast) {
  // ⛔ NO `try` HERE, AND THAT IS A RAIL RATHER THAN A PREFERENCE: this module
  // may not contain one at all, because a caught `RangeError` is one line from
  // being dressed up as a budget refusal. It needs none — `MEASURE[key](ast)`
  // has already walked this tree above, so anything malformed enough to throw
  // has thrown before this line is reached.
  if (key !== 'maxLookback') return ''
  const names = sessionAnchoredIn(ast)
  if (!names.length) return ''
  const list = names.map((n) => `\`${n}()\``).join(' and ')
  return `. ${list} reaches back one whole trading session, which is the entire `
    + 'lookback budget — so it can be compared and combined, but nothing can be '
    + 'wrapped around it (no moving average of it, no bar offset on it)'
}

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
        error: `${REFUSALS[guard]} — this formula measures ${value} and the cap is ${caps[key]}`
          + whyOverBudget(key, ast),
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
