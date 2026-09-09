// app/src/components/chart/engine/ast/pine.timeout.test.js
//
// ─── R1.1(a) — A HANG MUST BECOME A REFUSAL, AND NEVER TAKE THE BATCH ───────
//
// ⛔ A HANG IS A WORSE FAILURE THAN A REFUSAL. A refused script is one datum; a
// script that never returns kills the whole run and reports nothing — the batch
// cannot even say which file did it. That is not hypothetical: a published
// Parabolic SAR does exactly this, and it was found only because the survey
// runner names each file on disk BEFORE entering the translator.
//
// ⭐⭐ THIS FILE IS WHY `pine:timeout` MAY SIT ON THE "UNEXERCISED" LIST IN
// `pine.guardCensus.test.js`. No healthy corpus script should ever trip it, so
// the corpus can never prove it works. A guard nobody has seen fire is not a
// guard — so it is proven here instead, by asking a perfectly normal script to
// stop at an absurdly small budget and checking it refuses BY NAME.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, PINE_TRANSLATE_BUDGET_MS, PINE_TRANSLATE_MAX_STEPS } from './pine.js'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''))
const REPO = path.resolve(HERE, '../../../../../..')
const NORMAL = path.join(REPO, 'tests/fixtures/pine/10-supertrend.pine')
const source = fs.readFileSync(NORMAL, 'utf8')

const guardsOf = (r) => [...new Set((r.refusals || []).map((x) => x.guard))]
const timeoutsOf = (r) => (r.refusals || []).filter((x) => x.guard === 'pine:timeout')

describe('pine:timeout — the step cap', () => {
  it('⛔ refuses by name when a script outruns the step cap', () => {
    const r = translatePine(source, { strict: true, maxSteps: 100, sourcePath: NORMAL })
    expect(guardsOf(r)).toContain('pine:timeout')
    expect(timeoutsOf(r)[0].message).toMatch(/expansion passed 100 resolution steps/)
  })

  it('names the script, so a batch says WHICH file', () => {
    const r = translatePine(source, { strict: true, maxSteps: 100, sourcePath: 'corpus/committed/x.pine' })
    expect(timeoutsOf(r)[0].message).toContain('corpus/committed/x.pine')
  })

  it('says it is a translator defect, not a limit on the member\'s script', () => {
    // ⚠️ The wording matters. A member who sees "budget exceeded" will rewrite a
    // perfectly good script; the refusal has to say the fault is ours.
    const r = translatePine(source, { strict: true, maxSteps: 100 })
    expect(timeoutsOf(r)[0].message).toMatch(/translator defect, not a limit on the script/)
  })

  it('⭐ THE CONTROL: the same script is clean at the shipped cap', () => {
    // Without this, "it refuses at 100" is satisfied by a guard that refuses
    // everything always — which would take the whole corpus with it.
    const r = translatePine(source, { strict: true })
    expect(guardsOf(r)).not.toContain('pine:timeout')
  })

  it('⛔ the cap is checked OUTSIDE the sampling mask', () => {
    // The first version gated the step cap behind the same 4096-step mask as the
    // clock, which made every cap below 4096 UNREACHABLE — a guard that could not
    // fire, and it looked entirely correct in review. Small caps must be honoured.
    for (const maxSteps of [1, 10, 100, 500]) {
      const r = translatePine(source, { strict: true, maxSteps })
      expect(guardsOf(r), `maxSteps=${maxSteps}`).toContain('pine:timeout')
    }
  })

  it('⚠️ the cap is PER RESOLVER, not per script', () => {
    // `translatePine` builds one Resolver per output plus one for the object
    // pass, and `budgetSteps` lives on the Resolver. So the cap bounds a single
    // resolution, not the script's total work: this script takes ~6,500 steps
    // overall but its largest single resolution is under 1,000, which is why a
    // cap of 1,000 is already clean. Anyone reading the shipped 5,000,000 as a
    // whole-script ceiling would be over-estimating the headroom.
    expect(guardsOf(translatePine(source, { strict: true, maxSteps: 500 }))).toContain('pine:timeout')
    expect(guardsOf(translatePine(source, { strict: true, maxSteps: 1000 }))).not.toContain('pine:timeout')
  })

  it('a cap of 0 disables the step guard', () => {
    const r = translatePine(source, { strict: true, maxSteps: 0 })
    expect(guardsOf(r)).not.toContain('pine:timeout')
  })
})

describe('pine:timeout — the wall clock', () => {
  it('refuses by name when the deadline has passed', () => {
    // A budget of 1ms is gone before the first sampling boundary is reached.
    const r = translatePine(source, { strict: true, budgetMs: 1, maxSteps: 0, sourcePath: NORMAL })
    expect(guardsOf(r)).toContain('pine:timeout')
    expect(timeoutsOf(r)[0].message).toMatch(/gave up after 1ms/)
  })

  it('⭐ THE CONTROL: the same script is clean at the shipped budget', () => {
    const r = translatePine(source, { strict: true, budgetMs: PINE_TRANSLATE_BUDGET_MS })
    expect(guardsOf(r)).not.toContain('pine:timeout')
  })

  it('a budget of 0 disables the clock', () => {
    const r = translatePine(source, { strict: true, budgetMs: 0, maxSteps: 0 })
    expect(guardsOf(r)).not.toContain('pine:timeout')
  })

  it('the window is always closed, so a later call cannot inherit a dead deadline', () => {
    // ⛔ A budget left open would make the NEXT translation throw a timeout it
    // never earned. Run an expired one, then a normal one, in that order.
    translatePine(source, { strict: true, budgetMs: 1, maxSteps: 0 })
    const after = translatePine(source, { strict: true })
    expect(guardsOf(after)).not.toContain('pine:timeout')
  })
})

describe('the shipped numbers are measured, not guessed', () => {
  it('the budget is ~30x the slowest legitimate script', () => {
    // Slowest of 434 scripts: 322ms (tools/pine_survey/r11_translate_timings.json).
    expect(PINE_TRANSLATE_BUDGET_MS).toBe(10000)
    expect(PINE_TRANSLATE_BUDGET_MS / 322).toBeGreaterThan(25)
  })

  it('the step cap is ~30x the most resolution-hungry legitimate script', () => {
    // Most steps of 396 scripts: 167,336 (artemis-oscillator-pro).
    expect(PINE_TRANSLATE_MAX_STEPS).toBe(5000000)
    expect(PINE_TRANSLATE_MAX_STEPS / 167336).toBeGreaterThan(25)
  })

  it('⚠️ and neither number is what catches the SAR hang', () => {
    // Recorded so nobody reads this file as "the hang is handled". It is not:
    // on that script `resolve` stops being entered after ~130k steps and the
    // process spends the rest of its life in native GC, where no in-process
    // guard runs at all. The batch runner's process isolation is what covers it.
    // See docs/pine/r11-vocabulary-gap.md.
    expect(PINE_TRANSLATE_MAX_STEPS).toBeGreaterThan(130000)
  })
})
