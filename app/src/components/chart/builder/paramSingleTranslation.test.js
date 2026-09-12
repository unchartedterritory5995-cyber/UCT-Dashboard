// app/src/components/chart/builder/c2dProbe.test.js
//
// ─── C2D.1/.2/.5: ONE TRANSLATION, AND THE PARAMETERS IT PLACES ─────────────
//
// ⚰️ THE DEFECT THIS FILE PINS, MEASURED BEFORE IT WAS FIXED. `PineBox` built
// the Track F manifest from a SECOND `translatePine(text, {paramManifest:true})`
// call while the sheet saved the trees from `memberInputTranslation`. Those two
// translations are not the same program:
//
//   …03-supertrend-kivancozbilgic   output 0 astHash  3711a943663c vs 0087b364c04b
//   …22-rsi-levels-regime-map       output 0 astHash  dce8efd7442a vs 52e3309a4163
//   …12-cm-ultimate-rsi-mtf         SEVEN outputs in one pass, SIX in the other
//
// So one of each complex script's two controls carried an `astPath` that walked
// into an argument slot the saved node does not have, and reconciled to
// `detached` forever. The third line is worse than the first two: `PineBox`'s
// own comment asserted the two passes "share the same statement-order-derived
// indexing", and `chosen` indexed both.
//
// ⛔ THE INVARIANT, AND WHAT MAKES IT CHECKABLE: the manifest and the saved
// computation now come from ONE translation, so every locator can be WALKED
// through the tree that is actually saved and must land on a numeric literal.
// That is what every test below does — it never trusts the manifest's own
// account of itself.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import { memberInputTranslation } from './builderInputs'
import { paramLocatorsIn, manifestFromPlacements } from './pineParamManifest'
import { astHash, parseFormula } from '../engine/ast/parse'

const OOS = path.resolve(process.cwd(), '../tools/c0_oos_fixtures')

// ⚰⚰ `…03-supertrend-kivancozbilgic` LEFT THIS LIST ON 2026-09-12, BY RULING R-F,
// AND IT IS NOT A REGRESSION. R-F took `min`/`max` out of the seed-forgetting admit
// set, so that script's Supertrend band — which this engine was folding to a 250-bar
// rolling min wearing a running band's name — refuses at `pine:state`. A refused
// script has no saved tree, so it can place no locators and no parameters: every
// assertion here would be measuring an empty document.
//
// ⛔ IT IS NOT SILENTLY DROPPED. The script moves to `REFUSED_BY_RF` below, which
// asserts the refusal by guard, so the day it translates again this file says so
// instead of quietly covering less than it reads as covering — which is exactly what
// the first describe would have done (0 outputs === 0 outputs passes byte-identity).
const COMPLEX = [
  'mid_engagement__22-rsi-levels-regime-map',
  'high_engagement__12-cm-ultimate-rsi-mtf-chrismoody',
  'mid_engagement__14-master-line-lite',
]

const REFUSED_BY_RF = 'high_engagement__03-supertrend-kivancozbilgic'

const read = (n) => fs.readFileSync(path.join(OOS, `${n}.pine`), 'utf8')
const kept = (t) => (t.outputs || []).filter((o) => o && o.ast && o.formula && !o.hidden)

describe('C2D.1 — the option is inert on the saved computation', () => {
  for (const name of COMPLEX) {
    it(`${name}: trees are byte-identical with and without paramManifest`, () => {
      // ⛔ THE PRECONDITION FOR FOLDING THE TWO TRANSLATIONS INTO ONE. If asking
      // for parameters changed what gets computed, this fix would be trading a
      // detached control for a different indicator.
      const src = read(name)
      const without = kept(memberInputTranslation(translatePine, src, {}))
      const with_ = kept(memberInputTranslation(translatePine, src, { paramManifest: true }))
      expect(with_.length).toBe(without.length)
      without.forEach((o, i) => {
        expect(astHash(with_[i].ast), `output ${i}`).toBe(astHash(o.ast))
      })
    })
  }
})

describe('C2D.1 — every locator resolves against the tree that is SAVED', () => {
  for (const name of COMPLEX) {
    it(name, () => {
      const src = read(name)
      const t = memberInputTranslation(translatePine, src, { paramManifest: true })
      const outs = kept(t).slice(0, 12)
      const placements = outs.map((o, i) => ({
        treeIndex: i === 0 ? 'value' : `out${i + 1}`,
        locators: paramLocatorsIn(t.inputParams || [], o.ast),
      }))
      const manifest = manifestFromPlacements(t.inputParams || [], placements)
      const trees = Object.fromEntries(outs.map((o, i) => [
        i === 0 ? 'value' : `out${i + 1}`, o.ast]))

      let checked = 0
      for (const [pid, entry] of Object.entries(manifest)) {
        expect(entry.locators.length, `${pid} has locators`).toBeGreaterThan(0)
        for (const loc of entry.locators) {
          let node = trees[loc.treeIndex]
          expect(node, `${pid}: tree ${loc.treeIndex}`).toBeTruthy()
          for (const step of loc.astPath) node = node === undefined ? undefined : node[step]
          // ⛔ THE ASSERTION THE OLD SHAPE COULD NOT PASS.
          expect(node, `${pid} @ ${loc.treeIndex}.${loc.astPath.join('.')}`)
            .toMatchObject({ type: 'num' })
          checked += 1
        }
      }
      // eslint-disable-next-line no-console
      console.log(`  ${name}: ${Object.keys(manifest).length} parameters, ${checked} locators, all resolve`)
      expect(checked).toBeGreaterThan(0)
    })
  }
})

describe('⚰ the specimen R-F removed, asserted rather than forgotten', () => {
  it(`${REFUSED_BY_RF} refuses at pine:state and therefore places nothing`, () => {
    // ⛔ THE POINT OF THIS TEST IS THE DAY IT GOES RED. If the fold is ever restored
    // — or narrowed to a contracting coefficient, which R-F's own note says is the one
    // line it would take — this script translates again and belongs back in `COMPLEX`,
    // where its ten-plot Multiplier is the best locator-spread case the set holds.
    const src = read(REFUSED_BY_RF)
    const guards = [...new Set((translatePine(src).refusals || []).map((r) => r.guard))]
    expect(guards).toEqual(['pine:state'])
    const t = memberInputTranslation(translatePine, src, { paramManifest: true })
    const outs = kept(t)
    expect(outs.length).toBeLessThan(2)
    // ⚠ THE PARAMETERS ARE STILL MINTED — three of them — because minting reads the
    // script's `input.*` calls, which a refusal does not erase. What has gone is every
    // PLACE to put them: with no saved tree there are no locators, so the manifest the
    // door would carry is empty. Asserted on the manifest rather than on `inputParams`,
    // because that is the artifact the save door sends.
    expect((t.inputParams || []).length).toBeGreaterThan(0)
    const manifest = manifestFromPlacements(t.inputParams || [], outs.map((o, i) => ({
      treeIndex: i === 0 ? 'value' : `out${i + 1}`,
      locators: paramLocatorsIn(t.inputParams || [], o.ast),
    })))
    expect(Object.keys(manifest)).toEqual([])
  })
})

describe('C2D.2 — a parameter that feeds many plots is located in ALL of them', () => {
  it('…14-master-line-lite: one Pine input reaches every tree that uses it', () => {
    // ⚰️ Pre-C2D this parameter was located in the CHOSEN output only, so moving
    // the slider would have rewritten one tree and left the others holding the
    // old literal — one Pine input, ten plots, two different values.
    //
    // ⚰ THE SPECIMEN MOVED 2026-09-12 (R-F — see `REFUSED_BY_RF`). It was
    // `…03-supertrend`, whose Multiplier reached ten plots. Measured replacement on
    // the same day: `…14-master-line-lite` places ONE Pine input across SEVEN trees
    // in 95 locators, which is the same shape and a wider spread. The claim is
    // unchanged; only the script carrying it is.
    const src = read('mid_engagement__14-master-line-lite')
    const t = memberInputTranslation(translatePine, src, { paramManifest: true })
    const outs = kept(t).slice(0, 12)
    const placements = outs.map((o, i) => ({
      treeIndex: i === 0 ? 'value' : `out${i + 1}`,
      locators: paramLocatorsIn(t.inputParams || [], o.ast),
    }))
    const manifest = manifestFromPlacements(t.inputParams || [], placements)
    const spread = Object.values(manifest).map(
      (e) => new Set(e.locators.map((l) => l.treeIndex)).size)
    expect(Math.max(...spread), 'at least one parameter spans several plots')
      .toBeGreaterThan(1)
  })

  it('⛔ THE CONTROL: a parameter used by ONE plot is not spread across others', () => {
    const t = memberInputTranslation(translatePine,
      'indicator("x")\nlen = input.int(14)\nplot(ta.sma(close, len))\nplot(close)\n',
      { paramManifest: true })
    const outs = kept(t)
    const placements = outs.map((o, i) => ({
      treeIndex: i === 0 ? 'value' : `out${i + 1}`,
      locators: paramLocatorsIn(t.inputParams || [], o.ast),
    }))
    const manifest = manifestFromPlacements(t.inputParams || [], placements)
    for (const e of Object.values(manifest)) {
      expect([...new Set(e.locators.map((l) => l.treeIndex))]).toEqual(['value'])
    }
  })
})

describe('C2D.1 — a declared member input is NOT also a Track F parameter', () => {
  it('one Pine input gets exactly one control', () => {
    // ⛔ TWO AUTHORITIES OVER ONE INPUT IS THE DEFECT, NOT THE FEATURE. The old
    // second translation declared nothing, so an input that BECAME a member
    // input (an identifier in the saved tree, edited in the inputs panel) also
    // minted a Track F parameter pointing at a literal that no longer exists in
    // the saved tree. The mint's own early return for a declared input is what
    // keeps the two sets disjoint — this asserts the disjointness rather than
    // the mechanism.
    // ⚰ SPECIMEN MOVED 2026-09-12 (R-F). It was `…03-supertrend`, which declared
    // nothing once it refused — so `declared.size > 0` was the assertion that caught
    // the change. Measured replacement: `…22-rsi-levels-regime-map` declares TEN
    // member inputs beside two Track F parameters, the largest disjointness case the
    // frozen set holds.
    const src = read('mid_engagement__22-rsi-levels-regime-map')
    const t = memberInputTranslation(translatePine, src, { paramManifest: true })
    const declared = new Set(t.declared || [])
    expect(declared.size).toBeGreaterThan(0)
    for (const p of (t.inputParams || [])) {
      expect(declared.has(p.sourceName), `${p.sourceName} is claimed twice`).toBe(false)
    }
  })
})

describe('C2D.1 — print/parse does not move a locator', () => {
  it('the sheet re-parses the printed text, and the astPath still lands', () => {
    // The sheet saves `evaluateFormula(o.formula).ast`, a FRESH parse of the
    // printed text — not the translator's own object. `verifyRoundTrip` proves
    // print+parse yields an identical `astHash`, and an identical hash over this
    // canonical grammar means an identical STRUCTURE (`assertCanonical`'s
    // exact-key-set rule is what makes that true), so positions carry. That
    // argument was always sound; it was the OTHER translation that broke.
    const src = read('mid_engagement__22-rsi-levels-regime-map')
    const t = memberInputTranslation(translatePine, src, { paramManifest: true })
    const outs = kept(t).slice(0, 12)
    let checked = 0
    outs.forEach((o) => {
      const locs = paramLocatorsIn(t.inputParams || [], o.ast)
      if (!locs.length) return
      const re = parseFormula(o.formula)
      expect(re.ok).toBe(true)
      expect(astHash(re.ast)).toBe(astHash(o.ast))
      for (const loc of locs) {
        let node = re.ast
        for (const step of loc.astPath) node = node === undefined ? undefined : node[step]
        expect(node).toMatchObject({ type: 'num' })
        checked += 1
      }
    })
    expect(checked).toBeGreaterThan(0)
  })
})
