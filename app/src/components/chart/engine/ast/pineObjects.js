// app/src/components/chart/engine/ast/pineObjects.js
//
// ─── ⭐⭐ C3B — PINE'S OBJECT VOCABULARY, READ AS A LIFECYCLE ────────────────
//
// `pine.js` folds Pine into VALUES. This file reads the half of Pine that is not
// a value: `line.new`, `label.set_text`, `box.delete`, `table.cell` — statements
// whose meaning is a change to something that persists between bars.
//
// ⛔⛔ IT IS A SEPARATE PASS, ON PURPOSE, AND IT CONSUMES NOTHING. The main walk
// folds `if` chains into ternaries; an object statement inside an `if` is not a
// ternary and never will be, so this pass re-walks the SAME statement tree with
// its own guard stack and leaves the value walk untouched. That is why adding
// C3B could not change a single existing translation: this reads the tree, it
// does not edit it.
//
// ⛔ AND IT KNOWS WHAT IT CANNOT DO. Two things are refused BY NAME rather than
// approximated, because both would produce a confident wrong picture:
//
//   * an object operation inside a `for`/`while` body — RISK-043 stands, the
//     loop is not executed, and drawing the first iteration would be a lie;
//   * `line.get_x1(l)` and every other GETTER — a getter reads runtime OBJECT
//     state back into a VALUE, and the V2 computation graph is pure by
//     construction. There is no node that means "whatever that line's x1 is
//     now". Refused, counted, and reported.
//
// ⚠️ HELPERS ARE INJECTED, not imported. `pine.js` owns the lexer, the argument
// parser and the token predicates; importing them here would make a cycle, and
// re-implementing them would put a second authority on Pine's grammar. So the
// caller hands them in and this module holds no opinion about tokens beyond
// what it is given.
//
// ⭐ `ufcs.js` IS THE ONE EXCEPTION AND IT IMPORTS NOTHING, so it can be a real
// import rather than an injected helper: there is no cycle to make. It performs
// Pine's method form — `b.set_bgcolor(c)` IS `box.set_bgcolor(b, c)` — and
// decides no legality, so this file's rosters stay the only authority on which
// members exist.
import { methodFormCall, splitMethodName } from './ufcs.js'
import {
  MAX_INLINE_DEPTH, INLINE_SUFFIX, readFunctionDefs, objectCollections, drawingFunctions,
  historyReason, pureFunctions, chartSeriesFor, bodyNames, bindArgs, rewriteBody, splitArgs, definitionHeader, callsAny,
  callsMethodAny, bodyEffects, methodHead, isBuiltinMethodName, splitCommaStatements,
  barInvariantNames, guardIsBarInvariant, getterScalars, isBareGetterAt, literalInit, isMutator,
} from './objectFnInline.js'

/** Pine's own positional argument order, per constructor. ⭐ MEASURED FROM THE
 *  REACHABLE 27 — a positional call is common in the corpus and a named-only
 *  reader would silently drop every coordinate in `line.new(x1, y1, x2, y2)`. */
export const CREATE_POSITIONAL = Object.freeze({
  line: Object.freeze(['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width']),
  label: Object.freeze(['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor',
    'size', 'textalign', 'tooltip']),
  box: Object.freeze(['left', 'top', 'right', 'bottom', 'border_color', 'border_width',
    'border_style', 'extend', 'xloc', 'bgcolor']),
  table: Object.freeze(['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width',
    'border_color', 'border_width']),
  linefill: Object.freeze(['line1', 'line2', 'color']),
})

/** `table.cell(table_id, column, row, text, …)` — the first three are the
 *  ADDRESS, not properties, so they are split out by the reader. */
export const CELL_POSITIONAL = Object.freeze(['text', 'width', 'height', 'text_color',
  'text_halign', 'text_valign', 'bgcolor', 'tooltip', 'text_size',
  // ⭐⭐ SLOTS 9 AND 10, FOR `text_formatting` — PINE'S FOURTEENTH ARGUMENT.
  // Master's, restored 2026-09-23: taking this file wholesale in the merge
  // dropped them, and a COMPUTED `text_formatting = cond ? bold : normal`
  // stopped reaching the program while a literal one still did.
  //
  // `text_formatting` cannot be reached positionally unless `text_font_family`
  // holds the slot in front of it — the vendor signature is
  //   table.cell(id, column, row, text, width, height, text_color,
  //              text_halign, text_valign, text_size, bgcolor, tooltip,
  //              text_font_family, text_formatting)
  //
  // ⛔ `text_font_family` IS A PLACEHOLDER, NOT A CAPABILITY, and master's own
  // note says why: it is deliberately ABSENT from `CELL_PROPS`, so a script
  // that writes one gets a NAMED refusal rather than a font this renderer
  // would have had to invent.
  'text_font_family', 'text_formatting'])

/** `table.clear(table_id, start_column, start_row, end_column, end_row)` — the
 *  four bounds AFTER the handle, in Pine's own order.
 *
 *  ⭐ `end_column`/`end_row` are OPTIONAL and default to their `start_`
 *  counterpart, so `table.clear(t, 0, 2)` takes exactly the one cell. They are
 *  left ABSENT here rather than filled in, because the default is a property of
 *  the other argument and only the converter has both in hand. */
/** ⭐⭐ `table.cell_set_*` → THE ONE CELL PROPERTY EACH ONE PATCHES.
 *
 *  ⛔ MASTER'S TABLE, CARRIED ACROSS THE MERGE. It is a SEPARATE roster from
 *  `SETTER_PROPS` because a cell setter is not a `set_*` on the table — it is
 *  addressed by (column, row), so it shares `cell`'s address shape and not its
 *  meaning. Without this the ten `cell_set_*` names were filed as UNSUPPORTED
 *  methods, which is how the merge's own test suite found the gap. */
export const CELL_SETTER_PROPS = Object.freeze({
  cell_set_text: 'text',
  cell_set_text_color: 'text_color',
  cell_set_bgcolor: 'bgcolor',
  cell_set_text_size: 'text_size',
  cell_set_text_halign: 'text_halign',
  cell_set_text_valign: 'text_valign',
  cell_set_text_formatting: 'text_formatting',
  cell_set_tooltip: 'tooltip',
  cell_set_width: 'width',
  cell_set_height: 'height',
})

export const CLEAR_POSITIONAL = Object.freeze(['start_column', 'start_row',
  'end_column', 'end_row'])

/**
 * A Pine setter name → the canonical properties it writes, in the order its
 * arguments arrive AFTER the object handle.
 *
 * ⭐ `set_xy1` IS TWO PROPERTIES, and that is the whole reason this table maps
 * to a LIST. It is also the commonest setter in the reachable corpus (9 sites),
 * so a reader that treated one setter as one property would lose half of every
 * line move.
 */
export const SETTER_PROPS = Object.freeze({
  line: Object.freeze({
    set_x1: ['x1'], set_y1: ['y1'], set_x2: ['x2'], set_y2: ['y2'],
    set_xy1: ['x1', 'y1'], set_xy2: ['x2', 'y2'],
    set_color: ['color'], set_width: ['width'], set_style: ['style'], set_extend: ['extend'],
  }),
  label: Object.freeze({
    set_x: ['x'], set_y: ['y'], set_xy: ['x', 'y'], set_text: ['text'],
    set_color: ['color'], set_textcolor: ['textcolor'], set_style: ['style'],
    set_size: ['size'], set_textalign: ['textalign'], set_tooltip: ['tooltip'],
    set_yloc: ['yloc'],
  }),
  box: Object.freeze({
    set_left: ['left'], set_top: ['top'], set_right: ['right'], set_bottom: ['bottom'],
    set_lefttop: ['left', 'top'], set_rightbottom: ['right', 'bottom'],
    set_bgcolor: ['bgcolor'], set_border_color: ['border_color'],
    set_border_width: ['border_width'], set_border_style: ['border_style'],
    set_extend: ['extend'], set_text: ['text'], set_text_color: ['text_color'],
    set_text_size: ['text_size'],
  }),
  table: Object.freeze({
    set_position: ['position'], set_bgcolor: ['bgcolor'],
    set_frame_color: ['frame_color'], set_frame_width: ['frame_width'],
    set_border_color: ['border_color'], set_border_width: ['border_width'],
  }),
  linefill: Object.freeze({ set_color: ['color'] }),
})

export const OBJECT_NAMESPACES = Object.freeze(['line', 'label', 'box', 'table', 'linefill'])
/** Named but NOT built — reported with its count rather than half-implemented. */
export const OUT_OF_SCOPE_NAMESPACES = Object.freeze(['polyline'])

const COLLECTION_CALLS = Object.freeze(new Set(['push', 'unshift', 'set', 'remove', 'clear', 'pop', 'shift']))
/** ⭐ C11b — every operator that REASSIGNS an existing name (Pine reference). */
const REASSIGN_OPS = Object.freeze(new Set([':=', '+=', '-=', '*=', '/=', '%=']))
/** ⭐ C16 — every array method that CHANGES the array (Pine reference). One this
 *  pass does not carry leaves a drawing collection diverged. */
const COLLECTION_MUTATORS = Object.freeze(new Set(['push', 'set', 'remove', 'clear', 'pop', 'shift',
  'unshift', 'insert', 'reverse', 'sort', 'fill', 'concat']))

/**
 * Walk the statement tree and pull out every object operation, with the guard
 * it sits under.
 *
 * @param {Array}  stmts    `blockStatements` output — `{header, body, sub}`
 * @param {object} h        injected token helpers
 * @param {Function} h.isPunct
 * @param {Function} h.findTop
 * @param {Function} h.parseArguments
 * @param {Function} h.Cursor
 * @returns {{decls, ops, diagnostics}}
 */
export function collectObjectOps(stmts, h) {
  const decls = new Map() // pine name → { family, kind: 'var'|'local'|'coll' }
  // ⭐ `let`, not `const`: a loop body is collected into its OWN sink and then
  // nested under a `loop` op. See the `for` branch in `walk`.
  let ops = []
  // ⭐ `refusedCalls` and `inlinedCalls` belong to the function inliner below
  // (`objectFnInline.js`). A refused call is a COUNTED DROP downstream — see
  // `buildObjectProgram` — never a note beside a program that looks clean.
  const diagnostics = {
    loopBlocked: [], getters: [], unsupported: [], outOfScope: [],
    refusedCalls: [], inlinedCalls: 0,
    // ⭐ C16 — every DRAWING collection a change to which this pass could not
    // carry (inside a loop it cannot run, or a method it does not read). The
    // converter treats each as diverged from TradingView's (`divergedColls`).
    lostColls: [],
    // ⭐ C21 — beside each lost collection, WHY (`<what>@<line>`), same index.
    lostCollsWhy: [],
    // ⭐ C40 — every `for … in` this pass could have walked and did not, with
    // why (`<what>@<line>`): the loop then keeps the legacy refusal (`loopBlocked`).
    forInRefused: [],
  }
  const loseColl = (name, why, tok) => {
    diagnostics.lostColls.push(name)
    diagnostics.lostCollsWhy.push(`${why}@${tok && tok.line !== undefined ? tok.line : '?'}`)
  }
  let siteSeq = 0
  /** ⭐ C22 — every body this pass inlined, rewritten for its call site, and
   *  whether the call runs on EVERY bar (no guard, no loop): a `var` array its
   *  body declares is then that call site's own window (`buildObjectProgram`). */
  const inlineBodies = []
  /** Counter names of the loops currently open, innermost last. ⭐ Stamped onto
   *  every op emitted inside one, because the VALUE resolver lives in `pine.js`
   *  and has no other way to know that `r` is an iteration rather than a name it
   *  cannot find. */
  const loopIds = []

  const nsOf = (word) => {
    const dot = word.indexOf('.')
    return dot > 0 ? word.slice(0, dot) : null
  }
  const methodOf = (word) => word.slice(word.indexOf('.') + 1)

  /** ⛔⛔ EVERY NAME THIS SCRIPT DEFINES AS A FUNCTION OR A PINE 6 `method`.
   *
   *  The method form yields to it, and that is not a nicety. 19 of the 266
   *  committed scripts declare their own methods, and `pro-trading-art-…` writes
   *
   *      method maintainPivot(array<float> srcArray, float value) => …
   *      top.maintainPivot(ph)          ← `top` IS a declared array
   *
   *  Rewriting that to `array.maintainPivot` would refuse while naming a
   *  built-in nobody wrote. And the other direction is worse: a script defining
   *  `method get(array<float> this, int i) =>` would have its own method
   *  silently replaced by ours — the binding-order defect `pine.js` records four
   *  previous instances of. Collected over the WHOLE tree before the walk, since
   *  Pine lets a definition sit below its first use inside another function. */
  const defined = new Set()
  const scanDefs = (list) => {
    for (const s2 of list || []) {
      const ts = s2.header || []
      if (ts.length > 1) {
        if (ts[0].kind === 'ident' && ts[0].value === 'method' && ts[1].kind === 'ident') {
          defined.add(String(ts[1].value))
        } else if (ts[0].kind === 'ident' && h.isPunct(ts[1], '(')
            && h.findTop(ts, (x) => h.isPunct(x, '=>')) > 0) {
          const bare = splitMethodName(String(ts[0].value))
          defined.add(bare ? bare.method : String(ts[0].value))
        }
      }
      if (s2.sub && s2.sub.length) scanDefs(s2.sub)
    }
  }
  scanDefs(stmts)
  const isDefined = (name) => defined.has(name)

  // ── ⭐⭐ USER FUNCTIONS THAT DRAW — inlined at each call site ──────────────
  // See `objectFnInline.js` for the measurement and the Pine semantics. A
  // definition is never walked as top-level code any more; its body runs where
  // it is CALLED, under the call's guards, with its own per-call-site locals.
  const fnDefs = readFunctionDefs(stmts, h)
  const objColls = objectCollections(stmts, h)
  const drawing = drawingFunctions(fnDefs, objColls)
  const drawFns = new Set([...drawing].filter((n) => !fnDefs.get(n).isMethod))
  const drawMethods = new Set([...drawing].filter((n) => fnDefs.get(n).isMethod))
  const userFns = new Set([...fnDefs.keys()].filter((n) => !fnDefs.get(n).isMethod))
  const userMethods = new Set([...fnDefs.keys()].filter((n) => fnDefs.get(n).isMethod))
  /** ⭐ C34 — the witnessed chart series (`open`/`high`/`low`/`close`) no
   *  script name shadows: a conditional call's body reads them at an offset as
   *  the chart's own, not the call's (`objectFnInline.js`, C34). */
  const chartSeries = chartSeriesFor(stmts, h)
  const pureFns = pureFunctions(fnDefs, drawFns, chartSeries, drawMethods)
  /** Top-level names fixed for the whole run — see `barInvariantNames`. */
  const invariantNames = barInvariantNames(stmts, h)
  /** ⭐ C14 — names that hold a number read off a drawing (`getterScalars`). */
  const scalars = getterScalars(stmts, h)
  /** ⭐ C25 — a `var` declared inside a counted loop of an inlined helper
   *  (`bodyNames`' `carried`): renamed name → `{init, fn, line}` or
   *  `{refused, fn, line}`. See the walk's declaration and `:=` arms. */
  const loopScalars = new Map()
  let inlineSeq = 0
  let inlineDepth = 0
  /** How many loops (of any kind) the walk is inside right now. */
  let loopNest = 0
  /** ⭐ C20 — the `while` whose body is being read for the runtime lane, or null. */
  let rtLoop = null
  /** ⭐ C40 — counters minted for `for … in` and cap-`while` loops (see `walk`),
   *  and the element names those loops declared (a loop variable is the loop's
   *  own: a name another statement declared is never taken over). */
  let hostLoopSeq = 0
  const forInElems = new Set()
  /** ⭐ C40 — only the HOST lane runs these loops (`pine.js` `hostPasses`); the
   *  runtime lane's own object pass keeps the program it had. */
  const hostLoops = h.hostLoops === true

  /**
   * ⭐⭐ C20 — A `while` THE RUNTIME LANE READS PER PASS.
   *
   * A `while` cannot be a counted `loop` op the object runtime runs on its own —
   * its test is re-read every pass, which only an interpreter can do. But the
   * RUNTIME lane is one: it runs the loop exactly, and (C18) reads a drawing's
   * values where the drawing stands. So a `while` whose body only MAKES drawings
   * (`line.new(…)` / `label.new(…)` / `box.new(…)` as statements) becomes a loop
   * op whose passes, guards and values all come from ONE run of the script
   * (`pine.js`, `rtLoop`) — in Pine's creation order, pass by pass.
   *
   * ⛔ ONLY WHEN ALL OF IT CAN BE CARRIED, otherwise nothing changes: the member
   * door asked (`h.rtLoops`), the loop runs on the last bar only (an enclosing
   * `barstate.islast`, `h.isLastBarGuard` — the converter's own test), it is not
   * inside another loop or an inlined helper, and its body holds nothing but
   * statement creates — no handle kept, no delete, no list edit, no nested loop
   * that draws, no refused helper. A body that holds anything else is read again
   * the old way, with every counter and diagnostic rolled back first, so the
   * legacy refusal (`loopBlocked`) is exactly what it always was.
   */
  const rtLoopTry = (st, t, guards, inLoop, bodyScope) => {
    if (!h.rtLoops || inLoop || loopIds.length || loopNest || inlineDepth || rtLoop) return false
    if (typeof h.isLastBarGuard !== 'function'
        || !guards.some((g) => !g.negate && h.isLastBarGuard(g.toks))) return false
    const marks = Object.fromEntries(Object.entries(diagnostics)
      .filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]))
    const inlinedBefore = diagnostics.inlinedCalls
    const seq = siteSeq
    const iseq = inlineSeq
    const declsBefore = new Map(decls)
    const outer = ops
    const body = []
    ops = body
    rtLoop = { nest: loopNest + 1 }
    loopNest += 1
    try {
      walk(st.sub || [], guards, true, bodyScope)
    } finally {
      loopNest -= 1
      rtLoop = null
      ops = outer
    }
    const clean = Object.entries(marks).every(([k, n]) => diagnostics[k].length === n)
      && diagnostics.inlinedCalls === inlinedBefore
      && body.length > 0 && body.every((o) => o.k === 'create' && !o.into && !o.once)
    if (clean) {
      const loop = { line: t[0].line, column: t[0].column }
      for (const o of body) o.rtLoop = loop
      ops.push({
        k: 'loop', rt: true, rtLoop: loop, body, guards, locals: bodyScope,
        loopIds: [], at: t[0], line: st.header[0].line,
      })
      return true
    }
    for (const [k, n] of Object.entries(marks)) diagnostics[k].length = n
    diagnostics.inlinedCalls = inlinedBefore
    siteSeq = seq
    inlineSeq = iseq
    decls.clear()
    for (const [k, v] of declsBefore) decls.set(k, v)
    return false
  }
  /** ⛔ A REFUSED CALL IS A DROP, and says which function and why.
   *
   *  ⭐ AND WHAT ITS BODY WOULD HAVE REMOVED (`bodyEffects`), because a refused
   *  body is never walked and no other counter sees it — the member door's
   *  partial-drawing rule refuses a drawing that lost a removal (ruling
   *  2026-09-27, option b). `return-type` is the one refusal made AFTER the body
   *  was inlined: its ops are in the program, and only the returned handle is
   *  lost, so it carries no body effects. A function this reader cannot find
   *  has an unknown body and reports one removal of an unnamed family — the
   *  loud answer, never "removes nothing". */
  const refuseCall = (why, fn, st, detail) => {
    const def = fnDefs.get(fn)
    const effects = why === 'return-type' ? { kinds: {}, families: [], creates: [] }
      : def ? bodyEffects(def, fnDefs, objColls)
        : { kinds: { delete: 1 }, families: [null], creates: [null] }
    diagnostics.refusedCalls.push({
      why, fn, line: st && st.header && st.header[0] ? st.header[0].line : null,
      ...(detail ? { detail } : {}),
      effects,
    })
    return false
  }

  /** The namespace a METHOD-FORM receiver speaks for — `array`/`matrix`/`map`
   *  for a collection, the drawing family for a handle — read off `decls` and
   *  nowhere else.
   *
   *  ⛔⛔ THE FAMILY COMES FROM THE DECLARATION, NEVER FROM THE METHOD NAME.
   *  `delete` belongs to line, label, box, table and linefill alike and `get` to
   *  three collection namespaces, so reading the family off `.delete` would be
   *  this reader inventing a type system Pine already has and this engine does
   *  not. `array.new_line()` said `line`; that is the answer. */
  const receiverNs = (name) => {
    const d = decls.get(name)
    if (!d) return null
    return d.kind === 'coll' ? 'array' : d.family
  }

  /** Every name a block REASSIGNS with `:=`, at any depth inside it.
   *
   *  ⛔ `:=` ONLY. A plain `=` inside the block declares a name local to THAT
   *  block, which is invisible to the statement after the chain; a `:=` writes a
   *  name that already exists outside it, which is exactly the one a later cell
   *  can read. Treating the two alike would put a block-local name into the
   *  outer scope under a value the member cannot reach. */
  const reassignedIn = (list) => {
    const out = new Set()
    const scan = (items) => {
      for (const s2 of items || []) {
        const ts = s2.header || []
        for (let k = 1; k < ts.length; k += 1) {
          // ⭐ C11b — `+=` and its siblings reassign too (`x += 1` is `x := x + 1`).
          if (ts[k] && ts[k].kind === 'punct' && REASSIGN_OPS.has(ts[k].value)
              && ts[k - 1] && ts[k - 1].kind === 'ident') {
            out.add(ts[k - 1].value)
          }
        }
        if (s2.sub && s2.sub.length) scan(s2.sub)
      }
    }
    scan(list)
    return out
  }

  /**
   * ⭐⭐ C22 — AN `if` CHAIN IN AN INLINED BODY THAT ONLY ASSIGNS ITS LOCALS IS
   * A VALUE. vdubus-pattern-gen's `f_runEngine`:
   *
   *     shouldDraw = false
   *     if isHS
   *         shouldDraw := true
   *     else
   *         if rawName == "Gartley" and showGartley
   *             shouldDraw := true
   *         else if …
   *     if showStandard and f_checkStandardBearish() and shouldDraw   ← reads it
   *
   * Pine runs the chain in order, so after it `shouldDraw` IS
   * `isHS ? true : (rawName == "Gartley" and showGartley ? true : … : false)` on
   * this bar — each condition read as Pine's `if` reads it (`na` is false). The
   * value walk folds this shape at the top level; an inlined body was never
   * walked, so the name was opaque (`pine:state`) and every drawing it guarded
   * was dropped.
   * ⛔ EXACTLY THAT SHAPE: every arm holds only `name := expr` for a local whose
   * value before the chain is known (a declaration or an earlier fold), or a
   * nested chain of the same kind; no condition or value reads a name the chain
   * assigns. Anything else returns null and the name stays opaque, as before.
   * @returns {{end: number, bindings: Map<string, object[]>}|null}
   */
  const foldLocalChain = (items, at, scope) => {
    const prior = new Map()
    for (const b of scope || []) {
      if (!b.st || !b.st.synthetic) continue
      // ⛔ A `var` / `varip` local is not its initialiser on this bar: it holds
      // what the last bar (or the last pass of a loop) left, so a chain over it
      // has no "value before" this reader knows (C21's `update_drawings`).
      const w0 = b.st.header && b.st.header[0]
      const persists = w0 && w0.kind === 'ident' && (w0.value === 'var' || w0.value === 'varip')
      if (b.reassign || persists) prior.delete(b.name)
      else prior.set(b.name, b.toks)
    }
    const armsOf = (list, i) => {
      const arms = [{ cond: list[i].header.slice(1), body: list[i].sub || [] }]
      let k = i
      while (list[k + 1] && list[k + 1].header && list[k + 1].header[0]
          && list[k + 1].header[0].kind === 'ident' && list[k + 1].header[0].value === 'else') {
        k += 1
        const eh = list[k].header
        if (eh[1] && eh[1].kind === 'ident' && eh[1].value === 'if') arms.push({ cond: eh.slice(2), body: list[k].sub || [] })
        else { arms.push({ cond: null, body: list[k].sub || [] }); break }
      }
      return { arms, end: k }
    }
    const top = armsOf(items, at)
    const assigned = reassignedIn(items.slice(at, top.end + 1).map((s) => ({ header: [], sub: s.sub || [] })))
    if (!assigned.size) return null
    const a0 = items[at].header[0]
    const T = (kind, value) => ({ kind, value, line: a0.line, column: a0.column, index: a0.index })
    const P = (v) => T('punct', v)
    let bad = false
    let foldChain = null
    const foldList = (list, env) => {
      const its = splitCommaStatements(list, h)
      let cur = env
      for (let i = 0; i < its.length && !bad; i += 1) {
        const t = its[i].header || []
        if (!t.length) { bad = true; break }
        if (t[0].kind === 'ident' && t[0].value === 'if') {
          const c = armsOf(its, i)
          cur = foldChain(c.arms, cur)
          i = c.end
          continue
        }
        if (t.length > 2 && t[0].kind === 'ident' && h.isPunct(t[1], ':=') && !(its[i].sub || []).length
            && cur.has(String(t[0].value))) {
          const rhs = t.slice(2)
          if (rhs.some((x) => x.kind === 'ident' && assigned.has(String(x.value)))) { bad = true; break }
          cur = new Map(cur)
          cur.set(String(t[0].value), rhs)
          continue
        }
        bad = true
      }
      return cur
    }
    foldChain = (arms, env) => {
      if (arms.some((a) => a.cond && (!a.cond.length
          || a.cond.some((x) => x.kind === 'ident' && assigned.has(String(x.value)))))) { bad = true; return env }
      const results = arms.map((a) => foldList(a.body, env))
      if (bad) return env
      const out = new Map(env)
      const hasElse = !arms[arms.length - 1].cond
      for (const n of assigned) {
        if (!env.has(n)) continue
        if (!results.some((r) => r.get(n) !== env.get(n))) continue
        let acc = hasElse ? results[arms.length - 1].get(n) : env.get(n)
        for (let k = (hasElse ? arms.length - 2 : arms.length - 1); k >= 0; k -= 1) {
          const c = arms[k].cond
          acc = [P('('), P('('), T('ident', 'na'), P('('), ...c, P(')'), P('?'), T('number', 0), P(':'), P('('), ...c, P(')'), P(')'),
            P('?'), P('('), ...results[k].get(n), P(')'), P(':'), P('('), ...acc, P(')'), P(')')]
        }
        out.set(n, acc)
      }
      return out
    }
    const folded = foldChain(top.arms, prior)
    if (bad) return null
    const bindings = new Map()
    for (const n of assigned) {
      if (!folded.has(n)) return null
      if (folded.get(n) !== prior.get(n)) bindings.set(n, folded.get(n))
    }
    return bindings.size ? { end: top.end, bindings } : null
  }

  /**
   * `guards` is a stack of `{ toks, negate }`; the runtime AND of all of them.
   * `scope` is the BLOCK-LOCAL bindings seen so far, in order.
   *
   * ⭐⭐ THE BLOCK-LOCAL SCOPE IS WHAT MAKES THE TABLE POPULATION REACHABLE.
   * The corpus idiom is:
   *
   *     if barstate.islast and showDashboard
   *         stateText = dir == 1 ? "CALL" : "WAIT"
   *         table.cell(dash, 1, 0, stateText)
   *
   * `stateText` exists only inside that block. The main value walk never binds
   * it — `foldIfChain` refuses a block containing object statements — so a
   * resolver handed the top-level env sees an unknown name and the cell is lost.
   * Carrying the block's own bindings with each op is the difference between a
   * dashboard with content and an empty frame.
   */
  // ⭐ C14 — WHERE IN THE BAR EACH OP RUNS: the ordinal of the top-level
  // statement it came from (`topPos`), stamped on every op (loop bodies too).
  // See `varWrites` below for what it is compared with.
  // ⭐ C12r — and the TOKEN INDEX that statement starts at (`topTok`), which is
  // what `pine.js` keys the walk's per-statement bindings by (`envLog`).
  let rootPos = -1
  let rootTok = null
  let rootMark = 0
  const stampTop = (list, pos, tok) => {
    for (const o of list) {
      if (o.topPos === undefined) { o.topPos = pos; o.topTok = tok }
      if (o.k === 'loop' && Array.isArray(o.body)) stampTop(o.body, pos, tok)
    }
  }
  const stampRootSince = () => {
    if (rootPos >= 0) stampTop(ops.slice(rootMark), rootPos, rootTok)
    rootMark = ops.length
  }
  const walk = (list, guards, inLoop, scope) => {
    // ⭐⭐ C22 — EVERY earlier condition of the chain, not the last one: see `else`.
    let prevIfConds = []
    // ⭐ C11b — the scope the chain's FIRST `if` stood in (see `guardAt`).
    let prevIfLocals = null
    let localScope = scope
    const isRoot = list === stmts
    // ⭐ C22 — a chain of an inlined body folded into its locals' values
    // (`foldLocalChain`), applied once its last arm has been walked.
    let pendingFold = null
    const applyFold = (at) => {
      if (!pendingFold || pendingFold.end !== at) return
      for (const [name, toks] of pendingFold.bindings) {
        localScope = [...localScope, { name, toks, st: pendingFold.st, assign: true }]
      }
      pendingFold = null
    }
    // ⭐ `a, b, c` on one line is three statements — `splitCommaStatements`.
    const walkItems = splitCommaStatements(list, h)
    for (let wi = 0; wi < walkItems.length; wi += 1) {
      const st = walkItems[wi]
      if (isRoot) {
        stampRootSince()
        rootPos += 1
        rootTok = st.header && st.header[0] && Number.isFinite(st.header[0].index) ? st.header[0].index : null
      }
      const t = st.header
      if (!t || !t.length) continue
      const first = t[0]
      const word = first.kind === 'ident' ? first.value : null
      // ⭐ C25 — a loop scalar (`loopScalars`) is written ONLY by `x := e` as a
      // whole statement where the reader counts the loop; any other write of it
      // (`+=`, one inside a `while`, one nested in an expression) is a write this
      // program would not make, so the scalar is refused, whole.
      if (st.synthetic && st.synthetic.carried && loopScalars.size) {
        for (let i = 1; i < t.length; i += 1) {
          if (!isMutator(t[i]) || !t[i - 1] || t[i - 1].kind !== 'ident') continue
          const nm = String(t[i - 1].value)
          const rec = loopScalars.get(nm)
          if (!rec || rec.refused) continue
          if (i !== 1 || t[i].value !== ':=' || inLoop) {
            loopScalars.set(nm, { refused: `written at line ${t[0].line} as \`${t[i].value}\` where only a whole \`:=\` in a counted loop is carried`, fn: rec.fn, line: rec.line })
          }
        }
      }

      // ⭐⭐ A DEFINITION IS NOT CODE THAT RUNS HERE. Its body runs at each call
      // site (see `inlineCall`), so it is skipped at the definition — the
      // catch-all at the bottom of this loop used to descend into it and emit
      // its drawing as if it ran unconditionally on every bar.
      if (definitionHeader(t, h)) continue

      // ⭐⭐ A CALL TO A FUNCTION THAT DRAWS. Two shapes are inlined — the call
      // as a whole statement, and as the whole right-hand side of an assignment.
      // Anywhere else the call sits inside an expression whose evaluation order
      // this reader does not model, and it is REFUSED by name.
      // ⭐⭐ A METHOD THAT DRAWS is read exactly like a function that draws: the
      // same two statement shapes inline, everything else refuses by the same
      // names. `recv.m(…)` becomes `m(recv, …)` in `inlineAt` and nowhere else.
      const drawMethod = drawMethods.size
        ? (callsMethodAny(t, drawMethods) || callsAny(t, drawMethods)) : null
      const drawCall = drawFns.size ? callsAny(t, drawFns) : null
      if (drawMethod || drawCall) {
        const headOf = (tk) => (drawMethod ? methodHead(tk, drawMethods) : null)
          || (tk && tk.kind === 'ident' && drawFns.has(String(tk.value))
            ? { fn: String(tk.value), recv: null } : null)
        if (word !== 'if' && word !== 'else' && word !== 'for' && word !== 'while'
            && word !== 'switch') {
          const whole = headOf(first)
          if (whole && h.isPunct(t[1], '(') && closeOf(t, 1) === t.length - 1) {
            inlineAt(whole, t, 1, null, guards, inLoop, st, localScope)
            continue
          }
          const reIdx = h.findTop(t, (x) => h.isPunct(x, ':='))
          const asIdx = reIdx >= 0 ? reIdx : h.findTop(t, (x) => h.isPunct(x, '='))
          const rhs = asIdx > 0 ? t.slice(asIdx + 1) : []
          const rh = rhs.length > 1 ? headOf(rhs[0]) : null
          if (rh && h.isPunct(rhs[1], '(') && closeOf(rhs, 1) === rhs.length - 1) {
            if (word === 'var' || word === 'varip') {
              refuseCall('var-init', rh.fn, st)
              continue
            }
            // ⭐⭐ C11c — `[Line, A, B] = drawLL(…)`: a TUPLE of the handles the
            // body returns, one name each (see the tuple arm in `inlineCall`).
            const tupleClose = h.isPunct(t[0], '[') ? t.findIndex((x) => h.isPunct(x, ']')) : -1
            const tupleNames = tupleClose > 0 && asIdx > tupleClose
              ? t.slice(1, tupleClose).filter((x) => x.kind === 'ident').map((x) => String(x.value))
              : null
            const intoTok = reIdx >= 0 ? t[asIdx - 1] : h.boundName(t, asIdx)
            const into = tupleNames || (intoTok && intoTok.kind === 'ident' ? String(intoTok.value) : null)
            inlineAt(rh, rhs, 1, into, guards, inLoop, st, localScope)
            continue
          }
        }
        refuseCall('in-expression', drawMethod || drawCall, st)
      }

      // ⭐⭐ A `switch` IS A CHAIN OF GUARDED ARMS, and each arm runs under its own
      // condition AND the negation of every arm above it (Pine takes the FIRST arm
      // that matches). ⚰️ Before this branch a `switch` fell through to the
      // catch-all below, which walks a nested block under the PARENT's guards —
      // so every drawing inside an arm lost its arm's condition and ran on every
      // bar. Measured against TradingView 2026-09-27 (Zero-Lag MA Trend Levels,
      // NYSE:RDDT 1D, live capture): two `label.new` arms guarded by crossings drew
      // the 50-label cap where TradingView drew 8 — a confident wrong picture, not
      // a refusal.
      // ⭐ `switch <subject>` arms compare the subject: `(subject) == (match)`.
      // A condition this lane cannot read (an object getter, an unsupported call)
      // makes the GUARD unreadable, and an unreadable guard is dropped and counted
      // by the converter — never drawn unconditionally.
      if (word === 'switch') {
        const subject = t.slice(1)
        const P = (value) => ({ kind: 'punct', value, line: first.line, column: first.column, index: first.index })
        const prior = []
        for (const arm of st.sub || []) {
          const ah = arm.header || []
          const at = h.findTop(ah, (x) => h.isPunct(x, '=>'))
          const armGuards = [...guards, ...prior.map((toks) => ({ toks, negate: true, locals: localScope }))]
          if (at < 0) {
            // Not an arm shape this reader knows: an empty guard is unreadable, so
            // whatever it draws is refused rather than run without its condition.
            walk([arm], [...armGuards, { toks: [], negate: false, locals: localScope }], inLoop, localScope)
            continue
          }
          const match = ah.slice(0, at)
          let g = armGuards
          if (at > 0) {
            const cond = subject.length
              ? [P('('), ...subject, P(')'), P('=='), P('('), ...match, P(')')]
              : match
            prior.push(cond)
            g = [...armGuards, { toks: cond, negate: false, locals: localScope }]
          }
          const rhs = ah.slice(at + 1)
          if (rhs.length) walk([{ ...arm, header: rhs }], g, inLoop, localScope)
          else walk(arm.sub || [], g, inLoop, localScope)
        }
        // ⭐ C11b — what an arm reassigns is a new binding after the `switch`
        // (the value walk records it against this statement when it folds it).
        for (const name of reassignedIn(st.sub || [])) {
          localScope = [...localScope, { name, toks: t, st, reassign: true }]
        }
        continue
      }

      if (word === 'if') {
        const condEnd = t.length
        const cond = t.slice(1, condEnd)
        prevIfConds = [cond]
        prevIfLocals = localScope
        // ⭐⭐ C11b — A CONDITION IS READ WHERE ITS `if` STANDS (`locals`), not where
        // the op under it stands: the block may reassign a name the condition
        // read (`if high >= hh` → `hh := high`), and the op below must not see
        // its own `if` re-evaluated with the new value (`camarilla`, measured).
        if (st.synthetic) {
          const f = foldLocalChain(walkItems, wi, localScope)
          if (f) pendingFold = { ...f, st }
        }
        walk(st.sub || [], [...guards, { toks: cond, negate: false, locals: localScope }], inLoop, localScope)
        // ⭐⭐ R2 STEP 3 — A NAME THE CHAIN REASSIGNS IS A NEW BINDING FOR EVERY
        // STATEMENT AFTER IT. `string atrMultText = ''` then `atrMultText := …`
        // inside an `if` leaves TWO bindings for one name, and the cell below the
        // chain must read the second. `foldIfChain` records the ternary it built
        // against this very statement; adding the name here is what makes
        // `scopeFor` prefer it, because a later entry in `localScope` overwrites
        // an earlier one — Pine's own order.
        // ⛔ WITHOUT IT THE CELL RENDERS THE DECLARED INITIAL VALUE, which for
        // v2 is the empty string: a blank cell where the author wrote a number,
        // reading as "the value is empty" — a claim they never made.
        for (const name of reassignedIn(st.sub || [])) {
          localScope = [...localScope, { name, toks: t, st, reassign: true }]
        }
        applyFold(wi)
        continue
      }
      if (word === 'else') {
        // `else if c2` → not(c1) and c2 ; a later `else if c3` → not(c1) and
        // not(c2) and c3 ; bare `else` → not(every earlier condition).
        // ⛔⛔ C22 (H14) — EVERY EARLIER ARM'S CONDITION IS NEGATED, not the last
        // one's. Pine runs an arm only when every arm above it was false; this
        // carried `not(c2)` alone into the third arm, so on a bar where `c1` and
        // `c3` both held it ran arm ONE and arm THREE. ⚰️ MEASURED on RDDT 1D
        // (`if close > open` / `else if close > close[1]` / `else`, bars 401–631):
        // the `else` label drawn on 124 bars where Pine draws 107 — a confident
        // wrong picture, live on the objects pane. The value lane's fold of the
        // same chain was right (a nested ternary); only the object guards drifted.
        const isElseIf = t[1] && t[1].kind === 'ident' && t[1].value === 'if'
        const next = [...guards]
        for (const c of prevIfConds) next.push({ toks: c, negate: true, locals: prevIfLocals })
        if (isElseIf) {
          const cond = t.slice(2)
          prevIfConds = [...prevIfConds, cond]
          next.push({ toks: cond, negate: false, locals: prevIfLocals })
        }
        // ⭐ C11b — an `else` arm starts from the scope BEFORE the chain: the arm
        // above it did not run, so nothing it reassigned has happened here.
        walk(st.sub || [], next, inLoop, prevIfLocals || localScope)
        // ⭐ R2 STEP 3 — same as the `if` arm: an `else` body may reassign too,
        // and `foldIfChain` keys its record on the chain's FIRST statement, so
        // this points at `st` for the join the same way.
        for (const name of reassignedIn(st.sub || [])) {
          localScope = [...localScope, { name, toks: t, st, reassign: true }]
        }
        applyFold(wi)
        continue
      }
      if (word === 'for' || word === 'while') {
        // ⭐⭐ A COUNTED `for` BECOMES A `loop` OP; EVERYTHING ELSE STILL REFUSES.
        //
        // ⚰️ THE OLD REASON WAS RIGHT ABOUT THE WRONG THING. "RISK-043 stands,
        // the loop is not executed, and drawing the first iteration would be a
        // lie" is true of a STATIC reader — this pass cannot unroll
        // `for i = 0 to slots - 1`, because `slots` is a runtime value. But the
        // object RUNTIME executes bar by bar and now carries a `loop` op, so the
        // loop never needed unrolling: it needed to survive the read.
        //
        // ⛔ `while` STILL REFUSES, and that is not laziness. A `loop` op is a
        // COUNTED range (`from`, `to`); a `while` runs on a condition the object
        // runtime cannot re-evaluate without becoming an interpreter, and
        // guessing a bound would draw a table with the wrong number of rows.
        // Same for `for … by <step>`: the op has no step, so pretending 1 would
        // draw every row of a loop the author wrote to skip.
        const head = word === 'for' ? parseForHead(t) : null
        // ⭐⭐ C11b — A NAME THE LOOP REASSIGNS HAS NO SINGLE VALUE inside it (the
        // previous iteration's) nor, to this reader, after it: it is entered as
        // an unrecorded reassignment both ways, which `scopeFor` refuses by name.
        const loopRe = [...reassignedIn(st.sub || [])].map((name) => ({ name, toks: t, st, reassign: true }))
        const bodyScope = loopRe.length ? [...localScope, ...loopRe] : localScope
        // ⭐⭐ C40 — A `for … in` OVER A LIST THIS LANE HOLDS, AND THE CAP `while`.
        // Both become loop ops the object runtime runs (`forInPlan`, `capWhileOf`);
        // every other shape falls through to the refusal below, unchanged.
        // ⛔ Inside a loop this reader does not run, the body is walked with that
        // loop's `inLoop`, so every op in it is refused there and no loop is left.
        if (!head && hostLoops) {
          const plan = word === 'for' ? forInPlan(t, st) : capWhileOf(t, st)
          if (plan) {
            hostLoopSeq += 1
            const tok0 = t[0]
            const line = st.header[0].line
            const T = (kind, value) => ({ kind, value, line: tok0.line, column: tok0.column, index: tok0.index })
            const counter = plan.idx || `uct_loop_${hostLoopSeq}`
            let scopeIn = bodyScope
            const outer = ops
            const body = []
            ops = body
            loopIds.push(counter)
            loopNest += 1
            try {
              if (plan.kind === 'coll') {
                // The element is a COPY of the slot taken as the pass starts
                // (C16's eager `copy` → `setreg`): Pine's loop variable.
                ops.push({
                  k: 'copy', into: plan.elem, fromColl: plan.src, index: h.parseWholeExpression([T('ident', counter)]),
                  guards, locals: bodyScope, loopIds: [...loopIds], at: tok0, line,
                })
              } else if (plan.kind === 'window') {
                // The element of a bounded numeric window is `array.get(w, i)` —
                // the read C32 already serves per pass (`wget`).
                scopeIn = [...bodyScope, {
                  name: plan.elem,
                  toks: [T('ident', 'array.get'), T('punct', '('), T('ident', plan.src), T('punct', ','), T('ident', counter), T('punct', ')')],
                  st: { header: t, sub: [], synthetic: { fn: 'for … in', mutable: new Set(), carried: new Set() } },
                }]
              }
              walk(st.sub || [], guards, inLoop, scopeIn)
            } finally {
              loopNest -= 1
              loopIds.pop()
              ops = outer
            }
            if (loopRe.length) localScope = [...localScope, ...loopRe]
            // ⛔ Nothing carried (an element copy alone draws nothing) → no loop op.
            if (!body.some((b) => !(b.k === 'copy' && b.fromColl === plan.src && b.into === plan.elem))) continue
            const common = { k: 'loop', id: counter, body, guards, locals: localScope, loopIds: [...loopIds], at: tok0, line }
            if (plan.kind === 'cap') {
              ops.push({ ...common, whileToks: t.slice(1), capColl: plan.coll })
            } else if (plan.kind === 'all') {
              ops.push({ ...common, forIn: { all: plan.family, elem: plan.elem } })
            } else {
              // `0 to size − 1`, never counted down: an empty list runs no pass.
              ops.push({
                ...common,
                from: { value: h.parseWholeExpression([T('number', 0)]) },
                to: { value: h.parseWholeExpression([T('ident', 'array.size'), T('punct', '('), T('ident', plan.src), T('punct', ')'), T('punct', '-'), T('number', 1)]) },
                asc: true,
                forIn: { src: plan.src, elem: plan.kind === 'coll' ? plan.elem : null },
              })
            }
            continue
          }
        }
        if (!head) {
          // ⭐⭐ C20 — A `while` THE RUNTIME LANE READS PER PASS. See `rtLoopTry`.
          if (word === 'while' && rtLoopTry(st, t, guards, inLoop, bodyScope)) {
            if (loopRe.length) localScope = [...localScope, ...loopRe]
            continue
          }
          loopNest += 1
          try { walk(st.sub || [], guards, true, bodyScope) } finally { loopNest -= 1 }
          if (loopRe.length) localScope = [...localScope, ...loopRe]
          continue
        }
        const outer = ops
        const body = []
        ops = body
        loopIds.push(head.id)
        loopNest += 1
        try { walk(st.sub || [], guards, inLoop, bodyScope) } finally { loopNest -= 1 }
        loopIds.pop()
        ops = outer
        if (loopRe.length) localScope = [...localScope, ...loopRe]
        // ⛔ A LOOP THAT COLLECTED NOTHING IS NOT EMITTED. `assertObjectProgram`
        // refuses an empty body ("a loop with an empty body draws nothing"), and
        // it is right to — but the honest answer here is that this loop drew
        // nothing THIS READER COULD CARRY, which the per-op diagnostics already
        // say. Emitting an empty one would turn that into a build error.
        if (!body.length) continue
        ops.push({
          k: 'loop',
          id: head.id,
          from: head.from,
          to: head.to,
          ...(head.step ? { step: head.step } : {}),
          body,
          guards,
          locals: localScope,
          loopIds: [...loopIds],
          at: t[0],
          line: st.header[0].line,
        })
        continue
      }

      // ── a declaration: `var line l = na` / `var box b = box.new(…)` ───────
      if (word === 'var' || word === 'varip') {
        const fam = t[1] && t[1].kind === 'ident' ? t[1].value : null
        const name = t[2] && t[2].kind === 'ident' ? t[2].value : null
        if (fam && name && OBJECT_NAMESPACES.includes(fam)) {
          decls.set(name, { family: fam, kind: 'var' })
          const eq = h.findTop(t, (x) => h.isPunct(x, '='))
          if (eq > 0) {
            const rhs = t.slice(eq + 1)
            // ⭐⭐ `var x = <expr>` INITIALISES ONCE, and that is not a detail.
            // ⚰️ Without this, `var table t = table.new(…)` created a NEW table
            // on every bar: 300 bars, 300 tables, the 8-table envelope exceeded
            // by bar 8, and the whole indicator refused. The ladder caught it at
            // Level 9 — a dashboard is the commonest `var` initialiser in the
            // corpus, so this was not an edge case, it was the main road.
            //
            // ⛔⛔ A `var` INITIALISER IS NOT SPLIT ON ITS TERNARY, AND THE
            // REFUSAL IS COUNTED. `var line l = cond ? line.new(…) : na`
            // evaluates its right-hand side ONCE, on the first bar, and Pine
            // leaves `l` as `na` for the whole run if `cond` was false there. A
            // guarded `once` create would instead fire on the first bar the
            // condition turns true — a line on a member's chart their script
            // never drew, which is the wrong direction to fail in. Saying so is
            // the only honest answer available without a second op kind.
            if (!emitFromRhs(rhs, name, guards, inLoop, st, localScope, true)) {
              const named = createNameIn(rhs)
              if (named) diagnostics.unsupported.push(named)
            }
          }
          continue
        }
        // ⭐⭐ THE UNTYPED FORM — `var t = table.new(…)`, NO TYPE ANNOTATION.
        //
        // ⚰️ The branch above requires `var <family> <name> =`, so it reads
        // `var table t = …` and MISSES `var t = …`. The type annotation is
        // OPTIONAL in Pine 5 and 6, and the untyped spelling is the one most
        // authors write. Falling through sent it to the plain-assignment branch
        // below, which does not pass `once` — so the declaration that means
        // "make this table exactly once" created a NEW table on EVERY BAR.
        //
        // ⛔ AND IT FAILS THE WAY THE TYPED BUG FAILED, which is why the note
        // above is worth re-reading: 300 bars is 300 tables, the object envelope
        // is spent, and the indicator refuses — or, under a smaller bar count,
        // it simply draws the FIRST bar's numbers and looks entirely plausible
        // (measured: 4 bars, 4 live tables, the reader picked up bar 0).
        //
        // ⭐ THE FAMILY COMES FROM THE RIGHT-HAND SIDE, which is the only place
        // it is stated in this spelling. `eq === 2` is what distinguishes the
        // two forms: `var t =` puts `=` at index 2, `var table t =` at index 3,
        // so `var float x = 1.0` cannot reach here.
        const untypedEq = h.findTop(t, (x) => h.isPunct(x, '='))
        if (untypedEq === 2 && t[1] && t[1].kind === 'ident') {
          const rhs = t.slice(untypedEq + 1)
          // ⭐⭐ `var b = box(na)` — AN EMPTY HANDLE, TYPED BY THE CAST. The
          // untyped spelling of `var box b = na`, and the only place the family
          // is stated. ⚰️ Without it the name was never declared, so every
          // `b.set_right(…)` on it matched no handle and `b := m(…)` stored the
          // returned box in a LOCAL register that is cleared every bar — Pine's
          // `var` keeps it. Measured on Zero-Lag MA Trend Levels, 2026-09-27.
          const naFam = naHandleFamily(rhs)
          if (naFam) {
            if (!decls.has(t[1].value)) decls.set(t[1].value, { family: naFam, kind: 'var' })
            continue
          }
          if (rhs.length && rhs[0].kind === 'ident') {
            const ns = nsOf(rhs[0].value)
            if (ns && OBJECT_NAMESPACES.includes(ns) && methodOf(rhs[0].value) === 'new') {
              const nm = t[1].value
              if (!decls.has(nm)) decls.set(nm, { family: ns, kind: 'var' })
              emitFromRhs(rhs, nm, guards, inLoop, st, localScope, true)
              continue
            }
          }
        }
        if (fam && OUT_OF_SCOPE_NAMESPACES.includes(fam)) diagnostics.outOfScope.push(fam)
      }

      // ── `name := line.new(…)` or `name = line.new(…)` ────────────────────
      const assign = h.findTop(t, (x) => h.isPunct(x, ':=')) >= 0
        ? h.findTop(t, (x) => h.isPunct(x, ':='))
        : h.findTop(t, (x) => h.isPunct(x, '='))
      if (assign > 0 && t[assign - 1] && t[assign - 1].kind === 'ident') {
        const name = t[assign - 1].value
        const rhs = t.slice(assign + 1)
        // ⭐⭐ C14 — `x := label.get_y(l)` / `x = l.get_x()` on a getter-fed
        // scalar: WRITTEN HERE, in op order, under this block's guards. Nothing
        // else about the statement changes (it still joins the block scope).
        if (scalars.has(String(name)) && !inLoop && isBareGetterAt(rhs, 0, h)) {
          ops.push({
            k: 'getnum', name: String(name), rhs, guards, locals: localScope, loopIds: [...loopIds],
            at: t[0], line: st.header[0].line,
          })
        }
        // ⭐⭐ C25 — A HELPER'S `var` CARRIED IN A LOOP. Pine initialises it ONCE
        // (per call site — the rename already made it this site's) and keeps it
        // across the loop's passes and the bars; its declaration runs nothing
        // after the first time. So it is ONE runtime scalar: the declaration
        // gives its initial value, each `:=` writes it here — in op order, under
        // this block's guards, inside this loop (`getnum`, `loop: true`) — and
        // the converter reads it whole where the reader reads a scalar.
        // ⛔ Only a counted loop the reader keeps (`loopIds`, never a `while`
        // it walks as opaque — `inLoop`), a numeric declaration (`float`/`int`
        // or untyped) and a literal initialiser; anything else is recorded
        // refused, and every read keeps `pine:state`, named.
        const sname = String(name)
        if (st.synthetic && st.synthetic.carried && st.synthetic.carried.has(sname)) {
          if (word === 'var' || word === 'varip') {
            const typed = assign === 3 ? String(t[1].value) : null
            const lit = literalInit(t, assign + 1, h)
            const why = word === 'varip' ? 'a `varip`'
              : inLoop || !loopIds.length ? 'declared in a loop this reader does not count'
                : typed !== null && typed !== 'float' && typed !== 'int' ? `a \`${typed}\``
                  : !lit ? 'an initialiser that is not a literal number or `na`' : null
            loopScalars.set(sname, why
              ? { refused: why, fn: st.synthetic.fn, line: st.header[0].line }
              : { init: lit.init, fn: st.synthetic.fn, line: st.header[0].line })
          } else if (h.isPunct(t[assign], ':=') && loopScalars.has(sname) && !loopScalars.get(sname).refused) {
            ops.push({
              k: 'getnum', name: sname, rhs, guards, locals: localScope, loopIds: [...loopIds],
              at: t[0], line: st.header[0].line, loopScalar: true,
            })
          }
        }
        // ⭐⭐ `b := box(na)` / `b := na` — THE HANDLE IS EMPTIED, the object is
        // not. Pine keeps the box on the chart; only the variable forgets it, so
        // a later `b.set_right(…)` or `b.delete()` touches nothing. ⚰️ Unread,
        // the register kept its object and the next setter moved a box the
        // script had let go of. ⛔ `:=` only, and only on a declared handle
        // whose family the cast names — `b = box(na)` declares, it does not reset.
        const held = decls.get(name)
        if (h.isPunct(t[assign], ':=') && held && held.kind !== 'coll'
            && (naHandleFamily(rhs) === held.family
              || (rhs.length === 1 && rhs[0].kind === 'ident' && rhs[0].value === 'na'))) {
          if (inLoop) { diagnostics.loopBlocked.push(`${held.family}(na)`); continue }
          ops.push({
            k: 'reset', into: name, guards, locals: localScope, loopIds: [...loopIds],
            at: t[0], line: st.header[0].line,
          })
          continue
        }
        // ⭐⭐ C16 — `box b = array.get(bs, i)` / `b = bs.get(i)`: A HANDLE READ
        // OUT OF A DRAWING COLLECTION, into a name the lines below act through.
        //
        //     for i = array.size(bull_boxes) - 1 to 0
        //         box b = array.get(bull_boxes, i)          ← institutional-smc
        //         if low < box.get_bottom(b)
        //             box.delete(b)
        //             array.remove(bull_boxes, i)
        //
        // It is a COPY taken NOW, which is Pine's rule: `b` keeps naming the box
        // it read even after `array.remove` shifts the slots under it, so the op
        // is an eager register write (`copy` → `setreg`), never a lazy alias of
        // the slot. ⛔ Not for a `var` (initialised once) and not over a name
        // already declared as another family or as a collection.
        const fromColl = word !== 'var' && word !== 'varip' ? collGetOf(rhs) : null
        if (fromColl && (!held || (held.kind !== 'coll' && held.family === fromColl.family))) {
          if (inLoop) { diagnostics.loopBlocked.push('array.get'); continue }
          if (!held) decls.set(name, { family: fromColl.family, kind: 'local' })
          ops.push({
            k: 'copy', into: name, fromColl: fromColl.coll, index: fromColl.index,
            guards, locals: localScope, loopIds: [...loopIds], at: t[0], line: st.header[0].line,
          })
          continue
        }
        if (rhs.length && rhs[0].kind === 'ident') {
          const ns = nsOf(rhs[0].value)
          if (ns && OBJECT_NAMESPACES.includes(ns) && methodOf(rhs[0].value) === 'new') {
            if (!decls.has(name)) decls.set(name, { family: ns, kind: 'local' })
            emitFromRhs(rhs, name, guards, inLoop, st, localScope)
            continue
          }
          if (rhs[0].value.startsWith('array.new_')) {
            const fam = rhs[0].value.slice('array.new_'.length)
            if (OBJECT_NAMESPACES.includes(fam)) {
              decls.set(name, { family: fam, kind: 'coll' })
              if (createdWithSlots(rhs)) loseColl(name, 'coll:sized', rhs[0])
            }
            continue
          }
          // ⭐⭐ THE GENERIC SPELLING IS THE SAME DECLARATION — `array.new<label>()`.
          //
          // ⚰️ ONLY `array.new_label()` WAS READ, and the corpus prefers the other
          // one: `imbalanceLab = array.new<label>()` (footprint-iq-pro) is the
          // shape behind the very call sites this method-form lane was opened
          // for, and it was invisible here, so `decls` had no `coll` entry and
          // every `imbalanceLab.get(x).set_textcolor(…)` was unaddressable for a
          // reason that had nothing to do with the method form.
          //
          // ⭐ THE ELEMENT TYPE IS READ OFF `typeArgs`, WHICH THE LEXER ALREADY
          // PUT THERE. `lexPine` strips `<…>` and hangs the segment on the head
          // token (`genericTypeArguments.test.js`), so this needs no second
          // parse of the angle brackets — and no second opinion about where a
          // type argument ends.
          if (rhs[0].value === 'array.new' && Array.isArray(rhs[0].typeArgs)) {
            const fam = String(rhs[0].typeArgs[0] || '')
            if (OBJECT_NAMESPACES.includes(fam)) {
              decls.set(name, { family: fam, kind: 'coll' })
              if (createdWithSlots(rhs)) loseColl(name, 'coll:sized', rhs[0])
            }
            continue
          }
        }
        // ── ⭐⭐ A CONDITIONAL CREATE — `x := cond ? line.new(…) : na` ─────
        //
        // ⛔ `var` IS EXCLUDED BY NAME, and the untyped spelling is why the test
        // is here rather than only in the branch above: `var l = cond ?
        // line.new(…) : na` has no type annotation, so the untyped branch does
        // not recognise it and it FALLS THROUGH to this one. Splitting it here
        // would reintroduce exactly the once-initialised divergence that branch
        // refuses, by the back door.
        // ── ⭐⭐ C11c — `x := y` / `x = y` BETWEEN TWO HANDLES ───────────────
        // Pine copies the handle: `x` names the object `y` names NOW, and every
        // setter, getter or delete through `x` reaches that object. ⚰️ Unread,
        // the statement fell through to nothing — no op, no count — so
        // pro-trading-art's `topLine := Line` left `topLine` empty and its
        // `topLine.set_x2(bar_index)` extended no line (a `set_x2` TradingView
        // makes, dropped without a word). An eager register copy (`copy` →
        // `setreg`), the shape a returned handle and a list read already take.
        // ⛔ Not a `var` (initialised once — the branch above refuses that
        // shape for creates for the same reason), not a field of a user type,
        // and not across two families (a Pine type error, left as it was).
        const copyFrom = rhs.length === 1 && rhs[0].kind === 'ident' ? decls.get(String(rhs[0].value)) : null
        if (copyFrom && copyFrom.kind !== 'coll' && word !== 'var' && word !== 'varip'
            && !String(name).includes('.') && (!held || (held.kind !== 'coll' && held.family === copyFrom.family))) {
          if (inLoop) { diagnostics.loopBlocked.push(`${copyFrom.family} copy`); continue }
          if (!held) decls.set(name, { family: copyFrom.family, kind: 'local' })
          ops.push({
            k: 'copy', into: name, from: String(rhs[0].value), fromSite: null,
            guards, locals: localScope, loopIds: [...loopIds], at: t[0], line: st.header[0].line,
          })
          continue
        }
        const named = word !== 'var' && word !== 'varip' ? createNameIn(rhs) : null
        if (named) {
          // ⛔ THE FAMILY COMES FROM THE CONSTRUCTOR, and the declaration is
          // registered BEFORE the emit because `into` is resolved through
          // `decls` — the same order the unconditional branch above uses, and
          // with the same safety net: `buildObjectProgram` prunes a register no
          // surviving op writes, so a decl whose create is then dropped costs
          // nothing.
          if (!decls.has(name)) decls.set(name, { family: nsOf(named), kind: 'local' })
          if (emitTernaryCreate(rhs, name, guards, inLoop, st, localScope)) continue
        }
      }

      // ── a POSTFIX METHOD on a collection read ────────────────────────────
      // `array.get(lines, i).set_x2(bar_index)` — 23 of the 266 committed
      // scripts write a member call on the RESULT of an expression, and this is
      // the receiver shape the object program can already address: `targetRef`
      // in `pine.js` resolves `array.get(coll, idx)` to `{r:'coll', id, index}`,
      // and `decls` knows which drawing FAMILY that collection holds.
      //
      // ⛔ THE FAMILY COMES FROM THE DECLARATION, NEVER FROM THE METHOD NAME.
      // `delete` belongs to line, label, box, table and linefill alike, and
      // `set_color` to three of them — so reading the family off `.set_x2`
      // would be this reader inventing a type system Pine already has and this
      // engine does not. `array.new_line()` said `line`; that is the answer.
      //
      // ⛔ IT IS TRIED BEFORE the bare-call branch and falls through on any
      // miss, so a postfix this cannot lower is dropped and COUNTED by
      // `argsOf`'s span guard rather than half-read.
      if (word && h.isPunct(t[1], '(') && emitPostfix(t, guards, inLoop, st, localScope)) {
        continue
      }
      // ⭐ C40 — the same statement with its receiver in parentheses:
      // `(array.shift(ls)).delete()`. ⚰️ It opens with `(`, so no branch here
      // read it — the delete and the shift vanished with no count. The parser
      // already folds the parentheses away; `emitPostfix` reads what is left.
      if (!word && h.isPunct(t[0], '(') && emitPostfix(t, guards, inLoop, st, localScope)) {
        continue
      }

      // ── a bare call statement ────────────────────────────────────────────
      if (word && h.isPunct(t[1], '(')) {
        const ns = nsOf(word)
        if (ns === 'array') {
          const method = methodOf(word)
          if (COLLECTION_CALLS.has(method)) {
            emitCollection(method, t, guards, inLoop, st, localScope)
            continue
          }
          // ⭐ C16 — `array.unshift(bs, b)`, `array.insert`, … on a DRAWING
          // collection: a change this pass does not carry, so the collection is
          // named as diverged rather than left to disagree silently.
          if (COLLECTION_MUTATORS.has(method)) {
            const a = argsOf(t)
            const c = a && a[0] && a[0].value && a[0].value.type === 'name' ? a[0].value.name : null
            if (c && decls.get(c) && decls.get(c).kind === 'coll') loseColl(c, `coll:${method}`, t[0])
          }
        }
        if (ns && OUT_OF_SCOPE_NAMESPACES.includes(ns)) {
          diagnostics.outOfScope.push(word)
          continue
        }
        if (ns && OBJECT_NAMESPACES.includes(ns)) {
          const method = methodOf(word)
          if (method === 'new') { emitFromRhs(t, null, guards, inLoop, st, localScope); continue }
          if (method.startsWith('get_')) { diagnostics.getters.push(word); continue }
          emitMethod(ns, method, t, guards, inLoop, st, localScope)
          continue
        }
        // ── the METHOD FORM of the two branches above ────────────────────
        // `b.set_bgcolor(c)` IS `box.set_bgcolor(b, c)`; `ls.push(l)` IS
        // `array.push(ls, l)`. Tried LAST, so a hand-written `array.push(…)` or
        // `box.delete(…)` never reaches it and there is exactly one reader per
        // spelling. Measured over `corpus/committed`: 211 method-form sites on a
        // declared drawing handle across 19 scripts, 2,570 on a declared
        // collection across 37 more.
        //
        // ⛔⛔ AND AN UNREADABLE ONE IS COUNTED, WHICH IS THE HALF THAT MATTERS.
        // ⚰️ Before this branch existed, `b.set_bgcolor(c)` fell out of the
        // bare-call block with `ns = 'b'` matching nothing, and the statement
        // vanished: `emitMethodOnStatement`'s equivalent for `box.set_bgcolor(b, c)`
        // emits an `update`, the method form emitted NOTHING, and
        // `diagnostics.unsupported` stayed EMPTY — an UNCOUNTED drop, the same
        // defect class as `box.new(…).delete()` compiling to a lone create. The
        // only thing standing between that and a member's chart was the RUNTIME
        // lane independently refusing the same line `runtime:expression-statement`
        // — a guard in another lane catching it by accident. Measured: with
        // `x = b.get_left()` (a BINDING, which that guard does not see) the lane
        // answered OK and drew a box whose setter had disappeared.
        if (emitMethodForm(word, t, guards, inLoop, st, localScope)) continue
      }

      // ── ⭐ A BARE CONDITIONAL CREATE — `cond ? box.new(…) : na` ───────────
      //
      // The statement has no target at all: the object is drawn for its own
      // sake and no handle keeps it. `assign < 0` is what keeps this off every
      // assignment the branch above already read — it is tried LAST, so a shape
      // with a reader of its own never reaches it.
      if (assign < 0 && createNameIn(t)
          && emitTernaryCreate(t, null, guards, inLoop, st, localScope)) {
        continue
      }

      // ⭐ AN ORDINARY BINDING JOINS THE BLOCK'S SCOPE for every statement
      // AFTER it, which is exactly Pine's own order. A copy is taken rather
      // than mutating, so a sibling block cannot see a name declared in this one.
      // ⭐⭐ R2 STEP 2b — A DESTRUCTURE IS A BLOCK LOCAL TOO, and it is the one
      // shape this scope never recorded. `[tableUnit, tableDivisor] =
      // f_getVolumeUnit(volDisplay)` opens with `[`, not an ident, so the test
      // below cannot see it — and the object pass then meets `tableUnit` as an
      // unknown name and drops the cell that used it. Both names join on the
      // same statement; the walk's record holds one binding per name.
      //
      // ⚰️⚰️ THIS WAS REMOVED IN 2a AS DEAD CODE AND THAT WAS WRONG. Two
      // instruments said so and both were blind: mutation M6 survived, and an
      // A/B on `uncharted-volume-v2.pine` read identical on every number with
      // and without it. Neither could see it, because v2's ONE surviving Volume
      // cell reaches `tableUnit` by another route — so the only script in the
      // measurement could not distinguish the two worlds. `textTupleLocal.test.js`
      // is the reproduction that can: without this, its cell count is 0.
      // ⛔ AN ABSENCE IS ONLY EVIDENCE IF THE INSTRUMENT COULD HAVE SEEN A
      // PRESENCE, and a single fixture is not an instrument.
      if (h.isPunct(t[0], '[')) {
        const close = t.findIndex((x) => h.isPunct(x, ']'))
        const eq = close > 0 ? t.findIndex((x, xi) => xi > close && h.isPunct(x, '=')) : -1
        if (close > 0 && eq > close) {
          for (const nameTok of t.slice(1, close)) {
            if (nameTok.kind === 'ident') {
              localScope = [...localScope, { name: nameTok.value, toks: t.slice(eq + 1), st }]
            }
          }
        }
      }
      // ⭐⭐ R2 STEP 1 — `st` IS THE JOIN KEY, and it is why `toks` is no longer
      // the value. `buildObjectProgram` reads the binding the WALK made for this
      // statement rather than re-parsing these tokens; the statement object is
      // shared between the two walks (`blockStatements` runs once), so the
      // pairing is by identity and two same-named locals in sibling blocks
      // cannot be confused. `toks` stays for the diagnostics only.
      //
      // ⭐⭐ R2 STEP 3 — AND THE NAME COMES FROM `boundName`, THE WALK'S OWN
      // READER. ⚰️ This tested `t[1] === '='`, which is only true of an UNTYPED
      // declaration. Pine lets an author write the type — `string atrMultText =
      // ''`, `color dcrColor = color.gray` — and then the `=` sits at index 2
      // and the name at index 1, so the statement was invisible here.
      // `uncharted-volume-v2.pine`'s Range table is exactly that: two of its
      // four cells read names declared with a type, and both were dropped.
      //
      // ⛔ THE TYPE ROSTER IS NOT COPIED INTO THIS FILE. `boundName` already
      // knows which words are types and already returns the identifier before
      // the `=` unless it is one of them — it is what the walk itself uses to
      // decide this same question. A second roster here would be the exact
      // second authority steps 1 and 2 spent their time deleting.
      // ⭐⭐ INSIDE AN INLINED BODY, `x := e` IS WHAT `x` READS FOR THE REST OF
      // THE BLOCK. Pine is sequential: after the assignment, and until the next
      // one, `x` on this bar IS `e`'s value on this bar. The corpus writes the
      // drawing right under it —
      //     var int lastDojiIndex = na
      //     if isDoji
      //         lastDojiIndex := bar_index
      //         line.new(x1 = lastDojiIndex, …)
      // — so the create reads `bar_index`, exactly. ⛔ ONLY for a synthetic
      // (inlined) statement: at the top level the value walk already binds the
      // name, and a second binding here would change trees it already built.
      // ⛔ Outside this block, and before it, the name stays OPAQUE (see
      // `scopeFor` in pine.js): a `var` read there is the state this lane does
      // not carry, and it refuses rather than reading the initialiser.
      if (st.synthetic && t.length > 2 && t[0].kind === 'ident' && h.isPunct(t[1], ':=')) {
        localScope = [...localScope, { name: String(t[0].value), toks: t.slice(2), st, assign: true }]
      } else if (!st.synthetic && t.length > 2 && t[0].kind === 'ident' && t[1].kind === 'punct'
          && REASSIGN_OPS.has(t[1].value)) {
        // ⭐⭐ C11b — AND OUTSIDE ONE, A REASSIGNMENT IS THE NEW BINDING TOO.
        //
        // ⚰️⚰️ MEASURED 2026-09-29 (live on the member door, objects pane armed):
        // a name's DECLARATION joined this scope and nothing after it did, so
        //     x = 1.0
        //     x := 2.0
        //     label.new(bar_index, high, str.tostring(x))
        // drew "1" where Pine draws "2", and
        //     flag = true
        //     if close > open
        //         flag := high > high[1]
        //         if flag
        //             label.new(…)
        // drew on EVERY up bar — a confident wrong picture, with a clean drop
        // ledger. The declaration's per-statement record pinned the name for
        // every op after it. Entering the reassignment makes `scopeFor` read the
        // walk's OWN record for THIS statement (a block's `foldStatements`
        // record) — the binding the value walk made right there. At the TOP level
        // the entry is skipped: there `scopeFor`'s base reads the name at the
        // op's own position (`bindingAt`, the walk's per-statement log).
        localScope = [...localScope, { name: String(t[0].value), toks: t.slice(2), st, reassign: true }]
      }
      const declEq = h.findTop(t, (x) => h.isPunct(x, '='))
      const isArrow = h.findTop(t, (x) => h.isPunct(x, '=>')) >= 0
      if (declEq > 0 && !isArrow && t.length > declEq + 1) {
        const nameTok = h.boundName(t, declEq)
        if (nameTok) {
          localScope = [...localScope, { name: nameTok.value, toks: t.slice(declEq + 1), st }]
        }
      }
      // any other statement may still hide a nested block
      if (st.sub && st.sub.length) {
        walk(st.sub, guards, inLoop, localScope)
        for (const name of reassignedIn(st.sub)) {
          localScope = [...localScope, { name, toks: t, st, reassign: true }]
        }
      }
    }
  }

  // ─── ⭐⭐ C40 — `for … in` OVER A LIST THIS LANE HOLDS, AND THE CAP `while` ──
  //
  // C34 showed the helper call was never the wall: the drawing steps sit in
  // `for x in <list>` and `while array.size(a) > N` loops this reader did not
  // run. Two of those shapes ARE loops the object runtime can run exactly:
  //
  //   for b in fut_boxes            for [i, v] in line.all       for [i, u] in ups
  //       box.delete(b)                 line.delete(v)               tbl.cell(0, i, str.tostring(u))
  //   (a declared drawing list)     (every line on the chart)    (a bounded numeric window, C32)
  //
  //   while array.size(lbs) > N                 ← the FIFO cap: the oldest goes
  //       label.delete(array.shift(lbs))
  //
  // ⭐ WITNESS (committed capture `trend-lines-supports-and-resistances-rddt-1d-
  // 2026-09-28`): TradingView walked `for [i, v] in downtrends` over TWO elements
  // and applied the body to both — lines 8 and 11 are dotted with no colour, and
  // their extension lines (7, 10) and labels (9, 12) are gone.
  //
  // ⛔ SERVED ONLY WHERE THE LOOP HAS ONE READING. A body that changes the list
  // it walks (`push`/`shift`/`remove`/`set`/`clear`, or a helper handed the list)
  // is unwitnessed — whether Pine walks a snapshot or the live list is not in any
  // capture — and keeps the legacy refusal, named (`forInRefused`). A loop
  // variable that takes over a name another statement declared refuses too.
  const ALL_FAMILIES = Object.freeze({ 'line.all': 'line', 'box.all': 'box', 'label.all': 'label' })
  const refuseForIn = (why, t) => {
    diagnostics.forInRefused.push(`${why}@${t[0] && t[0].line !== undefined ? t[0].line : '?'}`)
    return null
  }
  /** Does this statement list (at any depth, and through any user function it
   *  calls) change the list `name` — a mutating member, a reassignment, or a
   *  user function that is handed it or names it? */
  const bodyMayWriteList = (list, name) => {
    const seenFns = new Set()
    let scan = null
    const scanToks = (toks) => {
      for (let i = 0; i < toks.length; i += 1) {
        const tk = toks[i]
        if (!tk || tk.kind !== 'ident') continue
        const v = String(tk.value)
        const nx = toks[i + 1]
        if (v === name && nx && nx.kind === 'punct' && (nx.value === '=' || REASSIGN_OPS.has(nx.value))) return true
        if (v.startsWith('array.') && COLLECTION_MUTATORS.has(v.slice(6)) && h.isPunct(nx, '(')
            && toks[i + 2] && toks[i + 2].kind === 'ident' && String(toks[i + 2].value) === name) return true
        const m = splitMethodName(v)
        if (m && m.recv === name && COLLECTION_MUTATORS.has(m.method) && !isDefined(m.method)) return true
        const fn = fnDefs.has(v) ? v : (m && fnDefs.has(m.method) ? m.method : null)
        if (!fn || !h.isPunct(nx, '(')) continue
        const close = closeOf(toks, i + 1)
        const args = close > 0 ? toks.slice(i + 2, close) : toks.slice(i + 2)
        if ((m && m.recv === name) || args.some((x) => x.kind === 'ident' && String(x.value).split('.')[0] === name)) return true
        if (!seenFns.has(fn)) {
          seenFns.add(fn)
          if (scan(fnDefs.get(fn).body)) return true
        }
      }
      return false
    }
    scan = (items) => (items || []).some((s2) => scanToks(s2.header || []) || scan(s2.sub))
    return scan(list)
  }
  const mentionsName = (list, name) => (list || []).some((s2) => (s2.header || [])
    .some((x) => x.kind === 'ident' && String(x.value).split('.')[0] === name) || mentionsName(s2.sub, name))
  /** `for x in SRC` / `for [i, x] in SRC` → `{kind, idx, elem, src, family}` for
   *  a SRC this lane walks, else null (the caller keeps the legacy refusal). */
  const forInPlan = (t, st) => {
    let k = 1
    let idx = null
    if (h.isPunct(t[1], '[')) {
      if (!(t[2] && t[2].kind === 'ident' && h.isPunct(t[3], ',') && t[4] && t[4].kind === 'ident'
          && h.isPunct(t[5], ']'))) return null
      idx = String(t[2].value)
      k = 4
    }
    const elemTok = t[k]
    const inAt = idx === null ? 2 : 6
    const inTok = t[inAt]
    if (!elemTok || elemTok.kind !== 'ident' || !inTok || inTok.kind !== 'ident' || inTok.value !== 'in') return null
    if (t.length !== inAt + 2 || t[inAt + 1].kind !== 'ident') return null
    const elem = String(elemTok.value)
    const src = String(t[inAt + 1].value)
    if (elem.includes('.') || (idx !== null && (idx.includes('.') || !/^[a-z][a-z0-9_]*$/.test(idx)))) return null
    const d = decls.get(src)
    const family = ALL_FAMILIES[src] || (d && d.kind === 'coll' && OBJECT_NAMESPACES.includes(d.family) ? d.family : null)
    const isWindow = !family && !d && !src.includes('.') && typeof h.forInWindow === 'function' && h.forInWindow(src)
    if (!family && !isWindow) return null
    // ⛔ THE LOOP VARIABLE IS THE LOOP'S OWN. A name some other statement holds
    // is not taken over (Pine's would shadow it; one register cannot).
    // ⭐ In an INLINED helper body the statements are this call site's own copy
    // (`rewriteBody`), so the variable is given a name of its own for this loop —
    // trend-lines' `f_clearAll` walks `line.all`, `box.all` and `label.all` with
    // one `v`. At the top level the statements are the value walk's too, and the
    // loop is refused by name instead.
    const taken = decls.has(elem) && (!forInElems.has(elem) || (family && decls.get(elem).family !== family))
    let elemName = elem
    if (taken) {
      if (!st.synthetic || !family) {
        return refuseForIn(!forInElems.has(elem) ? `loop variable \`${elem}\` is also declared outside the loop`
          : `loop variable \`${elem}\` already holds a ${decls.get(elem).family}`, t)
      }
      elemName = `${elem}__uctfi${hostLoopSeq + 1}`
    }
    // ⛔ An object's POSITION in `line.all` depends on every create TradingView
    // made, including any this program lost — never read.
    if (ALL_FAMILIES[src] && idx !== null && mentionsName(st.sub, idx)) return refuseForIn(`a position in \`${src}\` is read`, t)
    if (!ALL_FAMILIES[src] && bodyMayWriteList(st.sub, src)) return refuseForIn(`the body changes \`${src}\`, the list it walks`, t)
    if (isWindow) return { kind: 'window', idx, elem, src, family: null }
    if (elemName !== elem) {
      // …renamed only once the loop is taken, in this call site's own tokens.
      const rename = (toks) => {
        for (const x of toks || []) {
          if (x.kind !== 'ident') continue
          const v = String(x.value)
          if (v === elem) x.value = elemName
          else if (v.startsWith(`${elem}.`)) x.value = elemName + v.slice(elem.length)
        }
      }
      const renameAll = (items) => { for (const s2 of items || []) { rename(s2.header); renameAll(s2.sub) } }
      rename([elemTok])
      renameAll(st.sub)
    }
    decls.set(elemName, { family, kind: 'local' })
    forInElems.add(elemName)
    return { kind: ALL_FAMILIES[src] ? 'all' : 'coll', idx, elem: elemName, src, family }
  }

  /** `array.size(C)` / `C.size()` → C when C is a declared drawing list. */
  const sizedList = (node) => {
    if (!node || node.type !== 'call') return null
    const name = String(node.name || '')
    const args = node.args || []
    if (args.some((a) => a && a.name)) return null
    let c = null
    if (name === 'array.size') {
      const a = args.length === 1 ? args[0].value : null
      if (a && a.type === 'name') c = a.name
    } else {
      const m = splitMethodName(name)
      if (m && m.method === 'size' && !args.length && !isDefined('size')) c = m.recv
    }
    const d = c ? decls.get(c) : null
    return d && d.kind === 'coll' && OBJECT_NAMESPACES.includes(d.family) ? c : null
  }
  /** A VALUE that takes one element off the front or the back of an array —
   *  `array.shift(X)` / `X.shift()` / `array.pop(X)` / `X.pop()` → X, else null. */
  const endRemovalOf = (v) => {
    if (!v || v.type !== 'call') return null
    const name = String(v.name || '')
    const args = v.args || []
    if (args.some((a) => a && a.name)) return null
    if (name === 'array.shift' || name === 'array.pop') {
      const a = args.length === 1 ? args[0].value : null
      return a && a.type === 'name' ? String(a.name) : null
    }
    const m = splitMethodName(name)
    return m && (m.method === 'shift' || m.method === 'pop') && !args.length && !isDefined(m.method) ? m.recv : null
  }
  /**
   * ⭐⭐ THE CAP `while` — `while array.size(C) > N` whose every pass takes ONE
   * element off `C` (and deletes it, or not), and does nothing else but the same
   * to other arrays kept in step:
   *
   *     while array.size(zzLines) > maxZigzagSwings        renderingnature
   *         line.delete(array.shift(zzLines))
   *
   * That is a loop the object runtime runs as written: the condition is the
   * list's own length (the runtime's), re-read before every pass, and each pass
   * shortens the list, so it ends. ⛔ EXACTLY THAT SHAPE: one removal of `C` per
   * pass, flat statements only, a bound that reads no length and no array a
   * pass shortens. Anything else returns null and keeps the `while` refusal.
   * @returns {{kind: 'cap', coll: string, idx: null}|null}
   */
  const capWhileOf = (t, st) => {
    let node = null
    try { node = h.parseWholeExpression(t.slice(1)) } catch { return null }
    if (!node || node.type !== 'binary' || !['>', '>=', '<', '<='].includes(node.op)) return null
    const sizeLeft = node.op === '>' || node.op === '>='
    const coll = sizedList(sizeLeft ? node.left : node.right)
    if (!coll) return null
    const body = splitCommaStatements(st.sub || [], h)
    if (!body.length) return null
    const shortened = new Set()
    for (const s2 of body) {
      // (a statement with a block of its own — `if …` — is not an expression and fails the parse below)
      let n = null
      try { n = h.parseWholeExpression(s2.header || []) } catch { return null }
      if (!n) return null
      let arr = null
      if (n.type === 'method' && n.name === 'delete' && !(n.args || []).length) {
        arr = endRemovalOf(n.recv)                       // `array.shift(C).delete()`
        if (!arr || !decls.get(arr) || decls.get(arr).kind !== 'coll') return null
      } else if (n.type === 'call' && /^[a-z]+\.delete$/.test(String(n.name || ''))
          && OBJECT_NAMESPACES.includes(nsOf(String(n.name)))) {
        const a = (n.args || []).length === 1 && !n.args[0].name ? n.args[0].value : null
        arr = endRemovalOf(a)                            // `label.delete(array.shift(C))`
        if (!arr || !decls.get(arr) || decls.get(arr).kind !== 'coll') return null
      } else {
        arr = endRemovalOf(n)                            // `array.shift(C)` — dropped, not deleted
        if (!arr || (decls.get(arr) && decls.get(arr).kind !== 'coll')) return null
      }
      if (shortened.has(arr)) return null               // one removal of each array per pass
      shortened.add(arr)
    }
    if (!shortened.has(coll)) return null                // …the measured list among them
    const opAt = h.findTop(t, (x) => h.isPunct(x, node.op))
    if (opAt < 1) return null
    const bound = sizeLeft ? t.slice(opAt + 1) : t.slice(1, opAt)
    for (const x of bound) {
      if (x.kind !== 'ident') continue
      const v = String(x.value)
      if (v === 'array.size' || v.endsWith('.size') || shortened.has(v.split('.')[0]) || shortened.has(v)) return null
    }
    return { kind: 'cap', coll, idx: null }
  }

  /**
   * `for <id> = <from> to <to>` — the ONE loop shape this reader carries.
   *
   * ⛔ `eq === 2` IS THE SHAPE TEST, and it is what keeps `for [i, v] in arr`
   * (Pine 5's for-in, whose second token is `[`) and any annotated spelling out.
   * A head this does not recognise returns null and the caller refuses the loop
   * exactly as it always did — a new shape is never guessed at.
   *
   * ⭐⭐ `by <step>` IS READ AND CARRIED AS THE LOOP'S `step` (2026-09-28). It
   * used to refuse the whole loop, because the loop op had no step and stepping
   * by one would draw every row of a loop written to skip. The op has a step
   * now, so the refusal's reason is gone. MEASURED against TradingView the same
   * day: `heat-map-seasons` paints its gauge with `for i = 0 to 29 by 1` — the
   * vendor holds 31 cells and we held 4, the loop dropped whole.
   *
   * ⚠️ THE `while` GUARD IS NOT INDEPENDENTLY PROVABLE, and that is recorded
   * rather than implied: `while i < 3` has no top-level `=` at index 2, so the
   * parser refuses it for a second reason.
   */
  const parseForHead = (t) => {
    if (!t[1] || t[1].kind !== 'ident') return null
    const eq = h.findTop(t, (x) => h.isPunct(x, '='))
    if (eq !== 2) return null
    const toIdx = h.findTop(t, (x) => x.kind === 'ident' && x.value === 'to')
    if (toIdx <= eq) return null
    const byIdx = h.findTop(t, (x) => x.kind === 'ident' && x.value === 'by')
    if (byIdx >= 0 && byIdx < toIdx) return null
    try {
      const from = h.parseWholeExpression(t.slice(eq + 1, toIdx))
      const to = h.parseWholeExpression(t.slice(toIdx + 1, byIdx > toIdx ? byIdx : t.length))
      if (!from || !to) return null
      const head = { id: t[1].value, from: { value: from }, to: { value: to } }
      if (byIdx > toIdx) {
        const step = h.parseWholeExpression(t.slice(byIdx + 1))
        if (!step) return null
        head.step = { value: step }
      }
      return head
    } catch { return null }
  }

  /** ⭐⭐ C40 (H14) — `array.new_line(3)` / `array.new<box>(n)` / `array.new_box(n, na)`:
   *  A DRAWING LIST CREATED WITH SLOTS. The object runtime starts every list
   *  EMPTY, so `array.set(a, i, line.new(…))` on such a list wrote nothing and
   *  `line.delete(array.get(a, i))` deleted nothing — the corpus's "replace my
   *  three lines every bar" idiom drew a new set every bar and removed none,
   *  with a clean ledger (measured at the wave-9 base: 180 boxes where Pine
   *  holds 3). No capture witnesses a sized drawing list, so it is not modelled:
   *  the list is DIVERGED from its creation (`coll:sized`), and every read of it
   *  is withheld and counted (C16's `coll:diverged`), never run against an empty
   *  one. ⛔ `array.new_line()` and `array.new_line(0)` are empty in Pine too and
   *  stay as they were. Capture `vw-forin-collections` (rows Z01–Z03) settles it. */
  const createdWithSlots = (rhs) => {
    if (!h.isPunct(rhs[1], '(')) return false
    if (h.isPunct(rhs[2], ')')) return false
    return !(rhs[2] && rhs[2].kind === 'number' && Number(rhs[2].value) === 0 && h.isPunct(rhs[3], ')'))
  }

  /** `box(na)` / `line(na)` / … — Pine's typed empty handle — → its family,
   *  else null. ⛔ Exactly that shape: a cast of anything but `na` is not an
   *  empty handle and is left to the branches that read values. */
  const naHandleFamily = (toks) => {
    if (!toks || toks.length !== 4) return null
    const [f, o, n, c] = toks
    if (!f || f.kind !== 'ident' || !OBJECT_NAMESPACES.includes(String(f.value))) return null
    if (!h.isPunct(o, '(') || !n || n.kind !== 'ident' || n.value !== 'na' || !h.isPunct(c, ')')) return null
    return String(f.value)
  }

  /** The index closing the bracket opened at `open`, or -1. */
  const closeOf = (toks, open) => {
    let depth = 0
    for (let i = open; i < toks.length; i += 1) {
      const tk = toks[i]
      if (tk.kind !== 'punct') continue
      if (tk.value === '(' || tk.value === '[') depth += 1
      else if (tk.value === ')' || tk.value === ']') {
        depth -= 1
        if (depth === 0) return i
      }
    }
    return -1
  }

  const argsOf = (toks) => {
    const open = toks.findIndex((x) => h.isPunct(x, '('))
    if (open < 0) return null
    // ⛔⛔ THE CALL MUST BE THE WHOLE STATEMENT, AND THIS IS THE GUARD THAT SAYS
    // SO. This reader recognises a statement by its FIRST token and then takes
    // the first `(` as the call — so `box.new(…).delete()` was read as
    // `box.new(…)`, the create was emitted, and `.delete()` vanished without a
    // word. A create with its delete dropped is not a smaller drawing: it is a
    // box that stays on a member's chart forever, drawn by a line their script
    // says to remove. Measured: `box.new(…).delete()` emitted `["create:box"]`
    // and the name form emitted `["create:box","delete"]` for the same program.
    //
    // ⛔ A NULL HERE MEANS "THIS READER DOES NOT READ THIS STATEMENT", which
    // every caller already turns into an `unsupported` diagnostic and NO op. A
    // counted drop is this pass's own answer for a shape it cannot carry; an
    // uncounted, half-read one is not.
    if (closeOf(toks, open) !== toks.length - 1) return null
    try {
      return h.parseArguments(new h.Cursor(toks.slice(open + 1)))
    } catch { return null }
  }

  /** ⭐ C16 — a right-hand side that is EXACTLY `array.get(bs, i)` or
   *  `bs.get(i)` on a declared DRAWING collection → `{coll, family, index}`,
   *  else null. ⛔ `bs.get` yields to a script's own `get` method. */
  const collGetOf = (toks) => {
    if (!toks || toks.length < 3 || toks[0].kind !== 'ident' || !h.isPunct(toks[1], '(')) return null
    const head = String(toks[0].value)
    const args = argsOf(toks)
    if (!args || args.some((a) => a && a.name)) return null
    let coll = null
    let index = null
    if (head === 'array.get') {
      const c = args.length === 2 && args[0].value
      if (c && c.type === 'name') { coll = c.name; index = args[1].value }
    } else {
      const split = splitMethodName(head)
      if (split && split.method === 'get' && args.length === 1 && !isDefined('get')) {
        coll = split.recv
        index = args[0].value
      }
    }
    const d = coll ? decls.get(coll) : null
    if (!d || d.kind !== 'coll' || !OBJECT_NAMESPACES.includes(d.family) || !index) return null
    return { coll, family: d.family, index }
  }

  /** ⭐ C16 — a VALUE that takes an element OUT of a declared drawing
   *  collection: `array.shift(bs)` / `bs.shift()`, `array.pop(bs)` / `bs.pop()`,
   *  `array.remove(bs, i)` / `bs.remove(i)` → `{coll, family, method, index}`
   *  (`index` is the removed slot, as a parse node), else null. */
  const poppedFrom = (v) => {
    if (!v || v.type !== 'call') return null
    const name = String(v.name || '')
    const args = v.args || []
    if (args.some((a) => a && a.name)) return null
    let coll = null
    let method = null
    let index = null
    const m = /^array\.(shift|pop|remove)$/.exec(name)
    if (m) {
      const c = args[0] && args[0].value
      if (!c || c.type !== 'name') return null
      coll = c.name
      method = m[1]
      if (method === 'remove') {
        if (args.length !== 2) return null
        index = args[1].value
      } else if (args.length !== 1) return null
    } else {
      const split = splitMethodName(name)
      if (!split || !['shift', 'pop', 'remove'].includes(split.method) || isDefined(split.method)) return null
      coll = split.recv
      method = split.method
      if (method === 'remove') {
        if (args.length !== 1) return null
        index = args[0].value
      } else if (args.length !== 0) return null
    }
    const d = decls.get(coll)
    if (!d || d.kind !== 'coll' || !OBJECT_NAMESPACES.includes(d.family)) return null
    const tok = v.tok
    const name0 = { type: 'name', name: coll, tok }
    if (method === 'shift') index = { type: 'number', value: 0, tok }
    if (method === 'pop') {
      index = {
        type: 'binary', op: '-', tok,
        left: { type: 'call', name: 'array.size', args: [{ value: name0 }], tok },
        right: { type: 'number', value: 1, tok },
      }
    }
    return { coll, family: d.family, method, index }
  }

  /** The `<family>.new` this token span NAMES anywhere, or null.
   *
   *  ⛔ IT IS A DIAGNOSTIC READER, NOT A PARSER. Its only job is to tell a
   *  right-hand side that mentions a constructor this reader could not lift out
   *  from one that mentions none — so that the first is COUNTED and the second
   *  stays silent. Reading it as "there is a create here" would make every
   *  `str.tostring(line.get_x1(l))` look like a drawing. */
  const createNameIn = (toks) => {
    for (const tk of toks || []) {
      if (!tk || tk.kind !== 'ident') continue
      const name = String(tk.value)
      const ns = nsOf(name)
      if (ns && OBJECT_NAMESPACES.includes(ns) && methodOf(name) === 'new') return name
    }
    return null
  }

  /**
   * ⭐⭐ `cond ? a : b`, SPLIT AT THE TOP LEVEL — or null.
   *
   * ⛔ THE `:` MUST BE THE ONE THAT CLOSES THIS `?`, not the first one seen. A
   * chained ternary (`a ? x : b ? y : z`) opens a second `?` before its own
   * colon arrives, so a first-colon split would hand back `b ? y` as the ELSE
   * arm of the outer test and lose the inner condition entirely — the create
   * would then be emitted under the wrong guard, which draws on the wrong bars
   * rather than not at all.
   *
   * ⛔ `:=` IS A SINGLE TOKEN in this lexer, so an assignment can never be
   * mistaken for a ternary colon. That is a property of `lexPine`, not an
   * assumption made here — `reassignedIn` above leans on the same one.
   */
  const splitTernary = (toks) => {
    let depth = 0
    let q = -1
    for (let i = 0; i < toks.length; i += 1) {
      const tk = toks[i]
      if (!tk || tk.kind !== 'punct') continue
      if (tk.value === '(' || tk.value === '[') { depth += 1; continue }
      if (tk.value === ')' || tk.value === ']') { depth -= 1; continue }
      if (depth === 0 && tk.value === '?') { q = i; break }
    }
    if (q <= 0) return null
    depth = 0
    let pending = 0
    for (let i = q + 1; i < toks.length; i += 1) {
      const tk = toks[i]
      if (!tk || tk.kind !== 'punct') continue
      if (tk.value === '(' || tk.value === '[') { depth += 1; continue }
      if (tk.value === ')' || tk.value === ']') { depth -= 1; continue }
      if (depth !== 0) continue
      if (tk.value === '?') { pending += 1; continue }
      if (tk.value !== ':') continue
      if (pending > 0) { pending -= 1; continue }
      if (i === toks.length - 1) return null
      return { cond: toks.slice(0, q), then: toks.slice(q + 1, i), alt: toks.slice(i + 1) }
    }
    return null
  }

  /**
   * ⭐⭐ A CONDITIONAL CREATE — `x := cond ? line.new(…) : na`.
   *
   * ⚰️ THE READER SAW A CREATE ONLY WHERE THE CALL WAS THE WHOLE RIGHT-HAND
   * SIDE. `emitFromRhs` demands `rhs[0]` BE `<family>.new`, so a right-hand side
   * opening with a CONDITION matched nothing, fell through every branch of the
   * walk, and left no op AND NO DIAGNOSTIC — an uncounted drop, which the
   * method-form note above calls out as the worst shape a gap can take.
   * Measured on `corpus/committed` before this was written: 46 such sites in 17
   * scripts, the ONLY create shape in 7 of them, and 6 of them in
   * `liquidity-pools__fa7b28e733.pine` — a script that DRAWS today, from two
   * ops, while its source asks for more.
   *
   * ⭐⭐ AND IT IS THE GUARD STACK, NOT A NEW CAPABILITY. `x := cond ?
   * line.new(…) : na` is the same Pine operation as
   *
   *     if cond
   *         x := line.new(…)
   *
   * which the walk has carried since C3B by pushing `{toks: cond, negate:
   * false}` and letting `emitFromRhs` stamp it on. This needed the same stack
   * entry off a different token span: no new op kind, no new runtime, no new
   * validator rule. `objectTernaryCreate.test.js` rails the two spellings
   * against each other, and that is the test that would go red first if this
   * ever grew an opinion of its own.
   *
   * ⛔ AN ARM THAT NAMES A CREATE THIS READER CANNOT LIFT OUT IS COUNTED. The
   * whole point of the change is that a conditional drawing stops disappearing
   * in silence; replacing one silent drop with another would be no change at
   * all.
   *
   * @returns {boolean} whether any create was emitted.
   */
  function emitTernaryCreate(rhs, intoName, guards, inLoop, st, scope) {
    const split = splitTernary(rhs)
    if (!split) return false
    let emitted = false
    for (const [arm, negate] of [[split.then, false], [split.alt, true]]) {
      const next = [...guards, { toks: split.cond, negate }]
      if (emitFromRhs(arm, intoName, next, inLoop, st, scope)) { emitted = true; continue }
      if (emitTernaryCreate(arm, intoName, next, inLoop, st, scope)) { emitted = true; continue }
      const named = createNameIn(arm)
      if (named) diagnostics.unsupported.push(named)
    }
    return emitted
  }

  /** @returns {boolean} whether a create was emitted — the caller needs to know
   *  so a right-hand side this could not read can be COUNTED rather than left
   *  to vanish. */
  function emitFromRhs(rhs, intoName, guards, inLoop, st, scope, once = false) {
    if (!rhs.length || rhs[0].kind !== 'ident') return false
    const ns = nsOf(rhs[0].value)
    if (!ns || !OBJECT_NAMESPACES.includes(ns) || methodOf(rhs[0].value) !== 'new') return false
    // ⛔ STILL REFUSED FOR A LOOP THIS READER COULD NOT PARSE. `inLoop` is
    // now true ONLY for a `while`, a `for … by`, or a head of a shape the
    // parser does not know — a counted `for` clears it and nests instead.
    // ⚰️ Deleting these outright (first cut of the loop reader) made a `while`
    // body emit its ops as if they ran ONCE, which is precisely the lie the
    // original refusal existed to prevent.
    // ⭐ C20 — a statement create DIRECTLY in the body of a `while` the runtime
    // lane reads per pass (`rtLoopTry`) is carried; everything else still refuses.
    const rtCarried = inLoop && !!rtLoop && loopNest === rtLoop.nest && !intoName && !once
      && inlineDepth === 0
    if (inLoop && !rtCarried) { diagnostics.loopBlocked.push(`${ns}.new`); return false }
    const args = argsOf(rhs)
    if (!args) { diagnostics.unsupported.push(`${ns}.new`); return false }
    siteSeq += 1
    ops.push({
      k: 'create',
      family: ns,
      site: `s${siteSeq}`,
      into: intoName || null,
      once,
      guards,
      locals: scope,
      loopIds: [...loopIds],
      args,
      at: rhs[0],
      line: st.header[0].line,
    })
    return true
  }

  function emitMethod(ns, method, toks, guards, inLoop, st, scope) {
    if (inLoop) {
      diagnostics.loopBlocked.push(`${ns}.${method}`)
      // ⭐ C16 — a blocked `box.delete(array.shift(bs))` loses the SHIFT too.
      if (method === 'delete') {
        const a = argsOf(toks)
        const p = a && a[0] ? poppedFrom(a[0].value) : null
        if (p) loseColl(p.coll, `loop:${ns}.${method}`, toks[0])
      }
      return
    }
    const args = argsOf(toks)
    if (!args || !args.length) { diagnostics.unsupported.push(`${ns}.${method}`); return }
    emitMethodOn(ns, method, args[0], args.slice(1), toks[0], guards, st, scope)
  }

  /** ⭐⭐ ONE PLACE TURNS A FAMILY, A METHOD, A TARGET AND THE REST INTO AN OP.
   *
   *  ⛔ EXTRACTED FROM `emitMethod` RATHER THAN COPIED, and the difference is the
   *  whole point. `line.set_x2(l, n)` and `<expr>.set_x2(n)` are ONE Pine
   *  operation written two ways — Pine's own docs define the second as the first
   *  with the receiver moved. A second emitter would be a second opinion about
   *  which methods are deletes, which are `table.cell`, and which property each
   *  setter writes, and the two would drift the first time `SETTER_PROPS` gains
   *  a row (`lesson_a_second_authority_over_one_value`). The only thing the
   *  postfix caller supplies differently is WHERE the target came from. */
  function emitMethodOn(ns, method, target, rest, at, guards, st, scope) {
    if (method === 'delete') {
      // ⭐⭐ C16 — `box.delete(array.shift(bs))`: TWO Pine operations in one
      // statement — the slot leaves the array and the box it held is deleted.
      // Carried as exactly those two, in an order with the same end state (a
      // delete no longer touches the array — `reap`): delete what the slot
      // holds, then remove the slot. Without this the target was unreadable
      // and the delete was lost, leaving every evicted zone on the chart.
      const popped = target && target.value ? poppedFrom(target.value) : null
      if (popped && popped.family === ns) {
        const tok = target.value.tok
        const slot = {
          type: 'call', name: 'array.get', tok,
          args: [{ value: { type: 'name', name: popped.coll, tok } }, { value: popped.index }],
        }
        const line = st.header[0].line
        ops.push({ k: 'delete', family: ns, target: { name: null, value: slot, tok }, guards, locals: scope, loopIds: [...loopIds], at, line })
        ops.push({
          k: `coll_${popped.method}`, coll: popped.coll,
          args: popped.method === 'remove' ? [{ value: popped.index }] : [],
          guards, locals: scope, loopIds: [...loopIds], at, line,
        })
        return
      }
      ops.push({ k: 'delete', family: ns, target, guards, locals: scope, loopIds: [...loopIds], at, line: st.header[0].line })
      return
    }
    // ⭐⭐ `table.clear` REMOVES A RECTANGLE OF CELLS, and it is carried rather
    // than refused because ignoring it draws a WRONG table, not a smaller one.
    // The corpus idiom is *clear the block, then repopulate it*; on a bar where
    // fewer rows qualify than the bar before, the rows nobody rewrote stay on
    // screen as last bar's numbers under this bar's header.
    //
    // ⛔ REFUSING IT BY NAME WAS THE OTHER OPTION AND WOULD HAVE BEEN A
    // REGRESSION: the acceptance dashboard calls it at its line 108, so a
    // refusal would stop the one script this lane can currently draw.
    if (ns === 'table' && method === 'clear') {
      ops.push({
        k: 'clear', target, args: rest,
        guards, locals: scope, loopIds: [...loopIds], at, line: st.header[0].line,
      })
      return
    }
    // ⭐⭐ `table.merge_cells(t, c0, r0, c1, r1)` — a RECTANGLE drawn as ONE
    // cell. Carried rather than listed as unsupported: the reader's refusal drew
    // the header one column wide and dropped the covered cells from the table.
    // MEASURED against TradingView (2026-09-28, NYSE:RDDT 1D):
    // `momentum-volatility-scanner` writes a header with `table.merge_cells(t, 0, 0, 1, 0)`
    // and the vendor records cell (0,0) with colspan 2 AND the covered cell (1,0)
    // as a cell of its own with empty text — 12 cells, where we held 11 and drew
    // the header one column wide.
    if (ns === 'table' && method === 'merge_cells') {
      ops.push({
        k: 'merge', target, args: rest,
        guards, locals: scope, loopIds: [...loopIds], at, line: st.header[0].line,
      })
      return
    }
    if (ns === 'table' && method === 'cell') {
      ops.push({
        k: 'cell', target, col: rest[0], row: rest[1], args: rest.slice(2),
        guards, locals: scope, loopIds: [...loopIds], at, line: st.header[0].line,
      })
      return
    }
    // ⭐ A CELL SETTER SHARES `cell`'s ADDRESS SHAPE AND NOT ITS MEANING — same
    // `(column, row)` in the same two slots, exactly one property after them. The
    // op kind stays DISTINCT so that the day `cell` becomes the true REPLACE the
    // reference describes, a `cell_set_text` does not start wiping the colours off
    // the row it was only asked to relabel. (Master's, kept verbatim in intent.)
    if (ns === 'table' && CELL_SETTER_PROPS[method]) {
      ops.push({
        k: 'cellpatch', prop: CELL_SETTER_PROPS[method],
        target, col: rest[0], row: rest[1], args: rest.slice(2),
        // ⛔ THIS LANE'S OWN SHAPE, NOT MASTER'S VERBATIM. The sibling ops here
        // carry `at` (already resolved) and `loopIds`, which master's version has
        // no concept of — a ported op without them throws `toks is not defined`
        // and, worse, would lose its loop identity if it did not.
        guards, locals: scope, loopIds: [...loopIds], at, line: st.header[0].line,
      })
      return
    }
    const props = (SETTER_PROPS[ns] || {})[method]
    if (!props) { diagnostics.unsupported.push(`${ns}.${method}`); return }
    ops.push({
      k: 'update', family: ns, target, props, args: rest,
      guards, locals: scope, loopIds: [...loopIds], at, line: st.header[0].line,
    })
  }

  /**
   * ⭐⭐ A CREATE WRITTEN INSIDE THE CALL — `array.push(zones, box.new(…))`.
   *
   * ⚰️ THE READER ONLY EVER SAW A CREATE IN A STATEMENT POSITION. `emitFromRhs`
   * is reached from `var x = box.new(…)`, `x := box.new(…)` and a bare
   * `box.new(…)` statement, and from nowhere else — so the corpus idiom for a
   * script that keeps a LIST of drawings was invisible. Measured on the
   * committed corpus: `array.push(<coll>, <fam>.new(…))` appears in 19 of 266
   * scripts, and for two of them EVERY create is written that way, so the object
   * pass collected zero creates, `buildObjectProgram` answered `program: null`,
   * and the drawing was reported as "the script draws nothing".
   *
   * ⭐ THE OBJECT PROGRAM ALREADY HAD THE REFERENCE THIS NEEDS, and its own
   * format note says so: `{r:'site', id}` is *"what THIS bar's create at that
   * site made"*, and the note beside it names this exact case — *"`line.new(...)`
   * used inline as an argument refers to the object made on THIS bar"*. The
   * runtime resolves it from `siteNow`, the validator type-checks it against the
   * collection's family. Nothing new was built; the READER was the missing half.
   *
   * ⛔ THE CREATE IS EMITTED BEFORE THE CALL THAT REFERENCES IT, into the same
   * sink, so the ops stay in source order. `buildObjectProgram` walks them in
   * that order, which is what lets it know the site was really emitted rather
   * than dropped — see `emittedSites` there.
   *
   * @returns {string|null} the site id, or null when the argument is not a create.
   */
  const nestedCreate = (arg, guards, scope, st, toks) => {
    const v = arg && arg.value
    if (!v || v.type !== 'call') return null
    const name = String(v.name || '')
    const ns = nsOf(name)
    if (!ns || !OBJECT_NAMESPACES.includes(ns) || methodOf(name) !== 'new') return null
    siteSeq += 1
    const site = `s${siteSeq}`
    ops.push({
      k: 'create',
      family: ns,
      site,
      into: null,
      once: false,
      guards,
      locals: scope,
      loopIds: [...loopIds],
      args: v.args || [],
      at: v.tok || toks[0],
      line: st.header[0].line,
    })
    return site
  }

  /** The argument of `array.<method>` that carries an OBJECT, after the
   *  collection itself. `push(coll, v)` → 0; `set(coll, i, v)` → 1. Every other
   *  collection call takes an index or nothing, so it has no create position. */
  const VALUE_ARG = Object.freeze({ push: 0, unshift: 0, set: 1 })

  /** `<array.get(coll, i)>.<method>(args)` as a STATEMENT → the same op the
   *  name form emits, or false if this reader does not read this shape.
   *
   *  ⛔ IT ANSWERS FALSE RATHER THAN THROWING, and the caller falls through to
   *  the branches that already existed — so a postfix this cannot lower behaves
   *  exactly as it did before the rule landed. */
  function emitPostfix(toks, guards, inLoop, st, scope) {
    let node = null
    try { node = h.parseWholeExpression(toks) } catch { return false }
    if (!node || node.type !== 'method') return false
    const recv = node.recv
    // ⛔ THE ONE RECEIVER `targetRef` CAN ADDRESS. A `name` receiver never
    // reaches here — the parser folds `(b).delete()` back into the dotted name
    // `b.delete`, which is the bare-call branch's business — so this is the
    // whole of what the object program can resolve today.
    if (!recv || recv.type !== 'call') return false
    // ⭐ C16 — `bs.shift().delete()` is `box.delete(array.shift(bs))`, read by
    // the same two-op rule (`emitMethodOn`'s delete).
    if (node.name === 'delete') {
      const popped = poppedFrom(recv)
      if (popped) {
        if (inLoop) {
          diagnostics.loopBlocked.push(`${popped.family}.delete`)
          loseColl(popped.coll, `loop:${popped.family}.delete`, toks[0])
          return true
        }
        emitMethodOn(popped.family, 'delete', { name: null, value: recv, tok: toks[0] },
          node.args || [], toks[0], guards, st, scope)
        return true
      }
    }
    // ⭐⭐ `ls.get(i).set_x2(n)` IS `array.get(ls, i).set_x2(n)`, AND IT BECOMES
    // THE SAME NODE BEFORE ANYTHING ELSE LOOKS AT IT. Rewriting the receiver
    // here rather than teaching `targetRef` a second shape is what keeps ONE
    // reference format in the object program: everything below this line, and
    // every consumer of the op it emits, sees the name form it always saw.
    //
    // ⛔ `pop()`, `shift()` AND `first()`/`last()` ARE NOT REWRITTEN, on purpose.
    // `{r:'coll', index}` addresses an element; `pop` and `shift` REMOVE one, so
    // resolving `k._box.pop().delete()` to a read would delete the right object
    // and leave the collection holding a handle the script believes it took out.
    // `first`/`last` are readable in principle but their index is `0` and
    // `size-1`, and `size` is runtime state this pass has no node for. All four
    // fall through and are counted by the caller.
    const asMethod = recv.name === 'array.get'
      ? recv
      : (methodFormCall(recv, receiverNs, isDefined) || {}).node
    if (!asMethod || asMethod.name !== 'array.get') return false
    if (!Array.isArray(asMethod.args) || asMethod.args.length !== 2) return false
    const cn = asMethod.args[0] && asMethod.args[0].value
    const collName = cn && cn.type === 'name' ? cn.name : null
    const d = collName ? decls.get(collName) : null
    if (!d || d.kind !== 'coll' || !OBJECT_NAMESPACES.includes(d.family)) return false
    const method = node.name
    if (method.startsWith('get_')) { diagnostics.getters.push(`${d.family}.${method}`); return true }
    if (inLoop) { diagnostics.loopBlocked.push(`${d.family}.${method}`); return true }
    // ⛔ THE TARGET CARRIES `asMethod`, NEVER `recv`. For the name form the two
    // are the same object; for the method form `recv` is `{name:'ls.get'}`,
    // which `targetRef` answers null for — so the op would be emitted with NO
    // target and the drawing would address nothing.
    emitMethodOn(d.family, method, { name: null, value: asMethod, tok: toks[0] },
      node.args || [], toks[0], guards, st, scope)
    return true
  }

  /** ⭐⭐ A METHOD-FORM STATEMENT — `b.set_bgcolor(c)`, `ls.push(l)`, `t.cell(…)`.
   *
   *  @returns {boolean} true when this reader OWNED the statement, which includes
   *  every case it owned and could not carry: those are COUNTED here rather than
   *  left to fall through and vanish. False means "not a method form on anything
   *  this pass declared", and the caller behaves exactly as it did before. */
  function emitMethodForm(word, toks, guards, inLoop, st, scope) {
    const split = splitMethodName(word)
    if (!split) return false
    const { recv, method } = split
    // ⛔⛔ THE SCRIPT'S OWN METHOD WINS — see the note on `defined` above. This
    // is checked BEFORE the declaration lookup so that a shadowing definition
    // takes the statement back even when the receiver is a perfectly good
    // collection, which is exactly the case the corpus writes.
    if (isDefined(method)) return false
    const d = decls.get(recv)
    if (!d) return false
    const ns = d.kind === 'coll' ? 'array' : d.family
    const args = argsOf(toks)
    // ⛔ THE SPAN GUARD'S ANSWER IS A COUNTED DROP, NOT SILENCE. `argsOf` returns
    // null when the first `(` does not close on the last token — `b.copy().delete()`
    // — and that is precisely the half-read shape that put a box on a member's
    // chart forever the last time this pass met it.
    if (!args) { diagnostics.unsupported.push(`${ns}.${method}`); return true }
    if (d.kind === 'coll') {
      if (!COLLECTION_CALLS.has(method)) {
        diagnostics.unsupported.push(`array.${method}`)
        if (COLLECTION_MUTATORS.has(method)) loseColl(recv, `coll:${method}`, toks[0])
        return true
      }
      if (inLoop) { diagnostics.loopBlocked.push(`array.${method}`); loseColl(recv, `loop:array.${method}`, toks[0]); return true }
      emitCollectionOn(method, recv, args, toks, guards, st, scope)
      return true
    }
    if (method.startsWith('get_')) { diagnostics.getters.push(`${ns}.${method}`); return true }
    if (inLoop) { diagnostics.loopBlocked.push(`${ns}.${method}`); return true }
    emitMethodOn(ns, method, { name: null, value: { type: 'name', name: recv, tok: toks[0] }, tok: toks[0] },
      args, toks[0], guards, st, scope)
    return true
  }

  function emitCollection(method, toks, guards, inLoop, st, scope) {
    const args = argsOf(toks)
    if (!args || !args.length) return
    const collName = args[0] && args[0].value && args[0].value.type === 'name'
      ? args[0].value.name : null
    if (!collName || !decls.has(collName) || decls.get(collName).kind !== 'coll') return
    // ⛔⛔ AFTER THE RELEVANCE CHECK, NEVER BEFORE IT — MASTER'S TASK 1, AND THIS
    // MERGE PUT IT BACK THE WRONG WAY ROUND ONCE. `array` is Pine's one generic
    // namespace, so a scratch `array.new_float()` calls the same method spellings
    // as an `array.new_line()` collection. Flagging `inLoop` first counts an
    // ordinary numeric loop body as a dropped OBJECT op: measured on
    // `high_engagement__10-rsi-divergence-faytterro.pine`, six `array.set` calls on
    // float scratch arrays, reported as blocked drawings.
    // ⭐ RISK-043 STILL STANDS FOR WHAT IT PROTECTS — an object-family collection
    // op inside a loop this reader cannot execute is still refused and still
    // counted. This is WHEN irrelevance is noticed, not what happens after.
    if (inLoop) { diagnostics.loopBlocked.push(`array.${method}`); loseColl(collName, `loop:array.${method}`, toks[0]); return }
    emitCollectionOn(method, collName, args.slice(1), toks, guards, st, scope)
  }

  /** ⭐⭐ ONE PLACE TURNS A COLLECTION, A METHOD AND THE REST INTO A `coll_*` OP.
   *
   *  ⛔ EXTRACTED FROM `emitCollection` RATHER THAN COPIED, for the reason
   *  `emitMethodOn` records one screen up: `array.push(ls, l)` and `ls.push(l)`
   *  are ONE Pine operation written two ways, and a second emitter would be a
   *  second opinion about which argument carries an inline create. The only
   *  thing the method-form caller supplies differently is WHERE the collection
   *  name came from. */
  function emitCollectionOn(method, collName, restIn, toks, guards, st, scope) {
    const rest = restIn
    const at = VALUE_ARG[method]
    if (at !== undefined && rest[at]) {
      const site = nestedCreate(rest[at], guards, scope, st, toks)
      // ⭐ The argument KEEPS its parse node and gains the site — `targetRef`
      // reads `createSite` first, and anything else reading the node is
      // unaffected. Replacing the node with a synthetic name would have needed
      // a synthetic DECL to go with it, and a register that outlives the bar is
      // the wrong lifetime for an inline create.
      if (site) rest[at] = { ...rest[at], createSite: site }
    }
    ops.push({
      k: `coll_${method}`, coll: collName, args: rest,
      guards, locals: scope, loopIds: [...loopIds], at: toks[0], line: st.header[0].line,
    })
  }

  /**
   * ⭐⭐ ONE CALL TO A DRAWING FUNCTION → ITS BODY, WALKED IN PLACE.
   *
   * The body is rewritten for THIS call site (`rewriteBody`): every local it
   * declares is renamed with a per-call-site suffix — which is what gives each
   * call its own `var` register, Pine's own rule — and every parameter is
   * replaced by the argument's tokens. The rewritten statements are then walked
   * by the ordinary `walk`, under the call's guards and inside the caller's
   * block scope, so every shape this reader already carries (if/else, counted
   * loops, ternary creates, method forms, collections) works inside a function
   * with no second reader.
   *
   * @returns {boolean} whether the body was inlined.
   */
  /**
   * ⭐⭐ ONE CALL HEAD → ONE INLINE. `m(a, b)` goes straight to `inlineCall`;
   * the METHOD FORM `recv.m(a, b)` is rewritten to `m(recv, a, b)` first —
   * Pine's own definition of the method form — so the receiver binds to the
   * method's first parameter through the SAME `bindArgs` every argument uses,
   * and there is no second binder to drift.
   *
   * ⛔ IT REFUSES `method` WHERE THE BODY IS NOT DECIDABLE FROM THE TOKENS: a
   * user method named like a built-in method (`set_right`, `delete`, `push`, …)
   * called on a handle or list this pass declared, or `copy` on anything — Pine
   * might be meaning its own. (An OVERLOADED method is refused in `inlineCall`,
   * which both spellings reach.)
   */
  /** ⭐ C14 — `if c … else …` as a body's LAST statements, each arm ending in a
   *  bare `ns.new(…)` of one family → `{family, creates}` (the two create ops,
   *  found by their arm's line), else null. */
  function ifElseReturn(stmts, sink, before) {
    const n = stmts.length
    if (n < 2) return null
    const e = stmts[n - 1]
    const i = stmts[n - 2]
    const et = (e && e.header) || []
    const it = (i && i.header) || []
    if (et.length !== 1 || et[0].kind !== 'ident' || et[0].value !== 'else') return null
    if (!it.length || it[0].kind !== 'ident' || it[0].value !== 'if') return null
    const armCreate = (arm) => {
      const sub = (arm && arm.sub) || []
      const last = sub[sub.length - 1]
      const lt = (last && last.header) || []
      if (!lt.length || lt[0].kind !== 'ident') return null
      const ns = nsOf(String(lt[0].value))
      if (!ns || !OBJECT_NAMESPACES.includes(ns) || methodOf(String(lt[0].value)) !== 'new') return null
      if (!h.isPunct(lt[1], '(') || closeOf(lt, 1) !== lt.length - 1) return null
      for (let k = sink.length - 1; k >= before; k -= 1) {
        const o = sink[k]
        if (o.k === 'create' && !o.into && o.family === ns && o.line === lt[0].line) return o
      }
      return null
    }
    const a = armCreate(i)
    const b = armCreate(e)
    if (!a || !b || a === b || a.family !== b.family) return null
    return { family: a.family, creates: [a, b] }
  }

  /** ⭐ C34 — a body inlined into a loop this reader does not run: what it
   *  would have removed, created or re-listed, recorded as that loop's loss —
   *  the refused call's own accounting (`bodyEffects`), kept at full volume. A
   *  removal whose family the tokens cannot name is `object.delete`, which the
   *  door classifies as a removal (`classifyReaderName`), never as nothing. */
  function loopBodyEffects(def, fnName, st) {
    const fx = bodyEffects(def, fnDefs, objColls)
    const kinds = { ...(fx.kinds || {}) }
    for (const fam of fx.families || []) {
      const clear = fam === 'table' && (kinds.clear || 0) > 0
      if (clear) kinds.clear -= 1
      diagnostics.loopBlocked.push(clear ? 'table.clear' : `${fam || 'object'}.delete`)
    }
    for (const fam of fx.creates || []) diagnostics.loopBlocked.push(`${fam}.new`)
    for (const name of fx.colls || []) loseColl(name, `loop:fn ${fnName}`, st && st.header ? st.header[0] : null)
  }

  function inlineAt(head, callToks, open, into, guards, inLoop, st, scope) {
    if (!head.recv) return inlineCall(head.fn, callToks, open, into, guards, inLoop, st, scope)
    const root = head.recv.split('.')[0]
    if (isBuiltinMethodName(head.fn) && (head.fn === 'copy' || decls.has(root))) {
      return refuseCall('method', head.fn, st, `\`${head.recv}.${head.fn}\` could be Pine's own \`${head.fn}\``)
    }
    const at = callToks[0]
    const tok = (kind, value) => ({ kind, value, line: at.line, column: at.column, index: at.index })
    const argToks = callToks.slice(open + 1)
    const hasArgs = !(argToks.length === 1 && h.isPunct(argToks[0], ')'))
    const synth = [
      tok('ident', head.fn), callToks[open], tok('ident', head.recv),
      ...(hasArgs ? [tok('punct', ',')] : []),
      ...argToks,
    ]
    return inlineCall(head.fn, synth, 1, into, guards, inLoop, st, scope)
  }

  function inlineCall(fnName, callToks, open, into, guards, inLoop, st, scope) {
    const def = fnDefs.get(fnName)
    if (!def) return refuseCall('unknown', fnName, st)
    // ⛔ AN OVERLOADED METHOD: Pine chooses its body by the receiver's type.
    if (def.isMethod && def.overloaded) {
      return refuseCall('method', fnName, st, `\`${fnName}\` is defined more than once`)
    }
    // ⭐⭐ C34 — A CALL IN A LOOP THIS READER DOES NOT RUN (`for … in`, `while`)
    // IS INLINED, AND ITS BODY MEETS THE LOOP'S OWN REFUSAL. The helper was
    // never the wall: Pine runs the body where the call stands, so each of its
    // statements is a statement of that loop, and every op the walk makes there
    // is `loopBlocked` exactly as a top-level statement in the same loop is.
    // Refusing the CALL named the helper and hid what actually stops the
    // drawing (`trend-lines-supports-and-resistances`: six calls in `for … in`
    // over a list of user-type points, and in two `while`s).
    // ⛔ Nothing new is drawn by this: an op in such a loop is blocked either way.
    // ⛔ What the body would have removed, created or re-listed is ALSO recorded
    // against the loop (`loopBodyEffects` below), read off the tokens the same
    // way a refused call's is — so a removal the walk cannot name (a method-form
    // delete on a handle it never declared) stays as loud as it was when the
    // call was refused, and the member door's partial-drawing rule sees it.
    // ⛔ Still refused: inside the C20 runtime-lane `while` try (`rtLoop`), whose
    // carried body must be statement creates and nothing else.
    if (inLoop && rtLoop) return refuseCall('loop', fnName, st)
    if (inlineDepth >= MAX_INLINE_DEPTH) return refuseCall('depth', fnName, st)
    const args = splitArgs(callToks, open, h.isPunct)
    if (!args) return refuseCall('arity', fnName, st)
    const bound = bindArgs(def, args)
    if (bound.error) return refuseCall(bound.error, fnName, st)
    // ⛔ A CONDITIONAL CALL SEES ONLY THE BARS IT RUNS ON. See the header of
    // `objectFnInline.js`: a body that reads history under a conditional call
    // measures a different set of bars than the every-bar value model does.
    // ⭐ C13 (2026-09-29): a guard built only from inputs and constants holds on
    // every bar or on none, so the call's history is the every-bar history —
    // see `guardIsBarInvariant`. ⛔ A counted loop still refuses: its body runs
    // several times per bar, so no guard can make that history the columnar one.
    // ⭐ C34 — and a loop this reader does not run varies too (its passes).
    const varies = inLoop || loopIds.length > 0
      || guards.some((g) => !guardIsBarInvariant(g.toks, invariantNames))
    if (varies) {
      const why = historyReason(def, drawFns, userFns, pureFns, userMethods, chartSeries, drawMethods)
      if (why) return refuseCall('conditional-history', fnName, st, why)
    }
    const { locals, mutable, carried } = bodyNames(def, h)
    inlineSeq += 1
    const suffix = `${INLINE_SUFFIX}${inlineSeq}`
    const meta = {
      fn: fnName,
      suffix,
      callLine: st.header[0].line,
      mutable: new Set([...mutable].map((n) => n + suffix)),
      carried: new Set([...carried].map((n) => n + suffix)),
    }
    const rw = rewriteBody(def, bound.bind, locals, suffix, h, meta)
    if (rw.error) return refuseCall(rw.error.split(':')[0], fnName, st, rw.error)
    diagnostics.inlinedCalls += 1
    inlineBodies.push({ suffix, fn: fnName, stmts: rw.stmts, everyBar: guards.length === 0 && loopIds.length === 0 && !inLoop })
    if (inLoop) loopBodyEffects(def, fnName, st)
    const sink = ops
    const before = sink.length
    inlineDepth += 1
    try {
      walk(rw.stmts, guards, inLoop, scope)
    } finally {
      inlineDepth -= 1
    }
    // ⭐ C14 — an op the body produced. A getter in it was written where it
    // stands only when it reads the BODY's own handle; one pasted in from an
    // argument was evaluated at the call, before the body's earlier statements.
    // ⭐ C12r — and WHERE the call stands: the body's reads of top-level names
    // happen at the call (Pine runs the body there), so a read-order question
    // about them is asked at this token, not at the definition's. The outermost
    // call writes last, so a nested call's ops carry the real call site.
    const siteAt = callToks[0] && Number.isFinite(callToks[0].index) ? callToks[0].index : null
    for (let i = before; i < sink.length; i += 1) { sink[i].inlined = true; sink[i].siteIndex = siteAt }
    if (!into) return true
    // ⛔ C34 — a handle RETURNED inside a loop this reader does not run is not
    // copied: the copy would run on every bar outside the loop. Blocked with
    // the loop, the way a top-level copy there is.
    if (inLoop) { diagnostics.loopBlocked.push('object copy'); return true }
    // ⭐⭐ C11c — A TUPLE OF RETURNED HANDLES. Pine returns the body's last
    // statement; `[Line, A, B]` there hands each caller name the handle the
    // body's own name holds at the return — an eager register copy per element
    // (`copy` → `setreg`), under the call's guards, exactly the one-handle
    // return below done once per position. ⚰️ Unread, `topLine := Line` copied
    // from a name nothing declared and was dropped without a count, so every
    // setter and getter through `topLine` acted on a register nothing wrote.
    // An element that is not a handle is a value — the value walk's, not ours.
    // ⛔ A tuple whose length is not the caller's refuses by name.
    if (Array.isArray(into)) {
      const tail = rw.stmts[rw.stmts.length - 1]
      const tt = (tail && tail.header) || []
      const tclose = h.isPunct(tt[0], '[') ? tt.findIndex((x) => h.isPunct(x, ']')) : -1
      if (tclose !== tt.length - 1) return refuseCall('return-type', fnName, st, `\`${fnName}\` does not end in a tuple`)
      const parts = []
      let cur = []
      for (const x of tt.slice(1, tclose)) {
        if (h.isPunct(x, ',')) { parts.push(cur); cur = [] } else cur.push(x)
      }
      parts.push(cur)
      if (parts.length !== into.length) {
        return refuseCall('return-type', fnName, st, `\`${fnName}\` returns ${parts.length} values into ${into.length} names`)
      }
      const copies = []
      for (let k = 0; k < parts.length; k += 1) {
        const p = parts[k]
        const d = p.length === 1 && p[0].kind === 'ident' ? decls.get(String(p[0].value)) : null
        if (!d || d.kind === 'coll') continue
        const existing = decls.get(into[k])
        if (existing && (existing.kind === 'coll' || existing.family !== d.family)) {
          return refuseCall('return-type', fnName, st, `\`${into[k]}\` already holds a ${existing.kind === 'coll' ? 'list' : existing.family}`)
        }
        copies.push({ name: into[k], from: String(p[0].value), family: d.family, existing })
      }
      for (const c of copies) {
        if (!c.existing) decls.set(c.name, { family: c.family, kind: 'local' })
        ops.push({
          k: 'copy', into: c.name, from: c.from, fromSite: null, guards, locals: scope, loopIds: [...loopIds],
          at: st.header[0], line: st.header[0].line,
        })
      }
      return true
    }
    // ── the RETURN VALUE, when it is a drawing handle ─────────────────────
    // Pine returns the value of the body's LAST statement. `ret = line.new(…)`,
    // `ln := line.new(…)` and a bare `ln` all return the handle; a bare
    // `line.new(…)` returns the object it just made (this bar's `site`).
    const last = rw.stmts[rw.stmts.length - 1]
    const lt = (last && last.header) || []
    let from = null
    let fromSite = null
    let family = null
    const reL = h.findTop(lt, (x) => h.isPunct(x, ':='))
    const asL = reL >= 0 ? reL : h.findTop(lt, (x) => h.isPunct(x, '='))
    if (asL > 0 && lt[asL - 1] && lt[asL - 1].kind === 'ident') {
      const nm = String(lt[asL - 1].value)
      const d = decls.get(nm)
      if (d && d.kind !== 'coll') { from = nm; family = d.family }
    } else if (lt.length === 1 && lt[0].kind === 'ident') {
      const d = decls.get(String(lt[0].value))
      if (d && d.kind !== 'coll') { from = String(lt[0].value); family = d.family }
    } else if (lt.length && lt[0].kind === 'ident' && nsOf(String(lt[0].value))
      && OBJECT_NAMESPACES.includes(nsOf(String(lt[0].value)))
      && methodOf(String(lt[0].value)) === 'new') {
      for (let i = sink.length - 1; i >= before; i -= 1) {
        if (sink[i].k === 'create' && !sink[i].into) { fromSite = sink[i].site; family = sink[i].family; break }
      }
    }
    // ⭐⭐ C14 — THE HANDLE AN `if`/`else` RETURNS. `createOverBoughtLabel(isIt)
    // => if (isIt) label.new(…) else label.new(…)` (rsi-swing-indicator) returns
    // whichever create its arm ran: one `copy` per arm, under that create's own
    // guards, so the caller's variable holds exactly the object Pine returned.
    // ⛔ Only a plain `if … else` pair whose two arms each END in a bare create
    // of ONE family; any other shape reads as before.
    const arms = !family ? ifElseReturn(rw.stmts, sink, before) : null
    if (arms) {
      const existingArm = decls.get(into)
      if (existingArm && (existingArm.kind === 'coll' || existingArm.family !== arms.family)) {
        return refuseCall('return-type', fnName, st)
      }
      if (!existingArm) decls.set(into, { family: arms.family, kind: 'local' })
      for (const c of arms.creates) {
        ops.push({
          k: 'copy', into, from: null, fromSite: c.site, guards: c.guards, locals: scope, loopIds: [...loopIds],
          at: st.header[0], line: st.header[0].line, inlined: !!c.inlined,
        })
      }
      return true
    }
    if (!family) return true
    const existing = decls.get(into)
    if (existing && (existing.kind === 'coll' || existing.family !== family)) {
      return refuseCall('return-type', fnName, st)
    }
    if (!existing) decls.set(into, { family, kind: 'local' })
    ops.push({
      k: 'copy', into, from, fromSite, guards, locals: scope, loopIds: [...loopIds],
      at: st.header[0], line: st.header[0].line,
    })
    return true
  }

  walk(stmts, [], false, [])
  stampRootSince()
  // ⭐⭐ C14 — EVERY `:=` (and `+=`…) OUTSIDE A FUNCTION BODY, AS (top-level
  // statement ordinal, token index). `pine.js`'s `positionalPlan` compares
  // them with an op's read positions: a read binds at its statement's START or
  // END, and only a name read on BOTH sides of a write in one statement is
  // refused by name.
  const varWrites = new Map()
  const noteWrites = (list, pos) => {
    for (const s2 of list || []) {
      const ts = s2.header || []
      if (definitionHeader(ts, h)) continue
      for (let k = 1; k < ts.length; k += 1) {
        const p = ts[k]
        if (p && p.kind === 'punct' && typeof p.value === 'string' && p.value.length >= 2 && p.value.endsWith('=')
          && !['==', '!=', '<=', '>=', '=>'].includes(p.value) && ts[k - 1] && ts[k - 1].kind === 'ident') {
          const nm = String(ts[k - 1].value)
          if (!varWrites.has(nm)) varWrites.set(nm, [])
          varWrites.get(nm).push({ top: pos, index: Number.isFinite(p.index) ? p.index : null })
        }
      }
      noteWrites(s2.sub, pos)
    }
  }
  splitCommaStatements(stmts, h).forEach((s2, i) => noteWrites([s2], i))
  // ⭐ C16 — `definedNames` lets the converter's `bs.size()` yield to a script's
  // own `size` method, the rule `isDefined` applies to every method form here.
  return { decls, ops, diagnostics, scalars, loopScalars, varWrites, definedNames: defined, inlineBodies }
}
