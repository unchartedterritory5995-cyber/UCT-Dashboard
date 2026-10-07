// TERM-033 -- the compare hook. A failed read comes back as `error`, never as a `null` that
// the page would draw as two columns of dashes. Real SWR, real useMobileSWR, real
// sectionFetcher; only `fetch` and the market clock are stood in.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: true, isPremarket: false, isExtended: false }),
}))

import useComparison from './useComparison'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

afterEach(() => { vi.restoreAllMocks() })

describe('useComparison (TERM-033)', () => {
  it('a refused request is an error with no data, not an empty comparison', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    const { result } = renderHook(() => useComparison('aapl', 'msft'), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.error.status).toBe(404)
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(globalThis.fetch.mock.calls[0][0]).toBe('/api/research/compare/AAPL/MSFT')
  })

  it('control: a readable answer is data, with no error', async () => {
    const body = { a: { sym: 'AAPL' }, b: { sym: 'MSFT' } }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    const { result } = renderHook(() => useComparison('aapl', 'msft'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(body))
    expect(result.current.error).toBeNull()
  })
})
