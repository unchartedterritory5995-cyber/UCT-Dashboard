// CAPABILITY REGRESSION — the suite's PINNED CLOCK (2026-11-04 incident: the master deploy gate went red at the 09:30 ET
// open because "show extended hours" on a DAILY chart is legitimately refused during the regular session — the product
// reads the market clock, utils/extSession.js — and the corpus read the wall clock).
//
// Every capreg test file pins Date to ONE fixed instant, chosen by CAPREG_CLOCK:
//   post (default) — Tue 2026-11-03 17:00 ET, after the close: pre/post-market toggles are open
//   rth            — Tue 2026-11-03 11:00 ET, the regular session
// Only Date is faked (timers stay real) and it ADVANCES from the pinned instant, so waits, timeouts and the panel's
// own polling behave as they do live. Agent CI runs the suite at BOTH instants, in parallel (agent-ci.yml capability-regression-clock matrix);
// an expectation that legitimately differs in-session says so explicitly (baseline/clockExpectations.json).
import { vi, beforeAll, afterAll } from 'vitest'

export const CLOCKS = {
  post: '2026-11-03T22:00:00Z',     // 17:00 ET, Tuesday (a trading day): after the close
  rth: '2026-11-03T16:00:00Z',      // 11:00 ET, Tuesday: the regular session
}
export const CLOCK = (globalThis.process?.env?.CAPREG_CLOCK || 'post').trim()
if (!CLOCKS[CLOCK]) throw new Error(`CAPREG_CLOCK must be one of ${Object.keys(CLOCKS).join(', ')} (got "${CLOCK}")`)

/** Pin Date for this test file (call at module top level). */
export function pinClock() {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    vi.setSystemTime(new Date(CLOCKS[CLOCK]))
  })
  afterAll(() => { vi.useRealTimers() })
}
