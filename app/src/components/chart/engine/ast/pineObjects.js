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
  historyReason, pureFunctions, bodyNames, bindArgs, rewriteBody, splitArgs, definitionHeader, callsAny,
  callsMethodAny, bodyEffects, methodHead, isBuiltinMethodName, splitCommaStatements,
  barInvariantNames, guardIsBarInvariant, getterScalars, isBareGetterAt,
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

const COLLECTION_CALLS = Object.freeze(new Set(['push', 'set', 'remove', 'clear', 'pop', 'shift']))
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
  }
  let siteSeq = 0
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
  const pureFns = pureFunctions(fnDefs, drawFns)
  /** Top-level names fixed for the whole run — see `barInvariantNames`. */
  const invariantNames = barInvariantNames(stmts, h)
  /** ⭐ C14 — names that hold a number read off a drawing (`getterScalars`). */
  const scalars = getterScalars(stmts, h)
  let inlineSeq = 0
  let inlineDepth = 0
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
          if (h.isPunct(ts[k], ':=') && ts[k - 1] && ts[k - 1].kind === 'ident') {
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
  let rootPos = -1
  let rootMark = 0
  const stampTop = (list, pos) => {
    for (const o of list) {
      if (o.topPos === undefined) o.topPos = pos
      if (o.k === 'loop' && Array.isArray(o.body)) stampTop(o.body, pos)
    }
  }
  const stampRootSince = () => {
    if (rootPos >= 0) stampTop(ops.slice(rootMark), rootPos)
    rootMark = ops.length
  }
  const walk = (list, guards, inLoop, scope) => {
    let prevIfCond = null
    let localScope = scope
    const isRoot = list === stmts
    // ⭐ `a, b, c` on one line is three statements — `splitCommaStatements`.
    for (const st of splitCommaStatements(list, h)) {
      if (isRoot) { stampRootSince(); rootPos += 1 }
      const t = st.header
      if (!t || !t.length) continue
      const first = t[0]
      const word = first.kind === 'ident' ? first.value : null

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
            const intoTok = reIdx >= 0 ? t[asIdx - 1] : h.boundName(t, asIdx)
            const into = intoTok && intoTok.kind === 'ident' ? String(intoTok.value) : null
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
          const armGuards = [...guards, ...prior.map((toks) => ({ toks, negate: true }))]
          if (at < 0) {
            // Not an arm shape this reader knows: an empty guard is unreadable, so
            // whatever it draws is refused rather than run without its condition.
            walk([arm], [...armGuards, { toks: [], negate: false }], inLoop, localScope)
            continue
          }
          const match = ah.slice(0, at)
          let g = armGuards
          if (at > 0) {
            const cond = subject.length
              ? [P('('), ...subject, P(')'), P('=='), P('('), ...match, P(')')]
              : match
            prior.push(cond)
            g = [...armGuards, { toks: cond, negate: false }]
          }
          const rhs = ah.slice(at + 1)
          if (rhs.length) walk([{ ...arm, header: rhs }], g, inLoop, localScope)
          else walk(arm.sub || [], g, inLoop, localScope)
        }
        continue
      }

      if (word === 'if') {
        const condEnd = t.length
        const cond = t.slice(1, condEnd)
        prevIfCond = cond
        walk(st.sub || [], [...guards, { toks: cond, negate: false }], inLoop, localScope)
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
          localScope = [...localScope, { name, toks: t, st }]
        }
        continue
      }
      if (word === 'else') {
        // `else if cond` → not(prev) and cond ; bare `else` → not(prev)
        const isElseIf = t[1] && t[1].kind === 'ident' && t[1].value === 'if'
        const next = [...guards]
        if (prevIfCond) next.push({ toks: prevIfCond, negate: true })
        if (isElseIf) {
          const cond = t.slice(2)
          prevIfCond = cond
          next.push({ toks: cond, negate: false })
        }
        walk(st.sub || [], next, inLoop, localScope)
        // ⭐ R2 STEP 3 — same as the `if` arm: an `else` body may reassign too,
        // and `foldIfChain` keys its record on the chain's FIRST statement, so
        // this points at `st` for the join the same way.
        for (const name of reassignedIn(st.sub || [])) {
          localScope = [...localScope, { name, toks: t, st }]
        }
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
        if (!head) {
          walk(st.sub || [], guards, true, localScope)
          continue
        }
        const outer = ops
        const body = []
        ops = body
        loopIds.push(head.id)
        walk(st.sub || [], guards, inLoop, localScope)
        loopIds.pop()
        ops = outer
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
            if (OBJECT_NAMESPACES.includes(fam)) decls.set(name, { family: fam, kind: 'coll' })
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
            if (OBJECT_NAMESPACES.includes(fam)) decls.set(name, { family: fam, kind: 'coll' })
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
            if (c && decls.get(c) && decls.get(c).kind === 'coll') diagnostics.lostColls.push(c)
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
      if (st.sub && st.sub.length) walk(st.sub, guards, inLoop, localScope)
    }
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
    if (inLoop) { diagnostics.loopBlocked.push(`${ns}.new`); return false }
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
        if (p) diagnostics.lostColls.push(p.coll)
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
  const VALUE_ARG = Object.freeze({ push: 0, set: 1 })

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
          diagnostics.lostColls.push(popped.coll)
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
        if (COLLECTION_MUTATORS.has(method)) diagnostics.lostColls.push(recv)
        return true
      }
      if (inLoop) { diagnostics.loopBlocked.push(`array.${method}`); diagnostics.lostColls.push(recv); return true }
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
    if (inLoop) { diagnostics.loopBlocked.push(`array.${method}`); diagnostics.lostColls.push(collName); return }
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
    if (inLoop) return refuseCall('loop', fnName, st)
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
    const varies = loopIds.length > 0
      || guards.some((g) => !guardIsBarInvariant(g.toks, invariantNames))
    if (varies) {
      const why = historyReason(def, drawFns, userFns, pureFns, userMethods)
      if (why) return refuseCall('conditional-history', fnName, st, why)
    }
    const { locals, mutable } = bodyNames(def, h)
    inlineSeq += 1
    const suffix = `${INLINE_SUFFIX}${inlineSeq}`
    const meta = {
      fn: fnName,
      suffix,
      callLine: st.header[0].line,
      mutable: new Set([...mutable].map((n) => n + suffix)),
    }
    const rw = rewriteBody(def, bound.bind, locals, suffix, h, meta)
    if (rw.error) return refuseCall(rw.error.split(':')[0], fnName, st, rw.error)
    diagnostics.inlinedCalls += 1
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
    for (let i = before; i < sink.length; i += 1) sink[i].inlined = true
    if (!into) return true
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
  // statement ordinal, token index). An object op's value is read against the
  // name's END-OF-BAR binding, which is Pine's value only where no write to the
  // name comes after the read in the bar; `pine.js` refuses the rest by name.
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
  return { decls, ops, diagnostics, scalars, varWrites, definedNames: defined }
}
