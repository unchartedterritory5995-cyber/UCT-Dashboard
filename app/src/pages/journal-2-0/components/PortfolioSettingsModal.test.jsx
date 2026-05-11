import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PortfolioSettingsModal from './PortfolioSettingsModal'

const baseSettings = {
  id: 's1',
  userId: 'u1',
  accountSize: 100_000,
  defaultStop: { mode: 'custom' },
  positionClosing: 'FIFO',
  breakevenRange: { enabled: false, unit: '$', value: 0 },
  setups: ['Breakout'],
  createdAt: '2026-04-17T00:00:00Z',
  updatedAt: '2026-04-17T00:00:00Z',
}

describe('PortfolioSettingsModal', () => {
  it('mounts without error', () => {
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { name: /Settings/ })).toBeInTheDocument()
  })

  it('shows the pre-populated account size', () => {
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={vi.fn()} onClose={vi.fn()} />,
    )
    const input = screen.getByDisplayValue('100000')
    expect(input).toBeInTheDocument()
  })

  it('shows the user\'s existing setup chips', () => {
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={vi.fn()} onClose={vi.fn()} />,
    )
    // 'Breakout' appears in both TRADE SETUPS chips and SETUP-AWARE COACHING toggles
    expect(screen.getAllByText('Breakout').length).toBeGreaterThan(0)
  })

  it('calls onSave with canonical payload on Save Settings click', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    const onClose = vi.fn()
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={onClose} />,
    )
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.accountSize).toBe(100_000)
    expect(payload.defaultStop).toEqual({ mode: 'custom' })
    expect(payload.positionClosing).toBe('FIFO')
    expect(payload.breakevenRange).toEqual({ enabled: false, unit: '$', value: 0 })
    expect(payload.setups).toEqual(['Breakout'])
  })

  it('shareJournalData toggle ships in the save payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={vi.fn()} />,
    )
    // Default off
    const toggle = screen.getByRole('checkbox', { name: /Share my closed trades with the community/i })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    const payload = onSave.mock.calls[0][0]
    expect(payload.shareJournalData).toBe(true)
  })

  it('calls onClose without onSave on Cancel', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={onClose} />,
    )
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('switching stop mode to fixed_dollar_risk reveals the amount input', async () => {
    const user = userEvent.setup()
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={vi.fn()} onClose={vi.fn()} />,
    )
    await user.click(screen.getByLabelText(/Fixed \$ Risk/i))
    // After selecting the card, an "Amount" label appears in the sub-row
    expect(screen.getByText(/^Amount$/)).toBeInTheDocument()
  })

  it('adds a new setup chip and includes it in the saved payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={vi.fn()} />,
    )
    const input = screen.getByPlaceholderText('New setup name')
    await user.type(input, 'Pullback')
    // There are now multiple "Add" buttons (setups / mistakes / emotions) — target
    // the one in the TRADE SETUPS addRow by querying within its closest container.
    const setupsSection = input.closest('div')
    const { getByRole: getByRoleLocal } = within(setupsSection)
    await user.click(getByRoleLocal('button', { name: 'Add' }))
    // 'Pullback' appears in both TRADE SETUPS chips and SETUP-AWARE COACHING toggles
    expect(screen.getAllByText('Pullback').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Save Settings' }))
    const payload = onSave.mock.calls[0][0]
    expect(payload.setups).toEqual(['Breakout', 'Pullback'])
  })

  it('removes a setup chip when × is clicked', async () => {
    const user = userEvent.setup()
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={vi.fn()} onClose={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: 'Remove Breakout' }))
    expect(screen.queryByText('Breakout')).not.toBeInTheDocument()
  })

  it('BE value of 0 shows "disabled" helper text', () => {
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByText('disabled')).toBeInTheDocument()
  })

  it('BE value > 0 shows the range helper text', () => {
    const withRange = {
      ...baseSettings,
      breakevenRange: { enabled: true, unit: '$', value: 20 },
    }
    render(
      <PortfolioSettingsModal settings={withRange} onSave={vi.fn()} onClose={vi.fn()} />,
    )
    expect(screen.getByText(/trades within ±\$20 P&L are BE/)).toBeInTheDocument()
  })

  it('Esc closes the modal', () => {
    const onClose = vi.fn()
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={vi.fn()} onClose={onClose} />,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking the backdrop closes the modal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(
      <PortfolioSettingsModal settings={baseSettings} onSave={vi.fn()} onClose={onClose} />,
    )
    const backdrop = container.firstChild
    await user.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('Phase A guard inputs ship in the save payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={vi.fn()} />,
    )

    const sizeInput = screen.getByLabelText(/Default Position Size/i)
    const rInput = screen.getByLabelText(/Default Target \(R multiple\)/i)
    const capInput = screen.getByLabelText(/Max Risk Per Trade/i)

    await user.clear(sizeInput)
    await user.type(sizeInput, '5')
    await user.clear(rInput)
    await user.type(rInput, '2')
    await user.clear(capInput)
    await user.type(capInput, '1')

    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.defaultSizePct).toBe(5)
    expect(payload.defaultRMultipleTarget).toBe(2)
    expect(payload.maxRiskPerTradePct).toBe(1)
  })

  it('Phase B guard inputs ship in the save payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={vi.fn()} />,
    )

    const lossInput = screen.getByLabelText(/Daily Loss Limit/i)
    const coolInput = screen.getByLabelText(/Cooling-Off After Loss/i)

    await user.clear(lossInput); await user.type(lossInput, '2')
    await user.clear(coolInput); await user.type(coolInput, '15')

    // Add a no-trade window via the editor
    await user.click(screen.getByRole('button', { name: /add window/i }))
    const startInput = screen.getByLabelText(/Window 1 start/i)
    const endInput = screen.getByLabelText(/Window 1 end/i)
    await user.type(startInput, '11:30')
    await user.type(endInput, '13:30')

    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.dailyLossLimitPct).toBe(2)
    expect(payload.coolingOffMinutesAfterLoss).toBe(15)
    expect(payload.noTradeWindowsET).toEqual([
      { start: '11:30', end: '13:30', label: '' },
    ])
  })

  it('Phase C A+ inputs ship in the save payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    const settingsWithSetups = { ...baseSettings, setups: ['Bull Flag', 'Pullback'] }
    render(
      <PortfolioSettingsModal settings={settingsWithSetups} onSave={onSave} onClose={vi.fn()} />,
    )

    // Tag "Bull Flag" as A+ via the chip toggle. The chip is a button with aria-pressed.
    // Use getAllByRole to disambiguate from any other "Bull Flag" element on screen.
    const chips = screen.getAllByRole('button', { name: /Bull Flag/i, pressed: false })
    // The first un-pressed Bull Flag button is the A+ chip (other appearances are not buttons or are already pressed).
    await user.click(chips[0])

    const multInput = screen.getByLabelText(/A\+ Risk Multiplier/i)
    await user.clear(multInput)
    await user.type(multInput, '1.5')

    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.aPlusSetups).toEqual(['Bull Flag'])
    expect(payload.aPlusRiskMultiplier).toBe(1.5)
  })

  it('Phase D regime multipliers ship in the save payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={vi.fn()} />,
    )

    const greenInputEl = screen.getByLabelText(/GREEN/i)
    await user.clear(greenInputEl)
    await user.type(greenInputEl, '1.0')

    const orangeInputEl = screen.getByLabelText(/ORANGE/i)
    await user.clear(orangeInputEl)
    await user.type(orangeInputEl, '0.5')

    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.regimeSizeMultipliers).toEqual({ green: 1.0, orange: 0.5 })
  })

  it('Phase E seeded mistake taxonomy ships in the save payload', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(
      <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={vi.fn()} />,
    )

    // Click the "Seed standard 17" button in the MISTAKES TAXONOMY section
    await user.click(screen.getByRole('button', { name: /Seed standard 17 mistakes/i }))
    await user.click(screen.getByRole('button', { name: 'Save Settings' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const payload = onSave.mock.calls[0][0]
    expect(payload.mistakeTags).toEqual(expect.arrayContaining([
      'overtrading', 'FOMO', 'chasing', 'early_exit', 'late_entry',
      'no_stop', 'oversized', 'countertrend', 'revenge', 'ignored_thesis',
      'added_to_loser', 'cut_winner', 'broke_loss_rule', 'broke_size_rule',
      'broke_checklist', 'boredom', 'hesitation',
    ]))
    expect(payload.mistakeTags.length).toBe(17)
  })
})
