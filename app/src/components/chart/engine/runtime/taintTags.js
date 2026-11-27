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

/** Every effect in a write set is T now: `S` is the run's tag state, `lb` / `pb` the frame's locals / persist bases. */
function taintWrites(S, w, lb, pb, bar) {
  for (const x of w.locals) S.tl[lb + x] = 2
  for (const x of w.persist) S.tp[pb + x] = 2
  for (const x of w.held) S.theld[x] = 2
  for (const x of w.outputs) S.outT[x][bar] = 2
  for (const x of w.iters) S.iterT[x].fill(2)
}

/** A T branch at `p` (call depth `d`), with `top` regions open: every effect EITHER arm may have (the arm not taken
 *  included) is T now, the called sites' absolute effects too, and a region opens until the branch's join (every write
 *  until then is T). Answers the new number of open regions. A loop head re-tested inside its own region opens nothing.
 *  `S` = `{ tl, tp, theld, outT, iterT, brW, brJoin, siteW, rBr, rJoin, rDepth }` (the generated loop's own arrays). */
export function taintBranch(S, p, lb, pb, bar, d, top) {
  for (let r = 0; r < top; r += 1) if (S.rBr[r] === p && S.rDepth[r] === d) return top
  const w = S.brW[p]
  taintWrites(S, w, lb, pb, bar)
  for (const s of w.calls) taintWrites(S, S.siteW[s], 0, 0, bar)
  S.rBr[top] = p
  S.rJoin[top] = S.brJoin[p]
  S.rDepth[top] = d
  return top + 1
}

// ─── THE COLUMNS' TAGS (part 2: one tag per column; part 3 replaces this with each node's `cleanFrom`) ─────────────
/** The bar series a column may read and stay clean (each bar's own value, whatever the start). */
const CLEAN_SERIES = new Set(['open', 'high', 'low', 'close', 'volume'])
/** Pointwise operators: a node of one of these over clean children is clean. Anything else (a window, a recurrence,
 *  an offset, a call this table does not name) is T until part 3 gives it a rule. */
const CLEAN_OPS = new Set(['+', '-', '*', '/', '>', '<', '>=', '<=', '==', '!='])

function cleanTree(tree) {
  const stack = [tree]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') return false
    if (n.type === 'num') continue
    if (n.type === 'series') { if (CLEAN_SERIES.has(n.name)) continue; return false }
    if (n.type === 'op' && CLEAN_OPS.has(n.name) && Array.isArray(n.args)) { for (const a of n.args) stack.push(a); continue }
    return false
  }
  return true
}

/** One column's tag from its folded tree (`buildRuntimeIr`'s `columnInterpret` sees each): a bare `bar_index` /
 *  `last_bar_index` leaf is O; a pointwise tree over the bar's own prices and numbers is C; anything else is T
 *  (fail closed: a window warms up from the run's first bar, so its own rule is part 3's). */
export function columnTagOf(tree) {
  if (tree && tree.type === 'series' && BAR_INDEX_LEAVES.includes(tree.name)) return TAG.O
  return cleanTree(tree) ? TAG.C : TAG.T
}

/** The `columnTags` a taint run is handed, one per column, from the column trees in column order. */
export function columnTagsOf(trees) {
  return Uint8Array.from((trees || []).map(columnTagOf))
}
