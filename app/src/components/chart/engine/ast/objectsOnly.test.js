// app/src/components/chart/engine/ast/objectsOnly.test.js
//
// ─── ⭐⭐ NO COLUMN TO SCREEN ON IS NOT THE SAME FACT AS NOTHING TO DRAW ─────
//
// ⚰️⚰️ MEASURED ON A PUBLISHED MULTI-SYMBOL DASHBOARD. `translatePine` returned
// at `resolved.length === 0` with `pine:no-output` — *"the pasted script offers
// no plot and no alert condition to filter on"* — which is TRUE, and which the
// author of a working dashboard reads as "this engine cannot see my script".
//
// The object pass understands that script's table perfectly: a `create` of
// family `table` with resolved props. It had simply never run, because the
// function returned forty lines before it.
//
// ⭐ THE COMMENT TWENTY LINES ABOVE THAT RETURN ALREADY KNEW. It records that
// one real published indicator scraped past this on "the `plot(0)` placeholder
// that table-drawing scripts conventionally carry". A script that declines to
// carry the placeholder is not a different KIND of script — and depending on a
// convention to be visible is not a design.
//
// ⛔ THE SCREENER CONTRACT IS UNCHANGED. `ok` stays FALSE: there genuinely is no
// column to filter on, and saying otherwise would offer a member a scan over
// nothing. What changes is that the DRAWING survives the refusal, and that the
// refusal names which of the two facts it means.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, REFUSALS } from './pine.js'

const REPO = path.resolve(process.cwd(), '..')
const DASHBOARD = fs.readFileSync(
  path.join(REPO, 'corpus/committed/strong-start-rvol-dashboard__36140b1cbe.pine'), 'utf8')

const HEAD = '//@version=6\nindicator("t", overlay = true)\n'

describe('a table-only script keeps its drawing', () => {
  it('⭐⭐ THE DASHBOARD IS REFUSED FOR SCREENING AND STILL CARRIES ITS TABLE', () => {
    const t = translatePine(DASHBOARD, { strict: true })
    // the screener contract, unchanged
    expect(t.ok).toBe(false)
    expect(t.outputs).toEqual([])
    // …and the drawing survives it
    expect(t.refusal.guard).toBe('pine:objects-only')
    expect(t.objects).toBeTruthy()
    const families = new Set((t.objects.ops || []).map((o) => o.family))
    expect(families.has('table')).toBe(true)
  })

  it('⛔ the refusal names WHICH fact it means', () => {
    const t = translatePine(DASHBOARD, { strict: true })
    expect(t.refusal.message).toMatch(/draws objects/)
    expect(t.refusal.message).toMatch(/nothing to filter a scan on/)
    // ⛔ AND IT IS NOT THE OLD SENTENCE. "offers no plot" is what told the author
    // of a working dashboard that their script produced nothing.
    expect(t.refusal.message).not.toBe(REFUSALS['pine:no-output'])
  })

  it('⛔ CONTROL: a script that draws NOTHING still says `pine:no-output`', () => {
    // ⭐⭐ THE DISCRIMINATOR. Without this, "always say objects-only" passes the
    // cases above — and the two facts would be collapsed again, in the other
    // direction (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    const t = translatePine(`${HEAD}x = close * 2\n`, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:no-output')
  })

  it('⭐ the invariant the guard leans on: a program is never EMPTY', () => {
    // ⛔ `draws` tests the op COUNT, and that test is belt-and-braces rather
    // than load-bearing: `buildObjectProgram` answers `null` when a script draws
    // nothing and never returns a program with zero ops. Measured across a
    // plain-arithmetic script, a bare `table` declaration, a deleted label and a
    // comment-only file — every one gives `null`.
    //
    // ⚠ IT IS PINNED RATHER THAN SIMPLIFIED AWAY because if that ever changes,
    // an empty program would start reading as "this script draws", and a member
    // with nothing on screen would be told their script draws objects. This case
    // is what would go red first.
    for (const src of ['x = close * 2', 'var table tb = na', '// nothing at all']) {
      const t2 = translatePine(`${HEAD}${src}
`, { strict: true })
      if (t2.objects) expect((t2.objects.ops || []).length, src).toBeGreaterThan(0)
    }
  })

  it('⛔ CONTROL: a script WITH a plot is untouched by any of this', () => {
    // The change must not reach the ordinary path. A plot still translates, and
    // still reports `ok: true` with its row.
    const t = translatePine(`${HEAD}plot(close)\n`, { strict: true })
    expect(t.ok).toBe(true)
    expect(t.outputs).toHaveLength(1)
  })

  it('⛔ CONTROL: the object pass runs exactly ONCE on the ordinary path', () => {
    // ⚰️ The pass was EXTRACTED so the no-output path could call it. A copy
    // inside that branch would have been a second authority on what a script
    // draws; extracting it means both paths run the same code. This asserts the
    // ordinary path still gets its program — i.e. the extraction did not drop it.
    const t = translatePine(`${HEAD}var table tb = table.new(position.top_right, 1, 1)\nplot(close)\n`,
      { strict: true })
    expect(t.ok).toBe(true)
    expect(t.objects).toBeTruthy()
    expect((t.objects.ops || []).length).toBeGreaterThan(0)
  })
})
