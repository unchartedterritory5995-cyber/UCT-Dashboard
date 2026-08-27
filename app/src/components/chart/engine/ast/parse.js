// ─── ONE PARSER, AND THE AST IS THE PERSISTED ARTIFACT ──────────────────────
//
// `jsep` parses ONCE, in the browser, at author time. `compute.ast` — the tree
// this file produces — is what is stored, versioned, wired and interpreted.
// **Python never parses.** It walks the same tree.
//
// The basis for that ruling, measured rather than assumed:
//   * the frontend has no parser library of any kind today, so `jsep` is a NEW
//     dependency either way;
//   * Python has no equivalent that produces the SAME tree, so a second parser
//     would be a second grammar;
//   * a hand-ported grammar is a SECOND VOCABULARY, and this repo has already
//     paid for one — `williams_r` here is `williamsR` in the chart registry,
//     which is the entire reason `_CASE_COLUMNS` exists.
//
// ⭐ THE PERSISTED SHAPE IS THE CONTRACT WITH PYTHON, AND IT IS DELIBERATELY
// SMALLER THAN jsep's: `num`, `series`, `op`, `call`, `offset`, with keys drawn
// from `{type, name, value, args}` and nothing else. Python's walker therefore
// has five cases — a surface small enough to prove closed.
// ⚰️ SAID "four cases" and omitted `offset` from `291c9d8a` until `b54d4843`
// corrected the manifest. ⛔ Do not re-type the roster here: `NODE_TYPES` below
// is the authority and `closedTable.test.js` composes the manifest's claim from
// it, so a sixth type fails by name rather than drifting three comments apart.
//
// ⛔ A STORED TREE CARRYING jsep's OWN NODE SHAPES WOULD MAKE A jsep UPGRADE A
// DATA MIGRATION. That is why `canonicalise` exists at all, and it is why the
// dependency is pinned EXACT in `package.json` the way `lightweight-charts` is.

import jsep from 'jsep'
import TABLE_JSON from './closedTable.json'

// --------------------------------------------------------------------------- //
// the table
// --------------------------------------------------------------------------- //

/** Deep-frozen so a caller cannot edit the grammar at runtime. The manifest is
 *  DATA read by two lanes; a mutation here would desynchronise them silently. */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** The imported manifest, frozen. THE one grammar. */
/** ⭐⭐ THE SHAPE A DECLARED `lookback` MAY TAKE — a constant, `argN`, or a whole
 *  multiple of one (`2*argN`).
 *
 *  ⛔ IT LIVES HERE, WITH THE TABLE, AND THAT PLACEMENT IS A RAIL'S DOING. It was
 *  first exported from `interpret.js`, and `lint.test.js` immediately refused the
 *  import: *"no evaluator is reachable from the linter -- its import graph is one
 *  module wide"*. The reason is exact — if the repaint linter could reach an
 *  evaluator, a verdict could be reached by RUNNING the formula instead of by
 *  reading the tree, and a claim measured on one bar window is not the universal
 *  claim the badge makes. The grammar is part of the TABLE's vocabulary, not the
 *  evaluator's, so it belongs where every reader may see it.
 *
 *  ⚰️ FOUR hand-written copies of this pattern existed before it was hoisted, and
 *  the fourth (in the linter) branded ADX as repainting in production.
 */
export const LOOKBACK_RE = /^(?:(\d+)\s*\*\s*)?arg(\d+)$/

/** ⭐ THE ONE KEY GRAMMAR — input keys, plot keys, event keys, and the keys of
 *  `compute.trees`. Identifier-shaped because they are ADDRESSED (`defId.plotKey`,
 *  `$inputKey`); ASCII so the sorted order `trees.js` hashes in and Python's
 *  `sorted()` agree byte for byte with no collation rule. Hoisted here, beside
 *  `LOOKBACK_RE` and for the same reason: `defSchema.js` and `ast/trees.js` each
 *  held a private copy, and this leaf is the module both already import. */
export const KEY_RE = /^[A-Za-z][A-Za-z0-9_]*$/

export const TABLE = deepFreeze(TABLE_JSON)

/** ⭐⭐ THE OTHER SHAPE A DECLARED `lookback` MAY TAKE — the whole session.
 *
 *  `lookback: 'session'` is the window back to the first bar of the bar's own
 *  New York calendar day. It is deliberately NOT spellable as `argN`: no
 *  argument carries it, because how many bars a session holds is a property of
 *  the CALENDAR and the TIMEFRAME, not of anything the author typed. That is
 *  the whole reason it needs a name of its own rather than a number.
 *
 *  ⛔ IT LIVES BESIDE `LOOKBACK_RE` FOR THE IDENTICAL REASON, and that reason is
 *  a rail's doing rather than a preference: `lint.test.js` pins this module as
 *  the linter's ONLY import (`{ imports: ['./parse.js'] }`), so a sentinel owned
 *  by `interpret.js` would be unreachable from the reader that most needs it.
 */
export const SESSION_LOOKBACK = 'session'

/** How far back `lookback: 'session'` reaches, in bars — READ OFF THE MANIFEST.
 *
 *  ⛔⛔ NOT A LITERAL HERE, AND THAT IS THE POINT. Four readers need this number
 *  — `interpret.js::ownLookback`, `lint.js::resolveDeclaration`,
 *  `ast_interpret._own_lookback`, `ast_lint._resolve_declaration` — across two
 *  languages, and the Python linter is pinned by its own import rail to the
 *  standard library, so it can reach neither of the other three. The ONE place
 *  all four can see is the table, which is DATA for exactly this reason. A
 *  per-lane copy would be the fifth hand-written copy of a window grammar in
 *  this directory; the fourth branded ADX as repainting in production.
 *
 *  ⭐ WHY 960 — and why it is `closedTable.json::_session` that argues it, not
 *  this comment: the session is the ET CALENDAR DAY (04:00–20:00 ET = 16 hours),
 *  not regular hours, and the finest bar this platform serves is one minute, so
 *  a session can never hold more bars than it holds minutes.
 */
export const SESSION_MAX_BARS = (() => {
  const n = TABLE.sessionMaxBars
  if (!Number.isInteger(n) || n < 1) {
    // ⛔ A REFUSAL AT IMPORT, NOT A DEFAULT. A fallback number here would be the
    // per-lane copy this constant exists to prevent, and it would be invisible:
    // the grammar would go on answering, with a window nobody declared.
    throw new Error(
      `closedTable.json declares sessionMaxBars=${JSON.stringify(n)}; the session window `
      + 'must be a whole number of bars, and no lane may supply one of its own')
  }
  return n
})()

/** The canonical node types, and there are no others.
 *
 *  ⚠️ ASSERTED BY WALKING A PARSED TREE, never by reading this constant back —
 *  a test that reads the list it is checking measures a re-typed copy.
 *
 *  ⭐⭐ `offset` IS THE FIFTH, AND IT IS THE BOUNDED BACKWARD FORM — see
 *  `readOffset` below for the whole of what it may say.
 *  ⚰️ SAID the manifest "still describe[s] FOUR" — true when written, corrected
 *  in `b54d4843`: `_canonical`, `_no_offset` and `_scalars_node` now state the
 *  fifth type, each keeping its withdrawn claim behind the ⚰️ idiom. ⛔ Do not
 *  restate the roster in prose anywhere: `closedTable.test.js` COMPOSES the
 *  manifest's claim from `NODE_TYPES` and from the union of the `REFUSALS`
 *  rosters, so the two can no longer drift. The shape is stated once here
 *  rather than restated in nine walkers:
 *
 *      { type: 'offset', value: <integer ≥ 0>, args: [ <one child node> ] }
 *
 *  ⛔ `value` IS A NUMBER ON THE NODE, NOT A `num` CHILD, AND THAT IS THE WHOLE
 *  DESIGN. A node shape with no slot for an expression cannot hold one, so
 *  "the offset is a constant literal" is true BY CONSTRUCTION rather than by a
 *  check somebody can delete. `maxLookback` therefore stays a TREE SUM
 *  (`value + maxLookback(child)`), and a FORWARD reference stays INEXPRESSIBLE
 *  — which is the property `_no_offset` existed to protect and the reason
 *  `ichimoku.chikou` remains decidable.
 *
 *  ⭐ AND THE KEYS ARE STILL DRAWN FROM `{type, name, value, args}` — the
 *  vocabulary `_canonical` declares. Reusing `args` is not tidiness: every
 *  walker in both lanes already descends `node.args`, so the child is reached
 *  by machinery that already exists and a walker that forgets `offset` gets the
 *  child's contribution rather than silently dropping the subtree. */
export const NODE_TYPES = Object.freeze(['num', 'series', 'op', 'call', 'offset', 'tf', 'sym'])

// --------------------------------------------------------------------------- //
// the recurrence, READ from the manifest
// --------------------------------------------------------------------------- //
//
// ⭐ BAR-TO-BAR STATE ADDED NO NODE TYPE, AND THAT WAS THE POINT. `accum` is a
// `call` like any other, so the roster above is exactly the one it was and the
// Python walker still has five cases. What makes it different is declared in
// DATA — `closedTable.json::functions.accum.recurrence` — rather than in each
// lane's source: which argument is the seed, which is the per-bar body, which
// carries the warm-up, and what name the body reads its own past through.
//
// ⛔ SO NEITHER LANE TYPES THE STRING `self` OR THE INDEX `1`. Both read them
// off the entry below. A hand-copy would be the second-authority defect this
// repo has measured more times than any other, and it would be a silent one:
// a lane that thought the body was argument 2 would evaluate the WARM-UP as an
// expression and the body as a window, and produce numbers for both.

/** Every function entry that declares a `recurrence`, by name. A map so that a
 *  second recurrent entry needs no code change anywhere — the walkers ask
 *  "does this call declare one", never "is this call `accum`". */
export const RECURRENCES = Object.freeze(Object.fromEntries(
  Object.entries(TABLE.functions)
    .filter(([, spec]) => spec && typeof spec.recurrence === 'object' && spec.recurrence)
    .map(([name, spec]) => [name, spec.recurrence]),
))

/** The reserved names the bodies bind — the set a scope must refuse to let an
 *  input shadow. Derived from the entries above, never listed. */
export const RECURRENCE_BINDINGS = Object.freeze(
  [...new Set(Object.values(RECURRENCES).map((r) => r.binds))].sort())

/** The declaration that says an entry is computed over the BAR ARRAY rather than
 *  over the columns its arguments name. `closedTable.json::_functions_bar_readers`
 *  argues it; this is the string both lanes match on. */
export const BAR_READS = 'bars'

/** Every function entry declaring `reads: 'bars'`, sorted.
 *
 *  ⭐ THE `recurrence` IDIOM, APPLIED TO THE OTHER THING A CALL CAN NEED.
 *  `bindShipped` packs bars out of ARGUMENT COLUMNS and therefore fabricates `t`
 *  as a bar index — which is, in its own comment's words, exactly why `vwap` was
 *  refused for as long as this table has existed. An entry declaring this is
 *  handed `interpret`'s own bar array instead, so its anchor is a real instant.
 *
 *  ⛔ DERIVED, NEVER LISTED. Both walkers ask "does this entry read the bars",
 *  never "is this call `vwap`", so a third such entry needs no change in either
 *  lane. `ast_table.bar_readers` is the same read on the same manifest. */
export function barReadersOf(table) {
  return Object.entries((table && table.functions) || {})
    .filter(([, spec]) => spec && spec.reads === BAR_READS)
    .map(([name]) => name)
    .sort()
}

/** ⚠️ THE PURE READER IS EXPORTED FOR ONE REASON: SO ITS DERIVATION CAN BE
 *  RAILED. `TABLE` is frozen at import, so a manifest the shipped table does not
 *  contain is unreachable from any test that only sees the constant — and a
 *  derivation nobody can plant against is indistinguishable from a hand-list
 *  that happens to be right today. A mutation sweep proved exactly that:
 *  replacing the filter with `name === 'vwap' || name === 'avwap'` SURVIVED
 *  every suite in this directory until `barReadersOf` had a seam. Same lesson,
 *  same shape, one task earlier: `interpret.js::ownLookback`. */
export const BAR_READERS = Object.freeze(barReadersOf(TABLE))

/** The declaration that says an entry's OTHER `int` arguments must fit inside
 *  the one its `lookback` names. `closedTable.json::_functions_domain` argues it;
 *  this is the key both lanes match on, and its VALUE names which of the entry's
 *  own reach declarations supplies the ceiling. */
export const ARG_DOMAIN = 'domain'

/** Every function entry declaring an argument domain → the CEILING DECLARATION
 *  it points at. `{ macd: 'arg2', ichimokuTenkan: 'arg4', … }`.
 *
 *  ⭐ THE `reads: 'bars'` IDIOM, APPLIED TO THE OTHER THING A DECLARATION CAN BE
 *  WRONG ABOUT. `lookback: 'arg2'` is a promise about how many bars of history an
 *  entry needs, and for these six it holds only while the argument it names is
 *  the LARGEST period in the call — `macd(close, 26, 12)` reaches 26 bars back
 *  under a declaration that promised 12, and every line of the Ichimoku family
 *  starts at the longest of its three periods. The entry says so itself; nothing
 *  here knows the name `macd`.
 *
 *  ⛔ ONE INDIRECTION, NEVER A RE-TYPED SLOT. The value of `domain` is the NAME
 *  of another key on the same entry (`'lookback'`), and what comes back is that
 *  key's own declaration — so moving an entry's lookback to another slot moves
 *  its domain with it, and no argument index is written down twice.
 *
 *  ⛔ THE INDEX IS NOT RESOLVED HERE, AND THAT IS THE SPLIT. `LOOKBACK_RE` is
 *  this lane's ONE grammar for `argN` and the walker already reads it
 *  (`ownLookback`); resolving it here as well would be the second copy the
 *  hoisting of that regex exists to prevent. `ast_table.arg_domains` answers the
 *  same question in the same shape, and each lane's walker resolves the index
 *  with the grammar it already owns. */
export function argDomainsOf(table) {
  const out = {}
  for (const [name, spec] of Object.entries((table && table.functions) || {})) {
    if (!spec || typeof spec[ARG_DOMAIN] !== 'string') continue
    const declaration = spec[spec[ARG_DOMAIN]]
    if (typeof declaration === 'string' && declaration) out[name] = declaration
  }
  return out
}

/** ⚠️ EXPORTED AS A PURE READER FOR THE REASON `barReadersOf` IS: a derivation
 *  nobody can plant a manifest against is indistinguishable from a hand-list that
 *  happens to be right today. `argDomain.test.js` plants a seventh entry and a
 *  `domain` pointing at a key that names no argument. */
export const ARG_DOMAINS = Object.freeze(argDomainsOf(TABLE))

/** Does this function read each argument at the bar it writes, and nowhere else?
 *
 *  ⭐ DERIVED FROM THE WINDOW DECLARATION, NEVER FROM A LIST OF NAMES. A hand-list
 *  of "the pointwise ones" would be a third authority over `lookback`, and it
 *  would rot the day a pointwise entry landed — which is exactly how a running
 *  value would come to read a NaN it was never told about. `lookback: 0`, no
 *  `forward`, and no `int` slot IS the definition: an entry that reads only bar
 *  `i` of each argument can be applied one bar at a time, which is the only
 *  thing the recurrence step loop can do.
 *
 *  ⚠️ `interpret.test.js` asserts this set equals the scalar implementations the
 *  step loop actually holds, BOTH DIRECTIONS — a declared-but-unimplemented
 *  pointwise entry would refuse inside a body while looking legal in the table. */
export function isPointwise(spec) {
  return !!spec
    && spec.lookback === 0
    && !Object.prototype.hasOwnProperty.call(spec, 'forward')
    && Array.isArray(spec.args)
    && spec.args.every((kind) => kind === 'series')
}

// --------------------------------------------------------------------------- //
// the refusals
// --------------------------------------------------------------------------- //

/** A refusal at the parse→canonical boundary. Carries the GUARD that fired.
 *
 *  ⛔ DISJOINT MESSAGES, DELIBERATELY. Two gates sharing a phrase let a
 *  `raises(match=…)` pass with the safety deleted, and that has happened in this
 *  repo. The fragments below are the ones `tests/fixtures/ast/escapes.json`
 *  declares per guard, so the census can bind a refusal to the gate that made
 *  it rather than to "something threw". */
export class TableRefusal extends Error {
  constructor(guard, message) {
    super(message)
    this.name = 'TableRefusal'
    this.guard = guard
  }
}

/** guard → the sentence it refuses with. The fragments `escapes.json` pins are
 *  each a substring of exactly one of these, and no message is a substring of
 *  another. `parse.test.js` asserts both halves. */
export const REFUSALS = Object.freeze({
  'canonicalise:array':
    'array literals have no meaning in a column formula',
  'canonicalise:this':
    '`this` names nothing this table can resolve',
  'canonicalise:member':
    'property access is not in the table',
  'canonicalise:offset-literal':
    'a bar offset must be spelled as a plain whole number in the formula',
  'canonicalise:offset-forward':
    'a bar offset reads backwards, and a negative one would name a future bar',
  'canonicalise:offset-chained':
    'a bar offset applies once to a value, and this one applies twice',
  'canonicalise:call-target':
    'only a bare table name may be called',
  'canonicalise:assignment':
    'a formula produces a column; it does not bind a name',
  'canonicalise:compound':
    'a formula is one expression, and this is several',
  'canonicalise:empty':
    'there is nothing here to compute',
  'canonicalise:operator':
    'the parser produced a symbol this grammar never declared',
  'canonicalise:symbol':
    "a read of another instrument is written `sym('<TICKER>', …)` — the ticker is "
    + 'a plain quoted symbol, never an expression, so it can never be computed at '
    + 'runtime',
  'canonicalise:timeframe':
    'a higher-timeframe read is tf(<expression>, \'<TF>\') \u2014 two arguments, the second '
    + 'a quoted timeframe',
  'canonicalise:node':
    'the parser produced a construct with no canonical form',
})

const refuse = (guard) => { throw new TableRefusal(guard, REFUSALS[guard]) }

// --------------------------------------------------------------------------- //
// configure the parser FROM the table
// --------------------------------------------------------------------------- //

/** Binding power for every arity-2 operator. NOT in the manifest, because
 *  precedence is a property of the SURFACE SYNTAX and the manifest describes the
 *  tree; Python never sees an infix string and must not have to carry this.
 *
 *  ⚠️ EVERY arity-2 ENTRY OF THE TABLE MUST APPEAR HERE, and the module THROWS
 *  BY NAME if one does not. `jsep.addBinaryOp(op, undefined)` does not fail — it
 *  registers an operator with a broken binding power and silently misparses,
 *  which is the shape of defect that survives thousands of green tests. */
const PRECEDENCE = Object.freeze({
  '||': 1,
  '&&': 2,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '+': 9, '-': 9,
  '*': 10, '/': 10,
})

/** The arity-1 operator names the CANONICAL tree uses, mapped to the character
 *  the SOURCE spells them with. `u-` is unary minus; `-` alone is the binary
 *  operator and they are different table entries. */
const UNARY_CANONICAL = Object.freeze({ '-': 'u-', '!': '!' })

/** The arity-3 operator: the ternary. jsep produces `ConditionalExpression` for
 *  it; the table names it `?:`. */
const TERNARY = '?:'

function binaryOpsFromTable() {
  return Object.entries(TABLE.operators)
    .filter(([, spec]) => spec.arity === 2)
    .map(([op]) => op)
}

/** ⛔ EVERY jsep FEATURE THIS TABLE DOES NOT USE IS REMOVED AT CONFIGURE TIME.
 *  Not blocked at interpret time — REMOVED, so it cannot parse.
 *
 *  A blocklist is a list of what somebody remembered; removing the operator is
 *  the absence itself. jsep 1.4.0 ships `**`, `%`, `&`, `|`, `^`, `<<`, `>>`,
 *  `>>>`, `??`, `===` and `!==` as binary operators, `~` and unary `+` as unary
 *  operators, and `null` as a literal. Not one of the fourteen has a meaning in
 *  a column formula, and every one of them would reach a walker with no case
 *  for it. */
function configureParser() {
  jsep.removeAllBinaryOps()
  for (const op of binaryOpsFromTable()) {
    const bp = PRECEDENCE[op]
    if (typeof bp !== 'number') {
      throw new Error(
        `closedTable.json declares the binary operator ${JSON.stringify(op)} but ` +
        'parse.js has no precedence for it. jsep.addBinaryOp(op, undefined) does ' +
        'not fail — it misparses — so this is a hard stop.')
    }
    jsep.addBinaryOp(op, bp)
  }

  jsep.removeAllUnaryOps()
  jsep.addUnaryOp('-')
  jsep.addUnaryOp('!')

  jsep.removeAllLiterals()
  // The table has NO boolean node type — see `_booleans` in the manifest. These
  // exist so a user may type the words; they canonicalise to num 1 / num 0.
  jsep.addLiteral('true', true)
  jsep.addLiteral('false', false)
}

configureParser()

// --------------------------------------------------------------------------- //
// the forbidden-node scan
// --------------------------------------------------------------------------- //

/** WHICH OFFENCE IS REPORTED WHEN A TREE CARRIES SEVERAL, DECLARED RATHER THAN
 *  LEFT TO TRAVERSAL ORDER.
 *
 *  `[1, 2][0]` is a MemberExpression whose object is an ArrayExpression, so a
 *  naive top-down canonicaliser refuses it as a *member read* and the message a
 *  user sees depends on which line of the walker happens to run first. Task 2
 *  wrote that ambiguity down as an open question on the `array_literal` case.
 *  This closes it: the scan collects EVERY offence in the whole tree, then
 *  reports the first one in this declared order.
 *
 *  ⚠️ The order is measured, not aesthetic — under it every case in
 *  `escapes.json` reports the guard that file declares, which is what makes the
 *  armed per-guard fragment check (Task 6's) able to mean anything. */
const OFFENCE_PRIORITY = Object.freeze([
  'canonicalise:array',
  'canonicalise:this',
  'canonicalise:member',
  'canonicalise:offset-forward',
  'canonicalise:offset-literal',
  'canonicalise:offset-chained',
  'canonicalise:assignment',
  'canonicalise:call-target',
  'canonicalise:compound',
])

const JSEP_TYPE_OFFENCE = Object.freeze({
  ArrayExpression: 'canonicalise:array',
  ThisExpression: 'canonicalise:this',
  // ⚠️ MemberExpression is NOT listed here, because `x[3]` and `x.y` are the
  // same jsep type and only one of them is an offence. `readOffset` decides,
  // and `offencesIn` consults it — see the note on that function.
  AssignmentExpression: 'canonicalise:assignment',
  Compound: 'canonicalise:compound',
})

// --------------------------------------------------------------------------- //
// the bounded backward offset
// --------------------------------------------------------------------------- //

/** ⭐⭐ THE ONE AUTHORITY ON WHAT `EXPR[N]` MAY SAY. `offencesIn` (the scan) and
 *  `convert` (the walker) BOTH call this, so the door that decides a refusal and
 *  the door that builds the node can never disagree about which offsets are
 *  legal. A second copy of this predicate is the shape this repo has paid for
 *  three separate times.
 *
 *  @returns `null`                     — not an offset form at all (`a.b`)
 *           `{guard}`                  — an offset form this grammar refuses
 *           `{guard: null, value: N}`  — a legal backward offset of N bars
 *
 *  ⛔ THE NEGATIVE BRANCH IS THE LOAD-BEARING ONE AND IT IS NOT WHERE A READER
 *  EXPECTS IT. jsep does NOT fold a sign into a literal: `close[-1]` parses as a
 *  `UnaryExpression('-')` wrapping `Literal(1)`, so a check that only asked
 *  `value < 0` would never fire and `close[-1]` would fall through to the
 *  "not a literal" refusal — true, but named for the wrong thing. THIS is the
 *  refusal that keeps a forward reference inexpressible, so it must be the one
 *  that fires, by name. The `value < 0` line below it is the belt for a parser
 *  that ever does fold, and it is exercised directly rather than left theoretical.
 *
 *  ⛔ THERE IS NO CEILING HERE, AND THAT IS DELIBERATE. `close[100000]` is a
 *  well-formed backward offset; what refuses it is `budget:lookback`, because
 *  `maxLookback` counts the offset and `effectiveBudget` clamps DOWNWARD ONLY so
 *  no stored blob can raise the 500-bar cap. Inventing a second number here
 *  would be a second limit nobody could re-derive, and the two would drift. */
function readOffset(node) {
  if (node.type !== 'MemberExpression') return null
  // `a.b` — a property read, and still `canonicalise:member`. Only the computed
  // form `a[…]` is the offset spelling.
  if (node.computed !== true) return { guard: 'canonicalise:member' }
  const p = node.property
  // ⛔⛔ `close["constructor"]` IS A PROPERTY REACH, NOT A MALFORMED OFFSET, AND
  // THIS LINE IS THE ONE THE SECURITY CORPUS IS ABOUT. `escapes.json`'s
  // `computed_member` case exists because `close.constructor` and
  // `close["constructor"]` are the same reach spelled two ways, and it is
  // fated to `canonicalise:member`. THE LITERAL KIND IS WHAT SAYS WHICH THING
  // THE USER MEANT: a STRING is a property NAME, a NUMBER is a bar INDEX. Every
  // non-numeric literal therefore stays with the member guard — a re-route to
  // an offset message here would move the ladder-to-`Function` case out from
  // under the guard the census credits with catching it.
  if (p && p.type === 'Literal' && typeof p.value !== 'number') {
    return { guard: 'canonicalise:member' }
  }
  if (p && p.type === 'UnaryExpression' && p.operator === '-'
      && p.argument && p.argument.type === 'Literal'
      && typeof p.argument.value === 'number') {
    return { guard: 'canonicalise:offset-forward' }
  }
  if (!p || p.type !== 'Literal' || typeof p.value !== 'number'
      || !Number.isInteger(p.value)) {
    return { guard: 'canonicalise:offset-literal' }
  }
  if (p.value < 0) return { guard: 'canonicalise:offset-forward' }
  // ⛔⛔ ONE APPLICATION PER VALUE. `close[1][2]` and `close[3]` are the SAME
  // COLUMN — identical values, identical NaN prefix, identical `maxLookback` —
  // and admitting both would give one column TWO canonical trees and therefore
  // TWO `astHash`es. That hash decides whether an edit bumps `compute.rev`,
  // which force-migrates every binding and resets `last_value`; a second
  // spelling of one tree is a second authority over one value, which is this
  // repo's most repeated defect. It costs nothing to refuse, because Pine
  // forbids the chain in its own grammar and a real corpus of 54 scripts
  // contains none — and `close[3]` says it already.
  if (node.object && node.object.type === 'MemberExpression'
      && node.object.computed === true) {
    return { guard: 'canonicalise:offset-chained' }
  }
  // `-0` is an integer that is not `< 0`; normalise it so the persisted tree —
  // and therefore `astHash` — can never carry two spellings of zero bars.
  return { guard: null, value: p.value === 0 ? 0 : p.value }
}

/** Every offence present anywhere in a jsep tree.
 *
 *  ITERATIVE ON PURPOSE. The escape corpus's `too_many_nodes` case is 8,001
 *  nodes deep; a recursive scan would die inside the guard rather than inside
 *  the thing being guarded, and a guard that crashes is not a refusal. */
function offencesIn(root) {
  const found = new Set()
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    if (Array.isArray(node)) { stack.push(...node); continue }
    if (!node || typeof node !== 'object') continue

    const byType = JSEP_TYPE_OFFENCE[node.type]
    if (byType) found.add(byType)

    // `x[3]` and `x.y` are one jsep type and two different answers. ONE
    // AUTHORITY decides which — see `readOffset`.
    const offence = readOffset(node)
    if (offence && offence.guard) found.add(offence.guard)

    // A SHAPE, not a type: `sma(close, 20)(1)` is a perfectly ordinary
    // CallExpression whose callee is another CallExpression. Only a bare name
    // may be called, because a callee that is itself an expression is how a
    // closed table stops being closed.
    if (node.type === 'CallExpression' && node.callee?.type !== 'Identifier') {
      found.add('canonicalise:call-target')
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') stack.push(value)
    }
  }
  return found
}

// --------------------------------------------------------------------------- //
// canonicalise
// --------------------------------------------------------------------------- //

const num = (value) => ({ type: 'num', value })
const series = (name) => ({ type: 'series', name })
const op = (name, args) => ({ type: 'op', name, args })
const call = (name, args) => ({ type: 'call', name, args })
const offset = (value, child) => ({ type: 'offset', value, args: [child] })

function convert(node) {
  switch (node.type) {
    case 'Literal': {
      if (typeof node.value === 'number') return num(node.value)
      // The manifest declares `!`, `&&`, `||` and `?:` over a table whose only
      // literal is a number, so a condition IS a 0/1 column and `true`/`false`
      // are spellings of 1 and 0. See `_booleans` in closedTable.json.
      if (node.value === true) return num(1)
      if (node.value === false) return num(0)
      return refuse('canonicalise:node')
    }
    case 'Identifier':
      // ⚠️ NOT VALIDATED AGAINST `TABLE.series` HERE, ON PURPOSE. Whether a name
      // resolves is `resolve:name`'s question and `escapes.json` fates
      // `globalThis` / `toString` / `hasOwnProperty` to that guard. Refusing
      // them here would move three census cases out from under the guard that
      // is supposed to catch them and make its first zero mean less.
      return series(node.name)
    case 'UnaryExpression': {
      const name = UNARY_CANONICAL[node.operator]
      if (!name) return refuse('canonicalise:operator')
      return op(name, [convert(node.argument)])
    }
    case 'BinaryExpression': {
      // Reachable only if the parser was reconfigured behind this module's back;
      // the removal in `configureParser` is the primary defence and the ops-table
      // case in parse.test.js is what asserts the removal itself. This is the
      // belt, and it is exercised directly rather than left theoretical.
      if (TABLE.operators[node.operator]?.arity !== 2) return refuse('canonicalise:operator')
      return op(node.operator, [convert(node.left), convert(node.right)])
    }
    case 'ConditionalExpression':
      return op(TERNARY, [convert(node.test), convert(node.consequent), convert(node.alternate)])
    case 'CallExpression': {
      // \u2b50 `tf` IS THE ONE CALL THAT IS NOT A CALL. `tf(close, 'W')` reads a
      // HIGHER TIMEFRAME, and the timeframe is a FIELD on the node rather than a
      // child expression \u2014 the same shape rule `offset` follows for its bar
      // count. A shape with no slot for an expression cannot hold one, so a
      // timeframe can never be computed at runtime and `max_lookback` stays a
      // tree sum over a bounded thing.
      //
      // \u26d4 IT IS SPELLED AS A CALL BECAUSE THAT IS WHAT A MEMBER TYPES, and the
      // alternative \u2014 inventing punctuation \u2014 would put a second grammar in a
      // language whose whole claim is that it has one. The string literal is
      // legal HERE and nowhere else: `convert` still refuses every other string,
      // so the table stays closed and this is the single declared exception.
      if (node.callee && node.callee.name === 'tf') {
        const args = node.arguments || []
        if (args.length !== 2) return refuse('canonicalise:timeframe')
        const code = args[1]
        if (!code || code.type !== 'Literal' || typeof code.value !== 'string') {
          return refuse('canonicalise:timeframe')
        }
        // \u26a0\ufe0f WHICH timeframes are legal is `interpret`'s question, not this
        // one's. The parser decides SHAPE; the table decides meaning, and
        // `interpret:timeframe` names an unserveable code at its own door with
        // the ladder listed. Validating it twice would be two authorities on one
        // vocabulary, and the parser's copy would be the one that goes stale.
        return { type: 'tf', value: code.value, args: [convert(args[0])] }
      }
      // ⭐⭐ AND THE READ OF ANOTHER INSTRUMENT — `sym('SPY', expr)`, the same
      // shape one axis over: `tf` changes WHICH PERIOD, `sym` changes WHICH
      // INSTRUMENT, and both keep their parameter as a FIELD so neither can be
      // computed at runtime.
      //
      // ⚠️ WHICH tickers are legal is NOT asked here. The chart lane serves any
      // symbol it can fetch; the SCAN lane serves the declared benchmarks and
      // refuses the rest at `assert_scannable`, naming the list. Two different
      // questions with two different answers — the parser decides SHAPE only, and
      // a ticker list copied into this file would be the copy that goes stale.
      if (node.callee && node.callee.name === 'sym') {
        const args = node.arguments || []
        if (args.length !== 2) return refuse('canonicalise:symbol')
        // ⚠️ THE TICKER COMES FIRST — `sym('SPY', close)` — while `tf` puts its
        // code LAST. That is not an oversight: it is the order every platform
        // this engine is read beside uses (`request.security(symbol, tf, expr)`),
        // and a member arriving from one of them types it that way. The node
        // shape is identical either way; only the surface differs.
        const ticker = args[0]
        if (!ticker || ticker.type !== 'Literal' || typeof ticker.value !== 'string') {
          return refuse('canonicalise:symbol')
        }
        return { type: 'sym', value: ticker.value, args: [convert(args[1])] }
      }
      return call(node.callee.name, (node.arguments || []).map(convert))
    }
    case 'MemberExpression': {
      // The whole-tree scan already refused every illegal member and every
      // illegal offset, so this arm only ever sees a legal one. It re-asks
      // anyway, through the SAME predicate — the belt, exercised directly, in
      // the idiom `BinaryExpression` above uses for the same reason.
      const read = readOffset(node)
      if (!read || read.guard) return refuse(read ? read.guard : 'canonicalise:member')
      const child = convert(node.object)
      // ⭐⭐ `x[0]` IS `x`, AND IT FOLDS TO IT RATHER THAN BECOMING A NODE.
      // Same values, same (absent) NaN prefix, same `maxLookback` — so emitting
      // a zero-bar offset would give ONE COLUMN TWO CANONICAL TREES and
      // therefore two `astHash`es, which is the same defect the chained-offset
      // refusal exists to stop. `astHash` decides whether an edit bumps
      // `compute.rev`, and a rev bump force-migrates every binding: two
      // spellings of one column is a migration a user can trigger by typing
      // `[0]`. Pine spells the identity the same way and means the same thing.
      return read.value === 0 ? child : offset(read.value, child)
    }
    default:
      return refuse('canonicalise:node')
  }
}

/** jsep's tree → the persisted tree. Four node shapes, and no others.
 *
 *  ⛔ MemberExpression, ArrayExpression, Compound, ThisExpression and
 *  AssignmentExpression are REFUSED HERE BY NAME, each with its own message.
 *  Refusal is decided by a WHOLE-TREE scan (see `OFFENCE_PRIORITY`) so the
 *  message a user sees never depends on which branch the walker reached first.
 *
 *  Throws `TableRefusal`. `parseFormula` is the door that never throws. */
export function canonicalise(node) {
  if (!node || typeof node !== 'object') return refuse('canonicalise:node')
  if (node.type === 'Compound' && (node.body || []).length === 0) {
    return refuse('canonicalise:empty')
  }
  const offences = offencesIn(node)
  for (const guard of OFFENCE_PRIORITY) {
    if (offences.has(guard)) return refuse(guard)
  }
  return convert(node)
}

// --------------------------------------------------------------------------- //
// parseFormula
// --------------------------------------------------------------------------- //

/** Parse. NEVER throws — returns a tagged result.
 *
 *  ⛔ A THROW FROM A PARSER REACHES THE BUILDER AS A BLANK SCREEN. The spec's
 *  instance-state inventory has ten states and none of them is "the page died";
 *  the failure state is a red dot on the chip with the message in the tooltip.
 *  And a parse failure is the NORMAL case here, not the exceptional one — the
 *  whole surface is a text box a user is halfway through typing into.
 *
 *  @returns {{ok: true, ast: object} | {ok: false, error: string, guard?: string}}
 */
export function parseFormula(source) {
  if (typeof source !== 'string' || source.trim() === '') {
    return { ok: false, error: REFUSALS['canonicalise:empty'], guard: 'canonicalise:empty' }
  }
  let tree
  try {
    tree = jsep(source)
  } catch (err) {
    // jsep's own syntax errors ("Unexpected \"=\" at character 2", "Expected )
    // at character 10"). They are the user's message, unedited — a rewritten
    // one loses the character offset the text box needs.
    return { ok: false, error: String(err && err.message ? err.message : err), guard: 'parser' }
  }
  try {
    return { ok: true, ast: canonicalise(tree) }
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      guard: err instanceof TableRefusal ? err.guard : 'canonicalise:node',
    }
  }
}

// --------------------------------------------------------------------------- //
// the hash that decides a rev bump
// --------------------------------------------------------------------------- //

/** Canonical JSON: keys SORTED, no whitespace, and NOTHING optional.
 *
 *  ⚠️ `JSON.stringify` DROPS `undefined` — silently, from objects, and to `null`
 *  inside arrays. The canonical form therefore has NO optional keys, and this
 *  refuses anything that is not a string, a finite number, an array or a plain
 *  object rather than serialising it into a hole. B5 shipped a fixture asserting
 *  an absent key and it was vacuous until it was round-tripped through real
 *  JSON; this is that lesson as a hard stop. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`astHash: ${String(value)} has no JSON form; a canonical tree carries finite numbers only`)
    }
    return JSON.stringify(value)
  }
  throw new Error(
    `astHash: a canonical tree carries strings, finite numbers, arrays and objects only — got ${
      value === undefined ? 'undefined' : typeof value}`)
}

const CANONICAL_KEYS = Object.freeze({
  num: ['type', 'value'],
  series: ['type', 'name'],
  op: ['type', 'name', 'args'],
  call: ['type', 'name', 'args'],
  // ⚠️ NO `name`. An offset is not a named thing — the bar count IS the node,
  // and giving it a name would open a second spelling of the same tree and
  // move every persisted `astHash` for nothing.
  offset: ['type', 'value', 'args'],
  // ⚠️ NO `name` HERE EITHER, and for the same reason: the TIMEFRAME is the
  // node. A `tf` whose code could be an expression would make `max_lookback`
  // unbounded and a scan un-terminating; keeping it a field is what keeps the
  // scan lane total.
  tf: ['type', 'value', 'args'],
  // ⚠️ AND NO `name` HERE EITHER. The TICKER is the node, for the same reason
  // `tf`'s timeframe is: a shape with no slot for an expression cannot hold one,
  // so a symbol can never be computed at runtime and the scan lane stays total.
  sym: ['type', 'value', 'args'],
})

/** The tree really is one of the declared shapes, with exactly its own keys.
 *
 *  ⚰️ This said "one of the FOUR shapes" while `CANONICAL_KEYS` above it — the
 *  thing it describes — declared seven. A hand-typed count beside its own list is
 *  this repo's most-repeated defect; say what the code derives.
 *
 *  This runs INSIDE `astHash` because the hash is taken of the PERSISTED
 *  artifact — a blob that arrived over a wire or out of a database, not
 *  necessarily one this module produced a millisecond ago. */
export function assertCanonical(ast) {
  const stack = [ast]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error(`astHash: not a canonical node: ${JSON.stringify(node) ?? String(node)}`)
    }
    const expected = CANONICAL_KEYS[node.type]
    if (!expected) {
      throw new Error(
        `astHash: node type ${JSON.stringify(node.type)} is not one of ${NODE_TYPES.join(', ')}`)
    }
    const keys = Object.keys(node).sort()
    const want = [...expected].sort()
    if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) {
      throw new Error(
        `astHash: a ${node.type} node must carry exactly [${want}] — got [${keys}]`)
    }
    if (node.args !== undefined) {
      if (!Array.isArray(node.args)) throw new Error('astHash: `args` must be an array')
      stack.push(...node.args)
    }
  }
  return ast
}

// ─── sha256, in ~50 lines, because the alternative is a dependency ──────────
//
// `crypto.subtle.digest` is ASYNC and this signature is not; `node:crypto` does
// not exist in the browser bundle. The whole input is one short JSON string.
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x, n) => (x >>> n) | (x << (32 - n))

export function sha256Hex(text) {
  const msg = new TextEncoder().encode(text)
  const blocks = Math.floor((msg.length + 8) / 64) + 1
  const buf = new Uint8Array(blocks * 64)
  buf.set(msg)
  buf[msg.length] = 0x80
  const dv = new DataView(buf.buffer)
  const bits = msg.length * 8
  dv.setUint32(buf.length - 8, Math.floor(bits / 4294967296))
  dv.setUint32(buf.length - 4, bits >>> 0)

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)

  for (let i = 0; i < buf.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4)
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]
      const y = w[t - 2]
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7]
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K256[t] + w[t]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0
      d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('')
}

/** `'sha256:<64 hex>'` over the canonical JSON of a canonical tree.
 *
 *  ⭐ THIS HASH DECIDES WHETHER AN EDIT BUMPS `compute.rev`, and a rev bump
 *  force-migrates every binding, resets `last_value` and suppresses a cycle. An
 *  UNSTABLE hash would migrate a user's alerts on a save that changed nothing —
 *  so key order, whitespace and argument spacing must not reach it, and a real
 *  semantic change must. */
export function astHash(ast) {
  assertCanonical(ast)
  return `sha256:${sha256Hex(stableStringify(ast))}`
}
