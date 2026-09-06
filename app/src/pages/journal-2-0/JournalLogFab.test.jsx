/**
 * JournalLogFab — P0-18 regression coverage.
 *
 * The phone-only quick-log FAB is a separate component from LogTradeButton
 * (not a shared handler) with a byte-identical handleCreatePosition bug:
 * the position-creation response was discarded instead of returned, so
 * AddPositionModal's thesis-link step silently never ran.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigateSpy }))

const mutateSpy = vi.fn()
vi.mock('swr', async (orig) => ({ ...(await orig()), useSWRConfig: () => ({ mutate: mutateSpy }) }))

vi.mock('./hooks/useJ2Settings', () => ({
  default: () => ({ settings: { setups: [] } }),
}))
vi.mock('./hooks/useJ2SelectedAccount', () => ({
  default: () => ({
    accountId: 'a1',
    account: { id: 'a1', name: 'Default' },
    accounts: [{ id: 'a1', name: 'Default' }],
  }),
}))

const capturedOnSaveRef = { current: null }
vi.mock('./components/AddPositionModal', () => ({
  default: ({ onSave }) => {
    capturedOnSaveRef.current = onSave
    return (
      <button type="button" data-testid="stub-save-position" onClick={() => onSave({ symbol: 'NVDA', side: 'Long' })}>
        save position
      </button>
    )
  },
}))
vi.mock('./components/AddTradeModal', () => ({
  default: () => <div data-testid="stub-trade-modal" />,
}))

import JournalLogFab from './JournalLogFab'

function renderFab() {
  return render(<MemoryRouter><JournalLogFab /></MemoryRouter>)
}

beforeEach(() => {
  navigateSpy.mockClear()
  mutateSpy.mockClear()
  capturedOnSaveRef.current = null
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'p1', symbol: 'NVDA', side: 'Long' }) }),
  )
})

function openPositionModal() {
  fireEvent.click(screen.getByRole('button', { name: /log a trade/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /log open position/i }))
}

describe('JournalLogFab — handleCreatePosition (P0-18 fix)', () => {
  it('returns the created position -- AddPositionModal needs created.id to attach a thesis link', async () => {
    renderFab()
    openPositionModal()
    await waitFor(() => expect(capturedOnSaveRef.current).not.toBeNull())

    const created = await capturedOnSaveRef.current({ symbol: 'NVDA', side: 'Long' })

    expect(created).toEqual({ id: 'p1', symbol: 'NVDA', side: 'Long' })
  })

  it('still posts, revalidates, toasts, and navigates -- the fix only adds the missing return', async () => {
    renderFab()
    openPositionModal()
    fireEvent.click(screen.getByTestId('stub-save-position'))

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/j2/positions',
      expect.objectContaining({ method: 'POST' }),
    ))
    await waitFor(() => expect(mutateSpy).toHaveBeenCalled())
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/journal/trades?seg=open'))
    expect(await screen.findByText(/Logged NVDA long position/i)).toBeInTheDocument()
  })
})
