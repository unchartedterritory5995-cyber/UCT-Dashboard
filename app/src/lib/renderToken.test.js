import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as renderToken from './renderToken'
import { renderReadError, renderRefused, useServerTokenCheck } from './renderToken'

describe('renderRefused: the server said no', () => {
  it('is true for 403 (the render token check) and 401 (no session)', () => {
    expect(renderRefused(403)).toBe(true)
    expect(renderRefused(401)).toBe(true)
  })

  it('is false for every other answer, including other failures', () => {
    for (const status of [200, 204, 304, 400, 404, 429, 500, 502, 503]) {
      expect(renderRefused(status)).toBe(false)
    }
  })

  it('is false when there is no status at all', () => {
    expect(renderRefused(undefined)).toBe(false)
    expect(renderRefused(null)).toBe(false)
    expect(renderRefused(new TypeError('Failed to fetch'))).toBe(false)
  })

  it('does not match a status sent as text', () => {
    // A page passes the number from `Response.status`. Matching '403' as well would let an error
    // message that happens to read "403" count as the server's answer.
    expect(renderRefused('403')).toBe(false)
    expect(renderRefused('401')).toBe(false)
  })
})

describe('renderReadError: the line a panel page shows for a failed read', () => {
  it('says "unauthorized" when the server refused the read', () => {
    expect(renderReadError(403)).toBe('unauthorized')
    expect(renderReadError(401)).toBe('unauthorized')
  })

  it('says "data unavailable" for every other failure', () => {
    expect(renderReadError(500)).toBe('data unavailable')
    expect(renderReadError(429)).toBe('data unavailable')
    expect(renderReadError(404)).toBe('data unavailable')
    expect(renderReadError(new TypeError('Failed to fetch'))).toBe('data unavailable')
    expect(renderReadError(new SyntaxError('Unexpected token <'))).toBe('data unavailable')
    expect(renderReadError(undefined)).toBe('data unavailable')
  })
})

describe('the module holds no check of its own', () => {
  it('exports the two helpers and the hook, and nothing that compares a token', () => {
    expect(Object.keys(renderToken).sort()).toEqual(['renderReadError', 'renderRefused', 'useServerTokenCheck'])
  })
})

// ---- useServerTokenCheck: one question to the server before a page draws ----

const ROUTE = '/api/r/chart-settings?token='
const reply = (status) => Promise.resolve({ ok: status >= 200 && status < 300, status })
const never = () => new Promise(() => {})

// Each stubbed request is kept, with its url, its abort signal and a way to answer it later.
function stubFetch(answerFor) {
  const requests = []
  const fetchMock = vi.fn((url, init) => {
    const request = { url: String(url), signal: init && init.signal }
    const promise = new Promise((resolve, reject) => {
      request.resolve = resolve
      request.reject = reject
    })
    requests.push(request)
    const immediate = answerFor ? answerFor(request.url) : undefined
    return immediate === undefined ? promise : immediate
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, requests }
}

const pass = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

describe('useServerTokenCheck', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is pending until the server answers', async () => {
    vi.useFakeTimers()
    stubFetch(never)
    const { result } = renderHook(() => useServerTokenCheck('t'))
    expect(result.current).toBe('pending')
    await pass(1000)
    expect(result.current).toBe('pending')
  })

  it.each([403, 401])('a %i answer is refused', async (status) => {
    stubFetch(() => reply(status))
    const { result } = renderHook(() => useServerTokenCheck('t'))
    expect(result.current).toBe('pending')
    await waitFor(() => expect(result.current).toBe('refused'))
  })

  it.each([200, 204, 404, 429, 500, 503])('a %i answer is ok', async (status) => {
    stubFetch(() => reply(status))
    const { result } = renderHook(() => useServerTokenCheck('t'))
    await waitFor(() => expect(result.current).toBe('ok'))
  })

  it('a request that fails is ok', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    const { result } = renderHook(() => useServerTokenCheck('t'))
    await waitFor(() => expect(result.current).toBe('ok'))
  })

  it('a request that cannot be started is ok', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('no network stack') }))
    const { result } = renderHook(() => useServerTokenCheck('t'))
    await waitFor(() => expect(result.current).toBe('ok'))
  })

  it('no answer within four seconds is ok, and the request is aborted', async () => {
    vi.useFakeTimers()
    const { requests } = stubFetch()
    const { result } = renderHook(() => useServerTokenCheck('t'))

    await pass(3999)
    expect(result.current).toBe('pending')
    expect(requests[0].signal.aborted).toBe(false)

    await pass(1)
    expect(result.current).toBe('ok')
    expect(requests[0].signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the first outcome is the decision: an answer after the four seconds changes nothing', async () => {
    vi.useFakeTimers()
    const { requests } = stubFetch()
    const { result } = renderHook(() => useServerTokenCheck('t'))
    await pass(4000)
    expect(result.current).toBe('ok')

    requests[0].resolve({ ok: false, status: 403 })
    await pass(1000)
    expect(result.current).toBe('ok')
  })

  it('an answer before the four seconds clears the timer', async () => {
    vi.useFakeTimers()
    const { requests } = stubFetch()
    const { result } = renderHook(() => useServerTokenCheck('t'))
    expect(vi.getTimerCount()).toBe(1)

    requests[0].resolve({ ok: false, status: 403 })
    await pass(10)
    expect(result.current).toBe('refused')
    expect(vi.getTimerCount()).toBe(0)
    await pass(5000)
    expect(result.current).toBe('refused')
  })

  it('makes ONE read of the token-checked route and forwards the address token url-encoded', async () => {
    const { fetchMock } = stubFetch(() => reply(200))
    const { result, rerender } = renderHook(() => useServerTokenCheck('a b&c=d/e+f'))
    await waitFor(() => expect(result.current).toBe('ok'))
    rerender()
    rerender()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${ROUTE}a%20b%26c%3Dd%2Fe%2Bf`)
  })

  it('an address with no token still asks the server, which decides', async () => {
    const { fetchMock } = stubFetch(() => reply(403))
    const { result } = renderHook(() => useServerTokenCheck(''))
    await waitFor(() => expect(result.current).toBe('refused'))
    expect(fetchMock.mock.calls[0][0]).toBe(ROUTE)
  })

  it('after unmount: the timer is cleared, the request aborted, and a late answer renders nothing', async () => {
    vi.useFakeTimers()
    const { requests } = stubFetch()
    let renders = 0
    const { result, unmount } = renderHook(() => {
      renders += 1
      return useServerTokenCheck('t')
    })
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(requests[0].signal.aborted).toBe(true)

    const before = renders
    requests[0].resolve({ ok: false, status: 403 })
    await pass(5000)
    expect(renders).toBe(before)
    expect(result.current).toBe('pending')
  })

  it('a new token is asked again, and is pending until its own answer', async () => {
    const { fetchMock, requests } = stubFetch((url) => (url === `${ROUTE}first` ? reply(200) : undefined))
    const { result, rerender } = renderHook(({ token }) => useServerTokenCheck(token), {
      initialProps: { token: 'first' },
    })
    await waitFor(() => expect(result.current).toBe('ok'))

    rerender({ token: 'second' })
    expect(result.current).toBe('pending')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(requests[1].url).toBe(`${ROUTE}second`)

    await act(async () => { requests[1].resolve({ ok: false, status: 403 }) })
    await waitFor(() => expect(result.current).toBe('refused'))
  })

  it('an answer for a token the page no longer has sets no state', async () => {
    vi.useFakeTimers()
    const { requests } = stubFetch()
    let renders = 0
    const { result, rerender } = renderHook(({ token }) => {
      renders += 1
      return useServerTokenCheck(token)
    }, { initialProps: { token: 'first' } })

    rerender({ token: 'second' })
    await pass(10)
    expect(requests).toHaveLength(2)
    expect(requests[0].signal.aborted).toBe(true)
    expect(requests[1].signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(1)

    const before = renders
    requests[0].resolve({ ok: false, status: 403 })
    await pass(10)
    expect(renders).toBe(before)
    expect(result.current).toBe('pending')

    requests[1].resolve({ ok: true, status: 200 })
    await pass(10)
    expect(result.current).toBe('ok')
  })
})
