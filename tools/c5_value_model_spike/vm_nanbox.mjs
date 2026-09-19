// tools/c5_value_model_spike/vm_nanbox.mjs
//
// CANDIDATE B — every slot is a double; non-numbers ride in a quiet NaN.
//
// Layout (little-endian, which is what this box and every deploy target is):
//   high word  0x7FF8_0000 | tag     tag != 0 marks a boxed value
//   low  word  payload                index into a side table, or 0/1 for a bool
//
// A plain NaN — tag 0, payload 0 — is `na`, so the numeric lane's own NaN rule
// keeps working untouched.
//
// ⛔⛔ THIS FILE'S REAL OUTPUT IS A CORRECTNESS ANSWER, NOT A TIMING ONE. In C++
// the compiler controls every move of a double. In JavaScript the engine may
// canonicalise a NaN when it passes through a variable, an argument, an array
// element or the operand stack — and a canonicalised NaN has lost its payload,
// which turns a string into a different string or into nothing. `payloadSurvival`
// measures whether that happens here, on this engine, through the exact paths
// this VM uses. If it does not survive, B is out on correctness and its speed is
// irrelevant.
import { OP, SLOT_TYPES, CONSTS, OUTPUT_COUNT } from './program.mjs'
import { fmt } from './vm_boxed.mjs'

export const NAME = 'B — NaN-boxed (one Float64Array + side tables)'

const buf = new ArrayBuffer(8)
const f64 = new Float64Array(buf)
const u32 = new Uint32Array(buf)

export const TAG = Object.freeze({ NA: 0, STR: 1, ARR: 2, BOOL: 3 })

export function box(tag, payload) {
  u32[0] = payload >>> 0
  u32[1] = 0x7FF80000 | (tag & 0xFFFF)
  return f64[0]
}

export function tagOf(v) {
  if (!Number.isNaN(v)) return -1          // an ordinary double
  f64[0] = v
  return (u32[1] & 0x7FF80000) === 0x7FF80000 ? (u32[1] & 0xFFFF) : TAG.NA
}

export function payloadOf(v) {
  f64[0] = v
  return u32[0]
}

/**
 * Does a payload survive the paths this VM actually moves values through?
 *
 * ⭐ EACH PATH IS MEASURED SEPARATELY, because they are not the same question:
 * a Float64Array store is the one every textbook says is safe, while a plain
 * local, a function argument and a boxed array element are where an engine is
 * free to canonicalise.
 */
export function payloadSurvival() {
  const probe = box(TAG.STR, 12345)
  const through = (v) => v                       // argument + return
  const f64slot = new Float64Array(1)
  f64slot[0] = probe
  const boxedArr = [probe]
  let local = probe
  local = local                                   // eslint-disable-line no-self-assign
  const stackLike = new Float64Array(8)
  stackLike[3] = probe

  return {
    float64array: payloadOf(f64slot[0]) === 12345 && tagOf(f64slot[0]) === TAG.STR,
    local: payloadOf(local) === 12345 && tagOf(local) === TAG.STR,
    argument: payloadOf(through(probe)) === 12345 && tagOf(through(probe)) === TAG.STR,
    jsArrayElement: payloadOf(boxedArr[0]) === 12345 && tagOf(boxedArr[0]) === TAG.STR,
    operandStack: payloadOf(stackLike[3]) === 12345 && tagOf(stackLike[3]) === TAG.STR,
  }
}

export function run(code, series, bars) {
  const outputs = []
  for (let i = 0; i < OUTPUT_COUNT; i += 1) outputs.push(new Float64Array(bars))

  const slots = new Float64Array(SLOT_TYPES.length)
  const stack = new Float64Array(64)
  const strings = []
  const arrays = []
  const constBox = CONSTS.map((c) => (typeof c === 'string' ? box(TAG.STR, strings.push(c) - 1) : c))
  let lastString = null

  const str = (v) => strings[payloadOf(v)]
  const arr = (v) => arrays[payloadOf(v)]
  const newStr = (s) => box(TAG.STR, strings.push(s) - 1)

  for (let bar = 0; bar < bars; bar += 1) {
    let sp = 0
    let pc = 0
    while (pc < code.length) {
      const ins = code[pc]
      const op = ins[0]
      const a = ins[1]
      switch (op) {
        case OP.PUSH_CONST: stack[sp++] = constBox[a]; pc++; break
        case OP.PUSH_SERIES: stack[sp++] = series[a][bar]; pc++; break
        case OP.LOAD: stack[sp++] = slots[a]; pc++; break
        case OP.STORE: slots[a] = stack[--sp]; pc++; break
        case OP.ADD: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] + y; pc++; break }
        case OP.SUB: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] - y; pc++; break }
        case OP.MUL: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] * y; pc++; break }
        case OP.DIV: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] / y; pc++; break }
        case OP.LT: { const y = stack[--sp]; stack[sp - 1] = box(TAG.BOOL, stack[sp - 1] < y ? 1 : 0); pc++; break }
        case OP.GT: { const y = stack[--sp]; stack[sp - 1] = box(TAG.BOOL, stack[sp - 1] > y ? 1 : 0); pc++; break }
        case OP.EQ: {
          const y = stack[--sp]
          const x = stack[sp - 1]
          const eq = tagOf(x) === TAG.STR && tagOf(y) === TAG.STR ? str(x) === str(y) : x === y
          stack[sp - 1] = box(TAG.BOOL, eq ? 1 : 0)
          pc++
          break
        }
        case OP.AND: { const y = stack[--sp]; stack[sp - 1] = box(TAG.BOOL, (payloadOf(stack[sp - 1]) && payloadOf(y)) ? 1 : 0); pc++; break }
        case OP.OR: { const y = stack[--sp]; stack[sp - 1] = box(TAG.BOOL, (payloadOf(stack[sp - 1]) || payloadOf(y)) ? 1 : 0); pc++; break }
        case OP.NOT: stack[sp - 1] = box(TAG.BOOL, payloadOf(stack[sp - 1]) ? 0 : 1); pc++; break
        case OP.NUM_TO_STR: stack[sp - 1] = newStr(fmt(stack[sp - 1])); pc++; break
        case OP.STR_CONCAT: { const y = stack[--sp]; stack[sp - 1] = newStr(str(stack[sp - 1]) + str(y)); pc++; break }
        case OP.ARR_NEW: stack[sp++] = box(TAG.ARR, arrays.push([]) - 1); pc++; break
        case OP.ARR_PUSH: { const v = stack[--sp]; arr(stack[--sp]).push(v); pc++; break }
        case OP.ARR_GET: { const i = payloadOf(stack[--sp]); stack[sp - 1] = arr(stack[sp - 1])[i]; pc++; break }
        case OP.ARR_SIZE: stack[sp - 1] = arr(stack[sp - 1]).length; pc++; break
        case OP.JMP_IF_FALSE: { const c = stack[--sp]; pc = payloadOf(c) ? pc + 1 : a; break }
        case OP.JMP: pc = a; break
        case OP.EMIT: {
          const v = stack[--sp]
          outputs[a][bar] = tagOf(v) === TAG.BOOL ? payloadOf(v) : v
          pc++
          break
        }
        case OP.PUSH_NA: stack[sp++] = NaN; pc++; break
        default: throw new Error(`unknown op ${op}`)
      }
    }
    lastString = tagOf(slots[4]) === TAG.STR ? str(slots[4]) : null
    // ⚠️ THE SIDE TABLES GROW FOREVER IN THIS SPIKE, and that is deliberate: a
    // real runtime needs a reclamation story for them, and pretending otherwise
    // here would hide a cost that belongs in the decision.
  }
  return { outputs, lastString, sideTableSize: strings.length + arrays.length }
}
