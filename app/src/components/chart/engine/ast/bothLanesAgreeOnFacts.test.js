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

  // ⛔⛔ THE FRONTIER — 13 SCRIPTS WHOSE REFUSAL FACTS DIFFER, ASSERTED AS THEY ARE.
  //
  // a7.2 records these rather than fixing them, and keeps them IN the rail rather than
  // excluding them, so that fixing one turns this RED and moves the assertion forward.
  // An excluded finding is a finding nobody is reminded of.
  //
  // ⚰️ THE SHAPE IS THE OPPOSITE OF WHAT YOU WOULD EXPECT: on several of these the
  // LENIENT lane refuses MORE than strict — `uncharted-volume-v2.pine` is strict 0
  // refusals against lenient 4 × `pine:function`, and `atr-trailing-stoploss` is 0
  // against 5. A lane that "offers what it can" reporting more refusals than the lane
  // that demands everything translate is worth a ruling, not a quiet fix; the outputs
  // agree in every case, so no column is lost either way.
  const FACTS_DIFFER = [
    'atr-trailing-stoploss-strategy__oayb1wVXkZ.pine',
    'atr-trailing-stoploss__2JLLfrGRHg.pine',
    'camarilla__jw9faob08r.pine',
    'cumulative-volume-delta__c772250751.pine',
    'cvd-cumulative-volume-delta-chart__84da7a14bf.pine',
    'fibonacci-retracement-mtflog__54a8dbfa8e.pine',
    'rate-of-change__5efd12f955.pine',
    'smart-money-concepts-by-welotrades__0bff41a2e5.pine',
    'supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df.pine',
    'high_engagement__09-on-balance-volume-everget.pine',
    'high_engagement__20-ehlers-fisher-transform-cheatcountry.pine',
    'uncharted-volume-v2.pine',
    // ⚠️ BOTH member scripts are here, which is worth noticing: the two scripts this
    // whole programme is aimed at are among the thirteen.
    'uncharted-volume.pine',
  ]
  // ⭐ `smart-money-breakouts-chartprime` is NOT in this list, and the reason is a
  // distinction worth keeping: it THROWS on both lanes identically, so the lanes do
  // not DISAGREE — they fail the same way. It is its own finding below.

  it('⛔⛔ FINDING — exactly these 13 differ on refusal facts, and no others', () => {
    // Asserted as a SET, not a count: a count would stay green if one script were fixed
    // and another regressed on the same day.
    expect(disagreed.map((r) => r.name).sort()).toEqual([...FACTS_DIFFER].sort())
  })

  it('⛔⛔ CONTROL — the verdicts DO differ somewhere, or this proves nothing', () => {
    // ⚰️ Without this the rail passes on an engine where `strict` silently became
    // `lenient` — perfect agreement on every fact AND every verdict, which is exactly
    // the reading that voided a whole round of this programme's evidence. Agreement is
    // only meaningful beside a measured disagreement.
    const verdictDiffers = rows.filter((r) => {
      const src = fs.readFileSync(r.file, 'utf8')
      try {
        return translatePine(src, { strict: true }).ok !== translatePine(src, {}).ok
      } catch { return false }
    })
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
