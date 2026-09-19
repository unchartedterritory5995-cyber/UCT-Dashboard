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
  const ops = []
  const diagnostics = { loopBlocked: [], getters: [], unsupported: [], outOfScope: [] }
  let siteSeq = 0

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
        walk(st.sub || [], guards, true, localScope)
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

  const argsOf = (toks) => {
    const open = toks.findIndex((x) => h.isPunct(x, '('))
    if (open < 0) return null
    try {
      return h.parseArguments(new h.Cursor(toks.slice(open + 1)))
    } catch { return null }
  }

  function emitFromRhs(rhs, intoName, guards, inLoop, st, scope, once = false) {
    if (!rhs.length || rhs[0].kind !== 'ident') return
    const ns = nsOf(rhs[0].value)
    if (!ns || !OBJECT_NAMESPACES.includes(ns) || methodOf(rhs[0].value) !== 'new') return
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
      args,
      at: rhs[0],
      line: st.header[0].line,
    })
  }

  function emitMethod(ns, method, toks, guards, inLoop, st, scope) {
    if (inLoop) { diagnostics.loopBlocked.push(`${ns}.${method}`); return }
    const args = argsOf(toks)
    if (!args || !args.length) { diagnostics.unsupported.push(`${ns}.${method}`); return }
    const target = args[0]
    const rest = args.slice(1)
    if (method === 'delete') {
      ops.push({ k: 'delete', family: ns, target, guards, locals: scope, at: toks[0], line: st.header[0].line })
      return
    }
    if (ns === 'table' && method === 'cell') {
      ops.push({
        k: 'cell', target, col: rest[0], row: rest[1], args: rest.slice(2),
        guards, locals: scope, at: toks[0], line: st.header[0].line,
      })
      return
    }
    const props = (SETTER_PROPS[ns] || {})[method]
    if (!props) { diagnostics.unsupported.push(`${ns}.${method}`); return }
    ops.push({
      k: 'update', family: ns, target, props, args: rest,
      guards, locals: scope, at: toks[0], line: st.header[0].line,
    })
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
      guards, locals: scope, at: toks[0], line: st.header[0].line,
    })
  }

  walk(stmts, [], false, [])
  return { decls, ops, diagnostics }
}
