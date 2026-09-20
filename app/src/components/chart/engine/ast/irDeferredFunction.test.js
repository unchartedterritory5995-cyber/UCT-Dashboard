// app/src/components/chart/engine/ast/irDeferredFunction.test.js
//
// ─── ⭐⭐ R2 STEP 5 — AN UNCALLED HELPER IS NOT A REASON TO REFUSE A PROGRAM ──
//
// ⚰️ MEASURED ON `uncharted-volume-v2.pine`. `buildRuntimeIr`, told the clock,
// refused the WHOLE script at `pine:text-value@153` — `f_getTablePos`, a
// three-line helper that maps an `input.string` to a `position.*` enum and is
// called by nothing this lane models. It positions a table. Compiling every
// definition eagerly made an unreachable helper's text the reason a
// 34,378-character script produced zero columns, and the refusal pointed at a
// line whose value no column depends on.
//
// ⛔ NOTHING IS DROPPED (§18). The refusal is kept against the name and re-raised
// at the FIRST CALL SITE — the line a member would actually have to change — and
// a definition nobody calls is reported in `diagnostics.skippedFunctions` so
// "unreachable" is a measurement rather than a silence.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildRuntimeIr } from './pineRuntimeFrontend'
import { runtimeClockOpts } from './pineRuntimeClock'

const REPO = path.resolve(process.cwd(), '..')
const V2 = fs.readFileSync(
  path.join(REPO, 'tests/fixtures/member/uncharted-volume-v2.pine'), 'utf8')

const HEAD = '//@version=6\nindicator("t", overlay=true)\n'

describe('⭐⭐ a definition this lane cannot compile defers to its call site', () => {
  it('⭐ an UNCALLABLE helper no longer refuses the program', () => {
    // ⚰️ A TUPLE HELPER STOOD HERE and lowered two commits later, which is the
    // SECOND time this case's example became supported — a `for` loop was the
    // first. The mechanism it tests (deferral: an uncompilable definition is
    // skipped, NAMED, and re-raised at its first call site) has never changed;
    // only the construct standing in for "uncompilable" has. `while` is the
    // stable one: its bound is re-read every pass, a different termination
    // argument from the counted loop's, and nothing in this wave touches it.
    // ⚰️ THIS CASE USED TO USE A TEXT HELPER — `f_pos(_p) => _p == 'Top Left' ?
    // 1 : 2` — and the text value model (2026-09-19) made that helper COMPILE,
    // so it stopped being an example of "a definition this lane cannot
    // compile". The MECHANISM under test is deferral, not text: a definition
    // that cannot compile is skipped, NAMED with its line and guard, and
    // re-raised at the first call site. A tuple return is a construct this lane
    // still cannot compile, so it carries the case now.
    const src = `${HEAD}f_spin(_x) =>
    float s = 0.0
    while s < _x
        s := s + 1.0
    s
plot(ta.sma(close, 14))
`
    const r = buildRuntimeIr(src, runtimeClockOpts(false))
    expect(r.ok, `refused: ${JSON.stringify(r.refusal)}`).toBe(true)
    // ⛔ AND IT IS NAMED. A helper the lane skipped is in the diagnostics with
    // its line and the guard its definition hit — never simply absent.
    expect(r.diagnostics.skippedFunctions).toEqual(['f_spin@3 runtime:loop'])
  })

  it('⛔ …and CALLING it still refuses — at the CALL, not the definition', () => {
    const src = `${HEAD}f_spin(_x) =>
    float s = 0.0
    while s < _x
        s := s + 1.0
    s
plot(f_spin(close))
`
    const r = buildRuntimeIr(src, runtimeClockOpts(false))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('runtime:loop')
    // ⛔ AT THE CALL. The definition is on line 3; the refusal names line 5.
    expect(r.refusal.line).toBeGreaterThan(3)
  })

  it('⭐⭐ a TEXT helper now COMPILES — the case above no longer covers text', () => {
    // ⭐ Kept as the record of what changed, so the edit above is not read as a
    // rail being weakened to fit. This is the exact script the two cases above
    // used to use, and the lane now runs it.
    const src = `${HEAD}f_pos(_p) =>
    _p == 'Top Left' ? 1 : 2
plot(f_pos('Top Left'))
`
    const r = buildRuntimeIr(src, runtimeClockOpts(false))
    expect(r.ok, `refused: ${JSON.stringify(r.refusal)}`).toBe(true)
    expect(r.diagnostics.skippedFunctions || []).toEqual([])
  })

  it('⛔⛔ A DEFINITION THAT DIES ON ITS PARAMETERS STILL REFUSES BY ITS OWN NAME', () => {
    // ⚰⚰ THE DEFECT THIS CASE EXISTS FOR, found by the full sweep and not by the
    // cases above. `defineFunction` registers into `fnByName` only AFTER its
    // parameter list reads, so `f(x = 3) => …` — which dies ON the parameters —
    // never enters that map at all. Deferral then let the walk continue to
    // `plot(f(close))`, and `needsRuntime` asked `fnByName.has('f')`, got false,
    // and handed the subtree to the COLUMNAR resolver, which has never heard of
    // `f` and answered `pine:function`: *"there is no such function"* about a
    // function written one line above.
    //
    // ⭐ Two places were asking *"is this a user function"* and a refused
    // definition can leave the name in either one. There is one predicate now
    // (`isUserFn`), and this is the shape that can tell the difference.
    const src = `${HEAD}f(x = 3) =>
    x * 2
plot(f(close))
`
    const r = buildRuntimeIr(src, runtimeClockOpts(false))
    expect(r.ok).toBe(false)
    // The DEFINITION's own guard, re-raised at the call — not `pine:function`.
    expect(r.refusal.guard).toBe('runtime:function')
    expect(r.refusal.message).toContain('default values')
  })

  it('⛔ CONTROL — a helper this lane CAN compile still compiles and is not skipped', () => {
    // Without this the deferral could be swallowing every definition and the
    // cases above would pass over a lane that compiles nothing.
    const src = `${HEAD}f_half(_x) =>
    _x / 2
plot(f_half(close))
`
    const r = buildRuntimeIr(src, runtimeClockOpts(false))
    expect(r.ok, `refused: ${JSON.stringify(r.refusal)}`).toBe(true)
    expect(r.diagnostics.skippedFunctions).toBeUndefined()
    expect(r.diagnostics.functions).toBeGreaterThan(0)
  })
})

describe('⭐⭐ v2 through the IR lane — where it stops now', () => {
  const r = buildRuntimeIr(V2, runtimeClockOpts(false))

  it('v2:153 `f_getTablePos` is CLEARED', () => {
    // The measurement this step exists for. Before: `pine:text-value@153`,
    // 40 statements, 0 columns.
    expect(r.refusal.line).not.toBe(153)
    expect(r.refusal.guard).not.toBe('pine:text-value')
    expect(r.diagnostics.statements).toBeGreaterThan(40)
  })

  it('⛔ and the next blocker is NAMED TO ITS LINE — the R-K seam, one lane over', () => {
    // ⭐ `if not isRatioSymbol` at line 249. `isRatioSymbol` is v2:224's
    // `str.contains(syminfo.ticker, "/") or str.contains(syminfo.tickerid, "/")`
    // — the same bind-time symbol fold item 1 threaded through `binder.sync` →
    // `computeFor` → `symbolConstantsWith` for the DEFINITION lane.
    //
    // ⛔ THE IR LANE HAS NO SYMBOL PLUMBING AT ALL, and this pins that rather
    // than implying it: passing `{ticker, exchange}` through `interpretOpts`
    // changes nothing, because the refusal is raised while LOWERING, before any
    // `interpret` call can see it. That is a seam of its own — item 1's work,
    // one lane over — and naming it here is what keeps it from being
    // rediscovered as a mystery.
    expect(r.refusal.line).toBe(249)
    expect(r.refusal.message).toContain('syminfo.ticker')
    expect(r.diagnostics.statements).toBe(77)
  })
})
