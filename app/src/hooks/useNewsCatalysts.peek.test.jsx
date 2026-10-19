// A host that reads one News & Catalysts feed per row it steps through (the screener) must PEEK:
// the ordinary read starts an AI write-up for a stock not yet covered.
import { renderHook, act } from '@testing-library/react'
import { vi, expect, test, beforeEach, afterEach } from 'vitest'

const keys = []
vi.mock('./useMobileSWR', () => ({
  default: (key) => { keys.push(key); return { data: undefined, error: null, isLoading: !!key } },
}))
import useNewsCatalysts, { PEEK_SETTLE_MS } from './useNewsCatalysts'

beforeEach(() => { keys.length = 0; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('the ordinary read asks for the feed at once, on the generating URL /charts has always used', () => {
  renderHook(() => useNewsCatalysts('NVDA'))
  expect(keys[0]).toBe('/api/news-catalysts/NVDA')
})

test('a peek waits for the symbol to settle, then asks with generate=0, and reads as loading meanwhile', () => {
  const { result, rerender } = renderHook(({ sym }) => useNewsCatalysts(sym, { peek: true }), { initialProps: { sym: 'AAA' } })
  expect(keys.every(k => k === null)).toBe(true)
  expect(result.current.status).toBe('loading')
  // A held ↓ walks past BBB before it settles: BBB is never read.
  act(() => { vi.advanceTimersByTime(PEEK_SETTLE_MS - 50) })
  rerender({ sym: 'BBB' })
  act(() => { vi.advanceTimersByTime(PEEK_SETTLE_MS - 50) })
  rerender({ sym: 'CCC' })
  act(() => { vi.advanceTimersByTime(PEEK_SETTLE_MS) })
  const asked = keys.filter(Boolean)
  expect(new Set(asked)).toEqual(new Set(['/api/news-catalysts/CCC?generate=0']))
})

test('every key a peek ever asks for carries generate=0', () => {
  const { rerender } = renderHook(({ sym }) => useNewsCatalysts(sym, { peek: true, generating: true }), { initialProps: { sym: 'AAA' } })
  act(() => { vi.advanceTimersByTime(PEEK_SETTLE_MS) })
  rerender({ sym: 'BRK.B' })
  act(() => { vi.advanceTimersByTime(PEEK_SETTLE_MS) })
  const asked = keys.filter(Boolean)
  expect(asked.length).toBeGreaterThan(0)
  for (const k of asked) expect(k.endsWith('?generate=0')).toBe(true)
})
