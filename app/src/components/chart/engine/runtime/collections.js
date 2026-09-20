// app/src/components/chart/engine/runtime/collections.js
//
// ─── TYPED ARRAYS, THE THING A WATCHLIST BECOMES ────────────────────────────
//
// ⛔⛔ AN ARRAY IS A REFERENCE, AND A SLOT HOLDS THE ARRAY ITSELF. Pine's arrays
// are reference types: `b = a` makes `b` another name for the same collection,
// and only `array.copy` makes a second one. Boxing the slots (the value model
// change this wave is built on) is what lets that be expressed directly — a
// plain JS array in the slot aliases on assignment exactly as Pine does, with
// no handle table to keep in step. `arrays.test.js` pins BOTH halves, because
// an implementation that copied on assignment would pass every single-array
// case and be wrong about the language.
//
// ⛔⛔ AN OUT-OF-RANGE READ IS AN ERROR, NOT `na`. TradingView stops the script;
// a runtime that answered `na` would draw a dashboard with blank cells, and a
// member reads a blank cell as "no data for this symbol" and trusts it. That is
// a wrong answer wearing the costume of a fact, which is the one trade this
// runtime does not make for coverage.
//
// ⭐ THE ROSTER IS MEASURED, NOT GUESSED. Counted across both acceptance
// scripts: `array.get` 25, `array.size` 7, `array.new` 7, `array.push` 6,
// `array.set` 5, `array.copy` 1 — and nothing else, no `matrix.*`, no `map.*`.
// `array.from` is the one addition, because it makes a fixture readable in one
// line; it appears in neither script.

import { RuntimeLimitError } from './limits.js'

export class CollectionError extends Error {
  constructor(message) { super(message); this.name = 'CollectionError' }
}

/** What kind is this runtime value? The VM checks declared operand kinds
 *  against this, so 'array' is a real kind rather than `typeof v === 'object'`
 *  spread across nine call sites. */
export const kindOf = (v) => {
  if (Array.isArray(v)) return 'array'
  const t = typeof v
  return t === 'number' || t === 'string' ? t : 'other'
}

/** ⛔ BOUNDS ARE CHECKED IN ONE PLACE, and the message names the index AND the
 *  size — "index out of range" sends a member hunting through a watchlist. */
const at = (arr, i, what) => {
  if (!Number.isInteger(i) || i < 0 || i >= arr.length) {
    throw new CollectionError(
      `${what}: index ${i} is outside an array of ${arr.length} — `
      + 'Pine stops the script here rather than answering na')
  }
  return i
}

/** The per-element default for `array.new<T>(size)` with no initial value.
 *
 *  ⛔⛔ ONLY `float` AND `int` ARE SERVED, AND THAT IS A MEASUREMENT BOUNDARY
 *  RATHER THAN AN OVERSIGHT. Pine documents the omitted initial value as `na`
 *  for the numeric types; what it fills a `bool` or a `string` array with is
 *  NOT something this engine has measured on a chart, and a guess there is a
 *  wrong value in a member's table with nothing to catch it. The acceptance
 *  scripts use the sized form only with `<int>`, so nothing is blocked by
 *  refusing the other two until somebody measures them. */
const DEFAULT_FOR = Object.freeze({ float: NaN, int: NaN })

const filled = (n, value) => {
  const out = new Array(n)
  for (let i = 0; i < n; i += 1) out[i] = value
  return out
}

/**
 * @typedef {object} ArrayFn
 * @property {string[]} args       operand kinds ('array' | 'number' | 'string' | 'any')
 * @property {'array'|'number'|'any'|'void'} returns
 * @property {boolean} [variadic]  `args` describes a repeating element kind
 * @property {boolean} [generic]   takes a `<T>` type argument
 * @property {Function} fn         (args, budget, typeArg) — kinds already checked
 */

/** @type {Readonly<Record<string, ArrayFn>>} */
const ARRAY_NEW = {
  // ⭐ `array.new<T>(size?, initial?)` — the spelling both acceptance scripts
  // actually use. Zero arguments is by far the commonest and needs no default
  // at all, which is why the unmeasured bool/string default blocks nothing.
  // ⛔ THE KINDS ARE DECLARED EVEN THOUGH THE ARITY VARIES. An empty `args`
  // left the VM asking for kind `undefined` and refusing a correct call —
  // `argKind` has to have something to answer with for every position the
  // arity allows.
  args: ['number', 'any'], returns: 'array', generic: true, minArgs: 0, maxArgs: 2,
  fn: (a, budget, typeArg) => {
    if (a.length === 0) return []
    const n = a[0]
    if (!Number.isInteger(n) || n < 0) {
      throw new CollectionError(`array.new: a size is a whole number of elements, got ${n}`)
    }
    budget.peak('ARRAY_ELEMENTS', n)
    if (a.length === 2) return filled(n, a[1])
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_FOR, typeArg)) {
      throw new CollectionError(
        `array.new<${typeArg || '?'}>(${n}) with no initial value — what Pine fills a `
        + `\`${typeArg || 'that'}\` array with has not been measured on a chart, and this `
        + 'engine does not guess a value a member would read as data')
    }
    return filled(n, DEFAULT_FOR[typeArg])
  },
}

/** ⭐⭐ `array.new_float(…)` IS `array.new<float>(…)` WITH THE TYPE IN THE NAME.
 *
 *  Pine spells the same constructor two ways and real scripts overwhelmingly
 *  choose the typed one: measured across the 266-script corpus, `array.new_float`
 *  alone is the first blocker for **14** scripts, against 7 uses of the generic
 *  spelling in the census that shaped this table.
 *
 *  ⛔⛔ THEY DELEGATE TO ONE IMPLEMENTATION AND DO NOT COPY IT. A second body
 *  would drift from the generic one — and the half that drifted would be the
 *  typed half, which is the half members actually write. The alias binds the
 *  type and forwards; everything else (arity, budget, the unmeasured-default
 *  refusal) is the SAME code, so a fix to either reaches both.
 *
 *  ⚠ `bool` AND `string` ARE LISTED HERE AND STILL REFUSE A MISSING INITIAL
 *  VALUE, because `DEFAULT_FOR` does not carry them — what Pine fills those with
 *  has not been measured on a chart. Listing them is not serving them: it moves
 *  the refusal from *"this engine has no such function"* to the accurate
 *  *"what Pine fills a bool array with has not been measured"*, which is a
 *  different sentence and the true one.
 */
const TYPED_NEW = Object.freeze(['float', 'int', 'bool', 'string', 'color'])

const typedNew = (typeArg) => ({
  ...ARRAY_NEW,
  generic: false,
  fn: (a, budget) => ARRAY_NEW.fn(a, budget, typeArg),
})

export const ARRAY_FNS = Object.freeze({
  'array.new': ARRAY_NEW,
  ...Object.fromEntries(TYPED_NEW.map((ty) => [`array.new_${ty}`, typedNew(ty)])),
  'array.from': {
    args: ['any'], returns: 'array', variadic: true, minArgs: 0, maxArgs: Infinity,
    fn: (a, budget) => { budget.peak('ARRAY_ELEMENTS', a.length); return a.slice() },
  },
  // ⭐⭐ `str.split` LIVES WITH THE COLLECTIONS, NOT WITH THE TEXT BUILTINS, and
  // the reason is the route decision rather than tidiness: what a call RETURNS
  // is what decides which lane can hold it, and this one returns an array. It
  // is the bridge a pasted watchlist crosses — text in, collection out.
  //
  // ⛔⛔ AN EMPTY INPUT YIELDS ONE EMPTY ELEMENT, NOT AN EMPTY ARRAY. That is
  // Pine's documented behaviour and it is why both acceptance scripts skip
  // empty tokens after splitting. JavaScript's `String.prototype.split` agrees
  // by contract ("".split(",") is [""]), so this is a case to PIN rather than
  // to implement — and pinning it matters because a runtime that answered "an
  // empty array" would make the scripts' skip step look redundant, while a list
  // pasted with a trailing newline quietly gained a phantom symbol.
  //
  // ⛔ THE SEPARATOR IS LITERAL. A string argument to `split` is not a regex,
  // which is the same reason `str.replace_all` uses `replaceAll`: a member's
  // `BRK.B` must split on the dot, not on every character.
  'str.split': {
    args: ['string', 'string'], returns: 'array',
    fn: (a, budget) => {
      const parts = a[0].split(a[1])
      budget.peak('ARRAY_ELEMENTS', parts.length)
      return parts
    },
  },
  'array.size': { args: ['array'], returns: 'number', fn: (a) => a[0].length },
  'array.get': {
    args: ['array', 'number'], returns: 'any',
    fn: (a) => a[0][at(a[0], a[1], 'array.get')],
  },
  'array.set': {
    args: ['array', 'number', 'any'], returns: 'void',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', 1)
      a[0][at(a[0], a[1], 'array.set')] = a[2]
    },
  },
  'array.push': {
    args: ['array', 'any'], returns: 'void',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', 1)
      budget.peak('ARRAY_ELEMENTS', a[0].length + 1)
      a[0].push(a[1])
    },
  },
  'array.copy': {
    args: ['array'], returns: 'array',
    fn: (a, budget) => { budget.peak('ARRAY_ELEMENTS', a[0].length); return a[0].slice() },
  },
  'array.clear': {
    args: ['array'], returns: 'void',
    fn: (a, budget) => { budget.charge('ARRAY_OPERATIONS', 1); a[0].length = 0 },
  },
})

export const ARRAY_NAMES = Object.freeze(Object.keys(ARRAY_FNS))

/** Does this call return a collection? The front end's route decision needs it
 *  for the same reason `producesText` exists: a value the columnar lane cannot
 *  hold must not be sent there. */
export const producesArray = (name) => (
  Object.prototype.hasOwnProperty.call(ARRAY_FNS, name) && ARRAY_FNS[name].returns === 'array')

/** Does this call return nothing? A void call is a STATEMENT, and using one as
 *  a value is refused rather than silently yielding `na`. */
export const isVoid = (name) => (
  Object.prototype.hasOwnProperty.call(ARRAY_FNS, name) && ARRAY_FNS[name].returns === 'void')

/** The declared operand kind for argument `i` — variadic entries repeat their
 *  single declared kind. */
export const argKind = (spec, i) => (spec.variadic ? spec.args[0] : spec.args[i])

export { RuntimeLimitError }
