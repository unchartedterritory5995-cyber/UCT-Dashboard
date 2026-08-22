import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useCotNarrative } from './useCotNarrative'

const facts = { bias: 'Contrarian Bearish', groups: { commercials: { index: 4 } } }

describe('useCotNarrative', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', text: 'Hedgers are leaning hard.', cached: false }),
    }))
    global.fetch = fetchMock
  })
  afterEach(() => vi.restoreAllMocks())

  it('POSTs the facts for the report week and exposes the text', async () => {
    const { result } = renderHook(() =>
      useCotNarrative({ symbol: 'ES', name: 'S&P 500 E-Mini', reportDate: '2026-08-18', facts, enabled: true }),
    )
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(result.current.text).toBe('Hedgers are leaning hard.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/cot/ES/narrative')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ report_date: '2026-08-18', name: 'S&P 500 E-Mini', facts })
  })

  it('does nothing while disabled', async () => {
    const { result } = renderHook(() =>
      useCotNarrative({ symbol: 'ES', name: '', reportDate: '2026-08-18', facts, enabled: false }),
    )
    expect(result.current.status).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not re-request for the same symbol, date and facts', async () => {
    const { result, rerender } = renderHook(
      props => useCotNarrative(props),
      { initialProps: { symbol: 'ES', name: '', reportDate: '2026-08-18', facts, enabled: true } },
    )
    await waitFor(() => expect(result.current.status).toBe('ok'))
    rerender({ symbol: 'ES', name: '', reportDate: '2026-08-18', facts: { ...facts }, enabled: true })
    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-requests when the report week changes', async () => {
    const { result, rerender } = renderHook(
      props => useCotNarrative(props),
      { initialProps: { symbol: 'ES', name: '', reportDate: '2026-08-11', facts, enabled: true } },
    )
    await waitFor(() => expect(result.current.status).toBe('ok'))
    rerender({ symbol: 'ES', name: '', reportDate: '2026-08-18', facts, enabled: true })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('reports a non-ok service status as unavailable (templated read takes over)', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ status: 'error', text: null, reason: 'ungrounded' }),
    }))
    const { result } = renderHook(() =>
      useCotNarrative({ symbol: 'ES', name: '', reportDate: '2026-08-18', facts, enabled: true }),
    )
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
    expect(result.current.text).toBeNull()
  })

  it('treats a failed request as unavailable, never throws', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 402, json: () => Promise.resolve({}) }))
    const { result } = renderHook(() =>
      useCotNarrative({ symbol: 'ES', name: '', reportDate: '2026-08-18', facts, enabled: true }),
    )
    await waitFor(() => expect(result.current.status).toBe('unavailable'))
  })
})
