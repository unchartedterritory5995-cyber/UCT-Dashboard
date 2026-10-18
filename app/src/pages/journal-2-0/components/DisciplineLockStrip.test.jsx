/**
 * The discipline-lock notice on its own (ruling P4a-T9-R2): what Today shows when the member has hidden the
 * coach strip. It must say what the strip says about a lock, and nothing at all when there is no lock.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

const { lockState, navSpy, accountsAsked } = vi.hoisted(() => ({
  lockState: { current: null },
  navSpy: vi.fn(),
  accountsAsked: [],
}))

vi.mock('../hooks/useJ2DisciplineState', () => ({
  default: (accountId) => { accountsAsked.push(accountId); return { state: lockState.current } },
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

import DisciplineLockStrip from './DisciplineLockStrip'
import { lockItems } from './coachLock'

beforeEach(() => {
  lockState.current = null
  navSpy.mockReset()
  accountsAsked.length = 0
})

describe('DisciplineLockStrip', () => {
  it('when the account is locked it shows one "Trade entry locked" row per reason, with the reason', () => {
    lockState.current = {
      locked: true,
      reasons: [
        { type: 'daily_loss', message: 'Daily loss cap hit.' },
        { type: 'cooling_off', message: 'Cooling off after three losses.' },
      ],
    }
    render(<DisciplineLockStrip accountId="a1" />)
    const region = screen.getByRole('region', { name: 'Trade entry locked' })
    const rows = within(region).getAllByTestId('coach-row')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.getAttribute('data-kind') === 'lock')).toBe(true)
    expect(within(region).getAllByText('Trade entry locked')).toHaveLength(2)
    expect(within(region).getByText('Daily loss cap hit.')).toBeInTheDocument()
    expect(within(region).getByText('Cooling off after three losses.')).toBeInTheDocument()
    expect(accountsAsked.at(-1)).toBe('a1')
  })

  it('its rows are the coach strip\'s own lock rows (one builder), and Open Compass goes to Compass', () => {
    lockState.current = { locked: true, reasons: [{ type: 'daily_loss', message: 'Daily loss cap hit.' }] }
    render(<DisciplineLockStrip accountId="a1" />)
    const [item] = lockItems(lockState.current)
    expect(screen.getByText(item.message)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Open Compass/ }))
    expect(navSpy).toHaveBeenCalledWith('/journal/compass')
  })

  it('a reason with an unlock time says when it unlocks', () => {
    const unlockAt = new Date(Date.now() + 5 * 60 * 1000 + 30 * 1000).toISOString()
    lockState.current = { locked: true, reasons: [{ type: 'cooling_off', message: 'Cooling off.', unlockAt }] }
    render(<DisciplineLockStrip accountId="a1" />)
    expect(screen.getByText(/^Cooling off\. — unlocks in \dm \d\ds$/)).toBeInTheDocument()
  })

  it.each([
    ['no state yet', null],
    ['not locked', { locked: false, reasons: [] }],
    ['locked with no reasons listed', { locked: true }],
  ])('renders nothing when there is %s', (_, state) => {
    lockState.current = state
    const { container } = render(<DisciplineLockStrip accountId="a1" />)
    expect(container.innerHTML).toBe('')
  })
})
