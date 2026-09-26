// app/src/components/chart/engine/ast/legacyLookaheadSpelling.test.js
//
// ─── ⭐⭐ `lookahead=true` IS PINE'S OWN SPELLING, AND THE DOOR CALLED IT A TYPO ─
//
// `security(syminfo.tickerid, res, high[1], lookahead=true)` is how Pine v1–v3
// wrote a look-ahead request, and v4 still compiles it: the migration to
// `barmerge.lookahead_on` renamed the constant, it did not retire the boolean.
// **16 uses across 5 corpus scripts** write it that way.
//
// This door reads the argument only when the node is a NAME:
//
//     const spelled = v && v.type === 'name' ? v.name : null
//     if (spelled === 'barmerge.lookahead_on') live = true
//     else if (spelled !== 'barmerge.lookahead_off') return null
//
// A boolean literal has no `.name`, so `spelled` is null, the second test is
// true, and the whole call falls to `pine:request` — *"this request could not be
// resolved to one symbol and one servable timeframe"*. ⛔ THAT SENTENCE IS FALSE
// ABOUT ITS OWN NEIGHBOUR: the identical request with `lookahead=barmerge.
// lookahead_on` resolves, and so does the identical request with no `lookahead`
// at all. The symbol was fine and the timeframe was fine; the spelling of a
// third argument was not, and the refusal named neither.
//
// ⭐⭐ THE MEASURED GAIN DOES NOT REST ON WHICH DIRECTION `true` MEANS, and that
// is why this increment is safe. Three lines below the admission there is:
//
//     // ⛔ AND A LOOK-AHEAD READ OF THE CHART'S OWN TIMEFRAME IS NOTHING TO
//     // MODEL: there is no period to be part-way through
//     if (live && !code) live = false
//
// A request for the chart's own timeframe folds to the identity whatever the
// lookahead says, because there is no aggregation to peek inside. That is the
// case `fibonacci-pivot-points-cc` is in, and it is the one that moves the
// corpus — so the +1 below is true even if the mapping were backwards.
//
// ⚠️ THE DIRECTION IS A LANGUAGE EQUIVALENCE, NOT A VENDOR MEASUREMENT, and it
// is asserted by DERIVATION rather than restatement: the cases below do not say
// "`true` produces `tf_live`", they say "`true` produces whatever
// `barmerge.lookahead_on` produces". If this engine ever changes what
// `lookahead_on` emits, these follow it instead of going stale
// (`lesson_a_second_authority_over_one_value`).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')
const H = '//@version=4\nstudy("t", overlay=true)\n'

/** The translated tree of the first output, or the refusal guard. */
function astOf(src) {
  const t = translatePine(src, { strict: true })
  const o = (t.outputs || [])[0]
  if (!t.ok) return { refused: (t.refusal && t.refusal.guard) || (o && o.refusal && o.refusal.guard) }
  return { ast: o && o.ast, formula: o && o.formula }
}

const req = (tf, look) =>
  `${H}plot(security(syminfo.tickerid, ${tf}, close${look ? `, lookahead=${look}` : ''}))\n`

describe('⭐⭐ Pine\'s boolean lookahead spelling', () => {
  it('⛔ CONTROL — the two CONSTANT spellings work and DIFFER from each other', () => {
    // ⭐⭐ NON-VACUITY, and it is load-bearing for every case below. Those cases
    // compare a boolean spelling against a constant one; if both constants
    // produced the same tree the comparisons would pass for a door that had
    // stopped reading the argument at all.
    const on = astOf(req('"W"', 'barmerge.lookahead_on'))
    const off = astOf(req('"W"', 'barmerge.lookahead_off'))
    expect(on.refused, 'the constant spelling regressed').toBeUndefined()
    expect(off.refused, 'the constant spelling regressed').toBeUndefined()
    expect(on.ast).not.toEqual(off.ast)
  })

  it('⭐⭐ `lookahead=true` at the CHART\'S OWN timeframe — the corpus case', () => {
    // ⭐ THE ONE THAT MOVES THE NUMBER, and it is direction-independent: at the
    // base timeframe the engine forces `live = false` whichever way `true` maps,
    // so this asserts the request RESOLVES, not what lookahead means.
    const got = astOf(req('"D"', 'true'))
    expect(got.refused, 'a legacy boolean still reads as an unservable request')
      .toBeUndefined()
    // ⛔ AND IT IS THE IDENTITY — the bars already in hand, not a resample.
    expect(got.ast).toEqual(astOf(req('"D"', 'barmerge.lookahead_on')).ast)
    expect(got.formula).toBe('close')
  })

  it('⭐ `true` means whatever `barmerge.lookahead_on` means, at a REAL higher timeframe', () => {
    // ⚠️ DERIVED, NOT RESTATED — see the header. This is the only case where the
    // direction is observable, because a weekly request really does aggregate.
    expect(astOf(req('"W"', 'true')).ast)
      .toEqual(astOf(req('"W"', 'barmerge.lookahead_on')).ast)
  })

  it('⭐ `false` means whatever `barmerge.lookahead_off` means', () => {
    expect(astOf(req('"W"', 'false')).ast)
      .toEqual(astOf(req('"W"', 'barmerge.lookahead_off')).ast)
  })

  it('⭐⭐ POSITIONALLY TOO — the asymmetry a corpus-only measurement would hide', () => {
    // ⛔⛔ A FIX IS ONLY AS WIDE AS THE LANE YOU MEASURED IT IN. Pine takes
    // `lookahead` as the FIFTH argument, and the corpus writes it that way often:
    //     security(syminfo.tickerid, tf1, zigzag, barmerge.gaps_on, barmerge.lookahead_on)
    // The door catches those through a heuristic on the NAME node
    // (`spelled.includes('lookahead')`) — which a boolean literal has no way of
    // satisfying. So teaching only the named form would have left
    // `…, barmerge.gaps_on, true)` silently reading as lookahead_OFF: not a
    // refusal a member could see, but a different number under the same name.
    //
    // ⚠️ MEASURED: ZERO corpus scripts write it, so the corpus could not have
    // found this and a census-driven stop would have shipped the asymmetry. It is
    // valid Pine, and the objective is every published script, not 266 of them.
    const positional = `${H}plot(security(syminfo.tickerid, "W", close, barmerge.gaps_off, true))
`
    const named = `${H}plot(security(syminfo.tickerid, "W", close, gaps=barmerge.gaps_off, lookahead=true))
`
    const got = astOf(positional)
    expect(got.refused, 'a positional boolean lookahead is unreadable').toBeUndefined()
    expect(got.ast).toEqual(astOf(named).ast)
  })

  it('⭐ and positional `false` agrees with the named form as well', () => {
    expect(astOf(`${H}plot(security(syminfo.tickerid, "W", close, barmerge.gaps_off, false))
`).ast)
      .toEqual(astOf(`${H}plot(security(syminfo.tickerid, "W", close, lookahead=false))
`).ast)
  })

  it('⛔⛔ CONTROL — AN UNRECOGNISED SPELLING STILL REFUSES', () => {
    // ⚰️ THE HALF THAT KEEPS THE DOOR A DOOR. Its own comment says it "admits the
    // two declared values, never anything that isn't off", and widening it to
    // take a boolean must not widen it to take a name nobody declared.
    // `ilookaehad` is not invented for this test — it appears SIX times in the
    // committed corpus, where it is a member's own misspelling.
    expect(astOf(req('"W"', 'ilookaehad')).refused).toBe('pine:request')
  })

  it('⛔ CONTROL — a NUMERIC literal is not a boolean and still refuses', () => {
    // Pine's argument is a bool (or the barmerge type); `1` is neither. Taking
    // it because C treats 1 as true would be this engine inventing a coercion
    // the language does not have.
    expect(astOf(req('"W"', '1')).refused).toBe('pine:request')
  })

  it('⭐⭐ THE PRODUCT CLAIM — `fibonacci-pivot-points-cc` translates', () => {
    // ⛔ THE CORPUS FILE ITSELF, not a paraphrase of it. It writes the shape
    // three times over:
    //     High = security(syminfo.tickerid, res, high[1], lookahead=true)
    // with `res = input(type=input.resolution, defval="D")`, which folds to the
    // author's default and therefore to this engine's own base.
    const file = path.join(CORPUS, 'fibonacci-pivot-points-cc__p8DQ3RIR97.pine')
    // ⚠️ ASSERTED, NOT SKIPPED. The file is tracked, so a missing one is a
    // broken checkout and must fail rather than quietly pass
    // (`lesson_a_rails_important_half_can_be_opt_in`).
    expect(fs.existsSync(file), 'the committed corpus script is missing').toBe(true)
    const t = translatePine(fs.readFileSync(file, 'utf8'), { strict: true })
    expect(t.ok, t.ok ? '' : `${t.refusal && t.refusal.guard}: ${t.refusal && t.refusal.message}`)
      .toBe(true)
  })
})
