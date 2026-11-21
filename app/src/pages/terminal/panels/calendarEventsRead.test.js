// The read IPO and DVD make: the body AND the server's own label for the read, which rides in a
// response header that jsonFetcher drops. A non-2xx answer throws with its status, exactly as
// jsonFetcher's does, so marketRead's failure words read it unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CALENDAR_READ_HEADER, calendarEventsKey, calendarEventsRead } from './calendarEventsRead'
import { canRetry, failureKind, failureText } from './marketRead'

const answer = (body, label = null) => ({ ok: true, status: 200, headers: { get: (h) => (h === 'X-Calendar-Read' ? label : null) }, json: async () => body })

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('calendarEventsRead', () => {
  it('asks the URL as given, once, with one argument', async () => {
    globalThis.fetch.mockResolvedValue(answer([]))
    await calendarEventsRead('/api/calendar/ipos?from=2026-11-09&to=2026-11-27')
    expect(globalThis.fetch.mock.calls).toEqual([['/api/calendar/ipos?from=2026-11-09&to=2026-11-27']])
  })

  it('keeps the body, the instant it arrived and no label when the server sent none', async () => {
    globalThis.fetch.mockResolvedValue(answer([{ sym: 'AAAQ' }]))
    const out = await calendarEventsRead('/x')
    expect(out.body).toEqual([{ sym: 'AAAQ' }])
    expect(out.readStatus).toBeNull()
    expect(Number.isNaN(new Date(out.receivedAt).getTime())).toBe(false)
  })

  it('keeps the server\'s label for a failed or a partial read, and no other word', async () => {
    expect(CALENDAR_READ_HEADER).toBe('X-Calendar-Read')
    for (const [label, want] of [['failed', 'failed'], ['partial', 'partial'], ['ok', null], ['', null], ['FAILED', null]]) {
      globalThis.fetch.mockResolvedValue(answer([], label))
      expect((await calendarEventsRead('/x')).readStatus, label).toBe(want)
    }
  })

  it('an answer with no headers object is read without a label, not thrown', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] })
    expect(await calendarEventsRead('/x')).toMatchObject({ body: [], readStatus: null })
  })

  it('a non-2xx answer throws with its status, which the failure words read', async () => {
    for (const [status, words, kind] of [
      [401, 'You are signed out, so the IPO calendar cannot be read. Sign in again.', 'error'],
      [402, 'The IPO calendar needs a paid plan.', 'locked'],
      [500, 'The IPO calendar could not be read just now.', 'error'],
    ]) {
      globalThis.fetch.mockResolvedValue({ ok: false, status, headers: { get: () => null }, json: async () => ({}) })
      const err = await calendarEventsRead('/x').catch((e) => e)
      expect(err, String(status)).toBeInstanceOf(Error)
      expect(err.status).toBe(status)
      expect(failureText(err, 'The IPO calendar')).toBe(words)
      expect(failureKind(err)).toBe(kind)
      expect(canRetry(err)).toBe(kind === 'error')
    }
  })

  it('a request that never answers ends at the shared 30 second deadline', async () => {
    vi.useFakeTimers()
    try {
      globalThis.fetch.mockReturnValue(new Promise(() => {}))
      const pending = calendarEventsRead('/x').catch((e) => e)
      await vi.advanceTimersByTimeAsync(30000)
      const err = await pending
      expect(err.timedOut).toBe(true)
      expect(failureText(err, 'The IPO calendar')).toBe('The IPO calendar did not answer within 30 seconds.')
    } finally {
      vi.useRealTimers()
    }
  })

  it('the cache key is never the bare URL, and no URL is no read', () => {
    expect(calendarEventsKey('/api/calendar/dividends')).toEqual(['/api/calendar/dividends', 'terminal-calendar-events'])
    expect(calendarEventsKey(null)).toBeNull()
    expect(calendarEventsKey('')).toBeNull()
  })
})
