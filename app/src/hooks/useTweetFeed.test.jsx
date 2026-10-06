// Quality pass 2026-10-05: the shared tweet-feed hook mapped a failed read to `[]`, which every
// surface rendered as "no tweets". It now throws, so `error` is set and `data` stays undefined
// (and SWR keeps a previously good list on a later error).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('./useMarketOpen', () => ({ default: () => ({ isOpen: true, isPremarket: false, isExtended: false }) }))
import useTweetFeed from './useTweetFeed'

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)

describe('useTweetFeed', () => {
  beforeEach(() => { globalThis.fetch = vi.fn() })

  it('a failed read is an error, never an empty list', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 502, json: async () => [] })
    const { result } = renderHook(() => useTweetFeed(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.data).toBeUndefined()
  })

  it('a good read is the list', async () => {
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => [{ id: '1' }] })
    const { result } = renderHook(() => useTweetFeed(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([{ id: '1' }]))
  })
})
