// ─── ⛔⛔ RULING 3.3 — THE JS LANE REFUSES THE REALTIME COLUMNS, NEVER BLANKS ──
//
// The four realtime `barstate.*` columns are decided by `opts.newestBarIsForming`, a
// tri-state produced on the Python side by `indicator_compute.bar_close_state`. Nothing
// in `app/src` supplies it to this lane yet, so they fail closed to NA — correct, and
// BLANK. ⛔ A member cannot tell a blank cell from "this bar is not confirmed", and our
// own doctrine says anything that cannot be rendered with fidelity surfaces a named
// refusal or a disclosure, never a blank. Owner ruling, 2026-09-12.
//
// ⚰️ THE FIRST ATTEMPT PUT THIS IN `interpret()` AND TURNED 12 TESTS RED. That is the
// shared seam: censuses and rails legitimately interpret trees with no clock, where no
// member is involved. The reds were the signal that the seam was wrong, not that the
// tests were — so the refusal lives in the LANE, and this file is where it is proved.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { CLOCK_REALTIME } from '../../indicators.js'

const src = (body) => `//@version=6\nindicator("t")\n${body}\n`

describe('the JS lane refuses a realtime barstate column until it is told', () => {
  it('⛔ every one of the four refuses BY NAME when nobody supplied the flag', () => {
    // ⭐ THE SET IS IMPORTED, NOT LISTED. A fifth realtime column is covered the day it
    // lands, which is the same reason the lane itself imports it.
    expect(CLOCK_REALTIME.length).toBeGreaterThan(0)
    for (const name of CLOCK_REALTIME) {
      const r = buildRuntimeIr(src(`plot(barstate.${name} ? 1 : 0)`), {})
      expect(r.ok, name).toBe(false)
      expect(r.refusal.guard, name).toBe('runtime:realtime-untold')
      // the member is told WHICH name, and where
      expect(r.refusal.message, name).toContain(name)
      expect(r.refusal.line, name).toBe(3)
    }
  })

  it('⭐ THE CONTROL: telling it lets the column through', () => {
    // Without this the test above would pass just as happily against a lane that
    // refused these names unconditionally — which would be a different bug with the
    // same green.
    const r = buildRuntimeIr(src('plot(barstate.isconfirmed ? 1 : 0)'),
      { newestBarIsForming: false })
    expect(r.refusal && r.refusal.guard).not.toBe('runtime:realtime-untold')
  })

  it('⭐ …and `false` is a real answer, not "nobody told me"', () => {
    const told = buildRuntimeIr(src('plot(barstate.isconfirmed ? 1 : 0)'),
      { newestBarIsForming: false })
    const untold = buildRuntimeIr(src('plot(barstate.isconfirmed ? 1 : 0)'), {})
    expect(untold.refusal.guard).toBe('runtime:realtime-untold')
    expect(told.refusal && told.refusal.guard).not.toBe('runtime:realtime-untold')
  })

  it('⭐ it also reads the flag through `interpretOpts`', () => {
    const r = buildRuntimeIr(src('plot(barstate.isconfirmed ? 1 : 0)'),
      { interpretOpts: { newestBarIsForming: true } })
    expect(r.refusal && r.refusal.guard).not.toBe('runtime:realtime-untold')
  })

  it('⛔⛔ CODE, NEVER PROSE: the name in a COMMENT does not trigger it', () => {
    // This repo has six recorded instances of a sweep matching its own prose. Here the
    // scan runs over LEXED TOKENS, so comments and strings are already gone — the rule
    // is satisfied by construction rather than by a regex that strips. This test is the
    // proof that construction holds.
    const r = buildRuntimeIr(src('// barstate.isconfirmed is mentioned here only\nplot(close)'), {})
    expect(r.refusal && r.refusal.guard).not.toBe('runtime:realtime-untold')
  })

  it('⛔ and a STRING containing the name does not trigger it either', () => {
    const r = buildRuntimeIr(src('x = "barstate.isrealtime"\nplot(close)'), {})
    expect(r.refusal && r.refusal.guard).not.toBe('runtime:realtime-untold')
  })

  it('⭐ the NON-realtime barstate columns are unaffected', () => {
    // `isfirst`/`islast` are the extent pair — they come from the fetch, not the clock,
    // so this ruling must not touch them. Scoping a refusal too widely is how the first
    // attempt broke twelve tests.
    const r = buildRuntimeIr(src('plot(barstate.isfirst ? 1 : 0)'), {})
    expect(r.refusal && r.refusal.guard).not.toBe('runtime:realtime-untold')
  })
})
