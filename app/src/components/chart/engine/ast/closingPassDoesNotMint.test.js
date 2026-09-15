// app/src/components/chart/engine/ast/closingPassDoesNotMint.test.js
//
// ─── ⭐⭐ R13 — THE CLOSING PASS RESOLVES. IT DOES NOT MINT. ─────────────────
//
// ⛔⛔ RESOLVING IS NOT MINTING, AND THAT IS THE WHOLE RULING. The closing pass
// over `env` (`bdc1050ad`) exists so that a binding nothing reads is still
// RESOLVED once, and NOTED if it refuses — so a right-hand side this lane cannot
// read stops translating as a silent hole. Its own commit message states the
// restraint that makes it safe, and states it as the load-bearing half:
//
//     "WHAT IT DOES NOT DO IS THE LOAD-BEARING HALF. It does not report unread
//      names. An unread but perfectly readable `len = 14` needs no note […] It
//      resolves each leftover once and reports only what refuses."
//
// ⚰️ THE COMMENT WAS TRUE ABOUT NOTES AND FALSE ABOUT PARAMETERS. The probe was
// constructed with the LIVE `paramMint`, so every `input.*` inside an unread
// binding minted a Track F parameter — a member-visible control — while only a
// THROW was reported. The pass stayed silent in the channel it promised to stay
// silent in and spoke in one nobody had checked.
//
// ⭐ MEASURED, on `mid_engagement__22-rsi-levels-regime-map`, by tagging each
// mint with the site that made it:
//
//     by the output loop      5   rsiLen regLook useRev revPiv showSetup
//     by the CLOSING PASS    19   …including bullFloor, regTol, bearCeil
//
// and the closing pass's own loop guard is `if (… || bound.read) continue`, so
// **every one of those 19 came from a binding nothing read**. A Track F parameter
// is a literal that survives into a RENDERED OUTPUT'S tree; a binding no output
// reads contributes no tree, so it must mint nothing. 5 is the correct number and
// 24 is the defect.
//
// ⛔ THE COLLISION HAS TWO SITES AND ONLY ONE IS LEGITIMATE. `bullFloor`,
// `regTol` and `bearCeil` are DECLARED member inputs. In the output loop that is
// decided by `declareInputs`, whose early return hands back a `series` leaf and
// never reaches the mint at all. The closing pass's probe is built WITHOUT
// `declareInputs`, so for it no name is declared and all three fall through and
// mint. The declared member input is the authority — `paramSingleTranslation`'s
// own words, "TWO AUTHORITIES OVER ONE INPUT IS THE DEFECT, NOT THE FEATURE."
//
// ⭐ THE PRECEDENT IS ALREADY IN THIS FILE: the object-pass factory a few hundred
// lines below the closing pass constructs its Resolver with `paramMint: null`,
// for exactly this reason. The closing pass is the site that did not.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { memberInputTranslation } from '../../builder/builderInputs.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const SPECIMEN = path.join(REPO,
  'tests/fixtures/pine_oos/mid_engagement__22-rsi-levels-regime-map.pine')
const CLOUDS = path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine')

/** ⭐ THE DOOR THE MEMBER ACTUALLY WALKS THROUGH, not a raw `translatePine`.
 *
 *  ⚰️ The first version of this file called `translatePine` directly and read
 *  `t.declared`, which that entry point does not populate — so the overlap was
 *  empty because the set was empty, and the `it.fails` guarding it PASSED,
 *  reporting the defect as already fixed. An absence is only evidence if the
 *  instrument could have seen a presence; `assertsTheDoorIsReal` below is the
 *  control that now makes that impossible to repeat. */
function doorFacts() {
  const src = fs.readFileSync(SPECIMEN, 'utf8')
  const t = memberInputTranslation(translatePine, src, { paramManifest: true })
  return {
    params: (t.inputParams || []).map((p) => p.sourceName),
    declared: new Set(t.declared || []),
  }
}

describe('R13 — the closing pass resolves without minting', () => {
  it.fails('⭐⭐ THE SPECIMEN MINTS 5 TRACK F PARAMETERS, NOT 24', () => {
    // ⛔ THE ANSWER, NOT THE ABSENCE. The number is pinned, and it is pinned to
    // the measured pre-`bdc1050ad` value rather than to "fewer than 24" — a
    // bound would stay green at 23, which is the same defect one input smaller.
    const { params } = doorFacts()
    expect(params.length,
      `the closing pass is minting for unread bindings: ${JSON.stringify(params)}`)
      .toBe(5)
    expect([...params].sort())
      .toEqual(['regLook', 'revPiv', 'rsiLen', 'showSetup', 'useRev'])
  })

  it.fails('⭐⭐ AND NO DECLARED MEMBER INPUT IS ALSO A TRACK F PARAMETER', () => {
    const { params, declared } = doorFacts()
    const overlap = params.filter((n) => declared.has(n))
    expect(overlap, 'two authorities over one input').toEqual([])
  })

  it.fails('⛔ the three colliding names have exactly ONE minting authority', () => {
    // Named individually so a partial fix cannot read as a whole one.
    const { params, declared } = doorFacts()
    for (const name of ['bullFloor', 'regTol', 'bearCeil']) {
      expect(declared.has(name), `${name} should be a declared member input`).toBe(true)
      expect(params.includes(name),
        `${name} is claimed twice — declared AND minted as a Track F parameter`)
        .toBe(false)
    }
  })

  // ── THE CONTROLS. R13 must not spend the closing pass's gain to fix its
  //    overreach, and these are what say so. They pass BEFORE and AFTER.

  it('⛔⛔ CONTROL — the door really answers, so an empty overlap MEANS something', () => {
    // ⚰️ This exists because the first draft of this file read `declared` off an
    // entry point that does not populate it. The set was empty, so the overlap
    // was empty, so the defect read as fixed. Ten declared names is the measured
    // answer; asserting it is what stops a silent instrument passing as a green
    // product.
    const { params, declared } = doorFacts()
    expect(declared.size, 'the door declared nothing — the instrument is blind')
      .toBe(10)
    expect([...declared]).toContain('bullFloor')
    expect(params.length, 'the door minted nothing — the instrument is blind')
      .toBeGreaterThan(0)
  })

  it('⭐ CONTROL — a READ binding still legitimately mints', () => {
    // Without this, "0 parameters, ever" would satisfy every assertion above.
    const t = translatePine(
      'indicator("x")\nlen = input.int(14, "RSI Length")\nplot(ta.sma(close, len))\n',
      { paramManifest: true })
    expect((t.inputParams || []).map((p) => p.sourceName)).toEqual(['len'])
  })

  it('⛔⛔ CONTROL — the closing pass KEEPS its notes product on Clouds', () => {
    // ⚰️ This is the half R13 could most easily break by over-correcting. The
    // closing pass was built so line 90 would speak at all; a fix that silenced
    // the pass instead of un-minting it would pass every assertion above and
    // undo the ruling that created it.
    const t = translatePine(fs.readFileSync(CLOUDS, 'utf8'), {})
    const notes = (t.notes || []).map((n) => `${n.code || n.guard}@${n.line}`)
    expect(notes.filter((s) => s.startsWith('pine:colour-value')))
      .toEqual(['pine:colour-value@90', 'pine:colour-value@91'])
    expect(notes.filter((s) => s.startsWith('pine:input-kind')))
      .toEqual(['pine:input-kind@10', 'pine:input-kind@11', 'pine:input-kind@13',
        'pine:input-kind@17', 'pine:input-kind@18', 'pine:input-kind@20',
        'pine:input-kind@24', 'pine:input-kind@26'])
  })
})
