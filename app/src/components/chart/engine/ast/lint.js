// ─── THE MACHINE REPAINT LINTER ─────────────────────────────────────────────
//
// ⭐ THE RULE, IN ONE SENTENCE: a formula repaints iff its output at bar `i`
// depends on any bar `j > i`. That is decidable on this table because every
// function declares its dependency window as a constant or as a named argument,
// so the window of a node is a TREE SUM and nothing needs a dataflow analysis.
// Spec §11 defers this to Phase D for exactly that reason: *"No static analysis
// of hand-written JS; don't build throwaway introspection."*
//
// Three verdicts, spec §3's vocabulary, and there is no fourth:
//
//   non-repainting   — the forward reach is exactly 0. Every bar this output
//                      depends on is at or before its own index.
//   preview-repaints — the forward reach is a KNOWN FINITE k > 0. The output at
//                      bar `i` moves while bars `i+1 … i+k` are forming, and is
//                      FINAL the moment bar `i+k` closes. You can say when it
//                      settles, and that sentence is the badge.
//   repaints         — the forward reach is UNKNOWN or UNBOUNDED. Either this
//                      linter cannot bound it (an unanalysable shape) or the
//                      manifest declares it unbounded, and in both cases there
//                      is no bar after which the value is guaranteed final.
//
// ⭐⭐ ALL THREE ARE REACHABLE, AND THAT IS THE POINT OF THE TRICHOTOMY. The
// decision record's §3 warns that *"a vocabulary value nothing can ever emit is
// a value that does not exist"* — it says that about `preview-repaints`, which
// today is emitted by nothing at all. A design in which every forward reference
// is `repaints` would make `preview-repaints` unreachable; a design in which
// every forward reference is `preview-repaints` would make `repaints`
// unreachable and hand the brand a badge that only ever means "we could not
// read it". `tests/fixtures/ast/must_repaint.json` carries hand-derived cases
// for each of the three and asserts that every one of them is expected by at
// least one case, so no value in the vocabulary is decorative.
//
// ⛔ THERE IS NO EXEMPTION LIST, AND THERE MAY NOT BE ONE. An exemption is
// precisely the hand-audited metadata this linter exists to replace, and the
// brand position is receipts. If this linter disagrees with a shipped badge, the
// linter is the MEASUREMENT and the badge is the CLAIM — the disagreement goes
// to the OWNER (`docs/decisions/2026-08-06-machine-repaint-linter.md`), never
// into this file. That absence is proven STRUCTURALLY, by parsing this module
// and asking which string literals it contains, never by grep: on this branch a
// grep has counted comments in both directions, and this very comment names
// nine of the words a grep would trip on.
//
// ⛔ AND IT IS FAIL-CLOSED. An AST shape this module does not recognise returns
// `repaints` with an `unanalysable:` reason, NEVER `non-repainting`. The
// asymmetry is the whole design: a false `repaints` costs a user one confused
// moment; a false `non-repainting` costs the brand its central claim, and it
// costs it in a way a competitor can demonstrate.
//
// ⛔ NO EXECUTION, EVER. This module never evaluates a formula, never samples a
// bar and never compares two outputs. An empirical *"we ran it and nothing
// moved"* is a statement about one bar window; the claim on the badge is
// universal, so the only admissible evidence is the persisted tree and the
// manifest that describes it (obligation 1 of the record's §5).

import {
  TABLE, NODE_TYPES, RECURRENCES, RECURRENCE_BINDINGS, LOOKBACK_RE,
} from './parse.js'

// --------------------------------------------------------------------------- //
// the vocabulary
// --------------------------------------------------------------------------- //

/** Spec §3's three badge values, in increasing order of "how much of this can we
 *  promise". ONE declaration — `indicatorCatalog.test.js` imports it rather than
 *  retyping the three strings, because a badge vocabulary written down twice is
 *  the `williams_r`/`williamsR` shape that `_CASE_COLUMNS` exists to survive. */
export const REPAINT_MODES = Object.freeze(['non-repainting', 'preview-repaints', 'repaints'])

/** The two answers to *"could the linter decide this at all?"* (obligation 8).
 *
 *  ⭐ THIS EXISTS SO THAT *"the linter agreed with every shipped badge"* IS AN
 *  IMPOSSIBLE SENTENCE WHEN THE TRUTH IS *"the linter could not read any of
 *  them"*. Every shipped definition today is hand-written JS or Python and spec
 *  §11 forbids static analysis of hand-written JS, so the linter cannot ASSIGN
 *  their badges. It can still say, per plot, whether it was able to decide — and
 *  a measurement that reports a decidability of zero is a measurement that
 *  reports zero, out loud, instead of reporting agreement. */
export const DECIDABILITY = Object.freeze(['decided', 'undecidable-hand-written'])

/** The reach of a node the linter could not bound. NOT a number, deliberately:
 *  `Infinity` would compare, sum and `Math.max` its way silently through every
 *  arithmetic path below, and `-1`/`null` would each be a number-shaped hole a
 *  future `> 0` test reads as "clean". A string cannot be added to anything. */
export const UNKNOWN = 'unknown'

/** A forward reach the manifest declares to have no bound — a value that is
 *  never final while the series is still growing. Distinct from `UNKNOWN`: this
 *  one is DECIDED (the manifest said so), it just decides `repaints`. */
export const UNBOUNDED = 'unbounded'

// --------------------------------------------------------------------------- //
// the window, DERIVED FROM THE MANIFEST
// --------------------------------------------------------------------------- //

/** ⭐⭐ OBLIGATION 2 — THE FORWARD-REFERENCE SET COMES FROM THE MANIFEST BOTH
 *  LANES READ, AND THERE IS NO SECOND OFFSET TABLE IN THIS FILE.
 *
 *  `closedTable.json` declares, per function, a `lookback`: a non-negative
 *  integer, or the name of an argument that carries one. That declaration IS the
 *  dependency window, and this is the whole of what the linter knows:
 *
 *      lookback n ≥ 0   ⇒ the window is [i-n, i]      ⇒ forward reach 0
 *      lookback n < 0   ⇒ the window is [i, i+|n|]    ⇒ forward reach |n|
 *      lookback "argK"  ⇒ the same, with n = the K-th argument's literal value
 *
 *  ⭐ THE SIGN IS THE MECHANISM, AND IT IS WHY THERE IS NO SECOND LIST. The day
 *  somebody adds an offset form to the manifest, its forward reach is already
 *  decided here — by arithmetic on the number the manifest declares — without a
 *  line of this file changing. A per-function offset table maintained beside the
 *  manifest is a second grammar and it drifts silently; the ledger's entire
 *  subject matter is what that costs.
 *
 *  A `forward` key MAY be declared alongside `lookback` for a window that is not
 *  symmetric about the sign (a centred window, an explicit offset). It is read
 *  in exactly the same three forms, plus the literal `"unbounded"`.
 *
 *  ⚠️ DECLARED BLINDNESS, WRITTEN DOWN RATHER THAN LEFT TO BE DISCOVERED. This
 *  reads what the manifest SAYS a function's window is. A compute whose real
 *  window is wider than its declaration would be branded on the declaration and
 *  the linter would be wrong — and no static analysis of the tree can see that,
 *  because the tree does not contain the compute. That is a manifest-integrity
 *  question and it belongs to the conformance lane
 *  (`tools/ast_conformance.py`, which runs both interpreters against the same
 *  tree), not to this file. Stating it is the point: an unstated assumption is
 *  the one that ships. */
/** ⛔⛔ THE LOOKBACK GRAMMAR, READ OFF ITS OWNER — NEVER A COPY.
 *
 *  ⚰️ THIS WAS `/^arg(\d+)$/` AND IT BRANDED ADX AS REPAINTING. Measured in the
 *  deployed builder 2026-08-11, seconds after ADX shipped: `ADX14.14 > 25` read
 *  correctly, computed correctly, reported its 28-bar lookback correctly — and
 *  then wore *"⚠️ Repaints — unanalysable: `adx` declares a window this linter
 *  cannot bound"*, which is false. A non-repainting indicator branded repainting
 *  is a save gate: `canSaveFormula` refuses `repaints` outright.
 *
 *  ⛔ IT WAS THE **FOURTH** HAND-WRITTEN COPY OF ONE GRAMMAR. Three were found
 *  and removed when `2*argN` landed (two in `parse.test.js`, one in the parity
 *  probe) — and this one survived because no test had ever declared a function
 *  with a multiplied window AND asked the linter about it. The unit tests could
 *  not see it; the browser could.
 */
const ARG_REF = LOOKBACK_RE

const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k)
const sortedKeys = (o) => Object.keys(o || {}).sort()

// --------------------------------------------------------------------------- //
// the definition's own inputs — a DECLARED SCALAR, never an undeclared series
// --------------------------------------------------------------------------- //

/**
 * The input names a DEFINITION declares — `inputs[].key`, and nothing else.
 *
 * ⭐⭐ AN INPUT REFERENCE IS A SCALAR, AND THAT IS WHY IT HAS NO WINDOW.
 * `parse.js` turns every identifier into a `series` node — deliberately, so the
 * parser needs no table — and `interpret` seeds a declared input into the scope
 * as ONE NUMBER, not a column. A per-instance constant is the same value at
 * every bar, so its dependency window is `[i, i]`: back 0, forward 0. Until this
 * existed the linter had no way to say that, badged `close * lineWidth`
 * `repaints` on the strength of *"`lineWidth` is not a series this table
 * declares"*, and `BuilderSheet.buildDefinition` puts `lineWidth` on every
 * definition it builds — so an input-referencing formula could not be armed at
 * all.
 *
 * ⛔ ONE VOCABULARY, AND IT IS `key`. `defSchema.validateInput` REQUIRES
 * `input.key`, `nativeRegistry.resolveInputs` reads it, and the server's
 * `signature/registry_defs.resolve_inputs` reads `spec["key"]`. `name` is NOT
 * accepted as a fallback: a reader that took either would be the second
 * vocabulary for one field that `alert_user_series._inputs_for` already cost
 * this branch once.
 *
 * ⛔ THE VALUE IS DISCARDED, ON PURPOSE. Reading it would let a per-instance
 * number decide a WINDOW — `resolveDeclaration` still refuses an `argK` that is
 * not a literal `num` node, so `sma(close, period)` stays unanalysable and fails
 * closed even though `period` is declared. A window that changed with a knob is
 * a window the badge cannot promise anything about.
 *
 * @param {object} def a registered definition
 * @returns {object} a null-prototype object whose OWN KEYS are the input names
 */
export function declaredInputs(def) {
  const out = Object.create(null)
  const specs = Array.isArray(def && def.inputs) ? def.inputs : []
  for (const spec of specs) {
    if (spec && typeof spec === 'object' && typeof spec.key === 'string' && spec.key) {
      out[spec.key] = true
    }
  }
  return out
}

/**
 * Resolve one declaration (`lookback` or `forward`) against a call's argument
 * nodes. Returns a finite integer, `UNBOUNDED`, or `UNKNOWN`.
 *
 * ⛔ `UNKNOWN` IS RETURNED FOR EVERY SHAPE THIS DOES NOT RECOGNISE, and that
 * includes an `argK` whose argument is not a literal number. `sma(close, 5 + 5)`
 * parses today and its window is a computed value — bounding it would need a
 * constant folder, which is the dataflow analysis the manifest's `_no_offset`
 * note exists to avoid. Fail closed: the user sees `repaints` and one confused
 * moment, which is the cheap side of the asymmetry.
 */
function resolveDeclaration(decl, argNodes) {
  if (decl === UNBOUNDED) return UNBOUNDED
  if (typeof decl === 'number') {
    return Number.isInteger(decl) ? decl : UNKNOWN
  }
  if (typeof decl === 'string') {
    const m = ARG_REF.exec(decl)
    if (!m) return UNKNOWN
    // ⭐ GROUP 2 IS THE ARGUMENT, GROUP 1 THE OPTIONAL MULTIPLIER (`2*arg3`). The
    // multiplier is applied here so the linter bounds the SAME window the
    // interpreter and the budget walker do — three readers, one grammar.
    const node = argNodes[Number(m[2])]
    if (!node || node.type !== 'num') return UNKNOWN
    if (!Number.isInteger(node.value)) return UNKNOWN
    const times = m[1] === undefined ? 1 : Number(m[1])
    return times * node.value
  }
  return UNKNOWN
}

/** How far a call's OWN window reaches forward and backward, from the manifest.
 *
 *  `back` is the ordinary lookback (what `maxLookback` sums). `forward` is the
 *  other half of the same declaration — never a second table, never a second
 *  read. The two come out of ONE object so they cannot drift apart. */
function ownWindow(spec, argNodes) {
  if (!spec || typeof spec !== 'object') return { back: UNKNOWN, forward: UNKNOWN }

  const lookback = resolveDeclaration(spec.lookback, argNodes)
  const hasForward = Object.prototype.hasOwnProperty.call(spec, 'forward')
  const declaredForward = hasForward ? resolveDeclaration(spec.forward, argNodes) : 0

  if (lookback === UNKNOWN || declaredForward === UNKNOWN) {
    return { back: UNKNOWN, forward: UNKNOWN }
  }
  if (declaredForward === UNBOUNDED || lookback === UNBOUNDED) {
    return { back: UNKNOWN, forward: UNBOUNDED }
  }

  // A NEGATIVE lookback is a window that runs the other way: `[i, i+|n|]`.
  const back = lookback >= 0 ? lookback : 0
  const fromSign = lookback >= 0 ? 0 : -lookback
  const forward = Math.max(fromSign, declaredForward)
  return { back, forward: forward < 0 ? UNKNOWN : forward }
}

// --------------------------------------------------------------------------- //
// the tree sum
// --------------------------------------------------------------------------- //

const isUnknown = (v) => v === UNKNOWN
const isUnbounded = (v) => v === UNBOUNDED

/** `max` over the reach lattice: UNKNOWN ≻ UNBOUNDED ≻ any finite number.
 *
 *  ⛔ UNKNOWN OUTRANKS EVERYTHING, so one unreadable subtree makes the whole
 *  formula unreadable. Anything else would let a clean sibling launder a
 *  branch the linter could not read. */
function maxReach(a, b) {
  if (isUnknown(a) || isUnknown(b)) return UNKNOWN
  if (isUnbounded(a) || isUnbounded(b)) return UNBOUNDED
  return Math.max(a, b)
}

/** `a + b` over the same lattice. Used where a window COMPOSES: the outer
 *  function's own window is applied on top of whatever its arguments already
 *  reach. */
function addReach(a, b) {
  if (isUnknown(a) || isUnknown(b)) return UNKNOWN
  if (isUnbounded(a) || isUnbounded(b)) return UNBOUNDED
  return a + b
}

/**
 * The dependency window of a whole tree, in bars.
 *
 * Returns `{back, forward, reasons}` where each of `back`/`forward` is a finite
 * non-negative integer, `UNBOUNDED`, or `UNKNOWN`, and `reasons` is the list of
 * sentences that explain any non-zero forward reach or any UNKNOWN.
 *
 * ⚠️ ITERATIVE, NOT RECURSIVE — the same reason `parse.js`'s forbidden-node scan
 * is: the escape corpus carries an 8,001-node tree, and a guard that dies inside
 * itself is not a guard. A post-order walk over an explicit stack.
 *
 * ⚠️ `back` AND `forward` COME OUT OF THE SAME WALK, deliberately. `maxLookback`
 * and the repaint verdict are two readings of ONE declaration; computing them in
 * two places is how the day arrives when a function's lookback says one thing to
 * the evaluator and another to the badge.
 */
export function astReach(ast, opts = {}) {
  const table = opts.table || TABLE
  const functions = (table && table.functions) || {}
  const seriesNames = (table && table.series) || {}
  /** ⭐ THE TABLE'S OWN PER-SYMBOL SCALARS, read from the SAME manifest as the
   *  series. The freshness question this module does NOT answer is asked by
   *  `freshness.js` over this same section. */
  const scalarNames = (table && table.scalars) || {}
  /** ⭐ THE CLOCK (tableVersion 2), read from the SAME manifest. A clock leaf is
   *  a property of the bar it draws on — the calendar moment it sits at — so it
   *  reaches neither backwards nor forwards. */
  const clockNames = (table && table.clock) || {}
  /** `opts.inputs` — the definition's declared inputs, BY NAME. The same shape
   *  `sentence.js::explainSentence` already takes and the same shape `interpret`
   *  takes; only the KEYS are read here (see `declaredInputs`). `lintDefinition`
   *  derives it from the definition itself, so a caller cannot widen a
   *  definition's own input set by handing in another one. */
  const inputs = opts.inputs || {}
  const reasons = []

  // Post-order over an explicit stack: `[node, visitedChildren]`.
  const order = []
  const stack = [ast]
  while (stack.length) {
    const node = stack.pop()
    order.push(node)
    if (node && typeof node === 'object' && Array.isArray(node.args)) {
      for (const child of node.args) stack.push(child)
    }
  }

  const reachOf = new Map()
  const noteUnknown = (why) => { reasons.push(`unanalysable: ${why}`); return { back: UNKNOWN, forward: UNKNOWN } }

  /** Every node that sits inside some recurrence's BODY argument.
   *
   *  ⭐ THE RECURRENCE BINDING IS SCOPED, AND THIS IS THE ONLY PLACE THIS FILE
   *  HAS TO KNOW IT. `self` resolves inside a body and nowhere else, so a walk
   *  that judged it by NAME alone would either call every stray `self` legal or
   *  every legitimate one unanalysable — and `unanalysable` outranks everything
   *  in `maxReach`, so the second mistake would quietly downgrade every
   *  accumulator on the platform to a `unknown` repaint verdict.
   *
   *  ⛔ DERIVED FROM THE MANIFEST'S `recurrence.body` INDEX, never from the
   *  position 1: the walker asks the table which argument is the body. */
  const inRecurrenceBody = new Set()
  for (const node of order) {
    if (!node || typeof node !== 'object' || node.type !== 'call') continue
    const rec = own(RECURRENCES, node.name) ? RECURRENCES[node.name] : null
    if (!rec) continue
    const body = Array.isArray(node.args) ? node.args[rec.body] : undefined
    const descend = [body]
    while (descend.length) {
      const x = descend.pop()
      if (!x || typeof x !== 'object' || inRecurrenceBody.has(x)) continue
      inRecurrenceBody.add(x)
      if (Array.isArray(x.args)) for (const child of x.args) descend.push(child)
    }
  }

  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i]
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      reachOf.set(node, noteUnknown('a node that is not an object'))
      continue
    }
    switch (node.type) {
      case 'num': {
        reachOf.set(node, { back: 0, forward: 0 })
        break
      }
      case 'series': {
        // ⭐ A RECURRENCE BINDING FIRST, AND ONLY WHERE IT IS BOUND. `self` is
        // the running value's OWN previous bar, so it reaches back nothing of
        // its own — the `warmup` the `accum` call declares is the whole window,
        // and adding a bar here would double-count it. Outside a body the name
        // falls through to the refusal below, which is the honest answer: it
        // resolves to nothing there, and `interpret` says so too.
        if (RECURRENCE_BINDINGS.includes(node.name) && inRecurrenceBody.has(node)) {
          reachOf.set(node, { back: 0, forward: 0 })
          break
        }
        // ⛔ THE TABLE IS CONSULTED FIRST AND THE ORDER IS LOAD-BEARING —
        // verbatim `sentence.js::renderName`'s reasoning, for the same reason. A
        // definition whose input shadows `close` is a wiring defect `interpret`
        // throws on outright; what this must never do is let the ANSWER depend
        // on which map was consulted second.
        if (own(seriesNames, node.name)) {
          reachOf.set(node, { back: 0, forward: 0 })
          break
        }
        if (own(clockNames, node.name)) {
          // ⭐ A CLOCK LEAF, AND ITS ZERO IS A DIFFERENT FACT FROM A SCALAR'S.
          // A scalar is (0, 0) because it is ONE number for the whole column; a
          // clock value is (0, 0) because it is THIS bar's own — `hour` changes
          // every bar and still reads no other one. Both are non-repainting and
          // the reasons do not transfer, which is why this is its own branch
          // rather than a widening of the scalar test.
          //
          // ⛔ AND UNLIKE A SCALAR, THERE IS NO SECOND VERDICT TO ASK FOR. The
          // freshness gate exists because a scalar's zero hides a day-old value;
          // a clock leaf is read off the bar being drawn, so `freshness.js`
          // answers `live` and this zero is the whole truth.
          reachOf.set(node, { back: 0, forward: 0 })
          break
        }
        if (own(scalarNames, node.name)) {
          // ⭐ A TABLE-DECLARED SCALAR, AND IT IS THE SAME (0, 0) AS A DECLARED
          // INPUT FOR THE SAME REASON: one number for the whole column depends
          // on no bar at all, least of all a later one.
          //
          // ⛔ AND THAT ZERO IS CORRECT AND USELESS ON ITS OWN. It makes
          // `modeFromReach` answer `non-repainting` for a value that is up to a
          // day old, so this gate PASSES a nightly market cap and nothing fires
          // — a true answer to a question nobody asked. `freshness.js` asks the
          // other one; this module does not bend to cover it.
          reachOf.set(node, { back: 0, forward: 0 })
          break
        }
        if (own(inputs, node.name)) {
          // A DECLARED SCALAR. One number for the whole column, so it depends on
          // no bar at all — least of all a later one.
          reachOf.set(node, { back: 0, forward: 0 })
          break
        }
        reachOf.set(node, noteUnknown(
          `\`${node.name}\` is not a series this table declares, and this definition declares `
          + `${sortedKeys(inputs).join(', ') || 'no inputs'}`))
        break
      }
      case 'offset': {
        // ⭐⭐ THE OFFSET IS THE ONE NODE THAT MOVES A WINDOW WITHOUT NAMING A
        // FUNCTION, AND IT MOVES IT BACKWARDS ONLY. `close[3]` at bar `i` reads
        // bar `i-3`: `back` grows by the offset, `forward` is untouched. That
        // asymmetry is not a policy this file applies — it is a fact about the
        // node, because `parse.js` refuses a negative literal at the door and
        // the shape has no slot for an expression that could evaluate to one.
        //
        // ⛔ WHICH IS WHY THIS ARM CANNOT MAKE ANYTHING REPAINT, AND WHY
        // `ichimoku.chikou` IS STILL DECIDABLE. A signed offset would put a
        // second, tree-shaped source of forward reach beside the manifest's
        // `forward` declaration, and `modeFromReach` would then be reading two
        // authorities over one number. It reads one.
        const args = Array.isArray(node.args) ? node.args : []
        const n = node.value
        if (args.length !== 1 || typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
          reachOf.set(node, noteUnknown(
            `an offset node carries one child and a whole number of bars ≥ 0, got `
            + `${JSON.stringify(n)} over ${args.length}`))
          break
        }
        const child = reachOf.get(args[0]) || { back: UNKNOWN, forward: UNKNOWN }
        reachOf.set(node, { back: addReach(n, child.back), forward: child.forward })
        break
      }
      case 'op': {
        const spec = (table.operators || {})[node.name]
        const args = Array.isArray(node.args) ? node.args : []
        if (!spec || spec.arity !== args.length) {
          reachOf.set(node, noteUnknown(`\`${node.name}\` is not an operator this table declares at arity ${args.length}`))
          break
        }
        // An operator is POINTWISE: it reads its arguments at bar `i` and
        // nowhere else, so it contributes no window of its own.
        let back = 0
        let forward = 0
        for (const child of args) {
          const r = reachOf.get(child) || { back: UNKNOWN, forward: UNKNOWN }
          back = maxReach(back, r.back)
          forward = maxReach(forward, r.forward)
        }
        reachOf.set(node, { back, forward })
        break
      }
      case 'call': {
        const spec = functions[node.name]
        const args = Array.isArray(node.args) ? node.args : []
        if (!spec) {
          reachOf.set(node, noteUnknown(`\`${node.name}\` is not a function this table declares`))
          break
        }
        const own = ownWindow(spec, args)
        if (isUnknown(own.forward)) {
          reachOf.set(node, noteUnknown(`\`${node.name}\` declares a window this linter cannot bound`))
          break
        }
        let argBack = 0
        let argForward = 0
        for (const child of args) {
          const r = reachOf.get(child) || { back: UNKNOWN, forward: UNKNOWN }
          argBack = maxReach(argBack, r.back)
          argForward = maxReach(argForward, r.forward)
        }
        // The outer window COMPOSES on top of whatever the arguments reach:
        // an output at `i` reads argument outputs across `[i-back, i+forward]`,
        // and each of those already reaches `argForward` beyond its own index.
        const forward = addReach(own.forward, argForward)
        if (!isUnknown(forward) && forward !== 0) {
          reasons.push(
            isUnbounded(forward)
              ? `\`${node.name}\` declares an UNBOUNDED forward reach — no bar makes this value final`
              : `\`${node.name}\` reads ${forward} bar${forward === 1 ? '' : 's'} ahead of the bar it writes`)
        }
        reachOf.set(node, { back: addReach(own.back, argBack), forward })
        break
      }
      default: {
        // ⛔ THE LIST IS DERIVED, NEVER RETYPED. It read `['num','series','op',
        // 'call']` as a literal here, which made this message a SECOND AUTHORITY
        // over `parse.js::NODE_TYPES` — and the day a fifth type landed, this
        // arm would have gone on naming four while refusing the fifth.
        reachOf.set(node, noteUnknown(
          `node type ${JSON.stringify(node && node.type)} is not one of ${NODE_TYPES.join(', ')}`))
        break
      }
    }
  }

  const root = reachOf.get(ast) || { back: UNKNOWN, forward: UNKNOWN }
  return { back: root.back, forward: root.forward, reasons }
}

/** The backward window only — the number an evaluator needs to know how many
 *  bars to warm up on. Exported so nothing has to reimplement the sum.
 *
 *  ⛔ IT IS NOT A BOUND ON THE FORWARD DEPENDENCY AND MUST NEVER BE USED AS ONE.
 *  Treating a lookback as a forward bound brands `sma(close, 20)` as reading 20
 *  bars ahead — every clean case in the corpus goes red, which is exactly how
 *  that confusion is caught. */
export function maxLookback(ast, opts = {}) {
  return astReach(ast, opts).back
}

// --------------------------------------------------------------------------- //
// the verdict
// --------------------------------------------------------------------------- //

/**
 * Reach → badge. The whole decision, in three lines, on purpose.
 *
 * ⭐ THE MIDDLE LINE IS THE FORWARD-REFERENCE CHECK. Deleting it is the
 * guard-deleted control the record's §5.5 requires: with it gone every bounded
 * forward reference reads `non-repainting` and the must-repaint corpus comes
 * back non-zero clean, which is what proves this linter is capable of being
 * wrong. A gate that cannot fail is not a gate.
 */
export function modeFromReach(forward) {
  if (isUnknown(forward) || isUnbounded(forward)) return 'repaints'
  if (forward > 0) return 'preview-repaints'
  return 'non-repainting'
}

/**
 * Assign a repaint mode to an AST.
 *
 * @param {object} ast   a canonical tree (`parse.js`'s four node types)
 * @param {object} [opts]
 * @param {object} [opts.table] the manifest to read. Defaults to the shipped
 *        `closedTable.json`. It is a GRAMMAR, keyed by function name — never an
 *        allow-list, never keyed by an indicator id, and the corpus is the only
 *        caller that supplies one, so a future grammar can be linted before it
 *        ships rather than after.
 * @param {object} [opts.inputs] the DEFINITION's declared inputs, by name — the
 *        same shape `sentence.js` and `interpret` take. A `series` node naming
 *        one of them is a per-instance SCALAR and reaches no bar; a name in
 *        neither map is unanalysable and fails closed, exactly as before. It is
 *        not an allow-list either: `lintDefinition` DERIVES it from
 *        `def.inputs`, so what a definition may call a scalar is what that
 *        definition itself declares.
 * @returns {{mode: string, reasons: string[], forward: number|string, back: number|string}}
 */
export function lintRepaint(ast, opts = {}) {
  const { back, forward, reasons } = astReach(ast, opts)
  const mode = modeFromReach(forward)
  if (mode === 'non-repainting') {
    return { mode, reasons: ['every bar this output depends on is at or before its own index'], forward, back }
  }
  return {
    mode,
    reasons: reasons.length ? reasons : ['unanalysable: the linter could not bound this tree'],
    forward,
    back,
  }
}

// --------------------------------------------------------------------------- //
// per-plot, per-definition — the shape the owner's ruling needs
// --------------------------------------------------------------------------- //

/**
 * A plot's OWN declared forward window, read in the three forms this module
 * already understands, or `undefined` when it declares none.
 *
 * ⛔ `undefined` AND `0` ARE DIFFERENT ANSWERS AND MUST STAY DIFFERENT. `0` is a
 * plot that says *"I read no bar after my own index"* — a decidable, clean
 * verdict. `undefined` is a plot that says NOTHING, which on a hand-written lane
 * is `undecidable-hand-written` and carries no verdict at all. Collapsing them
 * would brand every un-declared plot in the catalogue `non-repainting` on the
 * strength of its silence — which is precisely the shared default this whole
 * record exists about, rebuilt one level down.
 *
 * ⛔ AND AN UNRECOGNISED SHAPE IS `UNKNOWN`, NOT `undefined`. A plot that
 * declares `forward: 'soon'` HAS made a declaration and this linter cannot read
 * it; answering `undefined` would silently downgrade that to "declared nothing"
 * and hide it among forty-one honest silences. `UNKNOWN` fails closed to
 * `repaints`, which is the cheap side of the asymmetry.
 */
function plotForward(plot) {
  if (!plot || typeof plot !== 'object') return undefined
  if (!Object.prototype.hasOwnProperty.call(plot, 'forward')) return undefined
  const v = plot.forward
  if (v === UNBOUNDED) return UNBOUNDED
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v
  return UNKNOWN
}

/**
 * ⭐⭐ OBLIGATION 9 — PER-PLOT GRANULARITY, EXPRESSIBLE BEFORE ANY BADGE MOVES.
 *
 * The owner's ruling (record §4) is per PLOT: `ichimoku` reads `non-repainting`
 * on four plots and something else on the fifth. Today `meta.repaint` is per
 * DEFINITION and no plot carries a badge, so the ruling cannot be applied
 * without lying in one direction or the other. This is the output shape that can
 * hold it — `(defId, plotKey) → verdict` — and it exists BEFORE any badge moves,
 * which is the order the record demands.
 *
 * ⛔ THIS FUNCTION MEASURES. It never reads `meta.repaint`, never compares
 * against it and never writes anything. The comparison to the shipped badge is
 * the CALLER's, and the caller is a test whose only available response to a
 * disagreement is to report it.
 *
 * @param {object} def   a registered definition
 * @param {object} [opts]
 * @param {object} [opts.table] the manifest (see `lintRepaint`)
 * @param {object} [opts.declaredForwardFacts] `"<compute.fn>.<plotKey>" → n`:
 *        an externally PINNED forward dependency for a lane this linter cannot
 *        read. The linter owns no such fact and cannot invent one; it is handed
 *        them by a caller that read them from where they are already pinned. See
 *        `tests/test_ast_lint.py` for the Python lane's source (the golden
 *        suite's `TRAILING_PAD`) and `lint.test.js` for the JS lane's (the
 *        trailing null run measured off the committed golden fixtures).
 *
 * ⭐⭐ AND `plots[].forward` IS THE SAME FACT ARRIVING FROM THE DEFINITION, WHICH
 * IS WHAT MAKES THE PER-PLOT VERDICT AVAILABLE IN A BROWSER AT ALL. The golden
 * fixtures are a test artefact; a chart cannot read them. So the DEFINITION may
 * declare the plot's forward window — a WINDOW, in bars, exactly the shape
 * `closedTable.json` declares per function — and this module turns it into the
 * badge through `modeFromReach`, the same three lines that decide the `ast` lane.
 *
 * ⛔ A WINDOW, NEVER A BADGE, AND THE DIFFERENCE IS THE WHOLE POINT. `defSchema`
 * REFUSES a `plots[].repaint` outright, so a plot can state the fact it knows and
 * can never state the verdict it does not get to choose. A hand-set badge stays
 * impossible in both directions; a hand-set window is the only thing a
 * hand-written compute has ever been able to tell this linter, and the record's
 * §3.1 already writes down what that costs (*"a compute whose real window is
 * wider than its declaration would be branded on the declaration"*).
 *
 * ⛔ WHEN BOTH ARRIVE, THE WORSE ONE WINS — `maxReach`, the same lattice the tree
 * sum uses. A declaration that under-claims cannot launder a measured artefact,
 * and a handed-in fact cannot launder a declared unbounded window. Failing closed
 * in the direction of the badge is the asymmetry this whole module is built on.
 */
export function lintDefinition(def, opts = {}) {
  const facts = opts.declaredForwardFacts || {}
  const lane = (def && def.compute && def.compute.kind) || 'unknown'
  const fn = (def && def.compute && def.compute.fn) || ''
  const plots = Array.isArray(def && def.plots) ? def.plots : []

  const rows = plots.map((plot) => {
    const plotKey = plot && plot.key
    const address = `${def.id}.${plotKey}`

    // ── the lane this linter was built for ────────────────────────────────
    if (lane === 'ast') {
      // ⭐ W1b — A PLOT LINTS **ITS** TREE; the scan alias is what a plot with no
      // tree of its own lints, which is every plot of a tree-less (pre-W1b)
      // document and every `hlines` guide. Reading `compute.ast` for all of them
      // would report one tree's verdict under four plot keys — a per-plot row
      // that is not per-plot, which is the whole obligation this function exists
      // to satisfy.
      const trees = def.compute.trees
      const ast = (trees && typeof trees === 'object'
        && Object.prototype.hasOwnProperty.call(trees, plotKey))
        ? trees[plotKey]
        : def.compute.ast
      // ⭐ THE DEFINITION'S OWN INPUTS ARE DERIVED HERE, NEVER ACCEPTED FROM THE
      // CALLER. A caller cannot widen a definition's scalar set by handing one
      // in — which is what would turn a declared knob into a general escape
      // hatch for any name at all. The closed table stays closed; what an input
      // adds is exactly the names the DOCUMENT declares.
      const verdict = lintRepaint(ast, { ...opts, inputs: declaredInputs(def) })
      return { address, defId: def.id, plotKey, lane, decidability: 'decided', ...verdict }
    }

    // ── a lane whose compute is hand-written code ─────────────────────────
    //
    // Spec §11 forbids static analysis of hand-written JS, so the linter cannot
    // read this compute at all. It says so, per plot, rather than reporting a
    // clean answer it did not earn — UNLESS somebody outside hands it the one
    // fact it cannot derive: how far ahead of its own index this column reads.
    const factKey = `${fn}.${plotKey}`
    const handed = Object.prototype.hasOwnProperty.call(facts, factKey) ? facts[factKey] : undefined
    const declared = plotForward(plot)
    if (handed !== undefined || declared !== undefined) {
      const forward = (handed !== undefined && declared !== undefined)
        ? maxReach(handed, declared)
        : (handed !== undefined ? handed : declared)
      const sources = []
      if (handed !== undefined) sources.push('PINNED outside this repo\'s source and handed in')
      if (declared !== undefined) sources.push('DECLARED by the plot as its forward window')
      return {
        address,
        defId: def.id,
        plotKey,
        lane,
        decidability: 'decided',
        mode: modeFromReach(forward),
        forward,
        back: UNKNOWN,
        reasons: [
          (isUnknown(forward) || isUnbounded(forward))
            ? `the compute is hand-written and unreadable to this linter, and the forward window it ` +
              `was handed (${forward}) names no bar after which the value is final`
            : `the compute is hand-written and unreadable to this linter, but a forward dependency of ` +
              `${forward} bar${forward === 1 ? '' : 's'} was ${sources.join(' and ')} — ` +
              `bar i's value is written to index i-${forward}, so the point at a historical index ` +
              `moves while the newest bar forms and is final the moment that bar closes`,
        ],
      }
    }
    return {
      address,
      defId: def.id,
      plotKey,
      lane,
      decidability: 'undecidable-hand-written',
      mode: null,
      forward: UNKNOWN,
      back: UNKNOWN,
      reasons: [
        `the compute is hand-written ${lane === 'server' ? 'Python' : 'JS'} and spec §11 forbids ` +
        'static analysis of it; nothing outside the linter pins a forward dependency for this plot',
      ],
    }
  })

  return { id: def.id, lane, plots: rows }
}

/** Every definition, every plot, one flat table. The measurement. */
export function lintCatalogue(defs, opts = {}) {
  return defs.flatMap((def) => lintDefinition(def, opts).plots)
}

/**
 * The rows on which the linter DISAGREES with a shipped badge.
 *
 * ⛔ A DISAGREEMENT IS A FINDING, NOT A FIX. This returns it; it does not resolve
 * it, and there is deliberately no function in this module that could. The only
 * response available to a caller is to report — which is obligation 7: the
 * failure direction is "the finding is loud", never "the badge was quietly
 * corrected to match".
 *
 * An `undecidable-hand-written` row is NOT a disagreement. The linter having no
 * opinion is not the same as the linter agreeing, and conflating them is exactly
 * the sentence obligation 8 exists to make unwriteable.
 */
export function disagreements(rows, defs) {
  const badgeOf = new Map(defs.map((d) => [d.id, d && d.meta && d.meta.repaint]))
  return rows
    .filter((r) => r.decidability === 'decided' && r.mode !== badgeOf.get(r.defId))
    .map((r) => ({ address: r.address, shipped: badgeOf.get(r.defId), measured: r.mode, reasons: r.reasons }))
}
