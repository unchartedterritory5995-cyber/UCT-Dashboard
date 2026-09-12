// app/src/components/chart/builder/builderInputs.symbolClosure.test.js
//
// ─── ⭐⭐ C0R: A DEFINITION MAY NOT REACH SAVE NAMING A SYMBOL NOBODY DECLARED ──
//
// ⚰️ WHAT THIS FILE EXISTS TO STOP, MEASURED ON THE FROZEN OOS CORPUS.
// Eight of the eighteen accepted scripts imported cleanly, applied cleanly,
// populated the builder — and could not be saved. Every one of them refused with
// the closed table's `sentence:name`, naming an identifier the member never
// typed: `mult`, `Multiplier`, `upLine`, `showMa`, `bandStdevMult`, `GateInp`,
// `showBand`, `lv3`.
//
// ⛔ TWO INDEPENDENT MECHANISMS, AND EACH NEEDED ITS OWN FIX.
//
//   A. THE DOOR DECLARED A NAME IT COULD NOT BACK. `memberInputTranslation`
//      chose what to declare from `e.name` alone, while a ROW additionally
//      requires the name to be a legal member-input KEY — `KEY_RE` *and*
//      lower-case-first. `Multiplier` and `GateInp` are uppercase-initial, so
//      they were declared into the formula and no row could ever exist for them.
//      Fixed by `memberInputKey`, the ONE predicate both sides now compose, plus
//      a measured closure loop that folds back anything still unbacked.
//
//   B. SIBLING OUTPUTS CARRIED FORMULAS WITHOUT THEIR INPUTS. `PineBox`'s
//      hand-back projected each non-selected output to `{source, title,
//      presentation}` and dropped `memberInputs`. Six scripts fail this way and
//      EVERY ONE fails on a sibling, never on output 0 — the selected column's
//      rows were the only ones that travelled.
//
// ⭐ `lv3` NAMES MECHANISM B EXACTLY. `mid_engagement__22-rsi-levels-regime-map`
// selects output 22, whose rows declare `lv1` and `lv2` — which is why the
// refusal could offer *"did you mean `lv1` or `lv2`?"* while `lv3`, named only by
// dropped siblings, was undeclared. It was never partial traversal, ternary
// handling or manifest pruning.
//
// ⛔ NO NAME IN THIS FILE IS VOCABULARY. The audit is `seriesNamesOf` over the
// tree plus the row set — it works for an arbitrary member's variable names, and
// the two mutation controls below fail if it is ever narrowed to a list.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import {
  memberInputTranslation, memberInputKey, seriesNamesOf, unbackedDeclaredInputs,
} from './builderInputs'

const DIR = path.resolve(__dirname, '../../../../../tools/c0_oos_fixtures')

/** The eight C0 SAVE_BLOCKED scripts, with the identifier each refused on. */
const BLOCKED = [
  ['high_engagement__02-waddah-attar-explosion-lazybear', 'mult'],
  // ⚰ R-F (2026-09-12): this one REFUSES now (`pine:state` — its Supertrend band was
  // folding to a 250-bar rolling min), so every loop below passes VACUOUSLY for it: a
  // script with no carried formula reads no unbacked name. Kept because it is the
  // historical record of which eight were save-blocked, and the vacuity is asserted by
  // name in `⚰ one of the eight no longer translates` rather than left to be noticed.
  ['high_engagement__03-supertrend-kivancozbilgic', 'Multiplier'],
  ['high_engagement__12-cm-ultimate-rsi-mtf-chrismoody', 'upLine'],
  ['long_tail__13-volatility-of-returns', 'showMa'],
  ['mid_engagement__07-3way-bollinger-trend', 'bandStdevMult'],
  ['mid_engagement__13-spma-trend', 'GateInp'],
  ['mid_engagement__14-master-line-lite', 'showBand'],
  ['mid_engagement__22-rsi-levels-regime-map', 'lv3'],
]

const read = (n) => fs.readFileSync(path.join(DIR, `${n}.pine`), 'utf8')
const translate = (src) => memberInputTranslation(translatePine, src, { paramManifest: true })

describe('memberInputKey — the one predicate both sides compose', () => {
  it('admits a lower-case-first identifier', () => {
    expect(memberInputKey('showMa')).toBe('showMa')
    expect(memberInputKey('lv3')).toBe('lv3')
    expect(memberInputKey('bandStdevMult')).toBe('bandStdevMult')
  })

  it('refuses an UPPERCASE-initial name — the `Multiplier`/`GateInp` class', () => {
    expect(memberInputKey('Multiplier')).toBeNull()
    expect(memberInputKey('GateInp')).toBeNull()
    // ⭐ AND FOR AN ARBITRARY NAME, not just the two the corpus happened to have.
    expect(memberInputKey('Zephyr')).toBeNull()
  })

  it('refuses a name that is not an identifier at all', () => {
    expect(memberInputKey('')).toBeNull()
    expect(memberInputKey('has space')).toBeNull()
    expect(memberInputKey('3lv')).toBeNull()
    expect(memberInputKey(null)).toBeNull()
  })
})

describe('seriesNamesOf — shape-driven, no vocabulary', () => {
  it('reaches every series name at every depth', () => {
    const tree = { type: 'op', name: '+', args: [
      { type: 'series', name: 'alpha' },
      { type: 'call', name: 'sma', args: [
        { type: 'series', name: 'beta' }, { type: 'num', value: 3 }] },
    ] }
    expect([...seriesNamesOf(tree)].sort()).toEqual(['alpha', 'beta'])
  })

  it('is empty for a tree with no names', () => {
    expect([...seriesNamesOf({ type: 'num', value: 1 })]).toEqual([])
  })
})

describe('⭐⭐ the invariant — every declared name a formula reads is backed by a row', () => {
  for (const [script, identifier] of BLOCKED) {
    it(`${script} closes over its own symbols (was: \`${identifier}\`)`, () => {
      const t = translate(read(script))
      const unbacked = unbackedDeclaredInputs(t.outputs, t.declared)
      expect([...unbacked.keys()]).toEqual([])
    })
  }

  it('holds for the multi-plot fixtures too', () => {
    const dir = path.resolve(__dirname, '../../../../../tests/fixtures/pine_multiplot')
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.pine'))) {
      const t = translate(fs.readFileSync(path.join(dir, f), 'utf8'))
      expect([...unbackedDeclaredInputs(t.outputs, t.declared).keys()], f).toEqual([])
    }
  })
})

describe('⛔ MUTATION CONTROLS — the audit must be able to FAIL', () => {
  // ⭐⭐ WITHOUT THESE THE SUITE ABOVE PASSES WITH THE FIX DELETED. Each control
  // re-implements one half of the old behaviour and asserts the audit catches it,
  // so a future "simplification" back to either shape goes red here first.

  it('the pre-fix `declarable` WOULD have declared a name no row can back', () => {
    // ⚠️ THIS DOCUMENTS THE ORIGINAL DEFECT; IT IS NOT THE GUARD.
    // Measured while writing this file: reverting `declarable` to the old
    // name-only filter leaves all 18 cases GREEN, because the closure loop below
    // removes the offender on its next round. So the loop — not the key
    // predicate — is what actually holds the invariant, and the mutation control
    // that matters is the next test. Saying that here rather than letting a
    // reader assume this line is load-bearing.
    // ⚰ SPECIMEN MOVED 2026-09-12 (R-F). It was `…03-supertrend`/`Multiplier`; that
    // script refuses now, so it has no usable output to fold an input INTO and
    // `oldDeclarable` came back empty. `…13-spma-trend` carries the same class —
    // uppercase-initial names the old filter would have declared — three of them.
    // ⛔ AND THAT LEAVES THE CLASS ON ONE CORPUS SCRIPT, which is the coverage R-F
    // actually cost here. The written witness below restores a second one, under the
    // original name, where no future ruling can take it away.
    const src = read('mid_engagement__13-spma-trend')
    const probe = translatePine(src, { paramManifest: true, declareInputs: 'all' })
    const usable = (probe.outputs || []).filter((o) => !o.refusal && o.formula)
    const oldDeclarable = [...new Set(usable.flatMap(
      (o) => (o.inputsFolded || []).filter((e) => e.name).map((e) => e.name)))]
    expect(oldDeclarable).toContain('GateInp')
    expect(memberInputKey('GateInp')).toBeNull()
    // The shipped door does not declare it, by either mechanism.
    expect(translate(src).declared).not.toContain('GateInp')
  })

  // ⭐⭐ THE CLOSURE LOOP'S OWN WITNESS, AND IT TOOK THREE TRIES TO FIND ONE.
  //
  // ⚰️ MEASURED WHILE WRITING THIS FILE: on the eight OOS scripts the loop and
  // the `memberInputKey` predicate are REDUNDANT — deleting either leaves all
  // eight green, because the key rule already stops the only two offenders that
  // corpus contains. A guard whose deletion changes no test is not covered, and
  // saying "belt and braces" is not evidence.
  //
  // This is the case that separates them: an input the author happens to name
  // `lineWidth`. It is a perfectly legal member-input key, so the predicate
  // admits it — and then `inputsFromFolded` refuses the ROW because every
  // document already declares `lineWidth` as its line-width control.
  //
  // ⛔ AND THE FAILURE IS WORSE THAN THE ONE C0R WAS OPENED FOR. Without the
  // loop the formula reads `close * lineWidth` and it RESOLVES — against the
  // chrome input — so there is no refusal at all: the plot's VALUE silently
  // becomes a function of its own line width, and turning the width knob moves
  // the data. A wrong number that saves beats a right number that will not.
  const COLLIDES_WITH_CHROME = `//@version=5
indicator("Collide", overlay = false)
lineWidth = input.float(2.0, "Mult")
plot(close * lineWidth, title = "X")
`

  it('⛔ THE LOOP IS THE GUARD — a key that collides with a chrome input folds back', () => {
    const t = memberInputTranslation(translatePine, COLLIDES_WITH_CHROME, {})
    // It is a legal key, so the predicate alone would let it through…
    expect(memberInputKey('lineWidth')).toBe('lineWidth')
    // …and no row can exist for it, so the loop must have withdrawn it.
    expect(t.declared).not.toContain('lineWidth')
    const out = (t.outputs || []).find((o) => o && o.formula)
    expect(out.formula).toBe('close * 2')
    expect(seriesNamesOf(out.ast).has('lineWidth')).toBe(false)
    expect([...unbackedDeclaredInputs(t.outputs, t.declared).keys()]).toEqual([])
    // And the member is told which knob did not come across, and why.
    expect((out.skippedInputs || []).some(
      (s) => s.name === 'lineWidth' && /already a name this builder declares/.test(s.reason),
    )).toBe(true)
  })

  it('the skip reason names the KEY rule, not a missing hand-back', () => {
    // ⚰️ The old sentence said *"no bound name on the folded entry … TO UNBLOCK:
    // `usedInputs[]` gaining `name`"* for a name that was RIGHT THERE. It sent
    // this session looking for a hand-back that had shipped long ago. A refusal
    // that names the wrong cause is worse than a vague one.
    // ⚰ 2026-09-12: the `…03-supertrend`/`Multiplier` pair left this loop with R-F — a
    // refused script reports no skipped inputs, because nothing got as far as folding
    // one. `UPPERCASE_INITIAL` below carries that name now.
    for (const [script, id] of [['mid_engagement__13-spma-trend', 'GateInp']]) {
      const t = translate(read(script))
      const hit = (t.outputs || []).flatMap((o) => o.skippedInputs || [])
        .find((s) => s && s.name === id)
      expect(hit, `${script}: ${id} should be reported as skipped`).toBeTruthy()
      expect(hit.reason).toMatch(/not a legal member-input key/)
      expect(hit.reason).not.toMatch(/no bound name/)
    }
  })

  // ⭐⭐ THE WRITTEN WITNESS FOR THE UPPERCASE-INITIAL CLASS (2026-09-12). The class had
  // two corpus witnesses, `Multiplier` and `GateInp`; R-F removed the script the first
  // one lived in. A class held up by ONE fixture is one ruling away from being held up
  // by none — this repo's own lesson — so the name that opened C0R keeps a home that
  // does not depend on any published script continuing to translate.
  const UPPERCASE_INITIAL = `//@version=5
indicator("Upper", overlay = false)
Multiplier = input.float(2.0, "Multiplier")
plot(ta.atr(14) * Multiplier, title = "X")
`

  it('⭐ `Multiplier` keeps its witness — declared by nobody, folded, and reported', () => {
    const t = translate(UPPERCASE_INITIAL)
    expect(memberInputKey('Multiplier')).toBeNull()
    expect(t.declared).not.toContain('Multiplier')
    const out = (t.outputs || []).find((o) => o && o.formula)
    // ⭐ THE COLUMN IS STILL RIGHT — the default folds in, so the member loses the KNOB
    // and not the indicator. That distinction is the whole argument of the skip reason.
    expect(out.formula).toBe('atr(high, low, close, 14) * 2')
    expect(seriesNamesOf(out.ast).has('Multiplier')).toBe(false)
    expect([...unbackedDeclaredInputs(t.outputs, t.declared).keys()]).toEqual([])
    const hit = (out.skippedInputs || []).find((x) => x && x.name === 'Multiplier')
    expect(hit, 'Multiplier must be reported as skipped').toBeTruthy()
    expect(hit.reason).toMatch(/not a legal member-input key/)
    expect(hit.reason).not.toMatch(/no bound name/)
  })

  it('⚰ one of the eight is down to a single column, and it is the SCAFFOLDING', () => {
    // ⛔ A VACUOUS PASS IS A SILENT LOSS OF COVERAGE unless somebody writes down which
    // row went quiet. Under R-F `…03-supertrend` keeps ONE of its ten columns and the
    // other nine refuse at `pine:state`, so every loop over BLOCKED still visits it and
    // learns nothing about declared names — it declares none.
    //
    // ⚠⚠ AND THE ONE THAT SURVIVES IS `ohlc4`: the author's fill edge, not the band.
    // The door therefore SELECTS it — `selected` is that output — so an import of this
    // script offers a column called Supertrend that is the average of the bar. The
    // refusals are named beside it, which is the door's stated policy, and whether a
    // scaffolding column may be the SELECTED one is a product question this test does
    // not settle. It is written down here because it is now reachable.
    const t = translate(read('high_engagement__03-supertrend-kivancozbilgic'))
    const carried = (t.outputs || []).filter((o) => o && o.formula && !o.hidden)
    expect(carried).toHaveLength(1)
    expect(carried[0].formula).toBe('(open + high + low + close) / 4')
    expect(t.outputs[t.selected]).toBe(carried[0])
    expect(t.declared || []).toEqual([])
    const guards = (t.outputs || []).filter((o) => o.refusal).map((o) => o.refusal.guard)
    expect(guards).toHaveLength(9)
    expect(new Set(guards)).toEqual(new Set(['pine:state']))
  })

  it('an output whose rows are stripped IS reported unbacked — control for the audit', () => {
    const t = translate(read('mid_engagement__22-rsi-levels-regime-map'))
    expect([...unbackedDeclaredInputs(t.outputs, t.declared).keys()]).toEqual([])
    // Strip the rows from every output but keep the formulas: the audit must
    // notice. A probe that cannot see this cannot see mechanism B either.
    const stripped = (t.outputs || []).map((o) => ({ ...o, memberInputs: [] }))
    const missed = unbackedDeclaredInputs(stripped, t.declared)
    expect(missed.size).toBeGreaterThan(0)
    expect([...missed.keys()]).toContain('lv3')
  })
})

describe('⭐ every carried output brings its own inputs — mechanism B, at the source', () => {
  it('a sibling output that reads an input reports it in `memberInputs`', () => {
    const t = translate(read('mid_engagement__22-rsi-levels-regime-map'))
    const byTitle = (title) => (t.outputs || []).find((o) => o && o.title === title)
    const lv3Out = byTitle('Rung 3 — equilibrium')
    expect(lv3Out).toBeTruthy()
    expect(seriesNamesOf(lv3Out.ast).has('lv3')).toBe(true)
    expect((lv3Out.memberInputs || []).map((r) => r.key)).toContain('lv3')
    // ⛔ AND IT IS NOT THE SELECTED OUTPUT — which is the whole point. If this
    // ever becomes output 0 the case stops testing the sibling path, so the
    // assertion names the condition rather than the index.
    expect(t.outputs[t.selected]).not.toBe(lv3Out)
    expect((t.outputs[t.selected].memberInputs || []).map((r) => r.key)).not.toContain('lv3')
  })

  it('the union over carried outputs covers every name any carried formula reads', () => {
    for (const [script] of BLOCKED) {
      const t = translate(read(script))
      const carried = (t.outputs || []).filter((o) => o && o.formula && !o.hidden).slice(0, 12)
      const union = new Set(carried.flatMap((o) => (o.memberInputs || []).map((r) => r.key)))
      const declaredSet = new Set(t.declared)
      for (const o of carried) {
        for (const n of seriesNamesOf(o.ast || {})) {
          if (declaredSet.has(n)) expect(union.has(n), `${script}: ${n}`).toBe(true)
        }
      }
    }
  })
})
