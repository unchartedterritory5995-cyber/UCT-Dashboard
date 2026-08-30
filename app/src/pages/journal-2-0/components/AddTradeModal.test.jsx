import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddTradeModal from './AddTradeModal'

const SETTINGS = {
  setups: ['VCP', 'Breakout'],
}

describe('AddTradeModal', () => {
  afterEach(() => {
    // Some tests stub global.fetch (verdict + discipline SWR + telemetry) —
    // don't leak it into the fetch-free tests.
    delete global.fetch
  })

  it('mounts with title', () => {
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Add Trade' })).toBeInTheDocument()
  })

  it('requires a symbol', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/Symbol is required/)
  })

  it('submits with empty contextAtEntry', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.symbol).toBe('NVDA')
    expect(payload.contextAtEntry).toEqual({})
    // Optional time-of-day fields default to null when the inputs are blank.
    expect(payload.entryTimeEt).toBeNull()
    expect(payload.exitTimeEt).toBeNull()
  })

  it('includes entryTimeEt / exitTimeEt in the payload when the time inputs are filled', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')
    fireEvent.change(screen.getByLabelText('Entry time (ET)'), { target: { value: '09:45' } })
    fireEvent.change(screen.getByLabelText('Exit time (ET)'), { target: { value: '10:30' } })

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.entryTimeEt).toBe('09:45')
    expect(payload.exitTimeEt).toBe('10:30')
  })

  it('rejects exit date before entry date', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn()
    render(<AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'X')
    await user.type(screen.getByLabelText(/Shares \*/), '10')
    await user.type(screen.getByLabelText(/Entry Price \*/), '100')
    await user.type(screen.getByLabelText(/Exit Price \*/), '110')
    const entryDateInput = screen.getByLabelText(/Entry Date \*/)
    const exitDateInput = screen.getByLabelText(/Exit Date \*/)
    fireEvent.change(entryDateInput, { target: { value: '2026-04-10' } })
    fireEvent.change(exitDateInput, { target: { value: '2026-04-09' } })

    await user.click(screen.getByRole('button', { name: 'Add Trade' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be before entry/)
  })

  it('shows live preview of P&L and R-multiple', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'YSS')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')
    await user.type(screen.getByLabelText(/Original Stop/), '27.90')

    expect(screen.getByText(/\+\$493.00/)).toBeInTheDocument()
    expect(screen.getByText(/\+3.0R/)).toBeInTheDocument()
  })

  // ── Pre-trade verdict embed (Task 6) ────────────────────────────────────────

  it('shows the Check with Compass button for paid users', () => {
    // useIsPaid() returns true with no AuthProvider mounted.
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Check with Compass/i })).toBeInTheDocument()
  })

  it('disables Check with Compass until a stop is entered', async () => {
    const user = userEvent.setup({ delay: null })
    render(<AddTradeModal settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')

    const compassBtn = screen.getByRole('button', { name: /Check with Compass/i })
    expect(compassBtn).toBeDisabled()
    expect(compassBtn).toHaveAttribute('title', 'add a stop to check with Compass')

    // Once a stop is present, the button enables + the hint clears.
    await user.type(screen.getByLabelText(/Original Stop/), '27.90')
    expect(compassBtn).toBeEnabled()
    expect(compassBtn).not.toHaveAttribute('title')
  })

  it('attaches the Compass verdict to the submitted payload after a run', async () => {
    const user = userEvent.setup({ delay: null })
    const onSave = vi.fn().mockResolvedValue({})
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/coach/pre-trade-verdict')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            verdict_id: 'v-123', label: 'GO', paragraph: 'Clean setup.', factors: [],
          }),
        })
      }
      // discipline-state SWR + telemetry + anything else
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(
      <AddTradeModal settings={SETTINGS} onSave={onSave} onClose={vi.fn()} accountId="acc1" />,
    )

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    await user.type(screen.getByLabelText(/Shares \*/), '100')
    await user.type(screen.getByLabelText(/Entry Price \*/), '29.57')
    await user.type(screen.getByLabelText(/Original Stop/), '27.90')

    await user.click(screen.getByRole('button', { name: /Check with Compass/i }))

    // Verdict card renders the label once the mocked verdict resolves.
    await screen.findByText('GO')

    // Telemetry fired for the run.
    expect(global.fetch.mock.calls.some((c) => c[0] === '/api/j2/telemetry')).toBe(true)

    await user.type(screen.getByLabelText(/Exit Price \*/), '34.50')
    await user.click(screen.getByRole('button', { name: 'Add Trade' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.contextAtEntry).toEqual({
      compass_verdict_id: 'v-123',
      compass_verdict_label: 'GO',
    })
  })
})
