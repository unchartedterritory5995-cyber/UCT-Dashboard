// app/src/components/chart/engine/ast/barIndexShift.js
//
// ─── ⭐⭐ C45 — DOES THIS TREE'S VALUE DEPEND ON WHERE THE SERIES STARTS? ─────────
//
// Pine's `bar_index` counts from the first bar of the symbol's HISTORY. This
// engine's `barindex` counts from the first bar it was HANDED. On a chart whose
// loaded bars do not begin at the listing the two differ by a constant `D` — the
// number of earlier bars TradingView holds and we do not — and `D` is unknown
// (measured on `vw-offset-na-spy-1d-2026-09-30`: the vendor's control row reads
// 8175 on the bar this engine calls 0).
//
// So every value is `V + D·K`, and the question a lane asks is what `K` is:
//
//   'inv'   K = 0 — the value does not move with `D`. `bar_index - bar_index[5]`,
//           `bar_index - ta.valuewhen(c, bar_index, 0) < 10`, a regression line
//           `x·slope + (ȳ − slope·x̄)`. SERVED: it is TradingView's number.
//   'pos'   K = 1 — the value IS a bar index (`bar_index - 5`, the bar a pivot
//           stood on). As a DRAWING'S X-COORDINATE it names the same bar on both
//           platforms, so the object lane serves it there. As a plotted value, a
//           text, a price or a test against a constant it is `D` away from
//           TradingView's — withheld.
//   'dep'   anything else, and anything this file cannot prove: `bar_index % n`,
//           `bar_index > 100`, `bar_index * close`. Withheld.
//
// ⛔ A PROOF, NOT A PROBE. Evaluating the tree at a few trial offsets was
// considered and rejected: `bar_index % 7 == 0` agrees at every offset that is a
// multiple of 7, and `bar_index == 5000` at every offset tried. This is a small
// symbolic pass instead — each node is `P0 + D·P1` with `P0`, `P1` polynomials
// over opaque atoms — and what it cannot decide is 'dep', the withholding side.
//
// ⭐ WHY POLYNOMIALS AND NOT THREE LABELS. A least-squares line is
// `bar_index · slope + (sma(y) − slope · sma(bar_index))`: two terms that each
// move with `D` and cancel exactly. Labels cannot see the cancellation; a
// polynomial in the atom `slope` can (heat-map-seasons, door-attached, plots it).
// Linear operators are normalised through (`sma(a·y) = a·sma(y)`,
// `sma(y + z) = sma(y) + sma(z)`), so the two spellings of one sum meet.
//
// ⭐ THE ONE PER-BAR CASE: A THRESHOLD. `bar_index > 100` — the commonest use of
// the index after a coordinate, a warm-up guard — is not constant in `D`, but it
// is MONOTONE: `D` is never negative, so where the test is already true on this
// chart it is true on TradingView's, whatever `D` is. It is unknown only on the
// bars where this chart answers false (bars 0..100 here), which is a mask, not a
// refusal. The pass answers 'inv' for such a comparison and LISTS it
// (`thresholds`); `interpret.js::barIndexMask` withholds the bars it cannot
// vouch for and what reaches back to them. `==` / `!=` have no such side: 'dep'.
//
// The Python mirror is `api/services/ast_interpret.py::bar_index_class`; one
// fixture holds both lanes to the same answer (`tests/fixtures/ast/
// bar_index_shift_parity.json`, written by `barIndexShift.test.js`).

import { RECURRENCES } from './parse.js'

/** The clock leaves that count bars from the first one held. */
export const BAR_INDEX_LEAVES = Object.freeze(['barindex', 'lastbarindex'])

/** Does this tree read a bar-index leaf at all? Iterative: it is asked of every
 *  tree, including ones too deep to recurse into. */
export function readsBarIndex(tree) {
  const stack = [tree]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (n.type === 'series' && BAR_INDEX_LEAVES.includes(n.name)) return true
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  return false
}

// ── polynomials over opaque atoms ───────────────────────────────────────────────
//
// A polynomial is `Map<monomialKey, coefficient>`; a monomial key is its atom keys,
// sorted, joined by `MONO_SEP` (the empty key is the constant term). An atom is a
// canonical subtree named by its structural key; `1/<key>` is its reciprocal.

const MONO_SEP = '\u0002'
const INV_PREFIX = '1/'
/** Past this many monomials a product is not expanded: the tree is 'dep'. */
const MAX_TERMS = 96
/** Past this depth the pass stops and answers 'dep'. A canonical tree the budget
 *  admits holds at most 128 nodes, so it is never deeper; the Python lane stops
 *  at the same depth (its recursion limit is the tighter of the two). */
const MAX_DEPTH = 128
const EPS = 1e-12

class Unprovable extends Error {}
const unprovable = () => { throw new Unprovable('bar-index dependence not provable') }

function makeAlgebra() {
  const keyMemo = new Map()
  const atomTree = new Map()
  /** The structural key of a canonical subtree (`type`, `name`, `value`, `args`). */
  const keyOf = (n) => {
    if (!n || typeof n !== 'object') return `l${JSON.stringify(n === undefined ? null : n)}`
    const hit = keyMemo.get(n)
    if (hit !== undefined) return hit
    const args = Array.isArray(n.args) ? n.args.map(keyOf).join(',') : '-'
    const k = `${n.type}\u0001${JSON.stringify(n.name ?? null)}\u0001${JSON.stringify(n.value ?? null)}\u0001(${args})`
    keyMemo.set(n, k)
    return k
  }
  const atomOf = (tree) => {
    const k = keyOf(tree)
    if (!atomTree.has(k)) atomTree.set(k, tree)
    return k
  }
  const inverseKey = (k) => (k.startsWith(INV_PREFIX) ? k.slice(INV_PREFIX.length) : INV_PREFIX + k)
  const treeOfAtom = (k) => (k.startsWith(INV_PREFIX)
    ? { type: 'op', name: '/', args: [{ type: 'num', value: 1 }, atomTree.get(k.slice(INV_PREFIX.length))] }
    : atomTree.get(k))
  /** Sorted atom keys with every `a · 1/a` pair cancelled. */
  const normalAtoms = (atoms) => {
    const count = new Map()
    for (const a of atoms) {
      const inv = inverseKey(a)
      if (count.get(inv) > 0) count.set(inv, count.get(inv) - 1)
      else count.set(a, (count.get(a) || 0) + 1)
    }
    const out = []
    for (const [a, n] of count) for (let i = 0; i < n; i += 1) out.push(a)
    return out.sort()
  }
  const monoKey = (atoms) => normalAtoms(atoms).join(MONO_SEP)
  const atomsOf = (key) => (key === '' ? [] : key.split(MONO_SEP))

  const ZERO = new Map()
  const constant = (c) => (Math.abs(c) < EPS ? ZERO : new Map([['', c]]))
  const atom = (tree) => new Map([[atomOf(tree), 1]])
  const add = (a, b, sign = 1) => {
    if (!b.size) return a
    const out = new Map(a)
    for (const [k, c] of b) {
      const v = (out.get(k) || 0) + sign * c
      if (Math.abs(v) < EPS) out.delete(k)
      else out.set(k, v)
    }
    return out
  }
  const scale = (a, c) => {
    if (Math.abs(c) < EPS) return ZERO
    const out = new Map()
    for (const [k, v] of a) out.set(k, v * c)
    return out
  }
  const mul = (a, b) => {
    if (!a.size || !b.size) return ZERO
    if (a.size * b.size > MAX_TERMS) unprovable()
    const out = new Map()
    for (const [ka, ca] of a) {
      for (const [kb, cb] of b) {
        const k = monoKey([...atomsOf(ka), ...atomsOf(kb)])
        const v = (out.get(k) || 0) + ca * cb
        if (Math.abs(v) < EPS) out.delete(k)
        else out.set(k, v)
      }
    }
    return out
  }
  const equal = (a, b) => {
    if (a.size !== b.size) return false
    for (const [k, c] of a) {
      const d = b.get(k)
      if (d === undefined || Math.abs(c - d) > EPS * Math.max(1, Math.abs(c))) return false
    }
    return true
  }
  const isZero = (a) => a.size === 0
  const isConstant = (a) => a.size === 0 || (a.size === 1 && a.has(''))
  const constantOf = (a) => (a.size === 0 ? 0 : a.get(''))
  /** `1 / q`: a single monomial inverts atom by atom; a sum is one opaque atom. */
  const reciprocal = (q, tree) => {
    if (q.size === 1) {
      const [[k, c]] = [...q]
      if (Math.abs(c) < EPS) unprovable()
      return new Map([[monoKey(atomsOf(k).map(inverseKey)), 1 / c]])
    }
    if (!q.size) unprovable()
    return new Map([[INV_PREFIX + atomOf(tree), 1]])
  }
  /** The subtree a monomial's atoms multiply to (canonical order). */
  const monoTree = (key) => atomsOf(key).map(treeOfAtom)
    .reduce((acc, t) => (acc ? { type: 'op', name: '*', args: [acc, t] } : t), null)
  /** A LINEAR, time-invariant operator applied term by term: `wrap(tree)` is the
   *  operator on one subtree, `onConstant` what it answers for the series `1`. */
  const linear = (p, wrap, onConstant) => {
    let out = ZERO
    for (const [k, c] of p) {
      if (k === '') out = add(out, constant(c * onConstant))
      else out = add(out, scale(atom(wrap(monoTree(k))), c))
    }
    return out
  }
  return { keyOf, ZERO, constant, atom, add, scale, mul, equal, isZero, isConstant, constantOf, reciprocal, linear }
}

// ── the functions whose behaviour under a shift is known ────────────────────────

/** Linear, time-invariant window operators and what each answers for the constant
 *  series 1 (`'period'`: the literal window — `sum(1, n) = n`). Exact for an
 *  average whose weights sum to one, which each of these is. */
const LINEAR_CALLS = Object.freeze({ sma: 1, wma: 1, ema: 1, rma: 1, hma: 1, sum: 'period', change: 0 })
/** Unchanged when their FIRST argument moves by a constant. */
const SHIFT_INVARIANT_CALLS = Object.freeze(new Set(['stdev', 'dev', 'rising', 'falling', 'highestbars',
  'lowestbars', 'rsi', 'percentrank']))
/** Move by the same constant as their SOURCE argument (the index names it); every
 *  other argument must not move at all. `floor`/`round`/`ceil` commute with a
 *  WHOLE shift, so they belong here only for a whole coefficient. */
const SHIFT_EQUIVARIANT_CALLS = Object.freeze({
  highest: 0, lowest: 0, median: 0, pivothigh: 0, pivotlow: 0,
  valuewhen: 1, valuewhenOccurrence: 1, barsAgo: 0,
})
const WHOLE_SHIFT_CALLS = Object.freeze(new Set(['floor', 'round', 'ceil']))
const COMPARISONS = Object.freeze(new Set(['>', '<', '>=', '<=', '==', '!=']))
const LOGICAL = Object.freeze(new Set(['&&', '||', '!']))

const isNaLiteral = (n) => !!n && n.type === 'op' && n.name === '/' && Array.isArray(n.args) && n.args.length === 2
  && n.args.every((a) => a && a.type === 'num' && a.value === 0)

/** Does this subtree read a recurrence's own binding (`self`)? */
function readsBinding(tree, name) {
  const stack = [tree]
  const seen = new Set()
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (n.type === 'series' && n.name === name) return true
    if (Array.isArray(n.args)) for (const a of n.args) stack.push(a)
  }
  return false
}

const NO_THRESHOLDS = Object.freeze([])

/**
 * @param {object} tree a canonical tree
 * @returns {'inv' | 'pos' | 'dep'} see the header
 */
export function barIndexClass(tree) {
  return barIndexVerdict(tree).cls
}

/**
 * The class, and the threshold comparisons it rests on.
 *
 * `thresholds[i] = {node, sign}`: `node` is an ordering comparison whose two
 * sides move apart by `sign · D` (`sign` +1: the left side gains on the right as
 * `D` grows). On the bars `thresholdUnknown` names, its answer on this chart is
 * not TradingView's for every `D ≥ 0`.
 * @returns {{cls: 'inv' | 'pos' | 'dep', thresholds: Array<{node: object, sign: number}>}}
 */
export function barIndexVerdict(tree) {
  if (!readsBarIndex(tree)) return { cls: 'inv', thresholds: NO_THRESHOLDS }
  const thresholds = []
  const A = makeAlgebra()
  const NA = { na: true }
  const lin = (p0, p1) => ({ p0, p1 })
  /** A value that does not move with `D`, named by its own subtree. */
  const fixed = (node) => lin(A.atom(node), A.ZERO)
  const still = (s) => s.na || A.isZero(s.p1)
  const memo = new Map()
  /** One memo per `self` reading: a node under a recurrence body is judged
   *  against THAT body's `self`, so its answer is not the top-level one. */
  const selfMemos = new Map()
  const memoFor = (self) => {
    if (!self) return memo
    if (!selfMemos.has(self)) selfMemos.set(self, new Map())
    return selfMemos.get(self)
  }

  const walk = (n, self, depth) => {
    if (depth > MAX_DEPTH) unprovable()
    if (!n || typeof n !== 'object') unprovable()
    const seen = memoFor(self)
    if (seen.has(n)) return seen.get(n)
    const out = visit(n, self, depth)
    seen.set(n, out)
    return out
  }
  const visit = (n, self, depth) => {
    const sub = (x) => walk(x, self, depth + 1)
    const args = Array.isArray(n.args) ? n.args : []
    switch (n.type) {
      case 'num':
        return Number.isFinite(n.value) ? lin(A.constant(n.value), A.ZERO) : NA
      case 'str':
      case 'symtext':
        return fixed(n)
      case 'series':
        if (self && self.name === n.name) return self.sym
        return BAR_INDEX_LEAVES.includes(n.name) ? lin(A.atom(n), A.constant(1)) : fixed(n)
      case 'offset': {
        const x = sub(args[0])
        if (x.na) return NA
        const wrap = (t) => ({ type: 'offset', value: n.value, args: [t] })
        return lin(A.linear(x.p0, wrap, 1), A.linear(x.p1, wrap, 1))
      }
      case 'tf':
      case 'tf_live':
      case 'sym':
      case 'textop':
        // other bars, or text: served only when nothing beneath it moves
        for (const a of args) if (!still(sub(a))) unprovable()
        return fixed(n)
      case 'op': return visitOp(n, args, sub)
      case 'call': return visitCall(n, args, sub, self, depth)
      default: return unprovable()
    }
  }
  const visitOp = (n, args, sub) => {
    if (isNaLiteral(n)) return NA
    if (n.name === 'u-') {
      const x = sub(args[0])
      return x.na ? NA : lin(A.scale(x.p0, -1), A.scale(x.p1, -1))
    }
    if (n.name === '+' || n.name === '-') {
      const a = sub(args[0])
      const b = sub(args[1])
      if (a.na || b.na) return NA
      const s = n.name === '+' ? 1 : -1
      return lin(A.add(a.p0, b.p0, s), A.add(a.p1, b.p1, s))
    }
    if (n.name === '*') {
      const a = sub(args[0])
      const b = sub(args[1])
      if (a.na || b.na) return NA
      if (!A.isZero(a.p1) && !A.isZero(b.p1)) unprovable()          // a D² term
      return lin(A.mul(a.p0, b.p0), A.add(A.mul(a.p1, b.p0), A.mul(a.p0, b.p1)))
    }
    if (n.name === '/') {
      const a = sub(args[0])
      const b = sub(args[1])
      if (a.na || b.na) return NA
      if (!A.isZero(b.p1)) unprovable()
      const r = A.reciprocal(b.p0, args[1])
      return lin(A.mul(a.p0, r), A.mul(a.p1, r))
    }
    if (COMPARISONS.has(n.name)) {
      const a = sub(args[0])
      const b = sub(args[1])
      // a comparison with an `na` operand is false on both platforms (C29 rule 6)
      if (a.na || b.na) return fixed(n)
      if (A.equal(a.p1, b.p1)) return fixed(n)
      // ⭐ a THRESHOLD: the sides move apart by a constant multiple of `D`, and
      // `D ≥ 0`, so an ORDERING is known wherever `D` can only confirm it.
      const gap = A.add(a.p1, b.p1, -1)
      if (n.name === '==' || n.name === '!=' || !A.isConstant(gap)) unprovable()
      if (self && readsBinding(n, self.name)) unprovable()             // no column of its own
      if (!thresholds.some((t) => t.node === n)) thresholds.push({ node: n, sign: Math.sign(A.constantOf(gap)) })
      return fixed(n)
    }
    if (LOGICAL.has(n.name)) {
      for (const a of args) if (!still(sub(a))) unprovable()
      return fixed(n)
    }
    if (n.name === '?:') {
      if (!still(sub(args[0]))) unprovable()
      const y = sub(args[1])
      const e = sub(args[2])
      if (y.na && e.na) return NA
      if (y.na) return lin(A.atom(n), e.p1)
      if (e.na) return lin(A.atom(n), y.p1)
      if (!A.equal(y.p1, e.p1)) unprovable()
      return lin(A.atom(n), y.p1)
    }
    return unprovable()
  }
  const literalPeriod = (node) => (node && node.type === 'num' && Number.isFinite(node.value) ? node.value : null)
  const visitCall = (n, args, sub, self, depth) => {
    const name = n.name
    const rec = Object.prototype.hasOwnProperty.call(RECURRENCES, name) ? RECURRENCES[name] : null
    if (rec) {
      // ⭐ A RUNNING VALUE IS WHAT ITS SEED AND ITS UPDATE BOTH ARE. Tried as a
      // value that does not move, then as an index: the first reading the body
      // and the seed are both consistent with. (`var int at = na` / `if c` /
      // `at := bar_index` is an index; a counter is neither and is C12s's.)
      for (let i = 0; i < args.length; i += 1) {
        if (i !== rec.seed && i !== rec.body && !still(sub(args[i]))) unprovable()
      }
      const seed = sub(args[rec.seed])
      const bindName = { type: 'series', name: rec.binds }
      const fits = (s, p1) => s.na || A.equal(s.p1, p1)
      for (const p1 of [A.ZERO, A.constant(1)]) {
        const kept = thresholds.length
        let body
        try {
          body = walk(args[rec.body], { name: rec.binds, sym: lin(A.atom(bindName), p1) }, depth + 1)
        } catch (err) {
          thresholds.length = kept                                    // a reading that failed lists nothing
          if (err instanceof Unprovable) continue
          throw err
        }
        if (!fits(body, p1) || !fits(seed, p1)) { thresholds.length = kept; continue }
        if (body.na && seed.na) return NA
        return lin(A.atom(n), p1)
      }
      // ⭐ AN INDEX ONCE WRITTEN — `var int at = 0` / `if c` / `at := bar_index`
      // (options-max-pain's `base_x`, pro-trading-art's `lastStart`): the seed is a
      // plain number standing for "none yet", and every WRITE is an index. Read as
      // the index it becomes. ⛔ Not a new claim about the bars before its first
      // write: there the name holds its seed where TradingView, with more history,
      // may already hold an index — the warm-up curtain's question, answered by
      // the masks that already ask it (`objectColumns.js::unknownMask`,
      // `interpret.js::switchedDependencyMask`), not by this pass.
      if (!seed.na && A.isZero(seed.p1) && A.isConstant(seed.p0)) {
        const kept = thresholds.length
        let body
        try {
          body = walk(args[rec.body], { name: rec.binds, sym: lin(A.atom(bindName), A.constant(1)) }, depth + 1)
        } catch (err) {
          thresholds.length = kept
          throw err
        }
        if (!body.na && A.equal(body.p1, A.constant(1))) return lin(A.atom(n), body.p1)
        thresholds.length = kept
      }
      return unprovable()
    }
    if (name === 'na') { sub(args[0]); return fixed(n) }                 // `na`-ness does not move with D
    if (name === 'nz') {
      const x = sub(args[0])
      const y = args.length > 1 ? sub(args[1]) : lin(A.ZERO, A.ZERO)
      if (x.na) return y
      if (y.na || !A.equal(x.p1, y.p1)) unprovable()
      return lin(A.atom(n), x.p1)
    }
    if (name === 'max' || name === 'min') {
      const a = sub(args[0])
      const b = sub(args[1])
      if (a.na || b.na || !A.equal(a.p1, b.p1)) unprovable()
      return lin(A.atom(n), a.p1)
    }
    if (Object.prototype.hasOwnProperty.call(LINEAR_CALLS, name)) {
      const x = sub(args[0])
      for (const a of args.slice(1)) if (!still(sub(a))) unprovable()
      if (x.na) return NA
      const period = literalPeriod(args[1])
      const one = LINEAR_CALLS[name] === 'period' ? period : LINEAR_CALLS[name]
      if (one === null) unprovable()
      const wrap = (t) => ({ type: 'call', name, args: [t, ...args.slice(1)] })
      return lin(A.linear(x.p0, wrap, one), A.linear(x.p1, wrap, one))
    }
    if (SHIFT_INVARIANT_CALLS.has(name)) {
      const x = sub(args[0])
      for (const a of args.slice(1)) if (!still(sub(a))) unprovable()
      if (!x.na && !A.isConstant(x.p1)) unprovable()
      return fixed(n)
    }
    if (Object.prototype.hasOwnProperty.call(SHIFT_EQUIVARIANT_CALLS, name)) {
      const at = SHIFT_EQUIVARIANT_CALLS[name]
      for (let i = 0; i < args.length; i += 1) if (i !== at && !still(sub(args[i]))) unprovable()
      const x = sub(args[at])
      if (x.na) return NA
      if (!A.isConstant(x.p1)) unprovable()
      return lin(A.atom(n), x.p1)
    }
    if (WHOLE_SHIFT_CALLS.has(name)) {
      const x = sub(args[0])
      if (x.na) return NA
      if (!A.isConstant(x.p1) || !Number.isInteger(A.constantOf(x.p1))) unprovable()
      return lin(A.atom(n), x.p1)
    }
    if (name === 'crossOver' || name === 'crossUnder') {
      const a = sub(args[0])
      const b = sub(args[1])
      if (a.na || b.na) return fixed(n)
      if (!A.equal(a.p1, b.p1)) unprovable()
      return fixed(n)
    }
    // every other function: served only when no argument moves
    for (const a of args) if (!still(sub(a))) unprovable()
    return fixed(n)
  }

  let root
  try {
    root = walk(tree, null, 0)
  } catch (err) {
    // ⛔ ONLY the pass's own "not provable". Anything else — a `RangeError`
    // included (`MAX_DEPTH` stops the recursion long before the stack does) — is
    // a defect and is thrown, never relabelled as a withholding.
    if (err instanceof Unprovable) return { cls: 'dep', thresholds: NO_THRESHOLDS }
    throw err
  }
  if (root.na || A.isZero(root.p1)) return { cls: 'inv', thresholds }
  const pos = A.isConstant(root.p1) && Math.abs(A.constantOf(root.p1) - 1) < EPS
  return pos ? { cls: 'pos', thresholds } : { cls: 'dep', thresholds: NO_THRESHOLDS }
}

/** ⭐ Is a threshold's answer on this chart one TradingView may not share?
 *  `gap` is `left − right` on this chart (`NaN` when either side is `na`: the
 *  comparison is false on both platforms — known). TradingView's gap is
 *  `gap + sign · D · |k|` for some `D ≥ 0`, so the answer is KNOWN exactly where
 *  growing `D` can only confirm it. */
export function thresholdUnknown(op, sign, gap) {
  if (!Number.isFinite(gap)) return false
  const up = sign > 0
  switch (op) {
    case '>': return up ? gap <= 0 : gap > 0
    case '>=': return up ? gap < 0 : gap >= 0
    case '<': return up ? gap < 0 : gap >= 0
    case '<=': return up ? gap <= 0 : gap > 0
    default: return true
  }
}
