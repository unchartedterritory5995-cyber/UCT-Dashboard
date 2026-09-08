import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddTradeModal from './AddTradeModal'

// Seam 17 remainder: integration-level coverage of the REAL SecuritySymbolInput
// wired into AddTradeModal (unlike AddTradeModal.test.jsx, which mocks
// SecuritySymbolInput entirely to isolate the modal's own save/validation
// logic). Mirrors AddPositionModal.symbolAssist.test.jsx. Real timers --
// vi.useFakeTimers breaks Testing Library's own setTimeout-based
// asyncUtilTimeout (see that file's header comment for the full story).
const SETTINGS = { setups: ['VCP', 'Breakout'] }

async function fillRequiredNumbers(user) {
  await user.type(screen.getByLabelText(/Shares \*/), '100')
  await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
  await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')
}

async function waitDebounce(ms = 300) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
}

afterEach(() => {
  delete global.fetch
})

describe('AddTradeModal + SecuritySymbolInput -- symbol assist integration', () => {
  it('typing drives real suggestions, and selecting one stores the canonical symbol in the save payload', async () => {
    const user = userEvent.setup({ delay: null })
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'NVDA', name: 'NVIDIA Corp' }] }),
    }))
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'nvda')
    await waitDebounce()
    const row = await screen.findByText('NVIDIA Corp')
    await user.click(row)

    await fillRequiredNumbers(user)
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].symbol).toBe('NVDA')
  })

  it('a free-form, unresolved historical symbol still saves -- no blocking on zero search matches', async () => {
    const user = userEvent.setup({ delay: null })
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'oldco')
    await waitDebounce()
    await screen.findByText(/not found in current search/i)

    await fillRequiredNumbers(user)
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].symbol).toBe('OLDCO')
  })

  it('a failed ticker-search never blocks save', async () => {
    const user = userEvent.setup({ delay: null })
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }))
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'nvda')
    await waitDebounce()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    await fillRequiredNumbers(user)
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].symbol).toBe('NVDA')
  })
})
