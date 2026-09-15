// app/src/components/chart/engine/ast/refusalsAreASurfaceProperty.test.js
//
// ─── ⭐⭐ R14 — A REFUSAL SET BELONGS TO THE SURFACE, NOT TO THE SCRIPT ──────
//
// Owner ruling, 2026-09-15. `bothLanesAgreeOnFacts.test.js` asserted *"the VERDICTS
// may differ, the FACTS must not"* and counted the refusal set among the facts. It is
// not one, and never was: `mode: strict ? 'host' : 'screener'` — the two lanes are two
// SURFACES with deliberately different admissibility.
//
// ⭐ OUTPUT COUNT IS lane-independent and agrees on all 327. That half was right and
// stays, in the file that already owns it.
//
// ⚰️⚰️ WHAT THE OLD ASSERTION DID WAS WORSE THAN BEING WRONG. It pinned 13 scripts as
// a defect frontier and told the next reader, in its own comment, that *"fixing one
// turns this RED and moves the assertion forward"* — inviting someone to "fix"
// behaviour the engine rules as correct, and to red a rail for doing the right thing.
//
// ⭐⭐ THE CLASSES ARE READ FROM THE ENGINE, NEVER LISTED HERE. `closedTable.json::
// _requirement_tags` is the data — one tag today, `window_dependent`, `calls:
// ["cum","isfirst"]`, `refused_by: [screener,…]`, `accepted_by: ["pane"]` — and
// `parse.js::hostAdmissible(table)` is the derivation, which says in its own comment
// *"DERIVED FROM `_requirement_tags`, NEVER TYPED HERE"*. A literal list in this file
// would be exactly the second authority that function exists to prevent, so this rail
// imports it. A tag added or removed in the manifest moves this rail with it.
//
// ⛔ THERE IS NO HOST-ONLY CLASS TO READ, and inventing one would manufacture a ruling
// the engine does not make. `hostAdmissible`'s own comment: *"IT IS THE ONE PLACE HOST
// MODE IS LOOSER THAN SCREENER MODE … Host mode is otherwise stricter —
// all-or-nothing."* So host-only refusals (`state`, `drawing`, `tuple`,
// `offset-literal`) need no exemption; they are the documented design. What IS asserted
// in that direction is the regression: **the pane must never refuse a name it is
// declared to accept.**
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { TABLE, hostAdmissible } from './parse.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const DIRS = ['corpus/committed', 'tests/fixtures/pine_oos', 'tests/fixtures/member']

/** The 13 measured at a7.2 — kept as the POPULATION to classify, not as a frontier. */
const LANES_DIFFER = [
  'atr-trailing-stoploss-strategy__oayb1wVXkZ.pine', 'atr-trailing-stoploss__2JLLfrGRHg.pine',
  'camarilla__jw9faob08r.pine', 'cumulative-volume-delta__c772250751.pine',
  'cvd-cumulative-volume-delta-chart__84da7a14bf.pine',
  'fibonacci-retracement-mtflog__54a8dbfa8e.pine', 'rate-of-change__5efd12f955.pine',
  'smart-money-concepts-by-welotrades__0bff41a2e5.pine',
  'supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df.pine',
  'high_engagement__09-on-balance-volume-everget.pine',
  'high_engagement__20-ehlers-fisher-transform-cheatcountry.pine',
  'uncharted-volume-v2.pine', 'uncharted-volume.pine',
]

/** ⭐ The four measured in full at R14 2.1/2.2 — three sources. */
const MEASURED_FOUR = [
  'uncharted-volume-v2.pine', 'uncharted-volume.pine',
  'atr-trailing-stoploss__2JLLfrGRHg.pine',
  'high_engagement__09-on-balance-volume-everget.pine',
]

const findScript = (n) => DIRS.map((d) => path.join(REPO, d, n)).find((p) => fs.existsSync(p))
const keyOf = (r) => `${r.guard}::${String(r.message || '').slice(0, 60)}`

/** ⭐⭐ THE CLASSIFIER, PURE, so it can be shown to FAIL on a synthetic input.
 *
 *  `admissible` is the set `hostAdmissible` derives. A screener-only refusal is
 *  EXPLAINED when it names one of those calls, or carries the code that names the
 *  same class. Returns the two answers the ruling turns on. */
export function classify(lenRefusals, strRefusals, admissible) {
  const sk = new Set(strRefusals.map(keyOf))
  const lk = new Set(lenRefusals.map(keyOf))
  const names = [...admissible]
  const mentions = (r) => names.some((c) => String(r.message || '').includes(`\`${c}\``))
  const screenerOnly = lenRefusals.filter((r) => !sk.has(keyOf(r)))
  const hostOnly = strRefusals.filter((r) => !lk.has(keyOf(r)))
  const explained = screenerOnly.filter(
    (r) => r.guard === 'pine:window-dependent' || mentions(r))
  return {
    screenerOnly,
    hostOnly,
    explained,
    // ⛔ THE REGRESSION, and the only one in this direction: the pane refusing a
    // name the manifest declares it accepts.
    paneRefusesAdmissible: hostOnly.filter(mentions),
    unexplained: screenerOnly.filter(
      (r) => !(r.guard === 'pine:window-dependent' || mentions(r))),
  }
}

function lanes(name) {
  const p = findScript(name)
  const src = fs.readFileSync(p, 'utf8')
  const L = translatePine(src, {})
  const S = translatePine(src, { strict: true })
  return { L, S, c: classify(L.refusals || [], S.refusals || [], hostAdmissible(TABLE)) }
}

describe('R14 — a refusal set is a property of the surface', () => {
  it('⛔⛔ NON-VACUITY CONTROL — the class is real and each script really disagrees', () => {
    // Without this every assertion below passes over empty lists: an empty
    // `screenerOnly` satisfies "all explained" perfectly.
    const admissible = hostAdmissible(TABLE)
    expect([...admissible].sort(), 'the engine declares no host-admissible class at '
      + 'all — this rail is reading nothing').toEqual(['cum', 'isfirst'])
    for (const n of MEASURED_FOUR) {
      expect(findScript(n), `${n} is not on disk`).toBeTruthy()
      const { c } = lanes(n)
      expect(c.screenerOnly.length, `${n} produced NO lane-only refusal, so its `
        + 'classification asserts nothing').toBeGreaterThan(0)
    }
  })

  it('⭐⭐ on the four measured scripts, every screener-only refusal is IN CLASS', () => {
    for (const n of MEASURED_FOUR) {
      const { c } = lanes(n)
      expect(c.unexplained.map((r) => `${r.guard}@${r.line}`),
        `${n}: a screener-only refusal outside the declared class`).toEqual([])
    }
  })

  it('⭐ …and their output counts agree, which IS a shared fact', () => {
    for (const n of MEASURED_FOUR) {
      const { L, S } = lanes(n)
      expect((L.outputs || []).length, `${n}: output count is lane-dependent`)
        .toBe((S.outputs || []).length)
    }
  })

  it('⛔⛔ THE REGRESSION GUARD — the pane never refuses a name it declares it accepts', () => {
    for (const n of LANES_DIFFER) {
      if (!findScript(n)) continue
      const { c } = lanes(n)
      expect(c.paneRefusesAdmissible.map((r) => `${r.guard}@${r.line}`),
        `${n}: the HOST lane refused a \`hostAdmissible\` name — the exemption has `
        + 'become a hole in the direction that matters').toEqual([])
    }
  })

  it('⭐⭐ CONTROL — the classifier really FIRES on a synthetic cross-class refusal', () => {
    // ⚰️ Without this, a `classify` broken into `() => ({unexplained: [], …})` passes
    // every assertion above. The corpus is clean, so the only way to show the rail
    // can fail is to hand it something that must fail.
    const admissible = new Set(['cum'])
    const cumRefusal = { guard: 'pine:function', line: 1, message: 'the `cum` total' }
    const shapeRefusal = { guard: 'pine:drawing', line: 2, message: 'a `box` paints' }
    // the pane refusing `cum` — the regression this rail exists for
    const bad = classify([], [cumRefusal], admissible)
    expect(bad.paneRefusesAdmissible).toHaveLength(1)
    // an out-of-class screener-only refusal
    const out = classify([shapeRefusal], [], admissible)
    expect(out.unexplained).toHaveLength(1)
    // …and the honest cases stay clean
    const ok = classify([cumRefusal], [], admissible)
    expect(ok.unexplained).toEqual([])
    expect(ok.explained).toHaveLength(1)
    expect(classify([], [shapeRefusal], admissible).paneRefusesAdmissible).toEqual([])
  })

  it('⛔ THE TWO RECORDED RESIDUES — named, so they cannot grow silently', () => {
    // ⭐ 11 of the 13 classify clean. These two do not, and both are measured
    // rather than excused:
    //
    //  • `rate-of-change` — 12 screener-only refusals ARE in class, and the 13th is
    //    `pine:hidden-only@308`, a WHOLE-SCRIPT verdict downstream of them: once the
    //    class refusals dropped the visible columns, only author-hidden helpers were
    //    left. Explained transitively, not separately.
    //  • `high_engagement__20` — 4 × `pine:request@10` screener-only against 2 ×
    //    `pine:offset-literal@10` host-only. SAME LINE, different code per surface:
    //    both lanes refuse line 10, each for its own surface's reason. No `cum`
    //    anywhere. This is a second, smaller finding and it is pinned, not folded in.
    const roc = lanes('rate-of-change__5efd12f955.pine').c
    expect(roc.explained.length, 'rate-of-change stopped being class-dominated')
      .toBeGreaterThan(0)
    expect(roc.unexplained.map((r) => r.guard)).toEqual(['pine:hidden-only'])

    const h20 = lanes('high_engagement__20-ehlers-fisher-transform-cheatcountry.pine').c
    expect(h20.unexplained.map((r) => `${r.guard}@${r.line}`))
      .toEqual(['pine:request@10', 'pine:request@10', 'pine:request@10', 'pine:request@10'])
    expect(h20.hostOnly.every((r) => r.line === 10),
      'the host-only side of this script moved off line 10').toBe(true)
  })

  it('⛔ the superseded 13-set equality assertion is GONE from the a7.2 rail', () => {
    // ⭐ SELF-RETIRING. R14 replaces that assertion; while it survives, the repo
    // holds two authorities on the same question and the older one calls correct
    // behaviour a defect.
    const src = fs.readFileSync(path.join(
      REPO, 'app/src/components/chart/engine/ast/bothLanesAgreeOnFacts.test.js'), 'utf8')
    expect(src.includes('FACTS_DIFFER'),
      'bothLanesAgreeOnFacts.test.js still pins the 13 as a defect frontier').toBe(false)
  })
})
