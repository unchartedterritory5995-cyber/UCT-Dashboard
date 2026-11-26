// app/src/components/chart/engine/runtime/pureCalls.js
//
// ⭐⭐ e99 b2 (coordinator ruling 2026-11-26) — A PURE LEAF CALL IS ANSWERED FROM A MEMO, ITS ACCOUNT REPLAYED.
//
// kernel-channel-backquant calls `kernelWeight(i, length, bw, ktype)` 300 times a bar, and every answer is the same
// on every bar (its arguments are a loop index and three inputs). A function that reads nothing but its own
// arguments, keeps no state and has no effect answers the same value for the same arguments, so the VM may hand
// back the value it computed before instead of running the body again (`vm.js` OP.CALL / OP.RET).
//
// ⛔⛔ CONSERVATIVE BY CONSTRUCTION: AN ALLOWLIST OF OPCODES OVER THE COMPILED BODY. A function qualifies only when
// its compiled body (the contiguous code from its entry to the next entry, as `vm.js::regionCausal` reads a
// region) holds NOTHING but: constants, arithmetic, comparison and logic, the ternary, its own frame's locals,
// jumps, pointwise builtins (`POINTWISE_FOR_PARITY`: no clock, no randomness, no I/O, railed in `interpret.js`),
// DROP and RET, and READ_COLUMN ONLY of a column that holds ONE value on every bar of the run (the front end
// compiles a literal inside a function, `2.0`, `"Epanechnikov"`, to a precomputed column: checked per `execute`,
// value by value, `Object.is`; a column that varies, `close` for one, disqualifies the function for that run). So:
// no series read, no varying column, no history operator (`x[k]` in any form), no `var` / `varip`
// (LOAD/STORE_PERSIST, JUMP_IF_INIT), no window or carried builtin, no drawing, broker, request, collection, text
// or emit, no loop, and NO CALL (a LEAF: its frame depth and loop nesting are then exactly one frame and none, so
// replaying its account is exact). It must also own no history ring, carried or window instance, persist slot, and
// the front end must call it effect-free (`effects.pure`). Anything else is simply run, as before.
//
// ⭐ EXACT, VALUES AND COUNTS. A memo entry is keyed by its arguments exactly (`Map` identity on each: a number, a
// string or a boolean; `-0` kept apart from `0`; an argument of any other kind is never memoised) and holds the
// values the body left and the instructions it took. A hit pushes the same values and charges the same
// instructions to the bar, the CALL's own depth and call count exactly as a run does, so every column AND every
// budget count (TOTAL_INSTRUCTIONS, INSTRUCTIONS_PER_BAR, CALL_COUNT, CALL_DEPTH, ...) is identical, and every stop
// fires on the same bar with the same numbers. A hit that would carry the bar past `INSTRUCTIONS_PER_BAR` is not
// taken: the body runs and stops where it always stopped. The memo lives for ONE `execute` and holds at most
// `PURE_MEMO_MAX` entries (then it stops growing; a hit is still a hit).
import { OP } from './program.js'

export const PURE_MEMO_MAX = 65536
/** `-0`'s key: a value no argument can be, so `-0` and `0` (one `Map` key) are kept apart. */
export const NEG_ZERO_KEY = Symbol('-0')

/** The opcodes a pure leaf body may hold. ⛔ An allowlist: an op not named here disqualifies the function. */
export const PURE_LEAF_OPS = Object.freeze(new Set([
  OP.CONST,
  OP.ADD, OP.SUB, OP.MUL, OP.DIV, OP.NEG,
  OP.LT, OP.GT, OP.LE, OP.GE, OP.EQ, OP.NE,
  OP.AND, OP.OR, OP.NOT, OP.SELECT,
  OP.LOAD_LOCAL, OP.STORE_LOCAL,
  OP.JUMP, OP.JUMP_IF_FALSE,
  OP.POINTWISE,
  OP.READ_COLUMN, // ⛔ only of a column constant over the run (`pureLeafFlagsFor`)
  OP.DROP,
  OP.RET,
]))

const cache = new WeakMap()

/** The STATIC half: `{ flags, columnReads }` over `program.functions`, `flags[i]` 1 for a candidate pure leaf and
 *  `columnReads[i]` the columns its body reads (each must be constant over a run). Cached per program. */
export function pureLeafCandidatesOf(program) {
  const hit = cache.get(program)
  if (hit) return hit
  const fns = program.functions || []
  const out = new Uint8Array(fns.length)
  const columnReads = fns.map(() => [])
  const code = program.code
  const max = program.instructions
  const starts = [...fns.map((f) => f.entry), ...(program.requests || []).map((r) => r.entry)]
    .filter(Number.isInteger).sort((x, y) => x - y)
  const endOf = (s) => { for (const e of starts) if (e > s) return e; return max }
  fns.forEach((fn, i) => {
    if (!fn || !Number.isInteger(fn.entry) || fn.entry <= 0 || fn.entry >= max) return
    if ((fn.persistCount || 0) !== 0 || (fn.historyCount || 0) !== 0 || (fn.carriedCount || 0) !== 0
      || (fn.carried2Count || 0) !== 0 || (fn.windowCount || 0) !== 0) return
    if (!(fn.effects && fn.effects.pure === true)) return
    let sawRet = false
    for (let pc = fn.entry, to = endOf(fn.entry); pc < to; pc += 1) {
      const op = code[pc * 3]
      if (!PURE_LEAF_OPS.has(op)) return
      if (op === OP.RET) sawRet = true
      if (op === OP.READ_COLUMN) columnReads[i].push(code[pc * 3 + 1])
    }
    if (sawRet) out[i] = 1
  })
  const res = { flags: out, columnReads }
  cache.set(program, res)
  return res
}

/** One value on every one of the run's `bars` bars (`Object.is`, so `NaN` is one value and `-0` is not `0`). */
export function constantColumn(col, bars) {
  if (!col || typeof col.length !== 'number' || col.length < 1) return false
  const v = col[0]
  const end = Math.min(col.length, bars)
  for (let i = 1; i < end; i += 1) if (!Object.is(col[i], v)) return false
  return true
}

/** The RUN half: `Uint8Array` of the functions memoisable in THIS run (every column a candidate reads is constant
 *  over it), or `null` when none is. */
export function pureLeafFlagsFor(program, columns, bars) {
  const { flags, columnReads } = pureLeafCandidatesOf(program)
  if (!flags.includes(1)) return null
  const out = flags.slice()
  const constant = new Map()
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] !== 1) continue
    for (const c of columnReads[i]) {
      if (!constant.has(c)) constant.set(c, constantColumn(columns && columns[c], bars))
      if (!constant.get(c)) { out[i] = 0; break }
    }
  }
  return out.includes(1) ? out : null
}

/** The static flags alone (a function whose body can qualify on some run). */
export function pureLeafFunctionsOf(program) { return pureLeafCandidatesOf(program).flags }
