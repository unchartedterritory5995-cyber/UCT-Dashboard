// app/src/components/chart/engine/runtime/taintTags.js
//
// ─── ⭐⭐ START-TAINT, PART 2 — THE TAG ALGEBRA THE TAINT RUN APPLIES ─────────────────────────────────────────────────
//
// `docs/pine/START-TAINT.md` (approved 2026-11-27). An off-listing run serves a value only where it cannot depend on
// the run's first bar. The taint run (`vmTaint.js::executeTainted`, GENERATED from `vm.js::execute`) carries one tag
// per value beside it, and these are the rules it combines them by. They live here, hand-written and railed, and the
// generated loop holds the table of which opcode applies which (`app/scripts/gen-vm-taint.mjs`). ⛔ The one-line joins
// below (`tStrict` ... `tVal`) are INLINED into the loop from this file's TEXT (`gen-vm-taint.mjs::INLINED`, a perf
// rule): keep each one line of one-letter parameters, numbers and operators, and regenerate after changing one.
//
//   C (0) clean    the same on every earlier first bar
//   O (1) offset   clean up to ONE additive constant, the number of bars before our first bar (`bar_index`)
//   T (2) tainted  may differ for another start
//
// THE O RULES (coordinator ruling 2026-11-27, `START-TAINT.md` ruling 2 and its 2026-11-27 correction): `O +- C -> O`;
// `O - O -> C`; `O cmp O -> C`; every other use of an O VALUE (`*`, `/`, `%`, compared with a C number, a text, a
// plot, a branch condition, a pointwise call) is T. An O value moved (stored, loaded, read back from history,
// `bar_index[k]`) stays O. An O-tagged history OFFSET (`close[bar_index]`, `close[bar_index - 5]`) is T: it reaches
// back to the run's first bar, which another start does not hold; only a C offset (`O - O` included) is clean.
//
// ⛔ A PURE MODULE: no VM state, no clock. The tag values are small integers so a `Uint8Array` holds them.

import { taintCfg } from './taintCfg.js'
import { FINITE_WINDOW, POINTWISE_FOR_PARITY, BINARY, UNARY } from '../ast/interpret.js'
import { BAR_INDEX_LEAVES } from '../ast/barIndexShift.js'

/** The three tags (`docs/pine/START-TAINT.md`). */
export const TAG = Object.freeze({ C: 0, O: 1, T: 2 })

/** Any non-clean operand taints (an O used as a plain value is T). */
export const tStrict = (x, y) => ((x | y) === 0 ? 0 : 2)
/** `x + y`: `O + C` and `C + O` stay O; `O + O` (twice the offset) and anything with T is T. */
export const tAdd = (x, y) => (x === 0 ? (y === 2 ? 2 : y) : (x === 1 && y === 0 ? 1 : 2))
/** `x - y`: `O - C` is O, `O - O` is C (the offsets cancel), `C - O` (minus the offset) is T. */
export const tSub = (x, y) => (y === 0 ? x : (x === 1 && y === 1 ? 0 : 2))
/** `x cmp y`: two C, or two O (the same offset on both sides), compare clean; anything else is T. */
export const tCmp = (x, y) => (x === y && x !== 2 ? 0 : 2)
/** One operand used as a plain value (a unary op, an output): O is T. */
export const tVal = (x) => (x === 0 ? 0 : 2)
/** `ts[lo..hi)` used as plain values: C only when every one is C. */
export const tRange = (ts, lo, hi) => {
  for (let k = lo; k < hi; k += 1) if (ts[k] !== 0) return 2
  return 0
}

// ─── THE IMPLICIT-FLOW TABLE: taintCfg's facts as flat arrays the loop indexes by pc ──────────────────────────────────
const _tables = new WeakMap()
/** Per program, once: `brJoin[pc]` (the join of the branch at `pc`, -1 the region's exit, -2 not a branch), `brW[pc]`
 *  (its write set) and `siteWrites` (each call site's absolute effects), from `taintCfg.js`. */
export function branchTableOf(program) {
  let t = _tables.get(program)
  if (t) return t
  const cfg = taintCfg(program)
  const n = program.code.length / 3
  const brJoin = new Int32Array(n).fill(-2)
  const brW = new Array(n).fill(null)
  for (const [pc, br] of cfg.branches) { brJoin[pc] = br.join; brW[pc] = br.writes }
  t = Object.freeze({ brJoin, brW, siteWrites: cfg.siteWrites })
  _tables.set(program, t)
  return t
}

/** Every effect in a write set is T now: `S` is the run's tag state, `lb` / `pb` the frame's locals / persist bases,
 *  `wb` / `cb` / `c2b` its window / carried / two-input carried bases (a built-in's state the arm not taken may have
 *  stepped forgets its clean count: part 3). */
function taintWrites(S, w, lb, pb, wb, cb, c2b, bar) {
  for (const x of w.locals) S.tl[lb + x] = 2
  for (const x of w.persist) S.tp[pb + x] = 2
  for (const x of w.held) S.theld[x] = 2
  for (const x of w.outputs) S.outT[x][bar] = 2
  for (const x of w.iters) S.iterT[x].fill(2)
  for (const x of w.windows) S.wc[wb + x] = 0
  for (const x of w.carried) S.cc[cb + x] = 0
  for (const x of w.carried2) S.cc2[c2b + x] = 0
}

/** A T branch at `p` (call depth `d`), with `top` regions open: every effect EITHER arm may have (the arm not taken
 *  included) is T now, the called sites' absolute effects too, and a region opens until the branch's join (every write
 *  until then is T). Answers the new number of open regions. A loop head re-tested inside its own region opens nothing.
 *  `S` = `{ tl, tp, theld, outT, iterT, wc, cc, cc2, brW, brJoin, siteW, rBr, rJoin, rDepth, ... }` (the generated
 *  loop's own arrays). */
export function taintBranch(S, p, lb, pb, wb, cb, c2b, bar, d, top) {
  for (let r = 0; r < top; r += 1) if (S.rBr[r] === p && S.rDepth[r] === d) return top
  const w = S.brW[p]
  taintWrites(S, w, lb, pb, wb, cb, c2b, bar)
  for (const s of w.calls) taintWrites(S, S.siteW[s], 0, 0, 0, 0, 0, bar)
  S.rBr[top] = p
  S.rJoin[top] = S.brJoin[p]
  S.rDepth[top] = d
  return top + 1
}

// ─── ⭐⭐ PART 3: THE BUILT-INS — ONE TABLE, read by the taint loop AND by the columns ────────────────────────────────
//
// `START-TAINT.md` source 4. A built-in's answer is clean once it has FORGOTTEN the run's first bar:
//   window  a finite window of `span` observations (every `FINITE_WINDOW` member, under its own `na` policy) is C once
//           `span` clean observations have arrived since the last tainted one (a count, not a ring: a T observation
//           leaves the window exactly `span` clean ones later, which is when the count reaches `span` again);
//   event   `ta.barssince` / `fixnan` restart at an event: C from the first clean event (`ta.valuewhen` from its
//           `occurrence + 1`-th clean firing: its ring holds that many);
//   lag     `ta.cross*` (the previous invocation's pair) and a column's `ta.change` (`x - x[1]`): C one clean step on;
//   T       everything else, for ever: a recurrence (`ema`, `rma`, `rsi`, `cum`, `vwap`, ...: an exponential decay
//           never forgets, ruling 1), and every built-in this table does not name (fail closed).
// The WINDOW members are DERIVED from `FINITE_WINDOW` (the table the VM and the columnar lane both reduce by), never
// listed here; `FORGET` names only the members with a written forget rule. The taint loop reads `builtinRuleOf` once
// per run (per plan entry), the columns once per build (per tree node): one rule per name for both.

/** The built-ins with a written forget rule (`kind` above). `event`: what counts as the event (`fires`: a condition
 *  that is neither `na` nor 0; `finite`: a value that is not `na`); `occurrence`: the value is read from a ring of the
 *  last `occurrence + 1` events. */
export const FORGET = Object.freeze({
  barssincePine: Object.freeze({ kind: 'event', event: 'fires' }),
  fixnanPine: Object.freeze({ kind: 'event', event: 'finite' }),
  valuewhen: Object.freeze({ kind: 'event', event: 'fires', occurrence: true }),
  crossOver: Object.freeze({ kind: 'lag' }),
  crossUnder: Object.freeze({ kind: 'lag' }),
  crossAny: Object.freeze({ kind: 'lag' }),
  change: Object.freeze({ kind: 'lag' }),
})

/** The rule for built-in `fn` (a VM plan entry's `fn`, or a column call node's `name`): `{ kind: 'window', policy }`,
 *  a `FORGET` entry, or `null` (T for ever). */
export function builtinRuleOf(fn) {
  if (typeof fn !== 'string') return null
  if (Object.prototype.hasOwnProperty.call(FINITE_WINDOW, fn)) return { kind: 'window', policy: FINITE_WINDOW[fn].na }
  if (Object.prototype.hasOwnProperty.call(FORGET, fn)) return FORGET[fn]
  return null
}

/** The taint loop's per-instance rule codes for the carried stores, read once per run from `builtinRuleOf`. */
export const RULE = Object.freeze({ T: 0, FIRES: 1, FINITE: 2, OCCURRENCE: 3, LAG: 4 })
export function ruleCodeOf(fn) {
  const r = builtinRuleOf(fn)
  if (r === null || r.kind === 'window') return RULE.T
  if (r.kind === 'lag') return RULE.LAG
  if (r.occurrence) return RULE.OCCURRENCE
  return r.event === 'fires' ? RULE.FIRES : RULE.FINITE
}

const COUNT_CAP = 0x3fffffff
const fires = (c) => !Number.isNaN(c) && c !== 0
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/** `WINDOW` instance `i` is stepped with `live` (tag `t`) under `policy`, at length `span` (tag `lt`: a length read
 *  per bar has one), with `top` tainted regions open. Answers the result's tag, and keeps `S.wc[i]`: the clean
 *  observations since the last tainted one (a tainted step, or a step under a tainted branch, restarts it). A
 *  `propagate` window (`dev`) reads the committed ring of its input, so its tag is that ring's: the live value and the
 *  `span - 1` committed cells the value code reads (`hi` the ring, `committed` the bars behind this one). */
export function tWindow(S, i, policy, t, live, span, lt, top, committed, hi) {
  if (top > 0 || t !== 0) { S.wc[i] = 0; return 2 }
  if (policy === 'propagate') {
    if (lt !== 0 || committed < span - 1) return 2
    if (span > 1) {
      const off = S.histOffset[hi]
      const depth = S.histPlan[hi].depth
      for (let k = 1; k < span; k += 1) if (S.th[off + ((committed - k) % depth)] !== 0) return 2
    }
    return 0
  }
  // a hole (`na`) is no observation; under `ffill` (`wma`) it is filled from the finite value before it, and with
  // `span` clean finite values since the last tainted step, a window of the last `span` steps holding h holes holds
  // span - h finite ones, so at least h clean finite values came before it: every fill's source is clean
  if (isFiniteNumber(live) && S.wc[i] < COUNT_CAP) S.wc[i] += 1
  if (lt !== 0 || S.wc[i] < span) return 2
  // `finite` answers `na` before bar `span - 1` (another start, further on, answers there): the run's own bar count
  if (policy === 'finite' && committed < span - 1) return 2
  return 0
}

/** `CARRIED` instance `i` (rule `code`) is stepped with `v` (tag `t`), `top` regions open: the result's tag. */
export function tCarried(S, i, code, t, v, top) {
  if (code === RULE.T || top > 0 || t !== 0) { S.cc[i] = 0; return 2 }
  if (code === RULE.FIRES ? fires(v) : isFiniteNumber(v)) S.cc[i] = 1
  return S.cc[i] > 0 ? 0 : 2
}

/** `CARRIED2` instance `i` (rule `code`, length `n`) is stepped with its condition / first series `x` (tag `tx`), its
 *  source / second series (tag `ty`) and a third input's tag `tz` (0 when it has none), `top` regions open: the
 *  result's tag. */
export function tCarried2(S, i, code, tx, x, ty, tz, n, top) {
  if (code === RULE.T || top > 0 || tx !== 0 || tz !== 0) { S.cc2[i] = 0; return 2 }
  if (code === RULE.LAG) {
    if (ty !== 0) { S.cc2[i] = 0; return 2 }
    if (S.cc2[i] < COUNT_CAP) S.cc2[i] += 1
    return S.cc2[i] >= 2 ? 0 : 2
  }
  // `valuewhen`: a firing pushes the source into the ring (a tainted source is a tainted cell: the count restarts)
  if (fires(x)) {
    if (ty !== 0) { S.cc2[i] = 0; return 2 }
    if (S.cc2[i] < COUNT_CAP) S.cc2[i] += 1
  }
  return S.cc2[i] >= n + 1 ? 0 : 2
}

// ─── THE COLUMNS' TAGS: per column, the first bar from which it is clean (`cleanFrom`, part 3) ───────────────────────
/** The bar series a column may read and stay clean (each bar's own value, whatever the start). */
const CLEAN_SERIES = new Set(['open', 'high', 'low', 'close', 'volume'])
/** Pointwise operators (the columnar lane's own operator tables, and its ternary): clean from where every child is. */
const POINTWISE_OPS = new Set([...Object.keys(BINARY), ...Object.keys(UNARY), '?:'])
const POINTWISE_CALLS = new Set(Object.keys(POINTWISE_FOR_PARITY))
const NEVER = Infinity

/** Index of the `need`-th finite value of `vals` at or after `from` (NEVER if it never arrives). */
function nthFiniteFrom(vals, from, need) {
  let k = 0
  for (let i = Math.max(0, from); i < vals.length; i += 1) if (Number.isFinite(vals[i]) && ++k >= need) return i
  return NEVER
}

/** The first bar from which `node`'s values are the same on every earlier start (NEVER: on no bar). `valuesOf`
 *  (optional) evaluates a sub-tree over the build's bars, as the build did: a `skip` / `finite` / `ffill` window
 *  counts its child's FINITE values, which only the values can say; without it such a window is NEVER (fail closed). */
export function cleanFromOf(node, valuesOf, memo = new Map()) {
  if (!node || typeof node !== 'object') return NEVER
  if (memo.has(node)) return memo.get(node)
  let r = NEVER
  const args = Array.isArray(node.args) ? node.args : []
  const maxOf = (list) => list.reduce((m, a) => Math.max(m, cleanFromOf(a, valuesOf, memo)), 0)
  if (node.type === 'num') r = 0
  else if (node.type === 'series') r = CLEAN_SERIES.has(node.name) ? 0 : NEVER
  else if (node.type === 'op') r = POINTWISE_OPS.has(node.name) && args.length ? maxOf(args) : NEVER
  else if (node.type === 'offset') {
    r = Number.isInteger(node.value) && node.value >= 0 && args.length === 1 ? maxOf(args) + node.value : NEVER
  } else if (node.type === 'call') {
    const rule = builtinRuleOf(node.name)
    if (POINTWISE_CALLS.has(node.name)) r = args.length ? maxOf(args) : NEVER
    else if (rule && rule.kind === 'lag') r = args.length ? maxOf(args) + 1 : NEVER
    else if (rule && rule.kind === 'window' && args.length === 2 && args[1] && args[1].type === 'num'
      && Number.isInteger(args[1].value) && args[1].value >= 1) {
      const span = FINITE_WINDOW[node.name].span(args[1].value)
      const c = cleanFromOf(args[0], valuesOf, memo)
      if (c === NEVER) r = NEVER
      else if (rule.policy === 'propagate') r = c + span - 1
      else if (typeof valuesOf !== 'function') r = NEVER
      else {
        // the bar holding the `span`-th finite value at or after `c`: from there the last `span` finite values (and,
        // under `ffill`, every hole's fill: see `tWindow`) lie at or after `c`; it is at least `c + span - 1`, so
        // a `finite` window's own warm-up (bar `span - 1`) is behind it too
        r = nthFiniteFrom(valuesOf(args[0]), c, span)
      }
    }
  }
  memo.set(node, r)
  return r
}

/** One column's tag on EVERY bar (part 2's question): a bare `bar_index` / `last_bar_index` leaf is O; a column clean
 *  from its first bar is C; anything else T. */
export function columnTagOf(tree) {
  if (tree && tree.type === 'series' && BAR_INDEX_LEAVES.includes(tree.name)) return TAG.O
  return cleanFromOf(tree) === 0 ? TAG.C : TAG.T
}

/** The `columnTags` a taint run is handed, one per column, from the column trees in column order. */
export function columnTagsOf(trees) {
  return Uint8Array.from((trees || []).map(columnTagOf))
}

/** Part 3: what a taint run is handed for its columns, `{ columnTags, columnFrom }`: column k is O (a bare
 *  `bar_index`), or C from bar `columnFrom[k]` on and T before it (`Infinity`: T on every bar). `valuesOf` as for
 *  `cleanFromOf`. */
export function columnTaintOf(trees, valuesOf) {
  const list = trees || []
  const memo = new Map()
  const columnTags = new Uint8Array(list.length)
  const columnFrom = new Float64Array(list.length)
  list.forEach((t, k) => {
    if (t && t.type === 'series' && BAR_INDEX_LEAVES.includes(t.name)) { columnTags[k] = TAG.O; columnFrom[k] = 0; return }
    const f = cleanFromOf(t, valuesOf, memo)
    columnTags[k] = f === NEVER ? TAG.T : TAG.C
    columnFrom[k] = f
  })
  return { columnTags, columnFrom }
}
