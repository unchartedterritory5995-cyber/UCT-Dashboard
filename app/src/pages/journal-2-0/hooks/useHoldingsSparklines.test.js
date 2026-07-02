import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import useHoldingsSparklines from './useHoldingsSparklines'

const barsFor = (closes) => ({ bars: closes.map((c, i) => ({ t: 1700000000 + i * 86400, c })) })

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    const sym = url.match(/\/api\/bars\/([A-Z0-9.]+)\?/)?.[1]
    if (sym === 'BAD') return Promise.resolve({ ok: false })
    return Promise.resolve({ ok: true, json: () => Promise.resolve(barsFor([1, 2, 3])) })
  })
})
afterEach(() => vi.restoreAllMocks())

describe('useHoldingsSparklines', () => {
  it('fetches daily closes per symbol', async () => {
    const { result } = renderHook(() => useHoldingsSparklines(['AAPL', 'TSLA']))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.closes.AAPL).toEqual([1, 2, 3])
    expect(result.current.closes.TSLA).toEqual([1, 2, 3])
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/bars/AAPL?tf=D&bars=30', expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('yields [] for a failed symbol without breaking the rest', async () => {
    const { result } = renderHook(() => useHoldingsSparklines(['AAPL', 'BAD']))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.closes.AAPL).toEqual([1, 2, 3])
    expect(result.current.closes.BAD).toEqual([])
  })

  it('returns empty map for no symbols without fetching', () => {
    const { result } = renderHook(() => useHoldingsSparklines([]))
    expect(result.current.closes).toEqual({})
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('caps fan-out at 60 symbols', async () => {
    const many = Array.from({ length: 80 }, (_, i) => `S${i}A`)
    const { result } = renderHook(() => useHoldingsSparklines(many))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(global.fetch).toHaveBeenCalledTimes(60)
  })
})
