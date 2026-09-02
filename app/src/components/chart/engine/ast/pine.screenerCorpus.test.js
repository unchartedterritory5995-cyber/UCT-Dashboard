// app/src/components/chart/engine/ast/pine.screenerCorpus.test.js
//
// ─── ⭐⭐ THE CORPUS THAT MEASURES WHAT THIS FEATURE IS FOR ────────────────────
//
// ⚰️⚰️ EVERY NUMBER THIS PROJECT QUOTED CAME FROM THE WRONG EXAM. `43/75` counts
// COMMUNITY CHART INDICATORS — plotting, colours, backgrounds, strategies, MTF
// overlays, runtime arrays. Nobody writes those to screen with. They are a
// REGRESSION NET, and they were being read as a progress bar toward a product
// goal they do not measure: *can a member write their own screener script?*
//
// ⭐ THESE THIRTY ARE THAT QUESTION. Each is a screen somebody would actually
// write — an oversold pullback, a squeeze, a volume surge, a MACD cross — in the
// spelling modern Pine forces (`//@version=6`, the `ta.` namespace, tuple
// destructuring). Written blind and then run, they found FIVE real defects in
// one pass, of which the sharpest was that `ta.tr` refused while the v4 spelling
// `tr` translated: the only spelling v5+ allows was the broken one.
//
// ⛔ THE FLOOR IS A RATCHET AND THE RESIDUAL IS A ROSTER. A count alone would let
// one script quietly break while another was fixed, so every miss is named with
// the guard that refused it and the file is red until the list is acknowledged.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, treeYieldsBool } from './pine.js'
import { parseFormula } from './parse.js'

const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine_screener')
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()

/** Every fixture, translated through the shipped door. */
const RESULTS = FILES.map((f) => {
  const source = fs.readFileSync(path.join(DIR, f), 'utf8')
  let out
  try { out = translatePine(source) } catch (e) { out = { ok: false, refusal: { guard: `THREW:${e.message}` } } }
  return { name: f.replace(/\.pine$/, ''), source, out }
})

/** ⛔ NAMED, NEVER COUNTED — the residual has to say why it is a residual. */
const MISSES = RESULTS.filter((r) => !r.out.ok)
  .map((r) => `${r.name} [${r.out.refusal.guard}]`)

describe('a member can write their own Pine screener', () => {
  it('⭐ the corpus is real — all v6, all screener-shaped', () => {
    // ⚰️ THE FIRST DRAFT SCORED 30/30 AND THAT WAS THE TELL. It held only cases
    // that already passed, because they were written from the same head that had
    // just fixed them — a corpus blind beside what it measures. The four scripts
    // this door still refuses were added deliberately, so the number is
    // 30/34 and the residual is visible rather than absent.
    expect(FILES.length).toBeGreaterThanOrEqual(36)
    for (const r of RESULTS) {
      expect(r.source, `${r.name} is not v6`).toContain('//@version=6')
      // ⛔ A SCREEN NEEDS SOMETHING TO FILTER ON. Without this a fixture could be
      // chrome-only and count as a pass for translating nothing.
      expect(r.source.match(/\b(plot|alertcondition)\s*\(/), `${r.name} has no output`)
        .toBeTruthy()
    }
  })

  it('⭐⭐ 34 translate, and the TWO that do not are named with their reason', () => {
    // ⏳ THE FLOOR MOVES ONE WAY. Raising it is the point of this file; a drop
    // reds here with the roster rather than as a silent number change.
    const passed = RESULTS.length - MISSES.length
    expect(passed, `misses: ${MISSES.join(', ')}`).toBeGreaterThanOrEqual(34)

    // ⛔⛔ A ROSTER, NOT A COUNT — and the two halves are different KINDS of
    // residual, which is the whole reason to name them:
    //
    // ✅ 31-cci-oversold AND 32-money-flow-oversold WERE ON THIS ROSTER AND CAME
    //    OFF IT. They needed a shape-level `sourceMustBe`, since Pine passes a
    //    SOURCE where this table takes high/low/close and a static `build` plan
    //    would have DROPPED that argument silently. See
    //    `pine.sourceAdapters.test.js`.
    //
    //   33-obv-rising          ─┐ WHAT IS LEFT IS A RULING, NOT A GAP. Pine's
    //   34-bars-since-signal   ─┘ `ta.obv` and `ta.barssince` accumulate from the
    //     first bar ever drawn; this table's `obvN` and `barssince` take a window.
    //     An unbounded accumulator would end static decidability — the property
    //     that lets ONE definition sweep every symbol without being evaluated
    //     first. These stay refused on purpose, and a member who needs them is
    //     told the window to give.
    expect(MISSES).toEqual([
      '33-obv-rising [pine:function]',
      '34-bars-since-signal [pine:function]',
    ])
  })

  it('⭐⭐ every translation is a FORMULA THE ENGINE PARSES, not just an `ok`', () => {
    // ⚠️ `ok === true` IS NOT THE CLAIM. A door could report success and hand
    // back a formula the downstream parser refuses, and every count in this file
    // would still look healthy — the shape of "built, tested, green and
    // unreachable" one layer down.
    for (const r of RESULTS.filter((x) => x.out.ok)) {
      const row = r.out.outputs[r.out.selected]
      expect(row, `${r.name} selected no output`).toBeTruthy()
      expect(row.formula, `${r.name} translated to no formula`).toBeTruthy()
      const parsed = parseFormula(row.formula)
      expect(parsed.ok, `${r.name}: ${row.formula}`).toBe(true)
    }
  })

  it('⭐⭐ every one of them REACHES A SCREEN, not just a formula', () => {
    // ⛔⛔ TRANSLATING IS NOT THE PRODUCT CLAIM. A column that yields a NUMBER
    // cannot be screened honestly — `doorScorecard` records the defect it causes:
    // the `yields` gate is "the one that stops a numeric column being screened as
    // `!= 0` and returning the universe". Every fixture here plots `cond ? 1 : 0`,
    // which is what a Pine author actually writes, so this asks the SHIPPED
    // predicate whether that folds back to a boolean.
    //
    // ⭐ `treeYieldsBool` IS THE DOOR'S OWN, the same function `thinkscript.js`
    // imports so both doors ask one question — not a second opinion written here.
    const numeric = []
    for (const r of RESULTS.filter((x) => x.out.ok)) {
      const row = r.out.outputs[r.out.selected]
      let bool = false
      try { bool = !!treeYieldsBool(parseFormula(row.formula).ast) } catch (e) { bool = false }
      if (!bool) numeric.push(`${r.name}: ${row.formula}`)
    }
    expect(numeric, 'these translate but cannot be screened').toEqual([])
  })

  it('⛔ …and the bool check can FAIL — a numeric column is caught', () => {
    // ⚠️ WITHOUT THIS THE CASE ABOVE PASSES IF `treeYieldsBool` EVER RETURNED
    // TRUTHY FOR EVERYTHING. A plain price plot is exactly the column the `yields`
    // gate exists to stop, so it is the honest control.
    const priced = translatePine(`//@version=6
indicator("s")
plot(ta.sma(close, 20))
`)
    expect(priced.ok).toBe(true)
    const row = priced.outputs[priced.selected]
    expect(!!treeYieldsBool(parseFormula(row.formula).ast)).toBe(false)
  })

  it('⛔ the corpus can DISTINGUISH — a broken script really does fail', () => {
    // ⭐ WITHOUT THIS THE WHOLE FILE COULD BE PASSING VACUOUSLY. If `translatePine`
    // returned `ok` for anything, the roster would be empty for the wrong reason.
    const broken = translatePine('//@version=6\nindicator("s")\nplot(ta.frobnicate(close, 9) ? 1 : 0)\n')
    expect(broken.ok).toBe(false)
  })
})
