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

import { TABLE } from './parse.js'

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
const ARG_REF = /^arg(\d+)$/

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
    const node = argNodes[Number(m[1])]
    if (!node || node.type !== 'num') return UNKNOWN
    return Number.isInteger(node.value) ? node.value : UNKNOWN
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
        if (!Object.prototype.hasOwnProperty.call(seriesNames, node.name)) {
          reachOf.set(node, noteUnknown(`\`${node.name}\` is not a series this table declares`))
          break
        }
        reachOf.set(node, { back: 0, forward: 0 })
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
        reachOf.set(node, noteUnknown(
          `node type ${JSON.stringify(node && node.type)} is not one of ${['num', 'series', 'op', 'call'].join(', ')}`))
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
      const ast = def.compute.ast
      const verdict = lintRepaint(ast, opts)
      return { address, defId: def.id, plotKey, lane, decidability: 'decided', ...verdict }
    }

    // ── a lane whose compute is hand-written code ─────────────────────────
    //
    // Spec §11 forbids static analysis of hand-written JS, so the linter cannot
    // read this compute at all. It says so, per plot, rather than reporting a
    // clean answer it did not earn.
    const factKey = `${fn}.${plotKey}`
    if (Object.prototype.hasOwnProperty.call(facts, factKey)) {
      const forward = facts[factKey]
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
          `the compute is hand-written and unreadable to this linter, but a forward dependency of ` +
          `${forward} bar${forward === 1 ? '' : 's'} is PINNED outside it and was handed in — ` +
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
