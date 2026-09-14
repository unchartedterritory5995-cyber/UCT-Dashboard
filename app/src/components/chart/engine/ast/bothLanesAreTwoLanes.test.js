// app/src/components/chart/engine/ast/bothLanesAreTwoLanes.test.js
//
// ─── ⚰️ "BOTH LANES" WAS ONE LANE, TWICE ────────────────────────────────────
//
// Measured 2026-09-14, in this session's own probes.
//
// Every "both lanes" reading taken while wiring item (a) was produced by calling
// `translatePine(src, { mode: 'host' })` and `translatePine(src, { mode:
// 'screener' })`. **`mode` is not the option.** `strict` is. Both calls ran the
// LENIENT lane, agreed with each other perfectly, and were reported as
// cross-lane agreement — which is the strongest-looking evidence a probe can
// produce and, in that shape, worth nothing.
//
// ⭐ AN INSTRUMENT THAT CANNOT DISTINGUISH ITS TWO INPUTS AGREES WITH ITSELF.
// Same family as `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail` and
// this repo's own "the three zeros that agree" incident.
//
// ⛔ SO THE SELF-CHECK IS THAT THE TWO READINGS DIFFER ON A KNOWN FIXTURE. If a
// future refactor renames the option, merges the contracts, or makes one lane
// silently fall back to the other, this goes red — instead of a later session
// re-reporting one lane as two.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const CLOUDS = fs.readFileSync(
  path.resolve(__dirname, '../../../../../../tests/fixtures/member/uncharted-clouds.pine'), 'utf8')

describe('the two lanes are two lanes', () => {
  it('⛔⛔ strict and lenient DISAGREE on Clouds — the fixture that proves it', () => {
    const strict = translatePine(CLOUDS, { strict: true })
    const lenient = translatePine(CLOUDS)

    // The load-bearing assertion: a DIFFERENT verdict from the same source.
    expect(strict.ok, 'strict refuses a partial translation').toBe(false)
    expect(lenient.ok, 'lenient offers what it can').toBe(true)
    expect(strict.ok).not.toBe(lenient.ok)
  })

  it('⭐ …and they agree about the FACTS, which is what makes the verdicts comparable', () => {
    const strict = translatePine(CLOUDS, { strict: true })
    const lenient = translatePine(CLOUDS)
    expect(strict.outputs.length).toBe(lenient.outputs.length)
    expect(strict.refusals.length).toBe(lenient.refusals.length)
  })

  it('⚰️ `mode` IS NOT THE OPTION — the exact call that produced the false reading', () => {
    // Kept as the reproduction rather than described in a comment: both of these
    // are the lenient lane, and a reader who writes them again will see this test
    // and know why they agreed.
    const a = translatePine(CLOUDS, { mode: 'host' })
    const b = translatePine(CLOUDS, { mode: 'screener' })
    expect(a.ok, '`mode` is ignored, so this is the lenient lane').toBe(true)
    expect(b.ok).toBe(true)
    expect(a.ok).toBe(b.ok)

    // …and the real option changes the answer, which is the whole point.
    expect(translatePine(CLOUDS, { strict: true }).ok).not.toBe(a.ok)
  })
})
