// ─── A SCRIPT THAT DRAWS ONLY OBJECTS (NO plot(), NO alertcondition()) MUST
// NOT BE REFUSED `pine:no-output` WHEN THE OBJECT LANE HAS SOMETHING REAL AND
// CLEAN TO SHOW ───────────────────────────────────────────────────────────
//
// `pine:no-output` fires purely off the VALUE lane (`resolved.length === 0`),
// before the object lane (`buildObjectProgram`) ever runs — measured against
// the real 266-script committed corpus, 2026-09-20: 48 scripts hit this as
// their ONLY blocker, and 2 of them have a real, ZERO-DROP object program
// waiting behind the gate. This is the doctrine-consistent fix: "no partial
// credit" (RULING, this file's own history — a script with 2-of-23 plots
// translating was wrongly `ok:true` once) means the bar for accepting via the
// object lane alone is the SAME bar the value lane already holds itself to —
// every attempted op must have survived, not merely one.
//
// ⛔ THE OTHER 17 OF 48 (real output, but ALSO some drops) correctly stay
// refused under this same doctrine — the control cases below pin that this
// fix does NOT touch them.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')

describe('⭐⭐ an object-only script (no plot, no alertcondition) with a clean object program is accepted for the host lane', () => {
  it('a real corpus script that draws only boxes now translates for the chart', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, "makuchaku039s-trade-tools-fair-value-gaps__b951deedc8.pine"), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok, 'a clean object-only program should be a host-lane accept').toBe(true)
    expect(t.mode).toBe('host')
    expect(t.refusal).toBe(null)
    expect(t.objects, 'the object program itself must be present').not.toBe(null)
    expect(t.objects.ops.length).toBeGreaterThan(0)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    // ⛔ NOTHING TO SCREEN ON. The screener lane asks a different question
    // ("which columns can you serve me") and an object-only script has zero —
    // it must stay refused there, with an HONEST reason, never silently.
    const screener = translatePine(src, {})
    expect(screener.ok, 'no numeric/boolean column exists to screen on').toBe(false)
    expect(screener.mode).toBe('screener')
    expect(screener.refusal, 'a screener refusal must never be silent').not.toBe(null)
    // ⭐ `pine:objects-only`, NOT `pine:no-output` — ruled in the 2026-09-23 merge.
    // Both facts are true here and they are DIFFERENT facts: this script offers no
    // column to screen on, AND it does draw. The narrower guard says which one it
    // means. ⛔ The case at the bottom of this file keeps `pine:no-output` and is
    // what proves the two are distinguished rather than renamed: that script's
    // object lane produces NOTHING, so the wider guard is the true one there.
    expect(screener.refusal.guard).toBe('pine:objects-only')
  })

  it('a second real corpus script (order blocks) also clears the host lane cleanly', () => {
    const src = fs.readFileSync(path.join(CORPUS, 'sonarlab-order-blocks__0df0d45ee6.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(true)
    expect(t.objects.ops.length).toBeGreaterThan(0)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
  })

  it('⛔ CONTROL — a script with SOME real object output but ALSO some drops stays correctly refused (no partial credit)', () => {
    const src = fs.readFileSync(path.join(CORPUS, 'fib-retracement__8XcLscnekw.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok, 'partial object output must not be reported as a full pass').toBe(false)
    // ⭐ `pine:objects-only`, NOT `pine:no-output` — ruled in the 2026-09-23 merge.
    // Both facts are true here and they are DIFFERENT facts: this script offers no
    // column to screen on, AND it does draw. The narrower guard says which one it
    // means. ⛔ The case at the bottom of this file keeps `pine:no-output` and is
    // what proves the two are distinguished rather than renamed: that script's
    // object lane produces NOTHING, so the wider guard is the true one there.
    expect(t.refusal.guard).toBe('pine:objects-only')
  })

  it('⛔ CONTROL — a script where the object lane also produces nothing stays correctly refused', () => {
    const src = fs.readFileSync(path.join(CORPUS, 'correlation-matrix__dzN3DMCFJL.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:no-output')
  })
})
