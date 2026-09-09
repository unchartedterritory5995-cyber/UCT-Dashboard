// @vitest-environment node
/* The slop predicate is TESTED; this proves the overlay actually USES it.
 *
 * ⛔ WHY A SEPARATE RAIL. `coarsePointer.test.jsx` pins the arithmetic, and the
 * arithmetic could be perfect while `ChartDrawingOverlay` never calls it — the
 * "computed but never applied" failure this repo keeps rediscovering (the inert
 * `log_space` parameter, the scale row that ticked and wrote a value nothing
 * read). A unit test of a helper cannot see a severed wire.
 *
 * It is a SOURCE read, deliberately: mounting the overlay needs a chart, a
 * canvas and a lightweight-charts double, and none of that would make the
 * assertion stronger than "the gate stands between the grab and the mutation".
 * It throws BY NAME when a marker moves rather than matching nothing.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, 'ChartDrawingOverlay.jsx'), 'utf8')

describe('the drag gate is wired, not merely written', () => {
  it('⛔ the overlay imports the shared predicate — never its own copy', () => {
    expect(SRC, 'ChartDrawingOverlay no longer imports crossedDragSlop from coarsePointer')
      .toMatch(/import\s*\{[^}]*crossedDragSlop[^}]*\}\s*from\s*'\.\/coarsePointer'/)
    // A second, local threshold would be a second authority over one value.
    expect(SRC, 'a hard-coded slop literal has appeared beside the shared one')
      .not.toMatch(/slop\s*[=:]\s*\d+/i)
  })

  it('⛔ it is read as a FUNCTION, never frozen at module load', () => {
    // The mistake this whole module exists to prevent: `const X = coarse ? 15 : 8`
    // evaluated once at import, so a rotated or re-pointered session keeps the
    // wrong answer for the life of the page.
    expect(SRC).toMatch(/const CROSSED_SLOP = \(startPixel, pos\) => crossedDragSlop\(startPixel, pos\)/)
  })

  it('⛔⛔ the gate stands BETWEEN the grab and the mutation, and returns early', () => {
    const i = SRC.indexOf('if (dragRef.current && coords) {')
    expect(i, 'the drag branch has moved — this rail is reading the wrong code').toBeGreaterThan(-1)
    const branch = SRC.slice(i, i + 3200)
    const gate = branch.indexOf('CROSSED_SLOP')
    const arm = branch.indexOf('drag.armed = true')
    const mutate = branch.indexOf('timeDelta')       // the first geometry the drag computes
    expect(gate, 'no slop gate inside the drag branch').toBeGreaterThan(-1)
    expect(arm, 'the gate never arms, so a drag could never start').toBeGreaterThan(-1)
    expect(mutate, 'the geometry computation has moved out of this branch').toBeGreaterThan(-1)
    // Order is the assertion: gate → arm → geometry.
    expect(gate).toBeLessThan(arm)
    expect(arm, 'geometry is computed BEFORE the gate — the slop would be decorative')
      .toBeLessThan(mutate)
    expect(branch.slice(gate, arm), 'the gate does not return early, so it gates nothing')
      .toMatch(/return/)
  })

  it('⛔ once armed it STAYS armed — a mid-drag re-check would stutter the object', () => {
    expect(SRC).toMatch(/if \(!drag\.armed\)/)
  })

  it('NON-VACUITY · the same read still finds unrelated, long-standing overlay code', () => {
    // If the file read were empty or wrong, every assertion above would also fail
    // — this proves the reads are landing on the real component.
    expect(SRC).toContain('hitTestHandle')
    expect(SRC).toContain('activePointersRef')
  })
})
