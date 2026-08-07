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
//   * `budget:nodes` and `budget:lookback` are NOT implemented. There is no
//     declared budget yet (`compute.budget` is Task 6's). What IS here is the
//     MEASUREMENT those guards threshold — `nodeCount(ast)` and
//     `maxLookback(ast)` — and both are ITERATIVE, so the guard Task 6 writes
//     cannot die inside itself on the input it exists to refuse. A deep tree
//     therefore still blows `interpret`'s stack today; that is a `RangeError`,
//     it is an ESCAPE, and it must never be dressed up as a table refusal.

import { TABLE, NODE_TYPES } from './parse.js'

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
})

function refuse(guard, detail) {
  throw new TableRefusal(guard, `${REFUSALS[guard]} ${detail}`)
}

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
// carries its own idea of what its arguments are, and a table edit reaches all
// eleven at once.
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
function emaCol(series, n) {
  const out = nan(series.length)
  const k = 2 / (n + 1)
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
    for (let i = 0; i < series.length; i++) out[i] = Math.abs(series[i])
    return out
  },
  // ⚠️ NaN PROPAGATES, WRITTEN OUT RATHER THAN INHERITED FROM `Math.min`. JS's
  // `Math.min(NaN, x)` is NaN and Python's `min` returns whichever it meets
  // first — a real cross-lane divergence the corpus names explicitly. Spelling
  // the rule kills it in both lanes instead of relying on one language's luck.
  min: (a, b) => elementwise2(a, b, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.min(x, y))),
  max: (a, b) => elementwise2(a, b, (x, y) => (Number.isNaN(x) || Number.isNaN(y) ? NaN : Math.max(x, y))),
  crossOver: (a, b) => crossing(a, b, (an, bn, ap, bp) => an > bn && ap <= bp),
  crossUnder: (a, b) => crossing(a, b, (an, bn, ap, bp) => an < bn && ap >= bp),
})

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
    if (node.type === 'op' || node.type === 'call') {
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
 *  @returns {Float64Array} exactly `bars.length` long, NaN-padded
 *
 *  Throws `TableRefusal` for anything the table refuses. Everything else — a
 *  `RangeError` from a tree deep enough to overflow the stack, say — is NOT a
 *  refusal and must never be caught and relabelled as one; see the header. */
export function interpret(ast, bars, inputs) {
  if (!Array.isArray(bars)) {
    // A PLAIN Error, NOT a TableRefusal: the table refuses what a USER wrote,
    // and the bars are the caller's. Conflating the two would let a wiring bug
    // read as "the formula was rejected" on a chip's tooltip.
    throw new Error(`interpret(ast, bars): bars must be an array, got ${typeof bars}`)
  }
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

  for (const [name, value] of Object.entries(inputs || {})) {
    if (own(scope, name) || own(TABLE.functions, name)) {
      // A plain Error again: a definition whose input shadows `close` is a
      // WIRING defect, and silently letting it win would change what every
      // formula on that definition means.
      throw new Error(
        `interpret: the input ${JSON.stringify(name)} shadows a table name. `
        + `The table declares ${declared(TABLE.series)} and ${declared(TABLE.functions)}.`)
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
      case 'op':
        return applyOp(n, n.args.map(evalNode))
      case 'call': {
        const spec = fnSpec(n.name)
        assertArity(n, spec)
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
