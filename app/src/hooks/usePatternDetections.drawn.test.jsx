// usePatternDetections surfaces the learned auto-drawer block (`drawn`) the admin
// include_structures response carries, and null when the response has none.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { usePatternDetections } from './usePatternDetections'
import drawn from '../components/chart/patternShapes/__fixtures__/learned_drawn.json'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

function mockFetch(body) {
  const spy = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => { vi.unstubAllGlobals() })

describe('usePatternDetections — drawn', () => {
  it('returns the drawn block and asks for it only with includeStructures', async () => {
    const spy = mockFetch({ detections: [], count: 0, structures: [], drawn })
    const { result } = renderHook(
      () => usePatternDetections('ZZZ', 'D', true, 50, { includeStructures: true }), { wrapper },
    )
    await waitFor(() => expect(result.current.drawn).not.toBeNull())
    expect(result.current.drawn.trendlines).toHaveLength(drawn.trendlines.length)
    expect(spy.mock.calls[0][0]).toContain('include_structures=true')
  })

  it('is null when the response carries no drawn block', async () => {
    mockFetch({ detections: [], count: 0 })
    const { result } = renderHook(() => usePatternDetections('ZZZ', 'D', true, 50), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.drawn).toBeNull()
  })
})
