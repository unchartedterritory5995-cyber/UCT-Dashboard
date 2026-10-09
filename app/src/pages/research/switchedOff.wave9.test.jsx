// Wave 9 lane 9: a research panel whose dark-flagged route answers 404 says "isn't switched on",
// never "unavailable right now" with a Retry that can never succeed. A 500 is still an outage with
// Retry. Rendered text, real panels, a fake network.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './depth/DepthTab'
import SeasonalityTab from './tabs/SeasonalityTab'
import HistoryTab from './tabs/HistoryTab'
import useSectorRead from '../../hooks/useSectorRead'

const answer = (status) => vi.fn(() => Promise.resolve({
  ok: status < 300, status, headers: { get: () => null }, json: () => Promise.resolve({ detail: 'Not Found' }),
}))
const wrap = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{ui}</SWRConfig>)
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('switched-off research routes', () => {
  it('FTD (depth): 404 reads "isn\'t switched on", no Retry; 500 stays an outage with Retry', async () => {
    global.fetch = answer(404)
    wrap(<DepthTab sym="gme" flags={{ ftd_dataset_enabled: true }} />)
    const off = await screen.findByTestId('ftd-off')
    expect(off.textContent).toContain("Fails-to-deliver data isn't switched on for this server yet.")
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    global.fetch = answer(500)
    wrap(<DepthTab sym="gme" flags={{ ftd_dataset_enabled: true }} />)
    expect(await screen.findByTestId('ftd-unavailable', {}, { timeout: 5000 })).toBeTruthy()
    expect(screen.queryByTestId('ftd-off')).toBeNull()
  })

  it('Seasonality: a 404 is switched off, not "unavailable"', async () => {
    global.fetch = answer(404)
    wrap(<SeasonalityTab sym="NVDA" />)
    expect((await screen.findByTestId('seasonality-off')).textContent).toContain("Seasonality isn't switched on")
    expect(screen.queryByTestId('seasonality-unavailable')).toBeNull()
  })

  it('History: a 404 is switched off, not "unavailable"', async () => {
    global.fetch = answer(404)
    wrap(<HistoryTab sym="NVDA" />)
    expect((await screen.findByTestId('history-off')).textContent).toContain("Ticker history isn't switched on")
  })

  it('no em-dash in the switched-off sentence', async () => {
    global.fetch = answer(404)
    wrap(<SeasonalityTab sym="NVDA" />)
    expect((await screen.findByTestId('seasonality-off')).textContent).not.toMatch(/[—–]/)
  })
})

describe('calendar sector read', () => {
  it('an unavailable answer ends the wait instead of "Reading…" forever', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'unavailable' }) }))
    const { result } = renderHook(() => useSectorRead('Technology', '2026-10-05'), {
      wrapper: ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>,
    })
    await waitFor(() => expect(result.current.unavailable).toBe(true))
    expect(result.current.line).toBeNull()
  })

  it('a failed read is unavailable too, and a ready line is not', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 402, json: () => Promise.resolve({}) }))
    const { result } = renderHook(() => useSectorRead('Energy', null), {
      wrapper: ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>,
    })
    await waitFor(() => expect(result.current.unavailable).toBe(true))
    cleanup()
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'ready', line: 'Energy beats.' }) }))
    const r2 = renderHook(() => useSectorRead('Energy', '2026-10-05'), {
      wrapper: ({ children }) => <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>,
    })
    await waitFor(() => expect(r2.result.current.line).toBe('Energy beats.'))
    expect(r2.result.current.unavailable).toBe(false)
  })
})
