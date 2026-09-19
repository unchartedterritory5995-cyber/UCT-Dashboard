// tools/c4_phase2a_runtime_spike/program.mjs
//
// THE ONE PROGRAM, ASSEMBLED ONCE. Every implementation reads this JSON — nobody
// hand-writes the instruction list twice, because two hand-encodings of "the same
// program" is the second-authority defect that would make the whole measurement
// meaningless.
//
// `node program.mjs > program.json` regenerates it.

const OP = {
  PUSH_CONST: 0, PUSH_SERIES: 1, PUSH_HIST: 2,
  ADD: 3, SUB: 4, MUL: 5, DIV: 6, LT: 7,
  LOAD_LOCAL: 8, STORE_LOCAL: 9, LOAD_PERSIST: 10, STORE_PERSIST: 11,
  JUMP_IF_FALSE: 12, JUMP: 13,
  ARR_PUSH: 14, ARR_GET: 15, ARR_SIZE: 16,
  EMIT: 17, POP: 18, HALT: 19,
}

export function assemble(lookback) {
  const consts = [0.9, 0.1, 0, 1, lookback]
  const K = { C9: 0, C1: 1, ZERO: 2, ONE: 3, LOOKBACK: 4 }
  const SER = { CLOSE: 3 }
  const L = { I: 0, SUM: 1 }
  const P = { ACC: 0 }
  const code = []
  const emit = (op, a = 0, b = 0) => { code.push(op, a, b) }
  const here = () => code.length / 3

  // acc := acc * 0.9 + close * 0.1
  emit(OP.LOAD_PERSIST, P.ACC)
  emit(OP.PUSH_CONST, K.C9)
  emit(OP.MUL)
  emit(OP.PUSH_SERIES, SER.CLOSE)
  emit(OP.PUSH_CONST, K.C1)
  emit(OP.MUL)
  emit(OP.ADD)
  emit(OP.STORE_PERSIST, P.ACC)

  // i = 0 ; sum = 0
  emit(OP.PUSH_CONST, K.ZERO)
  emit(OP.STORE_LOCAL, L.I)
  emit(OP.PUSH_CONST, K.ZERO)
  emit(OP.STORE_LOCAL, L.SUM)

  // while i < LOOKBACK
  const top = here()
  emit(OP.LOAD_LOCAL, L.I)
  emit(OP.PUSH_CONST, K.LOOKBACK)
  emit(OP.LT)
  const exitPatch = here()
  emit(OP.JUMP_IF_FALSE, 0)

  //   sum := sum + close[i]
  // ⛔ THE HISTORY OFFSET IS THE LOOP COUNTER, so `PUSH_HIST` cannot be hoisted
  // or folded by any host — the loop body genuinely re-reads history each pass,
  // which is the work a real runtime does and the reason this is not a constant.
  emit(OP.LOAD_LOCAL, L.SUM)
  emit(OP.LOAD_LOCAL, L.I)
  emit(OP.PUSH_HIST, SER.CLOSE, -1) // -1 = "offset comes from the stack"
  emit(OP.ADD)
  emit(OP.STORE_LOCAL, L.SUM)
  //   i := i + 1
  emit(OP.LOAD_LOCAL, L.I)
  emit(OP.PUSH_CONST, K.ONE)
  emit(OP.ADD)
  emit(OP.STORE_LOCAL, L.I)
  emit(OP.JUMP, top)
  code[exitPatch * 3 + 1] = here()

  // mean = sum / LOOKBACK
  emit(OP.LOAD_LOCAL, L.SUM)
  emit(OP.PUSH_CONST, K.LOOKBACK)
  emit(OP.DIV)
  emit(OP.STORE_LOCAL, L.SUM)

  // arr.push(mean)
  emit(OP.LOAD_LOCAL, L.SUM)
  emit(OP.ARR_PUSH, 0)

  // emit(mean - acc)
  emit(OP.LOAD_LOCAL, L.SUM)
  emit(OP.LOAD_PERSIST, P.ACC)
  emit(OP.SUB)
  emit(OP.EMIT, 0)
  emit(OP.HALT)

  return { consts, code, locals: 2, persists: 1, arrays: 1, outputs: 1, lookback }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`
    || process.argv[1]?.endsWith('program.mjs')) {
  const lookback = Number(process.argv[2] || 20)
  process.stdout.write(JSON.stringify(assemble(lookback), null, 2))
}
