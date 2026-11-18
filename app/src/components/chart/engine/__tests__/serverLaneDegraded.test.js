// app/src/components/chart/engine/__tests__/serverLaneDegraded.test.js
//
// ─── A DEGRADED SERVER ANSWER IS RE-ASKED, A REAL ONE IS NOT (2026-11-11) ────
//
// The server answers `200` with a blank envelope while it cannot yet compute (`payload.state`
// `no-bars` / `no-benchmark-bars`, or the route's `error` envelope) and itself forgets such
// an answer within a minute. The client lane kept every landed entry for the page load, so a
// chart that asked one moment too early stayed blank until the member reloaded. A degraded
// entry is now dropped on a bounded back-off and the next paint asks again.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  clearServerColumns, ensureColumns, cachedColumns, subscribe, primeServerColumns, DEGRADED_RETRY_MS,
} from '../serverCompute'

const ID = 'rsLine'
const SYM = 'CRWV'
const TF = 'D'
const INPUTS = { benchmark: 'SPY' }
const wire = (state, extra = {}) => ({ times: [20260102, 20260105], columns: { rsLine: [1, 1.1] }, payload: { state }, ...extra })
const blank = (state, extra = {}) => ({ times: [], columns: {}, payload: { state }, ...extra })

let answers, asked
const fetcher = () => { asked += 1; const a = answers.length > 1 ? answers.shift() : answers[0]; return Promise.resolve(a) }
/** one paint: read the cache, ask if absent (what `serverColumnsFor` does), let the promise settle */
const paint = async () => { const r = ensureColumns(ID, SYM, TF, INPUTS, fetcher); await vi.advanceTimersByTimeAsync(0); return r }

beforeEach(() => { vi.useFakeTimers(); clearServerColumns(); asked = 0 })
afterEach(() => { clearServerColumns(); vi.useRealTimers() })

describe('degraded answers are re-asked on a bounded back-off', () => {
  for (const [name, w] of [
    ['no-bars', blank('no-bars')],
    ['no-benchmark-bars', blank('no-benchmark-bars')],
    ['the route\'s own error envelope', { columns: {}, times: [], error: 'server lane unavailable' }],
  ]) {
    it(`${name}: dropped after 5 s, the next paint asks again, and a good answer then stands`, async () => {
      answers = [w, wire('ok')]
      const notified = []
      const unsub = subscribe((k) => notified.push(k))
      await paint()                                   // first ask
      expect(asked).toBe(1)
      expect(cachedColumns(ID, SYM, TF, INPUTS)).not.toBeNull()   // the degraded answer is shown, not hidden
      await vi.advanceTimersByTimeAsync(DEGRADED_RETRY_MS[0] - 1)
      expect(cachedColumns(ID, SYM, TF, INPUTS), 'not yet').not.toBeNull()
      const before = notified.length
      await vi.advanceTimersByTimeAsync(1)
      expect(cachedColumns(ID, SYM, TF, INPUTS), 'dropped').toBeNull()
      expect(notified.length, 'the chart is told to repaint').toBe(before + 1)
      await paint()                                   // the repaint asks again
      expect(asked).toBe(2)
      expect(cachedColumns(ID, SYM, TF, INPUTS).times.length).toBe(2)
      await vi.advanceTimersByTimeAsync(10 * 60_000)  // nothing else is scheduled for a good answer
      await paint()
      expect(asked).toBe(2)
      unsub()
    })
  }

  it('an answer that stays degraded is asked at most 1 + 3 times (5 s, 15 s, 45 s), then it stands', async () => {
    answers = [blank('no-benchmark-bars')]
    await paint()
    for (const ms of DEGRADED_RETRY_MS) {
      await vi.advanceTimersByTimeAsync(ms)
      expect(cachedColumns(ID, SYM, TF, INPUTS)).toBeNull()
      await paint()
    }
    expect(asked).toBe(1 + DEGRADED_RETRY_MS.length)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    await paint()
    expect(asked, 'no retry storm').toBe(1 + DEGRADED_RETRY_MS.length)
    expect(cachedColumns(ID, SYM, TF, INPUTS)).not.toBeNull()
  })

  for (const state of ['intraday', 'same-symbol', 'short-history', 'ok']) {
    it(`${state} is a real answer: kept, never re-asked`, async () => {
      answers = [blank(state)]
      await paint()
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      await paint()
      expect(asked).toBe(1)
      expect(cachedColumns(ID, SYM, TF, INPUTS)).not.toBeNull()
    })
  }

  it('a primed answer, or a clear, cancels the pending drop', async () => {
    answers = [blank('no-bars')]
    await paint()
    const primed = primeServerColumns(ID, SYM, TF, INPUTS, wire('ok'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(cachedColumns(ID, SYM, TF, INPUTS)).toBe(primed)
    expect(asked).toBe(1)
    answers = [blank('no-bars')]
    clearServerColumns()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(asked).toBe(1)
  })

  it('a failed request is unchanged: not cached, asked again on the next paint', async () => {
    const failing = () => { asked += 1; return Promise.reject(new Error('HTTP 502')) }
    ensureColumns(ID, SYM, TF, INPUTS, failing); await vi.advanceTimersByTimeAsync(0)
    expect(cachedColumns(ID, SYM, TF, INPUTS)).toBeNull()
    ensureColumns(ID, SYM, TF, INPUTS, failing); await vi.advanceTimersByTimeAsync(0)
    expect(asked).toBe(2)
  })
})
