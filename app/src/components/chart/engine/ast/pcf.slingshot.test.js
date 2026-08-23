// ⭐⭐ A REAL, COMPLEX, OWNER-AUTHORED TC2000 SCAN — END TO END, THROUGH THE
// SHIPPED DOOR.
//
// This is the firm's "Slingshot" column, copied verbatim from its TC2000 Edit
// Column dialog (three condition rows, ANDed, which is what that dialog's
// leading `and` on rows 2 and 3 means). It is here because every other TC2000
// case in this repo is a ONE-IDEA expression from Worden's syntax table, and a
// vocabulary that reads 59 single spellings can still fall over on the thing a
// member actually pastes: eight clauses, four different bar offsets, an offset
// applied to an INDICATOR rather than a price, a min-over-N of volume that is
// itself offset, and a ratio of a series to its own prior bar.
//
// ⛔ IT ASSERTS BEHAVIOUR, NOT JUST PARSING. `ok: true` is satisfiable by a
// reader that produced the wrong tree, and this formula's whole point is WHICH
// bar fires. So it runs on two hand-built series — one that slingshots and one
// that misses by a single clause — and the second is the control without which
// "it fired" would also be true of a formula that always returns 1.
//
// ⚠️ It is the owner's own formula, so unlike the third-party Pine fixtures it
// carries no licensing question (task #88).

import { describe, it, expect } from 'vitest'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'
import { interpret } from './interpret.js'

/** The three rows of the dialog, in the dialog's own order. */
const ROWS = Object.freeze([
  'c>xavgh4 and c1<xavgh4.1 and c2<xavgh4.2 and c3<xavgh4.3',
  'c>5 and minv3.1>700000',
  'c/c1>1.04 and v>v1',
])
const SLINGSHOT = ROWS.join(' and ')

/** Forty bars drifting DOWN — so close sits under the 4-bar EMA of high on every
 *  one of them — then a bar that gaps 5% on more than double the volume. */
function slingshotBars() {
  const out = []
  for (let i = 0; i < 40; i++) {
    const p = 50 - i * 0.15
    out.push({ o: p, h: p + 0.2, l: p - 0.2, c: p, v: 900000 })
  }
  const prev = out[out.length - 1]
  out.push({ o: prev.c, h: prev.c * 1.06, l: prev.c, c: prev.c * 1.05, v: 2000000 })
  return out
}

/** ⛔ THE CONTROL SERIES: identical, except the last bar's volume FALLS. That
 *  breaks `v>v1` alone and must take the whole column to 0 — proving the eight
 *  clauses are all live rather than one of them carrying the result. */
function missesOnVolume() {
  const out = slingshotBars()
  out[out.length - 1] = { ...out[out.length - 1], v: 100000 }
  return out
}

const ev = evaluateFormula(SLINGSHOT, BUILDER_INPUT_SCOPE)
const col = (bars) => [...interpret(ev.ast, bars, {})]

describe("the firm's Slingshot column, pasted as TC2000", () => {
  it('⛔ NON-VACUITY — the formula under test is the whole dialog, not one row', () => {
    expect(ROWS.length).toBe(3)
    // eight clauses; if a row is ever edited this is what says so out loud
    expect(SLINGSHOT.split(/\band\b/).length).toBe(8)
  })

  it('reads as TC2000, and SAVES', () => {
    expect(ev.ok, ev.error || '').toBe(true)
    expect(ev.dialect).toBe('pcf')
    expect(canSaveFormula(ev, false)).toBe(true)
  })

  it('every clause survives into the read-back, in English', () => {
    // ⭐ The expectations are the SHIPPED sentence layer's own words, and each
    // one names a different capability this scan needs. A reader that quietly
    // dropped an offset would still parse — it would fail here.
    const r = ev.readback
    expect(r, 'EMA of HIGH, not of close').toContain('4-bar exponential average of high')
    expect(r, 'a price offset').toContain('close 1 bar ago')
    expect(r, 'a deeper price offset').toContain('close 3 bars ago')
    expect(r, 'an offset applied to an INDICATOR').toMatch(/exponential average of high\) 3 bars ago/)
    expect(r, 'min-over-N of volume, itself offset').toContain('lowest volume of the last 3 bars) 1 bar ago')
    expect(r, 'a series over its own prior bar').toContain('close divided by (close 1 bar ago)')
    expect(r, 'volume against its own prior bar').toContain('volume 1 bar ago')
  })

  it('🔴 FIRES ON THE SLINGSHOT BAR — and on NO other bar', () => {
    const out = col(slingshotBars())
    expect(out[out.length - 1], 'the slingshot bar did not fire').toBe(1)
    expect(out.filter((x) => x === 1).length, 'it fired on more than the one bar').toBe(1)
  })

  it('⛔ THE CONTROL — drop the last bar`s volume and NOTHING fires', () => {
    // Without this, a formula that always returned 1 would pass the test above.
    expect(col(missesOnVolume()).filter((x) => x === 1).length).toBe(0)
  })

  it('is NON-REPAINTING, and reads no bar it has not reached', () => {
    // The property that makes a scan trustworthy: `forward: 0`.
    expect(ev.verdict.mode).toBe('non-repainting')
    expect(ev.verdict.forward).toBe(0)
  })

  it('fits the scan budget — this is what "complex" costs here', () => {
    // Recorded rather than merely asserted: a member's real screen is 52 nodes
    // and reaches 7 bars back, which is the scale the nightly sweep is sized for.
    expect(ev.measured.maxLookback).toBe(7)
    // ⚠️ 34, NOT 52, SINCE 2026-08-22 — `maxNodes` counts DISTINCT subtrees now.
    // The formula did not shrink; it stopped being billed once per REPEAT of a
    // subexpression the interpreter memoises and computes a single time.
    expect(ev.measured.maxNodes).toBe(34)
  })
})
