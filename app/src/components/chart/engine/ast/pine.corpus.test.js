// 🔴 THE CORPUS GATE — 21 REAL PUBLISHED PINE SCRIPTS, END TO END.
//
// ⛔ HAND-WRITTEN TOY INPUTS PROVE NOTHING, and this file is the reason. Every
// input under `tests/fixtures/pine/` was fetched verbatim from a public
// repository (see `SOURCES.md` beside them) and is byte-for-byte as published:
// license headers, forty `input.symbol` rows, Turkish comments, a 783-line
// scanner and all. Six defects in `pine.js` were found by running them and by
// nothing else — the wrong token on six `close[1]` refusals, a `plot()` bound to
// a name offering no column at all, a variable shadowing a function of the same
// name, `security()` reported as an unknown function instead of a foreign
// timeframe, an eight-times-displaced `plot(offset=…)` translated as if it were
// not displaced, and a `ta.stoch` argument permutation that was WRONG BY 126
// POINTS while every static gate stayed green.
//
// ⭐ THE SNAPSHOT IS THE COVERAGE MAP, MECHANISED. `__fixtures__/pineCorpus.json`
// records, per script, whether it translates, how many columns it offers, how
// many this engine can compute, and — where it refuses — the guard, the line and
// the column. A change that widens coverage moves it; so does one that narrows
// it; and the diff is the thing a reviewer reads. ⛔ It is NOT a `toMatchSnapshot`
// that rewrites itself on `-u`: it is a committed fixture compared with an
// explicit assertion, because an auto-updating snapshot records what happened
// rather than what was decided.
//
// ⚠️ THIS FILE MOVES WHEN `closedTable.json` MOVES, AND THAT IS CORRECT. The
// indicator agent is adding functions to the manifest as this ships; a script
// that refuses today at `pine:function` translates the moment its function lands,
// with no change here or in `pine.js`. When that happens the snapshot is stale
// and this goes red NAMING THE SCRIPT — which is the notification, not a flake.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, REFUSALS } from './pine.js'
import { parseFormula, astHash, TABLE } from './parse.js'
import { sentenceFor } from './sentence.js'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'
import SNAPSHOT from './__fixtures__/pineCorpus.json'

const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine')

/** ⛔ NO `existsSync` GUARD AND NO `it.skip`. A corpus gate that passes with no
 *  corpus is `lesson_gate_that_cannot_fail`; if the fixtures are gone this must
 *  fail loudly and the README says how to put them back. */
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

describe('the corpus is real and it is all there', () => {
  it('every fixture is present and every fixture is in the snapshot', () => {
    expect(FILES.length).toBe(21)
    expect(Object.keys(SNAPSHOT).sort()).toEqual(FILES)
  })

  it('every fixture is genuine Pine, not something this repo wrote', () => {
    for (const f of FILES) {
      const src = read(f)
      expect(src.length, f).toBeGreaterThan(300)
      // A published script names its author or its licence or declares itself.
      expect(/©|Copyright|License|licence|@version|study\(|indicator\(|strategy\(/.test(src), f).toBe(true)
    }
  })
})

describe('every script lands exactly where the snapshot says', () => {
  for (const f of FILES) {
    const want = SNAPSHOT[f]
    it(`${f} — ${want.translates ? `${want.usable} column(s)` : want.refusal.guard}`, () => {
      const got = translatePine(read(f))
      expect(got.version, 'version').toBe(want.version)
      expect(got.ok, 'translates').toBe(want.translates)
      expect(got.outputs.length, 'outputs offered').toBe(want.outputs)
      expect(got.outputs.filter((o) => o.formula).length, 'columns this engine computes')
        .toBe(want.usable)

      const perOutput = {}
      for (const o of got.outputs) {
        if (o.refusal) perOutput[o.refusal.guard] = (perOutput[o.refusal.guard] || 0) + 1
      }
      expect(perOutput, 'per-output refusals').toEqual(want.perOutputRefusals)

      if (want.refusal) {
        // ⭐ THE GUARD, THE LINE AND THE COLUMN. "It refused" is satisfiable by a
        // translator that refuses everything at line 1.
        expect(got.refusal.guard).toBe(want.refusal.guard)
        expect(got.refusal.line).toBe(want.refusal.line)
        expect(got.refusal.column).toBe(want.refusal.column)
        expect(got.refusal.token).toBe(want.refusal.token)
      } else {
        expect(got.refusal).toBe(null)
      }

      const sel = got.selected >= 0 ? got.outputs[got.selected] : null
      expect(sel ? sel.formula : null, 'the column offered first').toBe(want.selectedFormula)
    })
  }
})

describe('a script that translates goes all the way through the SHIPPED doors', () => {
  const TRANSLATING = FILES.filter((f) => SNAPSHOT[f].translates)

  it('there is more than one of them, or this whole block is decorative', () => {
    expect(TRANSLATING.length).toBeGreaterThanOrEqual(5)
  })

  for (const f of TRANSLATING) {
    it(`${f} parses, budgets, lints, reads back and may be saved`, () => {
      const out = translatePine(read(f))
      const row = out.outputs[out.selected]

      // 1. the ONE parser makes the tree — this module never persists its own
      const parsed = parseFormula(row.formula)
      expect(parsed.ok, row.formula).toBe(true)

      // 2. …and it is the same tree, so `compute.fn` is what a typed formula's
      //    would have been
      expect(astHash(parsed.ast)).toBe(astHash(row.ast))

      // 3. the budget, the linter and the read-back, through the door the text
      //    box itself calls
      const down = evaluateFormula(row.formula, BUILDER_INPUT_SCOPE)
      expect(down.ok, `${f}: ${down.guard} ${down.error}`).toBe(true)
      expect(down.readback).toBe(sentenceFor(parsed.ast, BUILDER_INPUT_SCOPE))
      expect(down.verdict.mode).toBe(SNAPSHOT[f].downstream.repaint)

      // 4. the save gate — the real one, not a copy of its rules
      expect(canSaveFormula(down, false)).toBe(true)
    })
  }
})

describe('a script that refuses refuses for a DECLARED reason', () => {
  const REFUSING = FILES.filter((f) => !SNAPSHOT[f].translates)

  it('there is more than one of them', () => {
    expect(REFUSING.length).toBeGreaterThanOrEqual(10)
  })

  it('every guard fired is one this module declares, and the excerpt shows the line', () => {
    for (const f of REFUSING) {
      const out = translatePine(read(f))
      const r = out.refusal
      expect(Object.keys(REFUSALS), `${f} → ${r.guard}`).toContain(r.guard)
      if (r.line != null) {
        const line = read(f).replace(/\r\n?/g, '\n').split('\n')[r.line - 1]
        expect(r.excerpt, f).toBe(`${line}\n${' '.repeat(r.column - 1)}^`)
        // The caret really is under the token the refusal names.
        expect(line.slice(r.column - 1, r.column - 1 + r.token.length), f).toBe(r.token)
      }
    }
  })

  it('the refusal corpus covers the constructs the brief names, from REAL scripts', () => {
    // ⚠️ EVERY FILE, NOT ONLY THE ONES THAT REFUSE WHOLE. A script can translate
    // and still refuse eight of its ten plots by name, and those refusals are the
    // ones a member reads most — scoping this to whole-script failures would have
    // dropped `pine:tuple` and `pine:plot-offset` off the coverage claim while
    // both fire on real published scripts.
    const fired = new Set()
    for (const f of FILES) {
      for (const r of translatePine(read(f)).refusals) fired.add(r.guard)
    }
    // Each of these is present because a published script does it — not because
    // somebody wrote a snippet that does it.
    for (const guard of [
      'pine:declaration-strategy', // 19-strategy-supertrend-atr
      'pine:request', // 04, 12
      'pine:collection', // 09, 15
      'pine:reassign', // 07, 20
      'pine:block', // 13
      'pine:function-def', // 05
      'pine:tuple', // 06
      'pine:role-order', // 18
      'pine:function', // 14
      'pine:na', // 21
      'pine:plot-offset', // 03, 12, 14
      'pine:strategy-call', // 19
      'pine:builtin', // 05, 06, 11
      'pine:undefined', // 12
    ]) {
      expect(fired, guard).toContain(guard)
    }
    // ⛔ AND THE COUNT, so a guard that stops firing on the corpus is noticed
    // rather than quietly leaving the list above still true.
    expect(fired.size).toBe(14)
  })

  it('⛔ and NOTHING in the corpus is blocked on the bar offset any more', () => {
    // ⭐ THIS CASE USED TO BE THE OTHER WAY ROUND. Before the engine's fifth node
    // type landed, `pine:history-ref` was the single most common refusal in the
    // corpus and two scripts were waiting on nothing else. Asserting its ABSENCE
    // is what stops the coverage map from still listing a limitation that was
    // fixed — the failure mode this repo's own doc-audit keeps finding.
    for (const f of FILES) {
      for (const r of translatePine(read(f)).refusals) {
        expect(r.guard, `${f} still refuses at the bar offset`).not.toBe('pine:history-ref')
      }
    }
  })
})

describe('the whole corpus, in one number', () => {
  it('reports what fraction of real scripts this engine can run', () => {
    const translating = FILES.filter((f) => SNAPSHOT[f].translates).length
    const columns = FILES.reduce((n, f) => n + SNAPSHOT[f].usable, 0)
    // ⛔ NOT A THRESHOLD THAT ONLY GOES UP. It is pinned in BOTH directions, so a
    // change that quietly narrows coverage is as red as one that breaks a script.
    expect(translating).toBe(9)
    expect(columns).toBe(14)
  })

  it('⭐ every script that translates is one a member could actually SAVE', () => {
    // ⛔ "IT TRANSLATED" AND "IT WORKS" ARE DIFFERENT CLAIMS. A formula can come
    // out of the translator and still be refused by the budget, the linter or the
    // read-back — and a coverage number that counted translations would be
    // reporting the first of those as if it were the second.
    const saveable = FILES.filter((f) => SNAPSHOT[f].downstream && SNAPSHOT[f].downstream.ok)
    expect(saveable.length).toBe(9)
    for (const f of saveable) {
      expect(SNAPSHOT[f].downstream.repaint, f).toBe('non-repainting')
    }
  })
})
