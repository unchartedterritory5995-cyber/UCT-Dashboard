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
      expect(got.outputs.filter((o) => o.formula && !o.hidden).length,
        'columns this engine computes').toBe(want.usable)
      // ⛔ "COLUMNS THIS ENGINE COMPUTES" MEANS COLUMNS A MEMBER CAN USE, so a
      // `display = display.none` output does not count. Folding scaffolding in is
      // how three scripts here were recorded as translating while every VISIBLE
      // output refused: 02 offered a hidden `highest(high, 30)[1]`, 06 a hidden
      // `0`, and 10 a hidden `ohlc4`. The count said 1-2; the member had nothing.
      // …and the scaffolding is RECORDED rather than dropped, because a fact this
      // file stops mentioning is one the next reader re-discovers the hard way.
      expect(got.outputs.filter((o) => o.formula && o.hidden).length,
        'hidden scaffolding outputs').toBe(want.hiddenScaffolding || 0)

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
    // ⚠️ A FLOOR ON *NON-VACUITY*, NOT A COVERAGE TARGET, AND THE DISTINCTION HAD
    // TO BE MADE THE FIRST TIME THE PRODUCT IMPROVED. It read `>= 10` — the count
    // that happened to be true when it was written — so translating two more real
    // scripts turned it RED for the right thing happening. A count typed beside
    // the thing it describes is this repo's most repeated defect, and it is worse
    // here than usual: it makes progress look like a regression, which is exactly
    // the pressure that gets a gate deleted rather than fixed. The COVERAGE number
    // is pinned in both directions by `reports what fraction`, below, which is
    // where a narrowing belongs.
    expect(REFUSING.length).toBeGreaterThanOrEqual(2)
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
    //
    // ⚠️ FOUR ENTRIES MOVED WHEN THE VARIABLES FOLD LANDED, AND THE MOVEMENT IS
    // THE POINT OF THIS LIST. `pine:collection` and `pine:function-def` left it:
    // the only collection literals in this corpus are `input(…, options=[…])`,
    // which no column reads, and every function definition it contains is now
    // either inlined or refused for what is actually inside it. `pine:state` and
    // `pine:offset-literal` joined it, and both are more precise than what they
    // replaced — `10-supertrend.pine`'s five refusals used to say "reassigned"
    // and now say "this value comes from the previous bar", which is the truth.
    for (const guard of [
      'pine:declaration-strategy', // 19-strategy-supertrend-atr
      'pine:request', // 04, 12
      'pine:state', // 10 — a trailing stop is a real accumulator
      'pine:reassign', // 20 — a `:=` inside UDT/array code the fold cannot read
      'pine:block', // 06 — a `switch` inside a user function
      // ⚰️ `pine:offset-literal` LEFT THIS LIST 2026-08-11, CLOSED RATHER THAN
      // WEAKENED — the same way `pine:role-order` did below. It fired on 05's
      // `hh[len]`, where `len` is a UDF parameter bound to an input; an input
      // already folded to a literal as a LENGTH and now folds as an OFFSET too,
      // so 05's refusal moved on to `pine:request`. ⛔ THE GUARD IS STILL LIVE
      // and still right for an index that genuinely cannot be reduced — a series
      // index, `1 + 1`, `bar_index` — it is simply no longer reachable from any
      // PUBLISHED script in this corpus, which is what this list tracks.
      // `pine.offset.test.js` holds the snippets that still exercise it.
      'pine:tuple', // 02, 06, 19
      // ⚰️ `pine:role-order` LEFT THIS LIST BECAUSE IT WAS CLOSED, not because it
      // stopped mattering. It fired on `18-normalized-average-true-range` for
      // `ta.atr(length)`, where the translator could see that `atr` exists and
      // takes four arguments and had no way to know WHICH three series to fill.
      // Declaring the permutation in `PINE_CALL_SHAPES` — the same shape `wpr`
      // already had — made 18 translate. The GUARD is still live and still right
      // for the next function whose order nobody has measured; it simply has no
      // published script left in this corpus that trips it.
      // ⚰️ `pine:na` LEFT THIS LIST TOO, and for the same kind of reason
      // `pine:role-order` did — it was CLOSED, not abandoned. The bare `na` VALUE
      // is Pine's "no value", which is this engine's not-computable, so it
      // expands to `0 / 0` rather than being refused: an identity in both lanes,
      // riding a seam `_binary_div` had already pinned. It took `12-ichimoku`
      // from 0 usable columns to 15. The GUARD is still live and still fires for
      // `fixnan`, which carries a value forward across bars with no stated bound.
      'pine:function', // 09 (`cum`)
      'pine:plot-offset', // 03, 12, 14
      'pine:strategy-call', // 19
      'pine:builtin', // 05, 06, 11, 15
      'pine:undefined', // 12
    ]) {
      expect(fired, guard).toContain(guard)
    }
    // ⛔ AND THE COUNT, so a guard that stops firing on the corpus is noticed
    // rather than quietly leaving the list above still true.
    //
    // ⭐ 12 → 11 ON 2026-08-11, AND THIS ASSERTION IS WHAT NOTICED. Folding an
    // input into a bar offset took `pine:offset-literal` off the corpus — 05's
    // `hh[len]` was its only published source, and that script now refuses at
    // `pine:request` instead. The guard is still live and still right for an
    // index that cannot be reduced; it is simply no longer reachable from these
    // 21 scripts. Exactly the movement this number exists to force somebody to
    // acknowledge, rather than a list going quietly stale.
    expect(fired.size).toBe(11)
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
    //
    // ⚠️ 9/14 BEFORE THE VARIABLES FOLD, 10/16 AFTER, 12/20 AFTER THE PINE
    // PARITY SWEEP. The last step is the clearest of the three about WHAT bought
    // it: six manifest entries (`rma`, `wma`, `round`, `sign`, `na`, `nz`), one
    // declared argument order (`ta.atr`), and one built-in expanded to its own
    // definition (`tr`). `13-average-true-range` needed the first and the last;
    // `18-normalized-average-true-range` needed only the middle one.
    // ⭐ 13/42 ONCE THE BARE `na` VALUE EXPANDED. That step moved COLUMNS more
    // than twice as far as it moved SCRIPTS, and the asymmetry is the whole point
    // of counting both: `cond ? x : na` is a per-PLOT idiom, so it was refusing
    // fifteen columns inside one Ichimoku script that the script-level number
    // could never have shown.
    // ⭐⭐ 2026-08-10: `barstate` MOVED NEITHER NUMBER, AND THAT IS THE ENTRY
    // WORTH READING. `barstate.isconfirmed` was the single most frequent refusal
    // in this corpus — 15 columns and one whole script — and resolving it (this
    // engine evaluates closed bars, so it is exactly `true`) bought ZERO columns.
    // Every one of those columns simply refuses one wall further in: script 06's
    // `pine:tuple` went 6 → 10, script 05's `pine:offset-literal` 1 → 3, script
    // 20's four turned into `pine:function`.
    //
    // ⛔ SO A REFUSAL COUNT IS NOT A PROGRESS METRIC, and this is the measurement
    // that proves it. Ranking work by "which guard fires most" would have picked
    // exactly this change, shipped it, and reported a win to an owner who would
    // see no new column anywhere. A column is usable only when EVERY wall in its
    // chain is down, so the thing to count is `usable` — which is why it is
    // pinned here and the guard histogram is not pinned anywhere.
    //
    // 🔴🔴 2026-08-11: 13/42 → 10/38, AND THE THREE THAT LEFT NEVER WORKED.
    // A `display = display.none` output was counted as a column. Three scripts
    // here had NO visible output that translated and were recorded as translating
    // anyway, on scaffolding their own authors had marked as not-for-display:
    // 02 offered a hidden `highest(high, 30)[1]`, 06 a hidden CONSTANT `0`, and
    // 10 a hidden `ohlc4`. A member opening any of the three got a saveable
    // column that was not the indicator named at the top of the file.
    //
    // ⛔ THE NEAR-MISS WAS ALREADY HALF-KNOWN, WHICH IS THE LESSON. `chooseOutput`
    // has carried a comment since 06 landed saying a hidden zero baseline must
    // never be OFFERED FIRST, "a screen that matches nothing, presented as the
    // obvious choice". That guard fixed which column was shown and left the count
    // alone — so the script still reported as translating and the headline number
    // still counted it. Fixing where a value is DISPLAYED without fixing whether
    // it COUNTS leaves the false claim standing in the number everyone reads.
    //
    // ⚠️ A number going DOWN here is why it is pinned in both directions. This is
    // a correction, not a regression: nothing that worked yesterday stopped
    // working, and 10/38 is the first honest reading this file has published.
    expect(translating).toBe(10)
    expect(columns).toBe(38)
  })

  it('⭐ every script that translates is one a member could actually SAVE', () => {
    // ⛔ "IT TRANSLATED" AND "IT WORKS" ARE DIFFERENT CLAIMS. A formula can come
    // out of the translator and still be refused by the budget, the linter or the
    // read-back — and a coverage number that counted translations would be
    // reporting the first of those as if it were the second.
    const saveable = FILES.filter((f) => SNAPSHOT[f].downstream && SNAPSHOT[f].downstream.ok)
    expect(saveable.length).toBe(10)
    for (const f of saveable) {
      expect(SNAPSHOT[f].downstream.repaint, f).toBe('non-repainting')
    }
  })
})
