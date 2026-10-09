// Wave 9 lane 9 (states and copy). Rails:
//   * a switched-off route (404) and a paywall (402) are failures Retry cannot fix: `locked`, no Retry,
//     and the 404 says "not switched on", never a generic "could not be read";
//   * a server "warming" answer (503 {"error":"warming"} / {"status":"computing"}) is recognised by its
//     BODY: a bare 503 is an outage, not a warm-up;
//   * a warming read re-polls briefly, then says it is still being prepared and offers Retry;
//   * the comparison panels (REL / RRG / CORR) show "Loading, the server is preparing this" while the
//     bar store warms a name, and fill in on their own when it lands.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, renderHook, act, cleanup, waitFor } from '@testing-library/react'
import {
  WARMING_TITLE, canRetry, failureKind, failureText, isWarmingBody, isWarmingError, midSentence,
} from './marketRead'
import useWarmingPoll from './warmingPoll'
import WarmingState from './WarmingState'
import RelPanel from './RelPanel'
import { clearClosesCache, failedText } from './useCloses'
import { fakeBarsFetch, series, weekdays } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
beforeEach(() => { clearClosesCache() })
afterEach(() => { cleanup(); globalThis.fetch = realFetch; vi.useRealTimers() })

const err = (status, extra = {}) => Object.assign(new Error(`answered ${status}`), { status }, extra)

describe('which failures Retry can fix', () => {
  it('402 and 404 cannot; 500, 503 and a timeout can', () => {
    expect(canRetry(err(402))).toBe(false)
    expect(canRetry(err(404))).toBe(false)
    expect(canRetry(err(500))).toBe(true)
    expect(canRetry(err(503))).toBe(true)
    expect(canRetry(Object.assign(new Error('t'), { timedOut: true }))).toBe(true)
    expect(failureKind(err(404))).toBe('locked')
    expect(failureKind(err(500))).toBe('error')
  })

  it('a 404 reads "not switched on", a 402 "needs a paid plan", a timeout names the 30 s deadline', () => {
    expect(failureText(err(404), 'Market news')).toBe('Market news is not switched on for this server yet.')
    expect(failureText(err(402), 'Market news')).toBe('Market news needs a paid plan.')
    expect(failureText(Object.assign(new Error('t'), { timedOut: true }), 'Market news')).toContain('30 seconds')
    expect(failureText(err(500), 'Market news')).toBe('Market news could not be read just now.')
  })

  it('a signed-out sentence keeps a code in capitals mid-sentence', () => {
    expect(midSentence('RS rankings')).toBe('RS rankings')
    expect(midSentence('Market news')).toBe('market news')
    expect(failureText(err(401), 'RS rankings')).toBe('You are signed out, so RS rankings cannot be read. Sign in again.')
  })
})

describe('warming answers are recognised by their body', () => {
  it('every stub shape the backend sends', () => {
    expect(isWarmingBody({ ticker: 'X', tf: 'D', bars: [], error: 'warming' })).toBe(true)   // bars_fetch cold shed
    expect(isWarmingBody({ ticker: 'X', bars: [], warming: true })).toBe(true)              // bars warm-shed
    expect(isWarmingBody({ status: 'warming', error: 'RS rankings are being computed' })).toBe(true)
    expect(isWarmingBody({ themes: [], status: 'computing' })).toBe(true)                    // theme performance
    expect(isWarmingBody({ status: 'generating' })).toBe(true)                               // modelbook, calendar line
    expect(isWarmingBody({ status: 'ok' })).toBe(false)
    expect(isWarmingBody({ detail: 'busy' })).toBe(false)
    expect(isWarmingBody([])).toBe(false)
    expect(isWarmingBody(null)).toBe(false)
  })

  it('only a 503 carrying a warming body is a warm-up; a bare 503 is an outage', () => {
    expect(isWarmingError(err(503, { body: { error: 'warming' } }))).toBe(true)
    expect(isWarmingError(err(503))).toBe(false)
    expect(isWarmingError(err(503, { body: { error: 'RS ranking unavailable: boom' } }))).toBe(false)
    expect(isWarmingError(err(500, { body: { error: 'warming' } }))).toBe(false)
  })
})

describe('useWarmingPoll', () => {
  it('polls while active, stops after maxTries, and Retry starts a fresh round', () => {
    vi.useFakeTimers()
    const poll = vi.fn()
    const { result, rerender } = renderHook(({ on }) => useWarmingPoll(on, poll, { everyMs: 1000, maxTries: 3 }), {
      initialProps: { on: true },
    })
    expect(result.current.gaveUp).toBe(false)
    for (let i = 0; i < 5; i++) act(() => { vi.advanceTimersByTime(1000) })
    expect(poll).toHaveBeenCalledTimes(3)
    expect(result.current.gaveUp).toBe(true)
    act(() => { result.current.retry() })
    expect(poll).toHaveBeenCalledTimes(4)
    expect(result.current.gaveUp).toBe(false)
    rerender({ on: false })
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(poll).toHaveBeenCalledTimes(4)
    expect(result.current.gaveUp).toBe(false)
  })
})

describe('WarmingState', () => {
  it('says the server is preparing it, then (given up) says so with a Retry', () => {
    const { rerender } = render(<WarmingState what="the RS rankings" testId="w" />)
    expect(screen.getByTestId('w').textContent).toContain(WARMING_TITLE)
    expect(screen.getByTestId('w').getAttribute('data-kind')).toBe('empty')
    expect(screen.queryByRole('button')).toBeNull()
    const retry = vi.fn()
    rerender(<WarmingState what="the RS rankings" gaveUp onRetry={retry} testId="w" />)
    expect(screen.getByTestId('w').textContent).toContain('The server is still preparing the RS rankings.')
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('no member-visible em-dash in the warming copy', () => {
    render(<WarmingState what="price history" testId="w" />)
    expect(screen.getByTestId('w').textContent).not.toMatch(/[—–]/)
  })
})

describe('the comparison panels while the bar store warms a name', () => {
  const dates = weekdays(80)
  it('REL shows the warming state, re-asks, and fills in on its own when the bars land', async () => {
    const ok = fakeBarsFetch({ NVDA: series(dates, () => 0.002), AMD: series(dates, () => 0.001) })
    let amdCalls = 0
    globalThis.fetch = vi.fn((url) => {
      if (/\/api\/bars\/AMD/.test(String(url)) && amdCalls++ === 0) {
        return Promise.resolve({ ok: false, status: 503, json: async () => ({ ticker: 'AMD', tf: 'D', bars: [], error: 'warming' }) })
      }
      return ok(url)
    })
    render(<RelPanel sym="NVDA" with0="AMD" />)
    const warm = await screen.findByTestId('terminal-rel-warming')
    expect(warm.textContent).toContain(WARMING_TITLE)
    expect(screen.queryByTestId('terminal-rel-error')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('terminal-rel-table')).toBeTruthy(), { timeout: 8000 })
    expect(amdCalls).toBe(2)
  }, 12_000)

  it('a name still warming after the re-polls is named as "still preparing", not "could not read"', () => {
    const text = failedText({ phase: 'ready', failed: ['AMD', 'ZZZZ', 'X'], notFound: ['ZZZZ'], warming: ['AMD'] })
    expect(text).toContain('No price history for ZZZZ: check the ticker.')
    expect(text).toContain('The server is still preparing price history for AMD. Retry in a minute.')
    expect(text).toContain('Could not read X just now.')
    expect(text).not.toContain('Could not read AMD')
  })
})
