// G-040 ruling 2 — a Notebook COT capture's "Current COT for <symbol>" link lands
// as `/breadth?tab=cot&cot=<symbol>`; the COT tab must open ON that market.
import { render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react-chartjs-2', () => ({ Chart: () => <div data-testid="chart" /> }))
vi.mock('../hooks/useBreakpoint', () => ({ useIsTouch: () => false, useIsPhone: () => false }))

import CotData from './CotData'

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn((url) => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

const cotFetches = () => fetchMock.mock.calls.map(([u]) => String(u))
  .filter((u) => /^\/api\/cot\/[A-Z0-9]+\?weeks=/.test(u))

describe('CotData — the ?cot= link from a Notebook capture', () => {
  it('opens on the linked market', async () => {
    window.history.replaceState(null, '', '/breadth?tab=cot&cot=cl')
    render(<CotData />)
    await waitFor(() => expect(cotFetches().length).toBeGreaterThan(0))
    expect(cotFetches()[0]).toMatch(/^\/api\/cot\/CL\?weeks=/)
  })

  it('⛔ CONTROL — no link (or a malformed one) still opens on ES', async () => {
    window.history.replaceState(null, '', '/breadth?tab=cot&cot=E%26S')
    render(<CotData />)
    await waitFor(() => expect(cotFetches().length).toBeGreaterThan(0))
    expect(cotFetches()[0]).toMatch(/^\/api\/cot\/ES\?weeks=/)
  })
})
