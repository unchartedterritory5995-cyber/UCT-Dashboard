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

  it('CONTROL: array.push on a declared OBJECT-family collection inside a loop IS STILL loopBlocked — RISK-043 stands', () => {
    const src = `//@version=6
indicator("t1b", overlay=true)
lines = array.new_line()
if barstate.islast
    for i = 0 to 2
        array.push(lines, na)
plot(close)
`
    const t = translatePine(src, { strict: true })
    expect(t.objectDiagnostics.loopBlocked).toBe(1)
    expect(t.objectDiagnostics.loopBlockedCalls).toEqual(['array.push'])
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
