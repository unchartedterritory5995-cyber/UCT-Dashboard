import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SWRConfig } from 'swr'
import useJ2Calendar from './useJ2Calendar'

// SWR dedupes globally; wrap to isolate the cache per test.
const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('useJ2Calendar basis', () => {
  it('includes basis in the request URL when provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ days: [], totals: null, basis: 'account' }),
    })
    renderHook(
      () => useJ2Calendar({ view: 'month', year: 2026, month: 6, basis: 'account' }),
      { wrapper },
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(fetchSpy.mock.calls[0][0]).toContain('basis=account')
    fetchSpy.mockRestore()
  })

  it('omits basis from the request URL when not provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ days: [], totals: null, basis: 'closed' }),
    })
    renderHook(
      () => useJ2Calendar({ view: 'month', year: 2026, month: 6 }),
      { wrapper },
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(fetchSpy.mock.calls[0][0]).not.toContain('basis=')
    fetchSpy.mockRestore()
  })
})
