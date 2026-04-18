import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditPositionModal from './EditPositionModal'

const YSS = {
  id: 'yss-1',
  userId: 'u1',
  symbol: 'YSS',
  side: 'Long',
  entryDate: '2026-04-09T00:00:00Z',
  shares: 250,
  originalShares: 250,
  entryPrice: 29.57,
  stopPrice: 27.9,
  breakevenStop: null,
  raiseToBreakeven: false,
  setup: 'VCP',
  notes: null,
  contextAtEntry: {},
  createdAt: '2026-04-09T00:00:00Z',
  updatedAt: '2026-04-09T00:00:00Z',
  closedAt: null,
}

const SETTINGS = {
  setups: ['VCP', 'Breakout', 'Pullback'],
}

describe('EditPositionModal', () => {
  it('mounts with symbol in title', () => {
    render(<EditPositionModal position={YSS} settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Edit YSS')).toBeInTheDocument()
  })

  it('pre-populates all fields', () => {
    render(<EditPositionModal position={YSS} settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByDisplayValue('250')).toBeInTheDocument()
    expect(screen.getByDisplayValue('29.57')).toBeInTheDocument()
    expect(screen.getByDisplayValue('27.9')).toBeInTheDocument()
    expect(screen.getByDisplayValue('VCP')).toBeInTheDocument()
  })

  it('raise-to-BE toggle reveals breakeven stop input', async () => {
    const user = userEvent.setup()
    render(<EditPositionModal position={YSS} settings={SETTINGS} onSave={vi.fn()} onClose={vi.fn()} />)

    // Before toggle: no "Breakeven Stop" label
    expect(screen.queryByText(/^Breakeven Stop$/)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/Raise stop to breakeven/))
    expect(screen.getByText(/^Breakeven Stop$/)).toBeInTheDocument()
    // Default BE stop defaults to entryPrice (29.57)
    const beInput = screen.getByLabelText(/Breakeven Stop/)
    expect(beInput).toHaveValue(29.57)
  })

  it('CRITICAL: saving after raise-to-BE toggle does NOT include stopPrice in the patch', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(<EditPositionModal position={YSS} settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.click(screen.getByLabelText(/Raise stop to breakeven/))
    await user.click(screen.getByRole('button', { name: /Save Changes/i }))

    expect(onSave).toHaveBeenCalledTimes(1)
    const patch = onSave.mock.calls[0][0]
    expect(patch.raiseToBreakeven).toBe(true)
    expect(patch.breakevenStop).toBe(29.57)
    // The key assertion: stopPrice is NOT in the patch
    expect('stopPrice' in patch).toBe(false)
  })

  it('toggling raise-to-BE off sets breakevenStop to null', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    const raised = { ...YSS, raiseToBreakeven: true, breakevenStop: 29.57 }
    render(<EditPositionModal position={raised} settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    await user.click(screen.getByLabelText(/Raise stop to breakeven/))
    await user.click(screen.getByRole('button', { name: /Save Changes/i }))

    const patch = onSave.mock.calls[0][0]
    expect(patch.raiseToBreakeven).toBe(false)
    expect(patch.breakevenStop).toBeNull()
  })

  it('edits to stopPrice DO appear in the patch', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue({})
    render(<EditPositionModal position={YSS} settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    const stopInput = screen.getByDisplayValue('27.9')
    await user.clear(stopInput)
    await user.type(stopInput, '28.5')
    await user.click(screen.getByRole('button', { name: /Save Changes/i }))

    const patch = onSave.mock.calls[0][0]
    expect(patch.stopPrice).toBe(28.5)
  })

  it('rejects save when stop >= entry for Long', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<EditPositionModal position={YSS} settings={SETTINGS} onSave={onSave} onClose={vi.fn()} />)

    const stopInput = screen.getByDisplayValue('27.9')
    await user.clear(stopInput)
    await user.type(stopInput, '35')  // above entry 29.57

    await user.click(screen.getByRole('button', { name: /Save Changes/i }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/below entry for Long/)
  })
})
