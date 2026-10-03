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

  // ⚰️ 2026-09-28 — was `sonarlab-order-blocks`, which "cleared" only because
  // its `for … by 1` delete loops were blocked at the reader, where no drop is
  // counted. The loop op reads `by` now; those loops' bounds are array sizes it
  // cannot read, so the loss is counted and the script is honestly not clean.
  // `ict-ipda-look-back` is a real object-only corpus script that IS clean —
  // and matches TradingView on every object family (vendor capture 2026-09-28).
  it('a second real corpus script (ICT IPDA look-back) also clears the host lane cleanly', () => {
    const src = fs.readFileSync(path.join(CORPUS, 'ict-ipda-look-back__f85b4c8956.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(true)
    expect(t.objects.ops.length).toBeGreaterThan(0)
    expect(t.objectDiagnostics.droppedOps).toBe(0)
  })

  it('⛔ CONTROL — a script with SOME real object output but ALSO some drops stays correctly refused (no partial credit)', () => {
    // ⚰️ The fixture was `fib-retracement` until O1 (step 67, G7) read its four
    // `x = ExtraFibs ? Fib_line(…) : na` calls and its program came out CLEAN —
    // the rule here did not move; the specimen stopped being one. `fair-value-gap`
    // draws AND drops (its `input.timeframe` label text, `f_gapCheck`'s state).
    const src = fs.readFileSync(path.join(CORPUS, 'fair-value-gap__1048fa103a.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    // ⛔ non-vacuity: the specimen really is partial — some ops kept, some dropped
    expect(t.objects && t.objects.ops.length).toBeGreaterThan(0)
    expect(t.objectDiagnostics.droppedOps).toBeGreaterThan(0)
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
