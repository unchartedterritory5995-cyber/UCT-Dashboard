// app/src/components/chart/builder/criteria.js
//
// ─── THE PICKER MODEL — A VIEW OVER THE TREE, NEVER A SECOND ARTIFACT ───────
//
// ⛔ NOTHING PICKER-SHAPED IS PERSISTED. `defSchema.validateCompute` already
// requires `compute.source` to parse back to `compute.ast`, compared BY HASH, so
// a stored picker shape would be a THIRD artifact beside those two and the three
// would drift with nothing to say so. The picker is rebuilt from the tree on
// every open — which is exactly what makes a lossy `fromAst` visible instead of
// invisible.
//
// ⛔ THERE IS NO SECOND TREE-MAKER. `toSource` spells SOURCE, fully
// parenthesised, and `parseFormula` makes the tree — the one parser, in the
// browser, D-A1 untouched. The spelling is presentation: `astHash` is over the
// CANONICAL tree, so two spellings of one tree are ONE `def_hash` and ONE scan.
//
// ⛔ `fromAst` IS PARTIAL AND REFUSES BY NAME. A picker that silently drops a
// term it cannot show IS the TC2000 PCF seam one hop earlier.
//
// ⛔ AND A SCALAR IS NOT A NODE TYPE. E-1 settled the scalar encoding: a scalar
// rides the `series` node, so there is no `'scalar'` node type to test for here.
// What distinguishes a scalar from a bar series is the VOCABULARY LOOKUP below,
// not the node tag.
//
// ⚰️ THIS SAID "THE CANONICAL NODE VOCABULARY IS FOUR TYPES", AND IT WAS THE
// SENTENCE THAT KEPT THIS FILE THREE COMMITS BEHIND THE GRAMMAR. `291c9d8a`
// added a fifth — `offset` — and `parse.js::NODE_TYPES` has read five ever
// since; `assert_canonical`, `ast_budget`, `ast_lint`, `ast_freshness` and
// `sentence.js` all learned it, and `c6ae15171` closed the Python sentence lane.
// This module dispatched four and answered `picker:node` for the fifth, so two
// of the firm's own two-bar setups could not be opened in the door that exists
// to teach the syntax. ⛔ DO NOT WRITE A COUNT HERE AGAIN — read
// `parse.js::NODE_TYPES`, which is the one authority, and note that the reason
// this drifted invisibly is that a picker with no row for a node REFUSES, and a
// refusal reads exactly like a decision.
//
// ⭐⭐ TWO ROW SHAPES, AND THE SECOND ONE IS WHY THE TWO DOORS NOW OFFER THE SAME
// SET. Spec §1.1 is that the definition consumed by chart, alerts, screener and
// builder is the SAME OBJECT — so two doors onto it that do not offer the same
// conditions is exactly the asymmetry the spec names by competitor. E-4 shipped
// `crossOver(close, open)` as a REFUSAL because a `<term> cmp <term>` row cannot
// spell a call; a member could TYPE a crossing, save it, scan it, chart it and
// alert on it, and the picker would say it had no shape for it.
//
// The fix is not a special case for crossings — it is the observation that BOTH
// shapes are the same sentence, `<term> <something that yields a yes/no> <term>`,
// and that the manifest already says which names those are:
//
//   * an OPERATOR of arity 2 that yields `bool` and is not a join — spelled
//     INFIX, `(left cmp right)`;
//   * a FUNCTION of two arguments that yields `bool` — spelled as a CALL,
//     `name(left, right)`.
//
// ⛔ NEITHER IS LISTED. `crossings` falls out of `yields` and the declared
// argument count exactly as `comparators` falls out of `yields` and `arity`, so
// a third bool function lands in the picker the day the manifest declares it and
// a renamed one follows without an edit here. `criteria.test.js`'s source rail is
// what keeps that true: a hand-list that AGREES with today's manifest passes
// every behavioural test there is (E-4's M10: 825 of 826 green) and only an AST
// walk of this file sees it.
//
// ⭐⭐ AND A THIRD ROW SHAPE, WHICH IS THE SAME MISTAKE ONE NODE TYPE OVER. E-4
// answered `picker:not-a-condition` for a BARE `series` node — and the manifest
// declares `above_50sma` with `"yields": "bool"`. Telling a member that
// `above_50sma` "produces a number" is FALSE, and it is what made the ONE
// starter the library ships unopenable in the picker that exists to teach it.
// The correction is the crossing row's, restated:
//
//   * a NAME the manifest declares `yields: "bool"` IS a condition, and its row
//     is the whole condition — one control, no relation and no second side.
//
// ⛔ NEITHER SECTION NOR NAME IS LISTED. `flags` is read off `yields` across the
// `series`, `clock` AND `scalars` sections, so a 55th boolean scalar — or the
// first boolean BAR FIELD, which today's manifest has none of — reaches the
// picker the day it is declared, with no edit here. And it fails the SAFE way:
// an entry with no `yields` reads as `num` (the manifest's own `_yields` rule),
// so a bare `close` still refuses exactly as it did.
//
// ⭐ THE CLOCK SECTION (tableVersion 2) IS OFFERED AS A FLAG ROW ONLY — the
// ruling that added it here scoped it to this ONE row shape, not to `series`/
// `scalars` TERM membership. A clock name reads back as a flag (`isintraday`
// alone), but it is not also usable as a comparison operand (`isintraday == 1`
// still refuses) the way a scalar or bar field is — see `readTerm`/`termSource`,
// which are unchanged. `criteria.test.js` records that asymmetry as a decision.
//
// ⭐ AND A NEGATIVE NUMBER IS A NUMBER. The same confusion of a node's TYPE with
// what it DENOTES, a third time: this grammar has no negative literal —
// `_canonical` says the canonical tree spells unary minus `u-` — so `-2` arrives
// as an OPERATOR node, and a picker that asks *what node type is this* refused a
// plain number as though it were arithmetic. That is the OTHER half of why the
// shipped starter could not be opened (`pct_vs_ema20 >= -2`). ⛔ WHICH operator
// negates is not spelled either: it is MEASURED by running the shipped
// interpreter over literal operands, exactly as the join/comparator split below
// is. The operand must be a LITERAL — `-close` is arithmetic and still refuses.
//
// ⭐⭐ AND A FOURTH ROW SHAPE, WHICH IS THE ONE THAT DOES NOT FALL OUT OF THE
// OTHER THREE. Every shape above is `<something> <relation> <something>` or a
// name standing alone — all of them LEAVES. `!x` is none of those: its operand
// is a CONDITION, so it WRAPS a row rather than being one, and it is the first
// node in this model with a picker child. That is why it needed a shape of its
// own rather than a second name in an existing one:
//
//   * a NEGATION is a condition with exactly one condition inside it, and its
//     control is a toggle ON that condition — not a row beside it.
//
// ⛔ AND THE NAME IS MEASURED, NOT SPELLED, exactly as the join/comparator split
// and the numeric negation below are: a logical NOT is the arity-1 operator that
// maps zero to one and every non-zero to zero, which is a fact about the SHIPPED
// INTERPRETER and is read by running it. Rename `!` in `closedTable.json` and
// this keeps working; delete it and negation fails CLOSED — `!x` cannot be typed
// either, because the parser builds its unary set from the same table.
//
// ⛔ AND `!!x` IS REFUSED IN BOTH DIRECTIONS RATHER THAN APPROXIMATED IN ONE.
// Collapsing it to `x` would make the AST identity property FALSE — `!!x` and
// `x` are the same truth and DIFFERENT TREES, and this model's whole claim is
// that it hands back the tree it was given. Rendering it would need a control
// the picker does not have (one toggle per condition says "negated", not "how
// many times"). So a negation of a negation refuses BY NAME, in `readCondition`,
// in `toSource` and in `canonicalPicker`, and the picker cannot build one.
//
// ⭐⭐ AND A FIFTH SHAPE, WHICH IS NOT A SHAPE AT ALL BUT A QUALIFIER ON ONE.
// `expr[N]` — the `offset` node — says WHEN to read something that is already
// there. It is not a row, it is not a relation and it is not a name: every one
// of the four above is a THING ON THE PAGE, and this one is an adverb. So it
// does not get a container. It rides the operand it qualifies, and the leaf row
// it qualifies, as one optional field:
//
//   * `bars: N` (a whole number ≥ 1) on a TERM — `{t:'name', name:'high',
//     bars:1}` spells `high[1]`;
//   * `bars: N` on a LEAF ROW — a comparison, a crossing or a flag — so
//     `{kind:'row', …, bars:1}` spells `(close < sma(close, 50))[1]`, which is
//     the firm's own Remount.
//
// ⛔ ONE (a whole number), NOT ZERO, AND THE REASON IS THE PARSER'S. `convert`
// FOLDS `close[0]` to `close` — one column, one `astHash` — so a picker carrying
// `bars: 0` would spell source that reads back as the UNQUALIFIED picker: a
// different shape than the one handed in, which is the `-0` ruling one node
// over. It is refused where it is spelled and where it is normalised, and it
// cannot be read at all because no tree the parser produces contains one.
//
// ⛔ AND NOT ON A GROUP, NOT ON A NEGATION, AND NOT INSIDE A CALL — each refused
// BY NAME in both directions, each for its own reason:
//
//   * a GROUP because a ONE-CHILD group spells its child and nothing else, so a
//     qualified group and a qualified leaf would be TWO pickers with ONE tree
//     and the round trip would stop being an identity;
//   * a NEGATION because there is one nesting and it is `!(x[1])` — the
//     qualifier is the leaf's, the toggle is written over the qualified
//     condition — and `(!x)[1]` would need a second control saying which came
//     first;
//   * a CALL ARGUMENT because an argument's controls are a name picker and a
//     window box, so a qualified one would put `sma(close, 20)` on screen for a
//     formula that says `sma(close[1], 20)`. That is the same refusal, for the
//     same reason, that `leafSource` already makes for a negative literal.
//
// ⏳ NOT TAKEN, AND SAID PLAINLY: arithmetic TERMS (`close + open > 1`) are
// scannable-when-typed and still refuse here. They do not fall out of any of the
// four shapes above, because they are not a shape at the CONDITION layer at all
// — arithmetic makes a TERM a tree, one layer below the row, so every term slot
// in every shape above becomes a recursive editor. That is a different grammar
// for the operand and it is still refused BY NAME (`picker:term`).
//
// ⭐⭐ AND NOT ONE NAME THE MANIFEST DECLARES IS SPELLED IN THIS FILE.
//
// Plan-review #13 found the shape this file was drafted with: `vocabulary()`
// hand-listing `&&` and `||` to subtract them from the comparator set. E-2's
// M5/M5b measured why that is not a style point — a hand-list that REPLACES a
// derivation is caught behaviourally, but a hand-list that AGREES WITH TODAY'S
// MANIFEST is invisible to every behavioural test there is, and the day an
// operator is renamed it drops out of the picker with every gate green.
//
// The manifest declares `arity` and `yields`. It does NOT declare operand kinds,
// so "arity 2, yields bool" is equally true of a COMPARATOR (`close > open`,
// whose operands are terms) and of a JOIN (`a && b`, whose operands are
// conditions) — there is no field to read. So the split is DERIVED FROM
// BEHAVIOUR, by running the SHIPPED interpreter over literal operands:
//
//   * a JOIN only ever sees zero-vs-non-zero, so `f(a, b) === f(a?1:0, b?1:0)`
//     for every pair — `interpret.js` spells that invariant `logical()`;
//   * a COMPARATOR does not: `5 > 3` is 1 while `1 > 1` is 0.
//
// and which join means ALL and which means ANY falls out of the same probe
// (`f(1, 0)` is 0 for the conjunction and 1 for the disjunction). Rename `&&` in
// `closedTable.json` and this file keeps working with no edit; delete it and
// `vocabulary()` throws BY NAME rather than quietly offering one join.
//
// `criteria.test.js` carries the AST rail that keeps it that way: the module's
// string constants are intersected with every name the manifest declares, and
// the intersection must be EMPTY.

import { TABLE, parseFormula } from '../engine/ast/parse'
import { interpret } from '../engine/ast/interpret'

export class PickerRefusal extends Error {
  constructor(guard) {
    super(REFUSALS[guard] || guard)
    this.name = 'PickerRefusal'
    this.guard = guard
  }
}

/** guard → the sentence the picker refuses with.
 *
 *  ⛔ PAIRWISE DISJOINT. C Task 9's M1: two gates sharing a phrase let a
 *  `raises(match=…)` — or here an `expect(res.guard)` — pass with the safety
 *  deleted. `criteria.test.js` asserts the disjointness rather than trusting it.
 */
export const REFUSALS = Object.freeze({
  'picker:not-a-condition':
    'this formula produces a number rather than a yes-or-no answer, so there is nothing for the picker to show as a condition',
  'picker:node':
    'this formula uses a construction the picker has no row for — keep editing it as text',
  'picker:term':
    'one side of a comparison here is a longer expression than a single value, name or function call',
  'picker:comparator':
    'the comparison in this formula is not one the picker offers',
  'picker:shape':
    'a picker condition must be a group of rows, and this one is neither',
})

// --------------------------------------------------------------------------- //
// the join/comparator split, DERIVED by running the shipped interpreter
// --------------------------------------------------------------------------- //

/** One bar, so `interpret` has a length to fill. Nothing here is read — the
 *  probe trees are literals only — but `bars` is a required argument and a
 *  zero-length run would return a zero-length column with nothing to inspect. */
const PROBE_BARS = Object.freeze([Object.freeze({ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 })])

/** The operand pairs the probe separates the two families with.
 *
 *  ⚠️ NOT ARBITRARY. `(5, 3)` and `(3, 5)` are what break `>` and `<`; `(3, 5)`
 *  alone is what breaks `>=` (which agrees with the conjunction on `(5, 3)`);
 *  the zero pairs are what a truthiness-only operator must be insensitive to. */
const PROBE_PAIRS = Object.freeze([
  [5, 3], [3, 5], [5, 5], [3, 0], [0, 3], [0, 0], [2, 2], [7, 1],
])

/** The operands the NEGATION probe uses.
 *
 *  ⚠️ STRICTLY POSITIVE, ON PURPOSE. `-0` and `0` are the same value to `===`
 *  and different values to `Object.is`, so a zero in this list would make the
 *  answer depend on which comparison the probe happened to use rather than on
 *  what the interpreter does. Fractions and a large integer are here so an
 *  operator that merely SUBTRACTS FROM SOMETHING, or that rounds, cannot pass. */
const NEGATION_PROBES = Object.freeze([1, 2, 3, 5, 7, 0.5, 137])

/** The operands the LOGICAL-NOT probe uses.
 *
 *  ⚠️ ZERO IS THE POINT OF THIS ONE, and it is the difference from the list
 *  above: a truth-inverter is defined by what it does to zero, so a probe list
 *  without it would be satisfied by any operator that maps every number to 0.
 *  A NEGATIVE and a FRACTION are here because "non-zero" is not "positive" and
 *  not "at least one" — an operator that rounded, clamped or compared against 1
 *  would pass a list of large positive integers and is not a negation. */
const TRUTH_PROBES = Object.freeze([0, 1, 2, 5, 137, 0.5, -3, -0.25])

const truthy = (x) => (x !== 0 ? 1 : 0)

function applyBinary(name, a, b) {
  const out = interpret(
    { type: 'op', name, args: [{ type: 'num', value: a }, { type: 'num', value: b }] },
    PROBE_BARS, undefined, undefined, undefined,
  )
  return out[0]
}

function applyUnary(name, a) {
  const out = interpret(
    { type: 'op', name, args: [{ type: 'num', value: a }] },
    PROBE_BARS, undefined, undefined, undefined,
  )
  return out[0]
}

/** True when the operator turns a literal into its negative and does nothing
 *  else — the property that makes `-2` a NUMBER the picker can show rather than
 *  arithmetic it must refuse.
 *
 *  ⛔ MEASURED, NOT NAMED. `u-` is a name `closedTable.json` owns; spelling it
 *  here is the hand-list the source rail exists to catch, and it would be
 *  hand-listed twice — once per language. Rename it in the manifest and this
 *  keeps working; delete it and negative literals fail CLOSED, refusing exactly
 *  as they did before this shape existed. */
function negatesNumbers(name) {
  for (const a of NEGATION_PROBES) {
    let got
    try { got = applyUnary(name, a) } catch { return false }
    if (got !== -a) return false
  }
  return true
}

/** True when the operator turns a yes into a no and a no into a yes — the
 *  property that makes `!x` a CONDITION the picker can wrap rather than a
 *  construction it must refuse.
 *
 *  ⛔ MEASURED, NOT NAMED, for the same reason `negatesNumbers` is: `!` is a
 *  name `closedTable.json` owns, and spelling it here is the hand-list the
 *  source rail exists to catch. ⚠️ AND IT IS NOT `yields: "bool"` EITHER — the
 *  manifest declares that of every comparator and both joins, so it says *this
 *  answers yes-or-no*, never *this INVERTS one*. Only running the interpreter
 *  says that. */
function invertsTruth(name) {
  for (const a of TRUTH_PROBES) {
    let got
    try { got = applyUnary(name, a) } catch { return false }
    if (got !== (a === 0 ? 1 : 0)) return false
  }
  return true
}

/** True when the operator can only ever see zero-vs-non-zero — the property
 *  `interpret.js`'s `logical()` wrapper gives the joins and nothing else. */
function readsOnlyTruthiness(name) {
  for (const [a, b] of PROBE_PAIRS) {
    let direct
    let asBooleans
    try {
      direct = applyBinary(name, a, b)
      asBooleans = applyBinary(name, truthy(a), truthy(b))
    } catch {
      // An operator the manifest declares and the interpreter cannot run is not
      // one the picker may offer. It is excluded from BOTH families, and if that
      // costs us a join the guard below says so by name rather than shipping a
      // picker with one.
      return null
    }
    if (!Object.is(direct, asBooleans)) return false
  }
  return true
}

/** What a control OFFERING a manifest entry says, TAKEN FROM THE MANIFEST'S OWN
 *  SENTENCE with the operand holes removed.
 *
 *  ⛔ NEVER TYPED. `"{0} crossing above {1}"` and `"whether the price is above
 *  its 50-day average"` are already the firm's words — in `closedTable.json`,
 *  beside the entries they describe — and a label written here would be a SECOND
 *  description of one thing, drifting from the read-back the member sees
 *  underneath the very row they built. A crossing's holes are what its row
 *  already renders as two term editors, so removing them is the whole
 *  transformation; a FLAG has no holes and its sentence arrives whole.
 *
 *  ⚠️ Falls back to the NAME rather than to a blank control: a manifest that
 *  declares an entry with no sentence still gets an offer a member can act on.
 */
function manifestLabel(name, spec) {
  const words = String(spec && spec.sentence ? spec.sentence : '')
    .replace(/\{\d+\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words || name
}

/** WeakMap so a repeated `vocabulary()` — `fromAst`'s default argument calls it
 *  on every invocation — costs one probe per table object, not one per call. */
const VOCAB_CACHE = new WeakMap()

/** The names the picker may offer, READ FROM THE MANIFEST.
 *
 *  ⛔ SECTION KEYS AND A `yields` READ — never a typed list. CORRECTION 2 put
 *  `yields` on every operator precisely so this is a derivation; if it is absent
 *  this THROWS rather than falling back to a hand-list, because a hand-list here
 *  is the second grammar the closed table exists to prevent.
 *
 *  @returns {{series: Set, scalars: Set, functions: Map, crossings: Map,
 *             flags: Map, boolFunctions: Set, comparators: Set, boolBinary: Set,
 *             negations: Set, notOp: (string|null), arity: Map, joins: Map,
 *             joinOf: Map}}
 */
export function vocabulary(table = TABLE) {
  const cached = VOCAB_CACHE.get(table)
  if (cached) return cached

  const ops = table.operators || {}
  const arity = new Map(Object.entries(ops).map(([name, spec]) => [name, spec.arity]))

  const boolBinary = new Set(Object.entries(ops)
    .filter(([, spec]) => spec.arity === 2 && spec.yields === 'bool')
    .map(([name]) => name))

  if (!boolBinary.size) {
    // ⛔ A PLAIN Error, NOT A `PickerRefusal`. A refusal is what the picker tells
    // a USER about a formula they wrote; this is a defect in the grammar itself,
    // and the one thing it must not do is degrade quietly into a hand-list.
    throw new Error(
      'closedTable.json declares no arity-2 operator with `yields: "bool"`, so the picker '
      + 'cannot derive its comparator set or its joins. ⛔ A hand-list here would be the '
      + 'second grammar the closed table exists to prevent (design CORRECTION 2), and it '
      + 'would be hand-listed twice — once per language.')
  }

  // ── the split, measured ───────────────────────────────────────────────────
  const joins = new Map()
  const joinOf = new Map()
  const comparators = new Set()
  for (const name of boolBinary) {
    if (readsOnlyTruthiness(name) !== true) { comparators.add(name); continue }
    const label = applyBinary(name, 1, 0) === 0 ? 'and' : 'or'
    if (joins.has(label)) {
      throw new Error(
        `closedTable.json declares two operators the picker reads as the same join `
        + `(${JSON.stringify(joins.get(label))} and ${JSON.stringify(name)}); the picker's `
        + 'group toggle has one control per join and cannot choose between them.')
    }
    joins.set(label, name)
    joinOf.set(name, label)
  }
  if (joins.size !== 2) {
    throw new Error(
      'the picker needs exactly one conjunction and one disjunction and the manifest '
      + `yielded ${joins.size}: [${[...joins].map(([k, v]) => `${k}=${v}`).join(', ')}]. `
      + 'A group of rows has no meaning without both.')
  }

  // ── the SECOND row shape, derived the same way ─────────────────────────────
  //
  // A function is a picker ROW when it answers yes-or-no about exactly two
  // things: `yields` says the first, the declared argument list says the second.
  // ⛔ NO NAME AND NO COUNT. `crossOver` is not spelled here, and a bool function
  // of any OTHER arity is deliberately in NEITHER map — it is a condition the
  // picker has no shape for, and `readCondition` says so by its own name rather
  // than calling it a number.
  const fns = Object.entries(table.functions || {})
  const boolFunctions = new Set(fns.filter(([, s]) => s.yields === 'bool').map(([n]) => n))

  // ── the THIRD row shape, read off `yields` and NOTHING ELSE ────────────────
  //
  // ⛔ NOT A SECTION AND NOT A NAME. A bar field, a clock value and a table
  // scalar are the same NODE (E-1), so which section an entry lives in cannot
  // be what decides whether it is a condition — only `yields` can. All three
  // sections are read, in the manifest's own order (series, then clock, then
  // scalars — `sentence.js::renderName`'s and `lint.js::astReach`'s), so the
  // first boolean BAR field is offered on the day it is declared without an
  // edit here.
  const boolNames = (section) => Object.entries(section || {})
    .filter(([, spec]) => spec && spec.yields === 'bool')

  // ── a NEGATIVE LITERAL is a number, and which operator says so is MEASURED ──
  const negations = new Set(Object.keys(ops)
    .filter((name) => ops[name].arity === 1 && negatesNumbers(name)))

  // ── the FOURTH row shape: a condition WRAPPED, measured the same way ───────
  //
  // ⛔ NO NAME, AND NO `yields` READ EITHER. Every comparator and both joins are
  // declared `yields: "bool"`, so the manifest cannot tell a NEGATION from any
  // other boolean operator — only the interpreter can, and the arity narrows the
  // probe to the operators a unary run is even defined for.
  const inverters = Object.keys(ops)
    .filter((name) => ops[name].arity === 1 && invertsTruth(name))
  if (inverters.length > 1) {
    throw new Error(
      'closedTable.json declares more than one arity-1 operator the picker reads as a '
      + `negation (${inverters.map((n) => JSON.stringify(n)).join(', ')}); a condition's `
      + 'negate control has ONE meaning and cannot choose between them.')
  }
  // ⛔ AND ITS ABSENCE IS NOT AN ERROR. A manifest with no logical NOT is a
  // grammar in which `!x` cannot be TYPED either — the parser builds its unary
  // set from this same table — so the picker simply has no negation to offer and
  // every negation refuses exactly as it did before this shape existed.
  const notOp = inverters.length ? inverters[0] : null

  const value = Object.freeze({
    series: new Set(Object.keys(table.series || {})),
    scalars: new Set(Object.keys(table.scalars || {})),
    functions: new Map(fns
      .filter(([, spec]) => spec.yields !== 'bool')
      .map(([name, spec]) => [name, { args: Object.freeze([...(spec.args || [])]) }])),
    crossings: new Map(fns
      .filter(([, spec]) => spec.yields === 'bool' && (spec.args || []).length === 2)
      .map(([name, spec]) => [name, {
        args: Object.freeze([...(spec.args || [])]),
        label: manifestLabel(name, spec),
      }])),
    flags: new Map([...boolNames(table.series), ...boolNames(table.clock), ...boolNames(table.scalars)]
      .map(([name, spec]) => [name, { label: manifestLabel(name, spec) }])),
    boolFunctions,
    comparators,
    boolBinary,
    negations,
    notOp,
    arity,
    joins,
    joinOf,
  })
  VOCAB_CACHE.set(table, value)
  return value
}

// --------------------------------------------------------------------------- //
// picker -> source
// --------------------------------------------------------------------------- //

// --------------------------------------------------------------------------- //
// the bars-ago qualifier, on both layers
// --------------------------------------------------------------------------- //

/** The bar count a picker node carries, VALIDATED — or `null` when it carries
 *  none.
 *
 *  ⛔ THE FLOOR IS ONE, AND IT IS THE PARSER'S RULE, NOT A TASTE. `convert`
 *  folds `x[0]` to `x`, so a node carrying `bars: 0` spells source that reads
 *  back as the UNQUALIFIED node — a different picker than the one handed in.
 *  Same ruling as `-0`, one node type over. A fraction and a negative are
 *  refused for the reason `readOffset` refuses them: a bar count is whole and it
 *  reads backwards.
 *
 *  ⚠️ THE GUARD IS THE CALLER'S LAYER. A term that cannot be shown is
 *  `picker:term`; a condition the picker has no control for is `picker:node`.
 *  That split is the one this module already draws everywhere else, and passing
 *  it in is what keeps ONE validation behind both. */
function barsOf(node, guard) {
  const n = node ? node.bars : undefined
  if (n === undefined || n === null) return null
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new PickerRefusal(guard)
  return n
}

/** ⛔ THE SPELLING IS THE GRAMMAR'S `expr[N]` AND NOTHING ELSE. It is appended
 *  to whatever spelled the thing being qualified — a name and a call are already
 *  primary expressions and a row brings its own parentheses — so there is one
 *  place the brackets are written and both layers use it. */
const qualify = (text, bars) => (bars === null ? text : `${text}[${bars}]`)

/** The bar count of a CANONICAL `offset` node, validated the same way the picker
 *  side is, so a tree and a picker can never disagree about which offsets exist.
 *  ⛔ THE ARITY IS CHECKED FIRST, exactly as `sentence.js::renderOffset` checks
 *  it first: an offset reads ONE child, and a malformed node is not a shape. */
function offsetBars(n, guard) {
  if (!Array.isArray(n.args) || n.args.length !== 1) throw new PickerRefusal(guard)
  const v = n.value
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new PickerRefusal(guard)
  return v
}

function spellNumber(v) {
  // ⭐ THE SIGN IS THE NUMBER'S, NOT AN OPERATOR THIS FILE SPELLS. `String(-5)`
  // is `-5`, which the parser reads back as `op u- [num 5]` — the grammar's only
  // spelling of a negative literal (`_canonical`) — and `readTerm` turns that
  // node back into this same term, so the round trip closes. ⛔ A `'-'` written
  // here would be a manifest name hand-listed in this file, which is precisely
  // what the source rail in `criteria.test.js` exists to catch.
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new PickerRefusal('picker:term')
  return String(v)
}

function termSource(t, vocab) {
  if (!t || typeof t !== 'object') throw new PickerRefusal('picker:term')
  const bars = barsOf(t, 'picker:term')
  if (t.t === 'num') {
    // ⛔ AND A NUMBER CARRIES NO QUALIFIER. `5[1]` is not a formula this grammar
    // has — jsep reads `[1]` after a literal as an ARRAY, which `offencesIn`
    // fates to `canonicalise:array` — so spelling one would produce source the
    // parser rejects outright. A bar count only means something about a thing
    // the bars HOLD.
    if (bars !== null) throw new PickerRefusal('picker:term')
    return spellNumber(t.value)
  }
  if (t.t === 'name') {
    if (!vocab.series.has(t.name) && !vocab.scalars.has(t.name)) throw new PickerRefusal('picker:term')
    return qualify(t.name, bars)
  }
  if (t.t === 'call') {
    if (!vocab.functions.has(t.name)) throw new PickerRefusal('picker:term')
    return qualify(
      `${t.name}(${(t.args || []).map((a) => leafSource(a, vocab)).join(', ')})`, bars)
  }
  throw new PickerRefusal('picker:term')
}

/** ONE LEVEL. A call's arguments are leaves, because a nested call is a real
 *  formula and the formula field is what shows one. `fromAst` refuses the nested
 *  form at `picker:term`, so spelling one here would produce source the picker
 *  could not read back — the exact asymmetry the identity property exists to
 *  catch. */
function leafSource(t, vocab) {
  if (t && t.t === 'call') throw new PickerRefusal('picker:term')
  // ⛔ AND NO NEGATIVE LITERAL INSIDE A CALL, for the identical reason. A
  // negative argument spells `sma(close, -2)`, whose canonical form puts an
  // OPERATOR node in the argument slot — and `readTerm` refuses an operator
  // there, so spelling one would produce source the picker could not read back.
  // Refusing it HERE keeps the two directions symmetric by construction rather
  // than by two lists that have to agree.
  if (t && t.t === 'num' && !(t.value >= 0)) throw new PickerRefusal('picker:term')
  // ⛔ AND NO BARS-AGO QUALIFIER INSIDE A CALL, for the third time and the same
  // reason. `sma(close[1], 20)` is a legal formula, but an argument's controls
  // are a name picker and a window box — rendering a qualified one would put
  // `sma(close, 20)` on screen for a formula that says something else. Refusing
  // it HERE keeps the two directions symmetric by construction rather than by
  // two lists that have to agree; `readTerm`'s call branch is the other half.
  if (t && t.bars !== undefined && t.bars !== null) throw new PickerRefusal('picker:term')
  return termSource(t, vocab)
}

/** The picker, spelled. FULLY PARENTHESISED and LEFT-ASSOCIATIVE, because jsep
 *  is left-associative and the tree-identity property is measured by hash. */
export function toSource(node, vocab = vocabulary()) {
  if (!node || typeof node !== 'object') throw new PickerRefusal('picker:shape')
  if (node.kind === 'row') {
    if (!vocab.comparators.has(node.cmp)) throw new PickerRefusal('picker:comparator')
    // ⭐ THE ROW'S OWN PARENTHESES ARE WHAT THE QUALIFIER ATTACHES TO. `(a > b)`
    // is already wrapped, so `[N]` lands on the comparison rather than on `b` —
    // which is the whole difference between `(close < sma(close, 50))[1]` and
    // `close < sma(close, 50)[1]`, two different questions.
    return qualify(
      `(${termSource(node.left, vocab)} ${node.cmp} ${termSource(node.right, vocab)})`,
      barsOf(node, 'picker:node'))
  }
  if (node.kind === 'cross') {
    // ⛔ THE SAME SENTENCE, SPELLED AS A CALL. A call is already a primary
    // expression, so it needs no parentheses of its own — the group's `reduce`
    // supplies every one the tree depends on, and adding a second pair here
    // would be spelling the parser cannot distinguish but a reader can.
    if (!vocab.crossings.has(node.fn)) throw new PickerRefusal('picker:comparator')
    return qualify(
      `${node.fn}(${termSource(node.left, vocab)}, ${termSource(node.right, vocab)})`,
      barsOf(node, 'picker:node'))
  }
  if (node.kind === 'flag') {
    // ⛔ AND THE REFUSAL IS THE READ SIDE'S OWN, not a new sentence. A name this
    // vocabulary does not carry as a flag is a name that yields a NUMBER, and
    // `picker:not-a-condition` already says exactly that — the same guard
    // `readCondition` answers for the same fact, so the two directions cannot
    // drift into telling a member two different things about one name.
    if (!vocab.flags.has(node.name)) throw new PickerRefusal('picker:not-a-condition')
    // A bare name is already a primary expression: the group's `reduce` supplies
    // every parenthesis the tree depends on, exactly as it does for a call — and
    // it is what `[N]` attaches to without a pair of its own.
    return qualify(node.name, barsOf(node, 'picker:node'))
  }
  if (node.kind === 'not') {
    // ⛔ THE OPERATOR IS THE VOCABULARY'S, NEVER A CHARACTER TYPED HERE — and a
    // vocabulary that carries none refuses rather than inventing one, which is
    // the same way a crossing whose function is not offered refuses above.
    if (!vocab.notOp) throw new PickerRefusal('picker:node')
    // ⛔ AND A NEGATION OF A NEGATION IS REFUSED ON THIS SIDE TOO, with the SAME
    // guard `readCondition` answers for it. Refusing in both directions is what
    // stops them disagreeing: a shape only one of them admits is a picker that
    // can spell something it cannot read back, which is the asymmetry the
    // identity property exists to catch.
    if (node.child && node.child.kind === 'not') throw new PickerRefusal('picker:node')
    // ⛔ AND A NEGATION CARRIES NO QUALIFIER OF ITS OWN. There is ONE nesting —
    // `!(x[1])`, the qualifier on the leaf and the toggle written over the
    // qualified condition — because a row has one negate control and one bar
    // count, and nothing on it could say which was applied first. `(!x)[1]`
    // therefore refuses here and in `readCondition`, with one guard between them.
    if (node.bars !== undefined && node.bars !== null) throw new PickerRefusal('picker:node')
    // The operand is parenthesised by whatever spells it — a row and a group
    // both come back wrapped, a flag and a crossing are already primary
    // expressions — and the outer pair is this shape's own, so a negation sits
    // in a group's `reduce` exactly as any other child does.
    return `(${vocab.notOp}${toSource(node.child, vocab)})`
  }
  if (node.kind === 'group') {
    // ⛔⛔ AND A GROUP CARRIES NO QUALIFIER EITHER, AND THIS IS THE ONE THAT
    // WOULD BREAK THE IDENTITY PROPERTY RATHER THAN MERELY LOOK ODD. A ONE-CHILD
    // group spells its child and NOTHING ELSE — that is what `reduce` does with
    // a single part, and it is why "add an any-of group" seeds two rows — so
    // `group{bars:1}[flag]` and `flag{bars:1}` would spell the SAME source and
    // therefore the same tree. Two pickers, one tree: the read-back would hand a
    // member a shape they did not assemble. Refusing the level costs a formula
    // no other route reaches and keeps the round trip an identity.
    if (node.bars !== undefined && node.bars !== null) throw new PickerRefusal('picker:node')
    const parts = (node.children || []).map((c) => toSource(c, vocab))
    if (!parts.length) throw new PickerRefusal('picker:shape')
    const op = vocab.joins.get(node.join)
    if (!op) throw new PickerRefusal('picker:shape')
    return parts.reduce((a, b) => `(${a} ${op} ${b})`)
  }
  throw new PickerRefusal('picker:shape')
}

// --------------------------------------------------------------------------- //
// tree -> picker
// --------------------------------------------------------------------------- //

function readTerm(n, vocab) {
  // ⭐ THE QUALIFIER IS STRIPPED FIRST AND PUT BACK ON WHATEVER IT WAS READING.
  // `high[1]` is the SAME term as `high`, read a bar earlier — so it is not a
  // term shape of its own, and the recursion is what keeps every rule below
  // (the vocabulary lookup, the one-level call, the negative literal) applying
  // to it unchanged.
  if (n.type === 'offset') {
    const bars = offsetBars(n, 'picker:term')
    const inner = readTerm(n.args[0], vocab)
    // ⛔ NOT OVER A NUMBER and NOT OVER A QUALIFIER. `5[1]` is not a formula the
    // parser accepts, and `x[1][2]` is `canonicalise:offset-chained` there — so
    // both are trees no member can hand us, and reading either would let the
    // picker spell source that does not parse back.
    if (inner.t === 'num' || inner.bars !== undefined) throw new PickerRefusal('picker:term')
    return { ...inner, bars }
  }
  if (n.type === 'num') return { t: 'num', value: n.value }
  // ⭐ A NEGATIVE LITERAL IS A NUMBER, NOT ARITHMETIC. The canonical tree has no
  // negative `num`, so `-2` is an operator node over a positive one — and a
  // picker that read the node's TYPE refused it as an expression. ⛔ THE OPERAND
  // MUST BE A LITERAL: `-close` and `-(a + b)` really are arithmetic and still
  // refuse, so this widens nothing but the one shape the grammar forces.
  // ⚠️ AND STRICTLY POSITIVE INSIDE. `-0` would spell back as `0`, a DIFFERENT
  // tree, so admitting it would make the identity property false for a shape no
  // member can reach by any other route.
  if (n.type === 'op' && vocab.negations.has(n.name)
    && (n.args || []).length === 1 && n.args[0].type === 'num' && n.args[0].value > 0) {
    return { t: 'num', value: -n.args[0].value }
  }
  if (n.type === 'series') {
    // A table scalar and a bar series are the SAME node type (E-1). The
    // vocabulary is what tells them apart, and the picker offers both.
    if (!vocab.series.has(n.name) && !vocab.scalars.has(n.name)) throw new PickerRefusal('picker:term')
    return { t: 'name', name: n.name }
  }
  if (n.type === 'call' && vocab.functions.has(n.name)) {
    // ONE level. A nested call is a real formula and the formula field shows it.
    const args = (n.args || []).map((a) => {
      // ⛔ AND NOT AN `offset` EITHER — the other half of `leafSource`'s refusal,
      // so the two directions cannot disagree about `sma(close[1], 20)`.
      if (a.type === 'call' || a.type === 'op' || a.type === 'offset') {
        throw new PickerRefusal('picker:term')
      }
      return readTerm(a, vocab)
    })
    return { t: 'call', name: n.name, args }
  }
  throw new PickerRefusal('picker:term')
}

function readCondition(n, vocab) {
  // ⭐ THE FIFTH NODE, AND IT IS READ THE SAME WAY ON THIS LAYER AS ON THE TERM
  // LAYER: strip the qualifier, read what it qualified, put the count back on
  // it. Which means every refusal INSIDE a qualifier is the operand's own —
  // `(close + open)[1]` says the arithmetic is the problem, not the `[1]`.
  if (n && n.type === 'offset') {
    const bars = offsetBars(n, 'picker:node')
    const inner = readCondition(n.args[0], vocab)
    // ⛔ ONLY A LEAF. A qualified GROUP is two pickers with one tree (see
    // `toSource`) and a qualified NEGATION is the nesting this model does not
    // carry; both refuse here with the guard the spelling side uses, so the
    // directions cannot disagree. `LEAF_KINDS` is the one list of what a leaf
    // is — declared beside `canonicalPicker`, which asks the same question.
    if (!LEAF_KINDS.includes(inner.kind) || inner.bars !== undefined) {
      throw new PickerRefusal('picker:node')
    }
    return { ...inner, bars }
  }
  if (n && n.type === 'op') {
    const join = vocab.joinOf.get(n.name)
    if (join) {
      const children = []
      const absorb = (k) => {
        // ⛔ SAME JOIN ONLY. `(a && b) || c` must stay nested: flattening mixed
        // joins changes the meaning and the hash property is what would catch it.
        if (k && k.type === 'op' && k.name === n.name) { absorb(k.args[0]); absorb(k.args[1]) }
        else children.push(readCondition(k, vocab))
      }
      absorb(n.args[0]); absorb(n.args[1])
      return { kind: 'group', join, children }
    }
    if (vocab.comparators.has(n.name)) {
      return {
        kind: 'row',
        left: readTerm(n.args[0], vocab),
        cmp: n.name,
        right: readTerm(n.args[1], vocab),
      }
    }
    // ⭐ THE FOURTH ROW SHAPE, AND IT IS THE FIRST ONE WITH A CHILD. Its operand
    // is a CONDITION, so it is read by the same function that read the row it
    // wraps — which is also what makes its refusals the operand's own: `!close`
    // says a price is not a yes-or-no answer, in the sentence that already says
    // exactly that, rather than inventing a second way to say it.
    if (vocab.notOp && n.name === vocab.notOp && (n.args || []).length === 1) {
      const child = readCondition(n.args[0], vocab)
      // ⛔ `!!x` REFUSES rather than collapsing to `x`. They are the same truth
      // and DIFFERENT TREES, and a model that quietly returned the second when
      // handed the first would make the AST identity property false — a picker
      // silently rewriting the member's formula, which is the whole defect this
      // module exists to prevent.
      if (child.kind === 'not') throw new PickerRefusal('picker:node')
      return { kind: 'not', child }
    }
    // ⭐ THE SPLIT IS THE MANIFEST'S ARITY, NOT A LIST OF SHAPES.
    //
    // A picker ROW is `<term> <comparison> <term>` — an arity-2 form by
    // construction. An operator with any OTHER arity that is not the negation
    // above has no row for the picker to show at all (`-x`, `a ? b : c`), and
    // that is a different fact from "this produces a number": the first says
    // *the picker has no shape for this*, the second says *this is not a
    // yes-or-no answer*. Collapsing them would tell a user editing `a ? b : c`
    // that their ternary "produces a number", which is both wrong and
    // unactionable.
    if (vocab.arity.get(n.name) !== 2) throw new PickerRefusal('picker:node')
    // An arity-2 operator the TABLE calls a condition but this vocabulary does
    // not offer. Reachable when a caller narrows the offered set.
    if (vocab.boolBinary.has(n.name)) throw new PickerRefusal('picker:comparator')
    throw new PickerRefusal('picker:not-a-condition')
  }
  if (n && n.type === 'call') {
    // ⭐ THE SECOND ROW SHAPE. Same sentence as a comparator row — two terms and
    // a relation between them — spelled as a call because that is how the
    // grammar spells a function.
    if (vocab.crossings.has(n.name) && (n.args || []).length === 2) {
      return {
        kind: 'cross',
        left: readTerm(n.args[0], vocab),
        fn: n.name,
        right: readTerm(n.args[1], vocab),
      }
    }
    // ⛔ AND THE SPLIT IS THE MANIFEST'S AGAIN, NOT A LIST OF NAMES. A function
    // that yields a yes-or-no IS a condition — telling a member that
    // `somethingBool(close)` "produces a number" would be false and
    // unactionable. What is true is that the picker has no ROW for it, which is
    // the same fact `picker:node` states about `!x` and `a ? b : c`.
    if (vocab.boolFunctions.has(n.name)) throw new PickerRefusal('picker:node')
    throw new PickerRefusal('picker:not-a-condition')
  }
  if (n && n.type === 'series') {
    // ⭐ THE THIRD ROW SHAPE, AND THE SPLIT IS `yields` — NEVER THE NODE TYPE.
    // A scalar the manifest declares `yields: "bool"` answers a yes-or-no
    // question about the symbol, so it IS a condition and it gets a row of its
    // own: one control, because there is no relation and no second side to
    // show. ⛔ Every OTHER name still refuses here, and refuses correctly — an
    // entry with no `yields` reads as `num` by the manifest's own rule, which
    // is why a bare `close` is still `picker:not-a-condition`.
    if (vocab.flags.has(n.name)) return { kind: 'flag', name: n.name }
    throw new PickerRefusal('picker:not-a-condition')
  }
  if (n && n.type === 'num') {
    throw new PickerRefusal('picker:not-a-condition')
  }
  throw new PickerRefusal('picker:node')
}

/** The tree, read as a picker — or a REFUSAL that names its door and hands back
 *  NOTHING. Never throws. */
export function fromAst(ast, vocab = vocabulary()) {
  try {
    const group = readCondition(ast, vocab)
    // A single row at the top is still a one-row group, so the UI has exactly
    // one shape to render and `toSource` has exactly one case to spell.
    return {
      ok: true,
      group: group.kind === 'group' ? group : { kind: 'group', join: 'and', children: [group] },
    }
  } catch (err) {
    const guard = err instanceof PickerRefusal ? err.guard : 'picker:node'
    return { ok: false, guard, reason: REFUSALS[guard] }
  }
}

/** The picker a SOURCE string shows, in one call — the door the UI uses.
 *
 *  ⛔ IT PARSES WITH `parseFormula` AND NOTHING ELSE, so a string the box holds
 *  and a string the picker reads are the same string through the same parser. */
export function fromSource(source, vocab = vocabulary()) {
  const parsed = parseFormula(source)
  if (!parsed.ok) return { ok: false, guard: parsed.guard || 'parser', reason: parsed.error }
  return fromAst(parsed.ast, vocab)
}

// --------------------------------------------------------------------------- //
// the normal form
// --------------------------------------------------------------------------- //

/** The normal form: a group never contains a group of the SAME join.
 *
 *  ⛔ WITHOUT THIS THE IDENTITY PROPERTY IS FALSE, and it is false in the
 *  direction that looks fine. `and[ and[a,b], c ]` spells `((a && b) && c)`,
 *  which reads back as `and[a,b,c]` — a picker the user did not have. The UI
 *  therefore only ever produces canonical shapes, and this is the assertion. */
/** The picker's LEAF kinds — the row shapes, none of which has children to
 *  flatten. ⛔ A kind this does not name is a shape `canonicalPicker` must
 *  handle EXPLICITLY (`group` and `not` both do) or refuse; it never passes an
 *  unknown kind through, because a shape it cannot normalise is a shape the
 *  identity property cannot be true of. */
const LEAF_KINDS = Object.freeze(['row', 'cross', 'flag'])

export function canonicalPicker(node) {
  if (!node || typeof node !== 'object') throw new PickerRefusal('picker:shape')
  if (LEAF_KINDS.includes(node.kind)) {
    // ⛔ THE QUALIFIER IS VALIDATED HERE TOO, and it has to be: `isCanonical` is
    // what the UI trusts before it emits, so a leaf carrying `bars: 0` that this
    // waved through would reach `toSource` as a throw out of an edit rather than
    // as a shape the model reported. The count itself needs no normalising — a
    // leaf has nothing to flatten — so the node is handed straight back.
    barsOf(node, 'picker:node')
    return node
  }
  if (node.kind === 'not') {
    // ⛔ AND NEITHER A NEGATION NOR A GROUP MAY CARRY A QUALIFIER — the third
    // place each of those refuses, so a shape only the normal form admitted
    // could not slip past the two doors that spell and read it.
    if (node.bars !== undefined && node.bars !== null) throw new PickerRefusal('picker:node')
    // ⛔ A NEGATION IS A BARRIER, NOT A LEVEL TO FLATTEN THROUGH. `!(a && b)`
    // inside an all-of group is NOT `a && b` inside it, so the child is
    // canonicalised on its own and never absorbed by the parent — which the
    // group branch below already does by construction, because a `not` is not a
    // group and its `join` is nobody's.
    const child = canonicalPicker(node.child)
    // ⛔ AND `!!x` DOES NOT NORMALISE TO `x`, with the SAME guard the read side
    // answers. A normal form that dropped a level would hand back a different
    // tree than it was given, which is exactly what `isCanonical` is checked
    // against in the identity property.
    if (child.kind === 'not') throw new PickerRefusal('picker:node')
    return { kind: 'not', child }
  }
  if (node.kind !== 'group') throw new PickerRefusal('picker:shape')
  if (node.bars !== undefined && node.bars !== null) throw new PickerRefusal('picker:node')
  const children = []
  for (const raw of node.children || []) {
    const c = canonicalPicker(raw)
    if (c.kind === 'group' && c.join === node.join) children.push(...c.children)
    else children.push(c)
  }
  if (!children.length) throw new PickerRefusal('picker:shape')
  return { kind: 'group', join: node.join, children }
}

export function isCanonical(node) {
  try { return JSON.stringify(canonicalPicker(node)) === JSON.stringify(node) } catch { return false }
}
