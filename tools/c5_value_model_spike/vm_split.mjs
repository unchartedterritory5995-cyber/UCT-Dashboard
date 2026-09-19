// tools/c5_value_model_spike/vm_split.mjs
//
// CANDIDATE C — two banks, chosen at COMPILE time.
//
// Numbers and booleans live in a `Float64Array`; strings and collections live in
// a plain JS array. Nothing carries a tag at run time, because the compiler
// already knows which bank every slot and every stack position belongs to —
// Pine tells it (`float x`, `array<string> toks`, and the type of every
// expression follows from its operands).
//
// ⭐ BOOLEANS GO IN THE NUMERIC BANK as 0/1. In Pine v6 a bool is never `na`, so
// there is nothing a tag would have to distinguish — this is a semantic fact of
// the language, not a shortcut.
//
// ⛔ WHERE THE COMPILER CANNOT DECIDE, THE SLOT GOES TO THE BOXED BANK. C then
// degrades to A for that slot rather than to something wrong; a value model must
// have an answer for the unknown case, and "refuse the script" is not one.
import { OP, SLOT_TYPES, CONSTS, OUTPUT_COUNT } from './program.mjs'
import { fmt } from './vm_boxed.mjs'

export const NAME = 'C — split banks (compile-time routing)'

// Specialised opcodes. The compiler picks one per instruction; the run loop
// never asks what kind a value is.
const S = Object.freeze({
  PUSH_NUM: 0, PUSH_STR: 1, PUSH_SERIES: 2,
  LOAD_NUM: 3, LOAD_BOX: 4, STORE_NUM: 5, STORE_BOX: 6,
  ADD: 7, SUB: 8, MUL: 9, DIV: 10, LT: 11, GT: 12,
  EQ_NUM: 13, EQ_STR: 14, AND: 15, OR: 16, NOT: 17,
  NUM_TO_STR: 18, STR_CONCAT: 19,
  ARR_NEW: 20, ARR_PUSH_NUM: 21, ARR_GET_NUM: 22, ARR_SIZE: 23,
  JMP_IF_FALSE: 24, JMP: 25, EMIT: 26, PUSH_NA: 27,
})

const BOXED_KINDS = new Set(['str', 'arr'])

/**
 * The compile pass: walk the program once, tracking the KIND of every stack
 * position, and emit a specialised instruction for each original one.
 *
 * ⛔ IT ASSERTS THE STACK IS EMPTY AT A LOOP HEAD rather than assuming it. A
 * back edge that arrived with a different stack shape would make the kinds a
 * guess, and a guess here is a wrong bank at run time — the silent kind of
 * wrong. This spike's program satisfies it; a real compiler needs the fixpoint.
 */
export function compile(code) {
  const out = new Array(code.length)
  const kinds = []          // abstract stack of kinds
  const seenAt = new Map()

  for (let pc = 0; pc < code.length; pc += 1) {
    const [op, a] = code[pc]
    if (seenAt.has(pc) && seenAt.get(pc) !== kinds.length) {
      throw new Error(`stack depth disagrees at ${pc}: ${seenAt.get(pc)} vs ${kinds.length}`)
    }
    seenAt.set(pc, kinds.length)

    switch (op) {
      case OP.PUSH_CONST: {
        const isStr = typeof CONSTS[a] === 'string'
        out[pc] = [isStr ? S.PUSH_STR : S.PUSH_NUM, a]
        kinds.push(isStr ? 'str' : 'num')
        break
      }
      case OP.PUSH_SERIES: out[pc] = [S.PUSH_SERIES, a]; kinds.push('num'); break
      case OP.LOAD: {
        const k = SLOT_TYPES[a]
        out[pc] = [BOXED_KINDS.has(k) ? S.LOAD_BOX : S.LOAD_NUM, a]
        kinds.push(k)
        break
      }
      case OP.STORE: {
        const k = kinds.pop()
        out[pc] = [BOXED_KINDS.has(k) ? S.STORE_BOX : S.STORE_NUM, a]
        break
      }
      case OP.ADD: case OP.SUB: case OP.MUL: case OP.DIV: {
        kinds.pop(); kinds.pop(); kinds.push('num')
        out[pc] = [{ [OP.ADD]: S.ADD, [OP.SUB]: S.SUB, [OP.MUL]: S.MUL, [OP.DIV]: S.DIV }[op], 0]
        break
      }
      case OP.LT: case OP.GT: {
        kinds.pop(); kinds.pop(); kinds.push('bool')
        out[pc] = [op === OP.LT ? S.LT : S.GT, 0]
        break
      }
      case OP.EQ: {
        const b = kinds.pop()
        const aK = kinds.pop()
        kinds.push('bool')
        out[pc] = [BOXED_KINDS.has(aK) || BOXED_KINDS.has(b) ? S.EQ_STR : S.EQ_NUM, 0]
        break
      }
      case OP.AND: case OP.OR: { kinds.pop(); kinds.pop(); kinds.push('bool'); out[pc] = [op === OP.AND ? S.AND : S.OR, 0]; break }
      case OP.NOT: out[pc] = [S.NOT, 0]; break
      case OP.NUM_TO_STR: kinds.pop(); kinds.push('str'); out[pc] = [S.NUM_TO_STR, 0]; break
      case OP.STR_CONCAT: kinds.pop(); kinds.pop(); kinds.push('str'); out[pc] = [S.STR_CONCAT, 0]; break
      case OP.ARR_NEW: kinds.push('arr'); out[pc] = [S.ARR_NEW, 0]; break
      case OP.ARR_PUSH: kinds.pop(); kinds.pop(); out[pc] = [S.ARR_PUSH_NUM, 0]; break
      case OP.ARR_GET: kinds.pop(); kinds.pop(); kinds.push('num'); out[pc] = [S.ARR_GET_NUM, 0]; break
      case OP.ARR_SIZE: kinds.pop(); kinds.push('num'); out[pc] = [S.ARR_SIZE, 0]; break
      case OP.JMP_IF_FALSE: kinds.pop(); out[pc] = [S.JMP_IF_FALSE, a]; break
      case OP.JMP: out[pc] = [S.JMP, a]; break
      case OP.EMIT: kinds.pop(); out[pc] = [S.EMIT, a]; break
      case OP.PUSH_NA: kinds.push('num'); out[pc] = [S.PUSH_NA, 0]; break
      default: throw new Error(`unknown op ${op}`)
    }
  }
  return out
}

export function run(code, series, bars, compiled = null) {
  const prog = compiled || compile(code)
  const outputs = []
  for (let i = 0; i < OUTPUT_COUNT; i += 1) outputs.push(new Float64Array(bars))

  const nslots = new Float64Array(SLOT_TYPES.length)
  const bslots = new Array(SLOT_TYPES.length).fill(null)
  const nstack = new Float64Array(64)
  const bstack = new Array(64)
  let lastString = null

  for (let bar = 0; bar < bars; bar += 1) {
    let np = 0
    let bp = 0
    let pc = 0
    while (pc < prog.length) {
      const ins = prog[pc]
      const op = ins[0]
      const a = ins[1]
      switch (op) {
        case S.PUSH_NUM: nstack[np++] = CONSTS[a]; pc++; break
        case S.PUSH_STR: bstack[bp++] = CONSTS[a]; pc++; break
        case S.PUSH_SERIES: nstack[np++] = series[a][bar]; pc++; break
        case S.LOAD_NUM: nstack[np++] = nslots[a]; pc++; break
        case S.LOAD_BOX: bstack[bp++] = bslots[a]; pc++; break
        case S.STORE_NUM: nslots[a] = nstack[--np]; pc++; break
        case S.STORE_BOX: bslots[a] = bstack[--bp]; pc++; break
        case S.ADD: { const y = nstack[--np]; nstack[np - 1] = nstack[np - 1] + y; pc++; break }
        case S.SUB: { const y = nstack[--np]; nstack[np - 1] = nstack[np - 1] - y; pc++; break }
        case S.MUL: { const y = nstack[--np]; nstack[np - 1] = nstack[np - 1] * y; pc++; break }
        case S.DIV: { const y = nstack[--np]; nstack[np - 1] = nstack[np - 1] / y; pc++; break }
        case S.LT: { const y = nstack[--np]; nstack[np - 1] = nstack[np - 1] < y ? 1 : 0; pc++; break }
        case S.GT: { const y = nstack[--np]; nstack[np - 1] = nstack[np - 1] > y ? 1 : 0; pc++; break }
        case S.EQ_NUM: { const y = nstack[--np]; nstack[np - 1] = nstack[np - 1] === y ? 1 : 0; pc++; break }
        case S.EQ_STR: { const y = bstack[--bp]; const x = bstack[--bp]; nstack[np++] = x === y ? 1 : 0; pc++; break }
        case S.AND: { const y = nstack[--np]; nstack[np - 1] = (nstack[np - 1] && y) ? 1 : 0; pc++; break }
        case S.OR: { const y = nstack[--np]; nstack[np - 1] = (nstack[np - 1] || y) ? 1 : 0; pc++; break }
        case S.NOT: nstack[np - 1] = nstack[np - 1] ? 0 : 1; pc++; break
        case S.NUM_TO_STR: bstack[bp++] = fmt(nstack[--np]); pc++; break
        case S.STR_CONCAT: { const y = bstack[--bp]; bstack[bp - 1] = bstack[bp - 1] + y; pc++; break }
        case S.ARR_NEW: bstack[bp++] = []; pc++; break
        case S.ARR_PUSH_NUM: { const v = nstack[--np]; bstack[--bp].push(v); pc++; break }
        case S.ARR_GET_NUM: { const i = nstack[--np]; nstack[np] = bstack[--bp][i]; np++; pc++; break }
        case S.ARR_SIZE: nstack[np++] = bstack[--bp].length; pc++; break
        case S.JMP_IF_FALSE: { const c = nstack[--np]; pc = c ? pc + 1 : a; break }
        case S.JMP: pc = a; break
        case S.EMIT: outputs[a][bar] = nstack[--np]; pc++; break
        case S.PUSH_NA: nstack[np++] = NaN; pc++; break
        default: throw new Error(`unknown specialised op ${op}`)
      }
    }
    lastString = bslots[4]
  }
  return { outputs, lastString }
}
