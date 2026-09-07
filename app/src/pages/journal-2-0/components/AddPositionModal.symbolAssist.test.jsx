import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddPositionModal from './AddPositionModal'
import usePreTradeVerdict from '../hooks/usePreTradeVerdict'

// Seam 17 remainder: integration-level coverage of the REAL SecuritySymbolInput
// wired into AddPositionModal (unlike AddPositionModal.test.jsx, which mocks
// SecuritySymbolInput entirely to isolate the modal's own save/validation
// logic). This file proves the two behave correctly TOGETHER: typing drives a
// real debounced search, a selected suggestion's canonical symbol flows into
// the save payload, and -- critically -- an unresolved/free-form symbol and a
// failed search never block save.
//
// Real timers (mirrors SecuritySymbolInput.test.jsx / CommandPalette.test.jsx)
// -- vi.useFakeTimers breaks Testing Library's own setTimeout-based
// asyncUtilTimeout, hanging every findBy/waitFor until vitest's outer
// testTimeout instead of resolving.
vi.mock('../hooks/usePreTradeVerdict', () => ({ default: vi.fn() }))

const NO_VERDICT = { run: vi.fn(), verdict: null, isLoading: false, error: null, reset: vi.fn() }

const BASE_SETTINGS = {
  accountSize: 100_000,
  defaultStop: { mode: 'custom' },
  setups: ['Breakout', 'VCP'],
  breakevenRange: { enabled: false, unit: '$', value: 0 },
}

async function fillRequiredNumbers(user) {
  await user.type(screen.getByLabelText(/Shares \*/i), '100')
  const numberInputs = screen.getAllByRole('spinbutton')
  await user.type(numberInputs[1], '500') // Entry Price
}

async function waitDebounce(ms = 300) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)) })
}

beforeEach(() => {
  usePreTradeVerdict.mockReturnValue(NO_VERDICT)
})

afterEach(() => {
  delete global.fetch
})

describe('AddPositionModal + SecuritySymbolInput -- symbol assist integration', () => {
  it('typing drives real suggestions, and selecting one stores the canonical symbol in the save payload', async () => {
    const user = userEvent.setup({ delay: null })
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ ticker: 'NVDA', name: 'NVIDIA Corp' }] }),
    }))
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'nvda')
    await waitDebounce()
    const row = await screen.findByText('NVIDIA Corp')
    await user.click(row)

    await fillRequiredNumbers(user)
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].symbol).toBe('NVDA')
  })

  it('a free-form, unresolved historical symbol still saves -- no blocking on zero search matches', async () => {
    const user = userEvent.setup({ delay: null })
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'oldco')
    await waitDebounce()
    await screen.findByText(/not found in current search/i)

    await fillRequiredNumbers(user)
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].symbol).toBe('OLDCO')
  })

  it('a failed ticker-search never blocks save', async () => {
    const user = userEvent.setup({ delay: null })
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }))
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'nvda')
    await waitDebounce()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    await fillRequiredNumbers(user)
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].symbol).toBe('NVDA')
  })

  it('does not issue one search request per keystroke -- a single debounced request per settled query', async () => {
    // AddPositionModal's own mount fires unrelated fetches (accounts, regime,
    // interventions) against this same global.fetch mock, so the assertion
    // filters to ticker-search calls specifically rather than the raw total.
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }))
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)

    const input = screen.getByPlaceholderText('e.g. NVDA')
    fireEvent.change(input, { target: { value: 'n' } })
    fireEvent.change(input, { target: { value: 'nv' } })
    fireEvent.change(input, { target: { value: 'nvd' } })
    fireEvent.change(input, { target: { value: 'nvda' } })
    await waitDebounce()
    const searchCalls = () => global.fetch.mock.calls.filter((c) => String(c[0]).includes('/api/ticker-search'))
    await waitFor(() => expect(searchCalls()).toHaveLength(1))
    expect(searchCalls()[0][0]).toContain('q=nvda')
  })
})
