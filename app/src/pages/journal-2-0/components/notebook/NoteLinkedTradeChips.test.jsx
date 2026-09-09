import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const mod = await orig()
  return { ...mod, useNavigate: () => navigateMock }
})

import { NoteLinkedTradeChips } from './NoteEditorPage'

function mockLinks(links) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ links }) })))
}

describe('NoteLinkedTradeChips (Wave 3, Thesis-Trade Link)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    navigateMock.mockClear()
  })

  it('renders nothing when the note has no trade links', async () => {
    mockLinks([])
    const { container } = render(<MemoryRouter><NoteLinkedTradeChips noteId="n1" /></MemoryRouter>)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('an equity_trade link navigates to the trade detail route', async () => {
    mockLinks([{ tradeRef: 't1', tradeRefType: 'equity_trade', resolution: { kind: 'equity_trade', id: 't1', symbol: 'NVDA' } }])
    const user = userEvent.setup()
    render(<MemoryRouter><NoteLinkedTradeChips noteId="n1" /></MemoryRouter>)
    const chip = await screen.findByText(/NVDA/)
    await user.click(chip)
    expect(navigateMock).toHaveBeenCalledWith('/journal-2-0/trade/t1')
  })

  it('an option_strategy link navigates to the Trade Journal tab with openTrade', async () => {
    mockLinks([{ tradeRef: 's1', tradeRefType: 'option_strategy', resolution: { kind: 'option_strategy', id: 's1', symbol: 'NVDA' } }])
    const user = userEvent.setup()
    render(<MemoryRouter><NoteLinkedTradeChips noteId="n1" /></MemoryRouter>)
    const chip = await screen.findByText(/NVDA/)
    await user.click(chip)
    expect(navigateMock).toHaveBeenCalledWith('/journal?j2tab=journal&openTrade=s1')
  })

  it('a still-open position link navigates to Open Positions (no standalone position detail page exists)', async () => {
    mockLinks([{ tradeRef: 'p1', tradeRefType: 'position', resolution: { kind: 'position', id: 'p1', symbol: 'NVDA' } }])
    const user = userEvent.setup()
    render(<MemoryRouter><NoteLinkedTradeChips noteId="n1" /></MemoryRouter>)
    const chip = await screen.findByText(/NVDA/)
    await user.click(chip)
    expect(navigateMock).toHaveBeenCalledWith('/journal?j2tab=positions')
  })

  it('an ambiguous legacy reference renders as an inert chip -- never navigates', async () => {
    mockLinks([{ tradeRef: '123', tradeRefType: null, resolution: { kind: 'ambiguous_legacy' } }])
    const user = userEvent.setup()
    render(<MemoryRouter><NoteLinkedTradeChips noteId="n1" /></MemoryRouter>)
    const chip = await screen.findByText(/ambiguous/i)
    await user.click(chip)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('an unresolved reference renders as an inert chip -- never navigates', async () => {
    mockLinks([{ tradeRef: 'ghost', tradeRefType: 'equity_trade', resolution: { kind: 'unresolved' } }])
    const user = userEvent.setup()
    render(<MemoryRouter><NoteLinkedTradeChips noteId="n1" /></MemoryRouter>)
    const chip = await screen.findByText(/not found/i)
    await user.click(chip)
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
