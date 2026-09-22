// app/src/components/chart/engine/runtime/ir.js
//
// ─── THE SEMANTIC IR — the artifact that can hold a PROGRAM ─────────────────
//
// ⛔⛔ THIS IS THE THING PHASE 1 PROVED DID NOT EXIST. The canonical tree has
// eight node types and all eight are expressions, so `var`, `:=`, a block, a
// loop, an array and a UDT had nowhere to be WRITTEN DOWN — not in the tree, not
// in the V2 graph, not in a saved definition. That was the ceiling, and it was in
// the artifact rather than the walker. This file is the artifact that removes it.
//
// ⭐ STATEMENTS AND EXPRESSIONS ARE DIFFERENT KINDS, deliberately. A Pine `if`
// that mutates a variable is not a ternary and must not be representable as one:
// a ternary evaluates both arms, and once an arm can have an effect that is a
// wrong program, not a slow one. Keeping the kinds apart in the IR is what makes
// that error impossible to write rather than merely discouraged.
//
// ⚠️ DECLARED WIDER THAN 2D IMPLEMENTS, per PHASE2_RUNTIME_ARCHITECTURE.md §9 —
// "implementation may proceed capability-by-capability; the architecture may
// not." Loops, functions, tuples, arrays and object operations have their node
// shapes here NOW so the IR cannot need re-cutting when they land. Anything not
// yet lowerable is refused BY NAME at lowering, never silently dropped.
import { drawingHandle, isDrawingHandle } from './handles.js'

/** Statement kinds. ⛔ DERIVED-FROM, never retyped: `lowerIr.js` switches on
 *  these and `irShape.test.js` asserts the two agree. */
export const STMT = Object.freeze({
  DECLARE: 'declare',     // `x = e` / `var x = e` — binds a slot
  ASSIGN: 'assign',       // `x := e`
  IF: 'if',               // header + then[] + else[]
  EMIT: 'emit',           // `plot(e)` and friends — one named output
  // ⭐⭐ ONE SLOT OF A PER-ITERATION BUFFER. See `iterOutputs` on the program.
  EMIT_ITER: 'emitIter',  // { iter, index, value }
  EXPR: 'expr',           // an expression evaluated for effect
  // ── declared, not yet lowerable ──
  FOR: 'for',
  WHILE: 'while',
  BREAK: 'break',
  DESTRUCTURE: 'destructure',   // `[a, b] = f()`
  CONTINUE: 'continue',
  FUNC: 'func',
  RETURN: 'return',
})

/** Expression kinds. */
export const EXPR = Object.freeze({
  NUM: 'num',
  // ⭐⭐ A STRING IS ITS OWN KIND, NOT A `NUM` WITH A DIFFERENT PAYLOAD. Both
  // lower to `CONST` over the same pool, so the distinction buys nothing in the
  // BACK end — it is the FRONT end that needs it: the route decision asks "can
  // the columnar lane hold this?", and the columnar lane refuses text at
  // `pine:text-value`. A string that arrived wearing `NUM` would be routed into
  // that lane and refused, which is the wall this kind exists to walk around.
  STR: 'str',
  CONCAT: 'concat',       // `+` between two STRINGS — never the numeric `+`
  COLOUR: 'colour',   // a `color.*` producer — a packed 0xTTBBGGRR integer
  // ⭐⭐ AN OPAQUE DRAWING HANDLE — the RESULT of a `<family>.new(…)` the OBJECT
  // PASS has taken responsibility for. See `runtime/handles.js` for why it is
  // neither a number nor `na`, and `pineRuntimeFrontend.js` for the ONE position
  // that may build one. ⛔ It carries no arguments and no coordinates: this lane
  // holds the handle, the object program holds the drawing.
  DRAWING: 'drawing',
  TEXT: 'text',           // a `str.*` builtin — see runtime/text.js
  ARRAY: 'array',         // an `array.*` builtin — see runtime/collections.js
  TUPLE: 'tuple',         // several values at once — only a function RESULT
  REQUEST: 'request',     // `request.security` — another symbol's series
  SERIES: 'series',       // a price series, by name
  CLOCK: 'clock',         // an ET clock field of the bar — see program.js
  SESSION: 'session',     // `time(tf, "0930-1600", tz)` — in-session or `na`
  COLUMN: 'column',       // a pure subtree the columnar lane evaluates — THE SEAM
  READ: 'read',           // a variable slot
  HIST: 'hist',           // `e[n]` over a COLUMN (see the lowering note)
  BINARY: 'binary',
  UNARY: 'unary',
  TERNARY: 'ternary',
  CALL: 'call',           // a user-defined function invocation at a CALL SITE
  BUILTIN: 'builtin',     // a POINTWISE table builtin applied to current-bar values
  WINDOW: 'window',       // a FINITE-WINDOW table builtin over a runtime series
  CARRIED: 'carried',     // a CARRIED-STATE table builtin over a runtime series
  // ── declared, not yet lowerable ──
  ARRAY_OP: 'arrayOp',
  OBJECT_OP: 'objectOp',
})

/** Where a resolved variable lives.
 *
 *  ⭐⭐ `PERSIST` IS PER-CALL-SITE, NOT PER-FUNCTION, and that is a semantic fact
 *  rather than an implementation choice: Pine's function-local `var` persists
 *  separately for each place the function is CALLED FROM. A shared slot per
 *  function would make two call sites of one helper silently share a counter —
 *  a wrong number with nothing red anywhere. 2E's frame model allocates these;
 *  the kind exists here so the allocator has somewhere to put them. */
export const SLOT = Object.freeze({
  LOCAL: 'local',         // reset every bar
  PERSIST: 'persist',     // survives bars — `var`
})

export class IrError extends Error {
  constructor(message) { super(message); this.name = 'IrError' }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * An IR program.
 *
 * `slots` is the resolved variable table — every DECLARE/ASSIGN/READ names an
 * INDEX into it, never a string. Name resolution is the front end's job and is
 * finished before this artifact exists, so nothing downstream can resolve a name
 * differently (§19: two same-named locals in different scopes get different
 * slots and can never alias).
 */
export function makeIrProgram({
  version = null, statements, slots, columns = [], outputs = [],
  functions = [], callSites = [], history = [], windows = [], carried = [],
  requests = [], objectTreeOutputs = [], iterOutputs = [],
}) {
  if (!Array.isArray(statements)) throw new IrError('statements must be an array')
  if (!Array.isArray(slots)) throw new IrError('slots must be an array')
  const normalised = normaliseSlots(slots)
  // ⭐⭐ P7.2 — A FUNCTION'S HISTORY SLOTS ARE TRANSLATED TO FRAME ADDRESSES HERE,
  // by the same normaliser that decided where every slot lives. The front end
  // names them by IR slot index (which is what it has); the RET hand-off needs
  // the frame-relative index and the lifetime. Deriving both from `normalised`
  // keeps ONE authority over where a variable is (`lesson_a_second_authority_over_one_value`).
  const fns = (functions || []).map((fn) => {
    const varSlots = fn.historySlots || []
    return {
      ...fn,
      historySlots: varSlots.map((v) => {
        const s = normalised[v]
        if (!s) throw new IrError(`function \`${fn.name}\` keeps history for slot ${v}, which is outside ${normalised.length}`)
        return s.index
      }),
      historyPersist: varSlots.map((v) => (normalised[v].kind === SLOT.PERSIST ? 1 : 0)),
    }
  })
  const p = {
    version, statements, slots: normalised, columns, outputs, functions: fns, callSites,
    windows: windows || [],
    carried: carried || [],
    requests: requests || [],
    // ⭐ tree index → the OUTPUT carrying that object-program tree's value,
    // one per bar. Empty for every ordinary script; the lane seam reads it.
    objectTreeOutputs: objectTreeOutputs || [],
    // ⭐ Per-ITERATION buffers — `[{ kind: 'num'|'text' }]`. Empty for every
    // ordinary script; only an object drawing inside a loop declares one.
    iterOutputs: iterOutputs || [],
    // ⭐⭐ WHERE A HISTORY-BEARING VARIABLE LIVES IS DERIVED HERE, FROM THE SLOT
    // TABLE THAT JUST DECIDED IT. The front end says WHICH variable bears history
    // and HOW DEEP; the frame index and the lifetime are `normaliseSlots`'s
    // answer, and reading them off it is what stops the commit phase and the slot
    // allocator from ever disagreeing about which array holds `x`.
    history: (history || []).map((h) => {
      const s = normalised[h.varSlot]
      if (!s) throw new IrError(`history for slot ${h.varSlot}, which is outside ${normalised.length}`)
      return { ...h, slot: s.index, persist: s.kind === SLOT.PERSIST }
    }),
  }
  validateIr(p)
  return p
}

/** ⭐⭐ A SLOT'S ADDRESS IS FRAME-RELATIVE, AND IT IS ASSIGNED HERE — ONCE.
 *
 *  The IR names variables by an index into one flat table; the RUNTIME addresses
 *  them relative to a frame base, because that is what lets one `LOAD_LOCAL`
 *  serve the main program and every invocation. Something has to map between
 *  those two numberings, and if the lowering did it AND the front end did it, the
 *  two would eventually disagree about which `x` a call is mutating — the exact
 *  class of defect §5 exists to prevent.
 *
 *  ⛔ SO THE NORMALISER IS THE ONE AUTHORITY. `owner` is the function a slot
 *  belongs to (`null` = the main program); `index` is its position within that
 *  owner's frame, numbered per kind in declaration order. A front end that
 *  already knows an index may supply it — a function's parameters must, since
 *  they occupy the first frame slots by calling convention — and anything left
 *  out is derived here rather than in a second place. */
function normaliseSlots(slots) {
  const next = new Map()
  return slots.map((s) => {
    const owner = s.owner === undefined ? null : s.owner
    const key = `${owner}:${s.kind}`
    const n = next.get(key) || 0
    const index = s.index === undefined ? n : s.index
    next.set(key, Math.max(n, index + 1))
    return { ...s, owner, index }
  })
}

/** ⛔ VALIDATED AT THE BOUNDARY (§44). A malformed IR is a front-end bug and has
 *  to say so here, rather than reaching the lowering and being reported as a
 *  compiler failure, or reaching the loop and being reported as a runtime one. */
export function validateIr(p) {
  const nSlots = p.slots.length
  const nCols = p.columns.length
  const nOut = p.outputs.length
  const nIter = (p.iterOutputs || []).length

  for (const s of p.slots) {
    if (!isObj(s) || typeof s.name !== 'string' || !Object.values(SLOT).includes(s.kind)) {
      throw new IrError(`a slot is {name, kind}; kind is one of ${Object.values(SLOT).join(', ')} — got ${JSON.stringify(s)}`)
    }
  }

  const walkExpr = (e, where) => {
    if (!isObj(e) || typeof e.kind !== 'string') throw new IrError(`${where}: not an expression node — ${JSON.stringify(e)}`)
    switch (e.kind) {
      case EXPR.NUM:
        // ⛔ A NON-FINITE CONST IS STILL REFUSED unless it is a DECLARED `na`.
        // See `naValue`: the marker distinguishes an author's absent value from
        // a number that lost itself on the way here.
        if (typeof e.value !== 'number' || (!Number.isFinite(e.value) && e.na !== true)) {
          throw new IrError(`${where}: a num carries a finite number, got ${JSON.stringify(e.value)}`)
        }
        return
      case EXPR.STR:
        // ⛔ CHECKED HERE FOR THE SAME REASON `num` IS. A non-string wearing
        // this kind would reach the const pool, pass `program.js`'s number-or-
        // string check as whatever it is, and only be noticed as a wrong value
        // on some bar — which is the silent-coercion class the value model was
        // changed to end.
        if (typeof e.value !== 'string') {
          throw new IrError(`${where}: a str carries a string, got ${JSON.stringify(e.value)}`)
        }
        return
      // ⛔ THE VALUE IS CHECKED BY THE SAME ARGUMENT `NUM` AND `STR` ARE. A
      // handle reaches the const pool, and `program.js` admits one THERE by
      // asking `isDrawingHandle` — so a plain object wearing this kind would
      // be rejected far from the front end that built it. Asking here names
      // the producer instead.
      case EXPR.DRAWING:
        if (!isDrawingHandle(e.value)) {
          throw new IrError(`${where}: a drawing carries a drawing handle, got ${typeof e.value}`)
        }
        return
      case EXPR.CONCAT:
        walkExpr(e.left, `${where}.left`)
        walkExpr(e.right, `${where}.right`)
        return
      case EXPR.REQUEST:
        if (!Number.isInteger(e.site) || e.site < 0) {
          throw new IrError(`${where}: a request carries a site index`)
        }
        walkExpr(e.symbol, `${where}.symbol`)
        return
      case EXPR.TUPLE:
        if (!Array.isArray(e.elements) || e.elements.length < 2) {
          throw new IrError(`${where}: a tuple carries at least two elements`)
        }
        e.elements.forEach((x, i) => walkExpr(x, `${where}.tuple[${i}]`))
        return
      case EXPR.ARRAY:
        if (typeof e.fn !== 'string') throw new IrError(`${where}: an array call carries a name`)
        if (!Array.isArray(e.args)) throw new IrError(`${where}: an array call carries an args array`)
        e.args.forEach((x, i) => walkExpr(x, `${where}.${e.fn}[${i}]`))
        return
      case EXPR.COLOUR:
      case EXPR.TEXT:
        if (typeof e.fn !== 'string') throw new IrError(`${where}: a text call carries a name`)
        if (!Array.isArray(e.args)) throw new IrError(`${where}: a text call carries an args array`)
        e.args.forEach((a, i) => walkExpr(a, `${where}.${e.fn}[${i}]`))
        return
      case EXPR.SERIES:
        if (typeof e.name !== 'string') throw new IrError(`${where}: a series carries a name`)
        return
      // ⭐ SHAPE ONLY, exactly as `SERIES` above. Which field names exist is a
      // WIRE fact and `program.js::CLOCK_FIELDS` owns it; `lowerIr` fails by
      // name on an unknown one. Checking membership here would make this file
      // import the wire table it is deliberately independent of, and would put
      // a second authority over the same list.
      case EXPR.CLOCK:
        if (typeof e.field !== 'string') throw new IrError(`${where}: a clock read carries a field`)
        return
      case EXPR.SESSION:
        if (!Number.isInteger(e.start) || !Number.isInteger(e.end)) {
          throw new IrError(`${where}: a session carries whole-minute bounds`)
        }
        return
      case EXPR.COLUMN:
        if (!Number.isInteger(e.index) || e.index < 0 || e.index >= nCols) {
          throw new IrError(`${where}: column ${e.index} outside ${nCols}`)
        }
        return
      case EXPR.READ:
        if (!Number.isInteger(e.slot) || e.slot < 0 || e.slot >= nSlots) {
          throw new IrError(`${where}: slot ${e.slot} outside ${nSlots}`)
        }
        return
      case EXPR.HIST:
        if (!Number.isInteger(e.back) || e.back < 0) {
          throw new IrError(`${where}: a history offset counts backwards in whole bars, got ${JSON.stringify(e.back)}`)
        }
        // ⭐⭐ TWO KINDS OF HISTORY, ONE NODE. `[n]` over a COLUMN is the pure
        // lane's — the whole series already exists and the runtime indexes it.
        // `[n]` over a READ is 2F-2's: a value the runtime produced, whose past
        // bars exist only because the runtime committed them. They share this
        // node because they are the same Pine construct, and they are told apart
        // at lowering by what `of` is.
        if (e.of && e.of.kind === EXPR.READ) {
          if (!Number.isInteger(e.slot) || e.slot < 0 || e.slot >= (p.history || []).length) {
            throw new IrError(
              `${where}: history over a variable must name the HISTORY slot the front end `
              + `allocated for it; got ${JSON.stringify(e.slot)} against ${(p.history || []).length} `
              + 'history slots. Without it the lowering would have to re-derive which values '
              + 'are history-bearing, and a second answer to that question is a ring nobody fills.')
          }
          if (e.back > p.history[e.slot].depth) {
            throw new IrError(
              `${where}: reads \`${p.history[e.slot].name}\`[${e.back}] but its ring was planned `
              + `for depth ${p.history[e.slot].depth}`)
          }
        }
        walkExpr(e.of, `${where}.of`)
        return
      case EXPR.BINARY:
        if (typeof e.op !== 'string') throw new IrError(`${where}: a binary carries an op`)
        walkExpr(e.left, `${where}.left`)
        walkExpr(e.right, `${where}.right`)
        return
      case EXPR.UNARY:
        if (typeof e.op !== 'string') throw new IrError(`${where}: a unary carries an op`)
        walkExpr(e.of, `${where}.of`)
        return
      case EXPR.TERNARY:
        walkExpr(e.test, `${where}.test`)
        walkExpr(e.then, `${where}.then`)
        walkExpr(e.else, `${where}.else`)
        return
      case EXPR.CALL: {
        // ⛔ A CALL NAMES A SITE, NOT JUST A FUNCTION. The site is what owns the
        // invocation's persistent locals; validating it here is what stops a
        // front end from emitting a call whose state has nowhere to live.
        if (!Number.isInteger(e.fn) || e.fn < 0 || e.fn >= p.functions.length) {
          throw new IrError(`${where}: function ${e.fn} outside ${p.functions.length}`)
        }
        if (!Number.isInteger(e.site) || e.site < 0 || e.site >= p.callSites.length) {
          throw new IrError(`${where}: call site ${e.site} outside ${p.callSites.length}`)
        }
        const fn = p.functions[e.fn]
        if (!Array.isArray(e.args) || e.args.length !== fn.params) {
          throw new IrError(`${where}: \`${fn.name}\` takes ${fn.params} arguments, got ${e.args ? e.args.length : 0}`)
        }
        e.args.forEach((a, k) => walkExpr(a, `${where}.args[${k}]`))
        return
      }
      case EXPR.CARRIED: {
        if (!Number.isInteger(e.site) || e.site < 0 || e.site >= (p.carried || []).length) {
          throw new IrError(`${where}: carried site ${JSON.stringify(e.site)} outside ${(p.carried || []).length}`)
        }
        walkExpr(e.source, `${where}.source`)
        return
      }
      case EXPR.WINDOW: {
        if (!Number.isInteger(e.site) || e.site < 0 || e.site >= (p.windows || []).length) {
          throw new IrError(`${where}: window site ${JSON.stringify(e.site)} outside ${(p.windows || []).length}`)
        }
        walkExpr(e.source, `${where}.source`)
        return
      }
      case EXPR.BUILTIN: {
        // ⛔ NAMED BY ITS TABLE ENTRY, never by its Pine spelling. `math.max`,
        // `max` and a v2 bare `max` are ONE semantic function; carrying the
        // surface name here would make the runtime re-decide that mapping and
        // become a second authority over it.
        if (typeof e.fn !== 'string') throw new IrError(`${where}: a builtin carries its TABLE name`)
        if (!Array.isArray(e.args)) throw new IrError(`${where}: a builtin carries args`)
        e.args.forEach((a, k) => walkExpr(a, `${where}.args[${k}]`))
        return
      }
      case EXPR.TUPLE: case EXPR.ARRAY_OP: case EXPR.OBJECT_OP:
        // ⛔ DECLARED, NOT LOWERABLE. Accepted by the validator so a front end
        // can BUILD one and get a named refusal from the lowering, rather than
        // the validator pretending the shape does not exist.
        return
      default:
        throw new IrError(`${where}: unknown expression kind ${JSON.stringify(e.kind)}`)
    }
  }

  const walkStmts = (list, where) => {
    if (!Array.isArray(list)) throw new IrError(`${where}: a statement list is an array`)
    list.forEach((s, i) => {
      const at = `${where}[${i}]`
      if (!isObj(s) || typeof s.kind !== 'string') throw new IrError(`${at}: not a statement`)
      switch (s.kind) {
        case STMT.DECLARE:
        case STMT.ASSIGN:
          if (!Number.isInteger(s.slot) || s.slot < 0 || s.slot >= nSlots) {
            throw new IrError(`${at}: slot ${s.slot} outside ${nSlots}`)
          }
          walkExpr(s.value, `${at}.value`)
          return
        case STMT.IF:
          walkExpr(s.test, `${at}.test`)
          walkStmts(s.then, `${at}.then`)
          walkStmts(s.else || [], `${at}.else`)
          return
        case STMT.EMIT:
          if (!Number.isInteger(s.output) || s.output < 0 || s.output >= nOut) {
            throw new IrError(`${at}: output ${s.output} outside ${nOut}`)
          }
          walkExpr(s.value, `${at}.value`)
          return
        case STMT.EMIT_ITER:
          if (!Number.isInteger(s.iter) || s.iter < 0 || s.iter >= nIter) {
            throw new IrError(`${at}: iteration buffer ${s.iter} outside ${nIter}`)
          }
          walkExpr(s.index, `${at}.index`)
          walkExpr(s.value, `${at}.value`)
          return
        case STMT.EXPR:
          walkExpr(s.value, `${at}.value`)
          return
        case STMT.FOR:
          for (const k of ['slot', 'toSlot', 'stepSlot']) {
            if (!Number.isInteger(s[k]) || s[k] < 0 || s[k] >= nSlots) {
              throw new IrError(`${at}: for.${k} ${s[k]} outside ${nSlots} slots`)
            }
          }
          walkExpr(s.from, `${at}.from`)
          walkExpr(s.to, `${at}.to`)
          walkExpr(s.step, `${at}.step`)
          if (!Array.isArray(s.body)) throw new IrError(`${at}: for.body must be an array`)
          walkStmts(s.body, `${at}.body`)
          return
        case STMT.DESTRUCTURE:
          if (!Array.isArray(s.slots) || s.slots.length < 2) {
            throw new IrError(`${at}: a destructuring binds at least two names`)
          }
          for (const sl of s.slots) {
            if (!Number.isInteger(sl) || sl < 0 || sl >= nSlots) {
              throw new IrError(`${at}: slot ${sl} outside ${nSlots}`)
            }
          }
          walkExpr(s.value, `${at}.value`)
          return
        case STMT.BREAK: case STMT.CONTINUE:
          return
        case STMT.WHILE:
        case STMT.FUNC: case STMT.RETURN:
          return
        default:
          throw new IrError(`${at}: unknown statement kind ${JSON.stringify(s.kind)}`)
      }
    })
  }

  walkStmts(p.statements, 'statements')

  // ⭐⭐ A FUNCTION IS A FIRST-CLASS SEMANTIC ENTITY (§4), not a macro. It carries
  // its own frame size, its own persistent-local count, its body and its result —
  // so nothing downstream has to re-derive them from source, and two call sites
  // share the CODE while owning their state separately.
  p.functions.forEach((fn, i) => {
    const at = `functions[${i}] \`${fn.name}\``
    if (typeof fn.name !== 'string') throw new IrError(`${at}: needs a name`)
    if (!Number.isInteger(fn.params) || fn.params < 0) throw new IrError(`${at}: params must be a count`)
    if (!Number.isInteger(fn.frameSize) || fn.frameSize < fn.params) {
      throw new IrError(`${at}: frameSize ${fn.frameSize} cannot be smaller than its ${fn.params} parameters`)
    }
    if (!Number.isInteger(fn.persistCount) || fn.persistCount < 0) {
      throw new IrError(`${at}: persistCount must be a count`)
    }
    walkStmts(fn.body || [], `${at}.body`)
    walkExpr(fn.result, `${at}.result`)
  })

  // ⛔ EVERY CALL SITE'S PERSISTENT BLOCK IS ITS OWN, AND THE VALIDATOR SAYS SO.
  // Two sites sharing a base is the exact defect §6 forbids — one helper called
  // twice would silently share a counter — so it is checked here rather than
  // trusted to the allocator.
  const seenBase = new Map()
  p.callSites.forEach((cs, i) => {
    const at = `callSites[${i}]`
    if (!Number.isInteger(cs.fn) || cs.fn < 0 || cs.fn >= p.functions.length) {
      throw new IrError(`${at}: function ${cs.fn} outside ${p.functions.length}`)
    }
    if (!Number.isInteger(cs.persistBase) || cs.persistBase < 0) {
      throw new IrError(`${at}: persistBase must be an index`)
    }
    const fn = p.functions[cs.fn]
    if (fn.persistCount > 0) {
      const prior = seenBase.get(cs.persistBase)
      if (prior !== undefined) {
        throw new IrError(
          `${at}: persistBase ${cs.persistBase} is already used by callSites[${prior}] — `
          + 'two call sites would share one function-local `var`')
      }
      seenBase.set(cs.persistBase, i)
    }
  })

  // ⭐⭐ THE HISTORY PLAN IS VALIDATED AGAINST THE SLOT TABLE IT REFERS TO.
  // Each entry says: this variable slot bears history, its ring is this deep, and
  // it lives in this lifetime. A plan naming a slot that does not exist, or
  // claiming a lifetime the slot table disagrees with, would have the commit
  // phase reading the wrong array every bar — a wrong number with no exception.
  const seenHistFor = new Map()
  ;(p.history || []).forEach((h, i) => {
    const at = `history[${i}]`
    if (!Number.isInteger(h.varSlot) || h.varSlot < 0 || h.varSlot >= nSlots) {
      throw new IrError(`${at}: varSlot ${h.varSlot} outside ${nSlots}`)
    }
    if (!Number.isInteger(h.depth) || h.depth < 1) {
      throw new IrError(`${at}: depth must be at least 1 bar, got ${JSON.stringify(h.depth)}`)
    }
    const s = p.slots[h.varSlot]
    // ⚠️ NOTE WHAT IS *NOT* CHECKED HERE. An earlier draft asserted that
    // `h.persist` matched the slot's kind and `h.slot` matched its index — which
    // reads like diligence and is a tautology, because `makeIrProgram` derives
    // both FROM that slot a few lines above. A check that cannot fail is worse
    // than no check: it costs a reader's attention and buys a false sense that
    // the two are independently corroborated (`lesson_gate_that_cannot_fail`).
    // What follows are the properties the front end really can get wrong.
    // ⛔ ONE RING PER VARIABLE **PER CALL SITE**. Two plan entries for the same
    // (slot, site) would each commit and `x[1]` would answer from whichever the
    // lowering happened to name.
    // ⚰️ Keyed by slot ALONE this refused the correct program: `f(close)` and
    // `f(open)` are two sites over ONE source variable, which is exactly the
    // independence 2E pinned — so the key has to carry the site or the guard
    // forbids the feature it is guarding.
    const key = `${h.varSlot}@${h.site === undefined || h.site === null ? 'main' : h.site}`
    const prior = seenHistFor.get(key)
    if (prior !== undefined) {
      throw new IrError(`${at}: slot ${h.varSlot} (\`${s.name}\`) already has history[${prior}] at the same call site`)
    }
    seenHistFor.set(key, i)
    // ⭐⭐⭐ P7.2 — A FUNCTION-OWNED ENTRY MUST NAME THE CALL SITE IT BELONGS TO,
    // and a main-frame entry must NOT. This is the guard that makes the commit
    // phase's choice unambiguous: a main entry reads its live slot at end of bar,
    // a site entry commits the value that site last HELD (TradingView's ruling —
    // a skipped call re-commits, it does not blank or advance). An entry without
    // a site would have the commit phase read `locals[index]` in the MAIN frame:
    // a different variable entirely, committed under this one's name.
    if (s.owner === null) {
      if (h.site !== undefined && h.site !== null) {
        throw new IrError(`${at}: \`${s.name}\` is a main-program slot but names call site ${h.site}`)
      }
    } else {
      if (!Number.isInteger(h.site) || h.site < 0 || h.site >= p.callSites.length) {
        throw new IrError(
          `${at}: \`${s.name}\` belongs to function ${s.owner}, so its ring is per CALL SITE — `
          + `got site ${JSON.stringify(h.site)} against ${p.callSites.length} call sites`)
      }
      if (p.callSites[h.site].fn !== s.owner) {
        throw new IrError(
          `${at}: \`${s.name}\` belongs to function ${s.owner} but site ${h.site} calls `
          + `function ${p.callSites[h.site].fn} — its history would live in another function's block`)
      }
    }
  })

  // ⛔ EVERY CALL SITE'S HISTORY BLOCK IS ITS OWN, checked the way `persistBase`
  // already is. Two sites sharing a base is the defect §14 forbids: one helper
  // called twice would answer `x[1]` from the other call's series.
  {
    const seenHist = new Map()
    p.callSites.forEach((cs, i) => {
      const fn = p.functions[cs.fn]
      if (!fn || !(fn.historyCount > 0)) return
      if (!Number.isInteger(cs.historyBase) || cs.historyBase < 0) {
        throw new IrError(`callSites[${i}]: historyBase must be an index`)
      }
      const prior = seenHist.get(cs.historyBase)
      if (prior !== undefined) {
        throw new IrError(
          `callSites[${i}]: historyBase ${cs.historyBase} is already used by callSites[${prior}] — `
          + 'two call sites would share one function-local history ring')
      }
      seenHist.set(cs.historyBase, i)
    })
  }
  return true
}

// ── small constructors, so a front end never hand-writes a literal ───────────
export const num = (value) => ({ kind: EXPR.NUM, value })
/** Pine's `na` — the ABSENT value, which is NaN at run time.
 *
 *  ⛔⛔ IT CARRIES A MARKER BECAUSE `num(NaN)` IS REFUSED, AND SHOULD BE. A
 *  non-finite const arriving by accident is how a coordinate silently becomes
 *  nothing, which is why the validator rejects one. But `na` is a LITERAL a
 *  member writes — `x > 0 ? y : na` is the standard way to leave a plot blank —
 *  so the intent has to be expressible. The marker is what separates
 *  'the author wrote absent' from 'something lost its value on the way here'. */
export const naValue = () => ({ kind: EXPR.NUM, value: NaN, na: true })
export const str = (value) => ({ kind: EXPR.STR, value })
/** ⭐⭐ THE RESULT OF A CREATE THE OBJECT PASS OWNS — an opaque handle.
 *
 *  ⛔ THE VALUE IS BUILT HERE, ONCE PER NODE, AND CARRIED. `lowerIr` interns
 *  consts with `Object.is`, so two calls made from one node must be ONE pool
 *  entry and two different creates must be two — which is a property of the
 *  OBJECT IDENTITY, not of the fields. Rebuilding the sentinel at lowering time
 *  would make every occurrence a fresh entry and grow the pool without bound.
 *
 *  ⛔ AND THERE IS NO `naValue()` EQUIVALENT FOR A HANDLE, deliberately. Pine's
 *  null drawing handle is a real value, but `collections.js` already wrote down
 *  why this lane must not have one: answering `na` makes the standard emptiness
 *  test read TRUE for a drawing the object program has already made. Nothing
 *  here mints an absent handle; a create either produces one or is refused. */
export const drawing = (family, site) => (
  { kind: EXPR.DRAWING, value: drawingHandle(family, site) })
/** ⛔ CONCATENATION IS NOT `binary('+')`, and the difference is a correctness
 *  one rather than a tidiness one. `BINARY['+']` is `(a, b) => a + b`, which on
 *  a string and a number silently produces a string — Pine calls that a TYPE
 *  ERROR. Routing text through its own node lets the VM refuse a mixed pair by
 *  name instead of inventing an answer TradingView would never give. */
export const concat = (left, right) => ({ kind: EXPR.CONCAT, left, right })
/** A `str.*` call. `fn` is the NAME; `runtime/text.js` owns the implementation
 *  and `program.js` validates the name when the program is built. */
export const textCall = (fn, args) => ({ kind: EXPR.TEXT, fn, args })
/** ⭐ A colour producer. Same shape as `textCall`: the NAME lives in the
 *  artifact, so adding a `color.*` costs no opcode and no VM branch. */
export const colourCall = (fn, args) => ({ kind: EXPR.COLOUR, fn, args })
/** An `array.*` call. `typeArg` is the `<T>` the member wrote, which only
 *  `array.new` reads — it decides the per-element default for a sized array. */
export const arrayCall = (fn, args, typeArg = null) => (
  { kind: EXPR.ARRAY, fn, args, typeArg })
export const series = (name) => ({ kind: EXPR.SERIES, name })
export const clock = (field) => ({ kind: EXPR.CLOCK, field })
export const session = (start, end) => ({ kind: EXPR.SESSION, start, end })
export const column = (index) => ({ kind: EXPR.COLUMN, index })
export const read = (slot) => ({ kind: EXPR.READ, slot })
export const hist = (of, back) => ({ kind: EXPR.HIST, of, back })
/** `x[n]` over a value the RUNTIME produces. `slot` is the history-slot index —
 *  a different address space from the variable slot, because only some variables
 *  bear history and allocating a ring for every one of them is the `HISTORY_VALUES`
 *  bill nobody wants to pay (§16). */
export const histSlot = (varSlot, historySlot, back) => (
  { kind: EXPR.HIST, of: read(varSlot), slot: historySlot, back })
export const binary = (op, left, right) => ({ kind: EXPR.BINARY, op, left, right })
export const unary = (op, of) => ({ kind: EXPR.UNARY, op, of })
export const ternary = (test, a, b) => ({ kind: EXPR.TERNARY, test, then: a, else: b })
export const call = (fn, site, args) => ({ kind: EXPR.CALL, fn, site, args })
export const builtin = (fn, args) => ({ kind: EXPR.BUILTIN, fn, args })
/** ⭐ A finite-window builtin over a runtime series. `site` indexes the program's
 *  window table; `source` is the expression producing the CURRENT bar's value, and
 *  the committed bars come from that series' own history ring. */
export const windowCall = (site, source) => ({ kind: EXPR.WINDOW, site, source })

/** ⭐ A carried-state builtin over a runtime series. `site` is FRAME-RELATIVE:
 *  the VM adds the invocation's `carriedBase`, so one compiled body serves every
 *  call site while each site keeps its own recurrence — the same addressing
 *  `persistBase` (2E) and `historyBase` (P7.2) already use. */
export const carriedCall = (site, source) => ({ kind: EXPR.CARRIED, site, source })

export const declare = (slot, value) => ({ kind: STMT.DECLARE, slot, value })
export const assign = (slot, value) => ({ kind: STMT.ASSIGN, slot, value })
export const ifStmt = (test, then, els) => ({ kind: STMT.IF, test, then, else: els || [] })
export const emit = (output, value) => ({ kind: STMT.EMIT, output, value })
/** Write one slot of a per-iteration buffer.
 *
 *  ⭐⭐ AN ITERATION BUFFER IS NOT A SERIES, AND THE DIFFERENCE IS THE WHOLE
 *  POINT. An output series is indexed BY BAR and a `Float64Array` by contract.
 *  A drawing inside `for r = 0 to n` needs a value per ITERATION, which no
 *  series can hold — and which the object program reads back by counter.
 *
 *  ⛔ IT IS OVERWRITTEN EVERY BAR, so only the bar that wrote it last can be
 *  read. That is why the lane refuses a loop that is not last-bar-guarded
 *  rather than handing back a stale buffer. */
export const emitIter = (iter, index, value) => (
  { kind: STMT.EMIT_ITER, iter, index, value })
/** An expression evaluated for its EFFECT. Admitted only for a call that has
 *  one — see `lowerIr.js`'s STMT.EXPR arm. */
export const exprStmt = (value) => ({ kind: STMT.EXPR, value })
/** `for slot = from to to [by step]`.
 *
 *  ⛔ `from`, `to` AND `step` ARE EXPRESSIONS EVALUATED ONCE, at loop entry.
 *  Pine does not re-read them per iteration, and a runtime that did would
 *  make a body that grows the array it walks into a loop that never ends.
 *  `toSlot` and `stepSlot` are where those once-evaluated values live. */
export const forStmt = ({ slot, toSlot, stepSlot, from, to, step, body }) => (
  { kind: STMT.FOR, slot, toSlot, stepSlot, from, to, step, body })
/** Several values at once. ⛔ ONLY VALID AS A FUNCTION'S RESULT or on the
 *  right of a destructuring — anywhere else it would leave values on the
 *  stack that nothing pops. */
export const tuple = (elements) => ({ kind: EXPR.TUPLE, elements })
/** `[a, b] = expr` — the slots are filled LEFT TO RIGHT from a value that
 *  left `slots.length` results on the stack. */
export const destructure = (slots, value) => ({ kind: STMT.DESTRUCTURE, slots, value })
/** `request.security(symbol, tf, value)`. `site` indexes the IR's `requests`
 *  table, which holds the timeframe and the VALUE expression; `symbol` is an
 *  ordinary expression because it is usually only known while the bar runs. */
export const requestCall = (site, symbol, results) => (
  { kind: EXPR.REQUEST, site, symbol, results })
export const breakStmt = () => ({ kind: STMT.BREAK })
export const continueStmt = () => ({ kind: STMT.CONTINUE })
