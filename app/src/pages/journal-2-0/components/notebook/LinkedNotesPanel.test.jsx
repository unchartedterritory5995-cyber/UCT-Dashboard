import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => {
  const mod = await orig()
  return { ...mod, useNavigate: () => navigateMock }
})

import LinkedNotesPanel from './LinkedNotesPanel'

describe('LinkedNotesPanel (Wave 3, Thesis-Trade Link reverse lookup)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    navigateMock.mockClear()
  })

  it('renders nothing without a tradeRef (no trade id yet)', () => {
    const { container } = render(<MemoryRouter><LinkedNotesPanel tradeRef={null} tradeRefType="equity_trade" /></MemoryRouter>)
    expect(container.textContent).toBe('')
  })

  it('renders nothing when the trade has zero linked notes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ notes: [] }) })))
    const { container } = render(<MemoryRouter><LinkedNotesPanel tradeRef="t1" tradeRefType="equity_trade" /></MemoryRouter>)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('queries by tradeRef + tradeRefType together (never tradeRef alone)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ notes: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    render(<MemoryRouter><LinkedNotesPanel tradeRef="t1" tradeRefType="equity_trade" /></MemoryRouter>)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('tradeRef=t1')
    expect(url).toContain('tradeRefType=equity_trade')
  })

  it('a single linked note renders as one clickable row that opens the Notebook to it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ notes: [{ id: 'n1', title: 'Thesis for NVDA' }] }),
    })))
    const user = userEvent.setup()
    render(<MemoryRouter><LinkedNotesPanel tradeRef="t1" tradeRefType="equity_trade" /></MemoryRouter>)
    const row = await screen.findByText('Thesis for NVDA')
    await user.click(row)
    expect(navigateMock).toHaveBeenCalledWith('/journal?j2tab=notebook&note=n1')
  })

  it('multiple linked notes render as a list, each independently clickable -- never forced to one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        notes: [
          { id: 'n1', title: 'First thesis' },
          { id: 'n2', title: 'Follow-up research' },
        ],
      }),
    })))
    const user = userEvent.setup()
    render(<MemoryRouter><LinkedNotesPanel tradeRef="t1" tradeRefType="equity_trade" /></MemoryRouter>)
    await screen.findByText('First thesis')
    expect(screen.getByText('Follow-up research')).toBeInTheDocument()
    expect(screen.getByText(/Linked research \(2\)/)).toBeInTheDocument()

    await user.click(screen.getByText('Follow-up research'))
    expect(navigateMock).toHaveBeenCalledWith('/journal?j2tab=notebook&note=n2')
  })
})
