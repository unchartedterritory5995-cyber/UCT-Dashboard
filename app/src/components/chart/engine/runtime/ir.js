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

/** Statement kinds. ⛔ DERIVED-FROM, never retyped: `lowerIr.js` switches on
 *  these and `irShape.test.js` asserts the two agree. */
export const STMT = Object.freeze({
  DECLARE: 'declare',     // `x = e` / `var x = e` — binds a slot
  ASSIGN: 'assign',       // `x := e`
  IF: 'if',               // header + then[] + else[]
  EMIT: 'emit',           // `plot(e)` and friends — one named output
  EXPR: 'expr',           // an expression evaluated for effect
  // ── declared, not yet lowerable ──
  FOR: 'for',
  WHILE: 'while',
  BREAK: 'break',
  CONTINUE: 'continue',
  FUNC: 'func',
  RETURN: 'return',
})

/** Expression kinds. */
export const EXPR = Object.freeze({
  NUM: 'num',
  SERIES: 'series',       // a price series, by name
  COLUMN: 'column',       // a pure subtree the columnar lane evaluates — THE SEAM
  READ: 'read',           // a variable slot
  HIST: 'hist',           // `e[n]` over a COLUMN (see the lowering note)
  BINARY: 'binary',
  UNARY: 'unary',
  TERNARY: 'ternary',
  CALL: 'call',           // a user-defined function invocation at a CALL SITE
  BUILTIN: 'builtin',     // a POINTWISE table builtin applied to current-bar values
  // ── declared, not yet lowerable ──
  TUPLE: 'tuple',
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
  functions = [], callSites = [], history = [],
}) {
  if (!Array.isArray(statements)) throw new IrError('statements must be an array')
  if (!Array.isArray(slots)) throw new IrError('slots must be an array')
  const normalised = normaliseSlots(slots)
  const p = {
    version, statements, slots: normalised, columns, outputs, functions, callSites,
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

  for (const s of p.slots) {
    if (!isObj(s) || typeof s.name !== 'string' || !Object.values(SLOT).includes(s.kind)) {
      throw new IrError(`a slot is {name, kind}; kind is one of ${Object.values(SLOT).join(', ')} — got ${JSON.stringify(s)}`)
    }
  }

  const walkExpr = (e, where) => {
    if (!isObj(e) || typeof e.kind !== 'string') throw new IrError(`${where}: not an expression node — ${JSON.stringify(e)}`)
    switch (e.kind) {
      case EXPR.NUM:
        if (typeof e.value !== 'number' || !Number.isFinite(e.value)) {
          throw new IrError(`${where}: a num carries a finite number, got ${JSON.stringify(e.value)}`)
        }
        return
      case EXPR.SERIES:
        if (typeof e.name !== 'string') throw new IrError(`${where}: a series carries a name`)
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
        case STMT.EXPR:
          walkExpr(s.value, `${at}.value`)
          return
        case STMT.FOR: case STMT.WHILE: case STMT.BREAK: case STMT.CONTINUE:
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
    // ⛔ ONE RING PER VARIABLE. Two plan entries for one slot would each commit,
    // and `x[1]` would answer from whichever the lowering happened to name.
    const prior = seenHistFor.get(h.varSlot)
    if (prior !== undefined) {
      throw new IrError(`${at}: slot ${h.varSlot} (\`${s.name}\`) already has history[${prior}]`)
    }
    seenHistFor.set(h.varSlot, i)
    // ⚠️ MAIN-FRAME ONLY, TODAY, AND SAID OUT LOUD. Function-local history is
    // refused by name in the front end; if one ever reached here the commit phase
    // would read `locals[index]` in the MAIN frame — a different variable
    // entirely. Refusing it here is the guard that makes that impossible rather
    // than unlikely.
    if (s.owner !== null) {
      throw new IrError(
        `${at}: \`${s.name}\` belongs to function ${s.owner}. Function-local history needs a `
        + 'per-call-site ring base, the way persistent state already has one — it is refused '
        + 'in the front end and must never be lowered by accident.')
    }
  })
  return true
}

// ── small constructors, so a front end never hand-writes a literal ───────────
export const num = (value) => ({ kind: EXPR.NUM, value })
export const series = (name) => ({ kind: EXPR.SERIES, name })
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

export const declare = (slot, value) => ({ kind: STMT.DECLARE, slot, value })
export const assign = (slot, value) => ({ kind: STMT.ASSIGN, slot, value })
export const ifStmt = (test, then, els) => ({ kind: STMT.IF, test, then, else: els || [] })
export const emit = (output, value) => ({ kind: STMT.EMIT, output, value })
