// app/src/components/chart/engine/pineCompare.js
//
// ─── ⭐⭐ PINE'S FLOAT COMPARISON — ONE AUTHORITY (engine 78 (#1858), Q-FCMP / Q-FCMP2) ──────────
//
// TradingView's Pine compares two floats with an ABSOLUTE EPSILON, not exactly and not by rounding:
//
//   a == b   when  a === b  or  |a - b| <= PINE_EQ_EPSILON
//   a != b   when  not (a == b)
//   a <  b   when  not (a == b) and a < b        (and `<=`, `>`, `>=` the same way)
//   any operand `na`  ->  every one of the six is FALSE, `!=` included
//
// Measured, never assumed (docs/pine/capture-queue-2026-11-18-float-compare.md, Q-FCMP; and
// docs/pine/capture-queue-2026-11-18-float-tolerance-form.md, Q-FCMP2, 16 captures):
//   · `(0.1 + 0.2) == 0.3` is true, `1.0 + 3e-14 == 1.0` is true, and AMEX:SPY 1D bar 5,333's up / down
//     moves, 2.842e-14 apart in TradingView's own doubles, compare EQUAL, neither greater (Q-FCMP F01-F12).
//   · Pairs 2e-14 apart either side of a 1e-9 bucket edge are EQUAL, pairs 3e-10 apart inside one are NOT
//     (vw-fcmp-form T20-T25, T08-T09): an epsilon on the difference. The v6 reference's remark on `==`
//     ("rounds float operands to nine fractional digits") is NOT what TradingView runs; the captures are.
//   · The edge: 0 vs 1e-10 and -5e-11 vs 5e-11 are EQUAL, the double just above 1e-10 is not
//     (vw-fcmp-builtins-v2 E01-E14, on SPY and RDDT): `<=`, at exactly the double 1e-10.
//   · Absolute at every magnitude from 1e-12 to 1e9 (vw-fcmp-magnitude M01-M34); all six operators share it;
//     `na` falsifies all six (T45-T48); the RUNTIME rule is the same in v1-v6 (the form twins).
//   · ONE exception, at compile time (`pineConstCompareExact`): in v1-v4 a comparison whose BOTH operands are
//     compile-time constants is EXACT (vw-fcmp-form-v1..v4 T50, vw-fcmp-const-v4 C01-C04, C10-C14); inputs,
//     series and reassigned names stay tolerant (C05-C09). v5 / v6 are tolerant everywhere.
//   · BUILT-INS do not all share it (vw-fcmp-builtins-v2): tolerant inside are ta.rising / ta.falling, a float
//     `switch`, array.indexof / array.includes, ta.percentrank and ta.dmi; EXACT inside are ta.crossover /
//     crossunder / cross, ta.highest / lowest(bars), ta.pivothigh / pivotlow, math.max / min / sign,
//     array.max / min, array.sort and ta.mode. Each kernel is told which, never by default.
//
// ⛔ ONE NUMBER, ONE PLACE. `PINE_EQ_EPSILON` and `PINE_EQ_INCLUSIVE` are DECLARED here, each on one line
//   (`export const NAME = <literal>`), and the server READS these declarations
//   (`api/services/pine_compare.py::read_pine_compare_declarations`): never a second literal in Python.
// ⛔ PINE DOCUMENTS ONLY (coordinator ruling D1, 2026-11-18). A native / PCF / thinkScript formula keeps
//   IEEE comparison byte for byte; which table a document's evaluation reads is `definitionSemantics.js::
//   semanticsOptsFor` (`pineCompare: true`), picked per evaluation by `interpret.js::binaryFor`.
// ⛔ IMPORT-FREE. interpret.js, vm.js, bind.js, pine.js, objectRuntime.js, collections.js and indicators.js
//   all read this module; it reads nothing, so it can never close an import cycle.

/** The absolute epsilon two Pine floats are equal within. Measured (Q-FCMP2 E rows). */
export const PINE_EQ_EPSILON = 1e-10
/** Is a difference of exactly `PINE_EQ_EPSILON` still equal (`<=`)? Measured: yes (Q-FCMP2 E10-E14). */
export const PINE_EQ_INCLUSIVE = true

const isNan = (x) => x !== x

/** Pine `==` on two NUMBERS (neither `na`): exact equality first, so `Infinity == Infinity` holds and
 *  a value equal to itself never pays the subtraction. */
export function pineEq(a, b) {
  if (a === b) return true
  const d = Math.abs(a - b)
  return PINE_EQ_INCLUSIVE ? d <= PINE_EQ_EPSILON : d < PINE_EQ_EPSILON
}

/** The six, as booleans, on two numbers neither of which is `na` (a caller handles `na` first). */
export const pineGt = (a, b) => a > b && !pineEq(a, b)
export const pineLt = (a, b) => a < b && !pineEq(a, b)
export const pineGe = (a, b) => a > b || pineEq(a, b)
export const pineLe = (a, b) => a < b || pineEq(a, b)
export const pineNe = (a, b) => !pineEq(a, b)

/** The six as the operator table's 0/1 answer, `na` -> 0 for all six (the X23 rule, `cmp`). */
const cmp01 = (f) => (a, b) => (isNan(a) || isNan(b) ? 0 : (f(a, b) ? 1 : 0))
export const PINE_CMP = Object.freeze({
  '>': cmp01(pineGt),
  '<': cmp01(pineLt),
  '>=': cmp01(pineGe),
  '<=': cmp01(pineLe),
  '==': cmp01(pineEq),
  '!=': cmp01(pineNe),
})

/** The exact (IEEE) six with the same `na` rule: a native document's table, and the comparison every
 *  construct measured exact uses (v1-v4 compile-time constants, the exact built-ins). */
export const EXACT_CMP = Object.freeze({
  '>': cmp01((a, b) => a > b),
  '<': cmp01((a, b) => a < b),
  '>=': cmp01((a, b) => a >= b),
  '<=': cmp01((a, b) => a <= b),
  '==': cmp01((a, b) => a === b),
  '!=': cmp01((a, b) => a !== b),
})

/** Do the exact and the Pine compare DISAGREE on this pair? Only when the two are unequal doubles within
 *  the epsilon — the one case a compile-time fold has to know which rule it serves. */
export function pineCompareAmbiguous(a, b) {
  return typeof a === 'number' && typeof b === 'number' && !isNan(a) && !isNan(b) && a !== b && pineEq(a, b)
}

/** ⭐ The last Pine version whose compiler compares two COMPILE-TIME CONSTANTS exactly (Q-FCMP2: v1-v4 read
 *  T50 / C01-C04 / C10-C14 exact, v5 / v6 tolerant). */
export const PINE_CONST_COMPARE_EXACT_THROUGH = 4
/** Does this Pine version compare two compile-time constants exactly? (`null`: no pragma, v1.) */
export function pineConstCompareExact(version) {
  return version === null || version === undefined || (Number.isInteger(version) && version <= PINE_CONST_COMPARE_EXACT_THROUGH)
}

const CMP_OPS = Object.freeze(['>', '<', '>=', '<=', '==', '!='])

/** ⭐⭐ THE COMPILE-TIME FOLD (Q-FCMP2: the v1-v4 form twins' T50, vw-fcmp-const-v4 C01-C04 / C10-C14): the 0/1
 *  a comparison of two COMPILE-TIME CONSTANTS `a OP b` folds to in this Pine version, or `null` when there is
 *  nothing to fold — v5 / v6 (tolerant at compile time too, the run's own rule), or a pair both rules answer
 *  alike (the tree keeps its shape and the run computes the same answer). The CALLER proves both operands are
 *  constants: an input, a series or a reassigned name is not one (C05-C09 read tolerant). */
export function constCompareFold(op, a, b, version) {
  if (!CMP_OPS.includes(op) || !pineConstCompareExact(version) || !pineCompareAmbiguous(a, b)) return null
  return EXACT_CMP[op](a, b)
}

/** The value of a canonical CONSTANT tree — numbers and `+ - * /` (and unary `-`) over them, nothing else — or
 *  `null`. What the compile-time fold may read as "a constant" once the caller has ruled out inputs and
 *  reassigned names (a declared input is a `series` leaf, a bar read a `series`, a call a `call`). */
export function constantTreeValue(t, depth = 0) {
  if (!t || typeof t !== 'object' || depth > 64) return null
  if (t.type === 'num') return typeof t.value === 'number' && Number.isFinite(t.value) ? t.value : null
  if (t.type !== 'op' || !Array.isArray(t.args)) return null
  if (t.name === 'u-' && t.args.length === 1) {
    const v = constantTreeValue(t.args[0], depth + 1)
    return v === null ? null : -v
  }
  if (!['+', '-', '*', '/'].includes(t.name) || t.args.length !== 2) return null
  const x = constantTreeValue(t.args[0], depth + 1)
  const y = constantTreeValue(t.args[1], depth + 1)
  if (x === null || y === null) return null
  const v = t.name === '+' ? x + y : t.name === '-' ? x - y : t.name === '*' ? x * y : x / y
  return Number.isFinite(v) ? v : null
}

/**
 * ⭐ THE INTERVAL FORM, for the engine's range reasoning (`interpret.js` RANGE_ORDER / `stepRange`):
 * over x in [A.lo, A.hi] and y in [B.lo, B.hi] (finite, not `na`), can `x OP y` be true, and can it be
 * false, under THIS compare?
 *
 * Sound because each ordering is MONOTONE in its operands: `pineGt(x, y)` is `x - y > EPS`, so over the
 * box it is true somewhere exactly when it is true at (A.hi, B.lo) and false somewhere exactly when it is
 * false at (A.lo, B.hi). Equality is true somewhere when the closest pair is equal, and false somewhere
 * when a farthest pair is not. `cmpTable` is the evaluation's own table (`PINE_CMP`, `EXACT_CMP`, or an
 * operator table holding one of them), so the proof and the run never read two different rules.
 */
export function compareRange(op, A, B, cmpTable) {
  const T = (o, x, y) => cmpTable[o](x, y) === 1
  switch (op) {
    case '>': return { canT: T('>', A.hi, B.lo), canF: !T('>', A.lo, B.hi) }
    case '>=': return { canT: T('>=', A.hi, B.lo), canF: !T('>=', A.lo, B.hi) }
    case '<': return { canT: T('<', A.lo, B.hi), canF: !T('<', A.hi, B.lo) }
    case '<=': return { canT: T('<=', A.lo, B.hi), canF: !T('<=', A.hi, B.lo) }
    case '==': {
      // closest pair: the overlap (0 apart) when the boxes overlap, else the two facing ends
      const overlap = A.lo <= B.hi && B.lo <= A.hi
      const canT = overlap || (A.hi < B.lo ? T('==', A.hi, B.lo) : T('==', A.lo, B.hi))
      // farthest pair: one of the two far-end pairs
      const canF = !T('==', A.lo, B.hi) || !T('==', A.hi, B.lo)
      return { canT, canF }
    }
    case '!=': {
      const eq = compareRange('==', A, B, cmpTable)
      return { canT: eq.canF, canF: eq.canT }
    }
    default: return null
  }
}

/** How far past `c` a branch of `s OP c` can still reach under this table, for the engine's state
 *  narrowing (`interpret.js::refine`): 0 for IEEE, and for the Pine compare twice the epsilon (a bound
 *  WIDER than the truth is sound; narrower is not). */
export function compareSlack(cmpTable) {
  return cmpTable && cmpTable['=='] === EXACT_CMP['=='] ? 0 : 2 * PINE_EQ_EPSILON
}

/** ⭐ THE STATE NARROWING `interpret.js::refine` applies: the states `s` in `[lo, hi]` for which `s OP c`
 *  (`OP` one of `<` `<=` `>` `>=`) can answer `branch`, as `{lo, hi}` — never narrower than the truth under
 *  `cmpTable` (railed by a soundness grid, `pineCompare.test.js`). */
export function compareNarrow(op, branch, lo, hi, c, cmpTable) {
  const slack = compareSlack(cmpTable)
  const below = (op === '<' || op === '<=') === branch
  return below ? { lo, hi: Math.min(hi, c + slack) } : { lo: Math.max(lo, c - slack), hi }
}
