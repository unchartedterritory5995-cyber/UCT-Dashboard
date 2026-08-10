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
import { NODE_TYPES, REFUSALS as PARSE_REFUSALS, TABLE } from './parse.js'
import { REFUSALS as INTERPRET_REFUSALS } from './interpret.js'
import { REFUSALS as BUDGET_REFUSALS } from './budget.js'

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

// ─── …AND THE MANIFEST'S PROSE, CHECKED AGAINST THE GRAMMAR IT DESCRIBES ─────
//
// 🔴 WHY THIS HALF EXISTS. `_canonical` and `_no_offset` are the note an engineer
// reads before deciding whether an offset is ALLOWED. On 2026-08-09 `291c9d8a`
// shipped a bounded backward offset and both notes still said the tree had FOUR
// node types and that no backward-index form existed — so the manifest argued
// that a feature the engine contains is forbidden. Left alone that gets a working
// feature removed, or costs the next engineer the whole derivation again.
//
// ⭐ THE DURABLE HALF IS NOT THE WORDING, IT IS THIS FILE. The note went stale
// because it was hand-written and nothing checked it; a sixth node type would do
// it again on the same day. Both claims below are COMPOSED from the grammar —
// `parse.js::NODE_TYPES` and the three `REFUSALS` tables — and compared with the
// prose, so the prose fails BY NAME rather than drifting.
//
// ⚰️ HISTORY IS EXEMPT, ON PURPOSE. This file's idiom keeps what was wrong and
// why, because that is what stops a withdrawn claim from being re-proposed as
// though it had never been considered. A claim inside a ⚰️ segment is a RECORD;
// a claim in un-marked prose is an ASSERTION, and only assertions are checked.
// That distinction is the contract: state the live claim BEFORE the ⚰️.

/** The count words this manifest writes numbers as. Deliberately finite — a
 *  grammar outside this range must make the rail FAIL, never silently skip. */
const COUNT_WORDS = Object.freeze(
  ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'])

const countWord = (n) => COUNT_WORDS[n] ?? null

/** The section markers this file writes. ⚰️ is the HISTORY one; the rest are
 *  ordinary emphasis and the prose under them is live. */
const MARKER_SOURCE = '[\\u2B50\\u26D4\\u26A0\\u26B0\\u{1F534}]\\u{FE0F}?'
const HISTORY_MARKER = '⚰'

/** A note split into segments, each tagged with the marker that OPENS it
 *  (`null` for the text before the first marker). */
function segmentsOf(note) {
  const re = new RegExp(MARKER_SOURCE, 'gu')
  const out = []
  let last = 0
  let marker = null
  let m
  while ((m = re.exec(note)) !== null) {
    out.push({ marker, text: note.slice(last, m.index) })
    marker = m[0]
    last = m.index + m[0].length
  }
  out.push({ marker, text: note.slice(last) })
  return out
}

const isHistory = (seg) => typeof seg.marker === 'string' && seg.marker.startsWith(HISTORY_MARKER)

/** Every `_`-prefixed prose key, as `[name, note]`. Derived from the table, so a
 *  nineteenth note is covered the day it lands. */
const proseKeysOf = (table) =>
  Object.entries(table).filter(([k, v]) => k.startsWith('_') && typeof v === 'string')

// ── the node-type roster ────────────────────────────────────────────────────

/** THE CLAIM, COMPOSED FROM THE GRAMMAR. Nothing in this sentence is typed
 *  twice: the word comes from the length and the roster from the list. */
const nodeTypeClaim = (types) => `${countWord(types.length)} node types -- ${types.join(', ')} --`

/** Every count word a text uses in a claim ABOUT node types, whatever it is. */
function nodeTypeCountWordsIn(text) {
  return [...text.matchAll(/\b([A-Z]{3,7}) node types\b/g)].map((m) => m[1])
}

/** Which prose keys state the live roster, and which assert a stale count.
 *
 *  ⭐ TAKES `types` AS AN ARGUMENT so the proof below can plant a sixth node type
 *  without touching `parse.js`, and so this function is never reading back the
 *  same constant its caller is checking. */
function nodeTypeVerdict(table, types) {
  const claim = nodeTypeClaim(types)
  const live = countWord(types.length)
  const states = []
  const stale = []
  for (const [name, note] of proseKeysOf(table)) {
    for (const seg of segmentsOf(note)) {
      if (isHistory(seg)) continue
      if (seg.text.includes(claim)) states.push(name)
      for (const word of nodeTypeCountWordsIn(seg.text)) {
        if (word !== live) stale.push(`${name} asserts "${word} node types" outside a ⚰️ record`)
      }
    }
  }
  return { claim, states: [...new Set(states)], stale: [...new Set(stale)] }
}

// ── the offset guards ───────────────────────────────────────────────────────

/** Every guard name the engine actually declares, across all three tables. */
const ALL_GUARDS = Object.freeze(new Set([
  ...Object.keys(PARSE_REFUSALS), ...Object.keys(INTERPRET_REFUSALS), ...Object.keys(BUDGET_REFUSALS),
]))

/** The guards whose NAME says they are about the offset form. Derived, so a
 *  sixth one obliges the note on the day it is declared. */
const offsetGuardsOf = (guards) => [...guards].filter((g) => g.includes('offset')).sort()

/** Guard-shaped tokens written in backticks in a note. */
const guardTokensIn = (text) => [...text.matchAll(/`([a-z]+:[a-z-]+)`/g)].map((m) => m[1])

/** The segment carrying the counted guard roster, found by its own words. */
const guardRosterSegment = (note) =>
  segmentsOf(note).find((s) => /\b[A-Z]+ GUARDS, PAIRWISE DISJOINT\b/.test(s.text)) ?? null

/** Does `_no_offset` name every offset guard, invent none, and count right? */
function offsetGuardVerdict(note, guards) {
  const problems = []
  const named = new Set(guardTokensIn(note))
  for (const token of named) {
    if (!guards.has(token)) problems.push(`\`${token}\` is named but no REFUSALS table declares it`)
  }
  for (const guard of offsetGuardsOf(guards)) {
    if (!named.has(guard)) problems.push(`\`${guard}\` is declared by the grammar and this note never names it`)
  }
  const seg = guardRosterSegment(note)
  if (!seg) {
    problems.push('no segment states a counted, pairwise-disjoint guard roster')
  } else {
    const word = /\b([A-Z]+) GUARDS, PAIRWISE DISJOINT\b/.exec(seg.text)[1]
    const listed = [...new Set(guardTokensIn(seg.text))]
    const expected = countWord(listed.length)
    if (word !== expected) {
      problems.push(
        `the roster says "${word} GUARDS" and lists ${listed.length} (${listed.join(', ')}), which is "${expected}"`)
    }
  }
  return problems.sort()
}

describe('the closed table`s prose, against the grammar it describes', () => {
  it('has a grammar and guards to judge against, so nothing below passes vacuously', () => {
    // The subject exists…
    expect(NODE_TYPES.length).toBeGreaterThanOrEqual(4)
    expect(countWord(NODE_TYPES.length), `no count word for ${NODE_TYPES.length} node types`).toBeTruthy()
    expect(ALL_GUARDS.size).toBeGreaterThanOrEqual(15)
    expect(offsetGuardsOf(ALL_GUARDS).length).toBeGreaterThan(0)
    // …the notes exist and are prose, not stubs…
    expect(proseKeysOf(TABLE).length).toBeGreaterThanOrEqual(10)
    expect(String(TABLE._canonical).length).toBeGreaterThan(200)
    expect(String(TABLE._no_offset).length).toBeGreaterThan(200)
    // …and the segmenter really finds the ⚰️ record rather than reading the whole
    // note as one blob, which would let the history exemption cover everything.
    const segs = segmentsOf(TABLE._no_offset)
    expect(segs.length).toBeGreaterThan(1)
    expect(segs.filter(isHistory).length).toBe(1)
    expect(segs.filter((s) => !isHistory(s)).length).toBeGreaterThan(1)
  })

  it('a prose key states the LIVE node-type roster, composed from `parse.js::NODE_TYPES`', () => {
    const { claim, states } = nodeTypeVerdict(TABLE, NODE_TYPES)
    expect(
      states.join(', '),
      'the manifest is the note an engineer reads before deciding what the persisted tree may '
      + 'hold, and no live prose in it states the grammar\'s roster. Expected the substring '
      + `${JSON.stringify(claim)} — composed from NODE_TYPES, not typed — in a segment that is `
      + 'not a ⚰️ record. Update `_canonical`.',
    ).not.toBe('')
  })

  it('NO live prose asserts a node-type count the grammar does not have', () => {
    const { stale } = nodeTypeVerdict(TABLE, NODE_TYPES)
    expect(
      stale.join('; '),
      `the grammar has ${NODE_TYPES.length} node types (${NODE_TYPES.join(', ')}). A count stated `
      + 'in un-marked prose is an ASSERTION about today; move a withdrawn one behind a ⚰️ marker '
      + `with what changed — do not delete it: ${stale.join('; ') || '(none)'}`,
    ).toBe('')
  })

  it('a PLANTED sixth node type takes both cases red, BY NAME', () => {
    // ⭐ THE PROOF, AND IT IS DERIVED. A rail asserting the roster that happened to
    // be right the day it was written would be UNMOVED by a sixth type — which is
    // exactly how the note it replaces went stale. This runs the very functions the
    // two cases above run, against the REAL manifest, with the grammar widened.
    const planted = Object.freeze([...NODE_TYPES, 'zzPlantedType'])
    const verdict = nodeTypeVerdict(TABLE, planted)
    expect(verdict.claim).toContain('zzPlantedType')
    expect(verdict.claim).toContain(countWord(planted.length))
    // …nothing states it, so the roster case would fail…
    expect(verdict.states).toEqual([])
    // …and the roster the manifest DOES state now reads as stale, named by key.
    expect(verdict.stale.join('; ')).toContain('_canonical')
    expect(verdict.stale.join('; ')).toContain(countWord(NODE_TYPES.length))

    // …while the real grammar passes both, so the rail answers about the CLAIM and
    // not about something having been planted.
    const real = nodeTypeVerdict(TABLE, NODE_TYPES)
    expect(real.states).toContain('_canonical')
    expect(real.stale).toEqual([])
  })

  it('a CORRUPTED note is caught even though the grammar never moved', () => {
    // The other direction: the grammar is right and the prose is rolled back to
    // what it said before `291c9d8a`. The rail must not need the grammar to move.
    const rolledBack = {
      ...TABLE,
      _canonical: 'The persisted tree has FOUR node types -- num, series, op, call -- and nothing else.',
    }
    const verdict = nodeTypeVerdict(rolledBack, NODE_TYPES)
    expect(verdict.states).not.toContain('_canonical')
    expect(verdict.stale.join('; ')).toContain('_canonical asserts "FOUR node types"')

    // …and the SAME withdrawn sentence written as a ⚰️ record is clean, because
    // keeping it is the idiom and must never be the thing that fails.
    const recorded = {
      ...TABLE,
      _canonical: `${nodeTypeClaim(NODE_TYPES)} ⚰️ THIS SAID *"FOUR node types -- num, series, op, call"*.`,
    }
    const kept = nodeTypeVerdict(recorded, NODE_TYPES)
    expect(kept.states).toContain('_canonical')
    expect(kept.stale).toEqual([])
  })

  it('`_no_offset` names every offset guard the grammar declares, and invents none', () => {
    const problems = offsetGuardVerdict(TABLE._no_offset, ALL_GUARDS)
    expect(
      problems.join('; '),
      'the offset note is what an engineer reads before deciding whether a refusal may be '
      + 'deleted, so every guard it names must exist and every offset guard the grammar declares '
      + `(${offsetGuardsOf(ALL_GUARDS).join(', ')}) must be named: ${problems.join('; ') || '(none)'}`,
    ).toBe('')
  })

  it('a PLANTED sixth offset guard, a RENAMED one and a MISCOUNTED roster each land red', () => {
    // ⭐ Three independent ways for the note and the grammar to disagree, each one
    // proven to fail — a rail nobody has seen fail is not a rail.
    const widened = new Set([...ALL_GUARDS, 'canonicalise:offset-planted'])
    expect(offsetGuardVerdict(TABLE._no_offset, widened).join('; '))
      .toContain('`canonicalise:offset-planted` is declared by the grammar and this note never names it')

    const renamed = new Set([...ALL_GUARDS].filter((g) => g !== 'canonicalise:offset-chained'))
    expect(offsetGuardVerdict(TABLE._no_offset, renamed).join('; '))
      .toContain('`canonicalise:offset-chained` is named but no REFUSALS table declares it')

    const miscounted = String(TABLE._no_offset)
      .replace('FIVE GUARDS, PAIRWISE DISJOINT', 'FOUR GUARDS, PAIRWISE DISJOINT')
    expect(miscounted, 'the roster sentence moved; this proof is checking nothing')
      .not.toBe(TABLE._no_offset)
    expect(offsetGuardVerdict(miscounted, ALL_GUARDS).join('; '))
      .toContain('the roster says "FOUR GUARDS"')

    // …and the real note is clean against the real grammar.
    expect(offsetGuardVerdict(TABLE._no_offset, ALL_GUARDS)).toEqual([])
  })

  it('the withdrawn v1 claim is KEPT, and kept as a ⚰️ record rather than an assertion', () => {
    // ⚰️ THE OTHER HALF OF THE IDIOM. A fix that silently rewrites the note as
    // though it always said this loses the reason a GENERAL `close[n]` is still
    // refused — and that argument is what stops it being re-proposed. So the v1
    // sentence must still be here, and must not read as current.
    const withdrawn = 'NO BACKWARD-INDEX FORM IN v1'
    expect(String(TABLE._no_offset)).toContain(withdrawn)
    const asserting = segmentsOf(TABLE._no_offset)
      .filter((s) => !isHistory(s) && s.text.includes(withdrawn))
    expect(
      asserting.map((s) => JSON.stringify(s.text.slice(0, 80))).join('; '),
      'the v1 claim is withdrawn, so it may appear only inside a ⚰️ record',
    ).toBe('')
  })
})
