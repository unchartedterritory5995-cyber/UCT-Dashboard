import { renderHook, act, waitFor } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'
vi.mock('../../shell/criteriaApi', () => ({
  compileEnglish: vi.fn(async () => ({ filters: [{ key: 'rs_rank', op: 'gte', min: 80 }], logic: { all: [] }, explanation: [] })),
  grammarAvailable: vi.fn(async () => true),
  compileAvailable: vi.fn(async () => true),
}))
import * as api from '../../shell/criteriaApi'
import useDescribe, { __resetDescribeSession, describeFailure, DESCRIBE_DOWN } from '../useDescribe'

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

test('B11: an exception name is never shown; plain copy instead', () => {
  expect(describeFailure(new Error('Compile failed (RuntimeError)'))).toEqual({ hard: true, text: DESCRIBE_DOWN })
  expect(describeFailure(new Error('ValueError: bad thing'))).toEqual({ hard: true, text: DESCRIBE_DOWN })
  expect(describeFailure(new Error('compile 502'))).toEqual({ hard: true, text: DESCRIBE_DOWN })
  expect(describeFailure(new TypeError('Failed to fetch'))).toEqual({ hard: true, text: DESCRIBE_DOWN })
  expect(describeFailure(new Error('Plain-English screens are unavailable right now. Try again shortly.')).hard).toBe(true)
  // refusals keep the server's own sentence and are not hard failures
  expect(describeFailure(new Error('Describe the screen you want.'))).toEqual({ hard: false, text: 'Describe the screen you want.' })
  expect(describeFailure(new Error('compile 400')).hard).toBe(false)
  expect(describeFailure(new Error('compile 400')).text).not.toMatch(/compile 400/)
  for (const e of [new Error('Compile failed (RuntimeError)'), new Error('compile 503')]) {
    expect(describeFailure(e).text).not.toMatch(/Error|compile \d/)
  }
})

test('B11: after a hard failure the box stays for this open, then is hidden for the session', async () => {
  api.compileEnglish.mockRejectedValueOnce(new Error('Compile failed (RuntimeError)'))
  const { result, rerender } = renderHook(({ on }) => useDescribe(on), { initialProps: { on: true } })
  await waitFor(() => expect(result.current.available).toBe(true))
  await act(async () => { await result.current.run('x') })
  expect(result.current.error).toBe(DESCRIBE_DOWN)
  expect(result.current.error).not.toMatch(/RuntimeError/)
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

test('a refusal does not hide the box on the next open', async () => {
  api.compileEnglish.mockRejectedValueOnce(new Error('Describe the screen you want.'))
  const { result, rerender } = renderHook(({ on }) => useDescribe(on), { initialProps: { on: true } })
  await waitFor(() => expect(result.current.available).toBe(true))
  await act(async () => { await result.current.run('') })
  rerender({ on: false })
  rerender({ on: true })
  await waitFor(() => expect(result.current.available).toBe(true))
})
