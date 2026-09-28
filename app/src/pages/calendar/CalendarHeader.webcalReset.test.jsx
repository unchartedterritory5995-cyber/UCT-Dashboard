// TERM-084 -- the member-facing re-subscribe path for the ICS export link.
//
// Rotating a subscribe link invalidates every calendar app using the old one, so
// the way back (a new link, copied, with an instruction) has to exist in the SAME
// change as the rotation. These rails assert RENDERED TEXT, never state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../hooks/useBreakpoint', () => ({ useIsPhone: () => false }))
vi.mock('../../components/mobile', () => ({ FiltersSheet: () => null }))

import CalendarHeader from './CalendarHeader'

const baseFilters = {
  audience: 'mine', minMcap: 0, sort: 'mine',
  minAvgVol: null, priceMin: null, priceMax: null,
}

function renderHeader() {
  const props = {
    view: 'table', setView: vi.fn(),
    weekLabel: 'Week of Jun 9–13',
    filters: baseFilters, setFilters: vi.fn(),
    mySources: ['watchlist'], setMySources: vi.fn(),
    monthCursor: { year: 2026, month: 6 }, setMonthCursor: vi.fn(),
    eventTypes: new Set(['earnings']), setEventTypes: vi.fn(),
  }
  render(<MemoryRouter><CalendarHeader {...props} /></MemoryRouter>)
  fireEvent.click(screen.getByLabelText('Open filters'))
}

const jsonRes = body => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

let writeText
beforeEach(() => {
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => { vi.restoreAllMocks() })

describe('CalendarHeader -- webcal link reset (TERM-084)', () => {
  it('flag OFF (legacy response): no expiry line and no Reset control', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      jsonRes({ token: 'abc', subscribe_url: 'webcal://x/api/calendar/export.ics?scope=mine&token=abc' }))
    renderHeader()
    fireEvent.click(screen.getByText(/Copy webcal URL/))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.queryByText(/Reset webcal link/)).toBeNull()
    expect(screen.queryByTestId('webcal-expiry')).toBeNull()
  })

  it('flag ON: shows the expiry, arms on the first tap, rotates + copies on the second', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).endsWith('/rotate')) {
        return jsonRes({ token: 'v2.new', subscribe_url: 'webcal://x/new', expires_at: '2026-12-27T00:00:00+00:00', rotatable: true, rotated: true })
      }
      return jsonRes({ token: 'v2.old', subscribe_url: 'webcal://x/old', expires_at: '2026-12-20T00:00:00+00:00', rotatable: true })
    })
    renderHeader()
    fireEvent.click(screen.getByText(/Copy webcal URL/))
    await waitFor(() => expect(screen.getByTestId('webcal-expiry').textContent).toMatch(/Link valid until/))

    fireEvent.click(screen.getByText('Reset webcal link'))
    // The first tap only arms it: nothing rotated yet.
    expect(fetchSpy.mock.calls.some(([u]) => String(u).endsWith('/rotate'))).toBe(false)
    expect(screen.getByText(/Confirm reset \(old link stops working\)/)).toBeTruthy()

    fireEvent.click(screen.getByText(/Confirm reset/))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent)
        .toBe('New link copied. Replace the old subscription in your calendar app.'))
    const rotateCall = fetchSpy.mock.calls.find(([u]) => String(u).endsWith('/rotate'))
    expect(rotateCall[1].method).toBe('POST')
    expect(writeText).toHaveBeenLastCalledWith('webcal://x/new')
  })

  it('a failed rotation says so instead of pretending', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).endsWith('/rotate')) return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      return jsonRes({ token: 'v2.old', subscribe_url: 'webcal://x/old', expires_at: '2026-12-20T00:00:00+00:00', rotatable: true })
    })
    renderHeader()
    fireEvent.click(screen.getByText(/Copy webcal URL/))
    await waitFor(() => screen.getByText('Reset webcal link'))
    fireEvent.click(screen.getByText('Reset webcal link'))
    fireEvent.click(screen.getByText(/Confirm reset/))
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Could not reset the link. Try again.'))
  })
})
