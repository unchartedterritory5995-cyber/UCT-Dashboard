// app/src/components/chart/engine/runtime/lowerIr.js
//
// ─── SEMANTIC IR → EXECUTABLE PROGRAM ───────────────────────────────────────
//
// The second lowering, and the one that carries STATEMENTS. `lower.js` takes a
// canonical expression tree (which has already lost them); this takes the IR,
// which was built to hold them.
//
// ⛔ WHAT IT REFUSES, IT REFUSES BY NAME. A declared-but-not-yet-lowerable IR
// shape (a loop, a call, a tuple, an array op, history over a variable) produces
// a named `LoweringGap` carrying the kind. Silently dropping one would be the
// defect this whole program exists to stop: a script that imports, saves,
// reopens and draws while quietly losing what it asked for.

import { OP, SERIES_NAMES, makeProgram } from './program.js'
import { STMT, EXPR, SLOT } from './ir.js'

export class LoweringGap extends Error {
  constructor(kind, detail) {
    super(`this runtime cannot yet lower ${kind}${detail ? ` — ${detail}` : ''}`)
    this.name = 'LoweringGap'
    this.kind = kind
  }
}

const BIN_OP = Object.freeze({
  '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV,
  '<': OP.LT, '>': OP.GT, '<=': OP.LE, '>=': OP.GE,
  '==': OP.EQ, '!=': OP.NE, '&&': OP.AND, '||': OP.OR,
})
const UN_OP = Object.freeze({ '!': OP.NOT, 'u-': OP.NEG })

export function lowerIrProgram(ir) {
  const code = []
  const consts = []

  // ⭐ IR SLOTS ARE ONE NUMBERING; THE PROGRAM HAS TWO. Locals and persists are
  // separate arrays in the runtime because they have different lifetimes, so the
  // lowering maps between them here — once, in one place, rather than every
  // emitter re-deriving it.
  const localOf = new Map()
  const persistOf = new Map()
  ir.slots.forEach((s, i) => {
    if (s.kind === SLOT.PERSIST) persistOf.set(i, persistOf.size)
    else localOf.set(i, localOf.size)
  })

  const constIndex = (v) => {
    const i = consts.indexOf(v)
    if (i >= 0) return i
    consts.push(v)
    return consts.length - 1
  }
  const emit = (op, a = 0, b = 0) => { code.push(op, a, b) }
  const here = () => code.length / 3
  const patch = (at, slot, value) => { code[at * 3 + slot] = value }

  const expr = (e) => {
    switch (e.kind) {
      case EXPR.NUM: emit(OP.CONST, constIndex(e.value)); return
      case EXPR.SERIES: {
        const i = SERIES_NAMES.indexOf(e.name)
        if (i < 0) throw new LoweringGap('series', `\`${e.name}\` is not one of ${SERIES_NAMES.join(', ')}`)
        emit(OP.READ_SERIES, i)
        return
      }
      case EXPR.COLUMN: emit(OP.READ_COLUMN, e.index); return
      case EXPR.READ: {
        const s = ir.slots[e.slot]
        if (s.kind === SLOT.PERSIST) emit(OP.LOAD_PERSIST, persistOf.get(e.slot))
        else emit(OP.LOAD_LOCAL, localOf.get(e.slot))
        return
      }
      case EXPR.HIST: {
        // ⛔ HISTORY IS OVER A COLUMN, AND HISTORY OF A VARIABLE IS A NAMED GAP.
        // `x[1]` where `x` is a mutable variable needs a per-slot ring buffer
        // written at the END of each bar — real Pine, real work, and 2E's. It is
        // refused here rather than approximated, because the plausible
        // approximation (read the slot's CURRENT value) is silently one bar wrong
        // on every bar.
        if (e.of.kind !== EXPR.COLUMN) {
          throw new LoweringGap('history over a variable',
            'only a precomputed column has history in this runtime yet')
        }
        emit(OP.READ_HIST, e.of.index, e.back)
        return
      }
      case EXPR.BINARY: {
        const op = BIN_OP[e.op]
        if (op === undefined) throw new LoweringGap('operator', `\`${e.op}\``)
        expr(e.left); expr(e.right); emit(op)
        return
      }
      case EXPR.UNARY: {
        const op = UN_OP[e.op]
        if (op === undefined) throw new LoweringGap('unary operator', `\`${e.op}\``)
        expr(e.of); emit(op)
        return
      }
      case EXPR.TERNARY:
        // ⚠️ BOTH ARMS ARE EVALUATED, which is correct for a Pine `?:` over pure
        // values and mirrors `interpret.js`. A branch that can have an EFFECT is
        // a statement — `STMT.IF` below — and must not be routed here.
        expr(e.test); expr(e.then); expr(e.else); emit(OP.SELECT)
        return
      default:
        throw new LoweringGap(e.kind)
    }
  }

  const stmts = (list) => {
    for (const s of list) {
      switch (s.kind) {
        case STMT.DECLARE: {
          const slot = ir.slots[s.slot]
          if (slot.kind === SLOT.PERSIST) {
            // ⭐⭐ `var x = e` — THE INITIALISER IS JUMPED OVER once the slot is
            // initialised, so it is not merely stored once, it is not EVALUATED
            // again. C3B's `var table t = table.new(…)` bug is the reason that
            // distinction is structural here.
            const p = persistOf.get(s.slot)
            const guard = here()
            emit(OP.JUMP_IF_INIT, p, 0)
            expr(s.value)
            emit(OP.STORE_PERSIST, p)
            patch(guard, 2, here())
          } else {
            expr(s.value)
            emit(OP.STORE_LOCAL, localOf.get(s.slot))
          }
          break
        }
        case STMT.ASSIGN: {
          const slot = ir.slots[s.slot]
          expr(s.value)
          if (slot.kind === SLOT.PERSIST) emit(OP.STORE_PERSIST, persistOf.get(s.slot))
          else emit(OP.STORE_LOCAL, localOf.get(s.slot))
          break
        }
        case STMT.IF: {
          expr(s.test)
          const toElse = here()
          emit(OP.JUMP_IF_FALSE, 0)
          stmts(s.then)
          const hasElse = (s.else || []).length > 0
          let toEnd = -1
          if (hasElse) { toEnd = here(); emit(OP.JUMP, 0) }
          patch(toElse, 1, here())
          if (hasElse) { stmts(s.else); patch(toEnd, 1, here()) }
          break
        }
        case STMT.EMIT:
          expr(s.value)
          emit(OP.EMIT, s.output)
          break
        case STMT.EXPR:
          // ⛔ NOT LOWERED AS A DISCARDED PUSH. An expression evaluated for
          // effect is meaningful only once a call can HAVE an effect; until then
          // emitting it would push a value nothing pops and quietly grow the
          // stack every bar.
          throw new LoweringGap('an expression statement', 'no call in this runtime has an effect yet')
        default:
          throw new LoweringGap(s.kind)
      }
    }
  }

  stmts(ir.statements)
  emit(OP.HALT)

  return makeProgram({
    code,
    consts,
    columns: ir.columns,
    outputs: ir.outputs,
    locals: localOf.size,
    persists: persistOf.size,
    version: ir.version,
  })
}
