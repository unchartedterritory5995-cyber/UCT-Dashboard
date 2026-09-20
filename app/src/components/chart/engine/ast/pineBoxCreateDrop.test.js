import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'

// ─── TASK 4 — DIAGNOSED, NOT FIXED: an object create inside a called Pine
// user function drops when its arguments read the function's OWN PARAMETERS ──
//
// Confirmed against `mid_engagement__01-zeiierman-trend-pressure.pine`
// (`tools/c0_parity_fixtures/…`, sha256 `5c6d87f8e3c8a29f173a68f3d2081f246a41ec9b33c8d2935d0642c41663c8cb`
// — the exact fixture Global Constraint 2 names; it was already present
// locally in two tool fixture directories, so no re-fetch was needed). Its
// `ut:=high; ub:=low; ubx:=mkbox(ut,ub,hc,hm)` where
// `mkbox(float t,float b,color c,color br)=>box.new(bar_index-1,t,bar_index,b,…)`
// is the real trigger for its one `create:box` drop.
//
// ⛔ ROOT CAUSE, TRACED THROUGH THE SWALLOWED EXCEPTION (temporarily
// unswallowed at `pine.js`'s `canonicalOf` catch block, then reverted — the
// production code path is unchanged by this diagnosis):
//
//   this Pine name was never given a value in the pasted script — `t`  (pine:undefined)
//
// `buildObjectProgram`'s per-op loop resolves every create's coordinate
// through `scopeEnv = scopeFor(op.locals)`, where `op.locals` is the scope
// `collectObjectOps` captured at the point it visited the `box.new(...)`
// statement. When that statement sits inside a Pine user FUNCTION's body
// (`mkbox`'s `=>` body, not the main script's top level), the scope captured
// is the function's own LEXICAL scope — which has no reason to know `t`
// resolves to whatever the CALL SITE passed (`ut`, itself `:=high`). Ordinary
// numeric/series expressions get this binding correctly elsewhere in this
// same file (see `canonicalOf`'s own comment on `envOverride`/`frame`:
// "an inlined user-function body must resolve its parameters against the
// caller's arguments" — proven for a numeric leaf read inside an `if` branch,
// e.g. `atrMult`) — but that per-call-site argument binding is not threaded
// through to an object-creating STATEMENT discovered inside a called
// function's own body, which is a different collection-time question (WHICH
// call site does this op belong to, and what did THAT call site pass) than
// the read-time question the existing mechanism answers.
//
// ⛔ NOT A ONE-LINE UNWRAP (Branch A), reasoned through rather than assumed:
// fixing this correctly means `collectObjectOps` recording, for an object op
// discovered inside a function body, WHICH CALL SITE reached it and binding
// that call's actual arguments into the op's captured scope -- extending the
// EXISTING per-call-site value-inlining machinery to also cover
// object-creating statements, not merely reading one more construct through
// the resolver. That is real, scoped, buildable work, but it touches exactly
// the collection-time scope-threading in `pineObjects.js`/`objectProgram.js`
// this plan's own Section A already flags as mid-landing on two other
// unmerged branches right now -- not a change to make in the same pass as
// this diagnosis. Recorded here, generically and reproducibly (not
// "too script-specific to name" -- the pattern is general: any object-op
// statement inside a called function body, referencing that function's own
// parameters), for a future wave with a real, evidenced starting point.
describe('⭐⭐ an object create inside a called function body drops on its own parameter names', () => {
  it('minimal repro: box.new inside a user function, called via := with a real argument', () => {
    const src = `//@version=6
indicator("t4", overlay=true)
mkbox(float t, float b) =>
    box.new(bar_index - 1, t, bar_index, b, bgcolor = color.new(color.red, 80))
var box ubx = na
if barstate.islast
    ubx := mkbox(high, low)
plot(close)
`
    const t = translatePine(src, { strict: true })
    // ⚠️ NOT a claim that this translates cleanly today -- diagnosed, not fixed.
    const d = t.objectDiagnostics
    expect(d.droppedOps).toBe(1)
    expect(d.dropReasons).toEqual({ 'create:box': 1 })
    expect(d.unresolvedValues).toBe(1)
    const ops = (t.objects && t.objects.ops) || []
    expect(ops.some((o) => o.k === 'create' && o.family === 'box')).toBe(false)
  })

  it('the real fixture: droppedOps unchanged at 4, including exactly one create:box', () => {
    const fixturePath = path.resolve(
      __dirname, '../../../../../../tools/c0_parity_fixtures/mid_engagement__01-zeiierman-trend-pressure.pine',
    )
    const src = fs.readFileSync(fixturePath, 'utf8')
    const t = translatePine(src, { strict: true })
    // ⚠️ The script does not translate at all today, for an UNRELATED reason
    // (a separate pine:function-def refusal on `con`, an earlier user
    // function this diagnosis does not concern) -- the object lane still
    // runs independently of the value lane's own output refusal, per this
    // engine's two-lane architecture, so its diagnostics remain readable.
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:function-def')
    const d = t.objectDiagnostics
    expect(d.droppedOps).toBe(4)
    expect(d.dropReasons).toEqual({ 'guard:delete': 3, 'create:box': 1 })
  })
})
