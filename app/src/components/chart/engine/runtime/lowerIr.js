// app/src/components/chart/engine/runtime/lowerIr.js
//
// ─── SEMANTIC IR → EXECUTABLE PROGRAM ───────────────────────────────────────
//
// The lowering that carries STATEMENTS. `lower.js` takes a canonical expression
// tree (which has already lost them); this takes the IR, which was built to hold
// them, and since 2E it also carries FUNCTIONS.
//
// ⛔ WHAT IT REFUSES, IT REFUSES BY NAME. A declared-but-not-yet-lowerable IR
// shape (a loop, a tuple, an array op, history over a variable) produces a named
// `LoweringGap` carrying the kind. Silently dropping one would be the defect this
// whole program exists to stop: a script that imports, saves, reopens and draws
// while quietly losing what it asked for.

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
  const pointwise = []

  const constIndex = (v) => {
    const i = consts.indexOf(v)
    if (i >= 0) return i
    consts.push(v)
    return consts.length - 1
  }
  const emit = (op, a = 0, b = 0) => { code.push(op, a, b) }
  const here = () => code.length / 3
  const patch = (at, slot, value) => { code[at * 3 + slot] = value }

  /** ⭐ SLOT ADDRESSES COME FROM THE IR, NOT FROM A SECOND WALK. `ir.js` gave
   *  every slot an owner and a frame-relative index; this only reads them, so it
   *  cannot disagree with the front end about which frame a variable lives in. */
  const slotAddr = (i) => {
    const s = ir.slots[i]
    if (!s) throw new LoweringGap('slot', `${i} is outside the slot table`)
    return s
  }

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
        const s = slotAddr(e.slot)
        emit(s.kind === SLOT.PERSIST ? OP.LOAD_PERSIST : OP.LOAD_LOCAL, s.index)
        return
      }
      case EXPR.HIST: {
        // ⭐⭐ 2F-2 — TWO HISTORIES, TOLD APART BY WHAT THEY ARE OVER.
        //
        // A COLUMN's history is the pure lane's: the whole series was computed
        // before the bar loop started, so `[n]` is an index into it.
        //
        // A READ's history is the runtime's: the value did not exist until the
        // bar produced it, and its past bars exist only because the commit phase
        // stored them. `READ_HIST_SLOT` addresses the RING, never the slot.
        //
        // ⛔ `x[0]` IS NOT HISTORY. Pine's `x[0]` is `x` — the live value at this
        // point in the program — and routing it through the ring would answer
        // with the PREVIOUS bar, one bar wrong in the one case a reader would
        // never think to check.
        if (e.of.kind === EXPR.COLUMN) { emit(OP.READ_HIST, e.of.index, e.back); return }
        if (e.of.kind === EXPR.READ) {
          if (e.back === 0) { expr(e.of); return }
          emit(OP.READ_HIST_SLOT, e.slot, e.back)
          return
        }
        // ⛔ HISTORY OVER AN ARBITRARY EXPRESSION IS STILL A NAMED GAP. `(a+b)[1]`
        // is a real Pine form and it needs its own committed series; approximating
        // it as `a[1]+b[1]` is right for `+` and wrong the moment the expression
        // contains anything with state.
        throw new LoweringGap('history over an expression',
          'only a column and a variable have committed history in this runtime yet')
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
        // ⚠️ BOTH ARMS EVALUATE — Pine's `?:` over values, mirroring
        // `interpret.js`. A branch that can have an EFFECT is a statement
        // (`STMT.IF`) and must never be routed here.
        expr(e.test); expr(e.then); expr(e.else); emit(OP.SELECT)
        return
      case EXPR.BUILTIN: {
        for (const a of e.args) expr(a)
        let i = pointwise.indexOf(e.fn)
        if (i < 0) { pointwise.push(e.fn); i = pointwise.length - 1 }
        emit(OP.POINTWISE, i, e.args.length)
        return
      }
      case EXPR.WINDOW: {
        // ⭐ THE SOURCE'S LIVE VALUE IS PUSHED FIRST, then WINDOW consumes it and
        // draws the rest of the span from that series' committed ring. The live
        // bar is PART OF the window — `rolling` reduces bars `i-n+1 .. i` — so a
        // span of n needs n-1 committed bars plus this one, never n committed.
        expr(e.source)
        emit(OP.WINDOW, e.site)
        return
      }
      case EXPR.CARRIED: {
        // ⭐ THE SOURCE'S VALUE FOR THIS BAR IS PUSHED FIRST; CARRIED consumes it,
        // steps the instance's cells and leaves the emitted value. There is no
        // history read at all — a recurrent builtin remembers its own OUTPUT, so
        // asking for a ring of its INPUTS would allocate memory the semantics
        // never needed (the 2F-2C performance win).
        expr(e.source)
        emit(OP.CARRIED, e.site)
        return
      }
      case EXPR.CALL: {
        // ⭐ ARGUMENTS PUSH LEFT TO RIGHT; the frame pops them in reverse. The
        // order is fixed HERE rather than left to the host, because once an
        // argument can contain a stateful call it becomes observable Pine
        // semantics rather than an implementation detail.
        for (const a of e.args) expr(a)
        emit(OP.CALL, e.fn, e.site)
        return
      }
      default:
        throw new LoweringGap(e.kind)
    }
  }

  const stmts = (list) => {
    for (const s of list) {
      switch (s.kind) {
        case STMT.DECLARE: {
          const slot = slotAddr(s.slot)
          if (slot.kind === SLOT.PERSIST) {
            // ⭐⭐ `var x = e` — THE INITIALISER IS JUMPED OVER once the slot is
            // initialised, so it is not merely stored once, it is not EVALUATED
            // again. C3B's `var table t = table.new(…)` bug is why that
            // distinction is structural rather than a flag inside STORE.
            const guard = here()
            emit(OP.JUMP_IF_INIT, slot.index, 0)
            expr(s.value)
            emit(OP.STORE_PERSIST, slot.index)
            patch(guard, 2, here())
          } else {
            expr(s.value)
            emit(OP.STORE_LOCAL, slot.index)
          }
          break
        }
        case STMT.ASSIGN: {
          const slot = slotAddr(s.slot)
          expr(s.value)
          emit(slot.kind === SLOT.PERSIST ? OP.STORE_PERSIST : OP.STORE_LOCAL, slot.index)
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
          // effect is meaningful only once a call can HAVE an effect; emitting it
          // now would push a value nothing pops and grow the stack every bar.
          throw new LoweringGap('an expression statement', 'no call in this runtime has an effect yet')
        default:
          throw new LoweringGap(s.kind)
      }
    }
  }

  // ── the main program ──
  stmts(ir.statements)
  emit(OP.HALT)

  // ── then every function body, after the HALT ──
  // ⭐ ONE CODE ARRAY. A function is a REGION of it with an entry pc, so a call is
  // a jump rather than a second interpreter — and every instruction executed
  // inside a call is charged to the same program budget for free (§57).
  const functions = (ir.functions || []).map((fn) => {
    const entry = here()
    stmts(fn.body || [])
    expr(fn.result)
    emit(OP.RET)
    return {
      name: fn.name,
      entry,
      params: fn.params,
      frameSize: fn.frameSize,
      persistCount: fn.persistCount,
      // ⭐ P7.2 — how many history rings ONE invocation of this function owns, and
      // which frame slots the RET hand-off copies from. Per FUNCTION; the SITE
      // supplies the base.
      historyCount: fn.historyCount || 0,
      historySlots: (fn.historySlots || []).slice(),
      historyPersist: (fn.historyPersist || []).slice(),
      // ⭐ 2F-2C — how many carried instances ONE invocation of this function
      // owns. Per FUNCTION; the SITE supplies the base, exactly as for history.
      carriedCount: fn.carriedCount || 0,
      effects: fn.effects || null,
      at: fn.at || null,
    }
  })

  return makeProgram({
    code,
    consts,
    columns: ir.columns,
    outputs: ir.outputs,
    locals: ir.slots.filter((s) => s.owner === null && s.kind === SLOT.LOCAL).length,
    persists: persistTotal(ir),
    functions,
    pointwise,
    windows: (ir.windows || []).map((w) => ({ ...w })),
    carried: (ir.carried || []).map((c) => ({ ...c })),
    callSites: (ir.callSites || []).map((c) => ({
      fn: c.fn, persistBase: c.persistBase, historyBase: c.historyBase || 0,
      carriedBase: c.carriedBase || 0, at: c.at || null,
    })),
    // ⭐ CARRIED THROUGH, NOT RE-DERIVED. The front end's static demand analysis
    // decided which values bear history and how deep; this only copies it, so the
    // ring the VM allocates and the depth the validator enforces cannot come from
    // two different answers to the same question.
    history: (ir.history || []).map((h) => ({
      name: h.name, varSlot: h.varSlot, slot: h.slot, persist: h.persist, depth: h.depth,
      // ⭐ `site` is null for a main-program series and the CALL SITE index for a
      // function-local one. The commit phase branches on it: a main entry reads
      // its live slot at end of bar; a site entry commits what that site last
      // HELD, which is what makes a skipped call re-commit rather than blank.
      site: h.site === undefined ? null : h.site,
    })),
    version: ir.version,
  })
}

/** Main-program persists come first; every call site's function-local block
 *  follows.
 *
 *  ⛔ DERIVED FROM THE SAME ALLOCATION THE FRONT END MADE. The front end assigns
 *  each `persistBase`; this only has to be large enough to hold the highest one,
 *  so the two numbers cannot drift into a buffer the runtime reads past. */
function persistTotal(ir) {
  const main = ir.slots.filter((s) => s.owner === null && s.kind === SLOT.PERSIST).length
  let top = main
  for (const cs of ir.callSites || []) {
    const fn = ir.functions[cs.fn]
    top = Math.max(top, cs.persistBase + (fn ? fn.persistCount : 0))
  }
  return top
}
