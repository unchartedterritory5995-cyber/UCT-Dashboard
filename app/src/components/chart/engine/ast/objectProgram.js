// app/src/components/chart/engine/ast/objectProgram.js
//
// ─── ⭐⭐ C3B — THE CANONICAL GRAPHICAL-OBJECT PROGRAM ────────────────────────
//
// This is the SECOND half of a UCT indicator, and until this file existed there
// was only the first. C2C gave the repo a shared canonical COMPUTATION graph:
// pure, series-valued, order-free, content-addressed. It cannot express a line
// that is born on bar 400, moved on bars 401-460, and deleted on bar 461 —
// because that is not a value, it is a LIFETIME.
//
//   V2 GRAPH            pure computation      "what is the number on this bar"
//   OBJECT PROGRAM      lifecycle             "what exists, since when, and why"
//
// ⛔⛔ THE SEPARATION IS LOAD-BEARING AND MUST NOT BE COLLAPSED. Every dynamic
// property here is a REFERENCE into the V2 graph — never a copied AST. That is
// what keeps C2C's document-size win: a `close` that a plot already computes is
// one node, and a line whose y-coordinate is that same `close` stores an
// integer. Inlining trees into object operations would silently undo a ×48
// compaction that took a whole wave to earn.
//
// ⛔⛔ AND OBJECT IDENTITY IS SEMANTIC, NEVER GEOMETRIC. Two lines with the same
// endpoints, colour and width are two objects if the program created them
// twice. Identity comes from (creation SITE, creation BAR) and nothing else —
// not coordinates, not colour, not the expression that produced them. Inferring
// identity from appearance is the single most tempting shortcut here and it is
// wrong in the exact case that matters: an author who draws a fresh support line
// every session, at the same price, is drawing a NEW line each time.
//
// ⭐ WHAT THIS FILE IS NOT: it is not Pine. `line.new` is a Pine spelling; the
// program below has `create`. The Builder must be able to author one of these
// directly without a Pine round-trip (C3B's Builder-future-proofing rule), so
// nothing in this module may name a dialect.
//
// SHAPE
//
//   program = {
//     programVersion: 1,
//     regs:    [{ id, family }]            // var-held object references
//     colls:   [{ id, family, cap }]       // typed bounded object collections
//     ops:     [ op, … ]                   // executed IN ORDER, every bar
//     limits:  { line, label, box, table, linefill, opsPerBar }
//   }
//
//   op.when  — a value reference evaluated as a guard, or null for "always"
//   op.k     — create | update | delete | cell | setreg | push | collset | collclear
//
//   valueRef = { v:'const', value }        a literal
//            | { v:'graph', node }         an index into the V2 graph node table
//            | { v:'param', id }           a logical parameter id (C2D)
//            | { v:'bar' } | { v:'time' }  the bar's own index / timestamp
//
//   refExpr  = { r:'reg',  id }            whatever that register holds NOW
//            | { r:'site', id }            what THIS bar's create at that site made
//            | { r:'coll', id, index }     an element of a collection
//
// ⚠️ `site` is deliberately bar-local. `line.new(...)` used inline as an
// argument refers to the object made on THIS bar and nothing else; a reference
// that must outlive its bar has to be stored in a register, which is exactly
// what Pine's `var line l = na` says and why 24 of the reachable 27 need one.

/** Bumped only when the stored shape changes incompatibly. */
export const OBJECT_PROGRAM_VERSION = 1

/**
 * ⭐ MEASURED, NOT ASPIRATIONAL. `tools/c3b_object_census.mjs` counted the
 * reachable-27 population; these are the families it actually demands:
 *
 *   table    19/27 scripts, 227 cell sites   ← the LARGEST demand, not a tail
 *   label    14/27
 *   line      9/27
 *   box       7/27
 *   linefill  2/27
 *   polyline  1/27  ← deliberately OUT of C3B, see below
 *
 * ⛔ `polyline` IS NOT HERE AND THAT IS A DECISION, NOT AN OVERSIGHT. One
 * reachable script uses it, and it needs `chart.point[]` — a different type
 * system, not a different renderer. Reported as unsupported with its count
 * rather than half-built.
 */
export const OBJECT_FAMILIES = Object.freeze(['line', 'label', 'box', 'table', 'linefill'])

/**
 * The property vocabulary, per family — CLOSED, and closed on evidence.
 *
 * ⛔ A PROPERTY THAT NO REACHABLE SCRIPT SETS IS NOT HERE. The wave's own rule
 * is "only implement Pine surface demanded by real evidence"; a vocabulary that
 * mirrors the whole Pine reference would make the validator agree with a
 * renderer that draws nothing, which is the `built-tested-green-and-unreachable`
 * shape this repo has paid for repeatedly.
 *
 * ⚠️ Creation and update share ONE vocabulary per family on purpose. Pine
 * spells them differently (`line.new(x1=…)` vs `line.set_xy1(…)`) but they name
 * the same property, and two vocabularies would let a property be creatable and
 * not updatable by accident.
 */
export const FAMILY_PROPS = Object.freeze({
  line: Object.freeze(['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width']),
  label: Object.freeze(['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor',
    'size', 'textalign', 'tooltip']),
  box: Object.freeze(['left', 'top', 'right', 'bottom', 'xloc', 'extend',
    'border_color', 'border_width', 'border_style', 'bgcolor', 'text', 'text_color', 'text_size']),
  table: Object.freeze(['position', 'columns', 'rows', 'bgcolor',
    'border_color', 'border_width', 'frame_color', 'frame_width']),
  linefill: Object.freeze(['line1', 'line2', 'color']),
})

/** The per-cell vocabulary. Tables are the biggest reachable demand, and a cell
 *  is not a `set_*` on the table — it is addressed by (column, row).
 *
 *  ⭐⭐ `text_formatting` IS HERE BECAUSE A DASHBOARD'S HEADER ROW IS BOLD.
 *  ⚰️ It was missing, and that absence was not a refusal — `pine.js`'s cell pass
 *  read `if (!OBJECT_CELL_PROPS.includes(k)) continue`, a bare `continue` with
 *  no count, no name and no line number, so `text_formatting = text.format_bold`
 *  left the member's header row indistinguishable from its data rows and left
 *  no record anywhere that they had asked for anything. `text.format_bold` is
 *  0.6% of the measured constant demand (`docs/pine/demand-constants.md:194`),
 *  which for a table-shaped corpus is a header row in a great many dashboards.
 *
 *  ⛔ `text_font_family` IS STILL NOT HERE AND THAT IS A DECISION. A font this
 *  renderer does not have is a font it would have to substitute, and a
 *  substituted typeface silently changes every column width in the table. It is
 *  named in `objectDiagnostics.unsupportedProps` instead. */
export const CELL_PROPS = Object.freeze(['text', 'text_color', 'text_size', 'text_halign',
  'text_valign', 'bgcolor', 'width', 'height', 'tooltip', 'text_formatting'])

/** Properties whose VALUE IS ANOTHER OBJECT. ⛔ These may only ever hold a
 *  `refExpr` of the stated family — this is where cross-family misuse is
 *  refused structurally rather than noticed at render time. */
export const REF_PROPS = Object.freeze({ 'linefill.line1': 'line', 'linefill.line2': 'line' })

/** ⭐⭐ EVERY FIELD ON AN OP WHOSE VALUE IS A PLAIN VALUE REFERENCE — ONE LIST.
 *
 *  ⛔⛔ MASTER'S EXTRACTION, WITH THE BRANCH'S FIELD NAMES FOLDED IN, AND THE
 *  MERGE IS EXACTLY WHERE THIS COULD HAVE GONE WRONG. Master unified four
 *  hand-written enumerations into this list because *"add a field, update three
 *  of the four, and the one you missed leaves `{v:'tree', i}` in a BOUND program:
 *  the runtime reads `undefined`, `Number(undefined)` is `NaN`, the operation is
 *  rejected as out of range and does nothing at all."*
 *
 *  ⚰️ THE TWO SIDES NAMED THE SAME IDEA DIFFERENTLY. Master's table-clear
 *  rectangle is `col2`/`row2`; this branch's is `startCol`/`startRow`/`endCol`/
 *  `endRow`, and the branch also carries `from`/`to` for the `loop` kind.
 *  **The merged `pine.js` emits BOTH spellings** (measured: `startCol` ×4,
 *  `col2` ×3), so adopting either list alone would silently unbind the other
 *  side's ops — the precise failure the list exists to prevent, reintroduced by
 *  the merge that was meant to preserve both.
 *
 *  ⚠️ A field absent from an op is skipped, so a superset costs nothing. */
export const OP_VALUE_FIELDS = Object.freeze([
  'when', 'col', 'row', 'index',
  'col2', 'row2',                              // master's clear rectangle
  'startCol', 'startRow', 'endCol', 'endRow',  // this branch's
  'from', 'to',                                // the `loop` bounds
])

export const OBJECT_OP_KINDS = Object.freeze([
  'create', 'update', 'delete', 'cell', 'clear', 'setreg', 'push', 'collset', 'collclear', 'collremove',
  // ⭐ MASTER'S TWO, KEPT BY THE MERGE. `cellpatch` is `table.cell_set_*` — the
  // same `(column, row)` address as `cell` and a DIFFERENT meaning (patch one
  // property, not replace the cell), which is why it is its own kind rather
  // than a flag on `cell`. `clearcells` is the range form's validated name.
  'cellpatch', 'clearcells',
  // ⭐⭐ THE TENTH KIND, AND THE FIRST ONE THAT CONTAINS OTHER OPS.
  //
  // ⚰ `pineObjects.js` refuses an object operation inside a `for`/`while` and
  // its reason is correct as far as it goes: *"RISK-043 stands, the loop is not
  // executed, and drawing the first iteration would be a lie"*. That is true of
  // a STATIC tree reader, which is what that pass is — it cannot unroll
  // `for i = 0 to slots - 1` because `slots` is a runtime value.
  //
  // ⭐ BUT THE OBJECT RUNTIME ALREADY RUNS BAR BY BAR. So the loop does not need
  // unrolling at read time; it needs to BE an operation the runtime executes.
  // Measured on the acceptance dashboard: 15 ops blocked this way — `array.push`,
  // `array.set` and `table.cell` — which is the whole difference between a
  // header cell and a watchlist table.
  //
  // ⛔ ITS BODY IS BOUNDED BY THE SAME ENVELOPE AS EVERYTHING ELSE. Each
  // iteration costs `opsPerBar`, so a runaway is stopped by the thing counting
  // operations rather than by a second limit nobody could re-derive.
  'loop',
])

/**
 * The resource envelope.
 *
 * ⭐ THE NUMBERS ARE THE AUTHORS' OWN. 15 of the reachable 27 declare
 * `max_*_count` themselves; the median declared ceiling is 500 and the maximum
 * is 500, which is also TradingView's own hard cap. So this is not an invented
 * budget — it is the ceiling Pine authors already reason about, and honouring it
 * up to the same number means a compliant script never meets a UCT-only limit.
 *
 * ⛔ `opsPerBar` HAS NO PINE COUNTERPART and exists for us: a program that
 * issues unbounded operations per bar is a hang, not a drawing. It is high
 * enough that no reachable script approaches it and low enough to stop a
 * runaway.
 */
export const DEFAULT_OBJECT_LIMITS = Object.freeze({
  line: 500, label: 500, box: 500, table: 8, linefill: 500, opsPerBar: 2000,
})

/** A collection's own ceiling. Bounded BY CONSTRUCTION — the wave forbids "a
 *  general arbitrary Pine heap", and an unbounded object array is one. */
export const MAX_COLLECTION_CAP = 500

/** The operators a value reference may carry. ⛔ DELIBERATELY TINY — see the
 *  `case 'op'` note in `assertValueRef`. These exist to offset a table address
 *  from a loop counter (`r + 1`), not to compute anything. */
export const OBJECT_VALUE_OPS = Object.freeze(['+', '-', '*'])

const ID_RE = /^[a-z][a-z0-9_]*$/
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A runtime object handle. ⛔ TYPED, and never a bare number: encoding a handle
 *  as an ordinary numeric series is how a `line.set_*` ends up applied to a
 *  label with nobody noticing. */
export function makeObjectRef(family, id) {
  return Object.freeze({ __objref: true, family, id })
}

export function isObjectRef(v) {
  return isObj(v) && v.__objref === true
    && typeof v.family === 'string' && Number.isInteger(v.id)
}

/** The na handle. Pine's `var line l = na` starts here and 10 of the reachable
 *  27 reassign one, so "empty" must be a first-class value rather than absent. */
export const NA_REF = Object.freeze({ __objref: true, family: null, id: -1 })

export function isNaRef(v) {
  return isObj(v) && v.__objref === true && v.id === -1
}

/**
 * ⭐⭐ A TEXT EXPRESSION, AND IT IS NOT AN AFTERTHOUGHT.
 *
 * ⚰️ THE FIRST BUILD OF THIS WAVE HAD ONLY NUMERIC VALUES, and it reached 6 of
 * the 27 reachable scripts. The measurement said why in one line: **19 of the
 * 27 are table-driven, and a table is made of TEXT** — `str.tostring(x, "#.##")`,
 * `"Avg " + str.tostring(n) + "-bar %"`, `ready ? stateName(s) : "Warming up…"`.
 * The V2 computation graph is numeric by construction and always will be, so a
 * cell's content cannot be a graph node. It is a small expression tree of its
 * own whose LEAVES are graph nodes.
 *
 * ⛔ THE NUMBERS STILL COME FROM THE GRAPH. `{t:'num', tree}` is a reference,
 * exactly like every other value here — the text layer formats, it does not
 * compute. That keeps one authority over every number a member sees, whether it
 * lands in a plot, a screener column or a dashboard cell.
 *
 *   textNode = {t:'lit', s}
 *            | {t:'num', tree, fmt?}          str.tostring(x [, "#.##"])
 *            | {t:'str', tree}                a tree whose VALUE IS TEXT
 *            | {t:'cat', args:[…]}            "a" + b + "c"
 *            | {t:'if', cond, then, else}     cond ? "a" : "b"
 */
function assertTextNode(v, where, depth = 0) {
  if (depth > 16) throw new Error(`${where}: text expression nested deeper than 16`)
  if (!isObj(v)) throw new Error(`${where}: expected a text node`)
  switch (v.t) {
    case 'lit':
      if (typeof v.s !== 'string') throw new Error(`${where}: a text literal must be a string`)
      return
    case 'num':
      if (!Number.isInteger(v.tree) && !Number.isInteger(v.node)) {
        throw new Error(`${where}: a text number must reference a tree or a graph node`)
      }
      if (v.fmt !== undefined && typeof v.fmt !== 'string') {
        throw new Error(`${where}: a number format must be a string`)
      }
      return
    // ⭐⭐ A TREE WHOSE VALUE IS ALREADY TEXT, which `num` cannot express.
    //
    // ⛔ IT IS NOT REACHABLE FROM THE V2 GRAPH AND MUST NOT BECOME SO. That
    // graph is numeric by construction, so the only lane that can answer this
    // is one with a text channel — the runtime lane. A watchlist ROW is the
    // case: `array.get(names, i)` is a string, and formatting a number is not
    // a thing that can be done to it.
    case 'str':
      if (!Number.isInteger(v.tree) && !Number.isInteger(v.node)) {
        throw new Error(`${where}: a text value must reference a tree or a graph node`)
      }
      return
    case 'cat':
      if (!Array.isArray(v.args) || !v.args.length) throw new Error(`${where}: a concatenation needs parts`)
      v.args.forEach((a, i) => assertTextNode(a, `${where}.args[${i}]`, depth + 1))
      return
    case 'if':
      assertValueRef(v.cond, `${where}.cond`)
      assertTextNode(v.then, `${where}.then`, depth + 1)
      assertTextNode(v.else, `${where}.else`, depth + 1)
      return
    default:
      throw new Error(`${where}: unknown text node ${JSON.stringify(v.t)}`)
  }
}

/**
 * ⭐ A COLOUR EXPRESSION — the same shape, one branch shorter.
 *
 * Measured beside the text finding: the reachable table scripts colour their
 * cells conditionally (`text_color = ready ? stateColor(s) : color.gray`) far
 * more often than they colour them statically. A model that carried only a
 * static hex would draw every dashboard in one colour and look like it worked.
 */
function assertColorNode(v, where, depth = 0) {
  if (depth > 16) throw new Error(`${where}: colour expression nested deeper than 16`)
  if (!isObj(v)) throw new Error(`${where}: expected a colour node`)
  switch (v.c) {
    case 'lit':
      if (typeof v.hex !== 'string') throw new Error(`${where}: a colour literal must be a string`)
      return
    case 'if':
      assertValueRef(v.cond, `${where}.cond`)
      assertColorNode(v.then, `${where}.then`, depth + 1)
      assertColorNode(v.else, `${where}.else`, depth + 1)
      return
    default:
      throw new Error(`${where}: unknown colour node ${JSON.stringify(v.c)}`)
  }
}

function assertValueRef(v, where) {
  if (!isObj(v)) throw new Error(`${where}: expected a value reference object, got ${typeof v}`)
  switch (v.v) {
    case 'const':
      if (!Object.hasOwn(v, 'value')) throw new Error(`${where}: a const reference must carry a value`)
      return
    case 'text':
      assertTextNode(v.node, `${where}.node`)
      return
    case 'color':
      assertColorNode(v.node, `${where}.node`)
      return
    case 'graph':
      if (!Number.isInteger(v.node) || v.node < 0) {
        throw new Error(`${where}: a graph reference needs a non-negative integer node index, got ${JSON.stringify(v.node)}`)
      }
      return
    // ⭐⭐ THE UNBOUND FORM. A program has TWO legal shapes and both are
    // validated here, because a shape that cannot be checked until it is stored
    // is a shape nothing checks:
    //
    //   UNBOUND   `{v:'tree', tree:i}`   an index into the program's OWN `trees`
    //                                    array — what a translator emits, before
    //                                    any graph exists
    //   BOUND     `{v:'graph', node:i}`  an index into the shared V2 graph — what
    //                                    the document stores and the runtime reads
    //
    // `bindObjectProgram` is the one conversion between them. ⛔ A stored
    // document must never contain the unbound form: `trees` there would be
    // copied ASTs, which is exactly the C2C compaction this wave must not undo.
    case 'tree':
      if (!Number.isInteger(v.tree) || v.tree < 0) {
        throw new Error(`${where}: a tree reference needs a non-negative integer index, got ${JSON.stringify(v.tree)}`)
      }
      return
    // ⭐⭐ ARITHMETIC OVER VALUE REFERENCES — added for the LOOP COUNTER, and
    // narrow on purpose.
    //
    // ⛔ WITHOUT IT A COUNTED LOOP CANNOT ADDRESS A TABLE. The corpus idiom is
    // `table.cell(t, 0, r + 1, …)` — a header row at 0 and the data starting at
    // 1 — and `r + 1` is not a tree (a tree is a per-BAR value and this depends
    // on the ITERATION) and not a const. Measured on the acceptance dashboard:
    // every one of its four data cells is addressed that way.
    //
    // ⛔ IT IS NOT A GENERAL EXPRESSION LANGUAGE AND MUST NOT BECOME ONE. The
    // V2 graph is where arithmetic over SERIES belongs; this exists only so an
    // ADDRESS can be offset from a counter. Anything richer than the operators
    // below belongs in a tree, evaluated by whichever lane owns the values.
    case 'op': {
      if (!OBJECT_VALUE_OPS.includes(v.op)) {
        throw new Error(`${where}: unknown value operator ${JSON.stringify(v.op)} `
          + `— this grammar offsets an address, it is not an expression language`)
      }
      if (!Array.isArray(v.args) || v.args.length < 1 || v.args.length > 2) {
        throw new Error(`${where}: a value operator takes one or two arguments`)
      }
      v.args.forEach((a, i) => assertValueRef(a, `${where}.args[${i}]`))
      return
    }
    case 'param':
      if (typeof v.id !== 'string' || !v.id) throw new Error(`${where}: a param reference needs an id`)
      return
    case 'bar':
    case 'time':
      return
    // ⭐⭐ THE LOOP COUNTER, and it sits beside `bar` for a reason: both are
    // values the RUNTIME supplies rather than the graph. A `for i = 0 to n` body
    // reads `i` in a cell's row, in `array.get(names, i)`, in a colour test —
    // and none of those can be a graph node, because `i` does not exist until
    // the loop runs.
    case 'loop':
      if (typeof v.id !== 'string' || !ID_RE.test(v.id)) {
        throw new Error(`${where}: a loop reference needs an id matching ${ID_RE}`)
      }
      return
    default:
      throw new Error(`${where}: unknown value reference kind ${JSON.stringify(v.v)}`)
  }
}

function assertRefExpr(v, where, regs, colls) {
  if (!isObj(v)) throw new Error(`${where}: expected an object reference expression`)
  switch (v.r) {
    case 'reg': {
      const reg = regs.get(v.id)
      if (!reg) throw new Error(`${where}: register ${JSON.stringify(v.id)} is not declared`)
      return reg.family
    }
    case 'site':
      if (typeof v.id !== 'string' || !ID_RE.test(v.id)) {
        throw new Error(`${where}: a site reference needs an id matching ${ID_RE}`)
      }
      return null // resolved against the creating op by the caller
    case 'coll': {
      const c = colls.get(v.id)
      if (!c) throw new Error(`${where}: collection ${JSON.stringify(v.id)} is not declared`)
      assertValueRef(v.index, `${where}.index`)
      return c.family
    }
    default:
      throw new Error(`${where}: unknown object reference kind ${JSON.stringify(v.r)}`)
  }
}

/**
 * Structural validation of a whole program.
 *
 * ⛔⛔ THIS IS THE DOOR, and it refuses rather than repairs. Every rule below
 * exists because the alternative is a silent wrong picture:
 *
 *  - a property outside the family's vocabulary → the renderer would ignore it
 *    and the member would see an object that quietly lost a setting;
 *  - `line.set_*` aimed at a label → a cross-family write, which in a dynamic
 *    language is a crash or, worse, a no-op;
 *  - a site reference to a site that never creates → a null handle at render;
 *  - a collection with no cap → an unbounded heap.
 *
 * @returns {{sites: string[], regs: string[], colls: string[]}}
 */
/** Every op, INCLUDING those nested inside a `loop` body, with a readable path.
 *
 *  ⛔⛔ THE VALIDATOR MUST DESCEND OR A LOOP BODY IS UNCHECKED. Both passes
 *  below used `ops.entries()`, which sees a `loop` op and nothing inside it — so
 *  every malformed op in a body would have reached the runtime unvalidated,
 *  which is the one thing this function exists to prevent. The path is carried
 *  rather than an index, so a failure names `objects.ops[2].body[0]` instead of
 *  a number that does not say which level it counted.
 */
function* walkOps(ops, prefix = 'objects.ops') {
  for (const [i, op] of (Array.isArray(ops) ? ops : []).entries()) {
    const where = `${prefix}[${i}]`
    yield [where, op]
    if (isObj(op) && op.k === 'loop' && Array.isArray(op.body)) {
      yield* walkOps(op.body, `${where}.body`)
    }
  }
}

export function assertObjectProgram(program) {
  if (!isObj(program)) {
    throw new Error(`objects: expected an object program, got ${program === null ? 'null' : typeof program}`)
  }
  if (program.programVersion !== OBJECT_PROGRAM_VERSION) {
    throw new Error(`objects: programVersion must be ${OBJECT_PROGRAM_VERSION}, got ${JSON.stringify(program.programVersion)}`)
  }
  const regs = new Map()
  for (const r of program.regs || []) {
    if (!isObj(r) || !ID_RE.test(String(r.id))) throw new Error(`objects: a register needs an id matching ${ID_RE}`)
    if (!OBJECT_FAMILIES.includes(r.family)) {
      throw new Error(`objects: register ${r.id} names family ${JSON.stringify(r.family)}, which is not one of [${OBJECT_FAMILIES}]`)
    }
    if (regs.has(r.id)) throw new Error(`objects: register ${r.id} is declared twice`)
    regs.set(r.id, r)
  }
  const colls = new Map()
  for (const c of program.colls || []) {
    if (!isObj(c) || !ID_RE.test(String(c.id))) throw new Error(`objects: a collection needs an id matching ${ID_RE}`)
    if (!OBJECT_FAMILIES.includes(c.family)) {
      throw new Error(`objects: collection ${c.id} names family ${JSON.stringify(c.family)}, which is not one of [${OBJECT_FAMILIES}]`)
    }
    if (!Number.isInteger(c.cap) || c.cap <= 0 || c.cap > MAX_COLLECTION_CAP) {
      throw new Error(`objects: collection ${c.id} needs an integer cap in 1..${MAX_COLLECTION_CAP}, got ${JSON.stringify(c.cap)}`)
    }
    if (colls.has(c.id)) throw new Error(`objects: collection ${c.id} is declared twice`)
    colls.set(c.id, c)
  }

  const ops = program.ops
  if (!Array.isArray(ops)) throw new Error('objects: ops must be an array')
  const siteFamily = new Map()
  for (const [where, op] of walkOps(ops)) {
    if (!isObj(op)) throw new Error(`${where}: expected an operation object`)
    if (!OBJECT_OP_KINDS.includes(op.k)) {
      throw new Error(`${where}: unknown operation ${JSON.stringify(op.k)}, expected one of [${OBJECT_OP_KINDS}]`)
    }
    if (op.when !== null && op.when !== undefined) assertValueRef(op.when, `${where}.when`)
    if (op.lastBarOnly !== undefined && op.lastBarOnly !== true) {
      throw new Error(`${where}: lastBarOnly is a flag — it is either absent or true`)
    }
    if (op.once !== undefined && op.once !== true) {
      throw new Error(`${where}: once is a flag — it is either absent or true`)
    }
    for (const k of ['requiresLive', 'requiresEmpty']) {
      if (op[k] === undefined) continue
      if (!regs.has(op[k])) {
        throw new Error(`${where}: ${k} names undeclared register ${JSON.stringify(op[k])}`)
      }
    }
    // ⭐⭐ A LOOP DECLARES ITS COUNTER AND ITS BOUNDS, and both bounds are
    // ordinary value references — so `for i = 0 to array.size(syms) - 1` is a
    // graph node like any other and needs no new machinery to be read.
    //
    // ⛔ THE COUNTER'S ID IS VALIDATED HERE because the body reads it by name.
    // A body referencing `{v:'loop', id:'j'}` inside a loop declaring `i` is a
    // program that would evaluate to NaN on every bar and draw nothing, which
    // reads exactly like an empty watchlist.
    // ⛔⛔ `loop` IS A BRANCH OF THIS CHAIN, NOT A CHECK BESIDE IT. The chain
    // ends in an `else` that assumes a COLLECTION op, so a kind validated
    // separately still falls through to it — and a loop was reported as
    // *"names undeclared collection undefined"*, a sentence about a feature it
    // has nothing to do with.
    if (op.k === 'loop') {
      if (!ID_RE.test(String(op.id))) {
        throw new Error(`${where}: a loop needs a counter id matching ${ID_RE}`)
      }
      assertValueRef(op.from, `${where}.from`)
      assertValueRef(op.to, `${where}.to`)
      if (!Array.isArray(op.body)) throw new Error(`${where}: a loop needs a body array`)
      if (!op.body.length) throw new Error(`${where}: a loop with an empty body draws nothing`)
    } else if (op.k === 'create') {
      if (!OBJECT_FAMILIES.includes(op.family)) {
        throw new Error(`${where}: create names family ${JSON.stringify(op.family)}, which is not one of [${OBJECT_FAMILIES}]`)
      }
      if (!ID_RE.test(String(op.site))) throw new Error(`${where}: create needs a site id matching ${ID_RE}`)
      if (siteFamily.has(op.site)) throw new Error(`${where}: site ${op.site} is created twice`)
      siteFamily.set(op.site, op.family)
      assertProps(op, where, op.family, regs, colls, siteFamily)
      if (op.into !== null && op.into !== undefined) {
        const reg = regs.get(op.into)
        if (!reg) throw new Error(`${where}: create stores into undeclared register ${JSON.stringify(op.into)}`)
        if (reg.family !== op.family) {
          throw new Error(`${where}: a ${op.family} cannot be stored in register ${op.into}, which holds ${reg.family}`)
        }
      }
    } else if (op.k === 'update' || op.k === 'delete' || op.k === 'cell'
      || op.k === 'cellpatch' || op.k === 'clear' || op.k === 'clearcells') {
      const fam = resolveTargetFamily(op, where, regs, colls, siteFamily)
      // ⭐ `cell` (Pine's PUT) and `cellpatch` (its `cell_set_*` PATCH) are two
      // operations with ONE SHAPE, so the door checks them with one rule — master's
      // wording, kept. What separates them is what the RUNTIME does with an address
      // that already holds something, which a validator cannot see.
      if (op.k === 'cell' || op.k === 'cellpatch') {
        if (fam !== 'table') throw new Error(`${where}: cell targets a ${fam}, but only a table has cells`)
        assertValueRef(op.col, `${where}.col`)
        assertValueRef(op.row, `${where}.row`)
        assertCellProps(op, where)
      }
      // ⛔ ALL FOUR BOUNDS ARE ASSERTED, including the two Pine lets an author
      // omit — the converter fills an absent `end_` from its own start, so by
      // the time an op reaches here a missing one is a CONVERTER defect, and a
      // rectangle with an unreadable edge would delete an arbitrary block.
      // ⛔⛔ TWO CLEAR SPELLINGS SURVIVE THE MERGE, AND THAT IS MEASURED, NOT
      // TOLERATED. Master's converter emits `clearcells` with a `col/row/col2/row2`
      // rectangle; this branch's emits `clear` with `startCol/startRow/endCol/endRow`.
      // The merged `pine.js` contains BOTH conversions, so a door that knew only one
      // would pass the other's ops unchecked — which is worse than either alone.
      // ⚠️ Collapsing them to one spelling is a FOLLOW-UP with its own evidence,
      // not a drive-by inside a merge.
      if (op.k === 'clearcells') {
        if (fam !== 'table') throw new Error(`${where}: clearcells targets a ${fam}, but only a table has cells`)
        for (const f of ['col', 'row', 'col2', 'row2']) assertValueRef(op[f], `${where}.${f}`)
      }
      if (op.k === 'clear') {
        if (fam !== 'table') throw new Error(`${where}: clear targets a ${fam}, but only a table has cells`)
        assertValueRef(op.startCol, `${where}.startCol`)
        assertValueRef(op.startRow, `${where}.startRow`)
        assertValueRef(op.endCol, `${where}.endCol`)
        assertValueRef(op.endRow, `${where}.endRow`)
      }
      if (op.k === 'update') assertProps(op, where, fam, regs, colls, siteFamily)
    } else if (op.k === 'setreg') {
      const reg = regs.get(op.reg)
      if (!reg) throw new Error(`${where}: setreg names undeclared register ${JSON.stringify(op.reg)}`)
      if (op.value !== null) {
        const fam = assertRefExpr(op.value, `${where}.value`, regs, colls)
        const resolved = fam === null ? siteFamily.get(op.value.id) : fam
        if (resolved && resolved !== reg.family) {
          throw new Error(`${where}: register ${op.reg} holds ${reg.family}, cannot be assigned a ${resolved}`)
        }
      }
    } else {
      const c = colls.get(op.coll)
      if (!c) throw new Error(`${where}: ${op.k} names undeclared collection ${JSON.stringify(op.coll)}`)
      if (op.k === 'push' || op.k === 'collset') {
        const fam = assertRefExpr(op.value, `${where}.value`, regs, colls)
        const resolved = fam === null ? siteFamily.get(op.value.id) : fam
        if (resolved && resolved !== c.family) {
          throw new Error(`${where}: collection ${op.coll} holds ${c.family}, cannot take a ${resolved}`)
        }
        if (op.k === 'collset') assertValueRef(op.index, `${where}.index`)
      }
      if (op.k === 'collremove') assertValueRef(op.index, `${where}.index`)
    }
  }

  // ⛔ a site reference that names no create is a null handle waiting to happen
  for (const [where, op] of walkOps(ops)) {
    const t = op.target || (op.k === 'push' || op.k === 'collset' ? op.value : null)
    if (t && t.r === 'site' && !siteFamily.has(t.id)) {
      throw new Error(`${where}: site ${JSON.stringify(t.id)} is referenced but never created`)
    }
  }

  const limits = { ...DEFAULT_OBJECT_LIMITS, ...(program.limits || {}) }
  for (const [k, v] of Object.entries(limits)) {
    if (!Number.isInteger(v) || v <= 0) {
      throw new Error(`objects.limits.${k}: expected a positive integer, got ${JSON.stringify(v)}`)
    }
  }

  return { sites: [...siteFamily.keys()], regs: [...regs.keys()], colls: [...colls.keys()] }
}

function resolveTargetFamily(op, where, regs, colls, siteFamily) {
  const fam = assertRefExpr(op.target, `${where}.target`, regs, colls)
  if (fam !== null) return fam
  const f = siteFamily.get(op.target.id)
  if (!f) throw new Error(`${where}: site ${JSON.stringify(op.target.id)} is referenced but never created`)
  return f
}

function assertProps(op, where, family, regs, colls, siteFamily) {
  const allowed = FAMILY_PROPS[family]
  if (!allowed) throw new Error(`${where}: no property vocabulary for family ${JSON.stringify(family)}`)
  const props = op.props
  if (!isObj(props)) throw new Error(`${where}: props must be an object`)
  for (const [k, v] of Object.entries(props)) {
    if (!allowed.includes(k)) {
      throw new Error(`${where}: ${family} has no property ${JSON.stringify(k)} — the vocabulary is [${allowed}]`)
    }
    const refFam = REF_PROPS[`${family}.${k}`]
    if (refFam) {
      const got = assertRefExpr(v, `${where}.props.${k}`, regs, colls)
      const resolved = got === null ? siteFamily.get(v.id) : got
      if (resolved && resolved !== refFam) {
        throw new Error(`${where}: ${family}.${k} must reference a ${refFam}, got a ${resolved}`)
      }
      continue
    }
    assertValueRef(v, `${where}.props.${k}`)
  }
}

function assertCellProps(op, where) {
  const props = op.props
  if (!isObj(props)) throw new Error(`${where}: props must be an object`)
  for (const [k, v] of Object.entries(props)) {
    if (!CELL_PROPS.includes(k)) {
      throw new Error(`${where}: a table cell has no property ${JSON.stringify(k)} — the vocabulary is [${CELL_PROPS}]`)
    }
    assertValueRef(v, `${where}.props.${k}`)
  }
}

/** Every graph node index the program reads. ⭐ Used to prove that an object
 *  program references the shared graph rather than carrying its own trees, and
 *  by the document writer to check no reference dangles. */
export function graphNodesReferenced(program) {
  const seen = new Set()
  const walkText = (t) => {
    if (!isObj(t)) return
    if ((t.t === 'num' || t.t === 'str') && Number.isInteger(t.node)) seen.add(t.node)
    if (t.t === 'cat') (t.args || []).forEach(walkText)
    if (t.t === 'if') { walkValue(t.cond); walkText(t.then); walkText(t.else) }
  }
  const walkColor = (c) => {
    if (!isObj(c)) return
    if (c.c === 'if') { walkValue(c.cond); walkColor(c.then); walkColor(c.else) }
  }
  const walkValue = (v) => {
    if (!isObj(v)) return
    if (v.v === 'graph') seen.add(v.node)
    if (v.v === 'text') walkText(v.node)
    if (v.v === 'color') walkColor(v.node)
    if (v.v === 'op') (v.args || []).forEach(walkValue)
  }
  const walkRef = (r) => { if (isObj(r) && r.r === 'coll') walkValue(r.index) }
  for (const [, op] of walkOps(program.ops || [])) {
    walkValue(op.when); walkValue(op.from); walkValue(op.to)
    walkRef(op.target); walkRef(op.value)
    for (const f of OP_VALUE_FIELDS) walkValue(op[f])
    for (const v of Object.values(op.props || {})) {
      if (isObj(v) && v.r) walkRef(v)
      else walkValue(v)
    }
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * ⭐⭐ THE ONE AUTHORITY ON "WHICH TREES DOES *THIS* OP READ".
 *
 * ⛔ IT DOES NOT DESCEND INTO `op.body`. A loop's body is the NEXT level of
 * ops, and a caller that needs to know WHERE a read happens — which enclosing
 * loop it sits in, whether that position is reached only on the last bar — must
 * be able to ask about one op at a time. `treeRefsReferenced` below walks the
 * whole program and unions these, so the two can never disagree about what
 * counts as a read (`lesson_a_second_authority_over_one_value`).
 *
 * ⚰️ THE ADDRESS FIELDS OF `clear` WERE MISSING and are included here. A tree
 * referenced only by `table.clear(t, startCol, …)` was invisible to the
 * document validator, which is the one consumer whose whole job is to say that
 * every referenced index exists. Finding MORE references is strictly safer
 * there: a ref it cannot see is a ref it cannot check.
 */
export function treeRefsOfOp(op) {
  const seen = new Set()
  const walkText = (t) => {
    if (!isObj(t)) return
    if ((t.t === 'num' || t.t === 'str') && Number.isInteger(t.tree)) seen.add(t.tree)
    if (t.t === 'cat') (t.args || []).forEach(walkText)
    if (t.t === 'if') { walkValue(t.cond); walkText(t.then); walkText(t.else) }
  }
  const walkColor = (c) => {
    if (!isObj(c)) return
    if (c.c === 'if') { walkValue(c.cond); walkColor(c.then); walkColor(c.else) }
  }
  function walkValue(v) {
    if (!isObj(v)) return
    if (v.v === 'tree') seen.add(v.tree)
    if (v.v === 'text') walkText(v.node)
    if (v.v === 'color') walkColor(v.node)
    if (v.v === 'op') (v.args || []).forEach(walkValue)
  }
  const walkRef = (r) => { if (isObj(r) && r.r === 'coll') walkValue(r.index) }
  if (!isObj(op)) return seen
  walkRef(op.target); walkRef(op.value)
  for (const f of OP_VALUE_FIELDS) walkValue(op[f])
  for (const v of Object.values(op.props || {})) {
    if (isObj(v) && v.r) walkRef(v)
    else walkValue(v)
  }
  return seen
}

/** Every UNBOUND tree index the program reads. ⭐ The mirror of
 *  `graphNodesReferenced`, and the two together are what let the document
 *  validator say which FORM a program is in rather than guessing.
 *
 *  ⭐ DERIVED from `treeRefsOfOp`, never a second copy of the walk. */
export function treeRefsReferenced(program) {
  const seen = new Set()
  for (const [, op] of walkOps(program.ops || [])) {
    for (const i of treeRefsOfOp(op)) seen.add(i)
  }
  return [...seen].sort((a, b) => a - b)
}

/** Every logical parameter id the program reads — the C2D bridge, so a slider
 *  can move a line's coordinate without the document being rewritten. */
export function paramsReferenced(program) {
  const seen = new Set()
  const walkValue = (v) => {
    if (!isObj(v)) return
    if (v.v === 'param') seen.add(v.id)
    if (v.v === 'op') (v.args || []).forEach(walkValue)
  }
  for (const [, op] of walkOps(program.ops || [])) {
    for (const f of OP_VALUE_FIELDS) walkValue(op[f])
    if (isObj(op.target) && op.target.r === 'coll') walkValue(op.target.index)
    for (const v of Object.values(op.props || {})) if (isObj(v) && v.v) walkValue(v)
  }
  return [...seen].sort()
}

/**
 * ⭐⭐ UNBOUND → BOUND. The one conversion, and the reason the object program
 * can be built before the graph exists.
 *
 * A translator emits `{v:'tree', tree:i}` against its own `trees` array. The
 * document writer adds those trees to the shared V2 graph as extra roots — where
 * `buildGraph` dedupes them by content digest against every plot's nodes — and
 * then calls this to rewrite each reference to the node index it landed on.
 *
 * ⛔ THE `trees` ARRAY IS DROPPED, DELIBERATELY. Keeping it would leave a second
 * copy of every expression in the saved document, which is the precise failure
 * C2C's ×48 compaction exists to prevent.
 *
 * @param {object} program                the unbound program
 * @param {(treeIndex:number)=>number} nodeOf  tree index → graph node index
 */
export function bindObjectProgram(program, nodeOf) {
  const bindText = (t) => {
    if (!isObj(t)) return t
    if ((t.t === 'num' || t.t === 'str') && Number.isInteger(t.tree)) {
      const { tree, ...rest } = t
      return { ...rest, node: nodeOf(tree) }
    }
    if (t.t === 'cat') return { ...t, args: t.args.map(bindText) }
    if (t.t === 'if') {
      return { ...t, cond: bindValue(t.cond), then: bindText(t.then), else: bindText(t.else) }
    }
    return t
  }
  const bindColor = (c) => {
    if (!isObj(c)) return c
    if (c.c === 'if') {
      return { ...c, cond: bindValue(c.cond), then: bindColor(c.then), else: bindColor(c.else) }
    }
    return c
  }
  function bindValue(v) {
    if (!isObj(v)) return v
    if (v.v === 'tree') return { v: 'graph', node: nodeOf(v.tree) }
    if (v.v === 'text') return { v: 'text', node: bindText(v.node) }
    if (v.v === 'color') return { v: 'color', node: bindColor(v.node) }
    // ⛔ AN OPERATOR'S ARGUMENTS ARE VALUE REFERENCES AND MUST BE BOUND TOO.
    // `r + 1` carries a const, but `startAt + r` carries a TREE, and leaving it
    // unbound would store the forbidden `{v:'tree'}` form in a document and make
    // the runtime answer `undefined` for the address — placing every cell of a
    // loop at the same spot rather than failing.
    if (v.v === 'op') return { ...v, args: (v.args || []).map(bindValue) }
    return v
  }
  const bindRef = (r) => (isObj(r) && r.r === 'coll' ? { ...r, index: bindValue(r.index) } : r)

  const bindOps = (list) => (list || []).map((op) => {
    const out = { ...op }
    // ⛔⛔ A LOOP'S BODY IS BOUND TOO. This mapped `program.ops` flatly, so an
    // op inside a loop kept its UNBOUND `{v:'tree'}` refs — and a stored
    // document must never contain the unbound form, because `trees` there would
    // be copied ASTs and undo the C2C compaction. The runtime would also read
    // `v: 'tree'` as an unknown kind and answer `undefined` for every cell in
    // the loop, which draws an empty table rather than failing.
    if (op.k === 'loop' && Array.isArray(op.body)) {
      out.from = bindValue(op.from)
      out.to = bindValue(op.to)
      out.body = bindOps(op.body)
    }
    if (op.target) out.target = bindRef(op.target)
    if (op.value && op.value.r) out.value = bindRef(op.value)
    // ⭐ ONE LIST HERE TOO — a field bound in three walkers and forgotten in the
    // fourth is the exact defect `OP_VALUE_FIELDS` was extracted to stop.
    for (const f of OP_VALUE_FIELDS) if (op[f] != null) out[f] = bindValue(op[f])
    // ⛔ THE CLEAR RECTANGLE BINDS TOO, for the reason the loop comment above
    // gives: an unbound `{v:'tree'}` reaching the runtime reads as an unknown
    // kind and answers `undefined`, and a bound that is not a number clears
    // NOTHING — so a forgotten bind here is a `table.clear` that silently
    // stops working rather than one that fails.
    if (op.props) {
      out.props = Object.fromEntries(Object.entries(op.props)
        .map(([k, v]) => [k, (isObj(v) && v.r) ? bindRef(v) : bindValue(v)]))
    }
    return out
  })
  const ops = bindOps(program.ops)
  const { trees, ...rest } = program
  return { ...rest, ops }
}
