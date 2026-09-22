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

import { OP, SERIES_NAMES, CLOCK_FIELDS, makeProgram } from './program.js'
import { STMT, EXPR, SLOT } from './ir.js'
import { isVoid } from './collections.js'

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
  const textOps = []
  const colourOps = []
  const arrayOps = []
  const recordTypes = []
  const fieldNames = []

  const constIndex = (v) => {
    // ⛔ `indexOf` CANNOT FIND NaN (`NaN !== NaN`), so an `na` would push a new
    // const every time it appears. `findIndex` with `Object.is` interns it like
    // any other value.
    const i = consts.findIndex((c) => Object.is(c, v))
    if (i >= 0) return i
    consts.push(v)
    return consts.length - 1
  }
  // ⭐ Interned the same way `pointwise` is: the NAME lands in the artifact
  // once and the instruction carries an index, so two calls to the same
  // builtin cost one table entry.
  /** ⭐ INTERNED BY NAME, exactly as a text op is — two `color.new` call
   *  sites share one table entry, because the entry is an implementation
   *  reference and carries no per-site state. */
  const colourIndex = (name) => {
    const i = colourOps.indexOf(name)
    if (i >= 0) return i
    colourOps.push(name)
    return colourOps.length - 1
  }
  const textIndex = (name) => {
    const i = textOps.indexOf(name)
    if (i >= 0) return i
    textOps.push(name)
    return textOps.length - 1
  }
  // ⛔ KEYED BY NAME **AND** TYPE ARGUMENT. `array.new<float>(3)` and
  // `array.new<int>(3)` are the same NAME and different programs, so interning
  // on the name alone would give the second one the first one's element type.
  const arrayIndex = (fn, typeArg) => {
    const key = `${fn}<${typeArg || ''}>`
    for (let i = 0; i < arrayOps.length; i += 1) {
      if (`${arrayOps[i].fn}<${arrayOps[i].typeArg || ''}>` === key) return i
    }
    arrayOps.push({ fn, typeArg: typeArg || null })
    return arrayOps.length - 1
  }
  // ⛔⛔ KEYED BY THE TYPE NAME **AND** ITS FIELD LIST, for the reason
  // `arrayIndex` is keyed by name and type argument. Interning on the NAME
  // alone is the bug that shape exists to prevent one level up: two Pine
  // scripts cannot collide here, but a front end that ever compiled two
  // declarations of one name — a local type shadowing an outer one is the
  // obvious future case — would hand the second one the first one's fields,
  // and every construction after that would pair values with the wrong names.
  const recordIndex = (type, fields) => {
    const key = `${type}(${fields.join(',')})`
    for (let i = 0; i < recordTypes.length; i += 1) {
      if (`${recordTypes[i].type}(${recordTypes[i].fields.join(',')})` === key) return i
    }
    recordTypes.push({ type, fields: fields.slice() })
    return recordTypes.length - 1
  }
  /** ⭐ ONE TABLE FOR READS AND WRITES — a `top` read and a `top` write name
   *  one field, and two tables would be two indices for one string. */
  const fieldIndex = (name) => {
    const i = fieldNames.indexOf(name)
    if (i >= 0) return i
    fieldNames.push(name)
    return fieldNames.length - 1
  }
  // ⭐ WHERE `break` AND `continue` JUMP TO. A stack, because loops nest and the
  // innermost one owns both words — the depth is also what `LOOP_TICK` carries.
  const loops = []
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
      // ⭐ THE SAME OPCODE AND THE SAME POOL. `constIndex` interns with
      // `indexOf`, i.e. strict equality, so the number `5` and the string `"5"`
      // are two entries and cannot be confused for one another.
      case EXPR.STR: emit(OP.CONST, constIndex(e.value)); return
      // ⭐ THE SAME OPCODE AND THE SAME POOL AGAIN, and that is the whole of the
      // back end's involvement with a drawing handle: it is pushed, stored and
      // handed to a collection call, and NOTHING reads it. There is no `OP.DRAWING`
      // because there is no operation — a new opcode would be a branch in the VM
      // that could only ever do what `CONST` already does.
      //
      // ⛔ `constIndex` interns with `Object.is`, so the handle's OBJECT IDENTITY
      // decides: `ir.js::drawing` builds it once per node, so one create is one
      // pool entry and two creates are two. Never rebuild the sentinel here.
      case EXPR.DRAWING: emit(OP.CONST, constIndex(e.value)); return
      case EXPR.CONCAT: expr(e.left); expr(e.right); emit(OP.CONCAT); return
      // ⭐ EXACTLY THE `POINTWISE` SHAPE: arguments are pushed left to right,
      // then one instruction naming the function and how many it takes.
      case EXPR.TEXT: {
        for (const a of e.args) expr(a)
        emit(OP.TEXT, textIndex(e.fn), e.args.length)
        return
      }
      case EXPR.COLOUR: {
        for (const a of e.args) expr(a)
        emit(OP.COLOUR, colourIndex(e.fn), e.args.length)
        return
      }
      case EXPR.REQUEST:
        // ⭐ THE SYMBOL IS PUSHED, THEN ONE INSTRUCTION. Everything else the
        // request needs — which timeframe, where its expression lives, how
        // many values it yields — is in the artifact, because none of it can
        // change while the bar runs. The symbol can, and does.
        expr(e.symbol)
        emit(OP.REQUEST, e.site, e.results)
        return
      case EXPR.TUPLE:
        // ⛔ NO OPCODE. A tuple IS its elements on the stack, in written
        // order; only `RET` and a destructuring know how many to expect, and
        // both carry the count. Anything else reaching this leaves values
        // nothing pops, which the end-of-bar stack invariant then catches.
        for (const x of e.elements) expr(x)
        return
      case EXPR.ARRAY: {
        for (const a of e.args) expr(a)
        emit(OP.ARRAY, arrayIndex(e.fn, e.typeArg), e.args.length)
        return
      }
      // ⭐ THE SAME SHAPE AS `TEXT`/`ARRAY`: the field values are pushed in
      // DECLARATION order, then one instruction naming the type and the count.
      // The order is the contract `records.js` pairs names to values by, and
      // `validateProgram` checks the count against the type's own field list.
      case EXPR.RECORD: {
        for (const a of e.args) expr(a)
        emit(OP.RECORD, recordIndex(e.type, e.fields), e.args.length)
        return
      }
      case EXPR.FIELD:
        expr(e.of)
        emit(OP.FIELD_GET, fieldIndex(e.name))
        return
      case EXPR.SERIES: {
        const i = SERIES_NAMES.indexOf(e.name)
        if (i < 0) throw new LoweringGap('series', `\`${e.name}\` is not one of ${SERIES_NAMES.join(', ')}`)
        emit(OP.READ_SERIES, i)
        return
      }
      case EXPR.CLOCK: {
        const i = CLOCK_FIELDS.indexOf(e.field)
        if (i < 0) {
          throw new LoweringGap('clock',
            `\`${e.field}\` is not one of ${CLOCK_FIELDS.join(', ')}`)
        }
        emit(OP.READ_CLOCK, i)
        return
      }
      case EXPR.SESSION: emit(OP.SESSION, e.start, e.end); return
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
        if (e.of.kind === EXPR.SERIES) {
          const si = SERIES_NAMES.indexOf(e.of.name)
          if (si < 0) throw new LoweringGap('series', `\`${e.of.name}\``)
          if (e.back === 0) { emit(OP.READ_SERIES, si); return }
          emit(OP.READ_SERIES_HIST, si, e.back)
          return
        }
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
        // ⭐ INDEX THEN VALUE, so the VM pops value first — the same order
        // every two-operand op here uses, so nothing has to remember a
        // special case for this one.
        case STMT.EMIT_ITER:
          expr(s.index)
          expr(s.value)
          emit(OP.EMIT_ITER, s.iter)
          break
        case STMT.FOR: {
          // ⭐⭐ PINE'S LOOP, LOWERED FAITHFULLY, AND EVERY LINE HERE IS A
          // SEMANTIC DECISION RATHER THAN A CODING ONE:
          //
          //   · both bounds are INCLUSIVE — `1 to 4` runs four times;
          //   · when `to` is LESS than `from` the loop counts DOWN — `5 to 1` is
          //     five descending passes, not an empty loop;
          //   · `by` is a MAGNITUDE, so a descending loop steps by |by|;
          //   · `from`, `to` and `by` are evaluated ONCE, at entry.
          //
          // ⛔ THE DIRECTION IS DECIDED AT RUNTIME, NOT AT BUILD. The bounds are
          // usually `array.size(x) - 1`, which nothing knows before the bar runs,
          // so a lowering that picked a direction from the source text would be
          // right only for literal bounds — and wrong silently for every real
          // watchlist walk.
          const i = slotAddr(s.slot)
          const toS = slotAddr(s.toSlot)
          const stepS = slotAddr(s.stepSlot)
          const store = (sl) => emit(sl.kind === SLOT.PERSIST ? OP.STORE_PERSIST : OP.STORE_LOCAL, sl.index)
          const load = (sl) => emit(sl.kind === SLOT.PERSIST ? OP.LOAD_PERSIST : OP.LOAD_LOCAL, sl.index)

          expr(s.from); store(i)          // i = from
          expr(s.to); store(toS)          // to = <evaluated once>

          // step = |by|, then negated when the loop runs downward.
          expr(s.step); store(stepS)
          load(stepS); emit(OP.CONST, constIndex(0)); emit(OP.LT)   // by < 0
          load(stepS); emit(OP.NEG)                                  // -by
          load(stepS)                                                // by
          emit(OP.SELECT); store(stepS)                              // |by|
          load(i); load(toS); emit(OP.LE)                            // from <= to
          load(stepS)                                                // +|by|
          load(stepS); emit(OP.NEG)                                  // -|by|
          emit(OP.SELECT); store(stepS)

          const top = here()
          emit(OP.LOOP_TICK, loops.length + 1)
          // continue while (step > 0 ? i <= to : i >= to)
          load(stepS); emit(OP.CONST, constIndex(0)); emit(OP.GT)
          load(i); load(toS); emit(OP.LE)
          load(i); load(toS); emit(OP.GE)
          emit(OP.SELECT)
          const exitJump = here()
          emit(OP.JUMP_IF_FALSE, 0)

          loops.push({ breaks: [], continues: [] })
          stmts(s.body)
          const frame = loops.pop()

          const contTarget = here()
          load(i); load(stepS); emit(OP.ADD); store(i)
          emit(OP.JUMP, top)
          const endTarget = here()
          patch(exitJump, 1, endTarget)
          // ⛔ `continue` LANDS ON THE STEP, NOT ON THE TEST. Jumping to the test
          // would leave the counter where it was and loop forever on the same
          // value — a hang, not a wrong number, and the ceiling would be the only
          // thing that noticed.
          for (const at of frame.continues) patch(at, 1, contTarget)
          for (const at of frame.breaks) patch(at, 1, endTarget)
          break
        }
        case STMT.DESTRUCTURE: {
          // ⛔⛔ FILLED RIGHT TO LEFT, BECAUSE A STACK POPS IN REVERSE. The
          // values were pushed in written order, so the LAST name takes the
          // top of the stack. Filling left to right would assign every name
          // the wrong value — and each one is a plausible number, so the only
          // symptom is a dashboard column quietly showing the wrong figure.
          expr(s.value)
          for (let k = s.slots.length - 1; k >= 0; k -= 1) {
            const sl = slotAddr(s.slots[k])
            emit(sl.kind === SLOT.PERSIST ? OP.STORE_PERSIST : OP.STORE_LOCAL, sl.index)
          }
          break
        }
        case STMT.BREAK: case STMT.CONTINUE: {
          const frame = loops[loops.length - 1]
          if (!frame) {
            throw new LoweringGap(s.kind === STMT.BREAK ? 'break' : 'continue',
              'outside a loop')
          }
          const at = here()
          emit(OP.JUMP, 0)
          ;(s.kind === STMT.BREAK ? frame.breaks : frame.continues).push(at)
          break
        }
        case STMT.EXPR:
          // ⭐⭐ A CALL CAN NOW HAVE AN EFFECT — `array.push(a, x)` mutates the
          // collection and returns NOTHING. A void call leaves nothing on the
          // stack, so it needs no pop, which is why this needs no new opcode.
          //
          // ⛔ AND ONLY A VOID CALL IS ADMITTED. Any other expression WOULD push
          // a value nothing pops, growing the stack every bar until the run dies
          // far from the line that caused it — so the original refusal stands for
          // everything else, with its reason narrowed rather than deleted.
          if (s.value && s.value.kind === EXPR.ARRAY && isVoid(s.value.fn)) {
            expr(s.value)
            break
          }
          // ⭐⭐ A CALL-FOR-EFFECT — `zigzag(len, dev)` ON A LINE OF ITS OWN.
          // Pine evaluates the call and throws the result away; §16 says every
          // function has a result, so there is always something to throw away.
          // The COUNT comes from the statement (`fn.returns`), so a helper that
          // hands back a tuple discards all of it rather than the top of it.
          //
          // ⛔ AND ONLY WITH A COUNT. Lowering the call without the DROP would
          // push values nothing pops, growing the stack every bar until the run
          // dies far from the line that caused it — which is what the end-of-bar
          // `sp !== 0` rail in `vm.js` exists to catch on bar 0 instead.
          if (Number.isInteger(s.drop) && s.drop > 0) {
            expr(s.value)
            emit(OP.DROP, s.drop)
            break
          }
          throw new LoweringGap('an expression statement',
            'only a collection operation or a call-for-effect has an effect here')
        // ⭐⭐ `f.top := x`. The RECORD is pushed first and the VALUE second,
        // so `FIELD_SET` pops them in the order a two-operand opcode already
        // reads its stack — the same convention `CONCAT` and every binary use.
        // ⛔ IT PUSHES NOTHING BACK. Pine's field assignment is a statement and
        // yields no value; leaving the record on the stack "because it is handy"
        // is exactly the unpopped value the `EXPR` arm above refuses.
        case STMT.FIELD_SET:
          expr(s.of)
          expr(s.value)
          emit(OP.FIELD_SET, fieldIndex(s.name))
          break
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
    // ⛔ NO COUNT ON THE RETURN, and that is a measured decision rather than an
    // omission. The VM does not move a result across the frame boundary — `sp`
    // is not part of a frame — so a count here would be written, carried in
    // every artifact, and read by nothing. The count that IS load-bearing is
    // `fn.returns` on the definition, which a destructuring checks its own name
    // count against.
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
      windowCount: fn.windowCount || 0,
      effects: fn.effects || null,
      at: fn.at || null,
    }
  })

  // ── then every REQUEST's expression, as its own region of the same code ──
  //
  // ⭐⭐ A REGION, NOT A SECOND PROGRAM. The expression can call the same user
  // functions and read the same consts, and the only thing that differs when
  // it runs is which SERIES it reads — so it is executed by the same VM from a
  // different entry point, over the requested symbol's bars. A separate
  // program would have needed its own copy of every function this expression
  // calls, which is the second-authority defect in compiled form.
  const requests = (ir.requests || []).map((r) => {
    const entry = here()
    // ⭐⭐ THE HOISTED BINDINGS RUN FIRST, ON THE SAME BAR. A window inside a
    // request needs its source as a committed series, and the author has no line
    // to write that binding on — the front end hoists it here.
    stmts(r.statements || [])
    const value = r.value
    const results = value && value.kind === EXPR.TUPLE ? value.elements.length : 1
    if (results === 1) { expr(value); emit(OP.EMIT, 0) } else {
      // ⛔ EMITTED IN REVERSE, because the tuple pushed its elements left to
      // right and EMIT pops. Output k holds the kth written value.
      expr(value)
      for (let k = results - 1; k >= 0; k -= 1) emit(OP.EMIT, k)
    }
    emit(OP.HALT)
    return { timeframe: r.timeframe, entry, results }
  })

  return makeProgram({
    code,
    consts,
    columns: ir.columns,
    // ⛔ THE OUTPUT TABLE MUST COVER A REQUEST'S RESULTS TOO. A request stub
    // EMITs into its OWN run's outputs, and `validateProgram` checks every
    // EMIT index against this list — so a two-value request inside a script
    // with one plot needs room for two.
    outputs: (() => {
      const widest = (ir.requests || []).reduce((m, r) => Math.max(
        m, r.value && r.value.kind === EXPR.TUPLE ? r.value.elements.length : 1), 0)
      const outs = (ir.outputs || []).slice()
      while (outs.length < widest) {
        outs.push({ call: 'request', role: `result ${outs.length}` })
      }
      return outs
    })(),
    locals: ir.slots.filter((s) => s.owner === null && s.kind === SLOT.LOCAL).length,
    persists: persistTotal(ir),
    functions,
    pointwise,
    textOps,
    colourOps,
    // ⭐ carried through so a caller can find which output holds which tree
    objectTreeOutputs: ir.objectTreeOutputs || [],
    iterOutputs: ir.iterOutputs || [],
    arrayOps,
    recordTypes,
    fieldNames,
    requests,
    windows: (ir.windows || []).map((w) => ({ ...w })),
    carried: (ir.carried || []).map((c) => ({ ...c })),
    callSites: (ir.callSites || []).map((c) => ({
      fn: c.fn, persistBase: c.persistBase, historyBase: c.historyBase || 0,
      carriedBase: c.carriedBase || 0, windowBase: c.windowBase || 0, at: c.at || null,
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
