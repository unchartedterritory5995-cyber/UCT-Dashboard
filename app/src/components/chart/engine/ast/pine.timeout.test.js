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

// ⚰⚰ THE VEHICLE MOVED ON 2026-09-12, AND WHY IT MOVED IS THE LESSON. This was
// `10-supertrend.pine` — a script that translated clean, which is the whole premise
// of the file: ask a NORMAL script to stop at an absurd budget. Ruling R-F removed
// the min/max admission from `forgetsItsSeed`, so Supertrend now refuses
// `pine:state` at every output — and a refused output stops resolving, so the
// script that used to reach 500 resolution steps now stops at 389. Two caps in
// this file went red, and the red was correct: the cap had nothing left to bound.
//
// ⛔ A REFUSED SCRIPT IS A BAD VEHICLE FOR A BUDGET TEST. Its resolution work is
// truncated by the refusal, so the cap is measured against less machinery than it
// ships against, and the test drifts quieter every time a guard gets stricter.
// `13-average-true-range.pine` translates clean today, so the premise holds again —
// and the control below asserts THAT, by name, so the next ruling that refuses this
// script fails here with a sentence instead of silently measuring a truncated run.
const NORMAL = path.join(REPO, 'tests/fixtures/pine/13-average-true-range.pine')
const source = fs.readFileSync(NORMAL, 'utf8')

// Measured 2026-09-12 on this file, with a counter in `checkBudget` (removed after):
//   total resolution steps for the whole script .... 4,378
//   largest SINGLE resolution ........................ 314
//   therefore: every cap <= 300 fires, and 500 is clean.
const CAP_FIRES = 300
const CAP_CLEAN = 500
const TOTAL_STEPS = 4378

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

  it('⭐⭐ THE PREMISE: the vehicle is a script this engine TRANSLATES', () => {
    // ⛔ The file's claim is "a perfectly normal script refuses at an absurd
    // budget". If the vehicle ever stops being normal, every cap below measures a
    // run cut short by a refusal instead of the translator's real work — which is
    // exactly what R-F did to `10-supertrend.pine`, quietly, in two assertions.
    // So the premise is asserted, not assumed, and it names the guards it found.
    const r = translatePine(source, { strict: true })
    expect(guardsOf(r), 'the timeout vehicle must translate clean — pick a new one').toEqual([])
    expect(r.ok).toBe(true)
  })

  it('⛔ the cap is checked OUTSIDE the sampling mask', () => {
    // The first version gated the step cap behind the same 4096-step mask as the
    // clock, which made every cap below 4096 UNREACHABLE — a guard that could not
    // fire, and it looked entirely correct in review. Small caps must be honoured.
    for (const maxSteps of [1, 10, 100, CAP_FIRES]) {
      const r = translatePine(source, { strict: true, maxSteps })
      expect(guardsOf(r), `maxSteps=${maxSteps}`).toContain('pine:timeout')
    }
  })

  it('⚠️ the cap is PER RESOLVER, not per script', () => {
    // `translatePine` builds one Resolver per output plus one for the object
    // pass, and `budgetSteps` lives on the Resolver. So the cap bounds a single
    // resolution, not the script's total work: this script spends 4,378 steps
    // overall and its largest single resolution is 314, which is why a cap of 500
    // is already clean while the script does fourteen times that much work.
    // Anyone reading the shipped 5,000,000 as a whole-script ceiling would be
    // over-estimating the headroom by more than an order of magnitude.
    expect(TOTAL_STEPS / CAP_CLEAN).toBeGreaterThan(8)
    expect(guardsOf(translatePine(source, { strict: true, maxSteps: CAP_FIRES }))).toContain('pine:timeout')
    expect(guardsOf(translatePine(source, { strict: true, maxSteps: CAP_CLEAN }))).not.toContain('pine:timeout')
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

  it('⭐ and the step cap DOES catch the SAR hang — measured, after a correction', () => {
    // ⚠️ THIS ASSERTION REPLACES ONE THAT SAID THE OPPOSITE. The first reading of
    // the evidence was that no in-process guard could fire, because `resolve`
    // appeared to stop being entered after ~130k steps. That measurement was
    // taken against a build in which the step cap was still gated behind the
    // 4096-step mask and therefore could not fire AT ALL — so the experiment was
    // measuring the broken guard, not the script.
    //
    // With the cap checked outside the mask, the real script refuses under the
    // SHIPPED defaults in ~35s: `pine:timeout`, naming the file. The step cap has
    // to be above the legitimate maximum (167,336) and low enough to trip before
    // the process falls into GC thrashing; 5,000,000 satisfies both, verified at
    // 50k / 200k / 1M / 2M / 3M / 5M — every one of them fires.
    expect(PINE_TRANSLATE_MAX_STEPS).toBeGreaterThan(167336)
    expect(PINE_TRANSLATE_MAX_STEPS).toBeLessThanOrEqual(5000000)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the wall clock bounds the SCRIPT, not each Resolver', () => {
  // ⛔ `translatePine` builds one Resolver per output PLUS one for the object
  // pass. A per-Resolver clock would give a 45-output script like Uncharted
  // Clouds 46 x 10s = SEVEN AND A HALF MINUTES while every individual guard
  // reported itself satisfied. Measured effect of fixing it on the pathological
  // script: 38.7s -> 31s -> 14.5s as the output loop and then the object pass
  // were brought under the one deadline.
  const SAR = path.join(REPO, 'corpus/committed/parabolic-sar__xoeoPMOWGJ.pine')

  it('⛔ the named corpus script refuses as pine:timeout, bounded', () => {
    const src = fs.readFileSync(SAR, 'utf8')
    const t0 = Date.now()
    const r = translatePine(src, { strict: true, budgetMs: 1500, maxSteps: 200000, sourcePath: 'corpus/committed/parabolic-sar__xoeoPMOWGJ.pine' })
    const ms = Date.now() - t0
    expect(guardsOf(r)).toContain('pine:timeout')
    expect(timeoutsOf(r)[0].message).toContain('parabolic-sar__xoeoPMOWGJ.pine')
    // ⭐ THE BOUND IS THE POINT. Generous, because the guard can only stop NEW
    // work — one resolution already in flight still runs to its step cap.
    expect(ms).toBeLessThan(20000)
  })

  it('⭐ and it is the ONLY corpus script that does', () => {
    // Measured over all 266: one script, three refusals — one per resolution
    // entry, NOT three scripts. Recorded so a second name appearing here is
    // visible as a regression rather than absorbed into a count.
    expect(path.basename(SAR)).toBe('parabolic-sar__xoeoPMOWGJ.pine')
  })

  it('the loop-level bound refuses for the WHOLE SCRIPT, by message', () => {
    // ⭐ Tested on a NORMAL script with an already-spent budget, which isolates
    // the loop bound from the step cap: with the clock gone before the first
    // output starts, the refusal must be the per-script one. Using the
    // pathological script here would prove nothing, because its per-resolution
    // step cap fires first and the message would be that one.
    const r = translatePine(source, { strict: true, budgetMs: 1, maxSteps: 0 })
    const msgs = timeoutsOf(r).map((x) => x.message)
    expect(msgs.length).toBeGreaterThan(0)
    expect(msgs.some((m) => /for the whole script/.test(m))).toBe(true)
  })
})
