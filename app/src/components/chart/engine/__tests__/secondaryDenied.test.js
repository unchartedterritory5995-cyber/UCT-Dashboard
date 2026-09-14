// app/src/components/chart/engine/__tests__/secondaryDenied.test.js
//
// ─── A PERMANENT REFUSAL IS A STATE, NOT A THING TO KEEP ASKING ─────────────
//
// ⭐⭐ THE CLAIM. `/api/bars` became paid on 2026-09-13. A member without the
// entitlement — or with an expired session — now gets 401/403 for a secondary
// source, and this lane has to treat that as TERMINAL: cached, reported
// truthfully, never re-requested paint after paint.
//
// ⚰️ MEASURED BEFORE THE FIX, in the audit that preceded the gate: every failure
// ran the same `.catch`, which DELETED the cache entry so "the next paint asks
// again". Right for a transient 503; catastrophic for a permanent 403. A live
// chart repaints on every tick, so an unentitled member would have driven an
// unbounded request storm at an endpoint that can only ever refuse — the client
// half of the same amplification the server-side gate exists to close.
//
// ⛔ AND `DENIED` IS NOT `NO_DATA`. Telling a member "no data" for QQQ teaches
// them something false about QQQ. The series is there; their plan is not.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SOURCE_STATUS, clearSecondaryBars, fetchSecondaryBars, cachedBars,
  ensureSecondaryBars,
} from '../secondaryBars'
import { knownCapabilityOf } from '../../discoveryCatalog'

const TF = 'D'
const COUNT = 400

/** A fetcher that refuses the way the gated route refuses. */
const refusing = (status, counter) => (url) => {
  counter.push(url)
  const err = new Error(`HTTP ${status}`)
  err.httpStatus = status
  return Promise.reject(err)
}

/** A fetcher that fails the way a blip fails — no HTTP status at all. */
const blipping = (counter) => (url) => {
  counter.push(url)
  return Promise.reject(new Error('NetworkError'))
}

const ok = (counter) => (url) => {
  counter.push(url)
  return Promise.resolve({ bars: [{ t: '2026-09-01', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] })
}

beforeEach(() => { clearSecondaryBars() })

describe('an entitlement refusal is terminal', () => {
  it.each([401, 403])('⭐⭐ %i lands as DENIED and is CACHED', async (status) => {
    const calls = []
    const entry = await fetchSecondaryBars('QQQ', TF, COUNT, refusing(status, calls))
    expect(entry.status).toBe(SOURCE_STATUS.DENIED)
    expect(entry.httpStatus).toBe(status)
    expect(entry.bars).toEqual([])
    // ⛔ THE CACHE IS THE MECHANISM. A cached denial is what makes the next
    // paint a synchronous read instead of a second request.
    const hit = cachedBars('QQQ', TF, COUNT)
    expect(hit, 'the denial was not remembered').toBeTruthy()
    expect(hit.status).toBe(SOURCE_STATUS.DENIED)
  })

  it('⛔⛔ AND THE NEXT PAINT DOES NOT ASK AGAIN — the retry storm, refused', async () => {
    const calls = []
    await fetchSecondaryBars('QQQ', TF, COUNT, refusing(403, calls))
    expect(calls).toHaveLength(1)

    // Twenty repaints, which a live chart does in a few seconds.
    for (let i = 0; i < 20; i++) {
      const read = ensureSecondaryBars('QQQ', TF, COUNT, refusing(403, calls))
      expect(read.status).toBe(SOURCE_STATUS.DENIED)
    }
    expect(calls, 'a permanent refusal was re-requested on repaint').toHaveLength(1)
  })

  it('⭐ a DENIED source reports the PLAN, not a lie about the symbol', () => {
    const calls = []
    return fetchSecondaryBars('QQQ', TF, COUNT, refusing(403, calls)).then(() => {
      const cap = knownCapabilityOf('QQQ', TF, COUNT)
      expect(cap.capabilityReason).toMatch(/paid plan/i)
      expect(cap.capabilityReason, 'a denial was reported as missing history')
        .not.toMatch(/no history/i)
    })
  })

  it('⭐ …and a 401 says SIGN IN, which is a different instruction', () => {
    const calls = []
    return fetchSecondaryBars('SPY', TF, COUNT, refusing(401, calls)).then(() => {
      expect(knownCapabilityOf('SPY', TF, COUNT).capabilityReason).toMatch(/sign in/i)
    })
  })
})

describe('everything else keeps the behaviour it had', () => {
  it('⭐⭐ A TRANSIENT FAILURE IS STILL RETRIED — the fix did not freeze the chart', async () => {
    const calls = []
    const entry = await fetchSecondaryBars('QQQ', TF, COUNT, blipping(calls))
    expect(entry.status).toBe(SOURCE_STATUS.ERROR)
    // ⛔ NOT CACHED. This is the half that must NOT change: a 503 during a
    // deploy has to heal on the next paint without a reload.
    expect(cachedBars('QQQ', TF, COUNT), 'a transient error was cached as terminal')
      .toBeNull()

    ensureSecondaryBars('QQQ', TF, COUNT, blipping(calls))
    // ⚠️ THE SUPPLIER CALLS ITS FETCHER ON A MICROTASK, so the count is read
    // after the chain drains rather than synchronously — the same note
    // `ohlcBinding.test.js` makes about `ensureAll`.
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(calls.length, 'a transient failure stopped retrying').toBeGreaterThan(1)
  })

  it('⛔ a 503 is transient even though it is an HTTP status', async () => {
    const calls = []
    const entry = await fetchSecondaryBars('QQQ', TF, COUNT, refusing(503, calls))
    expect(entry.status).toBe(SOURCE_STATUS.ERROR)
    expect(cachedBars('QQQ', TF, COUNT)).toBeNull()
  })

  it('⭐ an authorized response is unchanged', async () => {
    const calls = []
    const entry = await fetchSecondaryBars('QQQ', TF, COUNT, ok(calls))
    expect(entry.status).toBe(SOURCE_STATUS.AVAILABLE)
    expect(entry.bars).toHaveLength(1)
    expect(cachedBars('QQQ', TF, COUNT).status).toBe(SOURCE_STATUS.AVAILABLE)
  })

  it('⛔ DENIED and NO_DATA are not the same word', () => {
    expect(SOURCE_STATUS.DENIED).not.toBe(SOURCE_STATUS.NO_DATA)
    expect(SOURCE_STATUS.DENIED).not.toBe(SOURCE_STATUS.ERROR)
    expect(new Set(Object.values(SOURCE_STATUS)).size)
      .toBe(Object.values(SOURCE_STATUS).length)
  })
})
