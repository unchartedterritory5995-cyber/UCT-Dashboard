// ─── THE SECOND VERDICT — how fresh a formula's inputs CAN be ────────────────
//
// ⭐⭐ WHY THERE IS A SECOND VERDICT AT ALL, AND IT IS THE WHOLE POINT OF THIS
// MODULE. `lint.js::astReach` answers `{back: 0, forward: 0}` for a scalar leaf,
// so `modeFromReach` brands `market_cap > 1e9` **non-repainting** — and that
// answer is CORRECT. A scalar's value at bar `i` does not depend on any bar
// `j > i`; it is the same number at every bar of the column. Which means the
// repaint gate PASSES a formula whose value is up to a day old and **nothing
// fires at all**. The zero is a true answer to a question nobody asked.
//
// That is exactly why freshness is a **GATE** and not a label:
// `nativeRegistry.validateAstLane` requires `meta.freshness` on the `ast` lane
// and refuses a disagreement in BOTH directions, the same way it already does
// for the repaint badge one field over. Over-claiming `live` on a nightly market
// cap tells a user a number is current when it is a day old; under-claiming
// `as-of-snapshot` on a pure price formula tells them a live signal is stale,
// and a user who discounts a true signal has been misled just as precisely.
//
// Three values and NO CADENCE STRING IN THE BADGE, on purpose. Whether the
// snapshot's nightly cadence is the right one is an OPEN OWNER QUESTION, and a
// badge spelling `snapshot:nightly` would bake an unresolved decision into a
// persisted, user-visible field. The cadence lives per-scalar in the manifest.
//
// ⛔ IT IS A CADENCE CLAIM, NOT A STALENESS MEASUREMENT. `lint.js`'s rule is
// *"NO EXECUTION, EVER"* for the same reason: the claim on a badge is universal,
// so it may not depend on when it was rendered. How fresh a given symbol's row
// IS is a per-row runtime fact read off the `as_of` column.
//
// ⛔ AND IT IS FAIL-CLOSED, IN THE STALEST DIRECTION. A shape this module cannot
// read answers `unknown`, never `live` — mirroring the repaint linter's
// `repaints`. A false `live` is the brand claim dying quietly.
//
// ⛔ THIS IS A MIRROR OF `api/services/ast_freshness.py`, NOT A SECOND DESIGN.
// Both read the SAME `closedTable.json` and both are asserted against the SAME
// fixture (`tests/fixtures/ast/scalars.json`), so a divergence is a failing test
// rather than a discovery six months later.

import { TABLE, NODE_TYPES } from './parse.js'

/** The three answers, and there is no fourth.
 *
 *  live           — every leaf reads the bar it draws on. No scalar in the tree.
 *  as-of-snapshot — at least one leaf is a table-declared scalar. The value is
 *                   fixed between builds and is IDENTICAL AT EVERY BAR of the
 *                   column, including at bars that closed before the build ran.
 *  unknown        — a leaf, or the tree's own shape, is something this reader
 *                   cannot resolve. FAIL-CLOSED = the STALEST claim. */
export const FRESHNESS_MODES = Object.freeze(['live', 'as-of-snapshot', 'unknown'])

const [LIVE, AS_OF_SNAPSHOT, UNKNOWN] = FRESHNESS_MODES

/** ⛔ DERIVED FROM `parse.js`, NEVER RETYPED. This was a hand copy of the four,
 *  and a hand copy of a vocabulary is the defect this repo has paid for most
 *  often: when the bounded backward offset landed as a fifth node type, this
 *  list would have branded every formula containing `close[1]` **unknown** —
 *  fail-closed, so nothing would go red, and the badge would just quietly stop
 *  telling the truth about the freshest formula a user can write.
 *
 *  ⚠️ THE OFFSET ADDS NO FRESHNESS VOCABULARY OF ITS OWN, and that is the whole
 *  of what this module has to say about it. A scalar still rides the `series`
 *  node (`closedTable.json::_scalars_node`) and `walk` already descends `args`,
 *  so `market_cap[1]` reaches `scalarsIn` exactly as `market_cap` does — an
 *  offset over a snapshot is still a snapshot. */
const CANONICAL_TYPES = NODE_TYPES

const own = (obj, name) => Object.prototype.hasOwnProperty.call(obj, name)

/** Every node, ITERATIVELY — the escape corpus carries an 8,001-node tree and a
 *  reader that dies inside itself has no verdict to give. */
function walk(tree) {
  const order = []
  const stack = [tree]
  while (stack.length) {
    const node = stack.pop()
    order.push(node)
    if (node && typeof node === 'object' && Array.isArray(node.args)) {
      for (const child of node.args) stack.push(child)
    }
  }
  return order
}

function sections(opts) {
  const table = (opts && opts.table) || TABLE
  return {
    seriesNames: (table && table.series) || {},
    functions: (table && table.functions) || {},
    // ⭐ THE CLOCK (tableVersion 2). It is READ HERE so a clock leaf is a
    // resolvable name rather than falling through to `unreadable` — which,
    // because this module fails closed, would have branded every formula
    // containing `hour` **unknown** the day the section landed, quietly.
    clock: (table && table.clock) || {},
    scalars: (table && table.scalars) || {},
    inputs: (opts && opts.inputs) || {},
  }
}

/** The TABLE-DECLARED SCALARS this tree names.
 *
 *  ⛔ DERIVED FROM THE MANIFEST, NEVER FROM A LIST OF WHICH NAMES LOOK
 *  FUNDAMENTAL. A hand-list is the shape that rots the day the screener grows a
 *  column, and the partition rail exists precisely so that day is loud. */
export function scalarsIn(tree, opts) {
  const { scalars } = sections(opts)
  const found = new Set()
  for (const node of walk(tree)) {
    if (node && typeof node === 'object' && node.type === 'series'
        && typeof node.name === 'string' && own(scalars, node.name)) {
      found.add(node.name)
    }
  }
  return found
}

/** ⛔ BOTH HALVES OR NEITHER. `as_of.column` is what dates the value PER SYMBOL
 *  and `cadence` is what the badge is a claim about; a declaration missing
 *  either is one this module cannot stand behind, and standing behind it anyway
 *  is how `unknown` stops being reachable. */
function declarationIsReadable(decl) {
  if (!decl || typeof decl !== 'object') return false
  const asOf = decl.as_of
  return !!(asOf && typeof asOf === 'object'
    && typeof asOf.column === 'string' && asOf.column
    && typeof decl.cadence === 'string' && decl.cadence)
}

/** `{mode, scalars, cadences, reasons}` for a canonical tree.
 *
 *  `opts.table` is the manifest (defaults to the shipped one). `opts.inputs` is
 *  the DEFINITION's declared inputs, by name — the same shape `lint.js` and
 *  `interpret` take. A per-instance knob is dated by nothing and therefore
 *  neither makes a formula stale nor unreadable.
 *
 *  ⛔ IT DOES NOT RE-CHECK OPERATOR OR FUNCTION NAMES. `interpret` refuses an
 *  undeclared one at `resolve:function` and `checkBudget` resolves every call on
 *  its way to a lookback, so a tree carrying one never reaches a badge.
 *  Re-deciding it here would be a second declaration of one refusal, which is
 *  the wrong-door defect this branch has found four separate times. */
export function freshnessFor(tree, opts) {
  const { seriesNames, functions, clock, scalars, inputs } = sections(opts)
  let reasons = []
  const found = new Set()
  const cadences = new Set()
  let unreadable = false

  for (const node of walk(tree)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      unreadable = true
      reasons.push('unreadable: a node that is not an object')
      continue
    }
    if (!CANONICAL_TYPES.includes(node.type)) {
      unreadable = true
      reasons.push(
        `unreadable: node type ${JSON.stringify(node.type)} is not one of ${CANONICAL_TYPES.join(', ')}`)
      continue
    }
    if ((node.type === 'op' || node.type === 'call') && !Array.isArray(node.args)) {
      unreadable = true
      reasons.push(`unreadable: a ${node.type} node carries an \`args\` array`)
      continue
    }
    // ⭐⭐ A FUNCTION MAY DECLARE A CADENCE TOO, AND THIS IS WHERE IT IS READ.
    // Every entry in this table is computed from the BARS, so the ordinary case
    // is an entry with no `cadence` at all and nothing to say. `vwap`/`avwap`
    // declare `cadence: 'live'` because the cross-lane contract fixes the field
    // on functions, and a declared field nothing reads is an INERT KNOB — this
    // lane has already shipped two of those this wave.
    //
    // ⛔ SO THE CLAIM IS CHECKED RATHER THAN DECORATIVE: `live` adds no ceiling
    // (it says "this reads the bar it draws on", which is what the scalar branch
    // below denies), any OTHER cadence makes the whole tree `as-of-snapshot`
    // exactly as a scalar leaf does, and a cadence that is not a usable string is
    // `unknown` — fail-closed, the stalest answer, never a quiet `live`.
    if (node.type === 'call' && typeof node.name === 'string'
        && own(functions, node.name)
        && own(functions[node.name] || {}, 'cadence')) {
      const cadence = functions[node.name].cadence
      if (typeof cadence !== 'string' || !cadence) {
        unreadable = true
        reasons.push(
          `unreadable: the function \`${node.name}\` declares a cadence this reader cannot resolve`)
      } else if (cadence !== LIVE) {
        cadences.add(cadence)
        found.add(node.name)
        reasons.push(
          `\`${node.name}\` is rebuilt ${cadence} -- it is not read from the bar it draws on`)
      } else {
        reasons.push(`\`${node.name}\` reads the bar it draws on`)
      }
      continue
    }
    if (node.type !== 'series') continue
    const name = node.name
    if (typeof name === 'string' && own(seriesNames, name)) continue
    // ⭐ A CLOCK LEAF IS `live`, AND IT IS THE SAME `continue` A PRICE FIELD
    // GETS — not a widening of the scalar branch. `hour` is read off the bar
    // being drawn, exactly as `close` is: it carries no cadence, nothing dates
    // it, and it is a DIFFERENT number at every bar. The scalar branch below is
    // about a value that is identical at every bar and up to a day old; folding
    // the clock into it would brand every intraday session filter
    // `as-of-snapshot` and tell a member a live signal is stale.
    if (typeof name === 'string' && own(clock, name)) continue
    if (typeof name === 'string' && own(scalars, name)) {
      const decl = scalars[name]
      if (!declarationIsReadable(decl)) {
        unreadable = true
        reasons.push(
          `unreadable: the scalar \`${name}\` declares a cadence or an as-of column this reader cannot resolve`)
        continue
      }
      found.add(name)
      cadences.add(decl.cadence)
      reasons.push(
        `\`${name}\` is a per-symbol value dated by \`${decl.as_of.column}\`, rebuilt ${decl.cadence} `
        + '-- it is the same number at every bar of the column')
      continue
    }
    if (typeof name === 'string' && own(inputs, name)) continue
    unreadable = true
    reasons.push(
      `unreadable: \`${name}\` is neither a series nor a scalar this table declares, and this `
      + `definition declares ${Object.keys(inputs).sort().join(', ') || 'no inputs'}`)
  }

  let mode
  if (unreadable) {
    mode = UNKNOWN
  } else if (found.size) {
    mode = AS_OF_SNAPSHOT
  } else {
    mode = LIVE
    reasons = ['every value this formula reads comes from the bar it draws on']
  }

  return {
    mode,
    scalars: [...found].sort(),
    cadences: [...cadences].sort(),
    reasons,
  }
}
