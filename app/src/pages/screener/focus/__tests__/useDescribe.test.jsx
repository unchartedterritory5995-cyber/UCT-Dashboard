import { renderHook, act, waitFor } from '@testing-library/react'
import { vi, test, expect } from 'vitest'
vi.mock('../../shell/criteriaApi', () => ({
  compileEnglish: vi.fn(async () => ({ filters: [{ key: 'rs_rank', op: 'gte', min: 80 }], logic: { all: [] }, explanation: [] })),
  grammarAvailable: vi.fn(async () => true),
  compileAvailable: vi.fn(async () => true),
}))
import * as api from '../../shell/criteriaApi'
import useDescribe from '../useDescribe'

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
  api.grammarAvailable.mockClear()
  renderHook(() => useDescribe(false))
  expect(api.grammarAvailable).not.toHaveBeenCalled()
})

test('a failed compile surfaces the server sentence and returns null', async () => {
  api.compileEnglish.mockRejectedValueOnce(new Error('Daily limit reached.'))
  const { result } = renderHook(() => useDescribe())
  let out
  await act(async () => { out = await result.current.run('x') })
  expect(out).toBeNull()
  expect(result.current.error).toBe('Daily limit reached.')
})
