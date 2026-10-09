// Wave 4 (lane A): `CATH 2026-10-01` hands the page a `date` prop; it opens on that day.
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../components/TickerPopup', () => ({ default: ({ sym }) => <span>{sym}</span> }))
import CatalystsHistory from './CatalystsHistory'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const wrap = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <MemoryRouter><CatalystsHistory {...props} /></MemoryRouter>
  </SWRConfig>,
)

describe('CATH opening date', () => {
  it('opens on the day it was handed', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) })
    wrap({ date: '2026-10-01' })
    await screen.findByText(/No catalysts recorded/)
    expect(spy.mock.calls[0][0]).toBe('/api/catalysts/by-date/2026-10-01')
  })

  it('a malformed date is ignored (the latest session opens instead)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) })
    wrap({ date: 'soon' })
    await screen.findByText(/No catalysts recorded/)
    expect(spy.mock.calls[0][0]).not.toContain('soon')
  })
})
