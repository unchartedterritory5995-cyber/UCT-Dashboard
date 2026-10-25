// Notebook widgets wave 10 (Task 10.14): the ready-made dedicated widgets' client. Asserted by the request the browser
// actually sends (W10-R4: the body, never the query string) and by the exact sentences a member reads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  SHELF_WIDGETS_URL, DEDICATED_SETTINGS, BUSY_RETRY_MS, isDedicated, runDedicated, dedicatedRequestOf,
  dedicatedRefreshParams, __resetDedicatedQueue,
} from './dedicatedWidgets'
import { FAILURE_COPY, failureText } from './builtWidgets'
import { WIDGET_KINDS } from './notebookWidgets'

const setOnline = (value) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const SEVEN = ['myTiltCheck', 'myRevengeClean', 'myPlanVsActual', 'myRiskLeftToday', 'myPropFirm', 'myGamePlan', 'myAlertsFired']

let fetchSpy
beforeEach(() => {
  setOnline(true)
  __resetDedicatedQueue()
  fetchSpy = vi.fn(async () => reply(200, { asOf: '2026-10-24T14:00:00Z', lines: ['ok'] }))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  setOnline(true)
})

describe('the seven kinds', () => {
  it('isDedicated is the WIDGET_KINDS `dedicated` flag, and nothing else answers yes', () => {
    expect(WIDGET_KINDS.filter((k) => k.dedicated).map((k) => k.id)).toEqual(SEVEN)
    for (const k of SEVEN) expect(isDedicated(k), k).toBe(true)
    for (const k of ['builtWidget', 'myPnlStats', 'tradeRecap', 'nope', undefined, '__proto__']) expect(isDedicated(k), k).toBe(false)
  })

  it('the settings each kind keeps are the server PARAMS (shelf_kinds.PARAMS), and only those kinds have any', () => {
    expect(DEDICATED_SETTINGS).toEqual({
      myTiltCheck: ['from', 'to'], myPlanVsActual: ['tradeId'],
      myPropFirm: ['dailyLoss', 'maxDrawdown', 'since', 'accountId'],
    })
    for (const k of Object.keys(DEDICATED_SETTINGS)) expect(isDedicated(k), k).toBe(true)
  })
})

describe('runDedicated', () => {
  it('run_posts_body_never_query: POST to the kind\'s own door, the settings in the JSON body, nothing in the URL', async () => {
    const got = await runDedicated('myPropFirm', { dailyLoss: 500, maxDrawdown: 2500, since: '2026-10-01', accountId: 'acc-1' })
    expect(got).toEqual({ ok: true, data: { asOf: '2026-10-24T14:00:00Z', lines: ['ok'] } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(SHELF_WIDGETS_URL).toBe('/api/j2/notebook-shelf-widgets')
    expect(url).toBe('/api/j2/notebook-shelf-widgets/myPropFirm')
    expect(url).not.toContain('?')
    expect(url).not.toMatch(/500|2500|acc-1/)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ params: { dailyLoss: 500, maxDrawdown: 2500, since: '2026-10-01', accountId: 'acc-1' } })
    expect(init.signal).toBeDefined()                                 // FETCH_TIMEOUT_MS bounds a stalled wire
  })

  it('a kind name is a path segment, encoded', async () => {
    await runDedicated('a/b?c', {})
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/notebook-shelf-widgets/a%2Fb%3Fc')
  })

  it('dark_404_is_unavailable: the dark wave (or an unknown kind) reads "Not available right now."', async () => {
    fetchSpy.mockResolvedValueOnce(reply(404, { detail: 'Not found' }))
    const got = await runDedicated('myTiltCheck', {})
    expect(got).toMatchObject({ ok: false, code: 'unavailable', status: 404 })
    expect(failureText(got.code, got.message)).toBe('Not available right now.')
  })

  it('a refused setting carries the server\'s own sentence; a 402 is the paid copy; a network error is failed', async () => {
    fetchSpy.mockResolvedValueOnce(reply(400, { detail: { code: 'invalid', message: 'Dates need to look like 2026-10-24.' } }))
    let got = await runDedicated('myTiltCheck', { from: 'x' })
    expect(failureText(got.code, got.message)).toBe('Dates need to look like 2026-10-24.')
    fetchSpy.mockResolvedValueOnce(reply(402, { detail: 'Ready-made widgets require a paid plan' }))
    got = await runDedicated('myTiltCheck', {})
    expect(got.code).toBe('paid')
    fetchSpy.mockRejectedValueOnce(new Error('network'))
    got = await runDedicated('myTiltCheck', {})
    expect(got).toMatchObject({ ok: false, code: 'failed' })
  })

  it('an answer with no asOf is not a snapshot and counts as failed', async () => {
    fetchSpy.mockResolvedValueOnce(reply(200, { lines: [] }))
    expect(await runDedicated('myGamePlan', {})).toMatchObject({ ok: false, code: 'failed' })
  })

  it('offline makes no request', async () => {
    setOnline(false)
    expect(await runDedicated('myGamePlan', {})).toMatchObject({ ok: false, code: 'offline' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('four_refreshes_at_once_all_land: the server admits two per member (MEMBER_MAX), the client sends one at a time', async () => {
    // A server stand-in that answers busy when a third request arrives while two are in flight (run.admit).
    let inFlight = 0
    let peak = 0
    fetchSpy.mockImplementation(async (url) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        if (inFlight > 2) return reply(503, { detail: { code: 'busy', message: 'Busy right now. Try again in a moment.' } })
        await new Promise((r) => setTimeout(r, 5))
        return reply(200, { asOf: '2026-10-24T14:00:00Z', kind: url.split('/').pop() })
      } finally {
        inFlight -= 1
      }
    })
    const kinds = ['myTiltCheck', 'myRevengeClean', 'myRiskLeftToday', 'myAlertsFired']
    const got = await Promise.all(kinds.map((k) => runDedicated(k, {})))
    expect(got.map((g) => g.ok)).toEqual([true, true, true, true])
    expect(got.map((g) => g.data.kind)).toEqual(kinds)
    expect(got.some((g) => g.code === 'busy')).toBe(false)
    expect(peak).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it('a failed run never stops the queue behind it', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('network'))
    const [a, b] = await Promise.all([runDedicated('myTiltCheck', {}), runDedicated('myGamePlan', {})])
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(true)
  })

  it('busy_retries_once: a busy answer (a built widget held the slots) is asked once more after a short wait', async () => {
    vi.useFakeTimers()
    fetchSpy
      .mockResolvedValueOnce(reply(503, { detail: { code: 'busy', message: 'Busy right now. Try again in a moment.' } }))
      .mockResolvedValueOnce(reply(200, { asOf: '2026-10-24T14:00:00Z' }))
    const pending = runDedicated('myGamePlan', {})
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS - 1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)                       // the wait is real, not an immediate re-ask
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toMatchObject({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('busy twice reads the busy sentence (one retry, never a loop)', async () => {
    vi.useFakeTimers()
    fetchSpy.mockResolvedValue(reply(503, { detail: { code: 'busy', message: 'x' } }))
    const pending = runDedicated('myGamePlan', {})
    await vi.advanceTimersByTimeAsync(BUSY_RETRY_MS * 4)
    const got = await pending
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(failureText(got.code, got.message)).toBe(FAILURE_COPY.busy)
  })
})

describe('the member\'s settings', () => {
  it('dedicatedRequestOf sends only the member\'s own settings, never the echoed payload', () => {
    // A default tilt widget: the payload echoes the RESOLVED window; re-sending it would freeze the widget on it.
    expect(dedicatedRequestOf('myTiltCheck', { asOf: 'x', from: '2026-07-26', to: '2026-10-24', lines: [] })).toEqual({})
    expect(dedicatedRequestOf('myTiltCheck', { from: '2026-07-26', settings: { from: '2026-09-01', to: '2026-09-30' } }))
      .toEqual({ from: '2026-09-01', to: '2026-09-30' })
    // a key that is not the kind's setting is never sent; a malformed settings value is no settings
    expect(dedicatedRequestOf('myGamePlan', { settings: { from: '2026-09-01' } })).toEqual({})
    expect(dedicatedRequestOf('myPropFirm', { settings: ['x'] })).toEqual({})
    expect(dedicatedRequestOf('myPropFirm', { settings: { dailyLoss: 500, maxDrawdown: '', since: null } })).toEqual({ dailyLoss: 500 })
  })

  it('refresh_keeps_settings_and_share: the payload, plus the member\'s settings and the CURRENT share; no setting dropped', () => {
    const old = {
      asOf: '2026-10-20T14:00:00Z', share: true, lines: ['old'], daily: { left: 1 },
      settings: { dailyLoss: 500, maxDrawdown: 2500, since: '2026-10-01', accountId: 'acc-1' },
    }
    const payload = { asOf: '2026-10-24T14:00:00Z', lines: ['new'], since: '2026-10-01', accountId: 'acc-1', trailing: null }
    const next = dedicatedRefreshParams(old, payload)
    expect(next).toEqual({ ...payload, settings: old.settings, share: true })
    expect(next.settings).not.toBe(old.settings)                      // a copy: the old params are never shared
    expect(next.daily).toBeUndefined()                                // nothing else is copied from the old params
    expect(dedicatedRefreshParams({ share: 'true' }, payload).share).toBe(false)
    expect(dedicatedRefreshParams({}, payload)).toEqual({ ...payload, share: false })
    // a payload cannot overwrite the member's settings
    expect(dedicatedRefreshParams(old, { ...payload, settings: { dailyLoss: 1 } }).settings).toEqual(old.settings)
  })
})
