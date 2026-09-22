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
  'text_halign', 'text_valign', 'bgcolor', 'tooltip', 'text_size'])

/** `table.clear(table_id, start_column, start_row, end_column, end_row)` — the
 *  four bounds AFTER the handle, in Pine's own order.
 *
 *  ⭐ `end_column`/`end_row` are OPTIONAL and default to their `start_`
 *  counterpart, so `table.clear(t, 0, 2)` takes exactly the one cell. They are
 *  left ABSENT here rather than filled in, because the default is a property of
 *  the other argument and only the converter has both in hand. */
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
  const diagnostics = { loopBlocked: [], getters: [], unsupported: [], outOfScope: [] }
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
  const walk = (list, guards, inLoop, scope) => {
    let prevIfCond = null
    let localScope = scope
    for (const st of list) {
      const t = st.header
      if (!t || !t.length) continue
      const first = t[0]
      const word = first.kind === 'ident' ? first.value : null

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
            emitFromRhs(rhs, name, guards, inLoop, st, localScope, true)
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
   * ⛔ `by` IS REFUSED BY RETURNING NULL. The runtime's loop op steps by one
   * toward its bound; carrying a `by` head without a step would draw every row
   * of a loop the author wrote to skip, which is a wrong table rather than a
   * missing one.
   *
   * ⚠️ THE `by` AND `while` GUARDS ARE NOT INDEPENDENTLY PROVABLE, and that is
   * recorded rather than implied. A mutation deleting either stays GREEN,
   * because this parser already refuses both for a second reason: `while i < 3`
   * has no top-level `=` at index 2, and `0 to 10 by 2` fails to parse as a
   * bound expression. They are kept because they state the INTENT — a parser
   * that grew more lenient would otherwise start stepping a `by` loop by one,
   * silently — and NOT counted as guards this file can demonstrate.
   */
  const parseForHead = (t) => {
    if (!t[1] || t[1].kind !== 'ident') return null
    const eq = h.findTop(t, (x) => h.isPunct(x, '='))
    if (eq !== 2) return null
    const toIdx = h.findTop(t, (x) => x.kind === 'ident' && x.value === 'to')
    if (toIdx <= eq) return null
    if (h.findTop(t, (x) => x.kind === 'ident' && x.value === 'by') > toIdx) return null
    try {
      const from = h.parseWholeExpression(t.slice(eq + 1, toIdx))
      const to = h.parseWholeExpression(t.slice(toIdx + 1))
      if (!from || !to) return null
      return { id: t[1].value, from: { value: from }, to: { value: to } }
    } catch { return null }
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

  function emitFromRhs(rhs, intoName, guards, inLoop, st, scope, once = false) {
    if (!rhs.length || rhs[0].kind !== 'ident') return
    const ns = nsOf(rhs[0].value)
    if (!ns || !OBJECT_NAMESPACES.includes(ns) || methodOf(rhs[0].value) !== 'new') return
    // ⛔ STILL REFUSED FOR A LOOP THIS READER COULD NOT PARSE. `inLoop` is
    // now true ONLY for a `while`, a `for … by`, or a head of a shape the
    // parser does not know — a counted `for` clears it and nests instead.
    // ⚰️ Deleting these outright (first cut of the loop reader) made a `while`
    // body emit its ops as if they ran ONCE, which is precisely the lie the
    // original refusal existed to prevent.
    if (inLoop) { diagnostics.loopBlocked.push(`${ns}.new`); return }
    const args = argsOf(rhs)
    if (!args) { diagnostics.unsupported.push(`${ns}.new`); return }
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
  }

  function emitMethod(ns, method, toks, guards, inLoop, st, scope) {
    if (inLoop) { diagnostics.loopBlocked.push(`${ns}.${method}`); return }
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
    if (ns === 'table' && method === 'cell') {
      ops.push({
        k: 'cell', target, col: rest[0], row: rest[1], args: rest.slice(2),
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
    if (!recv || recv.type !== 'call' || recv.name !== 'array.get') return false
    if (!Array.isArray(recv.args) || recv.args.length !== 2) return false
    const cn = recv.args[0] && recv.args[0].value
    const collName = cn && cn.type === 'name' ? cn.name : null
    const d = collName ? decls.get(collName) : null
    if (!d || d.kind !== 'coll' || !OBJECT_NAMESPACES.includes(d.family)) return false
    const method = node.name
    if (method.startsWith('get_')) { diagnostics.getters.push(`${d.family}.${method}`); return true }
    if (inLoop) { diagnostics.loopBlocked.push(`${d.family}.${method}`); return true }
    emitMethodOn(d.family, method, { name: null, value: recv, tok: toks[0] },
      node.args || [], toks[0], guards, st, scope)
    return true
  }

  function emitCollection(method, toks, guards, inLoop, st, scope) {
    if (inLoop) { diagnostics.loopBlocked.push(`array.${method}`); return }
    const args = argsOf(toks)
    if (!args || !args.length) return
    const collName = args[0] && args[0].value && args[0].value.type === 'name'
      ? args[0].value.name : null
    if (!collName || !decls.has(collName) || decls.get(collName).kind !== 'coll') return
    ops.push({
      k: `coll_${method}`, coll: collName, args: args.slice(1),
      guards, locals: scope, loopIds: [...loopIds], at: toks[0], line: st.header[0].line,
    })
  }

  walk(stmts, [], false, [])
  return { decls, ops, diagnostics }
}
