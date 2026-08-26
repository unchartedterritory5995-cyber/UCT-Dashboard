// 🔴 THE CORPUS GATE — 24 REAL PUBLISHED thinkScript STUDIES, END TO END.
//
// ⛔ HAND-WRITTEN TOY INPUTS PROVE NOTHING. Every input under
// `tests/fixtures/thinkscript/` was copied verbatim from a public forum post or
// repository (see `SOURCES.md` beside them) and is byte-for-byte as published —
// header lines, capitalised keywords, a typo'd `ArrowUP`, and the en-dashes one
// author pasted into an expression as minus signs.
//
// ⭐ THE SNAPSHOT IS THE COVERAGE MAP. `__fixtures__/thinkscriptCorpus.json`
// records, per script, whether it translates, how many columns it offers, how
// many this engine computes, which lines were listed as ignored, what was folded
// — and, where it refuses, the guard, the line, the column and the token. It is
// NOT a `toMatchSnapshot` that rewrites itself: it is a committed fixture
// compared with explicit assertions, regenerated only by the deliberate
// `TS_CORPUS_WRITE=1` run and reviewed in the diff.
//
// ⭐⭐ AND IT STARTS AT ZERO ON PURPOSE. `thinkscript.js` translates NOTHING
// today; all 24 refuse `thinkscript:unsupported` at their first token. That is
// not a placeholder — it is the MEASURED starting line, pinned in both
// directions, so every later task's gain is a fact rather than a claim. The
// spec's ≥70% for this lane was amended to the measured Wave-1 ceiling of 15/24
// (19/24 once `tf`/`sym` land) because 70% was proven unreachable; nine of these
// scripts refuse by Wave-1 DESIGN and are named in the lane brief.
//
// ⚠️ THIS FILE MOVES WHEN `closedTable.json` MOVES, AND THAT IS CORRECT. When it
// goes red naming a script, that is the notification, not a flake.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translateThinkScript, REFUSALS } from './thinkscript.js'
import { parseFormula, astHash } from './parse.js'
import { sentenceFor } from './sentence.js'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'
import SNAPSHOT from './__fixtures__/thinkscriptCorpus.json'

const DIR = path.resolve(process.cwd(), '../tests/fixtures/thinkscript')

/** ⛔ NO `existsSync` GUARD AND NO `it.skip`. A corpus gate that passes with no
 *  corpus is `lesson_gate_that_cannot_fail`. */
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.ts')).sort()
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

/** The snapshot carries per-script entries plus `_`-prefixed roll-ups. Splitting
 *  them is DERIVED from the prefix rather than from a typed list of meta keys —
 *  the roll-up set is asserted by name in the generator, which is where it is
 *  decided. */
const SNAP_FILES = Object.keys(SNAPSHOT).filter((k) => !k.startsWith('_')).sort()

/** One script's snapshot entry, safe to read a property off even when there is
 *  no entry.
 *
 *  ⛔ IT EXISTS SO A MISSING ENTRY IS REPORTED BY NAME RATHER THAN AS A STACK
 *  TRACE, and the distinction is not cosmetic. Three of the dereferences below
 *  run while vitest is COLLECTING — inside `describe` bodies, before any `it`
 *  exists — so `entry(f).translates` on a script that is on disk and absent
 *  from the map reds the entire FILE with
 *  `TypeError: Cannot read properties of undefined`, and every named assertion
 *  in it, including the two that would have said which script, never runs. The
 *  gate fired either way; it just could not say what was wrong, in the one file
 *  whose whole argument is that a rail must report NAMES rather than counts.
 *  ⚠️ IT DOES NOT SOFTEN ANYTHING: a missing entry simply reads as "not
 *  translating", and `every fixture is in the snapshot` plus the per-script
 *  `it` below both still fail, now naming the file. Found in W3.2 review. */
const entry = (f) => SNAPSHOT[f] || {}

describe('the corpus is real and it is all there', () => {
  it('every fixture is present and every fixture is in the snapshot', () => {
    // ⭐ A FLOOR ON THE CENSUS, AN EQUALITY ON THE MAP — and the difference is
    // the point. The DIRECTORY is another lane's artifact and grows; an exact
    // count there reds this whole file the moment a correctly-recorded script is
    // added, which trains the next reader to edit a number instead of reading a
    // failure. What must be exact is that the snapshot covers EXACTLY the files
    // on disk — that equality names the new script instead of counting it, and
    // it is what actually keeps the map honest.
    expect(FILES.length, 'a corpus gate with no corpus is not a gate').toBeGreaterThanOrEqual(24)
    expect(SNAP_FILES).toEqual(FILES)
  })

  it('every fixture is genuine thinkScript, not something this repo wrote', () => {
    for (const f of FILES) {
      const src = read(f)
      expect(src.length, f).toBeGreaterThan(40)
      // ⚠️ CASE-INSENSITIVE ON PURPOSE. thinkorswim matches identifiers and
      // keywords case-insensitively and the corpus proves it: `13` writes `Def`
      // and `Plot`, `06` writes `compoundValue` and `addlabel`. A case-sensitive
      // marker list here would be a second, wronger grammar beside the one the
      // translator is being built to.
      expect(/(?:^|\n)[ \t]*(?:declare|def|plot|input|rec)\b|crosses[ \t]+(?:above|below)/i.test(src), f).toBe(true)
    }
  })
})

describe('every script lands exactly where the snapshot says', () => {
  for (const f of FILES) {
    const want = SNAPSHOT[f]
    // ⛔ THE TITLE IS BUILT AT COLLECTION TIME, SO IT MUST SURVIVE A MISSING
    // ENTRY. Dereferencing `want.translates` here for a script that is on disk
    // and absent from the snapshot reds the whole FILE with a
    // `TypeError: Cannot read properties of undefined` before a single `it`
    // runs — a stack trace, in the one file whose entire argument is that a
    // rail must report NAMES rather than counts. The gate still fires either
    // way; this is about what it says when it does. Found in W3.2 review.
    const label = !want ? 'MISSING FROM THE SNAPSHOT'
      : want.translates ? `${want.usable} column(s)` : want.refusal.guard
    it(`${f} — ${label}`, () => {
      expect(want, `${f} is on disk and has no snapshot entry — regenerate with `
        + 'TS_CORPUS_WRITE=1 and read the diff').toBeTruthy()
      const got = translateThinkScript(read(f))
      expect(got.version, 'version').toBe('thinkscript')
      expect(got.ok, 'translates').toBe(want.translates)
      expect(got.outputs.length, 'outputs offered').toBe(want.outputs)
      expect(got.outputs.filter((o) => o.formula && !o.hidden).length,
        'columns this engine computes').toBe(want.usable)

      const perOutput = {}
      for (const o of got.outputs) {
        if (o.refusal) perOutput[o.refusal.guard] = (perOutput[o.refusal.guard] || 0) + 1
      }
      expect(perOutput, 'per-output refusals').toEqual(want.perOutputRefusals)

      // ⛔ THE IGNORED LINES ARE PINNED BY NUMBER, NEVER BY COUNT. "we ignored 6
      // lines" is satisfied by ignoring the wrong six.
      expect(got.ignored.map((n) => n.line), 'ignored line numbers').toEqual(want.ignoredLines)
      expect(got.folded.map((x) => `${x.name}=${x.folded}`), 'folded').toEqual(want.folded)

      if (want.refusal) {
        // ⭐ THE GUARD, THE LINE, THE COLUMN AND THE TOKEN. "It refused" is
        // satisfiable by a translator that refuses everything at line 1 — which
        // is very nearly what this one does today, so the token is what makes
        // the record worth anything.
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
  const TRANSLATING = FILES.filter((f) => entry(f).translates)
  const THROUGH = TRANSLATING.filter((f) => entry(f).downstream && entry(f).downstream.ok)

  // ⏳ BOTH SETS ARE EMPTY TODAY AND THIS BLOCK THEREFORE RUNS ONE VACUOUS TEST.
  // That is stated rather than hidden: the machinery is written now so the task
  // that translates the first script inherits a finished gate instead of writing
  // one under time pressure, and the vacuity itself is pinned — `the whole
  // corpus, in one number` asserts 0 in BOTH directions, so this block cannot
  // stay empty by accident. ⛔ Do not "simplify" it away while it is empty.

  it('⭐ the ones that translate but CANNOT be saved are NAMED, with the wall they hit', () => {
    const blocked = TRANSLATING.filter((f) => !entry(f).downstream || !entry(f).downstream.ok)
    for (const f of blocked) {
      const out = translateThinkScript(read(f))
      const down = evaluateFormula(out.outputs[out.selected].formula, BUILDER_INPUT_SCOPE)
      expect(down.ok, f).toBe(false)
      expect(down.guard, f).toBe(entry(f).downstream.guard)
      expect(canSaveFormula(down, false), f).toBe(false)
    }
    expect(blocked).toEqual(SNAPSHOT._blocked)
  })

  for (const f of THROUGH) {
    it(`${f} parses, budgets, lints, reads back and may be saved`, () => {
      const out = translateThinkScript(read(f))
      const row = out.outputs[out.selected]
      const parsed = parseFormula(row.formula)
      expect(parsed.ok, row.formula).toBe(true)
      expect(astHash(parsed.ast)).toBe(astHash(row.ast))
      const down = evaluateFormula(row.formula, BUILDER_INPUT_SCOPE)
      expect(down.ok, `${f}: ${down.guard} ${down.error}`).toBe(true)
      expect(down.readback).toBe(sentenceFor(parsed.ast, BUILDER_INPUT_SCOPE))
      expect(down.verdict.mode).toBe(entry(f).downstream.repaint)
      expect(canSaveFormula(down, false)).toBe(true)
    })
  }
})

describe('a script that refuses refuses for a DECLARED reason', () => {
  const REFUSING = FILES.filter((f) => !entry(f).translates)

  it('there is more than one of them, or the sweep below measures nothing', () => {
    // ⚠️ A FLOOR ON NON-VACUITY, NOT A COVERAGE TARGET. The coverage number is
    // pinned in both directions below, which is where a narrowing belongs.
    expect(REFUSING.length).toBeGreaterThanOrEqual(2)
  })

  it('every guard fired is one this module declares, and the caret is under the token', () => {
    for (const f of REFUSING) {
      const r = translateThinkScript(read(f)).refusal
      expect(Object.keys(REFUSALS), `${f} → ${r.guard}`).toContain(r.guard)
      if (r.line != null) {
        const line = read(f).replace(/\r\n?/g, '\n').split('\n')[r.line - 1]
        expect(r.excerpt, f).toBe(`${line}\n${' '.repeat(r.column - 1)}^`)
        expect(line.slice(r.column - 1, r.column - 1 + r.token.length), f).toBe(r.token)
      }
    }
  })

  it('the refusal corpus covers the constructs the spec DEFERS, from REAL scripts', () => {
    // ⚠️ EVERY FILE, NOT ONLY THE ONES THAT REFUSE WHOLE. A script can translate
    // and still refuse eight of its ten plots by name, and those refusals are
    // the ones a member reads most.
    const fired = new Set()
    for (const f of FILES) for (const r of translateThinkScript(read(f)).refusals) fired.add(r.guard)
    for (const guard of SNAPSHOT._guardsFired) expect(fired, guard).toContain(guard)
    // ⛔ AND THE OTHER DIRECTION, so a guard that starts firing on the corpus is
    // acknowledged rather than quietly joining the record.
    expect([...fired].sort()).toEqual([...SNAPSHOT._guardsFired].sort())
  })
})

describe('the whole corpus, in one number', () => {
  it('reports what fraction of real thinkScript this engine can run', () => {
    const translating = FILES.filter((f) => entry(f).translates).length
    const columns = FILES.reduce((n, f) => n + entry(f).usable, 0)

    // ⛔⛔ THESE THREE LITERALS ARE THE WALL, AND THEY ARE LITERALS ON PURPOSE.
    // Comparing the roll-up to the per-file entries would only catch a
    // hand-edited fixture: regenerating moves BOTH, so a change that quietly
    // narrowed coverage would sail through green. A number typed HERE cannot be
    // regenerated past — moving it is an edit to a test file that a reviewer
    // reads in the diff, which is the whole point.
    //
    // ⚠️ This is the one place this lane types a count rather than deriving it,
    // and the distinction is deliberate: the DIRECTORY census above is a floor
    // because it is another lane's artifact and grows correctly, while COVERAGE
    // is this lane's own measured product property and must not move silently in
    // either direction.
    //
    // ⭐ 0/24 translating, 11 columns, 0 saveable — W3.3, MEASURED.
    // ⏳ Still 0 translating, and that is the predicted number, not a
    // disappointment: every one of these 24 needs at least one thinkorswim
    // FUNCTION, and this task maps none of them. What moved is the wall — see
    // `the walls have moved` below — and the eleven columns are the plots inside
    // otherwise-blocked studies that this reader can already compute end to end.
    expect(translating, 'scripts that translate').toBe(0)
    expect(columns, 'columns this engine computes').toBe(11)

    // …and the fixture's own roll-ups agree with its per-file entries, which is
    // the different failure: a hand-edited snapshot.
    expect(SNAPSHOT._translating, 'fixture roll-up disagrees with its own entries').toBe(translating)
    expect(SNAPSHOT._columns, 'fixture roll-up disagrees with its own entries').toBe(columns)
  })

  it('⭐⭐ the walls have MOVED OFF LINE 1 — a translator that refuses everything at the top has measured nothing', () => {
    // ⛔ COMPUTED BY RUNNING THE TRANSLATOR, NOT READ OFF THE SNAPSHOT. The lane
    // brief specified `FILES.filter(f => SNAPSHOT[f].refusal.line === 1 …)`
    // compared against `SNAPSHOT._atLineOne`, and BOTH SIDES OF THAT COMPARISON
    // REGENERATE TOGETHER — it is satisfied by any translator at all, including
    // the W3.2 skeleton that refused all 24 at line 1. The literals below cannot
    // be regenerated past, which is the whole point of typing them here.
    const at = (f) => translateThinkScript(read(f)).refusal || {}
    const atLineOne = FILES.filter((f) => at(f).line === 1 && at(f).column === 1)
    expect(atLineOne, 'W3.2 had all 24 here').toEqual([])

    // ⚠️ A FLOOR, NOT THE MEASURED NUMBER. W3.3 measured NINETEEN of the 24
    // refusing at a thinkorswim FUNCTION NAME; the floor is the brief's 8 so
    // that W3.4 and W3.5, whose whole job is to MAP those functions and move
    // files off this guard, are not reddened for succeeding. The exact set is
    // held still by the per-file assertions above, where a change names the
    // script it happened to.
    const atAFunction = FILES.filter((f) => at(f).guard === 'thinkscript:function')
    expect(atAFunction.length).toBeGreaterThanOrEqual(8)

    // …and the fixture's own roll-up agrees with the run, which is the DIFFERENT
    // failure: a hand-edited snapshot.
    expect(SNAPSHOT._atLineOne, 'fixture roll-up disagrees with a live run').toEqual(atLineOne)
  })

  it('⭐⭐ …and NOT ONE of them refuses `thinkscript:syntax` — every file here is real, running thinkScript', () => {
    // ⛔⛔ THE DURABLE HALF, AND THE ONE THIS LANE EXISTS FOR. Every fixture in
    // this directory was published and runs on thinkorswim, so a `:syntax`
    // refusal is never a fact about the member's script — it is this reader
    // mis-parsing valid code and then blaming the member for it, at a position
    // they cannot act on. It found two while W3.3 was being built: `bar` read as
    // a reserved word when `23` binds it as a variable, and a `fold` loop
    // reported as an unfinished statement instead of as a fold. NAMES, not a
    // count, so the next one says which script.
    //
    // ⚠️⚠️ AND ITS SCOPE IS THE 24 FILES, NOT THE LANGUAGE — read this before
    // treating it as a general guarantee. It is CORPUS-SCOPED BY CONSTRUCTION
    // and structurally cannot see a construct no fixture happens to use: W3.3
    // review found `between`, `reference` and `script` all refusing `:syntax`
    // with this rail green, because not one of the 24 writes them. The
    // class-level rail is `⭐⭐ DOCUMENTED thinkScript never refuses :syntax` in
    // `thinkscript.test.js`, which is hand-written and is where a newly-read
    // construct gets its row. The two are complementary and NEITHER replaces the
    // other: this one covers real scripts nobody hand-picked, that one covers
    // constructs no real script here happens to contain.
    const bad = FILES.filter((f) => {
      const r = translateThinkScript(read(f)).refusal
      return !!r && r.guard === 'thinkscript:syntax'
    })
    expect(bad, 'published thinkScript refused for a syntax this reader got wrong').toEqual([])
  })

  it('⭐ every script that translates is one a member could actually SAVE', () => {
    // ⛔ "IT TRANSLATED" AND "IT WORKS" ARE DIFFERENT CLAIMS. A formula can come
    // out of the translator and still be refused by the budget, the linter or
    // the read-back.
    const saveable = FILES.filter((f) => entry(f).downstream && entry(f).downstream.ok)
    expect(saveable.length).toBe(0)
    expect(SNAPSHOT._saveable).toBe(saveable.length)
  })
})
