// app/src/components/chart/engine/runtime/__tests__/taintCfg.test.js
//
// ─── START-TAINT PART 1: each branch's join and write set (`../taintCfg.js`, `docs/pine/START-TAINT.md`) ───────────
//
// The VM's implicit-flow rule (PART 2) taints everything EITHER arm of a tainted branch may write. These rails hold
// the static half to hand-built programs whose answer is known by construction (the diamond, the loop, the var
// initialiser, an early return, call sites rebased and nested), and to real lowered Pine (the store inside an `if`
// is in its write set, the store after it is not).
import { describe, it, expect } from 'vitest'

import { taintCfg, successors, WRITE_KINDS } from '../taintCfg.js'
import { OP } from '../program.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'

/** A program from `[op, a, b]` rows (the fields `taintCfg` reads). */
const prog = (rows, extra = {}) => ({ code: Int32Array.from(rows.flat()), functions: [], callSites: [], requests: [], ...extra })
const I = (op, a = 0, b = 0) => [op, a, b]

describe('the control-flow edges', () => {
  it('JUMP goes to its target; JUMP_IF_FALSE falls through or jumps; JUMP_IF_INIT falls into the initialiser or skips to b', () => {
    const p = prog([I(OP.JUMP, 2), I(OP.JUMP_IF_FALSE, 0), I(OP.JUMP_IF_INIT, 7, 0), I(OP.RET), I(OP.HALT), I(OP.ADD)])
    expect(successors(p.code, 0)).toEqual([2])
    expect(successors(p.code, 1)).toEqual([2, 0])
    expect(successors(p.code, 2)).toEqual([3, 0])
    expect(successors(p.code, 3)).toEqual([-1])
    expect(successors(p.code, 4)).toEqual([-1])
    expect(successors(p.code, 5)).toEqual([6])
  })
})

describe('hand-built programs: the join and the write set are the ones the code spells', () => {
  // 0 cond; 1 JIF ->5; then-arm 2-4 (persist 1, JUMP 6); else-arm 5 (local 2); 6 THE JOIN writes persist 3; 7 HALT
  const DIAMOND = prog([
    I(OP.READ_SERIES, 3), I(OP.JUMP_IF_FALSE, 5), I(OP.CONST, 0), I(OP.STORE_PERSIST, 1), I(OP.JUMP, 6),
    I(OP.STORE_LOCAL, 2), I(OP.STORE_PERSIST, 3), I(OP.HALT),
  ])
  it('an if / else: joins where both arms meet; BOTH arms\' writes, nothing at or after the join', () => {
    const br = taintCfg(DIAMOND).branches.get(1)
    expect(br.join).toBe(6)
    expect(br.writes.persist).toEqual([1])
    expect(br.writes.locals).toEqual([2])
  })
  it('a loop: the condition\'s branch joins at the exit; the body (behind its back edge) is the write set', () => {
    // 0-1 i = 0; 2-4 head (i < n); 5 JIF -> 10; 6 tick; 7 body writes persist 4 and an output; 8 i += 1; 9 JUMP 2;
    // 10 the exit writes output 1; 11 HALT
    const p = prog([
      I(OP.CONST, 0), I(OP.STORE_LOCAL, 0), I(OP.LOAD_LOCAL, 0), I(OP.CONST, 1), I(OP.LT), I(OP.JUMP_IF_FALSE, 10),
      I(OP.LOOP_TICK, 1), I(OP.STORE_PERSIST, 4), I(OP.STORE_LOCAL, 0), I(OP.JUMP, 2), I(OP.EMIT, 1), I(OP.HALT),
    ])
    const br = taintCfg(p).branches.get(5)
    expect(br.join).toBe(10)
    expect(br.writes.persist).toEqual([4])
    expect(br.writes.locals).toEqual([0])
    expect(br.writes.outputs).toEqual([])
  })
  it('a `var` initialiser: JUMP_IF_INIT is a branch whose region is the initialiser', () => {
    const p = prog([I(OP.JUMP_IF_INIT, 0, 3), I(OP.CONST, 0), I(OP.STORE_PERSIST, 0), I(OP.STORE_PERSIST, 9), I(OP.HALT)])
    const br = taintCfg(p).branches.get(0)
    expect(br.join).toBe(3)
    expect(br.writes.persist).toEqual([0])
  })
  it('every effect kind is collected (outputs, iteration buffers, built-in state, collections, drawings, broker, requests)', () => {
    const p = prog([
      I(OP.READ_SERIES, 3), I(OP.JUMP_IF_FALSE, 12),
      I(OP.EMIT, 2), I(OP.EMIT_ITER, 1), I(OP.WINDOW, 3), I(OP.CARRIED, 4), I(OP.CARRIED2, 5), I(OP.ARRAY, 6),
      I(OP.FIELD_SET, 7), I(OP.OBJECT, 8), I(OP.BROKER, 9), I(OP.REQUEST, 1),
      I(OP.HALT),
    ])
    const w = taintCfg(p).branches.get(1).writes
    expect(w).toMatchObject({ outputs: [2], iters: [1], windows: [3], carried: [4], carried2: [5], arrayOps: [6],
      fieldSets: [7], objectOps: [8], brokerOps: [9], requests: [1] })
    expect(Object.keys(w).sort()).toEqual([...WRITE_KINDS].sort())
  })
  it('an early return inside a function: the branch joins only at the exit, so everything after it on either path counts', () => {
    // main 0 CALL f via site 0, 1 HALT; f at 2: 2 cond, 3 JIF -> 6, 4 persist 0, 5 RET, 6 persist 1, 7 RET
    const p = prog([
      I(OP.CALL, 0, 0), I(OP.HALT),
      I(OP.READ_SERIES, 3), I(OP.JUMP_IF_FALSE, 6), I(OP.STORE_PERSIST, 0), I(OP.RET), I(OP.STORE_PERSIST, 1), I(OP.RET),
    ], { functions: [{ name: 'f', entry: 2, historyCount: 0 }], callSites: [{ fn: 0, persistBase: 20 }] })
    const br = taintCfg(p).branches.get(3)
    expect(br.join).toBe(-1)
    expect(br.region).toMatch(/function 0/)
    expect(br.writes.persist).toEqual([0, 1])
  })
})

describe('call sites: a call inside a branch writes the callee\'s state AT ITS SITE\'S BASES, transitively', () => {
  // main: 0 cond, 1 JIF -> 3, 2 CALL g via site 0, 3 HALT
  // g (entry 4): persist 0, window 1, carried 0, CALL h via site 1, RET; h (entry 9): persist 2, RET
  const P = prog([
    I(OP.READ_SERIES, 3), I(OP.JUMP_IF_FALSE, 3), I(OP.CALL, 0, 0), I(OP.HALT),
    I(OP.STORE_PERSIST, 0), I(OP.WINDOW, 1), I(OP.CARRIED, 0), I(OP.CALL, 1, 1), I(OP.RET),
    I(OP.STORE_PERSIST, 2), I(OP.RET),
  ], {
    functions: [{ name: 'g', entry: 4, historyCount: 2 }, { name: 'h', entry: 9, historyCount: 1 }],
    callSites: [{ fn: 0, persistBase: 10, windowBase: 5, carriedBase: 3, historyBase: 7 },
      { fn: 1, persistBase: 30, historyBase: 40 }],
  })
  it('the branch names its call site; the site\'s writes are absolute', () => {
    const { branches, siteWrites } = taintCfg(P)
    expect(branches.get(1).writes.calls).toEqual([0])
    expect(siteWrites[0]).toMatchObject({ persist: [10, 32], windows: [6], carried: [3], held: [7, 8, 40], calls: [1] })
    expect(siteWrites[1]).toMatchObject({ persist: [32], held: [40], calls: [] })
    // a function's locals are its frame's temporaries, never state
    expect(siteWrites[0].locals).toEqual([])
  })
  it('⛔ a recursive call is refused (Pine has none; a cycle here is a malformed program)', () => {
    const r = prog([I(OP.CALL, 0, 0), I(OP.HALT), I(OP.CALL, 0, 0), I(OP.RET)],
      { functions: [{ entry: 2 }], callSites: [{ fn: 0, persistBase: 0 }] })
    expect(() => taintCfg(r)).toThrow(/reaches itself/)
  })
})

describe('pure', () => {
  it('reads the program and returns frozen data; the code is untouched', () => {
    const p = prog([I(OP.READ_SERIES, 3), I(OP.JUMP_IF_FALSE, 4), I(OP.CONST, 0), I(OP.STORE_PERSIST, 1), I(OP.HALT)])
    const before = Array.from(p.code)
    const out = taintCfg(p)
    expect(Array.from(p.code)).toEqual(before)
    expect(Object.isFrozen(out)).toBe(true)
    expect(Object.isFrozen(out.branches.get(1).writes.persist)).toBe(true)
    expect(taintCfg(p).branches.get(1)).toEqual(out.branches.get(1))
  })
  it('⛔ not a program, or control leaving the code: refused', () => {
    expect(() => taintCfg(null)).toThrow(/not a lowered program/)
    expect(() => taintCfg(prog([I(OP.JUMP, 9)]))).toThrow(/past the code/)
  })
})

describe('real lowered Pine', () => {
  const BARS = Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 10 + i, h: 12 + i, l: 9 + i, c: 11 + i, v: 100 }))
  const lower = (src) => {
    const built = buildRuntimeIr(`//@version=5\nindicator("t")\n${src}`, { bars: BARS, inputs: {} })
    expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
    return lowerIrProgram(built.ir)
  }
  const pcsOf = (code, op) => { const out = []; for (let pc = 0; pc < code.length / 3; pc += 1) if (code[pc * 3] === op) out.push(pc); return out }
  it('a `var` latched inside an `if`: its store is in the branch\'s write set; the store after the `if` is not', () => {
    const p = lower('var float hi = na\nvar float seen = 0.0\nif close > open\n    hi := high\nseen := seen + 1\nplot(hi + seen)')
    const { branches } = taintCfg(p)
    const ifs = pcsOf(p.code, OP.JUMP_IF_FALSE)
    expect(ifs.length).toBe(1)
    const br = branches.get(ifs[0])
    const stores = pcsOf(p.code, OP.STORE_PERSIST)
    const inside = stores.filter((pc) => pc > ifs[0] && (br.join < 0 || pc < br.join))
    const after = stores.filter((pc) => br.join >= 0 && pc >= br.join)
    expect(inside.length, 'the `hi := high` store').toBe(1)
    expect(after.length, 'the `seen := seen + 1` store').toBe(1)
    const slot = (pc) => p.code[pc * 3 + 1]
    expect(br.writes.persist).toEqual([slot(inside[0])])
    expect(br.writes.persist).not.toContain(slot(after[0]))
  })
  it('every `var` initialiser is a JUMP_IF_INIT branch whose write set is its own slot', () => {
    const p = lower('var float a = close\nvar float b = open\nplot(a + b)')
    const { branches } = taintCfg(p)
    const inits = pcsOf(p.code, OP.JUMP_IF_INIT)
    expect(inits.length).toBe(2)
    for (const pc of inits) expect(branches.get(pc).writes.persist).toEqual([p.code[pc * 3 + 1]])
  })
  it('a user function with its own `var`, called inside an `if`: the call site carries the var at the site\'s base', () => {
    const p = lower('f(x) =>\n    var float last = na\n    last := x\n    last\nfloat v = na\nif close > open\n    v := f(close)\nplot(v)')
    const { branches, siteWrites } = taintCfg(p)
    const call = pcsOf(p.code, OP.CALL)
    expect(call.length).toBe(1)
    const site = p.code[call[0] * 3 + 2]
    const owner = pcsOf(p.code, OP.JUMP_IF_FALSE).map((pc) => branches.get(pc)).find((b) => b.region === 'main' && b.writes.calls.includes(site))
    expect(owner, 'the `if` names the call site').toBeTruthy()
    const base = p.callSites[site].persistBase
    expect(siteWrites[site].persist.length).toBeGreaterThan(0)
    for (const x of siteWrites[site].persist) expect(x).toBeGreaterThanOrEqual(base)
  })
})
