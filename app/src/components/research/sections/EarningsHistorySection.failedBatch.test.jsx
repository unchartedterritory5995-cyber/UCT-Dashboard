// Calendar audit 2026-10-05: a failed week-enrichment batch was folded into {} and read as
// "arrived", so the earnings modal told every company opened that week "No reported quarters
// yet". A failed batch now reaches the section as a failure, rendered as such.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import EarningsHistorySection from './EarningsHistorySection'
import { useWeekEnrichment, ENRICHMENT_FAILED } from '../../../pages/calendar/useCalendarData'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('a failed enrichment batch is not "never reported"', () => {
  it('the section says unavailable, not "No reported quarters yet"', () => {
    render(<EarningsHistorySection row={{ sym: 'JAZZ' }} reportDate="2026-08-27" enrichReady enrichFailed />)
    expect(screen.getByText('Earnings history unavailable')).toBeTruthy()
    expect(screen.queryByText(/No reported quarters yet/i)).toBeNull()
  })

  it.each([
    ['a 500', () => Promise.resolve({ ok: false, status: 500, json: async () => ({}) })],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('useWeekEnrichment answers ENRICHMENT_FAILED on %s', async (_n, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl))
    const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
    const { result } = renderHook(() => useWeekEnrichment(['2026-08-24', '2026-08-25']), { wrapper })
    await waitFor(() => expect(result.current.data).toBe(ENRICHMENT_FAILED))
  })

  it('a good batch is passed through untouched', async () => {
    const body = { '2026-08-24': { NVDA: { beat_history: [] } } }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => body })))
    const wrapper = ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
    const { result } = renderHook(() => useWeekEnrichment(['2026-08-24']), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(body))
  })
})
