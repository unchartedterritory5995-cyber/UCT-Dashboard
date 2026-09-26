// tools/c5_value_model_spike/program.mjs
//
// One assembled program, shared by every implementation. See `isa.md`.
//
// ⛔ OPERANDS ARE INDICES, NEVER VALUES. The same triples drive all three VMs so
// that no host can constant-fold something another host cannot — the rule the
// C4 Phase 2A spike set, for the same reason.

export const OP = Object.freeze({
  PUSH_CONST: 0,
  PUSH_SERIES: 1,
  LOAD: 2,
  STORE: 3,
  ADD: 4,
  SUB: 5,
  MUL: 6,
  DIV: 7,
  LT: 8,
  GT: 9,
  EQ: 10,
  AND: 11,
  OR: 12,
  NOT: 13,
  NUM_TO_STR: 14,
  STR_CONCAT: 15,
  ARR_NEW: 16,
  ARR_PUSH: 17,
  ARR_GET: 18,
  ARR_SIZE: 19,
  JMP_IF_FALSE: 20,
  JMP: 21,
  EMIT: 22,
  PUSH_NA: 23,
})

// Slots. ⭐ THE STATIC TYPE OF EACH ONE IS DECLARED HERE, because candidate C
// (split banks) needs at compile time what a real compiler would know from the
// Pine declaration. A and B ignore it.
export const SLOT = Object.freeze({ acc: 0, arr: 1, i: 2, v: 3, s: 4, hit: 5 })
export const SLOT_TYPES = Object.freeze(['num', 'arr', 'num', 'num', 'str', 'bool'])

export const CONSTS = Object.freeze([
  0.9,        // 0
  0.1,        // 1
  0,          // 2
  1,          // 3
  100,        // 4
  8,          // 5  K, the inner iteration count
  'S',        // 6
  ':',        // 7
  'S7:0.72',  // 8  the string the last iteration builds when close = 9
])

const C = (i) => [OP.PUSH_CONST, i, 0]

/**
 * The per-bar program of `isa.md`.
 *
 * ⭐ THE LOOP IS REAL, not unrolled. Unrolling it would delete the very work the
 * value model has to carry — a fresh string and a collection write per
 * iteration — and would measure the straight-line case nobody runs.
 */
export function buildProgram() {
  const code = []
  const emit = (...triple) => { code.push(triple); return code.length - 1 }

  // acc := acc * 0.9 + close * 0.1
  emit(OP.LOAD, SLOT.acc, 0)
  emit(...C(0))
  emit(OP.MUL, 0, 0)
  emit(OP.PUSH_SERIES, 3, 0)     // 3 = close
  emit(...C(1))
  emit(OP.MUL, 0, 0)
  emit(OP.ADD, 0, 0)
  emit(OP.STORE, SLOT.acc, 0)

  // arr := new collection ; i := 0
  emit(OP.ARR_NEW, 0, 0)
  emit(OP.STORE, SLOT.arr, 0)
  emit(...C(2))
  emit(OP.STORE, SLOT.i, 0)

  // while i < K
  const top = code.length
  emit(OP.LOAD, SLOT.i, 0)
  emit(...C(5))
  emit(OP.LT, 0, 0)
  const exitJump = emit(OP.JMP_IF_FALSE, 0, 0)   // target patched below

  //   v := open * (i + 1) / 100      ⭐ `open` is the series carrying the na
  emit(OP.PUSH_SERIES, 0, 0)
  emit(OP.LOAD, SLOT.i, 0)
  emit(...C(3))
  emit(OP.ADD, 0, 0)
  emit(OP.MUL, 0, 0)
  emit(...C(4))
  emit(OP.DIV, 0, 0)
  emit(OP.STORE, SLOT.v, 0)

  //   arr.push(v)
  emit(OP.LOAD, SLOT.arr, 0)
  emit(OP.LOAD, SLOT.v, 0)
  emit(OP.ARR_PUSH, 0, 0)

  //   s := "S" + str(i) + ":" + str(v)
  emit(...C(6))
  emit(OP.LOAD, SLOT.i, 0)
  emit(OP.NUM_TO_STR, 0, 0)
  emit(OP.STR_CONCAT, 0, 0)
  emit(...C(7))
  emit(OP.STR_CONCAT, 0, 0)
  emit(OP.LOAD, SLOT.v, 0)
  emit(OP.NUM_TO_STR, 0, 0)
  emit(OP.STR_CONCAT, 0, 0)
  emit(OP.STORE, SLOT.s, 0)

  //   hit := (s == "S7:0.72")
  emit(OP.LOAD, SLOT.s, 0)
  emit(...C(8))
  emit(OP.EQ, 0, 0)
  emit(OP.STORE, SLOT.hit, 0)

  //   i := i + 1
  emit(OP.LOAD, SLOT.i, 0)
  emit(...C(3))
  emit(OP.ADD, 0, 0)
  emit(OP.STORE, SLOT.i, 0)

  emit(OP.JMP, top, 0)
  code[exitJump] = [OP.JMP_IF_FALSE, code.length, 0]

  // emit acc, arr.size(), hit ? 1 : 0
  emit(OP.LOAD, SLOT.acc, 0)
  emit(OP.EMIT, 0, 0)
  emit(OP.LOAD, SLOT.arr, 0)
  emit(OP.ARR_SIZE, 0, 0)
  emit(OP.EMIT, 1, 0)
  emit(OP.LOAD, SLOT.hit, 0)
  emit(OP.EMIT, 2, 0)

  return code
}

/**
 * Bars for the run.
 *
 * ⭐ ONE `na` IS PLANTED ON PURPOSE (bar 3, in `open`): every candidate has to
 * propagate it the same way, and a value model that turns `na` into 0 or into
 * the string "0" is caught by the agreement control rather than by a member. It
 * rides the string-and-collection path, which is what a missing bar in a
 * requested symbol actually looks like on a dashboard.
 *
 * ⚰️ IT USED TO SIT IN `close`, WHICH FEEDS THE RECURRENCE — so `acc` went NaN
 * at bar 3 and stayed NaN for the remaining 4,996 bars. Two costs, both found by
 * `--self-check`: agreement on that output was vacuous after bar 3 (NaN equals
 * NaN and the comparator rightly skips it), and the timing measured NaN
 * arithmetic rather than the arithmetic a real script runs. `close` is finite
 * everywhere now.
 */
export function buildSeries(bars) {
  const close = new Float64Array(bars)
  const open = new Float64Array(bars)
  for (let i = 0; i < bars; i += 1) {
    close[i] = 9 + Math.sin(i / 7)
    open[i] = i === 3 ? NaN : 9 + Math.cos(i / 11)
  }
  const zeros = () => new Float64Array(bars)
  return [open, zeros(), zeros(), close]   // open, high, low, close
}

export const OUTPUT_COUNT = 3
export const K = CONSTS[5]
