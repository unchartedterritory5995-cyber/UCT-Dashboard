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
import { sentenceFor } from './sentence.js'
import VOCAB from './conceptVocabulary.json'

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

/** Try the shipped read-back and report WHY it could not speak.
 *
 *  ⚠️ MEASURED 2026-08-09, AND IT IS A GAP IN `sentence.js`, NOT HERE:
 *  `compileRules` builds name rows from `table.series` ONLY, so a tree naming
 *  any declared SCALAR refuses with `sentence:name`. `coverageGaps()` reports
 *  nothing, because it iterates the same three sections. So the vocabulary
 *  freezes a `sentence` exactly where the shipped module can produce one, and
 *  this function is how the test DERIVES which concepts those are rather than
 *  trusting the file to say. */
function readBack(ast) {
  try {
    return { ok: true, text: sentenceFor(ast) }
  } catch (err) {
    return { ok: false, guard: err.guard, message: String(err.message) }
  }
}

/** THE ONE CHECK. Returns a list of human-readable problems; empty is green. */
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
    if (said.ok && spec.sentence !== said.text) {
      problems.push(
        `${word}: the shipped read-back CAN say this tree and the frozen sentence `
        + `does not match it — re-freeze it (got: ${said.text})`)
    }
    if (!said.ok) {
      if (spec.sentence !== undefined) {
        problems.push(`${word}: carries a sentence the shipped read-back refuses (${said.guard})`)
      }
      const scalars = scalarsIn(parsed.ast)
      const explained = said.guard === 'sentence:name'
        && scalars.some((s) => said.message.includes(`"${s}"`))
      if (!explained) {
        problems.push(
          `${word}: the read-back refused with ${said.guard} for a reason that is NOT `
          + `the known declared-scalar gap — ${said.message}`)
      }
    }
  }
  return problems
}

describe('the concept vocabulary', () => {
  it('is not empty, so nothing below passes vacuously', () => {
    expect(Object.keys(VOCAB.concepts).length).toBeGreaterThan(0)
    expect(Object.keys(VOCAB._refused).length).toBeGreaterThan(0)
    expect(declaredNames().size).toBeGreaterThan(0)
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
    // `sentenceFor`'s is exactly the defect this whole design exists to prevent,
    // and it is the tempting fix for the declared-scalar gap.
    const source = 'rs_rank >= 80'
    const planted = {
      concepts: {
        zzplanted: { source, ast: parseFormula(source).ast, sentence: 'a market leader' },
      },
      _refused: {},
    }
    expect(problemsIn(planted).some((p) => p.includes('refuses'))).toBe(true)
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
})
