// tools/c5_value_model_spike/vm_boxed.mjs
//
// CANDIDATE A — one JS array of JS values.
//
// A slot holds whatever it holds: a double, a string, a boolean, a collection.
// `na` for a number is NaN, exactly as the columnar lane spells it.
//
// ⭐ THE HONEST VERSION OF "just use JS values". No tagging, no side tables, no
// compile-time routing — the array is polymorphic and the engine pays for that
// on every read. That cost is the thing being measured.
import { OP, SLOT_TYPES, CONSTS, OUTPUT_COUNT } from './program.mjs'

export const NAME = 'A — boxed (one polymorphic JS array)'

export function run(code, series, bars) {
  const outputs = []
  for (let i = 0; i < OUTPUT_COUNT; i += 1) outputs.push(new Float64Array(bars))

  // ⭐⭐ THE INITIAL VALUE IS PART OF THE ISA, NOT OF THE IMPLEMENTATION.
  // ⚰️ The first run of this spike disagreed at bar 0 — NaN here against 0.9 in
  // the other two — because this candidate left a slot `undefined` while a
  // `Float64Array` slot starts at 0. That is Pine's `var float acc = 0.0`
  // against an unassigned name, a semantic question the candidates must not each
  // answer for themselves. The agreement control caught it before a single
  // timing number was quoted, which is exactly what it is for.
  const slots = SLOT_TYPES.map((k) => (k === 'num' ? 0 : k === 'bool' ? false : null))
  const stack = new Array(64)
  let lastString = null

  for (let bar = 0; bar < bars; bar += 1) {
    let sp = 0
    let pc = 0
    while (pc < code.length) {
      const ins = code[pc]
      const op = ins[0]
      const a = ins[1]
      switch (op) {
        case OP.PUSH_CONST: stack[sp++] = CONSTS[a]; pc++; break
        case OP.PUSH_SERIES: stack[sp++] = series[a][bar]; pc++; break
        case OP.LOAD: stack[sp++] = slots[a]; pc++; break
        case OP.STORE: slots[a] = stack[--sp]; pc++; break
        case OP.ADD: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] + y; pc++; break }
        case OP.SUB: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] - y; pc++; break }
        case OP.MUL: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] * y; pc++; break }
        case OP.DIV: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] / y; pc++; break }
        case OP.LT: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] < y; pc++; break }
        case OP.GT: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] > y; pc++; break }
        case OP.EQ: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] === y; pc++; break }
        case OP.AND: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] && y; pc++; break }
        case OP.OR: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] || y; pc++; break }
        case OP.NOT: stack[sp - 1] = !stack[sp - 1]; pc++; break
        case OP.NUM_TO_STR: stack[sp - 1] = fmt(stack[sp - 1]); pc++; break
        case OP.STR_CONCAT: { const y = stack[--sp]; stack[sp - 1] = stack[sp - 1] + y; pc++; break }
        case OP.ARR_NEW: stack[sp++] = []; pc++; break
        case OP.ARR_PUSH: { const v = stack[--sp]; stack[--sp].push(v); pc++; break }
        case OP.ARR_GET: { const i = stack[--sp]; stack[sp - 1] = stack[sp - 1][i]; pc++; break }
        case OP.ARR_SIZE: stack[sp - 1] = stack[sp - 1].length; pc++; break
        case OP.JMP_IF_FALSE: { const c = stack[--sp]; pc = c ? pc + 1 : a; break }
        case OP.JMP: pc = a; break
        case OP.EMIT: {
          const v = stack[--sp]
          outputs[a][bar] = typeof v === 'boolean' ? (v ? 1 : 0) : v
          pc++
          break
        }
        case OP.PUSH_NA: stack[sp++] = NaN; pc++; break
        default: throw new Error(`unknown op ${op}`)
      }
    }
    lastString = slots[4]
  }
  return { outputs, lastString }
}

/** ⭐ ONE FORMATTER, SHARED BY EVERY CANDIDATE VIA COPY — they must agree on the
 *  STRING, not merely on the number, or the agreement control passes while the
 *  three disagree about what a member would read in a cell. */
export function fmt(n) {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : 'NaN'
}
