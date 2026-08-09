// ─── THE CONCEPT VOCABULARY, CHECKED BY THE SHIPPED PARSER ──────────────────
//
// ⛔ AN EXAMPLE FORMULA IS A CLAIM ABOUT THE TABLE AND MUST BE PARSED, NOT READ.
// Three worked examples in this phase's own design did not parse: `rsi()` is not
// a table function, and `and`/`or` are not operators — the second mistake landed
// inside the correction for the first, written by the author who had just
// measured the function list and did not re-measure the operator list. This file
// is the rule that ends that: every concept's `source` goes through
// `parseFormula` — the SAME function the text box calls — and the `ast` frozen
// beside it must be what came back.
//
// ⭐ WHY THE TREE IS FROZEN IN THE FILE AT ALL. Python has no parser and must
// never grow one (D-A1), so the Python lane walks the tree it did not build.
// Freezing the parse result here is what lets it: `conceptVocabulary.json`
// carries the proof of legality with the claim, and this file is what keeps the
// proof honest.
//
// ⚠️ THE FOUR CHECKS BELOW ALL RUN THROUGH ONE `problemsIn(vocab)`, so the
// PLANTED vocabularies at the bottom exercise exactly the code the real one
// does. A control that walks a different path proves nothing about the rail.

import { describe, expect, it } from 'vitest'
import { TABLE, parseFormula } from './parse.js'
import { SENTENCE_RULES, sentenceFor } from './sentence.js'
import VOCAB from './conceptVocabulary.json'

const hasOwn = (obj, name) => Object.prototype.hasOwnProperty.call(obj, name)

/** The inputs a CONCEPT expansion is read back with — none, and that is
 *  structural rather than incidental: a concept is an abbreviation for a tree
 *  the closed table can already express, so it declares no definition and has no
 *  inputs to declare. This is the very object handed to `sentenceFor`, so a test
 *  that asserts a name is absent from it is asserting about the third vocabulary
 *  the read-back actually consults rather than about a same-shaped stand-in. */
const NO_INPUTS = Object.freeze({})

/** Every name the manifest declares, DERIVED from its sections.
 *
 *  ⛔ NEVER A HAND-LIST. The whole value of a closed table is that a name it
 *  loses is a name every consumer loses; a list typed here would keep passing
 *  after the table dropped something and the concept would refuse at a member's
 *  save door instead. Underscore-prefixed keys are the manifest's own note
 *  convention and `tableVersion` is a scalar value, so a section is exactly
 *  "an object that maps names to specs". */
function declaredNames(table = TABLE) {
  const out = new Set()
  for (const [key, section] of Object.entries(table)) {
    if (key.startsWith('_')) continue
    if (!section || typeof section !== 'object') continue
    for (const name of Object.keys(section)) out.add(name)
  }
  return out
}

/** Every table name a canonical tree spells. */
function namesIn(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out
  if (node.type === 'series' || node.type === 'op' || node.type === 'call') out.add(node.name)
  for (const arg of node.args || []) namesIn(arg, out)
  return out
}

/** The declared SCALARS a tree names — a scalar rides the `series` node type. */
function scalarsIn(node) {
  return [...namesIn(node)].filter((n) => Object.prototype.hasOwnProperty.call(TABLE.scalars, n))
}

/** Every name the SHIPPED read-back can say, asked in `renderName`'s own order:
 *  the table's series, then the table's scalars, then the definition's inputs.
 *
 *  ⛔ THE THREE ARE ASKED SEPARATELY AND NONE IS RETYPED. `SENTENCE_RULES` is the
 *  compiled object `sentenceFor` itself consults, so this is the module's answer
 *  and not a copy of it. */
function saysThisName(name, inputs = NO_INPUTS) {
  return hasOwn(SENTENCE_RULES.series, name)
    || hasOwn(SENTENCE_RULES.scalars, name)
    || hasOwn(inputs, name)
}

/** A name NOTHING declares — SEARCHED FOR, never typed.
 *
 *  ⚠️ A REFUSAL CASE WHOSE SUBJECT QUIETLY BECOMES VALID IS A TEST THAT PASSES
 *  FOR THE WRONG REASON, and this file has already lived that once: the
 *  hand-written-sentence plant below rode on `rs_rank >= 80` until `56a2bca6`
 *  taught the read-back to say a declared scalar, at which point its subject
 *  stopped refusing. So the subject is derived against the three vocabularies at
 *  run time and walks until it finds one none of them owns. */
function aNameNothingDeclares(inputs = NO_INPUTS) {
  let name = 'zz_no_such_column'
  while (saysThisName(name, inputs) || declaredNames().has(name)) name = `${name}_x`
  return name
}

/** Try the shipped read-back and report WHY it could not speak.
 *
 *  ⭐ `inputs` IS THREADED RATHER THAN DEFAULTED INSIDE `sentenceFor`, so the
 *  object the third vocabulary is read from is one a caller can assert about. */
function readBack(ast, inputs = NO_INPUTS) {
  try {
    return { ok: true, text: sentenceFor(ast, inputs) }
  } catch (err) {
    return { ok: false, guard: err.guard, message: String(err.message) }
  }
}

/** THE ONE CHECK. Returns a list of human-readable problems; empty is green.
 *
 *  ⭐ A REFUSAL IS NOW ALWAYS A PROBLEM, and that is the whole shape of the
 *  hand-off from `56a2bca6`. This used to EXCUSE a `sentence:name` refusal that
 *  named one of the tree's own declared scalars, because the shipped read-back
 *  genuinely could not say those and 19 of the 21 concepts below carried no
 *  frozen sentence as a result. It can say all 54 now, so an excused refusal
 *  would be a hole exactly where the file's guarantee lives: every concept is
 *  sayable, and every sentence beside one is the read-back's own. */
function problemsIn(vocab) {
  const problems = []
  const declared = declaredNames()
  for (const [word, spec] of Object.entries(vocab.concepts || {})) {
    const parsed = parseFormula(spec.source)
    if (!parsed.ok) {
      problems.push(`${word}: does not parse (${parsed.guard}: ${parsed.error})`)
      continue
    }
    if (JSON.stringify(parsed.ast) !== JSON.stringify(spec.ast)) {
      problems.push(`${word}: the frozen ast is not what the parser produces from its source`)
    }
    const undeclared = [...namesIn(parsed.ast)].filter((n) => !declared.has(n))
    if (undeclared.length) {
      problems.push(`${word}: names ${undeclared.join(', ')}, which the closed table does not declare`)
    }
    const said = readBack(parsed.ast)
    if (said.ok) {
      if (spec.sentence !== said.text) {
        problems.push(
          `${word}: the shipped read-back CAN say this tree and the frozen sentence `
          + `does not match it — re-freeze it (got: ${said.text})`)
      }
      continue
    }
    if (spec.sentence !== undefined) {
      problems.push(`${word}: carries a sentence the shipped read-back refuses (${said.guard})`)
    }
    problems.push(
      `${word}: the shipped read-back cannot say this tree, so no honest sentence `
      + `can be frozen beside it — ${said.guard}: ${said.message}`)
  }
  return problems
}

describe('the concept vocabulary', () => {
  it('is not empty, so nothing below passes vacuously', () => {
    expect(Object.keys(VOCAB.concepts).length).toBeGreaterThan(0)
    expect(Object.keys(VOCAB._refused).length).toBeGreaterThan(0)
    expect(declaredNames().size).toBeGreaterThan(0)
    // ⭐ AND IT EXERCISES THE PATH `56a2bca6` REPAIRED. The re-freeze below is
    // only meaningful if these trees actually reach the table's SCALARS — the
    // section the read-back was blind to. Derived from the trees, so a
    // vocabulary that drifted to series-only would say so here.
    const scalarBearing = Object.values(VOCAB.concepts)
      .filter((spec) => scalarsIn(spec.ast).length > 0)
    expect(scalarBearing.length).toBeGreaterThan(0)
  })

  it('EVERY concept parses with the shipped parser, ships that parse result, and names only the table', () => {
    expect(problemsIn(VOCAB)).toEqual([])
  })

  it('the read-back is the TREE`s, and for "trending" it says what the firm means', () => {
    // ⭐ THE OWNER'S WORKED EXAMPLE. A member who says "trending stocks" must be
    // shown the maths and confirm it BEFORE anything is saved — that is D-A5
    // applied to a vocabulary, and it is the reason a concept can be trusted at
    // all. The sentence is `sentenceFor(ast)`, so it describes the TREE.
    const { ast } = parseFormula(VOCAB.concepts.trending.source)
    const said = sentenceFor(ast)
    expect(VOCAB.concepts.trending.sentence).toBe(said)
    for (const phrase of ['the 20-bar average of close',
      'the 50-bar average of close',
      'the 200-bar average of close']) {
      expect(said).toContain(phrase)
    }
    // …and it is not an echo of the word.
    expect(said).not.toContain('trending')
  })

  it('a refused word is NOT also a concept, and its reason names it', () => {
    for (const [word, reason] of Object.entries(VOCAB._refused)) {
      expect(VOCAB.concepts[word]).toBeUndefined()
      expect(reason.toLowerCase()).toContain(word)
    }
  })

  // ─── the planted illegals: the rail must be able to go red ────────────────

  it('a PLANTED unparseable expansion is caught, and the guard is named', () => {
    // CORRECTION 5's exact mistake: `and` is not an operator, jsep reads it as
    // several expressions, and the parser answers "a formula is one expression".
    const planted = {
      concepts: { zzplanted: { source: 'rs_rank > 80 and adr_pct > 4', ast: {} } },
      _refused: {},
    }
    const problems = problemsIn(planted)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('canonicalise:compound')
  })

  it('a PLANTED expansion naming something the table does not declare is caught BY NAME', () => {
    // CORRECTION 1's exact mistake: `rsi` parses perfectly well as a call and is
    // not one of the table's functions.
    const source = 'rsi(close, 14) < 30'
    const planted = {
      concepts: { zzplanted: { source, ast: parseFormula(source).ast } },
      _refused: {},
    }
    const problems = problemsIn(planted)
    expect(problems.some((p) => p.includes('does not declare') && p.includes('rsi'))).toBe(true)
    // …and the read-back independently refuses it as a function it has no rule
    // for, which is a DIFFERENT guard from the declared-scalar gap and must not
    // be swallowed as one.
    expect(problems.some((p) => p.includes('sentence:function'))).toBe(true)
  })

  it('a PLANTED tree that disagrees with its own source is caught', () => {
    const planted = {
      concepts: {
        zzplanted: {
          source: 'rs_rank >= 80',
          ast: parseFormula('rs_rank >= 75').ast,
        },
      },
      _refused: {},
    }
    expect(problemsIn(planted)[0]).toContain('not what the parser produces')
  })

  it('a PLANTED hand-written sentence on a tree the read-back refuses is caught', () => {
    // ⛔ THE SECOND-VOCABULARY MUTATION. Writing English here rather than taking
    // `sentenceFor`'s is exactly the defect this whole design exists to prevent.
    //
    // ⚠️ THE SUBJECT IS DERIVED, AND IT HAD TO BE REPLACED. This plant rode on
    // `rs_rank >= 80` — a tree the read-back refused only because it could not
    // yet say a declared SCALAR. `56a2bca6` taught it to, so that subject stopped
    // refusing and the case would otherwise have been quietly re-pointed at a
    // tree that reads back fine. The honest subject is a name NONE of the three
    // vocabularies owns, and it is searched for rather than typed.
    const source = aNameNothingDeclares(NO_INPUTS)
    expect(hasOwn(SENTENCE_RULES.series, source)).toBe(false)
    expect(hasOwn(SENTENCE_RULES.scalars, source)).toBe(false)
    expect(hasOwn(NO_INPUTS, source)).toBe(false)
    expect(declaredNames().has(source)).toBe(false)

    const parsed = parseFormula(source)
    expect(parsed.ok).toBe(true)
    expect(parsed.ast).toEqual({ type: 'series', name: source })

    // ⭐ AND THE DOOR IT REFUSES AT IS PART OF THE CLAIM. `sentence:name` is the
    // name lookup itself. If this ever becomes another guard, the refusal has
    // moved to a different door and this rail is measuring something else — say
    // so rather than relaxing the assertion.
    const refusal = readBack(parsed.ast, NO_INPUTS)
    expect(refusal.ok).toBe(false)
    expect(refusal.guard).toBe('sentence:name')
    expect(refusal.message).toContain(source)

    const planted = {
      concepts: {
        zzplanted: { source, ast: parsed.ast, sentence: 'a market leader' },
      },
      _refused: {},
    }
    const problems = problemsIn(planted)
    expect(problems.some((p) => p.includes('refuses'))).toBe(true)
    expect(problems.some((p) => p.includes('sentence:name'))).toBe(true)
  })

  it('a PLANTED stale sentence on a tree the read-back CAN say is caught', () => {
    const source = VOCAB.concepts.trending.source
    const planted = {
      concepts: {
        zzplanted: { source, ast: parseFormula(source).ast, sentence: 'the stock is trending' },
      },
      _refused: {},
    }
    expect(problemsIn(planted).some((p) => p.includes('re-freeze'))).toBe(true)
  })

  it('EVERY frozen sentence is the read-back`s OWN, re-derived here and not read', () => {
    // ⭐ THE RE-FREEZE, PROVED RATHER THAN ASSERTED. `problemsIn` already refuses
    // a sentence that does not match; this states the positive half over the
    // whole file so a concept cannot be covered by being skipped, and it is
    // TOTAL — every concept, or the count says so.
    const rederived = Object.fromEntries(
      Object.entries(VOCAB.concepts)
        .map(([word, spec]) => [word, sentenceFor(parseFormula(spec.source).ast, NO_INPUTS)]))
    const frozen = Object.fromEntries(
      Object.entries(VOCAB.concepts).map(([word, spec]) => [word, spec.sentence]))
    expect(frozen).toEqual(rederived)
    expect(Object.keys(rederived)).toEqual(Object.keys(VOCAB.concepts))
    // …and every concept CARRIES one. `problemsIn` reaches a missing sentence
    // only through `undefined !== <text>`; this says the guarantee positively, so
    // "the file declined to freeze this one" cannot read as a pass.
    for (const [word, spec] of Object.entries(VOCAB.concepts)) {
      expect(Object.prototype.hasOwnProperty.call(spec, 'sentence')).toBe(true)
      expect(typeof spec.sentence).toBe('string')
      expect(spec.sentence.length, word).toBeGreaterThan(0)
    }
  })
})
