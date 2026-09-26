// ─── TASK 1 — `emitCollection` MUST NOT COUNT A PLAIN NUMERIC ARRAY AS A
// DROPPED OBJECT OP, AND THE REAL RISK-043 CAUSE MUST BE NAMED CORRECTLY ───
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'

describe('⭐⭐ a plain numeric array inside a loop is not a dropped OBJECT op', () => {
  it('array.set on a array.new_float() scratch array inside a for loop is NOT loopBlocked', () => {
    const src = `//@version=6
indicator("t1", overlay=true)
len = 3
dizi = array.new_float(len)
for i = 0 to len - 1
    array.set(dizi, i, close[i])
plot(close)
`
    const t = translatePine(src, { strict: true })
    expect(t.objectDiagnostics.loopBlocked).toBe(0)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual([])
  })

  // ⚰️⚰️ THIS CONTROL USED A COUNTED `for i = 0 to 2`, AND ITS PREMISE MOVED.
  //
  // RISK-043's reason was *"the loop is not executed, and drawing the first
  // iteration would be a lie"* — true of a STATIC reader. The object runtime now
  // carries a `loop` op and EXECUTES a counted range bar by bar, with the counter
  // bound per iteration and every iteration paying `opsPerBar`, so for that shape
  // the premise is simply no longer true.
  //
  // ⭐⭐ THE RULING (2026-09-23): the counted `for` executes; `while` and
  // `for … by <step>` STILL REFUSE, and that is not laziness — a `loop` op is a
  // COUNTED range (`from`, `to`) with no step field, so a `while` would need the
  // runtime to become an interpreter and a stepped `for` would draw every row of
  // a loop the author wrote to skip. RISK-043 is NARROWED, not overturned, and
  // this control is re-pointed at a shape where it still holds rather than
  // deleted — a rail that stops discriminating is worse than no rail.
  it('CONTROL: array.push on an OBJECT-family collection inside a STEPPED for IS STILL loopBlocked — RISK-043 stands where it still applies', () => {
    const src = `//@version=6
indicator("t1b", overlay=true)
lines = array.new_line()
if barstate.islast
    for i = 0 to 2 by 1
        array.push(lines, na)
plot(close)
`
    const t = translatePine(src, { strict: true })
    expect(t.objectDiagnostics.loopBlocked).toBe(1)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual(['array.push'])
  })

  it('⭐⭐ THE OTHER HALF OF THE RULING — a COUNTED for is carried, not blocked', () => {
    // ⛔ WITHOUT THIS THE RE-POINT ABOVE WOULD BE UNFALSIFIABLE. "Stepped loops
    // block" is satisfied by an engine that blocks EVERY loop, which is exactly
    // the behaviour the `loop` op was built to replace.
    const src = `//@version=6
indicator("t1c", overlay=true)
lines = array.new_line()
if barstate.islast
    for i = 0 to 2
        array.push(lines, na)
plot(close)
`
    const t = translatePine(src, { strict: true })
    expect(t.objectDiagnostics.loopBlocked).toBe(0)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual([])
  })

  it('the real parity-set fixture: loopBlocked drops from 6 to 0, and the 6 real creates fail via guard:create (RISK-043), not loopBlocked', () => {
    const fixturePath = path.resolve(
      __dirname, '../../../../../../tests/fixtures/pine_oos/high_engagement__10-rsi-divergence-faytterro.pine',
    )
    const src = fs.readFileSync(fixturePath, 'utf8')
    const t = translatePine(src, { strict: true })
    // ⭐ THE FIX'S WHOLE CLAIM: the diagnostic becomes honest for this script.
    expect(t.objectDiagnostics.loopBlocked).toBe(0)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual([])
    // ⚠️ NOT A CLAIM THAT OBJECTS NOW PAINT. This is RISK-043 working as
    // designed (cg/cr reassigned inside a for loop, forced opaque, the
    // guard cannot resolve) — correct, standing, out of scope to change here.
    expect(t.objectDiagnostics.droppedOps).toBe(6)
    expect(t.objectDiagnostics.dropReasons).toEqual({ 'guard:create': 6 })
    const ops = (t.objects && t.objects.ops) || []
    expect(ops.length).toBe(0)
  })
})
