// ─── THE MANIFEST'S OWN PHRASES, CHECKED AGAINST THE SLOT THEY LAND IN ──────
//
// ⭐ WHY THIS FILE EXISTS. `sentence.js` returns a scalar's `sentence` VERBATIM,
// by design — a read-back with its own phrase table is a second vocabulary, and
// the manifest says so in `_sentence`. So when a read-back reads as gibberish,
// `sentence.js` is not the defect: THE MANIFEST IS. `closedTable.json` had no
// test of its own, and this is it.
//
// ⛔ THE ONE COMBINATION THAT BREAKS. The comparison chrome renders
// `<phrase> is greater than or equal to 0.66`, so the phrase occupies a NOUN
// slot. A phrase written as a CLAUSE (`whether …`, `where …`) is exactly right
// for a `bool` entry read on its own and is gibberish the moment a `num` entry
// is compared to a number:
//
//     "1 when where the close sits inside the bar's range is greater than
//      or equal to 0.66 and 0 otherwise"        ← `closing strong`, before
//
// That was `close_position`, and it was the ONLY entry in the table that could
// produce it. This rail is what makes a fifty-fifth scalar making the same
// mistake land red on arrival instead of surfacing as a sentence somebody reads
// six weeks later.
//
// ⭐ BOTH SIDES ARE DERIVED, AND THE EVIDENCE IS NOT THE SUBJECT. The allowed
// openings are read off the manifest's OTHER `num`-valued phrases — the `series`
// docs and the `num`-yielding `functions` sentences — because those are the
// phrases that land in the SAME operand slot (`close > sma(close, 50)` puts one
// of each on either side of the chrome). Reading them off the scalars would be
// circular: the offender is a scalar. Nothing here is a hand-list of names or of
// forbidden words.

import { describe, expect, it } from 'vitest'
import { TABLE } from './parse.js'

/** The first WORD of a phrase, lowercased and stripped to letters.
 *
 *  A leading argument placeholder (`{0} crossing above {1}`) reduces to the
 *  empty string and is DISCARDED rather than counted as an opening word — a
 *  slot is not a word, and admitting one would put `''` in the allowed set and
 *  quietly excuse a phrase with no opening word at all. */
function openingWord(phrase) {
  const first = String(phrase ?? '').trim().split(/\s+/)[0] ?? ''
  return first.toLowerCase().replace(/[^a-z]/g, '')
}

/** How the manifest ALREADY opens a phrase that names a number.
 *
 *  ⛔ READ FROM `series` AND `functions`, NEVER FROM `scalars`. Those two
 *  sections fill the very same operand slot the scalars do, and neither is the
 *  subject of the rule below, so this is evidence rather than a restatement of
 *  the thing being checked. `evidence` is returned so the caller can refuse to
 *  judge anything off a census that found almost nothing. */
function nounPhraseOpenings(table) {
  const openings = new Set()
  let evidence = 0
  for (const spec of Object.values(table.series ?? {})) {
    const word = openingWord(spec?.doc)
    if (word) { openings.add(word); evidence += 1 }
  }
  for (const spec of Object.values(table.functions ?? {})) {
    if (spec?.yields !== 'num') continue
    const word = openingWord(spec?.sentence)
    if (word) { openings.add(word); evidence += 1 }
  }
  return { openings, evidence }
}

/** THE ONE CHECK. Every `num` scalar whose phrase does not open the way this
 *  manifest's other `num` phrases open — i.e. every one that reads as a clause
 *  in the comparison chrome. Sorted, so the report is stable. */
function clausePhrasedNumScalars(table) {
  const { openings } = nounPhraseOpenings(table)
  return Object.entries(table.scalars ?? {})
    .filter(([, spec]) => spec?.yields === 'num')
    .filter(([, spec]) => !openings.has(openingWord(spec?.sentence)))
    .map(([name, spec]) => ({ name, opens: openingWord(spec?.sentence), sentence: spec?.sentence }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** ⛔ THE NAMES, BUILT INTO THE TEXT — NOT LEFT TO THE DIFFER. Vitest abbreviates
 *  an array of objects to `[ Array(5) ]`, so a rail whose whole job is to say
 *  WHICH entry is wrong must not report through one. */
function nameThem(rows) {
  return rows.map((r) => `${r.name} (opens "${r.opens}": ${JSON.stringify(r.sentence)})`).join('; ')
}

describe('the closed table`s read-back phrases', () => {
  it('has evidence to judge from, so nothing below passes vacuously', () => {
    const { openings, evidence } = nounPhraseOpenings(TABLE)
    expect(evidence).toBeGreaterThanOrEqual(10)
    expect(openings.size).toBeGreaterThan(0)
    // …and the subject exists: a table with no `num` scalars would make the
    // rule below green by having nothing to say.
    const num = Object.values(TABLE.scalars).filter((s) => s.yields === 'num')
    const bool = Object.values(TABLE.scalars).filter((s) => s.yields === 'bool')
    expect(num.length).toBeGreaterThan(0)
    expect(bool.length).toBeGreaterThan(0)
    // ⛔ AND THE TWO ARE THE WHOLE SECTION. If a third `yields` ever lands among
    // the scalars, the rule below silently stops covering part of the table —
    // so say it here rather than discover it as a sentence nobody checked.
    expect(num.length + bool.length).toBe(Object.keys(TABLE.scalars).length)
  })

  it('NO scalar declaring yields:"num" is phrased as a CLAUSE', () => {
    const offenders = clausePhrasedNumScalars(TABLE)
    const { openings } = nounPhraseOpenings(TABLE)
    expect(
      nameThem(offenders),
      'a `num` scalar\'s phrase fills a NOUN slot in the comparison chrome '
      + `(\`<phrase> is greater than 0\`), and this manifest opens such a phrase with `
      + `${[...openings].sort().map((w) => `"${w}"`).join(' / ')}. These do not, so the `
      + `read-back reads as gibberish — reword the SENTENCE (nothing else) in `
      + `closedTable.json: ${nameThem(offenders) || '(none)'}`,
    ).toBe('')
  })

  it('a PLANTED num scalar phrased as a clause is caught BY NAME', () => {
    // ⭐ THE RAIL IS DERIVED, AND HERE IS THE PROOF. A hand-list of the entries
    // that were wrong on the day it was written would be UNMOVED by a
    // fifty-fifth scalar. This plants one into a copy of the REAL manifest and
    // runs the very function the case above runs.
    const clause = { ...TABLE.scalars.market_cap, yields: 'num', sentence: 'whether the widget is wide' }
    const planted = { ...TABLE, scalars: { ...TABLE.scalars, zz_planted_scalar: clause } }
    const caught = clausePhrasedNumScalars(planted)
    expect(caught.map((r) => r.name)).toContain('zz_planted_scalar')
    expect(nameThem(caught)).toContain('zz_planted_scalar')
    expect(nameThem(caught)).toContain('whether')

    // …and the SAME plant with a noun phrase is clean, so the rail answers
    // about the phrasing and not about being planted.
    const noun = { ...clause, sentence: 'the width of the widget' }
    const clean = { ...TABLE, scalars: { ...TABLE.scalars, zz_planted_scalar: noun } }
    expect(clausePhrasedNumScalars(clean).map((r) => r.name)).not.toContain('zz_planted_scalar')

    // …and a plant declaring `bool` is OUT OF SCOPE, deliberately: a clause is
    // exactly the right shape for an entry read on its own.
    const asBool = { ...clause, yields: 'bool' }
    const boolean = { ...TABLE, scalars: { ...TABLE.scalars, zz_planted_scalar: asBool } }
    expect(clausePhrasedNumScalars(boolean).map((r) => r.name)).not.toContain('zz_planted_scalar')
  })

  it('the allowed openings come OFF THE MANIFEST, not out of this file', () => {
    // ⛔ THE OTHER HALF OF "DERIVED". The case above proves the SUBJECT side is
    // read from the table; this proves the EVIDENCE side is too. Planting a
    // `num` function whose phrase opens with a word nothing else uses must
    // WIDEN the allowed set — a typed list could not move.
    const before = nounPhraseOpenings(TABLE).openings
    expect(before.has('yonder')).toBe(false)
    const planted = {
      ...TABLE,
      functions: {
        ...TABLE.functions,
        zzPlantedFn: { args: ['series'], lookback: 'none', yields: 'num', sentence: 'yonder reading of {0}' },
      },
    }
    expect(nounPhraseOpenings(planted).openings.has('yonder')).toBe(true)
    // …and a `bool` function does NOT widen it, because a clause-shaped phrase
    // is not evidence about the noun slot.
    const boolFn = {
      ...TABLE,
      functions: {
        ...TABLE.functions,
        zzPlantedFn: { args: ['series'], lookback: 'none', yields: 'bool', sentence: 'yonder reading of {0}' },
      },
    }
    expect(nounPhraseOpenings(boolFn).openings.has('yonder')).toBe(false)

    // ⛔ AND A PHRASE THAT OPENS WITH AN ARGUMENT SLOT CONTRIBUTES NO WORD. If
    // `""` were allowed to enter the set, a scalar with a blank or missing
    // sentence would be excused by it — silence reading as compliance.
    const slotFn = {
      ...TABLE,
      functions: {
        ...TABLE.functions,
        zzPlantedFn: { args: ['series'], lookback: 'none', yields: 'num', sentence: '{0} yonder' },
      },
    }
    expect(nounPhraseOpenings(slotFn).openings.has('')).toBe(false)
    const blank = {
      ...TABLE,
      scalars: {
        ...TABLE.scalars,
        zz_planted_scalar: { ...TABLE.scalars.market_cap, yields: 'num', sentence: '' },
      },
    }
    expect(clausePhrasedNumScalars(blank).map((r) => r.name)).toContain('zz_planted_scalar')
  })
})
