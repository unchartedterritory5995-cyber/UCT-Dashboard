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
