/**
 * LogTradeButton — P0-18 regression coverage.
 *
 * The header "+ Log Trade" button is the single most discoverable entry
 * point to AddPositionModal in the whole product. Its handleCreatePosition
 * used to discard the position-creation response instead of returning it,
 * so AddPositionModal's own thesis-link step (which needs created.id) was
 * silently skipped every time — with no error shown, because the code path
 * that would have surfaced one never ran.
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

// Exposes the real onSave LogTradeButton hands to AddPositionModal, so a
// test can invoke it directly and inspect what it resolves to.
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

import LogTradeButton from './LogTradeButton'

function renderButton() {
  return render(<MemoryRouter><LogTradeButton /></MemoryRouter>)
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
  fireEvent.click(screen.getByRole('button', { name: /log trade/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /log open position/i }))
}

describe('LogTradeButton — handleCreatePosition (P0-18 fix)', () => {
  it('returns the created position -- AddPositionModal needs created.id to attach a thesis link', async () => {
    renderButton()
    openPositionModal()
    await waitFor(() => expect(capturedOnSaveRef.current).not.toBeNull())

    const created = await capturedOnSaveRef.current({ symbol: 'NVDA', side: 'Long' })

    expect(created).toEqual({ id: 'p1', symbol: 'NVDA', side: 'Long' })
  })

  it('still posts, revalidates, toasts, and navigates -- the fix only adds the missing return', async () => {
    renderButton()
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
