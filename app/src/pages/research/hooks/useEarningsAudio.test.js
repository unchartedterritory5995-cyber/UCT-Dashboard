import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// TERM-088 -- the earnings call audio hook (TRAN). A failed read keeps its
// HTTP outcome; it is never collapsed to `null`, which the tab would
// otherwise read as "no audio for this ticker" during a mere outage.

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); vi.doUnmock('../../../hooks/useMobileSWR') })

describe('fetchEarningsAudio', () => {
  it('keeps a refused request as ok:false with its status', async () => {
    const { fetchEarningsAudio } = await import('./useEarningsAudio')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    expect(await fetchEarningsAudio('/x')).toEqual({ ok: false, httpStatus: 500, body: null })
  })

  it('keeps a network failure as ok:false, status 0 -- not an empty audio record', async () => {
    const { fetchEarningsAudio } = await import('./useEarningsAudio')
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    expect(await fetchEarningsAudio('/x')).toEqual({ ok: false, httpStatus: 0, body: null })
  })

  it('passes a readable answer through untouched', async () => {
    const { fetchEarningsAudio } = await import('./useEarningsAudio')
    const body = { audio_url: 'https://x/y.mp3' }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => body })
    expect(await fetchEarningsAudio('/x')).toEqual({ ok: true, httpStatus: 200, body })
  })
})

describe('useEarningsAudio', () => {
  it('renders a 200-with-data body as data, with no error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { audio_url: 'https://x/y.mp3' } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useEarningsAudio } = await import('./useEarningsAudio')
    const { result } = renderHook(() => useEarningsAudio('aapl'))
    expect(result.current.data).toEqual({ audio_url: 'https://x/y.mp3' })
    expect(result.current.error).toBe(false)
  })

  it('renders a 200-with-empty body as empty data, not an error', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: {} }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useEarningsAudio } = await import('./useEarningsAudio')
    const { result } = renderHook(() => useEarningsAudio('aapl'))
    expect(result.current.data).toEqual({})
    expect(result.current.error).toBe(false)
  })

  it('renders a failed fetch (500/404/network) as error:true, never silently empty', async () => {
    const swr = { data: { ok: false, httpStatus: 500, body: null }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useEarningsAudio } = await import('./useEarningsAudio')
    const { result } = renderHook(() => useEarningsAudio('aapl'))
    expect(result.current.data).toBeNull()
    expect(result.current.error).toBe(true)
  })

  it('returns the SAME object across re-renders with the same data (H14 shape)', async () => {
    const swr = { data: { ok: true, httpStatus: 200, body: { audio_url: 'https://x/y.mp3' } }, isLoading: false, mutate: () => {} }
    vi.doMock('../../../hooks/useMobileSWR', () => ({ default: () => swr }))
    const { default: useEarningsAudio } = await import('./useEarningsAudio')
    const { result, rerender } = renderHook(({ sym }) => useEarningsAudio(sym), { initialProps: { sym: 'aapl' } })
    const first = result.current
    rerender({ sym: 'aapl' })
    expect(result.current).toBe(first)
    swr.data = { ok: true, httpStatus: 200, body: { audio_url: 'https://x/z.mp3' } }
    rerender({ sym: 'aapl' })
    expect(result.current).not.toBe(first)
  })
})
