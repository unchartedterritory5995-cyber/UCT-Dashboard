// app/src/components/chart/engine/runtime/program.js
//
// ─── THE EXECUTABLE REPRESENTATION ──────────────────────────────────────────
//
// A Pine program lowered to a FLAT instruction array. Phase 1 measured why flat:
// a per-bar AST walk costs 4.96-6.06x an optimal columnar pass while a flat
// dispatch loop costs 2.66-2.78x, for the same semantics.
//
// ⭐⭐ THE SEAM THIS FILE EXISTS TO EXPRESS. The hybrid's whole claim is that a
// PURE subtree keeps its columnar evaluation and the runtime READS the result,
// while program order, state and lifetime belong to the runtime. `READ_COLUMN`
// is that seam in one opcode: every closed-table builtin — all 70, with their
// warm-ups, recurrences, rounding conventions and vendor-pinned initialisations —
// is evaluated ONCE by `interpret.js` into a column, and the bar loop reads it.
//
// ⛔ SO THE RUNTIME NEVER RE-IMPLEMENTS A BUILTIN. That is not an optimisation,
// it is the `%` lesson from Phase 1 promoted to architecture: a second
// implementation of settled arithmetic is a second authority, and the first thing
// to diverge is the case nobody tests. If a builtin ever needs per-bar semantics
// the column cannot express (a stateful call inside a loop body), it gets a real
// opcode and a differential case — deliberately, never by drift.
//
// ⚠️ THIS FILE IS THE FOUNDATION'S ISA, NOT PINE'S. State, loops, arrays, frames
// and object refs have reserved opcode space and named slots in the program
// header — they are declared here so the shape cannot need re-cutting when they
// land, per PHASE2_RUNTIME_ARCHITECTURE.md §9.

/** ⭐ ONE TABLE, AND EVERY CONSUMER DERIVES FROM IT. `vm.js` switches on these,
 *  `lower.js` emits them, and `program.test.js` asserts the two agree — a hand-
 *  kept opcode list in a second file is the drift this repo pays for most. */
export const OP = Object.freeze({
  // ── operands ──
  CONST: 0,          // a: const index
  READ_SERIES: 1,    // a: series index (open high low close volume)
  READ_COLUMN: 2,    // a: precomputed column index — THE HYBRID SEAM
  READ_HIST: 3,      // a: column index, b: offset in bars (na when unavailable)
  // ── arithmetic (NaN-propagating) ──
  ADD: 10,
  SUB: 11,
  MUL: 12,
  DIV: 13,
  NEG: 14,
  // ── comparison — 1 / 0, and NOT NaN-propagating (see vm.js) ──
  LT: 20,
  GT: 21,
  LE: 22,
  GE: 23,
  EQ: 24,
  NE: 25,
  // ── logical ──
  AND: 30,
  OR: 31,
  NOT: 32,
  SELECT: 33,        // ternary: (test, a, b)
  // ── output ──
  EMIT: 40,          // a: output index
  HALT: 41,
  // ── state (2D) ──
  LOAD_LOCAL: 50,
  STORE_LOCAL: 51,
  LOAD_PERSIST: 52,
  STORE_PERSIST: 53,     // also MARKS the slot initialised
  // ── control flow (2D) ──
  JUMP: 60,
  JUMP_IF_FALSE: 61,
  // ⭐⭐ `var` INITIALISES ONCE, AND THE GUARD IS AN OPCODE RATHER THAN A FLAG.
  // C3B already paid for the other design: the object translator emitted
  // `var table t = table.new(…)` unguarded, minted a NEW table every bar, blew
  // an 8-table envelope by bar 8, and EVERY runtime unit test passed — only a
  // 300-bar ladder run could see it. A flag checked inside STORE would still
  // EVALUATE the initialiser every bar, which is wrong the moment an initialiser
  // can have an effect. Jumping over it is once-only by construction.
  JUMP_IF_INIT: 62,      // a: persist slot, b: target — skip an initialiser already run
  // ── RESERVED, not yet emitted or executed. Declared so the shape is settled. ──
  CALL: 70, RET: 71,
  ARR_NEW: 80, ARR_PUSH: 81, ARR_GET: 82, ARR_SET: 83, ARR_SIZE: 84,
  OBJ_CREATE: 90, OBJ_UPDATE: 91, OBJ_DELETE: 92,
})

/** The opcodes this foundation actually executes. ⛔ DERIVED, so a reserved
 *  opcode reaching the VM is a named error rather than a silent fallthrough. */
export const IMPLEMENTED = Object.freeze(new Set([
  OP.CONST, OP.READ_SERIES, OP.READ_COLUMN, OP.READ_HIST,
  OP.ADD, OP.SUB, OP.MUL, OP.DIV, OP.NEG,
  OP.LT, OP.GT, OP.LE, OP.GE, OP.EQ, OP.NE,
  OP.AND, OP.OR, OP.NOT, OP.SELECT,
  OP.LOAD_LOCAL, OP.STORE_LOCAL, OP.LOAD_PERSIST, OP.STORE_PERSIST,
  OP.JUMP, OP.JUMP_IF_FALSE, OP.JUMP_IF_INIT,
  OP.EMIT, OP.HALT,
]))

export const OP_NAME = Object.freeze(
  Object.fromEntries(Object.entries(OP).map(([k, v]) => [v, k])))

/** The five price series, in the order the runtime indexes them. ⛔ This order
 *  is a wire fact: it is baked into every lowered program, so appending is safe
 *  and reordering silently re-points every saved artifact. */
export const SERIES_NAMES = Object.freeze(['open', 'high', 'low', 'close', 'volume'])

export class ProgramError extends Error {
  constructor(message) { super(message); this.name = 'ProgramError' }
}

/**
 * A lowered program.
 *
 * `code` is a flat triple array `[op, a, b, op, a, b, …]`; `pc` counts triples.
 * `columns` names the pure subtrees the columnar lane evaluates for us — the
 * runtime is handed their values, never their trees.
 */
export function makeProgram({ code, consts, columns, outputs, locals = 0, persists = 0, version = null }) {
  if (!Array.isArray(code) || code.length % 3 !== 0) {
    throw new ProgramError(`code must be a flat array of [op,a,b] triples; got length ${code && code.length}`)
  }
  const p = Object.freeze({
    code: Int32Array.from(code),
    // ⚠️ consts are Float64 and NOT frozen into an Int32Array — a const is a
    // VALUE, and the first thing an integer array would do is truncate 0.1.
    consts: Float64Array.from(consts || []),
    columns: Object.freeze((columns || []).slice()),
    outputs: Object.freeze((outputs || []).slice()),
    locals, persists, version,
    instructions: code.length / 3,
  })
  validateProgram(p)
  return p
}

/** ⛔ VALIDATED BEFORE IT CAN RUN, per §44 — a malformed program is a compiler
 *  bug and must say so at the boundary rather than reaching the dispatch loop
 *  and being reported as a runtime failure. */
export function validateProgram(p) {
  const n = p.instructions
  for (let pc = 0; pc < n; pc += 1) {
    const op = p.code[pc * 3]
    const a = p.code[pc * 3 + 1]
    if (!(op in OP_NAME)) throw new ProgramError(`pc ${pc}: unknown opcode ${op}`)
    if (!IMPLEMENTED.has(op)) {
      throw new ProgramError(
        `pc ${pc}: ${OP_NAME[op]} is RESERVED and not yet implemented — this program `
        + 'was lowered by a compiler ahead of the runtime')
    }
    if (op === OP.CONST && (a < 0 || a >= p.consts.length)) {
      throw new ProgramError(`pc ${pc}: CONST ${a} outside ${p.consts.length} consts`)
    }
    if (op === OP.READ_SERIES && (a < 0 || a >= SERIES_NAMES.length)) {
      throw new ProgramError(`pc ${pc}: READ_SERIES ${a} outside ${SERIES_NAMES.length} series`)
    }
    if ((op === OP.READ_COLUMN || op === OP.READ_HIST) && (a < 0 || a >= p.columns.length)) {
      throw new ProgramError(`pc ${pc}: ${OP_NAME[op]} ${a} outside ${p.columns.length} columns`)
    }
    if (op === OP.EMIT && (a < 0 || a >= p.outputs.length)) {
      throw new ProgramError(`pc ${pc}: EMIT ${a} outside ${p.outputs.length} outputs`)
    }
    if ((op === OP.LOAD_LOCAL || op === OP.STORE_LOCAL) && (a < 0 || a >= p.locals)) {
      throw new ProgramError(`pc ${pc}: ${OP_NAME[op]} ${a} outside ${p.locals} locals`)
    }
    if ((op === OP.LOAD_PERSIST || op === OP.STORE_PERSIST) && (a < 0 || a >= p.persists)) {
      throw new ProgramError(`pc ${pc}: ${OP_NAME[op]} ${a} outside ${p.persists} persists`)
    }
    // ⛔ A JUMP TARGET IS VALIDATED HERE, not discovered by running off the end.
    // An out-of-range target is a compiler bug and reads as one; reaching the
    // dispatch loop it would read as a runtime failure on the member's script.
    if (op === OP.JUMP || op === OP.JUMP_IF_FALSE) {
      if (a < 0 || a > n) throw new ProgramError(`pc ${pc}: ${OP_NAME[op]} target ${a} outside 0..${n}`)
    }
    if (op === OP.JUMP_IF_INIT) {
      if (a < 0 || a >= p.persists) throw new ProgramError(`pc ${pc}: JUMP_IF_INIT slot ${a} outside ${p.persists} persists`)
      const t = p.code[pc * 3 + 2]
      if (t < 0 || t > n) throw new ProgramError(`pc ${pc}: JUMP_IF_INIT target ${t} outside 0..${n}`)
    }
  }
  if (n === 0 || p.code[(n - 1) * 3] !== OP.HALT) {
    throw new ProgramError('a program must end in HALT')
  }
  return true
}
