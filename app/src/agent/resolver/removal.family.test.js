// ── D31 RESOLVER · REMOVAL FAMILY · the GENERATED suites (design §6), policy-scored ───────────────────────────────────────
// matrix (words × plan targets) · metamorphic M1–M7 · model-based sequences · the score: correct apply +1, unnecessary ask −0.25,
// wrong refuse −0.5, WRONG-TARGET APPLY = FAIL. The over-ask rate may only ratchet DOWN from resolver/baseline/removal.json.
// A failing sequence prints its seed and a delta-shrunk command list.
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from '../builtins'
import { resolve } from './resolve'
import { matrixCases, metamorphicCases, sequenceRuns, VERBS, PRONOUNS } from './testing/generate'
import baseline from './baseline/removal.json'

registerBuiltins()

const verdict = (c) => resolve({ words: { typed: c.words, carried: c.carried || c.world?.offers?.carried || null }, planTargets: c.plan, world: c.world }).verdict
const score = { cases: 0, apply: 0, overAsk: 0, wrongRefuse: 0, wrongApply: [], points: 0 }
function scored(c, got) {
  score.cases++
  if (got === 'resolved' && c.expect !== 'resolved') { score.wrongApply.push(c.id || c.cmd); score.points = -Infinity }
  else if (got === 'resolved') { score.apply++; score.points += 1 }
  else if (c.expect === 'resolved' && got === 'ask') { score.overAsk++; score.points -= 0.25 }
  else if (c.expect === 'resolved' && got === 'refuse') { score.wrongRefuse++; score.points -= 0.5 }
}

describe('generated vocabularies are the live readers’ own', () => {
  it('verbs and pronouns are non-empty and accepted by chartRail', () => {
    expect(VERBS.length).toBeGreaterThanOrEqual(5)
    expect(PRONOUNS).toEqual(expect.arrayContaining(['it', 'that', 'this one']))
  })
})

const MATRIX = matrixCases(31)
describe(`MATRIX · words × plan targets (${MATRIX.length} cells, seed 31)`, () => {
  it('every cell gets the policy verdict; no wrong-target apply', () => {
    const bad = []
    for (const c of MATRIX) {
      const got = verdict(c)
      scored(c, got)
      if (got !== c.expect) bad.push(`${c.id} [${c.form}/${c.col}] "${c.words}" plan ${c.plan} sel ${c.world.selection} sub ${c.world.subject} → ${got}, want ${c.expect}`)
    }
    expect(bad).toEqual([])
  })
  it('covers every referring form × column', () => {
    const forms = new Set(MATRIX.map(c => c.form))
    expect([...forms].sort()).toEqual(['appos-chart', 'appos-thing', 'container-chart', 'container-thing', 'continuation', 'named', 'named-lower', 'negated', 'none', 'ordinal', 'plan-only', 'plural', 'pointer', 'position-after', 'subject'])
    expect(MATRIX.length).toBeGreaterThanOrEqual(800)
  })
})

const MM = metamorphicCases(32)
describe(`METAMORPHIC · M1–M7 (${MM.length} cases, seed 32)`, () => {
  for (const rel of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']) {
    it(`${rel} holds`, () => {
      const bad = []
      for (const c of MM.filter(x => x.rel === rel)) {
        const got = verdict(c)
        scored(c, got)
        if (got !== c.expect) bad.push(`${c.id} "${c.words}" plan ${c.plan} sel ${c.world.selection} → ${got}, want ${c.expect}`)
      }
      expect(bad).toEqual([])
    })
  }
})

// a failing run is shrunk: drop one earlier step at a time while the failing step still fails
function shrink(run, at) {
  let steps = run.steps.slice(0, at + 1)
  for (let i = steps.length - 2; i >= 0; i--) {
    const t = [...steps.slice(0, i), ...steps.slice(i + 1)]
    const last = t[t.length - 1]
    if (last.plan && verdict(last) !== last.expect) steps = t
  }
  return steps.map(s => s.cmd)
}
const RUNS = sequenceRuns(33)
describe(`SEQUENCES · model-based open / add / select / close / undo / answer (${RUNS.length} runs, seed 33)`, () => {
  it('after every step the resolver gives the model’s referent', () => {
    const bad = []
    let checked = 0
    for (const run of RUNS) {
      run.steps.forEach((s, i) => {
        if (!s.plan) return
        checked++
        const got = verdict(s)
        scored(s, got)
        if (got !== s.expect) bad.push(`seed ${run.seed} step ${i} ${s.cmd} "${s.words}" plan ${s.plan} → ${got}, want ${s.expect} · shrunk: ${shrink(run, i).join(' → ')}`)
      })
    }
    expect(checked).toBeGreaterThanOrEqual(150)
    expect(bad).toEqual([])
  })
})

describe('SCORE · policy-scored outcomes over every generated case', () => {
  it('zero wrong-target applies; the over-ask rate at or below the locked baseline', () => {
    expect(score.wrongApply).toEqual([])
    const rate = score.overAsk / Math.max(1, score.cases)
    expect(score.cases).toBeGreaterThanOrEqual(1500)
    expect(rate).toBeLessThanOrEqual(baseline.overAskRate)
    expect(score.wrongRefuse / Math.max(1, score.cases)).toBeLessThanOrEqual(baseline.wrongRefuseRate)
    if (globalThis.process?.env?.RESOLVER_REPORT) console.log(`SCORE: cases ${score.cases} · applies ${score.apply} · over-ask ${score.overAsk} (${rate.toFixed(4)}) · wrong refuse ${score.wrongRefuse} · points ${score.points}`)
  })
})
