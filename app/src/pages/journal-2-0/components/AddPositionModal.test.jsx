import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddPositionModal from './AddPositionModal'
import usePreTradeVerdict from '../hooks/usePreTradeVerdict'

// Control the verdict directly so the attachment branches are testable without
// wiring a live account + fetch.
vi.mock('../hooks/usePreTradeVerdict', () => ({
  default: vi.fn(),
}))

const NO_VERDICT = { run: vi.fn(), verdict: null, isLoading: false, error: null, reset: vi.fn() }

const BASE_SETTINGS = {
  accountSize: 100_000,
  defaultStop: { mode: 'custom' },
  setups: ['Breakout', 'VCP'],
  breakevenRange: { enabled: false, unit: '$', value: 0 },
}

describe('AddPositionModal', () => {
  beforeEach(() => {
    usePreTradeVerdict.mockReturnValue(NO_VERDICT)
  })

  it('mounts', () => {
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    // Use the heading specifically (button also says "Add Position")
    expect(screen.getByRole('heading', { name: 'Add Position' })).toBeInTheDocument()
  })

  it('requires a symbol', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/Symbol is required/)
  })

  it('submits a normalized payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'nvda')
    await user.type(screen.getByLabelText(/Shares \*/i), '100')
    // Entry Price — use the second number input (first was Shares)
    const numberInputs = screen.getAllByRole('spinbutton')
    // 0=Shares, 1=Entry Price, 2=Stop Price
    await user.type(numberInputs[1], '500')
    // Stop Price (optional) left blank

    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.symbol).toBe('NVDA')
    expect(payload.side).toBe('Long')
    expect(payload.shares).toBe(100)
    expect(payload.entryPrice).toBe(500)
    expect(payload.stopPrice).toBeNull()
    // No verdict run → empty attachment.
    expect(payload.contextAtEntry).toEqual({})
  })

  it('attaches the Compass verdict to the submitted payload when one has run', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    usePreTradeVerdict.mockReturnValue({
      ...NO_VERDICT,
      verdict: { verdict_id: 'v-9', label: 'GO', paragraph: 'Clean.', factors: [] },
    })
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const numberInputs = screen.getAllByRole('spinbutton')
    await user.type(numberInputs[0], '100')  // shares
    await user.type(numberInputs[1], '500')  // entry

    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.contextAtEntry).toEqual({
      compass_verdict_id: 'v-9',
      compass_verdict_label: 'GO',
    })
  })

  it('rejects Long stop above entry', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0], '100')      // shares
    await user.type(inputs[1], '100')      // entry
    await user.type(inputs[2], '105')      // stop — invalid for Long

    await user.click(screen.getByRole('button', { name: 'Add Position' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/below entry/)
  })

  it('prefills stop for fixed_percent_distance on blur', async () => {
    const user = userEvent.setup()
    const settings = {
      ...BASE_SETTINGS,
      defaultStop: { mode: 'fixed_percent_distance', percent: 5 },
    }
    render(<AddPositionModal settings={settings} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0], '100')
    await user.type(inputs[1], '500')
    await user.tab()  // blur entry price → prefill fires

    // Stop field should now show 475 (500 * 0.95)
    expect(inputs[2]).toHaveValue(475)
  })

  it('prefills stop for fixed_dollar_risk on blur', async () => {
    const user = userEvent.setup()
    const settings = {
      ...BASE_SETTINGS,
      defaultStop: { mode: 'fixed_dollar_risk', amount: 500 },
    }
    render(<AddPositionModal settings={settings} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[0], '100')
    await user.type(inputs[1], '500')
    await user.tab()

    // Stop = 500 - (500 / 100) = 495
    expect(inputs[2]).toHaveValue(495)
  })

  it('does not overwrite a user-typed stop', async () => {
    const user = userEvent.setup()
    const settings = {
      ...BASE_SETTINGS,
      defaultStop: { mode: 'fixed_percent_distance', percent: 5 },
    }
    render(<AddPositionModal settings={settings} onSave={vi.fn()} onClose={vi.fn()} />)

    await user.type(screen.getByPlaceholderText('e.g. NVDA'), 'NVDA')
    const inputs = screen.getAllByRole('spinbutton')
    await user.type(inputs[2], '480')  // user types stop first
    await user.type(inputs[0], '100')
    await user.type(inputs[1], '500')
    await user.tab()

    // Stop should remain 480 (user-edited), not overwritten to 475
    expect(inputs[2]).toHaveValue(480)
  })

  it('Esc calls onClose', () => {
    const onClose = vi.fn()
    render(<AddPositionModal settings={BASE_SETTINGS} onSave={vi.fn()} onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
