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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  SOURCE_STATUS, clearSecondaryBars, fetchSecondaryBars, cachedBars,
  ensureSecondaryBars, subscribe, RETRY_BASE_MS,
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

/**
 * A fetcher that refuses the way THE CHART'S OWN fetcher refuses — `err.status`,
 * and never `err.httpStatus`.
 *
 * ⚰⚰ THIS IS THE SHAPE THE LANE ACTUALLY MEETS, and the reason every rail above
 * passed while the storm ran anyway. `_defaultFetch` stamps `httpStatus`; the
 * chart passes its own fetcher (`StockChart.jsx`, `err.status = r.status`) and
 * that one is what `useSecondarySources` is handed on a live chart. A membership
 * test written against one spelling reads `undefined` for the other, so a
 * permanent 401/403 was filed as a transient ERROR — deleted, notified,
 * re-ensured, re-requested, forever.
 */
const chartRefusing = (status, counter, extra = null) => (url) => {
  counter.push(url)
  const err = new Error(`HTTP ${status}`)
  err.status = status
  if (extra) Object.assign(err, extra)
  return Promise.reject(err)
}

/** A fetcher that fails the way a blip fails — no HTTP status at all. */
const blipping = (counter) => (url) => {
  counter.push(url)
  return Promise.reject(new Error('NetworkError'))
}

/** ⚠️ THE SUPPLIER CALLS ITS FETCHER ON A MICROTASK, so a call count is read
 *  after the chain drains rather than synchronously — the same note
 *  `ohlcBinding.test.js` makes about `ensureAll`. */
const drain = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
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
    vi.useFakeTimers()
    try {
      const calls = []
      const entry = await fetchSecondaryBars('QQQ', TF, COUNT, blipping(calls))
      expect(entry.status).toBe(SOURCE_STATUS.ERROR)
      // ⛔ NOT CACHED. This is the half that must NOT change: a 503 during a
      // deploy has to heal without a reload, and a failure must never be
      // remembered as a fact about the data.
      expect(cachedBars('QQQ', TF, COUNT), 'a transient error was cached as terminal')
        .toBeNull()

      // ⚰ THIS USED TO READ `ensureSecondaryBars(...)` WITH NO CLOCK AT ALL and
      // assert the very next paint re-requested. That assertion was the storm
      // written down as a requirement: a live chart repaints on every tick, so
      // "retried immediately" is "retried hundreds of times a minute" against an
      // endpoint that is already failing. Retried is still the contract — AFTER
      // the backoff, which is what the clock below advances.
      await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
      ensureSecondaryBars('QQQ', TF, COUNT, blipping(calls))
      await drain()
      expect(calls.length, 'a transient failure stopped retrying').toBeGreaterThan(1)
    } finally {
      vi.useRealTimers()
    }
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

// ─── ⭐⭐ THE SAME REFUSAL, THROUGH THE FETCHER THE CHART ACTUALLY PASSES ─────
//
// Everything above is true of `_defaultFetch`'s error shape and none of it fired
// on the real chart, because the chart never uses `_defaultFetch`.

describe('the chart hands this lane a DIFFERENT error shape', () => {
  it.each([401, 403])('⭐⭐ a chart-shaped %i is DENIED, not a transient ERROR', async (status) => {
    const calls = []
    const entry = await fetchSecondaryBars('QQQ', TF, COUNT, chartRefusing(status, calls))
    expect(entry.status, 'a permanent refusal read as transient because it spelled '
      + 'its status `status` instead of `httpStatus`').toBe(SOURCE_STATUS.DENIED)
    expect(entry.httpStatus).toBe(status)
    const hit = cachedBars('QQQ', TF, COUNT)
    expect(hit, 'the denial was not remembered').toBeTruthy()
    expect(hit.status).toBe(SOURCE_STATUS.DENIED)
  })

  it('⛔⛔ …AND THE STORM NEVER STARTS — twenty repaints, one request', async () => {
    const calls = []
    await fetchSecondaryBars('QQQ', TF, COUNT, chartRefusing(403, calls))
    expect(calls).toHaveLength(1)
    for (let i = 0; i < 20; i++) {
      expect(ensureSecondaryBars('QQQ', TF, COUNT, chartRefusing(403, calls)).status)
        .toBe(SOURCE_STATUS.DENIED)
    }
    await drain()
    expect(calls, 'a permanent refusal was re-requested on repaint').toHaveLength(1)
  })

  it('⚠️ and the supplier\'s own shape still works — neither spelling wins alone', async () => {
    const calls = []
    const entry = await fetchSecondaryBars('QQQ', TF, COUNT, refusing(403, calls))
    expect(entry.status).toBe(SOURCE_STATUS.DENIED)
  })
})

// ─── ⭐⭐ AN ERROR IS A WAIT, NOT A RETRY-NOW ───────────────────────
//
// ⛔ A DENIAL WAS ONLY HALF THE STORM. Any other failure — a warming 503, a
// network blip, a 25s abort — also deleted its entry and notified, and the
// subscriber's re-ensure put the same URL back on the wire in the same tick. So
// the endpoint least able to answer was asked the most often.

describe('an ERROR backs off; it is not re-requested on the next paint', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { clearSecondaryBars(); vi.useRealTimers() })

  it('⛔⛔ AN IMMEDIATE ENSURE DOES NOT REFETCH — and reads ERROR, not LOADING', async () => {
    const calls = []
    const entry = await fetchSecondaryBars('QQQ', TF, COUNT, blipping(calls))
    expect(entry.status).toBe(SOURCE_STATUS.ERROR)
    expect(entry.retryAt, 'the error carries no time at which it may be retried')
      .toEqual(expect.any(Number))

    for (let i = 0; i < 20; i++) {
      // ⭐ THE CALLER STILL GETS A STATUS. A backing-off source that answered
      // LOADING would be a silence dressed as progress — the chart would wait
      // forever for a response nobody is going to ask for.
      expect(ensureSecondaryBars('QQQ', TF, COUNT, blipping(calls)).status,
        'a backing-off source read as LOADING').toBe(SOURCE_STATUS.ERROR)
    }
    await drain()
    expect(calls, 'a failed request was re-issued on the next paint').toHaveLength(1)
  })

  it('⭐ …AND EXACTLY ONE REFETCH WHEN THE BACKOFF ELAPSES', async () => {
    const calls = []
    const seen = []
    const unsub = subscribe((url) => seen.push(url))
    try {
      await fetchSecondaryBars('QQQ', TF, COUNT, blipping(calls))
      seen.length = 0                       // the failure's own notification

      await vi.advanceTimersByTimeAsync(RETRY_BASE_MS - 1)
      ensureSecondaryBars('QQQ', TF, COUNT, blipping(calls))
      await drain()
      expect(calls, 'the backoff was not honoured').toHaveLength(1)
      expect(seen, 'a retry was announced before it was due').toHaveLength(0)

      await vi.advanceTimersByTimeAsync(1)
      // ⭐⭐ ONE NOTIFICATION, NOT ONE PER SUBSCRIBER-VISIBLE TICK. The
      // notification is what makes consumers re-ensure, so a repeating one would
      // be the storm again wearing a timer.
      expect(seen, 'the elapsed backoff must announce itself exactly once').toHaveLength(1)

      // Five consumers wake on that one notification; the in-flight map makes
      // them one request, which is the property this lane exists for.
      for (let i = 0; i < 5; i++) ensureSecondaryBars('QQQ', TF, COUNT, blipping(calls))
      await drain()
      expect(calls, 'the elapsed backoff did not produce exactly one refetch')
        .toHaveLength(2)
    } finally {
      unsub()
    }
  })

  it('⭐⭐ THE BACKOFF GROWS, AND A SUCCESS RESETS IT', async () => {
    const calls = []
    await fetchSecondaryBars('QQQ', TF, COUNT, blipping(calls))     // 1st failure

    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    ensureSecondaryBars('QQQ', TF, COUNT, blipping(calls))
    await drain()
    expect(calls).toHaveLength(2)                                   // 2nd failure

    // One base window is no longer enough — the second wait is twice the first.
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    ensureSecondaryBars('QQQ', TF, COUNT, blipping(calls))
    await drain()
    expect(calls, 'the backoff did not grow — the second failure waited the first delay')
      .toHaveLength(2)

    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    ensureSecondaryBars('QQQ', TF, COUNT, ok(calls))
    await drain()
    expect(calls).toHaveLength(3)
    expect(cachedBars('QQQ', TF, COUNT).status).toBe(SOURCE_STATUS.AVAILABLE)

    // ⭐ AND THE LEDGER IS RESET BY THAT SUCCESS. A lane that healed and then
    // blipped must wait one base window again, not the four it had climbed to —
    // otherwise one bad afternoon makes the rest of the session sluggish.
    await fetchSecondaryBars('QQQ', TF, COUNT, blipping(calls))     // 4th call, fails
    expect(calls).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    ensureSecondaryBars('QQQ', TF, COUNT, blipping(calls))
    await drain()
    expect(calls, 'the backoff did not reset on success').toHaveLength(5)
  })

  it('⭐ a Retry-After the FETCHER attached is honoured as a floor', async () => {
    // ⚠️ READ WHAT THE FETCHERS ACTUALLY ATTACH, not what an HTTP header is
    // called: the chart's fetcher stamps `err.retryAfterMs` (milliseconds) on a
    // warming 503 and `_defaultFetch` stamps nothing at all. A lane that looked
    // for `retryAfter` seconds would find neither and would look correct.
    const floor = RETRY_BASE_MS * 5
    const calls = []
    const fetcher = chartRefusing(503, calls, { retryAfterMs: floor, warming: true })

    await fetchSecondaryBars('QQQ', TF, COUNT, fetcher)
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS)
    ensureSecondaryBars('QQQ', TF, COUNT, fetcher)
    await drain()
    expect(calls, "the server's own Retry-After was undercut by our guess")
      .toHaveLength(1)

    await vi.advanceTimersByTimeAsync(floor - RETRY_BASE_MS)
    ensureSecondaryBars('QQQ', TF, COUNT, fetcher)
    await drain()
    expect(calls, 'the Retry-After floor never elapsed').toHaveLength(2)
  })

  it('⛔ `clearSecondaryBars` clears the PENDING RETRY TIMER', async () => {
    // A timer that outlives the cache it belongs to notifies subscribers about a
    // URL nothing is holding any more — and in a test file, leaks into the next
    // case as a phantom refetch.
    const calls = []
    const seen = []
    const unsub = subscribe((url) => seen.push(url))
    try {
      await fetchSecondaryBars('QQQ', TF, COUNT, blipping(calls))
      expect(vi.getTimerCount(), 'no retry was armed at all').toBeGreaterThan(0)

      clearSecondaryBars()
      expect(vi.getTimerCount(), 'a retry timer outlived the cache it belonged to')
        .toBe(0)

      seen.length = 0
      await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 8)
      expect(seen, 'a cleared lane still announced a retry').toHaveLength(0)
      expect(calls).toHaveLength(1)
    } finally {
      unsub()
    }
  })
})
