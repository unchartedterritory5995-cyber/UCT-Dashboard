// Rails for the today-pack PROACTIVE keep-warm.
//
// The defect this closes: refresh used to happen only on a symbol change, and the
// fetch it started landed after that symbol's seed had already run — so the first
// ticker opened after a pause got a null seed (a whitespace hole) and the refresh
// benefited the NEXT ticker. These tests assert the new loop refreshes BEFORE the
// seed ceiling expires, and — just as important — that it stays quiet when it would
// not pay, which is the objection the original demand-driven design was built on.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ensureTodayPack, touchTodayPack, getTodayBar, todayPackAgeMs, todayPackUsable,
  __resetForTest, __stopKeepWarm,
} from './todayPackClient'

const PACK = { d: '2026-09-09', n: 1, bars: { AAPL: [1, 2, 0.5, 1.5, 10] } }
const EMPTY = { d: '', n: 0, bars: {} }

let calls
function stubFetch(payload = () => PACK) {
  calls = 0
  vi.stubGlobal('fetch', vi.fn(() => {
    calls += 1
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload()) })
  }))
}

// The loop polls on a timer and gates on visibility + recent interaction, so the
// tests drive real module state rather than reaching inside it.
function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}
function interact() {
  window.dispatchEvent(new Event('pointerdown'))
}

/** Advance fake time AND let the in-flight fetch promises settle. */
async function advance(ms) {
  await vi.advanceTimersByTimeAsync(ms)
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-09T15:00:00Z'))
  __resetForTest()
  setVisibility('visible')
  stubFetch()
})
afterEach(() => {
  __stopKeepWarm()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('today-pack keep-warm', () => {
  it('refreshes BEFORE the seed ceiling expires, so a seed is never a hole', async () => {
    await touchTodayPack()
    expect(calls).toBe(1)
    expect(getTodayBar('AAPL')).toBeTruthy()

    // Walk two minutes WITHOUT any symbol change. Under the old demand-driven model
    // the pack would now be 120s old — past MAX_SEED_AGE_MS — and the next ticker
    // opened would seed nothing. Keep-warm must have refreshed it in the meantime.
    for (let i = 0; i < 8; i++) { await advance(15_000); interact() }

    expect(calls).toBeGreaterThan(1)
    expect(todayPackAgeMs()).toBeLessThanOrEqual(45_000)
    expect(todayPackUsable()).toBe(true)
    expect(getTodayBar('AAPL')).toBeTruthy()
  })

  it('is BOUNDED — an actively scanning tab spends at most one request per refresh window', async () => {
    await touchTodayPack()
    for (let i = 0; i < 40; i++) { await advance(15_000); interact() }   // 10 minutes
    // 10 min at a 45s refresh window is ~13 refreshes + the initial load. Assert a
    // hard ceiling so a future interval change cannot quietly start hammering.
    expect(calls).toBeLessThanOrEqual(16)
  })

  // Opening a chart IS an interaction, so the loop legitimately keeps the pack warm
  // through the ACTIVE_MS window that follows — that is the whole point. What must be
  // true is that the cost DECAYS TO ZERO once the member stops scanning, rather than
  // running forever on a tab left open (the objection the demand-driven design was
  // built on). Assert the decay, not an impossible zero.
  it('an IDLE visible tab decays to zero cost once the active window lapses', async () => {
    await touchTodayPack()
    await advance(3 * 60_000)         // active window (120s) lapses during this
    const settled = calls
    expect(settled).toBeLessThanOrEqual(4)
    await advance(10 * 60_000)        // ten more minutes, no interaction at all
    expect(calls).toBe(settled)       // not one further request
  })

  it('a HIDDEN tab costs nothing even while interacting', async () => {
    await touchTodayPack()
    const after = calls
    setVisibility('hidden')
    for (let i = 0; i < 20; i++) { await advance(15_000); interact() }
    expect(calls).toBe(after)
  })

  it('an EMPTY pack (session shut) backs off instead of polling a closed market', async () => {
    stubFetch(() => EMPTY)
    await touchTodayPack()
    const after = calls
    for (let i = 0; i < 8; i++) { await advance(15_000); interact() }
    expect(calls).toBe(after)                 // backed off for the probe window
    expect(todayPackUsable()).toBe(false)     // and it never claims to be seedable
  })

  it('coming back to the tab refreshes immediately rather than waiting for a tick', async () => {
    await touchTodayPack()
    setVisibility('hidden')
    await advance(5 * 60_000)                 // go away long enough to expire
    const before = calls
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(calls).toBe(before + 1)
  })

  it('todayPackUsable reports the seed ceiling honestly', async () => {
    expect(todayPackUsable()).toBe(false)     // nothing loaded yet
    await ensureTodayPack()
    expect(todayPackUsable()).toBe(true)
    __stopKeepWarm()                          // freeze the loop, then age past the ceiling
    await advance(95_000)
    expect(todayPackUsable()).toBe(false)
    expect(getTodayBar('AAPL')).toBeNull()
  })
})
