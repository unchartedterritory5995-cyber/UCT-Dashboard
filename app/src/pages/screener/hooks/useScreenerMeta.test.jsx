// Quality pass 2026-10-05: the filter-registry read used to `r.json()` whatever came back, so a
// 500's `{detail}` body became `meta` and the rail rendered empty with nothing said.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import useScreenerMeta from './useScreenerMeta'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    {children}
  </SWRConfig>
)

describe('useScreenerMeta', () => {
  beforeEach(() => { globalThis.fetch = vi.fn() })

  it('a failed read is an error, never a meta built from the error body', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) })
    const { result } = renderHook(() => useScreenerMeta(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.meta).toBeUndefined()
    expect(typeof result.current.retry).toBe('function')
  })

  it('a good read is the meta', async () => {
    const meta = { filters: [], views: [], categories: [] }
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => meta })
    const { result } = renderHook(() => useScreenerMeta(), { wrapper })
    await waitFor(() => expect(result.current.meta).toEqual(meta))
    expect(result.current.error).toBeUndefined()
  })
})
