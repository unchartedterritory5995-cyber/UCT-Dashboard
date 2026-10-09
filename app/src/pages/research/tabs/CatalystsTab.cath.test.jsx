// Wave 4 (lane A): in a terminal panel, a CATS row's date opens that session's whole catalyst
// list (`CATH <date>`) beside it. On the research page the date stays plain text.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PanelListContext } from '../../../components/terminal'

vi.mock('../hooks/useCatalystHistory', () => ({ default: () => ({ data: { ticker: 'NVDA', entries: [
  { market_date: '2026-10-01', ticker: 'NVDA', tag: 'Earnings', thesis_text: 'Beat.', thesis_model: 'claude', thesis_at: 1791000000 },
  { market_date: null, ticker: 'NVDA', tag: 'News', thesis_text: 'Undated.', thesis_model: 'claude', thesis_at: 1790000000 },
] }, isLoading: false }) }))
vi.mock('../../../components/provenance/AbsenceReceipt', () => ({ default: () => null }))

import CatalystsTab from './CatalystsTab'

afterEach(() => cleanup())

describe('CATS → CATH on the row\'s date', () => {
  it('in a terminal panel the date is a button that opens CATH for that day', () => {
    const api = { open: vi.fn() }
    render(<PanelListContext.Provider value={api}><CatalystsTab sym="NVDA" /></PanelListContext.Provider>)
    const btn = screen.getByRole('button', { name: /Open the catalyst list for .*\(CATH 2026-10-01\)/ })
    fireEvent.click(btn)
    expect(api.open).toHaveBeenCalledWith('CATH 2026-10-01')
    expect(screen.getByText('Date unknown').tagName).toBe('SPAN')     // no date, no link
  })

  it('outside the terminal the date is plain text', () => {
    render(<CatalystsTab sym="NVDA" />)
    expect(screen.queryByRole('button', { name: /CATH/ })).toBeNull()
  })
})
