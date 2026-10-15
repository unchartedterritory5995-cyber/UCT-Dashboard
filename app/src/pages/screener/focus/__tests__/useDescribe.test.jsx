import { renderHook, act, waitFor } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'
vi.mock('../../shell/criteriaApi', () => ({
  compileEnglish: vi.fn(async () => ({ filters: [{ key: 'rs_rank', op: 'gte', min: 80 }], logic: { all: [] }, explanation: [] })),
  grammarAvailable: vi.fn(async () => true),
  compileAvailable: vi.fn(async () => true),
}))
import * as api from '../../shell/criteriaApi'
import useDescribe, { __resetDescribeSession, describeFailure, DESCRIBE_DOWN, DESCRIBE_BUSY } from '../useDescribe'
import { AuthContext } from '../../../../context/AuthContext'

const withStatus = (msg, status) => Object.assign(new Error(msg), { status })
const UNAVAILABLE = 'Plain-English screens are unavailable right now. Try again shortly.'

beforeEach(() => { __resetDescribeSession(); api.grammarAvailable.mockClear(); api.compileAvailable.mockClear() })

test('available when both doors answer, and run returns filters', async () => {
  const { result } = renderHook(() => useDescribe())
  await waitFor(() => expect(result.current.available).toBe(true))
  let out
  await act(async () => { out = await result.current.run('liquid leaders') })
  expect(out.filters).toHaveLength(1)
})

test('not available when the compile door is dark', async () => {
  api.compileAvailable.mockResolvedValueOnce(false)
  const { result } = renderHook(() => useDescribe())
  await waitFor(() => expect(api.compileAvailable).toHaveBeenCalled())
  expect(result.current.available).toBe(false)
})

test('disabled hook makes no probe', () => {
  renderHook(() => useDescribe(false))
  expect(api.grammarAvailable).not.toHaveBeenCalled()
})

test('a refused compile surfaces the server sentence and returns null; the box stays', async () => {
  api.compileEnglish.mockRejectedValueOnce(new Error('Daily limit reached.'))
  const { result } = renderHook(() => useDescribe())
  await waitFor(() => expect(result.current.available).toBe(true))
  let out
  await act(async () => { out = await result.current.run('x') })
  expect(out).toBeNull()
  expect(result.current.error).toBe('Daily limit reached.')
  expect(result.current.available).toBe(true)
})

test('the hook keeps no private probe cache: dedupe lives in criteriaApi', async () => {
  const a = renderHook(() => useDescribe())
  await waitFor(() => expect(a.result.current.available).toBe(true))
  const b = renderHook(() => useDescribe())
  await waitFor(() => expect(b.result.current.available).toBe(true))
  // criteriaApi is mocked here, so each mount asking is what proves the hook holds no cache of its own
  expect(api.grammarAvailable).toHaveBeenCalledTimes(2)
})

test('B11: no exception name or raw "Not Found" is ever shown; plain copy instead', () => {
  const busy = { hard: false, text: DESCRIBE_BUSY }
  const down = { hard: true, text: DESCRIBE_DOWN }
  // broken, but not shut: plain copy, and the box stays
  expect(describeFailure(new Error('Compile failed (RuntimeError)'))).toEqual(busy)
  expect(describeFailure(new Error('ValueError: bad thing'))).toEqual(busy)
  expect(describeFailure(new Error('compile 502'))).toEqual(busy)
  expect(describeFailure(new TypeError('Failed to fetch'))).toEqual(busy)
  // the door is shut: plain copy, and the box is hidden from the next open
  expect(describeFailure(withStatus('Not Found', 404))).toEqual(down)
  expect(describeFailure(new Error('Not Found'))).toEqual(down)
  expect(describeFailure(withStatus('The screener requires a paid plan', 402))).toEqual(down)
  expect(describeFailure(new Error('The screener requires a paid plan'))).toEqual(down)
  expect(describeFailure(withStatus('Forbidden', 403))).toEqual(down)
  // refusals keep the server's own sentence
  expect(describeFailure(new Error('Describe the screen you want.'))).toEqual({ hard: false, text: 'Describe the screen you want.' })
  expect(describeFailure(new Error('compile 400'))).toEqual({ hard: false, text: 'Could not read that. Try different words.' })
  for (const e of [new Error('Compile failed (RuntimeError)'), new Error('compile 503'), new Error('Not Found'), withStatus('Not Found', 404)]) {
    expect(describeFailure(e).text).not.toMatch(/Error|compile \d|Not Found|paid plan/)
  }
})

test('a transient 503 "try again shortly" is SOFT: its own sentence is shown, nothing is hidden', () => {
  expect(describeFailure(withStatus(UNAVAILABLE, 503))).toEqual({ hard: false, text: UNAVAILABLE })
  expect(describeFailure(new Error(UNAVAILABLE))).toEqual({ hard: false, text: UNAVAILABLE })
})

test('a 503 stays visible: the sentence shows and the box is still there on the next open', async () => {
  api.compileEnglish.mockRejectedValueOnce(withStatus(UNAVAILABLE, 503))
  const { result, rerender } = renderHook(({ on }) => useDescribe(on), { initialProps: { on: true } })
  await waitFor(() => expect(result.current.available).toBe(true))
  await act(async () => { await result.current.run('x') })
  expect(result.current.error).toBe(UNAVAILABLE)
  expect(result.current.available).toBe(true)
  rerender({ on: false })
  rerender({ on: true })
  await waitFor(() => expect(result.current.available).toBe(true))
  // and another drawer in the same session still offers it
  const other = renderHook(() => useDescribe())
  await waitFor(() => expect(other.result.current.available).toBe(true))
})

test('B11: after a shut-door answer the box stays for this open, then is hidden for the session', async () => {
  api.compileEnglish.mockRejectedValueOnce(withStatus('Not Found', 404))
  const { result, rerender } = renderHook(({ on }) => useDescribe(on), { initialProps: { on: true } })
  await waitFor(() => expect(result.current.available).toBe(true))
  await act(async () => { await result.current.run('x') })
  expect(result.current.error).toBe(DESCRIBE_DOWN)
  // still shown for THIS open, so the sentence is read
  expect(result.current.available).toBe(true)
  // close and reopen: gone, and no probe is spent asking again
  rerender({ on: false })
  api.grammarAvailable.mockClear()
  rerender({ on: true })
  expect(result.current.available).toBe(false)
  // a fresh mount (another drawer) in the same session is hidden too
  const other = renderHook(() => useDescribe())
  await new Promise(r => setTimeout(r, 0))
  expect(other.result.current.available).toBe(false)
  expect(api.grammarAvailable).not.toHaveBeenCalled()
})

test('the session hide is per signed-in user: someone else signing in starts clean', async () => {
  let user = { id: 'u1' }
  const wrapper = ({ children }) => <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>
  api.compileEnglish.mockRejectedValueOnce(withStatus('Not Found', 404))
  const a = renderHook(() => useDescribe(), { wrapper })
  await waitFor(() => expect(a.result.current.available).toBe(true))
  await act(async () => { await a.result.current.run('x') })
  a.unmount()
  const same = renderHook(() => useDescribe(), { wrapper })
  await new Promise(r => setTimeout(r, 0))
  expect(same.result.current.available).toBe(false)
  same.unmount()
  user = { id: 'u2' }
  const other = renderHook(() => useDescribe(), { wrapper })
  await waitFor(() => expect(other.result.current.available).toBe(true))
})

test('a refusal does not hide the box on the next open', async () => {
  api.compileEnglish.mockRejectedValueOnce(new Error('Describe the screen you want.'))
  const { result, rerender } = renderHook(({ on }) => useDescribe(on), { initialProps: { on: true } })
  await waitFor(() => expect(result.current.available).toBe(true))
  await act(async () => { await result.current.run('') })
  rerender({ on: false })
  rerender({ on: true })
  await waitFor(() => expect(result.current.available).toBe(true))
})
