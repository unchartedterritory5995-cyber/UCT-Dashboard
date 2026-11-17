// ── D31 RESOLVER P2 · the RELATION FAMILIES, generated (testing/relations.js) — protects families, never single phrases ─────
// paraphrase × target shape (2–4 charts, linked pairs) × anchor kind (click · conversation chart · previous chart · negated ·
// named · none) × ambiguity (the model's candidate count) × plan column, then the confirmation (answer / bare confirm / stale
// offer) and undo follow-ups. Expected outcomes are the reference model's (written apart from the resolver). Zero wrong-target
// applies, zero anchor-as-target applies; each family × shape × anchor cell must be exercised.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from '../builtins'
import { resolve } from './resolve'
import { relationCases, confirmationCases, undoCases, PARAPHRASES } from './testing/relations'

registerBuiltins()

const run = (c) => resolve({ words: { typed: c.words, carried: c.carried || null }, planTargets: c.plan, world: c.world })
const line = (c, rz) => `${c.id} [${c.family}/${c.shape || c.step}/${c.anchorKind || ''}/${c.col}] "${c.words}" sel ${c.world.selection} sub ${c.world.subject} prev ${c.world.previous} plan ${c.plan} → ${rz.verdict} (${rz.reason}), want ${c.expect}`
function check(cases) {
  const bad = [], wrongApply = []
  for (const c of cases) {
    const rz = run(c)
    if (rz.verdict === 'resolved' && c.expect !== 'resolved') wrongApply.push(line(c, rz))
    else if (rz.verdict !== c.expect) bad.push(line(c, rz))
  }
  return { bad, wrongApply }
}

const REL = relationCases(41)
describe(`RELATION FAMILIES · generated (${REL.length} cases, seed 41)`, () => {
  for (const fam of ['complement', 'everyOther', 'both', 'order', 'neighbour']) {
    it(`${fam}: every case gets the model's verdict; no wrong-target apply`, () => {
      const cs = REL.filter(c => c.family === fam)
      expect(cs.length).toBeGreaterThan(20)
      const { bad, wrongApply } = check(cs)
      expect(wrongApply).toEqual([])
      expect(bad).toEqual([])
    })
  }
  it('the anchor is never the target: every anchor column is refused', () => {
    const cs = REL.filter(c => c.col === 'anchor' || c.col === 'referentAndAnchor')
    expect(cs.length).toBeGreaterThan(40)
    for (const c of cs) expect(run(c).verdict, line(c, run(c))).toBe('refuse')
  })
  it('covers family × shape × anchor kind, resolved AND asked outcomes per family', () => {
    const cells = new Set(REL.map(c => `${c.family}/${c.shape}/${c.anchorKind}`))
    expect(cells.size).toBeGreaterThanOrEqual(50)
    for (const fam of ['complement', 'both', 'order', 'neighbour']) {
      const xs = REL.filter(c => c.family === fam)
      expect(xs.some(c => c.expect === 'resolved'), fam).toBe(true)
      expect(xs.some(c => c.expect === 'ask'), fam).toBe(true)
    }
    for (const sh of ['two', 'three', 'four', 'three-linked', 'four-linked']) expect(REL.some(c => c.shape === sh)).toBe(true)
    for (const a of ['click', 'subject', 'previous', 'none', 'negated', 'named']) expect(REL.some(c => c.anchorKind === a), a).toBe(true)
  })
  it('every paraphrase of a family gets the same verdict on the same world and plan (metamorphic)', () => {
    const groups = new Map()
    for (const c of REL) {
      const key = JSON.stringify([c.family, c.shape, c.anchorKind, c.world.selection, c.world.subject, c.world.previous, c.plan, c.model.n ?? null, !!c.model.plural, c.col])
      if (!groups.has(key)) groups.set(key, new Set())
      groups.get(key).add(c.expect)
    }
    // (the model is a function of the key — a paraphrase never changes the expectation; the per-family tests check the resolver)
    for (const [k, v] of groups) expect(v.size, k).toBe(1)
    expect(PARAPHRASES.complementSet.length + PARAPHRASES.complementOne.length + PARAPHRASES.both.length).toBeGreaterThanOrEqual(12)
  })
})

const CF = confirmationCases(REL)
describe(`RELATION FAMILIES · confirmation follow-ups (${CF.length} cases)`, () => {
  it('an asked relation: the answer resolves that offer, a bare confirm over 2+ offers asks again, a stale answer refuses', () => {
    expect(CF.length).toBeGreaterThan(40)
    const { bad, wrongApply } = check(CF)
    expect(wrongApply).toEqual([])
    expect(bad).toEqual([])
    for (const col of ['answerNumber', 'answerOrdinal', 'answerWrongPlan', 'bareConfirm', 'staleAnswer']) expect(CF.some(c => c.col === col), col).toBe(true)
  })
})

const UNDO = undoCases(42)
describe(`RELATION FAMILIES · undo follow-ups (${UNDO.length} cases)`, () => {
  it('the anchor the previous step made resolves the relation; after undo there is no anchor → asked', () => {
    const { bad, wrongApply } = check(UNDO)
    expect(wrongApply).toEqual([])
    expect(bad).toEqual([])
    expect(UNDO.some(c => c.step === 'afterUndo' && c.expect === 'ask')).toBe(true)
    expect(UNDO.some(c => c.step === 'afterOpen' && c.expect === 'resolved')).toBe(true)
  })
})
