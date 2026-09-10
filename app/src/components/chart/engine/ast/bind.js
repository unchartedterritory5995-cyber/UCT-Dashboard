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

// ⭐ THE SYMBOL-SCOPED VOCABULARY AS DATA. Everything in it is a fact about the
// outside world — our store's exchange spellings on one side, TradingView's on
// the other — so it is edited without reading code, and the capture that turns
// `syminfo.prefix` on is a data change rather than a deploy of new logic.
import SYMBOL_SCOPE from './symbolScope.json'

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

/** The arithmetic of the text predicates, in ONE place for this lane.
 *
 *  ⛔ `pine.js` IMPORTS THIS RATHER THAN KEEPING A COPY. The translator folds a
 *  predicate over two LITERALS at translate time and the fold settles the same
 *  predicate over a symbol at bind time — same question, two moments — and two
 *  copies of "does an empty needle match" is the second-authority defect this
 *  repo keeps paying for. `api/services/ast_bind.py` holds the Python mirror,
 *  and `bind_fold_parity.json` pins both against one artifact.
 *
 *  ⭐ PINE'S SEMANTICS, NOT JAVASCRIPT'S CONVENIENCE: `str.contains` is
 *  case-SENSITIVE and substring-based, and an empty needle is contained by every
 *  string — which is true in Python and JavaScript alike, so the mirror is exact
 *  rather than merely close. */
export const TEXT_PREDICATE_FN = Object.freeze({
  contains: (a, b) => (String(a).includes(String(b)) ? 1 : 0),
  startswith: (a, b) => (String(a).startsWith(String(b)) ? 1 : 0),
  endswith: (a, b) => (String(a).endsWith(String(b)) ? 1 : 0),
  length: (a) => String(a).length,
  eq: (a, b) => (String(a) === String(b) ? 1 : 0),
  ne: (a, b) => (String(a) === String(b) ? 0 : 1),
})

/** The exchange spellings actually WITNESSED on a TradingView chart:
 *  `<our store's string>` → `<Pine's string>`.
 *
 *  ⛔⛔ THIS IS THE SERVING PATH AND IT READS `confirmed` ONLY.
 *  `symbolScope.json::store_to_pine` beside it is a PROPOSAL — written down so
 *  the probe knows what to check and so a reviewer can disagree with a specific
 *  line — and reading it here would turn eleven guesses into eleven shipped
 *  answers in a single edit. An entry counts only if it carries a `witness`: an
 *  entry without one is an assertion wearing a data structure. */
export const SYMBOL_EXCHANGE_CONFIRMED = Object.freeze(Object.fromEntries(
  Object.entries((SYMBOL_SCOPE && SYMBOL_SCOPE.confirmed) || {})
    .filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object'
      && typeof v.pine === 'string' && typeof v.witness === 'string')
    .map(([k, v]) => [k, String(v.pine)]),
))

/** The reason the fold quotes when a symbol-scoped field cannot be resolved for
 *  THIS binding — read off the manifest so the sentence has one owner. */
const PENDING = Object.freeze((SYMBOL_SCOPE && SYMBOL_SCOPE.pending_measurement) || {})

/** What ONE symbol makes constant: `syminfo.*`, and nothing else.
 *
 *  ⭐⭐ `ticker` ALWAYS, THE OTHER TWO ONLY ON A WITNESSED EXCHANGE. The plain
 *  symbol is the string our own store is keyed by, so there is no vendor question
 *  in it. `tickerid` and `exchange` are TradingView strings a member compares with
 *  `==` and `str.contains`, where a plausible-but-unmeasured spelling does not
 *  degrade the answer — it INVERTS it. So they resolve for a symbol whose exchange
 *  has a capture and refuse, by name and with the reason, for one that does not.
 *
 *  ⛔ THE GATE IS HERE AND NOT AT THE DOOR because confirmation is a property of
 *  THE SYMBOL'S EXCHANGE. A door runs once per script and cannot answer a question
 *  whose answer is "it depends which symbol".
 *
 *  ⚠️ `tickerid` IS ASSEMBLED, NOT STORED: Pine's is `EXCHANGE:SYMBOL`, so it is
 *  exactly as measured as the exchange half and is gated on the same witness. */
export function symbolConstantsWith(confirmed, symbol) {
  const out = {}
  if (!symbol || typeof symbol !== 'object') return out
  const ticker = typeof symbol.ticker === 'string' ? symbol.ticker.trim() : ''
  if (!ticker) return out
  out['syminfo.ticker'] = ticker
  const stored = typeof symbol.exchange === 'string' ? symbol.exchange.trim() : ''
  if (stored && confirmed && Object.prototype.hasOwnProperty.call(confirmed, stored)) {
    const pine = confirmed[stored]
    out['syminfo.prefix'] = pine
    out['syminfo.tickerid'] = `${pine}:${ticker}`
  }
  return out
}

/** ⭐⭐ THE WITNESS MAP IS A PARAMETER, AND THE PRODUCTION CALL IS THE
 *  ONE-LINE SPECIALISATION. `confirmed` is empty today, so every path that reads
 *  an exchange is DARK — and a rail that could only drive the dark path would be
 *  proving the refusal works while proving nothing about the answer. Handing the
 *  map in lets a test drive the SERVING path with a synthetic witness, so "these
 *  fields refuse" is a statement about the DATA rather than about a code path
 *  nobody has ever seen run (`lesson_built_tested_green_and_unreachable`). */
export const symbolConstants = (symbol) =>
  symbolConstantsWith(SYMBOL_EXCHANGE_CONFIRMED, symbol)

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
 *  ⚰️ `symbol` USED TO BE ACCEPTED AND CONTRIBUTE NOTHING. It now contributes
 *  `syminfo.*` through `symbolConstants` — see there for why `ticker` resolves
 *  for every symbol while `tickerid` and `exchange` wait on a witnessed exchange
 *  spelling. The old note said only the fields our store can populate may ship,
 *  and that is still the rule; what changed is that one of them can. */
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
  // ⭐ TEXT AND NUMBERS SHARE ONE MAP, and each reader checks the type it needs:
  // `foldScalar` accepts only a finite number, `foldText` only a string. A single
  // map keeps "what is constant for this binding" a single question with a single
  // answer, which is the whole reason `bindingConstants` exists rather than each
  // caller assembling its own.
  Object.assign(out, symbolConstants(symbol))
  return out
}

/** One TEXT expression → a string, or `NotFoldable` naming what stopped it.
 *
 *  ⛔⛔ TEXT LIVES ONLY INSIDE THIS PASS. Nothing here returns a string to a
 *  caller that could put it in a tree: `foldScalar` consumes these through
 *  `TEXT_PREDICATE_FN` and hands back a NUMBER. That containment is the whole
 *  reason the closed table can gain `str.contains` without gaining a second
 *  value system in every walk that prices, lints and evaluates a tree.
 *
 *  ⭐ AND THE REFUSAL NAMES THE FIELD, NOT THE NODE KIND. A binding whose
 *  exchange has no witness stops on `syminfo.prefix` with the measurement
 *  reason the manifest carries — a member reading "the engine grammar does not
 *  hold this" would rewrite a script that will work unchanged the day a capture
 *  lands. */
export function foldText(node, consts) {
  if (!node || typeof node !== 'object') throw new NotFoldable(String(node))
  if (node.type === 'str') return String(node.value)
  if (node.type === 'symtext') {
    const key = `syminfo.${node.name}`
    const have = Object.prototype.hasOwnProperty.call(consts, key) ? consts[key] : undefined
    if (typeof have === 'string' && have !== '') return have
    const why = PENDING[node.name]
    throw new NotFoldable(why ? `${key} — ${why}` : key)
  }
  throw new NotFoldable(`a '${node.type}' node where text was needed`)
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

  // ⭐ A TEXT QUESTION WITH A NUMERIC ANSWER. `str.contains(syminfo.ticker, "/")`
  // is 1 or 0 for a binding, and after this line nothing textual remains in the
  // tree — which is what lets a window length, a screener column and the repaint
  // linter all go on seeing only numbers.
  if (kind === 'textop') {
    const fn = TEXT_PREDICATE_FN[node.name]
    if (!fn) throw new NotFoldable(`text predicate '${node.name}'`)
    return Number(fn(...(node.args || []).map((a) => foldText(a, consts))))
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

/** ⭐⭐⭐ WILL THIS LENGTH FOLD AT BIND TIME? THE ONE PREDICATE BOTH DOORS ASK.
 *
 *  ⛔⛔ IT EXISTS BECAUSE THE QUESTION WAS BEING ANSWERED TWICE, IN TWO PLACES,
 *  AND THE TWO ANSWERS DISAGREED. `translatePine` folds a window with
 *  `constantValueOf` at SAVE time and refuses `pine:window` when the result is
 *  not a literal; `foldScalar` folds the same node at BIND time with the clock
 *  and the inputs in hand. `ta.sma(v, timeframe.isweekly ? 5 : 20)` — Uncharted
 *  Volume line 233 — is refused by the first and folds cleanly under the second,
 *  so the door was rejecting a script the engine could already run. The disagreement
 *  was not a bug in either function: they were asking different questions and
 *  nothing named the difference.
 *
 *  ⭐ SO THE DOOR ASKS THIS BEFORE REFUSING. If a length is bind-foldable the
 *  door lets it through unfolded and the bind stage settles it per binding; if it
 *  is not, the door refuses exactly as it always did.
 *
 *  ⛔⛔ IT IS DERIVED FROM THE FOLD'S OWN TABLES, NEVER TYPED BESIDE THEM.
 *  `BIND_TIME_CLOCK`, `FOLD_CALLS` and `BINARY` are the same objects `foldScalar`
 *  dispatches on, and the arities below mirror its branches one for one. A name
 *  added to any of those is covered here the day it lands — which is the whole
 *  point, because a predicate that listed the names itself would be a THIRD
 *  authority over "what folds" and would drift from the fold on the first edit.
 *  `bindFoldableAgreement.test.js` holds the two to each other on a corpus.
 *
 *  ⚠️ IT IS DELIBERATELY CONSERVATIVE ABOUT TEXT. `str.length(syminfo.prefix)` CAN
 *  fold for a witnessed symbol, but whether it does is a property of THE SYMBOL
 *  rather than of the tree, so it is not knowable here and this answers `false`.
 *  Those keep the door they already had. ⛔ THE CONTRACT IS ONE-DIRECTIONAL AND
 *  THAT DIRECTION MATTERS: `true` must mean "folds for EVERY binding that supplies
 *  the clock and the inputs", because the door stops refusing on the strength of
 *  it. `false` merely means "this pass will not promise", which costs a refusal
 *  that was already being made and can never cost a wrong number. */
export function isBindFoldableLength(node) {
  if (!node || typeof node !== 'object') return false
  const kind = node.type

  if (kind === 'num') return Number.isFinite(Number(node.value))

  // ⭐ A `series` NODE IS THE WHOLE QUESTION. `close` reads a bar and can never
  // fold; `isweekly` is the CHART's timeframe and `lenDaily` is an `input.*`
  // default — both fixed before a single bar is read.
  if (kind === 'series') {
    if (BIND_TIME_CLOCK.includes(node.name)) return true
    return typeof node.inputDefault === 'number' && Number.isFinite(node.inputDefault)
  }

  if (kind === 'op') {
    const args = node.args || []
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
    const arity = node.name === '?:' ? 3
      : (node.name === 'u-' || node.name === '!') ? 1
        : (has(BINARY, node.name) ? 2 : -1)
    if (arity < 0 || args.length !== arity) return false
    return args.every(isBindFoldableLength)
  }

  if (kind === 'call') {
    if (!Object.prototype.hasOwnProperty.call(FOLD_CALLS, node.name)) return false
    return (node.args || []).every(isBindFoldableLength)
  }

  // `offset` (x[1]), `tf`, `sym`, `tf_live`, `str`, `symtext`, `textop` — every
  // one reads a bar, another request, or a symbol this pass cannot see.
  return false
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
  if (node.type === 'str') return JSON.stringify(String(node.value))
  if (node.type === 'symtext') return `syminfo.${node.name}`
  if (node.type === 'textop') {
    const parts = (node.args || []).map(render)
    if (node.name === 'eq') return `${parts[0]} == ${parts[1]}`
    if (node.name === 'ne') return `${parts[0]} != ${parts[1]}`
    return `str.${node.name}(${parts.join(', ')})`
  }
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
    // ⭐⭐ A `textop` FOLDS WHEREVER IT SITS, not only in an int slot — and that
    // is not symmetry for its own sake. `Uncharted Volume` line 222 feeds its
    // answer to a BOOLEAN (`isRatioSymbol`), never to a window length, so a pass
    // that only rewrote lengths would leave the node in the tree and the
    // evaluator would refuse a definition that was perfectly decidable. Every
    // `textop` is bind-time by construction, so folding it everywhere is the
    // same claim the node type already makes.
    // ⛔ AND AN UNFOLDABLE ONE IS LEFT EXACTLY AS IT WAS, like every other
    // operand here: the check downstream then refuses the member's own
    // expression, naming the field that stopped it.
    if (node.type === 'textop') {
      try {
        return { type: 'num', value: foldScalar(node, consts) }
      } catch (err) {
        if (!(err instanceof NotFoldable)) throw err
        return node
      }
    }
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
