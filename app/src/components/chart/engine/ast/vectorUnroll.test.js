// app/src/components/chart/engine/ast/vectorUnroll.test.js
//
// ─── ⭐⭐ a3 — THE ACCEPTANCE, WRITTEN BEFORE THE FIX ────────────────────────
//
// ⚰️ WHY THIS FILE EXISTS AT ALL, AND WHY IT IS COMMITTED RED.
//
// The first attempt at the unroll reported `ok=true, refusals=0` on Uncharted
// Clouds and looked finished. It was not: all 21 layer plots had folded to
// `0 / 0` — `na` — because the slots were never written. **"Zero refusals" was
// true and worthless.** The acceptance is not the verdict, it is the CONTENT of
// the formulas: a layer plot must resolve to a tree that still mentions the
// moving averages it is interpolating between.
//
// ⛔ So the assertion is written first, committed failing, and the fix commit is
// the thing that turns it green. `it.fails` makes that mechanical: these pass
// while the defect stands and go RED the day the slots are filled, which is when
// the marker is deleted. A test written after the fix would have been shaped by
// whatever the fix happened to produce.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const CLOUDS = fs.readFileSync(path.resolve(
  __dirname, '../../../../../../tests/fixtures/member/uncharted-clouds.pine'), 'utf8')

const LANES = [['strict', { strict: true }], ['lenient', {}]]

/** ⛔ MARKER — delete this and the `run` indirection in the commit that fills the
 *  slots. Until then each case passes BECAUSE it fails, which is visible in the
 *  reporter rather than hidden by a skip. */
const STILL_OPEN = true
const run = STILL_OPEN ? it.fails : it

describe('a3 — Clouds unrolls, and the slots hold real trees', () => {
  for (const [lane, opts] of LANES) {
    run(`⭐ ${lane}: the block note at 59 is GONE — the loop was read, not skipped`, () => {
      const t = translatePine(CLOUDS, opts)
      const blocks = (t.notes || []).filter((n) => n.code === 'pine:block')
      expect(blocks.map((n) => n.line)).not.toContain(59)
    })

    run(`⭐ ${lane}: no array read refuses any more`, () => {
      const t = translatePine(CLOUDS, opts)
      const coll = (t.refusals || []).filter((r) => r.guard === 'pine:collection')
      expect(coll.length).toBe(0)
    })

    run(`⛔⛔ ${lane}: all 21 layer plots carry a REAL tree, not \`na\``, () => {
      const t = translatePine(CLOUDS, opts)
      const formulas = (t.outputs || []).map((o) => String(o.formula || ''))
      const na = formulas.filter((f) => f.includes('0 / 0'))
      expect(na.length, `${na.length} plots folded to na`).toBe(0)

      // ⭐ THE REAL TERM, NOT A PROXY. `layerValue = fastMA + (slowMA - fastMA) *
      // ratio`, and both MAs are `ta.ema`/`ta.sma` of a source — so an unrolled
      // slot must still mention the smoother. Asserting "not na" alone would pass
      // on a slot that folded to a constant.
      const withMa = formulas.filter((f) => /ema|sma/i.test(f))
      expect(withMa.length, 'two MA plots plus twenty-one layers').toBe(23)
    })

    run(`⛔ ${lane}: the 21 layers are DISTINCT — each is its own interpolation`, () => {
      // Every layer sits at a different ratio, so 21 identical trees would mean
      // the loop ran once and the substitution never varied.
      const t = translatePine(CLOUDS, opts)
      const layers = (t.outputs || []).map((o) => String(o.formula || '')).slice(2)
      expect(new Set(layers).size, 'each layer interpolates differently').toBe(21)
    })
  }

  it('⛔⛔ CONTROL — a block the walk CANNOT read still refuses on read', () => {
    // The pre-a3 shape, kept permanently. Unrolling must not become a licence to
    // fold a loop this engine does not understand: a `while` is never unrolled,
    // so the array it fills stays unknown and the read refuses.
    const src = '//@version=6\nindicator("t", overlay=true)\nplot(close, "real")\n'
      + 'var a = array.new<float>(4)\n'
      + 'i = 0\n'
      + 'while i < 4\n'
      + '    array.set(a, i, close)\n'
      + '    i := i + 1\n'
      + 'plot(array.get(a, 0))\n'
    const t = translatePine(src, { strict: true })
    const about = (t.refusals || []).filter((r) => r.guard !== 'pine:constant-only')
    expect(about.length, 'a while-filled array is unknown, not empty').toBeGreaterThan(0)
  })
})
