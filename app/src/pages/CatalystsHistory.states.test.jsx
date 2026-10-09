// CATH: a failed read is not "No catalysts recorded for this date"; one row is "1 row".
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../components/TickerPopup', () => ({ default: ({ sym }) => <span>{sym}</span> }))
import CatalystsHistory from './CatalystsHistory'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
const wrap = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <MemoryRouter><CatalystsHistory /></MemoryRouter>
  </SWRConfig>,
)

describe('CATH states', () => {
  it('a 500 reads as could-not-read with Retry, not an empty day', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    wrap()
    expect((await screen.findByTestId('cath-error')).textContent).toMatch(/could not be read right now.*not a finding that the day was quiet/)
    expect(screen.queryByText(/No catalysts recorded/)).toBeNull()
  })

  it('one row is "1 row"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [{ ticker: 'XP', rank: 1, tag: 'Catalyst', thesis_text: 'Beat.', thesis_status: 'ok', gap_pct: 3, price: 28 }] }) })
    wrap()
    expect(await screen.findByText('1 row')).toBeInTheDocument()
  })
})

// Audit 2026-10-08 (lane A): opened on a weekend, CATH showed an empty day.
describe('CATH default date', () => {
  afterEach(() => { vi.useRealTimers() })
  it('on a Saturday opens on Friday\'s session, not an empty day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T16:00:00Z'))   // Saturday, noon ET
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) })
    wrap()
    await screen.findByText(/No catalysts recorded/)
    expect(spy.mock.calls[0][0]).toBe('/api/catalysts/by-date/2026-10-09')
  })
  it('on a trading day opens on today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T16:00:00Z'))   // Thursday, noon ET
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [] }) })
    wrap()
    await screen.findByText(/No catalysts recorded/)
    expect(spy.mock.calls[0][0]).toBe('/api/catalysts/by-date/2026-10-08')
  })
  it('a row with no move on file is not painted as a gain', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ rows: [{ ticker: 'XP', tag: 'Catalyst', thesis_text: 'Beat.', thesis_status: 'ok', gap_pct: null, price: 28 }] }) })
    const { container } = wrap()
    await screen.findByText('Beat.')
    const cell = container.querySelectorAll('tbody td')[2]   // Sym, Price, % Change
    expect(cell.textContent).toBe('—')
    expect(cell.className).not.toMatch(/gain/)
  })
})
