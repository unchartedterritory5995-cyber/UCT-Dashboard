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
import { isDrawingHandle } from './handles.js'
import { isUdtRecord } from './records.js'

export class CollectionError extends Error {
  constructor(message) { super(message); this.name = 'CollectionError' }
}

/** ⭐ C35 — THE SCRIPT'S OWN `runtime.error(message)`, REACHED.
 *
 *  TradingView stops the script where it is reached and shows the member the
 *  error instead of the indicator: nothing is plotted, nothing is drawn. So this
 *  stops the run BY NAME — `name` is Pine's own spelling, so a caller reading
 *  `runtime:${err.name}` (`runtimeColumns.js`) reports `runtime:runtime.error` —
 *  and carries the script's message. Never reached, it costs nothing and changes
 *  no value: a guard like `if barstate.isfirst and not (a < b)` that the member's
 *  inputs never satisfy is an ordinary, finished run. */
export class PineRuntimeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'runtime.error'
    this.guard = 'runtime:runtime.error'
  }
}

/** ⭐⭐ RT16 — the run-stop `time(<text>)` lowers to on a bar whose text names a
 *  timeframe the host lane refused (or one outside every value the script can
 *  write). A refusal-shaped error (`guard`), so `runtimeColumns.js` passes it to
 *  the member as the run's named answer, exactly as a VM limit's. */
export const CLOCK_UNSERVED_FN = '#time:unserved'
export const CLOCK_UNSERVED_GUARD = 'runtime:time-unserved'
export class ClockUnservedError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ClockUnservedError'
    this.guard = CLOCK_UNSERVED_GUARD
  }
}

/** What kind is this runtime value? The VM checks declared operand kinds
 *  against this, so 'array' is a real kind rather than `typeof v === 'object'`
 *  spread across nine call sites.
 *
 *  ⭐⭐ `'drawing'` IS A KIND OF ITS OWN, AND `'other'` WOULD NOT HAVE DONE.
 *  A drawing handle already answered `'other'` here by falling off the end, and
 *  every kind check would have refused it just the same — but the REFUSAL is
 *  what a member reads, and *"takes a number, got other"* names nothing they
 *  wrote. `handles.js` explains why a handle must never coerce; this is the
 *  sentence that says so when one lands where a number was declared. */
export const kindOf = (v) => {
  if (Array.isArray(v)) return 'array'
  if (isDrawingHandle(v)) return 'drawing'
  // ⭐⭐ A RECORD ANSWERS ITS OWN TYPE NAME, which is the same argument as
  // `'drawing'` one type further out. No declared operand kind in any of the
  // four tables is ever a user type name, so every kind check refuses a record
  // BY NAME — *"`array.push` argument 2 takes a number, got orderBlock"* names
  // the type on the member's own line, where `'other'` named nothing.
  // ⛔ `records.js` explains why this cannot widen by accident: the test is a
  // Symbol, not the shape of the object.
  if (isUdtRecord(v)) return v.type
  const t = typeof v
  return t === 'number' || t === 'string' ? t : 'other'
}

/** ⛔ BOUNDS ARE CHECKED IN ONE PLACE, and the message names the index AND the
 *  size — "index out of range" sends a member hunting through a watchlist.
 *
 *  ⭐ RT7 — IN A v6 SCRIPT A NEGATIVE INDEX COUNTS FROM THE END: measured,
 *  `vw-array-na-spy-1d-2026-10-02` N10 reads `array.get(array.from(3, na, 1, 2), -1)`
 *  as **2** on every bar, and N12's vote reads `array.get(outcome, -1)` (an
 *  `indexof` that found nothing) as the last outcome. ⛔ Only v6 is measured: a
 *  v5-or-older script, or a caller that does not say (`budget.pineVersion` unset),
 *  keeps the stop; and an index below `-size` stops in every version. */
const at = (arr, i, what, budget) => {
  if (Number.isInteger(i) && i < 0 && i >= -arr.length && budget && budget.pineVersion >= 6) {
    return arr.length + i
  }
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

/** ⛔⛔ THE FOUR DRAWING ELEMENT TYPES — `box`, `line`, `label`, `linefill`.
 *
 *  A Pine script that draws more than one of anything keeps its drawings in an
 *  array, and measured over the 266-script committed corpus that is the
 *  DOMINANT idiom, not a niche one: `array.new_line` 108 sites across 28
 *  scripts, `array.new_box` 83 across 27, `array.new_label` 46 across 18,
 *  `array.new_linefill` 1 across 1.
 *
 *  ⛔ THEY ARE NOT IN `DEFAULT_FOR`, AND THAT IS THE POINT. The value Pine
 *  fills an unsupplied element with is a NULL DRAWING HANDLE, and a drawing
 *  handle belongs to the object program — this lane has no value for one. The
 *  tempting answer is `na`, and it is the wrong one: it would make the standard
 *  emptiness test `na(array.get(zones, i))` read TRUE for a box the object
 *  program had already drawn, which is a confident wrong answer wearing the
 *  costume of a fact.
 *
 *  ⭐ Naming them here is what turns the refusal from the false *"the runtime
 *  has no collections yet"* into the true one, and it is the same move
 *  `bool`/`string` already make in `TYPED_NEW`. */
const DRAWING_TYPES = Object.freeze(['box', 'line', 'label', 'linefill'])

/** Why a sized `array.new<T>` with no initial value cannot be served.
 *
 *  ⛔ TWO SENTENCES, NOT ONE, BECAUSE THEY ARE TWO DIFFERENT FACTS. A `bool`
 *  array's fill is a value nobody has WATCHED Pine produce; a `box` array's
 *  fill is a value this lane STRUCTURALLY does not have. Collapsing them would
 *  send an engineer to take a vendor capture that cannot help. */
const noDefaultReason = (typeArg, n) => (
  DRAWING_TYPES.includes(typeArg)
    ? `array.new<${typeArg}>(${n}) with no initial value — Pine fills it with a null `
      + 'drawing handle, and a drawing handle belongs to the object program rather than '
      + `to this lane. Answering \`na\` would make \`na(array.get(…))\` read TRUE for a `
      + `${typeArg} that had already been drawn`
    : `array.new<${typeArg || '?'}>(${n}) with no initial value — what Pine fills a `
      + `\`${typeArg || 'that'}\` array with has not been measured on a chart, and this `
      + 'engine does not guess a value a member would read as data')

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

/** ⛔ AN EMPTY ARRAY HAS NO FIRST, LAST, OR POPPED ELEMENT — Pine stops the
 *  script ("the size of the array is 0") rather than answering `na`, for the
 *  same reason `at` does. */
const nonEmpty = (arr, what) => {
  if (!arr.length) {
    throw new CollectionError(`${what}: the array is empty — Pine stops the script here `
      + 'rather than answering na')
  }
  return arr
}

/** ⭐⭐ RT7 — A REDUCTION SKIPS ITS `na` ELEMENTS: MEASURED.
 *
 *  `vw-array-na-spy-1d-2026-10-02` (probe `vw-array-na.pine`, Q-C47-3) reads, on
 *  every bar, over `array.from(3, na, 1, 2)`: `array.min` 1 (N01), `array.max` 3
 *  (N02), `array.sum` 6 (N03), `array.avg` **2** (N04: the mean of the THREE real
 *  elements, not 6 / 4), and `array.min` of `(na, na)` **na** (N05). So Pine
 *  reduces over the real elements and skips the `na` ones.
 *
 *  ⭐ `array.min` / `array.max` over ZERO real elements answer `na`: N05 measures
 *  it for an all-`na` array, and an EMPTY array leaves the same zero real
 *  elements to reduce. That TradingView does not stop the script there is
 *  witnessed by `wyckoff-accumulation-distribution-rddt-1d-2026-10-02`: its
 *  `myhigh` / `mylow` push nothing while `boxlen` is still `na` (`for i = 0 to
 *  na`), call `array.max` / `array.min` of the empty array, and TradingView draws
 *  the script through those bars (Q-RT7a asks the empty case directly).
 *
 *  ⛔ `array.sum` / `array.avg` over ZERO real elements stay UNMEASURED (0, `na`,
 *  or a stop are all plausible, and no capture separates them): they stop the
 *  run by name, as before, unless a caller's probe answers (C18). A NON-numeric
 *  element (a string, a handle) is not a number to reduce and stops by name. */
const realsOf = (arr, what) => {
  const xs = []
  for (const v of arr) {
    if (typeof v !== 'number') {
      throw new CollectionError(`${what} over a non-numeric element — this runtime reduces `
        + 'numbers only')
    }
    if (!Number.isNaN(v)) xs.push(v)
  }
  return xs
}
/** ⛔ zero real elements under `sum` / `avg`: the unmeasured stop, word for word. */
const realNumbers = (arr, what) => {
  const xs = realsOf(arr, what)
  if (!xs.length) {
    throw new CollectionError(`${what} of ${arr.length ? 'an array whose every element is na' : 'an empty array'}`
      + ' — what Pine answers here has not been measured on a chart, and this engine does '
      + 'not guess a value a member would read as data')
  }
  return xs
}

/** ⭐⭐ C18 — A REDUCTION OF AN EMPTY ARRAY, UNDER A CALLER'S PROBE.
 *
 *  What Pine answers for `array.avg` & co. of an EMPTY array is not measured —
 *  but a capture can prove that Pine did NOT stop the script there (k-clustering
 *  averages its empty sixth cluster on every pass of its `while`, and TradingView
 *  drew the result). The value itself may still be unknowable, so it is not
 *  guessed: a caller that owns a `budget.unmeasured = { probe, hits }` gets its
 *  PROBE back and the hit recorded, runs the program again at a second probe, and
 *  serves an output only where the two runs agree — an output that does not move
 *  when the unknown value moves does not depend on it
 *  (`objectColumns.js::runtimeColumnsForObjects`).
 *
 *  ⛔ WITHOUT a probe the refusal stands, word for word: the runtime pane and
 *  every other caller keep `realNumbers`' stop. ⛔ AN `na` ELEMENT is a different
 *  question (skip it, or poison the result?) and is never probed here. */
const probedEmpty = (arr, what, budget) => {
  const u = budget && budget.unmeasured
  if (arr.length || !u || !probeAllows(u, what)) return null
  u.hits.push(what)
  return { value: u.probe }
}

/** ⭐ F8 — a caller may PROBE ONLY SOME unmeasured values (`budget.unmeasured.only`,
 *  a list of names): the runtime pane probes `array.sum` / `array.avg` over zero
 *  real elements and nothing else — every other unmeasured value keeps its stop.
 *  No list = every unmeasured value (the object lane, C18, unchanged). */
export const probeAllows = (u, what) => !(u && Array.isArray(u.only)) || u.only.includes(what)

/** ⚠️⚠️ INTERIM — SUPERSEDED BY LANE H7. CAP4 `vw-rt7-empty-reduce-fixnan-spy-1d-2026-10-04`
 *  measures TradingView's answer for sum / avg / max / min of an empty or all-`na` array:
 *  `na`, with no runtime error. H7 implements that direct answer and REMOVES this probe
 *  (and `INTERIM_PANE_PROBED` in runtimeColumns.js); the F8 rail "a column that depends on
 *  the sum stops" (vendorHarness.f8Ungraded) is the one that changes then.
 *
 *  ⭐⭐ F8 (step 94) — `array.sum` / `array.avg` OVER ZERO REAL ELEMENTS, under a
 *  caller's probe. RT7 measured that a reduction SKIPS its `na` elements, so an
 *  all-`na` array and an empty one leave the same thing to reduce: nothing. What
 *  Pine then answers (0 or `na`) is still unmeasured — but that it does NOT STOP
 *  the script is witnessed: `delta-rsi-oscillator-strategy` (v4) calls
 *  `array.sum(_x)` on its bar 0 with all 21 elements `na` (`_Y_raw` filled from
 *  `rsi(close, 21)[k]`), unconditionally, on every bar, and TradingView draws its
 *  four markers (`delta-rsi-oscillator-strategy-{rddt,spy}-1d-2026-10-02`; a reached
 *  stop leaves a study holding nothing, C43); k-clustering witnesses `array.avg`
 *  of an EMPTY array (C18). So under a probe the value is the PROBE and the hit
 *  is recorded; the caller serves only what does not move between two probes.
 *  ⛔ Without a probe, `realNumbers`' stop stands word for word. A non-numeric
 *  element is not reduced: no probe, the stop by name. */
const interimProbedZeroReals = (arr, what, budget) => {
  const u = budget && budget.unmeasured
  if (!u || !probeAllows(u, what)) return null
  for (const v of arr) {
    if (typeof v !== 'number' || !Number.isNaN(v)) return null
  }
  u.hits.push(what)
  return { value: u.probe }
}

/** ⭐⭐ C18 — `array.slice` IS A VIEW IN PINE: the slice and its source share
 *  storage, so a write through either reaches both. This runtime answers it
 *  with a COPY and LINKS the two, and a later write to either REFUSES by name —
 *  so the copy is served exactly where it cannot be told apart from the view
 *  (neither is changed after the slice: k-clustering's `[array.slice(mu, 0, k),
 *  …]` is read and `array.copy`'d, never written). */
const SLICED = Symbol('uct.array.sliced')
const guardSliceWrite = (arr, what) => {
  if (arr && arr[SLICED]) {
    throw new CollectionError(`${what}: this array shares storage with an \`array.slice\` — `
      + 'Pine writes through to both, and this runtime holds them as copies, so the write '
      + 'is refused rather than letting the two disagree')
  }
  return arr
}

/** ⭐ C18 — a member the corpus writes that this runtime does not compute:
 *  it COMPILES (so a script can be read) and STOPS the run by name the moment it
 *  is actually reached with elements — k-clustering names `array.median` and
 *  `array.stdev` in branches its default inputs never take. An EMPTY array takes
 *  the caller's probe like any other reduction. */
const unmeasuredReduction = (name) => ({
  args: ['array', 'number'], returns: 'number', minArgs: 1, maxArgs: 2,
  fn: (a, budget) => {
    const p = probedEmpty(a[0], name, budget)
    if (p) return p.value
    throw new CollectionError(`${name} — this runtime does not compute it yet, and it stops `
      + 'the run here rather than answering with a guess')
  },
})

/** ⭐ RT7 — AN `na` SEARCH VALUE IS FOUND NOWHERE: MEASURED. `vw-array-na-spy-1d-
 *  2026-10-02` reads `array.indexof(a, na)` **-1** (N06) and `array.includes(a, na)`
 *  **false** (N07) over an array that HOLDS an `na`, and `array.indexof` of an
 *  all-`na` array's own `array.min` (itself `na`) **-1** (N09). So `na` never
 *  equals `na` here. ⛔ JS `Array#includes` would answer TRUE (SameValueZero);
 *  both members compare with `indexOf`'s strict equality, under which NaN
 *  matches nothing — the measured answer. */
const indexOfValue = (arr, v) => ((typeof v === 'number' && Number.isNaN(v)) ? -1 : arr.indexOf(v))

/** ⭐⭐ C11 — THE MEMBERS THE NINE C11 SCRIPTS WRITE, each Pine's documented
 *  behaviour and nothing inferred. ⛔ `array.slice` is deliberately ABSENT: its
 *  result is a VIEW that shares storage with the source (a write through either
 *  reaches both), and a copy would be a different program — it keeps its
 *  `runtime:array` refusal by name. */
const C11_MEMBERS = {
  'array.first': { args: ['array'], returns: 'any', fn: (a) => nonEmpty(a[0], 'array.first')[0] },
  'array.last': {
    args: ['array'], returns: 'any',
    fn: (a) => { const arr = nonEmpty(a[0], 'array.last'); return arr[arr.length - 1] },
  },
  // ⭐ `shift`/`pop` REMOVE AND RETURN — usable as a value or, discarded, as a
  // statement (the front end drops the one value a statement leaves).
  'array.shift': {
    args: ['array'], returns: 'any',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', 1)
      return nonEmpty(guardSliceWrite(a[0], 'array.shift'), 'array.shift').shift()
    },
  },
  'array.pop': {
    args: ['array'], returns: 'any',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', 1)
      return nonEmpty(guardSliceWrite(a[0], 'array.pop'), 'array.pop').pop()
    },
  },
  'array.unshift': {
    args: ['array', 'any'], returns: 'void',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', 1)
      budget.peak('ARRAY_ELEMENTS', a[0].length + 1)
      guardSliceWrite(a[0], 'array.unshift').unshift(a[1])
    },
  },
  'array.remove': {
    args: ['array', 'number'], returns: 'any',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', 1)
      return guardSliceWrite(a[0], 'array.remove').splice(at(a[0], a[1], 'array.remove'), 1)[0]
    },
  },
  // `array.concat(id1, id2)` appends id2's elements to id1 and RETURNS id1 —
  // the same array, not a new one.
  'array.concat': {
    args: ['array', 'array'], returns: 'array',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', a[1].length)
      budget.peak('ARRAY_ELEMENTS', a[0].length + a[1].length)
      guardSliceWrite(a[0], 'array.concat')
      for (const v of a[1]) a[0].push(v)
      return a[0]
    },
  },
  'array.indexof': {
    args: ['array', 'any'], returns: 'number',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', a[0].length)
      return indexOfValue(a[0], a[1])
    },
  },
  'array.includes': {
    args: ['array', 'any'], returns: 'number',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', a[0].length)
      return indexOfValue(a[0], a[1]) >= 0 ? 1 : 0
    },
  },
  'array.max': {
    args: ['array'], returns: 'number',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', a[0].length)
      const xs = realsOf(a[0], 'array.max')
      return xs.length ? xs.reduce((m, v) => (v > m ? v : m), -Infinity) : NaN
    },
  },
  'array.min': {
    args: ['array'], returns: 'number',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', a[0].length)
      const xs = realsOf(a[0], 'array.min')
      return xs.length ? xs.reduce((m, v) => (v < m ? v : m), Infinity) : NaN
    },
  },
  'array.sum': {
    args: ['array'], returns: 'number',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', a[0].length)
      const p = interimProbedZeroReals(a[0], 'array.sum', budget)
      if (p) return p.value
      return realNumbers(a[0], 'array.sum').reduce((s, v) => s + v, 0)
    },
  },
  'array.avg': {
    args: ['array'], returns: 'number',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', a[0].length)
      const p = interimProbedZeroReals(a[0], 'array.avg', budget)
      if (p) return p.value
      const xs = realNumbers(a[0], 'array.avg')
      return xs.reduce((s, v) => s + v, 0) / xs.length
    },
  },
}

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
    // ⛔⛔ A ZERO-LENGTH ARRAY HAS NO ELEMENT, SO THE FILL VALUE CANNOT BE
    // REACHED — and refusing one on the grounds of an unknown fill refuses a
    // case the reason cannot apply to. `array.new_bool(0)` and
    // `array.new_string(0)` were refused that way, and so was every
    // `array.new_box(0)`, which is the corpus's second-commonest drawing-array
    // spelling. This is checked BEFORE the default lookup, deliberately: after
    // it, the lookup's verdict decides a case it has no stake in.
    if (n === 0) return []
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_FOR, typeArg)) {
      throw new CollectionError(noDefaultReason(typeArg, n))
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
 *
 *  ⭐⭐ AND THE FOUR DRAWING TYPES JOIN ON EXACTLY THAT ARGUMENT. `box`, `line`,
 *  `label` and `linefill` are listed for the same reason and serve the same
 *  three shapes every other type does: an empty array, an explicit size of
 *  zero, and an explicit initial value. What they do NOT serve is a sized array
 *  with no initial value — see `DRAWING_TYPES` for why that is a different
 *  refusal from `bool`'s, and `noDefaultReason` for the sentence.
 */
const TYPED_NEW = Object.freeze(['float', 'int', 'bool', 'string', 'color', ...DRAWING_TYPES])

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
  // ⭐⭐ `array.sort_indices(id, order)` — the RANKING, not the sorted values.
  // It returns the positions that WOULD sort the array, which is how a
  // dashboard orders its rows while keeping every parallel array (symbols,
  // RVOL, ATR, …) addressable by one index.
  //
  // ⛔ THE SOURCE IS NEVER MUTATED. `array.sort` reorders in place; this one
  // does not, and a member's other arrays are indexed off the original order —
  // sorting it here would silently re-point every one of them.
  //
  // ⛔⛔ THE TIE ORDER IS THE MEASURED PART, AND IT IS NOT SYMMETRIC.
  // Vendor packet M7, measured 2026-09-19: ties KEEP their order ascending and
  // are REVERSED descending. A plain stable sort keeps them in BOTH directions
  // and is therefore wrong on descending — which is the direction a dashboard
  // uses, and the case `sort_indices` exists for at all.
  //
  // ⚰️ A first version of this shipped that stable sort and was caught by
  // `arrays.test.js`'s own control, which had refused the function BY NAME
  // precisely because M7 is partial. A refusal backed by a measurement is not a
  // gap to be filled in passing.
  //
  // ⭐ H11 — AND NOW THE REST OF M7 IS MEASURED (CAP5, 2026-10-04,
  // `vw-m7-sort-indices-ties-spy-1d-2026-10-04`, TradingView Premium): over
  // 5,3,5,1,3,5 ascending is 3,1,4,0,2,5 and descending 5,2,0,4,1,3; over the
  // ALL-EQUAL 7,7,7,7 ascending is 0,1,2,3 and descending 3,2,1,0; over the
  // already-descending 3,2,1 ascending is 2,1,0. The reversed-tie rule below
  // answers every one of them (`vendorHarness.cap5Captures.test.js`).
  //
  // ⚠️ `na` SINKS IN BOTH DIRECTIONS — also unmeasured. A comparator returning
  // NaN makes the order implementation-defined, so a rule had to exist; sinking
  // is the one that behaves for this product (a symbol with no data ranks last
  // either way), and it is a choice, not a finding.
  'array.sort_indices': {
    args: ['array', 'string'], returns: 'array', minArgs: 1, maxArgs: 2,
    fn: (a, budget) => {
      const src = a[0]
      const desc = a[1] === 'descending'
      budget.charge('ARRAY_OPERATIONS', src.length)
      budget.peak('ARRAY_ELEMENTS', src.length)
      const idx = src.map((_, i) => i)
      idx.sort((i, j) => {
        const x = src[i]
        const y = src[j]
        const xs = typeof x === 'string'
        const ys = typeof y === 'string'
        let c
        if (xs && ys) c = x < y ? -1 : x > y ? 1 : 0
        else {
          const xn = typeof x === 'number' && Number.isFinite(x)
          const yn = typeof y === 'number' && Number.isFinite(y)
          if (!xn && !yn) c = 0
          else if (!xn) return 1
          else if (!yn) return -1
          else c = x < y ? -1 : x > y ? 1 : 0
        }
        // ⭐ THE TIE BRANCH IS THE WHOLE MEASUREMENT: equal keys keep their
        // order ascending (`i - j`) and reverse descending (`j - i`).
        if (c === 0) return desc ? j - i : i - j
        return desc ? -c : c
      })
      return idx
    },
  },
  // ⭐ H11 — `array.sort(id, order)`: the VALUES reordered in place. Equal keys
  // are the same value, so the tie order M7 measured (`sort_indices`, above)
  // cannot show in the result; the order of distinct keys is the comparison.
  // ⛔ An `na` element STOPS the run by name: where Pine sorts `na` is not
  // measured (`sort_indices`' sinking rule is a choice, not a finding, and an
  // in-place sort would hand that choice to every later read of the array).
  'array.sort': {
    args: ['array', 'string'], returns: 'void', minArgs: 1, maxArgs: 2,
    fn: (a, budget) => {
      const src = guardSliceWrite(a[0], 'array.sort')
      const desc = a[1] === 'descending'
      budget.charge('ARRAY_OPERATIONS', src.length)
      const strings = src.length > 0 && src.every((x) => typeof x === 'string')
      if (!strings && !src.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        throw new CollectionError('array.sort over an array holding `na` (or a non-number) — where '
          + 'Pine places `na` in a sort has not been measured, so this runtime stops rather than guess')
      }
      src.sort((x, y) => {
        const c = x < y ? -1 : x > y ? 1 : 0
        return desc ? -c : c
      })
    },
  },
  'array.size': { args: ['array'], returns: 'number', fn: (a) => a[0].length },
  'array.get': {
    args: ['array', 'number'], returns: 'any',
    fn: (a, budget) => a[0][at(a[0], a[1], 'array.get', budget)],
  },
  'array.set': {
    args: ['array', 'number', 'any'], returns: 'void',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', 1)
      guardSliceWrite(a[0], 'array.set')[at(a[0], a[1], 'array.set', budget)] = a[2]
    },
  },
  'array.push': {
    args: ['array', 'any'], returns: 'void',
    fn: (a, budget) => {
      budget.charge('ARRAY_OPERATIONS', 1)
      budget.peak('ARRAY_ELEMENTS', a[0].length + 1)
      guardSliceWrite(a[0], 'array.push').push(a[1])
    },
  },
  'array.copy': {
    args: ['array'], returns: 'array',
    fn: (a, budget) => { budget.peak('ARRAY_ELEMENTS', a[0].length); return a[0].slice() },
  },
  'array.clear': {
    args: ['array'], returns: 'void',
    fn: (a, budget) => { budget.charge('ARRAY_OPERATIONS', 1); guardSliceWrite(a[0], 'array.clear').length = 0 },
  },
  ...C11_MEMBERS,
  // ⭐⭐ C18 — see `SLICED`. `from` inclusive, `to` exclusive; Pine stops the
  // script on a bound outside the array, and so does this.
  'array.slice': {
    args: ['array', 'number', 'number'], returns: 'array',
    fn: (a, budget) => {
      const src = a[0]
      const from = a[1]
      const to = a[2]
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > src.length || from > to) {
        throw new CollectionError(`array.slice: [${from}, ${to}) is outside an array of ${src.length} — `
          + 'Pine stops the script here rather than answering na')
      }
      budget.peak('ARRAY_ELEMENTS', to - from)
      const out = src.slice(from, to)
      out[SLICED] = true
      src[SLICED] = true
      return out
    },
  },
  'array.median': unmeasuredReduction('array.median'),
  'array.stdev': unmeasuredReduction('array.stdev'),
  // ⭐ C35 — not a collection member: a void call the VM dispatches through this
  // table like `array.push`, and the one entry whose only effect is to STOP the
  // run (`PineRuntimeError`). Kept here rather than in a second table so the
  // front end's one statement path (`arrayStmt`) and the VM's one opcode serve it.
  'runtime.error': {
    args: ['string'], returns: 'void',
    fn: (a) => { throw new PineRuntimeError(a[0]) },
  },
  // ⭐⭐ RT16 — `time(<text>)` REACHED A SPELLING THIS ENGINE DOES NOT SERVE ON THIS
  // CHART (`pineRuntimeFrontend.js::timeOverText`). The run stops BY NAME and
  // nothing is drawn — never an `na` that reads like "no period started". The name
  // carries a `#`, which no Pine identifier can, so no script can call it.
  [CLOCK_UNSERVED_FN]: {
    args: ['string'], returns: 'number',
    fn: (a) => { throw new ClockUnservedError(a[0]) },
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
