// ─── THE READ-BACK: ONE ENGLISH SENTENCE, DERIVED FROM THE TREE ─────────────
//
// ⛔ THIS FUNCTION IS THE ONLY PRODUCER OF THE TEXT A USER CONFIRMS, and the
// concierge is FORBIDDEN from writing that text. A model-written summary of a
// model-written formula is two guesses agreeing, and the user has no way to tell
// that pair apart from a correct one. So the sentence is `sentenceFor(ast)`:
// deterministic, derived from the tree, and never written by a model.
//
// ⭐ THE VOCABULARY IS `closedTable.json`, AND TOTALITY IS DERIVED FROM IT.
// Every function's phrasing is the manifest's own `sentence` field, so the
// chip's plain English and the interpreter's dispatch come from ONE declaration.
// The coverage rail below walks `Object.keys` of each manifest section — it is
// never a hand-list, because a rail built on a list is a list, and DPC's four
// constants rode outside one for a rule's entire life.
//
// ⭐⭐ AND EVERY ROW OF THAT RAIL IS A PROBE, NOT A SECOND READING OF THE
// DECLARATION. This is the lesson the fourth section cost. A rail derived from
// the same declaration the walker reads can only report the gaps the walker
// already knows how to have, so the one class it can NEVER report is "a whole
// section the walker has no branch for" — which is precisely what shipped, and
// two agents working from opposite sides found it instead of the gate. So
// `compileRules` RENDERS one minimal tree per declared entry, in every section,
// and a gap is a tree that REFUSES. Delete any branch of the walker and the
// section it served goes red NAMING ITS OWN ENTRIES.
//
// ⭐ AND THE FOURTH SECTION IS READ THE SAME WAY. A table-declared SCALAR
// (`market_cap`) rides the `series` node — there is no fifth node type — and is
// said with the manifest's OWN `sentence`. This module authors not one word of
// it: it does not prettify the phrase, and it does NOT fall back to the column
// name when the declaration carries none, because `market_cap` is not English
// and a read-back nobody can confirm is worse than a refusal. An entry with no
// phrase is a NAMED gap (`sentence:no-template`), exactly like a function's.
// The consult order is TABLE SERIES → TABLE SCALARS → DEFINITION INPUTS,
// verbatim `lint.js::astReach`'s and `interpret`'s, so all three doors answer
// the same name the same way.
//
// ⚠️ THE OPERATOR PHRASES LIVE HERE AND THAT IS NOT A SECOND VOCABULARY.
// The manifest declares operators by NAME and ARITY only — it has no `sentence`
// field for them — so the English has to live somewhere, and this file owns two
// files' worth of nothing else. What matters is that the TOTALITY is derived:
// `compileRules` iterates the manifest's operator keys and reports any name with
// no phrase BY NAME. A new operator lands red here until somebody writes English
// for it. (Moving these into the manifest is a manifest-owner decision, not this
// module's; see `_no_offset_reopened_by` for the shape of that rule.)
//
// ⭐⭐ THE ENGLISH DOES NOT IMPLY BOOLEAN SEMANTICS, BECAUSE THE ENGINE DOES NOT
// IMPLEMENT THEM. The manifest's `_booleans` decision, implemented in
// `interpret.js`, is unlike both host languages:
//   * `1 && 2` is **1**, not 2, and `0 || 5` is **1**, not 5;
//   * truthiness is `x !== 0`, so `!5` is **0**;
//   * **NaN propagates** through `&&`, `||`, `!` and `?:` — the opposite of both
//     JS (`!NaN === true`) and Python (`not nan is False`);
//   * a **comparison** against NaN is **0**, so a comparison column really is
//     total over `{0, 1}` and never carries an unknown.
// So `&&` is NOT said as "and", and `?:` is NOT said as "if … then … else":
// both of those import a semantics this engine does not have. Each of the four
// is said with all of its cases, and the NaN case is said as "nothing", which is
// what the binder actually draws (whitespace). A construct that cannot be said
// honestly in one clause is said in three rather than smoothed into one.
//
// ⭐⭐ …EXCEPT THAT `!= 0` ON AN OPERAND THAT IS ALREADY A CONDITION SAYS
// NOTHING, AND THAT IS WHY THE CHROME CONSULTS `yields`. The paragraph above is
// about a NUMBER standing in for a condition: `close && volume` really does mean
// "1 when close and volume are BOTH NOT ZERO", the coercion is real, and a member
// reading "close and volume" would be reading a semantics the engine does not
// have. But `_booleans` says a condition is a 0/1 column because the table has no
// boolean type — an implementation detail of the REPRESENTATION — and when every
// operand already declares `yields: "bool"` the coercion is vacuous. The read-back
// then said *"…and whether the recent bars are tightly consolidated are both not
// zero"*, which explains the representation to somebody who asked about the maths.
//
// So a logical form may declare a SECOND phrase in `OPERATOR_SENTENCE_CONDITIONS`,
// used only when EVERY operand of the node yields `bool` — which is derived from
// the manifest's own `yields` key by `yieldsOf`, never from a list of names. A
// `num` operand, or a MIXED pair, keeps the scaffolding, because there the
// coercion is the thing that happens. ⛔ THE SECOND PHRASE IS A JOIN AND NOTHING
// MORE: it re-uses the operand phrases the manifest declared and adds one word.
// The two forms are a PARTITION over the operators whose base phrase talks about
// zero (see `CONDITIONS_FORM_DECLINED`), so a sixteenth operator that reads its
// operands as conditions cannot arrive without somebody deciding about it.
//
// ⚠️ NO CLOCK, NO LOCALE, NO `Intl`, NO RANDOMNESS, NO NETWORK, NO REGISTRY.
// The sentence is compared against a committed string in a test and rendered
// into a stored definition, so a locale-sensitive number format would make it
// machine-dependent — and this box has already produced one cp1252 failure and
// one CRLF failure of exactly that family. `sentence.test.js` proves it
// STRUCTURALLY, by AST over this file's own source, because a grep for `Date`
// matches the word in a comment.
//
// ⚠️ EVERY SET-VALUED OUTPUT IS SORTED. Two things this module emits are sets of
// names — the coverage gaps and the "this table declares …" list inside a
// refusal — and an insertion-ordered emission would make the text depend on the
// manifest's key order rather than on its content. That is the ordering hazard
// this file has, it is the only one, and `sentence.test.js` measures it by
// rendering through a manifest whose keys were rebuilt in reverse order.

import { TABLE, NODE_TYPES, RECURRENCE_BINDINGS } from './parse.js'

// --------------------------------------------------------------------------- //
// the refusals
// --------------------------------------------------------------------------- //

/** The read-back saying it cannot say something. Carries the guard that fired.
 *
 *  ⚠️ A THIRD CLASS, deliberately distinct from `parse.js`'s and
 *  `interpret.js`'s `TableRefusal`. The three doors refuse different things —
 *  shapes a tree may not have, names a tree may not reach, and trees this module
 *  has no English for — and one shared class would let a deletion in one be
 *  covered by a test of another. */
export class SentenceRefusal extends Error {
  constructor(guard, message) {
    super(message)
    this.name = 'SentenceRefusal'
    this.guard = guard
  }
}

/** guard → the sentence it always refuses with.
 *
 *  ⛔ PAIRWISE DISJOINT, AND ACROSS `parse.js`'s AND `interpret.js`'s SETS TOO —
 *  no message here is a substring of any message there, or of any other message
 *  here. Two gates sharing a phrase let a `toThrow(/…/)` pass with the safety
 *  deleted, and that has happened in this repo. `sentence.test.js` asserts the
 *  disjointness over the union of all three modules. */
export const REFUSALS = Object.freeze({
  'sentence:node':
    'this read-back has no rule for that node shape',
  'sentence:num':
    'a read-back cannot spell a number that is not finite',
  'sentence:name':
    'the read-back cannot name a value the table does not declare',
  'sentence:unsayable-name':
    'the read-back cannot spell a name that is not a plain word',
  'sentence:function':
    'the read-back has no rule for a function outside the table',
  'sentence:operator':
    'the read-back has no phrase for that operator',
  'sentence:arity':
    'the read-back was handed a call with the wrong argument count',
  'sentence:window':
    'the read-back cannot spell a window that is not a whole number',
  'sentence:no-template':
    'the table declares this entry and nobody wrote its read-back',
  'sentence:placeholder':
    'the read-back template leaves an argument unsaid',
})

function refuse(guard, detail) {
  throw new SentenceRefusal(guard, `${REFUSALS[guard]} ${detail}`)
}

/** Edit distance, capped — we only ever care whether it is SMALL. */
function editDistance(a, b) {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 3) return 99
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i += 1) {
    const cur = [i]
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[n]
}

/** ⭐⭐ "did you mean `close`?" — THE HALF A COMPLETE LIST CANNOT SUPPLY.
 *
 *  ⚰️ MEASURED 2026-08-11. Typing one wrong name answered with a JSON path
 *  (`at $.args[0].args[0].args[0]…`) followed by EVERY declared name — five
 *  series, fifty-four scalars and the definition's own inputs, ~400 characters of
 *  it. For a member who typed `clse` that is a wall of text with the answer buried
 *  in the middle of it.
 *
 *  ⛔ THE LIST IS NOT TRUNCATED, AND THAT IS DELIBERATE. `sentence.test.js` pins
 *  it because the message once named a FALSE vocabulary — five series while the
 *  table declared fifty-nine names — and telling a member something untrue about
 *  the table is the worse failure. `lesson_a_differ_can_truncate_the_names_a_rail_
 *  exists_to_report` is the same rule. So the suggestion is ADDED IN FRONT of the
 *  list, never instead of it.
 *
 *  ⚠️ Silent when nothing is close. A wrong guess ("did you mean `volume`?" for
 *  `frobnicate`) is worse than no guess: it sends the member off after a name that
 *  was never what they wanted.
 */
export function didYouMean(name, candidates) {
  if (typeof name !== 'string' || !name) return ''
  const needle = name.toLowerCase()
  // Distance scales with length: one typo in `pb` is not the same evidence as one
  // typo in `pullback_depth_pct`.
  const limit = needle.length <= 4 ? 1 : needle.length <= 8 ? 2 : 3
  const near = candidates
    .map((c) => ({ c, d: editDistance(needle, String(c).toLowerCase()) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || String(a.c).localeCompare(String(b.c)))
    .slice(0, 2)
    .map((x) => x.c)
  if (!near.length) return ''
  return ` — did you mean ${near.map((n) => `\`${n}\``).join(' or ')}?`
}

/** ⛔ THE ONLY WAY THIS MODULE ASKS WHETHER A NAME EXISTS. `name in obj` walks
 *  the prototype chain and `obj[name]` returns whatever it finds there — which
 *  is how `toString` becomes a series in a text box. */
const own = (obj, name) => Object.prototype.hasOwnProperty.call(obj, name)

/** A prototype-less nothing, for a lookup table a caller did not supply. Frozen
 *  so a probe can never write into the scope it was handed. */
const EMPTY = Object.freeze(Object.create(null))

/** ⚠️ SORTED, ALWAYS. See the header: this is one of the two set-valued outputs
 *  and the only reason the sentence surface is manifest-order independent. */
const sortedKeys = (obj) => Object.keys(obj).sort()

/** A name this module is willing to put in a sentence. A name with a space in it
 *  would make the read-back ambiguous — "the smaller of my close and open" has
 *  two readings — so it is REFUSED BY NAME rather than rendered into a sentence
 *  nobody can parse back. */
const SAYABLE = /^[A-Za-z_][A-Za-z0-9_]*$/

// --------------------------------------------------------------------------- //
// the operator phrases
// --------------------------------------------------------------------------- //

/** operator name → its English, with `{k}` for argument position k.
 *
 *  ⭐ THE FOUR LOGICAL FORMS SAY ALL THREE OF THEIR CASES. `&&` is not "and"
 *  and `?:` is not "if"; see the header for why. The comparison forms say only
 *  two cases and that is not an omission — a comparison against NaN is 0, so a
 *  comparison column is total over `{0, 1}` and there is no third case to say.
 *
 *  ⚠️ ASCII ONLY. An em dash here would be a cp1252 hazard on this box, and the
 *  sentence is written into a stored definition and compared byte-for-byte. */
export const OPERATOR_SENTENCE = Object.freeze({
  '+': '{0} plus {1}',
  '-': '{0} minus {1}',
  '*': '{0} times {1}',
  '/': '{0} divided by {1}',
  '>': '1 when {0} is greater than {1} and 0 otherwise',
  '<': '1 when {0} is less than {1} and 0 otherwise',
  '>=': '1 when {0} is greater than or equal to {1} and 0 otherwise',
  '<=': '1 when {0} is less than or equal to {1} and 0 otherwise',
  '==': '1 when {0} equals {1} and 0 otherwise',
  '!=': '1 when {0} does not equal {1} and 0 otherwise',
  '&&': '1 when {0} and {1} are both not zero, 0 when either is zero, and nothing while either is unknown',
  '||': '1 when {0} or {1} is not zero, 0 when both are zero, and nothing while either is unknown',
  'u-': 'the negative of {0}',
  '!': '1 when {0} is zero, 0 when it is not zero, and nothing while it is unknown',
  '?:': '{1} when {0} is not zero, {2} when it is zero, and nothing while it is unknown',
})

/** operator name → its English WHEN EVERY OPERAND IS ALREADY A CONDITION.
 *
 *  ⭐ A JOIN, NOT A SECOND VOCABULARY. Every word an operand contributes is still
 *  the manifest's own `sentence`; this table adds the one word that joins them
 *  and drops the `!= 0` the 0/1 representation needed. `sentence.test.js` proves
 *  that by REWORDING a scalar in a cloned manifest and watching the joined
 *  sentence follow.
 *
 *  ⛔ AND IT IS HALF OF A PARTITION, WHICH IS WHAT KEEPS IT HONEST. The other
 *  half is `CONDITIONS_FORM_DECLINED`, and together they cover exactly the
 *  operators whose BASE phrase talks about zero. An operator that reads its
 *  operands as conditions and appears in neither is a DECISION nobody made, and
 *  the rail says so by name. */
export const OPERATOR_SENTENCE_CONDITIONS = Object.freeze({
  '&&': '{0} and {1}',
  '||': '{0} or {1}',
})

/** The operators that read their operands as conditions and STILL say `zero`,
 *  each with the reason nobody wrote them a join.
 *
 *  ⚠️ THIS IS DATA SO THAT THE PARTITION CAN BE ASSERTED, exactly as
 *  `closedTable._scalars_excluded` is. A reason typed here is a decision on the
 *  record; a name simply missing from the table above is an omission nothing can
 *  tell apart from a choice. */
export const CONDITIONS_FORM_DECLINED = Object.freeze({
  '!': 'a bool operand reads as a "whether …" clause, and "not whether the '
    + 'recent bars are tightly consolidated" is not English. The negation of a '
    + 'clause needs the CLAUSE reworded, which is the manifest owner\'s call and '
    + 'not a join this module may make.',
  '?:': 'its two branches are not conditions — `yields` calls it `passthrough` '
    + 'precisely because they decide the answer — so there is no scaffolding to '
    + 'drop on the side that carries the value. Smoothing only the selector would '
    + 'read "high when whether the price is above its 50-day average", which is '
    + 'worse than the scaffolding it replaced.',
})

// --------------------------------------------------------------------------- //
// what a subtree's values CAN BE — the manifest's `yields`, resolved
// --------------------------------------------------------------------------- //

/** The three answers `yields` gives, and the direction it fails in.
 *
 *  ⛔ FAIL CLOSED TO `num`. `closedTable._yields` states the asymmetry and this
 *  module obeys it for a second reason of its own: reading a NUMBER as a
 *  condition would DELETE the `!= 0` from a sentence where the coercion really
 *  happens, which is the defect this file is fixing, mirrored. */
const NUM = 'num'
const BOOL = 'bool'
const PASSTHROUGH = 'passthrough'

/** Collapse a declared kind onto the two a NODE can actually have. */
const settle = (kind) => (kind === BOOL ? BOOL : NUM)

/** What a tree's values can be, from the manifest's `yields` and nothing else.
 *
 *  ⚠️ THE PYTHON LANE ASKS THE SAME QUESTION IN
 *  `api/services/scan_definition.py::is_boolean_tree`, off the same `yields`
 *  key, and the two resolutions are written to agree:
 *
 *    num       `bool` iff the literal is 0 or 1 — the two values a 0/1 column
 *              holds. That is what makes `(a > b) ? 1 : 0` a condition, the case
 *              `_yields` names when it explains why `passthrough` exists.
 *    series    the declared SCALAR's `yields`; a bar field declares none and is
 *              a price, so it is a number, and so is a definition input.
 *    op/call   the declared `yields`; `passthrough` is `bool` iff every ARM is.
 *
 *  ⭐ THE ARMS OF A `passthrough` ARE EVERY ARGUMENT AFTER THE FIRST, read off
 *  the interpreter's `?:` shape (selector first, the two results after it) and
 *  NOT "either arm" — which would call `(a > b) ? 1 : close` a condition, a tree
 *  that hands back a price on one branch.
 *
 *  ⚠️ THE LOOKUP IS BY NODE TYPE, not a flat scan of three sections, because
 *  this module already dispatches that way and a section list here would be a
 *  list. The two lanes can only differ for a name declared in two sections at
 *  once, and every such tree is REFUSED by the walker before its kind is used. */
export function yieldsOf(node, rules) {
  const r = rules || SENTENCE_RULES
  if (!node || typeof node !== 'object' || Array.isArray(node)) return NUM
  switch (node.type) {
    case 'num':
      return node.value === 0 || node.value === 1 ? BOOL : NUM
    case 'series': {
      // ⛔ ALL THE VOCABULARIES THAT RIDE THIS NODE AND DECLARE A `yields`, NOT
      // JUST THE SCALARS. This read only `rules.scalars`, so the `clock`
      // section's thirteen declarations were INERT the day they landed: a bare
      // `isintraday` classified `num` and was refused as a scan while the
      // identical 0/1 shape on a scalar was accepted. A bar field is absent
      // deliberately -- it declares no `yields` because it is a price -- and an
      // input is absent because a knob is dated by nothing and declares nothing.
      const clock = (r && r.clock) || EMPTY
      if (own(clock, node.name)) return settle(clock[node.name].yields)
      const scalars = (r && r.scalars) || EMPTY
      return own(scalars, node.name) ? settle(scalars[node.name].yields) : NUM
    }
    case 'op': {
      const operators = (r && r.operators) || EMPTY
      const declared = own(operators, node.name) ? operators[node.name].yields : NUM
      if (declared !== PASSTHROUGH) return settle(declared)
      const arms = Array.isArray(node.args) ? node.args.slice(1) : []
      return arms.length > 0 && arms.every((a) => yieldsOf(a, r) === BOOL) ? BOOL : NUM
    }
    case 'call': {
      const functions = (r && r.functions) || EMPTY
      return own(functions, node.name) ? settle(functions[node.name].yields) : NUM
    }
    case 'sym':
    case 'tf_live':
    case 'tf':
      // ⭐ NONE OF THEM CHANGES *WHAT*. A higher-timeframe read changes WHEN the value
      // comes from and a symbol read changes WHERE — `tf(close >
      // open, 'W')` is still the yes/no it is, read off last week's bar, so the
      // kind passes through from the child — the same rule, and the same
      // failure if it did not: every multi-timeframe condition would be quietly
      // demoted out of the boolean lane and stop being scannable.
      return Array.isArray(node.args) && node.args.length === 1
        ? yieldsOf(node.args[0], r)
        : NUM
    case 'offset':
      // ⭐ AN OFFSET CHANGES *WHEN*, NEVER *WHAT*. `(close > open)[1]` is still
      // the yes/no it was a bar ago, so the kind passes straight through from
      // the child. Falling to the `num` floor below would have quietly demoted
      // every offset condition out of the boolean lane.
      return Array.isArray(node.args) && node.args.length === 1
        ? yieldsOf(node.args[0], r)
        : NUM
    default:
      // ⛔ A NODE TYPE OUTSIDE THE FOUR HAS NO DECLARED KIND, and the numeric
      // answer is the fail-closed one. The walker refuses such a node by name a
      // moment later, so this is a floor rather than a branch anything reaches.
      return NUM
  }
}

/** The `yields` a manifest entry declares, normalised. An entry that declares
 *  nothing — or something outside the three — reads as `num`. */
const declaredYields = (spec) => {
  const value = spec && spec.yields
  return value === BOOL || value === PASSTHROUGH ? value : NUM
}

// --------------------------------------------------------------------------- //
// compiling the rules FROM the manifest
// --------------------------------------------------------------------------- //

/** Which argument positions a phrase actually says. Returns `null` when the
 *  phrase says every position exactly the once it must and invents none.
 *
 *  ⭐ THIS IS THE "NEVER SILENTLY OMITS A TERM" RULE, AS A DERIVED CHECK. A
 *  template that forgets `{1}` renders a sentence that reads perfectly and
 *  describes a simpler formula than the one that runs, which is worse than no
 *  read-back at all. The arity it is checked against is the MANIFEST's, so a
 *  function that gains an argument fails here without this file moving. */
function placeholderGap(phrase, arity) {
  const seen = new Set()
  const re = /\{(\d+)\}/g
  let m
  while ((m = re.exec(phrase)) !== null) seen.add(Number(m[1]))
  const missing = []
  for (let i = 0; i < arity; i++) if (!seen.has(i)) missing.push(i)
  const extra = [...seen].filter((i) => i >= arity).sort((a, b) => a - b)
  if (missing.length === 0 && extra.length === 0) return null
  return `says nothing for argument(s) [${missing.join(', ')}] and invents [${extra.join(', ')}]`
}

// --------------------------------------------------------------------------- //
// the coverage PROBE — one minimal tree per declared entry
// --------------------------------------------------------------------------- //

/** The ONE argument the probe ever passes.
 *
 *  ⛔ A LITERAL, NEVER ANOTHER SECTION'S NAME. If a function's probe borrowed
 *  `close`, deleting `renderName`'s series branch would light up the FUNCTIONS
 *  row too, and each section's rail has to answer about its OWN section — a rail
 *  that names four sections when one broke is as useless as one that names none.
 *  `2` is also a legal `int` window (a whole number >= 1), so one constant serves
 *  every argument position the manifest is able to declare.
 *
 *  ⚠️ AND IT IS `2` RATHER THAN `1` FOR A REASON THE CHROME GAVE IT: `yieldsOf`
 *  calls the literals 0 and 1 CONDITIONS, so a probe built out of `1` would ask
 *  every logical operator for its conditions form and never render the base
 *  phrase at all. `2` is a number, so the base phrase is what this argument
 *  probes — and the conditions form gets a probe of its own, below. */
const PROBE_ARG = Object.freeze({ type: 'num', value: 2 })

/** …and the argument that IS a condition: the literal a 0/1 column holds. */
const PROBE_CONDITION_ARG = Object.freeze({ type: 'num', value: 1 })

/** ⚠️ BOUNDED, BECAUSE `compileRules` NEVER THROWS. An arity a manifest declares
 *  as `Infinity`, a fraction or a negative would otherwise allocate forever.
 *  Anything outside the bound builds an EMPTY argument list, the walker refuses
 *  on the arity mismatch, and the entry is NAMED — a reported gap, never a hang. */
function probeArgs(count, arg) {
  const n = Number.isInteger(count) && count >= 0 && count <= 16 ? count : 0
  const out = []
  for (let i = 0; i < n; i++) out.push(arg)
  return out
}

/** The minimal tree for ONE declared entry, by section.
 *
 *  ⛔ AN UNKNOWN SECTION RETURNS `null`, AND THE WALKER REFUSES IT. A fifth
 *  section added to the compiled object is probed with a shape this function
 *  does not have, so every one of its entries is NAMED and somebody has to teach
 *  the probe. Returning something plausible instead would make the new section's
 *  rail green on the day it lands — which is the exact defect this loop exists to
 *  end, reintroduced one level up. */
function probeTree(section, name, rule, arg) {
  switch (section) {
    case 'series':
    case 'clock':
    case 'scalars':
      // ⭐ ALL THREE RIDE THE `series` NODE. Neither a scalar nor a clock value
      // is a new node type; each is another VOCABULARY read by the same branch,
      // which is why they share a probe and still report separately.
      return { type: 'series', name }
    case 'operators':
      return { type: 'op', name, args: probeArgs(rule.arity, arg) }
    case 'functions':
      return { type: 'call', name, args: probeArgs(rule.args.length, arg) }
    default:
      return null
  }
}

/** EVERY tree one declared entry has to be able to render.
 *
 *  ⭐ AN ENTRY WITH TWO PHRASES NEEDS TWO PROBES, or the rail covers whichever
 *  one the probe's arguments happened to select. A logical operator that declares
 *  a conditions form is rendered BOTH ways — once with numeric operands, once
 *  with operands that are conditions — and either refusal names it. The second
 *  probe is keyed off the ROW carrying a conditions phrase rather than off a
 *  section name, so nothing here is a list. */
function probeTrees(section, name, rule) {
  const trees = [probeTree(section, name, rule, PROBE_ARG)]
  if (rule && rule.conditionsPhrase !== undefined) {
    trees.push(probeTree(section, name, rule, PROBE_CONDITION_ARG))
  }
  return trees
}

/** The manifest, compiled into the four lookup tables the walker uses.
 *
 *  ⛔ EVERY DECLARED ENTRY GETS A ROW, INCLUDING THE BROKEN ONES. An entry with
 *  no phrase is NOT left out — it is carried with a `gap`, so a tree that uses it
 *  is refused BY NAME (`sentence:no-template`) instead of falling through to
 *  "unknown function", which would read like the table never declared it. The
 *  same rows are what `coverageGaps` reports, so the rail and the runtime refusal
 *  are ONE derivation rather than two that can drift.
 *
 *  ⚠️ NEVER THROWS. The module has to load for the coverage rail to be able to
 *  report a gap; a `compileRules` that threw on a bad manifest would make the
 *  gap unmeasurable, which is the failure mode a coverage rail exists to end.
 *  The PROBE at the end obeys the same rule: it catches, it never rises — in
 *  every section, for every entry.
 *
 *  ⭐ AND EVERY SECTION'S GAPS ARE PROBED, NOT DECLARED. See the comment at the
 *  probe — a rail that reads the same declaration the walker reads can only
 *  report the gaps the walker already knows how to have. */
export function compileRules(table = TABLE, operatorPhrases = OPERATOR_SENTENCE,
  conditionPhrases = OPERATOR_SENTENCE_CONDITIONS) {
  const series = Object.create(null)
  const clock = Object.create(null)
  const scalars = Object.create(null)
  const operators = Object.create(null)
  const functions = Object.create(null)
  const gaps = { series: [], clock: [], scalars: [], operators: [], functions: [], placeholders: [] }

  // ⚠️ THE ROW IS COMPILED HERE, THE GAP IS REPORTED BY THE PROBE. `gap` is what
  // makes `renderName` refuse an unsayable bar field; whether that refusal
  // belongs in `gaps.series` is the PROBE's answer, below, and not a second
  // opinion recorded here.
  for (const name of sortedKeys(table.series)) {
    series[name] = Object.freeze({ gap: SAYABLE.test(name) ? null : 'unsayable' })
  }

  // ⭐ THE FIFTH SECTION (tableVersion 2), AND IT IS SAID LIKE A SCALAR, NOT
  // LIKE A SERIES. A series is spoken AS ITS OWN NAME, so an unsayable name is
  // what breaks it; a clock value has a declared `sentence` — "the hour of the
  // bar on a 24-hour clock, 0 to 23, in New York time" — because `hour` alone in
  // a read-back is a word a member cannot check the maths against, and `minute`
  // reads as prose while meaning a number. Arity zero, so `placeholderGap(…, 0)`
  // is the same derived check the scalars get.
  const clockTable = (table && table.clock) || {}
  for (const name of sortedKeys(clockTable)) {
    const spec = clockTable[name]
    const phrase = spec && spec.sentence
    let gap = null
    if (typeof phrase !== 'string' || phrase === '') {
      gap = 'no-template'
    } else {
      const bad = placeholderGap(phrase, 0)
      if (bad) { gap = bad; gaps.placeholders.push(`${name}: ${bad}`) }
    }
    clock[name] = Object.freeze({ phrase, gap, yields: declaredYields(spec) })
  }

  // ⭐ THE FOURTH SECTION, AND THE PHRASE IS THE MANIFEST'S. Unlike a series —
  // which is SAID AS ITS OWN NAME, so an unsayable name is what breaks it — a
  // scalar is said as its declared `sentence`, so the NAME never reaches the
  // text and only the phrase can be missing.
  //
  // ⚠️ AND ITS ARITY IS ZERO, so `placeholderGap(phrase, 0)` is the same derived
  // check the functions get: a `{0}` copied into a scalar's declaration
  // references an argument that does not exist and is a gap, not a sentence.
  const scalarTable = (table && table.scalars) || {}
  for (const name of sortedKeys(scalarTable)) {
    const spec = scalarTable[name]
    const phrase = spec && spec.sentence
    let gap = null
    if (typeof phrase !== 'string' || phrase === '') {
      gap = 'no-template'
    } else {
      const bad = placeholderGap(phrase, 0)
      if (bad) { gap = bad; gaps.placeholders.push(`${name}: ${bad}`) }
    }
    scalars[name] = Object.freeze({ phrase, gap, yields: declaredYields(spec) })
  }

  for (const name of sortedKeys(table.operators)) {
    const spec = table.operators[name]
    const arity = spec && typeof spec.arity === 'number' ? spec.arity : 0
    const phrase = own(operatorPhrases, name) ? operatorPhrases[name] : undefined
    let gap = null
    if (typeof phrase !== 'string' || phrase === '') {
      gap = 'no-template'
    } else {
      const bad = placeholderGap(phrase, arity)
      if (bad) { gap = bad; gaps.placeholders.push(`${name}: ${bad}`) }
    }
    // ⭐⭐ THE SECOND PHRASE IS CARRIED EVEN WHEN IT IS BROKEN, AND IT DOES NOT
    // SET `gap`. Two reasons, and both are this file's own lessons:
    //
    //   * ⛔ NO QUIET FALLBACK. A malformed conditions phrase must not degrade to
    //     the base form — that is a read-back silently answering a question it was
    //     asked differently. It is carried, so `fill` REFUSES it by name the
    //     moment the chrome selects it.
    //   * ⛔ AND THE SECTION ROW IS THE PROBE'S ANSWER, NOT A SECOND READING.
    //     Setting `gap` here would make the base tree refuse too, for a defect in
    //     a phrase it never uses, AND it would make the conditions probe below
    //     dead weight — a gate nothing can fail. Left alone, the operators row
    //     names this operator ONLY because the walker refused its second tree.
    let conditionsPhrase
    if (own(conditionPhrases, name)) {
      const declared = conditionPhrases[name]
      conditionsPhrase = typeof declared === 'string' ? declared : ''
      const bad = placeholderGap(conditionsPhrase, arity)
      if (bad) gaps.placeholders.push(`${name}: ${bad}`)
    }
    operators[name] = Object.freeze({
      phrase, arity, gap, conditionsPhrase, yields: declaredYields(spec),
    })
  }

  for (const name of sortedKeys(table.functions)) {
    const spec = table.functions[name]
    const args = spec && Array.isArray(spec.args) ? spec.args.slice() : []
    const phrase = spec && spec.sentence
    let gap = null
    if (typeof phrase !== 'string' || phrase === '') {
      gap = 'no-template'
    } else {
      const bad = placeholderGap(phrase, args.length)
      if (bad) { gap = bad; gaps.placeholders.push(`${name}: ${bad}`) }
    }
    functions[name] = Object.freeze({
      phrase, args: Object.freeze(args), gap, yields: declaredYields(spec),
    })
  }

  const compiled = {
    series: Object.freeze(series),
    clock: Object.freeze(clock),
    scalars: Object.freeze(scalars),
    operators: Object.freeze(operators),
    functions: Object.freeze(functions),
  }

  // ⭐⭐ EVERY ROW OF THE COVERAGE RAIL IS MEASURED BY RENDERING, AND THAT IS
  // THIS PROGRAMME'S MOST EXPENSIVE LESSON. The declaration-derived rail was
  // PERMANENTLY GREEN for all fifty-four scalars: it iterated the sections the
  // walker already knew about, so the one class of unsayable name it could never
  // report was "a whole section the walker has no branch for" — which is
  // precisely what shipped, and two agents working from opposite sides found it
  // instead of the gate. A rail that asks the WALKER cannot be blind that way:
  // an entry is a gap when rendering its minimal tree REFUSES, whatever the
  // reason. Delete `renderName`'s series branch and this list names close, high,
  // low, open and volume; delete the `op` or `call` dispatch and it names every
  // operator or every function. (⛔ The counts that used to sit here — "fifteen
  // operators or all eleven functions" — went stale the day Phase F declared
  // seventeen indicators, which is the whole reason the rail is a LIST.)
  //
  // ⚠️ ONE DERIVATION, NOT TWO. The gap is the runtime refusal itself rather
  // than a second piece of bookkeeping that agrees with it today.
  //
  // ⭐ AND THE SECTION LIST IS THE COMPILED OBJECT'S OWN KEYS, NOT A LIST TYPED
  // HERE. Four sections is what this manifest has today; a FIFTH is probed on
  // the day it is compiled, with no edit to this loop — and if `probeTree` has
  // no shape for it, every entry lands in the report rather than the section
  // arriving silently green. That is the whole point: the rail must not be able
  // to outlive its own coverage.
  //
  // ⚠️ AND THE INNER SORT IS LOAD-BEARING, WHICH IS NOT OBVIOUS AND IS MEASURED.
  // Every row above was INSERTED in sorted order, so re-sorting here reads like
  // the redundant second guard this file has already written a finding about.
  // It is not: an INTEGER-LIKE key is emitted by `Object.keys` in ascending
  // numeric order however it was inserted, so a manifest declaring `9` and `10`
  // separates the two orders. `sentence.test.js` measures exactly that case.
  const PROBED_SECTIONS = Object.keys(compiled)
  for (const section of PROBED_SECTIONS) {
    if (!Array.isArray(gaps[section])) gaps[section] = []
    for (const name of sortedKeys(compiled[section])) {
      let refused = false
      for (const tree of probeTrees(section, name, compiled[section][name])) {
        try { renderNode(tree, compiled, EMPTY, 0, '$', []) } catch { refused = true }
      }
      if (refused) gaps[section].push(name)
    }
  }

  // ⚠️ FROZEN BY ITERATION, so a fifth section's row survives to the caller —
  // a hand-listed freeze would silently drop exactly the row the loop above
  // exists to produce.
  const frozenGaps = {}
  for (const key of Object.keys(gaps)) frozenGaps[key] = Object.freeze(gaps[key])
  compiled.gaps = Object.freeze(frozenGaps)
  return Object.freeze(compiled)
}

/** Every manifest entry this module has no English for, BY NAME.
 *
 *  ⚠️ A LIST, NEVER A COUNT. A count survives a rename — `(d.plots || [])`
 *  answered `[]` for a renamed field on this branch and silently voided an entire
 *  clause — and the whole point of this rail is that a NEW table entry is named
 *  in the failure message of the test that goes red.
 *
 *  🔴 AND A LIST THAT CANNOT GO RED IS NOT A RAIL. `gaps.scalars` reported
 *  nothing for all fifty-four scalars for as long as the section existed, not
 *  because they were sayable but because nothing asked. All four rows are now
 *  the walker's own answer (see `compileRules`), so no section can outrun the
 *  rail that covers it.
 *
 *  ⚠️ `placeholders` IS THE ONE ROW THAT IS STILL DECLARATION-DERIVED, ON
 *  PURPOSE. It is not a section: it reports a TEMPLATE that drops or invents an
 *  argument, keyed `name: reason`, and it is consumed elsewhere. The four
 *  section rows report the same entries by name whenever the walker refuses
 *  them, so the probe covers that class too — `placeholders` adds the reason. */
export function coverageGaps(table = TABLE, operatorPhrases = OPERATOR_SENTENCE,
  conditionPhrases = OPERATOR_SENTENCE_CONDITIONS) {
  return compileRules(table, operatorPhrases, conditionPhrases).gaps
}

// --------------------------------------------------------------------------- //
// rendering
// --------------------------------------------------------------------------- //

const isLeaf = (n) => !!n && typeof n === 'object' && (n.type === 'num' || n.type === 'series')

/** ⚠️ `String(n)`, NEVER `toLocaleString` AND NEVER `Intl`. ECMAScript pins
 *  Number-to-String exactly; a locale format would put a comma in a thousands
 *  separator on one machine and a period on another, and the sentence is
 *  compared byte-for-byte against a committed string. */
function spellNumber(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    refuse('sentence:num', `at ${path}: got ${JSON.stringify(value) ?? String(value)}`)
  }
  return String(value)
}

/** An `int` argument is a `num` LITERAL or nothing, exactly as `interpret.js`
 *  requires. A tree whose window is a computed column is a tree the engine
 *  refuses to run, and a read-back that described it as though it were fine would
 *  be telling the user about maths that will never draw. */
function spellWindow(node, fnName, index, path, trace) {
  if (!node || typeof node !== 'object' || node.type !== 'num'
      || typeof node.value !== 'number' || !Number.isInteger(node.value) || node.value < 1) {
    refuse('sentence:window',
      `at ${path}: ${fnName} argument ${index} — got `
      + `${JSON.stringify(node && node.type === 'num' ? node.value : node) ?? String(node)}`)
  }
  trace.push({ path, rule: 'window' })
  return String(node.value)
}

/** Fill a phrase's `{k}` slots, and refuse a phrase that drops or invents one.
 *
 *  ⭐ THE SECOND HALF OF "NEVER SILENTLY OMITS A TERM", AT RENDER TIME. The
 *  compile-time check reads the manifest's declared arity; this reads the ACTUAL
 *  argument list of the node in hand, so the two cannot both be satisfied by a
 *  tree whose arity disagrees with its declaration. */
function fill(phrase, parts, what, path) {
  const used = new Set()
  const text = phrase.replace(/\{(\d+)\}/g, (_m, digits) => {
    const i = Number(digits)
    if (i >= parts.length) {
      refuse('sentence:placeholder',
        `at ${path}: the ${what} read-back references {${i}} and there is no such argument`)
    }
    used.add(i)
    return parts[i]
  })
  if (used.size !== parts.length) {
    const missing = []
    for (let i = 0; i < parts.length; i++) if (!used.has(i)) missing.push(i)
    refuse('sentence:placeholder',
      `at ${path}: the ${what} read-back never says argument(s) ${missing.join(', ')}`)
  }
  return text
}

function refuseGap(gap, kind, name, path) {
  if (gap === 'no-template') {
    refuse('sentence:no-template', `at ${path}: the ${kind} ${JSON.stringify(name)}`)
  }
  refuse('sentence:placeholder', `at ${path}: the ${kind} ${JSON.stringify(name)} ${gap}`)
}

/** A sub-expression, PARENTHESISED unless it is a leaf.
 *
 *  ⭐ THE ONE RULE THAT MAKES THE SENTENCE RE-READABLE. Because every composite
 *  argument is bracketed, the chrome of exactly one form appears at bracket depth
 *  zero in any sentence — so the grammar needs no precedence and a reader can
 *  find the operands by scanning at depth zero. `sentence.test.js` measures that
 *  claim: exactly one form parses each of the sentences it generates. */
function renderArg(node, rules, inputs, depth, path, trace) {
  const inner = renderNode(node, rules, inputs, depth + 1, path, trace)
  return isLeaf(node) ? inner : `(${inner})`
}

function renderName(node, rules, inputs, path, trace) {
  const name = node.name
  if (typeof name !== 'string') {
    refuse('sentence:node', `at ${path}: a series node carries a name; got ${JSON.stringify(name) ?? String(name)}`)
  }
  // ⭐ A RECURRENCE BINDING READS BACK AS ENGLISH, CONSULTED FIRST AND OUTSIDE
  // EVERY VOCABULARY. `self` is not in `series`, not in `scalars` and not an
  // input — it is bound by the `accum` call around it — so without this line the
  // read-back of every accumulator on the platform would refuse `sentence:name`
  // and a member would be shown a formula the builder could not describe.
  //
  // ⛔ AND IT IS PHRASED AS A NOUN, LIKE EVERY OTHER OPERAND. "the running value
  // so far" fills the same slot `close` does, so `self > close` reads as a
  // comparison rather than as a fragment; the manifest's own `accum` sentence is
  // what surrounds it. ⚠️ NOT VALIDATED FOR POSITION HERE: whether the binding
  // is legal where it appears is `interpret`'s and `lint`'s answer, and a
  // read-back that tried to re-decide it would be a third authority over one
  // rule — it would also have to refuse a sentence for a tree the linter had
  // already refused, which helps nobody.
  if (RECURRENCE_BINDINGS.includes(name)) {
    trace.push({ path, rule: 'series:recurrence' })
    return 'the running value so far'
  }
  // ⛔ THE TABLE IS CONSULTED FIRST AND THE ORDER IS LOAD-BEARING. A definition
  // whose input shadows `close` is a wiring defect `interpret` throws on
  // outright; what the read-back must not do is let the ANSWER depend on which
  // object a merge happened to spread second.
  if (own(rules.series, name)) {
    if (rules.series[name].gap) {
      refuse('sentence:unsayable-name', `at ${path}: the series ${JSON.stringify(name)}`)
    }
    trace.push({ path, rule: 'series:table' })
    return name
  }
  // ⭐ THE TABLE'S CLOCK, CONSULTED AFTER THE SERIES AND BEFORE THE SCALARS —
  // the same order, for the same reason, as the line above and as
  // `lint.js::astReach`. The words are the manifest's: read, never written.
  //
  // ⛔ NOT A FALLBACK TO THE COLUMN NAME. `dayofweek` in a sentence tells a
  // member nothing about whether Sunday is 1 or 0, which is exactly the number
  // they need to check the formula against — so a clock entry the table declares
  // and nobody wrote English for is refused BY NAME.
  const clockRules = (rules && rules.clock) || EMPTY
  if (own(clockRules, name)) {
    const rule = clockRules[name]
    if (rule.gap) refuseGap(rule.gap, 'clock value', name, path)
    trace.push({ path, rule: 'series:clock' })
    return rule.phrase
  }
  // ⭐ THE TABLE'S PER-SYMBOL SCALARS, CONSULTED AFTER THE CLOCK AND BEFORE THE
  // INPUTS — the same order, for the same reason, as the lines above and as
  // `lint.js::astReach`. The words are the manifest's: read, never written.
  const scalarRules = (rules && rules.scalars) || EMPTY
  if (own(scalarRules, name)) {
    const rule = scalarRules[name]
    // ⛔ NOT A FALLBACK TO THE COLUMN NAME. A scalar the table declares and
    // nobody wrote English for is refused BY NAME, because `market_cap` in a
    // sentence is a read-back the member cannot check the maths against.
    if (rule.gap) refuseGap(rule.gap, 'scalar', name, path)
    trace.push({ path, rule: 'series:scalar' })
    return rule.phrase
  }
  if (own(inputs, name)) {
    if (!SAYABLE.test(name)) {
      refuse('sentence:unsayable-name', `at ${path}: the input ${JSON.stringify(name)}`)
    }
    trace.push({ path, rule: 'series:input' })
    return `the input ${name}`
  }
  // ⭐ THE SUGGESTION COMES FIRST, THE FULL LIST STILL FOLLOWS. See `didYouMean`.
  const suggestion = didYouMean(name, [
    ...sortedKeys(rules.series), ...sortedKeys(clockRules),
    ...sortedKeys(scalarRules), ...sortedKeys(inputs),
  ])
  refuse('sentence:name',
    `at ${path}: ${JSON.stringify(name)}${suggestion}`
    + ` — this table declares ${sortedKeys(rules.series).join(', ')}`
    + `, its clock is ${sortedKeys(clockRules).join(', ') || 'none'}`
    + `, its scalars are ${sortedKeys(scalarRules).join(', ') || 'none'}`
    + `, and this definition declares ${sortedKeys(inputs).join(', ') || 'no inputs'}`)
}

function renderOp(node, rules, inputs, depth, path, trace) {
  const name = node.name
  if (typeof name !== 'string' || !own(rules.operators, name)) {
    refuse('sentence:operator',
      `at ${path}: ${JSON.stringify(name)} — this table declares `
      + `${sortedKeys(rules.operators).join(', ')}`)
  }
  const rule = rules.operators[name]
  if (rule.gap) refuseGap(rule.gap, 'operator', name, path)
  if (!Array.isArray(node.args)) {
    refuse('sentence:node', `at ${path}: an op node carries an args array; got ${JSON.stringify(node.args)}`)
  }
  if (node.args.length !== rule.arity) {
    refuse('sentence:arity', `at ${path}: ${name} takes ${rule.arity}, got ${node.args.length}`)
  }
  // ⭐ THE ONE PLACE THE CHROME CONSULTS `yields`. Every operand already being a
  // condition is what makes the `!= 0` scaffolding vacuous; one `num` operand
  // anywhere and the coercion is real, so the base phrase stands. The question is
  // asked of the OPERAND TREES, so it is the manifest's declaration answering and
  // never a list of names — and a fifty-fifth scalar is covered the day it
  // declares its `yields`.
  //
  // ⚠️ THE TRACE SAYS WHICH FORM SPOKE. "The sentence is correct" is satisfiable
  // by the wrong branch agreeing today; "it was produced by `op:&&:conditions`,
  // and a `num` operand moves it back to `op:&&`" is not.
  const asConditions = rule.conditionsPhrase !== undefined
    && node.args.length > 0
    && node.args.every((arg) => yieldsOf(arg, rules) === BOOL)
  trace.push({ path, rule: asConditions ? `op:${name}:conditions` : `op:${name}` })
  const parts = node.args.map((arg, i) =>
    renderArg(arg, rules, inputs, depth, `${path}.args[${i}]`, trace))
  return fill(asConditions ? rule.conditionsPhrase : rule.phrase, parts,
    `operator ${name}`, path)
}

function renderCall(node, rules, inputs, depth, path, trace) {
  const name = node.name
  if (typeof name !== 'string' || !own(rules.functions, name)) {
    refuse('sentence:function',
      `at ${path}: ${JSON.stringify(name)} — this table declares `
      + `${sortedKeys(rules.functions).join(', ')}`)
  }
  const rule = rules.functions[name]
  if (rule.gap) refuseGap(rule.gap, 'function', name, path)
  if (!Array.isArray(node.args)) {
    refuse('sentence:node', `at ${path}: a call node carries an args array; got ${JSON.stringify(node.args)}`)
  }
  if (node.args.length !== rule.args.length) {
    refuse('sentence:arity', `at ${path}: ${name} takes ${rule.args.length}, got ${node.args.length}`)
  }
  trace.push({ path, rule: `fn:${name}` })
  const parts = []
  for (let i = 0; i < node.args.length; i++) {
    const childPath = `${path}.args[${i}]`
    parts.push(rule.args[i] === 'int'
      ? spellWindow(node.args[i], name, i, childPath, trace)
      : renderArg(node.args[i], rules, inputs, depth, childPath, trace))
  }
  return fill(rule.phrase, parts, `function ${name}`, path)
}

/** `close[1]` → `close 1 bar ago`. `sma(close, 20)[2]` → `(the 20-bar simple
 *  moving average of close) 2 bars ago`.
 *
 *  ⭐ THE PHRASE IS WRITTEN HERE AND NOT IN THE MANIFEST, and that is not an
 *  exception to `_sentence`'s rule — it is the rule applied. `closedTable.json`
 *  declares a phrase per NAME (a series, an operator, a function), and an offset
 *  names nothing: the bar count IS the node. There is no manifest entry for it
 *  to be a second copy of.
 *
 *  ⛔ `0` READS AS THE BAR ITSELF, NOT "0 bars ago". `close[0]` is `close` — the
 *  identity Pine spells the same way — and "close 0 bars ago" is English that
 *  makes a reader stop and work out whether it means today or yesterday. */
function renderOffset(node, rules, inputs, depth, path, trace) {
  const n = node.value
  if (!Array.isArray(node.args) || node.args.length !== 1) {
    refuse('sentence:arity',
      `at ${path}: an offset reads exactly one child column, got `
      + `${Array.isArray(node.args) ? node.args.length : JSON.stringify(node.args)}`)
  }
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    refuse('sentence:window',
      `at ${path}: a bar offset counts whole bars backwards; got ${JSON.stringify(n)}`)
  }
  trace.push({ path, rule: 'offset' })
  const inner = renderArg(node.args[0], rules, inputs, depth, `${path}.args[0]`, trace)
  if (n === 0) return inner
  return `${inner} ${n} bar${n === 1 ? '' : 's'} ago`
}

/** The English for a timeframe code. ⛔ A CLOSED MAP, not a `.toLowerCase()`:
 *  "W" has exactly one reading here, and a code with no word is a code this
 *  grammar cannot say — which must REFUSE rather than leak `W` into a sentence a
 *  member is asked to trust. */
const TF_WORD = Object.freeze({ W: 'weekly', M: 'monthly' })

/** ⭐ A SUFFIX, THE WAY `renderOffset` IS ONE, and for the same reason: a
 *  higher-timeframe read changes *WHERE THE VALUE COMES FROM*, never what the
 *  child says, so the child's own sentence stays intact and the chrome is
 *  appended. `(close > open) on the weekly timeframe` reads exactly as it
 *  computes.
 *
 *  ⚠️ THE WORDS ARE THE READER'S CONTRACT. `sentence.test.js` hand-types this
 *  phrase into its own independent reader, so a re-phrasing here lands there as
 *  `0 parses` — loudly — rather than as a reader that quietly moved with it. */
function renderTf(node, rules, inputs, depth, path, trace) {
  if (!Array.isArray(node.args) || node.args.length !== 1) {
    refuse('sentence:arity',
      `at ${path}: a higher-timeframe read has exactly one child column, got `
      + `${Array.isArray(node.args) ? node.args.length : JSON.stringify(node.args)}`)
  }
  const word = TF_WORD[String(node.value)]
  if (!word) {
    refuse('sentence:window',
      `at ${path}: no English is declared for timeframe ${JSON.stringify(node.value)} `
      + `\u2014 this grammar says ${Object.keys(TF_WORD).join(', ')}`)
  }
  // ⭐ THE TWO NODES SHARE A RENDERER AND DIFFER BY ONE WORD, because they differ
  // by one line in the interpreter. ⛔ "so far this week" is not decoration: it is
  // the ONLY thing in the read-back that tells a member the value will CHANGE
  // before the period closes, and the read-back is the artifact they are asked to
  // trust. A shared phrase would have made a repainting column indistinguishable
  // from a settled one in the sentence a member reads.
  const live = node.type === 'tf_live'
  trace.push({ path, rule: live ? 'tf_live' : 'tf' })
  const inner = renderArg(node.args[0], rules, inputs, depth, `${path}.args[0]`, trace)
  return live
    ? `${inner} so far this ${word === 'weekly' ? 'week' : 'month'}`
    : `${inner} on the ${word} timeframe`
}

/** ⭐ A PREFIX, WHERE `renderTf` IS A SUFFIX — and the asymmetry is the point.
 *  A symbol read changes *WHOSE* value it is, which English puts in front:
 *  `SPY's (close > open)` reads the way it computes, whereas a trailing
 *  "… for SPY" would leave the reader holding the whole expression before
 *  learning it was never about the symbol on screen.
 *
 *  ⚠️ THE WORDS ARE THE READER'S CONTRACT. `sentence.test.js` hand-types this
 *  phrasing into its own independent reader, so a re-phrasing here lands there as
 *  `0 parses` — loudly — rather than as a reader that quietly moved with it. */
function renderSym(node, rules, inputs, depth, path, trace) {
  if (!Array.isArray(node.args) || node.args.length !== 1) {
    refuse('sentence:arity',
      `at ${path}: a symbol read has exactly one child column, got `
      + `${Array.isArray(node.args) ? node.args.length : JSON.stringify(node.args)}`)
  }
  // ⛔ A TICKER IS NOT FREE TEXT IN A SENTENCE A MEMBER IS ASKED TO TRUST. Only
  // the plain uppercase forms a symbol actually takes are sayable; anything else
  // refuses rather than being interpolated into English unchecked.
  const ticker = String(node.value)
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    // ⚠️ `sentence:unsayable-name`, NOT `sentence:window`. The first draft
    // reused the window guard, whose published sentence is about a bar count
    // that is not a whole number — so a member with an odd ticker would have
    // been told the read-back "cannot spell a window", naming the wrong cause.
    // A refusal is TWO artifacts and the sentence is the half a member reads
    // (`lesson_rail_the_sentence_not_just_the_guard`).
    refuse('sentence:unsayable-name',
      `at ${path}: ${JSON.stringify(node.value)} is not a symbol this grammar can `
      + 'say — a ticker is up to ten characters of A-Z, 0-9, dot or dash')
  }
  trace.push({ path, rule: 'sym' })
  const inner = renderArg(node.args[0], rules, inputs, depth, `${path}.args[0]`, trace)
  return `${ticker}’s ${inner}`
}

function renderNode(node, rules, inputs, depth, path, trace) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    refuse('sentence:node', `at ${path}: got ${JSON.stringify(node) ?? String(node)}`)
  }
  switch (node.type) {
    case 'num':
      trace.push({ path, rule: 'num' })
      return spellNumber(node.value, path)
    case 'series':
      return renderName(node, rules, inputs, path, trace)
    case 'op':
      return renderOp(node, rules, inputs, depth, path, trace)
    case 'call':
      return renderCall(node, rules, inputs, depth, path, trace)
    case 'offset':
      return renderOffset(node, rules, inputs, depth, path, trace)
    case 'tf':
    case 'tf_live':
      return renderTf(node, rules, inputs, depth, path, trace)
    case 'sym':
      return renderSym(node, rules, inputs, depth, path, trace)
    default:
      // ⛔ NOT A FALLTHROUGH TO SOMETHING PLAUSIBLE. A catch-all that returned
      // "the value" would produce English for a node type nobody wrote a rule
      // for — a sentence that is right for the wrong reason, which is the defect
      // this branch has now cost four separate tasks. The trace is what makes
      // that assertable: a test can ask WHICH rule produced a sentence, not only
      // what the sentence said.
      return refuse('sentence:node',
        `at ${path}: node type ${JSON.stringify(node.type)} — the canonical types are `
        + `${NODE_TYPES.join(', ')}`)
  }
}

// --------------------------------------------------------------------------- //
// the public door
// --------------------------------------------------------------------------- //

/** The manifest, compiled once. Recompiled per call would be the same answer for
 *  a frozen table and a wasted walk; a test that needs a DIFFERENT table calls
 *  `compileRules` itself and hands the result to `explainSentence`. */
export const SENTENCE_RULES = compileRules()

/** The sentence AND the identity of every rule that produced a piece of it.
 *
 *  ⭐ THE TRACE IS A GATE, NOT A DEBUG AID. "The sentence is correct" is
 *  satisfiable by a fallback branch that happens to say the right thing; "the
 *  sentence was produced by `fn:sma`, and deleting `fn:sma`'s template changes
 *  it" is not. Pre-order — a node before its arguments, arguments left to right —
 *  so the trace is itself a deterministic serialisation of the tree.
 *
 *  @param {object} ast    a canonical tree (`parse.js::canonicalise`'s output)
 *  @param {object} inputs the definition's declared inputs, by name
 *  @param {object} [rules] a compiled rule set; defaults to the manifest's
 *  @returns {{text: string, trace: ReadonlyArray<{path: string, rule: string}>}}
 */
export function explainSentence(ast, inputs, rules = SENTENCE_RULES) {
  const scope = inputs && typeof inputs === 'object' ? inputs : Object.create(null)
  const trace = []
  const text = renderNode(ast, rules, scope, 0, '$', trace)
  return Object.freeze({ text, trace: Object.freeze(trace.map((e) => Object.freeze(e))) })
}

/** An AST → one English sentence, deterministically.
 *
 *  Throws `SentenceRefusal` for a tree this module has no English for. It does
 *  NOT return a placeholder string: a read-back that quietly degrades is a read-
 *  back the user cannot rely on, and the caller's failure state is a red dot with
 *  the message in the tooltip, not a plausible sentence about the wrong maths.
 *
 *  @param {object} ast
 *  @param {object} [inputs]
 *  @returns {string}
 */
export function sentenceFor(ast, inputs) {
  return explainSentence(ast, inputs, SENTENCE_RULES).text
}
