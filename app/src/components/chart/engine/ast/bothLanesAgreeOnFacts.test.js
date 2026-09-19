// app/src/components/chart/engine/ast/bothLanesAgreeOnFacts.test.js
//
// ─── ⭐⭐ a7.2 — THE TWO LANES AGREE ON THE FACTS, OVER ALL 327 SCRIPTS ─────
//
// `bothLanesAreTwoLanes.test.js` proves the lanes reach DIFFERENT verdicts on a known
// fixture — that is the two-lanes property, and it is asserted on a handful of
// scripts. `corpus_metric.json` covers 266. Neither reaches all 327, and Clouds is in
// neither: it lives in `tests/fixtures/member/`.
//
// ⭐ THE PROPERTY THIS ADDS, and it is the other half of the same rule:
//
//     the VERDICTS may differ            (`ok` — strict refuses a partial translation,
//                                         lenient offers what it can)
//     the FACTS must not                 (`outputs.length`, `refusals.length`, and the
//                                         refusal codes IN ORDER)
//
// A lane that answered a different NUMBER of outputs, or refused for a different
// reason, would not be a stricter reading of the same script — it would be a second
// translator. `bothLanesAreTwoLanes` case 2 is the precedent; this is that case over
// the whole corpus.
//
// ⛔ PER THE STANDING RULE, IT PINS THE FACTS EACH SCRIPT PRODUCES, not "the lanes did
// not disagree". A rail that only compared the two lanes to each other would stay
// green if BOTH collapsed to zero outputs, which is the failure it most needs to see.
// So the totals are asserted as numbers, and the per-script comparison sits on top.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')

/** ⭐ THE THREE SOURCES, read from the directories rather than typed. Clouds lives in
 *  `tests/fixtures/member/`, which is why neither existing instrument reached it. */
const SOURCES = [
  path.join(REPO, 'corpus/committed'),
  path.join(REPO, 'tests/fixtures/pine_oos'),
  path.join(REPO, 'tests/fixtures/member'),
]

function scripts() {
  const out = []
  for (const dir of SOURCES) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith('.pine') || name.endsWith('.txt')) {
        out.push({ dir: path.basename(dir), name, file: path.join(dir, name) })
      }
    }
  }
  return out
}

/** The facts a lane reports about one script. Verdict deliberately excluded. */
function factsOf(src, opts) {
  try {
    const t = translatePine(src, opts)
    return {
      threw: null,
      // ⭐ `ok` IS THE VERDICT, NOT A FACT, and it is carried here only so the
      // verdict CONTROL below can read it instead of translating all 327 scripts a
      // second and third time. ⚠️ It is deliberately excluded from `disagreed`: the
      // verdicts are ALLOWED to differ — that is the two-lanes property.
      ok: t.ok === true,
      outputs: (t.outputs || []).length,
      refusals: (t.refusals || []).length,
      codes: (t.refusals || []).map((r) => r.guard).join(','),
    }
  } catch (err) {
    // ⛔ A THROW IS A FACT TOO, and both lanes must throw the same way. `translatePine`
    // is contracted to RETURN refusals, so a throw is a defect — but if one is present
    // it must at least be symmetric, or the lanes are not reading one script.
    return { threw: String((err && err.guard) || (err && err.name) || 'throw'),
      outputs: -1, refusals: -1, codes: '' }
  }
}

const ALL = scripts()
const rows = ALL.map((s) => {
  const src = fs.readFileSync(s.file, 'utf8')
  return { ...s, strict: factsOf(src, { strict: true }), lenient: factsOf(src, {}) }
})
const disagreed = rows.filter((r) => r.strict.outputs !== r.lenient.outputs
  || r.strict.refusals !== r.lenient.refusals
  || r.strict.codes !== r.lenient.codes
  || r.strict.threw !== r.lenient.threw)

describe('a7.2 — both lanes agree on the facts, across every source', () => {
  it('⭐⭐ the rail reaches all three sources, and Clouds is one of them', () => {
    // ⛔ THE INSTRUMENT MUST BE SEEN TO SEE. A per-script comparison over an empty set
    // passes perfectly, so the population is asserted before anything is concluded
    // from it.
    expect(ALL.length, 'the corpus is not being read at all').toBeGreaterThan(300)
    const byDir = {}
    for (const s of ALL) byDir[s.dir] = (byDir[s.dir] || 0) + 1
    expect(Object.keys(byDir).sort()).toEqual(['committed', 'member', 'pine_oos'])
    expect(ALL.some((s) => s.name === 'uncharted-clouds.pine'),
      'Clouds lives in tests/fixtures/member and neither older instrument reached it')
      .toBe(true)
  })

  it('⭐⭐ OUTPUT COUNT agrees on every one of the 327 — no exceptions', () => {
    // ⭐ The strongest half, and it holds outright: not one script produces a different
    // NUMBER of outputs on the two lanes. Whatever else differs, both lanes are reading
    // the same script and finding the same plots in it.
    const n = rows.filter((r) => r.strict.outputs !== r.lenient.outputs)
    expect(n.map((r) => r.name), 'a lane found a different number of outputs').toEqual([])
  })

  // ⚰️⚰️ RETIRED BY R14 (owner, 2026-09-15) — THE 13-SCRIPT EQUALITY ASSERTION IS GONE.
  //
  // It read: *"FINDING — exactly these 13 differ on refusal facts, and no others"*,
  // over a `FACTS_DIFFER` list of 13 names, and its comment told the next reader that
  // *"fixing one turns this RED and moves the assertion forward."*
  //
  // ⛔ THERE WAS NOTHING TO FIX. Measured at R14 on four scripts from three sources
  // and then on all 13: **a refusal set is a property of the SURFACE, not of the
  // script.** `mode: strict ? 'host' : 'screener'` — the lanes are two surfaces with
  // deliberately different admissibility, and the engine RULES the asymmetry in its
  // own manifest (`closedTable.json::_requirement_tags.window_dependent`: `cum` and
  // `isfirst` are `refused_by` the screener and `accepted_by` the pane). Every
  // screener-only refusal in the 13 falls in that class or is downstream of it; the
  // pane refuses none of them.
  //
  // ⚠️ So this assertion pinned CORRECT BEHAVIOUR as a defect frontier and invited
  // somebody to "fix" it — which would have red a rail for doing the right thing, and
  // in the worst case would have removed the screener's refusal of a fetch-dependent
  // number, which is the one thing `_requirement_tags` exists to contain.
  //
  // ⭐ THE REPLACEMENT IS `refusalsAreASurfaceProperty.test.js`, which classifies each
  // lane-only refusal against the class READ FROM THE ENGINE (`parse.js::
  // hostAdmissible`) rather than listing names here, and whose regression guard is the
  // direction that actually matters: the pane must never refuse a name it declares it
  // accepts.
  //
  // ⭐ WHAT STAYS HERE IS THE HALF THAT WAS ALWAYS RIGHT: output count is
  // lane-independent and agrees on all 327, asserted above. And
  // `smart-money-breakouts-chartprime` is still its own finding below — it THROWS on
  // both lanes identically, so the lanes do not disagree; they fail the same way.

  it('⛔⛔ CONTROL — the verdicts DO differ somewhere, or this proves nothing', () => {
    // ⚰️ Without this the rail passes on an engine where `strict` silently became
    // `lenient` — perfect agreement on every fact AND every verdict, which is exactly
    // the reading that voided a whole round of this programme's evidence. Agreement is
    // only meaningful beside a measured disagreement.
    // ⚰️ THIS RE-READ AND RE-TRANSLATED ALL 327 SCRIPTS TWICE MORE, on top of the
    // module-level walk that had already translated each one on both lanes — three
    // full corpus passes for a fact the first pass already knew. It cost ~4s when
    // every refusing script stopped early, and **19.5s once R18 made the security
    // tuples translate instead of refusing**, which put it over the 15s limit ALONE.
    // ⭐ R18 did not break it; R18 removed the early exits that were hiding the
    // waste. The fix is to read the verdict `factsOf` already captured.
    const verdictDiffers = rows.filter((r) => r.strict.ok !== r.lenient.ok)
    expect(verdictDiffers.length,
      'no script separates the lanes — `strict` is not doing anything').toBeGreaterThan(0)
  })

  it('⛔ CONTROL — the facts are real numbers, not a collapsed zero on both sides', () => {
    // A rail that only compares the lanes to each other stays green if BOTH collapse.
    // So the totals are pinned as numbers.
    const totalOutputs = rows.reduce((n, r) => n + Math.max(0, r.strict.outputs), 0)
    expect(totalOutputs, 'every script produced zero outputs — the engine is not running')
      .toBeGreaterThan(500)
  })

  it('⛔⛔ FINDING — exactly ONE script still THROWS out of translatePine', () => {
    // ⚰️ `translatePine`'s contract is to RETURN refusals; a caller without a try/catch
    // gets an exception where a refusal belongs. This rail rediscovered the defect
    // independently, and it was already known: `pine.js`'s `switchBinding` call site
    // records it by name, measured, and routes it as a corpus item rather than fixing
    // it there ("guessing at a crash path is how a swallowed error becomes a confident
    // finding"). It throws on BOTH lanes, which is at least symmetric.
    // ⭐ Asserted as the exact name so the day it is fixed this goes red and the
    // finding is retired rather than forgotten.
    const throwers = rows.filter((r) => r.strict.threw || r.lenient.threw).map((r) => r.name)
    expect(throwers).toEqual(['smart-money-breakouts-chartprime__ea79c79a67.pine'])
  })
})
