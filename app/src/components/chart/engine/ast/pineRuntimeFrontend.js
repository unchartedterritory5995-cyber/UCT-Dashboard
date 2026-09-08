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
  findTop, isPunct, boundName, locate, PineRefusal,
  VALUE_NAMESPACES, PINE_CALL_SHAPES, PINE_NAMESPACED_TREE,
} from './pine.js'
import { TABLE, isPointwise } from './parse.js'
import { interpret, POINTWISE_FOR_PARITY, FINITE_WINDOW } from './interpret.js'
import {
  makeIrProgram, SLOT, num, series, column, read, hist, binary, unary, ternary,
  declare, assign, ifStmt, emit, call as irCall, builtin as irBuiltin, histSlot,
  windowCall,
} from '../runtime/ir.js'

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
  'runtime:operator': 'an operator the runtime has no instruction for',
  'runtime:switch': 'a switch — the runtime has no multi-way branch yet',
  'runtime:varip': 'varip — intrabar persistence, which a closed-bar runtime cannot reproduce',
  'runtime:udt': 'a user-defined type',
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
const OBJECT_NS = /^(line|label|box|table|polyline|linefill)\./
const ARRAY_NS = /^(array|matrix|map)\./
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

  const note = (family) => {
    diagnostics.families[family] = (diagnostics.families[family] || 0) + 1
  }

  let lexed
  try { lexed = lexPine(source) } catch (e) { return fail(e, diagnostics) }
  const { tokens, indents, version } = lexed

  let stmts
  try { stmts = blockStatements(tokens, indents, 0) } catch (e) { return fail(e, diagnostics) }

  const mut = scanMutability(stmts)

  // The resolver's environment holds ONLY pure bindings. A mutable name never
  // enters it — that is what keeps the two lanes from disagreeing about a name.
  const env = new Map()
  const makeResolver = () => new Resolver(env, TABLE, new Map(), {})

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
  const windows = []
  const functions = []
  const fnByName = new Map()
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
      value = interpret(canonical, bars, inputs, undefined, undefined, opts.interpretOpts)
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
    if (node.type === 'call' && fnByName.has(node.name)) return true
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
      canonical = makeResolver().resolve(e)
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
    const spec = TABLE.functions[bare]
    if (spec && isPointwise(spec)) return 'runtime:call-pointwise-state'
    // `na`/`nz` are Pine forms rather than table entries, and both are pointwise
    // by construction — they read one value and answer about that value.
    if (bare === 'na' || bare === 'nz') return 'runtime:call-pointwise-state'
    if (CONVERSION_NAMES.has(bare)) return 'runtime:call-conversion-state'
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

  const lowerExpr = (node, scope) => {
    if (!node || typeof node !== 'object') {
      throw new RuntimeRefusal('runtime:statement', 'an expression this front end cannot read')
    }
    // ⭐ THE ROUTE DECISION, ASKED ONCE PER SUBTREE. A pure subtree becomes one
    // column no matter how large it is, which is what keeps a stateful program
    // paying runtime cost only for the parts that are actually stateful.
    if (!readsSlot(node, scope)) return column(columnOf(node, locate(node.tok)))

    switch (node.type) {
      case 'number': return num(node.value)
      case 'name': {
        const slot = scope.lookup(node.name)
        if (slot !== null) return read(slot)
        if (guardOuter && guardOuter.lookup(node.name) !== null) {
          note('runtime:function-global-state')
          throw new RuntimeRefusal('runtime:function-global-state', `\`${node.name}\``, locate(node.tok))
        }
        throw new RuntimeRefusal('runtime:unbound', `\`${node.name}\``, locate(node.tok))
      }
      case 'binary': {
        const op = BIN[node.op]
        if (!op) {
          throw new RuntimeRefusal('runtime:operator', `\`${node.op}\` beside a mutable value`, locate(node.tok))
        }
        return binary(op, lowerExpr(node.left, scope), lowerExpr(node.right, scope))
      }
      case 'unary': {
        if (node.op === '-') return unary('u-', lowerExpr(node.arg, scope))
        if (node.op === 'not') return unary('!', lowerExpr(node.arg, scope))
        throw new RuntimeRefusal('runtime:operator', `unary \`${node.op}\``, locate(node.tok))
      }
      case 'ternary':
        // ⚠️ BOTH ARMS EVALUATE, which is Pine's `?:` over values. A branch that
        // MUTATES is an `if` STATEMENT and is lowered by `lowerStmts`, never here
        // — routing one through this arm would run both mutations every bar.
        return ternary(lowerExpr(node.test, scope), lowerExpr(node.yes, scope), lowerExpr(node.no, scope))
      case 'offset': {
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
          if (node.arg.type !== 'name') {
            note('runtime:history-expression')
            throw new RuntimeRefusal('runtime:history-expression', null, at)
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
        // ⭐⭐ A USER FUNCTION CALL — the 2E path. Each call gets its OWN call
        // site, and the site is what will own the invocation's persistent
        // locals: `f(1)` and `f(10)` on two lines are two sites, so a `var`
        // inside `f` is two independent counters, which is Pine's semantics and
        // the single most important thing this wave has to get right.
        const fnIndex = fnByName.get(node.name)
        if (fnIndex !== undefined) {
          const fn = functions[fnIndex]
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
          const site = callSites.length
          callSites.push({ fn: fnIndex, at: locate(node.tok) })
          // ⭐ ARGUMENTS ARE LOWERED IN THE CALLER'S SCOPE, so a state-derived
          // argument (`f(acc)`) is an ordinary runtime expression rather than a
          // special case — §30.
          return irCall(fnIndex, site, args.map((a) => lowerExpr(a, scope)))
        }
        const fam = callFamily(node.name)
        if (fam) { note(fam); throw new RuntimeRefusal(fam, `\`${node.name}\``, locate(node.tok)) }
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
          if (!srcNode || srcNode.type !== 'name') {
            note('runtime:history-expression')
            throw new RuntimeRefusal('runtime:history-expression',
              `\`${node.name}\` over an expression needs that expression's own committed series`, at)
          }
          const varSlot = scope.lookup(srcNode.name)
          if (varSlot === null) {
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
          windows.push({ fn: win.table, name: `${node.name}(${srcNode.name},${n})`, historySlot: histIndex, span })
          const call = windowCall(windows.length - 1, read(varSlot))
          // ⛔ THE SIGN IS APPLIED HERE, ON THE WAY OUT, because that is where
          // `pine.js` applies it — `u-` wrapping the bare call, not a second
          // reducer with a flipped comparison. One reducer, one negation node.
          return win.negate ? unary('u-', call) : call
        }
        // A builtin whose ARGUMENT is mutable state — and WHICH KIND matters.
        const g = builtinStateFamily(node.name)
        note(g)
        throw new RuntimeRefusal(g, `\`${node.name}\``, locate(node.tok))
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
  const OUTPUT_CALLS = new Set(['plot', 'plotshape', 'plotchar', 'plotarrow'])
  const PRESENTATION_CALLS = new Set([
    'fill', 'bgcolor', 'barcolor', 'hline', 'plotcandle', 'plotbar',
    'alertcondition', 'alert',
  ])
  const DIRECTIVE_CALLS = new Set(['max_bars_back'])

  const lowerStmts = (list, scope) => {
    const out = []
    for (let i = 0; i < list.length; i += 1) {
      const st = list[i]
      const toks = st.header || []
      if (!toks.length) continue
      diagnostics.statements += 1
      const first = toks[0]
      const word = first.kind === 'ident' ? first.value : null

      // ── declarations of the script itself ──
      if (word === 'indicator' || word === 'study') continue
      if (word === 'strategy' || word === 'library') {
        throw new RuntimeRefusal('runtime:declaration', `\`${word}()\``, locate(first))
      }
      if (word === 'import' || word === 'export') {
        throw new RuntimeRefusal('runtime:declaration', `\`${word}\``, locate(first))
      }
      if (word === 'type') { note('runtime:udt'); throw new RuntimeRefusal('runtime:udt', null, locate(first)) }
      if (word === 'varip') { note('runtime:varip'); throw new RuntimeRefusal('runtime:varip', null, locate(first)) }
      if (BLOCK_WORDS.has(word)) { note('runtime:loop'); throw new RuntimeRefusal('runtime:loop', `\`${word}\``, locate(first)) }
      if (word === 'switch') { note('runtime:switch'); throw new RuntimeRefusal('runtime:switch', null, locate(first)) }

      // ── a user function definition: `f(a, b) => …` ──
      {
        const arrow = findTop(toks, (t) => isPunct(t, '=>'))
        if (arrow > 0) {
          defineFunction(st, toks, arrow)
          continue
        }
      }

      // ── tuple destructuring: `[a, b] = …` ──
      if (isPunct(first, '[')) {
        note('runtime:tuple')
        throw new RuntimeRefusal('runtime:tuple', null, locate(first))
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
        const lowered = arms.map((a) => ({
          test: lowerExpr(a.test, scope),
          body: lowerStmts(a.from.sub || [], new Scope(scope)),
        }))
        const tail = finalElse ? lowerStmts(finalElse.sub || [], new Scope(scope)) : []
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
        const slot = scope.lookup(nameTok.value)
        if (slot === null) {
          throw new RuntimeRefusal('runtime:unbound', `\`${nameTok.value}\` is reassigned before it is declared`, locate(nameTok))
        }
        const value = parseWholeExpression(toks.slice(walrus + 1))
        out.push(assign(slot, lowerExpr(value, scope)))
        continue
      }

      // ── `var name = expr` ──
      if (word === 'var') {
        const eq = findTop(toks, (t) => isPunct(t, '='))
        const nameTok = eq > 0 ? boundName(toks, eq) : null
        if (!nameTok) throw new RuntimeRefusal('runtime:statement', 'a `var` declaration needs a name and an initialiser', locate(first))
        const value = parseWholeExpression(toks.slice(eq + 1))
        const slot = scope.declare(nameTok.value, newSlot(nameTok.value, true))
        out.push(declare(slot, lowerExpr(value, scope)))
        continue
      }

      // ── an output call ──
      if (word && OUTPUT_CALLS.has(word) && isPunct(toks[1], '(')) {
        const call = parseWholeExpression(toks)
        const arg0 = call.args && call.args.length ? (call.args[0].value !== undefined ? call.args[0].value : call.args[0]) : null
        if (!arg0) throw new RuntimeRefusal('runtime:statement', `\`${word}()\` with no value`, locate(first))
        outputs.push(word)
        out.push(emit(outputs.length - 1, lowerExpr(arg0, scope)))
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
        const mutable = mut.mutated.has(nameTok.value)
        if (!mutable && !readsSlot(value, scope)) {
          env.set(nameTok.value, { kind: 'expr', node: value, env: new Map(env), at: locate(nameTok) })
          continue
        }
        const slot = scope.declare(nameTok.value, newSlot(nameTok.value, mut.persistent.has(nameTok.value)))
        out.push(declare(slot, lowerExpr(value, scope)))
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
        const f = callFamily(word)
        if (f) { note(f); throw new RuntimeRefusal(f, `\`${word}\``, locate(first)) }
        note('runtime:expression-statement')
        throw new RuntimeRefusal('runtime:expression-statement', `\`${word}()\``, locate(first))
      }
      // a dotted call statement — `label.new(...)`, `array.push(...)`
      if (word && isPunct(toks[1], '.') && toks[2] && toks[2].kind === 'ident') {
        const name = `${word}.${toks[2].value}`
        const f = callFamily(name)
        if (f) { note(f); throw new RuntimeRefusal(f, `\`${name}\``, locate(first)) }
        note('runtime:expression-statement')
        throw new RuntimeRefusal('runtime:expression-statement', `\`${name}()\``, locate(first))
      }

      throw new RuntimeRefusal('runtime:statement', null, locate(first))
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
    const params = []
    for (let i = 2; i < arrow - 1; i += 1) {
      const t = toks[i]
      if (isPunct(t, ',')) continue
      if (t.kind !== 'ident') {
        throw new RuntimeRefusal('runtime:function',
          `a parameter this front end cannot read (\`${t.value}\`) — default values are not supported yet`,
          locate(t))
      }
      params.push(t.value)
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
          result = lowerExpr(parseWholeExpression(lt), fnScope)
        }
      } else {
        result = lowerExpr(parseWholeExpression(toks.slice(arrow + 1)), fnScope)
      }
      record.body = body
      record.result = result
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
  try {
    statements = lowerStmts(stmts, root)
  } catch (e) {
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
    if (history.length > MAX_HISTORY_SLOTS) {
      return fail(new RuntimeRefusal('runtime:statement',
        `this script keeps history for more than ${MAX_HISTORY_SLOTS} values across all call sites`, null), diagnostics)
    }
  }

  if (!outputs.length) {
    return fail(new RuntimeRefusal('runtime:no-output', null, null), diagnostics)
  }

  diagnostics.columns = columns.length
  diagnostics.slots = slots.length
  diagnostics.functions = functions.length
  diagnostics.callSites = callSites.length
  diagnostics.pureFunctions = functions.filter((f) => f.effects && f.effects.pure).length

  let ir
  try {
    ir = makeIrProgram({
      version: version || null, statements, slots, columns, outputs,
      functions: functions.map((f) => ({
        name: f.name, params: f.params, frameSize: f.frameSize,
        persistCount: f.persistCount, body: f.body, result: f.result,
        effects: f.effects, at: f.at,
        historyCount: f.historyCount || 0, historySlots: f.historySlots || [],
      })),
      callSites,
      history,
      windows,
    })
  } catch (e) { return fail(e, diagnostics) }

  return { ok: true, ir, diagnostics }
}

function fail(e, diagnostics) {
  const guard = e instanceof RuntimeRefusal ? e.guard
    : (e instanceof PineRefusal ? e.guard : 'runtime:statement')
  return {
    ok: false,
    refusal: {
      guard,
      message: String(e.message || e),
      line: e.line != null ? e.line : null,
      column: e.column != null ? e.column : null,
      token: e.token != null ? e.token : null,
    },
    diagnostics,
  }
}
