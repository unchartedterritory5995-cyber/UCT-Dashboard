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
// ⛔ AND THE CANONICAL NODE VOCABULARY IS FOUR TYPES. E-1 settled the scalar
// encoding: a scalar rides the `series` node and `NODE_TYPES` does not grow, so
// there is no `'scalar'` node type to test for here. What distinguishes a scalar
// from a bar series is the VOCABULARY LOOKUP below, not the node tag.
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

const truthy = (x) => (x !== 0 ? 1 : 0)

function applyBinary(name, a, b) {
  const out = interpret(
    { type: 'op', name, args: [{ type: 'num', value: a }, { type: 'num', value: b }] },
    PROBE_BARS, undefined, undefined, undefined,
  )
  return out[0]
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
 *  @returns {{series: Set, scalars: Set, functions: Map, comparators: Set,
 *             boolBinary: Set, arity: Map, joins: Map, joinOf: Map}}
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

  const value = Object.freeze({
    series: new Set(Object.keys(table.series || {})),
    scalars: new Set(Object.keys(table.scalars || {})),
    functions: new Map(Object.entries(table.functions || {})
      .filter(([, spec]) => spec.yields !== 'bool')
      .map(([name, spec]) => [name, { args: Object.freeze([...(spec.args || [])]) }])),
    comparators,
    boolBinary,
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

function spellNumber(v) {
  // ⛔ NON-NEGATIVE ONLY, and the reason is the parser's: `-5` parses to
  // `op u- [num 5]`, so a `num` node with a negative value is a tree the parser
  // CANNOT produce and a source spelling of it would never round-trip.
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new PickerRefusal('picker:term')
  return String(v)
}

function termSource(t, vocab) {
  if (!t || typeof t !== 'object') throw new PickerRefusal('picker:term')
  if (t.t === 'num') return spellNumber(t.value)
  if (t.t === 'name') {
    if (!vocab.series.has(t.name) && !vocab.scalars.has(t.name)) throw new PickerRefusal('picker:term')
    return t.name
  }
  if (t.t === 'call') {
    if (!vocab.functions.has(t.name)) throw new PickerRefusal('picker:term')
    return `${t.name}(${(t.args || []).map((a) => leafSource(a, vocab)).join(', ')})`
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
  return termSource(t, vocab)
}

/** The picker, spelled. FULLY PARENTHESISED and LEFT-ASSOCIATIVE, because jsep
 *  is left-associative and the tree-identity property is measured by hash. */
export function toSource(node, vocab = vocabulary()) {
  if (!node || typeof node !== 'object') throw new PickerRefusal('picker:shape')
  if (node.kind === 'row') {
    if (!vocab.comparators.has(node.cmp)) throw new PickerRefusal('picker:comparator')
    return `(${termSource(node.left, vocab)} ${node.cmp} ${termSource(node.right, vocab)})`
  }
  if (node.kind === 'group') {
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
  if (n.type === 'num') return { t: 'num', value: n.value }
  if (n.type === 'series') {
    // A table scalar and a bar series are the SAME node type (E-1). The
    // vocabulary is what tells them apart, and the picker offers both.
    if (!vocab.series.has(n.name) && !vocab.scalars.has(n.name)) throw new PickerRefusal('picker:term')
    return { t: 'name', name: n.name }
  }
  if (n.type === 'call' && vocab.functions.has(n.name)) {
    // ONE level. A nested call is a real formula and the formula field shows it.
    const args = (n.args || []).map((a) => {
      if (a.type === 'call' || a.type === 'op') throw new PickerRefusal('picker:term')
      return readTerm(a, vocab)
    })
    return { t: 'call', name: n.name, args }
  }
  throw new PickerRefusal('picker:term')
}

function readCondition(n, vocab) {
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
    // ⭐ THE SPLIT IS THE MANIFEST'S ARITY, NOT A LIST OF SHAPES.
    //
    // A picker ROW is `<term> <comparison> <term>` — an arity-2 form by
    // construction. An operator with any OTHER arity has no row for the picker
    // to show at all (`!x`, `-x`, `a ? b : c`), and that is a different fact
    // from "this produces a number": the first says *the picker has no shape for
    // this*, the second says *this is not a yes-or-no answer*. Collapsing them
    // would tell a user editing `!(close > open)` that their negation "produces
    // a number", which is both wrong and unactionable.
    if (vocab.arity.get(n.name) !== 2) throw new PickerRefusal('picker:node')
    // An arity-2 operator the TABLE calls a condition but this vocabulary does
    // not offer. Reachable when a caller narrows the offered set.
    if (vocab.boolBinary.has(n.name)) throw new PickerRefusal('picker:comparator')
    throw new PickerRefusal('picker:not-a-condition')
  }
  if (n && (n.type === 'call' || n.type === 'series' || n.type === 'num')) {
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
export function canonicalPicker(node) {
  if (!node || typeof node !== 'object') throw new PickerRefusal('picker:shape')
  if (node.kind === 'row') return node
  if (node.kind !== 'group') throw new PickerRefusal('picker:shape')
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
