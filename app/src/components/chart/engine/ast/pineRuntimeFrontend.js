// app/src/components/chart/engine/ast/pineRuntimeFrontend.js
//
// ─── PINE SOURCE → SEMANTIC IR ──────────────────────────────────────────────
//
// 2D-2. The first path by which REAL Pine source reaches the bar-by-bar runtime.
//
// ⛔⛔ THIS IS NOT A SECOND PARSER, AND THAT IS THE POINT. It reuses `pine.js`'s
// lexer, its indent-aware statement tree (`blockStatements`, which already
// produces `{header, body, sub}` at every level), its expression parser and its
// `Resolver`. What the old lowering did was DISCARD that structure, because the
// artifact it targeted could only hold expressions. This one keeps it.
//
// ⭐⭐ THE ROUTE IS CHOSEN BY EFFECT, NOT BY SYNTAX (§47/§48). One rule decides
// every expression:
//
//      does this subtree READ A MUTABLE SLOT?
//        no  → it is pure: `Resolver` → canonical tree → ONE column, evaluated by
//              the columnar lane, read per bar. All 70 builtins keep their
//              warm-ups, recurrences and vendor pins.
//        yes → it is stateful: lowered structurally into IR expression nodes,
//              with its pure subterms still becoming columns.
//
// So `ta.sma(close, len)` where `len` is an ordinary binding stays in the graph
// lane at full speed, and `acc := acc + close` becomes real statements — in the
// same program, from the same parse.
//
// ⛔ NOTHING IS EVER SILENTLY DROPPED (§18). A statement form this front end
// cannot yet lower produces a NAMED refusal identifying the exact family, so the
// next true dependency is exposed rather than hidden behind `pine:state`.

import {
  lexPine, blockStatements, parseWholeExpression, Resolver,
  findTop, isPunct, boundName, locate, PineRefusal, functionParams,
  VALUE_NAMESPACES, PINE_CALL_SHAPES, PINE_NAMESPACED_TREE, colourHexByName, objectEnumValue,
  OWN_TF_NAMES, basePeriodOf,
} from './pine.js'
import { CLOCK_REALTIME } from '../../indicators.js'
import { TABLE, isPointwise } from './parse.js'
import { interpret, POINTWISE_FOR_PARITY, FINITE_WINDOW, CARRIED } from './interpret.js'
import { bindConstsFor, foldBound } from './bind.js'
import {
  makeIrProgram, SLOT, EXPR, num, str, concat, series, column, read, hist, binary, unary, ternary,
  declare, assign, ifStmt, emit, emitIter, naValue, call as irCall, builtin as irBuiltin, histSlot,
  windowCall, carriedCall, carried2Call, textCall, arrayCall, exprStmt,
  forStmt, breakStmt, continueStmt, tuple, destructure, requestCall, colourCall,
  clock, session, drawing,
  // ⭐ ALIASED. `field` and `record` are ordinary English and this file already
  // uses both words as local variables; an IR constructor shadowed by one would
  // build the wrong node with nothing red.
  record as irRecord, field as irField, fieldSet as irFieldSet,
} from '../runtime/ir.js'
import { CLOCK_FIELDS } from '../runtime/program.js'
import { TEXT_FNS, producesText } from '../runtime/text.js'
import { ARRAY_FNS, producesArray, isVoid, argKind } from '../runtime/collections.js'
// ⭐ Pine's method form, and it decides no legality — see `ufcs.js`. The rewrite
// hands `array.push` / `table.cell` to the rosters this file already consults,
// so a method-form call is admitted or refused by the same table, with the same
// sentence, as the name form it is.
import { methodFormCall, splitMethodName } from './ufcs.js'

/** Array calls whose RESULT is one element of the array. ⭐ Used only to carry
 *  a collection's element KIND to the value that reads it out. */
/** The sort directions `array.sort_indices` reads, as the strings the
 *  collection layer compares. Two entries, and a name that is neither stays
 *  an ordinary unbound name rather than silently defaulting to ascending. */
const ORDER_ENUM = Object.freeze({
  'order.ascending': 'ascending', 'order.descending': 'descending',
})

const ARRAY_READS_ELEMENT = new Set(['array.get', 'array.pop', 'array.shift',
  'array.first', 'array.last', 'array.remove'])
import { COLOUR_FNS, producesColour, hexToPacked } from '../runtime/colours.js'

/** ⭐ THE REFUSAL VOCABULARY IS ITS OWN, AND DELIBERATELY GRANULAR (§19).
 *  Collapsing these into `pine:state` would hide the next dependency, which is
 *  the single most useful thing this wave can report. Every entry names a
 *  capability family from the completion matrix, so a refusal maps to a row. */
export const RUNTIME_REFUSALS = Object.freeze({
  'runtime:loop': 'a loop — the runtime has no iteration yet',
  'runtime:function': 'a user-defined function — the runtime has no call frames yet',
  'runtime:tuple': 'a tuple — the runtime has no multiple-value form yet',
  'runtime:array': 'an array or collection operation — the runtime has no collections yet',
  'runtime:object-op': 'a graphical-object operation — these belong to the object program, not the value runtime',
  // ⭐⭐ 2F-2 IMPLEMENTED THIS. It stays in the vocabulary because the family is
  // wider than the capability: `x[1]` over a top-level mutable value now runs,
  // and the three shapes below are the parts that do not, each refused BY ITS OWN
  // NAME so the next dependency is a row rather than a rumour.
  'runtime:fill-target': 'a fill spans two PLOTS, and this argument does not name one',
  'runtime:fill-gradient': 'the gradient form of `fill` — `fill(plot1, plot2, top_value, bottom_value, top_color, bottom_color)` shades vertically between two values, and this engine’s fill paints one colour across a span',
  'runtime:colour': 'a colour was expected here — a colour is a packed integer in this lane, and a price packed into a colour slot would draw a plausible shade computed from the wrong thing',
  'runtime:plot-id': 'a plot id used as a number — `p = plot(…)` names a plot so that `fill()` can refer to it, and it is not a value the script can compute with',
  'runtime:history-variable': 'history over a mutable variable — that needs per-slot history committed at end of bar',
  'runtime:history-expression':
    'history over an EXPRESSION containing a mutable value — `(a + b)[1]` needs its own '
    + 'committed series, and distributing the offset over the operands is only right when '
    + 'nothing inside carries state',
  // ⭐ ONE GUARD, TWO NOUNS — a history offset (`x[n]`) and a finite-window
  // length (`sma(x, n)`) ask the SAME question of the SAME ring, so they share a
  // guard and a measurement bucket deliberately. The stock sentence therefore
  // names neither; the call site supplies the noun. ⚰️ It led with "a history
  // offset" while the window path was already using it, so a refused length read
  // as a refused offset and sent the reader to ring machinery.
  'runtime:history-dynamic-offset':
    'a ring width that is only known while the bar is running — the depth it may reach '
    + 'cannot be bounded before execution, and reading past the ring would answer '
    + '`na` where Pine answers a number',
  'runtime:history-function-local':
    'history over a FUNCTION-LOCAL value — the ring needs a per-call-site base the way '
    + 'persistent state already has one, and Pine\'s semantics for a call site that is '
    + 'skipped on a bar are not yet vendor-pinned',
  'runtime:expression-statement': 'an expression evaluated for effect — nothing in this runtime has an effect yet',
  // ⭐⭐ SPLIT IN 2E, BECAUSE THE MEASUREMENT SAID IT WAS THREE THINGS (§29).
  // `runtime:call-with-state` was the top blocker at 15 and named `na`, `nz`,
  // `math.max`, `int` and `str.upper` in the same breath as `ema` and
  // `request.security` — a POINTWISE function applied to a state value, a
  // WINDOWED one that would need a growing series, and an MTF request are three
  // separately-schedulable capabilities of very different size. One label made
  // them look like one wall.
  'runtime:call-pointwise-state':
    'a POINTWISE builtin applied to a mutable value — no series is needed, only a per-bar apply',
  'runtime:call-windowed-state':
    'a WINDOWED builtin fed by a mutable variable — this one needs the series bridge',
  'runtime:request-with-state':
    'a data request whose argument is a mutable value',
  // ⭐⭐ SPLIT AGAIN IN 2F-1, FOR THE SAME REASON 2E SPLIT THE FIRST ONE (§14).
  // With the pointwise 14 executing, the residual bucket was re-read by name and
  // it was NOT one family either: `str.upper`, `int` and `iff` sat in
  // `call-windowed-state` beside `ema`, `sma` and `wma`. Measured against the
  // closed table (`TABLE.functions`), those three are not windowed — they are
  // **not declared at all**, so the wall is the TABLE, not the series bridge.
  // Left alone, the matrix would have sized the series bridge at 13 when it is
  // 10, and hidden a text/conversion demand inside a series row.
  'runtime:call-text-state':
    'a TEXT builtin applied to a mutable value — text is a value-model change, not a series one',
  'runtime:call-conversion-state':
    'a numeric CONVERSION applied to a mutable value — a cast, not a series',
  'runtime:call-undeclared-builtin-state':
    'a builtin fed by a mutable value that the CLOSED TABLE does not declare at all — '
    + 'this one is blocked on the builtin existing, not on the runtime',
  // ⭐⭐ SPLIT OUT FOR THE REASON 2E AND 2F-1 SPLIT THE TWO ABOVE, and it is the
  // THIRD instance of the mislabel `builtinStateFamily` records in its own
  // comment (a `plot` bound to a name; the eight `PINE_CALL_SHAPES` spellings).
  // An input is not a table function in EITHER lane — `pine.js::resolveInput`
  // folds it and the closed table has never held one — so filing it under "the
  // closed table does not declare this builtin" sends a reader to add an entry
  // that would do nothing. What is actually wrong is upstream of any table: an
  // input is settled once, before bar 0, so a default or a bound that is only
  // known while a bar runs is not a default or a bound.
  'runtime:input-state':
    'an input whose DEFAULT or BOUNDS read a mutable variable — an input is settled '
    + 'once, before bar 0, so both have to be fixed when the script is written',
  'runtime:operator': 'an operator the runtime has no instruction for',
  'runtime:switch': 'a switch — the runtime has no multi-way branch yet',
  'runtime:varip': 'varip — intrabar persistence, which a closed-bar runtime cannot reproduce',
  // ⭐⭐ THE FAMILY SURVIVES THE CAPABILITY, exactly as `runtime:fill-target`
  // does above. A `type Foo` declaration, `Foo.new(…)`, a field read and a
  // field write all execute now; what remains of the family is named BY ITS
  // OWN GUARD below, so the next dependency is a census row rather than one
  // undifferentiated wall. ⛔ The bare guard is kept for a `type` statement this
  // lane cannot READ — a declaration whose field lines carry no name it can
  // find is not a type it may guess at.
  'runtime:udt': 'a user-defined type',
  'runtime:udt-field':
    'a field this type does not declare — the head of the path is a record this lane '
    + 'holds, so the name is a field, not a variable',
  'runtime:udt-method':
    'a Pine 6 `method` declared on a user type — a method is a user FUNCTION whose '
    + 'receiver is argument 0, and this lane does not yet bind one',
  // ⭐ RULING 3.3 (owner, 2026-09-12) — THIS LANE REFUSES RATHER THAN BLANKS.
  // The four realtime barstate columns are decided by `opts.newestBarIsForming`, a
  // tri-state produced on the Python side. Nothing in `app/src` supplies it to this
  // lane yet, so they fail closed to NA — correct, and BLANK. A member cannot tell a
  // blank cell from "this bar is not confirmed", and our own doctrine says anything
  // unrenderable surfaces a named refusal or a disclosure, never a blank.
  // ⛔ SCOPED TO THIS LANE ON PURPOSE. The first attempt put it in `interpret()`, the
  // SHARED seam, and turned 12 tests red: censuses and rails legitimately interpret
  // trees with no clock, where no member is involved. Breaking them was the signal
  // that the seam was wrong, not that the tests were.
  'runtime:realtime-untold': 'this lane cannot say yet whether the newest bar has finished, so a realtime barstate column would be blank rather than wrong',
  'runtime:presentation': 'a presentation call — this belongs to the presentation program, which the runtime lane does not carry yet',
  'runtime:directive': 'a compiler directive',
  'runtime:unbound': 'a name nothing in this script binds',
  'runtime:statement': 'a statement shape this front end does not recognise',
  'runtime:declaration': 'a script that is not an indicator',
  'runtime:no-output': 'a script with nothing to plot',
  'runtime:recursion': 'a function that calls itself — Pine forbids it',
  'runtime:function-global-state': 'a function body reading a mutable GLOBAL — a frame has no address for one yet',
})

export class RuntimeRefusal extends Error {
  constructor(guard, detail, at) {
    super(`${RUNTIME_REFUSALS[guard] || guard}${detail ? ` — ${detail}` : ''}`)
    this.name = 'RuntimeRefusal'
    this.guard = guard
    this.detail = detail || null
    // ⭐ SOURCE LOCATION IS CARRIED (§50). Not for polish — a capability gap has
    // to be attributable to a line before any of the later product work
    // (diagnostics, Builder editing, import receipts) is possible at all.
    this.line = at && at.line != null ? at.line : null
    this.column = at && at.column != null ? at.column : null
    this.token = at && at.token != null ? at.token : null
  }
}

const BIN = Object.freeze({
  '+': '+', '-': '-', '*': '*', '/': '/',
  '<': '<', '>': '>', '<=': '<=', '>=': '>=', '==': '==', '!=': '!=',
  and: '&&', or: '||',
})
const PRICE = new Set(['open', 'high', 'low', 'close', 'volume'])
const BLOCK_WORDS = new Set(['for', 'while'])
/** The calls this lane turns into a VALUE SERIES.
 *
 *  ⭐ EXPORTED FOR THE RAIL, which compares it against `pine.js`'s own
 *  `OUTPUT_CALLS` so the two lanes cannot quietly disagree about what an output
 *  is. Where this set is WIDER the difference is deliberate and named there. */
export const RUNTIME_OUTPUT_CALLS = Object.freeze(new Set([
  'plot', 'plotshape', 'plotchar', 'plotarrow', 'alertcondition', 'hline',
  'bgcolor', 'barcolor',
]))

/** The output calls whose emitted series is a COLOUR rather than a price.
 *
 *  ⭐ A SUBSET, NOT A SEPARATE FAMILY. `bgcolor` and `barcolor` emit one value
 *  per bar exactly as `plot` does; the only difference is what the number MEANS,
 *  and that difference has to be declared somewhere or the emitter cannot refuse
 *  `plot(color.red)` and `bgcolor(close)` — which are the same mistake pointing
 *  in opposite directions. */
export const RUNTIME_COLOUR_OUTPUTS = Object.freeze(new Set(['bgcolor', 'barcolor']))

/** ⭐ The cross family this lane serves over RUNTIME state, Pine spelling ->
 *  the `CARRIED2` member.
 *
 *  ⚰️ `ta.cross` WAS LEFT OUT OF THIS TABLE AND THE REASONING WAS WRONG. It
 *  looked like a name with no authority — `closedTable.json` declares
 *  `crossOver` and `crossUnder` and no `cross` — so serving it here seemed like
 *  inventing a ruling. Measured instead of assumed: `pine.js` rewrites
 *  `cross(a, b)` to `crossOver(a, b) || crossUnder(a, b)`, `ta.cross` over PURE
 *  arguments COMPILES today, and `BINARY['||']` propagates NaN so the warm-up
 *  shape matches `crossover`'s exactly. Leaving it out would have created the
 *  very asymmetry the exclusion was meant to avoid — pure compiles, stateful
 *  refuses — in 28 sites across 8 scripts. */
export const RUNTIME_CROSS_CARRIED = Object.freeze({
  'ta.crossover': 'crossOver',
  crossover: 'crossOver',
  'ta.crossunder': 'crossUnder',
  crossunder: 'crossUnder',
  'ta.cross': 'crossAny',
  cross: 'crossAny',
})

/** How many firings back `ta.valuewhen` will look. The ring is allocated from
 *  this, and the corpus's largest occurrence is a small literal. */
export const MAX_VALUEWHEN_OCCURRENCE = 1000

const OBJECT_NS = /^(line|label|box|table|polyline|linefill)\./
const ARRAY_NS = /^(array|matrix|map)\./

// ── ⭐⭐ USER-DEFINED TYPES — `type Foo` ─────────────────────────────────────
//
// ⛔⛔ A `type` DECLARATION ARRIVES AS **ONE STATEMENT HEADER**, FIELDS AND
// ALL, AND THAT IS NOT A BUG TO ROUTE AROUND. `blockStatements` opens a `sub`
// block for the words that open one — `if`, `for`, `=>` — and `type` is not one
// of them, so its indented field lines are absorbed as CONTINUATIONS of the
// header. Measured on a five-field type, the header is:
//
//     type Point  float x = 0.0  int y  box b = na  array<line> ls
//
// ⭐ THE PHYSICAL LINE IS RECOVERABLE AND IS THE RIGHT SEPARATOR. Every token
// still carries its own `line`, and Pine writes one field per line — so the
// fields are the token runs grouped by `tok.line`, which is exactly what the
// member typed. ⛔ Splitting on TYPE WORDS instead was tried and is wrong:
// `float x = 0.0` is followed by `int y`, and a split on "the next type word"
// cannot tell that from a default value that happens to mention one
// (`color c = color.new(color.red, 0)`).
//
// ⛔ `array<line> ls` HAS ALREADY LOST ITS ANGLE BRACKETS BY HERE.
// `stripTypeArguments` runs in the LEXER and moves `<line>` onto the head token
// as `typeArgs`, so the run is two idents and the element type is read off
// `tok.typeArgs` rather than re-parsed. One normalisation, both lanes.

/** Pine's own type words, which may precede a field name. ⭐ A field's type may
 *  also be ANOTHER user type (`orderBlockInfo info`), so this list is not a
 *  whitelist — it is only used to tell a QUALIFIER from the field name. */
const FIELD_QUALIFIERS = Object.freeze(new Set(['series', 'simple', 'const', 'input']))

/**
 * The fields of one `type` declaration, read out of its flattened header.
 *
 * @param {object[]} toks  the whole statement header, starting at `type`
 * @returns {{name:string, type:string, typeArgs:string[]|null, def:object[]|null, tok:object}[]}
 */
function readTypeFields(toks) {
  // ⭐ GROUPED BY THE MEMBER'S OWN LINE — see the header above.
  const lines = new Map()
  for (let i = 2; i < toks.length; i += 1) {
    const t = toks[i]
    if (!lines.has(t.line)) lines.set(t.line, [])
    lines.get(t.line).push(t)
  }
  const out = []
  for (const run of lines.values()) {
    const eq = findTop(run, (t) => isPunct(t, '='))
    const head = eq > 0 ? run.slice(0, eq) : run
    // ⛔ THE NAME IS THE LAST IDENT OF THE DECLARATION HALF, and the TYPE is
    // what sits before it. A run of one token has no type and is not a field —
    // returning `null` there would be a field named after its own type.
    const idents = head.filter((t) => t.kind === 'ident' && !FIELD_QUALIFIERS.has(t.value))
    if (idents.length < 2) continue
    const nameTok = idents[idents.length - 1]
    const typeTok = idents[idents.length - 2]
    out.push({
      name: nameTok.value,
      type: typeTok.value,
      typeArgs: Array.isArray(typeTok.typeArgs) ? typeTok.typeArgs.slice() : null,
      def: eq > 0 ? run.slice(eq + 1) : null,
      tok: nameTok,
    })
  }
  return out
}

/**
 * Every `type Foo` in the tree, nested bodies included.
 *
 * ⛔⛔ COLLECTED BEFORE THE WALK, for the reason `scanMutability` is. A type may
 * be declared BELOW the function that constructs it — `ict-institutional-order-
 * flow-fadi` declares nine types and calls `Helper.new()` above three of them —
 * and a registry that filled as the walk went would refuse the constructor as
 * an unknown namespace and then register the type one statement later.
 *
 * ⚠️ IT IS ALSO WHY A DUPLICATE IS THE FIRST DECLARATION, NOT THE LAST: nothing
 * in this lane scopes a type to a block, so two declarations of one name would
 * otherwise depend on walk order. Pine forbids the duplicate outright; keeping
 * the first is the stable answer, and it is recorded rather than assumed.
 */
export function collectUdtTypes(stmts, out) {
  const acc = out || new Map()
  for (const st of stmts) {
    const toks = st.header || []
    const first = toks[0]
    // ⛔⛔ `type = input(…)` IS A BINDING TO A VARIABLE CALLED `type`, NOT A
    // TYPE DECLARATION, and this engine has already counted one as one.
    // `screener-mean-reversion-channel` writes
    //     type = input("SuperSmoother", title="Filter Type", options=[…])
    // and it sat on the `runtime:udt` census row for weeks — 1 of the 17
    // scripts that row claimed, in a script that declares no type at all.
    //
    // ⭐ THE SECOND TOKEN IS WHAT TELLS THEM APART, and one test does it: a
    // DECLARATION's second token is a NAME, a binding's is `=`. Requiring an
    // `ident` there rejects the binding by construction.
    // ⚰️ A second clause, `&& !isPunct(toks[2], '=')`, was written here as
    // well and is gone on its own measurement: removing it left every case
    // green, because `toks[1]` is already the `=` in that shape and is not an
    // ident. Two tests of one fact, the redundant one sitting where a reader
    // counts it (`lesson_a_guard_repeated_is_a_guard_unproved`).
    if (first && first.kind === 'ident' && first.value === 'type'
        && toks[1] && toks[1].kind === 'ident') {
      const name = toks[1].value
      if (!acc.has(name)) {
        acc.set(name, { name, fields: readTypeFields(toks), tok: toks[1] })
      }
    }
    if (st.sub && st.sub.length) collectUdtTypes(st.sub, acc)
  }
  return acc
}

/** ⭐ WHICH ARGUMENT OF A COLLECTION CALL CARRIES A VALUE, counting the
 *  collection itself. `push(coll, v)` → 1; `set(coll, i, v)` → 2.
 *
 *  ⛔⛔ THIS IS `pineObjects.js`'s `VALUE_ARG` WITH THE COLLECTION COUNTED IN.
 *  That table is written over the arguments AFTER the collection (`push` → 0)
 *  because that is the list its reader walks; this one is written over the WHOLE
 *  argument list because that is the list THIS lowering walks. The two numbers
 *  differ by one and name the same position, and two hand-typed tables of one
 *  fact is the drift this repo pays for most — so `drawingAsValue.test.js`
 *  DERIVES this one from that one and fails if either moves alone.
 *
 *  ⛔ Every other collection call takes an index or nothing, so it has NO value
 *  position — and a shape absent from this table can never admit a drawing.
 *
 *  ⭐ EXPORTED FOR THAT RAIL. Nothing else reads it. */
export const COLLECTION_VALUE_ARG = Object.freeze({ 'array.push': 1, 'array.set': 2 })
/** The input kinds whose VALUE IS TEXT.
 *
 *  ⛔⛔ `pine.js` REFUSES THESE AND IS RIGHT TO. That lane's value model is
 *  numbers, and it states at length that a string has no carrier in its
 *  grammar. This lane has one, so it takes them here — the same shape as
 *  every other text capability in this wave, and the columnar rule is left
 *  exactly where it is rather than widened. */
const TEXT_INPUTS = new Set(['input.text_area', 'input.string'])

/** Is this NAME Pine's input family?
 *
 *  ⛔ ONE SPELLING, READ TWICE. The route decision asks it of a node and
 *  `builtinStateFamily` asks it of a bare name; two hand-written copies of
 *  `name === 'input' || name.startsWith('input.')` would be two authorities
 *  over one question, and the one that drifts is the one nobody reads again
 *  (`lesson_a_guard_repeated_is_a_guard_unproved`). */
const isInputName = (name) => typeof name === 'string'
  && (name === 'input' || name.startsWith('input.'))

/** Is this node a call to Pine's input family? */
const isInputCall = (node) => !!(node && node.type === 'call' && isInputName(node.name))

/** The NAMED arguments of an input call that a reader in EITHER lane consults.
 *
 *  ⭐⭐ DERIVED FROM THE READERS, NOT FROM THE REFERENCE MANUAL. `pine.js`'s
 *  `resolveInput` reads exactly `defval`, and the NAMED `minval`/`maxval`/`step`
 *  — the bounds that decide whether a MEMBER'S number is admitted at all. This
 *  file's own `admitTextInput` reads `defval` and the NAMED `options`. Nothing
 *  anywhere reads `group`, `tooltip`, `inline`, `display` or `confirm` when
 *  computing a value, because none of them can move one: they name a control in
 *  the settings dialog.
 *
 *  ⛔ SO THIS IS A FACT ABOUT THIS ENGINE, CHECKABLE IN THOSE TWO FUNCTIONS, and
 *  deliberately NOT a transcription of TradingView's positional signatures —
 *  which differ per kind, are vendor surface, and would be a second authority
 *  over a question the readers already answer. */
const INPUT_VALUE_ARGS = Object.freeze(new Set(['defval', 'minval', 'maxval', 'step', 'options']))

/** The arguments of an input call whose value can reach the input's own value.
 *
 *  ⭐ The DEFVAL is read the way `resolveInput` reads it — named, or the
 *  argument at index 0 — so the two cannot disagree about which argument is the
 *  default. Every other POSITIONAL argument is skipped for the reason above:
 *  no reader in either lane consults one. `input.source(close, 'Price', tip, …)`
 *  — the `bollinger-band-width-percentile` shape, with `tip` a `var string` —
 *  passes its tooltip third, and a tooltip cannot change a source.
 *
 *  ⚠️ THE COST OF THAT, STATED RATHER THAN HIDDEN: a POSITIONAL `minval` is
 *  already ignored by `resolveInput`'s member-bound check, which finds bounds by
 *  NAME only. Skipping it here does not widen that gap; it matches it. A
 *  positional bound that mattered would have to be read by a reader first. */
const inputValueArgs = (node) => {
  const args = (node && node.args) || []
  const out = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    const v = a && a.value !== undefined ? a.value : a
    if (a && a.name) {
      if (INPUT_VALUE_ARGS.has(a.name)) out.push(v)
    } else if (i === 0) {
      out.push(v)
    }
  }
  return out
}

/** Pine's three numeric casts, as a REPORTING label only.
 *
 *  ⭐ THEY ARE `pine.js`'s, not this file's invention: its resolver handles
 *  `int`, `bool` and `float` by name and rules on each separately — `float(x)`
 *  is the identity in a one-numeric-column engine, `bool(x)` is `x != 0`, and
 *  `int(x)` REFUSES unless the argument already reduces to a whole number
 *  because TradingView does not publish whether the cast truncates, rounds or
 *  floors. Naming them here keeps a cast from being filed as a windowed series
 *  function; it can never make one execute. */
const CONVERSION_NAMES = Object.freeze(new Set(['int', 'float', 'bool']))

/** ⛔ A CEILING ON HOW MANY VALUES ONE SCRIPT MAY KEEP HISTORY FOR, checked at
 *  COMPILE time so a hopeless program is refused before bar 0 rather than
 *  discovered at bar 4,000. It mirrors the runtime's `HISTORY_SLOTS`, which
 *  charges the same quantity while running — `limits.js`'s own header argues why
 *  both halves are required: a static estimate cannot see a data-dependent bound,
 *  and a running counter alone lets a hopeless program start. */
const MAX_HISTORY_SLOTS = 512

// ── mutability pre-scan ─────────────────────────────────────────────────────

/** Every name this script ever MUTATES, and whether it was declared `var`.
 *
 *  ⛔ SCANNED OVER THE WHOLE TREE INCLUDING NESTED BODIES, before any lowering.
 *  A name reassigned inside an `if` is mutable everywhere, and deciding that
 *  lazily — as each statement is reached — would classify its first read as pure
 *  and fold it, which is the silent-wrong-result shape this whole program exists
 *  to prevent. */
export function scanMutability(stmts, out) {
  const acc = out || { mutated: new Set(), persistent: new Set() }
  for (const st of stmts) {
    const toks = st.header || []
    const first = toks[0]
    if (first && first.kind === 'ident' && (first.value === 'var' || first.value === 'varip')) {
      const eq = findTop(toks, (t) => isPunct(t, '='))
      const nameTok = eq > 0 ? boundName(toks, eq) : null
      if (nameTok) { acc.mutated.add(nameTok.value); acc.persistent.add(nameTok.value) }
    }
    const walrus = findTop(toks, (t) => isPunct(t, ':='))
    if (walrus > 0 && toks[walrus - 1] && toks[walrus - 1].kind === 'ident') {
      acc.mutated.add(toks[walrus - 1].value)
    }
    if (st.sub && st.sub.length) scanMutability(st.sub, acc)
  }
  return acc
}

// ── scope chain ─────────────────────────────────────────────────────────────

/** ⭐⭐ A SCOPE IS A FRAME, AND A SLOT IS ALLOCATED PER DECLARATION — never per
 *  NAME (§5). Two `x`es in sibling `if` bodies are two slots and cannot alias;
 *  resolving by name at runtime is what would let one mutate the other. */
class Scope {
  constructor(parent) { this.parent = parent; this.names = new Map() }
  lookup(name) {
    for (let s = this; s; s = s.parent) {
      if (s.names.has(name)) return s.names.get(name)
    }
    return null
  }
  declare(name, slot) { this.names.set(name, slot); return slot }
}

// ── the builder ─────────────────────────────────────────────────────────────

/** ⚠️ EXPORTED FOR THE RAIL ONLY, like `PINE_CALL_SHAPES`, and `shapes` is a
 *  parameter FOR THE SAME REASON — read-only, defaulting to the real table.
 *
 *  ⛔⛔ WITHOUT BOTH, THE IDENTITY-BUILD GUARD IS UNFALSIFIABLE. It was nested
 *  inside `buildRuntimeIr` and every rewrite shape in `PINE_CALL_SHAPES` happens
 *  to name a NON-pointwise table, so `isPointwise` rejected them one line later
 *  and DELETING the guard changed no observable answer — measured, not assumed:
 *  the deletion left all 124 runtime tests green. A guard nobody has seen fire is
 *  not a guard (`lesson_gate_that_cannot_fail`), so the rail passes a synthetic
 *  rewrite shape onto a pointwise target and watches this refuse it. */

/** ⭐ `ta.change` AND ITS BARE SPELLING — the `offsetOne` shape's one member
 *  this runtime can serve today.
 *
 *  ⛔ IT IS A LOOKUP, NOT A NAME TEST. The closed table declares `change` with
 *  `lookback: 1`; asking the table (through `PINE_CALL_SHAPES`, so a renamed
 *  spelling still resolves) is what keeps this from becoming a second opinion
 *  about which builtins read exactly one bar back. */
export const changeTarget = (pineName, table = TABLE) => {
  const name = String(pineName || '')
  if (PINE_NAMESPACED_TREE[name]) return null
  let bare = name
  const dot = name.indexOf('.')
  if (dot >= 0) {
    if (!VALUE_NAMESPACES.has(name.slice(0, dot))) return null
    bare = name.slice(dot + 1)
  }
  const shape = PINE_CALL_SHAPES[bare]
  const tbl = shape && shape.table ? shape.table : bare
  if (tbl !== 'change') return null
  const spec = table.functions[tbl]
  if (!spec || spec.lookback !== 1) return null
  return { table: tbl }
}

/** ⭐⭐ THE CARRIED-STATE CLASSIFIER (2F-2C) — `windowTarget`'s counterpart.
 *
 *  Same five-authority discipline, with `CARRIED` standing where
 *  `FINITE_WINDOW` stands. Membership is `interpret.js`'s and never this
 *  file's: a member is here because its shipped column walk IS a forward pass
 *  over a fixed number of scalars.
 *
 *  ⛔ A NAMESPACED REWRITE IS ASKED FIRST AND REFUSES. No member of `CARRIED`
 *  is rewritten by `PINE_NAMESPACED_TREE` today, but reaching the bare table
 *  entry through a namespace strip is exactly how 2F-2B lost `ta.highestbars`'
 *  sign — so the same door is checked here rather than assumed empty.
 */
export const carriedTarget = (pineName, tree = PINE_NAMESPACED_TREE, table = CARRIED) => {
  const name = String(pineName || '')
  // ⚠️ UNFALSIFIABLE AGAINST THE SHIPPED TABLES, AND EXERCISABLE ANYWAY.
  // No `CARRIED` member is rewritten by `PINE_NAMESPACED_TREE` today, so
  // deleting this line changes no answer and a mutation run would report it
  // surviving. It is kept because `ta.highestbars` proved what a dropped
  // namespaced transform costs (right magnitude, wrong sign), and it is made
  // REACHABLE rather than merely argued for: the rail passes a synthetic
  // tree/table pair the shipped ones cannot spell.
  if (tree[name]) return null
  let bare = name
  const dot = name.indexOf('.')
  if (dot >= 0) {
    if (!VALUE_NAMESPACES.has(name.slice(0, dot))) return null
    bare = name.slice(dot + 1)
  }
  const shape = PINE_CALL_SHAPES[bare]
  if (shape) {
    const identity = Array.isArray(shape.build)
      && shape.build.every((b, i) => b && b.pine === i && Object.keys(b).length === 1)
    if (!identity) return null
  }
  const tbl = shape && shape.table ? shape.table : bare
  if (!TABLE.functions[tbl]) return null
  if (!table[tbl]) return null
  return { table: tbl }
}
/** What `pine.js` turns a NAMESPACED Pine spelling into, when this runtime can
 *  serve the result.
 *
 *  ⭐⭐ THREE ANSWERS, AND THE THIRD IS THE POINT:
 *    · `undefined` — `pine.js` does not rewrite this name; the caller should
 *      go on to the ordinary namespace-strip path.
 *    · `null` — it DOES rewrite it, into something other than a bare negated
 *      finite window (`ta.pivothigh` shifts to its confirmation bar). Refuse.
 *    · a descriptor — the rewrite is exactly `-<member>(src, len)`.
 *
 *  ⛔⛔ THE MATCH IS STRUCTURAL AND IT CHECKS ARGUMENT IDENTITY. The probe
 *  nodes are handed in and must come back OUT, in order, as the same objects —
 *  so a rewrite that reorders, defaults, wraps or duplicates an argument fails
 *  the test even though its shape still reads `-call(a, b)`. `negatedBars`'
 *  own one-argument form defaults the source to `high`/`low`, which is a
 *  DIFFERENT question with the same shape; the two-argument probe is what
 *  keeps that form from being admitted on the two-argument form's evidence.
 *
 *  ⚠️ AND IT NEVER NAMES A MEMBER. Adding a third entry to
 *  `PINE_NAMESPACED_TREE` tomorrow is measured by this function on the day it
 *  lands — admitted if it is a negated window, refused if it is anything else.
 *  A hand-written `if (name === 'ta.highestbars')` would be a second authority
 *  over the sign, which is the defect this whole wave exists to stop.
 *
 *  ⚠️ `tree` IS EXPORTED FOR THE RAIL ONLY, exactly as `pointwiseTarget`'s
 *  `shapes` is, and for the same reason. `PINE_NAMESPACED_TREE` holds two
 *  entries and both are negated windows, so with the shipped table every guard
 *  below except the `u-` test is DEAD — deleting the argument-identity check,
 *  the arity check or the table membership check changes no answer, and a
 *  mutation run would report them all as surviving. That is not a reason to
 *  drop them (the next entry is what they are for); it is a reason to make
 *  them reachable. The rail passes synthetic rewrites — an argument reorder, a
 *  defaulted source, a non-member call — that the shipped table cannot spell.
 */
export const namespacedWindowShape = (pineName, tree = PINE_NAMESPACED_TREE) => {
  const build = tree[pineName]
  if (typeof build !== 'function') return undefined
  const src = { type: 'name', name: '__runtime_window_probe_src__' }
  const len = { type: 'num', value: 0 }
  let built = null
  try { built = build([src, len]) } catch { return null }
  if (!built || built.type !== 'op' || built.name !== 'u-') return null
  if (!Array.isArray(built.args) || built.args.length !== 1) return null
  const call = built.args[0]
  if (!call || call.type !== 'call') return null
  if (!Array.isArray(call.args) || call.args.length !== 2) return null
  if (call.args[0] !== src || call.args[1] !== len) return null
  if (!TABLE.functions[call.name]) return null
  if (!FINITE_WINDOW[call.name]) return null
  return { table: call.name, negate: true }
}

/** ⭐⭐ THE AUTHORITATIVE POINTWISE CLASSIFIER (§14) — EXECUTION SEMANTICS.
 *
 *  ⛔ THIS IS NOT THE NAMESPACE HEURISTIC BELOW, and the difference is the
 *  whole of §14. `builtinStateFamily` labels a REFUSAL for the census and may
 *  mislabel without ever changing a number. THIS decides whether code RUNS, so
 *  every step of it comes from an authority that already exists:
 *
 *    · `VALUE_NAMESPACES`  — pine.js's own set of namespaces that carry values
 *    · `PINE_CALL_SHAPES`  — pine.js's own Pine-name -> TABLE-name mapping
 *    · `TABLE.functions`   — the closed table's declaration
 *    · `isPointwise`       — parse.js's own predicate (lookback 0, no forward,
 *                            every argument a series)
 *    · `POINTWISE_FOR_PARITY` — interpret.js's own scalar implementations
 *
 *  Nothing here is a second catalog, and a function only executes if ALL FIVE
 *  agree it is pointwise and implemented.
 *
 *  @returns {{table:string, spec:object}|null}
 */
export const pointwiseTarget = (pineName, shapes = PINE_CALL_SHAPES) => {
  const name = String(pineName || '')
  let bare = name
  const dot = name.indexOf('.')
  if (dot >= 0) {
    const ns = name.slice(0, dot)
    // ⛔ ONLY A DECLARED VALUE NAMESPACE. `str.`, `request.`, `array.`,
    // `line.` and friends are different families entirely and must not be
    // stripped into a table lookup that happens to collide.
    if (!VALUE_NAMESPACES.has(ns)) return null
    bare = name.slice(dot + 1)
  }
  const shape = shapes[bare]
  if (shape) {
    // ⛔ ONLY AN IDENTITY BUILD. A shape whose `build` rearranges, injects or
    // synthesises arguments is not a rename — it is a REWRITE, and applying it
    // by passing the Pine arguments straight through would compute a different
    // function. Fail closed.
    const identity = Array.isArray(shape.build)
      && shape.build.every((b, i) => b && b.pine === i && Object.keys(b).length === 1)
    if (!identity) return null
  }
  const table = shape && shape.table ? shape.table : bare
  const spec = TABLE.functions[table]
  if (!spec || !isPointwise(spec)) return null
  if (typeof POINTWISE_FOR_PARITY[table] !== 'function') return null
  return { table, spec }
}

/**
 * @param {string} source  Pine source
 * @param {object} opts    { bars, inputs, interpretOpts }
 * @returns {{ok:boolean, ir?:object, refusal?:object, diagnostics:object}}
 */
export function buildRuntimeIr(source, opts = {}) {
  const bars = opts.bars || []
  const inputs = opts.inputs || {}
  const diagnostics = { statements: 0, columns: 0, slots: 0, families: {} }

  // ⭐⭐ THE OBJECT PASS OWNS THE DRAWING when the caller supplies its trees.
  //
  // ⛔ WITHOUT THIS FLAG THE SEAM CANNOT EXIST, and the reason is worth stating
  // because the refusal it relaxes is CORRECT. `runtime:object-op` says a
  // graphical-object call "belongs to the object program, not the value
  // runtime", which is true — this lane draws nothing and must never learn to.
  // But a script that draws is a script that CONTAINS those calls, so refusing
  // on sight also refuses to compute the numbers the drawing needs, and the two
  // lanes could never meet.
  //
  // ⭐ Supplying `objectTrees` is the caller SAYING it has already run the
  // object pass and taken responsibility for every `line|label|box|table|
  // linefill` call in the source. On that promise those calls become no-ops
  // here: skipped as statements, `na` as expressions. Nothing is drawn, nothing
  // is silently dropped — the object program holds them.
  //
  // ⛔ AN EMPTY ARRAY STILL MEANS OWNERSHIP. A drawing whose coordinates are all
  // literals references no trees at all, and it needs its calls skipped exactly
  // as much as one that references forty. `Array.isArray([])` is the test, never
  // `.length`.
  const objectPassOwnsDrawing = Array.isArray(opts.objectTrees)

  /** How many drawing-as-value creates this build has lowered. ⛔ THIS LANE'S
   *  OWN ORDINAL — see `runtime/handles.js`: it is NOT the object program's
   *  site id, nothing joins the two, and nothing reads it. It exists so two
   *  creates do not intern to one const. */
  let drawingSites = 0

  const note = (family) => {
    diagnostics.families[family] = (diagnostics.families[family] || 0) + 1
  }

  let lexed
  try { lexed = lexPine(source) } catch (e) { return fail(e, diagnostics) }
  const { tokens, indents, version } = lexed

  let stmts
  try { stmts = blockStatements(tokens, indents, 0) } catch (e) { return fail(e, diagnostics) }

  /** ⛔⛔ EVERY NAME THIS SCRIPT DEFINES AS A FUNCTION OR A PINE 6 `method`, so
   *  the method-form rewrite can YIELD to it.
   *
   *  19 of the 266 committed scripts declare their own methods, and one of them
   *  writes `top.maintainPivot(ph)` where `top` really is a declared array.
   *  Rewriting that to `array.maintainPivot` would refuse while naming a
   *  built-in nobody wrote; a script defining `method get(array<float> this, int i)`
   *  would have its own method silently replaced by ours. `pine.js` records four
   *  previous instances of that second defect and fixes each the same way —
   *  consult what the script SAID before what the table knows.
   *
   *  ⭐ COLLECTED OVER THE WHOLE TREE BEFORE THE WALK, because `fnByName` fills
   *  as the walk goes and a definition may sit below a call inside another
   *  function body. */
  const definedNames = new Set()
  const scanDefs = (list) => {
    for (const s of list || []) {
      const ts = s.header || []
      if (ts.length > 1 && ts[0].kind === 'ident') {
        if (ts[0].value === 'method' && ts[1].kind === 'ident') definedNames.add(String(ts[1].value))
        else if (isPunct(ts[1], '(') && findTop(ts, (x) => isPunct(x, '=>')) > 0) {
          const bare = splitMethodName(String(ts[0].value))
          definedNames.add(bare ? bare.method : String(ts[0].value))
        }
      }
      if (s.sub && s.sub.length) scanDefs(s.sub)
    }
  }
  scanDefs(stmts)

  // ⛔⛔ RULING 3.3 — REFUSE BY NAME, NEVER BLANK.
  // ⭐⭐ SCANNED OVER TOKENS, NOT SOURCE TEXT. `lexPine` has already dropped comments
  // and strings, so a realtime name written in a COMMENT cannot trigger this — the
  // CODE-NEVER-PROSE rule satisfied by construction rather than by a regex that strips.
  // ⭐ `null`/`undefined` is "nobody told me"; `false` is a real answer and folds.
  const told = opts.newestBarIsForming != null
    || (opts.interpretOpts && opts.interpretOpts.newestBarIsForming != null)
  if (!told) {
    const hit = tokens.find((t) => t && t.kind === 'ident'
      && CLOCK_REALTIME.some((c) => t.value === c || t.value === `barstate.${c}`))
    if (hit) {
      note('runtime:realtime-untold')
      return fail(new RuntimeRefusal('runtime:realtime-untold',
        `\`${hit.value}\``, locate(hit)), diagnostics)
    }
  }
  const mut = scanMutability(stmts)
  /** ⭐⭐ EVERY `type Foo` THIS SCRIPT DECLARES, collected before the walk — see
   *  `collectUdtTypes` for why the order matters. `typeName → {name, fields}`. */
  const udtTypes = collectUdtTypes(stmts)

  // The resolver's environment holds ONLY pure bindings. A mutable name never
  // enters it — that is what keeps the two lanes from disagreeing about a name.
  const env = new Map()
  /** name → { call, index, at } for `p = plot(…)`.
   *
   *  ⛔⛔ ITS OWN MAP, NEVER `env`. `env` holds PURE EXPRESSION macros and the
   *  COLUMNAR resolver reads it — dropping a plot id in there made that resolver
   *  dereference `bound.node.type` on an entry that has no node, which surfaced
   *  to the member as *"Cannot read properties of undefined"*: a TypeError
   *  wearing a refusal's clothes, the exact shape this front end has paid for
   *  before. A plot id is a different KIND of binding and gets a different map.
   */
  const plotRefs = new Map()
  /** Every `request.security` in this script: its timeframe and the VALUE
   *  expression, which the lowering turns into its own region of the code. */
  const requests = []
  /** ⛔⛔ INSIDE A REQUEST'S VALUE, NOTHING GOES TO THE COLUMNAR LANE.
   *
   *  A column is computed ONCE, before the run, from THIS chart's bars — so a
   *  column inside a request would silently be the wrong symbol's numbers.
   *  Price names become SERIES reads instead, which the sub-run binds to the
   *  requested symbol's arrays; that is the whole trick, and it means the
   *  expression itself is never rewritten.
   *
   *  ⚠️ A FLAG RATHER THAN A PARAMETER, deliberately: it has to reach EVERY
   *  nested `lowerExpr`, and threading an argument through twenty recursive
   *  call sites is exactly where one would be forgotten. It is saved and
   *  restored around the one place that sets it. */
  let inRequestValue = false
  // ⛔⛔ THE MEMBER'S OWN SETTINGS REACH THE FOLD, and until 2026-09-20 they did
  // NOT: this lane built its resolver with no `inputValues`, so every
  // `input.int`/`input.float` folded to the AUTHOR'S DEFAULT and a member who
  // changed a length in the settings got the script's original number with
  // nothing on screen to say so. Measured — `input.int(5)` with `{len: 7}`
  // plotted 5 — and it is the quiet kind of wrong this engine exists to refuse.
  //
  // ⭐ Setting it also restores the AUTHOR'S BOUNDS, which live on the same
  // path: an out-of-range member value is refused by name rather than used.
  const makeResolver = () => {
    const r = new Resolver(env, TABLE, new Map(), {})
    if (inputs && typeof inputs === 'object') r.inputValues = inputs
    return r
  }

  /** A resolver that does NOT see the member's values.
   *
   *  ⛔⛔ FOR THE FROZEN-DEFAULT FOLDS ONLY — a history OFFSET and a window
   *  LENGTH. Owner decision, 2026-08-11, recorded verbatim in `pine.js`'s
   *  `parseOffsetIndex`: folding an input there "freezes its default into the
   *  saved definition — and that is ALREADY true of every length, so folding
   *  the offset makes the two agree rather than introducing a new surprise."
   *
   *  ⚰️ WIRING THE MEMBER'S VALUES INTO THE ONE RESOLVER BROKE THIS, and
   *  `history.test.js` caught it: `x[n]` with `n = input.int(3)` and the
   *  member on 5 sized the ring at 5. That is the divergence the frozen rule
   *  exists to prevent — a knob meaning one thing in a column and another in
   *  the runtime — and the ring is allocated before bar 0, so a member's
   *  value cannot reach it without changing what a SAVED definition means.
   *  The two folds are genuinely different questions and now have two
   *  resolvers, rather than one that is wrong for one of them. */
  const makeFrozenResolver = () => new Resolver(env, TABLE, new Map(), {})

  // ─── ⭐⭐ THE BIND-TIME FOLD, ON THE SAME ASSEMBLY THE OTHER TWO LANES USE ──
  //
  // ⚰⚰ THIS LANE HAD NO SYMBOL PLUMBING AT ALL, and the cost was measured:
  // `buildRuntimeIr` on `uncharted-volume-v2.pine` stopped at **v2:249**,
  // `if not isRatioSymbol`, where `isRatioSymbol` is v2:224's
  // `str.contains(syminfo.ticker, "/") or str.contains(syminfo.tickerid, "/")`.
  // A `symtext` reaching the evaluator means the BINDING could not settle it
  // (R-K), so the refusal was correct and the wire was missing.
  //
  // ⛔ ONE AUTHORITY, NOT A THIRD READER. `bindConstsFor` is the same function
  // `nativeRegistry.computeFor` calls for a PLOT and `objectColumns` calls for an
  // OBJECT; it moved to `bind.js` so this front end could reach it without
  // importing the whole registry. A constant added to it reaches all three lanes
  // or none — which is the property that was missing when the plot lane's symbol
  // was fixed at R-K and the object lane's was not.
  //
  // ⚠️ AND IT IS NOT GUESSED. With no `symbol` the assembly returns `{}` for the
  // symbol half and every `syminfo.*` stays NotFoldable, refusing BY NAME — R-K's
  // deliberate choice of a loud refusal over a half-resolved string.
  const bindConsts = bindConstsFor({
    tf: opts.tf,
    inputs,
    symbol: opts.symbol,
  })

  /** ⭐⭐ THE BARS THIS BUILD IS FOR — read ONCE, here, from the BUILD's options.
   *
   *  ⛔⛔ IT CANNOT BE READ INSIDE `lowerExpr`, AND THAT IS A MEASURED TRAP, NOT
   *  A STYLE NOTE. `lowerExpr(node, scope, opts)` takes a parameter called
   *  `opts` — its own per-expression flags — which SHADOWS this function's
   *  options object. `basePeriodOf(opts)` written in there silently read
   *  `{multi: true}` or `undefined` and answered the DEFAULT for every build,
   *  so a caller passing `basePeriod: '60'` got `'D'` and nothing said so. It
   *  was caught by a rail that drove two different bases; a rail that only ever
   *  drove the default would have passed. */
  const lanePeriod = basePeriodOf(opts)

  const slots = []
  const columns = []
  const columnByKey = new Map()
  const outputs = []
  // ⭐ THE STATIC HISTORY-DEMAND ANALYSIS, accumulated as the body is lowered:
  // one entry per variable that any `[n]` reads, carrying the deepest offset seen.
  // Nothing allocates a ring for a variable nobody looks back at (§16).
  const history = []
  const historyByVarSlot = new Map()
  // ⭐ 2F-2B — one entry per finite-window CALL SITE in the source.
  const windowsMain = []
  const windows = []
  const carriedMain = []
  /** Two-input carried instances — `ta.valuewhen`. Main program only; see the
   *  refusal in its lowering for why there is no per-call-site block. */
  const carried2Main = []
  const carried = []
  const functions = []
  const fnByName = new Map()
  /** name → the refusal its DEFINITION hit, re-raised at the first call site.
   *  See the deferral in the statement walk for why a definition is not fatal. */
  const deferredFnRefusals = new Map()
  /** `name@line guard` for every definition this lane skipped and nobody called
   *  — reported so an unreachable helper is NAMED rather than invisible. */
  const skippedFunctions = []
  /** ⛔ THE ONE AUTHORITY FOR "is this name a user function", and it has to be
   *  one because a refused definition can leave the name in EITHER place.
   *  `defineFunction` registers into `fnByName` only after its parameter list
   *  reads, so a definition that dies ON the parameters (`f(x = 3) => …`) never
   *  gets there and is known only by its held refusal. Asking `fnByName` alone
   *  sends `f(close)` to the columnar Resolver, which has never heard of `f` and
   *  answers `pine:function` — "there is no such function" about a function the
   *  member can see one line up. */
  const isUserFn = (name) => fnByName.has(name) || deferredFnRefusals.has(name)
  const callSites = []
  const root = new Scope(null)

  /** The function currently being compiled — `null` inside the main program.
   *  ⭐ A slot's OWNER, which is what makes its address frame-relative. */
  let owner = null
  /** While a function body is being compiled, the scope its globals live in — so
   *  a reference to a global mutable variable is refused BY NAME rather than
   *  arriving at the columnar resolver as an undefined name. */
  let guardOuter = null

  const newSlot = (name, persistent, index) => {
    slots.push({
      name,
      kind: persistent ? SLOT.PERSIST : SLOT.LOCAL,
      owner,
      ...(index === undefined ? {} : { index }),
    })
    return slots.length - 1
  }

  /** Frame-relative counts for the owner currently being compiled. */
  const countFor = (who, kind) =>
    slots.filter((s) => s.owner === who && s.kind === kind).length

  /** A PURE parse subtree → a column index. ⭐ The one place the columnar lane
   *  is invoked, and the one place `interpret` runs, so the hybrid seam is a
   *  single function rather than a habit. */
  const columnOf = (node, at) => {
    let canonical
    try {
      canonical = makeResolver().resolve(node)
    } catch (e) {
      // ⛔ A REFUSAL FROM THE VALUE LANE KEEPS ITS OWN NAME. Re-dressing a
      // `pine:builtin` as a runtime gap would send an engineer to the wrong
      // subsystem and lose the real next dependency.
      throw e
    }
    const key = JSON.stringify(canonical)
    if (columnByKey.has(key)) return columnByKey.get(key)
    let value
    try {
      // ⛔ FOLD, THEN INTERPRET — the order the definition lane has used since R-K.
      // The fold returns a NEW tree and mutates nothing, so the parse this lane
      // lowers from stays symbolic and a second binding is free to fold it
      // differently.
      value = interpret(foldBound(canonical, bindConsts), bars, inputs,
        undefined, undefined, opts.interpretOpts)
    } catch (e) { throw e }
    let arr
    if (typeof value === 'number') arr = new Float64Array(bars.length).fill(value)
    else if (value instanceof Float64Array) arr = value
    else arr = Float64Array.from(value)
    if (arr.length !== bars.length) {
      throw new RuntimeRefusal('runtime:statement',
        `a column holds ${arr.length} values for ${bars.length} bars`, at)
    }
    columns.push(arr)
    const i = columns.length - 1
    columnByKey.set(key, i)
    return i
  }

  /** THE ROUTE DECISION. Does this subtree need the runtime?
   *
   *  ⭐⭐ TWO REASONS, NOT ONE. It reads a mutable SLOT — or it CALLS a
   *  user-defined function. The second matters because the columnar Resolver has
   *  no knowledge of this front end's function table: sending it a subtree
   *  containing `f(close)` would produce `pine:function` ("there is no `f`")
   *  about a function the member is looking straight at.
   *
   *  ⚠️ SO EVERY UDF CALL GOES THROUGH THE RUNTIME, pure ones included, and that
   *  is a DEFERRED OPTIMISATION rather than a semantic requirement (§26). A pure
   *  UDF could fold into a graph column, and `effects` below records which ones
   *  qualify — but routing it there needs the graph-vs-runtime differential to
   *  cover the seam, so correctness comes first and the classification is kept
   *  ready rather than acted on. */
  const needsRuntime = (node, scope) => {
    if (!node || typeof node !== 'object') return false
    if (node.type === 'name' && scope.lookup(node.name) !== null) return true
    // Inside a function, a GLOBAL mutable name must also reach the runtime path
    // — only so it can be refused precisely there.
    if (node.type === 'name' && guardOuter && guardOuter.lookup(node.name) !== null) return true
    if (node.type === 'call' && isUserFn(node.name)) return true
    // ⭐⭐ A METHOD FORM READS ITS RECEIVER, AND THE RECEIVER IS A SLOT.
    // `a.get(0)` is `array.get(a, 0)`, so the statement genuinely reads `a` —
    // but the receiver arrives glued into the CALL NAME rather than as a `name`
    // node, so this walk could not see it and routed the whole expression to
    // the columnar lane. ⚰️ That lane then refused `pine:builtin` — *"the engine
    // grammar does not hold `a.get`"* — which is false twice: `a.get` is not a
    // built-in, and `array.get` is a thing THIS lane holds. Measured: the name
    // form compiled and the method form did not, for the same program.
    if (node.type === 'call') {
      const uf = splitMethodName(String(node.name || ''))
      if (uf && scope.lookup(uf.recv) !== null) return true
    }
    // ⭐⭐ A FIELD PATH READS ITS HEAD, AND THE HEAD IS A SLOT. `ob.top`
    // arrives as ONE dotted `name` token, so the plain lookup above cannot see
    // it — the same blind spot the method-form note directly above records, in
    // the other of the two shapes the lexer glues a `.` into. Without this, an
    // expression mentioning only fields routes to the COLUMNAR lane, which has
    // never heard of a user type and answers `pine:builtin` about a namespace
    // the member never wrote.
    // ⛔ `syminfo.tickerid` MUST NOT MATCH. The test is a declared HEAD, not a
    // dot: the first segment has to be something this lane marked with a user
    // type.
    // ⛔⛔ AND IT IS THE HEAD, NOT THE WHOLE PATH. Testing `fieldPathOf` here
    // was tried and is subtly wrong: a MISSPELT field makes the path
    // unresolvable, so the expression routed to the columnar lane, which
    // answered *"this Pine built-in names something the engine grammar does not
    // hold — `p.tpo`"*. That sends the member to look for a built-in namespace
    // called `p`, when the fault is one letter in a field of a type they
    // declared six lines up. Owning the whole head is what lets the refusal say
    // so (`runtime:udt-field`).
    if (node.type === 'name' && String(node.name || '').indexOf('.') > 0
        && udtHeadOf(node, scope)) return true
    // ⛔ A `Foo.new(…)` LOOKS LIKE A NAMESPACED BUILTIN AND IS NOT ONE. Left to
    // the columnar lane it refuses `pine:builtin` — *"the engine grammar does
    // not hold `orderBlock.new`"* — naming a namespace the member declared
    // fourteen lines up.
    if (udtCtorOf(node)) return true
    // ⛔⛔ A POSTFIX MEMBER ON A RECORD, AND *ONLY* ON A RECORD.
    // `array.get(obs, i).top` is a `member` node, and the generic walk below
    // does not carry `recv` — so without this the whole expression reads as
    // pure and the columnar `Resolver` answers `pine:member`, *"a type this
    // engine does not track"*, about a type the member declared.
    // ⛔ ADDING `recv` TO THE GENERIC WALK WAS THE OBVIOUS FIX AND IS THE WRONG
    // ONE: it would route EVERY member whose receiver touches a slot into this
    // lane, changing a long-standing `pine:member` refusal into this file's
    // less specific `runtime:statement` for shapes nothing here can serve. The
    // narrow test moves exactly the shape that now has an answer.
    if (node.type === 'member' && udtTypeOf(node.recv, scope)) return true
    // ⭐⭐ AN INPUT'S LABEL CANNOT DECIDE ITS LANE, and until 2026-09-21 every
    // label did. `group`, `tooltip`, `title`, `inline`, `display` and `confirm`
    // name a control in the settings dialog; none of them can change the number
    // the input yields on any bar. Walking them here meant the ordinary Pine
    // idiom
    //
    //     var string GROUP_FRACT = "Fractals"
    //     n = input.int(10, title = "Fractal Period", minval = 2, group = GROUP_FRACT)
    //
    // read as "this call reads a mutable slot", so the whole call was handed to
    // the runtime lane — which has no `input.*` node and reported
    // `runtime:call-undeclared-builtin-state`, *"a builtin … that the CLOSED
    // TABLE does not declare at all"*. That sentence sends the next engineer to
    // add `input.int` to the closed table, and `input.int` is not a table
    // function in either lane: the SAME script with the group spelled as a
    // literal compiles today. NINE of 266 corpus scripts died there.
    //
    // ⛔ NOTHING IS REWRITTEN. The node keeps every argument it was parsed
    // with, so `boundName`, the title the param manifest reads, and the
    // author's own bounds are all exactly where they were — only the LANE that
    // reads the call changes.
    if (isInputCall(node)) {
      for (const v of inputValueArgs(node)) {
        if (needsRuntime(v, scope)) return true
      }
      return false
    }
    for (const k of ['left', 'right', 'test', 'yes', 'no', 'arg', 'value']) {
      if (needsRuntime(node[k], scope)) return true
    }
    if (Array.isArray(node.args)) {
      for (const a of node.args) {
        if (needsRuntime(a && a.value !== undefined ? a.value : a, scope)) return true
      }
    }
    return false
  }
  const readsSlot = needsRuntime

  /** Does this subtree carry TEXT?
   *
   *  ⭐⭐ THE SECOND HALF OF THE ROUTE DECISION, AND IT EXISTS BECAUSE PURITY IS
   *  NOT THE ONLY THING THAT DECIDES A LANE. `readsSlot` asks *"must the runtime
   *  evaluate this?"*; a pure subtree goes to the columnar lane, which is right
   *  for every number and wrong for every string — that lane refuses text at
   *  `pine:text-value`, so a bare `"ab"` was routed straight into a refusal.
   *  Measured 2026-09-19: `string s = "ab"` with `s` assigned under an `if`
   *  refused with the text sentence, and `s` never reached a slot at all.
   *
   *  ⛔ IT IS A STATIC READ OF THE SHAPE, NOT A TYPE SYSTEM. It knows a literal,
   *  a slot the declaration marked text, a `+` with a text side, a ternary with
   *  a text arm, and an immutable binding whose bound expression is text. A
   *  shape it cannot read answers `false` and keeps today's behaviour, so this
   *  can only ever move text OUT of the columnar lane — never a number into it.
   *  Where the read is wrong, `OP.CONCAT`'s own kind check refuses by name
   *  rather than inventing an answer. */
  const holdsText = (node, scope, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 24) return false
    if (node.type === 'string') return true
    if (node.type === 'name') {
      const slot = scope.lookup(node.name)
      if (slot !== null) return !!(slots[slot] && slots[slot].text)
      const bound = env.get(node.name)
      if (bound) return !!(bound.kind === 'expr' && holdsText(bound.node, scope, depth + 1))
      // ⭐⭐ `timeframe.period` IS TEXT, and this reader is where a BINDING to it
      // learns that. `tf = timeframe.period` then `request.security(sym, tf, x)`
      // is the corpus idiom; without this the bound name reads as numeric, the
      // route sends it to the columnar lane, and a member is told their script
      // *"uses a text feature our chart does not render yet"* about a name this
      // engine answers one lane over.
      // ⛔ A BINDING WINS — the `if (bound)` above returns before this — for the
      // same reason `ownTimeframeOf` consults one first: `period = "60"` is a
      // legal v2/v3 line and means hourly.
      return OWN_TF_NAMES.has(node.name)
    }
    // ⛔ A `str.*` THAT RETURNS A STRING IS TEXT; one that returns a NUMBER is
    // not. `str.length(s)` composes with ordinary arithmetic and must not mark
    // a slot as text — `int n = str.length(s)` is an int, and calling it text
    // would route `n + 1` to `CONCAT` and refuse a correct script.
    if (node.type === 'call' && producesText(node.name)) return true
    if (node.type === 'call' && TEXT_INPUTS.has(node.name)) return true
    // ⭐⭐ AN ELEMENT OF A TEXT ARRAY IS TEXT. Without this, `array.get(syms, r)`
    // — a watchlist row, the single commonest per-row value in the corpus — reads
    // as numeric, and a buffer allocated to hold it throws on the first symbol.
    // ⛔ The ARRAY's element kind is a property of the SLOT, recorded where the
    // collection is declared; there is no other place that knows it.
    if (node.type === 'call' && ARRAY_READS_ELEMENT.has(node.name)) {
      const a0 = (node.args || [])[0]
      const av = a0 && a0.value !== undefined ? a0.value : a0
      if (av && av.type === 'name') {
        const s0 = scope.lookup(av.name)
        if (s0 !== null) return !!(slots[s0] && slots[s0].elemText)
        const b0 = env.get(av.name)
        if (b0 && b0.kind === 'expr') return arrayHoldsText(b0.node, scope, depth + 1)
      }
      // ⭐ THE ARRAY CAN BE AN EXPRESSION, NOT ONLY A NAME. A slot records the
      // element kind for a DECLARED collection, and there is no slot when the
      // array is built inline — `array.get(str.split(sym, ":"), 1)`, which is
      // how a script pulls the ticker out of `NASDAQ:AAPL`, and which is what a
      // helper's body becomes once its frame is substituted in.
      return arrayHoldsText(av, scope, depth + 1)
    }
    if (node.type === 'binary' && node.op === '+') {
      return holdsText(node.left, scope, depth + 1) || holdsText(node.right, scope, depth + 1)
    }
    if (node.type === 'ternary') {
      return holdsText(node.yes, scope, depth + 1) || holdsText(node.no, scope, depth + 1)
    }
    // ⭐⭐ A USER FUNCTION THAT RETURNS TEXT IS TEXT, and this is the corpus's
    // commonest table cell:
    //
    //     formatPercent(value) => na(value) ? "-" : str.tostring(value, "#") + "%"
    //
    // ⛔ WITHOUT IT THE BUFFER IS ALLOCATED NUMERIC AND THROWS ON THE FIRST ROW
    // — "iteration buffer N is numeric and got string" — at RUN time, after the
    // program built clean. Every other spelling of text was already read here,
    // which is why a helper hid: `str.tostring(…)` is a call this knows,
    // `"-"` is a literal, and a call to the member's OWN function was neither.
    //
    // ⛔ THE RESULT EXPRESSION, NOT THE BODY'S STATEMENTS. Only the narrow
    // substitution form carries one; a statement body answers `false` rather
    // than guessing, which costs a named refusal instead of a wrong container.
    if (node.type === 'call' && depth < 8 && inlineBodyByName.has(node.name)) {
      const inl = inlineBodyByName.get(node.name)
      if (inl && inl.result) return holdsText(inl.result, scope, depth + 1)
    }
    return false
  }

  /** Does this array-producing expression hold TEXT elements?
   *
   *  ⛔ NARROW AND MEASURED, not a type system. It answers for the three
   *  spellings the corpus uses to make a string array and says nothing else —
   *  an unknown shape answers `false`, which costs a refusal rather than a
   *  wrong buffer. */
  const arrayHoldsText = (node, scope, depth = 0) => {
    if (!node || node.type !== 'call' || depth > 8) return false
    const n = String(node.name || '')
    // ⭐⭐ `str.split` ALWAYS YIELDS STRINGS — it is how every watchlist in the
    // corpus is built, and `collections.js` files it with the arrays for that
    // reason. Its absence here made `array.get(str.split(s, ":"), 1)` read as
    // numeric, and the per-row buffer behind it threw on the first symbol.
    if (n === 'str.split') return true
    if (n === 'array.new_string') return true
    if (n.startsWith('array.new')) {
      const ta = node.tok && Array.isArray(node.tok.typeArgs) ? node.tok.typeArgs[0] : null
      return ta === 'string'
    }
    const first = (node.args || [])[0]
    const fv = first && first.value !== undefined ? first.value : first
    if (n === 'array.from') return holdsText(fv, scope, depth + 1)
    // `array.copy(a)` / `array.slice(a, …)` keep their source's element kind.
    if (n === 'array.copy' || n === 'array.slice') {
      if (fv && fv.type === 'name') {
        const s0 = scope.lookup(fv.name)
        if (s0 !== null) return !!(slots[s0] && slots[s0].elemText)
      }
      return arrayHoldsText(fv, scope, depth + 1)
    }
    return false
  }

  /** Does this subtree evaluate to a COLOUR?
   *
   *  ⭐ A COLOUR IS A NUMBER AT RUN TIME — a packed `0xTTBBGGRR` integer — so
   *  nothing downstream could tell one from a price without this. The kind is
   *  the whole of the type system for colours, which is why `plot(color.red)`
   *  can still be refused while `bgcolor(color.red)` runs.
   *
   *  ⛔ A SLOT IS MARKED AT ITS BINDING, exactly as a text slot is, so
   *  `c = close > open ? color.green : color.red` followed by `bgcolor(c)`
   *  answers correctly one statement later.
   */
  /** Pine's own `na`, and not a name the script bound to something else.
   *
   *  ⛔ THE SHADOW CHECK IS NOT DEFENSIVE PADDING — it is the same pair of
   *  conditions the lowering uses one screen down before it emits `naValue()`.
   *  Two places deciding what `na` means, by different rules, is exactly
   *  `lesson_a_second_authority_over_one_value`; these agree by construction. */
  const isBuiltinNa = (node, scope) => !!node && node.type === 'name'
    && node.name === 'na' && scope.lookup('na') === null && !env.has('na')

  const holdsColour = (node, scope) => {
    if (!node || typeof node !== 'object') return false
    if (node.type === 'name') {
      if (colourHexByName(node.name) !== null) return true
      const slot = scope.lookup(node.name)
      if (slot !== null) return !!(slots[slot] && slots[slot].colour)
      const bound = env.get(node.name)
      return !!(bound && bound.kind === 'expr' && holdsColour(bound.node, scope))
    }
    // ⭐ A HEX LITERAL IS A COLOUR — `#141414`, which the parser gives its own
    // node type. Missing this made `color ROW_DARK = #141414` read as "not a
    // colour", so `row % 2 == 0 ? ROW_DARK : ROW_LIGHT` was routed to the
    // columnar lane and refused `pine:colour-value` — a correct refusal from a
    // lane that should never have been asked. Every OTHER way of spelling a
    // colour was already here, which is why it survived: `color.new(…)` is a
    // call, `color.red` is a name, and the literal is neither.
    if (node.type === 'colour') return true
    if (node.type === 'call' && producesColour(node.name)) return true
    // ⛔ BOTH ARMS, NOT EITHER. `cond ? color.red : 0` is a colour on one side
    // and a number on the other, which Pine rejects — answering "colour" for it
    // would send a price into a colour slot with no complaint.
    //
    // ⭐⭐ EXCEPT `na`, WHICH IS NOT A NUMBER — it is Pine's untyped null, and it
    // belongs to every type, `color` included. `cond ? colour : na` is the ONLY
    // way to write a `barcolor`/`bgcolor` that depends on the bar, and it is
    // what ALL THREE scripts this guard refuses across `corpus/committed`
    // write — `barcolor(isInsideBar() ? insideBarColor : na)` and two more.
    // Demanding a colour on both arms refused the idiom, not a mistake.
    //
    // ⛔ THE RULE ABOVE IS UNWEAKENED, and the distinction is the whole point:
    // `0` and `close` are NUMBERS, and a number in a colour slot paints a
    // plausible shade computed from the wrong thing. Both stay refused, with a
    // control each. `na` carries no value to be misread.
    //
    // ⭐ IT RECURSES, so `bull ? a : bear ? b : na` — the third corpus script —
    // resolves through the nested arm rather than needing a second shape.
    //
    // ⚰️ AND IT CLOSES A SILENT WRONG NUMBER POINTING THE OTHER WAY. While
    // `holdsColour` answered false for this shape, `plot(cond ? color.red : na)`
    // was not a colour to the `plot` direction either, so it COMPILED and drew
    // a packed colour integer as a price — a line at y = 5,394,687 that a
    // member reads as data. Saying "yes, colour" is what lets `plot` refuse it.
    if (node.type === 'ternary') {
      const y = holdsColour(node.yes, scope)
      const n = holdsColour(node.no, scope)
      if (y && n) return true
      // ⛔ ONE ARM MUST STILL BE A COLOUR. `cond ? na : na` says nothing about
      // the type, and answering "colour" for it would admit an expression on
      // the strength of what it does NOT contain.
      if (y) return isBuiltinNa(node.no, scope)
      if (n) return isBuiltinNa(node.yes, scope)
      return false
    }
    return false
  }

  /** Is a drawing-object constructor or method anywhere in this subtree?
   *
   *  ⭐ ONLY CONSULTED UNDER `objectPassOwnsDrawing`, and it exists for exactly
   *  one shape: `var t = table.new(…)`. The right-hand side reads no slot, so
   *  the route decision would hand it to the columnar lane, which refuses the
   *  whole namespace at `pine:drawing` — a refusal that is correct for that lane
   *  and irrelevant here, because the object program already holds the call.
   *
   *  ⛔ IT ASKS THE WHOLE SUBTREE, NOT THE HEAD. A drawing call can sit nested
   *  under arithmetic or a ternary, and a head-only test would route the
   *  enclosing expression to the lane that cannot read it while reporting
   *  nothing — the column would simply refuse and the script would die naming
   *  the wrong cause. */
  /** ⭐ IT ANSWERS WITH THE CALL'S NAME, NOT A BARE `true`, AND EVERY EXISTING
   *  CALLER IS UNCHANGED — a name is truthy and `null` is falsy, so the four
   *  `if (holdsObjectCall(…))` sites read exactly as they did.
   *
   *  ⛔ THE REASON IS THE METHOD FORM. `b.set_bgcolor(c)` is `box.set_bgcolor(b, c)`,
   *  and to say so this lane has to know which FAMILY `b` was bound from — a
   *  fact this walk already computes and then threw away. Recovering it with a
   *  second walker would be a second authority on what counts as a drawing call
   *  (`lesson_a_second_authority_over_one_value`); returning it is free. */
  /** Is Pine's `ta.valuewhen` anywhere in this subtree?
   *
   *  ⛔⛔ THE ROUTE DECISION RUNS FIRST, AND WITHOUT THIS THE BRANCH THAT
   *  LOWERS `ta.valuewhen` CAN NEVER BE REACHED. A `ta.valuewhen(cond, src, 0)`
   *  over pure inputs reads no mutable slot, so the router hands the whole
   *  subtree to the columnar lane — which refuses `pine:function` with a long,
   *  correct sentence about a BAR WINDOW being a different function. That is
   *  the `size.*` and `order.*` shape twice over: handling the name in the
   *  switch alone reads as a no-op until BOTH places change.
   *
   *  ⛔ IT ASKS THE WHOLE SUBTREE, NOT THE HEAD — `holdsObjectCall`'s rule, for
   *  the same reason: `ta.valuewhen(c, x, 0) + 1` is a pure head over a call
   *  this lane must keep, and a head-only test would route the sum away and
   *  report a refusal about a lane the caller is not using. */
  const holdsPineValueWhen = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 24) return false
    if (node.type === 'call'
      && (node.name === 'ta.valuewhen' || node.name === 'valuewhen')) return true
    // ⛔⛔ IT FOLLOWS A BINDING, AND WITHOUT THAT IT MISSES THE COMMONEST SHAPE.
    // A top-level binding that reads no slot becomes an `env` MACRO, substituted
    // at its use — so `v0 = ta.valuewhen(…)` followed by `plot(v0 - v1)` reaches
    // the router as `v0 - v1`, two bare names with no call in sight. Measured:
    // every single-call shape routed correctly and only the bound-and-combined
    // one refused, which is exactly how a predicate that stops at the syntax
    // reports a property of the SPELLING rather than of the program.
    // ⭐ `holdsColour` resolves through `env` for the same reason, and the depth
    // cap is what keeps a self-referential binding from spinning here.
    if (node.type === 'name') {
      const bound = env.get(node.name)
      return !!(bound && bound.kind === 'expr' && holdsPineValueWhen(bound.node, depth + 1))
    }
    for (const k of ['left', 'right', 'test', 'yes', 'no', 'arg', 'value', 'cond']) {
      if (holdsPineValueWhen(node[k], depth + 1)) return true
    }
    if (Array.isArray(node.args)) {
      for (const a of node.args) {
        if (holdsPineValueWhen(a && a.value !== undefined ? a.value : a, depth + 1)) return true
      }
    }
    return false
  }

  const holdsObjectCall = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 24) return null
    if (node.type === 'call' && OBJECT_NS.test(String(node.name || ''))) return String(node.name)
    for (const k of ['left', 'right', 'test', 'yes', 'no', 'arg', 'value', 'cond']) {
      const hit = holdsObjectCall(node[k], depth + 1)
      if (hit) return hit
    }
    if (Array.isArray(node.args)) {
      for (const a of node.args) {
        const hit = holdsObjectCall(a && a.value !== undefined ? a.value : a, depth + 1)
        if (hit) return hit
      }
    }
    return null
  }

  /** Names this lane saw bound to a drawing call → the FAMILY they hold.
   *
   *  ⛔ A RECORD, NOT A GUARD, and it is noted at EVERY binding path rather than
   *  at the two that skip. A `b = box.new(…)` that is neither `var` nor mutated
   *  never becomes a slot at all — it is absorbed by the `env` macro path — so a
   *  map filled only where a statement is SKIPPED would miss the commonest
   *  spelling and `b.delete()` would refuse for a reason that is not true. */
  const drawingHandles = new Map()
  const noteHandle = (name, value) => {
    const hit = holdsObjectCall(value)
    if (hit) drawingHandles.set(String(name), hit.slice(0, hit.indexOf('.')))
  }

  /**
   * A BARE `<family>.new(…)` → this lane's opaque handle for it, or null.
   *
   * ⛔⛔ ONE AUTHORITY, TWO CALLERS — `nestedCreateHandle` (a create passed to
   * a collection call) and `lowerFieldValue` (a create assigned to a UDT
   * field). Both admit exactly the same shape for exactly the same reason, and
   * `lesson_a_second_authority_over_one_value` is about the third copy nobody
   * updates. See `runtime/handles.js` for why a handle is opaque and why `na`
   * and a number are both the wrong answer.
   *
   * ⛔ THE TEST IS `^([a-z]+)\.new$`, NOT `OBJECT_NS`. `OBJECT_NS` matches the
   * whole `box.` namespace, so it also answers true for `box.set_bgcolor(b, c)`
   * — an UPDATE, which makes no new drawing and has no handle to be.
   */
  const mintHandle = (valueNode) => {
    if (!objectPassOwnsDrawing) return null
    if (!valueNode || valueNode.type !== 'call') return null
    const m = /^([a-z]+)\.new$/.exec(String(valueNode.name || ''))
    if (!m || !OBJECT_NS.test(`${m[1]}.`)) return null
    // ⭐ THE ORDINAL IS THIS LANE'S OWN, and `handles.js` says plainly that it
    // is NOT joined to the object program's site id. It exists so two creates
    // are not `===`; nothing reads it.
    drawingSites += 1
    return drawing(m[1], drawingSites - 1)
  }

  /** Does this subtree evaluate to a COLLECTION?
   *
   *  ⛔ SEPARATE FROM `holdsText` because the two route for the same REASON
   *  (the columnar lane can hold neither) but mean different things to every
   *  consumer: a text slot changes what `+` lowers to, an array slot must never
   *  be handed to arithmetic at all. */
  const holdsArray = (node, scope) => {
    if (!node || typeof node !== 'object') return false
    if (node.type === 'call') {
      if (producesArray(node.name)) return true
      // ⭐ AN UNSERVED COLLECTION CALL COUNTS AS ONE TOO, so the binding gets
      // a slot, the initialiser is LOWERED, and the refusal names the call the
      // member wrote. Left as an `env` macro it is never lowered at all, and
      // the member is told about whichever LATER call happened to read it —
      // measured: `m = matrix.new<float>(2, 2, 0.0)` was reported as
      // `matrix.rows`, one line below the call they would need to remove.
      return ARRAY_NS.test(String(node.name || ''))
        && !Object.prototype.hasOwnProperty.call(ARRAY_FNS, node.name)
    }
    if (node.type === 'name') {
      const slot = scope.lookup(node.name)
      if (slot !== null) return !!(slots[slot] && slots[slot].collection)
      const bound = env.get(node.name)
      return !!(bound && bound.kind === 'expr' && holdsArray(bound.node, scope))
    }
    return false
  }

  // ── ⭐⭐ USER-DEFINED TYPES, RESOLVED ────────────────────────────────────
  //
  // Four questions, and each one is asked in exactly one place below:
  //   • is this expression a `Foo.new(…)`?            `udtCtorOf`
  //   • what TYPE does this expression produce?       `udtTypeOf`
  //   • is `a.b.c` a field path, and through what?    `fieldPathOf`
  //   • what does a field named `f` of type `T` hold? `fieldSpec`

  /** `Foo.new` → the type's declaration, or null. ⛔ ASKED OF THE REGISTRY, so
   *  `line.new` and `array.new` can never be mistaken for one: a script would
   *  have to DECLARE `type line` for the name to resolve here, and if it does,
   *  its own declaration is what Pine means too. */
  const udtCtorOf = (node) => {
    if (!node || node.type !== 'call') return null
    const split = splitMethodName(String(node.name || ''))
    if (!split || split.method !== 'new') return null
    return udtTypes.get(split.recv) || null
  }

  /** One field of one type, by name. */
  const fieldSpec = (typeName, fieldName) => {
    const t = udtTypes.get(typeName)
    if (!t) return null
    return t.fields.find((f) => f.name === fieldName) || null
  }

  /** What USER TYPE does this subtree produce? `null` when it is not a record.
   *
   *  ⛔ IT NEVER GUESSES FROM A FIELD NAME. Two types may both declare `info`,
   *  and answering from the name alone would address the wrong record with no
   *  error anywhere — the defect `ufcs.js`'s header records four instances of.
   *  Every answer here comes from a DECLARATION: the constructor's own type, a
   *  slot marked at its binding, or a field's declared type. */
  const udtTypeOf = (node, scope, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 24) return null
    if (node.type === 'call') {
      const ctor = udtCtorOf(node)
      if (ctor) return ctor.name
      // ⭐⭐ READING AN ELEMENT OUT OF AN `array<Foo>` YIELDS A `Foo`. The
      // roster is `ARRAY_READS_ELEMENT`, the SAME one the text/colour element
      // kinds already ride, so a call added there carries the user type too
      // rather than needing a second list that drifts.
      if (ARRAY_READS_ELEMENT.has(String(node.name || ''))) {
        const first = (node.args || [])[0]
        const fv = first && first.value !== undefined ? first.value : first
        if (fv && fv.type === 'name') {
          const s0 = scope.lookup(fv.name)
          if (s0 !== null) return (slots[s0] && slots[s0].elemUdt) || null
        }
      }
      // ⭐ THE METHOD FORM OF THE SAME READ — `obs.get(i)`, `obs.last()`.
      // `ufcs.js` rewrites it to `array.get(obs, i)` downstream; here the
      // receiver is still glued into the name, so the receiver's own element
      // type is read directly rather than running the rewrite twice.
      {
        const uf = splitMethodName(String(node.name || ''))
        if (uf && ARRAY_READS_ELEMENT.has(`array.${uf.method}`)) {
          const s0 = scope.lookup(uf.recv)
          if (s0 !== null) return (slots[s0] && slots[s0].elemUdt) || null
        }
      }
      return null
    }
    if (node.type === 'name') {
      const slot = scope.lookup(node.name)
      if (slot !== null) return (slots[slot] && slots[slot].udt) || null
      const path = fieldPathOf(node, scope)
      if (path) return path.type
      const bound = env.get(node.name)
      if (bound && bound.kind === 'expr') return udtTypeOf(bound.node, scope, depth + 1)
      return null
    }
    // ⭐ A POSTFIX MEMBER ON A RECORD IS THE FIELD'S DECLARED TYPE — which is
    // what lets `array.get(obs, i).info.top` resolve one step at a time.
    if (node.type === 'member') {
      const recvType = udtTypeOf(node.recv, scope, depth + 1)
      const spec = recvType ? fieldSpec(recvType, node.name) : null
      return spec && udtTypes.has(spec.type) ? spec.type : null
    }
    // ⭐ A TERNARY OVER TWO RECORDS OF ONE TYPE IS THAT TYPE. `cond ? a : b`
    // is how the corpus picks between two order blocks. ⛔ Two DIFFERENT types
    // answer `null` rather than the first one: a union is not a type this lane
    // has, and naming one arm would let a field read resolve against a record
    // the other branch never had.
    if (node.type === 'ternary') {
      const a = udtTypeOf(node.yes, scope, depth + 1)
      const b = udtTypeOf(node.no, scope, depth + 1)
      return a && a === b ? a : null
    }
    return null
  }

  /** The user type the FIRST segment of a dotted name holds, or null.
   *
   *  ⭐ SEPARATE FROM `fieldPathOf` BECAUSE THE TWO ANSWER DIFFERENT QUESTIONS.
   *  "Is this whole path readable?" and "does this lane own this name at all?"
   *  diverge exactly on a misspelt field — and that is the case where owning it
   *  is what lets the refusal name the member's own type. */
  const udtHeadOf = (node, scope) => {
    if (!node || node.type !== 'name' || typeof node.name !== 'string') return null
    const head = node.name.split('.')[0]
    if (head === node.name) return null
    const slot = scope.lookup(head)
    if (slot !== null) return (slots[slot] && slots[slot].udt) || null
    const bound = env.get(head)
    if (bound && bound.kind === 'expr') return udtTypeOf(bound.node, scope)
    return null
  }

  /** `a.b.c` → `{head, steps:['b','c'], type}` when `a` really holds a record
   *  and every step is a declared field; null otherwise.
   *
   *  ⛔⛔ EVERY STEP IS CHECKED AGAINST THE DECLARATION, AND A BAD ONE ANSWERS
   *  `null` RATHER THAN REFUSING HERE. This function is also the TEST other
   *  call sites use ("is this a field path?"), and a test that throws cannot be
   *  asked. The refusal is raised by the one caller that knows a field path was
   *  required — `lowerExpr`'s `name` arm — which is what keeps
   *  `syminfo.tickerid` and a member's own `sd.info.breakTime` from sharing a
   *  sentence.
   *
   *  ⛔ THE HEAD IS THE WHOLE FIRST SEGMENT AND NOTHING LONGER. `ufcs.js` makes
   *  the same ruling for the receiver of a method call, and for the same reason:
   *  `a.b.c` addresses `c` OF `a.b`, and reading `a.b` as the head of `c` would
   *  address the wrong object with no error anywhere. */
  const fieldPathOf = (node, scope) => {
    if (!node || node.type !== 'name' || typeof node.name !== 'string') return null
    const parts = node.name.split('.')
    if (parts.length < 2) return null
    const head = parts[0]
    const slot = scope.lookup(head)
    let type = null
    if (slot !== null) type = (slots[slot] && slots[slot].udt) || null
    else {
      const bound = env.get(head)
      if (bound && bound.kind === 'expr') type = udtTypeOf(bound.node, scope)
    }
    if (!type) return null
    const steps = []
    for (let i = 1; i < parts.length; i += 1) {
      const spec = fieldSpec(type, parts[i])
      if (!spec) return null
      steps.push(parts[i])
      // ⭐ THE NEXT STEP'S TYPE IS THE FIELD'S DECLARED ONE — which is a user
      // type for `ob.info.top` and a Pine word (`float`, `box`) at the leaf.
      // A Pine word is not in the registry, so a further step answers `null`,
      // which is the correct answer for `ob.info.top.nonsense`.
      type = udtTypes.has(spec.type) ? spec.type : null
      if (!type && i < parts.length - 1) return null
    }
    return { head, steps, type, slot }
  }

  /**
   * `Foo.new(a, b, c)` / `Foo.new(y = 3)` → one `EXPR.RECORD`.
   *
   * ⛔⛔ EVERY FIELD IS SUPPLIED, ALWAYS, IN DECLARATION ORDER. Pine lets a
   * construction omit trailing fields and name the rest, and the back end must
   * never see a partial list — `records.js` pairs `fields[i]` with `values[i]`,
   * so a gap would pair every field after it with the WRONG value, and each of
   * those is a plausible number of the right kind. The defaults are resolved
   * HERE, from the declaration, and `ir.js` and `program.js` both re-check the
   * count so a front-end slip is a build error rather than a quiet mis-pairing.
   *
   * ⭐ A FIELD WITH NO DEFAULT IS `na`, which is Pine's own rule and the same
   * answer `var float x = na` already gives in this lane.
   */
  const lowerRecordNew = (ctor, node, scope) => {
    const fields = ctor.fields
    if (!fields.length) {
      // ⛔ A TYPE WHOSE FIELDS THIS LANE COULD NOT READ IS REFUSED, NOT BUILT
      // EMPTY. An empty record would make every later `f.anything` a field the
      // type "does not declare" — a sentence blaming the member's own spelling
      // for a declaration this lane failed to parse.
      note('runtime:udt')
      throw new RuntimeRefusal('runtime:udt',
        `\`${ctor.name}\` — this lane read no fields from its declaration`, locate(node.tok))
    }
    const byName = new Map()
    const positional = []
    for (const a of (node.args || [])) {
      const v = a && a.value !== undefined ? a.value : a
      if (a && a.name) byName.set(a.name, v)
      else positional.push(v)
    }
    if (positional.length > fields.length) {
      throw new RuntimeRefusal('runtime:statement',
        `\`${ctor.name}.new\` takes ${fields.length} field(s), given ${positional.length}`,
        locate(node.tok))
    }
    for (const k of byName.keys()) {
      if (!fields.some((f) => f.name === k)) {
        note('runtime:udt-field')
        throw new RuntimeRefusal('runtime:udt-field',
          `\`${ctor.name}.new(${k} = …)\` — \`${ctor.name}\` declares no field \`${k}\``,
          locate(node.tok))
      }
    }
    const args = fields.map((f, i) => {
      const supplied = byName.has(f.name) ? byName.get(f.name)
        : (i < positional.length ? positional[i] : null)
      if (supplied) return lowerFieldValue(f, supplied, scope, node)
      // ⭐ THE DECLARATION'S OWN DEFAULT, parsed from the tokens the field line
      // carried. It is lowered in the SCOPE OF THE CONSTRUCTION, not of the
      // declaration — Pine evaluates a field default at construction time, and
      // the corpus writes `bool disabled = false` / `string s = na`, which are
      // literals either way.
      if (f.def && f.def.length) {
        return lowerFieldValue(f, parseWholeExpression(f.def), scope, node)
      }
      return naValue()
    })
    return irRecord(ctor.name, fields.map((f) => f.name), args)
  }

  /** One field's value, with the ONE case that is not an ordinary expression.
   *
   *  ⭐⭐ A FIELD MAY HOLD A DRAWING, AND THE OBJECT PASS OWNS IT. `type
   *  orderBlock` / `box orderBox = na` / `ob.orderBox := box.new(…)` is the
   *  corpus's dominant order-block shape, and a `box.new(…)` reaching an
   *  ordinary expression position refuses at `runtime:object-op` — "these
   *  belong to the object program". `handles.js` is the answer: the create is
   *  admitted as an OPAQUE handle, exactly as `array.push(zones, box.new(…))`
   *  already is, so this lane carries the value and the object program keeps
   *  the drawing. ⛔ ONLY UNDER OWNERSHIP — with no object pass there is no
   *  program that took responsibility, and minting a handle would be this lane
   *  claiming to have drawn something. */
  const lowerFieldValue = (spec, valueNode, scope, at) => {
    const hit = objectPassOwnsDrawing ? holdsObjectCall(valueNode) : null
    if (hit) {
      // ⛔ ONE AUTHORITY OVER "IS THIS A BARE CREATE" — `mintHandle`, shared
      // with the collection path. Two copies of the `^([a-z]+)\.new$` test is
      // the drift this file pays for most, and the half that drifted would be
      // whichever one a later family (`polyline`) was added to first.
      const handle = mintHandle(valueNode)
      if (handle) return handle
    }
    if (hit) {
      // ⛔ A CREATE BURIED INSIDE AN EXPRESSION IS REFUSED, NOT UNWRAPPED.
      // `cond ? box.new(…) : na` makes a drawing on SOME bars, and answering
      // one handle for both arms would hand back a drawing the object program
      // did not make on this bar.
      note('runtime:object-op')
      throw new RuntimeRefusal('runtime:object-op',
        `\`${hit}\` inside the value of field \`${spec.name}\``,
        locate((valueNode && valueNode.tok) || (at && at.tok)))
    }
    return lowerExpr(valueNode, scope)
  }

  // ⚰️ `holdsRecord(node, scope)` WAS HERE — the mirror of `holdsArray`, so the
  // binding path could force a record into a slot. It is gone, and the reason is
  // recorded rather than the function: `readsSlot` already answers TRUE for
  // every way a record can be obtained (`udtCtorOf` for a construction, a slot
  // read for everything else), so the clause could never decide anything.
  // Its argument survives at the binding path that used it.

  /** The `<T>` of an `array<T>` / `array.new<T>()`, when `T` is a user type.
   *
   *  ⭐⭐ THIS IS WHAT MAKES `ob = array.get(obs, i)` A RECORD. An array of
   *  order blocks is the corpus's dominant shape — 8 of the 16 real
   *  `runtime:udt` scripts write one — and without the element type the read
   *  comes back as an untyped value, so the very next line (`ob.top`) cannot
   *  find a field. ⛔ It is read off the DECLARATION (`stripTypeArguments` put
   *  it on the token in the lexer), never guessed from what was pushed. */
  const udtElemOf = (node, scope, annot) => {
    if (annot && annot.kind === 'ident' && Array.isArray(annot.typeArgs)
        && udtTypes.has(annot.typeArgs[0])) {
      return annot.typeArgs[0]
    }
    if (node && node.type === 'call') {
      const n = String(node.name || '')
      if (n.startsWith('array.new')) {
        const ta = node.tok && Array.isArray(node.tok.typeArgs) ? node.tok.typeArgs[0] : null
        return ta && udtTypes.has(ta) ? ta : null
      }
      // `array.copy(a)` / `array.slice(a, …)` keep their source's element type,
      // exactly as they keep its text-ness one function up.
      if (n === 'array.copy' || n === 'array.slice') {
        const first = (node.args || [])[0]
        const fv = first && first.value !== undefined ? first.value : first
        if (fv && fv.type === 'name') {
          const s0 = scope.lookup(fv.name)
          if (s0 !== null) return (slots[s0] && slots[s0].elemUdt) || null
        }
      }
    }
    return null
  }

  /**
   * Mark a freshly declared slot with the user type it holds.
   *
   * ⛔⛔ THE WRITTEN ANNOTATION WINS OVER THE INITIALISER, and the case that
   * settles it is the corpus's most common one: `var orderBlockInfo info = na`.
   * The initialiser is `na` and produces no type at all, so an initialiser-only
   * rule would leave the slot untyped — and the `info := orderBlockInfo.new(…)`
   * on the next line is an ASSIGNMENT, which declares nothing. Every later
   * `info.top` would then refuse as an unbound name.
   *
   * ⚠️ AND A DISAGREEMENT KEEPS THE ANNOTATION. Pine rejects `Point p =
   * Other.new(…)` outright; this lane does not type-check, so it records what
   * the member DECLARED rather than what one expression happened to build.
   */
  const markUdtSlot = (slot, value, scope, toks, eq) => {
    const annot = Number.isInteger(eq) && eq >= 2 ? toks[eq - 2] : null
    const declared = annot && annot.kind === 'ident' && udtTypes.has(annot.value)
      ? annot.value : null
    const t = declared || udtTypeOf(value, scope)
    if (t) slots[slot].udt = t
    const elem = udtElemOf(value, scope, annot)
    if (elem) slots[slot].elemUdt = elem
  }

  /** Lower an `array.*` call.
   *
   *  ⭐⭐ ONE ADMISSION, TWO CALLERS, AND THAT IS THE POINT. A collection call
   *  reaches this front end two ways — as a VALUE (`array.size(a)` inside an
   *  expression) and as a STATEMENT (`array.push(a, x)` on a line of its own) —
   *  and the only difference between them is whether a VOID result is allowed.
   *  Two copies of the arity and named-argument checks would drift, and the one
   *  that drifted would be the statement path, which is the one a member's
   *  watchlist parser is made of. */
  const admitArrayCall = (node, scope, asStatement) => {
    const spec = ARRAY_FNS[node.name]
    for (const arg of node.args) {
      if (arg && arg.name) {
        throw new RuntimeRefusal('runtime:statement',
          `a named argument \`${arg.name}\` on \`${node.name}\``, locate(node.tok))
      }
    }
    const given = node.args.map((x) => (x && x.value !== undefined ? x.value : x))
    const lo = spec.minArgs === undefined ? spec.args.length : spec.minArgs
    const hi = spec.maxArgs === undefined ? spec.args.length : spec.maxArgs
    if (given.length < lo || given.length > hi) {
      throw new RuntimeRefusal('runtime:statement',
        `\`${node.name}\` takes ${lo === hi ? lo : `${lo} to ${hi}`} argument`
        + `${hi === 1 ? '' : 's'}, given ${given.length}`, locate(node.tok))
    }
    // ⛔ A VOID CALL IS A STATEMENT AND NOTHING ELSE. Used as a value it would
    // push nothing and leave the stack one short — refused here by name rather
    // than discovered later as an underflow far from the line that caused it.
    if (!asStatement && isVoid(node.name)) {
      throw new RuntimeRefusal('runtime:statement',
        `\`${node.name}\` returns nothing, so it cannot be used as a value`,
        locate(node.tok))
    }
    const typeArg = node.tok && Array.isArray(node.tok.typeArgs) ? node.tok.typeArgs[0] : null
    return arrayCall(
      node.name,
      given.map((x, i) => (nestedCreateHandle(node.name, i, x) || lowerExpr(x, scope))),
      typeArg,
    )
  }

  /**
   * ⭐⭐⭐ A DRAWING USED AS A VALUE — `array.push(zones, box.new(…))`.
   *
   * ⛔⛔ THE VALUE RUNTIME STILL DOES NOT DRAW, AND THIS DOES NOT TEACH IT TO.
   * It builds no coordinates, reads no properties and emits no drawing op: it
   * yields an OPAQUE HANDLE (`runtime/handles.js`) standing for the object the
   * OBJECT PASS made at this site. The object program holds the drawing; this
   * lane holds a value it cannot read.
   *
   * ⭐⭐ AND IT IS ADMITTED IN EXACTLY THE POSITIONS THE OBJECT PASS COLLECTS
   * ONE, which is the whole composition rule. `pineObjects.js::nestedCreate` is
   * reached from `emitCollection` and from nowhere else, at `VALUE_ARG[method]`
   * — so `array.push(coll, line.new(…))` becomes a `create` op plus a
   * `{r:'site', id}` reference over there, and a handle over here. Admitting one
   * anywhere else would have this lane claim a drawing the object pass never
   * collected: two lanes disagreeing about what exists, with no site for the
   * object program to resolve. Everywhere else `runtime:object-op` still stands,
   * and `line.get_y1(l)` in a value position still refuses — READING a drawing
   * is a different capability from HOLDING one, and this lane has neither.
   *
   * ⛔ ONLY `<family>.new`. A method call is not a create: it mutates or reads
   * an object this lane does not hold, and `objectOpDetail` already sends its
   * refusal to the object program, which is where that work belongs.
   *
   * @returns {object|null} the IR handle, or null when this is not that case —
   *          the caller then lowers the argument normally, so a shape this does
   *          not recognise behaves exactly as it did before the rule landed.
   */
  const nestedCreateHandle = (fnName, argIndex, valueNode) => {
    if (!objectPassOwnsDrawing) return null
    if (COLLECTION_VALUE_ARG[fnName] !== argIndex) return null
    return mintHandle(valueNode)
  }

  /** Resolve a TEXT input to the string the script will actually see.
   *
   *  ⭐ THE MEMBER'S VALUE WINS OVER THE AUTHOR'S DEFAULT — the same precedence
   *  `pine.js` applies to numeric inputs, keyed the same way (the name the
   *  input is BOUND to), so a member's saved settings mean the same thing in
   *  both lanes.
   *
   *  ⛔⛔ AND ONLY A VALUE THE AUTHOR'S OWN `options` ADMIT. An out-of-list value
   *  is refused BY NAME, never quietly replaced by the default: replacing it
   *  would compute a different indicator under the member's own setting, with
   *  nothing on screen to say so. This is the string twin of the numeric
   *  minval/maxval refusal that lane already makes, and it is refused for the
   *  same stated reason.
   */
  const admitTextInput = (node, scope) => {
    const at = locate(node.tok)
    const positional = node.args.filter((x) => !x || !x.name)
    // ⭐⭐ `defval` MAY BE NAMED, and this read only positional arguments.
    // `input.string(defval = 'SMA', options = […])` is the ordinary spelling —
    // TradingView's own docs write it that way — and it was refused with
    // *"states no default"* about a line whose default is right there under its
    // own parameter name. The reader is sent to add something already present.
    //
    // ⛔ THE PARAMETER'S NAME IS PINE'S, not a guess: `options` two blocks down
    // has been read by name since this function was written, so the shape was
    // already understood — only the FIRST parameter was assumed positional.
    const named = node.args.find((x) => x && x.name === 'defval')
    const firstPositional = positional.length
      ? (positional[0].value !== undefined ? positional[0].value : positional[0])
      : null
    // ⛔ GIVEN TWICE IS A MISTAKE, NOT A PRECEDENCE QUESTION. Pine rejects a
    // duplicate argument, so picking one silently would serve a default the
    // member did not settle on — and which of the two we picked would be an
    // arbitrary rule nobody wrote down. Refusing says what is actually wrong.
    if (firstPositional && named) {
      throw new RuntimeRefusal('runtime:statement',
        `\`${node.name}\` is given a default twice — once positionally and once as `
        + '`defval`', at)
    }
    const first = firstPositional
      || (named ? (named.value !== undefined ? named.value : named) : null)
    if (!first) {
      throw new RuntimeRefusal('runtime:statement',
        `\`${node.name}\` states no default`, at)
    }
    // ⛔⛔ THE DEFAULT IS AN EXPRESSION, NOT NECESSARILY A LITERAL. The
    // committed acceptance script writes `input.text_area(DEF, …)` with
    // `string DEF = \"\"` one line above — and a version of this that demanded a
    // literal refused that script on line 22 while claiming the front end
    // could not read its default. Lowering the expression and REQUIRING the
    // result to be a compile-time string keeps the honest half of that check
    // (an input default that is only known while the bar runs is not a
    // default) without failing the ordinary case.
    const loweredDefault = lowerExpr(first, scope)
    if (!loweredDefault || loweredDefault.kind !== EXPR.STR) {
      throw new RuntimeRefusal('runtime:statement',
        `\`${node.name}\` needs a text default that is fixed when the script is `
        + 'written, and this one is not', at)
    }
    const fallback = loweredDefault.value

    // `options = [...]` — the author's own list, read as written.
    let options = null
    const optArg = node.args.find((x) => x && x.name === 'options')
    if (optArg) {
      // ⛔ THE SHAPE IS THE PARSER'S, READ RATHER THAN GUESSED. A bracket
      // literal is `{ type: 'collection', elements }` (`pine.js`), and a
      // `collection` with NO `elements` is one the parser skipped over — an
      // author list this front end cannot read is left as "no options" rather
      // than silently treated as an empty one, which would refuse every value.
      const v = optArg.value
      if (v && v.type === 'collection' && Array.isArray(v.elements)) {
        const strs = v.elements.filter((x) => x && x.type === 'string').map((x) => x.value)
        if (strs.length === v.elements.length && strs.length) options = strs
      }
    }

    const boundName = typeof node.boundName === 'string' ? node.boundName : null
    let value = fallback
    if (boundName && inputs && Object.prototype.hasOwnProperty.call(inputs, boundName)) {
      const given = inputs[boundName]
      if (typeof given !== 'string') {
        throw new RuntimeRefusal('runtime:statement',
          `\`${boundName}\` was given a value that is not text`, at)
      }
      if (options && !options.includes(given)) {
        throw new RuntimeRefusal('runtime:statement',
          `\`${boundName}\` was given "${given}", and the script's own author `
          + `offers ${options.map((o) => `"${o}"`).join(', ')}`, at)
      }
      value = given
    }
    return str(value)
  }

  /** Does this subtree's value depend on a TEXT input?
   *
   *  ⛔⛔ IT HAS TO BYPASS THE COLUMNAR LANE OUTRIGHT, NOT WAIT FOR IT TO
   *  REFUSE. That lane FOLDS a text comparison at bind time — `mode == "SMA"`
   *  becomes 1 or 0 — and it folds it from the AUTHOR'S DEFAULT, because a
   *  string is not a value it can carry and a member's choice never reaches it.
   *  So it does not throw, the usual try/catch fallback never runs, and the
   *  member's setting is silently ignored. Measured: `input.string("EMA", …)`
   *  with the member on "SMA" still answered as "EMA".
   *
   *  ⚠️ NARROWER THAN "CONTAINS TEXT", DELIBERATELY. An earlier attempt routed
   *  every text subtree away from that lane and cost a real member script
   *  eleven compiled statements, because a literal-only comparison folds there
   *  perfectly well. Only a dependence on an INPUT — the one thing that lane
   *  cannot see — justifies taking the subtree. */
  /** Does this subtree READ a plot id? — the same shape as `dependsOnTextInput`,
   *  and for the same reason: the columnar lane must not be handed a subtree it
   *  cannot resolve, because its failure there is a crash rather than a refusal. */
  const readsPlotRef = (node) => {
    if (!node || typeof node !== 'object') return false
    if (node.type === 'name' && plotRefs.has(node.name)) return true
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) { if (v.some((x) => readsPlotRef(x && x.value !== undefined ? x.value : x))) return true }
      else if (v && typeof v === 'object' && readsPlotRef(v)) return true
    }
    return false
  }

  const dependsOnTextInput = (node, scope, seen) => {
    if (!node || typeof node !== 'object') return false
    // ⛔ A REQUEST NEVER GOES TO THE COLUMNAR LANE EITHER, and for a stronger
    // reason than text: that lane refuses `request.security` outright — it
    // evaluates ONE symbol on ONE timeframe, which is exactly what a request
    // is not. There is nothing there for it to fall back to.
    if (node.type === 'call') return TEXT_INPUTS.has(node.name) || node.name === 'request.security'
    if (node.type === 'name') {
      if (scope.lookup(node.name) !== null) return false
      const guard = seen || new Set()
      if (guard.has(node.name)) return false
      guard.add(node.name)
      const bound = env.get(node.name)
      return !!(bound && bound.kind === 'expr' && dependsOnTextInput(bound.node, scope, guard))
    }
    for (const k of ['left', 'right', 'test', 'yes', 'no', 'arg', 'of']) {
      if (dependsOnTextInput(node[k], scope, seen)) return true
    }
    return false
  }

  /** Lower a function's RESULT expression.
   *
   *  ⭐ A bracket list in RESULT position is a TUPLE — several values — rather
   *  than the collection the same syntax means anywhere else. Pine tells them
   *  apart by position and so does this. */
  const lowerResult = (node, fnScope) => {
    if (node && node.type === 'collection' && Array.isArray(node.elements)
        && node.elements.length >= 2) {
      return tuple(node.elements.map((x) => lowerExpr(x, fnScope)))
    }
    return lowerExpr(node, fnScope)
  }

  /** Does this subtree read a MUTABLE VARIABLE of the enclosing script?
   *
   *  ⛔⛔ NARROWER THAN `readsSlot`, AND THE DIFFERENCE IS A CAPABILITY. That
   *  one also answers true for any call to a USER FUNCTION, which is right for
   *  the route decision and wrong here: a user function inside a request is the
   *  documented shape — the acceptance script's whole per-symbol read is
   *  `request.security(sym, "1D", calcDaily(lookback))`, and the spec calls for
   *  it to carry its own `var` state per call site per symbol. Using `readsSlot`
   *  refused exactly that, on the one line this capability exists for.
   */
  const readsOuterSlot = (node, scope) => {
    if (!node || typeof node !== 'object') return false
    if (node.type === 'name' && scope.lookup(node.name) !== null) return true
    for (const k of ['left', 'right', 'test', 'yes', 'no', 'arg', 'value', 'of']) {
      if (readsOuterSlot(node[k], scope)) return true
    }
    for (const k of ['args', 'elements']) {
      if (Array.isArray(node[k])) {
        for (const a of node[k]) {
          if (readsOuterSlot(a && a.value !== undefined ? a.value : a, scope)) return true
        }
      }
    }
    return false
  }

  /** Lower a `request.security(symbol, timeframe, value, …)`.
   *
   *  ⭐⭐ THE VALUE IS LOWERED HERE BUT EXECUTED ELSEWHERE — over the requested
   *  symbol's bars, from its own entry point in the same code array. That is
   *  what makes `close` inside it mean the REQUESTED symbol's close, with no
   *  rewriting of the expression at all: only the series it reads are swapped.
   *
   *  ⛔ THE SYMBOL IS AN ORDINARY EXPRESSION and usually only known while the
   *  bar runs — the acceptance script reads its symbols out of a pasted
   *  watchlist. The TIMEFRAME is not: it selects which bars must be fetched
   *  before the run, so it has to be fixed when the script is written.
   */
  /** Names currently being inlined — a recursion guard, since an inlined body
   *  can reach another call to the same function. */
  /** Pine's TRUE RANGE, parsed from source so the expression has ONE spelling.
   *  ⭐ Built here rather than assembled from IR constructors: written as IR
   *  it is twelve nested calls nobody can read, and a reader cannot check it
   *  against Pine's definition at a glance. Parsed fresh per call — lowering
   *  may stamp nodes, and a shared AST would carry one call's marks to the
   *  next. */
  const trueRangeAst = () => {
    const src = ['//@version=6', 'x = math.max(high - low, math.max('
      + 'math.abs(high - nz(close[1], close)), math.abs(low - nz(close[1], close))))', ''].join('\n')
    const { tokens } = lexPine(src)
    const eq = tokens.findIndex((t) => isPunct(t, '='))
    return parseWholeExpression(tokens.slice(eq + 1))
  }
  const inliningNow = new Set()
  /** Statements hoisted OUT of the expression being lowered, to run before it
   *  on the same bar. ⭐ Non-null only inside a request's value — the one
   *  region that has somewhere to put them. */
  let hoistSink = null
  /** ⭐⭐⭐ THE SAME MECHANISM, AT THE ROOT STATEMENT LIST — the sink a history
   *  offset, a finite window or a `ta.change` over an EXPRESSION writes its
   *  committed series into. Non-null ONLY while lowering a statement of the
   *  root list, and that bound is a correctness argument rather than caution:
   *
   *  ⛔⛔ A DECLARE HOISTED OUT OF AN `if` BODY WOULD RUN ON EVERY BAR while the
   *  window inside the body runs only on the bars the branch takes. Those are
   *  two different series, and TradingView's answer for a conditionally-called
   *  `ta.*` is NOT vendor-pinned here — `carriedState.test.js` pins the opposite
   *  rule for recurrences (they step only when called), so guessing would put a
   *  plausible number where a capture belongs. A nested list therefore lowers
   *  with NO sink and the refusal keeps its name.
   *
   *  ⛔ IT IS SEPARATE FROM `hoistSink` BECAUSE THE TWO ADMIT DIFFERENT NODES.
   *  A request's region hoists ANY unresolved source, because inside a request
   *  there is nowhere for the member to put the binding themselves. Here there
   *  is: a name that does not resolve is a DIFFERENT gap
   *  (`runtime:function-global-state`) with its own measurement, and hoisting it
   *  would lift a refusal nobody asked to lift — the exact failure recorded for
   *  the wider deferred-function inlining a few lines below. */
  let stmtHoistSink = null
  /** name → a function body kept as an AST, so a call site can lower it in the
   *  CALLER's context when the shared frame will not do. */
  const inlineBodyByName = new Map()

  /** Lower a user function AT THE CALL SITE, substituting its arguments.
   *
   *  ⭐ SUBSTITUTION, NOT A FRAME. Each parameter and each body binding becomes
   *  an `env` macro, which is the same mechanism a top-level `x = expr` already
   *  uses here — so the body is lowered in the CALLER's context and sees exactly
   *  what a reader of that line would expect.
   *
   *  ⭐⭐ AND THAT IS WHAT MAKES A PARAMETER FOLDABLE. `calcDaily(lookback)` with
   *  `ta.sma(volume[1], N)` refused because `N` is a frame slot and a window
   *  needs its length before bar 0. Substituted, `N` IS `lookback` — an input,
   *  which folds — and the window sizes. Measured: the same expression written
   *  with the input directly has always compiled. */
  const lowerInlineCall = (name, inl, node, scope, opts) => {
    const at = locate(node.tok)
    if (inliningNow.has(name)) {
      note('runtime:recursion')
      throw new RuntimeRefusal('runtime:recursion', `\`${name}\``, at)
    }
    const args = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
    if (args.length !== inl.params.length) {
      throw new RuntimeRefusal('runtime:statement',
        `\`${name}\` takes ${inl.params.length} argument`
        + `${inl.params.length === 1 ? '' : 's'}, given ${args.length}`, at)
    }
    for (const a of node.args) {
      if (a && a.name) {
        throw new RuntimeRefusal('runtime:statement',
          `a named argument \`${a.name}\` on the user function \`${name}\``, at)
      }
    }
    const saved = new Map(env)
    inliningNow.add(name)
    try {
      inl.params.forEach((p, i) => env.set(p, { kind: 'expr', node: args[i], at }))
      // ⭐⭐ THE STATEMENT FORM — a body the substitution reader will not take.
      //
      // A `var` is frame state and an `if` is control flow; neither can become
      // an `env` macro without changing what the script computes. But a
      // request's region is a STATEMENT SEQUENCE with its own entry point and
      // its own bar loop, so the body's lines are lowered straight into it, by
      // the same `lowerStmts` the top level uses. Nothing here re-implements a
      // declaration, an assignment or a branch.
      //
      // ⭐ AND THE `var` LANDS IN THE RIGHT LIFETIME BY CONSTRUCTION.
      // `runRequest` builds a FRESH `execute` per requested symbol, and
      // `execute` allocates the persistent block per run — so each symbol's
      // opening-range high starts uninitialised and accumulates over ITS bars.
      // Sharing one block across symbols is the wrong-symbol defect this whole
      // path exists to avoid, and it is avoided by the region, not by a guard.
      //
      // ⛔ A CHILD SCOPE, NOT THE CALLER'S. Two call sites of one helper each
      // lower their own copy and must not collide on a name; declaring into the
      // caller's scope would make the second call rebind the first's slot.
      if (!inl.lines && inl.body) {
        if (!hoistSink) {
          throw new RuntimeRefusal('runtime:statement',
            `\`${name}\` has a body this reader can only lower inside a request's `
            + 'own region, and this call is not in one', at)
        }
        // ⛔⛔ ATOMIC, AND THAT IS NOT TIDINESS. Both call sites of this
        // function CATCH and fall through to an older refusal, so a throw from
        // halfway down a body would leave the statements lowered so far sitting
        // in the request's region — attached to a value that was never built.
        // The region would then run them on every bar, for a call that refused.
        // Everything lands in a local sink and is spliced in only on success.
        //
        // ⛔ AND NESTED HOISTS MUST LAND THERE TOO: `lowerExpr` hoists a
        // window's source into `hoistSink` itself, so the sink is SWAPPED for
        // the duration rather than merely written past.
        const bodyScope = new Scope(scope)
        const localSink = []
        const outerSink = hoistSink
        hoistSink = localSink
        let value
        try {
          for (const s of lowerStmts(inl.body.slice(0, -1), bodyScope)) localSink.push(s)
          const last = inl.body[inl.body.length - 1]
          const lt = last.header || []
          // ⛔ A FINAL LINE THAT BINDS IS STILL A STATEMENT, and its value is
          // the result (Pine §16) — lowered as a statement, then READ, rather
          // than evaluated twice. Twice would run any effect in it twice.
          const eq = (last.sub && last.sub.length) ? -1 : findTop(lt, (x) => isPunct(x, '='))
          const bound = eq > 0 && !isPunct(lt[0], '[') && !lt.some((x) => isPunct(x, ':='))
            ? boundName(lt, eq) : null
          if (bound) {
            for (const s of lowerStmts([last], bodyScope)) localSink.push(s)
            const slot = bodyScope.lookup(bound.value)
            if (slot === null) {
              throw new RuntimeRefusal('runtime:statement',
                `\`${name}\` ends on a binding this reader lowered but cannot read back`, at)
            }
            value = read(slot)
          } else if (last.sub && last.sub.length) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${name}\` ends on a block rather than a value`, at)
          } else {
            value = lowerExpr(parseWholeExpression(lt), bodyScope, opts)
          }
        } finally {
          hoistSink = outerSink
        }
        for (const s of localSink) hoistSink.push(s)
        return value
      }
      // ⛔ IN ORDER: a later binding may read an earlier one, exactly as the
      // author wrote them.
      for (const ln of inl.lines) env.set(ln.name, { kind: 'expr', node: ln.node, at })
      // ⭐ A `[a, b, …]` RESULT IS A TUPLE, and `lowerExpr` has no case for a
      // collection — that conversion lives in `lowerResult`, the FUNCTION-result
      // path this inlining replaces. Mirrored here rather than routed through
      // it, because `lowerResult` lowers against a frame scope and the whole
      // point of inlining is to lower against the caller's.
      const res = inl.result
      if (res && res.type === 'collection' && Array.isArray(res.elements)
          && res.elements.length >= 2 && opts && opts.multi) {
        return tuple(res.elements.map((x) => lowerExpr(x, scope)))
      }
      return lowerExpr(res, scope, opts)
    } finally {
      inliningNow.delete(name)
      env.clear()
      for (const [k, v] of saved) env.set(k, v)
    }
  }

  const admitRequest = (node, scope, callerOpts) => {
    const at = locate(node.tok)
    const positional = node.args.filter((x) => !x || !x.name)
    if (positional.length < 3) {
      throw new RuntimeRefusal('runtime:statement',
        '`request.security` takes a symbol, a timeframe and a value', at)
    }
    const argOf = (x) => (x && x.value !== undefined ? x.value : x)

    // ⛔⛔ CHECKED BEFORE ANYTHING IS LOWERED, and the ORDER is the point. The
    // symbol argument has its own seam (a symbol-settled value refuses when the
    // binding did not supply one), and lowering it first buried this more
    // fundamental problem under that one: a member whose request reads their
    // own `var` was told about symbol plumbing instead.
    //
    // A request's expression runs in ANOTHER symbol's context, where a `var`
    // belonging to this chart's run has no meaning — carrying its value across
    // would answer with one symbol's state under another symbol's heading.
    if (readsOuterSlot(argOf(positional[2]), scope)) {
      note('runtime:request-with-state')
      throw new RuntimeRefusal('runtime:request-with-state', '`request.security`', at)
    }

    // ⛔⛔ `lookahead` IS REFUSED BY NAME, AND NOT BECAUSE IT IS HARD. Vendor
    // packet M1 measured the HISTORICAL half of this alignment on a real chart;
    // the realtime half needs an open market and is still owed. Serving
    // lookahead on a guess would put a number on screen that nobody could have
    // traded on — the most valuable-LOOKING wrong answer available.
    for (const a2 of node.args) {
      if (a2 && a2.name === 'lookahead') {
        throw new RuntimeRefusal('runtime:request',
          '`lookahead` — the realtime half of this alignment is not measured yet, '
          + 'and a guess here reads as a number that could have been traded on', at)
      }
    }

    const tfNode = argOf(positional[1])
    const tfIr = lowerExpr(tfNode, scope)
    if (!tfIr || tfIr.kind !== EXPR.STR) {
      throw new RuntimeRefusal('runtime:request',
        'the timeframe of a request has to be fixed when the script is written — '
        + 'it decides which bars must be fetched before the run', at)
    }

    const symbolIr = lowerExpr(argOf(positional[0]), scope)

    // ⛔ THE VALUE IS LOWERED IN A SCOPE OF ITS OWN. It runs in another symbol's
    // context, so a mutable value from THIS script has no meaning inside it.
    const valueNode = argOf(positional[2])
    const inner = new Scope(null)
    const wasInRequest = inRequestValue
    inRequestValue = true
    // ⭐ A REQUEST'S VALUE IS THE ONE EXPRESSION WITH SOMEWHERE TO HOIST TO:
    // its region is a statement sequence with its own entry point.
    const prevSink = hoistSink
    hoistSink = []
    let valueIr
    try {
      // ⭐⭐ THE DESTRUCTURING FLAG REACHES THE VALUE, and without it a request
      // could only return a tuple written INLINE.
      //
      // ⚰️ `[rv, cg, o, l, pc] = request.security(sym, "1D", calcDaily(lb))` is
      // the acceptance dashboard's own line, and the corpus idiom: a helper
      // computes several daily metrics and the request carries them across
      // together. Lowered without `multi`, the UDF call refused with "`calcDaily`
      // returns 5 values, so it can only be unpacked by a `[a, b] = …` line" —
      // about a line that IS one. The tuple machinery was already here; only the
      // permission to use it was missing.
      const valueOpts = callerOpts && callerOpts.multi ? { multi: true } : undefined
      valueIr = valueNode && valueNode.type === 'collection'
        && Array.isArray(valueNode.elements) && valueNode.elements.length >= 2
        ? tuple(valueNode.elements.map((x) => lowerExpr(x, inner)))
        : lowerExpr(valueNode, inner, valueOpts)
    } finally { inRequestValue = wasInRequest }
    const hoisted = hoistSink
    hoistSink = prevSink

    // ⛔ A COLUMN INSIDE A REQUEST IS REFUSED BY NAME. A column is computed once,
    // from THIS chart's bars, before the run starts — inside a request it would
    // silently be the wrong symbol's numbers. Serving it needs the columnar lane
    // run per requested symbol, which is a capability rather than a patch.
    const carriesColumn = (e, seen) => {
      if (!e || typeof e !== 'object') return false
      // ⛔ A GENERIC WALK, NOT A LIST OF FIELDS. A hand-listed set of child keys
      // fails OPEN on the shape nobody remembered — and failing open here means
      // serving one symbol's numbers under another symbol's heading, which is
      // the exact defect this guard exists to make impossible.
      const guard = seen || new Set()
      if (guard.has(e)) return false
      guard.add(e)
      if (e.kind === EXPR.COLUMN) return true
      // ⛔⛔ THROUGH A USER FUNCTION TOO. A UDF's body was lowered against THIS
      // chart's bars, so its columns hold this symbol's numbers. Called inside a
      // request it would compute the wrong symbol's values and label them with
      // the right symbol's name. Serving it needs the columnar lane run per
      // requested symbol; until then it refuses, by name.
      if (e.kind === EXPR.CALL && functions[e.fn] && carriesColumn(functions[e.fn], guard)) return true
      for (const v of Object.values(e)) {
        if (v && typeof v === 'object' && carriesColumn(v, guard)) return true
      }
      return false
    }
    if (carriesColumn(valueIr)) {
      throw new RuntimeRefusal('runtime:request',
        'this request computes a value that needs the columnar lane, and that lane '
        + 'runs once over the bars of THIS chart — serving it per requested symbol '
        + 'is the next step, not something to approximate', at)
    }

    const results = valueIr && valueIr.kind === EXPR.TUPLE ? valueIr.elements.length : 1
    const site = requests.length
    requests.push({ timeframe: tfIr.value, value: valueIr, results, statements: hoisted })
    return requestCall(site, symbolIr, results)
  }

  /** A comparison whose OPERANDS are text.
   *
   *  ⛔ SEPARATE FROM `holdsText` BECAUSE THE VALUE IS A BOOLEAN, NOT TEXT.
   *  Folding this into `holdsText` would be the shorter edit and would then mark
   *  `bool b = (s == "a")`'s slot as text, which is a lie the `+` router would
   *  later act on. What this decides is only the LANE: `"a" == "b"` reads no
   *  slot, so purity alone sends it to the columnar resolver, which refuses text
   *  — measured on `(close > open ? "a" : "b") == "a"`, an ordinary dashboard
   *  shape that refused while the same comparison against a mutable variable ran.
   *
   *  ⚠️ ONLY `==` AND `!=`. Pine has no ordering over strings, and `"a" > "b"`
   *  must keep refusing rather than acquire a JS answer nobody asked for. */
  const textComparison = (node, scope) => (
    !!node && node.type === 'binary' && (node.op === '==' || node.op === '!=')
    && (holdsText(node.left, scope) || holdsText(node.right, scope)))

  /** Does this subtree contain text ANYWHERE the columnar lane would choke on?
   *
   *  ⭐⭐ THE ROUTE DECISION IS MADE AT THE TOP OF A SUBTREE, so asking only
   *  about the top node is not enough: `plot((close > open ? "up" : "dn") ==
   *  "up" ? 1 : 0)` is a ternary whose arms are 1 and 0, and the text is two
   *  levels down. Measured — it refused at `pine:text-value` while the same
   *  comparison against a mutable variable ran.
   *
   *  ⛔⛔ IT DOES NOT DESCEND INTO A CALL, AND THAT LIMIT IS LOAD-BEARING —
   *  measured, after a first comment here named the wrong reason. It is NOT
   *  about `str.length("ab")`: that resolves in the columnar lane without
   *  raising, so this predicate is never consulted for it. The case that needs
   *  the limit is `ta.sma("ab", 5)`, where the columnar lane DOES raise
   *  `pine:text-value` — and if this answered true, the subtree would fall
   *  through to a runtime that has no better answer for it and would report a
   *  worse-named refusal. Text inside a call is the columnar lane's business
   *  until the plan that gives this lane `str.*` says otherwise. */
  const touchesText = (node, scope) => {
    if (!node || typeof node !== 'object') return false
    if (holdsText(node, scope)) return true
    // ⭐ A COLLECTION ROUTES FOR THE SAME REASON TEXT DOES — the columnar lane
    // holds neither, and refuses one at `pine:collection`.
    if (holdsArray(node, scope)) return true
    // ⛔ ANY COLLECTION CALL, SERVED OR NOT. A served one must reach this
    // lane to run; an UNSERVED one must reach it to be refused BY NAME.
    // Left to the columnar lane, `matrix.new<float>(2, 2, 0.0)` came back as
    // the generic "an array, a matrix or a map is outside the expression
    // grammar … `this name` is read as an array here" — true, and useless to
    // a member trying to find which call to remove. `callFamily` names it.
    if (node.type === 'call' && ARRAY_NS.test(String(node.name || ''))) return true
    // ⚰️ A SERVED-CALL CLAUSE STOOD HERE AND WAS REDUNDANT — deleting it left
    // every test green, which a mutation proof caught. `holdsText`, which this
    // function's first line already asks, answers true for a call that PRODUCES
    // text; and every CONSUMER (`length`, `contains`, `startswith`, `endswith`)
    // is in `pine.js::PINE_TEXT_PREDICATE`, so the columnar lane resolves those
    // itself and never reaches this fallback at all. Two guards over one value
    // is the shape this repo records as "a guard repeated is a guard unproved":
    // neither could be shown to matter while the other stood.
    if (node.type === 'binary') return touchesText(node.left, scope) || touchesText(node.right, scope)
    if (node.type === 'unary') return touchesText(node.arg, scope)
    if (node.type === 'ternary') {
      return touchesText(node.test, scope)
        || touchesText(node.yes, scope) || touchesText(node.no, scope)
    }
    return false
  }

  /** ⭐⭐ THE THREE TIERS OF PINE HISTORY OFFSET, MEASURED RATHER THAN ASSUMED.
   *
   *  The 2F-2 census read every `mutable[…]` site in all five corpora and the
   *  offsets fall into exactly three kinds:
   *
   *    LITERAL          `x[1]`, `x[2]` — 30 of the 35 scripts, none deeper than 2.
   *    INPUT-DERIVED    `currentState[fwdBars]` — a knob, so it is a constant the
   *                     moment inputs are bound, which is BEFORE this runs. Folded
   *                     here by the same resolve-and-evaluate the column seam
   *                     uses, so the two lanes cannot disagree about what the
   *                     member's setting is.
   *    RUNTIME-DERIVED  `cg[i + 1]` inside a loop — genuinely unknown until the
   *                     bar runs.
   *
   *  ⛔ THE THIRD REFUSES, AND THAT IS NOT TIMIDITY. The ring is bounded before
   *  the first bar, so an offset that reaches past it would answer `na` where
   *  Pine answers a number — a wrong value wearing a warm-up's clothes. Every one
   *  of those sites is inside a `for` body, so the family is gated behind loops
   *  anyway; refusing it by name keeps that visible instead of shipping a silent
   *  hole under the loop wave.
   *
   *  ⚠️ FOLDING AN INPUT FREEZES ITS DEFAULT into the offset, exactly as
   *  `pine.js`'s own `parseOffsetIndex` already does for the pure lane (owner
   *  decision, 2026-08-11). Doing the same here makes the two lanes agree; doing
   *  something else would make a knob mean one thing in a column and another in
   *  the runtime. */
  const foldOffset = (n, at) => {
    if (Number.isInteger(n) && n >= 0) return n
    // `pine.js` hands a non-literal index over as `{expr, tok}` rather than
    // refusing at the parser, precisely so a consumer can decide.
    const e = n && typeof n === 'object' ? n.expr : null
    if (!e) {
      throw new RuntimeRefusal('runtime:statement',
        'a bar offset counts backwards in whole bars', at)
    }
    return foldConstNode(e, at)
  }

  /** ⭐ Fold ONE parsed expression to a compile-time whole number, or refuse.
   *
   *  Shared by history offsets (`x[n]`) and finite-window lengths
   *  (`sma(x, n)`) — the same question, so the same answer and the same refusal.
   *  Splitting them would let a knob mean one thing in an offset and another in a
   *  length, which is precisely the divergence the frozen-default rule exists to
   *  prevent. */
  const foldConstNode = (e, at, what = null) => {
    // ⭐⭐ THE CONSTANT IS READ OFF THE CANONICAL TREE, NOT OFF AN EVALUATION.
    //
    // ⚰️ The first draft interpreted the expression and asked whether the result
    // was a scalar. Two things were wrong with that, and the second is the
    // dangerous one. `interpret` broadcasts a constant to a Float64Array, so the
    // check never fired and every input-derived offset refused — visibly wrong,
    // caught by a test. But had it been "written" to accept a flat array, it
    // would have folded any series that HAPPENS to be constant over the bars in
    // front of it — and on a synthetic fixture almost everything is
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). A canonical
    // `num` node is a compile-time constant BY CONSTRUCTION; no data can fake it.
    let canonical
    try {
      // ⛔ THE FROZEN RESOLVER — see `makeFrozenResolver`. An offset and a
      // length are sized before bar 0 and are baked into a saved definition,
      // so they fold the AUTHOR'S default even though every ordinary value
      // follows the member's setting.
      canonical = makeFrozenResolver().resolve(e)
    } catch (err) {
      // ⛔ A REFUSAL FROM THE VALUE LANE KEEPS ITS OWN NAME — `columnOf`'s rule,
      // and for the same reason: re-dressing a `pine:undefined` as a dynamic
      // offset would send an engineer to build ring machinery for a typo.
      throw err
    }
    if (!canonical || canonical.type !== 'num'
      || !Number.isInteger(canonical.value) || canonical.value < 0) {
      note('runtime:history-dynamic-offset')
      // ⛔ ONE GUARD NAME, TWO NOUNS. The guard stays shared — splitting it is
      // what would let a knob mean one thing in an offset and another in a
      // length — but a refusal that calls a WINDOW LENGTH "a history offset"
      // sends the reader to the ring when the work is the fold, which is the
      // misfiled-refusal defect this front end has already paid for once.
      throw new RuntimeRefusal('runtime:history-dynamic-offset', what, at)
    }
    return canonical.value
  }

  /** Allocate — or deepen — the ring for one variable.
   *
   *  ⭐ DEPTH IS THE MAXIMUM OFFSET ANY SITE ASKS FOR, not a fixed reserve (§16).
   *  A script reading `x[1]` gets one cell. Reserving 5,000 bars per mutable slot
   *  "because history" is what makes a whole-market scan infeasible, and the
   *  census says the real answer is almost always 1. */
  const historySlotFor = (varSlot, back, at) => {
    let h = historyByVarSlot.get(varSlot)
    if (h === undefined) {
      h = history.length
      // ⛔ IT NAMES THE SLOT AND NOTHING ELSE ABOUT IT. Where that slot LIVES —
      // its frame-relative index and its lifetime — is `normaliseSlots`'s answer
      // to give, and `makeIrProgram` derives it there. Copying it here would put
      // a second authority on the one fact the commit phase reads every bar
      // (`lesson_a_second_authority_over_one_value`: derive, never restate).
      history.push({ name: slots[varSlot].name, varSlot, depth: back })
      historyByVarSlot.set(varSlot, h)
    } else if (back > history[h].depth) {
      history[h].depth = back
    }
    if (history.length > MAX_HISTORY_SLOTS) {
      throw new RuntimeRefusal('runtime:statement',
        `this script keeps history for more than ${MAX_HISTORY_SLOTS} values`, at)
    }
    return h
  }

  /** ⭐⭐⭐ THE SAME ALLOCATION, ONE FRAME DOWN — and the index it returns is
   *  FRAME-RELATIVE.
   *
   *  A function's history-bearing locals are numbered within the FUNCTION, not
   *  globally, because the same compiled body runs at every call site. The
   *  runtime adds the site's `historyBase` (allocated after the walk, exactly as
   *  `persistBase` already is), so `f(1)` and `f(10)` get separate rings for the
   *  same source variable — which is the 2E rule extended from live persistent
   *  state to committed history.
   *
   *  ⛔ KEYED BY THE **DECLARATION**, never by the name. Two `x`es in sibling
   *  blocks of one function are two slots, and giving them one ring would let a
   *  branch that never ran answer for one that did. */
  const fnHistorySlotFor = (fnIndex, varSlot, back, at) => {
    const fn = functions[fnIndex]
    if (!fn.historyLocals) { fn.historyLocals = []; fn.historyByVarSlot = new Map() }
    let h = fn.historyByVarSlot.get(varSlot)
    if (h === undefined) {
      h = fn.historyLocals.length
      fn.historyLocals.push({ name: slots[varSlot].name, varSlot, depth: back })
      fn.historyByVarSlot.set(varSlot, h)
    } else if (back > fn.historyLocals[h].depth) {
      fn.historyLocals[h].depth = back
    }
    if (fn.historyLocals.length > MAX_HISTORY_SLOTS) {
      throw new RuntimeRefusal('runtime:statement',
        `\`${fn.name}\` keeps history for more than ${MAX_HISTORY_SLOTS} values`, at)
    }
    return h
  }


  /** ⭐⭐ THE AUTHORITATIVE FINITE-WINDOW CLASSIFIER (2F-2B).
   *
   *  Same five-authority discipline as `pointwiseTarget`, with `FINITE_WINDOW`
   *  standing where `POINTWISE_FOR_PARITY` stands: a call executes here only if
   *  `VALUE_NAMESPACES`, an IDENTITY `PINE_CALL_SHAPES` build, `TABLE.functions`
   *  and `interpret.js`'s own finite-window table all agree.
   *
   *  ⛔⛔ MEMBERSHIP IS `interpret.js`'S, NOT THIS FILE'S. `ema` and `rma` take a
   *  series and a length and are NOT members, because their implementations carry
   *  the previous OUTPUT; `valuewhen`/`barssince` search backwards for a
   *  condition; `cum` accumulates without bound. Deciding membership here — by
   *  name, by arity, or by "it has a length argument" — is exactly how `ema`
   *  would end up computed as a moving average of the last n bars: a plausible
   *  line, wrong on every bar, with nothing red.
   *
   *  @returns {{table:string, negate:boolean}|null}
   */
  const windowTarget = (pineName) => {
    const name = String(pineName || '')
    // ⭐⭐ THE NAMESPACED REWRITE IS ASKED FIRST, AND IT IS pine.js's ANSWER,
    // NOT A COPY OF IT. `ta.highestbars` is NOT `highestbars`: Pine returns a
    // NON-POSITIVE offset and this engine's table entry returns the POSITIVE
    // distance, so `pine.js` translates the Pine spelling as `-highestbars(...)`.
    // Reading through the namespace strip to the bare table entry loses that
    // negation and answers with the RIGHT MAGNITUDE AND THE WRONG SIGN — a
    // defect no `toBeCloseTo` on a magnitude would ever catch, and one the
    // columnar lane does not have.
    //
    // ⛔ SO IT IS DERIVED BY RUNNING THE REWRITE, never by naming the two
    // members here. `namespacedWindowShape` hands `PINE_NAMESPACED_TREE`'s own
    // builder two probe nodes and reads the tree back; a rewrite that stops
    // being a bare negation — or that starts touching its arguments — fails the
    // structural match and REFUSES rather than quietly changing meaning.
    const ns = namespacedWindowShape(name)
    if (ns !== undefined) return ns
    let bare = name
    const dot = name.indexOf('.')
    if (dot >= 0) {
      if (!VALUE_NAMESPACES.has(name.slice(0, dot))) return null
      bare = name.slice(dot + 1)
    }
    const shape = PINE_CALL_SHAPES[bare]
    if (shape) {
      const identity = Array.isArray(shape.build)
        && shape.build.every((b, i) => b && b.pine === i && Object.keys(b).length === 1)
      if (!identity) return null
    }
    const table = shape && shape.table ? shape.table : bare
    if (!TABLE.functions[table]) return null
    if (!FINITE_WINDOW[table]) return null
    return { table, negate: false }
  }

  /** ⭐ WHICH builtin-with-state family a call belongs to.
   *
   *  ⚠️ THE NAMESPACE STRIP IS A HEURISTIC AND IT ONLY AFFECTS A LABEL. Pine
   *  spells the same table entry as `ema`, `ta.ema` and (in v2) `ema` again; the
   *  authoritative mapping lives inside `pine.js`'s resolver and is not exported.
   *  Stripping a known prefix and asking the closed table is close enough for a
   *  DIAGNOSTIC — a mislabel here misfiles a refusal in the completion matrix, it
   *  never changes a number — and saying so is cheaper than pretending the
   *  mapping is authoritative. */
  const builtinStateFamily = (rawName) => {
    const name = String(rawName || '')
    // ⭐ AN INPUT ANSWERS FOR ITSELF, and it is read BEFORE the namespace strip
    // for the same reason `str.` is: the namespace settles the question, and
    // stripping first would hand `input.int` to the closed table as `int` — a
    // CONVERSION, which is a third wrong answer rather than the second.
    if (isInputName(name)) return 'runtime:input-state'
    if (/^request\./.test(name)) return 'runtime:request-with-state'
    // ⚰️⚰️ A PRESENTATION CALL BOUND TO A NAME IS PRESENTATION, NOT AN UNKNOWN
    // BUILTIN — and 2F-2's census is what caught this. `upPlot = plot(trend == 1 ? up : na, …)`
    // is the standard SuperTrend/Chandelier idiom: Pine's `plot()` RETURNS a plot
    // id so a later `fill(upPlot, dnPlot, …)` can name it. The statement path
    // recognises `plot(…)` as a statement; bound to a name it arrives here as an
    // expression instead, and the fresh `undeclared-builtin` bucket swallowed it —
    // filing TWO scripts under "this builtin does not exist in the closed table"
    // and pointing the next engineer at the table when the real work is the
    // presentation program. The sets below are the same ones the statement path
    // uses, read rather than restated.
    if (OUTPUT_CALLS.has(name) || PRESENTATION_CALLS.has(name)) return 'runtime:presentation'
    if (DIRECTIVE_CALLS.has(name)) return 'runtime:directive'
    // ⭐ A NAMESPACE THAT ANSWERS THE QUESTION BY ITSELF. `str.` is text whatever
    // the bare name turns out to be, so it is read BEFORE the strip rather than
    // after — stripping first is what let `str.upper` be filed as windowed.
    if (/^str\./.test(name)) return 'runtime:call-text-state'
    const bare = name.replace(/^(ta|math|str|array|matrix|map)\./, '')
    // ⛔⛔ THE PINE SPELLING IS NOT ALWAYS THE TABLE'S SPELLING, and asking the
    // table with the bare Pine name misfiles EIGHT of them. `PINE_CALL_SHAPES`
    // maps `crossover`→`crossOver`, `log`→`ln`, `wpr`→`williams_r` and the four
    // DMI legs; without this hop `ta.crossover(x, 105)` over runtime state came
    // back `call-undeclared-builtin-state` — which reads as "the closed table
    // does not have this builtin" and sends the next engineer to ADD ONE THAT
    // ALREADY EXISTS. The two classifiers above already make this hop; this
    // diagnostic did not, so the completion matrix counted the difference.
    const shape = PINE_CALL_SHAPES[bare]
    const table = shape && shape.table ? shape.table : bare
    const spec = TABLE.functions[table]
    if (spec && isPointwise(spec)) return 'runtime:call-pointwise-state'
    // `na`/`nz` are Pine forms rather than table entries, and both are pointwise
    // by construction — they read one value and answer about that value.
    if (table === 'na' || table === 'nz') return 'runtime:call-pointwise-state'
    if (CONVERSION_NAMES.has(table)) return 'runtime:call-conversion-state'
    // ⛔⛔ AND THE RESIDUAL IS NOT AUTOMATICALLY "WINDOWED". Only a name the
    // closed table actually declares can be said to need the series bridge; a
    // name it does not declare is blocked on the builtin existing, and calling
    // that "windowed" inflates the series row with work that belongs elsewhere.
    if (!spec) return 'runtime:call-undeclared-builtin-state'
    return 'runtime:call-windowed-state'
  }

  /** The family a call belongs to, so a refusal names the right matrix row. */
  const callFamily = (name) => {
    const n = String(name || '')
    if (OBJECT_NS.test(n)) return 'runtime:object-op'
    if (ARRAY_NS.test(n)) return 'runtime:array'
    return null
  }

  /** ⭐⭐⭐ GIVE AN EXPRESSION ITS OWN COMMITTED SERIES.
   *
   *  A history offset, a finite window and `ta.change` all ask the same thing of
   *  the same machinery: a slot whose value this bar can be read again next bar.
   *  Only a declared variable had one, so `(x + 1)[1]`, `ta.sma(x + 1, 5)` and
   *  `ta.change(x * 2)` each refused `runtime:history-expression` with a message
   *  telling the member to write the binding themselves. This performs that
   *  rewrite instead of demanding it: the expression is lowered ONCE into a
   *  synthetic slot declared immediately before the statement that needs it.
   *
   *  Returns `null` when the caller must keep refusing, and the three reasons
   *  are each load-bearing:
   *
   *  ⛔ NO SINK — a nested statement list (an `if` body, a `for` body, a
   *     function body). See `stmtHoistSink`.
   *  ⛔ INSIDE A FRAME (`owner !== null`) — a function's history is allocated
   *     per call site off `historyBase`, and a slot declared into the caller's
   *     root list would be shared by every site. The frame case is real work
   *     with its own measurement, not a special case of this one.
   *  ⚰️ A THIRD GUARD — `srcNode.type === 'name'` — WAS WRITTEN HERE AND
   *  DELETED, because a mutation proved it DEAD. It was meant to stop an
   *  unresolvable name being hoisted instead of refusing
   *  `runtime:function-global-state`; measured with BOTH it and the frame guard
   *  removed, that refusal still fires, from `lowerExpr` below — which owns the
   *  name and answers with the better guard name. Every call site checks the
   *  shape before calling anyway. A second copy of a guard another function
   *  already enforces cannot be mutation-proved and reads as protection
   *  (`lesson_a_guard_repeated_is_a_guard_unproved`), so it is gone and the
   *  refusal it protected has its own case in `historyExpression.test.js`.
   *
   *  ⛔⛔ THE IR IS BUILT BEFORE THE SLOT IS DECLARED, and that order is not
   *  tidiness: `lowerExpr` can refuse, and a slot declared first would be left
   *  bound in the member's scope with nothing ever assigning it — a name that
   *  resolves to a value that never exists. Nothing is registered unless the
   *  whole hoist succeeds.
   *
   *  ⭐ A NESTED HOIST LANDS FIRST BY CONSTRUCTION. `lowerExpr` below may hoist
   *  its own source into the same sink; it pushes before this line does, so the
   *  inner binding precedes the outer one, which is the order they must run in.
   */
  const hoistCommittedSeries = (srcNode, scope, label) => {
    if (!stmtHoistSink) return null
    if (owner !== null) return null
    if (!srcNode || typeof srcNode !== 'object') return null
    // ⭐ A NAME NO PINE IDENTIFIER CAN COLLIDE WITH — it carries spaces, exactly
    // as the request region's own hoisted sources do.
    const tmp = `${label} src ${stmtHoistSink.length}`
    const value = lowerExpr(srcNode, scope)
    const slot = scope.declare(tmp, newSlot(tmp, false))
    stmtHoistSink.push(declare(slot, value))
    return { slot, label: tmp }
  }
  /**
   * The detail a family refusal carries — and for `runtime:object-op`, WHO WAS
   * ASKED matters more than which call it was.
   *
   * ⛔⛔ MEASURED 2026-09-21, AND IT CHANGES WHAT THE NUMBER MEANS. The corpus
   * census reports TWELVE scripts whose first blocker is `runtime:object-op`,
   * and ELEVEN move off it the moment the caller declares ownership — FOUR of
   * them compiling end to end. So the twelve are a property of the HARNESS, a
   * two-lane pipeline asked with one lane, and not of the corpus.
   * `buildObjectLane` declares ownership on every call; a bare `buildRuntimeIr`
   * does not.
   *
   * ⛔ THE OLD SENTENCE WAS TRUE AND SENT THE READER THE WRONG WAY. *"These
   * belong to the object program, not the value runtime"* is a fact about the
   * LANE, and read as a work queue it says "teach the value runtime to draw" —
   * the one thing this lane must never learn. The missing half is a fact about
   * the CALL, and it is one argument away.
   *
   * ⭐ AND IT IS ADDED ONLY WHERE IT IS TRUE. Under ownership a drawing
   * STATEMENT is skipped, so anything still refusing is a drawing used as a
   * VALUE — the real gap, for which there is no honest number. Pointing that
   * one at the ownership seam would send its reader where the fix is not.
   */
  const objectOpDetail = (name) => (objectPassOwnsDrawing
    ? `\`${name}\``
    : `\`${name}\` — and nobody told this build who owns the drawing. Pass `
      + '`objectTrees` (as `buildObjectLane` does) and every '
      + 'line/label/box/table/linefill STATEMENT is skipped here instead')

  /** One place that decides how a family refusal reads, so the three sites that
   *  raise one cannot drift. */
  const familyDetail = (family, name) => (
    family === 'runtime:object-op' ? objectOpDetail(name) : `\`${name}\``)

  // ⭐ `opts.multi` IS SET BY THE DESTRUCTURING AND BY NOTHING ELSE. It marks
  // the ONE position where an expression may leave several values on the
  // stack, and it deliberately does NOT propagate into sub-expressions —
  // `plot(f() + 1)` is not a destructuring however deep `f()` sits.
  const lowerExpr = (node, scope, opts) => {
    if (!node || typeof node !== 'object') {
      throw new RuntimeRefusal('runtime:statement', 'an expression this front end cannot read')
    }
    // ⭐ THE ROUTE DECISION, ASKED ONCE PER SUBTREE. A pure subtree becomes one
    // column no matter how large it is, which is what keeps a stateful program
    // paying runtime cost only for the parts that are actually stateful.
    // ⛔ TEXT IS EXCLUDED FROM THE COLUMN ROUTE. The columnar lane cannot hold a
    // string — it refuses one at `pine:text-value` — so a pure text subtree is
    // lowered here as a runtime const instead. See `holdsText`.
    // ⛔ A TEXT-INPUT DEPENDENCE NEVER GOES TO THE COLUMNAR LANE — see
    // `dependsOnTextInput`. That lane would fold it from the author's
    // default and never raise, so waiting for a refusal would wait forever.
    // ⛔⛔ A DRAWING CALL USED AS A VALUE IS NOT A COLUMN, AND THIS CLAUSE IS
    // LIVE AGAIN — it was removed once as dead and it has a case now.
    //
    // ⚰️ The removal was right at the time: `var t = table.new(…)` never reaches
    // this route decision, because both declaration branches skip a handle
    // binding before lowering its initialiser, so the clause could not fire and
    // read as a live guard (`lesson_a_guard_repeated_is_a_guard_unproved`). What
    // changed is that `array.new_label()` now BUILDS, so the corpus's own
    // `array.push(labels, label.new(…))` reaches here as an ARGUMENT — a
    // position no declaration branch covers.
    //
    // ⛔ WITHOUT IT THE COLUMNAR LANE ANSWERS, AND IT ANSWERS ABOUT ITSELF:
    // `pine:drawing`, "that lane refuses the whole namespace". True, and about
    // a lane this caller is not using — the same misreport `holdsArray` fixes
    // for an unserved collection call. The call is still REFUSED either way;
    // what this decides is whether the member is told `runtime:object-op` and
    // sent to the object program, or `pine:drawing` and sent nowhere.
    // ⛔ AN OBJECT ENUM IS NOT A COLUMN EITHER. `size.tiny` reads no slot, so
    // the route sent it to the columnar lane — which refuses the whole family
    // at `pine:builtin`, "names something the engine grammar does not hold",
    // about a vocabulary `objectEnumValue` holds. A column is a number per
    // bar; an enum is a fixed string the drawing layer reads.
    if (!inRequestValue && !readsSlot(node, scope) && !dependsOnTextInput(node, scope)
        && !readsPlotRef(node) && !holdsColour(node, scope) && !holdsObjectCall(node)
        && !(node.type === 'name' && objectEnumValue(node.name) !== undefined)
        // ⭐ AND A SORT DIRECTION IS A STRING, NOT A COLUMN — same reason as the
        // drawing enums one line up. Handling `order.*` in the name branch is
        // not enough on its own: the ROUTE decision runs FIRST, so without this
        // the name is handed to the columnar lane and refused `pine:builtin`
        // before the branch that knows it can ever be reached. That is exactly
        // how the `size.*` fix read as a no-op until BOTH places changed.
        && !(node.type === 'name' && ORDER_ENUM[node.name] !== undefined)
        // ⭐⭐ AND PINE'S `ta.valuewhen` IS THIS LANE'S, NOT THE COLUMNAR ONE'S.
        // The columnar lane has a function of the same name that counts BARS
        // where Pine counts OCCURRENCES, and it refuses the Pine spelling with
        // a correct, detailed sentence — which is the right answer for a
        // SCREENER formula and the wrong one here, where the occurrence
        // semantics are implemented. Without this clause that refusal arrives
        // before the branch that serves it, exactly as with `size.*`.
        && !holdsPineValueWhen(node)) {
      // ⚰️ A `timeframe.period` CLAUSE STOOD IN THIS CONDITION AND COULD NOT BE
      // PROVED. It looked necessary — the comment above says in as many words
      // that *"the ROUTE decision runs FIRST"*, and handling the name in the
      // switch alone really did read as a no-op. What closed the gap was
      // teaching `holdsText` the name, which makes `touchesText` true, which
      // makes the CATCH below fall through for the bare name as well as for a
      // binding to it. With that in place a mutation deleting this clause left
      // the suite green, while deleting the `holdsText` arm turned it red —
      // `lesson_a_guard_repeated_is_a_guard_unproved`, so one mechanism stands.
      // ⭐⭐⭐ THE COLUMNAR LANE'S OWN VERDICT DECIDES, NOT A SECOND GUESS ABOUT
      // WHAT IT CAN HOLD. A static "does this contain text?" predicate reads as
      // the obvious routing rule and is wrong in the expensive direction:
      // measured on the member fixture, `rangeType == 'ATR'` — an input string
      // against a literal — is FOLDED to a constant by that lane and never
      // reaches a series, so a predicate that steals every text subtree took
      // eleven statements of `f_getDailyData` AWAY from a script that compiled
      // them. Asking the lane, and taking over only where it says `text`, can
      // by construction never remove a script that works today.
      //
      // ⛔ `columnOf` pushes its column as its LAST act, so a throw leaves no
      // half-registered column behind and this catch cannot corrupt the pool.
      try {
        return column(columnOf(node, locate(node.tok)))
      } catch (e) {
        // ⛔ ONLY over a subtree that really does carry text, and only for the
        // two verdicts that mean "this lane has no text for you":
        //
        //   `pine:text-value` — it met a string and refuses strings outright.
        //   `pine:builtin`    — it does not hold this NAME. For a `str.*` this
        //                       lane now implements, that is a statement about
        //                       the columnar table, not about the script.
        //
        // ⚰️ The second was missing and produced an arbitrary split: measured,
        // `str.upper(s)` over a mutable `s` ran while the PURE `str.upper("aapl")`
        // — identical semantics, no slot — was refused *"the engine grammar does
        // not hold `str.upper`"*, one line after this lane had just implemented
        // it. That is precisely the refusal-false-about-its-neighbour defect.
        //
        // ⛔ Every OTHER refusal is that lane's verdict and keeps its own name —
        // re-dressing one as a runtime gap sends the next engineer to the wrong
        // subsystem. And a `pine:builtin` about some unrelated unknown name
        // still refuses here, by that name, because the runtime does not hold it
        // either.
        const laneHasNoText = e && (e.guard === 'pine:text-value'
          || e.guard === 'pine:collection' || e.guard === 'pine:builtin'
          || e.guard === 'pine:input-kind')
        if (!(laneHasNoText && touchesText(node, scope))) throw e
      }
    }

    switch (node.type) {
      case 'number': return num(node.value)
      case 'string': return str(node.value)
      // ⭐ `#141414` — packed the SAME way a named colour is two hundred lines
      // down (`colourHexByName` → `hexToPacked(hex, 0)`), so a literal and
      // `color.red` reach the drawing layer as the same kind of value.
      case 'colour': return num(hexToPacked(node.value, 0))
      case 'name': {
        if (inRequestValue && PRICE.has(node.name)) return series(node.name)
        // ⭐⭐ AN ET CLOCK FIELD INSIDE A REQUEST. Outside one the columnar lane
        // owns these and answers them as columns; inside one that lane is barred
        // — it runs over THIS chart's bars — so the name reached
        // `runtime:unbound`, "a name nothing in this script binds", about a
        // column the engine has held all along. Same shape as `na` and the
        // object enums: a vocabulary we own, refused as unknown.
        //
        // ⛔ A BINDING STILL WINS. A member may name a variable `hour`, and
        // replacing it with the clock would silently change what their script
        // computes — so this fires only where nothing else binds the name.
        if (inRequestValue && CLOCK_FIELDS.includes(node.name)
            && scope.lookup(node.name) === null && !env.has(node.name)) {
          return clock(node.name)
        }
        // ⭐ `order.ascending` / `order.descending` — the sort direction, which
        // reaches `array.sort_indices` as a plain string. It is NOT a drawing
        // enum, so it deliberately does not live in `pine.js`'s object-enum
        // table: that table is the vocabulary for how a thing is PAINTED, and
        // putting a sort direction in it would make the next reader of either
        // one wrong about what it holds.
        if (ORDER_ENUM[node.name] !== undefined
            && scope.lookup(node.name) === null && !env.has(node.name)) {
          return str(ORDER_ENUM[node.name])
        }
        // ⭐⭐ A FIELD PATH THROUGH A USER-DEFINED TYPE — `ob.top`,
        // `sd.info.breakTime`. It arrives as ONE dotted `name` node because the
        // LEXER glues a `.` between two idents into a single token, which is
        // also why `ufcs.js` can split a method call's receiver off the front.
        //
        // ⛔ TESTED BEFORE THE PLAIN SLOT LOOKUP, because the whole dotted
        // string is never a slot name and the lookup would answer `null` for a
        // path whose head this lane holds.
        if (node.name.indexOf('.') > 0) {
          const path = fieldPathOf(node, scope)
          if (path) return path.steps.reduce((acc, f) => irField(acc, f), lowerExpr({ type: 'name', name: path.head, tok: node.tok }, scope))
          // ⛔⛔ A HEAD THIS LANE KNOWS IS A RECORD, WITH A FIELD IT DOES NOT,
          // IS REFUSED BY NAME AND NOT LEFT TO FALL THROUGH. Falling through
          // reaches `runtime:unbound` — *"this Pine name was never given a
          // value"* — naming the WHOLE dotted string, which sends the reader
          // hunting for a variable called `ob.tpo` that nobody ever wrote. The
          // real fault is one misspelt field on a type declared upstairs.
          const headType = udtHeadOf(node, scope)
          if (headType) {
            note('runtime:udt-field')
            throw new RuntimeRefusal('runtime:udt-field',
              `\`${node.name}\` — \`${headType}\` declares no such field`, locate(node.tok))
          }
        }

        // ⛔ UDT DOTTED-PATH FIRST, timeframe.period STRING SECOND.
        // `fieldPathOf` returns null for any head that is not a declared UDT slot,
        // so `timeframe.period` cannot false-positive as a field path. Order chosen
        // so a UDT-field misspelling refuses BY NAME with its own guard rather than
        // being silently treated as a builtin.
        // ⭐⭐ `timeframe.period` IS A STRING CONSTANT IN THIS LANE TOO, and it
        // has to be lowered HERE rather than left to the columnar resolver.
        // `admitRequest` demands `EXPR.STR` for a request's timeframe — *"it
        // decides which bars must be fetched before the run"* — and text never
        // reaches the columnar lane at all, so a name that resolves perfectly
        // well as bind-time text over there arrives here as nothing.
        //
        // ⚰️ MEASURED: with the columnar half alone, four corpus scripts writing
        // `request.security(<sym>, timeframe.period, close)` moved from a FALSE
        // refusal (*"the grammar does not hold `timeframe.period`"*) to a
        // MISLEADING one (*"this script uses a text feature our chart does not
        // render yet"*) — about a request whose real problem is its symbol.
        // Serving the name in one lane and not the other is what produced that.
        //
        // ⛔ SAME VALUE, ONE READER (`basePeriodOf`), and the SAME roster
        // (`OWN_TF_NAMES`) the columnar half asks — otherwise `tf == 'D'` and
        // `request.security(sym, tf, x)` could disagree inside one script.
        // ⛔ AND A BINDING STILL WINS, exactly as it does for the clock fields
        // above and in `ownTimeframeOf`: a script may write `period = "60"`.
        if (OWN_TF_NAMES.has(node.name)
            && scope.lookup(node.name) === null && !env.has(node.name)) {
          return str(lanePeriod)
        }
        const slot = scope.lookup(node.name)
        if (slot !== null) return read(slot)
        // ⭐ AN IMMUTABLE TEXT BINDING IS EXPANDED INLINE. A non-mutated name
        // binds in `env` as an expression for the COLUMNAR resolver, which is
        // right for a number and impossible for a string — so a text one is
        // substituted here, exactly as the columnar lane would have substituted
        // it, and lowered into the runtime instead.
        // ⭐⭐ AN IMMUTABLE BINDING IS EXPANDED INLINE, WHATEVER ITS KIND. A name
        // the script never assigns binds in `env` as an expression for the
        // COLUMNAR resolver, which substitutes it at each use. Once a subtree
        // has been routed to THIS lane — because it touches text, a collection
        // or a text input — every name inside it has to resolve HERE too, and
        // that lane is no longer the one doing the substitution.
        //
        // ⚰️ THIS WAS LIMITED TO TEXT BINDINGS and the acceptance script showed
        // why that was wrong: `int cap = showTable ? … : 0` is an ordinary
        // numeric macro, and `math.min(avail, cap)` reaches this lane because
        // `avail` is derived from an ARRAY. `cap` then resolved to nothing and
        // the script was told it binds a name it binds one line above.
        {
          // ⭐⭐ A COLOUR NAME IS A CONSTANT, resolved through `pine.js`'s own
          // vendor-pinned table. `color.red` is `#FF5252` because a real
          // TradingView observation said so — a second table here would be a
          // second chance to carry the wrong red, and every rail that touched a
          // colour would assert OUR constant and agree with it.
          const hex = colourHexByName(node.name)
          if (hex !== null && scope.lookup(node.name) === null && !env.has(node.name)) {
            return num(hexToPacked(hex, 0))
          }
        }
        {
          // ⭐ A PLOT ID IS NOT A NUMBER, and saying so is the whole point of
          // binding it. Without this the read reached `runtime:unbound` —
          // *"this Pine name was never given a value"* — about a name the script
          // plainly gives a value to one line above, sending the reader hunting
          // for a typo that is not there.
          const pref = plotRefs.get(node.name)
          if (pref) {
            note('runtime:plot-id')
            throw new RuntimeRefusal('runtime:plot-id',
              `\`${node.name}\` is the id of ${pref.call}()`, locate(node.tok))
          }
          // ⭐⭐ `na` IS A LITERAL, NOT A NAME NOTHING BINDS. `x > 0 ? y : na`
          // is how a member leaves a plot blank, and it reached
          // `runtime:unbound` — "a name nothing in this script binds" — about
          // Pine's own absent value.
          // ⚠️ It only ever surfaced INSIDE a request, because everywhere else
          // the surrounding expression is pure and the columnar lane answers
          // it. A request bars that lane, which is what exposed the gap.
          if (node.name === 'na' && scope.lookup('na') === null && !env.has('na')) {
            return naValue()
          }
          // ⭐⭐ AN OBJECT ENUM IS A STRING CONSTANT — `size.tiny`,
          // `position.top_right`, `text.align_left`, `line.style_dashed`.
          //
          // ⚠️ A TOP-LEVEL BINDING OF ONE NEVER REACHES HERE: it is not mutable
          // and reads no slot, so it takes the `env` macro path and is never
          // lowered at all. Inside a FUNCTION BODY it IS lowered, and
          // `getTextSize(s) => s == "tiny" ? size.tiny : size.small` is how a
          // dashboard picks its text size — so the whole family read as
          // `pine:builtin`, "names something the engine grammar does not hold",
          // about a vocabulary `objectEnumValue` has held all along.
          //
          // ⛔ ONE AUTHORITY: the table is `pine.js`'s, read rather than copied.
          // A second list here would drift from the one the object pass uses to
          // decide what a cell's `text_size` means.
          {
            const enumValue = objectEnumValue(node.name)
            if (enumValue !== undefined && scope.lookup(node.name) === null
                && !env.has(node.name)) {
              return str(enumValue)
            }
          }
          const bound = env.get(node.name)
          if (bound && bound.kind === 'expr') return lowerExpr(bound.node, scope)
          // ⭐ A PLOT ID IS NOT A NUMBER, and saying so is the whole point of
          // binding it. Falling through from here reached `runtime:unbound` —
          // *"this Pine name was never given a value"* — about a name the script
          // plainly gives a value to one line above, which sends the reader
          // hunting for a typo that is not there.
        }
        if (guardOuter && guardOuter.lookup(node.name) !== null) {
          note('runtime:function-global-state')
          throw new RuntimeRefusal('runtime:function-global-state', `\`${node.name}\``, locate(node.tok))
        }
        throw new RuntimeRefusal('runtime:unbound', `\`${node.name}\``, locate(node.tok))
      }
      case 'binary': {
        // ⭐⭐ `%` IS `mod`, AND ROUTING IT HERE IS WHAT MAKES THE TWO LANES
        // AGREE. `pine.js` already resolves `%` to `cCall('mod', …)`, so the
        // columnar lane has answered it all along — measured: `plot(close % 2)`
        // compiles, while the same `%` beside a MUTABLE value refused. One
        // operator, served or refused depending on where its operand came from,
        // is worse than either answer on its own.
        //
        // ⛔ NO SECOND IMPLEMENTATION. This emits the SAME `POINTWISE.mod` the
        // columnar lane calls — `x - y * trunc(x / y)`, `na` on a zero divisor
        // or a non-finite quotient — rather than JavaScript's `%`, which agrees
        // on the easy cases and disagrees exactly where `mod`'s comment says the
        // overflow guard matters.
        //
        // ⚠️ THE VENDOR DIVERGENCE IS INHERITED, NOT INTRODUCED: Pine does not
        // publish how `%` rounds a negative operand, and truncation toward zero
        // is this engine's declared answer in both lanes now instead of one.
        if (node.op === '%') {
          return irBuiltin('mod', [lowerExpr(node.left, scope), lowerExpr(node.right, scope)])
        }
        const op = BIN[node.op]
        if (!op) {
          throw new RuntimeRefusal('runtime:operator', `\`${node.op}\` beside a mutable value`, locate(node.tok))
        }
        // ⛔ A TEXT `+` IS A DIFFERENT INSTRUCTION, not the numeric one with
        // different operands. `BINARY['+']` is `(a, b) => a + b` and would
        // happily turn a string and a number into a string, which Pine calls a
        // type error. `==` and `!=` need no such split: `cmp` compares with
        // `===` and `Number.isNaN` of a string is false, so they already answer
        // correctly for both kinds.
        if (holdsText(node.left, scope) || holdsText(node.right, scope)) {
          if (node.op === '+') {
            return concat(lowerExpr(node.left, scope), lowerExpr(node.right, scope))
          }
          // ⛔⛔ EVERY OTHER OPERATOR OVER TEXT IS REFUSED BY NAME, and this is
          // the half that makes the widened route safe. Once a text subtree
          // reaches the runtime switch, `"a" > "b"` would be lowered to `GT` and
          // answered by JavaScript's lexicographic comparison — an answer Pine
          // never gives, arrived at silently. Pine compares strings with `==`
          // and `!=` and nothing else.
          if (node.op !== '==' && node.op !== '!=') {
            throw new RuntimeRefusal(
              'runtime:operator',
              `\`${node.op}\` over text — Pine compares strings with \`==\` and \`!=\` only`,
              locate(node.tok))
          }
        }
        return binary(op, lowerExpr(node.left, scope), lowerExpr(node.right, scope))
      }
      case 'unary': {
        if (node.op === '-') return unary('u-', lowerExpr(node.arg, scope))
        if (node.op === 'not') return unary('!', lowerExpr(node.arg, scope))
        throw new RuntimeRefusal('runtime:operator', `unary \`${node.op}\``, locate(node.tok))
      }
      // ⭐⭐ A GUARD THE OBJECT PASS SYNTHESISED. `guardOf` builds a drawing's
      // `when` condition out of `{type:'op', name:'!'|'&&'}` — the shape the
      // COLUMNAR resolver reads on its way in, not the shape the parser emits.
      // Under `rawTrees` that node travels here instead, and this lane refused
      // it `pine:statement` ("not a shape the translator reads") about a node
      // the engine had just built for itself.
      //
      // ⛔ READ HERE RATHER THAN RESPELLED THERE, and that direction is the
      // whole lesson. Changing the object pass to emit the parser's shape looks
      // tidier — one spelling for one meaning — and it broke the table vendor
      // parity suite outright, because another reader depends on `op`. The
      // shape has an owner; this lane is a second READER of it, so it reads.
      case 'op': {
        const args = (node.args || []).map((a) => lowerExpr(a, scope))
        if (node.name === '!' && args.length === 1) return unary('!', args[0])
        if (node.name === '&&' && args.length === 2) return binary('&&', args[0], args[1])
        if (node.name === '||' && args.length === 2) return binary('||', args[0], args[1])
        throw new RuntimeRefusal('runtime:operator',
          `\`${node.name}\` with ${args.length} operand${args.length === 1 ? '' : 's'}`,
          locate(node.tok))
      }
      case 'ternary':
        // ⚠️ BOTH ARMS EVALUATE, which is Pine's `?:` over values. A branch that
        // MUTATES is an `if` STATEMENT and is lowered by `lowerStmts`, never here
        // — routing one through this arm would run both mutations every bar.
        //
        // ⛔⛔ A TEXT TEST IS REFUSED, AND THIS WAS FOUND BY PROBING RATHER THAN
        // BY REVIEW. `interpret`'s TERNARY is `isNan(t) ? NaN : (t !== 0 ? a :
        // b)`; `Number.isNaN('a')` is false and `'a' !== 0` is true, so once
        // text could reach the runtime `plot("a" ? 1 : 2)` compiled and plotted
        // 1 — a silent wrong answer to a script Pine does not accept at all.
        if (holdsText(node.test, scope)) {
          throw new RuntimeRefusal(
            'runtime:operator',
            'text used as a condition — a `?:` test is a boolean', locate(node.tok))
        }
        return ternary(lowerExpr(node.test, scope), lowerExpr(node.yes, scope), lowerExpr(node.no, scope))
      case 'offset': {
        // ⭐ INSIDE A REQUEST, `close[1]` IS THE REQUESTED SYMBOL'S PREVIOUS
        // BAR. The columnar lane owns price history everywhere else, but it
        // has no column of another symbol's bars — and building one would be
        // computing the wrong series and calling it the right one.
        if (inRequestValue && node.arg && node.arg.type === 'name'
            && PRICE.has(node.arg.name)) {
          // ⛔ THE OFFSET IS READ WITH THE FILE'S OWN HELPER, `foldOffset(node.n)`.
          // A first version guessed at `node.index`/`node.back` — fields the
          // parser does not have — and the refusal that came back was a
          // TypeError wearing a refusal's clothes.
          const backAt = locate(node.tok)
          return hist(series(node.arg.name), foldOffset(node.n, backAt))
        }
        // ⭐⭐⭐ 2F-2 — HISTORY OVER A VALUE THE RUNTIME PRODUCED.
        //
        // ⛔ IT IS STILL NEVER APPROXIMATED. Reading the slot's CURRENT value is
        // the plausible shortcut and it is silently one bar wrong on every bar;
        // what changed is that the ring now exists, not that the shortcut became
        // acceptable. Everything this cannot yet commit still refuses by name.
        if (readsSlot(node.arg, scope)) {
          const at = locate(node.tok)
          // ⛔ ONLY A BARE NAME HAS A COMMITTED SERIES HERE. `(a + b)[1]` is a
          // real Pine form and needs its OWN committed series; distributing the
          // offset over the operands is right for `+` and wrong the moment
          // anything inside carries state.
          //
          // ⭐⭐⭐ SO IT IS GIVEN ONE. `hoistCommittedSeries` declares the
          // expression into a slot on the line above — the rewrite this
          // refusal's own message asks the member to perform. It still returns
          // `null` for every shape that is a different gap, and the refusal
          // below is then exactly the one that was always here.
          if (node.arg.type !== 'name') {
            const hoisted = hoistCommittedSeries(node.arg, scope, 'history')
            if (!hoisted) {
              note('runtime:history-expression')
              throw new RuntimeRefusal('runtime:history-expression', null, at)
            }
            // ⛔ THE OFFSET IS FOLDED AFTER THE HOIST, NOT BEFORE, so an offset
            // only known while the bar runs refuses by ITS OWN name
            // (`runtime:history-dynamic-offset`) rather than being reported as
            // the expression problem this line just solved.
            const hb = foldOffset(node.n, at)
            // ⭐ `e[0]` IS `e`. Routing it through the ring would answer with
            // the PREVIOUS bar — one bar wrong in the one case nobody checks.
            if (hb === 0) return read(hoisted.slot)
            return histSlot(hoisted.slot, historySlotFor(hoisted.slot, hb, at), hb)
          }
          const varSlot = scope.lookup(node.arg.name)
          if (varSlot === null) {
            note('runtime:function-global-state')
            throw new RuntimeRefusal('runtime:function-global-state', `\`${node.arg.name}\``, at)
          }
          const back = foldOffset(node.n, at)
          // ⭐ `x[0]` IS `x`. Pine says so, and routing it through the ring would
          // answer with the PREVIOUS bar — one bar wrong in the one case nobody
          // would think to check.
          if (back === 0) return read(varSlot)
          // ⭐⭐⭐ P7.2 — FUNCTION-LOCAL HISTORY IS ALLOCATED PER FUNCTION HERE AND
          // MATERIALISED PER CALL SITE BELOW. The index carried on the node is
          // FRAME-RELATIVE, exactly like a persist slot: the runtime adds the call
          // site's `historyBase`, so one compiled body serves every site and two
          // sites can never share a ring.
          if (owner !== null) return histSlot(varSlot, fnHistorySlotFor(owner, varSlot, back, at), back)
          return histSlot(varSlot, historySlotFor(varSlot, back, at), back)
        }
        const back = Number(node.n)
        if (!Number.isInteger(back) || back < 0) {
          throw new RuntimeRefusal('runtime:statement', 'a bar offset counts backwards in whole bars', locate(node.tok))
        }
        return hist(column(columnOf(node.arg, locate(node.tok))), back)
      }
      case 'call': {
        // ⭐⭐ `Foo.new(…)` — ONE INSTANCE OF A USER-DEFINED TYPE.
        //
        // ⛔ FIRST IN THIS ARM, BEFORE THE USER-FUNCTION TABLE AND BEFORE THE
        // METHOD-FORM REWRITE. `ufcs.js` would otherwise read `Foo.new` as
        // "call `new` on a receiver named `Foo`" and go looking for `Foo`'s
        // namespace; a script is free to have BOTH a type `Foo` and a variable
        // `Foo`, and the member who wrote `Foo.new(…)` meant the type. Asking
        // the registry first is the same ruling `ufcs.js` makes about yielding
        // to a user definition, applied to the constructor.
        {
          const ctor = udtCtorOf(node)
          if (ctor) return lowerRecordNew(ctor, node, scope)
        }
        // ⭐⭐ A USER FUNCTION CALL — the 2E path. Each call gets its OWN call
        // site, and the site is what will own the invocation's persistent
        // locals: `f(1)` and `f(10)` on two lines are two sites, so a `var`
        // inside `f` is two independent counters, which is Pine's semantics and
        // the single most important thing this wave has to get right.
        // ⛔ A DEFERRED REFUSAL COMES BACK HERE, AT THE CALL. The definition
        // could not be compiled; this is the first line that actually needs it,
        // so this is where a member is told.
        if (deferredFnRefusals.has(node.name)) {
          const held = deferredFnRefusals.get(node.name)
          // ⭐⭐ INSIDE A REQUEST, TRY LOWERING THE BODY HERE BEFORE RE-RAISING.
          // The shared frame is what refused — `calcDaily(simple int N) =>
          // ta.sma(volume[1], N)` cannot size a window from a frame slot — and
          // the same expression written with the caller's argument compiles.
          //
          // ⛔⛔ SCOPED TO A REQUEST, AND NARROWLY, BECAUSE THE WIDER VERSION WAS
          // TRIED AND MEASURED. Inlining every deferred function also lifted two
          // refusals nobody asked to lift — a function reading a mutable global
          // (`udf.test.js`) and history over an expression inside a function
          // (`sourceToRuntime.test.js`). Both would then COMPILE, and both are
          // arguably correct Pine — but that is a capability decision with its
          // own measurement, not a side effect of fixing requests.
          //
          // ⛔ AND IF THE INLINE ALSO FAILS, THE HELD REFUSAL IS WHAT IS SHOWN.
          // Nothing is lost and no new message is invented.
          const inl = inRequestValue ? inlineBodyByName.get(node.name) : null
          if (inl) {
            try { return lowerInlineCall(node.name, inl, node, scope, opts) } catch { /* the held refusal below is the better message */ }
          }
          note(held && held.guard ? held.guard : 'runtime:function')
          throw held
        }
        const fnIndex = fnByName.get(node.name)
        if (fnIndex !== undefined) {
          const fn = functions[fnIndex]
          // ⛔⛔ A MULTI-VALUE CALL IS ONLY A DESTRUCTURING'S RIGHT-HAND SIDE.
          // Anywhere else it pushes values nothing pops: `plot(f())` would
          // draw whichever one happened to be on top and quietly grow the
          // stack every bar until the run died far from this line.
          if (fn.returns > 1 && !(opts && opts.multi)) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` returns ${fn.returns} values, so it can only be `
              + 'unpacked by a `[a, b] = …` line', locate(node.tok))
          }
          if (fn.compiling) {
            // Pine forbids a function calling itself. Saying so beats letting it
            // reach a depth limit and reporting exhaustion for a rule violation.
            note('runtime:recursion')
            throw new RuntimeRefusal('runtime:recursion', `\`${node.name}\``, locate(node.tok))
          }
          const args = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (args.length !== fn.params) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes ${fn.params} argument${fn.params === 1 ? '' : 's'}, given ${args.length}`,
              locate(node.tok))
          }
          for (const a of node.args) {
            if (a && a.name) {
              throw new RuntimeRefusal('runtime:statement',
                `a named argument \`${a.name}\` on the user function \`${node.name}\``, locate(node.tok))
            }
          }
          // ⭐⭐ INSIDE A REQUEST, THE BODY IS LOWERED HERE INSTEAD OF SHARED.
          // See `lowerInlineCall`. Outside one, nothing changes: the shared
          // frame is cheaper and is what every other call still uses.
          // ⛔ AND IT FALLS BACK TO THE SHARED FRAME IF INLINING REFUSES. That
          // path produces `carriesColumn`'s refusal — "this request computes a
          // value that needs the columnar lane" — which names the real problem.
          // Inlined, the same script refused as `function-global-state`, a
          // sentence about a frame the member is no longer in.
          if (inRequestValue && fn.inlineBody) {
            try {
              return lowerInlineCall(node.name, fn.inlineBody, node, scope, opts)
            } catch { /* fall through to the shared frame, and its refusal */ }
          }
          const site = callSites.length
          callSites.push({ fn: fnIndex, at: locate(node.tok) })
          // ⭐ ARGUMENTS ARE LOWERED IN THE CALLER'S SCOPE, so a state-derived
          // argument (`f(acc)`) is an ordinary runtime expression rather than a
          // special case — §30.
          return irCall(fnIndex, site, args.map((a) => lowerExpr(a, scope)))
        }
        // ⭐⭐ A SERVED `str.*` IS ADMITTED BEFORE `callFamily` SEES IT. That
        // classifier refuses the WHOLE `str.` namespace by design — it is the
        // diagnostic that says "text is a value-model change" — so anything
        // this lane now serves has to be taken out of its path rather than
        // carved out of its rule. Every unserved `str.*` keeps that refusal,
        // which is what the CONTROLs in `strBuiltins.test.js` pin.
        if (Object.prototype.hasOwnProperty.call(TEXT_FNS, node.name)) {
          const spec = TEXT_FNS[node.name]
          for (const arg of node.args) {
            if (arg && arg.name) {
              throw new RuntimeRefusal('runtime:statement',
                `a named argument \`${arg.name}\` on \`${node.name}\``, locate(node.tok))
            }
          }
          const given = node.args.map((x) => (x && x.value !== undefined ? x.value : x))
          if (given.length !== spec.args.length) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes ${spec.args.length} argument`
              + `${spec.args.length === 1 ? '' : 's'}, given ${given.length}`,
              locate(node.tok))
          }
          return textCall(node.name, given.map((x) => lowerExpr(x, scope)))
        }
        // ⭐⭐ A SERVED `color.*` IS ADMITTED HERE, for the same reason a served
        // `str.*` is: `callFamily` refuses the whole `color.` namespace as
        // `pine:colour-value`, which is the COLUMNAR lane's correct rule — you
        // cannot screen on a colour. This lane draws rather than screens, so the
        // two producers it serves are taken out of that path rather than the
        // rule being carved up. Every unserved `color.*`, `color.from_gradient`
        // above all, keeps the refusal.
        if (Object.prototype.hasOwnProperty.call(COLOUR_FNS, node.name)) {
          const spec = COLOUR_FNS[node.name]
          for (const arg of node.args) {
            if (arg && arg.name) {
              throw new RuntimeRefusal('runtime:statement',
                `a named argument \`${arg.name}\` on \`${node.name}\``, locate(node.tok))
            }
          }
          const given = node.args.map((x) => (x && x.value !== undefined ? x.value : x))
          const lo = spec.minArgs === undefined ? spec.args.length : spec.minArgs
          const hi = spec.maxArgs === undefined ? spec.args.length : spec.maxArgs
          if (given.length < lo || given.length > hi) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes ${lo === hi ? lo : `${lo} to ${hi}`} argument`
              + `${hi === 1 ? '' : 's'}, given ${given.length}`, locate(node.tok))
          }
          // ⛔ THE FIRST ARGUMENT OF `color.new` IS A COLOUR, AND IT IS CHECKED
          // HERE. The VM sees a packed integer and cannot tell one from a price,
          // so `color.new(close, 50)` would otherwise pack a PRICE into a colour
          // and draw it — a plausible shade computed from the wrong thing.
          if (node.name === 'color.new' && !holdsColour(given[0], scope)) {
            note('runtime:colour')
            throw new RuntimeRefusal('runtime:colour',
              '`color.new` takes a colour to recolour, and this is not one', locate(node.tok))
          }
          return colourCall(node.name, given.map((x) => lowerExpr(x, scope)))
        }
        if (node.name === 'request.security') return admitRequest(node, scope, opts)
        if (TEXT_INPUTS.has(node.name)) return admitTextInput(node, scope)
        if (Object.prototype.hasOwnProperty.call(ARRAY_FNS, node.name)) {
          return admitArrayCall(node, scope, false)
        }
        // ⭐⭐ THE METHOD FORM IN VALUE POSITION — `a.size()` IS `array.size(a)`.
        //
        // MEASURED over `corpus/committed`: 839 `.size()` and 815 `.get()` sites
        // on a DECLARED collection, which makes this the single largest method
        // form in the corpus — and the lane that actually HAS collections is
        // this one. ⚰️ Before this landed it refused `pine:builtin` — *"this
        // Pine built-in names something the engine grammar does not hold —
        // `a.get`"* — which is false twice over: `a.get` is not a built-in, and
        // the thing it names is one this lane holds.
        //
        // ⛔ THE RECEIVER MUST BE A SLOT THIS LANE MARKED AS A COLLECTION, so
        // the rewrite cannot fire on a UDT field or a name it never bound, and
        // the method form yields to a script's own definition of the same name.
        // Everything after the rewrite is `admitArrayCall`, the one admitter —
        // same arity check, same void rule, same lowering as the name form.
        {
          const uf = splitMethodName(String(node.name || ''))
          const rslot = uf && !definedNames.has(uf.method) ? scope.lookup(uf.recv) : null
          if (rslot !== null && rslot !== undefined && slots[rslot] && slots[rslot].collection) {
            const rew = methodFormCall(node, () => 'array', (m) => definedNames.has(m))
            if (rew && Object.prototype.hasOwnProperty.call(ARRAY_FNS, rew.node.name)) {
              return admitArrayCall(rew.node, scope, false)
            }
            // ⛔ AND A MEMBER THIS RUNTIME DOES NOT HOLD REFUSES BY THE
            // CANONICAL NAME. `array.median` is the thing that is missing;
            // `a.median` names a variable and sends the reader nowhere.
            note('runtime:array')
            throw new RuntimeRefusal('runtime:array',
              familyDetail('runtime:array', `array.${uf.method}`), locate(node.tok))
          }
        }
        const fam = callFamily(node.name)
        // ⛔⛔ NO `objectPassOwnsDrawing` ESCAPE HATCH IN THE EXPRESSION
        // POSITION, DELIBERATELY. The two shapes that legitimately mention a
        // drawing call — the handle binding and the bare drawing statement —
        // are both skipped before lowering ever reaches here, so anything that
        // arrives is a drawing used AS A VALUE. There is no honest number to
        // return for it: `num(NaN)` was tried and `ir.js` rightly refuses a
        // non-finite const, and `0` is a coordinate. Refusing by name is the
        // answer, and it keeps the message pointing at the real shape.
        if (fam) { note(fam); throw new RuntimeRefusal(fam, familyDetail(fam, node.name), locate(node.tok)) }
        // ⭐⭐ A POINTWISE BUILTIN OVER RUNTIME STATE — 2F-1's whole capability.
        // Its arguments are lowered in the caller's scope, so a state-derived
        // argument is an ordinary runtime expression, and the result composes
        // back into assignments, conditions, outputs and further calls.
        const pw = pointwiseTarget(node.name)
        if (pw) {
          for (const a of node.args) {
            if (a && a.name) {
              throw new RuntimeRefusal('runtime:statement',
                `a named argument \`${a.name}\` on \`${node.name}\``, locate(node.tok))
            }
          }
          const given = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          const want = pw.spec.args.length
          let args = given.map((a) => lowerExpr(a, scope))
          // ⭐ `nz(x)` IS `nz(x, 0)` — pine.js's own resolver says so, and this
          // mirrors that ruling rather than inventing a default.
          if (pw.table === 'nz' && given.length === 1 && want === 2) args = [args[0], num(0)]
          if (args.length !== want) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes ${want} argument${want === 1 ? '' : 's'}, given ${given.length}`,
              locate(node.tok))
          }
          return irBuiltin(pw.table, args)
        }
        // ⭐⭐⭐ 2F-2B — A FINITE-WINDOW BUILTIN OVER A RUNTIME-PRODUCED SERIES.
        const win = windowTarget(node.name)
        if (win) {
          const at = locate(node.tok)
          const given = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (given.length !== 2) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes a source and a length, given ${given.length}`, at)
          }
          // ⛔ THE SOURCE MUST BE A NAME. A window needs a COMMITTED SERIES, and
          // only a variable has one — `sma(x + 1, 5)` needs its own series exactly
          // as `(x + 1)[1]` does, and is refused by the same name.
          const srcNode = given[0]
          let varSlot = srcNode && srcNode.type === 'name' ? scope.lookup(srcNode.name) : null
          let srcLabel = srcNode && srcNode.type === 'name' ? srcNode.name : null
          // ⭐⭐ INSIDE A REQUEST, THE SOURCE IS GIVEN ITS OWN COMMITTED SERIES.
          //
          // ⛔ The refusals below are right everywhere else: a window needs a
          // series, and only a variable has one. But inside a request there is
          // nowhere for a member to PUT that variable — the value is a single
          // expression evaluated against another symbol's bars, so
          // `ta.sma(volume[1], N)` has no line on which to write
          // `tmp = volume[1]` first. A request region IS a statement
          // sequence, so the binding the author cannot write is hoisted for them.
          //
          // ⭐ It is exactly the rewrite the refusal below describes — "needs
          // that expression's own committed series" — performed, not demanded.
          if (varSlot === null && hoistSink) {
            const tmp = `${node.name} src ${hoistSink.length}`
            const slot = scope.declare(tmp, newSlot(tmp, false))
            hoistSink.push(declare(slot, lowerExpr(srcNode, scope)))
            varSlot = slot
            srcLabel = tmp
          }
          // ⭐⭐⭐ AND THE SAME REWRITE AT THE ROOT STATEMENT LIST. The request
          // region above hoists ANY unresolved source because a member has
          // nowhere to put the binding inside a request; here they do, so only
          // a node that is genuinely NOT A NAME is admitted and
          // `runtime:function-global-state` keeps firing for the other case.
          if (varSlot === null) {
            const hoisted = hoistCommittedSeries(srcNode, scope, node.name)
            if (hoisted) { varSlot = hoisted.slot; srcLabel = hoisted.label }
          }
          if (varSlot === null) {
            if (!srcNode || srcNode.type !== 'name') {
              note('runtime:history-expression')
              throw new RuntimeRefusal('runtime:history-expression',
                `\`${node.name}\` over an expression needs that expression's own committed series`, at)
            }
            note('runtime:function-global-state')
            throw new RuntimeRefusal('runtime:function-global-state', `\`${srcNode.name}\``, at)
          }
          // ⭐ THE LENGTH FOLDS THE SAME WAY A HISTORY OFFSET DOES — literal or
          // input-derived, off the CANONICAL TREE. A length only known while the
          // bar runs cannot size a ring before bar 0.
          const n = foldConstNode(given[1], at,
            `the length of \`${node.name}\` is only known while the bar is running, `
            + 'so the ring it needs cannot be sized before bar 0')
          if (n < 1) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` needs a length of at least 1, got ${n}`, at)
          }
          // ⭐⭐ SPAN COMES FROM `interpret.js`, NOT FROM HERE. `ta.rising(x, n)`
          // spans n+1 bars; asking the table means the runtime cannot disagree
          // with the columnar lane about how wide the window is.
          const span = FINITE_WINDOW[win.table].span(n)
          // the ring must reach `span - 1` bars back; the live bar completes it
          if (span > 1) {
            if (owner !== null) fnHistorySlotFor(owner, varSlot, span - 1, at)
            else historySlotFor(varSlot, span - 1, at)
          }
          const histIndex = span > 1
            ? (owner !== null ? functions[owner].historyByVarSlot.get(varSlot) : historyByVarSlot.get(varSlot))
            : 0
          // ⭐⭐ A WINDOW IS NOW MATERIALISED PER CALL SITE, like history and
          // carried state before it. 2F-2B could share one plan entry across
          // sites because the scratch buffer was TRANSIENT — filled and reduced
          // inside one opcode. The measured `skip` policy needs a ring of the
          // last `n` FINITE observations, which is STATE, and state that two
          // call sites shared would interleave two series into one window.
          const entry = { fn: win.table, name: `${node.name}(${srcLabel},${n})`, historySlot: histIndex, span }
          let widx
          if (owner !== null) {
            const list = functions[owner].windowLocals || (functions[owner].windowLocals = [])
            widx = list.length
            list.push(entry)
          } else {
            widx = windowsMain.length
            windowsMain.push(entry)
          }
          const call = windowCall(widx, read(varSlot))
          // ⛔ THE SIGN IS APPLIED HERE, ON THE WAY OUT, because that is where
          // `pine.js` applies it — `u-` wrapping the bare call, not a second
          // reducer with a flipped comparison. One reducer, one negation node.
          return win.negate ? unary('u-', call) : call
        }
        // ⭐⭐ `ta.change(x)` — LOWERED INTO SEMANTICS THIS RUNTIME ALREADY HAS,
        // never a new state machine (§44). `interpret.js::FN.change` is exactly
        // `series[i] - series[i-1]` with NaN falling out of the subtraction, and
        // `x - x[1]` is that expression in this IR: the ring supplies `x[1]`, the
        // subtraction supplies the NaN rule, and bar 0 answers NaN because the
        // ring has nothing to give. There is no second definition to keep in step.
        //
        // ⛔ `ta.crossover`/`ta.crossunder` ARE NOT DONE THE SAME WAY, AND THE
        // REASON IS MEASURED. `interpret.js::crossing` answers NaN when ANY of the
        // four values it reads is NaN; this grammar's `>` answers 0 on a NaN
        // (checked: `BINARY['>'](NaN, 5) === 0`). Lowering them into operators
        // would answer 0 where the table says NOT COMPUTABLE — a silent
        // approximation, which is the one thing this engine may not ship. They
        // stay refused until the family gets its own authoritative step.
        if (changeTarget(node.name)) {
          const at = locate(node.tok)
          const given = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (given.length !== 1) {
            // Pine also has `ta.change(source, length)`; the closed table's
            // `change` declares ONE argument, so the two-argument form is a
            // TABLE gap and refuses at the columnar door as `pine:arity`. Saying
            // so here keeps the runtime from inventing a second answer.
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes one source here; the two-argument form is a closed-table gap`, at)
          }
          const srcNode = given[0]
          if (!srcNode || srcNode.type !== 'name') {
            // ⭐⭐⭐ `x - x[1]` NEEDS THE SAME COMMITTED SERIES, so it gets one
            // the same way. Nothing about the lowering below changes: the
            // hoisted slot is an ordinary slot and the subtraction is still the
            // one definition of `change` this file has.
            const hoisted = hoistCommittedSeries(srcNode, scope, node.name)
            if (!hoisted) {
              note('runtime:history-expression')
              throw new RuntimeRefusal('runtime:history-expression',
                `\`${node.name}\` over an expression needs that expression's own committed series`, at)
            }
            return binary('-', read(hoisted.slot),
              histSlot(hoisted.slot, historySlotFor(hoisted.slot, 1, at), 1))
          }
          const varSlot = scope.lookup(srcNode.name)
          if (varSlot === null) {
            note('runtime:function-global-state')
            throw new RuntimeRefusal('runtime:function-global-state', `\`${srcNode.name}\``, at)
          }
          const prev = owner !== null
            ? histSlot(varSlot, fnHistorySlotFor(owner, varSlot, 1, at), 1)
            : histSlot(varSlot, historySlotFor(varSlot, 1, at), 1)
          return binary('-', read(varSlot), prev)
        }
        // ⭐⭐ `ta.atr(n)` IS `ta.rma(trueRange, n)`, AND THAT IS NOT A
        // CONVENIENCE — IT IS HOW THE TWO LANES ARE KEPT TO ONE NUMBER.
        //
        // The columnar lane serves ATR from the SHIPPED `computeATR`, which
        // accumulates the first `n` true ranges, seeds `atr = sum / n`, then
        // steps `atr = (atr * (n - 1) + tr) / n`. `CARRIED.rma` with `k = 1/n`
        // does exactly that: `smoothStep` seeds from an SMA over the first `n`
        // finite samples and then runs `prev * (1 - k) + v * k`. Read side by
        // side, they are the same recurrence with the same seed.
        //
        // ⛔ SO THIS DESUGARS RATHER THAN IMPLEMENTING. A second ATR here would
        // be a second authority on a number a member reads off the screen, and
        // the two would drift the first time either seed changed. The agreement
        // is MEASURED in `runtime/__tests__/atr.test.js` against `computeATR`
        // itself rather than asserted.
        //
        // ⭐⭐ AND THIS BRANCH HAS EXACTLY ONE REACHABLE DOOR — measured by
        // mutation 2026-09-21, not by reading. A `throw` planted as this
        // branch's first statement fires ONLY for `ta.atr` inside a
        // `request`. A plain `ta.atr(5)`, one beside runtime state, one in a
        // user function and one in an `if` body are ALL served by the
        // columnar lane and never arrive here. A neighbouring test case
        // claimed to cover the runtime-state route; it did not, and it could
        // not tell, because it asserted only that the script compiled.
        //
        // ⛔ SEPARATELY, AND STILL OPEN: Pine defines `ta.atr(n)` as
        // `ta.rma(ta.tr(true), n)`, and `tr(true)` is `high - low` on bar 0.
        // The expression below uses a raw `close[1]`, which is `na` there, so
        // this engine's ATR warm-up ends one bar late with a different seed.
        // The 2026-09-21 vendor capture CANNOT settle which is right — it
        // holds bars 8168..8467, where a seed difference has decayed to zero.
        // Pinned in `atr.test.js`; do not change these numbers on the
        // documentation alone.
        //
        // ⛔ THE TRUE RANGE IS `na` ON BAR 0, deliberately: `close[1]` does not
        // exist, `Math.max` propagates the NaN, and `smoothStep` HOLDS on a
        // non-finite sample. That is what makes the warm-up land on the same bar
        // as the shipped one, which starts its loop at `i = 1`.
        // ⭐⭐ `hour(time, "America/New_York")` IS THE `hour` COLUMN, and saying
        // so is what keeps one clock. `indicators.js::etClockAt` already serves
        // every ET field the columnar lane publishes; this routes the CALL form
        // onto it instead of implementing a second timezone conversion, which
        // is the same ruling `ta.atr` got and for the same reason.
        //
        // ⛔⛔ ANY OTHER TIMEZONE IS REFUSED BY NAME, NEVER COMPUTED AS ET. This
        // engine's clock is `America/New_York` end to end; answering a Tokyo
        // request with New York hours would put a number on screen that looks
        // entirely reasonable and is wrong by a fixed offset — the most
        // expensive kind of wrong answer available here. An absent timezone
        // means the exchange's, which for this platform IS ET.
        //
        // ⛔ AND THE INSTANT MUST BE `time` — the bar's own. These fields read
        // the bar being evaluated, so a computed instant (`time + 3600`, a
        // stored timestamp) is refused rather than silently answered for the
        // wrong moment.
        if (CLOCK_FIELDS.includes(node.name) && node.args && node.args.length) {
          const at = locate(node.tok)
          const given = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (given.length > 2) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes an instant and an optional timezone, `
              + `given ${given.length}`, at)
          }
          if (!(given[0] && given[0].type === 'name' && given[0].name === 'time')) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}(…)\` reads the clock of the bar being evaluated, so `
              + 'its instant has to be `time` — a computed instant would be '
              + 'answered for the wrong moment', at)
          }
          if (given.length === 2) {
            const tzNode = given[1]
            const tz = tzNode && tzNode.type === 'string' ? tzNode.value : null
            if (tz !== 'America/New_York') {
              throw new RuntimeRefusal('runtime:statement',
                `\`${node.name}\` is served in America/New_York, and this asks for `
                + `${tz === null ? 'a timezone only known while the bar runs' : `\`${tz}\``}`
                + ' — answering it with New York hours would be wrong by a fixed '
                + 'offset and would look entirely reasonable', at)
            }
          }
          return clock(node.name)
        }
        // ⭐⭐ `time(timeframe.period, "0930-1600", "America/New_York")` — Pine's
        // SESSION CLOCK, and the idiom is always `not na(…)`: "is this bar in
        // the regular session". It answers the bar's own instant inside the
        // window and `na` outside, which is what makes that check work.
        //
        // ⛔ THE BOUNDS ARE FOLDED HERE, NOT AT RUN TIME. A session is a literal
        // in every script that uses one, so parsing it once at lowering keeps the
        // bar loop free of string work — and, more importantly, makes a
        // malformed session a REFUSAL with a line number rather than a silent
        // `na` on every bar, which reads exactly like "the market was shut".
        if (node.name === 'time' && node.args && node.args.length >= 2) {
          const at = locate(node.tok)
          const given = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (given.length > 3) {
            throw new RuntimeRefusal('runtime:statement',
              `\`time\` takes a timeframe, a session and an optional timezone, `
              + `given ${given.length}`, at)
          }
          const tf = given[0]
          if (!(tf && tf.type === 'name' && tf.name === 'timeframe.period')) {
            throw new RuntimeRefusal('runtime:statement',
              'the session clock reads the timeframe the bars are ON, so its first '
              + 'argument has to be `timeframe.period` — a different timeframe would '
              + 'need bars this region does not have', at)
          }
          if (!(given[1] && given[1].type === 'string')) {
            throw new RuntimeRefusal('runtime:statement',
              'a session has to reach the engine as a literal like `"0930-1600"`, so '
              + 'its bounds are known before the first bar', at)
          }
          if (given.length === 3) {
            const tzNode = given[2]
            const tz = tzNode && tzNode.type === 'string' ? tzNode.value : null
            if (tz !== 'America/New_York') {
              throw new RuntimeRefusal('runtime:statement',
                'the session clock is served in America/New_York, and this asks for '
                + `${tz === null ? 'a timezone only known while the bar runs' : `\`${tz}\``}`
                + ' — answering it with New York session bounds would put every bar '
                + 'in or out of session by a fixed offset', at)
            }
          }
          const spec = String(given[1].value).trim()
          // ⛔ A DAY MASK (`"0930-1600:23456"`) IS REFUSED BY NAME. Serving the
          // time half and dropping the day half would put weekend bars inside a
          // weekday-only session — a wrong answer that looks like a working one.
          const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(spec)
          if (!m) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${spec}\` is not a session this engine reads — it takes \`HHMM-HHMM\``
              + (spec.includes(':') ? ', and a day mask is not served yet' : ''), at)
          }
          const [sh, sm, eh, em] = m.slice(1).map(Number)
          if (sh > 23 || eh > 23 || sm > 59 || em > 59) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${spec}\` names a time that does not exist`, at)
          }
          const start = sh * 60 + sm
          const end = eh * 60 + em
          // ⛔ AN OVERNIGHT SESSION WRAPS MIDNIGHT and is a different membership
          // test (two ranges, and a bar's session DAY stops matching its calendar
          // day). Refused rather than tested with `start <= x < end`, which is
          // empty for every wrapping session — so every bar would read as out of
          // session and the script would simply show nothing.
          if (end <= start) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${spec}\` runs overnight, and a wrapping session is a different `
              + 'membership test this engine does not serve yet', at)
          }
          return session(start, end)
        }
        if (node.name === 'ta.atr' || node.name === 'atr') {
          const at = locate(node.tok)
          const given = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (given.length !== 1) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes a length, given ${given.length}`, at)
          }
          const n = foldConstNode(given[0], at,
            `the length of \`${node.name}\` is only known while the bar is running, `
            + 'so the state it needs cannot be sized before bar 0')
          if (n < 1) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` needs a length of at least 1, got ${n}`, at)
          }
          const entry = { fn: 'rma', n, name: `${node.name}(${n})` }
          let aidx
          if (owner !== null) {
            const list = functions[owner].carriedLocals || (functions[owner].carriedLocals = [])
            aidx = list.length
            list.push(entry)
          } else {
            aidx = carriedMain.length
            carriedMain.push(entry)
          }
          return carriedCall(aidx, lowerExpr(trueRangeAst(), scope))
        }
        // ⭐⭐ `ta.crossover` / `ta.crossunder` OVER RUNTIME STATE.
        //
        // ⛔⛔ ONLY OVER RUNTIME STATE, AND NOT BY A CHECK HERE. A cross over
        // PURE arguments never reaches this branch — the route decision sends
        // the whole subtree to the columnar lane, which has answered it
        // correctly for as long as it has existed. What arrives here is the
        // shape that used to refuse `runtime:call-windowed-state`: a cross fed
        // by a mutable variable.
        //
        // ⛔⛔ AND IT IS A CARRIED STEP RATHER THAN AN OPERATOR LOWERING, which
        // is the decision the comment above `ta.change` already argued and left
        // unbuilt. `a > b and a[1] <= b[1]` is NOT the definition of a crossing:
        // `interpret.js::crossing` answers NaN when any of the four values is
        // NaN, while this grammar's `>` answers 0 on a NaN. The operator form
        // would report "did not cross" on every warm-up bar, where the table
        // says NOT COMPUTABLE — a silent approximation on 338 corpus sites.
        if (RUNTIME_CROSS_CARRIED[node.name]
          // ⛔ THE SCRIPT'S OWN DEFINITION WINS. `crossover` is a plain name in
          // the v1-v3 spelling and a member may define one; hijacking it would
          // compute a builtin nobody wrote.
          && !definedNames.has(node.name)) {
          const at = locate(node.tok)
          const given = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (given.length !== 2) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes two series, given ${given.length}`, at)
          }
          // ⛔ SAME RING-SHARING LIMIT AS `ta.valuewhen`: `OP.CARRIED2` has no
          // frame-relative base, so two invocations inside one user function
          // would share one previous-pair and answer a plausible wrong series.
          if (owner !== null) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` inside a user function is not served yet — each `
              + 'invocation needs its own previous-bar pair, and sharing one would '
              + 'answer a plausible wrong series rather than refuse', at)
          }
          const idx = carried2Main.length
          carried2Main.push({ fn: RUNTIME_CROSS_CARRIED[node.name], n: 0, name: node.name })
          // ⭐ FIRST ARGUMENT FIRST — `crossover(a, b)` is "a crossed ABOVE b",
          // and the pair is NOT symmetric. The VM hands them to the step in
          // this order; `crossFamily.test.js` asserts swapping them changes the
          // answer rather than merely the types.
          return carried2Call(idx, lowerExpr(given[0], scope), lowerExpr(given[1], scope))
        }
        // ⭐⭐ PINE'S `ta.valuewhen` — THE Nth MOST RECENT FIRING.
        //
        // ⛔⛔ NOT `interpret.js::valueWhen`, WHICH SHARES THE NAME AND COUNTS
        // BARS. That one holds a value only while the firing is within the last
        // `n` bars; Pine's third argument is an OCCURRENCE INDEX and two firings
        // may be a thousand bars apart. They line up positionally and answer
        // different numbers, so the host lane keeps its screener function and
        // this lane gets a twin — `docs/pine/computation-crossref.md` records
        // refusing this name as a DELIBERATE RULING rather than as a gap.
        //
        // ⭐ BOTH SPELLINGS, because 180 of the 377 corpus sites write the bare
        // v1-v3 form and it is the SAME Pine function.
        if (node.name === 'ta.valuewhen' || node.name === 'valuewhen') {
          const at = locate(node.tok)
          const given = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (given.length !== 3) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes a condition, a source and an occurrence, `
              + `given ${given.length}`, at)
          }
          // ⛔⛔ INSIDE A USER FUNCTION TWO INVOCATIONS WOULD SHARE ONE RING.
          // `OP.CARRIED` adds a frame-relative `carriedBase` so one body keeps
          // two recurrences; `OP.CARRIED2` has no such base yet, so a shared
          // ring would answer a PLAUSIBLE WRONG NUMBER on every bar. A named
          // refusal is the honest version of that limit, and it is the same
          // choice `runtime:object-op` makes about drawings used as values.
          if (owner !== null) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` inside a user function is not served yet — each `
              + 'invocation needs its own occurrence ring, and sharing one would '
              + 'answer a plausible wrong number rather than refuse', at)
          }
          const occ = foldConstNode(given[2], at,
            `the occurrence of \`${node.name}\` is only known while the bar is `
            + 'running, so the ring it needs cannot be sized before bar 0')
          if (!Number.isInteger(occ) || occ < 0) {
            throw new RuntimeRefusal('runtime:statement',
              `the occurrence of \`${node.name}\` counts firings back from this `
              + `bar, so it must be a whole number of 0 or more, got ${occ}`, at)
          }
          // ⛔ A CEILING, BECAUSE THE RING IS ALLOCATED FROM IT. The corpus's
          // largest occurrence is a small literal; an absurd one is a typo, and
          // reserving its memory silently is how a script becomes a hang.
          if (occ > MAX_VALUEWHEN_OCCURRENCE) {
            throw new RuntimeRefusal('runtime:statement',
              `the occurrence of \`${node.name}\` is ${occ}, past this engine's `
              + `ceiling of ${MAX_VALUEWHEN_OCCURRENCE} firings`, at)
          }
          const idx = carried2Main.length
          carried2Main.push({ fn: 'valuewhen', n: occ, name: `${node.name}(${occ})` })
          // ⭐ CONDITION THEN SOURCE — the order `lowerIr` walks them in.
          return carried2Call(idx, lowerExpr(given[0], scope), lowerExpr(given[1], scope))
        }
        const car = carriedTarget(node.name)
        if (car) {
          const at = locate(node.tok)
          const given = node.args.map((a) => (a && a.value !== undefined ? a.value : a))
          if (given.length !== 2) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` takes a source and a length, given ${given.length}`, at)
          }
          // ⭐⭐ THE SOURCE MAY BE ANY EXPRESSION, AND THAT IS THE POINT. A finite
          // window needs a COMMITTED SERIES and so refuses `sma(x + 1, 5)`; a
          // recurrence reads only the CURRENT value and remembers its own
          // OUTPUT, so `ema(x + 1, 5)` needs no ring at all. Allocating one for
          // symmetry would reserve memory the semantics never asked for.
          const n = foldConstNode(given[1], at,
            `the length of \`${node.name}\` is only known while the bar is running, `
            + 'so the state it needs cannot be sized before bar 0')
          if (n < 1) {
            throw new RuntimeRefusal('runtime:statement',
              `\`${node.name}\` needs a length of at least 1, got ${n}`, at)
          }
          const entry = { fn: car.table, n, name: `${node.name}(…,${n})` }
          let idx
          if (owner !== null) {
            const list = functions[owner].carriedLocals || (functions[owner].carriedLocals = [])
            idx = list.length
            list.push(entry)
          } else {
            idx = carriedMain.length
            carriedMain.push(entry)
          }
          return carriedCall(idx, lowerExpr(given[0], scope))
        }
                // A builtin whose ARGUMENT is mutable state — and WHICH KIND matters.
        const g = builtinStateFamily(node.name)
        note(g)
        throw new RuntimeRefusal(g, `\`${node.name}\``, locate(node.tok))
      }
      // ⛔⛔ NO `case 'member'` / `case 'method'` HERE, AND THAT IS MEASURED.
      // One was written — "both lanes should answer a postfix member alike" —
      // and the mutation run caught it SURVIVING: reverting it changed no test.
      // A marker probe then tried twelve shapes (a plot argument, a binding, a
      // `:=` onto `var` state, inside `if`, inside `for`, a bare field read, a
      // user function's return, a ternary, an `array.push` argument, an indexed
      // receiver) and every one refused `pine:member` — from `pine.js`'s shared
      // `Resolver`, which this lane calls, and NOT ONE from this switch.
      //
      // ⭐ So both lanes DO answer alike, and for a better reason than a second
      // copy: there is one resolver. A case here would have been a guard that
      // cannot fire, sitting exactly where a reader counts it as protection.
      //
      // ⭐⭐ AND NOW ONE CAN FIRE, WHICH IS WHY THE CASE BELOW EXISTS. The
      // probe's twelve shapes all had one thing in common: nothing in either
      // lane could say what TYPE the receiver produced, which is exactly what
      // `pine:member`'s sentence says. A declared user type answers that
      // question — `zones.get(0).top` is a `Zone`'s `top`, by declaration —
      // so this arm serves the ONE shape that has an answer and leaves every
      // other to the resolver that already refuses it accurately.
      // ⛔ THE GUARD IS `udtTypeOf`, NOT `node.type === 'member'`. Widening it
      // to every member would re-create the guard that could not fire, and
      // would answer for receivers this lane knows nothing about.
      case 'member': {
        const recvType = udtTypeOf(node.recv, scope)
        if (recvType) {
          const spec = fieldSpec(recvType, node.name)
          if (!spec) {
            note('runtime:udt-field')
            throw new RuntimeRefusal('runtime:udt-field',
              `\`.${node.name}\` — \`${recvType}\` declares no such field`, locate(node.tok))
          }
          return irField(lowerExpr(node.recv, scope), node.name)
        }
        throw new RuntimeRefusal('runtime:statement',
          `a \`${node.type}\` beside a mutable value`, locate(node.tok))
      }
      default:
        throw new RuntimeRefusal('runtime:statement', `a \`${node.type}\` beside a mutable value`, locate(node.tok))
    }
  }

  // ⭐⭐ THREE KINDS OF STATEMENT-LEVEL CALL, AND THEY ARE NOT ONE FAMILY (§27).
  // The first measurement of this front end filed `fill()`, `bgcolor()` and
  // `max_bars_back()` under `runtime:expression-statement` — technically true
  // and useless: it put a presentation gap and a compiler directive in the row
  // reserved for effectful calls, so the completion matrix would have shown work
  // where there is none and hidden work where there is.
  //
  //   OUTPUT       carries a VALUE SERIES the runtime emits
  //   PRESENTATION carries appearance — the presentation program's, not this lane's
  //   DIRECTIVE    instructs the compiler and produces nothing
  // ⭐⭐ `alertcondition` AND `hline` ARE OUTPUTS HERE, not presentation.
  //
  // The line between the two families is *"does this call carry a VALUE SERIES
  // this lane computes?"*, and for both of these it does: `alertcondition`'s
  // first argument is the condition, `hline`'s is the level. They sat under
  // PRESENTATION because the CALLS look decorative, which is a fact about what
  // a chart does with the answer, not about whether this lane can compute it.
  //
  // ⭐ `alertcondition` IS pine.js'S `OUTPUT_CALLS` VERDICT TOO — it declares
  // `alertcondition: 'condition'` — so this agrees with the lane next door
  // rather than inventing a second opinion.
  //
  // ⛔ THEIR TITLE AND MESSAGE ARE NOT DROPPED, THEY ARE NOT THIS LANE'S. The
  // host lane already carries `title`/`message` on its own output descriptors
  // (`alertMessageRides.test.js`), and alert DELIVERY is its path. This lane
  // computes bar-by-bar values; the condition series is the whole of its job.
  //
  // ⚠ `fill`, `bgcolor` and `barcolor` STAY REFUSED, and the reason is a real
  // one rather than an ordering: each carries a COLOUR, and a colour is not a
  // value this lane can hold — `pine:colour-value` refuses one by name. Serving
  // them needs a colour channel, which is a capability, not a table entry.
  const OUTPUT_CALLS = RUNTIME_OUTPUT_CALLS
  const COLOUR_OUTPUTS = RUNTIME_COLOUR_OUTPUTS
  const PRESENTATION_CALLS = new Set([
    'plotcandle', 'plotbar', 'alert',
  ])
  const DIRECTIVE_CALLS = new Set(['max_bars_back'])

  /** Emit ONE output for an output call, and answer its index.
   *
   *  ⭐⭐ ONE EMITTER FOR BOTH SPELLINGS. `plot(close)` as a statement and
   *  `p = plot(close)` as a binding are the same act, and they used to be two
   *  code paths — only one of which emitted anything. Two paths for one meaning
   *  is how the bound form came to compile and draw nothing; a single function
   *  is what makes that divergence impossible rather than merely fixed.
   */
  const emitOutputCall = (callName, call, scope, out, at, extra) => {
    const args = call && call.args ? call.args : []
    const arg0 = args.length ? (args[0].value !== undefined ? args[0].value : args[0]) : null
    if (!arg0) throw new RuntimeRefusal('runtime:statement', `\`${callName}()\` with no value`, at)
    // ⛔ A TEXT VALUE CANNOT BE PLOTTED, AND IT IS REFUSED HERE RATHER THAN
    // LEFT TO THE VM. `EMIT`'s kind check would catch it, but a bar into the
    // run and as a thrown `VmError` — a member would get an exception where
    // every other unsupported construct gives them a named refusal with a
    // line. Before text was lowerable at all this was the columnar lane's
    // `pine:text-value`; making text lowerable must not lose the sentence.
    if (holdsText(arg0, scope)) {
      throw new RuntimeRefusal('runtime:statement',
        `\`${callName}()\` was handed text — a plot draws numbers`, at)
    }
    // ⛔⛔ EVERY OUTPUT CALL DECLARES WHICH KIND IT TAKES, and both directions
    // are refused. A colour is a packed integer, so without this `plot(color.red)`
    // would compile and draw the line at y = 5,394,687 — a number a member would
    // read as data. And `bgcolor(close)` would paint the background whatever
    // colour a PRICE happens to pack to, which is a plausible shade computed
    // from the wrong thing.
    const isColour = holdsColour(arg0, scope)
    if (COLOUR_OUTPUTS.has(callName) && !isColour) {
      // ⛔⛔ AN UNSERVED `color.*` IS A DIFFERENT FACT FROM "NOT A COLOUR", and
      // telling a member the wrong one sends them to rewrite a line that is
      // correct. `color.from_gradient(…)` IS a colour — 21 corpus scripts use
      // it — this engine simply does not compute it yet. Saying "this is not a
      // colour" about it would be false, and false in the direction that wastes
      // the reader's time.
      const unserved = arg0 && arg0.type === 'call' && typeof arg0.name === 'string'
        && arg0.name.startsWith('color.')
      if (unserved) {
        note('runtime:colour')
        throw new RuntimeRefusal('runtime:colour',
          `\`${arg0.name}\` is a colour this engine does not compute yet`, at)
      }
      note('runtime:colour')
      throw new RuntimeRefusal('runtime:colour',
        `\`${callName}()\` paints with a colour, and this is not one`, at)
    }
    if (!COLOUR_OUTPUTS.has(callName) && isColour) {
      note('runtime:colour')
      throw new RuntimeRefusal('runtime:colour',
        `\`${callName}()\` draws numbers, and a colour is not one`, at)
    }
    outputs.push({ call: callName, ...(extra || {}) })
    const index = outputs.length - 1
    out.push(emit(index, lowerExpr(arg0, scope)))
    return index
  }

  /** `fill(plot1, plot2, colour)` — emits the COLOUR series and records which
   *  two outputs it spans.
   *
   *  ⭐⭐ THE TWO PLOTS ARE COMPILE-TIME HANDLES, which is what made this
   *  tractable at all. Pine's plot ids cannot be computed, so `fill` never needs
   *  a runtime value for them — it needs the output INDEX, and `plotRefs`
   *  already holds it. What the output list could not do until now was carry
   *  that index, which is why an output became a descriptor.
   */
  const emitFill = (call, scope, out, at) => {
    const args = (call && call.args) || []
    const positional = args.filter((x) => !x || !x.name)
    const named = new Map(args.filter((x) => x && x.name).map((x) => [x.name, x.value]))
    const argOf = (x) => (x && x.value !== undefined ? x.value : x)
    if (positional.length < 2) {
      throw new RuntimeRefusal('runtime:statement',
        '`fill()` spans two plots, and fewer than two were given', at)
    }
    // ⛔ EACH SIDE MUST NAME A PLOT, and the refusal says which one did not.
    // `fill(close, open, color.red)` is a real mistake a member makes, and
    // "expected a plot" without naming the side sends them to check both.
    const sideOf = (i) => {
      const node = argOf(positional[i])
      const ref = node && node.type === 'name' ? plotRefs.get(node.name) : null
      if (!ref) {
        note('runtime:fill-target')
        throw new RuntimeRefusal('runtime:fill-target',
          `argument ${i + 1} of \`fill()\` is not a plot — a fill spans two, and `
          + 'each is named by binding one (`p = plot(…)`)', at)
      }
      return ref.index
    }
    const upper = sideOf(0)
    const lower = sideOf(1)

    const colourNode = named.has('color') ? named.get('color')
      : (positional.length > 2 ? argOf(positional[2]) : null)
    if (!colourNode || !holdsColour(colourNode, scope)) {
      // ⛔⛔ THE GRADIENT FORM IS REFUSED BY ITS OWN NAME, not as "missing a
      // colour". `fill(p1, p2, top_value, bottom_value, top_colour, bottom_colour)`
      // is a DIFFERENT call that shades vertically between two values, and the
      // fill primitive this engine has paints one colour across a span. Telling
      // a member their colour is missing, when they passed two, would send them
      // to fix a line that is correct.
      if (positional.length >= 6) {
        note('runtime:fill-gradient')
        throw new RuntimeRefusal('runtime:fill-gradient', null, at)
      }
      note('runtime:colour')
      throw new RuntimeRefusal('runtime:colour',
        '`fill()` paints with a colour, and this is not one', at)
    }
    outputs.push({ call: 'fill', upper, lower })
    out.push(emit(outputs.length - 1, lowerExpr(colourNode, scope)))
  }

  // ⚰️ A REFUSAL WITH `line: null` IS NOT AN ACCEPTABLE FINAL STATE.
  // `buildRuntimeIr` on `uncharted-volume.pine` answered
  //     { guard: 'pine:text-value', line: null }
  // because the `string` node that reached `resolve` carried no `tok` — synthesized
  // rather than parsed — so `locate(node.tok)` was null and the member got a refusal
  // with nowhere to look. This records the statement being lowered so the catch
  // below can fall back to it.
  // ⚠️ IT IS THE STATEMENT'S LOCATION, NOT THE EXPRESSION'S, and the distinction
  // is kept rather than smoothed over: a fallback that pretended to be exact would
  // send the next reader to the wrong sub-expression with full confidence.
  let lastStmtTok = null
  /** ⭐⭐ `rootHoist` OPTS THIS LIST IN AS A HOIST SINK — see `stmtHoistSink`.
   *  Exactly ONE call site passes it (the root walk); every nested list lowers
   *  with no sink, which is what keeps a hoisted declare out of a branch body.
   *
   *  ⛔ THE SINK IS SAVED AND RESTORED, NOT MERELY CLEARED, AND THE RESTORE IS
   *  IN A `finally`. A nested list is lowered from inside a root statement, and
   *  `lowerInlineCall` is called under a `catch` that FALLS THROUGH and keeps
   *  going (the shared-frame fallback) — so a throw that did not restore would
   *  leave the REST of that root statement sinkless, and the same source line
   *  would compile or refuse depending on what had thrown earlier in it.
   *
   *  ⚠️ AND THIS RESTORE IS **NOT MUTATION-PROVED** — said plainly rather than
   *  counted as covered. Turning it into `stmtHoistSink = null` leaves all 221
   *  rail cases green, because `if (rootHoist) stmtHoistSink = out` re-arms the
   *  sink at the top of every iteration: reaching it needs a root statement that
   *  lowers a nested list AND then needs a hoist LATER IN THE SAME STATEMENT,
   *  and no such shape was constructed. It is kept as exception safety for the
   *  catch-and-fall-through path above, and labelled, because a guard nobody has
   *  seen fire is not a guard — recording that is the honest half. */
  const lowerStmts = (list, scope, rootHoist = false) => {
    const out = []
    const outerStmtSink = stmtHoistSink
    stmtHoistSink = null
    try {
    for (let i = 0; i < list.length; i += 1) {
      // ⭐ RE-ESTABLISHED PER STATEMENT so it survives a nested list lowered
      // mid-statement, and it always points at THIS list's `out` — which holds
      // every statement lowered so far, i.e. exactly the position immediately
      // before the statement being lowered now.
      if (rootHoist) stmtHoistSink = out
      const st = list[i]
      const toks = st.header || []
      if (!toks.length) continue
      diagnostics.statements += 1
      const first = toks[0]
      lastStmtTok = first
      const word = first.kind === 'ident' ? first.value : null

      // ── declarations of the script itself ──
      if (word === 'indicator' || word === 'study') continue
      if (word === 'strategy' || word === 'library') {
        throw new RuntimeRefusal('runtime:declaration', `\`${word}()\``, locate(first))
      }
      if (word === 'import' || word === 'export') {
        throw new RuntimeRefusal('runtime:declaration', `\`${word}\``, locate(first))
      }
      // ⭐⭐ A `type` DECLARATION EMITS NO IR AND IS NOT SKIPPED BLIND. It was
      // registered by `collectUdtTypes` before the walk — see there for why a
      // pre-pass rather than this line is what makes a forward reference work.
      // ⛔ WHAT STILL REFUSES IS A DECLARATION THIS LANE COULD NOT READ. A
      // `type` whose field lines yielded nothing is not an empty type; it is a
      // type whose shape this lane does not know, and constructing one would
      // make every later `f.field` read as the MEMBER's misspelling.
      // ⚠️ `type = input(…)` never reaches here as a declaration — see
      // `collectUdtTypes` — and falls through to the ordinary binding path,
      // which is what `screener-mean-reversion-channel` needs.
      // ⛔ THE SAME TEST AS `collectUdtTypes`, AND IT HAS TO BE: a shape that
      // registry does not treat as a declaration must not be skipped as one
      // here, or `type = input(…)` loses its binding and every later read of
      // `type` refuses as an unbound name. `udtTypes.get` below is what keeps
      // them in step — a `type` statement the registry never saw has no entry
      // and refuses by name rather than being silently dropped.
      if (word === 'type' && toks[1] && toks[1].kind === 'ident') {
        const decl = udtTypes.get(toks[1].value)
        if (!decl || !decl.fields.length) {
          note('runtime:udt')
          throw new RuntimeRefusal('runtime:udt',
            `\`type ${toks[1].value}\` — this lane read no fields from it`, locate(first))
        }
        continue
      }
      // ⛔ A PINE 6 `method` IS A USER FUNCTION WITH A RECEIVER, AND IT GETS ITS
      // OWN GUARD RATHER THAN SHARING `runtime:udt`. The two are separately
      // schedulable — a method needs the function table to bind a receiver as
      // argument 0 and `ufcs.js` to route the call form to it — and one label
      // over both is exactly the mis-sizing `RUNTIME_REFUSALS`'s own header
      // records three previous instances of.
      if (word === 'method') {
        note('runtime:udt-method')
        throw new RuntimeRefusal('runtime:udt-method',
          toks[1] && toks[1].kind === 'ident' ? `\`${toks[1].value}\`` : null, locate(first))
      }
      if (word === 'varip') { note('runtime:varip'); throw new RuntimeRefusal('runtime:varip', null, locate(first)) }
      // ⭐⭐ `for name = from to to [by step]`. `while` keeps the old refusal —
      // neither acceptance script uses one, and a loop whose bound is re-read
      // every pass is a different termination argument from this one's.
      if (word === 'for') {
        const nameTok = toks[1]
        if (!nameTok || nameTok.kind !== 'ident' || !isPunct(toks[2], '=')) {
          throw new RuntimeRefusal('runtime:statement',
            'a `for` needs `name = from to to`', locate(first))
        }
        const rest = toks.slice(3)
        const toAt = findTop(rest, (x) => x.kind === 'ident' && x.value === 'to')
        if (toAt < 0) {
          throw new RuntimeRefusal('runtime:statement',
            'a `for` needs a `to` bound', locate(first))
        }
        const after = rest.slice(toAt + 1)
        const byAt = findTop(after, (x) => x.kind === 'ident' && x.value === 'by')
        const fromToks = rest.slice(0, toAt)
        const toToks = byAt < 0 ? after : after.slice(0, byAt)
        const byToks = byAt < 0 ? null : after.slice(byAt + 1)
        if (!fromToks.length || !toToks.length || (byAt >= 0 && !byToks.length)) {
          throw new RuntimeRefusal('runtime:statement',
            'a `for` bound is missing its expression', locate(first))
        }
        // ⛔ THE BOUNDS ARE LOWERED IN THE OUTER SCOPE, THE BODY IN A NEW ONE.
        // The counter must not be visible to its own bounds (`for i = i to 3`
        // is not a Pine program), and must not outlive the loop.
        const fromIr = lowerExpr(parseWholeExpression(fromToks), scope)
        const toIr = lowerExpr(parseWholeExpression(toToks), scope)
        const stepIr = byToks ? lowerExpr(parseWholeExpression(byToks), scope) : num(1)
        const inner = new Scope(scope)
        const slot = inner.declare(nameTok.value, newSlot(nameTok.value, false))
        // ⭐ The once-evaluated bound and step need somewhere to live that the
        // member cannot name, so they get slots with names no Pine identifier
        // can collide with.
        const toSlot = newSlot(`${nameTok.value} to`, false)
        const stepSlot = newSlot(`${nameTok.value} by`, false)
        const body = lowerStmts(st.sub || [], inner)
        // ⭐⭐ THE PER-ITERATION VALUES RIDE THE MEMBER'S OWN LOOP.
        //
        // They used to be emitted as a PARALLEL loop at the end of the program,
        // and that loop's counter was declared fresh so it would resolve — but
        // its BOUNDS were still lowered at ROOT scope, and the corpus idiom
        // puts them inside `if barstate.islast`:
        //
        //     if barstate.islast
        //         int rowCount = array.size(sortedPositions)
        //         for row = 0 to rowCount - 1
        //
        // `rowCount` does not exist at root, so the bound refused
        // `pine:undefined` about a name that is plainly defined two lines up.
        // Declaring the counter fixed half of one bug and left the other half.
        //
        // ⭐ Riding the real loop fixes both halves and removes the duplicate:
        // the bounds, the counter, the enclosing `barstate.islast` guard and
        // the scope are the member's own, by construction rather than by being
        // reconstructed. Nothing here has to agree with anything.
        const waiting = iterPending.get(nameTok.value)
        iterCounterSeen.set(nameTok.value, (iterCounterSeen.get(nameTok.value) || 0) + 1)
        if (waiting && waiting.length) {
          iterPending.delete(nameTok.value)
          for (const { i, spec } of waiting) {
            // ⛔ THE KIND IS DECIDED IN `inner`, where the counter exists. A
            // per-row cell's text usually READS the counter, so asking this in
            // any other scope answers about a different expression.
            const kind = holdsText(spec.node, inner) ? 'text' : 'num'
            iterOutputs[i] = { kind }
            objectIterTreeKinds[i] = kind
            body.push(emitIter(i, read(slot), lowerExpr(spec.node, inner)))
          }
        }
        out.push(forStmt({ slot, toSlot, stepSlot, from: fromIr, to: toIr, step: stepIr, body }))
        continue
      }
      if (word === 'break') { out.push(breakStmt()); continue }
      if (word === 'continue') { out.push(continueStmt()); continue }
      if (BLOCK_WORDS.has(word)) { note('runtime:loop'); throw new RuntimeRefusal('runtime:loop', `\`${word}\``, locate(first)) }
      if (word === 'switch') { note('runtime:switch'); throw new RuntimeRefusal('runtime:switch', null, locate(first)) }

      // ── a user function definition: `f(a, b) => …` ──
      {
        const arrow = findTop(toks, (t) => isPunct(t, '=>'))
        if (arrow > 0) {
          // ⭐⭐ R2 STEP 5 — A DEFINITION THIS LANE CANNOT COMPILE IS NOT FATAL
          // UNTIL SOMETHING CALLS IT.
          //
          // ⚰️ MEASURED ON `uncharted-volume-v2.pine`: the whole program refused
          // at `pine:text-value@153`, `f_getTablePos` — a three-line helper that
          // maps an `input.string` to a `position.*` enum and is called by
          // NOTHING this lane models. It positions a table. Compiling every
          // definition eagerly made an unreachable helper's text the reason a
          // 34,378-character script produced zero columns, and the refusal named
          // a line whose value no column depends on.
          //
          // ⛔ NOTHING IS DROPPED (§18). The refusal is KEPT against the name and
          // re-raised at the first call site, so a script that genuinely needs
          // the function still refuses — at the CALL, which is the line a member
          // would have to change. A function nobody calls is reported as a
          // diagnostic instead, so "unreachable" is a measurement and not a
          // silence.
          try {
            defineFunction(st, toks, arrow)
          } catch (err) {
            const nameTok = toks[0]
            const fname = nameTok && nameTok.kind === 'ident' ? nameTok.value : null
            if (!fname) throw err
            // ⛔ THE HALF-BUILT RECORD MUST GO, NOT JUST STOP COMPILING.
            // `defineFunction` registers the record BEFORE compiling the body so
            // a self-call reads as recursion; a body that then throws leaves a
            // record with `frameSize 0` and its parameters still declared, and
            // `makeIrProgram` correctly refuses that — "functions[0] `f_pos`:
            // frameSize 0 cannot be smaller than its 1 parameters", a refusal
            // about our own leftovers rather than about the script.
            const idx = fnByName.get(fname)
            if (idx !== undefined) {
              // ⛔ THE HALF-BUILT RECORD GOES; THE NAME STAYS. `defineFunction`
              // registers before compiling so a self-call reads as recursion, and
              // a body that throws leaves a record with `frameSize 0` and its
              // parameters declared — which `makeIrProgram` then refuses, with a
              // sentence about OUR leftovers rather than about the script.
              // ⛔ But the NAME must remain in `fnByName`: it is what routes a
              // call to the user-function arm at all. Delete it and
              // `f_pos('Top Left')` reads as an unknown builtin and reports
              // `pine:function` — "there is no such function" — about a function
              // the member can see three lines up. The deferred refusal is
              // re-raised before the index is ever dereferenced.
              if (idx === functions.length - 1) functions.pop()
              else if (functions[idx]) functions[idx].compiling = false
            }
            deferredFnRefusals.set(fname, err)
            const at = locate(nameTok)
            skippedFunctions.push(
              `${fname}@${at ? at.line : '?'} ${err && err.guard ? err.guard : 'refused'}`)
          }
          continue
        }
      }

      // ── tuple destructuring: `[a, b] = …` ──
      if (isPunct(first, '[')) {
        const close = toks.findIndex((x) => isPunct(x, ']'))
        const eqAt = close > 0 ? close + 1 : -1
        if (close < 0 || !isPunct(toks[eqAt], '=')) {
          note('runtime:tuple')
          throw new RuntimeRefusal('runtime:tuple',
            'a bracket list outside a destructuring', locate(first))
        }
        const nameToks = toks.slice(1, close).filter((x) => x.kind === 'ident')
        if (nameToks.length < 2) {
          throw new RuntimeRefusal('runtime:statement',
            'a destructuring binds at least two names', locate(first))
        }
        const rhs = parseWholeExpression(toks.slice(eqAt + 1))
        // ⛔ THE COUNT IS CHECKED WHERE IT IS KNOWN. A UDF's result count is
        // recorded on its definition, so a mismatch is refused by name here
        // rather than padded with `na` — a padded name is a table column full
        // of blanks with no reason given.
        const lowered = lowerExpr(rhs, scope, { multi: true })
        if (lowered && lowered.kind === EXPR.REQUEST) {
          // ⭐ A REQUEST KNOWS ITS OWN RESULT COUNT, recorded when its value
          // expression was lowered, so the same by-name mismatch refusal
          // applies to `[a, b] = request.security(…, [x, y])`.
          if (lowered.results !== nameToks.length) {
            throw new RuntimeRefusal('runtime:statement',
              `this line unpacks ${nameToks.length} names from a request that `
              + `returns ${lowered.results}`, locate(first))
          }
        } else if (lowered && lowered.kind === EXPR.CALL) {
          const fnRec = functions[lowered.fn]
          const gives = fnRec && fnRec.returns ? fnRec.returns : 1
          if (gives !== nameToks.length) {
            throw new RuntimeRefusal('runtime:statement',
              `this line unpacks ${nameToks.length} names from a call that returns ${gives}`,
              locate(first))
          }
        } else if (!lowered || lowered.kind !== EXPR.TUPLE) {
          throw new RuntimeRefusal('runtime:tuple',
            'the right of a destructuring must produce several values', locate(first))
        } else if (lowered.elements.length !== nameToks.length) {
          throw new RuntimeRefusal('runtime:statement',
            `this line unpacks ${nameToks.length} names from ${lowered.elements.length} values`,
            locate(first))
        }
        const slotsOut = nameToks.map((nt) => scope.declare(nt.value, newSlot(nt.value, false)))
        out.push(destructure(slotsOut, lowered))
        continue
      }

      // ── if / else if / else ──
      //
      // ⚰️⚰️ P7.4 — THIS READ `else if` AS A ONE-ELEMENT LIST AND LOST THE REST
      // OF THE CHAIN. The old line was:
      //
      //     lowerStmts([{ header: elseToks, body: nxt.body, sub: nxt.sub }], elseScope)
      //
      // The nested call therefore saw a list of LENGTH ONE, so when that inner
      // `if` looked at `list[i + 1]` for its own `else` there was nothing there —
      // every remaining arm was still sitting in the OUTER list. The outer loop
      // then walked onto the next `else if` with no `if` in front of it and
      // refused `runtime:statement`: "`else` with no `if`".
      //
      // ⛔⛔ SO `if / else` WORKED AND `if / else if / else` DID NOT, while the
      // completion matrix claimed the whole family was green — because the
      // SHIPPED COLUMNAR DOOR does handle chains, and a spot check there
      // corroborated a claim about a front end that could not do it at all. Two
      // corpus scripts sat on this, one of them only visible after 2F-2A removed
      // the history wall in front of it.
      //
      // ⭐ THE FIX IS TO COLLECT THE WHOLE CHAIN FIRST, then fold it. Nothing is
      // left in the outer list, and `i` advances past every arm the chain owns.
      if (word === 'if') {
        const arms = [{ test: parseWholeExpression(toks.slice(1)), from: st }]
        let finalElse = null
        for (;;) {
          const nxt = list[i + 1]
          const nxtWord = nxt && nxt.header && nxt.header[0] && nxt.header[0].kind === 'ident'
            ? nxt.header[0].value : null
          if (nxtWord !== 'else') break
          const elseToks = nxt.header.slice(1)
          i += 1
          if (elseToks.length && elseToks[0].kind === 'ident' && elseToks[0].value === 'if') {
            arms.push({ test: parseWholeExpression(elseToks.slice(1)), from: nxt })
            continue
          }
          finalElse = nxt
          break
        }
        // ⭐ LOWERED IN SOURCE ORDER, ASSEMBLED BACKWARDS. The two are different
        // orders and both matter: lowering allocates columns, slots and history
        // rings, so doing it back-to-front would number the artifact by an order
        // nobody wrote. Assembly has to run last-arm-first because each arm's
        // `else` IS the rest of the chain.
        // ⭐ THE BRANCH SCOPE AND ITS BODY ARE RECORDED, for the object trees.
        // A drawing's values live inside `if barstate.islast` — the corpus
        // idiom — so a tree over them can only be lowered here. See
        // `objectBlocks` where they are placed.
        // ⛔⛔ THE TEST IS LOWERED BEFORE THE BODY, and that is SOURCE ORDER,
        // not a style. ⚰️ Recording the scopes here first inverted it — the
        // object literal below used to evaluate `test` then `body`, and a
        // rewrite that computed `body` first flipped them. The cost was not a
        // mis-numbered artifact but a MOVED REFUSAL: `if not isRatioSymbol` at
        // v2:249 reads `syminfo.ticker`, and with the body lowered first the
        // `lookahead` refusal twelve lines INSIDE that body fired instead. The
        // symbol seam silently stopped being reached, so a script that needs a
        // symbol nobody supplied walked straight past the guard that says so —
        // and the "with symbol / without symbol" pair read identically, which
        // is exactly the control `irSymbolFold` exists to be.
        const lowered = arms.map((a) => {
          const test = lowerExpr(a.test, scope)
          const armScope = new Scope(scope)
          const body = lowerStmts(a.from.sub || [], armScope)
          objectBlocks.push({ scope: armScope, body })
          return { test, body }
        })
        let tail = []
        if (finalElse) {
          const elseScope = new Scope(scope)
          tail = lowerStmts(finalElse.sub || [], elseScope)
          objectBlocks.push({ scope: elseScope, body: tail })
        }
        // ⛔ NESTED IFs, NEVER A FLATTENED CONDITION. `else if b` is not `if not a
        // and b` — the runtime must not evaluate a later arm's test after an
        // earlier one matched, and nesting is what makes that structural rather
        // than a rule somebody has to remember.
        let chain = tail
        for (let k = lowered.length - 1; k >= 0; k -= 1) {
          chain = [ifStmt(lowered[k].test, lowered[k].body, chain)]
        }
        out.push(chain[0])
        continue
      }
      if (word === 'else') {
        // Reached only when an `else` has no `if` before it.
        throw new RuntimeRefusal('runtime:statement', '`else` with no `if`', locate(first))
      }

      // ── reassignment: `name := expr` ──
      const walrus = findTop(toks, (t) => isPunct(t, ':='))
      if (walrus > 0) {
        const nameTok = toks[walrus - 1]
        if (!nameTok || nameTok.kind !== 'ident') {
          throw new RuntimeRefusal('runtime:statement', 'a reassignment target must be a name', locate(first))
        }
        const value = parseWholeExpression(toks.slice(walrus + 1))
        // ⭐⭐ `ob.top := x` — A FIELD WRITE, WHICH IS NOT A SLOT ASSIGNMENT.
        //
        // ⛔⛔ TESTED BEFORE THE HANDLE SKIP BELOW, AND THAT ORDER IS LOAD-
        // BEARING. `ob.orderBox := box.new(…)` satisfies `holdsObjectCall`, so
        // the skip would `continue` past it — and a skipped write leaves the
        // field holding the `na` its declaration gave it, so every later
        // `ob.orderBox` reads absent for a box the object program HAS drawn.
        // That is `collections.js`'s own argument about why `na` is the wrong
        // answer for a drawing, arriving through a different door.
        // ⭐ The skip is right for a BARE NAME (`lb := label.new(…)`), where
        // this lane never declared a slot at all; a field always exists.
        if (nameTok.value.indexOf('.') > 0) {
          const path = fieldPathOf({ type: 'name', name: nameTok.value, tok: nameTok }, scope)
          if (path) {
            const last = path.steps[path.steps.length - 1]
            // ⭐ THE TYPE THAT OWNS THE FIELD BEING WRITTEN — for `a.b` that is
            // `a`'s, for `a.b.c` it is `a.b`'s. `fieldPathOf` answered for the
            // WHOLE path one line up, so the prefix necessarily resolves too.
            // ⛔ AND IT IS STILL NULL-CHECKED. "Necessarily" is a claim about
            // today's `fieldPathOf`; a `.type` straight off a null would surface
            // to the member as a TypeError wearing a refusal's clothes, which is
            // the failure this file records paying for twice.
            const prefix = path.steps.length === 1 ? null : fieldPathOf({
              type: 'name',
              name: `${path.head}.${path.steps.slice(0, -1).join('.')}`,
              tok: nameTok,
            }, scope)
            const ownerType = path.steps.length === 1
              ? udtTypeOf({ type: 'name', name: path.head, tok: nameTok }, scope)
              : (prefix && prefix.type)
            const spec = ownerType ? fieldSpec(ownerType, last) : null
            if (!spec) {
              note('runtime:udt-field')
              throw new RuntimeRefusal('runtime:udt-field',
                `\`${nameTok.value}\` — this lane cannot name the type that owns `
                + `\`${last}\``, locate(nameTok))
            }
            const target = path.steps.slice(0, -1).reduce(
              (acc, f) => irField(acc, f),
              lowerExpr({ type: 'name', name: path.head, tok: nameTok }, scope))
            out.push(irFieldSet(target, last, lowerFieldValue(spec, value, scope, { tok: nameTok })))
            continue
          }
          const headType = udtHeadOf({ type: 'name', name: nameTok.value, tok: nameTok }, scope)
          if (headType) {
            note('runtime:udt-field')
            throw new RuntimeRefusal('runtime:udt-field',
              `\`${nameTok.value}\` — \`${headType}\` declares no such field`, locate(nameTok))
          }
        }
        // ⭐⭐ `lb := label.new(…)` — THE THIRD BINDING PATH, AND THE ONE REAL
        // PINE USES MOST. The corpus idiom for a drawing is `var label lb = na`
        // followed by a reassignment, so the handle is declared empty and only
        // ever filled here. ⛔ The other two spellings are skipped at their own
        // declarations; this one arrives as an ASSIGNMENT and was refused at
        // `runtime:object-op` — measured on the shape above, which is the most
        // common way to draw anything in Pine.
        //
        // ⛔ SKIPPED BEFORE THE SLOT IS LOOKED UP, deliberately: this lane never
        // declared a slot for the handle (its `var … = na` declaration is a
        // handle binding too), so asking for one first would refuse at
        // `runtime:unbound` and blame the wrong statement.
        noteHandle(nameTok.value, value)
        if (objectPassOwnsDrawing && holdsObjectCall(value)) continue
        const slot = scope.lookup(nameTok.value)
        if (slot === null) {
          throw new RuntimeRefusal('runtime:unbound', `\`${nameTok.value}\` is reassigned before it is declared`, locate(nameTok))
        }
        out.push(assign(slot, lowerExpr(value, scope)))
        continue
      }

      // ── `var name = expr` ──
      if (word === 'var') {
        const eq = findTop(toks, (t) => isPunct(t, '='))
        const nameTok = eq > 0 ? boundName(toks, eq) : null
        if (!nameTok) throw new RuntimeRefusal('runtime:statement', 'a `var` declaration needs a name and an initialiser', locate(first))
        const value = parseWholeExpression(toks.slice(eq + 1))
        // ⭐ THE BOUND NAME IS STAMPED ONTO AN INPUT CALL, exactly as `pine.js`
        // does, because it is the KEY a member's saved value is stored under.
        // Without it a text input can only ever serve the author's default, and
        // the member's paste would be silently ignored.
        if (value && value.type === 'call' && typeof value.name === 'string'
            && (value.name === 'input' || value.name.startsWith('input.'))) {
          value.boundName = nameTok.value
        }
        // ⭐⭐ `var t = table.new(…)` BINDS A HANDLE, AND A HANDLE IS NOT A
        // NUMBER. The object program owns that table; this lane has no
        // representation for one and nothing here will ever read it.
        //
        // ⛔ SO THE DECLARATION IS SKIPPED ENTIRELY, rather than declared with a
        // placeholder value. `num(NaN)` was tried and `ir.js` REFUSED IT — "a
        // num carries a finite number" — and that guard is right: a NaN const
        // reaching the pool is how a drawing coordinate silently becomes
        // nothing. ⭐ Skipping also gives the better failure: a name this lane
        // never declared refuses LOUDLY at `pine:undefined` if anything outside
        // a drawing call reads it, instead of quietly yielding `na`.
        noteHandle(nameTok.value, value)
        if (objectPassOwnsDrawing && holdsObjectCall(value)) continue
        const slot = scope.declare(nameTok.value, newSlot(nameTok.value, true))
        // ⭐ MARKED BEFORE THE INITIALISER IS LOWERED, so a later read of this
        // name answers `holdsText` correctly — and before the ASSIGNMENTS are,
        // which is what makes `s := "cd"` route out of the columnar lane too.
        if (holdsText(value, scope)) slots[slot].text = true
        // ⭐ MARKED AT THE BINDING, like text. Without it a MUTABLE colour
        // slot answers `holdsColour` false one statement later, and
        // `bgcolor(c)` is refused for a `c` that plainly holds a colour.
        if (holdsColour(value, scope)) slots[slot].colour = true
        // ⭐ THE `var` BRANCH MARKS THE ELEMENT KIND TOO. It marked text and
        // colour and not this, so `var syms = array.from("AAPL", "MSFT")` — the
        // way every watchlist in the corpus is declared — left the slot with no
        // element kind, and a per-row buffer built from it was allocated numeric
        // and threw on the first symbol.
        if (holdsArray(value, scope)) {
          slots[slot].collection = true
          slots[slot].elemText = arrayHoldsText(value, scope)
        }
        // ⭐⭐ MARKED AT THE BINDING, exactly as text, colour and the element
        // kind are, and for the same reason all three are: without it the NEXT
        // statement's `p.x` cannot tell a record from a number, and the field
        // path would fall through to `runtime:unbound` naming a variable called
        // `p.x` that nobody wrote.
        // ⛔ FROM THE DECLARED TYPE, never from the name. See `udtTypeOf`.
        markUdtSlot(slot, value, scope, toks, eq)
        out.push(declare(slot, lowerExpr(value, scope)))
        continue
      }

      // ── an output call ──
      if (word && OUTPUT_CALLS.has(word) && isPunct(toks[1], '(')) {
        emitOutputCall(word, parseWholeExpression(toks), scope, out, locate(first))
        continue
      }

      // ── an output call BOUND TO A NAME: `p = plot(close)` ──
      //
      // ⚰⚰ THIS SILENTLY LOST THE PLOT. `plot(close)` as a STATEMENT emitted an
      // output; the same call on the right of a binding fell through to the
      // ordinary-binding path, which lowered it as an expression and bound the
      // name — so `p = plot(close)` compiled, reported `ok`, and drew NOTHING.
      // Measured: `p = plot(close)` then `plot(open)` produced ONE output
      // carrying `open`. The author's first line vanished with nothing red.
      //
      // ⛔⛔ AND IT IS THE STANDARD IDIOM WHEREVER `fill` IS USED — `fill` takes
      // plot IDs, so every one of the 64 corpus scripts that fills a band binds
      // its plots first. A refusal would have been far better than this: a
      // member reads a chart with a line missing and no reason given.
      if (word !== null && (() => {
        const e = findTop(toks, (x) => isPunct(x, '='))
        if (e <= 0) return false
        const v = toks[e + 1]
        return v && v.kind === 'ident' && OUTPUT_CALLS.has(v.value) && isPunct(toks[e + 2], '(')
      })()) {
        const e = findTop(toks, (x) => isPunct(x, '='))
        const nameTok = boundName(toks, e)
        if (!nameTok) throw new RuntimeRefusal('runtime:statement', 'a binding needs a name', locate(first))
        const callName = toks[e + 1].value
        const index = emitOutputCall(callName, parseWholeExpression(toks.slice(e + 1)),
          scope, out, locate(first))
        // ⭐ A PLOT ID IS A COMPILE-TIME HANDLE, NEVER A RUNTIME VALUE. Pine's
        // plot ids cannot be computed, compared or stored — they exist so that
        // `fill` can name two plots. Binding one in `env` (rather than a slot)
        // is what lets `fill` resolve it without the VM carrying a value it
        // could not do anything with.
        plotRefs.set(nameTok.value, { call: callName, index, at: locate(nameTok) })
        continue
      }

      // ── an ordinary binding: `name = expr` ──
      const eq = findTop(toks, (t) => isPunct(t, '='))
      if (eq > 0) {
        const nameTok = boundName(toks, eq)
        if (!nameTok) throw new RuntimeRefusal('runtime:statement', 'a binding needs a name', locate(first))
        const value = parseWholeExpression(toks.slice(eq + 1))
        // ⭐⭐ THE HYBRID DECISION, MADE ONCE PER BINDING. A name this script
        // never mutates, bound to a pure expression, stays a PURE BINDING in the
        // resolver's environment — so `ta.sma(close, len)` is still one column at
        // columnar speed. A name that IS mutated, or one whose initialiser reads
        // a slot, becomes a runtime slot.
        // ⭐ THE BOUND NAME IS STAMPED ONTO AN INPUT CALL, exactly as `pine.js`
        // does, because it is the KEY a member's saved value is stored under.
        // Without it a text input can only ever serve the author's default, and
        // the member's paste would be silently ignored.
        if (value && value.type === 'call' && typeof value.name === 'string'
            && (value.name === 'input' || value.name.startsWith('input.'))) {
          value.boundName = nameTok.value
        }
        const mutable = mut.mutated.has(nameTok.value)
        // ⛔⛔ A COLLECTION BINDING IS ALWAYS A SLOT, NEVER AN `env` MACRO. A
        // name bound in `env` is SUBSTITUTED at each use, so `a = array.new<string>()`
        // followed by `array.push(a, x)` and `array.size(a)` would build a FRESH
        // empty array at every mention — the push would land in one array and the
        // size be read from another, reporting 0 forever with nothing red. Pine's
        // arrays are references; a reference needs somewhere to live.
        // ⚰️ A THIRD HANDLE SKIP WAS ADDED HERE AND REMOVED. `t = table.new(…)`
        // without `var` is absorbed by the `env` macro path a few lines below —
        // it reads no slot and is not mutated, so it is bound as an expression
        // and never lowered — and a mutation could not tell the skip's presence
        // from its absence. The proved copies are the `var` branch above and the
        // `:=` branch; this one read as protection and was not
        // (`lesson_a_guard_repeated_is_a_guard_unproved`).
        noteHandle(nameTok.value, value)
        const isCollection = holdsArray(value, scope)
        // ⛔⛔ A RECORD BINDING IS ALWAYS A SLOT, NEVER AN `env` MACRO — an
        // `env` macro is SUBSTITUTED at each use, so `ob = orderBlock.new(…)`
        // followed by `ob.top := x` and a read of `ob.top` would build a FRESH
        // record at every mention: the write lands in one instance and the read
        // comes from another, answering the default forever with nothing red.
        //
        // ⭐ AND `readsSlot` ALREADY ENFORCES IT — its `udtCtorOf` clause is
        // what makes a construction reach the runtime lane, and every other way
        // to obtain a record (a name, an element read, a ternary) reads a slot
        // by construction. ⚰️ A dedicated `!isRecord(value, scope)` clause was
        // written here too and is gone on its own measurement: removing it left
        // every case green, because nothing can produce a record while reading
        // no slot. `frontend-needsRuntime-ctor` is the mutation that holds the
        // surviving half.
        if (!mutable && !isCollection && !readsSlot(value, scope)) {
          env.set(nameTok.value, { kind: 'expr', node: value, env: new Map(env), at: locate(nameTok) })
          continue
        }
        const slot = scope.declare(nameTok.value, newSlot(nameTok.value, mut.persistent.has(nameTok.value)))
        if (holdsText(value, scope)) slots[slot].text = true
        // ⭐ MARKED AT THE BINDING, like text. Without it a MUTABLE colour
        // slot answers `holdsColour` false one statement later, and
        // `bgcolor(c)` is refused for a `c` that plainly holds a colour.
        if (holdsColour(value, scope)) slots[slot].colour = true
        if (isCollection) {
          slots[slot].collection = true
          slots[slot].elemText = arrayHoldsText(value, scope)
        }
        markUdtSlot(slot, value, scope, toks, eq)
        out.push(declare(slot, lowerExpr(value, scope)))
        continue
      }

      // ── `fill(a, b, colour)` — the band between two plots ──
      if (word === 'fill' && isPunct(toks[1], '(')) {
        emitFill(parseWholeExpression(toks), scope, out, locate(first))
        continue
      }

      // ── a bare call statement ──
      if (word && isPunct(toks[1], '(')) {
        if (PRESENTATION_CALLS.has(word)) {
          note('runtime:presentation')
          throw new RuntimeRefusal('runtime:presentation', `\`${word}()\``, locate(first))
        }
        if (DIRECTIVE_CALLS.has(word)) {
          note('runtime:directive')
          throw new RuntimeRefusal('runtime:directive', `\`${word}()\``, locate(first))
        }
        // ⭐⭐ THE FIRST STATEMENT IN THIS RUNTIME THAT EXISTS FOR ITS EFFECT.
        // `array.push(a, x)` returns nothing and changes the collection, so it is
        // lowered as an expression statement — which `lowerIr` admits for a VOID
        // collection call and still refuses for everything else.
        //
        // ⚠️ IT BELONGS HERE, NOT IN THE DOTTED BRANCH BELOW. A namespaced
        // BUILTIN name arrives as ONE ident token, so `array.push(...)` matches
        // `word && isPunct(toks[1], '(')` with `word` already equal to
        // "array.push"; the dotted branch is for a different shape and never
        // sees it. Established from the refusal's own stack after two rounds of
        // reasoning about the wrong branch.
        if (isVoid(word)) {
          const callNode = parseWholeExpression(toks)
          if (!callNode || callNode.type !== 'call') {
            throw new RuntimeRefusal('runtime:statement',
              `\`${word}()\` is not a shape this front end reads`, locate(first))
          }
          out.push(exprStmt(admitArrayCall(callNode, scope, true)))
          continue
        }
        const f = callFamily(word)
        if (f === 'runtime:object-op' && objectPassOwnsDrawing) continue
        if (f) { note(f); throw new RuntimeRefusal(f, familyDetail(f, word), locate(first)) }
        // ── the METHOD FORM — `t.cell(…)` IS `table.cell(t, …)` ──────────
        //
        // ⛔⛔ IT IS THE SAME STATEMENT AS THE NAME FORM ABOVE AND MUST GET THE
        // SAME ANSWER. ⚰️ Measured before this landed: `t.cell(0, 0, txt)` on a
        // declared table refused `runtime:expression-statement` while
        // `table.cell(t, 0, 0, txt)` compiled and drew — one Pine operation,
        // two verdicts, decided by which spelling the author happened to use.
        // 211 method-form sites on a declared drawing handle across 19 of the
        // 266 committed scripts write the losing one.
        //
        // ⛔ THE RECEIVER MUST BE A NAME THIS LANE SAW BOUND TO A DRAWING, and
        // the family comes from that binding — never from the method name.
        // `delete` belongs to five families; guessing one would skip a statement
        // this lane should have refused.
        const uf = splitMethodName(word)
        if (uf && !definedNames.has(uf.method)) {
          const fam = drawingHandles.get(uf.recv)
          if (fam) {
            if (objectPassOwnsDrawing) continue
            note('runtime:object-op')
            throw new RuntimeRefusal('runtime:object-op',
              objectOpDetail(`${fam}.${uf.method}`), locate(first))
          }
          // ⭐ A COLLECTION RECEIVER GOES THROUGH `admitArrayCall`, THE ONE
          // ADMITTER — same arity check, same void rule, same lowering as a
          // hand-written `array.push(a, x)`. The rewrite happens first and
          // nothing below this line knows the spelling it came from.
          const rslot = scope.lookup(uf.recv)
          if (rslot !== null && slots[rslot] && slots[rslot].collection) {
            const rew = methodFormCall(parseWholeExpression(toks),
              () => 'array', (m) => definedNames.has(m))
            if (rew && ARRAY_FNS[rew.node.name]) {
              out.push(exprStmt(admitArrayCall(rew.node, scope, true)))
              continue
            }
            note('runtime:array')
            throw new RuntimeRefusal('runtime:array',
              familyDetail('runtime:array', `array.${uf.method}`), locate(first))
          }
        }
        // ⭐⭐ A USER FUNCTION CALLED FOR ITS EFFECT — PINE'S OWN STATEMENT FORM.
        //
        // `zigzag(Length, DeviationThreshold)` on a line of its own is how ten of
        // the 266 committed scripts drive their drawing: the helper opens the
        // lines, pushes the labels and mutates the arrays, and its RESULT (§16 —
        // the value of its last statement) is thrown away. Refusing the line said
        // *"an expression evaluated for effect — nothing in this runtime has an
        // effect yet"*, which stopped being true the moment `array.push` was
        // admitted two branches above: this lane has arrays, loops and state, and
        // a call is exactly how a script reaches them.
        //
        // ⛔⛔ IT IS LOWERED, NEVER SKIPPED. A skip compiles every one of those
        // ten scripts and is WRONG: the helper's `array.push` never runs, so the
        // collection the next line reads is empty and the dashboard renders real
        // numbers from a run that did not happen. Measured as an instrument (and
        // reverted): skipping moves `draws end to end` by ZERO, so the shortcut
        // buys nothing it could be traded for.
        //
        // ⛔ `isUserFn`, NOT `fnByName` — the same one authority the expression
        // position uses. A definition that died on its own parameter list is
        // known only by its held refusal, and asking `fnByName` alone would send
        // the call to the columnar resolver to be told there is no such function,
        // about a function the member can see a few lines up.
        if (isUserFn(word)) {
          const callNode = parseWholeExpression(toks)
          if (!callNode || callNode.type !== 'call') {
            throw new RuntimeRefusal('runtime:statement',
              `\`${word}()\` is not a shape this front end reads`, locate(first))
          }
          // ⭐⭐ `multi` IS WHAT MAKES A TUPLE-RETURNING HELPER LEGAL HERE, and
          // it is safe for the same reason a destructuring's is: every value the
          // call leaves is accounted for. The expression position refuses a
          // multi-value call because ONE of its values would be read and the
          // rest abandoned; a statement reads none and discards all.
          const lowered = lowerExpr(callNode, scope, { multi: true })
          // ⛔ THE COUNT COMES FROM THE COMPILED DEFINITION, NOT FROM THE CALL.
          // `lowerExpr` has just compiled the body if it was not already, so
          // `returns` is settled by now; deriving it from the call site would be
          // a guess that is right until a helper returns a pair.
          const fnIdx = fnByName.get(word)
          const rec = fnIdx === undefined ? null : functions[fnIdx]
          out.push(exprStmt(lowered, rec && rec.returns ? rec.returns : 1))
          continue
        }
        note('runtime:expression-statement')
        throw new RuntimeRefusal('runtime:expression-statement', `\`${word}()\``, locate(first))
      }
      // a dotted call statement — `label.new(...)`, `array.push(...)`
      if (word && isPunct(toks[1], '.') && toks[2] && toks[2].kind === 'ident') {
        const name = `${word}.${toks[2].value}`
        const f = callFamily(name)
        // ⚰️ A DRAWING SKIP WAS ADDED HERE AND REMOVED — a mutation proved this
        // branch never sees one. The lexer emits `table.cell` as a SINGLE ident
        // token, so an object statement goes through the bare-word branch above,
        // which is where the live skip is. This branch is for the shape where
        // the pieces arrive separately, and the note at `isVoid` above says the
        // same thing about `array.push`. Two copies of one guard cannot both be
        // proved, and the unreachable one reads as protection.
        if (f) { note(f); throw new RuntimeRefusal(f, familyDetail(f, name), locate(first)) }
        note('runtime:expression-statement')
        throw new RuntimeRefusal('runtime:expression-statement', `\`${name}()\``, locate(first))
      }

      throw new RuntimeRefusal('runtime:statement', null, locate(first))
    }
    } finally {
      stmtHoistSink = outerStmtSink
    }
    return out
  }

  /** ⭐⭐ A FUNCTION DEFINITION BECOMES A FIRST-CLASS SEMANTIC ENTITY (§4) —
   *  name, parameters, its own frame, its own persistent-local count, a body and
   *  a result. Not a macro, and not re-parsed at each call: the CODE is shared and
   *  only the state is per call site. */
  const defineFunction = (st, toks, arrow) => {
    const nameTok = toks[0]
    if (!nameTok || nameTok.kind !== 'ident' || !isPunct(toks[1], '(') || !isPunct(toks[arrow - 1], ')')) {
      throw new RuntimeRefusal('runtime:function',
        'a definition this front end reads as `name(params) =>`', locate(toks[0]))
    }
    // ⭐⭐ ONE PARSER FOR THE HEADER. `functionParams` is the translator's own,
    // exported rather than copied: it skips Pine's type words and qualifiers
    // (`float a`, `simple int n`) and answers null for a header this grammar
    // does not read. The copy that used to live here counted `float` as a
    // parameter, which surfaced as a wrong ARITY — a refusal that named the call
    // site and said nothing about the real cause.
    const params = functionParams(toks, arrow)
    if (params === null) {
      // ⛔ THE REFUSAL STILL NAMES THE TOKEN. `null` means "not this shape", and
      // the member needs to know which token stopped it; a default value is the
      // case this corpus actually hits, so it keeps its own sentence.
      const bad = toks.slice(2, arrow - 1).find(
        (t) => !isPunct(t, ',') && t.kind !== 'ident')
      throw new RuntimeRefusal('runtime:function',
        bad && isPunct(bad, '=')
          ? 'a parameter this front end cannot read (`=`) — default values are not supported yet'
          : `a parameter this front end cannot read${bad ? ` (\`${bad.value}\`)` : ''}`,
        locate(bad || toks[0]))
    }

    // ⭐ REGISTERED BEFORE ITS BODY IS COMPILED, so a self-call is caught as
    // RECURSION by name rather than reaching a depth limit and reporting
    // exhaustion for what is actually a Pine rule violation (§19).
    const fnIndex = functions.length
    const record = {
      name: nameTok.value, params: params.length, compiling: true,
      frameSize: 0, persistCount: 0, body: [], result: null,
      effects: null, at: locate(nameTok),
    }
    functions.push(record)
    fnByName.set(nameTok.value, fnIndex)

    const prevOwner = owner
    const prevGuard = guardOuter
    owner = fnIndex
    // ⛔ NO PARENT SCOPE. A Pine function cannot assign to a global, and reading
    // a global mutable slot from inside a frame would need a cross-frame address
    // this model deliberately does not have. `guardOuter` makes that a NAMED
    // refusal instead of a confusing "undefined name" about a name the member
    // can see two lines up.
    guardOuter = root
    const fnScope = new Scope(null)
    params.forEach((p, k) => fnScope.declare(p, newSlot(p, false, k)))

    // ⭐⭐ THE BODY IS ALSO KEPT AS AN AST, for the call sites that must lower it
    // THEMSELVES rather than share the compiled copy.
    //
    // ⛔⛔ A UDF INSIDE `request.security` CANNOT USE THE SHARED BODY, and the
    // reason is a wrong number rather than a missing one: the shared body was
    // lowered against THIS chart's bars, so its columns hold THIS symbol's
    // values — served under another symbol's heading. `carriesColumn` already
    // refuses that, correctly, and names re-lowering per requested symbol as the
    // next step. This is that step, for the shape the corpus actually writes.
    //
    // ⭐ TWO FORMS, AND THE NARROW ONE IS TRIED FIRST ON PURPOSE.
    //
    // `lines` is the SUBSTITUTION form: every body line is a plain `name = expr`
    // binding, so each becomes an `env` macro and the body is lowered in the
    // CALLER's context. ⛔ That is what makes a parameter FOLDABLE —
    // `calcDaily(simple int N) => ta.sma(volume[1], N)` sizes its window only
    // because `N` substitutes to the caller's literal rather than staying a
    // frame slot. Lowering it as statements instead would put `N` back in a slot
    // and re-break the measured case, so this path keeps priority.
    //
    // `body` is the STATEMENT form, kept for every block body including the ones
    // `lines` refuses. A `var`, a `:=` or an `if` is not substitutable — it is
    // state and control flow — but a request's region IS a statement sequence,
    // so those lines can be lowered INTO it. That is what `carriesColumn` named
    // as the next capability, and it is what lets a helper like
    // `isAbove30mOrb()` — `var` + `if` + a clock read — run per requested
    // symbol instead of against this chart's bars.
    record.inlineBody = (() => {
      try {
        if (arrow !== toks.length - 1) {
          return { params, lines: [], result: parseWholeExpression(toks.slice(arrow + 1)), body: null }
        }
        const lines = st.sub || []
        if (!lines.length) return null
        const readBind = (t) => {
          if (t.some((x) => isPunct(x, ':='))) return null
          if (t[0] && (t[0].value === 'var' || t[0].value === 'varip')) return null
          const eq = findTop(t, (x) => isPunct(x, '='))
          if (eq <= 0 || isPunct(t[0], '[')) return null
          const nt = boundName(t, eq)
          if (!nt) return null
          return { name: nt.value, node: parseWholeExpression(t.slice(eq + 1)) }
        }
        const narrow = (() => {
          const binds = []
          for (const ln of lines.slice(0, -1)) {
            if (ln.sub && ln.sub.length) return null
            const b = readBind(ln.header || [])
            if (!b) return null
            binds.push(b)
          }
          const last = lines[lines.length - 1]
          if (last.sub && last.sub.length) return null
          const lt = last.header || []
          const lb = readBind(lt)
          // A final binding yields the value it bound (Pine §16), so the result
          // is that expression — there is no name left to read it through.
          return { lines: binds, result: lb ? lb.node : parseWholeExpression(lt) }
        })()
        if (narrow) return { params, lines: narrow.lines, result: narrow.result, body: lines }
        return { params, lines: null, result: null, body: lines }
      } catch { return null }
    })()
    if (record.inlineBody) inlineBodyByName.set(nameTok.value, record.inlineBody)

    const sitesBefore = callSites.length
    try {
      let body = []
      let result = null
      if (arrow === toks.length - 1) {
        const lines = st.sub || []
        if (!lines.length) {
          throw new RuntimeRefusal('runtime:function', 'a body with no statements', locate(nameTok))
        }
        body = lowerStmts(lines.slice(0, -1), fnScope)
        // ⭐ PINE RETURNS THE VALUE OF THE LAST STATEMENT (§16) — not an explicit
        // `return`. A final binding yields the value it bound; a final bare
        // expression yields itself.
        const last = lines[lines.length - 1]
        const lt = last.header || []
        const eq = findTop(lt, (t) => isPunct(t, '='))
        const walrus = findTop(lt, (t) => isPunct(t, ':='))
        if (walrus > 0 || (eq > 0 && !isPunct(lt[0], '['))) {
          body = body.concat(lowerStmts([last], fnScope))
          const bound = walrus > 0 ? lt[walrus - 1] : boundName(lt, eq)
          const slot = bound ? fnScope.lookup(bound.value) : null
          if (slot === null) {
            throw new RuntimeRefusal('runtime:function',
              'a body whose last statement binds nothing this front end can return', locate(nameTok))
          }
          result = read(slot)
        } else {
          result = lowerResult(parseWholeExpression(lt), fnScope)
        }
      } else {
        result = lowerResult(parseWholeExpression(toks.slice(arrow + 1)), fnScope)
      }
      record.body = body
      record.result = result
      // ⭐ HOW MANY VALUES THIS FUNCTION HANDS BACK. A destructuring compares
      // its own name count against this, so a mismatch is named at the call
      // rather than discovered as a stack that does not balance.
      record.returns = result && result.kind === EXPR.TUPLE ? result.elements.length : 1
      record.frameSize = countFor(fnIndex, SLOT.LOCAL)
      record.persistCount = countFor(fnIndex, SLOT.PERSIST)
      // ⭐ EFFECT CLASSIFICATION PROPAGATES THROUGH THE CALL GRAPH (§25): a
      // function is pure only if it holds no persistent state AND every function
      // it calls is pure. Recorded, not yet exploited — see `needsRuntime`.
      const callsImpure = callSites.slice(sitesBefore)
        .some((cs) => !(functions[cs.fn].effects && functions[cs.fn].effects.pure))
      record.effects = { pure: record.persistCount === 0 && !callsImpure }
    } finally {
      record.compiling = false
      owner = prevOwner
      guardOuter = prevGuard
    }
  }

  let statements
  /** tree index → the OUTPUT index carrying its value, one per bar.
   *
   *  ⭐⭐ THE LANE SEAM, AND IT NEEDED NO NEW MACHINERY. An object program's
   *  value references are `{v:'tree', i}` and `bindObjectProgram(program, nodeOf)`
   *  is the ONE conversion that resolves them — it does not care whether `nodeOf`
   *  answers with a V2 graph node or with something else entirely. So a table
   *  driven by THIS lane is a `nodeOf` that answers with an output index, and a
   *  `readNode` that reads that output.
   *
   *  ⛔ WHY THIS LANE AT ALL, when the host lane already draws tables: the
   *  acceptance dashboard's cells come from `array<string>`/`array<float>` built
   *  in a loop and SORTED with a bubble sort. An object collection holds only
   *  OBJECTS (`line|label|box|table|linefill`) and the V2 graph is pure — "what
   *  is the number on this bar" — which a sort is not. Those arrays can only
   *  live where arrays and loops live, which is here.
   */
  const objectTreeOutputs = []
  /** Per-ITERATION buffers this program declares, and each one's kind.
   *  ⭐ The KINDS are reported back because the caller cannot know them: only
   *  this lane can say whether an expression yields text. */
  const iterOutputs = []
  const objectIterTreeKinds = []
  /** ⭐⭐ counter name → the iteration specs that belong to THAT loop.
   *
   *  The buffers are pre-sized in SPEC order and filled in as each loop is
   *  reached, because the caller pairs tree index to buffer index positionally
   *  — filling them in the order the loops happen to appear would silently
   *  re-point every per-row value in the table. */
  /** Every `if`-branch scope the walk opened, with the statement list it
   *  produced. ⭐ An object tree over a value declared inside a branch can only
   *  be lowered THERE, and appending to the recorded list really does reach the
   *  emitted `ifStmt` — it is the same array. */
  const objectBlocks = []
  const iterPending = new Map()
  /** How many lowered `for` loops carried each counter name — see the refusal
   *  at the end of the walk. */
  const iterCounterSeen = new Map()
  ;(opts.objectIterTrees || []).forEach((spec, i) => {
    iterOutputs.push(null)
    objectIterTreeKinds.push(null)
    const list = iterPending.get(spec.counter) || []
    list.push({ i, spec })
    iterPending.set(spec.counter, list)
  })
  try {
    // ⭐⭐ THE ONE `rootHoist` CALL SITE. Every other `lowerStmts` is a nested
    // list — a branch body, a loop body, a function body — and lowers with no
    // sink on purpose (see `stmtHoistSink`).
    statements = lowerStmts(stmts, root, true)
    // ⛔ AFTER THE WALK, ON THE FINISHED SCOPE. An object coordinate is an
    // ordinary expression over the script's own bindings, so it must resolve
    // through exactly the bindings a plot would see — the same rule the object
    // pass states for the columnar lane, for the same reason.
    for (const tree of (opts.objectTrees || [])) {
      outputs.push({ call: 'objtree', role: `tree ${objectTreeOutputs.length}` })
      const index = outputs.length - 1
      // ⛔⛔ A `null` ENTRY IS A PER-ROW TREE, HANDLED BY THE LOOP BELOW, and
      // it still takes an output slot so the caller's tree→output map stays
      // index-aligned. Lowering it HERE would resolve its counter at ROOT
      // scope, where that name does not exist — measured: `this Pine name was
      // never given a value — \`r\``, from a table whose rows were perfectly
      // well defined inside their loop. The placeholder is never read: the
      // reader checks the iteration buffers first.
      // ⭐⭐ LOWERED WHERE ITS NAMES LIVE, not always at root.
      //
      // ⚰️ Root was the only site until 2026-09-20, and the corpus idiom breaks
      // it: a dashboard computes `rowCount = array.size(sortedPositions)` INSIDE
      // `if barstate.islast` and writes `for row = 0 to rowCount - 1`. That
      // bound becomes an object tree, and at root `rowCount` does not exist — so
      // the script refused `pine:undefined` about a name defined two lines above
      // its use. The value genuinely only exists inside that branch, so there is
      // no root lowering to be had; the emit has to go where the name is.
      //
      // ⛔ ROOT IS STILL TRIED FIRST, so nothing that already resolved moves.
      // ⛔ AND AMBIGUITY IS REFUSED, NOT RESOLVED BY ORDER: a tree that resolves
      // inside two different branches is reading two different `rowCount`s, and
      // picking the earlier one paints a table of real numbers from the wrong
      // block — indistinguishable from a working one.
      if (tree === null) {
        statements.push(emit(index, num(0)))
      } else {
        const sites = []
        let rootIr = null
        try { rootIr = lowerExpr(tree, root) } catch { /* try the branches */ }
        if (rootIr) {
          statements.push(emit(index, rootIr))
        } else {
          // ⛔⛔ THE OUTERMOST BLOCK THAT RESOLVES IT WINS, and that is not a
          // tie-break — it is the only correct answer. A branch scope CHAINS to
          // its parent, so a value declared in `if barstate.islast` resolves
          // from every nested branch inside it too. Treating that as ambiguity
          // refused the acceptance dashboard with "resolves inside 6 different
          // blocks" when all six were the same binding seen from six depths.
          // ⛔ TWO CANDIDATES AT THE SAME DEPTH ARE STILL REFUSED: neither
          // encloses the other, so they really are different bindings.
          const depthOf = (s) => { let d = 0; for (let x = s; x; x = x.parent) d += 1; return d }
          for (const blk of objectBlocks) {
            try {
              sites.push({ blk, ir: lowerExpr(tree, blk.scope), depth: depthOf(blk.scope) })
            } catch { /* this block does not bind it */ }
          }
          if (sites.length === 0) {
            // Re-raise the ROOT failure: it names the missing binding, which is
            // the sentence a member can act on.
            lowerExpr(tree, root)
          }
          const best = Math.min(...sites.map((s) => s.depth))
          const outermost = sites.filter((s) => s.depth === best)
          if (outermost.length > 1) {
            throw new RuntimeRefusal('runtime:statement',
              `a drawing value resolves inside ${outermost.length} sibling blocks, so `
              + 'which one it belongs to cannot be settled', null)
          }
          outermost[0].blk.body.push(emit(index, outermost[0].ir))
        }
      }
      objectTreeOutputs.push(index)
    }
    // ⭐⭐ AND THE PER-ITERATION ONES, EACH AS ITS OWN LOOP.
    //
    // A value the object program reads once per ROW cannot be an output — an
    // output is one number per BAR. So each is lowered as a real loop over the
    // same bounds the drawing uses, writing one slot of an iteration buffer:
    //
    //     for <counter> = <from> to <to>
    //         buffer[<counter>] = <the value>
    //
    // ⛔ THE COUNTER IS A SLOT IN AN INNER SCOPE AND THE BOUNDS ARE LOWERED IN
    // THE OUTER ONE — the same rule Pine's own `for` follows a few hundred lines
    // above, for the same reason: `for i = i to 3` is not a program, and the
    // counter must not outlive its loop.
    //
    // ⛔ THE BUFFER'S KIND IS DECIDED HERE, NOT BY THE CALLER. The object pass
    // knows a cell wants text; only this lane knows whether the EXPRESSION
    // produces one, and a buffer allocated as the wrong container coerces every
    // value it holds — which is why the kinds are reported back.
    // ⭐⭐ THE FALLBACK: A SPEC THAT FOUND NO LOOP GETS ITS OWN.
    //
    // ⚰️ A first cut REPLACED this with the injection above and broke every
    // case that has no member `for` to ride — a caller may hand this lane
    // iteration specs directly, which is exactly what `iterTrees.test.js` does.
    // Injection is an ADDITION: it fixes the bound that only resolves inside a
    // block, and it must not remove the path that was already working.
    //
    // ⛔ THE BOUNDS RESOLVE AT ROOT HERE, which is the limitation injection
    // exists to lift — so this path still refuses a bound that names a
    // block-local, by the same `pine:undefined` it always did.
    for (const [, waiting] of iterPending) {
      for (const { i, spec } of waiting) {
        const inner = new Scope(root)
        const slot = inner.declare(spec.counter, newSlot(spec.counter, false))
        const kind = holdsText(spec.node, inner) ? 'text' : 'num'
        iterOutputs[i] = { kind }
        objectIterTreeKinds[i] = kind
        statements.push(forStmt({
          slot,
          toSlot: newSlot(`${spec.counter} to`, false),
          stepSlot: newSlot(`${spec.counter} by`, false),
          from: lowerExpr(spec.from, root),
          to: lowerExpr(spec.to, root),
          step: num(1),
          body: [emitIter(i, read(slot), lowerExpr(spec.node, inner))],
        }))
      }
    }
    iterPending.clear()
    // ⛔ AND THE MATCH IS BY COUNTER NAME, so two loops sharing one name would
    // make "which loop does this row belong to" unanswerable. Refused rather
    // than resolved by source order: the wrong choice paints a table of real
    // numbers taken from the wrong loop, which is indistinguishable from a
    // working one.
    for (const [name, n] of iterCounterSeen) {
      if (n > 1 && (opts.objectIterTrees || []).some((s) => s.counter === name)) {
        throw new RuntimeRefusal('runtime:statement',
          `two loops share the counter \`${name}\` and a per-row value is written `
          + 'against it, so which loop owns that value cannot be settled', null)
      }
    }
  } catch (e) {
    // ⭐⭐ R2 STEP 5 — THE SKIPPED LIST IS ATTACHED ON THE FAILING PATH TOO.
    // ⚰️ It was set after the walk's early returns, so a program that refused
    // for some LATER reason reported `skippedFunctions: undefined` — and the one
    // question a reader has at that moment is "what did this lane decide not to
    // compile before it got here". A diagnostic only present on success is a
    // diagnostic absent exactly when it is needed.
    if (skippedFunctions.length) diagnostics.skippedFunctions = [...skippedFunctions]
    // The fallback: a refusal that knows no location inherits the STATEMENT's,
    // so `line: null` never reaches a member. Marked `approximate` so nobody
    // later reads it as the offending sub-expression's own position.
    //
    // ⛔⛔ THE QUESTION IS `position(e)`, NOT `e.line`, AND THAT ONE WORD WAS THE
    // WHOLE DEFECT. The two refusal classes carry their position differently:
    // `RuntimeRefusal` FLATTENS `at` into `line`/`column`/`token` in its
    // constructor, while `PineRefusal` keeps the same object NESTED at `.at`
    // and never sets `.line` at all. So `e.line == null` is TRUE FOR EVERY
    // `PineRefusal`, whether or not it knows exactly where it is — and this
    // branch then overwrote a real position with the enclosing STATEMENT's and
    // stamped it approximate. `position(e)` asks the question this branch meant
    // to ask: does this refusal know where it is, IN EITHER VOCABULARY.
    //
    // ⭐ MEASURED OVER `corpus/committed`, 266 real scripts, before and after this
    // one word changed: scripts stopping on a refusal that cannot say where it
    // is went **96 (36.1%) → 2 (0.8%)**, and scripts stuck ANYWHERE went
    // 193 → 169 — because a tool that peels the refused LINE cannot move a
    // script whose refusal points at an innocent statement. The two survivors
    // are correct: both are bare `Error`s with no position to recover, which is
    // what this fallback exists for.
    //
    // ⚰️ `fail()` BELOW ALREADY READ BOTH FORMS, under a comment naming this
    // exact hazard — so the fix had landed in ONE of the two readers of one
    // fact, and the other ran first and clobbered it
    // (`lesson_a_guard_repeated_is_a_guard_unproved`). There is one authority
    // now: this branch asks the same helper `fail` does.
    //
    // ⛔ TWO EARLIER FIXES AIMED AT THE RAISE SITES WERE MEASURED AS NO-OPS on
    // the corpus count and reverted (`approximateRefusals.measure.test.js`'s
    // header keeps both tombstones). They changed nothing because the raise
    // sites were never the problem: they raised the position correctly and it
    // was discarded here, one frame later.
    if (e && position(e).line == null && lastStmtTok) {
      const at = locate(lastStmtTok)
      if (at) {
        e.line = at.line
        e.column = at.column
        e.token = at.token
        e.locationIsStatement = true
      }
    }
    return fail(e, diagnostics)
  }

  // ⭐⭐ CALL-SITE PERSISTENT BLOCKS ARE ALLOCATED AFTER THE WALK, because the
  // main program's own persistent count is only final once every statement has
  // been read. Main persists occupy the bottom of the array; each call site then
  // takes its own block — which is what makes two calls to one helper two
  // independent `var`s (§6/§7).
  {
    let base = countFor(null, SLOT.PERSIST)
    for (const cs of callSites) {
      cs.persistBase = base
      base += functions[cs.fn].persistCount
    }
  }

  // ⭐⭐⭐ P7.2 — AND THE HISTORY RINGS ARE ALLOCATED THE SAME WAY, for the same
  // reason. The main program's entries occupy the bottom of the table; each call
  // site then takes a block sized to its function's history-bearing locals. One
  // compiled body, one ring per SITE.
  //
  // ⛔⛔ THE ENTRY CARRIES ITS `site`, AND THAT IS WHAT THE COMMIT PHASE READS.
  // TradingView's ruling (fixture `skipped-callsite-history-spy-1d-2026-09-08`)
  // is that a function-local series is indexed by CHART BAR and HOLDS its value
  // across bars where the call site does not run — so the ring must be committed
  // every bar from a HELD cell the invocation writes, not from a frame local that
  // no longer exists. An entry that did not know its site could not have one.
  {
    let hbase = history.length
    for (const cs of callSites) {
      const fn = functions[cs.fn]
      const locals = fn.historyLocals || []
      cs.historyBase = hbase
      for (const h of locals) {
        history.push({ name: `${fn.name}.${h.name}`, varSlot: h.varSlot, depth: h.depth, site: callSites.indexOf(cs) })
      }
      hbase += locals.length
    }
    for (const fn of functions) {
      fn.historyCount = (fn.historyLocals || []).length
      // the frame slots the RET hand-off copies from, in history-index order
      fn.historySlots = (fn.historyLocals || []).map((h) => h.varSlot)
      delete fn.historyLocals
      delete fn.historyByVarSlot
    }
    // ⭐⭐ WINDOWS, MATERIALISED PER CALL SITE (2F-2B-REMEDIATION). Same shape
    // as the two blocks that follow; `windowBase` is what stops two call sites
    // of one body from sharing an observation ring.
    {
      let wbase = windowsMain.length
      for (const w of windowsMain) windows.push({ ...w, site: null })
      for (let i = 0; i < callSites.length; i += 1) {
        const cs = callSites[i]
        const locals = functions[cs.fn].windowLocals || []
        cs.windowBase = wbase
        for (const w of locals) windows.push({ ...w, site: i })
        wbase += locals.length
      }
      for (const fn of functions) {
        fn.windowCount = (fn.windowLocals || []).length
        delete fn.windowLocals
      }
    }
    // ⭐⭐ 2F-2C — THE SAME MATERIALISATION, ONE LIFETIME OVER. Main-program
    // instances occupy the bottom; each call site then takes a block sized to
    // its function's carried instances. `carriedBase` is what makes two call
    // sites of one body two recurrences, and it is the third time this exact
    // addressing has been needed (`persistBase` 2E, `historyBase` P7.2).
    {
      let cbase = carriedMain.length
      for (const c of carriedMain) carried.push({ ...c, site: null })
      for (let i = 0; i < callSites.length; i += 1) {
        const cs = callSites[i]
        const locals = functions[cs.fn].carriedLocals || []
        cs.carriedBase = cbase
        for (const c of locals) carried.push({ ...c, site: i })
        cbase += locals.length
      }
      for (const fn of functions) {
        fn.carriedCount = (fn.carriedLocals || []).length
        delete fn.carriedLocals
      }
    }

    if (history.length > MAX_HISTORY_SLOTS) {
      return fail(new RuntimeRefusal('runtime:statement',
        `this script keeps history for more than ${MAX_HISTORY_SLOTS} values across all call sites`, null), diagnostics)
    }
  }

  if (!outputs.length) {
    return fail(new RuntimeRefusal('runtime:no-output', null, null), diagnostics)
  }

  if (skippedFunctions.length) diagnostics.skippedFunctions = [...skippedFunctions]
  diagnostics.columns = columns.length
  diagnostics.slots = slots.length
  diagnostics.functions = functions.length
  diagnostics.callSites = callSites.length
  diagnostics.pureFunctions = functions.filter((f) => f.effects && f.effects.pure).length

  let ir
  try {
    ir = makeIrProgram({
      version: version || null, statements, slots, columns, outputs,
      objectTreeOutputs,
      iterOutputs,
      functions: functions.map((f) => ({
        name: f.name, params: f.params, frameSize: f.frameSize,
        persistCount: f.persistCount, body: f.body, result: f.result,
        effects: f.effects, at: f.at,
        historyCount: f.historyCount || 0, historySlots: f.historySlots || [],
        carriedCount: f.carriedCount || 0,
        windowCount: f.windowCount || 0,
      })),
      callSites,
      history,
      windows,
      carried,
      carried2: carried2Main,
      requests,
    })
  } catch (e) { return fail(e, diagnostics) }

  // ⭐ `objectIterTreeKinds` rides the RESULT rather than the program: it is a
  // fact about what this lane DECIDED, which the object side needs in order to
  // render a buffer's value, and which nothing downstream of the program reads.
  return { ok: true, ir, diagnostics, objectIterTreeKinds }
}

/** ⭐⭐ RULING D2 (2026-09-12) — THE SAME GUARD, THE SENTENCE THIS LANE CAN KEEP.
 *
 *  `pine.js` owns the refusal vocabulary and this front end reuses its resolver,
 *  so a `PineRefusal` arrives here carrying a sentence written for a translator
 *  where a refusal lands on ONE OUTPUT ROW. This lane has no rows: the first
 *  refusal takes the program. `pine:text-value`'s promise — *"The numeric plots
 *  still run"* — is therefore true THERE and false HERE, measured on the two
 *  member scripts this session is about:
 *
 *      uncharted-volume-v2.pine   host ok=true, 5 outputs, 0 refusals
 *                                 IR   ok=false  pine:text-value@153
 *      uncharted-volume.pine      IR   ok=false  pine:text-value@151
 *
 *  ⛔ AN OVERRIDE, NOT A REWRITE OF THE SHARED TABLE. Changing the sentence in
 *  `pine.js` would make it wrong in the lane where it is currently right, which is
 *  the same one-value-two-authorities trade in the other direction. The guard, the
 *  line and the column are untouched — only the prose the member reads changes.
 *
 *  ⛔ AND IT MUST COVER EVERY `PER_ROW_PROMISE_GUARDS` ENTRY.
 *  `pineRuntimeTextLane.test.js` derives the requirement from that export rather
 *  than listing guards here, so a second per-row promise added to `pine.js`
 *  without an override fails by name instead of quietly reaching a member. */
export const RUNTIME_LANE_REFUSALS = Object.freeze({
  'pine:text-value':
    'this script uses a text feature our chart does not render yet. This lane stops '
    + 'at the first one, so none of this script runs here — the screener and host '
    + 'lanes still translate its numeric plots',
})

/** The source position of either refusal class, in one vocabulary.
 *
 *  ⭐ DERIVED FROM THE OBJECT, NOT FROM ITS CLASS. Asking `instanceof` would
 *  need updating the day a third refusal class appears; asking for the fields
 *  each one actually carries does not, and a refusal with neither reports null
 *  three times rather than throwing. */
const position = (e) => {
  const src = (e && e.line != null) ? e : ((e && e.at) || null)
  return {
    line: src && src.line != null ? src.line : null,
    column: src && src.column != null ? src.column : null,
    token: src && src.token != null ? src.token : null,
  }
}

function fail(e, diagnostics) {
  const guard = e instanceof RuntimeRefusal ? e.guard
    : (e instanceof PineRefusal ? e.guard : 'runtime:statement')
  return {
    ok: false,
    refusal: {
      guard,
      // ⛔ RULING D2: a shared-vocabulary refusal whose sentence promises
      // something about the OTHER rows is re-stated for this lane, which has none.
      message: (e instanceof PineRefusal && RUNTIME_LANE_REFUSALS[guard])
        || String(e.message || e),
      // ⛔⛔ TWO REFUSAL CLASSES CARRY THEIR POSITION DIFFERENTLY, and reading
      // only one of them silently dropped it for the other. `RuntimeRefusal`
      // FLATTENS `at` into `line`/`column`/`token` in its constructor;
      // `PineRefusal` keeps the same object NESTED at `.at`. This read the flat
      // form only, so every `pine:*` refusal that reached this lane — a bad
      // character, an unknown builtin, an undefined name — arrived with
      // `line: null`, which is most of what a member would actually hit.
      //
      // ⚠ MEASURED, AND IT COST AN INVESTIGATION: a corpus census of 266 real
      // scripts reported 24 `pine:character` refusals with no location at all,
      // and the hunt for the character went through three wrong answers (a ™ in
      // the licence header, a library import, a method call) before the missing
      // position turned out to be the whole reason it was hard. A refusal that
      // cannot say WHERE is barely a refusal.
      ...position(e),
      ...(e.locationIsStatement ? { locationIsStatement: true } : {}),
    },
    diagnostics,
  }
}
