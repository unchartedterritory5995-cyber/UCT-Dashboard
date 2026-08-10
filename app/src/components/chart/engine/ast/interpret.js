// ─── THE INTERPRETER, AND THE ONE LINE THAT MAKES THE TABLE CLOSED ──────────
//
// This is the first code in this product that EXECUTES AN EXPRESSION A USER
// WROTE. Everything else here is arithmetic; the load-bearing line is the
// identifier lookup, and it is load-bearing in a way that is easy to lose in a
// refactor:
//
//     Object.prototype.hasOwnProperty.call(scope, name)      // ✅
//     scope[name]                                            // ⛔
//
// ⛔ `scope[name]` FINDS `toString`, `constructor`, `valueOf` AND EVERY OTHER
// `Object.prototype` MEMBER — and every one of them is a FUNCTION, so a bare
// subscript turns a word a user typed into a callable. `[].constructor.constructor`
// IS `Function` in a browser and `Function('return this')()` is arbitrary code
// from a text box on a live trading surface.
//
// ⭐ THE SHAPE IS A CLOSED TABLE, NOT A DENYLIST, AND THAT IS A MEASURED
// PREFERENCE RATHER THAN A TASTE. Task 2's census resolved `eval`, `exec`,
// `__import__` and `compile` through a naive lookup — and recorded that `open`
// was MISSING from that list because it is shadowed by the `open` SERIES. A
// denylist of bad names gets that backwards: it would have blocked the series
// and let the builtin through on the day the series was renamed. The set of
// nameable things here is `closedTable.json` and there is no other list, so
// nothing outside it can be spelled at all.
//
// ⛔ NO CLOCK, NO NETWORK, NO REGISTRY IMPORT, NO `Math.random`, NO MODULE
// STATE. This module is PURE: the same (ast, bars, inputs) produces the same
// column forever. The conformance log is an equality against a lane in another
// language, so anything non-deterministic makes the two disagree for a reason
// neither is wrong about — and that failure would look exactly like a real
// divergence. `interpret.test.js` proves this STRUCTURALLY, by AST over this
// file's own source, because a grep for `Date` matches the word in a comment.
//
// ⭐ COLUMNAR, NOT PER-BAR. Every function in the table is a whole-series
// reduction, so the walker evaluates each node ONCE into a column and combines
// columns. That is both faster and the only shape in which `maxLookback` is a
// TREE SUM rather than a dataflow analysis — which is what lets Task 7's linter
// be simple enough to be obviously right.
//
// WHAT THIS FILE DOES **NOT** DO, NAMED SO NOBODY READS IT AS COVERED:
//   * the BUDGET ITSELF lives in `budget.js`. What is here is the MEASUREMENT
//     it thresholds — `nodeCount(ast)` and `maxLookback(ast)` — and both are
//     ITERATIVE, so the guard cannot die inside itself on the input it exists to
//     refuse. `interpret` below is still a plain RECURSIVE walk, and that
//     asymmetry is the point: a tree deep enough overflows the stack, that is a
//     `RangeError`, it is an ESCAPE, and it must never be dressed up as a table
//     refusal. There is no `try` anywhere in this file, and `budget.test.js`
//     asserts that structurally so the relabelling cannot be introduced quietly.

import { TABLE, NODE_TYPES, RECURRENCES, RECURRENCE_BINDINGS, isPointwise } from './parse.js'
// ⚠️ A REAL ES MODULE CYCLE, DELIBERATELY — `budget.js` imports `maxLookback`,
// `nodeCount` and `TableRefusal` back out of this file, because a second copy of
// either measurement is a second grammar (there are already two `maxLookback`s
// in this directory and Task 7 paid for the second with an agreement rail). It
// resolves because every cross-module use is inside a function body and
// `export function` bindings are hoisted; `budget.js`'s header states the whole
// contract and `budget.test.js` proves it from a graph whose ENTRY is that file.
import { assertBudget } from './budget.js'

// ⭐⭐ THE INDICATORS ARE NOT WRITTEN HERE. `indicators.js` is the maths the
// CHART draws, and `api/services/indicator_compute.py` is the same maths on the
// server; `tests/fixtures/indicators/` already pins those two against each other
// at rel-tol 1e-9, case by case, which is the only reason a formula calling them
// can be promised to agree across the lanes at all. A private RSI in this file
// would be a THIRD implementation and a second authority over one value —
// `closedTable.json::_functions_indicators` records the decision.
//
// ⚠️ THIS IMPORT IS WHY `tools/ast_conformance.py`'s node driver reaches
// `indicators.js`. That module imports nothing and touches no DOM, so a bare
// `node` resolves it exactly as vite does.
import {
  computeRSI, computeMACD, computeATR, computeADX, computeStochastic,
  computeCCI, computeWilliamsR, computeMFI, computeDonchian, computeIchimoku,
} from '../../indicators.js'

// --------------------------------------------------------------------------- //
// refusals
// --------------------------------------------------------------------------- //

/** The closed table saying no, at INTERPRET time. Carries the guard that fired.
 *
 *  ⚠️ A DIFFERENT CLASS FROM `parse.js`'s `TableRefusal`, deliberately, and both
 *  are exported under that name from their own module. The census recognises a
 *  refusal BY TYPE, and the two doors refuse different things: `canonicalise`
 *  refuses SHAPES the tree may not have, this refuses NAMES the tree may not
 *  reach. A single shared class would let a canonicalise guard's deletion be
 *  covered by an interpret guard's test. */
export class TableRefusal extends Error {
  constructor(guard, message) {
    super(message)
    this.name = 'TableRefusal'
    this.guard = guard
  }
}

/** guard → the sentence it always refuses with.
 *
 *  ⛔ PAIRWISE DISJOINT, AND ACROSS `parse.js`'s SET TOO. Two gates sharing a
 *  phrase let a `toThrow(/…/)` pass with the safety deleted, and that has
 *  happened in this repo (C Task 9's M1). `interpret.test.js` asserts the
 *  disjointness over the UNION of both modules' tables, not just this one. */
export const REFUSALS = Object.freeze({
  'resolve:name': 'unknown name',
  'resolve:function': 'unknown function',
  'resolve:arity': 'wrong number of arguments',
  'resolve:window': 'a window must be a whole-number literal',
  'interpret:node': 'not a canonical node',
  'interpret:operator': 'unknown operator',
  'interpret:offset': 'an offset node carries a whole-number count of bars',
  'interpret:recurrence': 'a running value reads its own past only inside its own update, and only through operators and pointwise calls',
  'interpret:steps': 'warming this running value up over these bars would take more steps than the engine will spend',
})

function refuse(guard, detail) {
  throw new TableRefusal(guard, `${REFUSALS[guard]} ${detail}`)
}

/** The ceiling on `bars × warmup` for one recurrence — the ONE cost in this
 *  engine that `budget.js` cannot threshold.
 *
 *  ⭐ IT LIVES HERE RATHER THAN IN `budget.js` BECAUSE IT NEEDS THE BARS. Every
 *  other cap is a property of the TREE and is decided before a single bar is
 *  fetched; this one is a property of the tree AND the request, so putting it in
 *  the static budget would mean thresholding a number that module cannot see.
 *
 *  ⚠️ ONE NUMBER FOR BOTH LANES, AND THAT IS WHY IT IS THIS LOW. The Python
 *  walker is plain loops on purpose (numpy would change summation order and cost
 *  the 1e-9 parity), so it is ~40× slower per step than the JS one and IT is
 *  what this bounds. A per-lane ceiling would be two engines: the same formula
 *  would draw on a chart and refuse in an alert, which is the one divergence a
 *  cross-lane parity run is blind to because both lanes would be internally
 *  consistent.
 *
 *  ⏳ WHAT WOULD RAISE IT: a scan needs only the LAST bar, so a last-bar-only
 *  entry point costs `warmup` steps instead of `bars × warmup` and would let a
 *  sweep carry a 500-bar warm-up over the whole universe. That is an API change
 *  in both lanes, not a number change here. */
export const MAX_RECURRENCE_STEPS = 1000000

/** ⛔ THE ONLY WAY THIS MODULE ASKS WHETHER A NAME EXISTS. `name in obj` walks
 *  the prototype chain and `obj[name]` returns whatever it finds there. */
const own = (obj, name) => Object.prototype.hasOwnProperty.call(obj, name)

const declared = (obj) => Object.keys(obj).join(', ')

// --------------------------------------------------------------------------- //
// columns
// --------------------------------------------------------------------------- //

/** A value the walker produced → an input-length, NaN-padded `Float64Array`.
 *
 *  ⭐ `bars.length`, ALWAYS, AND NEVER THE VALUE'S OWN LENGTH. `computeFor`
 *  returns one column per key aligned to the bar count (spec §4) and the binder
 *  converts NaN to LWC whitespace. A column that is SHORTER silently shifts
 *  every index — a scalar formula (`20`) is the case that proves it, because its
 *  value has no length at all. */
function toColumn(value, length) {
  const col = new Float64Array(length)
  col.fill(NaN)
  if (typeof value === 'number') {
    if (Number.isFinite(value)) col.fill(value)
    return col
  }
  if (!value || typeof value.length !== 'number') return col
  const n = Math.min(value.length, length)
  for (let i = 0; i < n; i++) {
    const v = value[i]
    col[i] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
  }
  return col
}

const isColumn = (v) => v instanceof Float64Array

const nan = (n) => { const c = new Float64Array(n); c.fill(NaN); return c }

// --------------------------------------------------------------------------- //
// the table's functions
// --------------------------------------------------------------------------- //
//
// ⚠️ EVERY IMPLEMENTATION BELOW RECEIVES A `Float64Array` FOR A `series`
// ARGUMENT AND A PLAIN NUMBER FOR AN `int` ONE. The coercion happens once, in
// the walker, driven by `TABLE.functions[name].args` — so no implementation
// carries its own idea of what its arguments are, and a table edit reaches every
// one of them at once. ⛔ NO COUNT HERE. This comment said "all eleven" while the
// table held eleven, which is the hand-typed-count-beside-the-list defect the
// ledger is full of; `interpret.test.js` asserts the key sets are EQUAL, which
// is the claim a number was only ever approximating.
//
// ⭐ NaN IS A WARMUP, NOT A ZERO, AND IT PROPAGATES. A fabricated 0 during a
// 199-bar warmup is a number a user could arm an alert on. Every reduction
// below emits NaN until its window is full, and any NaN INSIDE a window makes
// that window's output NaN.

/** Rolling reduction over a full window. NaN before bar `n-1`. */
function rolling(series, n, reduce) {
  const out = nan(series.length)
  for (let i = n - 1; i < series.length; i++) out[i] = reduce(series, i - n + 1, i)
  return out
}

function windowMean(series, lo, hi) {
  let sum = 0
  for (let i = lo; i <= hi; i++) sum += series[i]
  return sum / (hi - lo + 1)
}

function windowExtreme(series, lo, hi, better) {
  let best = series[lo]
  for (let i = lo; i <= hi; i++) {
    const v = series[i]
    if (Number.isNaN(v)) return NaN          // explicit: NaN does not lose a comparison
    if (better(v, best)) best = v
  }
  return best
}

/** POPULATION standard deviation — divisor `n`, not `n - 1`.
 *
 *  ⚠️ NAMED OUT LOUD BECAUSE THE CORPUS SAYS IT IS INVISIBLE OTHERWISE: a
 *  population/sample disagreement between the lanes has the same tree, the same
 *  column length and the same NaN pad, and shows up only in the number. This
 *  matches `indicators.js::computeBB` (`Math.sqrt(sqSum / period)`), so a
 *  user's `sma(close,20) + 2*stdev(close,20)` draws the same band the native
 *  Bollinger definition draws. The Python lane must use the same divisor. */
function windowStdev(series, lo, hi) {
  const avg = windowMean(series, lo, hi)
  let sq = 0
  for (let i = lo; i <= hi; i++) sq += (series[i] - avg) ** 2
  return Math.sqrt(sq / (hi - lo + 1))
}

/** EMA seeded with the SMA of the first full window, `k = 2 / (n + 1)`.
 *
 *  ⚠️ THE SEED IS A DECISION AND IT MATCHES THE NATIVE LANE. `indicators.js::_ema`
 *  seeds with `values.slice(0, period)`'s mean and emits its first value at
 *  index `period - 1`; so does this. A NaN in the input RESTARTS the seed — the
 *  warmup of a composed series (`ema(sma(close,20), 9)`) is exactly that case,
 *  and an EMA that carried its state across a hole would be reporting an average
 *  of bars it never saw. */
/** ⭐ ONE SMOOTHER, TWO CONSTANTS. `ema` passes `2 / (n + 1)` and `rma` (Wilder's)
 *  passes `1 / n`; the seed, the restart-on-a-hole and the NaN prefix are shared
 *  BY CONSTRUCTION rather than by two loops that agree today. See
 *  `closedTable.json::_functions_smoothing` for why the alpha is what is shared
 *  and the PERIOD is not. */
function smoothCol(series, n, k) {
  const out = nan(series.length)
  let prev = NaN
  let count = 0
  let sum = 0
  for (let i = 0; i < series.length; i++) {
    const v = series[i]
    if (!Number.isFinite(v)) { prev = NaN; count = 0; sum = 0; continue }
    if (Number.isNaN(prev)) {
      sum += v
      count += 1
      if (count === n) { prev = sum / n; out[i] = prev }
    } else {
      prev = prev * (1 - k) + v * k
      out[i] = prev
    }
  }
  return out
}

const emaCol = (series, n) => smoothCol(series, n, 2 / (n + 1))
const rmaCol = (series, n) => smoothCol(series, n, 1 / n)

/** The linearly weighted mean of `[lo, hi]` — the most recent bar carries the
 *  most weight. ⚠️ NaN PROPAGATES through the sum, which is what makes the
 *  warm-up of a composed argument show as a hole rather than as a lighter
 *  average of the bars that happened to be there. */
function windowWeightedMean(series, lo, hi) {
  let weighted = 0
  let weights = 0
  for (let i = lo; i <= hi; i++) {
    const w = i - lo + 1
    weighted += series[i] * w
    weights += w
  }
  return weighted / weights
}

function elementwise2(a, b, f) {
  const out = nan(a.length)
  for (let i = 0; i < a.length; i++) out[i] = f(a[i], b[i])
  return out
}

/** `{0, 1, NaN}` AND NOTHING ELSE — spec §3.1's event domain.
 *
 *  ⛔ NOT `true`/`false`. `nativeRegistry`'s `validateEventColumns` already
 *  refuses a 0.5 at registration for a native; a formula must not be the way in.
 *  Alerts, the screener and the Python AST lane all consume this one shape, and
 *  a JS `true` round-trips through JSON as `true`, not as 1. */
function crossing(a, b, fired) {
  const out = nan(a.length)
  for (let i = 1; i < a.length; i++) {
    const an = a[i]; const bn = b[i]; const ap = a[i - 1]; const bp = b[i - 1]
    if (Number.isNaN(an) || Number.isNaN(bn) || Number.isNaN(ap) || Number.isNaN(bp)) continue
    out[i] = fired(an, bn, ap, bp) ? 1 : 0
  }
  return out
}

// --------------------------------------------------------------------------- //
// the indicators — a BINDING to the chart's own maths, never a second copy
// --------------------------------------------------------------------------- //
//
// ⭐ THREE HELPERS AND NOTHING ELSE. Everything below is (1) pack the declared
// `series` columns into the `{h,l,c,v}` bar shape `indicators.js` reads, (2) call
// the shipped function, (3) unpack its `{time, value}` points back into a
// NaN-padded column. `api/services/ast_interpret.py` carries the SAME three, in
// the same order, against the same shipped functions — so the two lanes differ
// only where `indicators.js` and `indicator_compute.py` already differ, which is
// the thing the golden fixtures measure.

/** ⭐⭐ THE FIRST BAR FROM WHICH EVERY INPUT COLUMN IS FINITE TO THE END — and
 *  this is the load-bearing half of the whole binding.
 *
 *  🔴 THE MEASURED REASON, NOT A PRECAUTION. `indicators.js` and
 *  `indicator_compute.py` are written for BARS, and a bar is finite. Hand either
 *  one a NaN and the two languages stop agreeing: `compute_atr_raw`'s
 *  `max(h - l, abs(h - prev_c), abs(l - prev_c))` with a NaN `prev_c` returns
 *  Python's FIRST argument, because every NaN comparison is false and `max`
 *  keeps the incumbent — while `Math.max` returns NaN. Same expression, same
 *  fixture, two answers, and no golden fixture can see it because no fixture
 *  contains a NaN. A composed argument (`atr(high, low, sma(close,3), 14)`) is
 *  how a user reaches it in one keystroke.
 *
 *  ⭐ SO THE SHIPPED MATHS NEVER SEES ONE. The column starts after the LAST
 *  non-finite value in ANY argument, which is `emaCol`'s already-declared rule
 *  ("a NaN in the input RESTARTS the seed") applied to a whole bar. Two things
 *  fall out of it, and both are why this is the right rule rather than a
 *  convenient one:
 *    * `rsi(sma(close, 20), 14)` produces its first value at bar 33 — exactly
 *      the `19 + 14` the manifest's tree sum promises, rather than the all-NaN
 *      column a poisoned Wilder seed produces;
 *    * for an ordinary `close`/`high`/`low`/`volume` argument the start is 0, so
 *      every column this binding returns for an uncomposed call is
 *      byte-identical to calling the shipped function directly.
 *
 *  ⛔ WRITTEN TWICE, HERE AND IN `ast_interpret.py`, deliberately. It is a
 *  CONTRACT between the two lanes, not an optimisation, and the corpus pins it. */
function finiteTailStart(cols, length) {
  let start = 0
  for (const col of cols) {
    for (let i = length - 1; i >= start; i--) {
      if (!Number.isFinite(col[i])) { start = i + 1; break }
    }
  }
  return start
}

/** Pack the declared series columns into bars, run the chart's own maths over
 *  them, and unpack the result into a NaN-padded column of exactly `length`.
 *
 *  ⚠️ `t` IS SET AND NEVER READ BY ANY BOUND FUNCTION. It exists because
 *  `blank(bars)` writes `{time: b.t}` into every output point, and an
 *  `undefined` there is harmless only for as long as nobody looks — a bar index
 *  keeps that honest and costs nothing. ⛔ It is NOT the real timestamp, which
 *  is exactly why `vwap` is refused (`_functions_excluded`): a session anchor
 *  cannot be reconstructed from a column of prices.
 *
 *  ⛔ A LENGTH MISMATCH IS ALL-NaN, NOT A PARTIAL FILL. Every bound function
 *  returns either a bar-aligned array or `[]` (its "too short to compute
 *  anything" signal), and `[]` padded from the left would put a real value at
 *  the wrong bar. The Python lane's equivalent refuses the same way, against
 *  that lane's all-`None` form of the same signal. */
function bindShipped(fields, cols, length, run) {
  const out = nan(length)
  const start = finiteTailStart(cols, length)
  const n = length - start
  if (n <= 0) return out
  const bars = new Array(n)
  for (let i = 0; i < n; i++) {
    const bar = { t: i }
    for (let k = 0; k < fields.length; k++) bar[fields[k]] = cols[k][start + i]
    bars[i] = bar
  }
  const points = run(bars)
  if (!Array.isArray(points) || points.length !== n) return out
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const v = p ? p.value : undefined
    out[start + i] = typeof v === 'number' && !Number.isNaN(v) ? v : NaN
  }
  return out
}

/** The domain guard `_functions_domain` declares, as a value rather than a
 *  throw: a call whose periods are out of order computes nothing.
 *
 *  ⛔ WRITTEN TWICE ON PURPOSE — here and in `ast_interpret.py` — because the
 *  two shipped implementations DISAGREE on it. `compute_ichimoku_raw` returns
 *  empty columns when `max(tenkan, kijun) > senkouB`; `computeIchimoku` reads a
 *  negative index and throws a TypeError. Letting either lane's native answer
 *  through would be a cross-lane divergence on an argument list the table
 *  admits, so both lanes answer NaN before the shipped function is reached. */
const outOfOrder = (length) => nan(length)

/** The bar-field name lists the bindings below pack into. THE SHIPPED
 *  FUNCTIONS' parameter shape, never the table's vocabulary — `high` is the
 *  table's name for the series and `h` is the key `indicators.js` reads. */
const HL = Object.freeze(['h', 'l'])
const HLC = Object.freeze(['h', 'l', 'c'])
const HLCV = Object.freeze(['h', 'l', 'c', 'v'])

/** The pointwise functions AS SCALARS — one bar in, one bar out.
 *
 *  ⭐ THE COLUMN FORMS BELOW ARE DEFINED IN TERMS OF THESE, NOT BESIDE THEM, AND
 *  THAT IS THE WHOLE REASON THIS OBJECT EXISTS. A recurrence body is evaluated
 *  one bar at a time (see `runRecurrence`), so `max(self, close)` needs a scalar
 *  `max`; writing a second one there would be two implementations of one
 *  function, and the first thing to diverge would be the NaN rule that the
 *  comment below says was already a measured cross-lane bug.
 *
 *  ⚠️ THE KEY SET IS DERIVED AND ASSERTED, NOT CURATED. `parse.js::isPointwise`
 *  decides which table entries a body may call; `interpret.test.js` asserts that
 *  set equals these keys BOTH WAYS, so a pointwise entry that lands in the
 *  manifest without a scalar form here fails by name rather than refusing inside
 *  a body that looks legal. */
const POINTWISE = Object.freeze({
  abs: (x) => Math.abs(x),
  min: (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.min(x, y)),
  max: (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.max(x, y)),
  // ⛔ NOT `Math.sign`, WHICH ANSWERS -0 FOR -0. A signed zero is invisible in
  // every comparison and in the read-back, and it is NOT invisible to a parity
  // run that divides by it — so the three answers are written out.
  sign: (x) => (Number.isNaN(x) ? NaN : (x > 0 ? 1 : (x < 0 ? -1 : 0))),
  // ⛔ NOT `Math.round`, WHICH ROUNDS A HALF TOWARD +∞ WHILE PYTHON'S `round`
  // ROUNDS IT TO EVEN. Pine rounds a half AWAY FROM ZERO and so does this, in
  // both lanes, spelled the same way. See `_functions_rounding`.
  round: (x) => (Number.isNaN(x) ? NaN : POINTWISE.sign(x) * Math.floor(Math.abs(x) + 0.5)),
  // ⭐⭐ THE TWO THAT DO NOT PROPAGATE, AND THEY ARE THE ONLY TWO. `na` INSPECTS
  // not-computable and `nz` REPLACES it — see `_functions_na` for why a table
  // built entirely around NaN meaning "we do not know" declares them anyway.
  na: (x) => (Number.isNaN(x) ? 1 : 0),
  nz: (x, y) => (Number.isNaN(x) ? y : x),
})

/** name → implementation. THE KEY SET IS `TABLE.functions`'s, both directions.
 *
 *  ⛔ AN IMPLEMENTED-BUT-UNDECLARED KEY HERE IS A CALLABLE OUTSIDE THE CLOSED
 *  TABLE, which is the one thing this phase exists to make impossible; a
 *  DECLARED-BUT-UNIMPLEMENTED one is a formula the builder offers and the chart
 *  cannot draw. `interpret.test.js` asserts the equality in both directions. */
export const FN = Object.freeze({
  sma: (series, n) => rolling(series, n, windowMean),
  ema: (series, n) => emaCol(series, n),
  highest: (series, n) => rolling(series, n, (s, lo, hi) => windowExtreme(s, lo, hi, (v, b) => v > b)),
  lowest: (series, n) => rolling(series, n, (s, lo, hi) => windowExtreme(s, lo, hi, (v, b) => v < b)),
  stdev: (series, n) => rolling(series, n, windowStdev),
  change: (series) => {
    const out = nan(series.length)
    for (let i = 1; i < series.length; i++) out[i] = series[i] - series[i - 1]
    return out
  },
  abs: (series) => {
    const out = nan(series.length)
    for (let i = 0; i < series.length; i++) out[i] = POINTWISE.abs(series[i])
    return out
  },
  // ⚠️ NaN PROPAGATES, WRITTEN OUT RATHER THAN INHERITED FROM `Math.min`. JS's
  // `Math.min(NaN, x)` is NaN and Python's `min` returns whichever it meets
  // first — a real cross-lane divergence the corpus names explicitly. Spelling
  // the rule kills it in both lanes instead of relying on one language's luck.
  min: (a, b) => elementwise2(a, b, POINTWISE.min),
  max: (a, b) => elementwise2(a, b, POINTWISE.max),
  rma: (series, n) => rmaCol(series, n),
  wma: (series, n) => rolling(series, n, windowWeightedMean),
  sign: (series) => {
    const out = nan(series.length)
    for (let i = 0; i < series.length; i++) out[i] = POINTWISE.sign(series[i])
    return out
  },
  round: (series) => {
    const out = nan(series.length)
    for (let i = 0; i < series.length; i++) out[i] = POINTWISE.round(series[i])
    return out
  },
  na: (series) => {
    const out = nan(series.length)
    for (let i = 0; i < series.length; i++) out[i] = POINTWISE.na(series[i])
    return out
  },
  nz: (a, b) => elementwise2(a, b, POINTWISE.nz),
  crossOver: (a, b) => crossing(a, b, (an, bn, ap, bp) => an > bn && ap <= bp),
  crossUnder: (a, b) => crossing(a, b, (an, bn, ap, bp) => an < bn && ap >= bp),

  // ── the indicators, bound to the chart's own maths ──────────────────────
  //
  // ⚠️ `computeRSI` and `computeMACD` read ONLY `.c`, so a one-field bar array
  // is the whole adaptation and `rsi(sma(close,20), 14)` is an RSI of a smoothed
  // series rather than a different function. That composability is the reason
  // the table declares a `series` argument instead of reading `close` itself.
  rsi: (s, n) => bindShipped(['c'], [s], s.length, (bars) => computeRSI(bars, n)),

  // ⛔ `signal` IS PINNED TO 1 AND IT IS NOT A HIDDEN DEFAULT. `computeMACD`
  // returns the LINE, the signal and the histogram; this entry declares only the
  // line, and the only thing `signal` still reaches is the guard
  // `bars.length < slow + signal`. 1 is the smallest value that cannot make that
  // guard refuse a series the LINE could have been computed over — a larger one
  // would blank the line on a short series for a reason the declaration does not
  // mention. `compute_macd_raw` is passed the same 1.
  macd: (s, fast, slow) => (fast > slow
    ? outOfOrder(s.length)
    : bindShipped(['c'], [s], s.length, (bars) => computeMACD(bars, fast, slow, 1).macd)),

  atr: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeATR(bars, n)),
  plusDI: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeADX(bars, n).plusDI),
  minusDI: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeADX(bars, n).minusDI),
  // %K only. %D is `sma(stoch(…), d)` — see `_functions_excluded.stochD`, and
  // `dPeriod` is pinned to 1 for the same reason `macd`'s `signal` is: it must
  // not reach a guard this entry's declaration says nothing about.
  stoch: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeStochastic(bars, n, 1).k),
  cci: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeCCI(bars, n)),
  williamsR: (h, l, c, n) => bindShipped(HLC, [h, l, c], c.length, (bars) => computeWilliamsR(bars, n)),
  mfi: (h, l, c, v, n) => bindShipped(HLCV, [h, l, c, v], c.length, (bars) => computeMFI(bars, n)),

  donchianUpper: (h, l, n) => bindShipped(HL, [h, l], h.length, (bars) => computeDonchian(bars, n).upper),
  donchianMiddle: (h, l, n) => bindShipped(HL, [h, l], h.length, (bars) => computeDonchian(bars, n).middle),
  donchianLower: (h, l, n) => bindShipped(HL, [h, l], h.length, (bars) => computeDonchian(bars, n).lower),

  ichimokuTenkan: (h, l, t, k, s) => ichimokuLine(h, l, h, t, k, s, 'tenkan'),
  ichimokuKijun: (h, l, t, k, s) => ichimokuLine(h, l, h, t, k, s, 'kijun'),
  ichimokuSpanA: (h, l, t, k, s) => ichimokuLine(h, l, h, t, k, s, 'spanA'),
  ichimokuSpanB: (h, l, t, k, s) => ichimokuLine(h, l, h, t, k, s, 'spanB'),
  ichimokuChikou: (h, l, c, t, k, s) => ichimokuLine(h, l, c, t, k, s, 'chikou'),
})

/** One line of the Ichimoku family, with `_functions_domain`'s guard in front.
 *
 *  ⚠️ THE FOUR MIDLINE ENTRIES PASS `high` AS THE CLOSE COLUMN AND THAT IS NOT A
 *  SHORTCUT. `computeIchimoku` reads `.c` for exactly one thing — the lagging
 *  span — so the four lines that do not declare a close argument cannot be
 *  affected by what sits there, and the alternative (a fifth declared series
 *  every one of them ignores) would put a term in the read-back that says
 *  nothing about the number. `chikou` declares its close and passes it. */
function ichimokuLine(h, l, c, tenkan, kijun, senkouB, key) {
  if (Math.max(tenkan, kijun) > senkouB) return outOfOrder(h.length)
  return bindShipped(HLC, [h, l, c], h.length,
    (bars) => computeIchimoku(bars, tenkan, kijun, senkouB)[key])
}

// --------------------------------------------------------------------------- //
// the operators
// --------------------------------------------------------------------------- //
//
// ⭐⭐ THE BOOLEAN DECISION, IMPLEMENTED. `closedTable.json`'s `_booleans` key
// records it and Task 3 handed it here: there is NO boolean node type, because
// the manifest declares `!`, `&&`, `||` and `?:` over a table whose only literal
// is a NUMBER. A condition is therefore a 0/1 column BY CONSTRUCTION, and the
// parser's `true`/`false` already canonicalise to `num 1` / `num 0`.
//
// WHAT IT COSTS, STATED RATHER THAN DISCOVERED:
//   * `1 && 2` is **1**, not 2. JS's value-returning `&&`/`||` are deliberately
//     NOT implemented — they would put a non-{0,1} value in a column the alert
//     grammar reads as a signal.
//   * `0 || 5` is **1**, not 5. Same reason.
//   * `!5` is **0** and `!0` is **1**; there is no `!!x` idiom to write because
//     a comparison is already 0/1.
//   * TRUTHINESS IS `x !== 0`, NOT JS's. In JS every non-zero number and NaN are
//     both truthy; here NaN is not a truth value at all (below).
//
// ⛔ NaN PROPAGATES THROUGH `&&`, `||`, `!` AND `?:` — AND THAT IS THE OPPOSITE
// OF BOTH LANGUAGES' DEFAULTS (`!NaN` is `true` in JS and `not nan` is `False`
// in Python — they already disagree). The `{0,1,NaN}` domain distinguishes "it
// did not happen" from "it is not computable yet", and a warmup that collapsed
// to 0 would be a signal the user can arm an alert on.
//
// ⛔ A COMPARISON AGAINST NaN IS 0, NOT NaN. That is the other half of the same
// decision and it is the one place JS and Python agree by luck (`NaN > x` is
// false in both), so it is pinned rather than assumed.

const isNan = (x) => Number.isNaN(x)

const cmp = (f) => (a, b) => (isNan(a) || isNan(b) ? 0 : (f(a, b) ? 1 : 0))
const logical = (f) => (a, b) => (isNan(a) || isNan(b) ? NaN : (f(a !== 0, b !== 0) ? 1 : 0))

const BINARY = Object.freeze({
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '>': cmp((a, b) => a > b),
  '<': cmp((a, b) => a < b),
  '>=': cmp((a, b) => a >= b),
  '<=': cmp((a, b) => a <= b),
  '==': cmp((a, b) => a === b),
  '!=': cmp((a, b) => a !== b),
  '&&': logical((a, b) => a && b),
  '||': logical((a, b) => a || b),
})

const UNARY = Object.freeze({
  'u-': (a) => -a,
  '!': (a) => (isNan(a) ? NaN : (a !== 0 ? 0 : 1)),
})

const TERNARY = (t, a, b) => (isNan(t) ? NaN : (t !== 0 ? a : b))

// --------------------------------------------------------------------------- //
// the static measurements Task 6's budgets threshold
// --------------------------------------------------------------------------- //

/** Every node of a canonical tree, DESCENDANTS BEFORE PARENTS, iteratively.
 *
 *  ⛔ ITERATIVE ON PURPOSE, AND THIS IS THE WHOLE REASON THE MEASUREMENTS ARE
 *  SEPARATE FUNCTIONS. The escape corpus's `too_many_nodes` case is 8,001 nodes
 *  deep. A recursive counter would die inside the guard rather than inside the
 *  thing being guarded — and a guard that crashes is not a refusal. `parse.js`
 *  made its forbidden-node scan iterative for exactly this reason. */
function flatten(root) {
  const order = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()
    assertNode(node)
    order.push(node)
    if (node.type === 'op' || node.type === 'call' || node.type === 'offset') {
      if (!Array.isArray(node.args)) {
        refuse('interpret:node', `a ${node.type} node carries an \`args\` array; got ${JSON.stringify(node.args)}`)
      }
      for (const arg of node.args) stack.push(arg)
    }
  }
  order.reverse()          // a reversed pre-order puts every child before its parent
  return order
}

function assertNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    refuse('interpret:node', `got ${JSON.stringify(node) ?? String(node)}`)
  }
  if (!NODE_TYPES.includes(node.type)) {
    refuse('interpret:node',
      `unknown node type ${JSON.stringify(node.type)} — legal types are ${NODE_TYPES.join(', ')}`)
  }
}

/** The declared spec for a called name, or `resolve:function`. */
function fnSpec(name) {
  if (!own(TABLE.functions, name)) {
    refuse('resolve:function', `${JSON.stringify(name)} — this table declares ${declared(TABLE.functions)}`)
  }
  return TABLE.functions[name]
}

function assertArity(node, spec) {
  if (node.args.length !== spec.args.length) {
    refuse('resolve:arity',
      `— ${node.name} expects ${spec.args.length} arguments, got ${node.args.length}`)
  }
}

/** An `int` argument's value, which MUST be a `num` literal.
 *
 *  ⭐ NOT A CONVENIENCE — IT IS WHAT MAKES `maxLookback` A TREE SUM. The manifest
 *  declares every function's lookback as a constant or as a NAMED ARGUMENT
 *  (`arg1`), and `maxLookback(ast)` takes no bars and no inputs. A window that
 *  is an input name, or a computed column, is not decidable statically — and the
 *  moment lookback stops being decidable statically, Task 7's repaint linter
 *  stops being a tree sum and becomes a dataflow analysis, which is the exact
 *  trade `closedTable.json::_no_offset` refuses on the owner's behalf.
 *
 *  ⏳ HANDED FORWARD: this makes `sma(close, period)` — a window from a declared
 *  INPUT — unexpressible in v1. If Task 8 wants it, it re-opens the decidability
 *  question and belongs with the repaint-claim owner and the manifest owner
 *  together, exactly like `_no_offset_reopened_by` says. */
function windowLiteral(node, index) {
  const arg = node.args[index]
  if (!arg || arg.type !== 'num' || typeof arg.value !== 'number'
      || !Number.isInteger(arg.value) || arg.value < 1) {
    refuse('resolve:window',
      `— ${node.name} argument ${index} must be a whole number of at least 1, got `
      + `${JSON.stringify(arg && arg.type === 'num' ? arg.value : arg)}`)
  }
  return arg.value
}

/** The bar count of ONE `offset` node, VALIDATED. Refuses `interpret:offset`.
 *
 *  ⭐ THE SHAPE ALREADY MAKES A COMPUTED OFFSET INEXPRESSIBLE — `value` is a
 *  number on the node and there is no slot for an expression (see
 *  `parse.js::NODE_TYPES`). This is what stands between that guarantee and a
 *  PERSISTED tree, which is user data that did not necessarily come through
 *  `canonicalise`: a stored blob can spell `{type:'offset', value:-26}` by hand,
 *  and the negative is the one thing that must never reach the walker. Refusing
 *  it here is the same arrangement as `resolve:function` for a stored call name
 *  the manifest never declared.
 *
 *  ⛔ THE `< 0` LINE IS WHAT KEEPS A FORWARD REFERENCE INEXPRESSIBLE ON THE
 *  STORED SIDE, and it is why this is a refusal and not a clamp. A clamp to 0
 *  would silently turn `close[-26]` into `close` and draw a confident wrong
 *  column — the shape this whole phase exists to remove. */
function offsetBars(node) {
  if (node.args.length !== 1) {
    refuse('interpret:offset',
      `— an offset reads exactly one child column, got ${node.args.length}`)
  }
  const n = node.value
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    refuse('interpret:offset',
      `— got ${JSON.stringify(n)}; a bar offset counts backwards from the bar it writes`)
  }
  return n
}

/** The declared lookback of ONE call node: a constant, or a named argument. */
function ownLookback(node, spec) {
  const lb = spec.lookback
  if (typeof lb === 'number') return lb
  const m = /^arg(\d+)$/.exec(String(lb))
  if (!m) {
    refuse('interpret:node',
      `${JSON.stringify(node.name)} declares lookback ${JSON.stringify(lb)}, which is neither a constant nor an argument`)
  }
  return windowLiteral(node, Number(m[1]))
}

/** How many bars of history the tree needs. A TREE SUM, never a dataflow pass.
 *
 *  ⭐ THE SUM IS ALONG THE PATH, WHICH IS THE CASE A PER-ARGUMENT CHECK MISSES.
 *  `sma(sma(close, 5000), 5000)` needs 10,000 bars and neither 5,000 alone
 *  exceeds anything — `escapes.json::nested_lookback` exists for precisely that,
 *  and nothing else in the corpus catches it.
 *
 *  ⚠️ THIS IS A MEASUREMENT, NOT A GUARD. It returns the number; refusing a tree
 *  that asks for too much needs a DECLARED budget, and `compute.budget` is Task
 *  6's. Conservative by one bar per reduction on purpose: the manifest says
 *  `sma`'s lookback IS `arg1`, and an upper bound is the only thing a linter or
 *  a budget can safely use. */
export function maxLookback(ast) {
  const order = flatten(ast)
  const seen = new Map()
  for (const node of order) {
    if (node.type === 'num' || node.type === 'series') { seen.set(node, 0); continue }
    if (node.type === 'op') {
      let best = 0
      for (const arg of node.args) best = Math.max(best, seen.get(arg))
      seen.set(node, best)
      continue
    }
    if (node.type === 'offset') {
      // ⭐ THE TREE SUM, EXTENDED BY EXACTLY ONE TERM. `sma(close[2], 20)` needs
      // 20 + 2 bars and `close[2]` alone needs 2; the offset ADDS to whatever
      // its child already needs, the same way a call adds its own lookback to
      // its arguments'. That composition is the entire reason the offset is
      // bounded and backward-only — a signed one would make this a `max` over a
      // lattice and the linter a dataflow pass.
      seen.set(node, offsetBars(node) + seen.get(node.args[0]))
      continue
    }
    const spec = fnSpec(node.name)
    assertArity(node, spec)
    let best = 0
    for (let i = 0; i < node.args.length; i++) {
      if (spec.args[i] === 'int') { windowLiteral(node, i); continue }
      best = Math.max(best, seen.get(node.args[i]))
    }
    seen.set(node, ownLookback(node, spec) + best)
  }
  return seen.get(ast)
}

/** How many nodes the tree has. The number `budget:nodes` will threshold.
 *
 *  ⚠️ ITERATIVE, so it survives the 8,001-node tree that makes `interpret`
 *  itself overflow. That asymmetry is the point: Task 6's guard runs BEFORE the
 *  walker and must not need the walker to be safe first. */
export function nodeCount(ast) {
  return flatten(ast).length
}

// --------------------------------------------------------------------------- //
// interpret
// --------------------------------------------------------------------------- //

/** Evaluate a canonical AST over bars → one `Float64Array`.
 *
 *  @param {object} ast    a canonical tree (`parse.js::canonicalise`'s output)
 *  @param {Array}  bars   `[{t,o,h,l,c,v}, …]`
 *  @param {object} inputs declared instance inputs, by name; finite numbers only
 *  @param {object} [budget] the definition's stored `compute.budget`. Resolved
 *                  through `effectiveBudget`, so it can only ever TIGHTEN the
 *                  default and a stored blob cannot turn off its own limit.
 *  @param {object} [scalars] this SYMBOL's values for the table's declared
 *                  scalars. Every declared name is seeded whether or not it
 *                  appears here; an absent or unusable value seeds NaN.
 *  @returns {Float64Array} exactly `bars.length` long, NaN-padded
 *
 *  Throws `TableRefusal` for anything the table refuses. Everything else — a
 *  `RangeError` from a tree deep enough to overflow the stack, say — is NOT a
 *  refusal and must never be caught and relabelled as one; see the header. */
export function interpret(ast, bars, inputs, budget, scalars) {
  if (!Array.isArray(bars)) {
    // A PLAIN Error, NOT a TableRefusal: the table refuses what a USER wrote,
    // and the bars are the caller's. Conflating the two would let a wiring bug
    // read as "the formula was rejected" on a chip's tooltip.
    throw new Error(`interpret(ast, bars): bars must be an array, got ${typeof bars}`)
  }
  // ⭐ THE COMPUTE-TIME BUDGET, AND IT IS THE SAFETY HALF. It runs BEFORE the
  // scope is built and before a single node is walked, because the tree it
  // exists to refuse is the one that never returns. `assertBudget`'s
  // measurements are iterative, so this line survives the 8,001-node input that
  // makes the recursive walker below overflow — the guard does not need the
  // walker to be safe first.
  //
  // ⛔ NOT WRAPPED IN A `try`. A `RangeError` from a tree this admits must reach
  // the caller AS a `RangeError`; relabelling it as a budget refusal is the same
  // wrong-door defect this whole phase is about, wearing a different coat.
  assertBudget(ast, budget)
  const length = bars.length

  // ⛔ NULL PROTOTYPE, DELIBERATELY, AND IT IS THE FIRST OF TWO LOCKS.
  // `Object.create(null)` has no `toString`, no `constructor`, no `valueOf` —
  // so even a bare subscript finds nothing. The `hasOwnProperty` call in
  // `lookup` is the SECOND lock, because a future refactor seeding this from
  // `{}` would silently re-open every one of them and nothing else in this file
  // would notice.
  const scope = Object.create(null)
  for (const [name, spec] of Object.entries(TABLE.series)) {
    const col = new Float64Array(length)
    for (let i = 0; i < length; i++) {
      const v = bars[i] ? bars[i][spec.field] : undefined
      // ⚠️ NOT the Float64Array default of 0. A missing field is NOT a price of
      // zero; it is a bar we cannot compute on.
      col[i] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
    }
    scope[name] = col
  }

  // ⭐ A DECLARED SCALAR IS ALWAYS IN SCOPE. Present or absent, the name
  // RESOLVES — an absent value seeds NaN, exactly like a bar with a missing
  // field. That is what separates "declared but not known for this symbol" (a
  // HOLE a sweep counts and reports) from "a name this table never declared"
  // (`resolve:name`, a formula defect). ⛔ AND NEVER 0: a missing market cap
  // read as zero makes `market_cap > 1e9` a confident False, which is a broken
  // symbol wearing a quiet one's answer.
  //
  // ⚠️ A BARE NUMBER, NOT A COLUMN. `lift1/2/3` already broadcast a scalar
  // against a column and `toColumn` already fills `bars.length` from a bare
  // number, so a scalar-only tree is a flat column — which is what makes it
  // composable with a per-bar one.
  //
  // ⛔ AND `inputs` IS SEEDED AFTER, SO THE SHADOW CHECK BELOW SEES IT.
  {
    const provided = scalars || {}
    for (const name of Object.keys(TABLE.scalars)) {
      const v = own(provided, name) ? provided[name] : undefined
      scope[name] = typeof v === 'number' && Number.isFinite(v) ? v : NaN
    }
  }

  for (const [name, value] of Object.entries(inputs || {})) {
    // ⛔ AND A RECURRENCE BINDING IS RESERVED TOO. `self` is not in `scope` and
    // not in `functions`, so without this line an input could take the name and
    // every body in the definition would silently read the KNOB instead of the
    // running value — a formula that still computes, and computes the wrong
    // thing. The list is derived from the manifest, never typed.
    if (own(scope, name) || own(TABLE.functions, name) || RECURRENCE_BINDINGS.includes(name)) {
      // A plain Error again: a definition whose input shadows `close` is a
      // WIRING defect, and silently letting it win would change what every
      // formula on that definition means.
      throw new Error(
        `interpret: the input ${JSON.stringify(name)} shadows a table name. `
        + `The table declares ${declared(TABLE.series)}, ${declared(TABLE.functions)} `
        + `and ${declared(TABLE.scalars)}.`)
    }
    // Only finite numbers are seeded. An input that is a function, an object or
    // a string is NOT a name this table can resolve, and leaving it out makes
    // referencing it a loud `resolve:name` refusal rather than a column of
    // `undefined` — which is what a scope that accepted anything would produce.
    if (typeof value === 'number' && Number.isFinite(value)) scope[name] = value
  }

  const lookup = (name) => {
    // ⛔ `hasOwnProperty.call`, NEVER `scope[name]`. See the header.
    if (!own(scope, name)) {
      // ⭐ A RECURRENCE BINDING IS NEVER IN SCOPE, EVEN INSIDE ITS OWN BODY —
      // `runRecurrence`'s step loop intercepts it before the walker gets here.
      // So reaching this line with one means it was written somewhere no running
      // value is being computed, and saying THAT is worth a guard of its own:
      // `unknown name "self"` beside a list of every price field would send the
      // reader looking for a typo in a name that is spelled correctly.
      if (RECURRENCE_BINDINGS.includes(name)) {
        refuse('interpret:recurrence',
          `— \`${name}\` was read outside the update of a ${declared(RECURRENCES)} call`)
      }
      refuse('resolve:name',
        `${JSON.stringify(name)} — this table declares ${Object.keys(scope).join(', ')}`)
    }
    return scope[name]
  }

  const evalNode = (n) => {
    // ⚠️ NOT `assertNode` — the `default` arm below IS the guard here, and it has
    // to be REACHABLE for the mutation that deletes it to be lethal. A validating
    // pre-pass would make `default:` unreachable, which is how a guard becomes an
    // equivalent mutant: deleting it changes nothing and no test can notice.
    if (!n || typeof n !== 'object' || Array.isArray(n)) {
      return refuse('interpret:node', `got ${JSON.stringify(n) ?? String(n)}`)
    }
    if ((n.type === 'op' || n.type === 'call') && !Array.isArray(n.args)) {
      return refuse('interpret:node',
        `a ${n.type} node carries an \`args\` array; got ${JSON.stringify(n.args)}`)
    }
    switch (n.type) {
      case 'num':
        if (typeof n.value !== 'number' || !Number.isFinite(n.value)) {
          refuse('interpret:node', `a num node carries a finite number; got ${JSON.stringify(n.value)}`)
        }
        return n.value
      case 'series':
        return lookup(n.name)
      case 'offset': {
        const back = offsetBars(n)
        // ⛔ MATERIALISED TO A COLUMN FIRST, ALWAYS. A scalar child (`20[3]`, or
        // a per-symbol scalar) has no history either, and broadcasting it and
        // THEN shifting is what makes "three bars ago" mean the same thing for
        // every child kind in both lanes. Special-casing the scalar to itself
        // would answer a question about a bar that does not exist.
        const src = toColumn(evalNode(n.args[0]), length)
        const out = nan(length)
        // ⭐⭐ THE LEFT EDGE, AND IT IS THE DEFINING RULE OF THIS ENGINE. `i <
        // back` has no bar to read, so the answer is NOT COMPUTABLE — NaN. ⛔
        // NEVER 0 and ⛔ NEVER `src[0]`: a clamped first bar makes `close >
        // close[3]` a confident answer on bar 1, which is the exact defect class
        // (`close > sma(close,300)` returning 200 confident zeroes) this codebase
        // spent a week removing. `nan(length)` already fills the prefix; the loop
        // deliberately starts AT `back` rather than clamping an index.
        for (let i = back; i < length; i++) out[i] = src[i - back]
        return out
      }
      case 'op':
        return applyOp(n, n.args.map(evalNode))
      case 'call': {
        const spec = fnSpec(n.name)
        assertArity(n, spec)
        // ⭐ THE ONE ARM THAT DOES NOT EVALUATE ITS ARGUMENTS EAGERLY, and the
        // manifest says so rather than this line asserting it: an entry that
        // declares a `recurrence` carries a per-bar BODY, not a column. See
        // `runRecurrence`.
        if (own(RECURRENCES, n.name)) return runRecurrence(n, spec)
        const args = []
        for (let i = 0; i < n.args.length; i++) {
          args.push(spec.args[i] === 'int'
            ? windowLiteral(n, i)
            : toColumn(evalNode(n.args[i]), length))
        }
        return FN[n.name](...args)
      }
      default:
        // ⛔ NOT A FALLTHROUGH TO SOMETHING PLAUSIBLE. `assertNode` above already
        // refuses anything outside the four types, so this is unreachable while
        // the two agree — and it is written as a refusal rather than a `return
        // NaN` because a tree nobody authored must refuse, not draw a blank line
        // that reads exactly like a warmup.
        return refuse('interpret:node',
          `unknown node type ${JSON.stringify(n.type)} — legal types are ${NODE_TYPES.join(', ')}`)
    }
  }

  const applyOp = (node, values) => {
    const name = node.name
    if (name === '?:') {
      if (values.length !== 3) {
        refuse('resolve:arity', `— the ternary ?: expects 3 arguments, got ${values.length}`)
      }
      return lift3(values[0], values[1], values[2], TERNARY, length)
    }
    if (own(UNARY, name)) {
      if (values.length !== 1) {
        refuse('resolve:arity', `— ${name} expects 1 arguments, got ${values.length}`)
      }
      return lift1(values[0], UNARY[name], length)
    }
    if (own(BINARY, name)) {
      if (values.length !== 2) {
        refuse('resolve:arity', `— ${name} expects 2 arguments, got ${values.length}`)
      }
      return lift2(values[0], values[1], BINARY[name], length)
    }
    return refuse('interpret:operator',
      `${JSON.stringify(name)} — this table declares ${declared(TABLE.operators)}`)
  }

  /** One operator, applied to BARE NUMBERS. The recurrence step loop's arm.
   *
   *  ⭐ THE SAME `UNARY`/`BINARY`/`TERNARY` ENTRIES `applyOp` USES, and that is
   *  not a convenience — `lift1/2/3` are pure elementwise applications of these
   *  very functions, so a body evaluated one bar at a time and a column
   *  evaluated all at once are the SAME ARITHMETIC by construction. A second
   *  scalar table here would be a second grammar, and the first thing to
   *  diverge would be the NaN rule (`cmp` answers 0, `logical` answers NaN) —
   *  a difference no cross-lane parity run would catch, because it would be
   *  wrong identically in both lanes. */
  const applyOpStep = (node, values) => {
    const name = node.name
    if (name === '?:') {
      if (values.length !== 3) {
        refuse('resolve:arity', `— the ternary ?: expects 3 arguments, got ${values.length}`)
      }
      return TERNARY(values[0], values[1], values[2])
    }
    if (own(UNARY, name)) {
      if (values.length !== 1) {
        refuse('resolve:arity', `— ${name} expects 1 arguments, got ${values.length}`)
      }
      return UNARY[name](values[0])
    }
    if (own(BINARY, name)) {
      if (values.length !== 2) {
        refuse('resolve:arity', `— ${name} expects 2 arguments, got ${values.length}`)
      }
      return BINARY[name](values[0], values[1])
    }
    return refuse('interpret:operator',
      `${JSON.stringify(name)} — this table declares ${declared(TABLE.operators)}`)
  }

  /** A declared recurrence — bar-to-bar state, bounded so the answer cannot
   *  depend on which bars the caller happened to fetch.
   *
   *  ⭐⭐ THE DEFINITION, AND EVERYTHING ELSE HERE FOLLOWS FROM IT. At bar `i`
   *  the state is SEEDED FRESH at bar `i - warmup` and the body is applied once
   *  per bar across `(i - warmup, i]`. So the value at bar `i` is a function of
   *  exactly `warmup + 1` bars and nothing else — the same bargain
   *  `sma(close, 20)` makes, and the reason panning a chart cannot change it.
   *
   *  ⛔ THE OBVIOUS IMPLEMENTATION IS THE WRONG ONE, AND IT IS WRONG QUIETLY. A
   *  single forward pass from bar 0 is O(n) instead of O(n × warmup) and gives
   *  a DIFFERENT number for the same bar the moment the window moves — which is
   *  `lesson_a_derived_value_must_not_depend_on_the_request` exactly: a rolling
   *  value needs a warm-up prefix, a cumulative one needs an absolute seed, and
   *  "wherever this fetch started" is neither. Nothing about the output would
   *  look wrong; it would simply disagree with itself between two requests.
   *
   *  ⛔ AND THE PREFIX IS NaN, NEVER A SHORT RUN. Bars before `warmup` have no
   *  seed bar to start from, so they are not computable — a partial accumulation
   *  there would be a confident wrong number wearing a warm-up's clothes, the
   *  same shape as the clamped `src[0]` the offset arm refuses. */
  const runRecurrence = (node, spec) => {
    const rec = spec.recurrence
    const bind = rec.binds
    const warmup = windowLiteral(node, rec.warmup)
    const body = node.args[rec.body]

    // ⭐ THE ONE COST IN THIS ENGINE THE STATIC BUDGET CANNOT SEE. `budget.js`
    // takes no bars, and `warmup` alone is already capped by `budget:lookback`
    // like any other window — but the WORK is `bars × warmup`, and the bar count
    // arrives with the caller. So it is measured here, where it is known, and
    // refused BY NAME rather than turning a chart into a hang.
    if (length * warmup > MAX_RECURRENCE_STEPS) {
      refuse('interpret:steps',
        `— ${node.name} over ${length} bars with a ${warmup}-bar warm-up is `
        + `${length * warmup} steps and the ceiling is ${MAX_RECURRENCE_STEPS}`)
    }

    const isBind = (x) => !!x && typeof x === 'object' && x.type === 'series' && x.name === bind

    // Which nodes of the body read the running value. Memoised over node
    // IDENTITY, so a tree that shares a subtree object answers once.
    const readsBind = new Map()
    const reads = (x) => {
      if (readsBind.has(x)) return readsBind.get(x)
      let answer = isBind(x)
      if (!answer && x && typeof x === 'object' && Array.isArray(x.args)) {
        for (const child of x.args) if (reads(child)) { answer = true; break }
      }
      readsBind.set(x, answer)
      return answer
    }

    // ⭐ THE PARTITION, AND IT IS WHAT KEEPS THIS AFFORDABLE. Every maximal
    // subtree that does NOT read the running value is an ordinary column and is
    // evaluated ONCE, by the ordinary walker. Only the spine that actually
    // depends on the previous bar is re-evaluated per step — so `sma(volume,20)`
    // inside a body costs one pass, not `bars × warmup` of them.
    const columns = new Map()
    const planned = new Set()
    const plan = (x) => {
      if (planned.has(x)) return
      planned.add(x)
      if (!reads(x)) { columns.set(x, evalNode(x)); return }
      if (isBind(x)) return
      if (x.type === 'offset') {
        refuse('interpret:recurrence',
          `— \`${bind}\` sits under a bar offset in ${node.name}(…). The step loop holds `
          + `ONE previous value, not a history of them.`)
      }
      if (x.type === 'call') {
        const inner = fnSpec(x.name)
        if (own(RECURRENCES, x.name)) {
          refuse('interpret:recurrence',
            `— \`${bind}\` sits inside a nested ${x.name}(…), so which running value it names `
            + `would depend on where a reader started counting.`)
        }
        if (!isPointwise(inner)) {
          refuse('interpret:recurrence',
            `— \`${bind}\` sits inside ${x.name}(…), which reads a window of bars rather than `
            + `one. Write the windowed part outside the update, or spell it with `
            + `${declared(TABLE.operators)}.`)
        }
        assertArity(x, inner)
      }
      for (const child of (Array.isArray(x.args) ? x.args : [])) plan(child)
    }
    plan(body)

    const step = (x, j, carried) => {
      if (columns.has(x)) {
        const v = columns.get(x)
        return isColumn(v) ? v[j] : v
      }
      if (isBind(x)) return carried
      const values = x.args.map((child) => step(child, j, carried))
      if (x.type === 'op') return applyOpStep(x, values)
      return POINTWISE[x.name](...values)
    }

    const seed = toColumn(evalNode(node.args[rec.seed]), length)
    const out = nan(length)
    for (let i = warmup; i < length; i++) {
      let carried = seed[i - warmup]
      for (let j = i - warmup + 1; j <= i; j++) carried = step(body, j, carried)
      out[i] = carried
    }
    return out
  }

  return toColumn(evalNode(ast), length)
}

// --------------------------------------------------------------------------- //
// lifting scalars and columns
// --------------------------------------------------------------------------- //
//
// A scalar stays a scalar until it meets a column, so `20 * 2` is 40 (a number)
// and `close * 2` is a column. That keeps `sma(close, 10 * 2)`… out of reach,
// deliberately — `windowLiteral` refuses a computed window because `maxLookback`
// must stay decidable without evaluating anything.

function lift1(a, f, length) {
  if (!isColumn(a)) return f(a)
  const out = nan(length)
  for (let i = 0; i < length; i++) out[i] = f(a[i])
  return out
}

function lift2(a, b, f, length) {
  if (!isColumn(a) && !isColumn(b)) return f(a, b)
  const ca = isColumn(a) ? a : null
  const cb = isColumn(b) ? b : null
  const out = nan(length)
  for (let i = 0; i < length; i++) out[i] = f(ca ? ca[i] : a, cb ? cb[i] : b)
  return out
}

function lift3(t, a, b, f, length) {
  if (!isColumn(t) && !isColumn(a) && !isColumn(b)) return f(t, a, b)
  const ct = isColumn(t) ? t : null
  const ca = isColumn(a) ? a : null
  const cb = isColumn(b) ? b : null
  const out = nan(length)
  for (let i = 0; i < length; i++) {
    out[i] = f(ct ? ct[i] : t, ca ? ca[i] : a, cb ? cb[i] : b)
  }
  return out
}
