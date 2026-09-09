// app/src/components/chart/engine/ast/bind.js
//
// ─── THE BIND-TIME FOLD — a length is a whole number *FOR A BINDING* ─────────
//
// ⛔⛔ THE MIRROR OF `api/services/ast_bind.py`, AND IT IS A MIRROR IN THE STRICT
// SENSE: same inputs, same four refusal shapes, same reason STRINGS. A member
// who pastes a script into the builder and a sweep that evaluates the saved
// definition must be told the same sentence about the same length, or the two
// lanes are two products. `tests/test_ast_bind_parity.py` runs both over the same
// trees and compares the folded literals AND the refusal text.
//
// The full argument lives in the Python module's docstring and in
// `closedTable.json::_bind_time_constants`; it is not repeated here, because two
// copies of an argument drift and this repo has paid for that more than once.
// What is repeated is only what a reader of THIS file needs:
//
//   * `interpret.js::windowLiteral` requires a `num` node and stays that way —
//     `maxLookback` is a TREE SUM and the repaint linter depends on it. This pass
//     rewrites the tree so the check sees the literal it always required.
//   * It never partially folds: an expression resolves wholly to a number, or is
//     left exactly as it was for the window check to refuse BY NAME.
//   * It never mutates: the next symbol folds the same saved tree differently,
//     and a rewrite in place would give it the previous symbol's lengths.

import { TABLE, TableRefusal } from './parse.js'
// ⛔ `REFUSALS` COMES FROM `interpret.js`, NOT `parse.js`, AND THE DISTINCTION IS
// REAL: `resolve:window` is an INTERPRETER guard and only that table declares its
// sentence. Reading a guard's prefix from the wrong table yields `undefined` and
// ships a refusal reading "undefined — sma argument 1 folded to 12.5", which is
// exactly what the first cut of this file did.
import { REFUSALS } from './interpret.js'

/** ⛔ THE REFUSAL IS BUILT THE WAY `interpret.js` BUILDS ITS OWN — guard prefix
 *  from `REFUSALS`, then the detail — so a surface branching on `.guard` sees the
 *  same door whether the length was hand-typed or folded, and the Python twin's
 *  `_refuse` produces the identical sentence. */
const refuse = (guard, detail) => {
  throw new TableRefusal(guard, `${REFUSALS[guard]} ${detail}`)
}

/** The clock names constant for one binding — READ OFF THE MANIFEST.
 *
 *  ⛔ `dayofweek` and `isdaily` are the same KIND of manifest entry and opposite
 *  kinds of value; only the sentence each carries says so. The manifest declares
 *  the split and a rail checks it against those sentences in both lanes. */
export const BIND_TIME_CLOCK = Object.freeze(
  ((TABLE._bind_time_constants || {}).clock) || [],
)

/** Scalar functions the fold may evaluate. ⛔ CLOSED AND SMALL, and identical to
 *  the Python lane's `_FOLD_CALLS` — a name in one and not the other is a script
 *  that folds on the pane and refuses in the sweep. */
const FOLD_CALLS = {
  abs: (a) => Math.abs(a),
  round: (a) => Math.round(a),
  max: (a, b) => Math.max(a, b),
  min: (a, b) => Math.min(a, b),
  sqrt: (a) => (a >= 0 ? Math.sqrt(a) : NaN),
  pow: (a, b) => a ** b,
}

const BINARY = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => (b ? a / b : NaN),
  '>': (a, b) => Number(a > b),
  '<': (a, b) => Number(a < b),
  '>=': (a, b) => Number(a >= b),
  '<=': (a, b) => Number(a <= b),
  '==': (a, b) => Number(a === b),
  '!=': (a, b) => Number(a !== b),
  '&&': (a, b) => Number(Boolean(a) && Boolean(b)),
  '||': (a, b) => Number(Boolean(a) || Boolean(b)),
}

/** Thrown carrying the OPERAND that stopped the fold, never a generic message. */
export class NotFoldable extends Error {
  constructor(what) {
    super(what)
    this.what = what
  }
}

/** The `name -> value` map ONE binding makes constant.
 *
 *  ⛔ THE ASSEMBLY RULE LIVES HERE AND IN THE PYTHON TWIN, NOWHERE ELSE. A caller
 *  building this itself would be a second authority over *what is constant for a
 *  binding* — the one question the whole fold rests on.
 *
 *  ⚠️ `symbol` IS ACCEPTED AND CONTRIBUTES NOTHING YET; `syminfo.*` resolves from
 *  our own store and only the fields it can populate may ship. Until then a
 *  window mentioning `syminfo.*` does not fold and refuses naming the operand,
 *  which is the correct answer rather than a placeholder. */
export function bindingConstants({ timeframe, inputs, symbol } = {}) {
  const out = {}
  for (const name of BIND_TIME_CLOCK) {
    if (timeframe && Object.prototype.hasOwnProperty.call(timeframe, name)) {
      out[name] = timeframe[name] ? 1 : 0
    }
  }
  for (const [name, value] of Object.entries(inputs || {})) {
    if (typeof value === 'number' && Number.isFinite(value)) out[String(name)] = value
  }
  return out
}

/** One expression → a number, or `NotFoldable` naming what stopped it. */
export function foldScalar(node, consts) {
  if (!node || typeof node !== 'object') throw new NotFoldable(String(node))
  const kind = node.type

  if (kind === 'num') return Number(node.value)

  if (kind === 'series') {
    if (Object.prototype.hasOwnProperty.call(consts, node.name)) return Number(consts[node.name])
    throw new NotFoldable(String(node.name))
  }

  if (kind === 'op') {
    const vals = (node.args || []).map((a) => foldScalar(a, consts))
    // ⛔ BOTH ARMS FOLD BEFORE THE SELECTOR IS READ — otherwise the same saved
    // definition folds on one binding and refuses on the next, which is a refusal
    // the member cannot reproduce.
    if (node.name === '?:' && vals.length === 3) return vals[0] ? vals[1] : vals[2]
    if (node.name === 'u-' && vals.length === 1) return -vals[0]
    if (node.name === '!' && vals.length === 1) return vals[0] ? 0 : 1
    if (BINARY[node.name] && vals.length === 2) return BINARY[node.name](vals[0], vals[1])
    throw new NotFoldable(`operator '${node.name}'`)
  }

  if (kind === 'call') {
    const fn = FOLD_CALLS[node.name]
    if (!fn) throw new NotFoldable(`${node.name}()`)
    return Number(fn(...(node.args || []).map((a) => foldScalar(a, consts))))
  }

  // `offset` (x[1]), `tf`, `sym`, `tf_live` all read bars or another request.
  throw new NotFoldable(`a '${kind}' node`)
}

/** Which argument positions of `name` the manifest declares `int`.
 *
 *  ⛔ READ OFF THE TABLE, so a new length-taking entry is covered the day it
 *  lands — the per-function work this pass exists to avoid. */
export function intSlots(name) {
  const spec = (TABLE.functions || {})[name]
  if (!spec || !Array.isArray(spec.args)) return []
  const out = []
  spec.args.forEach((kind, i) => { if (kind === 'int') out.push(i) })
  return out
}

/** A compact source rendering, for a refusal to QUOTE.
 *
 *  ⛔ "argument 1 folded to 2.5" AND STOP IS HALF A SENTENCE. The member wrote
 *  `lenDaily / 2`; 2.5 is our arithmetic, not their text, and a script with
 *  several lengths in it gives them nothing to search for. */
export function render(node) {
  if (!node || typeof node !== 'object') return String(node)
  if (node.type === 'num') {
    return Number.isInteger(Number(node.value)) ? String(Number(node.value)) : String(node.value)
  }
  if (node.type === 'series') return String(node.name)
  const args = (node.args || []).map(render)
  if (node.type === 'op') {
    if (node.name === '?:' && args.length === 3) return `${args[0]} ? ${args[1]} : ${args[2]}`
    if (node.name === 'u-' && args.length === 1) return `-${args[0]}`
    if (node.name === '!' && args.length === 1) return `not ${args[0]}`
    if (args.length === 2) return `${args[0]} ${node.name} ${args[1]}`
  }
  return `${node.name}(${args.join(', ')})`
}

function assertUsableWindow(fnName, index, value, source) {
  if (!Number.isFinite(value)) {
    refuse('resolve:window',
      `— ${fnName} argument ${index} folded to a non-finite value for this `
      + `binding, from \`${source}\`; a length must be a whole number of at least 1`)
  }
  if (!Number.isInteger(value) || value < 1) {
    refuse('resolve:window',
      `— ${fnName} argument ${index} folded to ${value} for this binding, from `
      + `\`${source}\`; a length must be a whole number of at least 1`)
  }
}

/** The tree with every foldable INT-slot argument replaced by its literal.
 *
 *  ⭐ RETURNS A NEW TREE AND MUTATES NOTHING. The saved definition must go on
 *  meaning what it said, because the NEXT symbol folds it differently — a pass
 *  that rewrote in place would let the second symbol of a sweep inherit the
 *  first's lengths, and that defect shows as a WRONG NUMBER, not an error. */
export function foldBound(ast, consts = {}) {
  const walk = (node) => {
    if (!node || typeof node !== 'object' || !Array.isArray(node.args)) return node
    const slots = node.type === 'call' ? intSlots(node.name) : []
    const args = node.args.map((arg, i) => {
      if (slots.includes(i) && arg && typeof arg === 'object' && arg.type !== 'num') {
        let value
        try {
          value = foldScalar(arg, consts)
        } catch (err) {
          if (err instanceof NotFoldable) return walk(arg)   // the check names it
          throw err
        }
        assertUsableWindow(node.name, i, value, render(arg))
        return { type: 'num', value }
      }
      return walk(arg)
    })
    return { ...node, args }
  }
  return walk(ast)
}
